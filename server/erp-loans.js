// EMIs and loans: loan master, repayment schedules (generated or imported), EMI payment requests or recorded
// auto-debits, reminders before each due date with a funds check, and overdue flags. The forecast
// (server/erp-forecast.js) counts each unpaid instalment once: through its payment request when it has one.
import { registerErp, registerErpHooks } from './erp.js';
import { bad, conflict, newId, toPaise, optPaise, str, text, need, ymdOf, oneOf, needId, normRef, keyOf, ymdIST, addDays, daysBetween, filesFrom, inr, toBp, rupeeStr } from './erp-core.js';
import { forecast } from './erp-forecast.js';

const LOAN_TYPES = ['TERM', 'WORKING_CAPITAL', 'VEHICLE', 'MACHINERY', 'PROPERTY', 'OTHER'];
const FREQ = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };

/** the same day of the month, k months later (31 Jan + 1 month = 28/29 Feb) */
export function addMonths(ymd, k, day = Number(ymd.slice(8, 10))) {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)) - 1 + k;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
/** move a Saturday / Sunday due date to the next Monday — only when the loan is set up that way */
const nextWorkingDay = (ymd) => { const wd = new Date(ymd + 'T00:00:00Z').getUTCDay(); return wd === 6 ? addDays(ymd, 2) : wd === 0 ? addDays(ymd, 1) : ymd; };

/**
 * Build a schedule. With the principal and the annual rate it splits each EMI into interest and principal
 * (reducing balance, rounded to the paisa, the last instalment taking the remainder); without them it leaves the split blank.
 */
export function buildSchedule({ firstDue, n, emi, frequency = 'MONTHLY', principal = null, rateBp = null, weekendRule = 'NONE' }) {
  const step = FREQ[frequency] || 1, day = Number(firstDue.slice(8, 10)), out = [];
  let bal = principal;
  for (let i = 0; i < n; i++) {
    let due = addMonths(firstDue, i * step, day);
    if (weekendRule === 'NEXT_WORKING') due = nextWorkingDay(due);
    const row = { n: i + 1, due, amount: emi };
    if (principal != null && rateBp != null) {
      const interest = Math.round((bal * rateBp * step) / (10000 * 12));
      let prin = emi - interest;
      if (i === n - 1 || prin > bal) { prin = bal; row.amount = prin + interest; }
      bal -= prin;
      Object.assign(row, { interest, principal: prin, balance: bal });
    }
    out.push(row);
  }
  return out;
}

