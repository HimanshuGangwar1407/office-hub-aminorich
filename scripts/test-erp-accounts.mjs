// Accounts: bank accounts, receipts, payment requests (maker-checker) and the cash-flow forecast. Loaded by test-erp.mjs.
import assert from 'node:assert/strict';
import { test, world } from './erp-test-kit.mjs';
import { forecast } from '../server/erp-forecast.js';

const T = '2026-10-14'; // the test clock (world()) is 2026-10-14 10:30 IST
async function setup() {
  const w = world();
  const { id: hdfc } = await w.run('ACC1', 'bank.save', { name: 'HDFC current', bank: 'HDFC Bank', last4: '1234', openingAmount: '10,00,000', openingDate: '2026-10-10', buffer: '1,00,000' });
  const { id: sbi } = await w.run('ACC1', 'bank.save', { name: 'SBI CC', bank: 'SBI', last4: '9876', openingAmount: '2,00,000', openingDate: '2026-10-10', restricted: '50,000' });
  return { w, hdfc, sbi };
}
const pay = (w, who, o) => w.run(who, 'pay.create', { category: 'SUPPLIER', payee: 'Acme Chemicals', amount: '1,18,000', due: '2026-10-20', ...o });
const act = (w, who, id, action, o = {}) => w.run(who, 'pay.act', { id, action, ...o });
const PAYOK = async (w, id, bankId) => { await act(w, 'ACC2', id, 'verify'); await act(w, 'APR', id, 'approve'); return act(w, 'ACC1', id, 'schedule', { date: '2026-10-20', bankId }); };

test('bank accounts keep only the last 4 digits; the opening balance is a verified figure with a date', async () => {
  const { w, hdfc } = await setup();
  const b = w.db.docs.get(`erp_bank/${hdfc}`);
  assert.equal(b.masked, 'XXXX1234'); assert.equal(JSON.stringify(b).includes('12345678'), false);
  await w.fails('ACC1', 'bank.save', { name: 'x', bank: 'y', last4: '123456789012', openingAmount: '1', openingDate: T }, /last 4 digits/);
  await w.fails('PUR1', 'bank.save', { name: 'x', bank: 'y', last4: '1111', openingAmount: '1', openingDate: T }, /Only Accounts/);
  const bal = w.db.of('erp_bal').find((x) => x.bankId === hdfc);
  assert.deepEqual([bal.amount, bal.asOf, bal.source], [100000000, '2026-10-10', 'OPENING']);
  await w.fails('ACC1', 'bal.verify', { bankId: hdfc, amount: '1', asOf: '2026-10-20', note: 'portal' }, /future/);
  await w.fails('ACC1', 'bal.verify', { bankId: hdfc, amount: '1', asOf: T }, /checked/);
  assert.ok(w.audits().some((a) => a.action === 'BANK_ACCOUNT_ADDED'));
});

test('maker-checker: nobody verifies or approves their own request; the verifier can’t approve; limits apply', async () => {
  const { w, hdfc } = await setup();
  const { id } = await pay(w, 'ACC1', {});
  await w.fails('ACC1', 'pay.act', { id, action: 'verify' }, /other than the requester/);
  await w.fails('PUR1', 'pay.act', { id, action: 'verify' }, /access to this payment/);
  // APR verifies, so APR can't also approve
  await act(w, 'APR', id, 'verify');
  await w.fails('APR', 'pay.act', { id, action: 'approve' }, /verified .* can’t also approve/);
  await w.fails('ACC1', 'pay.act', { id, action: 'approve' }, /approval permission/);
  // a second approver, with a ₹1,00,000 limit, can't approve ₹1,18,000
  await w.run('ADM', 'perm.set', { empId: 'MGR', perms: ['acc.approve'], limits: { acc: '1,00,000' } });
  await w.fails('MGR', 'pay.act', { id, action: 'approve' }, /above your approval limit of ₹1,00,000/);
  await act(w, 'MGR', id, 'approve', { amount: '90,000', note: 'Balance after the credit note' });
  const p = w.db.docs.get(`erp_pay/${id}`);
  assert.deepEqual([p.status, p.amountApproved, p.verifiedBy, p.approvedBy], ['APPROVED', 9000000, 'APR', 'MGR']);
  // an approver can't approve their own request either
  const { id: own } = await pay(w, 'APR', { invoiceRef: 'X-1' });
  await act(w, 'ACC1', own, 'verify');
  await w.fails('APR', 'pay.act', { id: own, action: 'approve' }, /your own payment request/);
  // administrators can't approve anything without the permission
  await w.fails('ADM', 'pay.act', { id: own, action: 'approve' }, /access to this payment/);
  void hdfc;
});

