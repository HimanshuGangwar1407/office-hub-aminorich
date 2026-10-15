<script>
/* ═════════════ Accounts: EMIs & loans, and the monthly funds reservation calendar ═════════════
   Loans and their schedules are in erp_loan (server/erp-loans.js). The calendar is the forecast's own commitments
   grouped by date — reservations are planning figures, not withdrawals or separate balances. */

const LOAN_TYPES = { TERM: 'Term loan', WORKING_CAPITAL: 'Working capital', VEHICLE: 'Vehicle', MACHINERY: 'Machinery', PROPERTY: 'Property', OTHER: 'Other' };
const FREQS = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', HALF_YEARLY: 'Half-yearly', YEARLY: 'Yearly' };
const emiState = (i, T = today()) => (i.paid ? 'PAID' : i.skipped ? 'SKIPPED' : i.due < T ? 'OVERDUE' : i.payId ? 'REQUESTED' : 'DUE');
const EMI_ST = { PAID: ['Paid', 't-ok'], SKIPPED: ['Skipped', ''], OVERDUE: ['Overdue', 't-bad'], REQUESTED: ['Payment requested', 't-vio'], DUE: ['Upcoming', 't-info'] };
const ACC_TABS_EXTRA = [
  ['loans', 'EMIs & loans', () => accLoans(), () => erpList('erp_loan').reduce((n, l) => n + (l.status === 'ACTIVE' ? (l.schedule || []).filter((i) => emiState(i) === 'OVERDUE').length : 0), 0) || ''],
  ['cal', 'Funds calendar', () => accCalendar()],
];
function emiDashKpi(k) {
  const T = today(), d30 = addDays(T, 30), rows = [];
  for (const l of erpList('erp_loan').filter((x) => x.status === 'ACTIVE')) for (const i of l.schedule || []) if (!i.paid && !i.skipped && i.due <= d30) rows.push(i);
  const over = rows.filter((i) => i.due < T);
  return k('EMIs due · next 30 days', inr(sumBy(rows, (i) => i.amount)), 'RESERVED', `${rows.length} instalment${rows.length === 1 ? '' : 's'}${over.length ? ` · <span class="v bad">${over.length} overdue</span>` : ''}`, 'loans');
}
// reminders and overdue flags: checked when Accounts opens the app (each is sent once — server/erp-loans.js erp.tick)
// checked again whenever loans change (a new loan can be due within the reminder window); the server sends each once
const ERPT = { key: '' };
function erpTick() {
  if (!erpHas('acc') || !ERPD.c.erp_loan) return;
  const key = today() + '|' + erpList('erp_loan').map((l) => `${l.id}:${l.updatedAt || 0}`).join(',');
  if (ERPT.key === key) return;
  ERPT.key = key; window.OH.api('erp', { cmd: 'erp.tick', args: {} }).then(() => window.OH.sync?.()).catch(() => { ERPT.key = ''; });
}

