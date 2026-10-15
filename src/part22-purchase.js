<script>
/* ═════════════ Purchase: dashboard, requisitions, purchase orders, invoices, suppliers ═════════════
   Purchase, Stores and Accounts share the same records: a PO's deliveries are its goods receipts (Stores), its advances
   and payments are payment requests (Accounts). The server (server/erp-purchase.js) checks every change. */

const PR_ST = { DRAFT: ['Draft', ''], SUBMITTED: ['Waiting for approval', 't-warn'], APPROVED: ['Approved', 't-acc'], REJECTED: ['Rejected', 't-bad'], CANCELLED: ['Cancelled', ''], ORDERED: ['Ordered', 't-ok'] };
const PO_ST = { DRAFT: ['Draft', ''], SUBMITTED: ['Waiting for approval', 't-warn'], APPROVED: ['Approved', 't-acc'], REJECTED: ['Rejected', 't-bad'], CANCELLED: ['Cancelled', ''], CLOSED: ['Closed', ''] };
const INV_ST = { RECEIVED: ['To verify', 't-info'], DISCREPANCY: ['Differences', 't-bad'], VERIFIED: ['Verified', 't-ok'], DISPUTED: ['Disputed', 't-bad'], CANCELLED: ['Cancelled', ''] };
const SUP_ST = { PENDING: ['Awaiting approval', 't-warn'], APPROVED: ['Approved', 't-ok'], BLOCKED: ['Blocked', 't-bad'] };
const PDEAD = ['REJECTED', 'CANCELLED'];
const supName = (id) => erpGet('erp_sup', id)?.name || '—';
const pctTxt = (bp) => `${(bp || 0) / 100}%`;
// the same arithmetic as the server (server/erp-purchase.js) — for display only
function pAdvances(poId) {
  const adv = erpList('erp_pay').filter((p) => p.poId === poId && p.category === 'ADVANCE' && !PDEAD.includes(p.status));
  const paid = sumBy(adv, erpPaid), adjusted = sumBy(erpList('erp_inv'), (i) => sumBy((i.advanceAdj || []).filter((x) => adv.some((p) => p.id === x.payId)), (x) => x.amount));
  return { list: adv, requested: sumBy(adv, (p) => p.amountApproved ?? p.amountReq), paid, adjusted, unadjusted: paid - adjusted };
}
const advAllowed = (po) => (po.advance?.amount != null ? po.advance.amount : Math.round((po.total * (po.advance?.pctBp || 0)) / 10000));
function pLiability(inv) {
  const linked = erpList('erp_pay').filter((p) => p.invoiceId === inv.id && !PDEAD.includes(p.status));
  const credits = sumBy(inv.creditNotes || [], (c) => c.amount), adjusted = sumBy(inv.advanceAdj || [], (x) => x.amount), paid = sumBy(linked, erpPaid);
  const requestedOpen = sumBy(linked, (p) => Math.max(0, (p.amountApproved ?? p.amountReq) - erpPaid(p)));
  const payable = inv.amount - credits - adjusted - paid;
  return { credits, adjusted, paid, requestedOpen, payable, requestable: payable - requestedOpen, linked };
}
function pProgress(po) {
  const grns = erpList('erp_grn').filter((g) => g.poId === po.id && g.status === 'VERIFIED'), invs = erpList('erp_inv').filter((i) => i.poId === po.id && i.status !== 'CANCELLED');
  const pend = erpList('erp_grn').filter((g) => g.poId === po.id && g.status === 'RECORDED');
  return (po.lines || []).map((l) => ({ ...l, accepted: sumBy(grns.flatMap((g) => g.lines.filter((x) => x.poLineId === l.id)), (x) => x.accepted), pending: sumBy(pend.flatMap((g) => g.lines.filter((x) => x.poLineId === l.id)), (x) => x.accepted), rejected: sumBy(grns.flatMap((g) => g.lines.filter((x) => x.poLineId === l.id)), (x) => x.rejected + (x.damaged || 0)), invoiced: sumBy(invs.flatMap((i) => (i.lines || []).filter((x) => x.poLineId === l.id)), (x) => x.qty) }));
}
const poDone = (po) => pProgress(po).every((l) => l.accepted >= l.qty);
const poPaid = (po) => sumBy(erpList('erp_pay').filter((p) => p.poId === po.id && !PDEAD.includes(p.status)), erpPaid);
const poInvoiced = (po) => sumBy(erpList('erp_inv').filter((i) => i.poId === po.id && i.status !== 'CANCELLED'), (i) => i.amount - sumBy(i.creditNotes || [], (c) => c.amount));

function vPurchase2() {
  const pur = erpHas('pur'), acc = erpHas('acc');
  erpUse('erp_cfg', 'erp_pr', ...(pur || acc || erpHas('sto') ? ['erp_sup', 'erp_po', 'erp_grn'] : []), ...(pur || acc ? ['erp_inv', 'erp_pay', 'erp_bank'] : []), ...(pur ? ['erp_item'] : []), ...(acc ? ['erp_supbank'] : []));
  if (S.ui.erpOpen && ['pr', 'po', 'inv', 'sup'].includes(S.ui.erpKind)) { const id = S.ui.erpOpen, k = S.ui.erpKind; S.ui.erpOpen = null; ERPUI.pAct = null; setTimeout(() => openModal(() => (k === 'pr' ? prModal(id) : k === 'po' ? poModal(id) : k === 'inv' ? invModal(id) : supModal(id))), 0); }
  const tabs = pur || acc ? [['dash', 'Dashboard'], ['pr', 'Requisitions'], ['po', 'Purchase orders'], ['inv', 'Invoices'], ['sup', 'Suppliers']] : [['pr', 'My requisitions']];
  const { cur, html } = erpTabs('puTab', tabs, tabs[0][0]);
  let body;
  if (erpLoading('erp_pr', ...(pur || acc ? ['erp_po', 'erp_sup'] : []))) body = '<div class="body muted small">Loading…</div>';
  else body = { dash: purDash, pr: purPRs, po: purPOs, inv: purInvoices, sup: purSuppliers }[tabs.some((t) => t[0] === cur) ? cur : tabs[0][0]]();
  const actions = `<button class="btn" data-a="erp-pr-new">Purchase requisition</button>${pur ? '<button class="btn pri" data-a="erp-po-new">Purchase order</button>' : ''}`;
  return shell(`${html}${body}`, 'Purchase', pur || acc ? 'Requisitions, orders, deliveries, invoices and supplier payments' : 'Ask Purchase to buy something for your department', actions);
}

