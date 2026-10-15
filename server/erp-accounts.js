// Accounts: bank accounts and verified balances, receipts, payment requests (maker-checker) and the cash-flow forecast.
// Tally stays the official ledger: these records plan, control and evidence payments; nothing here posts to Tally.
import { registerErp } from './erp.js';
import { approveLimit } from './erp-perms.js';
import { bad, deny, conflict, newId, toPaise, optPaise, str, text, need, ymdOf, oneOf, isId, needId, normRef, keyOf, ymdIST, filesFrom, inr, PAY_CATEGORIES } from './erp-core.js';
import { forecast, paidOf, receivedOf, rcptStatus, SCENARIOS } from './erp-forecast.js';

export const PAY_STATUS = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'CANCELLED', 'ON_HOLD'];
const METHODS = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];
const PRIORITY = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'];
const CERTAINTY = ['FIRM', 'LIKELY', 'UNCERTAIN'];
const DEAD = ['REJECTED', 'CANCELLED'];
const normName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function bankOf(t, id, label = 'Bank account') {
  needId(id, label);
  const b = await t.get(`erp_bank/${id}`);
  if (!b || b.active === false) bad(`${label}: pick an active company account.`);
  return b;
}
const hist = (p, by, now, action, note = '') => [...(p.history || []), { at: now, by, action, note: note || undefined }];
/** paid / partly paid follow from the recorded payments; otherwise the workflow state stands */
function settle(p) {
  const paid = paidOf(p), due = p.amountApproved ?? p.amountReq;
  if (DEAD.includes(p.status)) return p.status;
  if (paid > 0 && paid >= due) return 'PAID';
  if (paid > 0) return p.status === 'ON_HOLD' ? 'ON_HOLD' : 'PARTIALLY_PAID';
  if (['PAID', 'PARTIALLY_PAID'].includes(p.status)) return p.scheduledDate ? 'SCHEDULED' : 'APPROVED'; // after a reversal
  return p.status;
}
/** who may raise a payment request for a category */
function mayRequest(E, category) {
  if (E.has('acc')) return true;
  return E.has('pur') && ['SUPPLIER', 'ADVANCE'].includes(category);
}

/** Duplicate payment requests: same payee and normalised invoice reference (never the amount alone). */
async function duplicatesOf(t, p, selfId) {
  if (!p.dupKey) return [];
  return (await t.list('erp_pay')).filter((x) => x.id !== selfId && x.data.dupKey === p.dupKey && !DEAD.includes(x.data.status)).map((x) => ({ id: x.id, code: x.data.code, status: x.data.status, amount: x.data.amountReq }));
}

