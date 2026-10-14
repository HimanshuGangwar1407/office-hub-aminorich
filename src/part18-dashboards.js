<script>
/* ═════════════ Role dashboards: My workspace (everyone), HR dashboard, Management dashboard ═════════════
   The department manager dashboard is in part17. Everything here is computed from records the server already sends
   to this viewer (server/people-rules.js): the person themselves, their team, the records that name them, and —
   for Admin, HR and Directors — everyone. Nothing is estimated or invented; a missing record is shown as missing. */

// ── one person's month, from the same dayStatus the rest of the app uses ──
const leaveType = (code) => cfg().leaveTypes.find((l) => l.code === code) || null;
const unpaidLeave = (lv) => !!lv && (leaveType(lv.data.lt)?.unpaid || lv.data.lt === 'LWP'); // as payroll does
function monthSummary(e, m) {
  const T = today(), end = monthEnd(m) < T ? monthEnd(m) : T;
  const r = { days: 0, work: 0, present: 0, late: 0, absent: 0, half: 0, leave: 0, lwp: 0, wfh: 0, od: 0, missing: 0, off: 0, pending: 0, halfLeavePaid: 0 };
  if (m + '-01' > T) return { ...r, payable: 0 };
  for (const d of eachDay(m + '-01', end)) {
    const s = dayStatus(e, d);
    if (!s.code) continue; // before joining / after leaving
    r.days++;
    if (s.code === 'WO' || s.code === 'H' || weeklyOff(d) || holidayOn(d)) { r.off++; continue; } // incl. weekends inside a leave
    if (s.code === 'PS') { r.pending++; continue; }
    if (s.code === 'NI') continue; // today, not checked in yet
    r.work++;
    const lv = leaveOn(e.id, d), rem = remoteOn(e.id, d);
    if (s.code === 'LV') { if (unpaidLeave(lv)) r.lwp++; else r.leave++; continue; }
    if (rem) { if (rem.data.kind === 'OD') r.od++; else r.wfh++; }
    if (s.code === 'HD') { r.half++; if (lv?.data.half && !unpaidLeave(lv)) r.halfLeavePaid++; }
    else if (s.code === 'A') r.absent++;
    else if (presentish(s.code)) r.present++;
    if (s.code === 'L') r.late++;
    if (s.code === 'I') r.missing++;
  }
  // payroll input, not a salary: days worked + paid leave, half days count ½ (plus ½ when the other half is paid leave)
  r.payable = round2(r.present + r.leave + r.half * 0.5 + r.halfLeavePaid * 0.5);
  return r;
}
const thisMonth = () => today().slice(0, 7);
const monthOpts = (sel, n = 15) => { const out = []; let m = thisMonth(); for (let i = 0; i < n; i++) { out.push([m, fmtM(m)]); m = addDays(m + '-01', -1).slice(0, 7); } return opts(out, sel); };