const loans = {
  'loan.save': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts manages loans and EMIs.');
    const old = a.id ? await t.get(`erp_loan/${needId(a.id)}`) : null;
    if (a.id && !old) bad('That loan no longer exists.');
    const bankId = needId(a.bankId, 'Linked bank account');
    if (!(await t.get(`erp_bank/${bankId}`))) bad('Linked bank account: pick a company account.');
    const rec = {
      ...(old || {}), lender: need(str(a.lender, 120), 'Lender'), ref: need(str(a.ref, 60), 'Loan reference'), type: oneOf(String(a.type || 'TERM'), LOAN_TYPES, 'Loan type'),
      principal: optPaise(a.principal, 'Original loan amount'), outstanding: optPaise(a.outstanding, 'Outstanding principal'), outstandingAsOf: ymdOf(a.outstandingAsOf, 'Outstanding as of', { optional: true }),
      bankId, owner: a.owner && typeof a.owner === 'string' ? a.owner : old?.owner || by, note: text(a.note, 1000), updatedAt: now,
      files: [...(old?.files || []), ...(await filesFrom(a.files, t, by, now))],
    };
    if (!old) {
      const emi = toPaise(a.emi, 'EMI amount', { allowZero: false });
      const n = Number(a.n);
      if (!Number.isInteger(n) || n < 1 || n > 600) bad('Number of instalments: enter a whole number between 1 and 600.');
      const firstDue = ymdOf(a.firstDue, 'First EMI date');
      const frequency = oneOf(String(a.frequency || 'MONTHLY'), Object.keys(FREQ), 'Frequency');
      const rateBp = a.rate === '' || a.rate == null ? null : toBp(a.rate, 'Interest rate');
      const weekendRule = oneOf(String(a.weekendRule || 'NONE'), ['NONE', 'NEXT_WORKING'], 'Weekend rule');
      Object.assign(rec, { code: await t.next('LOAN'), emi, n, firstDue, frequency, rateBp, weekendRule, status: 'ACTIVE', createdAt: now, createdBy: by, corrections: [],
        schedule: buildSchedule({ firstDue, n, emi, frequency, principal: rec.outstanding ?? rec.principal, rateBp, weekendRule }) });
      rec.endDate = rec.schedule[rec.schedule.length - 1].due;
    }
    const id = a.id || newId();
    // the same lender reference can't be entered twice
    if (!old && !(await t.claim(`erp_key/loan_${keyOf(normRef(rec.lender), normRef(rec.ref))}`, { id, at: now }))) conflict(`Loan ${rec.ref} from ${rec.lender} is already entered.`);
    await t.set(`erp_loan/${id}`, rec);
    await audit(old ? 'LOAN_CHANGED' : 'LOAN_ADDED', { loan: id, code: rec.code, lender: rec.lender, emi: rec.emi, n: rec.n });
    return { id, code: rec.code };
  },
  /** replace the unpaid part of the schedule with the lender's own (rows parsed from their file), with a reason */
  'loan.import': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts manages loans and EMIs.');
    const id = needId(a.id), l = await t.get(`erp_loan/${id}`);
    if (!l) bad('That loan no longer exists.');
    const reason = need(text(a.reason, 500), 'Reason');
    const rows = Array.isArray(a.rows) ? a.rows : [];
    if (!rows.length || rows.length > 600) bad('The schedule file has no instalments.');
    const kept = (l.schedule || []).filter((i) => i.paid || i.payId);
    const keptDue = new Set(kept.map((i) => i.due));
    const fresh = rows.map((r, k) => ({ due: ymdOf(r.due, `Row ${k + 1}: due date`), amount: toPaise(r.amount, `Row ${k + 1}: EMI`, { allowZero: false }), principal: optPaise(r.principal, `Row ${k + 1}: principal`), interest: optPaise(r.interest, `Row ${k + 1}: interest`) }))
      .filter((r) => !keptDue.has(r.due)).sort((x, y) => x.due.localeCompare(y.due));
    for (const r of fresh) if (r.principal != null && r.interest != null && r.principal + r.interest !== r.amount) bad(`The instalment due ${r.due}: principal + interest doesn’t equal the EMI.`);
    const schedule = [...kept, ...fresh].sort((x, y) => x.due.localeCompare(y.due)).map((r, k) => ({ ...r, n: k + 1 }));
    await t.set(`erp_loan/${id}`, { ...l, schedule, n: schedule.length, endDate: schedule[schedule.length - 1].due, updatedAt: now, corrections: [...(l.corrections || []), { at: now, by, reason, what: `Schedule imported (${fresh.length} unpaid instalments)` }] });
    await audit('EMI_SCHEDULE_IMPORTED', { loan: id, code: l.code, rows: fresh.length, reason });
    return { n: schedule.length };
  },
  /** correct one instalment (date or amount), with a reason — paid ones are history and can't change */
  'loan.fix': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts manages loans and EMIs.');
    const id = needId(a.id), l = await t.get(`erp_loan/${id}`);
    if (!l) bad('That loan no longer exists.');
    const i = (l.schedule || []).find((x) => x.n === Number(a.n));
    if (!i) bad('Pick the instalment to correct.');
    if (i.paid) bad('A paid instalment can’t be changed.');
    const reason = need(text(a.reason, 500), 'Reason for the correction');
    const before = { due: i.due, amount: i.amount };
    if (a.due) i.due = ymdOf(a.due, 'Due date');
    if (a.amount) i.amount = toPaise(a.amount, 'EMI amount', { allowZero: false });
    if (a.skip) i.skipped = { at: now, by, reason }; // e.g. a moratorium month agreed with the lender
    if (i.payId && (i.amount !== before.amount)) bad('This instalment already has a payment request. Cancel that request first, then correct the amount.');
    await t.set(`erp_loan/${id}`, { ...l, updatedAt: now, corrections: [...(l.corrections || []), { at: now, by, reason, what: `EMI ${i.n}: ${before.due} ${inr(before.amount)} → ${i.due} ${inr(i.amount)}${a.skip ? ' (skipped)' : ''}` }] });
    await audit('EMI_SCHEDULE_CORRECTED', { loan: id, code: l.code, n: i.n, from: before, to: { due: i.due, amount: i.amount }, reason });
    return { ok: true };
  },
  /** raise the payment request for an instalment (Accounts then verifies / approves / pays it as usual) */
  'loan.request': async (a, env) => {
    const { need: needP, t, now } = env;
    needP('acc', 'Only Accounts manages loans and EMIs.');
    const id = needId(a.id), l = await t.get(`erp_loan/${id}`);
    if (!l) bad('That loan no longer exists.');
    const i = (l.schedule || []).find((x) => x.n === Number(a.n));
    if (!i || i.paid || i.skipped) bad('That instalment is paid, skipped or doesn’t exist.');
    if (i.payId) { const p = await t.get(`erp_pay/${i.payId}`); if (p && !['REJECTED', 'CANCELLED'].includes(p.status)) conflict(`EMI ${i.n} already has payment request ${p.code}.`); }
    const r = await env.run('pay.create', { category: 'EMI', payee: l.lender, invoiceRef: `${l.ref}-EMI-${i.n}`, amount: rupeeStr(i.amount), due: i.due, proposedDate: i.due, priority: 'CRITICAL', bankId: l.bankId, loanId: id, emiN: i.n, note: `EMI ${i.n} of ${l.schedule.length} — ${l.lender} ${l.ref}` });
    const fresh = await t.get(`erp_loan/${id}`);
    await t.set(`erp_loan/${id}`, { ...fresh, schedule: fresh.schedule.map((x) => (x.n === i.n ? { ...x, payId: r.id } : x)), updatedAt: now });
    return r;
  },
  /** an EMI the bank debited automatically: record it with the bank reference */
  'loan.paid': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts manages loans and EMIs.');
    const id = needId(a.id), l = await t.get(`erp_loan/${id}`);
    if (!l) bad('That loan no longer exists.');
    const i = (l.schedule || []).find((x) => x.n === Number(a.n));
    if (!i || i.paid) bad('That instalment is already paid or doesn’t exist.');
    if (i.payId) { const p = await t.get(`erp_pay/${i.payId}`); if (p && !['REJECTED', 'CANCELLED'].includes(p.status)) bad(`EMI ${i.n} is being paid through ${p.code} — record the payment there.`); }
    const date = ymdOf(a.date, 'Debit date');
    if (date > ymdIST(now)) bad('Record the EMI after the bank has debited it.');
    const ref = str(a.ref, 60);
    if (normRef(ref).length < 4) bad('Enter the bank reference of the debit as evidence.');
    if (!(await t.claim(`erp_key/utr_${keyOf(l.bankId, normRef(ref))}`, { loan: id, n: i.n, at: now }))) conflict(`Bank reference ${ref} is already recorded on another payment from this account.`);
    i.paid = { date, ref, by, at: now, bankId: l.bankId };
    delete i.payId;
    await t.set(`erp_loan/${id}`, { ...l, updatedAt: now, ...(l.schedule.every((x) => x.paid || x.skipped) ? { status: 'CLOSED' } : {}) });
    await audit('EMI_PAID', { loan: id, code: l.code, n: i.n, amount: i.amount, ref, date });
    return { ok: true };
  },
  'loan.close': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts manages loans and EMIs.');
    const id = needId(a.id), l = await t.get(`erp_loan/${id}`);
    if (!l) bad('That loan no longer exists.');
    const reason = need(text(a.reason, 500), 'Reason (e.g. foreclosed — NOC received)');
    await t.set(`erp_loan/${id}`, { ...l, status: 'CLOSED', closed: { at: now, by, reason }, updatedAt: now });
    await audit('LOAN_CLOSED', { loan: id, code: l.code, reason });
    return { ok: true };
  },
  /**
   * Reminders and overdue flags, at most once each (a unique key per loan, instalment and day count). Runs when
   * Accounts opens the app and from the optional scheduled job (GET /api/cron/erp).
   */
  'erp.tick': async (a, { E, s, t, now, notify, holders, cfg }) => {
    if (!E.has('acc') && !s.system) return { skipped: true };
    const c = await cfg(), today = ymdIST(now), sent = [];
    const loansL = (await t.list('erp_loan')).filter((x) => x.data.status === 'ACTIVE');
    if (!loansL.length) return { sent };
    const [banks, bals, rcpts, pays] = await Promise.all(['erp_bank', 'erp_bal', 'erp_rcpt', 'erp_pay'].map((x) => t.list(x)));
    const fc = forecast({ banks, bals, rcpts, pays, loans: loansL, cfg: c, today, horizon: Math.max(...c.emiRemind, 7) + 1, scenario: 'base' });
    const to = (l) => [...new Set([...holders('acc'), l.owner])];
    for (const { id, data: l } of loansL) {
      for (const i of l.schedule || []) {
        if (i.paid || i.skipped) continue;
        const left = daysBetween(today, i.due);
        if (left < 0) {
          if (await t.claim(`erp_key/od_${keyOf(id, i.n)}`, { at: now })) { await notify(to(l), { title: `Overdue EMI: ${l.lender} ${i.n}/${l.schedule.length}`, body: `${inr(i.amount)} was due ${i.due} and isn’t recorded as paid.`, go: { view: 'accounts', erp: id, erpKind: 'loan' } }, { system: true }); sent.push(['overdue', l.code, i.n]); }
          continue;
        }
        if (!c.emiRemind.includes(left)) continue;
        if (!(await t.claim(`erp_key/rem_${keyOf(id, i.n, left)}`, { at: now }))) continue;
        const acct = fc.accounts.find((x) => x.id === l.bankId), day = acct?.series.find((x) => x.date === i.due);
        const short = day && day.close < acct.protect;
        await notify(to(l), { title: `EMI in ${left} day${left === 1 ? '' : 's'}: ${l.lender} ${inr(i.amount)}`, body: `Due ${i.due} from ${acct?.name || 'the linked account'}.${short ? ` Warning: the account is projected at ${inr(day.close)} that day, below its protected cash of ${inr(acct.protect)}.` : ''}${i.payId ? '' : ' No payment request yet.'}`, go: { view: 'accounts', erp: id, erpKind: 'loan' } }, { system: true });
        sent.push(['remind', l.code, i.n, left, short]);
      }
    }
    return { sent };
  },
};
registerErp(loans);

