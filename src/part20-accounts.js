<script>
/* ═════════════ Accounts: dashboard, bank accounts, receipts, payments, forecast ═════════════
   Every figure says where it comes from (verified, imported, expected, forecast, reserved, pending, paid) and when.
   Expected receipts are never shown as cash; a forecast is never shown as a bank balance. The server
   (server/erp-accounts.js, erp-forecast.js) checks and records every change; these screens only ask. */

const PAY_ST = {
  DRAFT: ['Draft', ''], SUBMITTED: ['Submitted', 't-info'], UNDER_REVIEW: ['Under review', 't-warn'], APPROVED: ['Approved', 't-acc'], SCHEDULED: ['Scheduled', 't-vio'],
  PARTIALLY_PAID: ['Partially paid', 't-warn'], PAID: ['Paid', 't-ok'], REJECTED: ['Rejected', 't-bad'], CANCELLED: ['Cancelled', ''], ON_HOLD: ['On hold', 't-bad'],
};
const RC_ST = { EXPECTED: ['Expected', 't-info'], DUE: ['Due today', 't-warn'], PARTIAL: ['Partly received', 't-warn'], RECEIVED: ['Received', 't-ok'], OVERDUE: ['Overdue', 't-bad'], DISPUTED: ['Disputed', 't-bad'], CANCELLED: ['Cancelled', ''] };
const PAY_PRIO = { CRITICAL: ['Critical', 't-bad'], HIGH: ['High', 't-warn'], NORMAL: ['Normal', ''], LOW: ['Low', ''] };
const CERT = { FIRM: ['Firm', 't-ok'], LIKELY: ['Likely', 't-info'], UNCERTAIN: ['Uncertain', 't-warn'] };
const METHODS = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];
const sumBy = (l, f) => l.reduce((s, x) => s + (f(x) || 0), 0);
const erpPaid = (p) => sumBy(p.payments || [], (x) => x.amount);
const erpRecv = (r) => sumBy(r.received || [], (x) => x.amount);
const payDue = (p) => (p.amountApproved ?? p.amountReq) - erpPaid(p);
function rcStatus(r, d = today()) {
  if (r.cancelled) return 'CANCELLED';
  const got = erpRecv(r);
  if (got >= r.amount) return 'RECEIVED';
  if (r.disputed) return 'DISPUTED';
  if (got > 0) return 'PARTIAL';
  const due = r.promisedDate || r.expectedDate;
  return due < d ? 'OVERDUE' : due === d ? 'DUE' : 'EXPECTED';
}
const bankName = (id) => { const b = erpGet('erp_bank', id); return b ? `${b.name} (${b.masked})` : id ? 'Unknown account' : '—'; };
const bankOpts = (sel, blank = 'Pick an account') => opts(erpList('erp_bank').filter((b) => b.active !== false).map((b) => [b.id, `${b.name} · ${b.bank} ${b.masked}`]), sel, blank);
function latestBal(bankId) { return erpList('erp_bal').filter((x) => x.bankId === bankId).sort((a, b) => (b.asOf || '').localeCompare(a.asOf || '') || (b.at || 0) - (a.at || 0))[0] || null; }
const BAL_SRC = { OPENING: 'Opening balance', MANUAL: 'Verified manually', STATEMENT: 'Bank statement import', TALLY: 'Tally import' };

/** finance actions show the server's reason (limits, duplicates, permissions), not a generic error */
async function erpAct(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r ?? true; } catch (e) {
    if (!e?.user && !['invalid_argument', 'permission_denied', 'conflict', 'not_found'].includes(e?.code)) console.error(e);
    toast(e?.user || ['invalid_argument', 'permission_denied', 'conflict', 'not_found'].includes(e?.code) ? e.message : errText(e), 'bad');
    return false;
  }
}
/** supporting documents: uploaded in pieces (the server checks the uploader when they are attached) */
const ERP_FILE_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'xlsx', 'csv', 'docx', 'txt', 'zip', 'xml'];
async function erpFiles(input) {
  const out = [];
  for (const f of [...(input?.files || [])].slice(0, 10)) {
    const ext = extOf(f.name);
    if (!ERP_FILE_EXT.includes(ext)) fail(`.${ext || '?'} files can’t be attached. Use PDF, images, Excel, CSV, Word, text or ZIP.`);
    if (f.size > MAX_CHUNKED) fail(`${f.name} is over 6 MB. Attach a smaller copy.`);
    const { fid, chunks } = await putChunked(new Uint8Array(await f.arrayBuffer()), f.name);
    out.push({ fid, chunks, name: f.name, ext, size: f.size });
  }
  return out;
}
const fileList = (l) => ((l || []).length ? `<div class="row" style="gap:6px">${l.map((f) => `<button type="button" class="btn sm ghost" data-a="erp-file" data-f="${esc(JSON.stringify({ fid: f.fid, chunks: f.chunks, name: f.name, ext: f.ext }))}">📎 ${esc(f.name)}</button>`).join('')}</div>` : '<span class="tiny muted">None</span>');
ERP_ACTIONS['erp-file'] = (el) => act(() => saveFile(JSON.parse(el.dataset.f)));
const ckey = () => 'k' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

// ── the forecast comes from the server (one calculation for everyone, server/erp-forecast.js) ──
const ERPF = { key: '', data: null, busy: false, err: '' };
function erpStamp() { return ['erp_bank', 'erp_bal', 'erp_rcpt', 'erp_pay', 'erp_loan', 'erp_cfg'].map((c) => erpList(c).length + ':' + erpList(c).reduce((m, x) => Math.max(m, x.updatedAt || x.at || x.createdAt || 0), 0)).join('|'); }
function erpForecast(scenario, horizon) {
  const key = `${scenario}|${horizon}|${erpStamp()}|${today()}`;
  if (ERPF.key !== key && !ERPF.busy) {
    ERPF.busy = true; ERPF.key = key;
    erpCall('forecast.get', { scenario, horizon }).then((d) => { ERPF.data = d; ERPF.err = ''; }, (e) => { ERPF.err = e?.message || 'The forecast couldn’t be calculated.'; }).finally(() => { ERPF.busy = false; schedule(); });
  }
  return ERPF.data && ERPF.data.scenario === scenario && ERPF.data.horizon === horizon ? ERPF.data : null;
}

