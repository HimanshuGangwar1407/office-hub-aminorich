// Tally and bank statement imports, reconciliation and exceptions (server/erp-import.js). Loaded by test-erp.mjs.
import assert from 'node:assert/strict';
import { test, world } from './erp-test-kit.mjs';

const T = '2026-10-14';
async function setup() {
  const w = world();
  const { id: bank } = await w.run('ACC1', 'bank.save', { name: 'HDFC current', bank: 'HDFC', last4: '1111', openingAmount: '10,00,000', openingDate: '2026-10-01' });
  const { id: p } = await w.run('ACC1', 'pay.create', { category: 'RENT', payee: 'Landlord', amount: '50,000', bankId: bank });
  await w.run('ACC2', 'pay.act', { id: p, action: 'verify' }); await w.run('APR', 'pay.act', { id: p, action: 'approve' });
  await w.run('ACC1', 'pay.act', { id: p, action: 'record', amount: '50,000', date: '2026-10-05', bankId: bank, ref: 'HDFCN26100500011' });
  const { id: p2 } = await w.run('ACC1', 'pay.create', { category: 'UTILITIES', payee: 'APDCL', amount: '12,000', bankId: bank });
  await w.run('ACC2', 'pay.act', { id: p2, action: 'verify' }); await w.run('APR', 'pay.act', { id: p2, action: 'approve' });
  await w.run('ACC1', 'pay.act', { id: p2, action: 'record', amount: '12,000', date: '2026-10-06', bankId: bank, ref: 'CHQ004411' });
  return { w, bank, p, p2 };
}
const stmt = (bank, rows, extra = {}) => ({ kind: 'BANK_STATEMENT', bankId: bank, fileName: 'hdfc-oct.csv', fileHash: 'h-' + rows.length + JSON.stringify(rows).length, rows, ...extra });
const ROWS = [
  { date: '2026-10-05', desc: 'NEFT DR HDFCN26100500011 LANDLORD', debit: '50,000.00', credit: '', balance: '9,50,000.00' },
  { date: '2026-10-08', desc: 'BANK CHARGES', debit: '590.00', credit: '', balance: '9,49,410.00' },
  { date: '2026-10-09', desc: 'NEFT CR ZEN FOODS', debit: '', credit: '25,000.00', balance: '9,74,410.00' },
];

test('statement import: preview writes nothing; commit matches by reference; the rest become exceptions; the closing balance is verified', async () => {
  const { w, bank, p, p2 } = await setup();
  const pre = await w.run('ACC1', 'imp.preview', stmt(bank, ROWS));
  assert.deepEqual([pre.valid, pre.new, pre.duplicates, pre.errorCount, pre.recon.matched, pre.recon.unmatched], [3, 3, 0, 0, 1, 2]);
  assert.equal(w.db.of('erp_stl').length, 0, 'the preview wrote nothing');
  const r = await w.run('ACC1', 'imp.commit', stmt(bank, ROWS));
  assert.deepEqual([r.counts.imported, r.counts.matched], [3, 1]);
  assert.equal(w.db.docs.get(`erp_pay/${p}`).payments[0].stl != null, true, 'the rent payment is matched to its statement line');
  const ex = w.db.of('erp_exc');
  assert.deepEqual(ex.map((x) => x.kind).sort(), ['PAYMENT_NOT_IN_STATEMENT', 'STATEMENT_UNMATCHED', 'STATEMENT_UNMATCHED'], 'bank charges + an unknown receipt, and the cheque that hasn’t cleared');
  assert.equal(ex.find((x) => x.kind === 'PAYMENT_NOT_IN_STATEMENT').payId, p2);
  const bal = w.db.of('erp_bal').find((x) => x.source === 'STATEMENT');
  assert.deepEqual([bal.amount, bal.asOf], [97441000, '2026-10-09']);
  // the forecast starts from the statement balance; the rent paid on the 5th isn't deducted again
  const fc = await w.run('ACC1', 'forecast.get', { horizon: 7 });
  assert.equal(fc.accounts[0].current, 97441000);
  assert.ok(w.audits().some((a) => a.action === 'IMPORT_COMMITTED' && a.detail.matched === 1));
});