// when a payment request for an EMI is paid in full, the instalment is paid (and the loan closes after the last one)
registerErpHooks({ afterPayment: (...x) => emiAfterPayment(...x) });
export async function emiAfterPayment(id, before, after, t) {
  if (!after.loanId || after.status === before.status) return;
  const l = await t.get(`erp_loan/${after.loanId}`);
  if (!l) return;
  const sched = (l.schedule || []).map((i) => {
    if (i.n !== after.emiN || i.payId !== id) return i;
    if (after.status === 'PAID') { const last = (after.payments || []).filter((x) => x.amount > 0 && !x.reversed).slice(-1)[0]; return { ...i, paid: { date: last?.date, ref: last?.ref, payId: id, bankId: last?.bankId } }; }
    if (['REJECTED', 'CANCELLED'].includes(after.status)) { const { payId, ...rest } = i; return rest; } // the instalment is unpaid and free for a new request
    if (i.paid && after.status !== 'PAID') { const { paid, ...rest } = i; return rest; } // a reversal
    return i;
  });
  await t.set(`erp_loan/${after.loanId}`, { ...l, schedule: sched, ...(sched.every((x) => x.paid || x.skipped) ? { status: 'CLOSED' } : { status: l.status === 'CLOSED' && !l.closed ? 'ACTIVE' : l.status }) });
}
