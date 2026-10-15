<script>
/* ═════════════ Stores: expected deliveries, goods receipts, inventory ═════════════
   A goods receipt (GRN) records what physically arrived against a PO; a second person verifies it. Verified receipts
   feed Purchase (delivery progress) and Accounts (payment checks) — a GRN never marks anything paid.
   Current stock is the sum of stock movements (server/erp-stores.js). */

const GRN_ST = { RECORDED: ['To verify', 't-warn'], VERIFIED: ['Verified', 't-ok'], REVERSED: ['Reversed', ''] };
const QC_ST = { PASSED: ['Passed', 't-ok'], FAILED: ['Failed', 't-bad'], PARTIAL: ['Partly passed', 't-warn'], NOT_REQUIRED: ['Not required', ''], PENDING: ['Inspection pending', 't-warn'] };
const stockOf = (itemId) => sumBy(erpList('erp_stk').filter((m) => m.itemId === itemId), (m) => m.qty);

function vStores2() {
  if (!erpHas('sto') && !erpHas('pur')) return erpNoAccess('Stores', 'Stores is for the Stores team.');
  erpUse('erp_cfg', 'erp_po', 'erp_grn', 'erp_sup', 'erp_item', 'erp_stk');
  if (S.ui.erpOpen && S.ui.erpKind === 'grn') { const id = S.ui.erpOpen; S.ui.erpOpen = null; ERPUI.gAct = null; setTimeout(() => openModal(() => grnModal(id)), 0); }
  const toVerify = erpList('erp_grn').filter((g) => g.status === 'RECORDED' && g.receivedBy !== S.me.id && (erpHas('sto.verify') || (g.kind === 'SERVICE' && erpHas('pur.approve'))));
  const low = erpList('erp_item').filter((i) => i.reorder && stockOf(i.id) <= i.reorder);
  const { cur, html } = erpTabs('stTab', [['exp', 'Expected deliveries'], ['grn', 'Goods receipts', toVerify.length || ''], ['inv', 'Inventory', low.length || ''], ['rej', 'Rejected & damaged']], 'exp');
  const body = erpLoading('erp_po', 'erp_grn') ? '<div class="body muted small">Loading…</div>' : { exp: stoExpected, grn: () => stoGrns(toVerify), inv: () => stoInventory(low), rej: stoRejected }[cur]();
  return shell(`${html}${body}`, 'Stores', 'What is due, what arrived, and what is in stock');
}

