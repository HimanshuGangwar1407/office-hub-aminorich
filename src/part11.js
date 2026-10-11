<script>
/* ═════════════ Expense claims & TA/DA ═════════════
   A claim is an EXPENSE request (same approval chain: reporting manager → Accounts → Director above the limit)
   whose data.claim holds the trip and its line items. Approvers can pass a lower amount; Accounts marks it paid. */
const CLAIM_KINDS = [['TADA', 'TA/DA — field visit / tour'], ['LOCAL', 'Local conveyance'], ['OTHER', 'Other business expense']];
const CLINE = [['FARE', 'Travel fare (bus / train / flight / cab)'], ['OWN', 'Own vehicle (per km)'], ['LODGE', 'Hotel / lodging'], ['DA', 'Daily allowance (DA)'], ['FOOD', 'Food & meals'], ['LOCAL', 'Local conveyance / auto'], ['CLIENT', 'Client / farmer meeting'], ['COMM', 'Phone / internet'], ['OTHER', 'Other']];
const CLAIM_DEF = { da: { EMPLOYEE: 400, MANAGER: 600, HR: 600, DIRECTOR: 1000, ADMIN: 1000 }, lodge: { EMPLOYEE: 1800, MANAGER: 3000, HR: 3000, DIRECTOR: 5000, ADMIN: 5000 }, km2: 4, km4: 9, billAbove: 300 };
const CPOL = () => { const c = cfg().claims || {}; return { ...CLAIM_DEF, ...c, da: { ...CLAIM_DEF.da, ...(c.da || {}) }, lodge: { ...CLAIM_DEF.lodge, ...(c.lodge || {}) } }; };
const claimTotal = (lines) => Math.round((lines || []).reduce((a, l) => a + (+l.amt || 0), 0));
const isClaim = (r) => r?.type === 'EXPENSE' && !!r.data?.claim;
const canPayClaims = () => isHR() || S.me?.deptId === cfg().depts.find((d) => d.code === 'ACC')?.id;
const tripDays = (a, b) => (a && b && b >= a ? eachDay(a, b).length : a ? 1 : 0);
function claimFlags(c, emp) {
  const P = CPOL(), role = emp?.role || 'EMPLOYEE', out = [];
  const nights = Math.max(0, tripDays(c.from, c.to) - 1);
  (c.lines || []).forEach((l, i) => {
    const amt = +l.amt || 0;
    if (amt > P.billAbove && !l.file && !l.link && !['DA', 'OWN'].includes(l.cat)) out.push([i, `No bill attached for ${money(amt)}`]);
    if (l.cat === 'DA' && l.days && amt > l.days * P.da[role]) out.push([i, `DA above ${money(P.da[role])}/day`]);
    if (l.cat === 'OWN' && l.km && amt > Math.round(l.km * (l.veh === '4W' ? P.km4 : P.km2))) out.push([i, 'Above the per-km rate']);
  });
  const lodge = (c.lines || []).filter((l) => l.cat === 'LODGE').reduce((a, l) => a + (+l.amt || 0), 0);
  if (lodge && nights && lodge > nights * P.lodge[role]) out.push([-1, `Lodging ${money(lodge)} is above ${money(P.lodge[role])} × ${nights} night(s)`]);
  if (c.kind === 'TADA' && !c.odReq) out.push([-1, 'Not linked to an approved official-duty request']);
  return out;
}