/* ── dashboard: what needs doing ── */
function purDash() {
  const T = today(), pos = erpList('erp_po'), open = pos.filter((p) => p.status === 'APPROVED'), invs = erpList('erp_inv').filter((i) => i.status !== 'CANCELLED'), pays = erpList('erp_pay');
  const lists = [];
  const L = (title, items, row, tone = '') => lists.push([title, items, row, tone]);
  const poRow = (p, extra = '') => `<button class="row click" data-a="erp-po" data-id="${p.id}" style="justify-content:space-between;width:100%;background:none;border:0;padding:5px 0;text-align:left"><span><b class="small">${esc(p.code)}</b> ${esc(p.supplierName)}${extra}</span><span class="small">${inr(p.total)}</span></button>`;
  const invRow = (i, extra = '') => `<button class="row click" data-a="erp-inv" data-id="${i.id}" style="justify-content:space-between;width:100%;background:none;border:0;padding:5px 0;text-align:left"><span><b class="small">${esc(i.code)}</b> ${esc(i.supplierName)} · ${esc(i.invoiceNo)}${extra}</span><span class="small">${inr(i.amount)}</span></button>`;
  L('Requisitions awaiting approval', erpList('erp_pr').filter((r) => r.status === 'SUBMITTED'), (r) => `<button class="row click" data-a="erp-pr" data-id="${r.id}" style="justify-content:space-between;width:100%;background:none;border:0;padding:5px 0;text-align:left"><span><b class="small">${esc(r.code)}</b> ${esc(nameOf(r.requestedBy))} · ${esc(r.items[0]?.desc || '')}</span><span class="small">${inr(r.estTotal)}</span></button>`);
  L('POs awaiting approval', pos.filter((p) => p.status === 'SUBMITTED'), (p) => poRow(p));
  L('Orders due for delivery (7 days)', open.filter((p) => !poDone(p) && p.expectedDate >= T && p.expectedDate <= addDays(T, 7)), (p) => poRow(p, ` <span class="tiny muted">due ${fmtD(p.expectedDate)}</span>`));
  L('Overdue deliveries', open.filter((p) => !poDone(p) && p.expectedDate < T), (p) => poRow(p, ` <span class="pill t-bad">${Math.round((Date.parse(T) - Date.parse(p.expectedDate)) / 864e5)} days late</span>`), 't-bad');
  L('Advances paid, not adjusted', open.concat(pos.filter((p) => p.status === 'CLOSED')).filter((p) => pAdvances(p.id).unadjusted > 0), (p) => poRow(p, ` <span class="pill t-warn">${inr(pAdvances(p.id).unadjusted)} unadjusted</span>`));
  L('Advances paid, material not received', open.filter((p) => pAdvances(p.id).paid > 0 && p.kind !== 'SERVICES' && pProgress(p).every((l) => !l.accepted)), (p) => poRow(p, ` <span class="pill t-bad">${inr(pAdvances(p.id).paid)} paid</span>`), 't-bad');
  L('Material received, invoice missing', open.concat(pos.filter((p) => p.status === 'CLOSED')).filter((p) => pProgress(p).some((l) => l.accepted > l.invoiced)), (p) => poRow(p, ' <span class="pill t-warn">not invoiced</span>'));
  L('Invoices for material not received', invs.filter((i) => i.poId && (i.match?.issues || []).some((x) => /accepted at stores|accepted work/.test(x))), (i) => invRow(i, ' <span class="pill t-bad">not received</span>'), 't-bad');
  L('Invoices awaiting verification', invs.filter((i) => ['RECEIVED', 'DISCREPANCY'].includes(i.status)), (i) => invRow(i, ` ${pill(INV_ST, i.status)}`));
  L('Supplier payments awaiting approval', pays.filter((p) => ['SUBMITTED', 'UNDER_REVIEW'].includes(p.status) && (p.poId || p.supplierId)), (p) => `<button class="row click" data-a="erp-pay" data-id="${p.id}" style="justify-content:space-between;width:100%;background:none;border:0;padding:5px 0;text-align:left"><span><b class="small">${esc(p.code)}</b> ${esc(p.payee)} ${pill(PAY_ST, p.status)}</span><span class="small">${inr(p.amountReq)}</span></button>`);
  L('Duplicate warnings', [...invs.filter((i) => i.dupOverride || (i.warnings || []).length), ...pays.filter((p) => p.dupOverride && !PDEAD.includes(p.status))], (x) => (x.invoiceNo ? invRow(x, ` <span class="pill t-bad">${x.dupOverride ? 'duplicate override' : 'possible duplicate'}</span>`) : `<button class="row click" data-a="erp-pay" data-id="${x.id}" style="width:100%;background:none;border:0;padding:5px 0;text-align:left"><b class="small">${esc(x.code)}</b>&nbsp;${esc(x.payee)} <span class="pill t-bad">duplicate override</span></button>`), 't-bad');
  L('Disputed invoices / pending supplier credits', invs.filter((i) => i.status === 'DISPUTED'), (i) => invRow(i));
  const cardsHtml = lists.map(([title, items, row, tone]) => `<section class="card"><header><h2>${esc(title)} <span class="pill ${items.length ? tone || 't-info' : ''}">${items.length}</span></h2></header><div class="body">${items.length ? items.slice(0, 8).map(row).join('') + (items.length > 8 ? `<div class="tiny muted">+${items.length - 8} more</div>` : '') : '<span class="small muted">Nothing.</span>'}</div></section>`).join('');
  // supplier exposure: ordered vs invoiced vs paid, and what is still committed
  const bySup = new Map();
  for (const p of pos.filter((x) => ['APPROVED', 'CLOSED'].includes(x.status))) { const s = bySup.get(p.supplierId) || { id: p.supplierId, name: p.supplierName, ordered: 0, invoiced: 0, paid: 0, adv: 0 }; s.ordered += p.total; s.invoiced += poInvoiced(p); s.paid += poPaid(p); s.adv += pAdvances(p.id).unadjusted; bySup.set(p.supplierId, s); }
  const exposure = dataTable('puX', [...bySup.values()], [
    { k: 'name', label: 'Supplier', v: (s) => s.name }, { k: 'ord', label: 'PO value', num: true, v: (s) => s.ordered, html: (s) => inr(s.ordered) },
    { k: 'inv', label: 'Invoiced', num: true, v: (s) => s.invoiced, html: (s) => inr(s.invoiced) }, { k: 'paid', label: 'Paid', num: true, v: (s) => s.paid, html: (s) => inr(s.paid) },
    { k: 'adv', label: 'Advance not adjusted', num: true, v: (s) => s.adv, html: (s) => (s.adv ? `<span class="v warn">${inr(s.adv)}</span>` : '—') },
    { k: 'out', label: 'Still committed', num: true, v: (s) => s.ordered - s.paid, html: (s) => inr(s.ordered - s.paid) },
  ], { name: 'Supplier exposure', empty: 'No approved purchase orders yet.' });
  return `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px">${cardsHtml}</div>${card('Supplier-wise commitments', exposure, { list: true })}`;
}

/* ── requisitions ── */
function purPRs() {
  const mine = !erpHas('pur') && !erpHas('acc');
  const list = erpList('erp_pr').filter((r) => !mine || r.requestedBy === S.me.id || r.approverId === S.me.id);
  return card(`Requisitions · ${list.length}`, dataTable('puR', list, [
    { k: 'code', label: 'Number', v: (r) => r.code, html: (r) => `<b class="small">${esc(r.code)}</b>${r.status === 'SUBMITTED' && (r.approverId === S.me.id || erpHas('pur.approve')) && r.requestedBy !== S.me.id ? ' <span class="pill t-warn">You</span>' : ''}` },
    { k: 'who', label: 'Requested by', v: (r) => nameOf(r.requestedBy), html: (r) => person(r.requestedBy, deptOf(r.deptId)?.name || '') },
    { k: 'what', label: 'Items', v: (r) => r.items.map((x) => x.desc).join(', '), html: (r) => `${esc(r.items[0]?.desc || '')}${r.items.length > 1 ? ` <span class="tiny muted">+${r.items.length - 1}</span>` : ''}` },
    { k: 'est', label: 'Estimate', num: true, v: (r) => r.estTotal, html: (r) => inr(r.estTotal) }, { k: 'need', label: 'Needed by', v: (r) => r.needBy, html: (r) => fmtD(r.needBy) },
    { k: 'st', label: 'Status', v: (r) => r.status, html: (r) => pill(PR_ST, r.status) },
  ], { name: 'Requisitions', click: (r) => `data-a="erp-pr" data-id="${r.id}"`, empty: 'No requisitions yet.' }), { list: true, actions: '<button class="btn pri sm" data-a="erp-pr-new">Purchase requisition</button>' });
}
const rowsUI = (key, n) => Math.max(1, +(ERPUI[key] || n));
function prNewModal() {
  const n = rowsUI('prRows', 1);
  return `${mhead('Purchase requisition', 'Your manager or a purchase approver approves it; Purchase then orders it')}<form data-f="erp-pr-new"><div class="body grid">
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Item or service</th><th style="width:90px">Quantity</th><th style="width:80px">Unit</th><th style="width:120px">Est. price (₹ / unit)</th></tr></thead><tbody>
    ${Array.from({ length: n }, (_, i) => `<tr><td><input class="i" name="desc" id="pr-d${i}" ${i === 0 ? 'required' : ''}></td><td><input class="i" name="qty" id="pr-q${i}" inputmode="decimal"></td><td><input class="i" name="uom" id="pr-u${i}" value="Nos"></td><td><input class="i" name="estRate" id="pr-r${i}" inputmode="decimal"></td></tr>`).join('')}
    </tbody></table></div><button type="button" class="btn sm ghost" data-a="erp-rows" data-k="prRows">+ Add line</button>
    <div class="grid two"><label class="f">Needed by<input type="date" class="i" id="pr-nb" name="needBy" required min="${today()}"></label><label class="f">Cost centre / budget (optional)<input class="i" id="pr-cc" name="costCentre"></label></div>
    <label class="f">Business justification<textarea class="i" id="pr-j" name="justification" rows="2" required></textarea></label>
    <label class="f">Attachments (quotes, specs — optional)<input type="file" class="i" id="pr-f" name="files" multiple></label>
    </div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn" name="go" value="draft">Save draft</button><button class="btn pri" name="go" value="submit">Submit</button></footer></form>`;
}
function prModal(id) {
  const r = erpGet('erp_pr', id);
  if (!r) return `${mhead('Requisition')}<div class="body">${empty('This requisition isn’t available.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const decide = r.status === 'SUBMITTED' && r.requestedBy !== S.me.id && (r.approverId === S.me.id || erpHas('pur.approve'));
  return `${mhead(`${esc(r.code)} · ${esc(nameOf(r.requestedBy))}`, `${pill(PR_ST, r.status)} needed by ${fmtD(r.needBy)}`)}<div class="body grid">
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Est. price</th><th class="num">Est. total</th></tr></thead><tbody>${r.items.map((x) => `<tr><td>${esc(x.desc)}</td><td class="num">${qtyTxt(x.qty)} ${esc(x.uom)}</td><td class="num">${inr(x.estRate)}</td><td class="num">${inr(Math.round((x.estRate * x.qty) / 1000))}</td></tr>`).join('')}</tbody></table></div>
    <p class="small"><b>Why:</b> ${esc(r.justification)}${r.costCentre ? ` · Cost centre ${esc(r.costCentre)}` : ''}</p>
    <div><div class="tiny muted">Attachments</div>${fileList(r.files)}</div>
    ${r.approverId ? `<p class="tiny muted">Approver: ${esc(nameOf(r.approverId))} (or a purchase approver)</p>` : ''}
    ${decide ? `<form data-f="erp-pr-act" data-id="${r.id}" class="row"><input class="i" name="note" id="pra-n" placeholder="Comment (required to reject)" style="flex:1"><button class="btn danger" name="go" value="reject">Reject</button><button class="btn pri" name="go" value="approve">Approve</button></form>` : ''}
    ${r.status === 'APPROVED' && erpHas('pur') ? `<button class="btn pri" data-a="erp-po-new" data-pr="${r.id}">Raise purchase order</button>` : ''}
    ${r.poId ? `<button class="btn sm ghost" data-a="erp-po" data-id="${r.poId}">Open ${esc(erpGet('erp_po', r.poId)?.code || 'PO')}</button>` : ''}
    ${['DRAFT', 'SUBMITTED', 'APPROVED'].includes(r.status) && (r.requestedBy === S.me.id || erpHas('pur')) ? `<button class="btn sm danger" data-a="erp-pr-cancel" data-id="${r.id}">Cancel requisition</button>` : ''}
    <details><summary class="small">History</summary><ul class="small">${(r.history || []).slice().reverse().map((h) => `<li><span class="tiny muted">${fmtDT(h.at)}</span> ${esc(nameOf(h.by))} — ${esc(h.action)}${h.note ? `: “${esc(h.note)}”` : ''}</li>`).join('')}</ul></details>
    </div><footer><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}