/* ═════════════ the Accounts page ═════════════ */
function vAccounts2() {
  if (!erpHas('acc')) return erpNoAccess('Accounts', 'Accounts is for the Accounts team.');
  erpUse('erp_cfg', 'erp_bank', 'erp_bal', 'erp_rcpt', 'erp_pay', 'erp_loan', 'erp_imp', 'erp_exc', 'erp_cust');
  if (typeof ACC_ON_RENDER !== 'undefined') for (const f of ACC_ON_RENDER) f(); // EMI reminders, opening a loan from a notification
  if (S.ui.erpOpen && ['pay', 'rcpt'].includes(S.ui.erpKind || 'pay')) { const id = S.ui.erpOpen, k = S.ui.erpKind || 'pay'; S.ui.erpOpen = null; ERPUI.payAct = null; setTimeout(() => openModal(() => (k === 'rcpt' ? rcptModal(id) : payModal(id))), 0); }
  const pays = erpList('erp_pay'), mine = (p) => p.requestedBy === S.me.id;
  const toVerify = pays.filter((p) => p.status === 'SUBMITTED' && !mine(p)), toApprove = erpHas('acc.approve') ? pays.filter((p) => p.status === 'UNDER_REVIEW' && !mine(p) && p.verifiedBy !== S.me.id) : [];
  const extraTabs = typeof ACC_TABS_EXTRA !== 'undefined' ? ACC_TABS_EXTRA : [];
  const { cur, html: tabs } = erpTabs('accTab', [['dash', 'Dashboard'], ['banks', 'Bank accounts'], ['rcpt', 'Receipts'], ['pay', 'Payments', toVerify.length + toApprove.length || ''], ['fc', 'Cash-flow forecast'], ...extraTabs.map((x) => [x[0], x[1], x[3] ? x[3]() : ''])], 'dash');
  let body = '';
  if (erpLoading('erp_bank', 'erp_pay', 'erp_rcpt')) body = `<div class="body muted small">Loading…</div>`;
  else if (cur === 'dash') body = accDash(toVerify, toApprove);
  else if (cur === 'banks') body = accBanks();
  else if (cur === 'rcpt') body = accReceipts();
  else if (cur === 'pay') body = accPayments(toVerify, toApprove);
  else if (cur === 'fc') body = accForecast();
  else { const x = extraTabs.find((t) => t[0] === cur); body = x ? x[2]() : ''; }
  const actions = `<button class="btn" data-a="erp-rcpt-new">Expected receipt</button><button class="btn pri" data-a="erp-pay-new">Payment request</button>`;
  return shell(`${tabs}${body}`, 'Accounts', 'Bank balances, receipts, payments and cash flow — Tally remains the official ledger', actions);
}

function accDash(toVerify, toApprove) {
  const banks = erpList('erp_bank').filter((b) => b.active !== false), pays = erpList('erp_pay'), rcpts = erpList('erp_rcpt'), T = today(), d30 = addDays(T, 30);
  const fc = erpForecast('base', 90);
  const verified = sumBy(banks, (b) => latestBal(b.id)?.amount || 0), asOfs = banks.map((b) => latestBal(b.id)?.asOf).filter(Boolean).sort();
  const open = pays.filter((p) => ['APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'].includes(p.status));
  const pend = pays.filter((p) => ['SUBMITTED', 'UNDER_REVIEW'].includes(p.status));
  const rOpen = rcpts.filter((r) => !['RECEIVED', 'CANCELLED'].includes(rcStatus(r)));
  const exp30 = sumBy(rOpen.filter((r) => (r.promisedDate || r.expectedDate) <= d30 && rcStatus(r) !== 'OVERDUE' && rcStatus(r) !== 'DISPUTED'), (r) => r.amount - erpRecv(r));
  const overdue = rOpen.filter((r) => rcStatus(r) === 'OVERDUE');
  const imp = erpList('erp_imp').filter((x) => x.status === 'COMMITTED').sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  const k = (label, value, src, sub = '', go = '') => `<div class="kpi" ${go ? `data-a="ui" data-k="accTab" data-v="${go}" role="button" tabindex="0"` : ''}><div class="l">${esc(label)}</div><div class="v">${value}</div><div class="tiny muted">${srcPill(src)} ${sub}</div></div>`;
  const kpis = `<div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">
    ${k('Verified bank balance', inr(verified), 'VERIFIED', asOfs.length ? `oldest as of ${fmtD(asOfs[0])}` : 'no balance verified yet', 'banks')}
    ${fc ? k('Since verification (not yet verified)', inr(fc.company.sinceVerified, { sign: true }), 'PAID', 'money recorded in or out after the verified dates') : ''}
    ${k('Expected receipts · next 30 days', inr(exp30), 'EXPECTED', 'not cash until received', 'rcpt')}
    ${k('Overdue receivables', inr(sumBy(overdue, (r) => r.amount - erpRecv(r))), 'EXPECTED', `${overdue.length} receipt${overdue.length === 1 ? '' : 's'}`, 'rcpt')}
    ${k('Approved, not yet paid', inr(sumBy(open, payDue)), 'RESERVED', `${open.length} payment${open.length === 1 ? '' : 's'}`, 'pay')}
    ${k('Waiting for approval', inr(sumBy(pend, (p) => p.amountReq)), 'PENDING', `${pend.length} request${pend.length === 1 ? '' : 's'}`, 'pay')}
    ${fc ? k('Projected closing · 30 days', inr(fc.company.series[Math.min(30, fc.company.series.length - 1)].close), 'FORECAST', 'base case', 'fc') : ''}
    ${fc ? k('Available to spend (forecast)', inr(fc.company.availableToSpend), 'FORECAST', 'after commitments and protected cash, next 90 days', 'fc') : ''}
    ${typeof emiDashKpi === 'function' ? emiDashKpi(k) : ''}
    ${(() => { const snap = (side) => erpList('erp_cust').filter((c) => c.side === side && !c.superseded); return [['RECEIVABLE', 'Receivables per Tally'], ['PAYABLE', 'Payables per Tally']].map(([s, l]) => { const x = snap(s); return x.length ? k(l, inr(sumBy(x, (c) => c.amount)), 'IMPORTED', `as of ${fmtD(x[0].asOf)} · ${x.length} bills`, 'imp') : ''; }).join(''); })()}
    ${erpList('erp_exc').filter((x) => x.status === 'OPEN').length ? k('Reconciliation exceptions', String(erpList('erp_exc').filter((x) => x.status === 'OPEN').length), 'PENDING', 'to resolve', 'imp') : ''}
    ${k('Last Tally / statement import', imp ? fmtDT(imp.at) : 'None yet', 'IMPORTED', imp ? esc(imp.kindLabel || imp.kind || '') : 'imports are on the Imports tab')}
  </div>`;
  const short = fc?.shortfalls || [];
  const alerts = [
    ...short.map((s) => `<div class="row" style="justify-content:space-between"><span><span class="pill t-bad">Shortfall</span> <b>${esc(s.name)}</b> falls ${s.belowZero ? 'below zero' : 'below its protected cash'} on <b>${fmtD(s.date)}</b> — short by <b>${inr(s.shortBy)}</b></span><span class="tiny muted">${esc(s.causes.slice(0, 3).map((c) => `${c.label} ${inr(-c.amount)}`).join(' · '))}</span></div>`),
    ...(fc?.company.unverifiedAccounts || []).map((id) => `<div><span class="pill t-warn">No verified balance</span> ${esc(bankName(id))} — the forecast starts it at ₹0 until a balance is verified.</div>`),
  ];
  const myq = [...toVerify.map((p) => [p, 'Verify']), ...toApprove.map((p) => [p, 'Approve'])];
  const q = myq.length ? myq.map(([p, what]) => `<button class="row click" style="justify-content:space-between;width:100%;background:none;border:0;padding:6px 0;text-align:left" data-a="erp-pay" data-id="${p.id}"><span><span class="pill t-warn">${what}</span> <b>${esc(p.code)}</b> ${esc(p.payee)}</span><span>${inr(p.amountReq)}</span></button>`).join('') : '<span class="small muted">Nothing waiting for you.</span>';
  const bankRows = banks.map((b) => { const lb = latestBal(b.id), fa = fc?.accounts.find((a) => a.id === b.id); return { b, lb, fa }; });
  const banksTbl = dataTable('accB', bankRows, [
    { k: 'name', label: 'Account', v: (r) => r.b.name, html: (r) => `<b>${esc(r.b.name)}</b><div class="tiny muted">${esc(r.b.bank)} ${esc(r.b.masked)}</div>` },
    { k: 'bal', label: 'Verified balance', num: true, v: (r) => r.lb?.amount ?? -1e15, html: (r) => (r.lb ? `${inr(r.lb.amount)}<div class="tiny">${srcPill('VERIFIED')} ${fmtD(r.lb.asOf)}</div>` : '<span class="pill t-warn">Not verified</span>') },
    { k: 'since', label: 'Since then', num: true, v: (r) => r.fa?.sinceVerified ?? 0, html: (r) => (r.fa ? inr(r.fa.sinceVerified, { sign: true }) : '—') },
    { k: 'prot', label: 'Protected', num: true, v: (r) => (r.b.buffer || 0) + (r.b.restricted || 0), html: (r) => inr((r.b.buffer || 0) + (r.b.restricted || 0)) },
    { k: 'min', label: 'Lowest in 90 days', num: true, v: (r) => r.fa?.minClose ?? 0, html: (r) => (r.fa ? `<span class="${r.fa.minClose < r.fa.protect ? 'v bad' : ''}">${inr(r.fa.minClose)}</span> <span class="tiny">${srcPill('FORECAST')}</span>` : '—') },
  ], { name: 'Bank accounts', empty: 'No bank accounts yet — add one on the Bank accounts tab.' });
  return `${kpis}
    <div class="grid two" style="margin-top:12px">${card('Waiting for you', q)}${card('Alerts', alerts.length ? alerts.join('<hr style="border:0;border-top:1px solid var(--line);margin:6px 0">') : `<span class="small muted">${fc ? 'No shortfalls in the next 90 days (base case).' : ERPF.err ? esc(ERPF.err) : 'Calculating…'}</span>`)}</div>
    ${card('Bank accounts', banksTbl, { list: true })}
    <p class="tiny muted">Balances are only as current as their verification date. Expected receipts and forecasts are planning figures, not cash. Tally remains the official accounting record.</p>`;
}

