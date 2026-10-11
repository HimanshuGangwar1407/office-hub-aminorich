<script>
/* ═════════════ Small render helpers ═════════════ */
const pill = (map, k, extra = '') => { const v = map[k] || [cap(k), '']; return `<span class="pill ${v[1]}">${esc(v[0])}${extra}</span>`; };
const stPill = (code, note) => `<span class="pill ${STATUS[code]?.[1] || ''}" title="${esc(note || '')}">${esc(STATUS[code]?.[0] || code)}</span>`;
const empty = (t) => `<div class="empty">${t}</div>`;
const card = (title, body, { actions = '', cls = '', list = false } = {}) => `<section class="card ${cls}"><header><h2>${title}</h2><div class="row">${actions}</div></header>${list ? body : `<div class="body">${body}</div>`}</section>`;
const person = (id, sub = '') => { const e = empById(id); const n = e?.name || 'Someone'; return `<span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(n)}<span style="min-width:0"><span class="trunc" style="display:block">${esc(n)}</span>${sub ? `<span class="tiny muted">${esc(sub)}</span>` : ''}</span></span>`; };
const opts = (list, sel, blank) => (blank != null ? `<option value="">${esc(blank)}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
const peopleOpts = (sel, blank, ids) => opts((ids ? ids.map(empById).filter(Boolean) : active()).sort((a, b) => a.name.localeCompare(b.name)).map((e) => [e.id, e.name]), sel, blank);
function peopleGroups(sel, { blank = null, exclude = [], load = false } = {}) {
  const ex = new Set(exclude), all = active().filter((e) => !ex.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  const openOf = (id) => S.tasks.filter((t) => t.assigneeId === id && openTask(t)).length;
  const o = (e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}${e.id === S.me?.id ? ' (me)' : ''}${e.designation ? ' — ' + esc(e.designation) : ''}${load ? ` · ${openOf(e.id)} open` : ''}</option>`;
  const team = new Set(S.me ? myTeam() : []), mgr = S.me?.managerId, myDept = S.me?.deptId;
  const used = new Set(); const grp = (label, list) => { const l = list.filter((e) => !used.has(e.id)); l.forEach((e) => used.add(e.id)); return l.length ? `<optgroup label="${esc(label)}">${l.map(o).join('')}</optgroup>` : ''; };
  let h = blank != null ? `<option value="">${esc(blank)}</option>` : '';
  h += grp('My team', all.filter((e) => team.has(e.id) || e.id === mgr));
  h += grp(`My department${deptOf(myDept) ? ' — ' + deptOf(myDept).name : ''}`, all.filter((e) => e.deptId === myDept));
  for (const d of cfg().depts) h += grp(d.name, all.filter((e) => e.deptId === d.id));
  h += grp('Others', all);
  return h;
}
const deptOpts = (sel, blank) => opts(cfg().depts.map((d) => [d.id, d.name]), sel, blank);
const kpi = (l, v, tone = '', go = '') => `<button class="kpi" ${go ? `data-a="go" data-go="${go}"` : ''}><div class="l">${esc(l)}</div><div class="v ${tone}">${v}</div></button>`;
const ui = (k, d) => (S.ui[k] ?? d);

/* ═════════════ Shell ═════════════ */
const VIEWS = [
  ['dashboard', 'Dashboard', () => true], ['chats', 'Chats', () => canView('chats')], ['attendance', 'Attendance', () => canView('attendance')], ['leave', 'Leave', () => canView('leave')], ['tasks', 'Tasks', () => canView('tasks')],
  ['worklog', 'Work log', () => canView('worklog')], ['approvals', 'Approvals', () => canView('approvals')], ['claims', 'Claims', () => canView('claims')], ['departments', 'Departments', () => canView('departments')],
  ['people', 'People', () => canView('people', isManager)], ['reports', 'Reports', () => canView('reports', isManager)], ['settings', 'Settings', () => canView('settings', isHR)],
];
const ICON = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  chats: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  attendance: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  leave: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 14l6 4M15 14l-6 4',
  tasks: 'M9 11l2 2 4-4M5 4h14v16H5z',
  worklog: 'M6 3h10l3 3v15H6zM9 9h6M9 13h6M9 17h4',
  approvals: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  claims: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  departments: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6',
  reports: 'M4 20h16M7 16V10M12 16V5M17 16v-8',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k] || ICON.more}"/></svg>`;