const accounts = {
  /* ── bank accounts ── */
  'bank.save': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts can manage bank accounts.');
    const id = a.id ? needId(a.id) : newId(), old = a.id ? await t.get(`erp_bank/${id}`) : null;
    if (a.id && !old) bad('That account no longer exists.');
    // only the last four digits are ever kept — never the full number, and never passwords, PINs or OTPs
    const last4 = String(a.last4 ?? old?.last4 ?? '').replace(/\D/g, '');
    if (last4.length !== 4) bad('Enter the last 4 digits of the account number (only those are stored).');
    const rec = {
      name: need(str(a.name, 80), 'Account nickname'), bank: need(str(a.bank, 80), 'Bank name'), last4, masked: 'XXXX' + last4,
      currency: oneOf(String(a.currency || old?.currency || 'INR'), ['INR'], 'Currency'),
      buffer: optPaise(a.buffer, 'Minimum balance / buffer'), restricted: optPaise(a.restricted, 'Restricted funds') ?? 0,
      restrictedNote: str(a.restrictedNote, 200), note: str(a.note, 300), active: a.active !== false,
      createdAt: old?.createdAt ?? now, createdBy: old?.createdBy ?? by, updatedAt: now,
    };
    await t.set(`erp_bank/${id}`, rec);
    if (!old) {
      const amount = toPaise(a.openingAmount, 'Opening balance', { allowNegative: true });
      const asOf = ymdOf(a.openingDate, 'Opening balance date');
      if (asOf > ymdIST(now)) bad('The opening balance date can’t be in the future.');
      await t.set(`erp_bal/${newId()}`, { bankId: id, amount, asOf, source: 'OPENING', at: now, by, note: 'Opening balance' });
    }
    await audit(old ? 'BANK_ACCOUNT_CHANGED' : 'BANK_ACCOUNT_ADDED', { bank: id, name: rec.name, ...(old ? { from: { buffer: old.buffer, restricted: old.restricted, active: old.active }, to: { buffer: rec.buffer, restricted: rec.restricted, active: rec.active } } : {}) });
    return { id };
  },
  /** a verified balance from a statement or the bank's portal — the figure the forecast starts from */
  'bal.verify': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts can verify bank balances.');
    const b = await bankOf(t, a.bankId);
    const asOf = ymdOf(a.asOf, 'Balance date');
    if (asOf > ymdIST(now)) bad('The balance date can’t be in the future.');
    const amount = toPaise(a.amount, 'Balance', { allowNegative: true });
    const note = need(str(a.note, 200), 'Where the balance was checked (e.g. “HDFC portal, closing balance”)');
    const id = newId();
    await t.set(`erp_bal/${id}`, { bankId: a.bankId, amount, asOf, source: 'MANUAL', at: now, by, note });
    await audit('BANK_BALANCE_VERIFIED', { bank: a.bankId, name: b.name, amount, asOf });
    return { id };
  },

  /* ── receipts (expected money in; expected is never cash) ── */
  'rcpt.save': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts can manage receipts.');
    const old = a.id ? await t.get(`erp_rcpt/${needId(a.id)}`) : null;
    if (a.id && !old) bad('That receipt no longer exists.');
    if (old?.cancelled) bad('This receipt was cancelled.');
    const amount = toPaise(a.amount, 'Expected amount', { allowZero: false });
    if (old && amount < receivedOf(old)) bad(`More than ${inr(amount)} has already been received.`);
    if (a.bankId) await bankOf(t, a.bankId, 'Account to be credited');
    const rec = {
      ...(old || {}), customer: need(str(a.customer, 120), 'Customer'), ref: str(a.ref, 60), amount,
      expectedDate: ymdOf(a.expectedDate, 'Expected date'), promisedDate: ymdOf(a.promisedDate, 'Promised date', { optional: true }),
      certainty: oneOf(String(a.certainty || 'LIKELY'), CERTAINTY, 'Certainty'), bankId: a.bankId || null, tallyRef: str(a.tallyRef, 60),
      updatedAt: now,
    };
    const id = a.id || newId();
    if (!old) Object.assign(rec, { code: await t.next('RCPT'), received: [], notes: [], createdAt: now, createdBy: by });
    if (a.note) rec.notes = [...(rec.notes || []), { at: now, by, text: text(a.note, 500) }];
    await t.set(`erp_rcpt/${id}`, rec);
    await audit(old ? 'RECEIPT_CHANGED' : 'RECEIPT_EXPECTED', { rcpt: id, code: rec.code, customer: rec.customer, amount, ...(old && old.amount !== amount ? { from: old.amount } : {}) });
    return { id, code: rec.code };
  },
  'rcpt.receive': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts can record receipts.');
    const id = needId(a.id), r = await t.get(`erp_rcpt/${id}`);
    if (!r || r.cancelled) bad('That receipt doesn’t exist or was cancelled.');
    const amount = toPaise(a.amount, 'Amount received', { allowZero: false }), left = r.amount - receivedOf(r);
    if (amount > left) bad(`Only ${inr(left)} is outstanding on ${r.code}. Record the extra as a separate receipt.`);
    const date = ymdOf(a.date, 'Date received');
    if (date > ymdIST(now)) bad('Money can’t be received in the future — record it when it arrives.');
    await bankOf(t, a.bankId, 'Account credited');
    const files = await filesFrom(a.files, t, by, now);
    const entry = { amount, date, bankId: a.bankId, ref: need(str(a.ref, 60), 'Bank reference / UTR'), by, at: now, ...(files.length ? { files } : {}) };
    const next = { ...r, received: [...(r.received || []), entry], updatedAt: now };
    next.status = rcptStatus(next, ymdIST(now));
    await t.set(`erp_rcpt/${id}`, next);
    await audit('RECEIPT_RECEIVED', { rcpt: id, code: r.code, amount, bank: a.bankId, date });
    return { status: next.status };
  },
  'rcpt.update': async (a, { need: needP, t, now, by, audit }) => {
    needP('acc', 'Only Accounts can manage receipts.');
    const id = needId(a.id), r = await t.get(`erp_rcpt/${id}`);
    if (!r) bad('That receipt no longer exists.');
    const next = { ...r, updatedAt: now };
    if (a.action === 'note') next.notes = [...(r.notes || []), { at: now, by, text: need(text(a.text, 500), 'Note') }];
    else if (a.action === 'dispute') { next.disputed = true; next.notes = [...(r.notes || []), { at: now, by, text: 'Disputed: ' + need(text(a.text, 500), 'Reason') }]; }
    else if (a.action === 'undispute') { next.disputed = false; next.notes = [...(r.notes || []), { at: now, by, text: 'Dispute resolved' + (a.text ? ': ' + text(a.text, 500) : '') }]; }
    else if (a.action === 'cancel') {
      if (receivedOf(r) > 0) bad('Part of this has been received, so it can’t be cancelled. Reduce the expected amount instead.');
      next.cancelled = { at: now, by, reason: need(text(a.text, 300), 'Reason') };
    } else bad('Unknown action.');
    next.status = rcptStatus(next, ymdIST(now));
    await t.set(`erp_rcpt/${id}`, next);
    if (a.action !== 'note') await audit(`RECEIPT_${a.action.toUpperCase()}`, { rcpt: id, code: r.code });
    return { status: next.status };
  },

  /* ── payment requests ── */
  'pay.create': async (a, env) => {
    const { E, t, now, by, audit, notify, holders } = env;
    const category = oneOf(String(a.category || ''), Object.keys(PAY_CATEGORIES), 'Payment category');
    if (!mayRequest(E, category)) deny('You can’t raise this kind of payment request.');
    // a repeated submission (double click, retry after a network error) returns the request already made
    const ck = typeof a.clientKey === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(a.clientKey) ? `erp_key/ck_${keyOf(by, a.clientKey)}` : null;
    if (ck) { const prev = await t.get(ck); if (prev) return { id: prev.id, code: prev.code, replay: true }; }
    const amountReq = toPaise(a.amount, 'Amount', { allowZero: false });
    const bankId = a.bankId || null;
    if (bankId) await bankOf(t, bankId, 'Paying account');
    let payee = str(a.payee, 120), transferTo = null;
    if (category === 'TRANSFER') {
      if (!bankId) bad('Pick the account the money leaves from.');
      const to = await bankOf(t, a.transferTo, 'Receiving account');
      if (a.transferTo === bankId) bad('A transfer needs two different accounts.');
      transferTo = a.transferTo; payee = `Transfer to ${to.name}`;
    }
    need(payee, 'Payee');
    const invoiceRef = str(a.invoiceRef, 60);
    const rec = {
      category, payee, supplierId: isId(a.supplierId) ? a.supplierId : null, invoiceRef, amountReq, amountApproved: null,
      due: ymdOf(a.due, 'Due date', { optional: true }), proposedDate: ymdOf(a.proposedDate, 'Proposed payment date', { optional: true }),
      priority: oneOf(String(a.priority || 'NORMAL'), PRIORITY, 'Priority'), bankId, transferTo,
      method: oneOf(String(a.method || 'NEFT'), METHODS, 'Payment method'), note: text(a.note, 1000), tallyRef: str(a.tallyRef, 60),
      files: await filesFrom(a.files, t, by, now), requestedBy: by, createdAt: now, payments: [],
      dupKey: invoiceRef ? keyOf('pay', a.supplierId || normName(payee), normRef(invoiceRef)) : null,
      ...(a.poId && isId(a.poId) ? { poId: a.poId } : {}), ...(a.invoiceId && isId(a.invoiceId) ? { invoiceId: a.invoiceId } : {}),
      ...(a.loanId && isId(a.loanId) ? { loanId: a.loanId, emiN: Number.isInteger(a.emiN) ? a.emiN : null } : {}),
    };
    // Purchase checks invoice payments against the remaining liability and advances against the PO's terms
    for (const f of env.hooks.beforeCreate) await f(rec, t, a, env);
    const dups = await duplicatesOf(t, rec, null);
    if (dups.length) {
      const ov = a.override;
      if (!ov) conflict(`Possible duplicate: ${dups.map((d) => `${d.code} (${d.status.toLowerCase().replace(/_/g, ' ')}, ${inr(d.amount)})`).join(', ')} already uses invoice “${invoiceRef}” for this payee.`);
      if (!E.has('acc.approve')) deny('A duplicate can only be raised by a payment approver, with a reason.');
      const reason = text(ov.reason, 500);
      if (reason.length < 10) bad('Explain why this isn’t a duplicate, in a full sentence.');
      rec.dupOverride = { by, at: now, reason, of: dups.map((d) => d.code) };
    }
    rec.status = a.submit === false ? 'DRAFT' : 'SUBMITTED';
    rec.history = hist({}, by, now, rec.status === 'DRAFT' ? 'Drafted' : 'Submitted');
    const id = newId();
    rec.code = await t.next('PAY');
    await t.set(`erp_pay/${id}`, rec);
    if (ck) await t.claim(ck, { id, code: rec.code, at: now });
    await audit('PAYMENT_REQUESTED', { pay: id, code: rec.code, category, payee, amount: amountReq, ...(rec.dupOverride ? { duplicateOverride: rec.dupOverride } : {}) });
    if (rec.dupOverride) await audit('DUPLICATE_OVERRIDE', { pay: id, code: rec.code, of: rec.dupOverride.of, reason: rec.dupOverride.reason });
    if (rec.advanceOverride) await audit('ADVANCE_OVER_TERMS', { pay: id, code: rec.code, allowed: rec.advanceOverride.allowed, amount: amountReq, reason: rec.advanceOverride.reason });
    if (rec.status === 'SUBMITTED') await notify(holders('acc'), { title: `Payment request ${rec.code} to verify`, body: `${payee} · ${inr(amountReq)}`, go: { view: 'accounts', erp: id } });
    return { id, code: rec.code };
  },
  'pay.act': async (a, env) => {
    const { E, t, now, by, me, audit, notify, holders, s } = env;
    const id = needId(a.id), p = await t.get(`erp_pay/${id}`);
    if (!p) bad('That payment request no longer exists.');
    const act = String(a.action || '');
    const mine = p.requestedBy === by, acc = E.has('acc'), approver = E.has('acc.approve');
    // first: may this person see the request at all? (nothing about it is revealed otherwise)
    if (!acc && !approver && !mine && !(E.has('pur') && (p.poId || p.supplierId))) deny('You don’t have access to this payment request.');
    const next = { ...p, updatedAt: now };
    const st = (...ok) => { if (!ok.includes(p.status)) bad(`This request is ${p.status.toLowerCase().replace(/_/g, ' ')} — that can’t be done now.`); };
    let auditAction = null, auditDetail = {};
    switch (act) {
      case 'submit': st('DRAFT'); if (!mine) deny('Only the person who drafted it can submit it.'); next.status = 'SUBMITTED'; next.history = hist(p, by, now, 'Submitted'); break;
      case 'edit': {
        st('DRAFT', 'SUBMITTED'); if (!mine) deny('Only the requester can change a request before it is verified.');
        if (a.amount != null) next.amountReq = toPaise(a.amount, 'Amount', { allowZero: false });
        if (a.due !== undefined) next.due = ymdOf(a.due, 'Due date', { optional: true });
        if (a.proposedDate !== undefined) next.proposedDate = ymdOf(a.proposedDate, 'Proposed payment date', { optional: true });
        if (a.note !== undefined) next.note = text(a.note, 1000);
        if (a.priority) next.priority = oneOf(String(a.priority), PRIORITY, 'Priority');
        if (a.files) next.files = [...(p.files || []), ...(await filesFrom(a.files, t, by, now))];
        next.history = hist(p, by, now, 'Edited'); break;
      }
      case 'verify': {
        st('SUBMITTED'); if (!acc) deny('Only Accounts verifies payment requests.');
        if (mine) deny('Someone other than the requester must verify a payment request.');
        for (const f of env.hooks.eligibility) { const c = await f({ ...p, id }, t, env); if (c) next.checks = c; }
        next.status = 'UNDER_REVIEW'; next.verifiedBy = by; next.verifiedAt = now; next.history = hist(p, by, now, 'Verified', text(a.note, 500));
        auditAction = 'PAYMENT_VERIFIED';
        await notify(holders('acc.approve').filter((x) => x !== p.requestedBy), { title: `Payment ${p.code} to approve`, body: `${p.payee} · ${inr(p.amountReq)}`, go: { view: 'accounts', erp: id } });
        break;
      }
      case 'approve': {
        st('UNDER_REVIEW'); if (!approver) deny('You don’t have payment approval permission.');
        if (mine) deny('You can’t approve your own payment request.');
        if (p.verifiedBy === by) deny('The person who verified a request can’t also approve it.');
        const amt = a.amount == null || a.amount === '' ? p.amountReq : toPaise(a.amount, 'Approved amount', { allowZero: false });
        if (amt > p.amountReq) bad('You can’t approve more than was requested.');
        const lim = approveLimit(me, 'acc');
        if (amt > lim) deny(`This is above your approval limit of ${inr(lim)}.`);
        for (const f of env.hooks.paymentBlockers) { const blk = await f({ ...p, id, amountApproved: amt }, t, a, env); if (blk) bad(blk); }
        if (amt < p.amountReq && !a.note) bad('Say why you are approving less than requested.');
        next.status = 'APPROVED'; next.amountApproved = amt; next.approvedBy = by; next.approvedAt = now; next.history = hist(p, by, now, 'Approved', text(a.note, 500));
        auditAction = 'PAYMENT_APPROVED'; auditDetail = { amount: amt, ...(a.exception ? { exception: a.exception } : {}) };
        if (a.exception) next.exception = { by, at: now, reason: text(a.exception, 500) };
        await notify([p.requestedBy], { title: `Approved: ${p.code}`, body: `${p.payee} · ${inr(amt)}`, go: { view: 'accounts', erp: id } });
        break;
      }
      case 'reject': {
        st('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'ON_HOLD');
        if (!acc && !approver) deny('Only Accounts can reject payment requests.');
        if (mine) deny('Cancel your own request instead of rejecting it.');
        if (paidOf(p) > 0) bad('Part of this has been paid. Record a reversal instead.');
        next.status = 'REJECTED'; next.history = hist(p, by, now, 'Rejected', need(text(a.note, 500), 'Reason'));
        auditAction = 'PAYMENT_REJECTED'; auditDetail = { reason: text(a.note, 300) };
        await notify([p.requestedBy], { title: `Rejected: ${p.code}`, body: text(a.note, 200), go: { view: 'accounts', erp: id } });
        break;
      }
      case 'hold': st('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'); if (!acc) deny('Only Accounts can put a payment on hold.'); next.heldFrom = p.status; next.status = 'ON_HOLD'; next.history = hist(p, by, now, 'Put on hold', need(text(a.note, 500), 'Reason')); auditAction = 'PAYMENT_ON_HOLD'; break;
      case 'resume': st('ON_HOLD'); if (!acc) deny('Only Accounts can resume a payment.'); next.status = p.heldFrom || 'SUBMITTED'; delete next.heldFrom; next.history = hist(p, by, now, 'Resumed', text(a.note, 500)); auditAction = 'PAYMENT_RESUMED'; break;
      case 'schedule': {
        st('APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'); if (!acc) deny('Only Accounts schedules payments.');
        next.scheduledDate = ymdOf(a.date, 'Payment date');
        if (a.bankId) { await bankOf(t, a.bankId, 'Paying account'); next.bankId = a.bankId; }
        if (!next.bankId) bad('Pick the account it will be paid from.');
        if (a.method) next.method = oneOf(String(a.method), METHODS, 'Payment method');
        if (p.status === 'APPROVED') next.status = 'SCHEDULED';
        next.history = hist(p, by, now, `Scheduled for ${next.scheduledDate}`); break;
      }
      case 'record': {
        // only after the bank has actually paid: the bank reference / UTR is the evidence
        st('APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'); if (!acc) deny('Only Accounts records payments.');
        const amount = toPaise(a.amount, 'Amount paid', { allowZero: false }), left = p.amountApproved - paidOf(p);
        if (amount > left) bad(`Only ${inr(left)} of the approved amount is unpaid.`);
        const date = ymdOf(a.date, 'Payment date');
        if (date > ymdIST(now)) bad('Record a payment after the bank has made it — the date can’t be in the future.');
        const bankId = a.bankId || p.bankId; await bankOf(t, bankId, 'Paying account');
        const ref = str(a.ref, 60);
        if (normRef(ref).length < 4) bad('Enter the bank reference / UTR (or cheque number) as evidence of the payment.');
        if (!(await t.claim(`erp_key/utr_${keyOf(bankId, normRef(ref))}`, { pay: id, code: p.code, at: now }))) conflict(`Bank reference ${ref} is already recorded on another payment from this account.`);
        const files = await filesFrom(a.files, t, by, now);
        next.payments = [...(p.payments || []), { amount, date, bankId, ref, method: a.method ? oneOf(String(a.method), METHODS, 'Payment method') : p.method, by, at: now, ...(files.length ? { files } : {}) }];
        next.history = hist(p, by, now, `Paid ${inr(amount)} (${ref})`);
        auditAction = 'PAYMENT_RECORDED'; auditDetail = { amount, ref, bank: bankId, date };
        break;
      }
      case 'reverse': {
        // a bounced or returned payment: a negative entry, so history is kept and the remainder is payable again
        if (!acc) deny('Only Accounts records reversals.');
        const k = Number(a.index), x = (p.payments || [])[k];
        if (!x || x.amount <= 0 || x.reversed) bad('Pick the payment to reverse.');
        const reason = need(text(a.note, 500), 'Reason for the reversal');
        const date = ymdOf(a.date || ymdIST(now), 'Reversal date');
        next.payments = (p.payments || []).map((y, i) => (i === k ? { ...y, reversed: true } : y)).concat([{ amount: -x.amount, date, bankId: x.bankId, ref: `REV-${x.ref}`, reverses: k, reason, by, at: now }]);
        next.history = hist(p, by, now, `Reversed ${inr(x.amount)} (${x.ref})`, reason);
        auditAction = 'PAYMENT_REVERSED'; auditDetail = { amount: x.amount, ref: x.ref, reason };
        break;
      }
      case 'cancel': {
        if (paidOf(p) > 0) bad('Part of this has been paid, so it can’t be cancelled. Record a reversal first.');
        st('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'ON_HOLD');
        if (!mine && !acc) deny('Only the requester or Accounts can cancel a request.');
        next.status = 'CANCELLED'; next.history = hist(p, by, now, 'Cancelled', need(text(a.note, 500), 'Reason'));
        auditAction = 'PAYMENT_CANCELLED'; auditDetail = { reason: text(a.note, 300) }; break;
      }
      case 'note': next.history = hist(p, by, now, 'Comment', need(text(a.note, 1000), 'Comment')); if (!mine && !acc) deny(); break;
      case 'tally': if (!acc) deny('Only Accounts links Tally references.'); next.tallyRef = need(str(a.ref, 60), 'Tally voucher reference'); next.history = hist(p, by, now, `Tally reference ${next.tallyRef}`); auditAction = 'PAYMENT_TALLY_LINKED'; auditDetail = { ref: next.tallyRef }; break;
      default: bad('Unknown action.');
    }
    next.status = settle(next);
    await t.set(`erp_pay/${id}`, next);
    if (auditAction) await audit(auditAction, { pay: id, code: p.code, ...auditDetail });
    if (next.status === 'SUBMITTED' && p.status === 'DRAFT') await notify(holders('acc'), { title: `Payment request ${p.code} to verify`, body: `${p.payee} · ${inr(p.amountReq)}`, go: { view: 'accounts', erp: id } });
    for (const f of env.hooks.afterPayment) await f(id, p, next, t, env);
    return { status: next.status };
  },

  /* ── forecast (read-only) ── */
  'forecast.get': async (a, { E, t, now, cfg }) => {
    if (!E.has('acc')) deny('The cash-flow forecast is for Accounts.');
    const horizon = Math.min(Math.max(Number(a.horizon) || 90, 7), 366);
    const scenario = SCENARIOS[a.scenario] ? a.scenario : 'base';
    const [banks, bals, rcpts, pays, loans] = await Promise.all(['erp_bank', 'erp_bal', 'erp_rcpt', 'erp_pay', 'erp_loan'].map((c) => t.list(c)));
    return forecast({ banks, bals, rcpts, pays, loans, cfg: await cfg(), today: ymdIST(now), horizon, scenario });
  },
};
registerErp(accounts);
