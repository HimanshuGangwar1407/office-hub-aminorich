// Purchase: suppliers (bank details restricted and verified), requisitions, purchase orders (versioned), advances,
// supplier invoices with duplicate detection, credit notes, advance adjustment, three-way matching and the payment
// eligibility checks. One source of truth with Accounts: a supplier payment is an erp_pay request linked to its
// invoice or PO — Purchase never keeps a separate payment record.
import { registerErp, registerErpHooks } from './erp.js';
import { approveLimit } from './erp-perms.js';
import { bad, deny, conflict, newId, toPaise, optPaise, toQty, lineAmount, pctOf, toBp, str, text, need, ymdOf, oneOf, isId, needId, normRef, normRef2, keyOf, ymdIST, addDays, daysBetween, filesFrom, inr, rupeeStr } from './erp-core.js';
import { paidOf } from './erp-forecast.js';

const DEAD = ['REJECTED', 'CANCELLED'];
const sum = (l, f = (x) => x) => l.reduce((s, x) => s + (f(x) || 0), 0);
const hist = (r, by, now, action, note = '') => [...(r.history || []), { at: now, by, action, note: note || undefined }];
const qtyTxt = (m) => (m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });

/* ═════════════ shared calculations (exported for the tests and the summary) ═════════════ */

/** the advance a PO's terms allow (paise) */
export const advanceAllowed = (po) => (po.advance?.amount != null ? po.advance.amount : po.advance?.pctBp ? pctOf(po.total, po.advance.pctBp) : 0);
/** advances on a PO: requested (open), paid, adjusted against invoices, and the unadjusted balance */
export function advancesOf(poId, pays, invs) {
  const adv = pays.filter((p) => p.data.poId === poId && p.data.category === 'ADVANCE' && !DEAD.includes(p.data.status));
  const paid = sum(adv, (p) => paidOf(p.data));
  const adjusted = sum(invs, (i) => sum((i.data.advanceAdj || []).filter((x) => adv.some((p) => p.id === x.payId)), (x) => x.amount));
  return { list: adv, requested: sum(adv, (p) => p.data.amountApproved ?? p.data.amountReq), paid, adjusted, unadjusted: paid - adjusted };
}
/** an invoice's liability and what has been settled against it — from linked records, never by matching amounts */
export function invoiceLiability(inv, invId, pays) {
  const credits = sum(inv.creditNotes || [], (c) => c.amount);
  const adjusted = sum(inv.advanceAdj || [], (x) => x.amount);
  const linked = pays.filter((p) => p.data.invoiceId === invId && !DEAD.includes(p.data.status));
  const paid = sum(linked, (p) => paidOf(p.data));
  const requestedOpen = sum(linked, (p) => Math.max(0, (p.data.amountApproved ?? p.data.amountReq) - paidOf(p.data)));
  const payable = inv.amount - credits - adjusted - paid;
  return { amount: inv.amount, credits, adjusted, paid, requestedOpen, payable, requestable: payable - requestedOpen, linked: linked.map((p) => p.data.code) };
}
/** ordered / received (accepted, verified GRNs) / invoiced quantities and values per PO line */
export function poProgress(po, grns, invs, invId = null) {
  return (po.lines || []).map((l) => {
    const rec = grns.filter((g) => g.data.poId === po.id && g.data.status === 'VERIFIED').flatMap((g) => g.data.lines).filter((x) => x.poLineId === l.id);
    const inv = invs.filter((i) => i.data.poId === po.id && i.id !== invId && !['CANCELLED'].includes(i.data.status)).flatMap((i) => i.data.lines || []).filter((x) => x.poLineId === l.id);
    return { ...l, accepted: sum(rec, (x) => x.accepted), rejected: sum(rec, (x) => x.rejected), invoiced: sum(inv, (x) => x.qty) };
  });
}

/**
 * Three-way match of an invoice against its PO and the verified goods receipts. Returns issues; tolerances come from
 * Finance setup. Matching totals alone never makes an invoice payable — receipt, duplicates and approvals are separate checks.
 */
export function matchInvoice(inv, invId, po, grns, invs, cfg) {
  const issues = [];
  if (!po) return { ok: !inv.poId, issues: inv.poId ? ['The purchase order isn’t available.'] : [] };
  if (po.supplierId !== inv.supplierId) issues.push('The invoice is from a different supplier than the purchase order.');
  const prog = poProgress(po, grns, invs, invId), tolQ = cfg.qtyTolBp || 0, tolR = cfg.rateTolBp || 0;
  let lineTotal = 0, taxTotal = 0;
  for (const x of inv.lines || []) {
    const l = prog.find((p) => p.id === x.poLineId);
    if (!l) { issues.push('An invoice line isn’t on the purchase order.'); continue; }
    const name = l.desc.slice(0, 40);
    const allowQ = (q) => q + Math.floor((q * tolQ) / 10000);
    if (l.invoiced + x.qty > allowQ(l.qty)) issues.push(`${name}: invoiced ${qtyTxt(l.invoiced + x.qty)} ${l.uom}, ordered ${qtyTxt(l.qty)}.`);
    if (po.kind !== 'SERVICES' && cfg.grnRequired !== false && l.invoiced + x.qty > allowQ(l.accepted)) issues.push(`${name}: invoiced ${qtyTxt(l.invoiced + x.qty)} ${l.uom}, accepted at stores ${qtyTxt(l.accepted)}.`);
    if (po.kind === 'SERVICES' && l.invoiced + x.qty > allowQ(l.accepted)) issues.push(`${name}: invoiced beyond the accepted work (${qtyTxt(l.accepted)} ${l.uom}).`);
    if (Math.abs(x.rate - l.rate) > Math.floor((l.rate * tolR) / 10000)) issues.push(`${name}: rate ${inr(x.rate)} vs ${inr(l.rate)} on the PO.`);
    if ((x.taxBp ?? l.taxBp) !== l.taxBp) issues.push(`${name}: tax ${(x.taxBp ?? 0) / 100}% vs ${l.taxBp / 100}% on the PO.`);
    lineTotal += lineAmount(x.rate, x.qty); taxTotal += pctOf(lineAmount(x.rate, x.qty), x.taxBp ?? l.taxBp);
  }
  if ((inv.lines || []).length) {
    const expect = lineTotal + taxTotal + (inv.charges || 0);
    if (Math.abs(expect - inv.amount) > (cfg.roundTol ?? 100)) issues.push(`Invoice total ${inr(inv.amount)} doesn’t match its lines (${inr(expect)}).`);
  }
  const otherInv = sum(invs.filter((i) => i.data.poId === po.id && i.id !== invId && i.data.status !== 'CANCELLED'), (i) => i.data.amount - sum(i.data.creditNotes || [], (c) => c.amount));
  if (otherInv + inv.amount - sum(inv.creditNotes || [], (c) => c.amount) > po.total + (cfg.roundTol ?? 100) + Math.floor((po.total * tolR) / 10000)) issues.push(`Invoices on this PO total ${inr(otherInv + inv.amount)}, more than the PO value ${inr(po.total)}.`);
  return { ok: !issues.length, issues };
}

