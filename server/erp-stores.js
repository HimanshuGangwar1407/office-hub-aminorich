// Stores: goods receipt notes (GRNs) against purchase orders, verification and quality inspection, corrections by
// reversal, service acceptance, and stock kept as movements (current stock is their sum — never edited directly).
// A GRN never marks an invoice paid: it only feeds the three-way match and the payment eligibility checks.
import { registerErp } from './erp.js';
import { bad, deny, conflict, newId, toQty, str, text, need, ymdOf, oneOf, isId, needId, normRef, keyOf, ymdIST, filesFrom } from './erp-core.js';
import { matchInvoice } from './erp-purchase.js';

const QC = ['PASSED', 'FAILED', 'PARTIAL', 'NOT_REQUIRED', 'PENDING'];
const sum = (l, f = (x) => x) => l.reduce((s, x) => s + (f(x) || 0), 0);
const hist = (r, by, now, action, note = '') => [...(r.history || []), { at: now, by, action, note: note || undefined }];
const q3 = (m) => (m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** what is still to come on each PO line: ordered − accepted on verified GRNs − received on GRNs not yet verified */
export function outstanding(po, poId, grns, selfId = null) {
  return (po.lines || []).map((l) => {
    const live = grns.filter((g) => g.data.poId === poId && g.id !== selfId && ['RECORDED', 'VERIFIED'].includes(g.data.status)).flatMap((g) => g.data.lines.filter((x) => x.poLineId === l.id).map((x) => ({ ...x, st: g.data.status })));
    const accepted = sum(live.filter((x) => x.st === 'VERIFIED'), (x) => x.accepted), pending = sum(live.filter((x) => x.st === 'RECORDED'), (x) => x.accepted);
    return { id: l.id, desc: l.desc, uom: l.uom, itemId: l.itemId, ordered: l.qty, accepted, pending, open: Math.max(0, l.qty - accepted - pending) };
  });
}
async function rematchPo(t, poId, cfg) {
  const po = await t.get(`erp_po/${poId}`);
  if (!po) return;
  const [grns, invs] = await Promise.all([t.list('erp_grn'), t.list('erp_inv')]);
  for (const { id, data: inv } of invs.filter((i) => i.data.poId === poId && ['RECEIVED', 'DISCREPANCY'].includes(i.data.status))) {
    const m = matchInvoice(inv, id, { ...po, id: poId }, grns, invs, cfg);
    const accepted = inv.match?.accepted && !m.ok ? inv.match.accepted : null;
    await t.set(`erp_inv/${id}`, { ...inv, match: { ...m, accepted }, status: m.ok || accepted ? 'RECEIVED' : 'DISCREPANCY' });
  }
}
async function stockMove(t, m) { await t.set(`erp_stk/${newId()}`, m); }

const stores = {
  /* ── goods receipt / service acceptance ── */
  'grn.save': async (a, { E, t, now, by, audit, notify, holders, cfg }) => {
    const poId = needId(a.poId, 'Purchase order'), po = await t.get(`erp_po/${poId}`);
    if (!po || po.status !== 'APPROVED') bad('Goods are received only against an approved, open purchase order.');
    const service = po.kind === 'SERVICES';
    if (service ? !E.has('pur') && !E.has('sto') : !E.has('sto')) deny(service ? 'Purchase or Stores records the acceptance of services.' : 'Only Stores records goods received.');
    const c = await cfg(), grns = await t.list('erp_grn'), open = outstanding(po, poId, grns);
    const deliveryDate = ymdOf(a.deliveryDate, service ? 'Completion date' : 'Delivery date');
    if (deliveryDate > ymdIST(now)) bad('Goods can’t be received in the future — record them when they arrive.');
    const lines = [];
    for (const [k, x] of (Array.isArray(a.lines) ? a.lines : []).entries()) {
      if (x == null || x.received === '' || x.received == null) continue;
      const o = open.find((l) => l.id === x.poLineId);
      if (!o) bad(`Line ${k + 1} isn’t on the purchase order.`);
      const received = toQty(x.received, `${o.desc}: quantity received`, { allowZero: true });
      if (!received) continue;
      const rejected = x.rejected === '' || x.rejected == null ? 0 : toQty(x.rejected, `${o.desc}: rejected`, { allowZero: true });
      const damaged = x.damaged === '' || x.damaged == null ? 0 : toQty(x.damaged, `${o.desc}: damaged`, { allowZero: true });
      if (rejected + damaged > received) bad(`${o.desc}: rejected + damaged can’t be more than received.`);
      const accepted = received - rejected - damaged;
      const allow = o.open + Math.floor((o.ordered * (c.qtyTolBp || 0)) / 10000);
      if (accepted > allow) bad(`${o.desc}: only ${q3(o.open)} ${o.uom} are still to come on ${po.code}. Reject or return the excess (${q3(accepted - o.open)} ${o.uom}).`);
      const qc = oneOf(String(x.qc || (service ? 'NOT_REQUIRED' : 'PENDING')), QC, `${o.desc}: inspection result`);
      const remarks = text(x.remarks, 300);
      if ((rejected || damaged || qc === 'FAILED' || qc === 'PARTIAL') && !remarks) bad(`${o.desc}: say why material was rejected or damaged.`);
      lines.push({ poLineId: o.id, desc: o.desc, uom: o.uom, itemId: o.itemId || null, ordered: o.ordered, prevAccepted: o.accepted, received, accepted, rejected, damaged, short: Math.max(0, o.open - received), excess: Math.max(0, received - o.open), qc, remarks });
    }
    if (!lines.length) bad('Enter the quantity received for at least one line.');
    const challanNo = str(a.challanNo, 40);
    if (!service && !challanNo) bad('Enter the delivery challan number.');
    if (challanNo && !(await t.claim(`erp_key/dc_${keyOf(po.supplierId, normRef(challanNo))}`, { po: poId, at: now }))) conflict(`Challan ${challanNo} from this supplier is already received.`);
    const rec = {
      code: await t.next(service ? 'SAC' : 'GRN'), kind: service ? 'SERVICE' : 'GOODS', poId, poCode: po.code, supplierId: po.supplierId, supplierName: po.supplierName,
      challanNo, deliveryDate, receivedAt: now, location: need(str(a.location, 80) || po.deliveryLocation, 'Receiving location'), vehicle: str(a.vehicle, 30),
      lines, note: text(a.note, 800), files: await filesFrom(a.files, t, by, now), status: 'RECORDED', receivedBy: by, history: [{ at: now, by, action: service ? 'Acceptance recorded' : 'Goods received' }],
    };
    const id = newId();
    await t.set(`erp_grn/${id}`, rec);
    await audit(service ? 'SERVICE_ACCEPTANCE_RECORDED' : 'GRN_CREATED', { grn: id, code: rec.code, po: po.code, lines: lines.map((l) => ({ desc: l.desc, received: l.received, accepted: l.accepted, rejected: l.rejected })) });
    await notify((service ? holders('pur.approve') : holders('sto.verify')).filter((x) => x !== by), { title: `${rec.code} to verify`, body: `${po.supplierName} · ${po.code}`, go: { view: 'stores', erp: id, erpKind: 'grn' } });
    return { id, code: rec.code };
  },
  'grn.verify': async (a, { E, t, now, by, audit, notify, holders, cfg }) => {
    const id = needId(a.id), g = await t.get(`erp_grn/${id}`);
    if (!g) bad('That goods receipt no longer exists.');
    if (g.kind === 'SERVICE' ? !E.has('pur.approve') && !E.has('sto.verify') : !E.has('sto.verify')) deny(g.kind === 'SERVICE' ? 'A purchase approver verifies service acceptance.' : 'Only a Stores verifier verifies goods receipts.');
    if (g.status !== 'RECORDED') bad('Only a newly recorded receipt can be verified.');
    if (g.receivedBy === by) deny('Someone other than the person who received the goods must verify them.');
    // check again: other receipts may have been verified in the meantime
    const po = await t.get(`erp_po/${g.poId}`), open = outstanding(po, g.poId, await t.list('erp_grn'), id), c = await cfg();
    for (const l of g.lines) { const o = open.find((x) => x.id === l.poLineId); const allow = (o?.open ?? 0) + Math.floor((l.ordered * (c.qtyTolBp || 0)) / 10000); if (l.accepted > allow) bad(`${l.desc}: more than is still to come on the PO — reverse this receipt and record it again.`); }
    await t.set(`erp_grn/${id}`, { ...g, status: 'VERIFIED', verifiedBy: by, verifiedAt: now, history: hist(g, by, now, 'Verified', text(a.note, 500)) });
    for (const l of g.lines) if (l.itemId && l.accepted) await stockMove(t, { itemId: l.itemId, qty: l.accepted, type: 'IN', ref: g.code, grnId: id, location: g.location, date: g.deliveryDate, by, at: now });
    await rematchPo(t, g.poId, c);
    await audit(g.kind === 'SERVICE' ? 'SERVICE_ACCEPTANCE_VERIFIED' : 'GRN_VERIFIED', { grn: id, code: g.code, po: g.poCode });
    await notify([...holders('pur'), ...holders('acc')].filter((x) => x !== by), { title: `${g.code} verified: ${g.supplierName}`, body: `${g.poCode} · ${g.lines.map((l) => `${l.desc.slice(0, 30)} ${q3(l.accepted)} ${l.uom}`).join(', ')}`, go: { view: 'stores', erp: id, erpKind: 'grn' } });
    return { ok: true };
  },
  /** inspection results recorded after verification (rejections reduce what is accepted, with the reason) */
  'grn.qc': async (a, { E, t, now, by, audit, cfg }) => {
    if (!E.has('sto.verify')) deny('Only a Stores verifier records inspection results.');
    const id = needId(a.id), g = await t.get(`erp_grn/${id}`);
    if (!g || g.status !== 'VERIFIED') bad('Inspection results are recorded on a verified receipt.');
    const reason = need(text(a.note, 500), 'Inspection notes');
    const lines = g.lines.map((l) => {
      const x = (a.lines || []).find((y) => y.poLineId === l.poLineId);
      if (!x) return l;
      const qc = oneOf(String(x.qc), QC.filter((q) => q !== 'PENDING'), `${l.desc}: inspection result`);
      const extra = x.rejected === '' || x.rejected == null ? 0 : toQty(x.rejected, `${l.desc}: rejected at inspection`, { allowZero: true });
      if (extra > l.accepted) bad(`${l.desc}: can’t reject more than was accepted.`);
      return { ...l, qc, accepted: l.accepted - extra, rejected: l.rejected + extra, qcBy: by, qcAt: now, remarks: [l.remarks, reason].filter(Boolean).join(' · ') };
    });
    await t.set(`erp_grn/${id}`, { ...g, lines, history: hist(g, by, now, 'Inspection recorded', reason) });
    for (const l of lines) { const before = g.lines.find((x) => x.poLineId === l.poLineId); if (l.itemId && before.accepted > l.accepted) await stockMove(t, { itemId: l.itemId, qty: l.accepted - before.accepted, type: 'QC_REJECT', ref: g.code, grnId: id, location: g.location, date: ymdIST(now), by, at: now, reason }); }
    await rematchPo(t, g.poId, await cfg());
    await audit('GRN_INSPECTION', { grn: id, code: g.code, lines: lines.map((l) => ({ desc: l.desc, qc: l.qc, accepted: l.accepted, rejected: l.rejected })), reason });
    return { ok: true };
  },
  /** corrections: a receipt is never edited — it is reversed (kept, with the reason) and recorded again */
  'grn.reverse': async (a, { E, t, now, by, audit, cfg }) => {
    const id = needId(a.id), g = await t.get(`erp_grn/${id}`);
    if (!g || g.status === 'REVERSED') bad('That receipt doesn’t exist or is already reversed.');
    if (!E.has('sto.verify') && !(g.kind === 'SERVICE' && E.has('pur.approve'))) deny('Only a Stores verifier reverses goods receipts.');
    const reason = need(text(a.note, 500), 'Reason for the reversal');
    await t.set(`erp_grn/${id}`, { ...g, status: 'REVERSED', reversedBy: by, reversedAt: now, reverseReason: reason, history: hist(g, by, now, 'Reversed', reason) });
    if (g.challanNo) await t.release(`erp_key/dc_${keyOf(g.supplierId, normRef(g.challanNo))}`);
    if (g.status === 'VERIFIED') for (const l of g.lines) if (l.itemId && l.accepted) await stockMove(t, { itemId: l.itemId, qty: -l.accepted, type: 'REVERSAL', ref: g.code, grnId: id, location: g.location, date: ymdIST(now), by, at: now, reason });
    await rematchPo(t, g.poId, await cfg());
    await audit('GRN_REVERSED', { grn: id, code: g.code, wasVerified: g.status === 'VERIFIED', reason });
    return { ok: true };
  },

  /* ── inventory ── */
  'item.save': async (a, { E, t, now, by, audit }) => {
    if (!E.has('sto') && !E.has('pur')) deny('Only Stores or Purchase manages items.');
    const old = a.id ? await t.get(`erp_item/${needId(a.id)}`) : null;
    const sku = need(str(a.sku, 40).toUpperCase(), 'Item code / SKU');
    const rec = { ...(old || {}), sku, name: need(str(a.name, 120), 'Item name'), category: str(a.category, 60), uom: need(str(a.uom, 12), 'Unit'), location: str(a.location, 80), reorder: a.reorder === '' || a.reorder == null ? 0 : toQty(a.reorder, 'Reorder level', { allowZero: true }), updatedAt: now };
    const id = a.id || newId();
    if (!old || old.sku !== sku) { if (!(await t.claim(`erp_key/sku_${keyOf(normRef(sku))}`, { id, at: now }))) conflict(`Item code ${sku} is already used.`); if (old) await t.release(`erp_key/sku_${keyOf(normRef(old.sku))}`); }
    if (!old) {
      Object.assign(rec, { code: await t.next('ITM'), createdBy: by, createdAt: now });
      const opening = a.opening === '' || a.opening == null ? 0 : toQty(a.opening, 'Opening stock', { allowZero: true });
      if (opening) await stockMove(t, { itemId: id, qty: opening, type: 'OPENING', ref: 'Opening stock', location: rec.location, date: ymdOf(a.openingDate || ymdIST(now), 'Opening date'), by, at: now });
    }
    await t.set(`erp_item/${id}`, rec);
    await audit(old ? 'ITEM_CHANGED' : 'ITEM_ADDED', { item: id, sku });
    return { id };
  },
  /** stock out (issue to a department / production) or an adjustment after a count — with a reason; never below zero */
  'stk.move': async (a, { E, t, now, by, audit }) => {
    const type = oneOf(String(a.type), ['OUT', 'ADJUST'], 'Movement');
    if (type === 'OUT' ? !E.has('sto') : !E.has('sto.verify')) deny(type === 'OUT' ? 'Only Stores issues stock.' : 'Only a Stores verifier adjusts stock after a count.');
    const itemId = needId(a.itemId, 'Item'), item = await t.get(`erp_item/${itemId}`);
    if (!item) bad('Pick an item.');
    const qtyAbs = toQty(a.qty, 'Quantity');
    const qty = type === 'OUT' ? -qtyAbs : a.direction === 'DOWN' ? -qtyAbs : qtyAbs;
    const cur = sum((await t.list('erp_stk')).filter((m) => m.data.itemId === itemId), (m) => m.data.qty);
    if (cur + qty < 0) bad(`Only ${q3(cur)} ${item.uom} of ${item.name} is in stock.`);
    const reason = type === 'ADJUST' ? need(text(a.reason, 300), 'Reason for the adjustment (e.g. physical count on …)') : text(a.reason, 300);
    await stockMove(t, { itemId, qty, type, ref: str(a.ref, 60) || (type === 'OUT' ? 'Issue' : 'Count adjustment'), toDept: str(a.toDept, 40) || null, location: item.location, date: ymdOf(a.date || ymdIST(now), 'Date'), by, at: now, reason });
    await audit(type === 'OUT' ? 'STOCK_ISSUED' : 'STOCK_ADJUSTED', { item: itemId, sku: item.sku, qty, reason });
    return { stock: cur + qty };
  },
};
registerErp(stores);
void isId;
