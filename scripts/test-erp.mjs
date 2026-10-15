// Tests the Accounts, Purchase and Stores rules (server/erp*.js) against an in-memory database.
// Run: node scripts/test-erp.mjs
import assert from 'node:assert/strict';
import { erpPerms, erpReadable, approveLimit } from '../server/erp-perms.js';
import { toPaise, toQty, lineAmount, normRef, normRef2, inr } from '../server/erp-core.js';
import { world, test, tests } from './erp-test-kit.mjs';

let n = 0;

test('money is parsed exactly, in paise — no floating point', () => {
  assert.equal(toPaise('0.10') + toPaise('0.20'), toPaise('0.30'));
  assert.equal(toPaise('12,34,567.89'), 123456789);
  assert.equal(toPaise('₹ 500'), 50000);
  assert.equal(toPaise('99999999999.99'), 9999999999999);
  for (const x of ['1.234', 'abc', '', '1e5', '12.5.1']) assert.throws(() => toPaise(x), /amount/, x);
  assert.throws(() => toPaise('-5'), /negative/);
  assert.equal(toPaise('-5', 'x', { allowNegative: true }), -500);
  assert.equal(toQty('2.5'), 2500);
  assert.equal(lineAmount(33333, toQty('3')), 99999, '₹333.33 × 3');
  assert.equal(lineAmount(1000, toQty('0.333')), 333, 'rounded half up');
  assert.equal(inr(123456789), '₹12,34,567.89');
  assert.equal(inr(-50000), '−₹500');
});
test('invoice numbers compare without spaces, punctuation, case or leading zeros', () => {
  assert.equal(normRef('INV/2024-001'), normRef('inv 2024 001'));
  assert.equal(normRef('  inv.2024.001 '), 'INV2024001');
  assert.equal(normRef('000123'), normRef('123'));
  assert.notEqual(normRef('INV-1'), normRef('INV-11'));
  assert.equal(normRef2('ACME/24-25/0118'), normRef2('acme 24 25 118'), 'zero-padding inside the number');
  assert.notEqual(normRef2('INV-12'), normRef2('INV-120'), 'trailing zeros are real digits');
  assert.notEqual(normRef2('INV/2024/18'), normRef2('INV/2024/81'));
});
test('permissions: departments give their everyday permission; approvals are explicit; roles give no money powers', () => {
  const w = world(), P = (id) => [...erpPerms(w.sess(id), w.ctx())].sort();
  assert.deepEqual(P('ACC1'), ['acc']);
  assert.deepEqual(P('APR'), ['acc', 'acc.approve']);
  assert.deepEqual(P('PUR1'), ['pur']);
  assert.deepEqual(P('STV'), ['sto', 'sto.verify']);
  assert.deepEqual(P('E1'), []);
  assert.deepEqual(P('HRP'), [], 'HR has no finance access by default');
  assert.deepEqual(P('DIRP'), ['fin'], 'directors see summaries only');
  assert.deepEqual(P('ADM'), ['erp.admin'], 'administrators configure, but can’t approve or pay');
  assert.deepEqual([...erpPerms({ ...w.sess('APR'), active: false }, w.ctx())], [], 'inactive');
  assert.equal(approveLimit(w.ctx().emps.get('APR'), 'acc'), 100000000);
  assert.equal(approveLimit(w.ctx().emps.get('PAPR'), 'pur'), Infinity);
});
test('who reads which finance records', () => {
  const w = world(), can = (id, path, data) => erpReadable(path, data, w.sess(id), erpPerms(w.sess(id), w.ctx()));
  for (const c of ['erp_bank/b1', 'erp_bal/x', 'erp_rcpt/r', 'erp_loan/l', 'erp_imp/i', 'erp_stl/s', 'erp_supbank/s']) {
    assert.equal(can('ACC1', c, {}), true, c);
    for (const id of ['PUR1', 'ST1', 'E1', 'HRP', 'DIRP', 'ADM']) assert.equal(can(id, c, {}), false, `${id} ${c}`);
  }
  assert.equal(can('PUR1', 'erp_pay/p', { poId: 'po1' }), true, 'purchase sees payments against its orders');
  assert.equal(can('PUR1', 'erp_pay/p', { category: 'SALARY' }), false, 'but not salaries or rent');
  assert.equal(can('E1', 'erp_pay/p', { requestedBy: 'E1' }), true, 'a requester sees their own');
  assert.equal(can('ST1', 'erp_po/p', {}), true); assert.equal(can('ST1', 'erp_inv/i', {}), false, 'stores don’t see invoices');
  assert.equal(can('E1', 'erp_pr/r', { requestedBy: 'E1' }), true); assert.equal(can('E1', 'erp_pr/r', { requestedBy: 'MGR' }), false);
  assert.equal(can('ACC1', 'erp_key/k', {}), false, 'uniqueness keys are server-only');
  assert.equal(can('ACC1', 'erp_cfg/main', {}), true); assert.equal(can('E1', 'erp_cfg/main', {}), false, 'the cash buffer isn’t shown to everyone');
  assert.equal(can('ACC1', 'erp_whatever/x', {}), false, 'unknown erp collections are closed');
});
test('administrators grant permissions and limits; it is audited; nobody else can', async () => {
  const w = world();
  await w.run('ADM', 'perm.set', { empId: 'E1', perms: ['pur', 'sto.verify'], limits: { pur: '25,000' } });
  const e = w.db.docs.get('emp/E1');
  assert.deepEqual(e.erp, ['pur', 'sto.verify']); assert.deepEqual(e.erpLimits, { pur: 2500000 });
  const a = w.audits().find((x) => x.action === 'ERP_PERMISSIONS_CHANGED');
  assert.deepEqual(a.detail, { emp: 'E1', from: { perms: [], limits: {} }, to: { perms: ['pur', 'sto.verify'], limits: { pur: 2500000 } } });
  for (const who of ['HRP', 'DIRP', 'APR', 'E1']) await w.fails(who, 'perm.set', { empId: 'E1', perms: ['acc.approve'] }, /administrator/);
  await w.fails('ADM', 'perm.set', { empId: 'E1', perms: ['god'] }, /Unknown permission/);
  await w.fails('ADM', 'perm.set', { empId: 'NOPE', perms: [] }, /Pick an employee/);
});
test('finance settings: finance setup only; amounts and percentages validated', async () => {
  const w = world();
  await w.run('ADM', 'settings.save', { cashBuffer: '2,00,000', qtyTol: '2.5', rateTol: '1', roundTol: '1', emiRemind: '7, 3, 1', categories: ['SUPPLIER', 'EMI', 'BOGUS'] });
  const c = w.db.docs.get('erp_cfg/main');
  assert.equal(c.cashBuffer, 20000000); assert.equal(c.qtyTolBp, 250); assert.equal(c.rateTolBp, 100); assert.deepEqual(c.emiRemind, [7, 3, 1]); assert.deepEqual(c.categories, ['SUPPLIER', 'EMI']);
  await w.fails('ACC1', 'settings.save', {}, /finance setup/);
  await w.fails('ADM', 'settings.save', { cashBuffer: '1.234' }, /amount/);
  assert.equal(w.audits().filter((a) => a.action === 'ERP_SETTINGS_CHANGED').length, 1);
});
test('unknown actions and inactive accounts are refused', async () => {
  const w = world();
  await w.fails('ADM', 'no.such', {}, /Unknown action/);
  w.db.docs.set('emp/ACC1', { ...w.db.docs.get('emp/ACC1'), active: false });
  await w.fails('ACC1', 'settings.save', {}, /not active/);
});

// each module's tests are in their own file
await import('./test-erp-accounts.mjs');
await import('./test-erp-loans.mjs');
await import('./test-erp-purchase.mjs');
await import('./test-erp-import.mjs');
await import('./test-erp-summary.mjs');
let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); n++; console.log('ok -', name); } catch (e) { failed++; console.log('NOT OK -', name, '\n   ', String(e.message).split('\n').slice(0, 8).join('\n    ')); }
}
console.log(failed ? `\n${failed} FAILED, ${n} passed` : `\n${n} tests passed`);
if (failed) process.exitCode = 1;