function stoExpected() {
  const T = today(), loc = ui('stLoc', '');
  const pos = erpList('erp_po').filter((p) => p.status === 'APPROVED' && p.kind !== 'SERVICES' && (!loc || p.deliveryLocation === loc));
  const rows = pos.map((p) => ({ p, pr: pProgress(p) })).filter((x) => x.pr.some((l) => l.qty > l.accepted + l.pending));
  const locs = [...new Set(erpList('erp_po').map((p) => p.deliveryLocation).filter(Boolean))];
  return `<div class="filters rd-filters"><select class="i" id="st-loc" data-c="stLoc" aria-label="Location">${opts(locs.map((l) => [l, l]), loc, 'All locations')}</select></div>
    ${card(`Expected deliveries · ${rows.length}`, dataTable('stE', rows, [
      { k: 'po', label: 'PO', v: (x) => x.p.code, html: (x) => `<b class="small">${esc(x.p.code)}</b><div class="tiny muted">${esc(x.p.deliveryLocation)}</div>` },
      { k: 'sup', label: 'Supplier', v: (x) => x.p.supplierName },
      { k: 'what', label: 'Still to come', v: (x) => x.pr.map((l) => l.desc).join(', '), html: (x) => x.pr.filter((l) => l.qty > l.accepted + l.pending).map((l) => `<div class="small">${esc(l.desc)}: <b>${qtyTxt(l.qty - l.accepted - l.pending)}</b> ${esc(l.uom)}${l.accepted ? ` <span class="tiny muted">(${qtyTxt(l.accepted)} received)</span>` : ''}</div>`).join('') },
      { k: 'due', label: 'Expected', v: (x) => x.p.expectedDate, html: (x) => `${fmtD(x.p.expectedDate)}${x.p.expectedDate < T ? ` <span class="pill t-bad">${Math.round((Date.parse(T) - Date.parse(x.p.expectedDate)) / 864e5)} days late</span>` : ''}` },
      { k: 'act', label: '', v: () => '', html: (x) => (erpHas('sto') ? `<button class="btn sm pri" data-a="erp-grn-new" data-po="${x.p.id}">Receive</button>` : '') },
    ], { name: 'Expected deliveries', empty: 'Nothing is due.' }), { list: true })}`;
}
function stoGrns(toVerify) {
  const st = ui('grSt', ''), list = erpList('erp_grn').filter((g) => !st || g.status === st);
  return `<div class="filters rd-filters"><select class="i" id="gr-st" data-c="grSt" aria-label="Status">${opts(Object.entries(GRN_ST).map(([k, v]) => [k, v[0]]), st, 'All')}</select></div>
    ${card(`Goods receipts · ${list.length}`, dataTable('stG', list, [
      { k: 'code', label: 'GRN', v: (g) => g.code, html: (g) => `<b class="small">${esc(g.code)}</b>${toVerify.includes(g) ? ' <span class="pill t-warn">You</span>' : ''}<div class="tiny muted">${g.kind === 'SERVICE' ? 'Service acceptance' : 'Challan ' + esc(g.challanNo)}</div>` },
      { k: 'po', label: 'PO · supplier', v: (g) => `${g.poCode} ${g.supplierName}`, html: (g) => `${esc(g.poCode)}<div class="tiny muted">${esc(g.supplierName)}</div>` },
      { k: 'date', label: 'Received', v: (g) => g.deliveryDate, html: (g) => `${fmtD(g.deliveryDate)}<div class="tiny muted">${esc(nameOf(g.receivedBy))}</div>` },
      { k: 'what', label: 'Accepted / rejected', v: (g) => g.lines.length, html: (g) => g.lines.map((l) => `<div class="small">${esc(l.desc.slice(0, 40))}: ${qtyTxt(l.accepted)}${l.rejected + (l.damaged || 0) ? ` <span class="v bad">/ ${qtyTxt(l.rejected + (l.damaged || 0))} rejected</span>` : ''} ${esc(l.uom)} ${l.qc === 'PENDING' ? pill(QC_ST, 'PENDING') : ''}</div>`).join('') },
      { k: 'st', label: 'Status', v: (g) => g.status, html: (g) => pill(GRN_ST, g.status) },
    ], { name: 'GRN register', click: (g) => `data-a="erp-grn" data-id="${g.id}"`, empty: 'No goods receipts yet.' }), { list: true })}`;
}
function grnNewModal(poId) {
  const p = erpGet('erp_po', poId);
  if (!p) return `${mhead('Goods receipt')}<div class="body">${empty('Pick an approved purchase order.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const pr = pProgress(p), svc = p.kind === 'SERVICES';
  return `${mhead(`${svc ? 'Accept work' : 'Receive goods'} · ${esc(p.code)}`, `${esc(p.supplierName)} — record what physically ${svc ? 'was delivered' : 'arrived'}; someone else verifies it`)}<form data-f="erp-grn-new" data-po="${p.id}"><div class="body grid">
    <div class="grid two">${svc ? '' : '<label class="f">Delivery challan number<input class="i" id="gr-ch" name="challanNo" required></label><label class="f">Vehicle number (optional)<input class="i" id="gr-v" name="vehicle"></label>'}
      <label class="f">${svc ? 'Completion date' : 'Date received'}<input type="date" class="i" id="gr-d" name="deliveryDate" required max="${today()}" value="${today()}"></label>
      <label class="f">Receiving location<input class="i" id="gr-l" name="location" required value="${esc(p.deliveryLocation)}"></label></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Still to come</th><th style="width:90px">Received</th><th style="width:85px">Rejected</th><th style="width:85px">Damaged</th>${svc ? '' : '<th style="width:140px">Inspection</th>'}<th>Remarks</th></tr></thead><tbody>
    ${pr.map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${qtyTxt(Math.max(0, l.qty - l.accepted - l.pending))} ${esc(l.uom)}</td><td><input class="i" name="rcv_${esc(l.id)}" id="gr-r-${esc(l.id)}" inputmode="decimal"></td><td><input class="i" name="rej_${esc(l.id)}" id="gr-j-${esc(l.id)}" inputmode="decimal"></td><td><input class="i" name="dmg_${esc(l.id)}" id="gr-m-${esc(l.id)}" inputmode="decimal"></td>${svc ? '' : `<td><select class="i" name="qc_${esc(l.id)}" id="gr-q-${esc(l.id)}">${opts(Object.entries(QC_ST).map(([k, v]) => [k, v[0]]), 'PENDING')}</select></td>`}<td><input class="i" name="rmk_${esc(l.id)}" id="gr-k-${esc(l.id)}" placeholder="needed if anything is rejected"></td></tr>`).join('')}
    </tbody></table></div>
    <label class="f">Notes<input class="i" id="gr-n" name="note"></label><label class="f">Challan / photos (optional)<input type="file" class="i" id="gr-f" name="files" multiple></label>
    </div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">${svc ? 'Record acceptance' : 'Record goods received'}</button></footer></form>`;
}
function grnModal(id) {
  const g = erpGet('erp_grn', id);
  if (!g) return `${mhead('Goods receipt')}<div class="body">${empty('This receipt isn’t available.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const x = ERPUI.gAct, verifier = g.kind === 'SERVICE' ? erpHas('pur.approve') || erpHas('sto.verify') : erpHas('sto.verify');
  const canVerify = g.status === 'RECORDED' && verifier && g.receivedBy !== S.me.id;
  const forms = x === 'reverse' ? `<form data-f="erp-grn-act" data-id="${g.id}" data-x="reverse" class="card body" style="background:var(--sunk);border:0"><h3>Reverse this receipt</h3><p class="tiny muted">It stays on record as reversed; record the correct receipt again.</p><label class="f">Reason<input class="i" name="note" id="ga-n" required></label><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-g-act" data-x="">Back</button><button class="btn danger">Reverse</button></div></form>`
    : x === 'qc' ? `<form data-f="erp-grn-act" data-id="${g.id}" data-x="qc" class="card body" style="background:var(--sunk);border:0"><h3>Inspection result</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Accepted</th><th>Result</th><th style="width:110px">Reject now</th></tr></thead><tbody>${g.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${qtyTxt(l.accepted)}</td><td><select class="i" name="qc_${esc(l.poLineId)}">${opts(Object.entries(QC_ST).filter(([k]) => k !== 'PENDING').map(([k, v]) => [k, v[0]]), l.qc === 'PENDING' ? 'PASSED' : l.qc)}</select></td><td><input class="i" name="rej_${esc(l.poLineId)}" inputmode="decimal"></td></tr>`).join('')}</tbody></table></div><label class="f">Inspection notes<input class="i" name="note" id="gq-n" required></label><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-g-act" data-x="">Back</button><button class="btn pri">Save inspection</button></div></form>`
    : x === 'verify' ? `<form data-f="erp-grn-act" data-id="${g.id}" data-x="verify" class="card body" style="background:var(--sunk);border:0"><h3>Verify</h3><p class="small">Check the quantities against the material and the challan before verifying.</p><label class="f">Note (optional)<input class="i" name="note" id="gv-n"></label><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-g-act" data-x="">Back</button><button class="btn pri">Verify receipt</button></div></form>` : '';
  const btns = [canVerify && '<button class="btn sm pri" data-a="erp-g-act" data-x="verify">Verify</button>', g.status === 'VERIFIED' && erpHas('sto.verify') && g.lines.some((l) => l.qc !== 'NOT_REQUIRED') && '<button class="btn sm" data-a="erp-g-act" data-x="qc">Inspection result</button>', g.status !== 'REVERSED' && (erpHas('sto.verify') || (g.kind === 'SERVICE' && erpHas('pur.approve'))) && '<button class="btn sm danger" data-a="erp-g-act" data-x="reverse">Reverse</button>'].filter(Boolean).join('');
  return `${mhead(`${esc(g.code)} · ${esc(g.supplierName)}`, `${pill(GRN_ST, g.status)} ${esc(g.poCode)} · ${g.kind === 'SERVICE' ? 'service acceptance' : 'challan ' + esc(g.challanNo)} · ${fmtD(g.deliveryDate)} · ${esc(g.location)}`)}<div class="body grid">
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Accepted</th><th class="num">Rejected</th><th class="num">Damaged</th><th class="num">Short / excess</th><th>Inspection</th></tr></thead><tbody>${g.lines.map((l) => `<tr><td>${esc(l.desc)}${l.remarks ? `<div class="tiny muted">${esc(l.remarks)}</div>` : ''}</td><td class="num">${qtyTxt(l.ordered)}</td><td class="num">${qtyTxt(l.received)}</td><td class="num"><b>${qtyTxt(l.accepted)}</b></td><td class="num">${l.rejected ? qtyTxt(l.rejected) : '—'}</td><td class="num">${l.damaged ? qtyTxt(l.damaged) : '—'}</td><td class="num">${l.excess ? `+${qtyTxt(l.excess)}` : l.short ? `−${qtyTxt(l.short)}` : '—'}</td><td>${pill(QC_ST, l.qc)}</td></tr>`).join('')}</tbody></table></div>
    <p class="small">Received by ${esc(nameOf(g.receivedBy))} · ${fmtDT(g.receivedAt)}${g.verifiedBy ? ` · verified by ${esc(nameOf(g.verifiedBy))}` : ''}${g.reverseReason ? ` · reversed: “${esc(g.reverseReason)}”` : ''}</p>
    ${forms || (btns ? `<div class="row" style="gap:6px">${btns}</div>` : '')}
    <div><div class="tiny muted">Documents</div>${fileList(g.files)}</div>
    <details><summary class="small">History</summary><ul class="small">${(g.history || []).slice().reverse().map((h) => `<li><span class="tiny muted">${fmtDT(h.at)}</span> ${esc(nameOf(h.by))} — ${esc(h.action)}${h.note ? `: “${esc(h.note)}”` : ''}</li>`).join('')}</ul></details>
    </div><footer><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}
function stoInventory(low) {
  const items = erpList('erp_item'), q = ui('itQ', '').trim().toLowerCase();
  const list = items.filter((i) => !q || `${i.sku} ${i.name} ${i.category}`.toLowerCase().includes(q));
  const moves = erpList('erp_stk').slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 300);
  return `${low.length ? `<div class="card body" style="background:var(--warn-soft);border:0;margin-bottom:12px"><b>Low stock:</b> ${low.map((i) => `${esc(i.name)} (${qtyTxt(stockOf(i.id))} ${esc(i.uom)}, reorder at ${qtyTxt(i.reorder)})`).join(' · ')}</div>` : ''}
    <div class="filters rd-filters"><input class="i" id="it-q" data-i="itQ" placeholder="Search items" value="${esc(ui('itQ', ''))}" aria-label="Search"></div>
    ${card(`Items · ${list.length}`, dataTable('stI', list, [
      { k: 'sku', label: 'Code', v: (i) => i.sku, html: (i) => `<b class="small">${esc(i.sku)}</b>` }, { k: 'name', label: 'Item', v: (i) => i.name, html: (i) => `${esc(i.name)}<div class="tiny muted">${esc(i.category || '')}${i.location ? ' · ' + esc(i.location) : ''}</div>` },
      { k: 'stock', label: 'In stock', num: true, v: (i) => stockOf(i.id), html: (i) => `<span class="${i.reorder && stockOf(i.id) <= i.reorder ? 'v bad' : ''}">${qtyTxt(stockOf(i.id))}</span> ${esc(i.uom)}` },
      { k: 'reorder', label: 'Reorder at', num: true, v: (i) => i.reorder || 0, html: (i) => (i.reorder ? qtyTxt(i.reorder) : '—') },
      { k: 'act', label: '', v: () => '', html: (i) => `<span class="row" style="gap:4px;flex-wrap:nowrap">${erpHas('sto') ? `<button class="btn sm" data-a="erp-stk" data-id="${i.id}" data-x="OUT">Issue</button>` : ''}${erpHas('sto.verify') ? `<button class="btn sm ghost" data-a="erp-stk" data-id="${i.id}" data-x="ADJUST">Count adjustment</button>` : ''}</span>` },
    ], { name: 'Stock', empty: 'No items yet.' }), { list: true, actions: '<button class="btn pri sm" data-a="erp-item-new">Add item</button>' })}
    ${card('Stock movements', dataTable('stM', moves, [
      { k: 'date', label: 'Date', v: (m) => m.date, html: (m) => fmtD(m.date) }, { k: 'item', label: 'Item', v: (m) => erpGet('erp_item', m.itemId)?.name || '' },
      { k: 'type', label: 'Type', v: (m) => m.type }, { k: 'qty', label: 'Quantity', num: true, v: (m) => m.qty, html: (m) => `<span class="${m.qty < 0 ? 'v bad' : 'v ok'}">${m.qty > 0 ? '+' : ''}${qtyTxt(m.qty)}</span>` },
      { k: 'ref', label: 'Reference', v: (m) => m.ref || '', html: (m) => `${esc(m.ref || '')}${m.reason ? `<div class="tiny muted">${esc(m.reason)}</div>` : ''}` }, { k: 'by', label: 'By', v: (m) => nameOf(m.by) },
    ], { name: 'Stock movements', pageSize: 20, empty: 'No movements yet.' }), { list: true })}`;
}
function stoRejected() {
  const rows = erpList('erp_grn').filter((g) => g.status !== 'REVERSED').flatMap((g) => g.lines.filter((l) => l.rejected || l.damaged || ['FAILED', 'PARTIAL'].includes(l.qc)).map((l) => ({ g, l })));
  return card(`Rejected, damaged or failed inspection · ${rows.length}`, dataTable('stR', rows, [
    { k: 'grn', label: 'GRN', v: (x) => x.g.code, html: (x) => `<button class="btn sm ghost" data-a="erp-grn" data-id="${x.g.id}">${esc(x.g.code)}</button>` }, { k: 'sup', label: 'Supplier', v: (x) => x.g.supplierName },
    { k: 'item', label: 'Item', v: (x) => x.l.desc }, { k: 'rej', label: 'Rejected', num: true, v: (x) => x.l.rejected, html: (x) => qtyTxt(x.l.rejected) }, { k: 'dmg', label: 'Damaged', num: true, v: (x) => x.l.damaged || 0, html: (x) => qtyTxt(x.l.damaged || 0) },
    { k: 'qc', label: 'Inspection', v: (x) => x.l.qc, html: (x) => pill(QC_ST, x.l.qc) }, { k: 'why', label: 'Remarks', v: (x) => x.l.remarks || '' }, { k: 'date', label: 'Date', v: (x) => x.g.deliveryDate, html: (x) => fmtD(x.g.deliveryDate) },
  ], { name: 'Rejected and damaged material', empty: 'Nothing rejected.' }), { list: true });
}
function itemModal() {
  return `${mhead('Add item')}<form data-f="erp-item"><div class="body grid two">
    <label class="f">Item code / SKU<input class="i" id="it-s" name="sku" required></label><label class="f">Name<input class="i" id="it-n" name="name" required></label>
    <label class="f">Category<input class="i" id="it-c" name="category"></label><label class="f">Unit<input class="i" id="it-u" name="uom" required value="Nos"></label>
    <label class="f">Store location<input class="i" id="it-l" name="location"></label><label class="f">Reorder level<input class="i" id="it-r" name="reorder" inputmode="decimal"></label>
    <label class="f">Opening stock<input class="i" id="it-o" name="opening" inputmode="decimal"></label><label class="f">As of<input type="date" class="i" id="it-od" name="openingDate" value="${today()}" max="${today()}"></label>
    </div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Save item</button></footer></form>`;
}
function stkModal(id, type) {
  const i = erpGet('erp_item', id);
  return `${mhead(`${type === 'OUT' ? 'Issue' : 'Count adjustment'} · ${esc(i?.name || '')}`, `In stock: ${qtyTxt(stockOf(id))} ${esc(i?.uom || '')}`)}<form data-f="erp-stk" data-id="${id}" data-x="${type}"><div class="body grid two">
    ${type === 'ADJUST' ? `<label class="f">Direction<select class="i" name="direction" id="sk-dir">${opts([['DOWN', 'Less than recorded'], ['UP', 'More than recorded']], 'DOWN')}</select></label>` : `<label class="f">Issued to department<select class="i" name="toDept" id="sk-d">${deptOpts('', '—')}</select></label>`}
    <label class="f">Quantity<input class="i" id="sk-q" name="qty" required inputmode="decimal"></label><label class="f">Reference<input class="i" id="sk-r" name="ref" placeholder="${type === 'OUT' ? 'e.g. production batch 117' : 'e.g. count sheet 14 Oct'}"></label>
    <label class="f ${type === 'OUT' ? '' : 'full'}">${type === 'OUT' ? 'Note' : 'Reason (recorded)'}<input class="i" id="sk-n" name="reason" ${type === 'ADJUST' ? 'required' : ''}></label>
    </div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Save</button></footer></form>`;
}

ERPUI.gAct = null;
Object.assign(ERP_ACTIONS, {
  'erp-grn-new': (el) => openModal(() => grnNewModal(el.dataset.po)),
  'erp-grn': (el) => { ERPUI.gAct = null; openModal(() => grnModal(el.dataset.id)); },
  'erp-g-act': (el) => { ERPUI.gAct = el.dataset.x || null; drawModal(); },
  'erp-item-new': () => openModal(() => itemModal()),
  'erp-stk': (el) => openModal(() => stkModal(el.dataset.id, el.dataset.x)),
});
Object.assign(ERP_FORMS, {
  'erp-grn-new': (form, fd, v) => erpAct(async () => {
    const p = erpGet('erp_po', form.dataset.po);
    const lines = p.lines.map((l) => ({ poLineId: l.id, received: v('rcv_' + l.id), rejected: v('rej_' + l.id), damaged: v('dmg_' + l.id), qc: v('qc_' + l.id) || undefined, remarks: v('rmk_' + l.id) }));
    const files = await erpFiles(form.querySelector('[name="files"]'));
    const r = await erpCall('grn.save', { poId: form.dataset.po, challanNo: v('challanNo'), vehicle: v('vehicle'), deliveryDate: v('deliveryDate'), location: v('location'), note: v('note'), lines, files });
    closeModal(); return r;
  }, 'Recorded — waiting for verification'),
  'erp-grn-act': (form, fd, v) => erpAct(async () => {
    const x = form.dataset.x, g = erpGet('erp_grn', form.dataset.id);
    if (x === 'verify') await erpCall('grn.verify', { id: g.id, note: v('note') });
    if (x === 'reverse') await erpCall('grn.reverse', { id: g.id, note: v('note') });
    if (x === 'qc') await erpCall('grn.qc', { id: g.id, note: v('note'), lines: g.lines.map((l) => ({ poLineId: l.poLineId, qc: v('qc_' + l.poLineId), rejected: v('rej_' + l.poLineId) })) });
    ERPUI.gAct = null; drawModal();
  }, 'Saved'),
  'erp-item': (form, fd, v) => erpAct(async () => { await erpCall('item.save', { sku: v('sku'), name: v('name'), category: v('category'), uom: v('uom'), location: v('location'), reorder: v('reorder'), opening: v('opening'), openingDate: v('openingDate') }); closeModal(); }, 'Item saved'),
  'erp-stk': (form, fd, v) => erpAct(async () => { await erpCall('stk.move', { itemId: form.dataset.id, type: form.dataset.x, direction: v('direction'), qty: v('qty'), ref: v('ref'), toDept: v('toDept'), reason: v('reason') }); closeModal(); }, 'Stock updated'),
});
</script>