test('the same file twice is refused; an overlapping statement skips the rows already imported', async () => {
  const { w, bank } = await setup();
  await w.run('ACC1', 'imp.commit', stmt(bank, ROWS));
  await w.fails('ACC1', 'imp.commit', stmt(bank, ROWS), /imported before/);
  const next = [...ROWS.slice(1), { date: '2026-10-12', desc: 'NEFT DR SALARY', debit: '1,00,000', credit: '', balance: '8,74,410' }];
  const pre = await w.run('ACC1', 'imp.preview', { ...stmt(bank, next), fileHash: 'different-file' });
  assert.deepEqual([pre.new, pre.duplicates], [1, 2]);
  const r = await w.run('ACC1', 'imp.commit', { ...stmt(bank, next), fileHash: 'different-file' });
  assert.equal(r.counts.imported, 1);
  assert.equal(w.db.of('erp_stl').length, 4, 'no line imported twice');
});

test('amount formats: Dr / Cr suffixes, brackets, separate debit and credit columns; bad rows block the import unless skipped', async () => {
  const { w, bank } = await setup();
  const rows = [{ date: '2026-10-10', desc: 'a', amount: '1,000.00 Dr', balance: '5,000.00 Cr' }, { date: '2026-10-10', desc: 'b', amount: '(250.50)' }, { date: '2026-10-10', desc: 'c', amount: '300 Cr' }, { date: '10/13/2026', desc: 'bad date', amount: '1' }];
  const pre = await w.run('ACC1', 'imp.preview', stmt(bank, rows));
  assert.deepEqual(pre.rows.map((x) => x.amount), [-100000, -25050, 30000]);
  assert.equal(pre.rows[0].balance, 500000);
  assert.equal(pre.errorCount, 1);
  await w.fails('ACC1', 'imp.commit', stmt(bank, rows), /1 row has errors/);
  const r = await w.run('ACC1', 'imp.commit', { ...stmt(bank, rows), skipErrors: true });
  assert.deepEqual([r.counts.imported, r.counts.errors], [3, 1]);
});

test('Tally balances: mapped ledgers become verified balances (source Tally); unmapped ledgers are exceptions', async () => {
  const { w, bank } = await setup();
  await w.run('ACC1', 'imp.commit', { kind: 'TALLY_BALANCES', fileName: 'tally-bank.csv', rows: [{ ledger: 'HDFC Bank A/c', date: '2026-10-13', amount: '9,10,000.00 Dr' }, { ledger: 'Petty Cash', date: '2026-10-13', amount: '4,500 Dr' }], map: { 'HDFC Bank A/c': bank } });
  const b = w.db.of('erp_bal').find((x) => x.source === 'TALLY');
  assert.deepEqual([b.bankId, b.amount, b.asOf], [bank, 91000000, '2026-10-13'], '9,10,000 Dr in a bank ledger = ₹9,10,000 in the bank');
  await w.run('ACC1', 'imp.commit', { kind: 'TALLY_BALANCES', fileName: 'od.csv', rows: [{ ledger: 'HDFC Bank A/c', date: '2026-10-14', amount: '20,000 Cr' }], map: { 'HDFC Bank A/c': bank } });
  assert.equal(w.db.of('erp_bal').find((x) => x.source === 'TALLY' && x.asOf === '2026-10-14').amount, -2000000, 'Cr = overdrawn');
  assert.ok(w.db.of('erp_exc').some((x) => x.kind === 'TALLY_LEDGER_UNMAPPED' && x.text === 'Petty Cash'));
});

