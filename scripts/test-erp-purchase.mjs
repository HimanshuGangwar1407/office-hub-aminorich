// Purchase, Stores and the Purchase ↔ Accounts controls (server/erp-purchase.js, erp-stores.js). Loaded by test-erp.mjs.
import assert from 'node:assert/strict';
import { test, world } from './erp-test-kit.mjs';

const T = '2026-10-14';
const up = (w, who, fid) => { w.db.docs.set(`blob/${fid}_0`, { fid, i: 0, n: 1, by: who, data: 'QUJD' }); return [{ fid, chunks: 1, name: `${fid}.pdf`, ext: 'pdf', size: 3 }]; };
let seq = 0;
async function setup({ advancePct = '30', kind = 'GOODS' } = {}) {
  const w = world();
  await w.run('ADM', 'perm.set', { empId: 'PAPR', perms: ['pur.approve'], limits: { pur: '10,00,000' } });
  const { id: bank } = await w.run('ACC1', 'bank.save', { name: 'HDFC', bank: 'HDFC', last4: '1111', openingAmount: '20,00,000', openingDate: '2026-10-13' });
  const { id: sup } = await w.run('PUR1', 'sup.save', { name: 'Acme Chemicals', gstin: '27AAACA1234F1Z5', terms: '30 days' });
  await w.run('PAPR', 'sup.approve', { id: sup });
  const { id: po } = await w.run('PUR1', 'po.save', {
    supplierId: sup, kind, deliveryLocation: 'Factory, Guwahati', expectedDate: '2026-10-25', terms: '30% advance, balance 30 days after delivery',
    advanceType: 'PCT', advanceValue: advancePct, charges: '1,000',
    lines: [{ desc: 'Citric acid 25 kg bag', uom: 'Bag', qty: '100', rate: '800', tax: '18' }, { desc: 'Sodium benzoate', uom: 'Kg', qty: '50', rate: '400', tax: '18' }],
  });
  await w.run('PAPR', 'po.act', { id: po, action: 'approve' });
  const P = () => w.db.docs.get(`erp_po/${po}`);
  return { w, bank, sup, po, P, L: () => P().lines };
}
const grn = async (w, po, lines, o = {}) => (await w.run('ST1', 'grn.save', { poId: po, challanNo: o.challan || `DC-${++seq}`, deliveryDate: T, location: 'Factory store', lines, ...o })).id;
const inv = (w, who, x) => w.run(who, 'inv.save', { date: T, due: '2026-11-13', files: up(w, who, 'f' + (++seq)), ...x });
const approvePay = async (w, id, extra = {}) => { await w.run('ACC2', 'pay.act', { id, action: 'verify' }); return w.run('APR', 'pay.act', { id, action: 'approve', ...extra }); };

test('purchase orders: exact totals, approval by someone else within their limit, approved suppliers only', async () => {
  const { w, P, sup } = await setup();
  const p = P();
  assert.equal(p.subtotal, 8000000 + 2000000); assert.equal(p.taxTotal, 1440000 + 360000); assert.equal(p.total, 10000000 + 1800000 + 100000);
  assert.equal(p.code, 'PO-0001'); assert.equal(p.status, 'APPROVED'); assert.equal(p.approvedBy, 'PAPR');
  const { id: po2 } = await w.run('PAPR', 'po.save', { supplierId: sup, deliveryLocation: 'x', expectedDate: T, terms: 'x', lines: [{ desc: 'x', qty: '1', rate: '1' }] });
  await w.fails('PAPR', 'po.act', { id: po2, action: 'approve' }, /you raised/);
  await w.fails('PUR1', 'po.act', { id: po2, action: 'approve' }, /approval permission/);
  await w.run('ADM', 'perm.set', { empId: 'MGR', perms: ['pur.approve'], limits: { pur: '1,000' } });
  const { id: po3 } = await w.run('PUR1', 'po.save', { supplierId: sup, deliveryLocation: 'x', expectedDate: T, terms: 'x', lines: [{ desc: 'x', qty: '10', rate: '500' }] });
  await w.fails('MGR', 'po.act', { id: po3, action: 'approve' }, /above your approval limit of ₹1,000/);
  const { id: s2 } = await w.run('PUR1', 'sup.save', { name: 'New Vendor' });
  const { id: po4 } = await w.run('PUR1', 'po.save', { supplierId: s2, deliveryLocation: 'x', expectedDate: T, terms: 'x', lines: [{ desc: 'x', qty: '1', rate: '1' }] });
  await w.fails('PAPR', 'po.act', { id: po4, action: 'approve' }, /isn’t an approved supplier/);
  await w.fails('ST1', 'po.save', {}, /Only Purchase/);
});

