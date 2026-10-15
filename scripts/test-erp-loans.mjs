// EMIs and loans (server/erp-loans.js). Loaded by test-erp.mjs.
import assert from 'node:assert/strict';
import { test, world } from './erp-test-kit.mjs';
import { addMonths, buildSchedule } from '../server/erp-loans.js';

async function setup() {
  const w = world();
  const { id: bank } = await w.run('ACC1', 'bank.save', { name: 'SBI loan account', bank: 'SBI', last4: '5555', openingAmount: '3,00,000', openingDate: '2026-10-13', buffer: '50,000' });
  const { id } = await w.run('ACC1', 'loan.save', { lender: 'SBI', ref: 'TL/2026/77', type: 'MACHINERY', principal: '12,00,000', emi: '1,05,000', n: 12, firstDue: '2026-10-21', frequency: 'MONTHLY', bankId: bank, rate: '9' });
  return { w, bank, id, loan: () => w.db.docs.get(`erp_loan/${id}`) };
}
const at = (fc, bank, d) => fc.accounts.find((a) => a.id === bank).series.find((x) => x.date === d).close;

test('schedules: same day each month (clamped at month end); interest + principal adds up to the EMI', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2027-12-15', 2), '2028-02-15');
  const s = buildSchedule({ firstDue: '2026-01-31', n: 3, emi: 1000000, principal: 2900000, rateBp: 1200 });
  assert.deepEqual(s.map((x) => x.due), ['2026-01-31', '2026-02-28', '2026-03-31']);
  for (const x of s) assert.equal(x.principal + x.interest, x.amount);
  assert.equal(s[2].balance, 0, 'the last instalment clears the loan');
  assert.equal(s[0].interest, 29000, '₹29,000 × 12% / 12');
  const w = buildSchedule({ firstDue: '2026-11-07', n: 2, emi: 100, weekendRule: 'NEXT_WORKING' }); // 7 Nov 2026 is a Saturday
  assert.deepEqual(w.map((x) => x.due), ['2026-11-09', '2026-12-07']);
});

test('EMIs appear in the forecast on their due dates, from the linked account', async () => {
  const { w, bank } = await setup();
  const fc = await w.run('ACC1', 'forecast.get', { horizon: 60 });
  assert.equal(at(fc, bank, '2026-10-20'), 30000000);
  assert.equal(at(fc, bank, '2026-10-21'), 30000000 - 10500000);
  assert.equal(at(fc, bank, '2026-11-21'), 30000000 - 21000000);
  assert.ok(fc.events.some((e) => e.kind === 'EMI' && e.date === '2026-10-21'));
});

test('an EMI with a payment request is counted once — through the request — and is marked paid when the request is paid', async () => {
  const { w, bank, id, loan } = await setup();
  const r = await w.run('ACC1', 'loan.request', { id, n: 1 });
  await w.fails('ACC1', 'loan.request', { id, n: 1 }, /already has payment request/);
  let fc = await w.run('ACC1', 'forecast.get', { horizon: 30 });
  assert.equal(fc.events.filter((e) => e.date === '2026-10-21' && e.amount === -10500000).length, 1, 'one outflow, not two');
  assert.equal(at(fc, bank, '2026-10-21'), 30000000 - 10500000);
  await w.run('ACC2', 'pay.act', { id: r.id, action: 'verify' }); await w.run('APR', 'pay.act', { id: r.id, action: 'approve' });
  w.tick(7 * 864e5); // 21 Oct
  await w.run('ACC1', 'pay.act', { id: r.id, action: 'record', amount: '1,05,000', date: '2026-10-21', bankId: bank, ref: 'SBIEMI0001' });
  assert.equal(loan().schedule[0].paid.ref, 'SBIEMI0001');
  fc = await w.run('ACC1', 'forecast.get', { horizon: 10 });
  assert.equal(fc.events.filter((e) => e.kind === 'EMI' && e.n === 1).length, 0, 'a paid EMI is no longer a commitment');
  assert.equal(at(fc, bank, '2026-10-21'), 30000000 - 10500000, 'paid once (after the verified balance)');
});

test('auto-debited EMIs are recorded with the bank reference; the same reference can’t be used twice', async () => {
  const { w, bank, id, loan } = await setup();
  w.tick(7 * 864e5);
  await w.fails('ACC1', 'loan.paid', { id, n: 1, date: '2026-10-21' }, /bank reference/);
  await w.run('ACC1', 'loan.paid', { id, n: 1, date: '2026-10-21', ref: 'ECS-77-0001' });
  await w.fails('ACC1', 'loan.paid', { id, n: 2, date: '2026-10-21', ref: 'ecs 77 0001' }, /already recorded/);
  const fc = await w.run('ACC1', 'forecast.get', { horizon: 40 });
  assert.equal(at(fc, bank, '2026-10-21'), 30000000 - 10500000, 'debited once');
  assert.equal(at(fc, bank, '2026-11-21'), 30000000 - 21000000);
  assert.ok(loan().schedule[0].paid);
});