function accBanks() {
  const banks = erpList('erp_bank');
  const bals = erpList('erp_bal').slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 200);
  return `${card(`Bank accounts · ${banks.length}`, dataTable('accBk', banks, [
      { k: 'name', label: 'Account', v: (b) => b.name, html: (b) => `<b>${esc(b.name)}</b>${b.active === false ? ' <span class="pill">Closed</span>' : ''}<div class="tiny muted">${esc(b.bank)} ${esc(b.masked)} · ${esc(b.currency)}</div>` },
      { k: 'bal', label: 'Latest verified balance', num: true, v: (b) => latestBal(b.id)?.amount ?? -1e15, html: (b) => { const l = latestBal(b.id); return l ? `${inr(l.amount)}<div class="tiny muted">${fmtD(l.asOf)} · ${esc(BAL_SRC[l.source] || l.source)}</div>` : '<span class="pill t-warn">Not verified</span>'; } },
      { k: 'buf', label: 'Minimum balance', num: true, v: (b) => b.buffer ?? 0, html: (b) => (b.buffer != null ? inr(b.buffer) : '<span class="tiny muted">Company buffer</span>') },
      { k: 'res', label: 'Restricted funds', num: true, v: (b) => b.restricted || 0, html: (b) => `${inr(b.restricted || 0)}${b.restrictedNote ? `<div class="tiny muted">${esc(b.restrictedNote)}</div>` : ''}` },
      { k: 'act', label: '', v: () => '', html: (b) => `<span class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-a="erp-bal" data-id="${b.id}">Verify balance</button><button class="btn sm ghost" data-a="erp-bank" data-id="${b.id}">Edit</button></span>` },
    ], { name: 'Bank accounts', empty: 'No bank accounts yet.' }), { list: true, actions: '<button class="btn pri sm" data-a="erp-bank">Add bank account</button>' })}
    ${card('Balance history', dataTable('accBh', bals, [
      { k: 'asOf', label: 'As of', v: (x) => x.asOf, html: (x) => fmtD(x.asOf) }, { k: 'bank', label: 'Account', v: (x) => bankName(x.bankId) },
      { k: 'amt', label: 'Balance', num: true, v: (x) => x.amount, html: (x) => inr(x.amount) }, { k: 'src', label: 'Source', v: (x) => BAL_SRC[x.source] || x.source },
      { k: 'by', label: 'Recorded by', v: (x) => (x.by ? nameOf(x.by) : 'Import'), html: (x) => `${esc(x.by ? nameOf(x.by) : 'Import')}<div class="tiny muted">${fmtDT(x.at)}${x.note ? ' · ' + esc(x.note) : ''}</div>` },
    ], { name: 'Balance history', pageSize: 15, empty: 'No balances yet.' }), { list: true })}
    <p class="tiny muted">Only the last four digits of an account are stored. Never enter internet-banking passwords, PINs or OTPs anywhere in OfficeHub.</p>`;
}
function bankModal(id) {
  const b = id ? erpGet('erp_bank', id) : null;
  return `${mhead(b ? `Edit ${esc(b.name)}` : 'Add bank account')}<form data-f="erp-bank" data-id="${b?.id || ''}"><div class="body grid two">
    <label class="f">Nickname<input class="i" id="bk-name" name="name" required value="${esc(b?.name || '')}" placeholder="e.g. HDFC current"></label>
    <label class="f">Bank<input class="i" id="bk-bank" name="bank" required value="${esc(b?.bank || '')}"></label>
    <label class="f">Last 4 digits of the account number<input class="i" id="bk-l4" name="last4" required inputmode="numeric" maxlength="4" pattern="[0-9]{4}" value="${esc(b?.last4 || '')}"></label>
    <label class="f">Currency<select class="i" id="bk-cur" name="currency">${opts([['INR', 'INR — Indian rupee']], b?.currency || 'INR')}</select></label>
    ${b ? '' : `<label class="f">Opening balance (₹)<input class="i" id="bk-ob" name="openingAmount" required inputmode="decimal"></label><label class="f">Opening balance date<input type="date" class="i" id="bk-od" name="openingDate" required max="${today()}" value="${today()}"></label>`}
    <label class="f">Minimum balance / protected buffer (₹, blank = company buffer)<input class="i" id="bk-buf" name="buffer" inputmode="decimal" value="${esc(rupeesIn(b?.buffer ?? null))}"></label>
    <label class="f">Restricted / earmarked funds (₹)<input class="i" id="bk-res" name="restricted" inputmode="decimal" value="${esc(rupeesIn(b?.restricted || null))}"></label>
    <label class="f full">What the restricted funds are for<input class="i" id="bk-rn" name="restrictedNote" value="${esc(b?.restrictedNote || '')}" placeholder="e.g. margin money for the LC — not EMIs or scheduled payments, those are already in the forecast"></label>
    ${b ? `<label class="f">Status<select class="i" id="bk-act" name="active">${opts([['yes', 'In use'], ['no', 'Closed']], b.active === false ? 'no' : 'yes')}</select></label>` : ''}
    <p class="tiny muted full">Only the last four digits are stored. Never enter internet-banking passwords, PINs or OTPs.</p></div>
    <footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Save</button></footer></form>`;
}
function balModal(id) {
  const b = erpGet('erp_bank', id), l = latestBal(id);
  return `${mhead(`Verify balance · ${esc(b?.name || '')}`, l ? `Last: ${inr(l.amount)} as of ${fmtD(l.asOf)}` : '')}<form data-f="erp-bal" data-id="${id}"><div class="body grid two">
    <label class="f">Balance (₹, as shown by the bank)<input class="i" id="bv-amt" name="amount" required inputmode="decimal"></label>
    <label class="f">As of (end of day)<input type="date" class="i" id="bv-d" name="asOf" required max="${today()}" value="${today()}"></label>
    <label class="f full">Where you checked it<input class="i" id="bv-n" name="note" required placeholder="e.g. HDFC portal — closing balance; statement page 3"></label>
    <p class="tiny muted full">Payments and receipts dated on or before this date are treated as already inside this balance.</p></div>
    <footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Save verified balance</button></footer></form>`;
}