test('Tally outstanding: a snapshot (the previous one kept, superseded); differences from OfficeHub are exceptions, not changes', async () => {
  const { w, bank } = await setup();
  await w.run('ACC1', 'rcpt.save', { customer: 'Zen Foods', ref: 'SI-101', amount: '3,00,000', expectedDate: T, bankId: bank, tallyRef: 'SI-101' });
  await w.run('ACC1', 'imp.commit', { kind: 'TALLY_RECEIVABLES', fileName: 'bills-receivable-1.csv', asOf: '2026-10-13', rows: [{ party: 'Zen Foods', ref: 'SI-101', date: '2026-09-15', amount: '2,50,000', due: '2026-10-15' }, { party: 'Old Co', ref: 'SI-077', amount: '40,000' }] });
  const snap1 = w.db.of('erp_cust');
  assert.equal(snap1.length, 2);
  const x = w.db.of('erp_exc').find((e) => e.kind === 'OUTSTANDING_MISMATCH');
  assert.match(x.note, /Tally shows ₹2,50,000 outstanding; OfficeHub shows ₹3,00,000/);
  assert.equal(w.db.of('erp_rcpt')[0].amount, 30000000, 'the OfficeHub receipt is not changed');
  await w.run('ACC1', 'imp.commit', { kind: 'TALLY_RECEIVABLES', fileName: 'bills-receivable-2.csv', asOf: T, rows: [{ party: 'Zen Foods', ref: 'SI-101', amount: '2,50,000' }] });
  assert.equal(w.db.of('erp_cust').filter((c) => !c.superseded).length, 1, 'only the latest snapshot is current');
  assert.equal(w.db.of('erp_cust').length, 3, 'earlier snapshots are kept');
});

test('Tally vouchers: matched payments get their Tally reference; unmatched vouchers are exceptions; re-imports add nothing', async () => {
  const { w, p } = await setup();
  const rows = [{ date: '2026-10-05', vtype: 'Payment', number: 'PMT/412', party: 'Landlord', amount: '50,000.00', guid: 'abc-123' }, { date: '2026-10-07', vtype: 'Payment', number: 'PMT/413', party: 'Unknown Vendor', amount: '9,999', guid: 'abc-124' }];
  const r = await w.run('ACC1', 'imp.commit', { kind: 'TALLY_VOUCHERS', fileName: 'daybook.xml', rows });
  assert.deepEqual([r.counts.imported, r.counts.matched, r.counts.exceptions], [2, 1, 1]);
  assert.equal(w.db.docs.get(`erp_pay/${p}`).tallyRef, 'PMT/412');
  const again = await w.run('ACC1', 'imp.commit', { kind: 'TALLY_VOUCHERS', fileName: 'daybook-again.xml', rows });
  assert.deepEqual([again.counts.imported, again.counts.duplicates], [0, 2]);
});

test('exceptions are resolved with an explanation (or by matching by hand) and stay on record; only Accounts imports', async () => {
  const { w, bank } = await setup();
  await w.run('ACC1', 'imp.commit', stmt(bank, ROWS));
  const charges = w.db.of('erp_exc').find((x) => x.text?.includes('BANK CHARGES'));
  const id = [...w.db.docs].find(([k, v]) => k.startsWith('erp_exc/') && v === w.db.docs.get(k) && v.text === charges.text)[0].slice(8);
  await w.fails('ACC1', 'exc.resolve', { id }, /Explanation/);
  await w.run('ACC1', 'exc.resolve', { id, note: 'Quarterly bank charges — booked in Tally as JV 88' });
  assert.equal(w.db.docs.get(`erp_exc/${id}`).status, 'RESOLVED');
  await w.fails('ACC1', 'exc.resolve', { id, note: 'again' }, /already resolved/);
  for (const who of ['PUR1', 'ST1', 'ADM', 'DIRP', 'E1']) await w.fails(who, 'imp.preview', stmt(bank, ROWS), /Only Accounts/);
});
