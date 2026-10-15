// Cash-flow forecast: projected closing cash = opening verified cash + expected receipts − planned payments, per bank
// account and for the company. Pure function (no database), used by the forecast and summary commands and the tests.
//
// How double counting is avoided:
//  • Each account starts from its latest verified balance (statement, Tally import or manual verification, with a date).
//    Money received or paid ON or BEFORE that date is assumed to be inside the balance already; only movements dated
//    after it are added (as actual movements, not yet verified).
//  • A payment request is one outflow: its unpaid remainder (approved − paid), never the invoice and the request both.
//  • An EMI instalment that already has a payment request is counted through that request, not again from the loan.
//  • Transfers between company accounts move cash between accounts; the company total doesn't change.
//  • Protected cash = each account's own buffer + its restricted (earmarked) funds; the company-wide buffer applies only
//    as far as account buffers don't already cover it. Commitments already in the forecast (EMIs, scheduled payments)
//    are outflows — they are not also deducted as restricted funds.
import { addDays, daysBetween } from './erp-core.js';

// share of an outstanding receipt counted, and days of delay, per scenario and certainty
export const SCENARIOS = {
  base: { label: 'Base case', rcpt: { FIRM: [100, 0], LIKELY: [100, 0], UNCERTAIN: [0, 0] }, overdue: [100, 7], pending: true, held: false, emiDelay: 0 },
  conservative: { label: 'Conservative', rcpt: { FIRM: [100, 7], LIKELY: [50, 15], UNCERTAIN: [0, 0] }, overdue: [50, 30], pending: true, held: false, emiDelay: 0 },
  stress: { label: 'Stress', rcpt: { FIRM: [100, 30], LIKELY: [0, 0], UNCERTAIN: [0, 0] }, overdue: [0, 0], pending: true, held: true, emiDelay: 0 },
};
const share = (p, pct) => Math.round((p * pct) / 100);
const sum = (l, f = (x) => x) => l.reduce((s, x) => s + f(x), 0);
export const paidOf = (p) => sum(p.payments || [], (x) => x.amount || 0);
export const receivedOf = (r) => sum(r.received || [], (x) => x.amount || 0);
const OUT_STATES = ['APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'];
const PENDING_STATES = ['SUBMITTED', 'UNDER_REVIEW'];

/** receipts: status as of a date (never stored as fact — "overdue" depends on today) */
export function rcptStatus(r, today) {
  if (r.cancelled) return 'CANCELLED';
  const got = receivedOf(r);
  if (got >= r.amount) return 'RECEIVED';
  if (r.disputed) return 'DISPUTED';
  if (got > 0) return 'PARTIAL';
  const due = r.promisedDate || r.expectedDate;
  if (due < today) return 'OVERDUE';
  if (due === today) return 'DUE';
  return 'EXPECTED';
}

/**
 * banks: [{id, data}] erp_bank · bals: erp_bal · rcpts: erp_rcpt · pays: erp_pay · loans: erp_loan
 * Returns { today, horizon, scenario, accounts:[…], company, events, shortfalls }
 */