/** the ten eligibility checks for a supplier payment (labels shown to verifier and approver) */
export async function paymentChecks(p, t, cfg) {
  if (!['SUPPLIER', 'ADVANCE'].includes(p.category) || (!p.poId && !p.invoiceId && !p.supplierId)) return null;
  const C = [];
  const add = (k, ok, label, detail = '', blocking = true) => C.push({ k, ok: !!ok, label, detail, blocking: blocking && !ok });
  const po = p.poId ? await t.get(`erp_po/${p.poId}`) : null;
  const inv = p.invoiceId ? await t.get(`erp_inv/${p.invoiceId}`) : null;
  const [pays, invs, grns] = await Promise.all(['erp_pay', 'erp_inv', 'erp_grn'].map((c) => t.list(c)));
  if (p.poId) add('po', po && ['APPROVED', 'CLOSED'].includes(po.status), 'Purchase order approved', po ? `${po.code} is ${po.status.toLowerCase()}` : 'PO not found');
  if (p.category === 'ADVANCE') {
    if (!p.poId) add('po', false, 'Linked to a purchase order', 'An advance must be against a PO');
    else {
      // each advance is checked against those raised before it: the one that goes over the terms carries the exception
      const before = (x) => x.id !== p.id && ((x.data.createdAt || 0) < (p.createdAt || 0) || ((x.data.createdAt || 0) === (p.createdAt || 0) && String(x.data.code) < String(p.code)));
      const a = advancesOf(p.poId, pays.filter(before), invs), allow = advanceAllowed(po);
      add('terms', a.requested + p.amountReq <= allow, 'Allowed by the PO’s advance terms', `${inr(a.requested + p.amountReq)} of ${inr(allow)} allowed`);
      add('dup', !p.dupOverride, 'No duplicate warning', p.dupOverride ? `raised despite ${p.dupOverride.of.join(', ')}` : '');
    }
    return C;
  }
  add('inv', !!inv, 'Linked to a supplier invoice', inv ? `${inv.invoiceNo}` : 'Supplier payments are made against an invoice (use an advance for payment before invoicing)');
  if (!inv) return C;
  add('invok', inv.status === 'VERIFIED' && inv.supplierId === p.supplierId, 'Invoice verified and from this supplier', inv.status === 'VERIFIED' ? '' : `invoice is ${inv.status.toLowerCase().replace(/_/g, ' ')}`);
  const pr = po ? poProgress({ ...po, id: p.poId }, grns, invs) : [];
  const goods = po && po.kind !== 'SERVICES';
  const myLines = (inv.lines || []).map((x) => ({ x, l: pr.find((l) => l.id === x.poLineId) }));
  const recvOk = !po || (cfg.grnRequired === false && goods) || myLines.every(({ x, l }) => l && l.accepted >= l.invoiced + 0 && l.accepted > 0);
  const anyGrn = po && grns.some((g) => g.data.poId === p.poId);
  add('received', recvOk, goods ? 'Material received' : 'Work / service accepted', recvOk ? '' : anyGrn ? 'not all invoiced items are accepted on a verified goods receipt' : 'no goods receipt yet');
  const pendingVerify = po && grns.some((g) => g.data.poId === p.poId && g.data.status === 'RECORDED');
  add('verified', !pendingVerify, 'Received quantities verified', pendingVerify ? 'a goods receipt is waiting for verification' : '', !!pendingVerify && !recvOk);
  const qcPending = po && grns.some((g) => g.data.poId === p.poId && g.data.status === 'VERIFIED' && (g.data.lines || []).some((x) => x.qc === 'PENDING'));
  add('qc', !qcPending, 'Quality inspection complete', qcPending ? 'inspection pending' : '');
  const adv = po ? advancesOf(p.poId, pays, invs) : { unadjusted: 0 };
  add('advance', adv.unadjusted <= 0, 'Advances adjusted', adv.unadjusted > 0 ? `${inr(adv.unadjusted)} advance on this PO not yet adjusted against an invoice` : '');
  const L = invoiceLiability(inv, p.invoiceId, pays.filter((x) => x.id !== p.id));
  const amt = p.amountApproved ?? p.amountReq;
  add('liability', amt <= L.requestable, 'Within the remaining payable (after payments, credit notes and advances)', `payable ${inr(L.payable)}, already requested ${inr(L.requestedOpen)}, this ${inr(amt)}`);
  add('terms', !inv.due || p.proposedDate == null || p.proposedDate >= addDays(inv.date, 0), 'Permitted by the payment terms', inv.due ? `invoice due ${inv.due}` : '', false);
  add('match', inv.match?.ok || !!inv.match?.accepted, 'PO / invoice / goods receipt match', inv.match?.ok ? '' : inv.match?.accepted ? `differences accepted by ${inv.match.accepted.byName || 'an approver'}` : (inv.match?.issues || []).join(' '));
  add('dup', !p.dupOverride && !inv.dupOverride, 'No duplicate invoice or payment warning', p.dupOverride || inv.dupOverride ? 'raised despite a duplicate warning' : '');
  return C;
}