/* ── purchase orders ── */
function purPOs() {
  const st = ui('poSt', 'open'), q = ui('poQ', '').trim().toLowerCase(), sup = ui('poSup', '');
  const list = erpList('erp_po').filter((p) => (st === 'open' ? ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(p.status) : !st || p.status === st) && (!sup || p.supplierId === sup) && (!q || `${p.code} ${p.supplierName} ${(p.lines || []).map((l) => l.desc).join(' ')}`.toLowerCase().includes(q)));
  return `<div class="filters rd-filters"><input class="i" id="po-q" data-i="poQ" placeholder="Search PO, supplier or item" value="${esc(ui('poQ', ''))}" aria-label="Search">
      <select class="i" id="po-st" data-c="poSt" aria-label="Status">${opts([['open', 'Open'], ...Object.entries(PO_ST).map(([k, v]) => [k, v[0]])], st, 'All')}</select>
      <select class="i" id="po-sup" data-c="poSup" aria-label="Supplier">${opts(erpList('erp_sup').map((s) => [s.id, s.name]), sup, 'All suppliers')}</select></div>
    ${card(`Purchase orders · ${list.length}`, dataTable('puP', list, [
      { k: 'code', label: 'PO', v: (p) => p.code, html: (p) => `<b class="small">${esc(p.code)}</b>${p.version > 1 ? ` <span class="tiny muted">v${p.version}</span>` : ''}<div class="tiny muted">${fmtD(p.date)}</div>` },
      { k: 'sup', label: 'Supplier', v: (p) => p.supplierName, html: (p) => `${esc(p.supplierName)}<div class="tiny muted">${esc(p.lines[0]?.desc || '')}${p.lines.length > 1 ? ` +${p.lines.length - 1}` : ''}</div>` },
      { k: 'tot', label: 'Value', num: true, v: (p) => p.total, html: (p) => inr(p.total) },
      { k: 'del', label: 'Delivery', v: (p) => p.expectedDate, html: (p) => { const pr = pProgress(p), done = pr.every((l) => l.accepted >= l.qty), some = pr.some((l) => l.accepted); return `${fmtD(p.expectedDate)}<div class="tiny">${p.kind === 'SERVICES' ? '' : done ? '<span class="pill t-ok">Received</span>' : some ? '<span class="pill t-warn">Partly received</span>' : p.status === 'APPROVED' && p.expectedDate < today() ? '<span class="pill t-bad">Overdue</span>' : ''}</div>`; } },
      { k: 'inv', label: 'Invoiced', num: true, v: (p) => poInvoiced(p), html: (p) => inr(poInvoiced(p)) }, { k: 'paid', label: 'Paid', num: true, v: (p) => poPaid(p), html: (p) => inr(poPaid(p)) },
      { k: 'st', label: 'Status', v: (p) => p.status, html: (p) => pill(PO_ST, p.status) },
    ], { name: 'PO register', click: (p) => `data-a="erp-po" data-id="${p.id}"`, empty: 'No purchase orders match.' }), { list: true, actions: erpHas('pur') ? '<button class="btn pri sm" data-a="erp-po-new">Purchase order</button>' : '' })}`;
}
function poFormBody(po, pr) {
  const lines = po ? po.lines : pr ? pr.items.map((x) => ({ desc: x.desc, uom: x.uom, qty: x.qty, rate: x.estRate, taxBp: 1800 })) : [];
  const n = Math.max(lines.length, rowsUI('poRows', 1));
  const items = erpList('erp_item');
  const line = (l, i) => `<tr>${l?.id ? `<input type="hidden" name="lid" value="${esc(l.id)}">` : '<input type="hidden" name="lid" value="">'}<td><input class="i" name="desc" id="po-d${i}" value="${esc(l?.desc || '')}" ${i === 0 ? 'required' : ''}>${items.length ? `<select class="i" name="itemId" id="po-it${i}" style="margin-top:4px">${opts(items.map((x) => [x.id, `${x.sku} · ${x.name}`]), l?.itemId || '', 'Not a stock item')}</select>` : '<input type="hidden" name="itemId" value="">'}</td><td><input class="i" name="qty" id="po-q${i}" inputmode="decimal" value="${l ? esc(qtyIn(l.qty)) : ''}"></td><td><input class="i" name="uom" id="po-u${i}" value="${esc(l?.uom || 'Nos')}"></td><td><input class="i" name="rate" id="po-r${i}" inputmode="decimal" value="${l ? esc(rupeesIn(l.rate)) : ''}"></td><td><input class="i" name="tax" id="po-t${i}" inputmode="decimal" value="${l ? (l.taxBp || 0) / 100 : '18'}"></td></tr>`;
  return `<div class="grid two">
      <label class="f">Supplier<select class="i" id="po-sup" name="supplierId" required ${po && po.status === 'APPROVED' ? 'disabled' : ''}>${opts(erpList('erp_sup').filter((s) => s.status !== 'BLOCKED').map((s) => [s.id, `${s.name}${s.status === 'PENDING' ? ' (awaiting approval)' : ''}`]), po?.supplierId || '', 'Pick a supplier')}</select></label>
      <label class="f">Goods or services<select class="i" id="po-k" name="kind">${opts([['GOODS', 'Goods (Stores receives them)'], ['SERVICES', 'Services (accepted by the requester / Purchase)']], po?.kind || 'GOODS')}</select></label></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Item / service</th><th style="width:90px">Qty</th><th style="width:70px">Unit</th><th style="width:110px">Rate (₹)</th><th style="width:70px">GST %</th></tr></thead><tbody>${Array.from({ length: n }, (_, i) => line(lines[i], i)).join('')}</tbody></table></div>
    <button type="button" class="btn sm ghost" data-a="erp-rows" data-k="poRows" data-n="${n + 1}">+ Add line</button>
    <div class="grid two">
      <label class="f">Other charges (freight, packing… ₹)<input class="i" id="po-ch" name="charges" inputmode="decimal" value="${esc(rupeesIn(po?.charges || null))}"></label>
      <label class="f">Delivery location<input class="i" id="po-loc" name="deliveryLocation" required value="${esc(po?.deliveryLocation || '')}" placeholder="e.g. Factory store, Guwahati"></label>
      <label class="f">Expected delivery date<input type="date" class="i" id="po-ed" name="expectedDate" required value="${esc(po?.expectedDate || pr?.needBy || '')}"></label>
      <label class="f">Payment terms<input class="i" id="po-terms" name="terms" required value="${esc(po?.terms || '')}" placeholder="e.g. 30% advance, balance 30 days after delivery"></label>
      <label class="f">Advance<select class="i" id="po-at" name="advanceType">${opts([['NONE', 'No advance'], ['PCT', 'Percentage of the PO'], ['AMT', 'Fixed amount']], po?.advance?.pctBp ? 'PCT' : po?.advance?.amount ? 'AMT' : 'NONE')}</select></label>
      <label class="f">Advance % or ₹<input class="i" id="po-av" name="advanceValue" inputmode="decimal" value="${po?.advance?.pctBp ? po.advance.pctBp / 100 : po?.advance?.amount ? esc(rupeesIn(po.advance.amount)) : ''}"></label>
      <label class="f full">Balance payment terms<input class="i" id="po-bt" name="balanceTerms" value="${esc(po?.balanceTerms || '')}"></label>
      <label class="f full">Quotations / documents<input type="file" class="i" id="po-f" name="files" multiple></label>
    </div>`;
}
function poNewModal(prId) {
  const pr = prId ? erpGet('erp_pr', prId) : null;
  return `${mhead(pr ? `Purchase order for ${esc(pr.code)}` : 'Purchase order', 'A purchase approver approves it before it goes to the supplier')}<form data-f="erp-po-new" data-pr="${esc(prId || '')}"><div class="body grid">${poFormBody(null, pr)}</div>
    <footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn" name="go" value="draft">Save draft</button><button class="btn pri" name="go" value="submit">Submit for approval</button></footer></form>`;
}
function poModal(id) {
  const p = erpGet('erp_po', id);
  if (!p) return `${mhead('Purchase order')}<div class="body">${empty('This purchase order isn’t available.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const x = ERPUI.pAct, pur = erpHas('pur'), pr = pProgress(p), A = pAdvances(p.id), allow = advAllowed(p);
  if (x === 'revise') return `${mhead(`Revise ${esc(p.code)} (version ${p.version} → ${p.version + 1})`, 'Needs approval again; the current version is kept')}<form data-f="erp-po-revise" data-id="${p.id}"><div class="body grid">${poFormBody(p)}<label class="f">Reason for the revision<input class="i" id="por-r" name="reason" required></label></div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="erp-p-act" data-x="">Back</button><button class="btn pri">Submit revision</button></footer></form>`;
  const invs = erpList('erp_inv').filter((i) => i.poId === p.id), grns = erpList('erp_grn').filter((g) => g.poId === p.id), pays = erpList('erp_pay').filter((y) => y.poId === p.id);
  const decide = p.status === 'SUBMITTED' && erpHas('pur.approve') && p.createdBy !== S.me.id;
  const advForm = x === 'advance' ? `<form data-f="erp-po-adv" data-id="${p.id}" data-k="${ckey()}" class="card body" style="background:var(--sunk);border:0"><h3>Request an advance</h3><p class="tiny muted">The PO allows ${inr(allow)} in advance; ${inr(A.requested)} is already requested.</p><div class="grid two"><label class="f">Amount (₹)<input class="i" id="pa-a" name="amount" required inputmode="decimal" value="${esc(rupeesIn(Math.max(0, allow - A.requested)))}"></label><label class="f">Needed by<input type="date" class="i" id="pa-d" name="due" value="${today()}"></label><label class="f full">Note<input class="i" id="pa-n" name="note"></label>${ERPUI.dup ? `<div class="full card body" style="background:var(--bad-soft);border:0"><b>${esc(ERPUI.dup)}</b>${erpHas('pur.approve') || erpHas('acc.approve') ? '<label class="f" style="margin-top:6px">Reason for going over the terms (recorded)<input class="i" name="override" id="pa-o"></label>' : '<p class="small">Only an approver can request more than the PO allows.</p>'}</div>` : ''}</div><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-p-act" data-x="">Back</button><button class="btn pri">Send to Accounts</button></div></form>` : '';
  const reasonForm = ['reject', 'cancel', 'close'].includes(x) ? `<form data-f="erp-po-act" data-id="${p.id}" data-x="${x}" class="card body" style="background:var(--sunk);border:0"><label class="f">Reason<input class="i" name="note" id="poa-n" required></label><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-p-act" data-x="">Back</button><button class="btn ${x === 'close' ? 'pri' : 'danger'}">${x === 'reject' ? 'Reject' : x === 'cancel' ? 'Cancel PO' : 'Close PO'}</button></div></form>` : '';
  const btns = [
    decide && `<button class="btn sm pri" data-a="erp-po-approve" data-id="${p.id}">Approve</button>`, decide && '<button class="btn sm danger" data-a="erp-p-act" data-x="reject">Reject</button>',
    p.status === 'DRAFT' && p.createdBy === S.me.id && `<button class="btn sm pri" data-a="erp-po-submit" data-id="${p.id}">Submit</button>`,
    p.status === 'APPROVED' && pur && '<button class="btn sm" data-a="erp-p-act" data-x="advance">Request advance</button>',
    p.status === 'APPROVED' && pur && '<button class="btn sm" data-a="erp-p-act" data-x="revise">Revise</button>',
    ['APPROVED', 'CLOSED'].includes(p.status) && (pur || erpHas('acc')) && `<button class="btn sm" data-a="erp-inv-new" data-po="${p.id}">Record invoice</button>`,
    p.status === 'APPROVED' && pur && '<button class="btn sm" data-a="erp-p-act" data-x="close">Close</button>',
    ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(p.status) && pur && '<button class="btn sm danger" data-a="erp-p-act" data-x="cancel">Cancel</button>',
  ].filter(Boolean).join('');
  const row = (l, v) => `<div><div class="tiny muted">${l}</div><div>${v}</div></div>`;
  return `${mhead(`${esc(p.code)} · ${esc(p.supplierName)}${p.version > 1 ? ` · v${p.version}` : ''}`, `${pill(PO_ST, p.status)} ${p.kind === 'SERVICES' ? 'Services' : 'Goods'} · ${esc(p.deliveryLocation)}`)}<div class="body grid">
    <div class="grid two" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${row('PO value', inr(p.total))}${row('Expected', fmtD(p.expectedDate))}${row('Advance allowed', inr(allow))}${row('Advance paid', inr(A.paid))}${row('Advance not adjusted', A.unadjusted ? `<span class="v warn">${inr(A.unadjusted)}</span>` : '—')}${row('Invoiced', inr(poInvoiced(p)))}${row('Paid (all)', inr(poPaid(p)))}${row('Raised by', esc(nameOf(p.createdBy)))}${row('Approved by', p.approvedBy ? esc(nameOf(p.approvedBy)) : '—')}</div>
    <p class="small"><b>Terms:</b> ${esc(p.terms)}${p.balanceTerms ? ` · ${esc(p.balanceTerms)}` : ''}</p>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Ordered</th><th class="num">Rate</th><th class="num">GST</th><th class="num">Accepted</th><th class="num">Rejected</th><th class="num">Invoiced</th><th class="num">To come</th></tr></thead><tbody>${pr.map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${qtyTxt(l.qty)} ${esc(l.uom)}</td><td class="num">${inr(l.rate)}</td><td class="num">${pctTxt(l.taxBp)}</td><td class="num">${qtyTxt(l.accepted)}${l.pending ? `<div class="tiny muted">+${qtyTxt(l.pending)} to verify</div>` : ''}</td><td class="num">${l.rejected ? qtyTxt(l.rejected) : '—'}</td><td class="num ${l.invoiced > l.accepted ? 'v bad' : ''}">${qtyTxt(l.invoiced)}</td><td class="num">${qtyTxt(Math.max(0, l.qty - l.accepted - l.pending))}</td></tr>`).join('')}</tbody></table></div>
    <div class="tiny muted">Subtotal ${inr(p.subtotal)} + GST ${inr(p.taxTotal)} + charges ${inr(p.charges || 0)} = <b>${inr(p.total)}</b></div>
    ${advForm || reasonForm || (btns ? `<div class="row" style="gap:6px">${btns}</div>` : '')}
    ${grns.length ? `<div><h3>Deliveries</h3><ul class="small">${grns.map((g) => `<li><button class="btn sm ghost" data-a="erp-grn" data-id="${g.id}">${esc(g.code)}</button> ${fmtD(g.deliveryDate)} · ${pill(GRN_ST, g.status)} · ${esc(g.lines.map((l) => `${l.desc.slice(0, 25)} ${qtyTxt(l.accepted)}`).join(', '))}</li>`).join('')}</ul></div>` : ''}
    ${invs.length ? `<div><h3>Invoices</h3><ul class="small">${invs.map((i) => `<li><button class="btn sm ghost" data-a="erp-inv" data-id="${i.id}">${esc(i.code)}</button> ${esc(i.invoiceNo)} · ${inr(i.amount)} · ${pill(INV_ST, i.status)}</li>`).join('')}</ul></div>` : ''}
    ${pays.length ? `<div><h3>Advances & payments</h3><ul class="small">${pays.map((y) => `<li><button class="btn sm ghost" data-a="erp-pay" data-id="${y.id}">${esc(y.code)}</button> ${esc(PAY_CATEGORIES[y.category])} · ${inr(y.amountApproved ?? y.amountReq)} · paid ${inr(erpPaid(y))} · ${pill(PAY_ST, y.status)}</li>`).join('')}</ul></div>` : ''}
    <div><div class="tiny muted">Documents</div>${fileList(p.files)}</div>
    ${(p.versions || []).length ? `<details><summary class="small">Versions</summary><ul class="small">${p.versions.slice().reverse().map((v) => `<li>Version ${v.v}: ${inr(v.total)} — replaced ${fmtDT(v.at)} by ${esc(nameOf(v.by))}: “${esc(v.reason)}”</li>`).join('')}</ul></details>` : ''}
    <details><summary class="small">History</summary><ul class="small">${(p.history || []).slice().reverse().map((h) => `<li><span class="tiny muted">${fmtDT(h.at)}</span> ${esc(nameOf(h.by))} — ${esc(h.action)}${h.note ? `: “${esc(h.note)}”` : ''}</li>`).join('')}</ul></details>
    </div><footer><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}