test('a PO changed after approval becomes a new version (kept, with the reason) and needs approval again', async () => {
  const { w, po, P, L } = await setup();
  await grn(w, po, [{ poLineId: L()[0].id, received: '40', qc: 'PASSED' }]);
  await w.run('STV', 'grn.verify', { id: w.db.of('erp_grn')[0] && [...w.db.docs].find(([k]) => k.startsWith('erp_grn/'))[0].slice(8) });
  const lines = L().map((l) => ({ id: l.id, desc: l.desc, uom: l.uom, qty: String(l.qty / 1000), rate: String(l.rate / 100), tax: '18' }));
  await w.fails('PUR1', 'po.revise', { id: po, reason: 'Reduce quantity', supplierId: P().supplierId, deliveryLocation: 'Factory', expectedDate: T, terms: 'x', lines: [{ ...lines[0], qty: '30' }, lines[1]] }, /already received or invoiced \(40/);
  await w.fails('PUR1', 'po.revise', { id: po, deliveryLocation: 'Factory', expectedDate: T, terms: 'x', lines }, /Reason/);
  await w.run('PUR1', 'po.revise', { id: po, reason: 'Supplier agreed a lower rate', deliveryLocation: 'Factory', expectedDate: T, terms: 'x', advanceType: 'PCT', advanceValue: '30', lines: [{ ...lines[0], rate: '780' }, lines[1]] });
  const p = P();
  assert.equal(p.version, 2); assert.equal(p.status, 'SUBMITTED'); assert.equal(p.versions[0].total, 11900000); assert.equal(p.versions[0].reason, 'Supplier agreed a lower rate');
  await w.fails('PUR1', 'po.act', { id: po, action: 'approve' }, /approval permission/);
  await w.run('PAPR', 'po.act', { id: po, action: 'approve' });
  assert.ok(w.audits().some((a) => a.action === 'PO_REVISED'));
});

test('advances: within the PO’s terms; more needs an approver’s reason; tracked until adjusted', async () => {
  const { w, po, P } = await setup(); // 30% of ₹1,19,000 = ₹35,700
  const { id: a1 } = await w.run('PUR1', 'po.advance', { id: po, amount: '30,000' });
  await w.fails('PUR1', 'po.advance', { id: po, amount: '10,000' }, /allows ₹35,700 in advance; ₹30,000 is already requested/);
  await w.fails('PUR1', 'po.advance', { id: po, amount: '10,000', override: { reason: 'urgent' } }, /Only an approver/);
  const a2 = await w.run('APR', 'po.advance', { id: po, amount: '10,000', override: { reason: 'Supplier needs 40% for the import duty on this lot' } }).catch((e) => e);
  assert.match(String(a2.message || ''), /Only Purchase/, 'Accounts can’t raise purchase advances');
  w.db.docs.set('emp/PAPR', { ...w.db.docs.get('emp/PAPR'), erp: ['pur.approve'] });
  const ok = await w.run('PAPR', 'po.advance', { id: po, amount: '10,000', override: { reason: 'Supplier needs 40% for the import duty on this lot' } });
  assert.ok(w.db.docs.get(`erp_pay/${ok.id}`).advanceOverride);
  assert.ok(w.audits().some((a) => a.action === 'ADVANCE_OVER_TERMS'));
  // the payment checks flag an advance over terms at approval; an exception reason lets it through, recorded
  await w.run('ACC2', 'pay.act', { id: ok.id, action: 'verify' });
  await w.fails('APR', 'pay.act', { id: ok.id, action: 'approve' }, /Allowed by the PO’s advance terms/);
  await w.run('APR', 'pay.act', { id: ok.id, action: 'approve', exception: 'Director approved 40% advance by email on 12 Oct' });
  assert.ok(w.db.docs.get(`erp_pay/${ok.id}`).exception);
  await approvePay(w, a1);
  void P;
});

test('THE BUSINESS CASE: advance paid, then the full invoice — the balance payment can’t charge for the advance again', async () => {
  const { w, po, sup, bank, L } = await setup(); // PO ₹1,19,000, 30% advance
  const { id: adv } = await w.run('PUR1', 'po.advance', { id: po, amount: '35,700' });
  await approvePay(w, adv);
  await w.run('ACC1', 'pay.act', { id: adv, action: 'record', amount: '35,700', date: T, bankId: bank, ref: 'UTRADV0001' });
  // the goods arrive, are verified; the supplier invoices the full ₹1,19,000
  const g = await grn(w, po, [{ poLineId: L()[0].id, received: '100', qc: 'PASSED' }, { poLineId: L()[1].id, received: '50', qc: 'PASSED' }]);
  await w.run('STV', 'grn.verify', { id: g });
  const { id: i } = await inv(w, 'PUR1', { supplierId: sup, poId: po, invoiceNo: 'ACME/24-25/118', amount: '1,19,000', tax: '18,000', charges: '1,000', lines: L().map((l) => ({ poLineId: l.id, qty: String(l.qty / 1000) })) });
  assert.equal(w.db.docs.get(`erp_inv/${i}`).status, 'RECEIVED', 'matches PO and GRN');
  await w.run('ACC2', 'inv.act', { id: i, action: 'verify' });
  // asking for the full invoice amount: approval is blocked — the advance hasn't been adjusted
  const { id: full } = await w.run('ACC1', 'inv.act', { id: i, action: 'pay', amount: '1,19,000' });
  await w.run('ACC2', 'pay.act', { id: full, action: 'verify' });
  await w.fails('APR', 'pay.act', { id: full, action: 'approve' }, /Advances adjusted \(₹35,700 advance on this PO not yet adjusted/);
  await w.run('ACC1', 'pay.act', { id: full, action: 'cancel', note: 'Advance must be adjusted first' });
  // adjust the advance: now only ₹83,300 is payable, and a request for more is refused outright
  await w.run('ACC1', 'inv.act', { id: i, action: 'adjust', payId: adv, amount: '35,700' });
  await w.fails('ACC1', 'inv.act', { id: i, action: 'pay', amount: '1,19,000' }, /Only ₹83,300 can be requested — ₹0 paid, ₹0 credited, ₹35,700 advances adjusted/);
  const { id: bal } = await w.run('ACC1', 'inv.act', { id: i, action: 'pay' });
  assert.equal(w.db.docs.get(`erp_pay/${bal}`).amountReq, 8330000);
  await approvePay(w, bal);
  await w.run('ACC1', 'pay.act', { id: bal, action: 'record', amount: '83,300', date: T, bankId: bank, ref: 'UTRBAL0001' });
  // nothing left: any further request for this invoice is refused
  await w.fails('ACC1', 'inv.act', { id: i, action: 'pay', amount: '1' }, /Nothing is left|Only ₹0/);
  await w.fails('ACC1', 'pay.create', { category: 'SUPPLIER', invoiceId: i, payee: 'Acme Chemicals', amount: '1,000' }, /Only ₹0 can be requested/);
  const paid = w.db.of('erp_pay').filter((p) => p.supplierId === sup && ['PAID'].includes(p.status)).reduce((s, p) => s + p.payments.reduce((x, y) => x + y.amount, 0), 0);
  assert.equal(paid, 11900000, 'paid exactly the invoice: ₹35,700 + ₹83,300');
});

test('an invoice for goods not yet received is flagged; paying it needs a recorded exception', async () => {
  const { w, po, sup, L } = await setup();
  const { id: i } = await inv(w, 'PUR1', { supplierId: sup, poId: po, invoiceNo: 'ACME-200', amount: '94,400', tax: '14,400', lines: [{ poLineId: L()[0].id, qty: '100' }] });
  const x = w.db.docs.get(`erp_inv/${i}`);
  assert.equal(x.status, 'DISCREPANCY'); assert.match(x.match.issues.join(' '), /invoiced 100 Bag, accepted at stores 0/);
  await w.fails('ACC2', 'inv.act', { id: i, action: 'verify' }, /Resolve the PO \/ goods receipt differences/);
  await w.fails('PUR1', 'inv.act', { id: i, action: 'accept', note: 'ok' }, /Only an approver/);
  await w.run('PAPR', 'inv.act', { id: i, action: 'accept', note: 'Goods in transit; supplier requires payment against dispatch per contract' });
  await w.run('ACC2', 'inv.act', { id: i, action: 'verify' });
  const { id: p } = await w.run('ACC1', 'inv.act', { id: i, action: 'pay' });
  await w.run('ACC2', 'pay.act', { id: p, action: 'verify' });
  assert.equal(w.db.docs.get(`erp_pay/${p}`).checks.find((c) => c.k === 'received').ok, false, 'the verifier sees “Material received: no”');
  await w.fails('APR', 'pay.act', { id: p, action: 'approve' }, /Material received \(no goods receipt yet\)/);
  await w.fails('APR', 'pay.act', { id: p, action: 'approve', exception: 'urgent' }, /full sentence/);
  await w.run('APR', 'pay.act', { id: p, action: 'approve', exception: 'Contract clause 4: payment against dispatch documents (LR attached)' });
  const a = w.audits().find((x) => x.action === 'PAYMENT_APPROVED' && x.detail.exception);
  assert.match(a.detail.exception, /Contract clause 4/);
});

test('duplicate invoices: same supplier + number in any format is blocked; near-duplicates are shown; other suppliers are fine', async () => {
  const { w, sup } = await setup();
  await inv(w, 'PUR1', { supplierId: sup, invoiceNo: 'INV/2026/0042', amount: '50,000' });
  await w.fails('PUR1', 'inv.save', { supplierId: sup, invoiceNo: 'inv-2026-0042', amount: '50,000', date: T, files: up(w, 'PUR1', 'dupf') }, /Duplicate invoice: Acme Chemicals invoice INV\/2026\/0042 is already recorded as INV-0001/);
  await w.fails('PUR1', 'inv.save', { supplierId: sup, invoiceNo: 'inv/2026/42', amount: '50,000', date: T, files: up(w, 'PUR1', 'dupz') }, /Duplicate invoice/);
  const chk = await w.run('PUR1', 'inv.check', { supplierId: sup, invoiceNo: 'INV 2026 0042' });
  assert.equal(chk.matches[0].kind, 'EXACT');
  const near = await w.run('PUR1', 'inv.check', { supplierId: sup, invoiceNo: 'INV-2026-0099', amount: '50,000', date: '2026-10-16' });
  assert.equal(near.matches[0].kind, 'NEAR'); assert.match(near.matches[0].why, /same supplier and amount/);
  const r = await inv(w, 'PUR1', { supplierId: sup, invoiceNo: 'INV-2026-0099', amount: '50,000', date: '2026-10-14' });
  assert.equal(r.warnings.length, 1, 'saved, with the warning kept on the invoice');
  const { id: s2 } = await w.run('PUR1', 'sup.save', { name: 'Beta Traders' });
  await inv(w, 'PUR1', { supplierId: s2, invoiceNo: 'INV/2026/0042', amount: '50,000' });
  await w.fails('PUR1', 'inv.save', { supplierId: sup, invoiceNo: 'INV20260042', amount: '1', date: T, files: up(w, 'PUR1', 'g1'), override: { reason: 'separate invoice really' } }, /Only an approver/);
  await w.run('PAPR', 'inv.save', { supplierId: sup, invoiceNo: 'INV20260042', amount: '1', date: T, files: up(w, 'PAPR', 'g2'), override: { reason: 'Supplier reused the number for a debit note; confirmed by phone' } });
  assert.ok(w.audits().some((a) => a.action === 'DUPLICATE_OVERRIDE' && a.by === 'PAPR'));
  await w.fails('PUR1', 'inv.save', { supplierId: sup, invoiceNo: 'X-1', amount: '1', date: T }, /Attach the supplier’s invoice/);
});

test('three-way match: price and quantity differences are flagged; partial deliveries and multiple invoices add up', async () => {
  const { w, po, sup, L } = await setup();
  const g1 = await grn(w, po, [{ poLineId: L()[0].id, received: '60', qc: 'PASSED' }]);
  await w.run('STV', 'grn.verify', { id: g1 });
  // invoiced at a higher rate than the PO
  const a = await inv(w, 'PUR1', { supplierId: sup, poId: po, invoiceNo: 'A-1', amount: '57,348', lines: [{ poLineId: L()[0].id, qty: '60', rate: '810' }] });
  assert.match(w.db.docs.get(`erp_inv/${a.id}`).match.issues.join(' '), /rate ₹810 vs ₹800/);
  // a correct first invoice for the 60 received
  const b = await inv(w, 'PUR1', { supplierId: sup, poId: po, invoiceNo: 'A-2', amount: '56,640', lines: [{ poLineId: L()[0].id, qty: '60' }] });
  assert.equal(w.db.docs.get(`erp_inv/${b.id}`).status, 'DISCREPANCY', 'the other invoice already claims those 60 bags');
  await w.run('PUR1', 'inv.act', { id: a.id, action: 'cancel', note: 'Wrong rate — supplier will reissue' });
  await w.run('PUR1', 'inv.act', { id: b.id, action: 'rematch' });
  assert.equal(w.db.docs.get(`erp_inv/${b.id}`).status, 'RECEIVED');
  // the second delivery (40 more), then an invoice for those 40
  const g2 = await grn(w, po, [{ poLineId: L()[0].id, received: '45', rejected: '5', remarks: '5 bags torn', qc: 'PARTIAL' }]);
  await w.fails('ST1', 'grn.verify', { id: g2 }, /Only a Stores verifier/);
  await w.run('STV', 'grn.verify', { id: g2 });
  await w.fails('ST1', 'grn.save', { poId: po, challanNo: 'DC-X', deliveryDate: T, location: 'store', lines: [{ poLineId: L()[0].id, received: '10' }] }, /only 0 Bag are still to come/);
  const c = await inv(w, 'PUR1', { supplierId: sup, poId: po, invoiceNo: 'A-3', amount: '37,760', lines: [{ poLineId: L()[0].id, qty: '40' }] });
  assert.equal(w.db.docs.get(`erp_inv/${c.id}`).status, 'RECEIVED');
  const d = await inv(w, 'PUR1', { supplierId: sup, poId: po, invoiceNo: 'A-4', amount: '9,440', lines: [{ poLineId: L()[0].id, qty: '10' }] });
  assert.match(w.db.docs.get(`erp_inv/${d.id}`).match.issues.join(' '), /invoiced 110 Bag, ordered 100/);
  // totals that don't add up are caught too
  const e = await inv(w, 'PUR1', { supplierId: sup, poId: po, invoiceNo: 'A-5', amount: '30,000', lines: [{ poLineId: L()[1].id, qty: '50' }] });
  assert.match(w.db.docs.get(`erp_inv/${e.id}`).match.issues.join(' '), /doesn’t match its lines \(₹23,600\)/);
});

test('credit notes and earlier payments reduce what is payable; partial payments never double count', async () => {
  const { w, sup, bank } = await setup();
  const { id: i } = await inv(w, 'PUR1', { supplierId: sup, invoiceNo: 'S-9', amount: '1,00,000' });
  await w.run('ACC2', 'inv.act', { id: i, action: 'verify' });
  await w.run('PUR1', 'inv.act', { id: i, action: 'credit', no: 'CN-7', date: T, amount: '10,000', note: 'Short-supplied 10 bags' });
  await w.fails('PUR1', 'inv.act', { id: i, action: 'credit', no: 'cn 7', date: T, amount: '1', note: 'x' }, /already recorded/);
  const { id: p1 } = await w.run('ACC1', 'inv.act', { id: i, action: 'pay', amount: '50,000' });
  await w.fails('ACC1', 'inv.act', { id: i, action: 'pay', amount: '45,000' }, /Only ₹40,000 can be requested — ₹0 paid, ₹10,000 credited, ₹0 advances adjusted, ₹50,000 already requested/);
  await approvePay(w, p1);
  await w.run('ACC1', 'pay.act', { id: p1, action: 'record', amount: '30,000', date: T, bankId: bank, ref: 'UTRP1A' });
  const { id: p2 } = await w.run('ACC1', 'inv.act', { id: i, action: 'pay' });
  assert.equal(w.db.docs.get(`erp_pay/${p2}`).amountReq, 4000000, '₹1,00,000 − ₹10,000 credit − ₹50,000 already requested (₹30,000 of it paid)');
  // the forecast counts each request's unpaid remainder once: ₹20,000 + ₹40,000
  const fc = await w.run('ACC1', 'forecast.get', { horizon: 30 });
  assert.equal(fc.events.filter((e) => e.kind === 'PLANNED_PAYMENT').reduce((s, e) => s - e.amount, 0), 6000000);
  assert.equal(fc.events.filter((e) => e.kind === 'PAID').reduce((s, e) => s - e.amount, 0), 3000000);
});

test('the same purchase commitment is never counted twice across Purchase and Accounts', async () => {
  const { w, po, sup, L } = await setup();
  let fc = await w.run('ACC1', 'forecast.get', { horizon: 30 });
  assert.equal(fc.events.length, 0, 'an approved PO alone is a commitment, not a cash outflow');
  const { id: adv } = await w.run('PUR1', 'po.advance', { id: po, amount: '20,000', due: '2026-10-16' });
  const g = await grn(w, po, [{ poLineId: L()[1].id, received: '50', qc: 'PASSED' }]); await w.run('STV', 'grn.verify', { id: g });
  const { id: i } = await inv(w, 'PUR1', { supplierId: sup, poId: po, invoiceNo: 'C-1', amount: '23,600', lines: [{ poLineId: L()[1].id, qty: '50' }] });
  await w.run('ACC2', 'inv.act', { id: i, action: 'verify' });
  await w.run('ACC1', 'inv.act', { id: i, action: 'pay' });
  fc = await w.run('ACC1', 'forecast.get', { horizon: 30 });
  assert.deepEqual(fc.events.map((e) => -e.amount).sort((a, b) => a - b), [2000000, 2360000], 'the advance and the invoice payment, once each');
  void adv;
});

test('stores: only Stores records receipts; challan numbers are unique; a verified receipt is reversed, never edited', async () => {
  const { w, po, L } = await setup();
  await w.fails('PUR1', 'grn.save', { poId: po, challanNo: 'Z', deliveryDate: T, location: 'x', lines: [{ poLineId: L()[0].id, received: '1' }] }, /Only Stores/);
  await w.fails('E1', 'grn.save', { poId: po, challanNo: 'Z', deliveryDate: T, location: 'x', lines: [{ poLineId: L()[0].id, received: '1' }] }, /Only Stores/);
  await w.fails('ST1', 'grn.save', { poId: po, deliveryDate: T, location: 'x', lines: [{ poLineId: L()[0].id, received: '1' }] }, /challan/);
  await w.fails('ST1', 'grn.save', { poId: po, challanNo: 'Z', deliveryDate: '2026-10-20', location: 'x', lines: [{ poLineId: L()[0].id, received: '1' }] }, /future/);
  await w.fails('ST1', 'grn.save', { poId: po, challanNo: 'Z', deliveryDate: T, location: 'x', lines: [{ poLineId: L()[0].id, received: '10', rejected: '2' }] }, /say why/);
  const g = await grn(w, po, [{ poLineId: L()[0].id, received: '10', qc: 'PASSED' }], { challan: 'DC/77' });
  await w.fails('ST1', 'grn.save', { poId: po, challanNo: 'dc 77', deliveryDate: T, location: 'x', lines: [{ poLineId: L()[0].id, received: '1' }] }, /already received/);
  await w.fails('ST1', 'grn.verify', { id: g }, /Only a Stores verifier/);
  await w.run('ADM', 'perm.set', { empId: 'ST1', perms: ['sto.verify'] });
  await w.fails('ST1', 'grn.verify', { id: g }, /Someone other than the person who received/);
  await w.run('STV', 'grn.verify', { id: g });
  await w.fails('STV', 'grn.reverse', { id: g }, /Reason/);
  await w.run('STV', 'grn.reverse', { id: g, note: 'Wrong PO — goods belonged to PO-0002' });
  const x = w.db.docs.get(`erp_grn/${g}`);
  assert.equal(x.status, 'REVERSED'); assert.equal(x.lines[0].accepted, 10000, 'the original figures are kept');
  assert.ok(w.audits().some((a) => a.action === 'GRN_REVERSED'));
  await grn(w, po, [{ poLineId: L()[0].id, received: '100', qc: 'PASSED' }], { challan: 'DC/77' });
});

test('stock: movements make the balance; goods receipts add stock; issues can’t go below zero; adjustments need a reason', async () => {
  const { w, sup } = await setup();
  const { id: item } = await w.run('ST1', 'item.save', { sku: 'CIT-25', name: 'Citric acid 25 kg', uom: 'Bag', reorder: '20', opening: '5' });
  await w.fails('ST1', 'item.save', { sku: 'cit-25', name: 'x', uom: 'Bag' }, /already used/);
  const { id: po } = await w.run('PUR1', 'po.save', { supplierId: sup, deliveryLocation: 'Factory', expectedDate: T, terms: '30 days', lines: [{ desc: 'Citric acid', itemId: item, uom: 'Bag', qty: '40', rate: '800', tax: '18' }] });
  await w.run('PAPR', 'po.act', { id: po, action: 'approve' });
  const lid = w.db.docs.get(`erp_po/${po}`).lines[0].id;
  const g = await grn(w, po, [{ poLineId: lid, received: '40', qc: 'PASSED' }]);
  const stock = () => w.db.of('erp_stk').filter((m) => m.itemId === item).reduce((s, m) => s + m.qty, 0);
  assert.equal(stock(), 5000, 'not counted until verified');
  await w.run('STV', 'grn.verify', { id: g });
  assert.equal(stock(), 45000);
  await w.run('ST1', 'stk.move', { type: 'OUT', itemId: item, qty: '30', ref: 'Batch 117', toDept: 'ops' });
  await w.fails('ST1', 'stk.move', { type: 'OUT', itemId: item, qty: '20' }, /Only 15 Bag/);
  await w.fails('ST1', 'stk.move', { type: 'ADJUST', itemId: item, qty: '1', direction: 'DOWN', reason: 'count' }, /Stores verifier/);
  await w.fails('STV', 'stk.move', { type: 'ADJUST', itemId: item, qty: '1', direction: 'DOWN' }, /Reason/);
  await w.run('STV', 'stk.move', { type: 'ADJUST', itemId: item, qty: '1', direction: 'DOWN', reason: 'Physical count 14 Oct: 14 bags' });
  assert.equal(stock(), 14000);
});

test('suppliers: no duplicates; bank details go live only after someone else in Accounts verifies them with evidence', async () => {
  const { w, sup } = await setup();
  await w.fails('PUR1', 'sup.save', { name: 'Acme Chem (dup)', gstin: '27AAACA1234F1Z5' }, /GSTIN 27AAACA1234F1Z5 already exists/);
  await w.fails('PUR1', 'sup.save', { name: 'x', gstin: 'BAD' }, /GSTIN doesn’t look right/);
  await w.fails('PUR1', 'sup.bank', { id: sup, holder: 'Acme', bank: 'HDFC', account: '50100012345678', ifsc: 'HDFC0001234' }, /cancelled cheque/);
  await w.run('ACC1', 'sup.bank', { id: sup, holder: 'Acme Chemicals Pvt Ltd', bank: 'HDFC', account: '50100012345678', ifsc: 'HDFC0001234', files: up(w, 'ACC1', 'chq') });
  assert.equal(w.db.docs.get(`erp_supbank/${sup}`).account, undefined, 'not live yet');
  await w.fails('ACC1', 'sup.bankVerify', { id: sup, how: 'called' }, /Someone other than the person who entered/);
  await w.fails('PUR1', 'sup.bankVerify', { id: sup, how: 'called' }, /Only Accounts/);
  await w.run('ACC2', 'sup.bankVerify', { id: sup, how: 'Called Mr Rao on the number in our 2024 PO file; confirmed last 4 digits' });
  const b = w.db.docs.get(`erp_supbank/${sup}`);
  assert.equal(b.last4, '5678'); assert.equal(b.verifiedBy, 'ACC2');
  assert.equal(w.db.docs.get(`erp_sup/${sup}`).bankLast4, '5678', 'the supplier record (seen by Purchase and Stores) shows only the last 4 digits');
  assert.ok(w.audits().some((a) => a.action === 'SUPPLIER_BANK_CHANGED' && a.detail.to === '5678' && !JSON.stringify(a).includes('50100012345678')), 'the audit log never holds the account number');
});

test('requisitions: anyone may raise one; their manager (or a purchase approver) decides — never themselves', async () => {
  const { w } = await setup();
  const { id } = await w.run('E1', 'pr.save', { items: [{ desc: 'Office chairs', qty: '4', uom: 'Nos', estRate: '6,500' }], justification: 'New joiners', needBy: '2026-10-30' });
  const pr = w.db.docs.get(`erp_pr/${id}`);
  assert.equal(pr.approverId, 'MGR'); assert.equal(pr.estTotal, 2600000);
  await w.fails('E1', 'pr.act', { id, action: 'approve' }, /own requisition/);
  await w.fails('ST1', 'pr.act', { id, action: 'approve' }, /access to this requisition/);
  await w.run('MGR', 'pr.act', { id, action: 'approve' });
  assert.equal(w.db.docs.get(`erp_pr/${id}`).status, 'APPROVED');
});