/* ═════════════ commands ═════════════ */
async function supplierOf(t, id) { const s = await t.get(`erp_sup/${needId(id, 'Supplier')}`); if (!s) bad('Pick a supplier.'); return s; }
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const purchase = {
  /* ── suppliers ── */
  'sup.save': async (a, { E, need: needP, t, now, by, audit }) => {
    needP('pur', 'Only Purchase manages suppliers.');
    const old = a.id ? await t.get(`erp_sup/${needId(a.id)}`) : null;
    if (a.id && !old) bad('That supplier no longer exists.');
    const gstin = str(a.gstin, 15).toUpperCase();
    if (gstin && !GSTIN.test(gstin)) bad('GSTIN doesn’t look right (15 characters, e.g. 27AAACA1234F1Z5).');
    const rec = { ...(old || {}), name: need(str(a.name, 120), 'Supplier name'), contact: str(a.contact, 120), phone: str(a.phone, 30), email: str(a.email, 120).toLowerCase(), address: text(a.address, 400), gstin, pan: str(a.pan, 10).toUpperCase(), terms: str(a.terms, 200), msme: !!a.msme, note: text(a.note, 800), updatedAt: now, files: [...(old?.files || []), ...(await filesFrom(a.files, t, by, now))] };
    const id = a.id || newId();
    if (!old) {
      const key = gstin ? `erp_key/sup_${keyOf('gst', gstin)}` : `erp_key/sup_${keyOf('name', normRef(rec.name))}`;
      if (!(await t.claim(key, { id, at: now }))) conflict(gstin ? `A supplier with GSTIN ${gstin} already exists.` : `A supplier called ${rec.name} already exists.`);
      Object.assign(rec, { code: await t.next('SUP'), status: 'PENDING', createdBy: by, createdAt: now });
    }
    await t.set(`erp_sup/${id}`, rec);
    await audit(old ? 'SUPPLIER_CHANGED' : 'SUPPLIER_ADDED', { sup: id, code: rec.code, name: rec.name });
    void E;
    return { id, code: rec.code };
  },
  'sup.approve': async (a, { E, t, now, by, audit }) => {
    if (!E.has('pur.approve')) deny('Only a purchase approver can approve suppliers.');
    const id = needId(a.id), s = await supplierOf(t, id);
    if (s.createdBy === by) deny('Someone other than the person who added the supplier must approve it.');
    const status = oneOf(String(a.status || 'APPROVED'), ['APPROVED', 'BLOCKED'], 'Status');
    await t.set(`erp_sup/${id}`, { ...s, status, approvedBy: by, approvedAt: now, ...(status === 'BLOCKED' ? { blockedReason: need(text(a.reason, 300), 'Reason') } : {}) });
    await audit(status === 'APPROVED' ? 'SUPPLIER_APPROVED' : 'SUPPLIER_BLOCKED', { sup: id, code: s.code });
    return { status };
  },
  /** supplier bank details: proposed by Purchase or Accounts, live only after someone else in Accounts verifies them */
  'sup.bank': async (a, { E, t, now, by, audit, notify, holders }) => {
    if (!E.has('pur') && !E.has('acc')) deny('You can’t change supplier bank details.');
    const id = needId(a.id), s = await supplierOf(t, id);
    const acct = String(a.account || '').replace(/\s/g, ''), ifsc = String(a.ifsc || '').toUpperCase().trim();
    if (!/^\d{6,18}$/.test(acct)) bad('Account number: 6 to 18 digits.');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) bad('IFSC doesn’t look right (e.g. HDFC0001234).');
    const cur = (await t.get(`erp_supbank/${id}`)) || {};
    const proposal = { holder: need(str(a.holder, 120), 'Account holder name'), bank: need(str(a.bank, 80), 'Bank'), account: acct, ifsc, last4: acct.slice(-4), proposedBy: by, proposedAt: now, files: await filesFrom(a.files, t, by, now), reason: text(a.reason, 300) };
    if (!proposal.files.length) bad('Attach a cancelled cheque or the supplier’s bank letter as evidence.');
    await t.set(`erp_supbank/${id}`, { ...cur, pending: proposal });
    await t.set(`erp_sup/${id}`, { ...s, bankPending: true, bankLast4: s.bankLast4 || null, updatedAt: now });
    await audit('SUPPLIER_BANK_CHANGE_PROPOSED', { sup: id, code: s.code, last4: proposal.last4 });
    await notify(holders('acc').filter((x) => x !== by), { title: `Verify bank details: ${s.name}`, body: `New account ending ${proposal.last4} — check the evidence and call the supplier on a known number before approving.`, go: { view: 'purchase', erp: id, erpKind: 'sup' } });
    return { ok: true };
  },
  'sup.bankVerify': async (a, { E, t, now, by, audit }) => {
    if (!E.has('acc')) deny('Only Accounts verifies supplier bank details.');
    const id = needId(a.id), s = await supplierOf(t, id), b = await t.get(`erp_supbank/${id}`);
    if (!b?.pending) bad('There is no bank change waiting.');
    if (b.pending.proposedBy === by) deny('Someone other than the person who entered the new details must verify them.');
    if (a.reject) {
      await t.set(`erp_supbank/${id}`, { ...b, pending: null, rejected: [...(b.rejected || []), { ...b.pending, rejectedBy: by, at: now, reason: need(text(a.reason, 300), 'Reason') }] });
      await t.set(`erp_sup/${id}`, { ...s, bankPending: false, updatedAt: now });
      await audit('SUPPLIER_BANK_CHANGE_REJECTED', { sup: id, code: s.code, reason: text(a.reason, 300) });
      return { ok: true };
    }
    const how = need(text(a.how, 300), 'How you verified it (e.g. called the supplier’s known number)');
    const live = { ...b.pending, verifiedBy: by, verifiedAt: now, how };
    await t.set(`erp_supbank/${id}`, { ...live, pending: null, history: [...(b.history || []), ...(b.account ? [{ account: b.account, ifsc: b.ifsc, last4: b.last4, until: now }] : [])] });
    await t.set(`erp_sup/${id}`, { ...s, bankPending: false, bankLast4: live.last4, updatedAt: now });
    await audit('SUPPLIER_BANK_CHANGED', { sup: id, code: s.code, from: b.last4 || null, to: live.last4, proposedBy: live.proposedBy, verifiedBy: by });
    return { ok: true };
  },

  /* ── requisitions ── */
  'pr.save': async (a, { E, ctx, t, now, by, me, audit, notify, holders }) => {
    if (!me) deny('Your account isn’t linked to an employee.');
    const old = a.id ? await t.get(`erp_pr/${needId(a.id)}`) : null;
    if (old && (old.requestedBy !== by || !['DRAFT', 'SUBMITTED'].includes(old.status))) deny('Only the requester can change a requisition before it is approved.');
    const items = (Array.isArray(a.items) ? a.items : []).slice(0, 50).map((x, k) => ({ desc: need(str(x.desc, 200), `Item ${k + 1}: description`), qty: toQty(x.qty, `Item ${k + 1}: quantity`), uom: str(x.uom || 'Nos', 12), estRate: optPaise(x.estRate, `Item ${k + 1}: estimated price`) ?? 0 }));
    if (!items.length) bad('Add at least one item or service.');
    const rec = {
      ...(old || {}), deptId: me.deptId || null, items, estTotal: sum(items, (x) => lineAmount(x.estRate, x.qty)),
      justification: need(text(a.justification, 1000), 'Business justification'), needBy: ymdOf(a.needBy, 'Required by'), costCentre: str(a.costCentre, 60),
      files: [...(old?.files || []), ...(await filesFrom(a.files, t, by, now))], updatedAt: now,
    };
    // approved by the requester's manager or department head, or a purchase approver — never the requester
    const head = (ctx.depts || []).find((d) => d.id === me.deptId)?.headId;
    rec.approverId = [me.managerId, head].find((x) => x && x !== by && ctx.emps.get(x)?.active !== false) || null;
    const id = a.id || newId();
    if (!old) Object.assign(rec, { code: await t.next('PR'), requestedBy: by, createdAt: now, history: [] });
    rec.status = a.submit === false ? 'DRAFT' : 'SUBMITTED';
    rec.history = hist(rec, by, now, rec.status === 'DRAFT' ? 'Drafted' : 'Submitted');
    await t.set(`erp_pr/${id}`, rec);
    await audit('REQUISITION_' + (old ? 'CHANGED' : 'RAISED'), { pr: id, code: rec.code, est: rec.estTotal });
    if (rec.status === 'SUBMITTED') await notify([rec.approverId, ...holders('pur.approve')].filter((x) => x && x !== by), { title: `Requisition ${rec.code} to approve`, body: `${nameOrId(ctx, by)} · ${items[0].desc}${items.length > 1 ? ` +${items.length - 1}` : ''} · est. ${inr(rec.estTotal)}`, go: { view: 'purchase', erp: id, erpKind: 'pr' } });
    void E;
    return { id, code: rec.code };
  },
  'pr.act': async (a, { E, t, now, by, me, audit, notify }) => {
    const id = needId(a.id), r = await t.get(`erp_pr/${id}`);
    if (!r) bad('That requisition no longer exists.');
    const approver = (E.has('pur.approve') && r.estTotal <= approveLimit(me, 'pur')) || r.approverId === by;
    if (!E.has('pur') && !approver && r.requestedBy !== by) deny('You don’t have access to this requisition.');
    const next = { ...r, updatedAt: now };
    switch (String(a.action)) {
      case 'approve': case 'reject':
        if (r.status !== 'SUBMITTED') bad('Only a submitted requisition can be decided.');
        if (r.requestedBy === by) deny('You can’t approve your own requisition.');
        if (!approver) deny(E.has('pur.approve') ? `This is above your approval limit of ${inr(approveLimit(me, 'pur'))}.` : 'Only the requester’s manager, department head or a purchase approver decides this.');
        next.status = a.action === 'approve' ? 'APPROVED' : 'REJECTED'; next.decidedBy = by; next.decidedAt = now;
        next.history = hist(r, by, now, a.action === 'approve' ? 'Approved' : 'Rejected', a.action === 'reject' ? need(text(a.note, 500), 'Reason') : text(a.note, 500));
        await notify([r.requestedBy], { title: `${a.action === 'approve' ? 'Approved' : 'Rejected'}: ${r.code}`, body: text(a.note, 200), go: { view: 'purchase', erp: id, erpKind: 'pr' } });
        break;
      case 'cancel':
        if (r.requestedBy !== by && !E.has('pur')) deny('Only the requester or Purchase can cancel a requisition.');
        if (['ORDERED', 'CANCELLED', 'REJECTED'].includes(r.status)) bad('This requisition can’t be cancelled now.');
        next.status = 'CANCELLED'; next.history = hist(r, by, now, 'Cancelled', need(text(a.note, 500), 'Reason')); break;
      case 'submit': if (r.requestedBy !== by || r.status !== 'DRAFT') bad('Only a draft can be submitted, by its requester.'); next.status = 'SUBMITTED'; next.history = hist(r, by, now, 'Submitted'); break;
      default: bad('Unknown action.');
    }
    await t.set(`erp_pr/${id}`, next);
    await audit(`REQUISITION_${next.status}`, { pr: id, code: r.code });
    return { status: next.status };
  },

  /* ── purchase orders ── */
  'po.save': async (a, { need: needP, t, now, by, audit, notify, holders }) => {
    needP('pur', 'Only Purchase raises purchase orders.');
    const old = a.id ? await t.get(`erp_po/${needId(a.id)}`) : null;
    if (old && !['DRAFT', 'SUBMITTED', 'REJECTED'].includes(old.status)) bad('An approved PO changes only through a revision (with a reason).');
    const po = await poFrom(a, t, old, by, now);
    const id = a.id || newId();
    if (!old) Object.assign(po, { code: await t.next('PO'), createdBy: by, createdAt: now, version: 1, versions: [], history: [] });
    po.status = a.submit === false ? 'DRAFT' : 'SUBMITTED';
    po.history = hist(po, by, now, po.status === 'DRAFT' ? 'Drafted' : 'Submitted for approval');
    if (po.prId) {
      const pr = await t.get(`erp_pr/${po.prId}`);
      if (!pr || !['APPROVED', 'ORDERED'].includes(pr.status)) bad('The linked requisition isn’t approved.');
      await t.set(`erp_pr/${po.prId}`, { ...pr, status: 'ORDERED', poId: id, updatedAt: now });
    }
    await t.set(`erp_po/${id}`, po);
    await audit(old ? 'PO_CHANGED' : 'PO_CREATED', { po: id, code: po.code, supplier: po.supplierId, total: po.total });
    if (po.status === 'SUBMITTED') await notify(holders('pur.approve').filter((x) => x !== by), { title: `Purchase order ${po.code} to approve`, body: `${po.supplierName} · ${inr(po.total)}`, go: { view: 'purchase', erp: id, erpKind: 'po' } });
    return { id, code: po.code };
  },
  /** after approval, material changes are a new version (kept with the reason) and need approval again */
  'po.revise': async (a, { need: needP, t, now, by, audit, notify, holders }) => {
    needP('pur', 'Only Purchase revises purchase orders.');
    const id = needId(a.id), old = await t.get(`erp_po/${id}`);
    if (!old || !['APPROVED'].includes(old.status)) bad('Only an approved, open PO can be revised.');
    const reason = need(text(a.reason, 500), 'Reason for the revision');
    const po = await poFrom({ ...a, supplierId: old.supplierId }, t, old, by, now);
    const [grns, invs] = await Promise.all([t.list('erp_grn'), t.list('erp_inv')]);
    const prog = poProgress({ ...old, id }, grns, invs);
    for (const l of prog) {
      const nl = po.lines.find((x) => x.id === l.id);
      if ((l.accepted || l.invoiced) && (!nl || nl.qty < Math.max(l.accepted, l.invoiced))) bad(`${l.desc}: can’t go below what is already received or invoiced (${qtyTxt(Math.max(l.accepted, l.invoiced))} ${l.uom}).`);
    }
    const snap = { v: old.version, at: now, by, reason, lines: old.lines, total: old.total, advance: old.advance, expectedDate: old.expectedDate, terms: old.terms };
    await t.set(`erp_po/${id}`, { ...po, code: old.code, createdBy: old.createdBy, createdAt: old.createdAt, version: old.version + 1, versions: [...(old.versions || []), snap], status: 'SUBMITTED', approvedBy: null, history: hist(old, by, now, `Revised to version ${old.version + 1}`, reason) });
    await audit('PO_REVISED', { po: id, code: old.code, version: old.version + 1, from: old.total, to: po.total, reason });
    await notify(holders('pur.approve').filter((x) => x !== by), { title: `Revised ${old.code} to approve`, body: `${inr(old.total)} → ${inr(po.total)} · ${reason}`, go: { view: 'purchase', erp: id, erpKind: 'po' } });
    return { version: old.version + 1 };
  },
  'po.act': async (a, { E, t, now, by, me, audit, notify }) => {
    const id = needId(a.id), po = await t.get(`erp_po/${id}`);
    if (!po) bad('That purchase order no longer exists.');
    if (!E.has('pur') && !E.has('acc') && !E.has('sto')) deny('You don’t have access to purchase orders.');
    const next = { ...po, updatedAt: now };
    switch (String(a.action)) {
      case 'approve': case 'reject': {
        if (po.status !== 'SUBMITTED') bad('Only a PO waiting for approval can be decided.');
        if (!E.has('pur.approve')) deny('You don’t have purchase approval permission.');
        if (po.createdBy === by || (po.versions || []).some((v) => v.by === by && v.v === po.version - 1)) deny('You can’t approve a purchase order you raised or revised.');
        if (a.action === 'approve') {
          const lim = approveLimit(me, 'pur'); if (po.total > lim) deny(`This is above your approval limit of ${inr(lim)}.`);
          const sup = await t.get(`erp_sup/${po.supplierId}`); if (sup?.status !== 'APPROVED') bad(`${po.supplierName} isn’t an approved supplier yet.`);
        }
        next.status = a.action === 'approve' ? 'APPROVED' : 'REJECTED'; next.approvedBy = a.action === 'approve' ? by : null; next.approvedAt = now;
        next.history = hist(po, by, now, a.action === 'approve' ? `Approved (version ${po.version})` : 'Rejected', a.action === 'reject' ? need(text(a.note, 500), 'Reason') : text(a.note, 500));
        await notify([po.createdBy], { title: `${a.action === 'approve' ? 'Approved' : 'Rejected'}: ${po.code}`, body: `${po.supplierName} · ${inr(po.total)}`, go: { view: 'purchase', erp: id, erpKind: 'po' } });
        break;
      }
      case 'cancel': {
        if (!E.has('pur')) deny('Only Purchase cancels purchase orders.');
        const [grns, invs, pays] = await Promise.all([t.list('erp_grn'), t.list('erp_inv'), t.list('erp_pay')]);
        if (grns.some((g) => g.data.poId === id && g.data.status !== 'REVERSED') || invs.some((i) => i.data.poId === id && i.data.status !== 'CANCELLED') || pays.some((p) => p.data.poId === id && !DEAD.includes(p.data.status))) bad('Goods, invoices or payments exist against this PO — close it instead.');
        next.status = 'CANCELLED'; next.history = hist(po, by, now, 'Cancelled', need(text(a.note, 500), 'Reason')); break;
      }
      case 'close': if (!E.has('pur')) deny('Only Purchase closes purchase orders.'); if (po.status !== 'APPROVED') bad('Only an approved PO can be closed.'); next.status = 'CLOSED'; next.history = hist(po, by, now, 'Closed (no more deliveries expected)', need(text(a.note, 500), 'Reason')); break;
      case 'submit': if (po.status !== 'DRAFT' || po.createdBy !== by) bad('Only a draft can be submitted, by whoever raised it.'); next.status = 'SUBMITTED'; next.history = hist(po, by, now, 'Submitted for approval'); break;
      default: bad('Unknown action.');
    }
    await t.set(`erp_po/${id}`, next);
    await audit(`PO_${next.status}`, { po: id, code: po.code, total: po.total });
    return { status: next.status };
  },
  /** an advance against a PO: a payment request (category ADVANCE) that Accounts verifies, approves and pays */
  'po.advance': async (a, env) => {
    const { need: needP, t } = env;
    needP('pur', 'Only Purchase raises advance requests.');
    const id = needId(a.id), po = await t.get(`erp_po/${id}`);
    if (!po || po.status !== 'APPROVED') bad('Advances are only against an approved, open PO.');
    return env.run('pay.create', { category: 'ADVANCE', payee: po.supplierName, supplierId: po.supplierId, poId: id, invoiceRef: '', amount: a.amount, due: a.due, proposedDate: a.due, priority: a.priority || 'NORMAL', note: text(a.note, 1000) || `Advance against ${po.code}`, files: a.files, clientKey: a.clientKey, override: a.override });
  },

  /* ── supplier invoices ── */
  /** before saving: the records this invoice could duplicate (shown to the person entering it) */
  'inv.check': async (a, { E, t }) => {
    if (!E.has('pur') && !E.has('acc')) deny('You can’t see supplier invoices.');
    return { matches: await invoiceMatches(t, a, a.id || null) };
  },
  'inv.save': async (a, { E, t, now, by, audit, cfg, notify, holders }) => {
    if (!E.has('pur') && !E.has('acc')) deny('Only Purchase or Accounts records supplier invoices.');
    const old = a.id ? await t.get(`erp_inv/${needId(a.id)}`) : null;
    if (old && !['RECEIVED', 'DISCREPANCY'].includes(old.status)) bad('A verified invoice can’t be edited. Add a credit note, or cancel it with a reason.');
    const sup = await supplierOf(t, a.supplierId);
    const po = a.poId ? await t.get(`erp_po/${needId(a.poId, 'Purchase order')}`) : null;
    if (a.poId && (!po || !['APPROVED', 'CLOSED'].includes(po.status))) bad('The purchase order isn’t approved.');
    if (po && po.supplierId !== a.supplierId) bad('The purchase order is for a different supplier.');
    const invoiceNo = need(str(a.invoiceNo, 40), 'Invoice number'), normNo = normRef(invoiceNo), normNo2 = normRef2(invoiceNo);
    if (normNo.length < 1) bad('Invoice number needs letters or digits.');
    const lines = po ? (Array.isArray(a.lines) ? a.lines : []).filter((x) => x && x.qty !== '' && x.qty != null && Number(String(x.qty).replace(/,/g, '')) !== 0).map((x, k) => {
      const pl = po.lines.find((l) => l.id === x.poLineId);
      if (!pl) bad(`Line ${k + 1} isn’t on the purchase order.`);
      return { poLineId: pl.id, desc: pl.desc, uom: pl.uom, qty: toQty(x.qty, `${pl.desc}: quantity`), rate: toPaise(x.rate ?? rupeeStr(pl.rate), `${pl.desc}: rate`, { allowZero: false }), taxBp: x.taxBp != null && x.taxBp !== '' ? toBp(x.taxBp, `${pl.desc}: tax`) : pl.taxBp };
    }) : [];
    if (po && !lines.length) bad('Enter the quantity invoiced for at least one PO line.');
    const rec = {
      ...(old || {}), supplierId: a.supplierId, supplierName: sup.name, invoiceNo, normNo, normNo2, date: ymdOf(a.date, 'Invoice date'), due: ymdOf(a.due, 'Due date', { optional: true }),
      amount: toPaise(a.amount, 'Invoice total (including tax)', { allowZero: false }), tax: optPaise(a.tax, 'Tax amount') ?? 0, charges: optPaise(a.charges, 'Other charges') ?? 0,
      poId: a.poId || null, poCode: po?.code || null, lines, tallyRef: str(a.tallyRef, 60), note: text(a.note, 800),
      files: [...(old?.files || []), ...(await filesFrom(a.files, t, by, now))], updatedAt: now,
    };
    if (rec.date > ymdIST(now)) bad('The invoice date can’t be in the future.');
    if (!rec.files.length) bad('Attach the supplier’s invoice.');
    const id = a.id || newId();
    // exact duplicate: same supplier and the same invoice number however it is written — blocked unless overridden
    // two keys per number (with and without zero-padding inside it); either one taken by a live invoice = duplicate.
    // Every ERP change holds the same lock (server/db.js withTx), so looking first and then taking is safe.
    const keys = invKeys(a.supplierId, invoiceNo);
    if (!old || old.normNo !== normNo || old.supplierId !== a.supplierId) {
      let prev = null;
      for (const k of keys) { const cur = await t.get(k); if (cur?.id && cur.id !== id) { const p = await t.get(`erp_inv/${cur.id}`); if (p && p.status !== 'CANCELLED') { prev = p; break; } } }
      if (prev) {
        const reason = text(a.override?.reason, 500);
        if (!reason) conflict(`Duplicate invoice: ${sup.name} invoice ${prev.invoiceNo} is already recorded as ${prev.code} (${inr(prev.amount)}, ${prev.date}).`);
        if (!E.has('pur.approve') && !E.has('acc.approve')) deny('Only an approver can record a duplicate invoice number, with a reason.');
        if (reason.length < 10) bad('Explain why this isn’t a duplicate, in a full sentence.');
        rec.dupOverride = { by, at: now, reason, of: [prev.code] };
      } else for (const k of keys) await t.set(k, { id, at: now });
      if (old) for (const k of invKeys(old.supplierId, old.invoiceNo)) if (!keys.includes(k)) await t.release(k);
    }
    rec.warnings = (await invoiceMatches(t, rec, id)).filter((m) => m.kind !== 'EXACT').map((m) => `${m.code}: ${m.why}`);
    if (!old) Object.assign(rec, { code: await t.next('INV'), createdBy: by, createdAt: now, creditNotes: [], advanceAdj: [], history: [] });
    const [grns, invs] = await Promise.all([t.list('erp_grn'), t.list('erp_inv')]);
    rec.match = po ? matchInvoice(rec, id, { ...po, id: rec.poId }, grns, invs, await cfg()) : { ok: true, issues: [] };
    rec.status = rec.match.ok ? 'RECEIVED' : 'DISCREPANCY';
    rec.history = hist(rec, by, now, old ? 'Edited' : 'Recorded', rec.match.ok ? '' : rec.match.issues.join(' '));
    await t.set(`erp_inv/${id}`, rec);
    await audit(old ? 'INVOICE_CHANGED' : 'INVOICE_RECORDED', { inv: id, code: rec.code, supplier: a.supplierId, invoiceNo, amount: rec.amount, ...(rec.dupOverride ? { duplicateOverride: rec.dupOverride } : {}) });
    if (rec.dupOverride) await audit('DUPLICATE_OVERRIDE', { inv: id, code: rec.code, of: rec.dupOverride.of, reason: rec.dupOverride.reason });
    await notify(holders('acc').filter((x) => x !== by), { title: `Invoice ${rec.code} to verify`, body: `${sup.name} ${invoiceNo} · ${inr(rec.amount)}${rec.match.ok ? '' : ' · has discrepancies'}`, go: { view: 'purchase', erp: id, erpKind: 'inv' } });
    return { id, code: rec.code, status: rec.status, warnings: rec.warnings, issues: rec.match.issues };
  },
  'inv.act': async (a, env) => {
    const { E, t, now, by, audit, cfg, ctx } = env;
    const id = needId(a.id), inv = await t.get(`erp_inv/${id}`);
    if (!inv) bad('That invoice no longer exists.');
    if (!E.has('pur') && !E.has('acc')) deny('You don’t have access to supplier invoices.');
    const next = { ...inv, updatedAt: now };
    const pays = await t.list('erp_pay');
    switch (String(a.action)) {
      case 'rematch': {
        // after a goods receipt or a PO revision
        const po = inv.poId ? await t.get(`erp_po/${inv.poId}`) : null;
        const [grns, invs] = await Promise.all([t.list('erp_grn'), t.list('erp_inv')]);
        next.match = po ? { ...matchInvoice(inv, id, { ...po, id: inv.poId }, grns, invs, await cfg()), accepted: null } : { ok: true, issues: [] };
        if (['RECEIVED', 'DISCREPANCY'].includes(inv.status)) next.status = next.match.ok ? 'RECEIVED' : 'DISCREPANCY';
        next.history = hist(inv, by, now, 'Matched again', next.match.issues.join(' '));
        break;
      }
      case 'accept': {
        // differences reviewed and accepted (e.g. within a negotiated rate), by an approver — recorded with the reason
        if (!E.has('pur.approve') && !E.has('acc.approve')) deny('Only an approver can accept invoice differences.');
        if (inv.status !== 'DISCREPANCY') bad('There are no differences to accept.');
        if (inv.createdBy === by) deny('Someone other than the person who entered the invoice must accept its differences.');
        const reason = need(text(a.note, 500), 'Why the differences are acceptable');
        next.match = { ...inv.match, accepted: { by, byName: ctx.emps.get(by)?.name || '', at: now, reason } };
        next.status = 'RECEIVED'; next.history = hist(inv, by, now, 'Differences accepted', reason);
        await audit('INVOICE_DISCREPANCY_ACCEPTED', { inv: id, code: inv.code, issues: inv.match.issues, reason });
        break;
      }
      case 'verify':
        if (!E.has('acc')) deny('Accounts verifies supplier invoices.');
        if (inv.status !== 'RECEIVED') bad(inv.status === 'DISCREPANCY' ? 'Resolve the PO / goods receipt differences first.' : 'This invoice can’t be verified now.');
        if (inv.createdBy === by) deny('Someone other than the person who entered the invoice must verify it.');
        next.status = 'VERIFIED'; next.verifiedBy = by; next.verifiedAt = now; next.history = hist(inv, by, now, 'Verified', text(a.note, 500));
        break;
      case 'dispute': next.status = 'DISPUTED'; next.history = hist(inv, by, now, 'Disputed', need(text(a.note, 500), 'Reason')); break;
      case 'undispute': if (inv.status !== 'DISPUTED') bad('This invoice isn’t disputed.'); next.status = inv.match?.ok || inv.match?.accepted ? 'RECEIVED' : 'DISCREPANCY'; next.history = hist(inv, by, now, 'Dispute resolved', text(a.note, 500)); break;
      case 'cancel': {
        if (pays.some((p) => p.data.invoiceId === id && !DEAD.includes(p.data.status))) bad('Payment requests exist for this invoice. Cancel them first.');
        if ((inv.advanceAdj || []).length) bad('Advances were adjusted against this invoice. Remove the adjustments first.');
        next.status = 'CANCELLED'; next.history = hist(inv, by, now, 'Cancelled', need(text(a.note, 500), 'Reason'));
        for (const k of invKeys(inv.supplierId, inv.invoiceNo)) { const cur = await t.get(k); if (cur?.id === id) await t.release(k); }
        break;
      }
      case 'credit': {
        // a credit note or return reduces what is payable
        const amount = toPaise(a.amount, 'Credit note amount', { allowZero: false });
        const L = invoiceLiability(inv, id, pays);
        if (amount > L.payable) bad(`The credit note is more than the ${inr(L.payable)} still payable on this invoice. Record the rest against the supplier’s next invoice.`);
        const no = need(str(a.no, 40), 'Credit note number');
        if (!(await t.claim(`erp_key/cn_${keyOf(inv.supplierId, normRef(no))}`, { inv: id, at: now }))) conflict(`Credit note ${no} from this supplier is already recorded.`);
        next.creditNotes = [...(inv.creditNotes || []), { no, date: ymdOf(a.date, 'Credit note date'), amount, reason: need(text(a.note, 300), 'Reason'), by, at: now, files: await filesFrom(a.files, t, by, now) }];
        next.history = hist(inv, by, now, `Credit note ${no}: ${inr(amount)}`);
        await audit('CREDIT_NOTE_RECORDED', { inv: id, code: inv.code, no, amount });
        break;
      }
      case 'adjust': {
        // set a paid advance on the same PO against this invoice
        const payId = needId(a.payId, 'Advance');
        const adv = pays.find((p) => p.id === payId);
        if (!adv || adv.data.category !== 'ADVANCE' || adv.data.poId !== inv.poId) bad('Pick a paid advance on this invoice’s purchase order.');
        const amount = toPaise(a.amount, 'Amount to adjust', { allowZero: false });
        const invs = await t.list('erp_inv');
        const A = advancesOf(inv.poId, pays, invs);
        const advLeft = paidOf(adv.data) - sum(invs, (i) => sum((i.data.advanceAdj || []).filter((x) => x.payId === payId), (x) => x.amount));
        if (amount > advLeft) bad(`Only ${inr(advLeft)} of ${adv.data.code} is paid and not yet adjusted.`);
        const L = invoiceLiability(inv, id, pays);
        if (amount > L.payable - L.requestedOpen) bad(`Only ${inr(L.payable - L.requestedOpen)} of this invoice is still payable and not already requested.`);
        next.advanceAdj = [...(inv.advanceAdj || []), { payId, code: adv.data.code, amount, by, at: now }];
        next.history = hist(inv, by, now, `Advance ${adv.data.code} adjusted: ${inr(amount)}`);
        await audit('ADVANCE_ADJUSTED', { inv: id, code: inv.code, advance: adv.data.code, amount, unadjustedBefore: A.unadjusted });
        break;
      }
      case 'unadjust': {
        if (!E.has('acc')) deny('Only Accounts removes advance adjustments.');
        const k = Number(a.index), x = (inv.advanceAdj || [])[k];
        if (!x) bad('Pick the adjustment to remove.');
        next.advanceAdj = inv.advanceAdj.filter((_, i) => i !== k);
        next.history = hist(inv, by, now, `Adjustment of ${x.code} removed`, need(text(a.note, 300), 'Reason'));
        await audit('ADVANCE_ADJUSTMENT_REMOVED', { inv: id, code: inv.code, advance: x.code, amount: x.amount, reason: text(a.note, 300) });
        break;
      }
      case 'pay': {
        // the balance payment request: never more than is still payable and not already requested
        const L = invoiceLiability(inv, id, pays);
        if (inv.status !== 'VERIFIED') bad('Accounts must verify the invoice before a payment is requested.');
        const amount = a.amount ? toPaise(a.amount, 'Amount', { allowZero: false }) : L.requestable;
        if (amount <= 0) bad(`Nothing is left to request: payable ${inr(L.payable)}, already requested ${inr(L.requestedOpen)}.`);
        if (amount > L.requestable) bad(`Only ${inr(L.requestable)} can be requested — ${inr(L.paid)} paid, ${inr(L.credits)} credited, ${inr(L.adjusted)} advances adjusted, ${inr(L.requestedOpen)} already requested.`);
        return env.run('pay.create', { category: 'SUPPLIER', payee: inv.supplierName, supplierId: inv.supplierId, poId: inv.poId || undefined, invoiceId: id, invoiceRef: inv.invoiceNo, amount: rupeeStr(amount), due: inv.due || undefined, proposedDate: a.proposedDate || inv.due || undefined, priority: a.priority || 'NORMAL', note: text(a.note, 1000) || `${inv.supplierName} invoice ${inv.invoiceNo}`, clientKey: a.clientKey });
      }
      default: bad('Unknown action.');
    }
    await t.set(`erp_inv/${id}`, next);
    if (['verify', 'dispute', 'cancel', 'undispute'].includes(String(a.action))) await audit(`INVOICE_${String(a.action).toUpperCase()}`, { inv: id, code: inv.code, note: text(a.note, 300) || undefined });
    return { status: next.status };
  },
};
const nameOrId = (ctx, id) => ctx.emps.get(id)?.name || id;