/* ── receipts ── */
function accReceipts() {
  const st = ui('rcSt', 'open'), q = ui('rcQ', '').trim().toLowerCase();
  const all = erpList('erp_rcpt');
  const list = all.filter((r) => { const s = rcStatus(r); return (st === 'open' ? !['RECEIVED', 'CANCELLED'].includes(s) : !st || s === st) && (!q || `${r.customer} ${r.ref} ${r.code}`.toLowerCase().includes(q)); });
  return `<div class="filters rd-filters"><input class="i" id="rc-q" data-i="rcQ" placeholder="Search customer, invoice or number" value="${esc(ui('rcQ', ''))}" aria-label="Search">
      <select class="i" id="rc-st" data-c="rcSt" aria-label="Status">${opts([['open', 'Outstanding'], ...Object.entries(RC_ST).map(([k, v]) => [k, v[0]])], st, 'All')}</select></div>
    ${card(`Receipts · ${list.length}`, dataTable('accR', list, [
      { k: 'code', label: 'Number', v: (r) => r.code, html: (r) => `<b class="small">${esc(r.code)}</b>` },
      { k: 'cust', label: 'Customer', v: (r) => r.customer, html: (r) => `${esc(r.customer)}<div class="tiny muted">${esc(r.ref || '')}${r.tallyRef ? ' · Tally ' + esc(r.tallyRef) : ''}</div>` },
      { k: 'exp', label: 'Expected', num: true, v: (r) => r.amount, html: (r) => `${inr(r.amount)}<div class="tiny">${srcPill('EXPECTED')}</div>` },
      { k: 'got', label: 'Received', num: true, v: (r) => erpRecv(r), html: (r) => (erpRecv(r) ? `${inr(erpRecv(r))}<div class="tiny">${srcPill('PAID', '')}</div>` : '—') },
      { k: 'due', label: 'Due', v: (r) => r.promisedDate || r.expectedDate, html: (r) => `${fmtD(r.promisedDate || r.expectedDate)}${r.promisedDate && r.promisedDate !== r.expectedDate ? `<div class="tiny muted">promised (invoice ${fmtD(r.expectedDate)})</div>` : ''}` },
      { k: 'cert', label: 'Certainty', v: (r) => r.certainty, html: (r) => pill(CERT, r.certainty) },
      { k: 'st', label: 'Status', v: (r) => rcStatus(r), html: (r) => pill(RC_ST, rcStatus(r)) },
    ], { name: 'Receipts', click: (r) => `data-a="erp-rcpt" data-id="${r.id}"`, empty: 'No receipts match.' }), { list: true, actions: '<button class="btn pri sm" data-a="erp-rcpt-new">Expected receipt</button>' })}`;
}
function rcptModal(id) {
  const r = id ? erpGet('erp_rcpt', id) : null, s = r ? rcStatus(r) : null, left = r ? r.amount - erpRecv(r) : 0;
  const form = `<form data-f="erp-rcpt" data-id="${r?.id || ''}"><div class="body grid two">
    <label class="f">Customer<input class="i" id="rc-c" name="customer" required value="${esc(r?.customer || '')}"></label>
    <label class="f">Invoice / reference<input class="i" id="rc-r" name="ref" value="${esc(r?.ref || '')}"></label>
    <label class="f">Expected amount (₹)<input class="i" id="rc-a" name="amount" required inputmode="decimal" value="${esc(rupeesIn(r?.amount ?? null))}"></label>
    <label class="f">Account to be credited<select class="i" id="rc-b" name="bankId">${bankOpts(r?.bankId, 'Not decided')}</select></label>
    <label class="f">Expected date (invoice terms)<input type="date" class="i" id="rc-e" name="expectedDate" required value="${esc(r?.expectedDate || '')}"></label>
    <label class="f">Promised date (if the customer promised another)<input type="date" class="i" id="rc-p" name="promisedDate" value="${esc(r?.promisedDate || '')}"></label>
    <label class="f">Certainty<select class="i" id="rc-ce" name="certainty">${opts(Object.entries(CERT).map(([k, v]) => [k, v[0]]), r?.certainty || 'LIKELY')}</select></label>
    <label class="f">Tally reference (optional)<input class="i" id="rc-t" name="tallyRef" value="${esc(r?.tallyRef || '')}"></label>
    <label class="f full">Follow-up note<input class="i" id="rc-n" name="note" placeholder="e.g. Spoke to Ravi in their accounts — cheque on Friday"></label></div>
    <footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Close</button>${r?.cancelled ? '' : '<button class="btn pri">Save</button>'}</footer></form>`;
  if (!r) return `${mhead('Expected receipt', 'Not cash until it is received')}${form}`;
  const recv = (r.received || []).map((x) => `<li>${inr(x.amount)} on ${fmtD(x.date)} into ${esc(bankName(x.bankId))} · ref ${esc(x.ref)} · ${esc(nameOf(x.by))}${x.files ? ' ' + fileList(x.files) : ''}</li>`).join('');
  const notes = (r.notes || []).slice().reverse().map((n) => `<li><span class="tiny muted">${fmtDT(n.at)} · ${esc(nameOf(n.by))}</span><br>${esc(n.text)}</li>`).join('');
  return `${mhead(`${esc(r.code)} · ${esc(r.customer)}`, `${pill(RC_ST, s)} ${inr(left)} outstanding of ${inr(r.amount)}`)}
    <div class="body grid">
      ${!['RECEIVED', 'CANCELLED'].includes(s) ? `<form data-f="erp-rcv" data-id="${r.id}" class="card body" style="background:var(--sunk);border:0"><h3>Record money received</h3><div class="grid two">
        <label class="f">Amount (₹)<input class="i" id="rv-a" name="amount" required inputmode="decimal" value="${esc(rupeesIn(left))}"></label>
        <label class="f">Date received<input type="date" class="i" id="rv-d" name="date" required max="${today()}" value="${today()}"></label>
        <label class="f">Account credited<select class="i" id="rv-b" name="bankId" required>${bankOpts(r.bankId)}</select></label>
        <label class="f">Bank reference / UTR<input class="i" id="rv-r" name="ref" required></label>
        <label class="f full">Evidence (optional)<input type="file" class="i" id="rv-f" name="files" multiple></label></div>
        <div class="row"><span style="flex:1"></span><button class="btn pri">Record receipt</button></div></form>` : ''}
      ${recv ? `<div><h3>Received</h3><ul class="small">${recv}</ul></div>` : ''}
      <div class="row" style="gap:6px">${!r.cancelled ? `<button class="btn sm" data-a="erp-rc-act" data-id="${r.id}" data-x="${r.disputed ? 'undispute' : 'dispute'}">${r.disputed ? 'Resolve dispute' : 'Mark disputed'}</button>${erpRecv(r) ? '' : `<button class="btn sm danger" data-a="erp-rc-act" data-id="${r.id}" data-x="cancel">Cancel</button>`}` : ''}</div>
      ${notes ? `<div><h3>Follow-up</h3><ul class="small">${notes}</ul></div>` : ''}
      <details><summary class="small">Edit details</summary>${form}</details>
    </div>`;
}