test('a payment is “paid” only with bank evidence; a bank reference can’t be used twice; partial payments add up', async () => {
  const { w, hdfc } = await setup();
  const { id } = await pay(w, 'ACC1', { invoiceRef: 'INV-77' });
  await PAYOK(w, id, hdfc);
  await w.fails('ACC1', 'pay.act', { id, action: 'record', amount: '50,000', date: T, bankId: hdfc }, /UTR/);
  await w.fails('ACC1', 'pay.act', { id, action: 'record', amount: '50,000', date: '2026-10-30', bankId: hdfc, ref: 'UTR123456' }, /future/);
  await w.fails('ACC1', 'pay.act', { id, action: 'record', amount: '2,00,000', date: T, bankId: hdfc, ref: 'UTR123456' }, /unpaid/);
  await act(w, 'ACC1', id, 'record', { amount: '50,000', date: T, bankId: hdfc, ref: 'HDFCN26101400001' });
  assert.equal(w.db.docs.get(`erp_pay/${id}`).status, 'PARTIALLY_PAID');
  // the same UTR again (any spacing / case) is refused — on this request or any other from the account
  await w.fails('ACC1', 'pay.act', { id, action: 'record', amount: '10,000', date: T, bankId: hdfc, ref: 'hdfcn 2610 1400001' }, /already recorded/);
  await act(w, 'ACC1', id, 'record', { amount: '68,000', date: T, bankId: hdfc, ref: 'HDFCN26101400002' });
  const p = w.db.docs.get(`erp_pay/${id}`);
  assert.equal(p.status, 'PAID'); assert.equal(p.payments.reduce((s, x) => s + x.amount, 0), 11800000);
  await w.fails('ACC1', 'pay.act', { id, action: 'record', amount: '1', date: T, bankId: hdfc, ref: 'UTR999999' }, /can’t be done now/);
  // a bounced payment is reversed (history kept) and becomes payable again
  await act(w, 'ACC1', id, 'reverse', { index: 1, note: 'Returned by beneficiary bank — wrong IFSC' });
  const r = w.db.docs.get(`erp_pay/${id}`);
  assert.equal(r.status, 'PARTIALLY_PAID'); assert.equal(r.payments.length, 3); assert.equal(r.payments[2].amount, -6800000);
  assert.ok(w.audits().some((a) => a.action === 'PAYMENT_REVERSED'));
  await w.fails('ACC1', 'pay.act', { id, action: 'cancel', note: 'x' }, /reversal first|has been paid/);
});