/** build a PO from the form (lines, tax, charges, advance terms, totals) */
async function poFrom(a, t, old, by, now) {
  const sup = await supplierOf(t, a.supplierId);
  if (sup.status === 'BLOCKED') bad(`${sup.name} is blocked.`);
  const lines = (Array.isArray(a.lines) ? a.lines : []).slice(0, 100).map((x, k) => {
    const qty = toQty(x.qty, `Line ${k + 1}: quantity`), rate = toPaise(x.rate, `Line ${k + 1}: rate`, { allowZero: false }), taxBp = x.tax === '' || x.tax == null ? 0 : toBp(x.tax, `Line ${k + 1}: tax %`);
    const amount = lineAmount(rate, qty);
    return { id: isId(x.id) ? x.id : `L${k + 1}${newId().slice(0, 4)}`, desc: need(str(x.desc, 200), `Line ${k + 1}: description`), itemId: isId(x.itemId) ? x.itemId : null, uom: str(x.uom || 'Nos', 12), qty, rate, taxBp, amount, tax: pctOf(amount, taxBp) };
  });
  if (!lines.length) bad('Add at least one line.');
  const charges = optPaise(a.charges, 'Other charges') ?? 0, subtotal = sum(lines, (l) => l.amount), taxTotal = sum(lines, (l) => l.tax), total = subtotal + taxTotal + charges;
  const advance = a.advanceType === 'PCT' ? { pctBp: toBp(a.advanceValue || '0', 'Advance %'), amount: null } : a.advanceType === 'AMT' ? { pctBp: null, amount: toPaise(a.advanceValue, 'Advance amount') } : { pctBp: null, amount: 0 };
  const allowed = advance.amount ?? pctOf(total, advance.pctBp || 0);
  if (allowed > total) bad('The advance can’t be more than the PO value.');
  return {
    ...(old || {}), supplierId: a.supplierId, supplierName: sup.name, prId: isId(a.prId) ? a.prId : old?.prId || null, date: ymdOf(a.date || ymdIST(now), 'PO date'),
    kind: oneOf(String(a.kind || 'GOODS'), ['GOODS', 'SERVICES'], 'Goods or services'), lines, charges, subtotal, taxTotal, total,
    deliveryLocation: need(str(a.deliveryLocation, 120), 'Delivery location'), expectedDate: ymdOf(a.expectedDate, 'Expected delivery date'),
    terms: need(text(a.terms, 500), 'Payment terms'), advance, balanceTerms: text(a.balanceTerms, 300), deptId: str(a.deptId, 40) || old?.deptId || null,
    files: [...(old?.files || []), ...(await filesFrom(a.files, t, by, now))], updatedAt: now,
  };
}