const SEC = { dashboard: 'teal', chats: 'sky', attendance: 'blue', leave: 'violet', tasks: 'amber', worklog: 'leaf', approvals: 'coral', claims: 'gold', departments: 'indigo', people: 'rose', reports: 'cyan', settings: 'slate' };
const NAV_GROUPS = [['Workspace', ['dashboard', 'chats', 'attendance', 'leave', 'tasks', 'worklog']], ['Requests', ['approvals', 'claims']], ['Organisation', ['departments', 'people', 'reports', 'settings']]];
const MOBILE_NAV = ['dashboard', 'attendance', 'tasks', 'approvals'];
function shell(content, title, sub, actions = '') {
  const inbox = myInbox().length, unread = S.ntf.filter((n) => !n.read).length, chatUnread = unreadCount();
  const vis = new Map(VIEWS.filter((v) => v[2]()).map((v) => [v[0], v[1]]));
  const badge = (k) => (k === 'approvals' && inbox ? `<span class="ct">${inbox}</span>` : k === 'chats' && chatUnread ? `<span class="ct ct-acc">${chatUnread}</span>` : '');
  const navBtn = (k) => `<button class="nav" style="--nc:var(--c-${SEC[k]})" data-a="nav" data-v="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${ico(k)}<span class="nl">${vis.get(k)}</span>${badge(k)}</button>`;
  const more = S.ui.moreOpen;
  return `<div class="shell">
  <nav class="rail" aria-label="Main">
    <div class="brand"><div class="mark">${esc(initials(cfg().company || 'OH'))}</div><div><b>OfficeHub</b><small>${esc(cfg().company)}</small></div></div>
    ${NAV_GROUPS.map(([g, ks]) => { const items = ks.filter((k) => vis.has(k)); return items.length ? `<div class="nav-g">${g}</div>${items.map(navBtn).join('')}` : ''; }).join('')}
    <button class="me" data-a="acct" title="My account, password and email alerts">${avatar(S.me.name)}<div style="min-width:0;text-align:left"><div class="trunc small" style="font-weight:600">${esc(S.me.name)}</div><div class="tiny rail-muted">${esc(S.me.designation || '')} · ${cap(S.me.role)}</div></div><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="margin-left:auto;opacity:.7"><path d="M10 17l5-5-5-5"/></svg></button>
  </nav>
  <main class="main" id="main" style="--sec:var(--c-${SEC[S.view] || 'teal'})">
    ${S.readonly ? '<div class="alert t-warn" style="margin-bottom:12px;cursor:default">You have view-only access. Ask the app owner to share it with you as a Contributor so you can check in, apply for leave and update tasks.</div>' : ''}
    <div class="topbar"><div class="tb-title"><span class="sec-ico">${ico(S.view)}</span><div style="min-width:0"><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>
      <div class="row tb-actions">${actions}<button class="btn searchbtn" data-a="cmdk-open" aria-label="Search (Ctrl K)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg><span class="hide-sm">Search</span><kbd class="hide-sm">Ctrl K</kbd></button><button class="btn bell" data-a="ntf" aria-label="Notifications${unread ? ` (${unread} unread)` : ''}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4"/></svg><span class="hide-sm">Alerts</span>${unread ? `<span class="dot">${unread}</span>` : ''}</button></div></div>
    ${content}
  </main>
  <nav class="tabbar" aria-label="Main (mobile)">${MOBILE_NAV.filter((k) => vis.has(k)).map((k) => `<button class="tb" data-a="nav" data-v="${k}" ${S.view === k && !more ? 'aria-current="page"' : ''}>${ico(k)}<span>${k === 'dashboard' ? 'Home' : vis.get(k)}</span>${badge(k)}</button>`).join('')}<button class="tb" data-a="ui" data-k="moreOpen" data-v="${more ? '' : '1'}" ${more || (!MOBILE_NAV.includes(S.view)) ? 'aria-current="page"' : ''}>${ico('more')}<span>More</span>${chatUnread && !MOBILE_NAV.includes('chats') ? '<span class="ct ct-acc">•</span>' : ''}</button></nav>
  ${more ? `<div class="sheet-bg" data-a="ui" data-k="moreOpen" data-v=""></div><div class="sheet" role="dialog" aria-label="All sections"><div class="sheet-me">${avatar(S.me.name)}<div style="flex:1"><b>${esc(S.me.name)}</b><div class="tiny muted">${esc(S.me.designation || '')} · ${cap(S.me.role)}</div></div><button class="btn sm" data-a="acct">My account</button></div>${NAV_GROUPS.map(([g, ks]) => { const items = ks.filter((k) => vis.has(k)); return items.length ? `<div class="nav-g">${g}</div><div class="sheet-grid">${items.map((k) => `<button class="sg" style="--nc:var(--c-${SEC[k]})" data-a="nav" data-v="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${ico(k)}<span>${vis.get(k)}</span>${badge(k)}</button>`).join('')}</div>` : ''; }).join('')}</div>` : ''}
  </div>`;
}

/* ═════════════ Dashboard ═════════════ */
function vDashboard() {
  const T = today(), me = S.me, ids = scope(), mgmt = isMgmt(), team = myTeam();
  const mode = mgmt ? 'Whole office' : team.length ? `You and your team (${team.length})` : 'Your work';
  const ppl = ids.map(empById).filter((e) => e && (!e.joining || e.joining <= T));
  const st = ppl.map((e) => ({ e, s: dayStatus(e, T) }));
  const expected = st.filter((x) => !['WO', 'H', ''].includes(x.s.code));
  const c = (codes) => st.filter((x) => codes.includes(x.s.code)).length;
  const present = c(['P', 'L', 'HD']), late = st.filter((x) => x.s.lateMin).length, leave = c(['LV']), remote = ppl.filter((e) => remoteOn(e.id, T) && !leaveOn(e.id, T)).length, notIn = c(['NI']), absent = c(['A']);
  const sh = cfg().shift, afterEnd = minOfDay(Date.now()) > toMin(sh.end) + 30;
  const noLogoff = afterEnd ? st.filter((x) => x.s.punches?.length === 1).length : 0;
  const tasks = S.tasks.filter((t) => ids.includes(t.assigneeId));
  const open = tasks.filter(openTask), dueToday = open.filter((t) => t.due === T), od = open.filter((t) => overdue(t)), blocked = open.filter((t) => t.status === 'BLOCKED');
  const doneToday = tasks.filter((t) => t.status === 'DONE' && t.completedAt && ymd(new Date(t.completedAt)) === T).length;
  const inbox = myInbox(), sla = S.reqs.filter((r) => pastSLA(r) && (ids.includes(r.empId) || curStep(r)?.by === me.id));
  const mine = S.tasks.filter((t) => t.assigneeId === me.id && openTask(t)).sort(taskSort);
  const byMe = S.tasks.filter((t) => t.assignerId === me.id && t.assigneeId !== me.id && openTask(t)).sort(taskSort);
  const drOpen = S.dreqs.filter((r) => !['RESOLVED', 'CLOSED'].includes(r.status) && (mgmt || r.ownerId === me.id || r.byId === me.id || r.toDept === me.deptId || r.fromDept === me.deptId));
  let prev = addDays(T, -1); for (let i = 0; i < 6 && !workingDay(prev); i++) prev = addDays(prev, -1);
  const logged = new Set(S.wlogs.filter((w) => w.date === prev).map((w) => w.empId));
  const noLog = ppl.filter((e) => e.id !== me.id && presentish(dayStatus(e, prev).code) && !logged.has(e.id));
  const incomplete = [];
  for (let i = 1; i <= 7; i++) { const d = addDays(T, -i); ppl.forEach((e) => { if (dayStatus(e, d).code === 'I') incomplete.push({ e, d }); }); }
  const myS = dayStatus(me, T), myP = punchesOn(me.id, T);

  const alerts = [];
  const crit = od.filter((t) => t.priority === 'CRITICAL');
  if (crit.length) alerts.push(['bad', `${crit.length} critical task(s) overdue`, 'tasks:overdue']);
  if (sla.length) alerts.push(['bad', `${sla.length} approval(s) waiting longer than ${cfg().slaHours} h`, 'approvals:team']);
  if (blocked.length) alerts.push(['warn', `${blocked.length} task(s) blocked`, 'tasks:blocked']);
  const drLate = drOpen.filter((r) => r.due < T);
  if (drLate.length) alerts.push(['warn', `${drLate.length} cross-department request(s) past their date`, 'departments']);
  if (ids.length > 1 && incomplete.length) alerts.push(['', `${incomplete.length} missing check-out(s) in the last 7 days`, 'attendance:register']);
  if (ids.length > 1 && noLog.length) alerts.push(['', `${noLog.length} work log(s) not submitted for ${fmtDs(prev)}`, 'worklog:team']);
  if (cfg().attSource === 'device' && isHR() && (!cfg().importedThrough || cfg().importedThrough < addDays(T, -2))) alerts.push(['warn', `Machine attendance imported only up to ${cfg().importedThrough ? fmtD(cfg().importedThrough) : 'never'}`, 'attendance:import']);
  { const nl = locAlertCount(ids, T); if (ids.length > 1 && nl) alerts.push(['warn', `${nl} on WFH / official duty today haven’t shared their location`, 'attendance:today']); }
  if (ids.length > 2 && late >= 3) alerts.push(['', `${late} late arrival(s) today`, 'attendance:today']);

  const events = [];
  const win = eachDay(T, addDays(T, 30));
  for (const e of ppl) {
    const b = e.dob && win.find((d) => d.slice(5) === e.dob.slice(5)); if (b) events.push([b, `${e.name} — birthday`]);
    const a = e.joining && e.joining < addDays(T, -300) && win.find((d) => d.slice(5) === e.joining.slice(5)); if (a) events.push([a, `${e.name} — ${+a.slice(0, 4) - +e.joining.slice(0, 4)} yr work anniversary`]);
    if (e.status === 'PROBATION' && e.probEnd && e.probEnd <= addDays(T, 30)) events.push([e.probEnd, `${e.name} — probation ends`]);
    if (e.status === 'ON_NOTICE' && e.exitDate) events.push([e.exitDate, `${e.name} — last working day`]);
  }
  cfg().holidays.filter((h) => h.date >= T && h.date <= addDays(T, 60)).forEach((h) => events.push([h.date, `${h.name}${h.optional ? ' (optional)' : ''}`]));
  events.sort((a, b) => a[0].localeCompare(b[0]));
  const anns = (cfg().announcements || []).filter((a) => !a.until || a.until >= T).slice(-3).reverse();
  const deptStr = cfg().depts.map((d) => { const m = st.filter((x) => x.e.deptId === d.id); return [d, m.length, m.filter((x) => presentish(x.s.code)).length, m.filter((x) => x.s.code === 'LV').length]; }).filter((x) => x[1]);
  const h = new Date().getHours();

  const taskLi = (t, who) => `<li class="pri-${t.priority}" data-a="task" data-id="${t.id}" style="cursor:pointer"><div class="grow"><div class="trunc">${esc(t.title)}</div><div class="tiny muted">${esc(t.code)}${who ? ' · ' + esc(nameOf(t.assigneeId)) : ' · from ' + esc(nameOf(t.assignerId))}</div></div>${pill(TSTAT, effStatus(t))}<span class="tiny ${overdue(t) ? '' : 'muted'}" style="white-space:nowrap;${overdue(t) ? 'color:var(--bad);font-weight:600' : ''}">${overdue(t) ? 'Overdue · ' : 'Due '}${fmtDs(t.due)}</span></li>`;
  const office = ids.length > 1;
  const myDue = mine.filter((t) => t.due === T).length, myOd = mine.filter((t) => overdue(t)).length;
  const wl7 = []; for (let i = 6; i >= 0; i--) wl7.push(addDays(T, -i));
  const wlT = wlState(me, T), wlY = wlState(me, prev);
  const wlMsg = wlT === 'ok' || wlT === 'late' ? ['Today’s log submitted', 'ok'] : wlY === 'miss' ? [`${fmtDs(prev)} log missing`, 'bad'] : wlT === 'due' ? ['Today’s log not yet submitted', 'warn'] : ['Nothing due today', ''];

  /* 1 — your day */
  const seg = (label, inner) => `<div class="day-seg"><div class="sec-l">${label}</div>${inner}</div>`;
  const yourDay = `<section class="card dayband">
    ${seg('Attendance', `<div class="row" style="justify-content:space-between;gap:6px">${myS.code ? stPill(myS.code, myS.note) : '<span class="pill">Non-working day</span>'}<span class="small">In <b>${hm(myS.inT)}</b> · Out <b>${hm(myS.outT)}</b></span></div>
      ${myS.lateMin ? `<div class="tiny" style="color:var(--warn);margin-top:4px">Late by ${mins(myS.lateMin)}</div>` : ''}
      <div class="row" style="margin-top:10px;gap:6px">${cfg().webPunch && !S.readonly ? `<button class="btn pri sm" data-a="punch">${myP.length % 2 === 0 ? 'Check in' : 'Check out'}</button>` : ''}<button class="btn sm" data-a="new-req" data-t="CORRECTION">Fix attendance</button></div>
      ${myLocStrip()}`)}
    ${seg('Work log', `<div class="small"><span class="dot-s ${wlMsg[1] ? 'd-' + wlMsg[1] : ''}"></span>${wlMsg[0]}</div>
      <div class="wl7" aria-label="Last 7 days">${wl7.map((d) => { const k = wlState(me, d); return `<button class="wl7-d wc-${k || 'none'}" data-a="wl-day" data-d="${d}" title="${fmtD(d)} · ${WLSTATE[k]?.[0] || 'No log needed'}"><span>${DAYS[dow(d)][0]}</span></button>`; }).join('')}</div>
      <button class="btn sm" style="margin-top:8px" data-a="wl-day" data-d="${wlY === 'miss' && wlT !== 'due' ? prev : T}">${wlT === 'ok' || wlT === 'late' ? 'Update today’s log' : 'Fill work log'}</button>`)}
    ${seg('My tasks', `<div class="mini-kpis"><button data-a="go" data-go="tasks:mine"><b>${mine.length}</b><span>Open</span></button><button data-a="go" data-go="tasks:mine-today"><b>${myDue}</b><span>Due today</span></button><button data-a="go" data-go="tasks:mine-overdue"><b class="${myOd ? 'bad' : ''}">${myOd}</b><span>Overdue</span></button></div>`)}
    ${seg('Approvals', `<div class="mini-kpis"><button data-a="go" data-go="approvals"><b class="${inbox.length ? 'warn' : ''}">${inbox.length}</b><span>Waiting for me</span></button><button data-a="go" data-go="approvals:team"><b class="${sla.length ? 'bad' : ''}">${sla.length}</b><span>Past ${cfg().slaHours} h</span></button><button data-a="go" data-go="chats"><b>${unreadCount()}</b><span>Unread chats</span></button></div>`)}
  </section>`;

  const myLists = `<div class="dgrid">
    ${card(`My tasks <span class="count">${mine.length}</span>`, mine.length ? `<ul class="list">${mine.slice(0, 6).map((t) => taskLi(t)).join('')}</ul>${mine.length > 6 ? `<div class="more"><button class="btn sm ghost" data-a="go" data-go="tasks:mine">See all ${mine.length}</button></div>` : ''}` : empty('No open tasks assigned to you.'), { list: true, cls: 'span2', actions: '<button class="btn sm ghost" data-a="go" data-go="tasks:mine-board">Board</button>' })}
    ${card(`Waiting for my decision <span class="count">${inbox.length}</span>`, inbox.length ? `<ul class="list">${inbox.slice(0, 6).map((r) => `<li data-a="req" data-id="${r.id}" style="cursor:pointer"><div class="grow"><div class="trunc">${esc(r.title)}</div><div class="tiny muted">${esc(nameOf(r.empId))} · ${RTYPE[r.type]}</div></div>${pastSLA(r) ? '<span class="pill t-bad">Late</span>' : ''}</li>`).join('')}</ul>${inbox.length > 6 ? `<div class="more"><button class="btn sm ghost" data-a="go" data-go="approvals">See all ${inbox.length}</button></div>` : ''}` : empty('Nothing waiting for you.'), { list: true })}
  </div>`;

  /* 2 — office / team overview */
  let overview = '';
  if (office) {
    const strip = [['Present', `${present}<small>/${expected.length}</small>`, 'ok', 'attendance:today'], ['Absent', absent, absent ? 'bad' : '', 'attendance:today'], ['Not in yet', notIn, '', 'attendance:today'], ['Late', late, late ? 'warn' : '', 'attendance:today'],
      ['On leave', leave, '', 'attendance:today'], ['WFH / OD', remote, '', 'attendance:today'], ['Overdue tasks', od.length, od.length ? 'bad' : '', 'tasks:overdue'], ['Blocked', blocked.length, blocked.length ? 'bad' : '', 'tasks:blocked']];
    const ftab = ui('dashTab', 'attention');
    const tabs = [['attention', 'Attention', alerts.length], ['byme', 'Assigned by me', byMe.length], ['blocked', 'Blocked', blocked.length + drOpen.length], ['nolog', `No log · ${fmtDs(prev)}`, noLog.length], ['noout', 'No check-out', incomplete.length]];
    const panel = {
      attention: alerts.length ? `<div class="body grid" style="gap:8px">${alerts.map(([t, txt, go]) => `<button class="alert ${t ? 't-' + t : ''}" style="${t ? '' : 'background:var(--sunk)'}" data-a="go" data-go="${go}">${esc(txt)}<span style="margin-left:auto">›</span></button>`).join('')}</div>` : `<div class="body">${empty('No exceptions — all clear.')}</div>`,
      byme: byMe.length ? `<ul class="list">${byMe.slice(0, 8).map((t) => taskLi(t, true)).join('')}</ul>` : `<div class="body">${empty('You have no open tasks assigned to others.')}</div>`,
      blocked: (blocked.length + drOpen.length) ? `<ul class="list">${blocked.slice(0, 5).map((t) => `<li data-a="task" data-id="${t.id}" style="cursor:pointer"><div class="grow"><div class="trunc">${esc(t.code)} · ${esc(t.title)}</div><div class="tiny" style="color:var(--bad)">${esc(t.blockedReason || '')} · ${esc(nameOf(t.assigneeId))}</div></div>${pill(TSTAT, 'BLOCKED')}</li>`).join('')}${drOpen.slice(0, 5).map((r) => `<li data-a="dreq" data-id="${r.id}" style="cursor:pointer"><div class="grow"><div class="trunc">${esc(r.code)} · ${esc(r.title)}</div><div class="tiny muted">${esc(deptOf(r.fromDept)?.code)} → ${esc(deptOf(r.toDept)?.code)} · due ${fmtDs(r.due)}</div></div>${pill(DRSTAT, r.status)}</li>`).join('')}</ul>` : `<div class="body">${empty('Nothing blocked.')}</div>`,
      nolog: noLog.length ? `<ul class="list cols2">${noLog.slice(0, 12).map((e) => `<li>${person(e.id, deptOf(e.deptId)?.name)}</li>`).join('')}</ul>${noLog.length > 12 ? `<div class="more"><button class="btn sm ghost" data-a="go" data-go="worklog:team">See all ${noLog.length}</button></div>` : ''}` : `<div class="body">${empty('Everyone who worked submitted a log.')}</div>`,
      noout: incomplete.length ? `<ul class="list cols2">${incomplete.slice(0, 12).map(({ e, d }) => `<li>${person(e.id, fmtD(d))}</li>`).join('')}</ul>` : `<div class="body">${empty('No missing punches.')}</div>`,
    }[ftab];
    overview = `<h2 class="sec-h">${mgmt ? 'Office today' : 'My team today'} <span class="muted">· ${esc(mode)}</span></h2>
    <div class="kstrip">${strip.map(([l, v, tone, go]) => `<button class="kt" data-a="go" data-go="${go}"><span class="l">${l}</span><span class="v ${tone}">${v}</span></button>`).join('')}</div>
    <div class="dgrid">
      <section class="card span2"><div class="tabs card-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button class="tab" role="tab" aria-selected="${ftab === k}" data-a="ui" data-k="dashTab" data-v="${k}">${esc(l)}${n ? ` <span class="count">${n}</span>` : ''}</button>`).join('')}</div>${panel}</section>
      ${card('Attendance by department', `<div class="grid" style="gap:10px">${deptStr.map(([d, n, p, l]) => `<div><div class="row small" style="justify-content:space-between"><span>${esc(d.name)}</span><span><b>${p}</b><span class="muted">/${n}</span>${l ? ` <span class="tiny muted">· ${l} on leave</span>` : ''}</span></div><div class="bar"><span style="width:${n ? Math.round((p / n) * 100) : 0}%"></span></div></div>`).join('')}</div>`)}
    </div>`;
  } else if (byMe.length) {
    overview = `<div class="dgrid">${card(`Assigned by me <span class="count">${byMe.length}</span>`, `<ul class="list">${byMe.slice(0, 6).map((t) => taskLi(t, true)).join('')}</ul>`, { list: true, cls: 'span2' })}</div>`;
  }

  /* 3 — company */
  const company = (events.length || anns.length) ? `<h2 class="sec-h">Around the company</h2><div class="dgrid">
    ${anns.length ? card('Announcements', `<ul class="list">${anns.map((a) => `<li style="display:block"><b>${esc(a.title)}</b><div class="small muted">${esc(a.body)}</div></li>`).join('')}</ul>`, { list: true, cls: events.length ? '' : 'span3' }) : ''}
    ${events.length ? card('Coming up · 30 days', `<ul class="list cols2">${events.slice(0, 8).map(([d, l]) => `<li><span class="date-chip"><b>${+d.slice(8)}</b>${MON[+d.slice(5, 7) - 1]}</span><span class="grow trunc">${esc(l)}</span></li>`).join('')}</ul>`, { list: true, cls: anns.length ? 'span2' : 'span3' }) : ''}
  </div>` : '';

  const actions = `<button class="btn pri" data-a="new-task">+ Task</button><button class="btn" data-a="apply-leave">Apply leave</button><button class="btn" data-a="claim-new">Claim expense</button><button class="btn hide-sm" data-a="new-req">Raise request</button>`;
  const body = `${yourDay}${myLists}${overview}${company}`;
  return shell(body, `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${esc(me.name.split(' ')[0])}`, `${DAYS[dow(T)]}, ${fmtD(T)}`, actions);
}

/* ═════════════ Attendance ═════════════ */
function vAttendance() {
  const mgr = isManager(), tab = ui('attTab', mgr ? 'today' : 'mine');
  const tabs = [['today', 'Daily board', mgr], ['mine', 'My attendance', true], ['register', 'Monthly register', mgr], ['salary', 'Salary sheet', canSalary()], ['import', 'Import machine report', isHR()]].filter((t) => t[2]);
  let body = `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-a="ui" data-k="attTab" data-v="${k}">${l}</button>`).join('')}</div>`;
  const T = today();
  if (tab === 'mine') body += monthView(S.me, ui('attMonth', T.slice(0, 7)));
  if (tab === 'salary') body += canSalary() ? vSalary() : '';
  if (tab === 'today') {
    const d = ui('attDate', T), dept = ui('attDept', '');
    const rows = scope().map(empById).filter((e) => e && (!dept || e.deptId === dept)).sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ e, s: dayStatus(e, d) }));
    const counts = rows.reduce((m, r) => ((m[r.s.code] = (m[r.s.code] || 0) + 1), m), {});
    body += `<div class="filters"><input type="date" class="i" id="att-date" data-c="attDate" value="${d}"><select class="i" id="att-dept" data-c="attDept">${deptOpts(dept, 'All departments')}</select>
      <button class="btn" data-a="ui" data-k="attDate" data-v="${addDays(d, -1)}">‹ Previous day</button><button class="btn" data-a="ui" data-k="attDate" data-v="${addDays(d, 1)}">Next day ›</button></div>
      <div class="row" style="margin-bottom:10px">${Object.entries(counts).map(([k, n]) => `${stPill(k)}<b class="small">${n}</b>`).join(' ')}</div>
      ${card(`${DAYS[dow(d)]} ${fmtD(d)}`, `<div class="tbl-wrap"><table class="t"><thead><tr><th>Employee</th><th>Status</th><th>First in</th><th>Last out</th><th class="num">Worked</th><th class="num">Late</th><th>Location</th><th>Notes</th></tr></thead><tbody>
        ${rows.map(({ e, s }) => `<tr><td>${person(e.id, `${e.code || ''} · ${deptOf(e.deptId)?.name || ''}`)}</td><td>${stPill(s.code, s.note)}</td><td>${hm(s.inT)}</td><td>${hm(s.outT)}</td><td class="num">${mins(s.work)}</td><td class="num">${s.lateMin ? s.lateMin + 'm' : ''}</td><td>${locCell(e.id, d)}</td><td class="small muted">${esc(s.note)}</td></tr>`).join('')}
      </tbody></table></div>`, { list: true, actions: `<button class="btn sm" data-a="export-att-day">Export</button>` })}`;
  }
  if (tab === 'register') {
    const m = ui('regMonth', T.slice(0, 7)), dept = ui('attDept', ''), days = eachDay(m + '-01', monthEnd(m));
    const ppl = scope().map(empById).filter((e) => e && (!dept || e.deptId === dept)).sort((a, b) => a.name.localeCompare(b.name));
    body += `<div class="filters"><input type="month" class="i" id="reg-month" data-c="regMonth" value="${m}"><select class="i" id="att-dept2" data-c="attDept">${deptOpts(dept, 'All departments')}</select><button class="btn" data-a="export-register">Export month</button></div>
    ${card(fmtM(m), `<div class="tbl-wrap"><table class="reg"><thead><tr><th class="n" style="text-align:left">Employee</th>${days.map((d) => `<th class="tiny muted">${+d.slice(8)}<br>${DAYS[dow(d)][0]}</th>`).join('')}<th>P</th><th>L</th><th>A</th><th>LV</th></tr></thead><tbody>
      ${ppl.map((e) => { const ss = days.map((d) => dayStatus(e, d)); const c = (k) => ss.filter((s) => k.includes(s.code)).length;
        return `<tr><td class="n">${esc(e.name)}</td>${ss.map((s, i) => `<td>${s.code ? `<span class="code c-${s.code}" title="${esc(fmtD(days[i]) + ' · ' + (STATUS[s.code]?.[0] || '') + (s.inT ? ' · ' + hm(s.inT) + '–' + hm(s.outT) : ''))}">${s.code === 'NI' ? '·' : s.code}</span>` : ''}</td>`).join('')}
        <td><b>${c(['P', 'L', 'WFH', 'OD']) + c(['HD']) / 2}</b></td><td>${ss.filter((s) => s.lateMin).length}</td><td style="color:var(--bad)">${c(['A'])}</td><td>${c(['LV'])}</td></tr>`; }).join('')}
    </tbody></table></div><div class="row tiny muted" style="padding:10px 16px">${Object.entries(STATUS).filter(([k]) => k).map(([k, v]) => `<span><span class="code c-${k}">${k}</span> ${v[0]}</span>`).join(' ')}</div>`, { list: true })}`;
  }
  if (tab === 'import') {
    const imp = S.ui.import;
    body += `<div class="grid g2">${card('Upload the attendance report', `
      <p class="small">Export the punch log from your machine software (eSSL eTimeTrackLite, ZKTeco, Realtime, Matrix…) as Excel or CSV, then upload it here. Each row needs an employee ID — matched to the <b>Biometric ID</b> or <b>Employee code</b> on the People page — and either a date-time column, a date + time column, or date + in-time + out-time columns.</p>
      <input type="file" class="i" id="imp-file" accept=".xlsx,.xls,.csv" data-c="importFile">
      <p class="tiny muted" style="margin-top:8px">Duplicate punches are skipped automatically, so re-uploading an overlapping report is safe.</p>`)}
      ${card('Preview', imp ? (imp.error ? `<p style="color:var(--bad)">${esc(imp.error)}</p>` : `
        <div class="kv"><div><span>Punches matched</span><b>${imp.punches.length}</b></div><div><span>Employees</span><b>${new Set(imp.punches.map((p) => p.emp.id)).size}</b></div>
        <div><span>Unknown IDs</span><b>${imp.unknown.length}</b></div><div><span>Unreadable rows</span><b>${imp.bad}</b></div></div>
        ${imp.unknown.length ? `<p class="tiny muted">Not matched: ${esc(imp.unknown.slice(0, 20).join(', '))}${imp.unknown.length > 20 ? '…' : ''} — add these IDs to the employees’ profiles and upload again.</p>` : ''}
        <p class="tiny muted">Columns used: ${esc(Object.values(imp.cols).filter(Boolean).join(', '))}</p>
        <button class="btn pri" data-a="do-import" ${imp.punches.length ? '' : 'disabled'}>Import ${imp.punches.length} punches</button>`) : empty('Choose a file to see what will be imported.'))}
      ${card('Attendance source', `<p class="small">Currently: <b>${cfg().attSource === 'device' ? 'biometric machine report' : 'web check-in'}</b>. Machine data imported up to <b>${fmtD(cfg().importedThrough)}</b>.</p><p class="tiny muted">In machine mode, days after the last import show “Pending import” instead of absent. Change the source in Settings.</p>`)}</div>`;
  }
  return shell(body, 'Attendance', `Shift ${cfg().shift.start}–${cfg().shift.end}, ${cfg().shift.grace} min grace`, `${remoteOn(S.me.id, T) || lastPing(locOf(S.me.id, T)) ? '<button class="btn" data-a="loc-share">Share my location</button>' : ''}<button class="btn" data-a="new-req" data-t="CORRECTION">Correction</button><button class="btn" data-a="new-req" data-t="WFH_OD">WFH / OD</button>`);
}
function monthView(emp, m) {
  const days = eachDay(m + '-01', monthEnd(m)), padN = (dow(m + '-01') + 6) % 7;
  const ss = days.map((d) => [d, dayStatus(emp, d)]);
  const c = (k) => ss.filter(([, s]) => k.includes(s.code)).length;
  const prevM = addDays(m + '-01', -1).slice(0, 7), nextM = addDays(monthEnd(m), 1).slice(0, 7);
  return `<div class="grid g3">${card(fmtM(m), `<div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dh">${d}</div>`).join('')}${'<div></div>'.repeat(padN)}
    ${ss.map(([d, s]) => `<div class="dc ${s.code ? 'c-' + s.code : ''}" style="${d === today() ? 'outline:2px solid var(--accent)' : ''}"><b>${+d.slice(8)}</b> ${s.code && s.code !== 'NI' ? s.code : ''}${s.inT ? `<div>${hm(s.inT)}–${hm(s.outT)}</div>` : ''}${s.code === 'I' ? `<button class="btn sm ghost" style="padding:0" data-a="new-req" data-t="CORRECTION" data-d="${d}">Fix</button>` : ''}</div>`).join('')}</div>`,
    { cls: 'span2', actions: `<button class="btn sm" data-a="ui" data-k="attMonth" data-v="${prevM}">‹</button><button class="btn sm" data-a="ui" data-k="attMonth" data-v="${nextM}">›</button>` })}
    ${card('Summary', `<div class="kv" style="grid-template-columns:1fr">${[['Present', c(['P', 'L'])], ['Late marks', ss.filter(([, s]) => s.lateMin).length], ['Half days', c(['HD'])], ['WFH / OD', c(['WFH', 'OD'])], ['On leave', c(['LV'])], ['Absent', c(['A'])], ['Missing check-out', c(['I'])], ['Hours worked', mins(ss.reduce((a, [, s]) => a + s.work, 0))]].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`)}</div>`;
}

/* ═════════════ Leave ═════════════ */
function vLeave() {
  const T = today(), year = +T.slice(0, 4), bals = balances(S.me, year);
  const mine = reqsOf('LEAVE', S.me.id).sort((a, b) => b.data.from.localeCompare(a.data.from));
  const m = ui('lvMonth', T.slice(0, 7)), days = eachDay(m + '-01', monthEnd(m));
  const ppl = (isMgmt() ? active() : [S.me, ...myTeam().map(empById), empById(S.me.managerId)].filter(Boolean)).sort((a, b) => a.name.localeCompare(b.name));
  const body = `<div class="grid g3" style="margin-bottom:14px">${bals.map((b) => card(esc(b.lt.name), `<div style="font:600 2rem var(--f-display)">${b.lt.quota ? b.avail : '—'} <span class="small muted" style="font-family:var(--f-body)">${b.lt.quota ? 'days available' : 'unpaid, no balance'}</span></div>
    <div class="kv" style="margin-top:6px"><div><span>Credited</span><b>${b.entitled}</b></div><div><span>Used</span><b>${b.used}</b></div><div><span>Pending</span><b>${b.pending}</b></div><div><span>Code</span><b>${esc(b.lt.code)}</b></div></div>
    ${b.lt.accrual ? `<p class="tiny muted" style="margin:6px 0 0">Earns ${round2(b.lt.quota / 12)} per month</p>` : ''}`)).join('')}</div>
  <div class="grid" style="margin-bottom:14px">${card('My leave applications', mine.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Type</th><th>Dates</th><th class="num">Days</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
    ${mine.map((r) => `<tr><td><span class="pill">${esc(r.data.lt)}</span></td><td>${fmtD(r.data.from)}${r.data.to !== r.data.from ? ' – ' + fmtD(r.data.to) : ''}${r.data.half ? ' (½)' : ''}</td><td class="num">${r.data.days}</td><td class="small muted">${esc(r.data.reason)}</td>
    <td>${r.data.cancelled ? '<span class="pill">Cancelled</span>' : pill(RSTAT, r.status)}</td><td class="row">${r.status === 'PENDING' || r.status === 'RETURNED' ? `<button class="btn sm" data-a="req" data-id="${r.id}">Open</button>` : ''}${r.status === 'APPROVED' && !r.data.cancelled && r.data.to >= T && !r.data.cancelOf ? `<button class="btn sm" data-a="cancel-leave" data-id="${r.id}">Request cancellation</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : empty('No leave applications yet.'), { list: true, actions: '<button class="btn pri sm" data-a="apply-leave">Apply for leave</button>' })}</div>
  ${card(`Team leave calendar · ${fmtM(m)}`, `<div class="tbl-wrap"><table class="reg"><thead><tr><th class="n" style="text-align:left">Employee</th>${days.map((d) => `<th class="tiny muted">${+d.slice(8)}<br>${DAYS[dow(d)][0]}</th>`).join('')}</tr></thead><tbody>
    ${ppl.map((e) => `<tr><td class="n">${esc(e.name)}</td>${days.map((d) => { const r = reqsOf('LEAVE', e.id).find((x) => ['APPROVED', 'PENDING'].includes(x.status) && !x.data.cancelled && !x.data.cancelOf && x.data.from <= d && x.data.to >= d); const off = !workingDay(d);
      return `<td style="${off ? 'background:var(--sunk)' : ''}">${r && !off ? `<span class="code ${r.status === 'APPROVED' ? 'c-LV' : ''}" style="${r.status === 'PENDING' ? 'border:1px dashed var(--vio);color:var(--vio)' : ''}" title="${esc(r.data.lt + ' · ' + r.status.toLowerCase())}">${esc(r.data.lt[0])}</span>` : ''}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div><p class="tiny muted" style="padding:8px 16px">Solid = approved, dashed = pending. Grey columns are weekly offs and holidays.</p>`, { list: true, actions: `<button class="btn sm" data-a="ui" data-k="lvMonth" data-v="${addDays(m + '-01', -1).slice(0, 7)}">‹</button><button class="btn sm" data-a="ui" data-k="lvMonth" data-v="${addDays(monthEnd(m), 1).slice(0, 7)}">›</button>` })}`;
  return shell(body, 'Leave — CL / SL', `Balances for ${year}. Approved leave updates attendance automatically.`, '<button class="btn pri" data-a="apply-leave">Apply for leave</button>');
}

/* ═════════════ Tasks ═════════════ */
function vTasks() {
  const team = myTeam(), mgmt = isMgmt();
  const sc = ui('tScope', mgmt ? 'all' : team.length ? 'team' : 'mine'), view = ui('tView', 'list');
  const st = ui('tStatus', 'OPEN'), pr = ui('tPrio', ''), q = ui('tQ', '').toLowerCase(), dept = ui('tDept', ''), who = ui('tWho', '');
  let list = S.tasks.filter((t) => t.code);
  if (sc === 'mine') list = list.filter((t) => t.assigneeId === S.me.id);
  else if (sc === 'assigned') list = list.filter((t) => t.assignerId === S.me.id);
  else if (sc === 'team') list = list.filter((t) => [S.me.id, ...team].includes(t.assigneeId));
  else if (!mgmt) list = list.filter((t) => canSee(t.assigneeId) || t.assignerId === S.me.id);
  if (view === 'board') list = list.filter((t) => openTask(t) || (t.completedAt && Date.now() - t.completedAt < 7 * 86400000));
  else if (st === 'OPEN') list = list.filter(openTask);
  else if (st === 'OVERDUE') list = list.filter((t) => overdue(t));
  else if (st === 'TODAY') list = list.filter((t) => openTask(t) && t.due === today());
  else if (st) list = list.filter((t) => effStatus(t) === st);
  if (pr) list = list.filter((t) => t.priority === pr);
  if (dept) list = list.filter((t) => t.deptId === dept);
  if (who) list = list.filter((t) => t.assigneeId === who);
  if (q) list = list.filter((t) => `${t.code} ${t.title} ${t.project || ''} ${t.desc || ''}`.toLowerCase().includes(q));
  list.sort(taskSort);
  const scopes = [['mine', 'My tasks'], ['assigned', 'Assigned by me'], ...(team.length && !mgmt ? [['team', 'My team']] : []), ...(mgmt ? [['all', 'All tasks']] : [])];
  let body = `<div class="tabs">${scopes.map(([k, l]) => `<button class="tab" aria-selected="${sc === k}" data-a="ui" data-k="tScope" data-v="${k}">${l}</button>`).join('')}</div>
  <div class="filters">
    <input class="i" id="t-q" data-i="tQ" placeholder="Search ID, title, project…" value="${esc(ui('tQ', ''))}" style="min-width:200px">
    ${view === 'list' ? `<select class="i" id="t-st" data-c="tStatus">${opts([['OPEN', 'Open tasks'], ['TODAY', 'Due today'], ['OVERDUE', 'Overdue'], ['', 'Any status'], ...Object.entries(TSTAT).map(([k, v]) => [k, v[0]])], st)}</select>` : ''}
    <select class="i" id="t-pr" data-c="tPrio">${opts(Object.entries(PRIO).map(([k, v]) => [k, v[0]]), pr, 'Any priority')}</select>
    <select class="i" id="t-dept" data-c="tDept">${deptOpts(dept, 'Any department')}</select>
    ${sc !== 'mine' ? `<select class="i" id="t-who" data-c="tWho">${peopleOpts(who, 'Anyone', mgmt ? null : [S.me.id, ...team])}</select>` : ''}
    <span style="flex:1"></span>
    <button class="btn ${view === 'list' ? 'pri' : ''}" data-a="ui" data-k="tView" data-v="list">List</button><button class="btn ${view === 'board' ? 'pri' : ''}" data-a="ui" data-k="tView" data-v="board">Board</button>
  </div>`;
  if (view === 'board') {
    const cols = [['TODO', 'To do'], ['IN_PROGRESS', 'In progress'], ['BLOCKED', 'Blocked'], ['IN_REVIEW', 'In review'], ['DONE', 'Completed']];
    body += `<div class="board">${cols.map(([k, l]) => { const items = list.filter((t) => t.status === k); return `<div class="col" data-drop="${k}"><h3><span>${l}</span><span>${items.length}</span></h3>
      ${items.map((t) => `<div class="kcard pri-${t.priority}" draggable="true" data-drag="${t.id}" data-a="task" data-id="${t.id}"><div>${esc(t.title)}</div><div class="tiny muted">${esc(t.code)} · ${esc(nameOf(t.assigneeId))} · <span style="${overdue(t) ? 'color:var(--bad);font-weight:600' : ''}">${fmtDs(t.due)}</span></div></div>`).join('')}</div>`; }).join('')}</div>
      <p class="tiny muted">Drag a card to change its status. Blocking a task needs a reason, so open the task for that.</p>`;
  } else {
    body += card(`${list.length} task(s)`, list.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Task</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Due</th><th>Assigned by</th><th>Project</th></tr></thead><tbody>
      ${list.map((t) => `<tr class="click pri-${t.priority}" data-a="task" data-id="${t.id}"><td style="min-width:220px"><b style="font-weight:500">${esc(t.title)}</b><div class="tiny muted">${esc(t.code)}${t.status === 'BLOCKED' && t.blockedReason ? ` · <span style="color:var(--bad)">${esc(t.blockedReason)}</span>` : ''}</div></td>
      <td>${esc(nameOf(t.assigneeId))}</td><td>${pill(PRIO, t.priority)}</td><td>${pill(TSTAT, effStatus(t))} ${overdue(t) ? '<span class="pill t-bad">Overdue</span>' : ''}</td>
      <td style="white-space:nowrap;${overdue(t) ? 'color:var(--bad);font-weight:600' : ''}">${fmtD(t.due)}</td><td>${esc(nameOf(t.assignerId))}</td><td class="small muted">${esc(t.project || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('No tasks match these filters.'),
      { list: true, actions: `<button class="btn sm" data-a="export-tasks">Export</button>` });
  }
  return shell(body, 'Tasks', 'Assignments, deadlines and progress — overdue is flagged on top of each task’s real status', `<button class="btn" data-a="templates">Recurring tasks</button><button class="btn pri" data-a="new-task">New task</button>`);
}
</script>
