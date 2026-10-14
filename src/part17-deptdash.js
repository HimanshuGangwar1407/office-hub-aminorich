<script>
/* ═════════════ Department dashboard ═════════════
   For department heads (their own departments only) and for Admin, HR and Directors (every department — the access
   they already have elsewhere in the app). Built only from records the app already keeps: employee records,
   check-ins (att), approved leave and WFH / official-duty requests (req), tasks, daily work logs (wlog) and shared
   WFH locations (loc — the server sends these only to Admin, HR and Manager accounts). Nothing is estimated or made
   up: where a record doesn't exist, the dashboard says so. */
const ddDepts = () => (S.me ? cfg().depts.filter((d) => isMgmt() || d.headId === S.me.id) : []);
const canDeptDash = () => ddDepts().length > 0;
// attendance category for the summary and the filter: one per person per day, so nobody is counted twice
const DD_CAT = {
  present: ['Present', 't-ok'], wfh: ['WFH / official duty', 't-info'], half: ['Half day', 't-warn'], leave: ['On leave', 't-vio'],
  notin: ['Not checked in', 't-warn'], absent: ['Absent', 't-bad'], off: ['Weekly off / holiday', ''], pending: ['Machine data pending', ''], none: ['—', ''],
};
function ddCat(s, rem) {
  if (s.code === 'LV') return 'leave';
  if (rem && !['WO', 'H'].includes(s.code)) return 'wfh';
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
  const dept = ddDept(), T = today();
  let d = ui('ddDate', T); if (d > T) d = T;
  const minD = `${+T.slice(0, 4) - 1}-01-01`; if (d < minD) d = minD;
  const all = active().filter((e) => e.deptId === dept.id).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ddRow(e, d));
  const rows = ddRows(dept, d);
  const n = (c) => all.filter((r) => r.cat === c).length;
  const pending = all.reduce((s, r) => s + r.open.length, 0), late = all.reduce((s, r) => s + r.late.length, 0), done = all.reduce((s, r) => s + r.doneOn.length, 0);
  const kpis = [['Present', n('present'), 'ok', 'present'], ['WFH / official duty', n('wfh'), '', 'wfh'], ['On leave', n('leave'), '', 'leave'], ['Half day', n('half'), n('half') ? 'warn' : '', 'half'],
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
  const attCell = (r) => `${r.s.code ? stPill(r.s.code, r.s.note) : ''}${r.cat === 'wfh' && r.s.code !== 'WFH' && r.s.code !== 'OD' ? ` <span class="pill t-info">${r.rem.data.kind === 'OD' ? 'OD' : 'WFH'}</span>` : ''}${r.s.lateMin ? `<div class="tiny" style="color:var(--warn)">${r.s.lateMin} min late</div>` : ''}${ddLocCell(r)}`;
  const body = `
    <div class="filters dd-filters">
      ${multi ? `<select class="i" id="dd-dept" data-c="ddDept" aria-label="Department">${opts(ddDepts().map((x) => [x.id, x.name]), dept.id)}</select>` : ''}
      <input type="date" class="i" id="dd-date" data-c="ddDate" value="${d}" max="${T}" min="${minD}" aria-label="Date">
      <select class="i" id="dd-emp" data-c="ddEmp" aria-label="Employee">${opts(empOpts, ui('ddEmp', ''), 'All employees')}</select>
      <select class="i" id="dd-cat" data-c="ddCat" aria-label="Attendance status">${opts(Object.entries(DD_CAT).filter(([k]) => k !== 'none').map(([k, v]) => [k, v[0]]), ui('ddCat', ''), 'Any attendance')}</select>
      <select class="i" id="dd-task" data-c="ddTask" aria-label="Task status">${opts(DD_TASK_FILTERS.slice(1), ui('ddTask', ''), DD_TASK_FILTERS[0][1])}</select>
      ${ui('ddEmp', '') || ui('ddCat', '') || ui('ddTask', '') ? '<button class="btn ghost" data-a="dd-clear">Clear filters</button>' : ''}
    </div>
    <div class="kstrip dd-kpis">${kpis.map(([l, v, c, k]) => `<button class="kt" ${k ? `data-a="ui" data-k="ddCat" data-v="${k}" title="Show only: ${esc(l)}"` : 'style="cursor:default"'}><span class="l">${esc(l)}</span><span class="v ${c}">${v}</span></button>`).join('')}</div>
    ${card(`${esc(dept.name)} · ${DAYS[dow(d)]} ${fmtD(d)} · ${all.length} people · head: ${esc(head)}`, rows.length ? `<div class="tbl-wrap"><table class="t dd-t"><thead><tr><th>Employee</th><th>Attendance</th><th>In</th><th>Out</th><th>Working on</th><th>Tasks</th><th>Work log</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="click" data-a="dd-emp" data-e="${r.e.id}" data-d="${d}"><td>${person(r.e.id, esc(r.e.designation || ''))}</td>
        <td>${attCell(r)}</td><td class="small">${r.s.inT ? hm(r.s.inT) : '—'}</td><td class="small">${r.s.outT ? hm(r.s.outT) : '—'}</td>
        <td style="max-width:240px">${working(r)}</td><td>${taskCell(r)}</td>
        <td class="small">${r.wl ? `<span style="color:var(--ok)">Submitted ${hm(r.wl.at)}</span>${r.wl.blockers ? '<div class="tiny" style="color:var(--bad)">Has blockers</div>' : ''}` : '<span class="muted">Not submitted</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : empty(all.length ? 'Nobody matches these filters.' : 'No active employees in this department.'), { list: true })}
    ${notes.length ? `<p class="tiny muted">${notes.join(' ')}</p>` : ''}
    <p class="tiny muted">Attendance comes from check-ins, approved leave and approved WFH / official-duty requests. “Working on” is the person’s tasks marked In progress, or what they logged in their daily work log. Click a person for all their tasks and the day’s work log.</p>`;
  return shell(body, 'Department dashboard', multi ? 'Your departments — attendance and work, from the app’s own records' : `${esc(dept.name)} — attendance and work, from the app’s own records`);
}

function ddEmpModal(empId, d) {
  const e = empById(empId);
  // only people in a department this viewer may see
  if (!e || !ddDepts().some((x) => x.id === e.deptId)) return `${mhead('Not available')}<div class="body">${empty('This person isn’t in a department you manage.')}</div><footer><button class="btn" data-a="close">Close</button></footer>`;
  const r = ddRow(e, d), T = today();
  const tl = (list) => list.map((t) => `<li style="display:block"><div class="row" style="justify-content:space-between;gap:8px"><span class="grow" style="min-width:0"><b class="small">${esc(t.code)}</b> <span class="small">${esc(t.title)}</span></span><span class="row" style="gap:4px">${overdue(t) ? '<span class="pill t-bad">Overdue</span>' : ''}<span class="pill ${TSTAT[effStatus(t)]?.[1] || ''}">${TSTAT[effStatus(t)]?.[0] || esc(t.status)}</span></span></div>
    <div class="tiny muted">${PRIO[t.priority]?.[0] || ''}${t.due ? ` · due ${fmtD(t.due)}` : ''}${ddProgress(t) ? ` · ${ddProgress(t)}` : ''}${t.hours ? ` · ${t.hours} h logged` : ''}${t.status === 'BLOCKED' && t.blockedReason ? ` · blocked: ${esc(t.blockedReason)}` : ''}${t.status === 'DONE' && t.completedAt ? ` · completed ${fmtD(ymd(new Date(t.completedAt)))}` : ''}</div></li>`).join('');
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
</style>
