// Management summary (server/erp-summary.js). Loaded by test-erp.mjs.
import assert from 'node:assert/strict';
import { test, world } from './erp-test-kit.mjs';
import { erpPerms, erpReadable } from '../server/erp-perms.js';

test('management summary: directors see company totals, with sources and dates — but not the records behind them', async () => {
  const w = world();
  const { id: bank } = await w.run('ACC1', 'bank.save', { name: 'HDFC', bank: 'HDFC', last4: '1111', openingAmount: '5,00,000', openingDate: '2026-10-13', buffer: '1,00,000' });
  await w.run('ACC1', 'rcpt.save', { customer: 'Zen', amount: '2,00,000', expectedDate: '2026-10-20', certainty: 'FIRM', bankId: bank });
  await w.run('ACC1', 'rcpt.save', { customer: 'Late Co', amount: '50,000', expectedDate: '2026-10-01', bankId: bank });
  const { id: p } = await w.run('ACC1', 'pay.create', { category: 'RENT', payee: 'Landlord', amount: '4,50,000', proposedDate: '2026-10-16', bankId: bank });
  await w.run('ACC2', 'pay.act', { id: p, action: 'verify' }); await w.run('APR', 'pay.act', { id: p, action: 'approve' });
  await w.run('ACC1', 'pay.create', { category: 'UTILITIES', payee: 'APDCL', amount: '10,000', bankId: bank });
  const s = await w.run('DIRP', 'summary.get', {});
  assert.equal(s.cash.verified, 50000000); assert.equal(s.cash.verifiedAsOf, '2026-10-13');
  assert.equal(s.receivables.expected30, 20000000); assert.equal(s.receivables.overdue, 5000000);
  assert.equal(s.payables.approvedUnpaid, 45000000); assert.equal(s.payables.pending, 1000000); assert.equal(s.payables.pendingCount, 1);
  assert.equal(s.cash.shortfalls[0].name, 'HDFC'); assert.equal(s.cash.shortfalls[0].date, '2026-10-16');
  assert.ok(s.alerts.some((x) => x.kind === 'SHORTFALL'));
  assert.ok(s.updated.payments > 0);
  // the director receives none of the records themselves
  const E = erpPerms(w.sess('DIRP'), w.ctx());
  for (const c of ['erp_pay/x', 'erp_bank/x', 'erp_rcpt/x', 'erp_inv/x', 'erp_po/x']) assert.equal(erpReadable(c, { requestedBy: 'ACC1' }, w.sess('DIRP'), E), false, c);
  for (const who of ['E1', 'PUR1', 'ST1', 'HRP', 'ADM']) await w.fails(who, 'summary.get', {}, /management and Accounts/);
  await w.run('ADM', 'perm.set', { empId: 'ADM', perms: ['fin'] });
  assert.ok((await w.run('ADM', 'summary.get', {})).cash, 'an administrator can be given the summary explicitly');
});