/* ── invoices ── */
function purInvoices() {
  const st = ui('ivSt', 'open'), q = ui('ivQ', '').trim().toLowerCase();
  const list = erpList('erp_inv').filter((i) => (st === 'open' ? i.status !== 'CANCELLED' && pLiability(i).payable > 0 : !st || i.status === st) && (!q || `${i.code} ${i.supplierName} ${i.invoiceNo} ${i.poCode || ''}`.toLowerCase().includes(q)));
  return `<div class="filters rd-filters"><input class="i" id="iv-q" data-i="ivQ" placeholder="Search supplier, invoice or PO" value="${esc(ui('ivQ', ''))}" aria-label="Search">
      <select class="i" id="iv-st" data-c="ivSt" aria-label="Status">${opts([['open', 'Still payable'], ...Object.entries(INV_ST).map(([k, v]) => [k, v[0]])], st, 'All')}</select></div>
    ${card(`Supplier invoices · ${list.length}`, dataTable('puI', list, [
      { k: 'code', label: 'Ref', v: (i) => i.code, html: (i) => `<b class="small">${esc(i.code)}</b>${i.dupOverride || (i.warnings || []).length ? ' <span class="pill t-bad">Duplicate?</span>' : ''}` },
      { k: 'sup', label: 'Supplier · invoice', v: (i) => `${i.supplierName} ${i.invoiceNo}`, html: (i) => `${esc(i.supplierName)}<div class="tiny muted">${esc(i.invoiceNo)} · ${fmtD(i.date)}${i.poCode ? ' · ' + esc(i.poCode) : ''}</div>` },
      { k: 'amt', label: 'Amount', num: true, v: (i) => i.amount, html: (i) => inr(i.amount) },
      { k: 'pay', label: 'Still payable', num: true, v: (i) => pLiability(i).payable, html: (i) => { const L2 = pLiability(i); return `${inr(L2.payable)}${L2.requestedOpen ? `<div class="tiny muted">${inr(L2.requestedOpen)} requested</div>` : ''}`; } },
      { k: 'due', label: 'Due', v: (i) => i.due || '', html: (i) => (i.due ? fmtD(i.due) : '—') },
      { k: 'st', label: 'Status', v: (i) => i.status, html: (i) => pill(INV_ST, i.status) },
    ], { name: 'Invoice register', click: (i) => `data-a="erp-inv" data-id="${i.id}"`, empty: 'No invoices match.' }), { list: true, actions: '<button class="btn pri sm" data-a="erp-inv-new">Record invoice</button>' })}`;
}
function invNewModal(fixedPo) {
  const poId = fixedPo || ui('inPo', '') || null;
  const po = poId ? erpGet('erp_po', poId) : null, pr = po ? pProgress(po) : [];
  const supId = po?.supplierId || ui('inSup', '');
  const pos = erpList('erp_po').filter((p) => ['APPROVED', 'CLOSED'].includes(p.status) && (!supId || p.supplierId === supId));
  const lines = po ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>PO line</th><th class="num">Accepted</th><th class="num">Invoiced before</th><th style="width:100px">Qty on this invoice</th><th style="width:110px">Rate (₹)</th></tr></thead><tbody>${pr.map((l) => `<tr><td>${esc(l.desc)}<div class="tiny muted">PO rate ${inr(l.rate)} · GST ${pctTxt(l.taxBp)}</div></td><td class="num">${qtyTxt(l.accepted)} ${esc(l.uom)}</td><td class="num">${qtyTxt(l.invoiced)}</td><td><input class="i" name="q_${esc(l.id)}" id="in-q-${esc(l.id)}" inputmode="decimal" value="${l.accepted > l.invoiced ? esc(qtyIn(l.accepted - l.invoiced)) : ''}"></td><td><input class="i" name="r_${esc(l.id)}" id="in-r-${esc(l.id)}" inputmode="decimal" value="${esc(rupeesIn(l.rate))}"></td></tr>`).join('')}</tbody></table></div>` : '';
  return `${mhead('Record supplier invoice', 'Checked for duplicates and matched against the PO and goods received')}<form data-f="erp-inv-new" data-po="${esc(fixedPo || '')}"><div class="body grid">
    <div class="grid two"><label class="f">Supplier<select class="i" id="in-sup" name="supplierId" data-c="inSup" required ${po ? 'disabled' : ''}>${opts(erpList('erp_sup').map((s) => [s.id, s.name]), supId, 'Pick a supplier')}</select>${po ? `<input type="hidden" name="supplierId" value="${esc(po.supplierId)}">` : ''}</label>
    <label class="f">Purchase order<select class="i" id="in-po" name="poId" data-c="inPo" ${fixedPo ? 'disabled' : ''}>${opts(pos.map((p) => [p.id, `${p.code} · ${inr(p.total)}`]), poId || '', 'No PO (e.g. utilities)')}</select></label>
    <label class="f">Supplier’s invoice number<input class="i" id="in-no" name="invoiceNo" required></label><label class="f">Invoice date<input type="date" class="i" id="in-d" name="date" required max="${today()}"></label>
    <label class="f">Invoice total incl. GST (₹)<input class="i" id="in-a" name="amount" required inputmode="decimal"></label><label class="f">of which GST (₹)<input class="i" id="in-t" name="tax" inputmode="decimal"></label>
    <label class="f">Other charges on the invoice (₹)<input class="i" id="in-c" name="charges" inputmode="decimal"></label><label class="f">Due date<input type="date" class="i" id="in-du" name="due"></label>
    <label class="f">Tally voucher (optional)<input class="i" id="in-tl" name="tallyRef"></label></div>
    ${lines}
    <label class="f">The invoice (PDF or image)<input type="file" class="i" id="in-f" name="files" multiple required></label>
    <div id="inv-dupbox">${ERPUI.invDup || ''}</div>
    ${ERPUI.dup ? `<div class="card body" style="background:var(--bad-soft);border:0"><b>${esc(ERPUI.dup)}</b>${erpHas('pur.approve') || erpHas('acc.approve') ? '<label class="f" style="margin-top:6px">If this really is a different invoice, say why (recorded)<input class="i" name="override" id="in-ov"></label>' : '<p class="small">Only an approver can record a duplicate invoice number.</p>'}</div>` : ''}
    </div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button type="button" class="btn" data-a="erp-inv-dupcheck">Check for duplicates</button><button class="btn pri">Save invoice</button></footer></form>`;
}
function invModal(id) {
  const i = erpGet('erp_inv', id);
  if (!i) return `${mhead('Invoice')}<div class="body">${empty('This invoice isn’t available.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const x = ERPUI.pAct, L2 = pLiability(i), acc = erpHas('acc'), pur = erpHas('pur'), apr = erpHas('pur.approve') || erpHas('acc.approve');
  const advs = i.poId ? pAdvances(i.poId).list.filter((p) => erpPaid(p) > 0) : [];
  const f = (k, title, inner, btn = 'Save', tone = 'pri') => (x === k ? `<form data-f="erp-inv-act" data-id="${i.id}" data-x="${k}" class="card body" style="background:var(--sunk);border:0"><h3>${title}</h3><div class="grid two">${inner}</div><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-p-act" data-x="">Back</button><button class="btn ${tone}">${btn}</button></div></form>` : '');
  const forms = f('credit', 'Credit note / return', `<label class="f">Credit note number<input class="i" name="no" id="ic-no" required></label><label class="f">Date<input type="date" class="i" name="date" id="ic-d" required value="${today()}"></label><label class="f">Amount (₹)<input class="i" name="amount" id="ic-a" required inputmode="decimal"></label><label class="f">Reason<input class="i" name="note" id="ic-n" required></label><label class="f full">Credit note copy<input type="file" class="i" name="files" multiple></label>`, 'Record credit note')
    + f('adjust', 'Adjust a paid advance', `<label class="f">Advance<select class="i" name="payId" id="ia-p" required>${opts(advs.map((p) => [p.id, `${p.code} · paid ${inr(erpPaid(p))}`]), '', 'Pick the advance')}</select></label><label class="f">Amount to adjust (₹)<input class="i" name="amount" id="ia-a" required inputmode="decimal" value="${esc(rupeesIn(Math.min(pAdvances(i.poId || '').unadjusted, L2.requestable) || null))}"></label>`, 'Adjust')
    + f('pay', 'Request payment', `<p class="tiny muted full">Payable ${inr(L2.payable)} − already requested ${inr(L2.requestedOpen)} = up to <b>${inr(L2.requestable)}</b>.</p><label class="f">Amount (₹)<input class="i" name="amount" id="ip-a" inputmode="decimal" value="${esc(rupeesIn(Math.max(0, L2.requestable)))}"></label><label class="f">Pay on<input type="date" class="i" name="proposedDate" id="ip-d" value="${esc(i.due || '')}"></label>`, 'Send to Accounts')
    + ['dispute', 'cancel', 'verify', 'accept', 'undispute'].map((k) => f(k, { dispute: 'Dispute', cancel: 'Cancel invoice', verify: 'Verify invoice', accept: 'Accept the differences', undispute: 'Resolve dispute' }[k], `<label class="f full">${k === 'verify' ? 'What you checked (optional)' : k === 'accept' ? 'Why the differences are acceptable (recorded)' : 'Reason'}<input class="i" name="note" id="ix-n" ${k === 'verify' || k === 'undispute' ? '' : 'required'}></label>`, { dispute: 'Dispute', cancel: 'Cancel invoice', verify: 'Verify', accept: 'Accept differences', undispute: 'Resolve' }[k], ['dispute', 'cancel'].includes(k) ? 'danger' : 'pri')).join('');
  const can = {
    verify: acc && i.status === 'RECEIVED' && i.createdBy !== S.me.id, accept: apr && i.status === 'DISCREPANCY' && i.createdBy !== S.me.id,
    pay: (acc || pur) && i.status === 'VERIFIED' && L2.requestable > 0, adjust: (acc || pur) && advs.length && i.status !== 'CANCELLED' && L2.requestable > 0,
    credit: (acc || pur) && i.status !== 'CANCELLED' && L2.payable > 0, rematch: (acc || pur) && ['RECEIVED', 'DISCREPANCY'].includes(i.status) && i.poId,
    dispute: (acc || pur) && !['DISPUTED', 'CANCELLED'].includes(i.status), undispute: (acc || pur) && i.status === 'DISPUTED', cancel: (acc || pur) && i.status !== 'CANCELLED' && !L2.linked.length,
  };
  const LBL = { verify: 'Verify', accept: 'Accept differences', pay: 'Request payment', adjust: 'Adjust advance', credit: 'Credit note', rematch: 'Match again', dispute: 'Dispute', undispute: 'Resolve dispute', cancel: 'Cancel' };
  const btns = Object.keys(LBL).filter((k) => can[k]).map((k) => (k === 'rematch' ? `<button class="btn sm" data-a="erp-inv-rematch" data-id="${i.id}">${LBL[k]}</button>` : `<button class="btn sm ${['verify', 'pay'].includes(k) ? 'pri' : ['cancel', 'dispute'].includes(k) ? 'danger' : ''}" data-a="erp-p-act" data-x="${k}">${LBL[k]}</button>`)).join('');
  const row = (l, v) => `<div><div class="tiny muted">${l}</div><div>${v}</div></div>`;
  return `${mhead(`${esc(i.code)} · ${esc(i.supplierName)} ${esc(i.invoiceNo)}`, `${pill(INV_ST, i.status)} dated ${fmtD(i.date)}${i.poCode ? ` · ${esc(i.poCode)}` : ''}`)}<div class="body grid">
    <div class="grid two" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${row('Invoice', inr(i.amount))}${row('Credit notes', `− ${inr(L2.credits)}`)}${row('Advances adjusted', `− ${inr(L2.adjusted)}`)}${row('Paid', `− ${inr(L2.paid)}`)}${row('Still payable', `<b>${inr(L2.payable)}</b>`)}${row('Requested, unpaid', inr(L2.requestedOpen))}${row('Due', i.due ? fmtD(i.due) : '—')}${row('Entered by', esc(nameOf(i.createdBy)))}${row('Verified by', i.verifiedBy ? esc(nameOf(i.verifiedBy)) : '—')}</div>
    ${i.poId ? `<div class="card body" style="background:${i.match?.ok ? 'var(--ok-soft)' : i.match?.accepted ? 'var(--warn-soft)' : 'var(--bad-soft)'};border:0"><b>PO / goods receipt / invoice match:</b> ${i.match?.ok ? 'everything matches.' : `<ul class="small" style="margin:4px 0">${(i.match?.issues || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>${i.match?.accepted ? `Accepted by ${esc(nameOf(i.match.accepted.by))}: “${esc(i.match.accepted.reason)}”` : ''}`}</div>` : ''}
    ${i.dupOverride ? `<div class="card body" style="background:var(--bad-soft);border:0"><b>Recorded despite a duplicate number</b> (${esc(i.dupOverride.of.join(', '))}) by ${esc(nameOf(i.dupOverride.by))}: “${esc(i.dupOverride.reason)}”</div>` : ''}
    ${(i.warnings || []).length ? `<div class="card body" style="background:var(--warn-soft);border:0"><b>Possible duplicates to check:</b><ul class="small" style="margin:4px 0">${i.warnings.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    ${(i.lines || []).length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Line</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">GST</th></tr></thead><tbody>${i.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${qtyTxt(l.qty)} ${esc(l.uom)}</td><td class="num">${inr(l.rate)}</td><td class="num">${pctTxt(l.taxBp)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${forms || (btns ? `<div class="row" style="gap:6px">${btns}</div>` : '')}
    ${(i.creditNotes || []).length ? `<div><h3>Credit notes</h3><ul class="small">${i.creditNotes.map((c) => `<li>${esc(c.no)} · ${fmtD(c.date)} · ${inr(c.amount)} — ${esc(c.reason)}</li>`).join('')}</ul></div>` : ''}
    ${(i.advanceAdj || []).length ? `<div><h3>Advances adjusted</h3><ul class="small">${i.advanceAdj.map((a, k) => `<li>${esc(a.code)} · ${inr(a.amount)} · ${esc(nameOf(a.by))}${acc ? ` <button class="btn sm ghost" data-a="erp-inv-unadj" data-id="${i.id}" data-i="${k}">Remove</button>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${L2.linked.length ? `<div><h3>Payment requests</h3><ul class="small">${L2.linked.map((p) => `<li><button class="btn sm ghost" data-a="erp-pay" data-id="${p.id}">${esc(p.code)}</button> ${inr(p.amountApproved ?? p.amountReq)} · paid ${inr(erpPaid(p))} · ${pill(PAY_ST, p.status)}</li>`).join('')}</ul></div>` : ''}
    <div><div class="tiny muted">Documents</div>${fileList(i.files)}</div>
    <details><summary class="small">History</summary><ul class="small">${(i.history || []).slice().reverse().map((h) => `<li><span class="tiny muted">${fmtDT(h.at)}</span> ${esc(nameOf(h.by))} — ${esc(h.action)}${h.note ? `: “${esc(h.note)}”` : ''}</li>`).join('')}</ul></details>
    </div><footer><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}

/* ── suppliers ── */
function purSuppliers() {
  const list = erpList('erp_sup');
  return card(`Suppliers · ${list.length}`, dataTable('puS', list, [
    { k: 'code', label: 'Code', v: (s) => s.code, html: (s) => `<b class="small">${esc(s.code)}</b>` },
    { k: 'name', label: 'Supplier', v: (s) => s.name, html: (s) => `${esc(s.name)}<div class="tiny muted">${esc(s.gstin || 'No GSTIN')}${s.msme ? ' · MSME' : ''}</div>` },
    { k: 'terms', label: 'Terms', v: (s) => s.terms || '' }, { k: 'bank', label: 'Bank account', v: (s) => s.bankLast4 || '', html: (s) => `${s.bankLast4 ? `XXXX${esc(s.bankLast4)}` : '—'}${s.bankPending ? ' <span class="pill t-warn">Change to verify</span>' : ''}` },
    { k: 'open', label: 'Committed', num: true, v: (s) => sumBy(erpList('erp_po').filter((p) => p.supplierId === s.id && p.status === 'APPROVED'), (p) => p.total - poPaid(p)), html: (s) => inr(sumBy(erpList('erp_po').filter((p) => p.supplierId === s.id && p.status === 'APPROVED'), (p) => p.total - poPaid(p))) },
    { k: 'st', label: 'Status', v: (s) => s.status, html: (s) => pill(SUP_ST, s.status) },
  ], { name: 'Suppliers', click: (s) => `data-a="erp-sup" data-id="${s.id}"`, empty: 'No suppliers yet.' }), { list: true, actions: erpHas('pur') ? '<button class="btn pri sm" data-a="erp-sup-new">Add supplier</button>' : '' });
}
function supModal(id) {
  const s = id ? erpGet('erp_sup', id) : null, x = ERPUI.pAct, sb = id ? erpGet('erp_supbank', id) : null;
  const form = `<form data-f="erp-sup" data-id="${s?.id || ''}" class="grid two">
    <label class="f">Name<input class="i" id="su-n" name="name" required value="${esc(s?.name || '')}"></label><label class="f">GSTIN<input class="i" id="su-g" name="gstin" value="${esc(s?.gstin || '')}" maxlength="15"></label>
    <label class="f">Contact person<input class="i" id="su-c" name="contact" value="${esc(s?.contact || '')}"></label><label class="f">Phone<input class="i" id="su-p" name="phone" value="${esc(s?.phone || '')}"></label>
    <label class="f">Email<input class="i" id="su-e" name="email" value="${esc(s?.email || '')}"></label><label class="f">PAN<input class="i" id="su-pan" name="pan" value="${esc(s?.pan || '')}" maxlength="10"></label>
    <label class="f">Payment terms<input class="i" id="su-t" name="terms" value="${esc(s?.terms || '')}"></label><label class="row small" style="gap:6px;align-items:center"><input type="checkbox" name="msme" ${s?.msme ? 'checked' : ''}> MSME registered</label>
    <label class="f full">Address<input class="i" id="su-a" name="address" value="${esc(s?.address || '')}"></label>
    <div class="full row"><span style="flex:1"></span>${erpHas('pur') ? '<button class="btn pri">Save supplier</button>' : ''}</div></form>`;
  if (!s) return `${mhead('Add supplier', 'A purchase approver approves new suppliers')}<div class="body">${form}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const bankForm = x === 'bank' ? `<form data-f="erp-sup-bank" data-id="${s.id}" class="card body" style="background:var(--sunk);border:0"><h3>New bank details</h3><p class="tiny muted">They go live only after someone else in Accounts verifies them with the supplier on a known phone number.</p><div class="grid two"><label class="f">Account holder<input class="i" name="holder" id="sb-h" required></label><label class="f">Bank<input class="i" name="bank" id="sb-b" required></label><label class="f">Account number<input class="i" name="account" id="sb-a" required inputmode="numeric" autocomplete="off"></label><label class="f">IFSC<input class="i" name="ifsc" id="sb-i" required></label><label class="f full">Why (e.g. supplier’s letter dated …)<input class="i" name="reason" id="sb-r"></label><label class="f full">Cancelled cheque / bank letter<input type="file" class="i" name="files" multiple required></label></div><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-p-act" data-x="">Back</button><button class="btn pri">Send for verification</button></div></form>` : '';
  const pend = sb?.pending;
  const verifyForm = x === 'bankok' && pend ? `<form data-f="erp-sup-bankok" data-id="${s.id}" class="card body" style="background:var(--sunk);border:0"><h3>Verify the new account</h3><p class="small">${esc(pend.holder)} · ${esc(pend.bank)} · ${esc(pend.account)} · ${esc(pend.ifsc)} — entered by ${esc(nameOf(pend.proposedBy))}</p>${fileList(pend.files)}<label class="f">How you verified it<input class="i" name="how" id="sv-h" placeholder="e.g. called Mr Rao on the number in our records; confirmed the account number"></label><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-p-act" data-x="">Back</button><button class="btn danger" name="go" value="reject">Reject</button><button class="btn pri" name="go" value="ok">Verified — make it live</button></div></form>` : '';
  const btns = [
    s.status === 'PENDING' && erpHas('pur.approve') && s.createdBy !== S.me.id && `<button class="btn sm pri" data-a="erp-sup-approve" data-id="${s.id}">Approve supplier</button>`,
    s.status !== 'BLOCKED' && erpHas('pur.approve') && `<button class="btn sm danger" data-a="erp-sup-block" data-id="${s.id}">Block</button>`,
    (erpHas('pur') || erpHas('acc')) && '<button class="btn sm" data-a="erp-p-act" data-x="bank">Change bank details</button>',
    pend && erpHas('acc') && pend.proposedBy !== S.me.id && '<button class="btn sm pri" data-a="erp-p-act" data-x="bankok">Verify bank change</button>',
  ].filter(Boolean).join('');
  return `${mhead(`${esc(s.code)} · ${esc(s.name)}`, pill(SUP_ST, s.status))}<div class="body grid">
    ${bankForm || verifyForm || (btns ? `<div class="row" style="gap:6px">${btns}</div>` : '')}
    <p class="small">Bank account: ${s.bankLast4 ? `XXXX${esc(s.bankLast4)}` : 'not set'}${erpHas('acc') && sb?.account ? ` · ${esc(sb.bank)} ${esc(sb.account)} ${esc(sb.ifsc)} (verified by ${esc(nameOf(sb.verifiedBy))})` : ''}${s.bankPending ? ' · <span class="pill t-warn">change waiting for verification</span>' : ''}</p>
    ${form}</div><footer><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}

/* ── payment screen additions (part20 calls these) ── */
function payChecks(p, forApprove) {
  if (!['SUPPLIER', 'ADVANCE'].includes(p.category) || (!p.poId && !p.invoiceId && !p.supplierId)) return '';
  const C = p.checks;
  const list = C ? `<ul class="small full" style="margin:0;padding-left:18px">${C.map((c) => `<li>${c.ok ? '✅' : c.blocking ? '⛔' : '⚠️'} ${esc(c.label)}${c.detail ? ` <span class="tiny muted">— ${esc(c.detail)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="tiny muted full">The eligibility checks run when Accounts verifies the request.</p>';
  const blocking = (C || []).some((c) => c.blocking);
  return `<div class="full"><b class="small">Payment eligibility</b>${list}</div>${forApprove && blocking ? '<label class="f full">This doesn’t pass every check. If it is a legitimate exception (e.g. a contractual advance), explain why — recorded in the audit log<input class="i" id="pa-ex" name="exception"></label>' : ''}`;
}
function payLinks(p) {
  const po = p.poId ? erpGet('erp_po', p.poId) : null, inv = p.invoiceId ? erpGet('erp_inv', p.invoiceId) : null;
  if (!po && !inv) return p.checks ? `<div>${payChecks(p, false)}</div>` : '';
  return `<div class="row" style="gap:6px">${po ? `<button class="btn sm ghost" data-a="erp-po" data-id="${po.id}">${esc(po.code)}</button>` : ''}${inv ? `<button class="btn sm ghost" data-a="erp-inv" data-id="${inv.id}">Invoice ${esc(inv.invoiceNo)}</button>` : ''}${p.advanceOverride ? ` <span class="pill t-bad">Advance over PO terms: “${esc(p.advanceOverride.reason)}”</span>` : ''}</div>${p.checks && p.status !== 'UNDER_REVIEW' ? `<div>${payChecks(p, false)}</div>` : ''}`;
}

/* ── actions and forms ── */
ERPUI.pAct = null;
Object.assign(ERP_ACTIONS, {
  'erp-rows': (el) => { ERPUI[el.dataset.k] = +(el.dataset.n || rowsUI(el.dataset.k, 1) + 1); drawModal(); },
  'erp-p-act': (el) => { ERPUI.pAct = el.dataset.x || null; ERPUI.dup = null; drawModal(); },
  'erp-pr-new': () => { ERPUI.prRows = 1; openModal(() => prNewModal()); },
  'erp-pr': (el) => openModal(() => prModal(el.dataset.id)),
  'erp-pr-cancel': (el) => confirmBox('Cancel this requisition?', 'Give a reason — it is kept with the requisition.', (reason) => erpAct(async () => { await erpCall('pr.act', { id: el.dataset.id, action: 'cancel', note: reason }); }, 'Requisition cancelled'), { input: 'Reason' }),
  'erp-po-new': (el) => { ERPUI.poRows = 1; ERPUI.pAct = null; openModal(() => poNewModal(el.dataset.pr || null)); },
  'erp-po': (el) => { ERPUI.pAct = null; ERPUI.dup = null; openModal(() => poModal(el.dataset.id)); },
  'erp-po-approve': (el) => erpAct(async () => { await erpCall('po.act', { id: el.dataset.id, action: 'approve' }); drawModal(); }, 'Purchase order approved'),
  'erp-po-submit': (el) => erpAct(async () => { await erpCall('po.act', { id: el.dataset.id, action: 'submit' }); drawModal(); }, 'Submitted for approval'),
  'erp-inv-new': (el) => { ERPUI.dup = null; ERPUI.invDup = ''; S.ui.inSup = null; S.ui.inPo = null; openModal(() => invNewModal(el.dataset.po || null)); },
  'erp-inv': (el) => { ERPUI.pAct = null; openModal(() => invModal(el.dataset.id)); },
  'erp-inv-rematch': (el) => erpAct(async () => { await erpCall('inv.act', { id: el.dataset.id, action: 'rematch' }); drawModal(); }, 'Matched again'),
  'erp-inv-unadj': (el) => confirmBox('Remove this advance adjustment?', 'The advance becomes unadjusted again. Give a reason.', (reason) => erpAct(() => erpCall('inv.act', { id: el.dataset.id, action: 'unadjust', index: +el.dataset.i, note: reason }), 'Adjustment removed'), { input: 'Reason' }),
  'erp-inv-dupcheck': () => erpAct(async () => {
    const f = $('form[data-f="erp-inv-new"]'); if (!f) return;
    const v = (k) => String(new FormData(f).get(k) ?? '').trim();
    if (!v('supplierId') || !v('invoiceNo')) return;
    const r = await erpCall('inv.check', { supplierId: v('supplierId'), invoiceNo: v('invoiceNo'), amount: v('amount') || null, date: v('date') || null });
    ERPUI.invDup = r.matches.length ? `<div class="card body" style="background:${r.matches.some((m) => m.kind === 'EXACT') ? 'var(--bad-soft)' : 'var(--warn-soft)'};border:0"><b>${r.matches.some((m) => m.kind === 'EXACT') ? 'Already recorded:' : 'Check these first:'}</b><ul class="small" style="margin:4px 0">${r.matches.map((m) => `<li><b>${esc(m.code)}</b> — ${esc(m.why)}</li>`).join('')}</ul></div>` : '<p class="small" style="color:var(--ok)">No duplicates found for this supplier and number.</p>';
    const box = $('#inv-dupbox'); if (box) box.innerHTML = ERPUI.invDup;
  }),
  'erp-sup-new': () => openModal(() => supModal(null)),
  'erp-sup': (el) => { ERPUI.pAct = null; openModal(() => supModal(el.dataset.id)); },
  'erp-sup-approve': (el) => erpAct(async () => { await erpCall('sup.approve', { id: el.dataset.id }); drawModal(); }, 'Supplier approved'),
  'erp-sup-block': (el) => confirmBox('Block this supplier?', 'No new purchase orders can be raised for a blocked supplier.', (reason) => erpAct(() => erpCall('sup.approve', { id: el.dataset.id, status: 'BLOCKED', reason }), 'Supplier blocked'), { input: 'Reason' }),
});
const vals = (fd, k) => fd.getAll(k).map((x) => String(x).trim());
Object.assign(ERP_FORMS, {
  'erp-pr-new': (form, fd, v, sub) => erpAct(async () => {
    const d = vals(fd, 'desc'), q = vals(fd, 'qty'), u = vals(fd, 'uom'), r = vals(fd, 'estRate');
    const items = d.map((desc, i) => ({ desc, qty: q[i], uom: u[i], estRate: r[i] })).filter((x) => x.desc);
    const files = await erpFiles(form.querySelector('[name="files"]'));
    await erpCall('pr.save', { items, needBy: v('needBy'), costCentre: v('costCentre'), justification: v('justification'), files, submit: sub?.value !== 'draft' }); closeModal();
  }, sub?.value === 'draft' ? 'Draft saved' : 'Requisition submitted'),
  'erp-pr-act': (form, fd, v, sub) => erpAct(async () => { await erpCall('pr.act', { id: form.dataset.id, action: sub?.value || 'approve', note: v('note') }); drawModal(); }, 'Saved'),
  'erp-po-new': (form, fd, v, sub) => erpAct(async () => { await erpCall('po.save', await poArgs(form, fd, v, { prId: form.dataset.pr || undefined, submit: sub?.value !== 'draft' })); closeModal(); }, sub?.value === 'draft' ? 'Draft saved' : 'Purchase order submitted for approval'),
  'erp-po-revise': (form, fd, v) => erpAct(async () => { await erpCall('po.revise', { id: form.dataset.id, reason: v('reason'), ...(await poArgs(form, fd, v, {})) }); ERPUI.pAct = null; drawModal(); }, 'Revision submitted for approval'),
  'erp-po-act': (form, fd, v) => erpAct(async () => { await erpCall('po.act', { id: form.dataset.id, action: form.dataset.x, note: v('note') }); ERPUI.pAct = null; drawModal(); }, 'Saved'),
  'erp-po-adv': (form, fd, v) => erpAct(async () => {
    try { await erpCall('po.advance', { id: form.dataset.id, amount: v('amount'), due: v('due'), note: v('note'), clientKey: form.dataset.k, ...(v('override') ? { override: { reason: v('override') } } : {}) }); ERPUI.pAct = null; ERPUI.dup = null; drawModal(); } catch (e) { if (e?.code === 'conflict') { ERPUI.dup = e.message; form.dataset.k = ckey(); drawModal(); } throw e; }
  }, 'Advance request sent to Accounts'),
  'erp-inv-new': (form, fd, v) => erpAct(async () => {
    const poId = form.dataset.po || v('poId') || null, po = poId ? erpGet('erp_po', poId) : null;
    const lines = po ? po.lines.map((l) => ({ poLineId: l.id, qty: v('q_' + l.id), rate: v('r_' + l.id) })) : [];
    const files = await erpFiles(form.querySelector('[name="files"]'));
    try {
      const r = await erpCall('inv.save', { supplierId: v('supplierId'), poId: poId || undefined, invoiceNo: v('invoiceNo'), date: v('date'), amount: v('amount'), tax: v('tax'), charges: v('charges'), due: v('due'), tallyRef: v('tallyRef'), lines, files, ...(v('override') ? { override: { reason: v('override') } } : {}) });
      ERPUI.dup = null; closeModal();
      if (r.issues?.length) toast(`Saved with differences: ${r.issues[0]}`, 'warn');
      return r;
    } catch (e) { if (e?.code === 'conflict') { ERPUI.dup = e.message; drawModal(); } throw e; }
  }, 'Invoice recorded'),
  'erp-inv-act': (form, fd, v) => erpAct(async () => {
    const x = form.dataset.x, files = form.querySelector('[name="files"]') ? await erpFiles(form.querySelector('[name="files"]')) : undefined;
    await erpCall('inv.act', { id: form.dataset.id, action: x, note: v('note') || undefined, amount: v('amount') || undefined, no: v('no') || undefined, date: v('date') || undefined, payId: v('payId') || undefined, proposedDate: v('proposedDate') || undefined, files });
    ERPUI.pAct = null; drawModal();
  }, 'Saved'),
  'erp-sup': (form, fd, v) => erpAct(async () => { const r = await erpCall('sup.save', { id: form.dataset.id || undefined, name: v('name'), gstin: v('gstin'), contact: v('contact'), phone: v('phone'), email: v('email'), pan: v('pan'), terms: v('terms'), msme: fd.get('msme') === 'on', address: v('address') }); if (!form.dataset.id) closeModal(); else drawModal(); return r; }, 'Supplier saved'),
  'erp-sup-bank': (form, fd, v) => erpAct(async () => { const files = await erpFiles(form.querySelector('[name="files"]')); await erpCall('sup.bank', { id: form.dataset.id, holder: v('holder'), bank: v('bank'), account: v('account'), ifsc: v('ifsc'), reason: v('reason'), files }); ERPUI.pAct = null; drawModal(); }, 'Sent to Accounts for verification'),
  'erp-sup-bankok': (form, fd, v, sub) => erpAct(async () => { await erpCall('sup.bankVerify', { id: form.dataset.id, how: v('how'), reject: sub?.value === 'reject', reason: v('how') }); ERPUI.pAct = null; drawModal(); }, sub?.value === 'reject' ? 'Bank change rejected' : 'Bank details are now live'),
});
async function poArgs(form, fd, v, extra) {
  const d = vals(fd, 'desc'), q = vals(fd, 'qty'), u = vals(fd, 'uom'), r = vals(fd, 'rate'), tx = vals(fd, 'tax'), ids = vals(fd, 'lid'), items = vals(fd, 'itemId');
  const lines = d.map((desc, i) => ({ id: ids[i] || undefined, desc, qty: q[i], uom: u[i], rate: r[i], tax: tx[i], itemId: items[i] || undefined })).filter((x) => x.desc);
  const files = await erpFiles(form.querySelector('[name="files"]'));
  return { supplierId: v('supplierId') || form.querySelector('#po-sup')?.value, kind: v('kind'), lines, charges: v('charges'), deliveryLocation: v('deliveryLocation'), expectedDate: v('expectedDate'), terms: v('terms'), advanceType: v('advanceType'), advanceValue: v('advanceValue'), balanceTerms: v('balanceTerms'), files, ...extra };
}
</script>