const invKeys = (supplierId, no) => [...new Set([`erp_key/inv_${keyOf(supplierId, normRef(no))}`, `erp_key/inv_${keyOf(supplierId, 'z', normRef2(no))}`])];
/** possible duplicates of an invoice: exact (same supplier + number), and near ones to look at */
async function invoiceMatches(t, a, selfId) {
  const all = (await t.list('erp_inv')).filter((x) => x.id !== selfId && x.data.status !== 'CANCELLED');
  const n = normRef(a.invoiceNo), n2 = normRef2(a.invoiceNo), out = [];
  const amt = (() => { try { return a.amount == null ? null : typeof a.amount === 'number' ? a.amount : toPaise(a.amount); } catch { return null; } })();
  for (const { id, data: x } of all) {
    if (x.supplierId === a.supplierId && (x.normNo === n || normRef2(x.invoiceNo) === n2)) out.push({ id, code: x.code, kind: 'EXACT', why: `same supplier and invoice number (${x.invoiceNo})` });
    else if (x.supplierId === a.supplierId && amt != null && x.amount === amt && a.date && Math.abs(daysBetween(x.date, a.date)) <= 7) out.push({ id, code: x.code, kind: 'NEAR', why: `same supplier and amount ${inr(amt)} within a week (${x.invoiceNo}, ${x.date})` });
    else if (x.supplierId === a.supplierId && n && x.normNo && n.length >= 4 && (x.normNo.endsWith(n) || n.endsWith(x.normNo))) out.push({ id, code: x.code, kind: 'NEAR', why: `similar invoice number (${x.invoiceNo})` });
  }
  return out;
}