test('duplicate payment requests: same payee and invoice number in any format are blocked; an approver may override with a reason', async () => {
  const { w } = await setup();
  await pay(w, 'ACC1', { invoiceRef: 'INV/2026-0042' });
  await w.fails('ACC1', 'pay.create', { category: 'SUPPLIER', payee: 'ACME chemicals', amount: '5,000', invoiceRef: 'inv 2026 0042' }, /Possible duplicate: PAY-0001/);
  await w.fails('PUR1', 'pay.create', { category: 'SUPPLIER', payee: 'Acme Chemicals', amount: '5', invoiceRef: 'INV-2026-0042', override: { reason: 'second instalment as agreed' } }, /Possible duplicate|only be raised by a payment approver/);
  await w.fails('APR', 'pay.create', { category: 'SUPPLIER', payee: 'Acme Chemicals', amount: '5', invoiceRef: 'INV-2026-0042', override: { reason: 'ok' } }, /full sentence/);
  const r = await w.run('APR', 'pay.create', { category: 'SUPPLIER', payee: 'Acme Chemicals', amount: '59,000', invoiceRef: 'INV-2026-0042', override: { reason: 'Second instalment per agreement dated 1 Oct' } });
  assert.equal(w.db.docs.get(`erp_pay/${r.id}`).dupOverride.of[0], 'PAY-0001');
  assert.ok(w.audits().some((a) => a.action === 'DUPLICATE_OVERRIDE' && a.by === 'APR'));
  // a different supplier with the same invoice number is not a duplicate; neither is the same amount without a match
  await pay(w, 'ACC1', { payee: 'Beta Traders', invoiceRef: 'INV/2026-0042' });
  await pay(w, 'ACC1', { invoiceRef: 'INV/2026-0043' });
  // a cancelled request no longer blocks
  const { id: c } = await pay(w, 'ACC1', { payee: 'Gamma', invoiceRef: 'G-1' });
  await act(w, 'ACC1', c, 'cancel', { note: 'Raised by mistake' });
  await pay(w, 'ACC1', { payee: 'Gamma', invoiceRef: 'G-1' });
});