/* ── payments ── */
function accPayments(toVerify, toApprove) {
  const st = ui('pySt', 'open'), cat = ui('pyCat', ''), q = ui('pyQ', '').trim().toLowerCase();
  const OPEN = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'PARTIALLY_PAID', 'ON_HOLD'];
  const list = erpList('erp_pay').filter((p) => (st === 'open' ? OPEN.includes(p.status) : st === 'mine' ? toVerify.includes(p) || toApprove.includes(p) : !st || p.status === st) && (!cat || p.category === cat) && (!q || `${p.code} ${p.payee} ${p.invoiceRef || ''}`.toLowerCase().includes(q)));
  return `<div class="filters rd-filters"><input class="i" id="py-q" data-i="pyQ" placeholder="Search payee, invoice or number" value="${esc(ui('pyQ', ''))}" aria-label="Search">
      <select class="i" id="py-st" data-c="pySt" aria-label="Status">${opts([['open', 'Open'], ['mine', 'Waiting for me'], ...Object.entries(PAY_ST).map(([k, v]) => [k, v[0]])], st, 'All')}</select>
      <select class="i" id="py-cat" data-c="pyCat" aria-label="Category">${opts(Object.entries(PAY_CATEGORIES), cat, 'All categories')}</select></div>
    ${card(`Payments · ${list.length}`, dataTable('accP', list, [
      { k: 'code', label: 'Number', v: (p) => p.code, html: (p) => `<b class="small">${esc(p.code)}</b>${toVerify.includes(p) || toApprove.includes(p) ? ' <span class="pill t-warn">You</span>' : ''}` },
      { k: 'payee', label: 'Payee', v: (p) => p.payee, html: (p) => `${esc(p.payee)}<div class="tiny muted">${esc(PAY_CATEGORIES[p.category] || p.category)}${p.invoiceRef ? ' · ' + esc(p.invoiceRef) : ''}</div>` },
      { k: 'amt', label: 'Amount', num: true, v: (p) => p.amountApproved ?? p.amountReq, html: (p) => `${inr(p.amountApproved ?? p.amountReq)}${p.amountApproved != null && p.amountApproved !== p.amountReq ? `<div class="tiny muted">asked ${inr(p.amountReq)}</div>` : ''}` },
      { k: 'paid', label: 'Paid', num: true, v: (p) => erpPaid(p), html: (p) => (erpPaid(p) ? inr(erpPaid(p)) : '—') },
      { k: 'date', label: 'Due / planned', v: (p) => p.scheduledDate || p.proposedDate || p.due || '', html: (p) => (p.scheduledDate ? `${fmtD(p.scheduledDate)}<div class="tiny muted">scheduled</div>` : p.proposedDate || p.due ? fmtD(p.proposedDate || p.due) : '—') },
      { k: 'prio', label: 'Priority', v: (p) => ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].indexOf(p.priority), html: (p) => pill(PAY_PRIO, p.priority) },
      { k: 'st', label: 'Status', v: (p) => p.status, html: (p) => `${pill(PAY_ST, p.status)}${p.dupOverride ? ' <span class="pill t-bad" title="Raised despite a possible duplicate">Duplicate override</span>' : ''}${p.exception ? ' <span class="pill t-bad">Exception</span>' : ''}` },
    ], { name: 'Payments', click: (p) => `data-a="erp-pay" data-id="${p.id}"`, empty: 'No payments match.' }), { list: true, actions: '<button class="btn pri sm" data-a="erp-pay-new">Payment request</button>' })}`;
}
const ERPUI = { payAct: null, dup: null };
function payNewModal(pre = {}) {
  const cats = erpHas('acc') ? erpCfg().categories.concat(['TRANSFER']) : ['SUPPLIER', 'ADVANCE'];
  const c = pre.category || ui('pnCat', cats[0]);
  return `${mhead('Payment request', 'Accounts verifies it, an approver approves it, and it is marked paid only with the bank reference')}<form data-f="erp-pay-new" data-k="${ckey()}"><div class="body grid two">
    <label class="f">Category<select class="i" id="pn-cat" name="category" data-c="pnCat">${opts(cats.map((k) => [k, PAY_CATEGORIES[k]]), c)}</select></label>
    ${c === 'TRANSFER' ? `<label class="f">To account<select class="i" id="pn-to" name="transferTo" required>${bankOpts(pre.transferTo)}</select></label>` : `<label class="f">Payee<input class="i" id="pn-payee" name="payee" required value="${esc(pre.payee || '')}"></label>`}
    <label class="f">Invoice / bill number${c === 'SUPPLIER' ? ' (used to catch duplicates)' : ''}<input class="i" id="pn-inv" name="invoiceRef" value="${esc(pre.invoiceRef || '')}"></label>
    <label class="f">Amount (₹)<input class="i" id="pn-amt" name="amount" required inputmode="decimal" value="${esc(pre.amount || '')}"></label>
    <label class="f">Due date<input type="date" class="i" id="pn-due" name="due" value="${esc(pre.due || '')}"></label>
    <label class="f">Proposed payment date<input type="date" class="i" id="pn-pd" name="proposedDate"></label>
    <label class="f">Priority<select class="i" id="pn-pr" name="priority">${opts(Object.entries(PAY_PRIO).map(([k, v]) => [k, v[0]]), 'NORMAL')}</select></label>
    <label class="f">${c === 'TRANSFER' ? 'From account' : 'Paying account'}<select class="i" id="pn-bank" name="bankId" ${c === 'TRANSFER' ? 'required' : ''}>${bankOpts('', 'Accounts will decide')}</select></label>
    <label class="f">Method<select class="i" id="pn-m" name="method">${opts(METHODS.map((m) => [m, m]), 'NEFT')}</select></label>
    <label class="f">Tally reference (optional)<input class="i" id="pn-t" name="tallyRef"></label>
    <label class="f full">Notes<textarea class="i" id="pn-note" name="note" rows="2"></textarea></label>
    <label class="f full">Supporting documents (invoice, agreement…)<input type="file" class="i" id="pn-files" name="files" multiple></label>
    ${ERPUI.dup ? `<div class="full card body" style="background:var(--bad-soft);border:0"><b>${esc(ERPUI.dup)}</b>${erpHas('acc.approve') ? `<label class="f" style="margin-top:6px">If this really is a separate payment, say why (recorded in the audit log)<input class="i" id="pn-ov" name="override" placeholder="e.g. second instalment as per the agreement dated 1 Oct"></label>` : '<p class="small">Check the existing request. Only a payment approver can raise a duplicate, with a reason.</p>'}</div>` : ''}
    </div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn" name="go" value="draft">Save draft</button><button class="btn pri" name="go" value="submit">Submit</button></footer></form>`;
}
function payModal(id) {
  const p = erpGet('erp_pay', id);
  if (!p) return `${mhead('Payment')}<div class="body">${empty('This payment isn’t available to you.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const mine = p.requestedBy === S.me.id, acc = erpHas('acc'), apr = erpHas('acc.approve');
  const can = {
    submit: p.status === 'DRAFT' && mine, edit: ['DRAFT', 'SUBMITTED'].includes(p.status) && mine,
    verify: p.status === 'SUBMITTED' && acc && !mine,
    approve: p.status === 'UNDER_REVIEW' && apr && !mine && p.verifiedBy !== S.me.id,
    reject: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'ON_HOLD'].includes(p.status) && (acc || apr) && !mine && !erpPaid(p),
    hold: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'].includes(p.status) && acc,
    resume: p.status === 'ON_HOLD' && acc,
    schedule: ['APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'].includes(p.status) && acc,
    record: ['APPROVED', 'SCHEDULED', 'PARTIALLY_PAID'].includes(p.status) && acc,
    cancel: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'SCHEDULED', 'ON_HOLD'].includes(p.status) && (mine || acc) && !erpPaid(p),
    tally: acc, note: mine || acc,
  };
  const LBL = { submit: 'Submit', verify: 'Verify', approve: 'Approve', reject: 'Reject', hold: 'Put on hold', resume: 'Resume', schedule: 'Schedule', record: 'Record payment made', cancel: 'Cancel request', tally: 'Link Tally voucher', note: 'Comment' };
  const a = ERPUI.payAct;
  const field = {
    approve: `<label class="f">Amount to approve (₹)<input class="i" id="pa-amt" name="amount" inputmode="decimal" value="${esc(rupeesIn(p.amountReq))}"></label><label class="f full">Note (required if approving less)<input class="i" id="pa-note" name="note"></label>${typeof payChecks === 'function' ? payChecks(p, true) : ''}`,
    reject: '<label class="f full">Reason<input class="i" id="pa-note" name="note" required></label>', hold: '<label class="f full">Reason<input class="i" id="pa-note" name="note" required></label>',
    cancel: '<label class="f full">Reason<input class="i" id="pa-note" name="note" required></label>', note: '<label class="f full">Comment<textarea class="i" id="pa-note" name="note" rows="2" required></textarea></label>',
    verify: `<label class="f full">Verification note (what you checked)<input class="i" id="pa-note" name="note" placeholder="e.g. invoice matches the PO and the goods receipt"></label>${typeof payChecks === 'function' ? payChecks(p, false) : ''}`,
    resume: '<label class="f full">Note<input class="i" id="pa-note" name="note"></label>', submit: '',
    schedule: `<label class="f">Payment date<input type="date" class="i" id="pa-d" name="date" required value="${esc(p.scheduledDate || p.proposedDate || p.due || today())}"></label><label class="f">From account<select class="i" id="pa-b" name="bankId" required>${bankOpts(p.bankId)}</select></label><label class="f">Method<select class="i" id="pa-m" name="method">${opts(METHODS.map((m) => [m, m]), p.method)}</select></label>`,
    record: `<label class="f">Amount paid (₹)<input class="i" id="pa-amt" name="amount" required inputmode="decimal" value="${esc(rupeesIn(payDue(p)))}"></label><label class="f">Date the bank paid it<input type="date" class="i" id="pa-d" name="date" required max="${today()}" value="${today()}"></label><label class="f">From account<select class="i" id="pa-b" name="bankId" required>${bankOpts(p.bankId)}</select></label><label class="f">Bank reference / UTR / cheque no.<input class="i" id="pa-ref" name="ref" required></label><label class="f full">Payment advice / evidence (optional)<input type="file" class="i" id="pa-f" name="files" multiple></label><p class="tiny muted full">Record a payment only after the bank has made it.</p>`,
    tally: `<label class="f full">Tally voucher reference<input class="i" id="pa-ref" name="ref" required value="${esc(p.tallyRef || '')}"></label>`,
    edit: `<label class="f">Amount (₹)<input class="i" id="pa-amt" name="amount" inputmode="decimal" value="${esc(rupeesIn(p.amountReq))}"></label><label class="f">Due date<input type="date" class="i" id="pa-due" name="due" value="${esc(p.due || '')}"></label><label class="f">Proposed date<input type="date" class="i" id="pa-pd" name="proposedDate" value="${esc(p.proposedDate || '')}"></label><label class="f full">Notes<textarea class="i" id="pa-note" name="note" rows="2">${esc(p.note || '')}</textarea></label><label class="f full">Add documents<input type="file" class="i" id="pa-f" name="files" multiple></label>`,
  };
  const actForm = a && can[a] ? `<form data-f="erp-payact" data-id="${p.id}" data-x="${a}" class="card body" style="background:var(--sunk);border:0"><h3>${LBL[a] || 'Edit'}</h3><div class="grid two">${field[a] || ''}</div><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-pay-act" data-x="">Back</button><button class="btn pri">${LBL[a] || 'Save'}</button></div></form>` : '';
  const btns = Object.keys(LBL).concat(['edit']).filter((k) => can[k]).map((k) => `<button class="btn sm ${['reject', 'cancel'].includes(k) ? 'danger' : ['approve', 'verify', 'record'].includes(k) ? 'pri' : ''}" data-a="erp-pay-act" data-x="${k}">${k === 'edit' ? 'Edit' : LBL[k]}</button>`).join('');
  const pays = (p.payments || []).map((x, i) => `<li>${x.amount < 0 ? '<span class="pill t-bad">Reversal</span> ' : ''}${inr(x.amount)} on ${fmtD(x.date)} from ${esc(bankName(x.bankId))} · ${esc(x.method || '')} ${esc(x.ref)}${x.reason ? ' — ' + esc(x.reason) : ''} · ${esc(nameOf(x.by))}${x.files ? ' ' + fileList(x.files) : ''}${x.amount > 0 && !x.reversed && erpHas('acc') ? ` <button class="btn sm ghost" data-a="erp-pay-rev" data-id="${p.id}" data-i="${i}">Reverse</button>` : ''}${x.reversed ? ' <span class="pill">Reversed</span>' : ''}</li>`).join('');
  const row = (l, v) => `<div><div class="tiny muted">${l}</div><div>${v}</div></div>`;
  return `${mhead(`${esc(p.code)} · ${esc(p.payee)}`, `${pill(PAY_ST, p.status)} ${esc(PAY_CATEGORIES[p.category] || p.category)}`)}
    <div class="body grid">
      <div class="grid two" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
        ${row('Requested', inr(p.amountReq))}${row('Approved', p.amountApproved != null ? inr(p.amountApproved) : '—')}${row('Paid', inr(erpPaid(p)))}${row('Unpaid', ['REJECTED', 'CANCELLED'].includes(p.status) ? '—' : inr(payDue(p)))}
        ${row('Invoice', esc(p.invoiceRef || '—'))}${row('Due', p.due ? fmtD(p.due) : '—')}${row('Scheduled', p.scheduledDate ? fmtD(p.scheduledDate) : '—')}${row('Priority', pill(PAY_PRIO, p.priority))}
        ${row('Account', esc(bankName(p.bankId)))}${p.transferTo ? row('To account', esc(bankName(p.transferTo))) : ''}${row('Method', esc(p.method || '—'))}${row('Tally', esc(p.tallyRef || '—'))}
        ${row('Requested by', esc(nameOf(p.requestedBy)))}${row('Verified by', p.verifiedBy ? esc(nameOf(p.verifiedBy)) : '—')}${row('Approved by', p.approvedBy ? esc(nameOf(p.approvedBy)) : '—')}
      </div>
      ${p.note ? `<p class="small">${esc(p.note)}</p>` : ''}
      ${p.dupOverride ? `<div class="card body" style="background:var(--bad-soft);border:0"><b>Raised despite a possible duplicate</b> (${esc(p.dupOverride.of.join(', '))}) by ${esc(nameOf(p.dupOverride.by))}: “${esc(p.dupOverride.reason)}”</div>` : ''}
      ${p.exception ? `<div class="card body" style="background:var(--bad-soft);border:0"><b>Approved as an exception</b> by ${esc(nameOf(p.exception.by))}: “${esc(p.exception.reason)}”</div>` : ''}
      ${typeof payLinks === 'function' ? payLinks(p) : ''}
      <div><div class="tiny muted">Documents</div>${fileList(p.files)}</div>
      ${pays ? `<div><h3>Payments made</h3><ul class="small">${pays}</ul></div>` : ''}
      ${actForm || (btns ? `<div class="row" style="gap:6px">${btns}</div>` : '')}
      <details><summary class="small">History</summary><ul class="small">${(p.history || []).slice().reverse().map((h) => `<li><span class="tiny muted">${fmtDT(h.at)}</span> ${esc(nameOf(h.by))} — ${esc(h.action)}${h.note ? `: “${esc(h.note)}”` : ''}</li>`).join('')}</ul></details>
    </div><footer><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}

/* ── forecast ── */
function accForecast() {
  const sc = ui('fcSc', 'base'), hz = +ui('fcHz', 90), gran = ui('fcGr', 'week'), acct = ui('fcAc', '');
  const fc = erpForecast(sc, hz);
  const head = `<div class="filters rd-filters">
    <select class="i" id="fc-sc" data-c="fcSc" aria-label="Scenario">${opts([['base', 'Base case — expected receipts on time'], ['conservative', 'Conservative — delayed / reduced receipts'], ['stress', 'Stress — late collections, all outflows']], sc)}</select>
    <select class="i" id="fc-hz" data-c="fcHz" aria-label="Horizon">${opts([[30, '30 days'], [60, '60 days'], [90, '90 days'], [180, '6 months'], [365, '12 months']], hz)}</select>
    <select class="i" id="fc-gr" data-c="fcGr" aria-label="Period">${opts([['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']], gran)}</select>
    <select class="i" id="fc-ac" data-c="fcAc" aria-label="Account">${opts(erpList('erp_bank').filter((b) => b.active !== false).map((b) => [b.id, b.name]), acct, 'Company — all accounts')}</select></div>`;
  if (!fc) return `${head}<div class="body muted small">${ERPF.err ? esc(ERPF.err) : 'Calculating…'}</div>`;
  const a = acct ? fc.accounts.find((x) => x.id === acct) : null, series = a ? a.series : fc.company.series, protect = a ? a.protect : fc.company.protect;
  const buckets = [];
  for (const d of series) {
    const key = gran === 'day' ? d.date : gran === 'month' ? d.date.slice(0, 7) : addDays(d.date, -((new Date(d.date + 'T00:00:00Z').getUTCDay() + 6) % 7));
    let b = buckets[buckets.length - 1];
    if (!b || b.key !== key) { b = { key, from: d.date, in: 0, out: 0, close: 0, low: Infinity }; buckets.push(b); }
    b.in += d.in; b.out += d.out; b.close = d.close; b.low = Math.min(b.low, d.close); b.to = d.date;
  }
  const label = (b) => (gran === 'day' ? fmtD(b.key) : gran === 'month' ? fmtM(b.key) : `${fmtD(b.from)} – ${fmtD(b.to)}`);
  const kp = `<div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">
    <div class="kpi"><div class="l">${a ? 'Verified balance' : 'Verified bank balance'}</div><div class="v">${inr(a ? a.opening || 0 : fc.company.verifiedTotal)}</div><div class="tiny muted">${srcPill('VERIFIED')} ${a ? (a.asOf ? 'as of ' + fmtD(a.asOf) : 'not verified') : fc.company.oldestAsOf ? 'oldest as of ' + fmtD(fc.company.oldestAsOf) : ''}</div></div>
    <div class="kpi"><div class="l">Actual cash today (estimate)</div><div class="v">${inr(a ? a.current : fc.company.current)}</div><div class="tiny muted">verified + movements recorded since</div></div>
    <div class="kpi"><div class="l">Projected closing · ${fmtD(series[series.length - 1].date)}</div><div class="v">${inr(series[series.length - 1].close)}</div><div class="tiny muted">${srcPill('FORECAST')} ${esc(fc.label)}</div></div>
    <div class="kpi"><div class="l">Lowest point</div><div class="v ${Math.min(...series.map((x) => x.close)) < protect ? 'bad' : ''}">${inr(Math.min(...series.map((x) => x.close)))}</div><div class="tiny muted">protected cash ${inr(protect)}</div></div>
    <div class="kpi"><div class="l">Available to spend (forecast)</div><div class="v">${inr(a ? a.availableToSpend : fc.company.availableToSpend)}</div><div class="tiny muted">${srcPill('FORECAST')} lowest point − protected cash</div></div>
  </div>`;
  const tbl = `<div class="tbl-wrap"><table class="t rd-t"><thead><tr><th>Period</th><th class="num">In</th><th class="num">Out</th><th class="num">Closing</th><th class="num">Lowest</th></tr></thead><tbody>${buckets.map((b) => `<tr><td>${label(b)}</td><td class="num">${b.in ? inr(b.in) : '—'}</td><td class="num">${b.out ? inr(-b.out) : '—'}</td><td class="num">${inr(b.close)}</td><td class="num ${b.low < protect ? 'v bad' : ''}">${inr(b.low)}${b.low < protect ? ' ⚠' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const evs = fc.events.filter((e) => !acct || e.bankId === acct);
  const KIND = { RECEIVED: ['Received', 't-ok'], PAID: ['Paid', 't-ok'], TRANSFER_IN: ['Transfer in', 't-info'], EXPECTED_RECEIPT: ['Expected receipt', 't-warn'], PLANNED_PAYMENT: ['Planned payment', 't-vio'], EMI: ['EMI', 't-vio'] };
  const shorts = fc.shortfalls.filter((s) => (acct ? s.bankId === acct : true));
  return `${head}${kp}
    ${shorts.length ? card('Shortfalls', shorts.map((s) => `<div style="margin-bottom:8px"><span class="pill t-bad">${esc(s.name)}</span> on <b>${fmtD(s.date)}</b>: closing ${inr(s.close)} vs protected ${inr(s.protect)} — short by <b>${inr(s.shortBy)}</b>${s.belowZero ? ' (below zero)' : ''}<div class="tiny muted">Largest commitments up to then: ${esc(s.causes.map((c) => `${c.label} ${inr(-c.amount)} on ${fmtD(c.date)}`).join(' · ') || '—')}</div></div>`).join('')) : ''}
    ${card(`${a ? esc(a.name) : 'Company'} · ${esc(fc.label)}`, tbl, { list: true })}
    ${card('What is in the forecast', dataTable('accFe', evs, [
      { k: 'date', label: 'Date', v: (e) => e.date, html: (e) => fmtD(e.date) }, { k: 'kind', label: 'Type', v: (e) => e.kind, html: (e) => `${pill(KIND, e.kind)}${e.pending ? ' <span class="pill t-warn">Pending approval</span>' : ''}${e.overdue ? ' <span class="pill t-bad">Overdue</span>' : ''}` },
      { k: 'what', label: 'What', v: (e) => e.label }, { k: 'acct', label: 'Account', v: (e) => (e.bankId ? bankName(e.bankId) : 'Not assigned') },
      { k: 'amt', label: 'Amount', num: true, v: (e) => e.amount, html: (e) => `<span class="${e.amount < 0 ? '' : 'v ok'}">${inr(e.amount, { sign: true })}</span>` },
    ], { name: 'Forecast items', pageSize: 30 }), { list: true })}
    <p class="tiny muted">Projected closing = verified opening + money received / paid since + expected receipts − planned payments, EMIs and approved commitments. ${esc(fc.label)} rules: ${sc === 'base' ? 'firm and likely receipts on their dates; uncertain ones left out; overdue ones a week from today; payments awaiting approval included.' : sc === 'conservative' ? 'firm receipts a week late; likely ones half, two weeks late; overdue ones half, a month late; uncertain ones left out.' : 'only firm receipts, a month late; every planned and on-hold payment included.'} Transfers between company accounts don’t change the company total.</p>`;
}

/* ── actions ── */
Object.assign(ERP_ACTIONS, {
  'erp-bank': (el) => openModal(() => bankModal(el.dataset.id || null)),
  'erp-bal': (el) => openModal(() => balModal(el.dataset.id)),
  'erp-rcpt-new': () => openModal(() => rcptModal(null)),
  'erp-rcpt': (el) => openModal(() => rcptModal(el.dataset.id)),
  'erp-rc-act': (el) => { const x = el.dataset.x, id = el.dataset.id; if (x === 'undispute') return erpAct(() => erpCall('rcpt.update', { id, action: x }), 'Dispute resolved'); return confirmBox(x === 'cancel' ? 'Cancel this expected receipt?' : 'Mark this receipt as disputed?', 'Give a reason — it is kept with the receipt.', (reason) => erpAct(() => erpCall('rcpt.update', { id, action: x, text: reason }), 'Saved'), { input: 'Reason', danger: x === 'cancel' }); },
  'erp-pay-new': () => { ERPUI.dup = null; S.ui.pnCat = null; openModal(() => payNewModal()); },
  'erp-pay': (el) => { ERPUI.payAct = null; openModal(() => payModal(el.dataset.id)); },
  'erp-pay-act': (el) => { ERPUI.payAct = el.dataset.x || null; drawModal(); },
  'erp-pay-rev': (el) => confirmBox('Reverse this payment?', 'Use this when the bank returned or bounced the payment. The original entry is kept; the amount becomes payable again.', (reason) => erpAct(() => erpCall('pay.act', { id: el.dataset.id, action: 'reverse', index: +el.dataset.i, note: reason }), 'Reversal recorded'), { input: 'Reason (e.g. returned — wrong IFSC)' }),
});
Object.assign(ERP_FORMS, {
  'erp-bank': (form, fd, v) => erpAct(async () => { await erpCall('bank.save', { id: form.dataset.id || undefined, name: v('name'), bank: v('bank'), last4: v('last4'), currency: v('currency'), openingAmount: v('openingAmount'), openingDate: v('openingDate'), buffer: v('buffer'), restricted: v('restricted'), restrictedNote: v('restrictedNote'), active: v('active') !== 'no' }); closeModal(); }, 'Bank account saved'),
  'erp-bal': (form, fd, v) => erpAct(async () => { await erpCall('bal.verify', { bankId: form.dataset.id, amount: v('amount'), asOf: v('asOf'), note: v('note') }); closeModal(); }, 'Verified balance saved'),
  'erp-rcpt': (form, fd, v) => erpAct(async () => { const r = await erpCall('rcpt.save', { id: form.dataset.id || undefined, customer: v('customer'), ref: v('ref'), amount: v('amount'), bankId: v('bankId'), expectedDate: v('expectedDate'), promisedDate: v('promisedDate'), certainty: v('certainty'), tallyRef: v('tallyRef'), note: v('note') }); if (!form.dataset.id) closeModal(); else drawModal(); return r; }, 'Receipt saved'),
  'erp-rcv': (form, fd, v) => erpAct(async () => { const files = await erpFiles(form.querySelector('[name="files"]')); await erpCall('rcpt.receive', { id: form.dataset.id, amount: v('amount'), date: v('date'), bankId: v('bankId'), ref: v('ref'), files }); drawModal(); }, 'Receipt recorded'),
  'erp-pay-new': (form, fd, v, submitter) => erpAct(async () => {
    const files = await erpFiles(form.querySelector('[name="files"]'));
    const args = { category: v('category'), payee: v('payee'), transferTo: v('transferTo') || undefined, invoiceRef: v('invoiceRef'), amount: v('amount'), due: v('due'), proposedDate: v('proposedDate'), priority: v('priority'), bankId: v('bankId') || undefined, method: v('method'), tallyRef: v('tallyRef'), note: v('note'), files, submit: submitter?.value !== 'draft', clientKey: form.dataset.k, ...(v('override') ? { override: { reason: v('override') } } : {}), ...(ERPUI.pre || {}) };
    try { const r = await erpCall('pay.create', args); ERPUI.dup = null; ERPUI.pre = null; closeModal(); return r; } catch (e) { if (e?.code === 'conflict') { ERPUI.dup = e.message; form.dataset.k = ckey(); drawModal(); } throw e; }
  }, submitter?.value === 'draft' ? 'Draft saved' : 'Payment request submitted'),
  'erp-payact': (form, fd, v) => erpAct(async () => {
    const x = form.dataset.x, files = form.querySelector('[name="files"]') ? await erpFiles(form.querySelector('[name="files"]')) : undefined;
    const args = { id: form.dataset.id, action: x, note: v('note') || undefined, amount: fd.has('amount') ? v('amount') : undefined, date: v('date') || undefined, bankId: v('bankId') || undefined, method: v('method') || undefined, ref: v('ref') || undefined, files, due: fd.has('due') ? v('due') : undefined, proposedDate: fd.has('proposedDate') ? v('proposedDate') : undefined, exception: v('exception') || undefined };
    await erpCall('pay.act', args); ERPUI.payAct = null; drawModal();
  }, 'Saved'),
});
</script>