test('reminders 7, 3 and 1 days before, once each, with a funds warning; overdue EMIs are flagged once', async () => {
  const { w, id } = await setup(); // EMI 1 due 21 Oct; today 14 Oct = 7 days before
  let r = await w.run('ACC1', 'erp.tick', {});
  assert.deepEqual(r.sent.map((x) => x.slice(0, 4)), [['remind', 'LOAN-0001', 1, 7]]);
  r = await w.run('ACC1', 'erp.tick', {}); assert.deepEqual(r.sent, [], 'not again the same day');
  const n7 = w.db.of('ntf').filter((n) => /EMI in 7 days/.test(n.title));
  assert.ok(n7.some((n) => n.to === 'ACC1') && n7.some((n) => n.to === 'APR') && n7.every((n) => n.from === null), 'all of Accounts is told — the person who triggered the check too — as a system reminder');
  // 3 days before: the account (₹3,00,000) minus a ₹2,60,000 rent payment can't cover the EMI above the ₹50,000 buffer
  const { id: p } = await w.run('ACC1', 'pay.create', { category: 'RENT', payee: 'Landlord', amount: '2,60,000', proposedDate: '2026-10-17', bankId: w.db.of('erp_bank')[0] && [...w.db.docs].find(([k]) => k.startsWith('erp_bank/'))[0].slice(9) });
  await w.run('ACC2', 'pay.act', { id: p, action: 'verify' }); await w.run('APR', 'pay.act', { id: p, action: 'approve' });
  w.tick(4 * 864e5);
  r = await w.run('ACC1', 'erp.tick', {});
  assert.equal(r.sent.length, 1); assert.equal(r.sent[0][3], 3); assert.equal(r.sent[0][4], true, 'funds warning');
  assert.ok(w.db.of('ntf').some((n) => /EMI in 3 days/.test(n.title) && /below its protected cash/.test(n.body)));
  w.tick(5 * 864e5); // 23 Oct: EMI 1 overdue
  r = await w.run('ACC1', 'erp.tick', {});
  assert.deepEqual(r.sent.map((x) => x[0]), ['overdue']);
  r = await w.run('ACC1', 'erp.tick', {}); assert.deepEqual(r.sent, []);
  const fc = await w.run('ACC1', 'forecast.get', { horizon: 5 });
  assert.ok(fc.events.some((e) => e.kind === 'EMI' && e.overdue && e.date === '2026-10-23'), 'an unpaid overdue EMI stays in the forecast, from today');
  void id;
});

test('corrections need a reason and are audited; paid instalments can’t change; imported schedules keep paid history', async () => {
  const { w, id, loan } = await setup();
  await w.fails('ACC1', 'loan.fix', { id, n: 2, due: '2026-11-25' }, /Reason/);
  await w.run('ACC1', 'loan.fix', { id, n: 2, due: '2026-11-25', reason: 'Lender moved the date after the holiday' });
  assert.equal(loan().schedule[1].due, '2026-11-25');
  assert.ok(w.audits().some((a) => a.action === 'EMI_SCHEDULE_CORRECTED' && a.detail.reason.includes('Lender')));
  w.tick(7 * 864e5);
  await w.run('ACC1', 'loan.paid', { id, n: 1, date: '2026-10-21', ref: 'ECS-1' });
  await w.fails('ACC1', 'loan.fix', { id, n: 1, amount: '1', reason: 'typo fix please' }, /paid instalment/);
  await w.run('ACC1', 'loan.import', { id, reason: 'Revised schedule from SBI after the rate change', rows: [{ due: '2026-10-21', amount: '1,05,000' }, { due: '2026-11-21', amount: '1,06,000', principal: '97,000', interest: '9,000' }, { due: '2026-12-21', amount: '1,06,000' }] });
  const s = loan().schedule;
  assert.deepEqual(s.map((x) => [x.n, x.due, x.amount, !!x.paid]), [[1, '2026-10-21', 10500000, true], [2, '2026-11-21', 10600000, false], [3, '2026-12-21', 10600000, false]]);
  await w.fails('ACC1', 'loan.import', { id, reason: 'bad', rows: [{ due: '2027-01-21', amount: '100', principal: '50', interest: '10' }] }, /doesn’t equal/);
  await w.fails('ACC1', 'loan.save', { lender: 'S.B.I.', ref: 'tl-2026-77', emi: '1', n: 1, firstDue: '2026-11-01', bankId: [...w.db.docs].find(([k]) => k.startsWith('erp_bank/'))[0].slice(9) }, /already entered/);
  await w.fails('PUR1', 'loan.save', {}, /Only Accounts/);
});