test('a repeated submission creates one request; two simultaneous requests for the same invoice create one', async () => {
  const { w } = await setup();
  const a = await pay(w, 'ACC1', { invoiceRef: 'K-1', clientKey: 'click-abcdef12' });
  const b = await pay(w, 'ACC1', { invoiceRef: 'K-1', clientKey: 'click-abcdef12' });
  assert.equal(b.id, a.id); assert.equal(b.replay, true);
  const res = await Promise.allSettled([pay(w, 'ACC1', { payee: 'Delta', invoiceRef: 'D-9' }), pay(w, 'APR', { payee: 'Delta', invoiceRef: 'd 9' })]);
  assert.deepEqual(res.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(w.db.of('erp_pay').filter((p) => p.payee === 'Delta').length, 1);
});

test('a failed action leaves nothing half-done', async () => {
  const { w, hdfc } = await setup();
  const { id } = await pay(w, 'ACC1', {});
  await PAYOK(w, id, hdfc);
  // a bad attachment fails the whole action — the bank reference stays free
  await w.fails('ACC1', 'pay.act', { id, action: 'record', amount: '1,000', date: T, bankId: hdfc, ref: 'UTR55555', files: [{ fid: 'nosuchfile', chunks: 1, ext: 'pdf' }] }, /uploaded properly/);
  assert.equal(w.db.docs.get(`erp_pay/${id}`).payments.length, 0);
  await act(w, 'ACC1', id, 'record', { amount: '1,000', date: T, bankId: hdfc, ref: 'UTR55555' });
});

test('who may raise what: Purchase only supplier payments and advances; employees nothing', async () => {
  const { w } = await setup();
  await w.fails('PUR1', 'pay.create', { category: 'ADVANCE', payee: 'Acme', amount: '1,000' }, /against a purchase order/);
  await pay(w, 'PUR1', { category: 'SUPPLIER', invoiceRef: 'PUR-RAISED-1' });
  await w.fails('PUR1', 'pay.create', { category: 'SALARY', payee: 'Staff', amount: '1' }, /can’t raise/);
  await w.fails('E1', 'pay.create', { category: 'SUPPLIER', payee: 'x', amount: '1' }, /can’t raise/);
  await w.fails('ACC1', 'pay.create', { category: 'SUPPLIER', payee: 'x', amount: '0' }, /more than zero/);
});

test('receipts: expected is not cash; receiving more than outstanding is refused; status follows the dates', async () => {
  const { w, hdfc } = await setup();
  const { id } = await w.run('ACC1', 'rcpt.save', { customer: 'Zen Foods', ref: 'SI-101', amount: '3,00,000', expectedDate: '2026-10-12', certainty: 'FIRM', bankId: hdfc });
  const fc = await w.run('ACC1', 'forecast.get', {});
  assert.equal(fc.company.verifiedTotal, 120000000, 'verified cash = the two opening balances, nothing expected');
  assert.equal(fc.company.current, 120000000);
  await w.fails('ACC1', 'rcpt.receive', { id, amount: '4,00,000', date: T, bankId: hdfc, ref: 'NEFT1' }, /outstanding/);
  await w.fails('ACC1', 'rcpt.receive', { id, amount: '1,00,000', date: '2026-10-30', bankId: hdfc, ref: 'NEFT1' }, /future/);
  await w.run('ACC1', 'rcpt.receive', { id, amount: '1,00,000', date: T, bankId: hdfc, ref: 'NEFT1' });
  assert.equal(w.db.docs.get(`erp_rcpt/${id}`).status, 'PARTIAL');
  await w.fails('ACC1', 'rcpt.update', { id, action: 'cancel', text: 'x' }, /Part of this/);
  await w.fails('PUR1', 'rcpt.save', { customer: 'x', amount: '1', expectedDate: T }, /Only Accounts/);
});

test('forecast: verified opening + receipts after verification + expected − planned, per account; scenarios differ', async () => {
  const { w, hdfc, sbi } = await setup();
  await w.run('ACC1', 'rcpt.save', { customer: 'Zen Foods', amount: '3,00,000', expectedDate: '2026-10-25', certainty: 'FIRM', bankId: hdfc });
  await w.run('ACC1', 'rcpt.save', { customer: 'Old Customer', amount: '1,00,000', expectedDate: '2026-10-01', certainty: 'LIKELY', bankId: hdfc }); // overdue
  await w.run('ACC1', 'rcpt.save', { customer: 'Maybe Ltd', amount: '5,00,000', expectedDate: '2026-10-20', certainty: 'UNCERTAIN', bankId: hdfc });
  const { id } = await pay(w, 'ACC1', { amount: '4,00,000', invoiceRef: 'BIG-1' });
  await PAYOK(w, id, hdfc);
  const base = await w.run('ACC1', 'forecast.get', { scenario: 'base', horizon: 30 });
  const H = base.accounts.find((a) => a.id === hdfc);
  const at = (s, d) => s.find((x) => x.date === d).close;
  assert.equal(at(H.series, T), 100000000);
  assert.equal(at(H.series, '2026-10-20'), 100000000 - 40000000, 'payment on its scheduled date; the uncertain receipt not counted');
  assert.equal(at(H.series, '2026-10-21'), 60000000 + 10000000, 'the overdue receipt counted 7 days from today in the base case');
  assert.equal(at(H.series, '2026-10-25'), 70000000 + 30000000);
  const stress = await w.run('ACC1', 'forecast.get', { scenario: 'stress', horizon: 30 });
  const HS = stress.accounts.find((a) => a.id === hdfc);
  assert.equal(at(HS.series, '2026-10-25'), 60000000, 'stress: firm receipt delayed 30 days, others not counted');
  const cons = await w.run('ACC1', 'forecast.get', { scenario: 'conservative', horizon: 30 });
  assert.equal(at(cons.accounts.find((a) => a.id === hdfc).series, '2026-11-13'), 60000000 + 5000000 + 30000000, 'conservative: overdue at 50% after 30 days, firm after 7');
  void sbi;
});

test('forecast: money paid or received after the verified balance counts once; before it, not at all', async () => {
  const { w, hdfc } = await setup(); // HDFC verified ₹10,00,000 on 10 Oct
  const { id } = await pay(w, 'ACC1', { amount: '1,00,000', invoiceRef: 'P-1' });
  await PAYOK(w, id, hdfc);
  await act(w, 'ACC1', id, 'record', { amount: '1,00,000', date: '2026-10-12', bankId: hdfc, ref: 'UTR-A1' });
  let fc = await w.run('ACC1', 'forecast.get', { horizon: 10 });
  let H = fc.accounts.find((a) => a.id === hdfc);
  assert.equal(H.current, 90000000, 'paid on the 12th, after the verification on the 10th: deducted once');
  assert.equal(H.series[H.series.length - 1].close, 90000000, 'and not again as a planned payment');
  // a new verified balance on the 13th already includes that payment
  await w.run('ACC1', 'bal.verify', { bankId: hdfc, amount: '9,00,000', asOf: '2026-10-13', note: 'HDFC statement' });
  fc = await w.run('ACC1', 'forecast.get', { horizon: 10 });
  H = fc.accounts.find((a) => a.id === hdfc);
  assert.equal(H.current, 90000000, 'not deducted a second time');
  assert.equal(H.sinceVerified, 0);
});

test('forecast: transfers between company accounts move cash but are not income or expense', async () => {
  const { w, hdfc, sbi } = await setup();
  const { id } = await w.run('ACC1', 'pay.create', { category: 'TRANSFER', amount: '1,00,000', bankId: hdfc, transferTo: sbi, proposedDate: '2026-10-16' });
  await PAYOK(w, id, hdfc);
  const fc = await w.run('ACC1', 'forecast.get', { horizon: 10 });
  const H = fc.accounts.find((a) => a.id === hdfc), S = fc.accounts.find((a) => a.id === sbi);
  const last = (s) => s[s.length - 1].close;
  assert.equal(last(H.series), 90000000); assert.equal(last(S.series), 30000000);
  assert.equal(last(fc.company.series), 120000000, 'company total unchanged');
  await w.fails('ACC1', 'pay.create', { category: 'TRANSFER', amount: '1', bankId: hdfc, transferTo: hdfc }, /two different accounts/);
});

test('forecast: buffers and restricted funds are deducted once; a shortfall names the account, date and commitments', async () => {
  const { w, hdfc, sbi } = await setup(); // HDFC buffer ₹1,00,000; SBI restricted ₹50,000
  await w.run('ADM', 'settings.save', { cashBuffer: '1,20,000' });
  const { id } = await pay(w, 'ACC1', { payee: 'Landlord', category: 'RENT', amount: '1,80,000', due: '2026-10-18', invoiceRef: 'RENT-OCT' });
  await act(w, 'ACC2', id, 'verify'); await act(w, 'APR', id, 'approve'); await act(w, 'ACC1', id, 'schedule', { date: '2026-10-18', bankId: sbi });
  const fc = await w.run('ACC1', 'forecast.get', { horizon: 30 });
  const S = fc.accounts.find((a) => a.id === sbi), H = fc.accounts.find((a) => a.id === hdfc);
  assert.equal(H.protect, 10000000); assert.equal(S.protect, 5000000);
  assert.equal(fc.company.protect, 10000000 + 5000000 + 2000000, 'the company buffer adds only what account buffers don’t cover');
  assert.equal(H.availableToSpend, 90000000);
  const sf = fc.shortfalls.find((x) => x.bankId === sbi);
  assert.deepEqual([sf.date, sf.close, sf.shortBy], ['2026-10-18', 2000000, 3000000]);
  assert.equal(sf.causes[0].code, 'PAY-0001');
  assert.equal(fc.shortfalls.some((x) => x.bankId === hdfc), false);
  assert.equal(fc.company.availableToSpend, 120000000 - 18000000 - 17000000);
});

test('forecast (pure): an account with no verified balance is flagged, never given an invented one', () => {
  const fc = forecast({ banks: [{ id: 'b', data: { name: 'New account' } }], today: T, horizon: 7 });
  assert.equal(fc.accounts[0].verified, false); assert.deepEqual(fc.company.unverifiedAccounts, ['b']);
});
