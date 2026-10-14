<script>
/* ═════════════ Department dashboard ═════════════
   For department heads (their own departments only) and for Admin, HR and Directors (every department — the access
   they already have elsewhere in the app). Built only from records the app already keeps: employee records,
   check-ins (att), approved leave and WFH / official-duty requests (req), tasks, daily work logs (wlog) and shared
   WFH locations (loc — the server sends these only to Admin, HR and Manager accounts). Nothing is estimated or made
   up: where a record doesn't exist, the dashboard says so. */
// department heads and Manager-role accounts see their own department; Admin, HR and Directors every department
const ddDepts = () => (S.me ? cfg().depts.filter((d) => isMgmt() || d.headId === S.me.id || (S.me.role === 'MANAGER' && S.me.active !== false && d.id === S.me.deptId)) : []);
const canDeptDash = () => ddDepts().length > 0;
// attendance category for the summary and the filter: one per person per day, so nobody is counted twice
const DD_CAT = {
  present: ['In office', 't-ok'], wfh: ['Work from home', 't-info'], od: ['Field visit / official duty', 't-vio'], half: ['Half day', 't-warn'], leave: ['On leave', 't-vio'],
  notin: ['Not checked in', 't-warn'], absent: ['Absent', 't-bad'], off: ['Weekly off / holiday', ''], pending: ['Machine data pending', ''], none: ['—', ''],
};
function ddCat(s, rem) {
  if (s.code === 'LV') return 'leave';
  if (rem && !['WO', 'H'].includes(s.code)) return rem.data.kind === 'OD' ? 'od' : 'wfh';
  return { P: 'present', L: 'present', I: 'present', HD: 'half', NI: 'notin', A: 'absent', WO: 'off', H: 'off', PS: 'pending' }[s.code] || 'none';
}
const DD_TASK_FILTERS = [['', 'Any task status'], ['IN_PROGRESS', 'Has work in progress'], ['BLOCKED', 'Has blocked work'], ['IN_REVIEW', 'Has work in review'], ['TODO', 'Has work to do'], ['OVERDUE', 'Has overdue work'], ['NONE', 'No open tasks']];
const DD_WL_DAYS = 62, DD_LOC_DAYS = 40; // how far back the app loads work logs and locations (part7 subscriptions)