export function forecast({ banks = [], bals = [], rcpts = [], pays = [], loans = [], cfg = {}, today, horizon = 90, scenario = 'base' }) {
  const sc = SCENARIOS[scenario] || SCENARIOS.base;
  const end = addDays(today, horizon);
  const acct = new Map();
  for (const { id, data: b } of banks) {
    if (b.active === false) continue;
    const latest = bals.filter((x) => x.data.bankId === id).sort((x, y) => (y.data.asOf || '').localeCompare(x.data.asOf || '') || (y.data.at || 0) - (x.data.at || 0))[0]?.data || null;
    acct.set(id, { id, name: b.name, bank: b.bank, opening: latest ? latest.amount : null, asOf: latest?.asOf || null, source: latest?.source || null, verifiedAt: latest?.at || null, buffer: b.buffer ?? null, restricted: b.restricted || 0 });
  }
  const after = (bankId, date) => { const a = acct.get(bankId); return !a || !a.asOf || date > a.asOf; };
  const events = [];
  const ev = (date, bankId, amount, kind, ref, label, extra = {}) => { if (amount) events.push({ date: date < today && !['RECEIVED', 'PAID', 'TRANSFER_IN'].includes(kind) ? today : date, bankId: acct.has(bankId) ? bankId : null, amount, kind, ref, label, ...extra }); };

  // receipts: actual ones after verification, and the expected remainder per scenario
  for (const { id, data: r } of rcpts) {
    if (r.cancelled) continue;
    for (const x of r.received || []) if (after(x.bankId, x.date)) ev(x.date, x.bankId, x.amount, 'RECEIVED', id, `${r.customer} · ${r.ref || r.code}`, { code: r.code });
    const left = r.amount - receivedOf(r);
    if (left <= 0 || r.disputed) continue;
    const due = r.promisedDate || r.expectedDate, overdue = due < today;
    const [pct, delay] = overdue ? sc.overdue : sc.rcpt[r.certainty] || sc.rcpt.LIKELY;
    const amt = share(left, pct);
    if (amt > 0) ev(overdue ? addDays(today, delay) : addDays(due, delay), r.bankId, amt, 'EXPECTED_RECEIPT', id, `${r.customer} · ${r.ref || r.code}`, { code: r.code, certainty: r.certainty || 'LIKELY', overdue });
  }
  // payments: made after verification, and the unpaid remainder of approved / pending ones
  for (const { id, data: p } of pays) {
    if (['REJECTED', 'CANCELLED', 'DRAFT'].includes(p.status)) continue;
    const label = `${p.payee} · ${p.code}`;
    for (const x of p.payments || []) {
      const bank = x.bankId || p.bankId;
      if (after(bank, x.date)) ev(x.date, bank, -x.amount, 'PAID', id, label, { code: p.code, category: p.category });
      if (p.category === 'TRANSFER' && after(p.transferTo, x.date)) ev(x.date, p.transferTo, x.amount, 'TRANSFER_IN', id, label, { code: p.code, category: p.category });
    }
    const left = (p.amountApproved ?? p.amountReq) - paidOf(p);
    if (left <= 0) continue;
    const st = p.status === 'ON_HOLD' ? p.heldFrom : p.status;
    const counted = OUT_STATES.includes(st) ? (p.status !== 'ON_HOLD' || sc.held) : PENDING_STATES.includes(st) && sc.pending && (p.status !== 'ON_HOLD' || sc.held);
    if (!counted) continue;
    const date = p.scheduledDate || p.proposedDate || p.due || today;
    const pend = PENDING_STATES.includes(st) ? { pending: true } : {};
    ev(date, p.bankId, -left, 'PLANNED_PAYMENT', id, label, { code: p.code, category: p.category, priority: p.priority, status: p.status, ...pend });
    if (p.category === 'TRANSFER') ev(date, p.transferTo, left, 'TRANSFER_IN', id, label, { code: p.code, category: p.category, ...pend });
  }
  // EMIs not yet turned into a payment request (once they are, the request above carries them)
  for (const { id, data: l } of loans) {
    if (l.status === 'CLOSED' || l.status === 'CANCELLED') continue;
    for (const i of l.schedule || []) {
      // an EMI the bank debited directly (no payment request) is an actual outflow once, if after the verified balance
      if (i.paid && !i.payId) { if (after(i.paid.bankId || l.bankId, i.paid.date)) ev(i.paid.date, i.paid.bankId || l.bankId, -i.amount, 'PAID', id, `${l.lender} EMI ${i.n}`, { code: l.code, n: i.n, category: 'EMI' }); continue; }
      if (i.paid || i.payId || i.skipped || i.due > end) continue;
      ev(i.due < today ? today : addDays(i.due, sc.emiDelay), l.bankId, -i.amount, 'EMI', id, `${l.lender} EMI ${i.n}/${(l.schedule || []).length}`, { code: l.code, n: i.n, overdue: i.due < today, category: 'EMI' });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);

  // day-by-day closing balance per account, from today to the horizon
  const days = []; for (let d = today; d <= end; d = addDays(d, 1)) days.push(d);
  const series = (filter, start) => {
    let bal = start, k = 0;
    const evs = events.filter(filter), out = [];
    for (const d of days) {
      let inn = 0, outn = 0;
      while (k < evs.length && evs[k].date <= d) { const e = evs[k++]; bal += e.amount; if (e.amount > 0) inn += e.amount; else outn -= e.amount; }
      out.push({ date: d, in: inn, out: outn, close: bal });
    }
    return out;
  };
  const companyBufferExtra = Math.max(0, (cfg.cashBuffer || 0) - sum([...acct.values()], (a) => a.buffer || 0));
  const accounts = [...acct.values()].map((a) => {
    const protect = (a.buffer || 0) + (a.restricted || 0);
    const s = series((e) => e.bankId === a.id, a.opening || 0);
    const sinceVerified = sum(events.filter((e) => e.bankId === a.id && e.date <= today && ['RECEIVED', 'PAID', 'TRANSFER_IN'].includes(e.kind)), (e) => e.amount);
    const minClose = Math.min(...s.map((x) => x.close));
    return { ...a, protect, verified: a.opening != null, sinceVerified, current: (a.opening || 0) + sinceVerified, series: s, minClose, closeEnd: s[s.length - 1].close, availableToSpend: Math.max(0, minClose - protect) };
  });
  const unassigned = series((e) => e.bankId == null, 0);
  const companySeries = days.map((d, i) => ({ date: d, in: sum(accounts, (a) => a.series[i].in) + unassigned[i].in, out: sum(accounts, (a) => a.series[i].out) + unassigned[i].out, close: sum(accounts, (a) => a.series[i].close) + unassigned[i].close }));
  const protect = sum(accounts, (a) => a.protect) + companyBufferExtra;
  const minClose = Math.min(...companySeries.map((x) => x.close));
  const company = {
    verifiedTotal: sum(accounts, (a) => a.opening || 0), oldestAsOf: accounts.filter((a) => a.asOf).map((a) => a.asOf).sort()[0] || null,
    unverifiedAccounts: accounts.filter((a) => !a.verified).map((a) => a.id),
    sinceVerified: sum(accounts, (a) => a.sinceVerified), current: sum(accounts, (a) => a.current),
    protect, series: companySeries, minClose, closeEnd: companySeries[companySeries.length - 1].close, availableToSpend: Math.max(0, minClose - protect),
    unassignedNet: unassigned[unassigned.length - 1].close,
  };
  // the first day each account (and the company) falls below its protected cash, and the commitments behind it
  const shortfalls = [];
  const firstShort = (s, prot, filter, bankId, name) => {
    const i = s.findIndex((x) => x.close < prot);
    if (i < 0) return;
    const date = s[i].date;
    const causes = events.filter((e) => filter(e) && e.amount < 0 && e.date <= date).sort((a, b) => a.amount - b.amount).slice(0, 6);
    shortfalls.push({ bankId, name, date, close: s[i].close, protect: prot, shortBy: prot - s[i].close, belowZero: s[i].close < 0, causes });
  };
  for (const a of accounts) firstShort(a.series, a.protect, (e) => e.bankId === a.id, a.id, a.name);
  firstShort(companySeries, protect, () => true, null, 'Company total');
  return { today, horizon, scenario, label: sc.label, accounts, company, events: events.filter((e) => e.date <= end), shortfalls, days: daysBetween(today, end) + 1 };
}