/* ── the claim form ── */
function claimForm() {
  if (!M) return '';
  if (!M.cl) {
    const T = today(), od = myODs()[0];
    M.cl = { kind: 'TADA', from: od?.data.from || addDays(T, -1), to: od?.data.to || od?.data.from || addDays(T, -1), odReq: od?.id || '', lines: [{ date: od?.data.from || addDays(T, -1), cat: 'FARE', desc: '', amt: '' }], files: {} };
  }
  const c = M.cl, P = CPOL(), role = S.me.role, days = tripDays(c.from, c.to), ods = myODs();
  const line = (l, i) => `<div class="cl-line" data-i="${i}">
    <input class="i" type="date" id="cl-d-${i}" name="d_${i}" value="${esc(l.date || '')}" aria-label="Date">
    <select class="i" id="cl-c-${i}" name="c_${i}" data-c="clCat" aria-label="Type">${opts(CLINE, l.cat)}</select>
    <input class="i" id="cl-x-${i}" name="x_${i}" value="${esc(l.desc || '')}" placeholder="${l.cat === 'FARE' ? 'e.g. Bus Guwahati → Jorhat' : l.cat === 'LODGE' ? 'Hotel name, nights' : l.cat === 'DA' ? 'Days on tour' : 'Details'}" aria-label="Details">
    ${l.cat === 'OWN' ? `<span class="row" style="gap:4px;flex-wrap:nowrap"><select class="i" id="cl-v-${i}" name="v_${i}" data-calc="1" aria-label="Vehicle" style="width:auto">${opts([['2W', '2-wheeler'], ['4W', '4-wheeler']], l.veh || '2W')}</select><input class="i" type="number" min="0" id="cl-k-${i}" name="k_${i}" data-calc="1" value="${esc(l.km || '')}" placeholder="km" style="width:76px" aria-label="Kilometres"></span>`
      : l.cat === 'DA' ? `<input class="i" type="number" min="0" step="0.5" id="cl-k-${i}" name="k_${i}" data-calc="1" value="${esc(l.days || '')}" placeholder="days" aria-label="Days" style="width:90px">` : '<span></span>'}
    <input class="i num" type="number" min="0" step="1" id="cl-a-${i}" name="a_${i}" value="${esc(l.amt ?? '')}" placeholder="₹" aria-label="Amount" data-sum="1">
    <span class="cl-bill">${c.files[i] ? `<span class="chip" title="${esc(c.files[i].name)}">Bill ✓<button type="button" class="chip-x" data-a="cl-unbill" data-i="${i}" aria-label="Remove bill">✕</button></span>` : `<label class="btn sm" for="cl-f-${i}">${M.upl === i ? 'Uploading…' : 'Attach bill'}</label><input type="file" id="cl-f-${i}" data-c="clBill" data-i="${i}" accept="image/*,.pdf" hidden>`}</span>
    <button type="button" class="btn sm ghost" data-a="cl-del" data-i="${i}" aria-label="Remove line" ${c.lines.length < 2 ? 'disabled' : ''}>✕</button></div>`;
  return `${mhead('New expense claim', 'Goes to your approver, then Accounts. You are paid after approval.')}<form data-f="claim"><div class="body grid" style="gap:14px">
    <div class="fgrid">
      <label class="f">Claim type<select class="i" id="cl-kind" name="kind" data-c="clKind">${opts(CLAIM_KINDS, c.kind)}</select></label>
      ${c.kind === 'TADA' ? `<label class="f">Linked official-duty / field visit<select class="i" id="cl-od" name="odReq" data-c="clOD">${opts(ods.map((r) => [r.id, `${r.data.location || 'Official duty'} · ${fmtDs(r.data.from)}${r.data.to && r.data.to !== r.data.from ? '–' + fmtDs(r.data.to) : ''}`]), c.odReq, ods.length ? '— not linked —' : 'No approved official duty found')}</select></label>` : '<span></span>'}
      <label class="f full">Purpose<input class="i" id="cl-p" name="purpose" required value="${esc(c.purpose || '')}" placeholder="${c.kind === 'TADA' ? 'e.g. Farmer meet and dealer visits — Bhimavaram cluster' : 'What was this spent on?'}"></label>
      ${c.kind === 'TADA' ? `<label class="f">Places (from → to)<input class="i" id="cl-pl" name="places" value="${esc(c.places || '')}" placeholder="Guwahati → Jorhat → Sivasagar → Guwahati"></label>` : ''}
      <label class="f">${c.kind === 'TADA' ? 'Trip from' : 'Date'}<input class="i" type="date" id="cl-from" name="from" required value="${esc(c.from)}" data-c="clFrom" max="${today()}"></label>
      ${c.kind === 'TADA' ? `<label class="f">Trip to<input class="i" type="date" id="cl-to" name="to" required value="${esc(c.to)}" data-c="clTo" max="${today()}"></label>` : ''}
    </div>
    <div><div class="row" style="justify-content:space-between"><h3>Expenses</h3><span class="row" style="gap:6px">${c.kind === 'TADA' ? `<button type="button" class="btn sm" data-a="cl-da">+ DA for ${days} day(s) · ${money(days * P.da[role])}</button>` : ''}<button type="button" class="btn sm" data-a="cl-add">+ Add line</button></span></div>
      <div class="cl-lines"><div class="cl-head"><span>Date</span><span>Type</span><span>Details</span><span></span><span class="num">Amount</span><span>Bill</span><span></span></div>${c.lines.map(line).join('')}</div>
      <div class="cl-tot"><span class="small muted">Your rates: DA ${money(P.da[role])}/day · lodging up to ${money(P.lodge[role])}/night · own vehicle ${money(P.km2)}/km (2W), ${money(P.km4)}/km (4W) · bill needed above ${money(P.billAbove)}</span><span>Total <b id="cl-total">${money(claimTotal(c.lines))}</b></span></div></div>
    <div class="fgrid">
      <label class="f">Advance already taken (₹)<input class="i" type="number" min="0" id="cl-adv" name="advance" value="${esc(c.advance || '')}" placeholder="0" data-sum="1"></label>
      <label class="f">Bills folder link (optional)<input class="i" id="cl-link" name="link" value="${esc(c.link || '')}" placeholder="Drive / OneDrive folder with all bills"></label>
      <label class="f full">Notes for the approver<textarea class="i" id="cl-n" name="note" rows="2">${esc(c.note || '')}</textarea></label>
      ${approverPick(chainFor('EXPENSE', S.me, { amount: 1 })[0]?.by, `Then Accounts${cfg().directorExpenseAbove ? `, and the Director above ${money(cfg().directorExpenseAbove)}` : ''}`)}
    </div>
  </div><footer><span class="small muted" style="margin-right:auto">Net payable: <b id="cl-net">${money(Math.max(0, claimTotal(c.lines) - (+c.advance || 0)))}</b></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri" type="submit">Submit claim</button></footer></form>`;
}
const myODs = () => reqsOf('WFH_OD', S.me.id).filter((r) => r.status === 'APPROVED' && r.data.kind === 'OD').sort((a, b) => b.data.from.localeCompare(a.data.from));
/* read what is typed into the form back into M.cl, so adding/removing rows keeps it */
function clSync() {
  const f = document.querySelector('form[data-f=claim]'); if (!f || !M?.cl) return;
  const fd = new FormData(f), g = (k) => String(fd.get(k) ?? '');
  Object.assign(M.cl, { kind: g('kind') || M.cl.kind, purpose: g('purpose'), places: g('places'), from: g('from') || M.cl.from, to: g('to') || M.cl.to, odReq: fd.has('odReq') ? g('odReq') : M.cl.odReq, advance: g('advance'), link: g('link'), note: g('note') });
  M.cl.lines = M.cl.lines.map((l, i) => ({ ...l, date: g(`d_${i}`), cat: g(`c_${i}`) || l.cat, desc: g(`x_${i}`), amt: g(`a_${i}`), veh: g(`v_${i}`) || l.veh, km: l.cat === 'OWN' ? g(`k_${i}`) : l.km, days: l.cat === 'DA' ? g(`k_${i}`) : l.days }));
}
function clRecalc(el) {
  const row = el?.closest?.('.cl-line'), P = CPOL();
  if (row && el.dataset.calc) {
    const i = row.dataset.i, cat = row.querySelector(`[name=c_${i}]`)?.value, k = +row.querySelector(`[name=k_${i}]`)?.value || 0, a = row.querySelector(`[name=a_${i}]`);
    if (a && cat === 'OWN') a.value = Math.round(k * (row.querySelector(`[name=v_${i}]`)?.value === '4W' ? P.km4 : P.km2)) || '';
    if (a && cat === 'DA') a.value = Math.round(k * P.da[S.me.role || 'EMPLOYEE']) || '';
  }
  const tot = [...document.querySelectorAll('form[data-f=claim] [name^=a_]')].reduce((s, x) => s + (+x.value || 0), 0), adv = +document.getElementById('cl-adv')?.value || 0;
  const t = document.getElementById('cl-total'), n = document.getElementById('cl-net');
  if (t) t.textContent = money(Math.round(tot)); if (n) n.textContent = money(Math.max(0, Math.round(tot - adv)));
}
document.addEventListener('input', (ev) => { if (ev.target.closest?.('form[data-f=claim]') && (ev.target.dataset.calc || ev.target.dataset.sum)) clRecalc(ev.target); });