function accLoans() {
  erpTick();
  const loans = erpList('erp_loan'), st = ui('lnSt', 'ACTIVE');
  const list = loans.filter((l) => !st || l.status === st);
  const next = (l) => (l.schedule || []).find((i) => !i.paid && !i.skipped);
  return `${card(`Loans · ${list.length}`, dataTable('accL', list, [
      { k: 'code', label: 'Loan', v: (l) => l.code, html: (l) => `<b class="small">${esc(l.code)}</b><div class="tiny muted">${esc(LOAN_TYPES[l.type] || l.type)}</div>` },
      { k: 'lender', label: 'Lender', v: (l) => l.lender, html: (l) => `${esc(l.lender)}<div class="tiny muted">${esc(l.ref)}</div>` },
      { k: 'emi', label: 'EMI', num: true, v: (l) => l.emi, html: (l) => `${inr(l.emi)}<div class="tiny muted">${esc(FREQS[l.frequency] || '')}</div>` },
      { k: 'next', label: 'Next due', v: (l) => next(l)?.due || '9999', html: (l) => { const i = next(l); return i ? `${fmtD(i.due)} ${pill(EMI_ST, emiState(i))}` : '—'; } },
      { k: 'left', label: 'Remaining', num: true, v: (l) => sumBy((l.schedule || []).filter((i) => !i.paid && !i.skipped), (i) => i.amount), html: (l) => `${inr(sumBy((l.schedule || []).filter((i) => !i.paid && !i.skipped), (i) => i.amount))}<div class="tiny muted">${(l.schedule || []).filter((i) => !i.paid && !i.skipped).length} of ${(l.schedule || []).length} left</div>` },
      { k: 'acct', label: 'Account', v: (l) => bankName(l.bankId) },
      { k: 'st', label: 'Status', v: (l) => l.status, html: (l) => pill({ ACTIVE: ['Active', 't-ok'], CLOSED: ['Closed', ''] }, l.status) },
    ], { name: 'Loans', click: (l) => `data-a="erp-loan" data-id="${l.id}"`, empty: 'No loans entered.' }), { list: true, actions: `<select class="i" id="ln-st" data-c="lnSt" aria-label="Status" style="width:auto">${opts([['ACTIVE', 'Active'], ['CLOSED', 'Closed']], st, 'All')}</select><button class="btn pri sm" data-a="erp-loan-new">Add loan</button>` })}
    <p class="tiny muted">EMIs are in the cash-flow forecast from their due dates. Accounts is reminded ${esc(erpCfg().emiRemind.join(', '))} days before each one (set in Finance setup), with a warning when the linked account may not have enough.</p>`;
}
function loanNewModal() {
  return `${mhead('Add loan', 'The repayment schedule is generated from these terms — you can import the lender’s schedule afterwards')}<form data-f="erp-loan"><div class="body grid two">
    <label class="f">Lender<input class="i" id="ln-l" name="lender" required></label><label class="f">Loan reference / account no.<input class="i" id="ln-r" name="ref" required></label>
    <label class="f">Type<select class="i" id="ln-t" name="type">${opts(Object.entries(LOAN_TYPES), 'TERM')}</select></label><label class="f">Linked bank account (EMIs are paid from)<select class="i" id="ln-b" name="bankId" required>${bankOpts('')}</select></label>
    <label class="f">Original loan amount (₹, optional)<input class="i" id="ln-p" name="principal" inputmode="decimal"></label><label class="f">Outstanding principal (₹, optional)<input class="i" id="ln-o" name="outstanding" inputmode="decimal"></label>
    <label class="f">EMI amount (₹)<input class="i" id="ln-e" name="emi" required inputmode="decimal"></label><label class="f">Number of instalments (remaining)<input class="i" id="ln-n" name="n" required inputmode="numeric"></label>
    <label class="f">Next / first EMI date<input type="date" class="i" id="ln-f" name="firstDue" required></label><label class="f">Frequency<select class="i" id="ln-q" name="frequency">${opts(Object.entries(FREQS), 'MONTHLY')}</select></label>
    <label class="f">Interest rate (% a year, optional — to split interest / principal)<input class="i" id="ln-i" name="rate" inputmode="decimal"></label>
    <label class="f">Weekend due dates<select class="i" id="ln-w" name="weekendRule">${opts([['NONE', 'Keep the date'], ['NEXT_WORKING', 'Move Saturday / Sunday to Monday']], 'NONE')}</select></label>
    <label class="f full">Notes<input class="i" id="ln-no" name="note"></label><label class="f full">Sanction letter / schedule (optional)<input type="file" class="i" id="ln-fi" name="files" multiple></label>
    </div><footer><span style="flex:1"></span><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Save loan</button></footer></form>`;
}
function loanModal(id) {
  const l = erpGet('erp_loan', id);
  if (!l) return `${mhead('Loan')}<div class="body">${empty('This loan isn’t available.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const x = ERPUI.loanAct, T = today();
  const rows = (l.schedule || []).map((i) => {
    const s = emiState(i, T), p = i.payId ? erpGet('erp_pay', i.payId) : null;
    const acts = l.status !== 'ACTIVE' || i.paid || i.skipped ? '' : `${i.payId ? `<button class="btn sm ghost" data-a="erp-pay" data-id="${i.payId}">${esc(p?.code || 'Request')}</button>` : `<button class="btn sm" data-a="erp-emi-req" data-id="${l.id}" data-n="${i.n}">Request payment</button><button class="btn sm ghost" data-a="erp-loan-act" data-x="paid:${i.n}">Auto-debited</button>`}<button class="btn sm ghost" data-a="erp-loan-act" data-x="fix:${i.n}">Correct</button>`;
    return `<tr><td>${i.n}</td><td>${fmtD(i.due)}</td><td class="num">${inr(i.amount)}</td><td class="num">${i.principal != null ? inr(i.principal) : '—'}</td><td class="num">${i.interest != null ? inr(i.interest) : '—'}</td><td>${pill(EMI_ST, s)}${i.paid ? `<div class="tiny muted">${fmtD(i.paid.date)} · ${esc(i.paid.ref || '')}</div>` : ''}</td><td><span class="row" style="gap:4px;flex-wrap:nowrap">${acts}</span></td></tr>`;
  }).join('');
  const [kind, n] = String(x || '').split(':'), inst = n ? (l.schedule || []).find((i) => i.n === +n) : null;
  const form = kind === 'paid' && inst ? `<form data-f="erp-loan-paid" data-id="${l.id}" data-n="${inst.n}" class="card body" style="background:var(--sunk);border:0"><h3>EMI ${inst.n} debited by the bank</h3><div class="grid two"><label class="f">Debit date<input type="date" class="i" id="lp-d" name="date" required max="${T}" value="${inst.due <= T ? inst.due : T}"></label><label class="f">Bank reference of the debit<input class="i" id="lp-r" name="ref" required></label></div><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-loan-act" data-x="">Back</button><button class="btn pri">Record</button></div></form>`
    : kind === 'fix' && inst ? `<form data-f="erp-loan-fix" data-id="${l.id}" data-n="${inst.n}" class="card body" style="background:var(--sunk);border:0"><h3>Correct EMI ${inst.n}</h3><div class="grid two"><label class="f">Due date<input type="date" class="i" id="lf-d" name="due" value="${inst.due}"></label><label class="f">Amount (₹)<input class="i" id="lf-a" name="amount" inputmode="decimal" value="${esc(rupeesIn(inst.amount))}"></label><label class="row small full" style="gap:6px"><input type="checkbox" name="skip"> Skip this instalment (e.g. moratorium agreed with the lender)</label><label class="f full">Reason (recorded)<input class="i" id="lf-r" name="reason" required></label></div><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-loan-act" data-x="">Back</button><button class="btn pri">Save correction</button></div></form>`
    : kind === 'import' ? `<form data-f="erp-loan-import" data-id="${l.id}" class="card body" style="background:var(--sunk);border:0"><h3>Import the lender’s schedule</h3><p class="tiny muted">CSV with columns: due date, EMI, principal (optional), interest (optional). Dates as YYYY-MM-DD or DD/MM/YYYY. Paid instalments are kept; unpaid ones are replaced.</p><label class="f">CSV file<input type="file" class="i" id="li-f" name="csv" accept=".csv,text/csv"></label><label class="f">…or paste the rows<textarea class="i" id="li-t" name="text" rows="5" placeholder="2026-11-21, 105000, 96000, 9000"></textarea></label><label class="f">Reason (recorded)<input class="i" id="li-r" name="reason" required placeholder="e.g. revised schedule after the rate change"></label><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-loan-act" data-x="">Back</button><button class="btn pri">Import</button></div></form>`
    : kind === 'close' ? `<form data-f="erp-loan-close" data-id="${l.id}" class="card body" style="background:var(--sunk);border:0"><h3>Close the loan</h3><label class="f">Reason<input class="i" id="lc-r" name="reason" required placeholder="e.g. foreclosed on 10 Oct — NOC received"></label><div class="row"><span style="flex:1"></span><button type="button" class="btn" data-a="erp-loan-act" data-x="">Back</button><button class="btn danger">Close loan</button></div></form>` : '';
  return `${mhead(`${esc(l.code)} · ${esc(l.lender)}`, `${esc(l.ref)} · ${inr(l.emi)} ${esc((FREQS[l.frequency] || '').toLowerCase())} · ${esc(bankName(l.bankId))}`)}
    <div class="body grid">
      ${form || (l.status === 'ACTIVE' ? `<div class="row" style="gap:6px"><button class="btn sm" data-a="erp-loan-act" data-x="import">Import lender’s schedule</button><button class="btn sm danger" data-a="erp-loan-act" data-x="close">Close loan</button></div>` : `<p class="small">Closed${l.closed ? `: ${esc(l.closed.reason)} (${esc(nameOf(l.closed.by))})` : ' — all instalments paid'}.</p>`)}
      <div class="tbl-wrap"><table class="t rd-t"><thead><tr><th>#</th><th>Due</th><th class="num">EMI</th><th class="num">Principal</th><th class="num">Interest</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      ${(l.corrections || []).length ? `<details><summary class="small">Corrections</summary><ul class="small">${l.corrections.slice().reverse().map((c) => `<li><span class="tiny muted">${fmtDT(c.at)}</span> ${esc(nameOf(c.by))} — ${esc(c.what || '')}: “${esc(c.reason)}”</li>`).join('')}</ul></details>` : ''}
      <div><div class="tiny muted">Documents</div>${fileList(l.files)}</div>
    </div><footer><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}

/* ── funds reservation calendar ── */
function accCalendar() {
  const m = ui('calM', thisMonth()), T = today(), end = monthEnd(m);
  const horizon = Math.min(366, Math.max(7, (Date.parse(end) - Date.parse(T)) / 864e5 + 1));
  const fc = end < T ? null : erpForecast('base', Math.round(horizon));
  const head = `<div class="filters rd-filters"><select class="i" id="cal-m" data-c="calM" aria-label="Month" style="max-width:220px">${(() => { const out = []; let x = T.slice(0, 7); for (let i = 0; i < 12; i++) { out.push([x, fmtM(x)]); x = addDays(x + '-28', 5).slice(0, 7); } return opts(out, m); })()}</select>
    <select class="i" id="cal-ac" data-c="calAc" aria-label="Account">${opts(erpList('erp_bank').filter((b) => b.active !== false).map((b) => [b.id, b.name]), ui('calAc', ''), 'All accounts')}</select></div>`;
  if (end < T) return `${head}${empty('Pick this month or a later one — the calendar shows commitments still to come.')}`;
  if (!fc) return `${head}<div class="body muted small">${ERPF.err ? esc(ERPF.err) : 'Calculating…'}</div>`;
  const acct = ui('calAc', '');
  const evs = fc.events.filter((e) => e.amount < 0 && ['EMI', 'PLANNED_PAYMENT'].includes(e.kind) && e.date.slice(0, 7) === m && (!acct || e.bankId === acct));
  const byDay = new Map(); for (const e of evs) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
  const closeOf = (bankId, d) => { const a = fc.accounts.find((x) => x.id === bankId); return a ? a.series.find((x) => x.date === d) : null; };
  const total = sumBy(evs, (e) => -e.amount), unapproved = sumBy(evs.filter((e) => e.pending), (e) => -e.amount);
  const days = [...byDay.keys()].sort().map((d) => `<tr class="cal-day"><td colspan="5"><b>${fmtD(d)}</b> <span class="tiny muted">${inr(sumBy(byDay.get(d), (e) => -e.amount))} required</span></td></tr>${byDay.get(d).map((e) => { const c = e.bankId ? closeOf(e.bankId, d) : null, a = fc.accounts.find((x) => x.id === e.bankId); return `<tr><td>${esc(e.label)}<div class="tiny muted">${esc(PAY_CATEGORIES[e.category] || (e.kind === 'EMI' ? 'EMI' : ''))}</div></td><td class="num">${inr(-e.amount)}</td><td>${esc(e.bankId ? bankName(e.bankId) : 'Account not decided')}</td><td>${e.kind === 'EMI' ? '<span class="pill t-vio">Scheduled EMI</span>' : e.pending ? '<span class="pill t-warn">Not yet approved</span>' : '<span class="pill t-acc">Approved</span>'}${e.overdue ? ' <span class="pill t-bad">Overdue</span>' : ''}</td><td class="num">${c ? `<span class="${c.close < a.protect ? 'v bad' : ''}">${inr(c.close)}</span>` : '—'}</td></tr>`; }).join('')}`).join('');
  return `${head}<div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">
      <div class="kpi"><div class="l">Required in ${esc(fmtM(m))}</div><div class="v">${inr(total)}</div><div class="tiny muted">${srcPill('RESERVED')} ${evs.length} commitment${evs.length === 1 ? '' : 's'}</div></div>
      <div class="kpi"><div class="l">Of which not yet approved</div><div class="v">${inr(unapproved)}</div><div class="tiny muted">${srcPill('PENDING')}</div></div>
      <div class="kpi"><div class="l">Projected cash at month end</div><div class="v">${inr(acct ? closeOf(acct, end)?.close ?? 0 : fc.company.series.find((x) => x.date === end)?.close ?? fc.company.closeEnd)}</div><div class="tiny muted">${srcPill('FORECAST')} base case</div></div></div>
    ${card(`Commitments · ${esc(fmtM(m))}`, evs.length ? `<div class="tbl-wrap"><table class="t rd-t"><thead><tr><th>What</th><th class="num">Amount</th><th>Account</th><th>Status</th><th class="num">Account’s projected cash that day</th></tr></thead><tbody>${days}</tbody></table></div>` : empty('No EMIs or planned payments this month.'), { list: true })}
    <p class="tiny muted">Reservations are planning figures — they are not withdrawals or separate balances. Salaries, taxes, rent, utilities and supplier payments appear here once a payment request exists for them; EMIs appear from the loan schedule until a payment request is raised (then through the request, never twice).</p>`;
}

/* ── actions ── */
ERPUI.loanAct = null;
Object.assign(ERP_ACTIONS, {
  'erp-loan-new': () => openModal(() => loanNewModal()),
  'erp-loan': (el) => { ERPUI.loanAct = null; openModal(() => loanModal(el.dataset.id)); },
  'erp-loan-act': (el) => { ERPUI.loanAct = el.dataset.x || null; drawModal(); },
  'erp-emi-req': (el) => erpAct(async () => { await erpCall('loan.request', { id: el.dataset.id, n: +el.dataset.n }); drawModal(); }, 'Payment request raised — Accounts verifies and approves it as usual'),
});
/** "2026-11-21, 1,05,000, 96000, 9000" or "21/11/2026;105000" → rows (dates to YYYY-MM-DD) */
function parseScheduleCsv(textIn) {
  const out = [];
  for (const raw of String(textIn || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const cells = line.match(/("([^"]*)"|[^,;\t]+)/g)?.map((c) => c.replace(/^"|"$/g, '').trim()) || [];
    let [d, amount, principal, interest] = cells;
    const m1 = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(d || '');
    if (m1) d = `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue; // a header or a blank line
    out.push({ due: d, amount, principal: principal || '', interest: interest || '' });
  }
  return out;
}
Object.assign(ERP_FORMS, {
  'erp-loan': (form, fd, v) => erpAct(async () => { const files = await erpFiles(form.querySelector('[name="files"]')); await erpCall('loan.save', { lender: v('lender'), ref: v('ref'), type: v('type'), bankId: v('bankId'), principal: v('principal'), outstanding: v('outstanding'), emi: v('emi'), n: Number(v('n')), firstDue: v('firstDue'), frequency: v('frequency'), rate: v('rate'), weekendRule: v('weekendRule'), note: v('note'), files }); closeModal(); }, 'Loan saved — its EMIs are now in the forecast'),
  'erp-loan-paid': (form, fd, v) => erpAct(async () => { await erpCall('loan.paid', { id: form.dataset.id, n: +form.dataset.n, date: v('date'), ref: v('ref') }); ERPUI.loanAct = null; drawModal(); }, 'EMI recorded as paid'),
  'erp-loan-fix': (form, fd, v) => erpAct(async () => { await erpCall('loan.fix', { id: form.dataset.id, n: +form.dataset.n, due: v('due'), amount: v('amount'), skip: fd.get('skip') === 'on', reason: v('reason') }); ERPUI.loanAct = null; drawModal(); }, 'Correction saved'),
  'erp-loan-close': (form, fd, v) => erpAct(async () => { await erpCall('loan.close', { id: form.dataset.id, reason: v('reason') }); ERPUI.loanAct = null; drawModal(); }, 'Loan closed'),
  'erp-loan-import': (form, fd, v) => erpAct(async () => {
    const f = form.querySelector('[name="csv"]')?.files?.[0];
    const rows = parseScheduleCsv(f ? await f.text() : v('text'));
    if (!rows.length) fail('No instalments found. Each line needs a date and an amount.');
    const r = await erpCall('loan.import', { id: form.dataset.id, rows, reason: v('reason') }); ERPUI.loanAct = null; drawModal(); return r;
  }, 'Schedule imported'),
});
// open a loan from a reminder notification
const _accOpenLoan = () => { if (S.ui.erpOpen && S.ui.erpKind === 'loan' && S.view === 'accounts') { const id = S.ui.erpOpen; S.ui.erpOpen = null; S.ui.accTab = 'loans'; ERPUI.loanAct = null; setTimeout(() => openModal(() => loanModal(id)), 0); } };
const ACC_ON_RENDER = [_accOpenLoan, erpTick];
</script>