registerErp(purchase);

// supplier payments: the eligibility checks at verification, and what blocks approval (an approver may record an exception)
registerErpHooks({
  eligibility: async (p, t, env) => paymentChecks(p, t, await env.cfg()),
  paymentBlockers: async (p, t, a, env) => {
    const checks = await paymentChecks(p, t, await env.cfg());
    const blocking = (checks || []).filter((c) => c.blocking);
    if (!blocking.length) return null;
    const why = blocking.map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ''}`).join('; ');
    if (!a.exception) return `Not eligible yet: ${why}. If this payment is a legitimate exception, record the reason as an exception.`;
    if (String(a.exception).trim().length < 15) return 'Explain the exception in a full sentence (it is recorded in the audit log).';
    return null;
  },
  beforeCreate: async (rec, t, a, env) => {
    // a payment against an invoice can't exceed what is still payable and not already requested
    if (rec.invoiceId) {
      const inv = await t.get(`erp_inv/${rec.invoiceId}`);
      if (!inv) bad('The invoice doesn’t exist.');
      if (inv.status !== 'VERIFIED') bad('Accounts must verify the invoice before a payment is requested.');
      const L = invoiceLiability(inv, rec.invoiceId, await t.list('erp_pay'));
      if (rec.amountReq > L.requestable) bad(`Only ${inr(Math.max(0, L.requestable))} can be requested — ${inr(L.paid)} paid, ${inr(L.credits)} credited, ${inr(L.adjusted)} advances adjusted, ${inr(L.requestedOpen)} already requested.`);
      rec.dupKey = null; // the liability check above is the duplicate control for invoice payments
      rec.supplierId = inv.supplierId; rec.poId = inv.poId || null;
    }
    if (rec.category === 'ADVANCE') {
      if (!rec.poId) bad('An advance must be against a purchase order.');
      const po = await t.get(`erp_po/${rec.poId}`);
      if (!po || po.status !== 'APPROVED') bad('Advances are only against an approved, open PO.');
      const A = advancesOf(rec.poId, await t.list('erp_pay'), await t.list('erp_inv')), allow = advanceAllowed(po);
      if (A.requested + rec.amountReq > allow) {
        const reason = text(a.override?.reason, 500);
        if (!reason) conflict(`${po.code} allows ${inr(allow)} in advance; ${inr(A.requested)} is already requested. This would make ${inr(A.requested + rec.amountReq)}.`);
        if (!env.E.has('acc.approve') && !env.E.has('pur.approve')) deny('Only an approver can request more advance than the PO allows, with a reason.');
        rec.advanceOverride = { by: env.by, at: env.now, reason, allowed: allow };
      }
      rec.supplierId = po.supplierId; rec.dupKey = null;
    }
  },
});