// ── a sortable, paginated table with export (state in S.ui[id + …]) ──
const TBL = {};
function dataTable(id, rows, cols, { pageSize = 25, name = 'Export', empty: emptyMsg = 'Nothing to show.', click = null } = {}) {
  const sk = ui(id + 'Sort', ''), dir = ui(id + 'Dir', 'asc'), col = cols.find((c) => c.k === sk);
  let list = rows.slice();
  if (col) list.sort((a, b) => { const x = col.v(a), y = col.v(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }); return dir === 'desc' ? -c : c; });
  TBL[id] = { rows: list, cols, name };
  const pages = Math.max(1, Math.ceil(list.length / pageSize)), page = Math.min(+ui(id + 'Page', 0) || 0, pages - 1), shown = list.slice(page * pageSize, page * pageSize + pageSize);
  if (!list.length) return empty(emptyMsg);
  const th = (c) => `<th class="${c.num ? 'num' : ''}"><button class="th-sort" data-a="rd-sort" data-t="${id}" data-k="${c.k}" aria-label="Sort by ${esc(c.label)}">${esc(c.label)}${sk === c.k ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`;
  return `<div class="tbl-wrap"><table class="t rd-t"><thead><tr>${cols.map(th).join('')}</tr></thead><tbody>
    ${shown.map((r) => `<tr ${click ? `class="click" ${click(r)}` : ''}>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(String(c.v(r) ?? '—'))}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>
  <div class="rd-pager"><span class="tiny muted">${list.length} row${list.length === 1 ? '' : 's'}${pages > 1 ? ` · page ${page + 1} of ${pages}` : ''}</span>
    <span class="row" style="gap:6px">${pages > 1 ? `<button class="btn sm ghost" data-a="rd-page" data-t="${id}" data-p="${page - 1}" ${page === 0 ? 'disabled' : ''}>‹ Previous</button><button class="btn sm ghost" data-a="rd-page" data-t="${id}" data-p="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>Next ›</button>` : ''}
    <button class="btn sm" data-a="rd-export" data-t="${id}">Export</button></span></div>`;
}

/* ═════════════ My workspace — on everyone's Dashboard ═════════════ */
const PAYSLIP = { sub: false, runs: {} };
function ensurePayslips() {
  // the server sends each person only their own line of finalised payroll months (salary users get everything)
  if (PAYSLIP.sub || !S.db) return;
  PAYSLIP.sub = true;
  S.db.collection('payroll').onSnapshot((q) => { const m = {}; q.docs.forEach((d) => { m[d.id] = { id: d.id, ...d.data() }; }); PAYSLIP.runs = m; schedule(); }, () => {});
}
const myPayslips = () => Object.values(PAYSLIP.runs).filter((r) => r.status === 'FINAL' && (r.rows || []).some((x) => x.e === S.me.id)).sort((a, b) => b.month.localeCompare(a.month));
function myWorkspace() {
  if (!S.me) return '';
  ensurePayslips();
  const T = today(), m = thisMonth(), sm = monthSummary(S.me, m), bals = balances(S.me, +T.slice(0, 4)).filter((b) => b.lt.quota || b.used);
  const wfh = reqsOf('WFH_OD', S.me.id).filter((r) => r.status !== 'CANCELLED').sort((a, b) => (b.data.from || '').localeCompare(a.data.from || '')).slice(0, 4);
  const chats = (typeof myChats === 'function' ? myChats() : []).filter((c) => c.last && !c.peek).sort((a, b) => b.last.at - a.last.at).slice(0, 4);
  const slips = myPayslips().slice(0, 4);
  const letters = reqsOf('DOCUMENT', S.me.id).sort((a, b) => b.created - a.created).slice(0, 3);
  const kv = (l, v, c = '') => `<div><span>${l}</span><b class="${c}">${v}</b></div>`;
  return `<h2 class="sec-h">My workspace</h2><div class="dgrid rd-my">
    ${card(`My attendance · ${fmtM(m)}`, `<div class="kv rd-kv">${kv('Present', sm.present, 'ok')}${kv('Late', sm.late, sm.late ? 'warn' : '')}${kv('Absent', sm.absent, sm.absent ? 'bad' : '')}${kv('Leave', sm.leave + sm.lwp)}${kv('WFH / OD', sm.wfh + sm.od)}${kv('Half days', sm.half)}</div>
      ${sm.missing ? `<p class="tiny" style="color:var(--warn);margin:8px 0 0">${sm.missing} day(s) with a missing check-out</p>` : ''}`,
      { actions: `<button class="btn sm ghost" data-a="go" data-go="attendance:mine">History</button><button class="btn sm" data-a="new-req" data-t="CORRECTION">Correction</button>` })}
    ${card('Leave balance', bals.length ? `<div class="kv rd-kv">${bals.map((b) => kv(esc(b.lt.code), b.lt.quota ? b.avail : `${b.used} used`, b.lt.quota && b.avail <= 0 ? 'bad' : '')).join('')}</div>${bals.some((b) => b.pending) ? `<p class="tiny muted" style="margin:8px 0 0">${bals.reduce((s, b) => s + b.pending, 0)} day(s) waiting for approval</p>` : ''}` : empty('No leave types set up yet.'),
      { actions: `<button class="btn sm ghost" data-a="nav" data-v="leave">History</button><button class="btn sm pri" data-a="apply-leave">Apply</button>` })}
    ${card('My WFH / official duty', wfh.length ? `<ul class="list">${wfh.map((r) => `<li data-a="req" data-id="${r.id}" style="cursor:pointer"><span class="grow small">${r.data.kind === 'OD' ? 'Official duty' : 'Work from home'} · ${fmtD(r.data.from)}${r.data.to && r.data.to !== r.data.from ? ' – ' + fmtD(r.data.to) : ''}</span>${pill(RSTAT, r.status)}</li>`).join('')}</ul>` : `<div class="body">${empty('No WFH or official-duty requests yet.')}</div>`,
      { list: true, actions: `<button class="btn sm" data-a="new-req" data-t="WFH_OD">Request</button>` })}
    ${card(`Chats${unreadCount() ? ` <span class="count">${unreadCount()} unread</span>` : ''}`, chats.length ? `<ul class="list">${chats.map((c) => `<li data-a="rd-chat" data-id="${esc(c.id)}" style="cursor:pointer"><span class="grow" style="min-width:0"><b class="small ${unreadIn(c) ? '' : 'muted'}">${esc(c.title)}</b><span class="tiny muted trunc" style="display:block">${c.last.by === S.me.id ? 'You: ' : ''}${esc(c.last.text || '')}</span></span><span class="tiny muted">${ymd(new Date(c.last.at)) === T ? hm(c.last.at) : fmtDs(ymd(new Date(c.last.at)))}</span></li>`).join('')}</ul>` : `<div class="body">${empty('No conversations yet.')}</div>`,
      { list: true, actions: '<button class="btn sm ghost" data-a="nav" data-v="chats">Open chats</button>' })}
    ${card('My documents', `<div class="body grid" style="gap:10px">
        <div><b class="tiny">Payslips</b>${slips.length ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">${slips.map((r) => `<button class="btn sm ghost" data-a="rd-slip" data-m="${esc(r.month)}">${esc(fmtM(r.month))}</button>`).join('')}</div>` : '<div class="tiny muted">None yet — payslips appear when HR finalises a month’s payroll.</div>'}</div>
        <div><b class="tiny">Letters &amp; documents</b>${letters.length ? letters.map((r) => `<div class="row small" style="justify-content:space-between;margin-top:4px"><button class="btn sm ghost" data-a="req" data-id="${r.id}" style="padding:0 4px">${esc(r.title)}</button>${pill(RSTAT, r.status)}</div>`).join('') : '<div class="tiny muted">No document requests.</div>'}
          <button class="btn sm" data-a="new-req" data-t="DOCUMENT" style="margin-top:6px">Request a letter</button></div>
        <div><b class="tiny">Company policies</b><div><button class="btn sm ghost" data-a="nav" data-v="policies" style="padding:0 4px">Open policies</button></div></div>
      </div>`, { list: true })}
  </div>`;
}
function payslipModal(m) {
  const run = PAYSLIP.runs[m], row = run?.rows?.find((x) => x.e === S.me.id);
  if (!run || run.status !== 'FINAL' || !row) return `${mhead('Payslip')}<div class="body">${empty('This payslip isn’t available.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const money = (n) => (n == null ? '—' : `₹${Math.round(+n).toLocaleString('en-IN')}`);
  const line = (l, v) => `<div class="row" style="justify-content:space-between"><span class="small">${l}</span><b class="small">${v}</b></div>`;
  return `${mhead(`Payslip · ${esc(fmtM(m))}`, `${esc(S.me.name)} · ${esc(S.me.code || '')} · finalised ${fmtD(ymd(new Date(run.at)))}`)}
  <div class="body grid" style="gap:12px">
    <div class="grid" style="gap:4px"><h3 class="sec-l" style="margin:0">Attendance</h3>${line('Days counted', `${row.dc ?? '—'}${row.rq != null ? ` of ${row.rq}` : ''}`)}${line('Absent', row.a ?? 0)}${line('Paid leave', row.l ?? 0)}${line('Unpaid leave', row.u ?? 0)}${line('Work from home', row.w ?? 0)}${row.mp ? line('Missing check-outs', row.mp) : ''}</div>
    <div class="grid" style="gap:4px"><h3 class="sec-l" style="margin:0">Pay</h3>${line('Monthly salary', money(row.s))}${line('Earned for days counted', money(row.b))}${row.sc ? line('Short hours', '− ' + money(row.sc)) : ''}${row.wd ? line('WFH rule', '− ' + money(row.wd)) : ''}${row.fi ? line('Fines', '− ' + money(row.fi)) : ''}
      <div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:6px;margin-top:4px"><b>Net pay</b><b>${money(row.n)}</b></div></div>
    <p class="tiny muted" style="margin:0">From the payroll HR finalised for ${fmtM(m)}. Questions: raise a “Help from HR” request.</p>
  </div><footer><button class="btn" data-a="close">Close</button><button class="btn" data-a="rd-slip-print">Print</button></footer>`;
}

/* ═════════════ HR dashboard (Admin and HR) ═════════════ */
const EMP_STATUS = { ACTIVE: 'Active', PROBATION: 'Probation', ON_NOTICE: 'On notice', EXITED: 'Exited' };
const pendingWith = (r) => r.status === 'PENDING' && curStep(r)?.by === S.me.id;
function vHrDash() {
  if (!isHR()) return shell(empty('The HR dashboard is for HR and administrators.'), 'HR dashboard');
  const tab = ui('hrTab', 'people'), m = ui('hrMonth', thisMonth());
  const tabs = [['people', 'Employees'], ['corr', 'Attendance corrections'], ['leave', 'Leave'], ['monthly', 'Monthly report'], ['wfh', 'WFH compliance'], ['payroll', 'Payroll inputs']];
  const head = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-a="ui" data-k="hrTab" data-v="${k}">${l}</button>`).join('')}</div>`;
  const monthPick = `<select class="i" id="hr-month" data-c="hrMonth" aria-label="Month" style="max-width:200px">${monthOpts(m)}</select>`;
  let body = '';
  if (tab === 'people') {
    const q = ui('hrQ', '').trim().toLowerCase(), dept = ui('hrDept', ''), st = ui('hrSt', ''), des = ui('hrDes', '');
    const all = S.emps.filter((e) => (!st ? e.active !== false && e.status !== 'EXITED' : st === 'EXITED' ? e.status === 'EXITED' || e.active === false : e.status === st && e.active !== false))
      .filter((e) => (!dept || e.deptId === dept) && (!des || (e.designation || '') === des) && (!q || `${e.name} ${e.code || ''} ${e.email || ''}`.toLowerCase().includes(q)));
    const designations = [...new Set(S.emps.map((e) => e.designation).filter(Boolean))].sort();
    body = `<div class="filters rd-filters"><input class="i" id="hr-q" data-i="hrQ" placeholder="Search name, employee ID or email" value="${esc(ui('hrQ', ''))}" aria-label="Search">
      <select class="i" id="hr-dept" data-c="hrDept" aria-label="Department">${deptOpts(dept, 'All departments')}</select>
      <select class="i" id="hr-des" data-c="hrDes" aria-label="Designation">${opts(designations.map((d) => [d, d]), des, 'All designations')}</select>
      <select class="i" id="hr-st" data-c="hrSt" aria-label="Status">${opts([['ACTIVE', 'Active'], ['PROBATION', 'Probation'], ['ON_NOTICE', 'On notice'], ['EXITED', 'Exited']], st, 'Current employees')}</select>
      <button class="btn pri" data-a="emp-new">Add employee</button></div>
      ${card(`Employees · ${all.length}`, dataTable('hrP', all, [
        { k: 'name', label: 'Name', v: (e) => e.name, html: (e) => person(e.id, e.designation || '') },
        { k: 'code', label: 'Employee ID', v: (e) => e.code || '' }, { k: 'dept', label: 'Department', v: (e) => deptOf(e.deptId)?.name || '' },
        { k: 'mgr', label: 'Reports to', v: (e) => (e.managerId ? nameOf(e.managerId) : '') }, { k: 'role', label: 'Role', v: (e) => (ROLES.find((r) => r[0] === e.role) || [])[1] || e.role || '' },
        { k: 'status', label: 'Status', v: (e) => EMP_STATUS[e.active === false ? 'EXITED' : e.status || 'ACTIVE'] || e.status }, { k: 'join', label: 'Joined', v: (e) => e.joining || '', html: (e) => (e.joining ? fmtD(e.joining) : '—') },
        { k: 'acct', label: 'Account', v: (e) => (e.userId ? 'Linked' : 'Not created'), html: (e) => (e.userId ? '<span class="pill t-ok">Linked</span>' : '<span class="pill">Not created</span>') },
      ], { name: 'Employees', click: (e) => `data-a="emp" data-id="${e.id}"`, empty: 'No employees match.' }), { list: true })}`;
  }
  if (tab === 'corr' || tab === 'leave') {
    const type = tab === 'corr' ? 'CORRECTION' : 'LEAVE', show = ui('hrRq', 'pending');
    const list = S.reqs.filter((r) => r.type === type && (show === 'pending' ? r.status === 'PENDING' : show === 'mine' ? pendingWith(r) : r.status !== 'PENDING') && (show !== 'decided' || (r.decided || r.created || 0) >= Date.now() - 90 * 864e5));
    const cols = [
      { k: 'code', label: 'Request', v: (r) => r.code, html: (r) => `<b class="small">${esc(r.code)}</b>${pendingWith(r) ? ' <span class="pill t-warn">Your decision</span>' : ''}` },
      { k: 'emp', label: 'Employee', v: (r) => nameOf(r.empId), html: (r) => person(r.empId, deptOf(empById(r.empId)?.deptId)?.name || '') },
      type === 'CORRECTION' ? { k: 'date', label: 'Date', v: (r) => r.data.date || '', html: (r) => `${fmtD(r.data.date)}<div class="tiny muted">In ${esc(r.data.inT || '—')} · Out ${esc(r.data.outT || '—')}</div>` }
        : { k: 'date', label: 'Dates', v: (r) => r.data.from || '', html: (r) => `${fmtD(r.data.from)}${r.data.to !== r.data.from ? ' – ' + fmtD(r.data.to) : ''}<div class="tiny muted">${esc(r.data.lt || '')} · ${+r.data.days || 0} day(s)${r.data.half ? ' · half' : ''}</div>` },
      { k: 'reason', label: 'Reason', v: (r) => r.data.reason || '', html: (r) => `<span class="small">${esc((r.data.reason || '').slice(0, 120))}</span>` },
      { k: 'step', label: 'With', v: (r) => (r.status === 'PENDING' ? nameOf(curStep(r)?.by) : ''), html: (r) => (r.status === 'PENDING' ? `<span class="small">${esc(nameOf(curStep(r)?.by))}</span><div class="tiny muted">${esc(curStep(r)?.label || '')}</div>` : '—') },
      { k: 'status', label: 'Status', v: (r) => r.status, html: (r) => pill(RSTAT, r.status) },
      { k: 'raised', label: 'Raised', v: (r) => r.created || 0, html: (r) => `<span class="small">${fmtD(ymd(new Date(r.created)))}</span>` },
    ];
    body = `<div class="filters rd-filters">${opts ? `<select class="i" id="hr-rq" data-c="hrRq" aria-label="Show" style="max-width:260px">${opts([['pending', 'All pending'], ['mine', 'Waiting for my decision'], ['decided', 'Decided (last 90 days)']], show)}</select>` : ''}
      ${tab === 'leave' ? '<button class="btn ghost" data-a="rd-settings" data-v="leave">Leave policy</button>' : ''}</div>
      ${card(tab === 'corr' ? 'Attendance corrections' : 'Leave applications', dataTable('hr' + type, list, cols, { name: tab === 'corr' ? 'Attendance corrections' : 'Leave applications', click: (r) => `data-a="req" data-id="${r.id}"`, empty: 'Nothing here.' }), { list: true })}
      <p class="tiny muted">Open a request to approve, reject or send it back — the approval chain and its audit trail are unchanged (every decision is recorded in the request and in the audit log).</p>
      ${tab === 'leave' ? card(`Leave balances · ${today().slice(0, 4)}`, dataTable('hrBal', active(), [
        { k: 'name', label: 'Employee', v: (e) => e.name },
        { k: 'dept', label: 'Department', v: (e) => deptOf(e.deptId)?.name || '' },
        ...cfg().leaveTypes.map((lt) => ({ k: 'lt' + lt.code, label: lt.code + ' left', num: true, v: (e) => { const b = balances(e).find((x) => x.lt.code === lt.code); return b ? (lt.quota ? b.avail : b.used) : 0; } })),
      ], { name: 'Leave balances' }), { list: true }) : ''}`;
  }
  if (tab === 'monthly' || tab === 'payroll') {
    const rows = active().map((e) => ({ e, s: monthSummary(e, m) })).filter((r) => r.s.days > 0);
    const base = [{ k: 'name', label: 'Employee', v: (r) => r.e.name }, { k: 'code', label: 'ID', v: (r) => r.e.code || '' }, { k: 'dept', label: 'Department', v: (r) => deptOf(r.e.deptId)?.name || '' }];
    const n = (k, label, f) => ({ k, label, num: true, v: f });
    const cols = tab === 'monthly'
      ? [...base, n('work', 'Working days', (r) => r.s.work), n('present', 'Present', (r) => r.s.present), n('late', 'Late', (r) => r.s.late), n('absent', 'Absent', (r) => r.s.absent), n('half', 'Half days', (r) => r.s.half), n('leave', 'Leave', (r) => r.s.leave), n('lwp', 'Unpaid leave', (r) => r.s.lwp), n('wfh', 'WFH', (r) => r.s.wfh), n('od', 'Official duty', (r) => r.s.od), n('miss', 'Missing check-out', (r) => r.s.missing)]
      : [...base, n('work', 'Working days', (r) => r.s.work), n('present', 'Days present', (r) => r.s.present), n('leave', 'Paid leave', (r) => r.s.leave), n('lwp', 'Unpaid leave', (r) => r.s.lwp), n('half', 'Half days', (r) => r.s.half), n('absent', 'Absent', (r) => r.s.absent), n('wfh', 'WFH days', (r) => r.s.wfh + r.s.od), n('late', 'Late arrivals', (r) => r.s.late), n('pay', 'Payable days', (r) => r.s.payable)];
    const tot = (k) => rows.reduce((a, r) => a + (r.s[k] || 0), 0);
    body = `<div class="filters rd-filters">${monthPick}${tab === 'payroll' && canSalary() ? '<button class="btn ghost" data-a="go" data-go="attendance:salary">Open the salary sheet</button>' : ''}</div>
      <div class="kstrip rd-kpis">${[['Working days (all)', tot('work')], ['Present', tot('present')], ['Absent', tot('absent')], ['Leave', tot('leave') + tot('lwp')], ['Late arrivals', tot('late')], ['WFH / OD', tot('wfh') + tot('od')]].map(([l, v]) => `<div class="kt" style="cursor:default"><span class="l">${l}</span><span class="v">${v}</span></div>`).join('')}</div>
      ${card(`${tab === 'monthly' ? 'Monthly attendance' : 'Payroll inputs'} · ${fmtM(m)}${m === thisMonth() ? ' (so far)' : ''}`, dataTable('hr' + tab, rows, cols, { name: `${tab === 'monthly' ? 'Monthly attendance' : 'Payroll inputs'} ${m}`, click: (r) => `data-a="emp" data-id="${r.e.id}"`, empty: 'No attendance for this month.' }), { list: true })}
      ${tab === 'payroll' ? '<p class="tiny muted">Inputs for payroll, not a salary calculation: payable days = days present + paid leave + ½ × half days (+ ½ when the other half is paid leave). The salary sheet applies the company’s pay rules and is only open to people with salary access.</p>' : '<p class="tiny muted">From check-ins, approved leave and approved WFH / official-duty requests. Weekly offs and holidays are excluded from working days.</p>'}`;
  }
  if (tab === 'wfh') {
    const reqs = S.reqs.filter((r) => r.type === 'WFH_OD' && r.data.from <= monthEnd(m) && (r.data.to || r.data.from) >= m + '-01');
    const byEmp = new Map();
    for (const r of reqs) { const x = byEmp.get(r.empId) || { e: empById(r.empId), approved: 0, pending: 0, rejected: 0, days: 0, checkedIn: 0, located: 0 }; if (!x.e) continue; x[r.status === 'APPROVED' ? 'approved' : r.status === 'PENDING' ? 'pending' : 'rejected']++; byEmp.set(r.empId, x); }
    for (const x of byEmp.values()) {
      for (const d of eachDay(m + '-01', monthEnd(m) < today() ? monthEnd(m) : today())) {
        const rem = remoteOn(x.e.id, d); if (!rem || weeklyOff(d) || holidayOn(d)) continue;
        x.days++; if (punchesOn(x.e.id, d).length) x.checkedIn++; if (lastPing(locOf(x.e.id, d))) x.located++;
      }
    }
    const rows = [...byEmp.values()];
    const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
    body = `<div class="filters rd-filters">${monthPick}<button class="btn ghost" data-a="nav" data-v="wfhlive">Live WFH locations</button></div>
      ${card(`WFH / official duty · ${fmtM(m)}`, dataTable('hrW', rows, [
        { k: 'name', label: 'Employee', v: (x) => x.e.name, html: (x) => person(x.e.id, deptOf(x.e.deptId)?.name || '') },
        { k: 'appr', label: 'Approved requests', num: true, v: (x) => x.approved }, { k: 'pend', label: 'Pending', num: true, v: (x) => x.pending }, { k: 'rej', label: 'Rejected / cancelled', num: true, v: (x) => x.rejected },
        { k: 'days', label: 'Remote working days', num: true, v: (x) => x.days }, { k: 'ci', label: 'Checked in', num: true, v: (x) => x.checkedIn, html: (x) => `${x.checkedIn} <span class="tiny muted">(${pct(x.checkedIn, x.days)})</span>` },
        { k: 'loc', label: 'Shared a location', num: true, v: (x) => x.located, html: (x) => `${x.located} <span class="tiny muted">(${pct(x.located, x.days)})</span>` },
      ], { name: `WFH compliance ${m}`, empty: 'No WFH or official-duty requests this month.' }), { list: true })}
      <p class="tiny muted">“Checked in” and “Shared a location” count remote working days with a check-in, and with at least one shared location (locations are kept for 40 days).</p>`;
  }
  return shell(`${head}${body}`, 'HR dashboard', 'Employees, attendance, leave and payroll inputs — company-wide');
}

/* ═════════════ Management dashboard (Admin and Directors; administration tabs for Admin only) ═════════════ */
const isAdmin = () => S.me?.role === 'ADMIN';
const canMgmtDash = () => ['ADMIN', 'DIRECTOR'].includes(S.me?.role);
const AUD = { sub: false, list: [] };
function ensureAudit() {
  // the server sends the audit log to administrators only
  if (AUD.sub || !S.db || !isAdmin()) return;
  AUD.sub = true;
  S.db.collection('audit').onSnapshot((q) => { AUD.list = docsOf(q).sort((a, b) => (b.at || 0) - (a.at || 0)); schedule(); }, () => {});
}
function deptStats(d, from, to) {
  const ppl = active().filter((e) => e.deptId === d.id);
  let work = 0, present = 0, late = 0, absent = 0, leave = 0, wfh = 0;
  for (const e of ppl) for (const day of eachDay(from, to)) {
    const s = dayStatus(e, day), c = s.code; if (!c || ['WO', 'H', 'PS', 'NI'].includes(c) || weeklyOff(day) || holidayOn(day)) continue;
    work++; if (presentish(c)) present += c === 'HD' ? 0.5 : 1; if (c === 'L') late++; if (c === 'A') absent++; if (c === 'LV') leave++; if (remoteOn(e.id, day)) wfh++;
  }
  const tasks = S.tasks.filter((t) => t.deptId === d.id && t.status !== 'CANCELLED'), open = tasks.filter(openTask);
  const done = tasks.filter((t) => t.status === 'DONE' && t.completedAt && ymd(new Date(t.completedAt)) >= from && ymd(new Date(t.completedAt)) <= to);
  const onTime = done.filter((t) => ymd(new Date(t.completedAt)) <= t.due);
  return { d, people: ppl.length, work, present, late, absent, leave, wfh, att: work ? Math.round((present / work) * 100) : null, open: open.length, overdue: open.filter((t) => overdue(t)).length, blocked: open.filter((t) => t.status === 'BLOCKED').length, done: done.length, onTime: done.length ? Math.round((onTime.length / done.length) * 100) : null, perHead: ppl.length ? round2(open.length / ppl.length) : 0 };
}
function periodRange(kind, val) {
  if (kind === 'quarter') { const [y, q] = val.split('-Q').map(Number); const from = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, to = monthEnd(`${y}-${String(q * 3).padStart(2, '0')}`); return [from, to < today() ? to : today()]; }
  return [val + '-01', monthEnd(val) < today() ? monthEnd(val) : today()];
}
function quarterOpts(sel) { const out = []; let y = +today().slice(0, 4), q = Math.floor((+today().slice(5, 7) - 1) / 3) + 1; for (let i = 0; i < 6; i++) { out.push([`${y}-Q${q}`, `Q${q} ${y}`]); q--; if (!q) { q = 4; y--; } } return opts(out, sel); }
function vMgmtDash() {
  if (!canMgmtDash()) return shell(empty('The management dashboard is for administrators and directors.'), 'Management');
  const admin = isAdmin(), tab = ui('mgTab', 'overview'), T = today();
  const tabs = [['overview', 'Company overview'], ['depts', 'Departments'], ['reports', 'Business reports'], ...(admin ? [['users', 'Users & roles'], ['audit', 'Audit log'], ['config', 'Configuration']] : [])];
  const head = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-a="ui" data-k="mgTab" data-v="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'overview') {
    const all = S.emps, act = active(), st = act.map((e) => ({ e, s: dayStatus(e, T), rem: remoteOn(e.id, T) }));
    const c = (f) => st.filter(f).length;
    const pend = S.reqs.filter((r) => r.status === 'PENDING'), open = S.tasks.filter((t) => openTask(t) && t.status !== 'CANCELLED');
    const late = pend.filter((r) => { const s = curStep(r); return s?.at && Date.now() - s.at > (cfg().slaHours || 24) * 3600000; });
    const kp = [['Employees', all.length, ''], ['Active', act.length, ''], ['Present today', c((x) => ['P', 'L', 'I'].includes(x.s.code) && !x.rem), 'ok'], ['WFH / OD today', c((x) => x.rem && !['LV', 'WO', 'H'].includes(x.s.code)), ''], ['On leave', c((x) => x.s.code === 'LV'), ''], ['Not checked in', c((x) => x.s.code === 'NI'), c((x) => x.s.code === 'NI') ? 'warn' : ''], ['Pending approvals', pend.length, pend.length ? 'warn' : ''], ['Past response time', late.length, late.length ? 'bad' : ''], ['Open tasks', open.length, ''], ['Overdue tasks', open.filter((t) => overdue(t)).length, open.some((t) => overdue(t)) ? 'bad' : '']];
    const m0 = thisMonth(), ds = cfg().depts.map((d) => deptStats(d, m0 + '-01', T));
    const bar = (v, max, cls = '') => `<div class="bar rd-bar"><span class="${cls}" style="width:${max ? Math.round((v / max) * 100) : 0}%"></span></div>`;
    body = `<div class="kstrip rd-kpis">${kp.map(([l, v, cl]) => `<div class="kt" style="cursor:default"><span class="l">${l}</span><span class="v ${cl}">${v}</span></div>`).join('')}</div>
      <div class="dgrid">
        ${card(`Attendance this month by department`, ds.length ? `<div class="body grid" style="gap:10px">${ds.map((x) => `<div><div class="row small" style="justify-content:space-between"><span>${esc(x.d.name)}</span><b>${x.att == null ? '—' : x.att + '%'}</b></div>${bar(x.att || 0, 100)}</div>`).join('')}</div>` : empty('No departments yet.'), { list: true })}
        ${card('Open work by department', ds.length ? `<div class="body grid" style="gap:10px">${ds.map((x) => `<div><div class="row small" style="justify-content:space-between"><span>${esc(x.d.name)}</span><span><b>${x.open}</b> open${x.overdue ? ` · <span style="color:var(--bad)">${x.overdue} overdue</span>` : ''}</span></div>${bar(x.open, Math.max(1, ...ds.map((y) => y.open)))}</div>`).join('')}</div>` : empty('No departments yet.'), { list: true })}
        ${card(`Pending approvals · ${pend.length}`, pend.length ? `<ul class="list">${pend.sort((a, b) => a.created - b.created).slice(0, 6).map((r) => `<li data-a="req" data-id="${r.id}" style="cursor:pointer"><span class="grow small trunc">${esc(r.code)} · ${esc(RTYPE[r.type] || r.type)} · ${esc(nameOf(r.empId))}</span><span class="tiny muted">with ${esc(nameOf(curStep(r)?.by))}</span></li>`).join('')}</ul>` : `<div class="body">${empty('Nothing pending.')}</div>`, { list: true, actions: '<button class="btn sm ghost" data-a="nav" data-v="approvals">Approvals</button>' })}
      </div>`;
  }
  if (tab === 'depts' || tab === 'reports') {
    const kind = tab === 'reports' ? ui('mgKind', 'month') : 'month', val = tab === 'reports' ? ui(kind === 'quarter' ? 'mgQ' : 'mgM', kind === 'quarter' ? `${T.slice(0, 4)}-Q${Math.floor((+T.slice(5, 7) - 1) / 3) + 1}` : thisMonth()) : ui('mgDm', thisMonth());
    const [from, to] = periodRange(kind, val);
    const ds = cfg().depts.map((d) => deptStats(d, from, to));
    const totals = ds.reduce((a, x) => { for (const k of ['people', 'work', 'present', 'late', 'absent', 'leave', 'wfh', 'open', 'overdue', 'blocked', 'done']) a[k] = (a[k] || 0) + x[k]; return a; }, {});
    const pick = tab === 'depts' ? `<select class="i" id="mg-dm" data-c="mgDm" aria-label="Month" style="max-width:200px">${monthOpts(val)}</select>`
      : `<select class="i" id="mg-kind" data-c="mgKind" aria-label="Period" style="max-width:160px">${opts([['month', 'Monthly'], ['quarter', 'Quarterly']], kind)}</select>${kind === 'quarter' ? `<select class="i" id="mg-q" data-c="mgQ" style="max-width:160px">${quarterOpts(val)}</select>` : `<select class="i" id="mg-m" data-c="mgM" style="max-width:200px">${monthOpts(val)}</select>`}`;
    const n = (k, label, f) => ({ k, label, num: true, v: f });
    const cols = [{ k: 'name', label: 'Department', v: (x) => x.d.name, html: (x) => `<b class="small">${esc(x.d.name)}</b><div class="tiny muted">${esc(x.d.headId ? nameOf(x.d.headId) : 'no head')}</div>` }, n('people', 'People', (x) => x.people),
      n('att', 'Attendance %', (x) => x.att ?? -1), n('late', 'Late arrivals', (x) => x.late), n('absent', 'Absences', (x) => x.absent), n('leave', 'Leave days', (x) => x.leave), n('wfh', 'WFH / OD days', (x) => x.wfh),
      n('open', 'Open tasks', (x) => x.open), n('overdue', 'Overdue', (x) => x.overdue), n('blocked', 'Blocked', (x) => x.blocked), n('done', 'Completed', (x) => x.done), n('ontime', 'On time %', (x) => x.onTime ?? -1), n('per', 'Open per person', (x) => x.perHead)];
    for (const c of cols) if (['att', 'ontime'].includes(c.k)) c.html = (x) => { const v = c.v(x); return v < 0 ? '—' : v + '%'; };
    body = `<div class="filters rd-filters">${pick}</div>
      ${tab === 'reports' ? `<div class="kstrip rd-kpis">${[['People', totals.people || 0], ['Attendance', totals.work ? Math.round((totals.present / totals.work) * 100) + '%' : '—'], ['Late arrivals', totals.late || 0], ['Absences', totals.absent || 0], ['Leave days', totals.leave || 0], ['WFH / OD days', totals.wfh || 0], ['Tasks completed', totals.done || 0], ['Overdue now', totals.overdue || 0]].map(([l, v]) => `<div class="kt" style="cursor:default"><span class="l">${l}</span><span class="v">${v}</span></div>`).join('')}</div>` : ''}
      ${card(`${tab === 'depts' ? 'Department comparison' : 'Operational report'} · ${fmtD(from)} – ${fmtD(to)}`, dataTable('mg' + tab, ds, cols, { name: `${tab === 'depts' ? 'Department comparison' : 'Business report'} ${val}`, empty: 'No departments yet.' }), { list: true })}
      <p class="tiny muted">Attendance % = days present (half days count ½) ÷ working days. Completed and on-time use each task’s completion date; open and overdue are as of now. Employees without a department aren’t in any row.</p>`;
  }
  if (tab === 'users' && admin) {
    const q = ui('mgQu', '').trim().toLowerCase(), role = ui('mgRole', '');
    const list = S.emps.filter((e) => (!role || e.role === role) && (!q || `${e.name} ${e.code || ''} ${e.email || ''}`.toLowerCase().includes(q)));
    body = `<div class="filters rd-filters"><input class="i" id="mg-qu" data-i="mgQu" placeholder="Search name, ID or email" value="${esc(ui('mgQu', ''))}"><select class="i" id="mg-role" data-c="mgRole">${opts(ROLES, role, 'All roles')}</select>
      <button class="btn" data-a="rd-settings" data-v="access">Window access by role</button><button class="btn" data-a="rd-settings" data-v="depts">Departments &amp; heads</button><button class="btn pri" data-a="emp-new">Add employee</button></div>
      ${card(`Users & roles · ${list.length}`, dataTable('mgU', list, [
        { k: 'name', label: 'Name', v: (e) => e.name, html: (e) => person(e.id, e.email || '') }, { k: 'role', label: 'Role', v: (e) => e.role, html: (e) => `<span class="pill ${e.role === 'ADMIN' ? 't-bad' : ['HR', 'DIRECTOR'].includes(e.role) ? 't-warn' : e.role === 'MANAGER' ? 't-info' : ''}">${esc((ROLES.find((r) => r[0] === e.role) || [])[1] || e.role)}</span>` },
        { k: 'dept', label: 'Department', v: (e) => deptOf(e.deptId)?.name || '' }, { k: 'mgr', label: 'Reports to', v: (e) => (e.managerId ? nameOf(e.managerId) : '') },
        { k: 'head', label: 'Heads', v: (e) => cfg().depts.filter((d) => d.headId === e.id).map((d) => d.name).join(', ') },
        { k: 'acct', label: 'Account', v: (e) => (e.userId ? 'Linked' : 'Not created') }, { k: 'st', label: 'Status', v: (e) => EMP_STATUS[e.active === false ? 'EXITED' : e.status || 'ACTIVE'] || e.status },
      ], { name: 'Users and roles', click: (e) => `data-a="emp" data-id="${e.id}"` }), { list: true })}
      <p class="tiny muted">Change someone’s role, department or manager from their record (HR and administrators). Every change is recorded in the audit log by the server. Window access by role is an administrator setting.</p>`;
  }
  if (tab === 'audit' && admin) {
    ensureAudit();
    const act = ui('mgAct', ''), who = ui('mgWho', ''), from = ui('mgFrom', ''), to = ui('mgTo', ''), q = ui('mgAq', '').trim().toLowerCase();
    const acts = [...new Set(AUD.list.map((a) => a.action).filter(Boolean))].sort();
    const list = AUD.list.filter((a) => (!act || a.action === act) && (!who || a.by === who) && (!from || ymd(new Date(a.at)) >= from) && (!to || ymd(new Date(a.at)) <= to) && (!q || JSON.stringify(a.detail || {}).toLowerCase().includes(q)));
    const detail = (a) => Object.entries(a.detail || {}).map(([k, v]) => `${k}: ${k === 'emp' ? nameOf(v) : typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
    body = `<div class="filters rd-filters"><select class="i" id="mg-act" data-c="mgAct" aria-label="Action">${opts(acts.map((x) => [x, x.replace(/_/g, ' ').toLowerCase()]), act, 'All actions')}</select>
      <select class="i" id="mg-who" data-c="mgWho" aria-label="By">${peopleOpts(who, 'Anyone')}</select>
      <input type="date" class="i" id="mg-from" data-c="mgFrom" value="${from}" aria-label="From"><input type="date" class="i" id="mg-to" data-c="mgTo" value="${to}" aria-label="To">
      <input class="i" id="mg-aq" data-i="mgAq" placeholder="Search details" value="${esc(ui('mgAq', ''))}"></div>
      ${card(`Audit log · ${list.length}`, AUD.sub && !AUD.list.length ? `<div class="body muted small">Loading…</div>` : dataTable('mgA', list, [
        { k: 'at', label: 'When', v: (a) => a.at || 0, html: (a) => `<span class="small">${fmtDT(a.at)}</span>` }, { k: 'by', label: 'By', v: (a) => (a.by ? nameOf(a.by) : 'System') },
        { k: 'action', label: 'Action', v: (a) => a.action || '', html: (a) => `<span class="pill">${esc((a.action || '').replace(/_/g, ' ').toLowerCase())}</span>` }, { k: 'detail', label: 'Details', v: (a) => detail(a), html: (a) => `<span class="small">${esc(detail(a)).slice(0, 300)}</span>` },
        { k: 'edit', label: '', v: () => '', html: (a) => `<span class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-a="rd-aud-edit" data-id="${esc(a.id)}">Edit</button><button class="btn sm danger" data-a="rd-aud-del" data-id="${esc(a.id)}">Delete</button></span>` },
      ], { name: 'Audit log', pageSize: 50, empty: 'No entries match.' }), { list: true })}
      <p class="tiny muted">Recorded by the server for approvals, attendance changed by someone other than the employee, and role / department / manager / status changes; recorded by the app for settings, leave policy, payroll, salary, fines, claims and passwords. Only administrators can read it, and nobody can change or delete it.</p>`;
  }
  if (tab === 'config' && admin) {
    const C = cfg();
    const item = (k, l, d) => `<li data-a="rd-settings" data-v="${k}" style="cursor:pointer"><span class="grow"><b class="small">${l}</b><span class="tiny muted" style="display:block">${d}</span></span><span class="tiny muted">Open ›</span></li>`;
    body = card('Configuration', `<ul class="list">${item('depts', 'Departments & heads', `${C.depts.length} department(s)`)}${item('calendar', 'Shift, weekly off & holidays', `Shift ${esc(C.shift.start)}–${esc(C.shift.end)} · ${C.holidays.length} holiday(s)`)}${item('leave', 'Leave policy', `${C.leaveTypes.length} leave type(s)`)}${item('general', 'Attendance & approvals', `Source: ${C.attSource === 'device' ? 'machine import' : 'web check-in'} · response time ${+C.slaHours || 24} h`)}${item('ann', 'Announcements', `${(C.announcements || []).length} posted`)}${item('access', 'Window access by role', 'Who sees which part of the app')}</ul>`, { list: true });
  }
  return shell(`${head}${body}`, 'Management', admin ? 'Company overview, departments, reports and administration' : 'Company overview, departments and reports');
}