function ddDept() {
  const list = ddDepts(), want = ui('ddDept', '');
  return list.find((d) => d.id === want) || list.find((d) => d.id === S.me.deptId) || list[0] || null;
}
// one person's day: attendance, WFH, location sharing (only when this viewer may see it), tasks and work log
function ddRow(e, d) {
  const s = dayStatus(e, d), rem = remoteOn(e.id, d), cat = ddCat(s, rem);
  const mine = S.tasks.filter((t) => t.assigneeId === e.id && t.status !== 'CANCELLED');
  const open = mine.filter(openTask).sort(taskSort);
  const doneOn = mine.filter((t) => t.status === 'DONE' && t.completedAt && ymd(new Date(t.completedAt)) === d);
  const wl = S.wlogs.find((w) => w.empId === e.id && w.date === d) || null;
  const canLoc = seesLocOf(e.id), loc = canLoc ? locOf(e.id, d) || null : null; // the server only sends locations to Admin, HR and Manager accounts
  return { e, d, s, rem, cat, mine, open, doneOn, wl, canLoc, loc,
    inProg: open.filter((t) => t.status === 'IN_PROGRESS'), blocked: open.filter((t) => t.status === 'BLOCKED'),
    review: open.filter((t) => t.status === 'IN_REVIEW'), todo: open.filter((t) => t.status === 'TODO'), late: open.filter((t) => overdue(t)),
    next: open.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due))[0] || null };
}
const ddProgress = (t) => { const cl = t.checklist || []; return cl.length ? `${cl.filter((c) => c.d).length}/${cl.length} steps` : ''; };
function ddTaskMatch(r, f) {
  if (!f) return true;
  if (f === 'NONE') return !r.open.length;
  if (f === 'OVERDUE') return r.late.length > 0;
  return r.open.some((t) => t.status === f);
}
function ddRows(dept, d) {
  const empF = ui('ddEmp', ''), catF = ui('ddCat', ''), taskF = ui('ddTask', '');
  return active().filter((e) => e.deptId === dept.id).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ddRow(e, d))
    .filter((r) => (!empF || r.e.id === empF) && (!catF || r.cat === catF) && ddTaskMatch(r, taskF));
}
function ddLocCell(r) {
  if (!r.rem) return '';
  if (!r.canLoc) return '<div class="tiny muted">Location: only Admin, HR and Manager accounts can see it</div>';
  if (daysBetween(r.d, today()) > DD_LOC_DAYS) return '<div class="tiny muted">Location: not loaded for dates this old</div>';
  const st = wfhState(r.loc), p = lastPing(r.loc);
  const txt = { live: 'Sharing live', outdated: 'Live, but outdated', stopped: 'Stopped sharing', once: 'Shared once', none: 'No location shared' }[st];
  return `<div class="tiny ${st === 'live' ? '' : 'muted'}" style="${st === 'live' ? 'color:var(--ok)' : st === 'outdated' ? 'color:var(--warn)' : ''}">${txt}${p ? ` · ${hm(p.t)}` : ''}${p ? ` <button class="btn sm ghost" data-a="loc-view" data-e="${r.e.id}" data-d="${r.d}" style="padding:0 4px">View</button>` : ''}</div>`;
}
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function vDeptDash() {
  if (!canDeptDash()) return shell(empty('This dashboard is for department heads, Admin, HR and Directors.'), 'Department dashboard');
  const dept = ddDept(), T = today(), tab = ui('ddTab', 'today');
  if (tab !== 'today') {
    const other = { updates: ddUpdates, approvals: ddApprovals, workload: ddWorkload, reports: ddReports, wfh: ddWfhTab }[tab];
    if (other) return shell(ddTabs(tab) + other(dept), 'Department dashboard', `${esc(dept.name)} — ${DD_TABS.find((x) => x[0] === tab)[1].toLowerCase()}`);
  }
  let d = ui('ddDate', T); if (d > T) d = T;
  const minD = `${+T.slice(0, 4) - 1}-01-01`; if (d < minD) d = minD;
  const all = active().filter((e) => e.deptId === dept.id).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ddRow(e, d));
  const rows = ddRows(dept, d);
  const n = (c) => all.filter((r) => r.cat === c).length;
  const pending = all.reduce((s, r) => s + r.open.length, 0), late = all.reduce((s, r) => s + r.late.length, 0), done = all.reduce((s, r) => s + r.doneOn.length, 0);
  const kpis = [['In office', n('present'), 'ok', 'present'], ['Work from home', n('wfh'), '', 'wfh'], ['Field visit / OD', n('od'), '', 'od'], ['On leave', n('leave'), '', 'leave'], ['Half day', n('half'), n('half') ? 'warn' : '', 'half'],
    [d === T ? 'Not checked in' : 'Absent', d === T ? n('notin') : n('absent'), (d === T ? n('notin') : n('absent')) ? 'warn' : '', d === T ? 'notin' : 'absent'],
    ...(d === T && n('absent') ? [['Absent', n('absent'), 'bad', 'absent']] : []),
    ['Pending tasks', pending, '', ''], ['Overdue', late, late ? 'bad' : '', ''], [`Completed ${d === T ? 'today' : 'that day'}`, done, 'ok', '']];
  const multi = ddDepts().length > 1;
  const notes = [];
  if (daysBetween(d, T) > DD_WL_DAYS) notes.push(`Work logs older than ${DD_WL_DAYS} days aren’t loaded, so work-log columns are empty for this date.`);
  if (daysBetween(d, T) > DD_LOC_DAYS) notes.push(`Shared locations older than ${DD_LOC_DAYS} days aren’t loaded.`);
  if (d !== T) notes.push('Tasks show their current status — the app doesn’t keep a day-by-day history of task status. “Completed that day” uses each task’s completion date.');
  const head = dept.headId ? nameOf(dept.headId) : 'no head set';
  const empOpts = all.map((r) => [r.e.id, r.e.name]);
  const working = (r) => {
    const ip = r.inProg.slice(0, 2).map((t) => `<div class="small trunc" title="${esc(t.title)}">${esc(t.code)} · ${esc(t.title)}</div>`).join('');
    const wl = r.wl ? (r.wl.tasks || []).filter((x) => x.st === 'W' || x.st === 'C').length : 0;
    return ip || (r.wl ? `<div class="tiny muted">Work log: ${wl} task(s) worked on</div>` : '<span class="tiny muted">Nothing in progress</span>');
  };
  const taskCell = (r) => `<div class="small"><b>${r.open.length}</b> open${r.late.length ? ` · <span style="color:var(--bad);font-weight:600">${r.late.length} overdue</span>` : ''}${r.blocked.length ? ` · <span style="color:var(--bad)">${r.blocked.length} blocked</span>` : ''}</div>
    <div class="tiny muted">${r.doneOn.length ? `${r.doneOn.length} completed ${d === T ? 'today' : 'that day'} · ` : ''}${r.next ? `next due ${fmtD(r.next.due)}` : 'no deadlines'}</div>`;
  // where they are working: office, home, a field visit / official duty — or not working (leave, off, not in yet)
  const whereCell = (r) => { const [l, cls] = DD_CAT[r.cat] || DD_CAT.none; const place = r.cat === 'od' && (r.rem.data.location || r.rem.data.place || r.rem.data.reason);
    return `<span class="pill ${cls} dd-where">${esc(l)}</span>${place ? `<div class="tiny muted">${esc(String(place).slice(0, 80))}</div>` : ''}${ddLocCell(r)}`; };
  const attCell = (r) => `${r.s.code ? stPill(r.s.code, r.s.note) : ''}${r.s.lateMin ? `<div class="tiny" style="color:var(--warn)">${r.s.lateMin} min late</div>` : ''}`;
  const body = `${ddTabs('today')}
    <div class="filters dd-filters">
      ${multi ? `<select class="i" id="dd-dept" data-c="ddDept" aria-label="Department">${opts(ddDepts().map((x) => [x.id, x.name]), dept.id)}</select>` : ''}
      <input type="date" class="i" id="dd-date" data-c="ddDate" value="${d}" max="${T}" min="${minD}" aria-label="Date">
      <select class="i" id="dd-emp" data-c="ddEmp" aria-label="Employee">${opts(empOpts, ui('ddEmp', ''), 'All employees')}</select>
      <select class="i" id="dd-cat" data-c="ddCat" aria-label="Attendance status">${opts(Object.entries(DD_CAT).filter(([k]) => k !== 'none').map(([k, v]) => [k, v[0]]), ui('ddCat', ''), 'Any attendance')}</select>
      <select class="i" id="dd-task" data-c="ddTask" aria-label="Task status">${opts(DD_TASK_FILTERS.slice(1), ui('ddTask', ''), DD_TASK_FILTERS[0][1])}</select>
      ${ui('ddEmp', '') || ui('ddCat', '') || ui('ddTask', '') ? '<button class="btn ghost" data-a="dd-clear">Clear filters</button>' : ''}
    </div>
    <div class="kstrip dd-kpis">${kpis.map(([l, v, c, k]) => `<button class="kt" ${k ? `data-a="ui" data-k="ddCat" data-v="${k}" title="Show only: ${esc(l)}"` : 'style="cursor:default"'}><span class="l">${esc(l)}</span><span class="v ${c}">${v}</span></button>`).join('')}</div>
    ${card(`${esc(dept.name)} · ${DAYS[dow(d)]} ${fmtD(d)} · ${all.length} people · head: ${esc(head)}`, rows.length ? `<div class="tbl-wrap"><table class="t dd-t"><thead><tr><th>Employee</th><th>Working from</th><th>Attendance</th><th>In</th><th>Out</th><th>Working on</th><th>Tasks</th><th>Work log</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="click" data-a="dd-emp" data-e="${r.e.id}" data-d="${d}"><td>${person(r.e.id, r.e.designation || '')}</td>
        <td>${whereCell(r)}</td><td>${attCell(r)}</td><td class="small">${r.s.inT ? hm(r.s.inT) : '—'}</td><td class="small">${r.s.outT ? hm(r.s.outT) : '—'}</td>
        <td style="max-width:240px">${working(r)}</td><td>${taskCell(r)}</td>
        <td class="small">${r.wl ? `<span style="color:var(--ok)">Submitted ${hm(r.wl.at)}</span>${r.wl.blockers ? '<div class="tiny" style="color:var(--bad)">Has blockers</div>' : ''}` : '<span class="muted">Not submitted</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : empty(all.length ? 'Nobody matches these filters.' : 'No active employees in this department.'), { list: true })}
    ${notes.length ? `<p class="tiny muted">${notes.join(' ')}</p>` : ''}
    <p class="tiny muted">“Working from”: In office = checked in without a WFH or official-duty request for the day; Work from home and Field visit / official duty come from approved requests. Attendance comes from check-ins, approved leave and approved WFH / official-duty requests. “Working on” is the person’s tasks marked In progress, or what they logged in their daily work log. Click a person for all their tasks and the day’s work log.</p>`;
  return shell(body, 'Department dashboard', multi ? 'Your departments — attendance and work, from the app’s own records' : `${esc(dept.name)} — attendance and work, from the app’s own records`);
}

function ddEmpModal(empId, d) {
  const e = empById(empId);
  // only people in a department this viewer may see
  if (!e || !ddDepts().some((x) => x.id === e.deptId)) return `${mhead('Not available')}<div class="body">${empty('This person isn’t in a department you manage.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const r = ddRow(e, d), T = today();
  const tl = (list) => list.map((t) => `<li style="display:block"><div class="row" style="justify-content:space-between;gap:8px"><span class="grow" style="min-width:0"><b class="small">${esc(t.code)}</b> <span class="small">${esc(t.title)}</span></span><span class="row" style="gap:4px">${overdue(t) ? '<span class="pill t-bad">Overdue</span>' : ''}<span class="pill ${TSTAT[effStatus(t)]?.[1] || ''}">${TSTAT[effStatus(t)]?.[0] || esc(t.status)}</span></span></div>
    <div class="tiny muted">${PRIO[t.priority]?.[0] || ''}${t.due ? ` · due ${fmtD(t.due)}` : ''}${ddProgress(t) ? ` · ${ddProgress(t)}` : ''}${t.hours ? ` · ${+t.hours || 0} h logged` : ''}${t.status === 'BLOCKED' && t.blockedReason ? ` · blocked: ${esc(t.blockedReason)}` : ''}${t.status === 'DONE' && t.completedAt ? ` · completed ${fmtD(ymd(new Date(t.completedAt)))}` : ''}</div></li>`).join('');
  const recentDone = r.mine.filter((t) => t.status === 'DONE').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 5);
  const wl = r.wl;
  const lines = (s) => esc(s || '').split('\n').filter(Boolean).map((x) => `<div class="small">${x}</div>`).join('') || '<div class="small muted">—</div>';
  return `${mhead(esc(e.name), `${esc(e.designation || '')}${e.code ? ` · ${esc(e.code)}` : ''} · ${DAYS[dow(d)]} ${fmtD(d)}`)}
  <div class="body grid" style="gap:14px">
    <div class="row" style="gap:10px;flex-wrap:wrap">${r.s.code ? stPill(r.s.code, r.s.note) : ''}${r.rem ? `<span class="pill t-info">${r.rem.data.kind === 'OD' ? 'Official duty' : 'Work from home'}</span>` : ''}
      <span class="small">In ${r.s.inT ? hm(r.s.inT) : '—'} · Out ${r.s.outT ? hm(r.s.outT) : '—'}${r.s.work ? ` · ${mins(r.s.work)} worked` : ''}${r.s.lateMin ? ` · ${r.s.lateMin} min late` : ''}</span></div>
    ${r.s.punches?.length > 2 ? `<div class="tiny muted">All check-ins: ${r.s.punches.map((p) => hm(p.t)).join(', ')}</div>` : ''}
    ${r.rem ? `<div>${ddLocCell(r) || '<div class="tiny muted">Location: not loaded for this date</div>'}</div>` : ''}
    <div><h3 class="sec-l" style="margin:0 0 6px">Open tasks (${r.open.length})</h3>${r.open.length ? `<ul class="list">${tl(r.open)}</ul>` : '<p class="small muted" style="margin:0">No open tasks.</p>'}</div>
    ${recentDone.length ? `<div><h3 class="sec-l" style="margin:0 0 6px">Recently completed</h3><ul class="list">${tl(recentDone)}</ul></div>` : ''}
    <div><h3 class="sec-l" style="margin:0 0 6px">Work log · ${fmtD(d)}</h3>${wl ? `<div class="grid" style="gap:6px"><div><b class="tiny">Done</b>${lines(wl.done)}</div><div><b class="tiny">Pending</b>${lines(wl.pending)}</div>${wl.blockers ? `<div><b class="tiny" style="color:var(--bad)">Blockers</b>${lines(wl.blockers)}</div>` : ''}${wl.tomorrow ? `<div><b class="tiny">Next</b>${lines(wl.tomorrow)}</div>` : ''}<div class="tiny muted">Submitted ${fmtDT(wl.at)}${wl.review ? ` · reviewed: ${esc(wl.review)}` : ''}</div></div>`
      : `<p class="small muted" style="margin:0">${daysBetween(d, T) > DD_WL_DAYS ? 'Work logs this old aren’t loaded.' : 'No work log submitted for this day.'}</p>`}</div>
  </div><footer><button class="btn" data-a="close">Close</button>${canView('tasks') ? `<button class="btn" data-a="dd-tasks" data-e="${e.id}">Open in Tasks</button>` : ''}</footer>`;
}

/* ── more of the department dashboard: work updates, approvals, workload, reports and WFH ── */
const DD_TABS = [['today', 'Team today'], ['updates', 'Work updates'], ['approvals', 'Approvals'], ['workload', 'Workload'], ['reports', 'Reports'], ['wfh', 'WFH']];
const ddTabs = (tab) => `<div class="tabs" role="tablist">${DD_TABS.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-a="ui" data-k="ddTab" data-v="${k}">${l}</button>`).join('')}</div>`;
const ddDeptPick = (dept) => (ddDepts().length > 1 ? `<select class="i" id="dd-dept2" data-c="ddDept" aria-label="Department" style="max-width:240px">${opts(ddDepts().map((x) => [x.id, x.name]), dept.id)}</select>` : '');
const ddPeople = (dept) => active().filter((e) => e.deptId === dept.id).sort((a, b) => a.name.localeCompare(b.name));

function ddUpdates(dept) {
  const T = today(), from = ui('ddUpFrom', addDays(T, -6)), only = ui('ddUpOnly', '');
  const ids = new Set(ddPeople(dept).map((e) => e.id));
  const logs = S.wlogs.filter((w) => ids.has(w.empId) && w.date >= from && w.date <= T && (only !== 'blockers' || w.blockers) && (only !== 'unreviewed' || !w.reviewedBy)).sort((a, b) => b.date.localeCompare(a.date) || nameOf(a.empId).localeCompare(nameOf(b.empId)));
  const lines = (s) => esc(s || '').split('\n').filter(Boolean).map((x) => `<div class="small">${x}</div>`).join('') || '<span class="small muted">—</span>';
  return `<div class="filters dd-filters">${ddDeptPick(dept)}<label class="small row" style="gap:6px">From <input type="date" class="i" id="dd-upfrom" data-c="ddUpFrom" value="${from}" max="${T}" min="${addDays(T, -DD_WL_DAYS)}" style="width:auto"></label>
      <select class="i" id="dd-uponly" data-c="ddUpOnly" style="max-width:220px">${opts([['blockers', 'Only with blockers'], ['unreviewed', 'Not reviewed yet']], only, 'All updates')}</select></div>
    ${logs.length ? `<div class="grid" style="gap:10px">${logs.map((l) => `<section class="card"><div class="body">
      <div class="row" style="justify-content:space-between;gap:8px">${person(l.empId, `${DAYS[dow(l.date)]} ${fmtD(l.date)} · submitted ${hm(l.at)}`)}${l.blockers ? '<span class="pill t-bad">Blockers</span>' : ''}</div>
      <div class="dd-wl"><div><b class="tiny">Done</b>${lines(l.done)}</div><div><b class="tiny">Pending</b>${lines(l.pending)}</div>${l.blockers ? `<div><b class="tiny" style="color:var(--bad)">Blockers</b>${lines(l.blockers)}</div>` : ''}${l.tomorrow ? `<div><b class="tiny">Next</b>${lines(l.tomorrow)}</div>` : ''}</div>
      ${l.reviewedBy ? `<div class="tiny muted" style="margin-top:8px">Reviewed by ${esc(nameOf(l.reviewedBy))}${l.review ? `: ${esc(l.review)}` : ''}</div>`
        : `<form data-f="wl-review" data-id="${l.id}" class="row" style="margin-top:10px;flex-wrap:nowrap"><input class="i" name="note" placeholder="Feedback (optional)" aria-label="Feedback for ${esc(nameOf(l.empId))}"><button class="btn sm">Mark reviewed</button></form>`}
    </div></section>`).join('')}</div>` : empty('No work updates in this period.')}
    <p class="tiny muted">The daily work logs your team submitted. Days without a log simply don’t appear.</p>`;
}

function ddApprovals(dept) {
  const ids = new Set(ddPeople(dept).map((e) => e.id)), show = ui('ddApShow', 'pending');
  const list = S.reqs.filter((r) => ids.has(r.empId) && (show === 'pending' ? r.status === 'PENDING' : r.status !== 'PENDING' && (r.decided || r.created || 0) >= Date.now() - 30 * 864e5))
    .sort((a, b) => (pendingWith(b) - pendingWith(a)) || (a.created || 0) - (b.created || 0));
  const what = (r) => (r.type === 'LEAVE' ? `${esc(r.data.lt || '')} · ${fmtD(r.data.from)}${r.data.to !== r.data.from ? ' – ' + fmtD(r.data.to) : ''} · ${+r.data.days || 0} day(s)`
    : r.type === 'WFH_OD' ? `${r.data.kind === 'OD' ? 'Official duty' : 'WFH'} · ${fmtD(r.data.from)}${r.data.to && r.data.to !== r.data.from ? ' – ' + fmtD(r.data.to) : ''}`
    : r.type === 'CORRECTION' ? `${fmtD(r.data.date)} · in ${esc(r.data.inT || '—')} · out ${esc(r.data.outT || '—')}` : esc(r.title || ''));
  return `<div class="filters dd-filters">${ddDeptPick(dept)}<select class="i" id="dd-apshow" data-c="ddApShow" style="max-width:240px">${opts([['pending', 'Pending'], ['decided', 'Decided (last 30 days)']], show)}</select></div>
    ${card(`Requests from your team · ${list.length}`, dataTable('ddAp', list, [
      { k: 'code', label: 'Request', v: (r) => r.code, html: (r) => `<b class="small">${esc(r.code)}</b>${pendingWith(r) ? ' <span class="pill t-warn">Your decision</span>' : ''}<div class="tiny muted">${esc(RTYPE[r.type] || r.type)}</div>` },
      { k: 'emp', label: 'Employee', v: (r) => nameOf(r.empId), html: (r) => person(r.empId, empById(r.empId)?.designation || '') },
      { k: 'what', label: 'Details', v: (r) => r.data?.from || r.data?.date || '', html: (r) => `<span class="small">${what(r)}</span>${r.data?.reason ? `<div class="tiny muted">${esc(String(r.data.reason).slice(0, 100))}</div>` : ''}` },
      { k: 'with', label: 'With', v: (r) => (r.status === 'PENDING' ? nameOf(curStep(r)?.by) : ''), html: (r) => (r.status === 'PENDING' ? `<span class="small">${esc(nameOf(curStep(r)?.by))}</span>` : '—') },
      { k: 'status', label: 'Status', v: (r) => r.status, html: (r) => pill(RSTAT, r.status) },
    ], { name: `${dept.name} requests`, click: (r) => `data-a="req" data-id="${r.id}"`, empty: show === 'pending' ? 'Nothing pending from your team.' : 'No decisions in the last 30 days.' }), { list: true })}
    <p class="tiny muted">Open a request to approve, reject or send it back. Approvals follow the existing chain (reporting manager, then HR where the policy needs it); you can decide when the request is waiting for you.</p>`;
}

function ddWorkload(dept) {
  const T = today(), ppl = ddPeople(dept);
  const rows = ppl.map((e) => {
    const mine = S.tasks.filter((t) => t.assigneeId === e.id && t.status !== 'CANCELLED'), open = mine.filter(openTask);
    const lastLog = S.wlogs.filter((w) => w.empId === e.id).map((w) => w.date).sort().pop() || null;
    const done30 = mine.filter((t) => t.status === 'DONE' && t.completedAt && ymd(new Date(t.completedAt)) >= addDays(T, -30)).length;
    return { e, open: open.length, overdue: open.filter((t) => overdue(t)).length, blocked: open.filter((t) => t.status === 'BLOCKED').length, review: open.filter((t) => t.status === 'IN_REVIEW').length,
      week: open.filter((t) => t.due && t.due >= T && t.due <= addDays(T, 7)).length, done30, lastLog };
  });
  const avg = rows.length ? rows.reduce((s, r) => s + r.open, 0) / rows.length : 0;
  const since3 = (() => { let n = 0, d = T; while (n < 3) { d = addDays(d, -1); if (!weeklyOff(d) && !holidayOn(d)) n++; } return d; })();
  for (const r of rows) {
    r.why = [];
    if (r.overdue) r.why.push(`${r.overdue} overdue`);
    if (r.blocked) r.why.push(`${r.blocked} blocked`);
    if (avg && r.open >= Math.max(4, avg * 2)) r.why.push('much more open work than the team average');
    const lv = leaveOn(r.e.id, T);
    if (S.wlogs.some((w) => w.empId === r.e.id) && (!r.lastLog || r.lastLog < since3) && !lv) r.why.push('no work log for 3 working days');
  }
  const max = Math.max(1, ...rows.map((r) => r.open));
  return `<div class="filters dd-filters">${ddDeptPick(dept)}</div>
    <div class="kstrip dd-kpis">${[['People', rows.length], ['Open tasks', rows.reduce((s, r) => s + r.open, 0)], ['Overdue', rows.reduce((s, r) => s + r.overdue, 0)], ['Blocked', rows.reduce((s, r) => s + r.blocked, 0)], ['Average open per person', round2(avg)], ['May need support', rows.filter((r) => r.why.length).length]].map(([l, v]) => `<div class="kt" style="cursor:default"><span class="l">${l}</span><span class="v">${v}</span></div>`).join('')}</div>
    ${card('Task distribution', dataTable('ddWl', rows, [
      { k: 'name', label: 'Employee', v: (r) => r.e.name, html: (r) => person(r.e.id, r.e.designation || '') },
      { k: 'open', label: 'Open', num: true, v: (r) => r.open, html: (r) => `<b>${r.open}</b><div class="bar" style="width:90px"><span style="width:${Math.round((r.open / max) * 100)}%"></span></div>` },
      { k: 'od', label: 'Overdue', num: true, v: (r) => r.overdue, html: (r) => (r.overdue ? `<b style="color:var(--bad)">${r.overdue}</b>` : '0') },
      { k: 'bl', label: 'Blocked', num: true, v: (r) => r.blocked }, { k: 'rv', label: 'In review', num: true, v: (r) => r.review }, { k: 'wk', label: 'Due in 7 days', num: true, v: (r) => r.week },
      { k: 'done', label: 'Completed (30 days)', num: true, v: (r) => r.done30 },
      { k: 'log', label: 'Last work log', v: (r) => r.lastLog || '', html: (r) => (r.lastLog ? fmtD(r.lastLog) : '<span class="muted">—</span>') },
      { k: 'why', label: 'May need support', v: (r) => r.why.length, html: (r) => (r.why.length ? `<span class="small" style="color:var(--warn)">${esc(r.why.join(' · '))}</span>` : '<span class="tiny muted">—</span>') },
    ], { name: `${dept.name} workload`, click: (r) => `data-a="dd-emp" data-e="${r.e.id}" data-d="${T}"` }), { list: true })}
    <p class="tiny muted">From tasks assigned to each person (cancelled ones excluded). “May need support” lists the reasons; it isn’t a rating. Tasks have no effort estimates, so workload is counted in tasks.</p>`;
}

function ddReports(dept) {
  const m = ui('ddRepM', thisMonth()), ppl = ddPeople(dept), [from, to] = periodRange('month', m);
  const rows = ppl.map((e) => {
    const s = monthSummary(e, m), mine = S.tasks.filter((t) => t.assigneeId === e.id && t.status !== 'CANCELLED');
    const done = mine.filter((t) => t.status === 'DONE' && t.completedAt && ymd(new Date(t.completedAt)) >= from && ymd(new Date(t.completedAt)) <= to);
    return { e, s, done: done.length, onTime: done.filter((t) => ymd(new Date(t.completedAt)) <= t.due).length, open: mine.filter(openTask).length, overdue: mine.filter((t) => overdue(t)).length,
      leaveReq: reqsOf('LEAVE', e.id).filter((r) => r.data.from <= to && r.data.to >= from).length, wfhReq: reqsOf('WFH_OD', e.id).filter((r) => r.data.from <= to && (r.data.to || r.data.from) >= from).length };
  });
  const n = (k, label, f) => ({ k, label, num: true, v: f });
  return `<div class="filters dd-filters">${ddDeptPick(dept)}<select class="i" id="dd-repm" data-c="ddRepM" style="max-width:200px" aria-label="Month">${monthOpts(m)}</select></div>
    ${card(`${esc(dept.name)} · ${fmtM(m)}${m === thisMonth() ? ' (so far)' : ''}`, dataTable('ddRep', rows, [
      { k: 'name', label: 'Employee', v: (r) => r.e.name }, n('work', 'Working days', (r) => r.s.work), n('present', 'Present', (r) => r.s.present), n('late', 'Late', (r) => r.s.late), n('absent', 'Absent', (r) => r.s.absent),
      n('half', 'Half days', (r) => r.s.half), n('leave', 'Leave days', (r) => r.s.leave + r.s.lwp), n('wfh', 'WFH / OD days', (r) => r.s.wfh + r.s.od), n('done', 'Tasks completed', (r) => r.done), n('ontime', 'On time', (r) => r.onTime),
      n('open', 'Open now', (r) => r.open), n('od', 'Overdue now', (r) => r.overdue), n('lr', 'Leave requests', (r) => r.leaveReq), n('wr', 'WFH requests', (r) => r.wfhReq),
    ], { name: `${dept.name} report ${m}` }), { list: true })}
    <p class="tiny muted">Attendance from check-ins, approved leave and approved WFH / official duty; tasks completed by their completion date. Use Export for a spreadsheet.</p>`;
}

function ddWfhTab(dept) {
  const T = today(), d = ui('ddWfhDate', T) > T ? T : ui('ddWfhDate', T), ppl = ddPeople(dept);
  const remote = ppl.map((e) => ({ e, rem: remoteOn(e.id, d), s: dayStatus(e, d) })).filter((x) => x.rem);
  const upcoming = S.reqs.filter((r) => r.type === 'WFH_OD' && ppl.some((e) => e.id === r.empId) && ['APPROVED', 'PENDING'].includes(r.status) && (r.data.to || r.data.from) > d && r.data.from <= addDays(T, 14)).sort((a, b) => a.data.from.localeCompare(b.data.from));
  const loc = (x) => {
    if (!seesLocOf(x.e.id)) return '<span class="tiny muted">Only Admin, HR and Manager accounts can see locations</span>';
    const l = locOf(x.e.id, d), st = wfhState(l), p = lastPing(l);
    const txt = { live: 'Sharing live', outdated: 'Live, but outdated', stopped: 'Stopped sharing', once: 'Shared once', none: 'No location shared' }[st];
    return `<span class="small" style="${st === 'live' ? 'color:var(--ok)' : st === 'outdated' ? 'color:var(--warn)' : ''}">${txt}${p ? ` · ${hm(p.t)}` : ''}</span>${p ? ` <button class="btn sm ghost" data-a="loc-view" data-e="${x.e.id}" data-d="${d}" style="padding:0 4px">Trail</button>` : ''}`;
  };
  return `<div class="filters dd-filters">${ddDeptPick(dept)}<input type="date" class="i" id="dd-wfhdate" data-c="ddWfhDate" value="${d}" max="${T}" min="${addDays(T, -DD_LOC_DAYS)}" style="max-width:200px" aria-label="Date"></div>
    ${card(`Working remotely · ${fmtD(d)} · ${remote.length}`, remote.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Employee</th><th>Type</th><th>Attendance</th><th>In</th><th>Out</th><th>Location</th></tr></thead><tbody>
      ${remote.map((x) => `<tr><td>${person(x.e.id, x.e.designation || '')}</td><td><span class="pill ${x.rem.data.kind === 'OD' ? 't-vio' : 't-info'}">${x.rem.data.kind === 'OD' ? 'Field visit / official duty' : 'Work from home'}</span></td><td>${x.s.code ? stPill(x.s.code, x.s.note) : ''}</td><td class="small">${x.s.inT ? hm(x.s.inT) : '—'}</td><td class="small">${x.s.outT ? hm(x.s.outT) : '—'}</td><td>${loc(x)}</td></tr>`).join('')}
    </tbody></table></div>` : empty('Nobody in this department is working remotely that day.'), { list: true })}
    ${card(`Coming up · next 14 days · ${upcoming.length}`, upcoming.length ? `<ul class="list">${upcoming.map((r) => `<li data-a="req" data-id="${r.id}" style="cursor:pointer"><span class="grow small">${esc(nameOf(r.empId))} · ${r.data.kind === 'OD' ? 'Official duty' : 'WFH'} · ${fmtD(r.data.from)}${r.data.to && r.data.to !== r.data.from ? ' – ' + fmtD(r.data.to) : ''}</span>${pill(RSTAT, r.status)}</li>`).join('')}</ul>` : `<div class="body">${empty('No upcoming WFH or official duty.')}</div>`, { list: true })}
    ${canSeeLocations() ? '<p class="tiny"><button class="btn sm ghost" data-a="nav" data-v="wfhlive">Open the live WFH map</button></p>' : ''}`;
}

async function ddAction(a, el) {
  switch (a) {
    case 'dd-emp': return openModal(() => ddEmpModal(el.dataset.e, el.dataset.d));
    case 'dd-clear': Object.assign(S.ui, { ddEmp: '', ddCat: '', ddTask: '' }); return schedule();
    case 'dd-open': S.ui.ddDept = el.dataset.d; Object.assign(S.ui, { ddEmp: '', ddCat: '', ddTask: '' }); return setView('deptdash');
    case 'dd-tasks': { closeModal(); Object.assign(S.ui, { tScope: isMgmt() ? 'all' : 'team', tView: 'list', tStatus: 'OPEN', tQ: '', tWho: el.dataset.e }); return setView('tasks'); }
  }
}
</script>
<style>
.dd-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}.dd-filters .i{flex:1 1 160px;min-width:0}.dd-filters .btn{flex:none}
.dd-kpis{grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}
button.kt{font:inherit}
.dd-t td{vertical-align:top}
.dd-wl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:8px}
</style>