async function claimAction(a, el) {
  if (a === 'claim-new') { if (S.readonly) return toast('You have view-only access to this app.', 'warn'); return openModal(claimForm); }
  if (a === 'claim-export') return claimExport();
  if (a === 'claim-pay') { const r = byId(S.reqs, el.dataset.id); return openModal(() => payClaimForm(r)); }
  if (!M?.cl) return;
  clSync();
  const c = M.cl, i = +el.dataset.i;
  if (a === 'cl-add') { const last = c.lines[c.lines.length - 1]; c.lines.push({ date: last?.date || c.from, cat: 'FARE', desc: '', amt: '' }); }
  if (a === 'cl-del' && c.lines.length > 1) { c.lines.splice(i, 1); const nf = {}; Object.entries(c.files).forEach(([k, f]) => { if (+k < i) nf[k] = f; else if (+k > i) nf[+k - 1] = f; }); c.files = nf; }
  if (a === 'cl-unbill') delete c.files[i];
  if (a === 'cl-da') { const days = tripDays(c.from, c.to), rate = CPOL().da[S.me.role || 'EMPLOYEE']; const ex = c.lines.findIndex((l) => l.cat === 'DA'); const ln = { date: c.from, cat: 'DA', desc: `DA ${days} day(s) @ ${money(rate)}`, days: String(days), amt: String(days * rate) }; if (ex >= 0) c.lines[ex] = ln; else c.lines.push(ln); }
  drawModal();
}
async function claimChange(el) {
  if (!M?.cl) return;
  clSync();
  if (el.dataset.c === 'clBill') {
    const file = el.files?.[0], i = +el.dataset.i; if (!file) return;
    M.upl = i; drawModal();
    await act(async () => { const f = await uploadFile(/^image\//.test(file.type) ? await shrinkImage(file, 1600) : file); M.cl.files[i] = f; });
    if (M) { M.upl = null; drawModal(); }
    return;
  }
  if (el.dataset.c === 'clCat') { const i = +el.closest('.cl-line').dataset.i; M.cl.lines[i].cat = el.value; }
  drawModal();
}
async function claimSubmit(form, fd) {
  clSync();
  const c = M.cl, v = (k) => String(fd.get(k) ?? '').trim();
  return act(async () => {
    if (!c.purpose?.trim()) fail('Write the purpose of the claim.');
    if (c.kind === 'TADA' && c.to < c.from) fail('The trip end date is before the start date.');
    const lines = c.lines.map((l, i) => ({ date: l.date || c.from, cat: l.cat, desc: (l.desc || '').trim(), amt: Math.round(+l.amt || 0), ...(l.cat === 'OWN' ? { veh: l.veh || '2W', km: +l.km || 0 } : {}), ...(l.cat === 'DA' ? { days: +l.days || 0 } : {}), ...(c.files[i] ? { file: c.files[i] } : {}) })).filter((l) => l.amt > 0);
    if (!lines.length) fail('Add at least one expense with an amount.');
    if (lines.some((l) => l.date > today())) fail('Expense dates can’t be in the future.');
    const total = claimTotal(lines), advance = Math.round(+c.advance || 0);
    const claim = { kind: c.kind, purpose: c.purpose.trim(), places: (c.places || '').trim(), from: c.from, to: c.kind === 'TADA' ? c.to : c.from, odReq: c.kind === 'TADA' ? c.odReq || null : null, lines, total, advance, net: Math.max(0, total - advance), link: (c.link || '').trim(), note: (c.note || '').trim() };
    const title = `${c.kind === 'TADA' ? 'TA/DA' : c.kind === 'LOCAL' ? 'Local conveyance' : 'Expense'} · ${claim.purpose.slice(0, 60)} · ${fmtDs(claim.from)}${claim.to !== claim.from ? '–' + fmtDs(claim.to) : ''}`;
    await createRequest('EXPENSE', title, { category: CLAIM_KINDS.find((k) => k[0] === c.kind)[1], billDate: claim.to, reason: claim.purpose, link: claim.link, claim, approver: v('approver') || null }, { amount: claim.net, ctx: { amount: claim.net, approver: v('approver') } });
    closeModal();
  }, 'Claim submitted for approval');
}

/* ── inside the request detail ── */
function claimCtx(r, canDecide) {
  const c = r.data.claim, emp = empById(r.empId), flags = claimFlags(c, emp), fl = new Map(flags.filter((f) => f[0] >= 0).map((f) => [f[0], f[1]]));
  return `<div class="card" style="overflow:hidden">
    <header><div><h2>${esc(CLAIM_KINDS.find((k) => k[0] === c.kind)?.[1] || 'Claim')}</h2><div class="small muted">${esc(c.purpose)}${c.places ? ` · ${esc(c.places)}` : ''} · ${fmtD(c.from)}${c.to !== c.from ? ' – ' + fmtD(c.to) : ''}</div></div>${r.paid ? `<span class="pill t-ok">Paid ${fmtDs(r.paid.date)}</span>` : r.status === 'APPROVED' ? '<span class="pill t-warn">Awaiting payment</span>' : ''}</header>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="num">Amount</th><th>Bill</th></tr></thead><tbody>
    ${c.lines.map((l, i) => `<tr><td class="small">${fmtDs(l.date)}</td><td class="small">${esc(CLINE.find((x) => x[0] === l.cat)?.[1] || l.cat)}</td><td class="small">${esc([l.desc, l.km ? `${l.km} km (${l.veh === '4W' ? '4-wheeler' : '2-wheeler'})` : '', l.days && !/day/.test(l.desc || '') ? `${l.days} day(s)` : ''].filter(Boolean).join(' · '))}${fl.has(i) ? `<div class="tiny" style="color:var(--warn)">⚑ ${esc(fl.get(i))}</div>` : ''}</td><td class="num">${money(l.amt)}</td><td>${l.file ? `<button class="btn sm" data-a="claim-bill" data-id="${r.id}" data-i="${i}">View</button>` : '<span class="tiny muted">—</span>'}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="3"><b>Total claimed</b></td><td class="num"><b>${money(c.total)}</b></td><td></td></tr>${c.advance ? `<tr><td colspan="3">Less advance taken</td><td class="num">− ${money(c.advance)}</td><td></td></tr><tr><td colspan="3"><b>Net payable</b></td><td class="num"><b>${money(c.net)}</b></td><td></td></tr>` : ''}${r.amountApproved != null && r.amountApproved !== c.net ? `<tr><td colspan="3"><b>Approved amount</b> <span class="tiny muted">by ${esc(nameOf(r.amountApprovedBy))}</span></td><td class="num" style="color:var(--accent)"><b>${money(r.amountApproved)}</b></td><td></td></tr>` : ''}</tfoot></table></div>
    ${flags.filter((f) => f[0] < 0).map((f) => `<div class="alert t-warn" style="cursor:default;border-radius:0">⚑ ${esc(f[1])}</div>`).join('')}
    ${c.link ? `<div class="body small">Bills folder: <a href="${esc(c.link)}" target="_blank" rel="noopener">Open link</a></div>` : ''}
    ${c.note ? `<div class="body small"><b>Note:</b> ${esc(c.note)}</div>` : ''}
    ${r.paid ? `<div class="body small" style="background:var(--ok-soft)">Paid ${money(r.paid.amount)} on ${fmtD(r.paid.date)} by ${esc(r.paid.mode)}${r.paid.ref ? ` · ref ${esc(r.paid.ref)}` : ''} · recorded by ${esc(nameOf(r.paid.by))}</div>` : r.status === 'APPROVED' && canPayClaims() ? `<div class="body"><button class="btn pri" data-a="claim-pay" data-id="${r.id}">Mark as paid</button></div>` : ''}
  </div>`;
}
const claimApprField = (r) => `<label class="f">Amount to approve (₹) — lower it to pass only part of the claim<input class="i" type="number" min="0" max="${r.amountApproved ?? r.data.claim.net}" id="dc-amt-${r.id}" name="apprAmt" value="${r.amountApproved ?? r.data.claim.net}"></label>`;
function payClaimForm(r) {
  if (!r) return null;
  const amt = r.amountApproved ?? r.data.claim?.net ?? r.amount;
  return `${mhead('Record payment', `${esc(r.code)} · ${esc(nameOf(r.empId))} · approved ${money(amt)}`)}<form data-f="claim-paid" data-id="${r.id}"><div class="body fgrid">
    <label class="f">Amount paid (₹)<input class="i" type="number" id="cp-a" name="amount" min="1" required value="${amt}"></label>
    <label class="f">Paid on<input class="i" type="date" id="cp-d" name="date" required value="${today()}" max="${today()}"></label>
    <label class="f">Mode<select class="i" id="cp-m" name="mode">${opts(['Bank transfer (NEFT/IMPS)', 'UPI', 'Cash', 'With salary'].map((x) => [x, x]))}</select></label>
    <label class="f">Reference / UTR<input class="i" id="cp-r" name="ref" placeholder="e.g. UTR 4321…"></label>
  </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri" type="submit">Mark as paid</button></footer></form>`;
}
async function claimPaidSubmit(form, fd) {
  const r = byId(S.reqs, form.dataset.id), v = (k) => String(fd.get(k) ?? '').trim();
  return act(async () => {
    if (!canPayClaims()) fail('Only Accounts or HR can record payments.');
    if (r.status !== 'APPROVED') fail('Only approved claims can be paid.');
    const paid = { amount: Math.round(+v('amount') || 0), date: v('date'), mode: v('mode'), ref: v('ref'), by: S.me.id, at: Date.now() };
    if (!paid.amount) fail('Enter the amount paid.');
    await patch(`req/${r.id}`, { paid });
    await audit('CLAIM_PAID', { req: r.code, amount: paid.amount });
    await notify([r.empId], { title: `Claim paid: ${money(paid.amount)}`, body: `${r.title} · ${paid.mode}${paid.ref ? ' · ' + paid.ref : ''}`, go: { view: 'claims', req: r.id } });
    closeModal(); openModal(() => reqDetail(r.id));
  }, 'Payment recorded');
}

/* ── the Claims page ── */
function vClaims() {
  const tab = ui('clTab', 'mine'), mgr = isManager() || canPayClaims(), m = ui('clMonth', '');
  const all = S.reqs.filter((r) => r.type === 'EXPENSE').sort((a, b) => b.created - a.created);
  const mine = all.filter((r) => r.empId === S.me.id);
  const team = all.filter((r) => r.empId !== S.me.id && (isMgmt() || canPayClaims() || canSee(r.empId)));
  const amt = (r) => r.amountApproved ?? r.data.claim?.net ?? r.amount ?? 0;
  const stat = (r) => (r.paid ? ['Paid', 't-ok'] : r.status === 'APPROVED' ? ['Approved · to pay', 't-acc'] : RSTAT[r.status] || [r.status, '']);
  const list = (tab === 'mine' ? mine : tab === 'topay' ? all.filter((r) => r.status === 'APPROVED' && !r.paid) : team).filter((r) => !m || (r.data.claim?.from || r.data.billDate || '').startsWith(m));
  const sum = (arr) => arr.reduce((a, r) => a + amt(r), 0);
  const myPend = mine.filter((r) => r.status === 'PENDING'), myToPay = mine.filter((r) => r.status === 'APPROVED' && !r.paid), myPaidY = mine.filter((r) => r.paid && r.paid.date.slice(0, 4) === today().slice(0, 4));
  const tabs = [['mine', 'My claims', true], ['team', 'Team claims', mgr], ['topay', 'To pay', canPayClaims()], ['policy', 'Rates & policy', true]].filter((t) => t[2]);
  let body = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-a="ui" data-k="clTab" data-v="${k}">${l}${k === 'topay' && all.some((r) => r.status === 'APPROVED' && !r.paid) ? ` <span class="count">${all.filter((r) => r.status === 'APPROVED' && !r.paid).length}</span>` : ''}</button>`).join('')}</div>`;
  if (tab === 'policy') {
    const P = CPOL(), ed = isHR();
    body += card('Travel & expense rates', `<form data-f="claim-pol"><div class="tbl-wrap"><table class="t"><thead><tr><th>Role</th><th class="num">Daily allowance (₹/day)</th><th class="num">Lodging cap (₹/night)</th></tr></thead><tbody>
      ${ROLES.map(([r, l]) => `<tr><td>${l}${r === S.me.role ? ' <span class="pill t-acc">you</span>' : ''}</td><td class="num">${ed ? `<input class="i num" type="number" min="0" id="cp-da-${r}" name="da_${r}" value="${P.da[r]}" style="width:110px">` : money(P.da[r])}</td><td class="num">${ed ? `<input class="i num" type="number" min="0" id="cp-lo-${r}" name="lo_${r}" value="${P.lodge[r]}" style="width:110px">` : money(P.lodge[r])}</td></tr>`).join('')}
      </tbody></table></div><div class="body fgrid">
      ${ed ? `<label class="f">Own 2-wheeler (₹/km)<input class="i" type="number" min="0" step="0.5" id="cp-k2" name="km2" value="${P.km2}"></label><label class="f">Own 4-wheeler (₹/km)<input class="i" type="number" min="0" step="0.5" id="cp-k4" name="km4" value="${P.km4}"></label><label class="f">Bill needed above (₹)<input class="i" type="number" min="0" id="cp-b" name="billAbove" value="${P.billAbove}"></label><div class="full"><button class="btn pri" type="submit">Save rates</button></div>`
      : `<div class="small">Own vehicle: <b>${money(P.km2)}/km</b> (2-wheeler), <b>${money(P.km4)}/km</b> (4-wheeler). Attach a bill for anything above <b>${money(P.billAbove)}</b>.</div>`}
      <p class="full small muted" style="margin:0">TA/DA claims should be linked to an approved <b>official duty</b> request for the trip. Claims go to your approver, then Accounts (and the Director above ${money(cfg().directorExpenseAbove || 0)}). Approvers can pass a lower amount; Accounts records the payment and you are notified.</p></div></form>`, { list: true });
    return shell(body, 'Expense claims', 'TA/DA for field visits, local conveyance and business expenses', '<button class="btn pri" data-a="claim-new">+ New claim</button>');
  }
  const kp = tab === 'mine' ? [['Waiting approval', money(sum(myPend)), `${myPend.length} claim(s)`, 'warn'], ['Approved, not paid', money(sum(myToPay)), `${myToPay.length} claim(s)`, ''], ['Paid this year', money(sum(myPaidY)), `${myPaidY.length} claim(s)`, 'ok']]
    : [['Pending approval', money(sum(list.filter((r) => r.status === 'PENDING'))), `${list.filter((r) => r.status === 'PENDING').length} claim(s)`, 'warn'], ['Approved, not paid', money(sum(list.filter((r) => r.status === 'APPROVED' && !r.paid))), `${list.filter((r) => r.status === 'APPROVED' && !r.paid).length} claim(s)`, ''], ['Paid', money(sum(list.filter((r) => r.paid))), `${list.filter((r) => r.paid).length} claim(s)`, 'ok']];
  body += `<div class="kstrip" style="grid-template-columns:repeat(3,minmax(0,1fr))">${kp.map(([l, v, s, t]) => `<div class="kt"><span class="l">${l}</span><span class="v ${t}">${v}</span><span class="tiny muted">${s}</span></div>`).join('')}</div>
    <div class="filters"><input type="month" class="i" id="cl-m" data-c="clMonth" value="${m}" aria-label="Month"><button class="btn" data-a="claim-export">Export to Excel</button></div>
    ${card(tab === 'mine' ? 'My claims' : tab === 'topay' ? 'Approved — waiting for payment' : 'Team claims', list.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Claim</th>${tab !== 'mine' ? '<th>Employee</th>' : ''}<th>Dates</th><th class="num">Claimed</th><th class="num">Approved</th><th>Status</th><th>With</th></tr></thead><tbody>
      ${list.map((r) => { const c = r.data.claim, s = stat(r), st = curStep(r); return `<tr class="click" data-a="req" data-id="${r.id}"><td><div class="trunc" style="max-width:340px">${esc(r.title)}</div><div class="tiny muted">${esc(r.code)}${c ? ` · ${c.lines.length} item(s)${c.lines.some((l) => l.file) ? ' · bills attached' : ''}` : ''}${c && claimFlags(c, empById(r.empId)).length ? ' · <span style="color:var(--warn)">⚑ check</span>' : ''}</div></td>${tab !== 'mine' ? `<td>${person(r.empId, deptOf(empById(r.empId)?.deptId)?.code || '')}</td>` : ''}<td class="small">${fmtDs(c?.from || r.data.billDate)}${c && c.to !== c.from ? '–' + fmtDs(c.to) : ''}</td><td class="num">${money(c?.total ?? r.amount)}</td><td class="num">${['APPROVED'].includes(r.status) ? money(amt(r)) : ''}</td><td><span class="pill ${s[1]}">${s[0]}</span></td><td class="small muted">${st ? esc(nameOf(st.by)) : r.paid ? esc(r.paid.mode) : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : empty(tab === 'mine' ? 'No claims yet. Use “+ New claim” after a field visit or business expense.' : 'Nothing here.'), { list: true })}`;
  return shell(body, 'Expense claims', 'TA/DA for field visits, local conveyance and business expenses', '<button class="btn pri" data-a="claim-new">+ New claim</button>');
}
function claimExport() {
  const all = S.reqs.filter((r) => r.type === 'EXPENSE' && (r.empId === S.me.id || isMgmt() || canPayClaims() || canSee(r.empId))), m = ui('clMonth', '');
  const list = all.filter((r) => !m || (r.data.claim?.from || r.data.billDate || '').startsWith(m));
  const sum = { name: 'Claims', cols: ['Code', 'Employee', 'Emp. code', 'Department', 'Type', 'Purpose', 'From', 'To', 'Claimed', 'Advance', 'Net', 'Approved', 'Status', 'Paid on', 'Mode', 'Reference'],
    rows: list.map((r) => { const c = r.data.claim || {}, e = empById(r.empId); return [r.code, e?.name || '', e?.code || '', deptOf(e?.deptId)?.name || '', CLAIM_KINDS.find((k) => k[0] === c.kind)?.[1] || r.data.category || '', c.purpose || r.title, c.from || r.data.billDate || '', c.to || '', c.total ?? r.amount, c.advance || 0, c.net ?? r.amount, r.status === 'APPROVED' ? r.amountApproved ?? c.net ?? r.amount : '', r.paid ? 'Paid' : RSTAT[r.status]?.[0] || r.status, r.paid?.date || '', r.paid?.mode || '', r.paid?.ref || '']; }) };
  const lines = { name: 'Line items', cols: ['Claim', 'Employee', 'Date', 'Type', 'Details', 'km', 'Days', 'Amount', 'Bill attached'], rows: list.flatMap((r) => (r.data.claim?.lines || []).map((l) => [r.code, nameOf(r.empId), l.date, CLINE.find((x) => x[0] === l.cat)?.[1] || l.cat, l.desc, l.km || '', l.days || '', l.amt, l.file ? 'Yes' : '']) ) };
  return exportBook(`Expense claims${m ? ' ' + fmtM(m) : ''} - ${cfg().company}`, [sum, lines]);
}
async function claimPolSubmit(form, fd) {
  return act(async () => {
    if (!isHR()) fail('Only HR or an administrator can change rates.');
    const da = {}, lodge = {}; for (const [r] of ROLES) { da[r] = Math.max(0, +fd.get('da_' + r) || 0); lodge[r] = Math.max(0, +fd.get('lo_' + r) || 0); }
    await saveCfg({ claims: { da, lodge, km2: +fd.get('km2') || 0, km4: +fd.get('km4') || 0, billAbove: +fd.get('billAbove') || 0 } });
    await audit('CLAIM_RATES_CHANGED', {});
  }, 'Rates saved');
}
</script>
<style>
.modal:has(form[data-f=claim]){width:min(1060px,100%)}
.cl-lines{display:grid;gap:6px;margin-top:8px;overflow-x:auto}
.cl-head,.cl-line{display:grid;grid-template-columns:136px 160px minmax(140px,1fr) auto 96px 100px 32px;gap:6px;align-items:center}
.cl-head{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 2px}
.cl-line .i{padding:6px 8px;font-size:.86rem}
input.num{text-align:right}
.cl-bill .btn{width:100%;justify-content:center}
.cl-tot{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.cl-tot b{font:700 1.2rem var(--f-display)}
@media (max-width:860px){.cl-head{display:none}.cl-line{grid-template-columns:1fr 1fr;padding:8px;border:1px solid var(--line);border-radius:8px}.cl-line>*:nth-child(3){grid-column:1/-1}}
</style>