async function rdAction(a, el) {
  const t = el.dataset.t;
  switch (a) {
    case 'rd-sort': { const k = el.dataset.k; if (ui(t + 'Sort', '') === k) S.ui[t + 'Dir'] = ui(t + 'Dir', 'asc') === 'asc' ? 'desc' : 'asc'; else { S.ui[t + 'Sort'] = k; S.ui[t + 'Dir'] = 'asc'; } S.ui[t + 'Page'] = 0; return schedule(); }
    case 'rd-page': S.ui[t + 'Page'] = Math.max(0, +el.dataset.p || 0); return schedule();
    case 'rd-export': { const x = TBL[t]; if (!x) return; return exportXlsx(x.name, x.cols.map((c) => c.label), x.rows.map((r) => x.cols.map((c) => c.v(r) ?? ''))); }
    case 'rd-chat': S.ui.chat = el.dataset.id; S.ui.chTab = 'msgs'; return setView('chats');
    case 'rd-slip': return openModal(() => payslipModal(el.dataset.m));
    case 'rd-slip-print': return window.print();
    case 'rd-settings': S.ui.sTab = el.dataset.v; return setView('settings');
    // administrators correct or remove audit entries; the server records each change as a new entry
    case 'rd-aud-edit': return openModal(() => audEditModal(el.dataset.id));
    case 'rd-aud-save': return act(async () => {
      const id = el.dataset.id, action = ($('#ae-act')?.value || '').trim().toUpperCase().replace(/\s+/g, '_');
      let detail; try { detail = JSON.parse($('#ae-det')?.value || '{}'); } catch { fail('Details must be valid JSON, e.g. {"emp": "E1"}.'); }
      if (!action) fail('Enter the action.');
      await patch(`audit/${id}`, { action, detail }); closeModal();
    }, 'Audit entry updated');
    case 'rd-aud-del': { const id = el.dataset.id; return confirmBox('Delete this audit entry?', 'It is removed from the audit log for everyone. The deletion itself is recorded as a new entry.', () => act(() => S.db.doc(`audit/${id}`).delete(), 'Audit entry deleted')); }
  }
}
function audEditModal(id) {
  const a = AUD.list.find((x) => x.id === id);
  if (!a) return `${mhead('Edit audit entry')}<div class="body">${empty('This entry no longer exists.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  return `${mhead('Edit audit entry')}<div class="body grid"><p class="tiny muted">${fmtDT(a.at)} · ${esc(a.by ? nameOf(a.by) : 'System')}. Your change is recorded as a new audit entry.</p>
    <label class="f">Action<input class="i" id="ae-act" value="${esc(a.action || '')}"></label>
    <label class="f">Details (JSON)<textarea class="i" id="ae-det" rows="6" style="font-family:monospace">${esc(JSON.stringify(a.detail || {}, null, 2))}</textarea></label></div>
    <footer><span style="flex:1"></span><button class="btn" data-a="close">Cancel</button><button class="btn pri" data-a="rd-aud-save" data-id="${esc(id)}">Save</button></footer>`;
}
// filters change what's on the first page: go back to it
document.addEventListener('change', (ev) => { const k = ev.target?.dataset?.c; if (k && /^(hr|mg)/.test(k)) for (const id of Object.keys(TBL)) S.ui[id + 'Page'] = 0; });
document.addEventListener('input', (ev) => { const k = ev.target?.dataset?.i; if (k && /^(hr|mg)/.test(k)) for (const id of Object.keys(TBL)) S.ui[id + 'Page'] = 0; });
</script>
<style>
.rd-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.rd-filters .i{flex:1 1 170px;min-width:0}.rd-filters .btn{flex:none}
.rd-kpis{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
.rd-t td{vertical-align:top}
.th-sort{border:0;background:none;padding:0;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer;text-align:inherit}
.rd-pager{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-top:1px solid var(--line)}
.rd-kv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.rd-kv>div{background:var(--sunk);border-radius:8px;padding:6px 8px}.rd-kv span{display:block;font-size:.7rem;color:var(--muted)}.rd-kv b{font-size:1.1rem}
.rd-kv b.ok{color:var(--ok)}.rd-kv b.warn{color:var(--warn)}.rd-kv b.bad{color:var(--bad)}
.rd-bar{height:8px}
@media print{body *{visibility:hidden}.modal,.modal *{visibility:visible}.modal{position:absolute;left:0;top:0;box-shadow:none}.modal footer{display:none}}
</style>
