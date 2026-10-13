<script>
const DRSTAT = { OPEN: ['Open', 't-info'], PENDING_INFO: ['Needs info', 't-warn'], IN_PROGRESS: ['In progress', 't-vio'], BLOCKED: ['Blocked', 't-bad'], RESOLVED: ['Resolved', 't-ok'], CLOSED: ['Closed', ''] };

/* ═════════════ Work log ═════════════ */
/* work-log status per day: ok = same day, late = submitted after the day, miss = worked but no log, due = today, not yet */
const WLSTATE = { ok: ['Submitted on time', 't-ok'], late: ['Submitted late', 't-vio'], miss: ['Not submitted', 't-bad'], due: ['Due today', 't-warn'] };
const WL_WINDOW = 62;
function wlState(emp, d) {
  const T = today();
  if (!emp || d > T || (emp.joining && d < emp.joining) || d < addDays(T, -WL_WINDOW)) return '';
  const log = S.wlogs.find((w) => w.empId === emp.id && w.date === d);
  if (log) { const t = log.firstAt || log.at; return t && ymd(new Date(t)) > d ? 'late' : 'ok'; }
  const c = dayStatus(emp, d).code;
  if (d === T) return presentish(c) || c === 'NI' ? 'due' : '';
  return presentish(c) ? 'miss' : '';
}
function wlCalendar(emp, m, sel) {
  const T = today(), first = m + '-01', days = eachDay(first, monthEnd(m));
  const lead = (dow(first) + 6) % 7; // Monday first
  const minM = addDays(T, -WL_WINDOW).slice(0, 7), prevM = addDays(first, -1).slice(0, 7), nextM = addDays(monthEnd(m), 1).slice(0, 7);
  const st = days.map((d) => [d, wlState(emp, d)]);
  const n = (k) => st.filter(([, s]) => s === k).length;
  const cells = [...Array(lead).fill('<span></span>'), ...st.map(([d, k]) => {
    const off = !workingDay(d), fut = d > T;
    return `<button type="button" class="cal-d wc-${k || 'none'}${d === sel ? ' sel' : ''}${d === T ? ' today' : ''}${off ? ' off' : ''}" data-a="wl-day" data-d="${d}" ${fut ? 'disabled' : ''} aria-label="${fmtD(d)}${k ? ' — ' + WLSTATE[k][0] : ''}" title="${fmtD(d)}${k ? ' — ' + WLSTATE[k][0] : ''}" aria-pressed="${d === sel}"><span class="n">${+d.slice(8)}</span></button>`;
  })];
  return `<section class="card wl-cal"><header><button class="btn sm ghost" data-a="wl-month" data-m="${prevM}" ${prevM < minM ? 'disabled' : ''} aria-label="Previous month">‹</button><h2>${fmtM(m)}</h2><button class="btn sm ghost" data-a="wl-month" data-m="${nextM}" ${nextM > T.slice(0, 7) ? 'disabled' : ''} aria-label="Next month">›</button></header>
    <div class="body"><div class="cal-h">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div><div class="cal-g">${cells.join('')}</div>
    <div class="cal-legend"><span><i class="wc-ok"></i>On time <b>${n('ok')}</b></span><span><i class="wc-late"></i>Late <b>${n('late')}</b></span><span><i class="wc-miss"></i>Missing <b>${n('miss')}</b></span>${n('due') ? `<span><i class="wc-due"></i>Due today</span>` : ''}</div>
    <p class="tiny muted" style="margin:8px 0 0">Click any day to add or edit its log. Late = submitted after that day ended. Days off, leave and absences need no log.</p></div></section>`;
}
function wlTeamGrid(ids, m, sel) {
  const T = today(), days = eachDay(m + '-01', monthEnd(m)).filter((d) => d <= T);
  const ppl = ids.map(empById).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  const rows = ppl.map((e) => { const ss = days.map((d) => wlState(e, d)); return { e, ss, miss: ss.filter((x) => x === 'miss').length, late: ss.filter((x) => x === 'late').length }; });
  return card(`Team work-log calendar · ${fmtM(m)}`, `<div class="tbl-wrap"><table class="reg wlg"><thead><tr><th class="n" style="text-align:left">Employee</th>${days.map((d) => `<th class="tiny muted">${+d.slice(8)}</th>`).join('')}<th title="Missing">Miss</th><th title="Late">Late</th></tr></thead><tbody>
    ${rows.map(({ e, ss, miss, late }) => `<tr><td class="n">${esc(e.name)}</td>${ss.map((k, i) => `<td><button class="sq wc-${k || 'none'}${days[i] === sel ? ' sel' : ''}" data-a="ui" data-k="wlDate" data-v="${days[i]}" title="${esc(e.name)} · ${fmtD(days[i])}${k ? ' · ' + WLSTATE[k][0] : ''}" aria-label="${esc(e.name)} ${fmtD(days[i])} ${k ? WLSTATE[k][0] : 'no log needed'}"></button></td>`).join('')}<td style="color:var(--bad);font-weight:600">${miss || ''}</td><td style="color:var(--vio);font-weight:600">${late || ''}</td></tr>`).join('')}
  </tbody></table></div><div class="cal-legend" style="padding:10px 16px"><span><i class="wc-ok"></i>On time</span><span><i class="wc-late"></i>Late</span><span><i class="wc-miss"></i>Missing</span><span><i class="wc-due"></i>Due today</span></div>`, { list: true, actions: `<input type="month" class="i" id="wl-tm" data-c="wlMonth" value="${m}" max="${T.slice(0, 7)}" style="width:auto">` });
}

function vWorklog() {
  const T = today(), d = ui('wlDate', T), mgr = isManager(), tab = ui('wlTab', 'mine');
  const tabsH = `<div class="tabs"><button class="tab" aria-selected="${tab === 'mine'}" data-a="ui" data-k="wlTab" data-v="mine">My log</button>${mgr ? `<button class="tab" aria-selected="${tab === 'team'}" data-a="ui" data-k="wlTab" data-v="team">Team logs</button>` : ''}</div>`;
  const dateBar = `<div class="filters"><button class="btn" data-a="ui" data-k="wlDate" data-v="${addDays(d, -1)}">‹</button><input type="date" class="i" id="wl-date" data-c="wlDate" value="${d}" max="${T}">${d < T ? `<button class="btn" data-a="ui" data-k="wlDate" data-v="${addDays(d, 1)}">›</button>` : ''}<span class="muted small" style="align-self:center">${DAYS[dow(d)]}, ${fmtD(d)}</span></div>`;
  const nav = tabsH;
  let body = nav;
  if (tab === 'mine') {
    const log = S.wlogs.find((w) => w.empId === S.me.id && w.date === d);
    const items = new Map((log?.tasks || []).map((x) => [x.id, x]));
    const doneThatDay = (t) => t.completedAt && ymd(new Date(t.completedAt)) === d;
    const tasks = S.tasks.filter((t) => t.assigneeId === S.me.id && t.code && ((openTask(t) && t.start <= d) || doneThatDay(t) || items.has(t.id))).sort(taskSort);
    let prevD = addDays(d, -1); for (let i = 0; i < 6 && !workingDay(prevD); i++) prevD = addDays(prevD, -1);
    const prevLog = S.wlogs.find((w) => w.empId === S.me.id && w.date === prevD);
    const editable = d >= addDays(T, -31) && d <= T && !S.readonly && (!S.me.joining || d >= S.me.joining);
    const CH = [['W', 'Worked on it'], ['C', 'Completed'], ['B', 'Blocked'], ['N', 'Not today']];
    const rowFor = (t) => {
      const it = items.get(t.id) || {};
      const st = it.st || (doneThatDay(t) ? 'C' : log ? 'N' : t.status === 'IN_PROGRESS' ? 'W' : 'N');
      return `<li style="display:block" class="pri-${t.priority}">
        <div class="row" style="justify-content:space-between;flex-wrap:nowrap"><a href="#" data-a="task" data-id="${t.id}" class="trunc" style="font-weight:500">${esc(t.title)}</a><span class="row" style="flex-wrap:nowrap">${pill(TSTAT, effStatus(t))}${overdue(t, d) ? '<span class="pill t-bad">Overdue</span>' : ''}</span></div>
        <div class="tiny muted">${esc(t.code)} · from ${esc(nameOf(t.assignerId))} · due ${fmtDs(t.due)}${(t.checklist || []).length ? ` · checklist ${(t.checklist || []).filter((c) => c.d).length}/${t.checklist.length}` : ''}</div>
        <div class="row" style="margin-top:6px;gap:6px">
          <div class="seg" role="radiogroup" aria-label="What happened with ${esc(t.code)}">${CH.map(([k, l]) => `<label class="${st === k ? 'on' : ''} s-${k}"><input type="radio" id="wl-s-${t.id}-${k}" name="s_${t.id}" value="${k}" ${st === k ? 'checked' : ''} ${editable ? '' : 'disabled'}>${l}</label>`).join('')}</div>
          <select class="i" id="wl-h-${t.id}" name="h_${t.id}" style="width:auto" aria-label="Hours" ${editable ? '' : 'disabled'}>${opts([['', 'Hours'], ...[0.5, 1, 1.5, 2, 3, 4, 5, 6, 8].map((h) => [h, h + ' h'])], it.hrs || '')}</select>
          <input class="i" id="wl-n-${t.id}" name="n_${t.id}" placeholder="Note (optional)" value="${esc(it.note || '')}" style="flex:1;min-width:140px" ${editable ? '' : 'disabled'}>
        </div></li>`;
    };
    const f = (k, l, v, ph = '') => `<label class="f full">${l}<textarea class="i" id="wl-${k}" name="${k}" rows="2" placeholder="${esc(ph)}" ${editable ? '' : 'disabled'}>${esc(v || '')}</textarea></label>`;
    const k = wlState(S.me, d);
    body += `<div class="wl-layout">${wlCalendar(S.me, ui('wlMonth', d.slice(0, 7)), d)}<div class="grid" style="gap:14px;align-content:start">
    <div class="wl-dayhead"><div><h2 style="margin:0">${DAYS[dow(d)]}, ${fmtD(d)}</h2><div class="small muted">${log ? `First submitted ${fmtDT(log.firstAt || log.at)}${log.firstAt && log.at !== log.firstAt ? ` · last edited ${fmtDT(log.at)}` : ''}` : k === 'miss' ? 'No log for this day yet — fill it now; it will be marked late.' : k === 'due' ? 'Submit before midnight to count as on time.' : workingDay(d) ? 'No log needed for this day (leave, absent or not joined yet) — you can still add one.' : 'Weekly off / holiday'}</div></div>${k ? `<span class="pill ${WLSTATE[k][1]}">${WLSTATE[k][0]}</span>` : ''}</div>
    <form data-f="worklog" data-date="${d}" class="grid" style="gap:14px">
      ${card(`My tasks for ${fmtDs(d)} (${tasks.length})`, tasks.length ? `<ul class="list">${tasks.map(rowFor).join('')}</ul>` : empty('No tasks assigned to you for this day. Add what you did in “Other work” below.'),
        { list: true, actions: editable && tasks.length ? '<button type="button" class="btn sm" data-a="wl-all">Mark all as worked on</button>' : '' })}
      <section class="card"><details ${log?.extra || log?.blockersNote || log?.outcomes || log?.tomorrowNote ? 'open' : ''}><summary class="body" style="cursor:pointer"><b>Other work &amp; notes</b> <span class="small muted">— optional; tasks above already fill the report</span></summary>
        <div class="body fgrid" style="padding-top:0">
          ${f('extra', 'Other work not in a task', log?.extra, 'e.g. Attended distributor call, prepared samples')}${f('outcomes', 'Results / numbers', log?.outcomes, 'e.g. Collected ₹1.2 lakh, 3 farmer visits')}
          ${f('blockers', 'Need help with (your manager is alerted)', log?.blockersNote)}${f('tomorrow', 'Plan for tomorrow', log?.tomorrowNote, 'Leave blank to use your open tasks')}
          ${editable && prevLog ? `<div class="full"><button type="button" class="btn sm" data-a="wl-copy" data-d="${prevD}">Copy notes from ${fmtDs(prevD)}</button></div>` : ''}
        </div></details></section>
      ${log?.review ? `<div class="alert t-info" style="cursor:default"><b>Manager feedback:</b> ${esc(log.review)}</div>` : ''}
      <div class="row">${editable ? `<button class="btn pri" type="submit">${log ? 'Update work log' : 'Submit work log'}</button><span class="small muted">Completed and blocked tasks are updated for you — no need to open each one.</span>` : '<span class="tiny muted">Logs older than 31 days are read-only.</span>'}${log ? `<span class="small muted">Saved ${fmtDT(log.at)}</span>` : ''}</div>
    </form></div></div>`;
  } else {
    const ids = scope().filter((id) => id !== S.me.id);
    const logs = S.wlogs.filter((w) => w.date === d && ids.includes(w.empId));
    const has = new Set(logs.map((l) => l.empId));
    const missing = ids.map(empById).filter((e) => e && !has.has(e.id) && presentish(dayStatus(e, d).code));
    body += wlTeamGrid(ids, ui('wlMonth', d.slice(0, 7)), d) + `<div style="margin-top:14px">${dateBar}</div>` + `${card(`Not submitted for ${fmtDs(d)} (${missing.length})`, missing.length ? `<div class="row">${missing.map((e) => `<span class="pill t-warn">${esc(e.name)}</span>`).join('')}</div>` : '<span class="muted small">Everyone who worked has submitted.</span>')}
    <div class="grid" style="margin-top:14px">${logs.length ? logs.map((l) => card(`${esc(nameOf(l.empId))} <span class="muted small" style="font-weight:400">· ${fmtDT(l.at)}</span>`, `<div class="grid g3 small">${[['Planned', l.planned], ['Completed', l.done], ['Pending', l.pending], ['Outcomes', l.outcomes], ['Blockers', l.blockers], ['Tomorrow', l.tomorrow]].filter(([, v]) => v).map(([k, v]) => `<div><div class="tiny muted" style="text-transform:uppercase;letter-spacing:.06em">${k}</div><div style="white-space:pre-wrap;${k === 'Blockers' ? 'color:var(--bad)' : ''}">${esc(v)}</div></div>`).join('')}</div>
      ${(l.tasks || []).length ? `<div class="tiny" style="margin-top:8px">${l.tasks.map((x) => { const t = S.tasks.find((y) => y.id === x.id); return `<div>${esc(t?.code || '')} ${esc(t?.title || '')}${x.hrs ? ` · ${x.hrs} h` : ''}${x.note ? ` — ${esc(x.note)}` : ''}</div>`; }).join('')}</div>` : ''}
      <form data-f="wl-review" data-id="${l.id}" class="row" style="margin-top:10px;flex-wrap:nowrap"><input class="i" id="wlr-${l.id}" name="note" placeholder="Feedback (optional)" value="${esc(l.review || '')}"><button class="btn" type="submit">${l.reviewedBy ? 'Update' : 'Mark reviewed'}</button></form>`,
      { actions: l.reviewedBy ? '<span class="pill t-ok">Reviewed</span>' : '' })).join('') : empty('No work logs for this date.')}</div>`;
  }
  return shell(body, 'Daily work log', 'Linked to your tasks — notes and hours flow into each task’s history');
}

/* ═════════════ Approvals ═════════════ */
function vApprovals() {
  const team = myTeam(), mgmt = isMgmt(), tab = ui('apTab', 'inbox'), type = ui('apType', ''), stat = ui('apStat', '');
  let list;
  if (tab === 'inbox') list = myInbox();
  else if (tab === 'mine') list = S.reqs.filter((r) => r.empId === S.me.id || r.raisedBy === S.me.id);
  else if (tab === 'decided') list = S.reqs.filter((r) => r.steps.some((s) => s.by === S.me.id && ['APPROVED', 'REJECTED', 'RETURNED'].includes(s.status)));
  else list = S.reqs.filter((r) => mgmt || team.includes(r.empId));
  if (type) list = list.filter((r) => r.type === type);
  if (stat) list = list.filter((r) => r.status === stat);
  list = list.slice().sort((a, b) => b.created - a.created);
  const body = `<div class="tabs">${[['inbox', `Waiting for me${myInbox().length ? ` (${myInbox().length})` : ''}`], ['mine', 'My requests'], ['decided', 'Decided by me'], ...(mgmt || team.length ? [['team', mgmt ? 'All requests' : 'My team’s requests']] : [])].map(([k, l]) => `<button class="tab" aria-selected="${tab === k}" data-a="ui" data-k="apTab" data-v="${k}">${l}</button>`).join('')}</div>
  <div class="filters"><select class="i" id="ap-type" data-c="apType">${opts(Object.entries(RTYPE), type, 'All types')}</select>${tab !== 'inbox' ? `<select class="i" id="ap-stat" data-c="apStat">${opts(Object.entries(RSTAT).map(([k, v]) => [k, v[0]]), stat, 'Any status')}</select>` : ''}</div>
  ${card(`${list.length} request(s)`, list.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Request</th><th>Type</th><th>From</th><th>Status</th><th>With</th><th>Raised</th></tr></thead><tbody>
    ${list.map((r) => { const s = curStep(r); return `<tr class="click" data-a="req" data-id="${r.id}"><td><b style="font-weight:500">${esc(r.title)}</b><div class="tiny muted">${esc(r.code)}${r.amount ? ' · ' + money(r.amount) : ''}</div></td><td class="small">${RTYPE[r.type]}</td><td>${esc(nameOf(r.empId))}</td>
      <td>${pill(RSTAT, r.status)} ${pastSLA(r) ? '<span class="pill t-bad">Late</span>' : ''}</td><td class="small">${s ? `${esc(nameOf(s.by))} <span class="muted">(${esc(s.label)})</span>` : '—'}</td><td class="small muted" style="white-space:nowrap">${fmtDT(r.created)}</td></tr>`; }).join('')}
  </tbody></table></div>` : empty(tab === 'inbox' ? 'Nothing is waiting for your decision.' : 'No requests here.'), { list: true })}
  <p class="tiny muted">Requests are never approved automatically. If an approver doesn’t respond within ${cfg().slaHours} hours the request is marked late and the requester can escalate it to the approver’s manager.</p>`;
  return shell(body, 'Approval center', 'Leave, attendance corrections, extensions, task reviews, expenses, purchases and more', '<button class="btn pri" data-a="new-req">New request</button>');
}

/* ═════════════ Departments ═════════════ */
function vDepartments() {
  const T = today(), tab = ui('drTab', 'incoming'), mgmt = isMgmt();
  const ppl = active();
  const cards = cfg().depts.map((d) => {
    const m = ppl.filter((e) => e.deptId === d.id), st = m.map((e) => dayStatus(e, T).code);
    const open = S.tasks.filter((t) => t.deptId === d.id && openTask(t));
    const inc = S.dreqs.filter((r) => r.toDept === d.id && !['RESOLVED', 'CLOSED'].includes(r.status));
    return `<section class="card"><div class="body"><div class="row" style="justify-content:space-between"><div><h2>${esc(d.name)}</h2><div class="tiny muted">${esc(d.code)} · Head: ${esc(nameOf(d.headId))}</div></div><span style="font:600 1.6rem var(--f-display)">${m.length}</span></div>
      <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:10px">${kpi('Present', st.filter(presentish).length, 'ok')}${kpi('Open tasks', open.length)}${kpi('Overdue', open.filter((t) => overdue(t)).length, open.some((t) => overdue(t)) ? 'bad' : '')}${kpi('On leave', st.filter((c) => c === 'LV').length)}${kpi('Requests in', inc.length)}${kpi('Late requests', inc.filter((r) => r.due < T).length, inc.some((r) => r.due < T) ? 'bad' : '')}</div></div></section>`;
  }).join('');
  const myD = S.me.deptId, heads = cfg().depts.filter((d) => d.headId === S.me.id).map((d) => d.id), mine = new Set([myD, ...heads]);
  let list = S.dreqs.slice();
  if (tab === 'incoming') list = list.filter((r) => mine.has(r.toDept) || r.ownerId === S.me.id);
  else if (tab === 'outgoing') list = list.filter((r) => mine.has(r.fromDept) || r.byId === S.me.id);
  else if (!mgmt) list = [];
  if (!ui('drClosed', false)) list = list.filter((r) => r.status !== 'CLOSED');
  list.sort((a, b) => a.due.localeCompare(b.due));
  const body = `<div class="grid g3" style="margin-bottom:18px">${cards || empty('No departments yet — HR can add them in Settings.')}</div>
  <h2 style="margin-bottom:8px">Cross-department requests</h2>
  <div class="tabs">${[['incoming', 'To my department'], ['outgoing', 'Raised by my department'], ...(mgmt ? [['all', 'All']] : [])].map(([k, l]) => `<button class="tab" aria-selected="${tab === k}" data-a="ui" data-k="drTab" data-v="${k}">${l}</button>`).join('')}
    <label class="check small" style="margin-left:auto"><input type="checkbox" id="dr-closed" data-c="drClosed" ${ui('drClosed', false) ? 'checked' : ''}> Show closed</label></div>
  ${card(`${list.length} request(s)`, list.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Request</th><th>From → To</th><th>Owner now</th><th>Priority</th><th>Status</th><th>Expected by</th></tr></thead><tbody>
    ${list.map((r) => { const late = r.due < T && !['RESOLVED', 'CLOSED'].includes(r.status); return `<tr class="click" data-a="dreq" data-id="${r.id}"><td><b style="font-weight:500">${esc(r.title)}</b><div class="tiny muted">${esc(r.code)} · by ${esc(nameOf(r.byId))}</div></td><td class="small">${esc(deptOf(r.fromDept)?.name)} → ${esc(deptOf(r.toDept)?.name)}</td><td>${esc(nameOf(r.ownerId))}</td><td>${pill(PRIO, r.priority)}</td><td>${pill(DRSTAT, r.status)}</td><td style="white-space:nowrap;${late ? 'color:var(--bad);font-weight:600' : ''}">${fmtD(r.due)}${late ? ' · late' : ''}</td></tr>`; }).join('')}
  </tbody></table></div>` : empty('No requests here.'), { list: true })}`;
  return shell(body, 'Departments', 'Strength, workload and coordination between teams', '<button class="btn pri" data-a="new-dreq">Request another department</button>');
}

/* ═════════════ People ═════════════ */
function vPeople() {
  const tab = ui('pTab', 'list'), q = ui('pQ', '').toLowerCase(), dept = ui('pDept', ''), showAll = ui('pAll', false);
  const vis = isMgmt() ? S.emps : S.emps.filter((e) => canSee(e.id));
  let list = vis.filter((e) => (showAll || (e.active !== false && e.status !== 'EXITED')) && (!dept || e.deptId === dept) && (!q || `${e.name} ${e.code} ${e.email} ${e.designation}`.toLowerCase().includes(q)));
  list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  let body = `<div class="tabs"><button class="tab" aria-selected="${tab === 'list'}" data-a="ui" data-k="pTab" data-v="list">Directory</button><button class="tab" aria-selected="${tab === 'org'}" data-a="ui" data-k="pTab" data-v="org">Org chart</button></div>`;
  if (tab === 'list') {
    body += `<div class="filters"><input class="i" id="p-q" data-i="pQ" placeholder="Name, code, email…" value="${esc(ui('pQ', ''))}"><select class="i" id="p-dept" data-c="pDept">${deptOpts(dept, 'All departments')}</select><label class="check small"><input type="checkbox" id="p-all" data-c="pAll" ${showAll ? 'checked' : ''}> Include exited / inactive</label></div>
    ${card(`${list.length} people`, `<div class="tbl-wrap"><table class="t"><thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>Reports to</th><th>Role</th><th>Status</th><th>Joined</th><th>Claude login</th></tr></thead><tbody>
      ${list.map((e) => `<tr class="click" data-a="emp" data-id="${e.id}"><td>${person(e.id, e.designation)}</td><td class="mono">${esc(e.code)}</td><td>${esc(deptOf(e.deptId)?.name || '')}</td><td>${esc(e.managerId ? nameOf(e.managerId) : '—')}</td><td class="small">${cap(e.role)}</td><td>${pill({ ACTIVE: ['Active', 't-ok'], PROBATION: ['Probation', 't-warn'], ON_NOTICE: ['On notice', 't-warn'], EXITED: ['Exited', ''] }, e.status || 'ACTIVE')}</td><td class="small">${fmtD(e.joining)}</td><td class="small">${e.userId ? '<span class="pill t-ok">Linked</span>' : '<span class="pill">Not yet</span>'}</td></tr>`).join('')}
    </tbody></table></div>`, { list: true, actions: '<button class="btn sm" data-a="export-people">Export</button>' })}`;
  } else {
    const ids = new Set(active().map((e) => e.id));
    const node = (e) => { const kids = active().filter((k) => k.managerId === e.id); return `<li style="margin-top:8px"><button class="btn" data-a="emp" data-id="${e.id}" style="text-align:left">${avatar(e.name)}<span><b style="font-weight:600">${esc(e.name)}</b><br><span class="tiny muted">${esc(e.designation || '')} · ${esc(deptOf(e.deptId)?.code || '')}</span></span></button>${kids.length ? `<ul style="list-style:none;margin:0;padding-left:22px;border-left:1px solid var(--line)">${kids.map(node).join('')}</ul>` : ''}</li>`; };
    body += `<ul style="list-style:none;padding:0;margin:0">${active().filter((e) => !e.managerId || !ids.has(e.managerId)).map(node).join('')}</ul>`;
  }
  return shell(body, 'People', 'One employee master used by attendance, leave, tasks and approvals', isHR() ? '<button class="btn pri" data-a="emp-new">Add employee</button>' : '');
}

/* ═════════════ Reports ═════════════ */
const REPORTS = [['attendance', 'Monthly attendance'], ['leave', 'Leave utilization'], ['productivity', 'Employee productivity'], ['tasks', 'Daily task report'], ['aging', 'Approval aging'], ['dept', 'Department MIS'], ['lifecycle', 'Employee lifecycle']];
function buildReport(key) {
  const T = today(), ids = scope(), ppl = ids.map(empById).filter(Boolean).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  const m = ui('rMonth', T.slice(0, 7)), from = ui('rFrom', addDays(T, -30)), to = ui('rTo', T), date = ui('rDate', T);
  const inRange = (d) => d >= from && d <= to;
  if (key === 'attendance') {
    const days = eachDay(m + '-01', monthEnd(m));
    return { title: `Monthly attendance — ${fmtM(m)}`, f: ['month'], cols: ['Code', 'Name', 'Department', 'Present', 'Late marks', 'Half days', 'Absent', 'Leave', 'WFH/OD', 'Incomplete', 'Weekly off', 'Holidays', 'Hours'], rows: ppl.map((e) => { const ss = days.map((d) => dayStatus(e, d)); const c = (k) => ss.filter((s) => k.includes(s.code)).length; return [e.code, e.name, deptOf(e.deptId)?.name || '', c(['P', 'L']), ss.filter((s) => s.lateMin).length, c(['HD']), c(['A']), c(['LV']), c(['WFH', 'OD']), c(['I']), c(['WO']), c(['H']), round2(ss.reduce((a, s) => a + s.work, 0) / 60)]; }) };
  }
  if (key === 'leave') {
    const y = +m.slice(0, 4);
    return { title: `Leave utilization — ${y}`, f: ['month'], cols: ['Code', 'Name', 'Department', 'Leave type', 'Credited', 'Used', 'Pending', 'Available'], rows: ppl.flatMap((e) => balances(e, y).map((b) => [e.code, e.name, deptOf(e.deptId)?.name || '', b.lt.code, b.entitled, b.used, b.pending, b.avail])) };
  }
  if (key === 'productivity') {
    const W = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    return { title: `Employee productivity — ${fmtD(from)} to ${fmtD(to)}`, f: ['range'], note: 'Weighted score counts each task completed on time at its priority weight (critical 4, high 3, medium 2, low 1) and late completions at half weight. Read it alongside workload and complexity, not as a task count.',
      cols: ['Code', 'Name', 'Tasks due', 'Completed', 'On time', 'Late', 'Still overdue', 'On-time %', 'Weighted score', 'Work logs / days worked'], rows: ppl.map((e) => {
        const t = S.tasks.filter((x) => x.assigneeId === e.id && x.status !== 'CANCELLED' && inRange(x.due));
        const comp = t.filter((x) => x.status === 'DONE' && x.completedAt), ontime = comp.filter((x) => ymd(new Date(x.completedAt)) <= x.due), late = comp.length - ontime.length;
        const worked = eachDay(from, to).filter((d) => presentish(dayStatus(e, d).code)).length, logs = S.wlogs.filter((w) => w.empId === e.id && inRange(w.date)).length;
        return [e.code, e.name, t.length, comp.length, ontime.length, late, t.filter((x) => overdue(x)).length, comp.length ? Math.round(ontime.length / comp.length * 100) + '%' : '—', ontime.reduce((s, x) => s + W[x.priority], 0) + comp.filter((x) => !ontime.includes(x)).reduce((s, x) => s + W[x.priority] / 2, 0), `${logs} / ${worked}`];
      }) };
  }
  if (key === 'tasks') {
    return { title: `Daily task report — ${fmtD(date)}`, f: ['date'], cols: ['Code', 'Name', 'Department', 'Due that day', 'Completed that day', 'Open', 'In progress', 'Blocked', 'In review', 'Overdue'], rows: ppl.map((e) => { const t = S.tasks.filter((x) => x.assigneeId === e.id); const o = t.filter(openTask); return [e.code, e.name, deptOf(e.deptId)?.name || '', t.filter((x) => x.due === date).length, t.filter((x) => x.completedAt && ymd(new Date(x.completedAt)) === date).length, o.length, o.filter((x) => x.status === 'IN_PROGRESS').length, o.filter((x) => x.status === 'BLOCKED').length, o.filter((x) => x.status === 'IN_REVIEW').length, o.filter((x) => overdue(x, date)).length]; }) };
  }
  if (key === 'aging') {
    const list = S.reqs.filter((r) => r.status === 'PENDING' && (isMgmt() || ids.includes(r.empId) || curStep(r)?.by === S.me.id)).sort((a, b) => a.created - b.created);
    return { title: 'Approval aging — pending requests', f: [], cols: ['Code', 'Type', 'Title', 'Requester', 'With', 'Step', 'Raised', 'Age (h)', 'Waiting at step (h)', 'Response time', 'Escalated'], rows: list.map((r) => { const s = curStep(r); return [r.code, RTYPE[r.type], r.title, nameOf(r.empId), s ? nameOf(s.by) : '', s?.label || '', fmtDT(r.created), Math.round((Date.now() - r.created) / 3600000), s?.at ? Math.round((Date.now() - s.at) / 3600000) : '', pastSLA(r) ? 'LATE' : 'OK', s?.escalated ? 'Yes' : '']; }) };
  }
  if (key === 'dept') {
    return { title: `Department MIS — ${fmtD(from)} to ${fmtD(to)}`, f: ['range'], cols: ['Department', 'Head', 'Headcount', 'Attendance %', 'Open tasks', 'Overdue', 'Blocked', 'Completed in period', 'Requests open', 'Requests late', 'Resolved on time %'], rows: cfg().depts.map((d) => {
      const m2 = active().filter((e) => e.deptId === d.id); let exp = 0, pres = 0;
      for (const e of m2) for (const day of eachDay(from, to)) { const c = dayStatus(e, day).code; if (['WO', 'H', '', 'PS', 'NI'].includes(c)) continue; exp++; if (presentish(c)) pres += c === 'HD' ? 0.5 : 1; }
      const t = S.tasks.filter((x) => x.deptId === d.id), o = t.filter(openTask), inc = S.dreqs.filter((r) => r.toDept === d.id), io = inc.filter((r) => !['RESOLVED', 'CLOSED'].includes(r.status));
      const res = inc.filter((r) => r.resolvedAt && inRange(ymd(new Date(r.resolvedAt)))), met = res.filter((r) => ymd(new Date(r.resolvedAt)) <= r.due);
      return [d.name, nameOf(d.headId), m2.length, exp ? Math.round(pres / exp * 100) + '%' : '—', o.length, o.filter((x) => overdue(x)).length, o.filter((x) => x.status === 'BLOCKED').length, t.filter((x) => x.completedAt && inRange(ymd(new Date(x.completedAt)))).length, io.length, io.filter((r) => r.due < T).length, res.length ? Math.round(met.length / res.length * 100) + '%' : '—'];
    }) };
  }
  if (key === 'lifecycle') {
    const rows = [];
    for (const e of S.emps.filter((x) => isMgmt() || ids.includes(x.id))) {
      if (e.joining && inRange(e.joining)) rows.push(['New joiner', e.name, deptOf(e.deptId)?.name || '', fmtD(e.joining), e.designation || '']);
      if (e.status === 'PROBATION') rows.push(['On probation', e.name, deptOf(e.deptId)?.name || '', fmtD(e.probEnd), e.probEnd && e.probEnd < T ? 'Review overdue' : 'Review due']);
      if (e.status === 'ON_NOTICE') rows.push(['On notice', e.name, deptOf(e.deptId)?.name || '', fmtD(e.exitDate), e.clearance || '']);
      if (e.status === 'EXITED' && e.exitDate && inRange(e.exitDate)) rows.push(['Exited', e.name, deptOf(e.deptId)?.name || '', fmtD(e.exitDate), '']);
      for (const h of (e.history || []).filter((x) => inRange(x.date))) rows.push([h.kind, e.name, '', fmtD(h.date), `${h.from || ''} → ${h.to || ''}`]);
    }
    return { title: `Employee lifecycle — ${fmtD(from)} to ${fmtD(to)}`, f: ['range'], cols: ['Event', 'Employee', 'Department', 'Date', 'Details'], rows };
  }
}
function vReports() {
  const key = ui('rKey', 'attendance'), r = buildReport(key), T = today();
  const num = r.cols.map((_, i) => r.rows.length && r.rows.every((x) => typeof x[i] === 'number'));
  const body = `<div class="tabs">${REPORTS.map(([k, l]) => `<button class="tab" aria-selected="${key === k}" data-a="ui" data-k="rKey" data-v="${k}">${l}</button>`).join('')}</div>
  <div class="filters">${r.f.includes('month') ? `<input type="month" class="i" id="r-month" data-c="rMonth" value="${ui('rMonth', T.slice(0, 7))}">` : ''}${r.f.includes('date') ? `<input type="date" class="i" id="r-date" data-c="rDate" value="${ui('rDate', T)}">` : ''}${r.f.includes('range') ? `<input type="date" class="i" id="r-from" data-c="rFrom" value="${ui('rFrom', addDays(T, -30))}"><input type="date" class="i" id="r-to" data-c="rTo" value="${ui('rTo', T)}">` : ''}<span style="flex:1"></span><button class="btn pri" data-a="export-report">Export to Excel</button></div>
  ${r.note ? `<p class="small alert t-info" style="cursor:default">${esc(r.note)}</p>` : ''}
  ${card(esc(r.title), r.rows.length ? `<div class="tbl-wrap"><table class="t"><thead><tr>${r.cols.map((c, i) => `<th class="${num[i] ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.rows.map((x) => `<tr>${x.map((c, i) => `<td class="${num[i] ? 'num' : ''}" style="${c === 'LATE' ? 'color:var(--bad);font-weight:600' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : empty('No data for these filters.'), { list: true, actions: `<span class="tiny muted">${r.rows.length} rows</span>` })}`;
  return shell(body, 'Reports & MIS', isMgmt() ? 'Whole office' : 'You and your team');
}

/* ═════════════ Settings ═════════════ */
function vSettings() {
  const C = cfg(), tab = ui('sTab', 'general');
  const tabs = [['general', 'General'], ['calendar', 'Shift & holidays'], ['leave', 'Leave policy'], ['depts', 'Departments'], ['ann', 'Announcements'], ['mail', 'Email alerts'], ...(S.me.role === 'ADMIN' ? [['access', 'Access']] : [])];
  let body = `<div class="tabs">${tabs.map(([k, l]) => `<button class="tab" aria-selected="${tab === k}" data-a="ui" data-k="sTab" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (tab === 'access' && S.me.role === 'ADMIN') body += accessCard();
  if (tab === 'mail') body += mailCard();
  if (tab === 'general') body += card('General', `<form data-f="cfg-general" class="fgrid">
    <label class="f">Company name<input class="i" id="s-company" name="company" value="${esc(C.company)}"></label>
    <label class="f">Attendance source<select class="i" id="s-src" name="attSource">${opts([['web', 'Web check-in in this app'], ['device', 'Biometric machine report (imported)']], C.attSource)}</select></label>
    <label class="f">Approval response time (hours)<input class="i" id="s-sla" name="slaHours" type="number" min="1" value="${C.slaHours}"></label>
    <label class="f">Add HR approval to leave longer than (days)<input class="i" id="s-hrl" name="hrLeaveAbove" type="number" min="0" step="0.5" value="${C.hrLeaveAbove}"></label>
    <label class="f">Expenses above this go to the Director (₹)<input class="i" id="s-dir" name="directorExpenseAbove" type="number" min="0" value="${C.directorExpenseAbove}"></label>
    <label class="check full"><input type="checkbox" id="s-web" name="webPunch" ${C.webPunch ? 'checked' : ''}> Allow check-in / check-out from the app</label>
    <label class="f">Location on WFH / official-duty days<select class="i" id="s-wloc" name="wfhLoc">${opts([['required', 'Required at check-in and check-out'], ['optional', 'Asked, but can be skipped'], ['off', 'Not asked']], C.wfhLoc || 'required')}</select></label>
    <label class="f">Ask to re-share location every (hours, 0 = never)<input class="i" id="s-loch" name="locEveryH" type="number" min="0" max="12" value="${C.locEveryH ?? 3}"></label>
    <label class="f">Live location sharing — update every (minutes)<input class="i" id="s-live" name="liveEveryMin" type="number" min="2" max="60" value="${C.liveEveryMin ?? 10}"></label>
    <div class="full"><button class="btn pri" type="submit">Save</button></div></form>
    <p class="tiny muted">Approval paths: leave → reporting manager (+ HR above the day limit); attendance correction → manager → HR; WFH/OD and overtime → manager; deadline extension → task assigner; task review → reviewer; expense → manager → Accounts head (+ Director above the limit); purchase → manager → Director; documents, HR help and employee changes → HR. Nobody approves their own request.</p>`);
  if (tab === 'calendar') body += `<div class="grid g2">${card('Shift', `<form data-f="cfg-shift" class="fgrid">
    <label class="f">Start<input class="i" id="s-st" type="time" name="start" value="${C.shift.start}"></label><label class="f">End<input class="i" id="s-en" type="time" name="end" value="${C.shift.end}"></label>
    <label class="f">Grace (minutes)<input class="i" id="s-gr" type="number" name="grace" value="${C.shift.grace}"></label><label class="f">Half day below (minutes worked)<input class="i" id="s-hd" type="number" name="halfMin" value="${C.shift.halfMin}"></label>
    <div class="full row">Weekly off: ${DAYS.map((d, i) => `<label class="check"><input type="checkbox" id="s-wo${i}" name="wo" value="${i}" ${C.weeklyOff.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}<label class="check"><input type="checkbox" id="s-2s" name="secondSat" ${C.secondSat ? 'checked' : ''}>2nd Saturday</label></div>
    <div class="full"><button class="btn pri" type="submit">Save shift</button></div></form>`)}
    ${card('Holidays', `<ul class="list">${C.holidays.slice().sort((a, b) => a.date.localeCompare(b.date)).map((h) => `<li><span class="grow">${fmtD(h.date)} — ${esc(h.name)} ${h.optional ? '<span class="pill">optional</span>' : ''}</span><button class="btn sm ghost" data-a="hol-del" data-d="${h.date}">Remove</button></li>`).join('') || '<li class="muted">No holidays yet.</li>'}</ul>
      <form data-f="hol-add" class="row" style="padding:12px 16px;border-top:1px solid var(--line)"><input class="i" id="h-date" type="date" name="date" required style="width:auto"><input class="i" id="h-name" name="name" placeholder="Holiday name" required style="flex:1;min-width:140px"><label class="check small"><input type="checkbox" id="h-opt" name="optional"> Optional</label><button class="btn pri" type="submit">Add</button></form>`, { list: true })}</div>`;
  if (tab === 'leave') body += card('Leave types', `<form data-f="cfg-leave"><div class="tbl-wrap"><table class="t"><thead><tr><th>Code</th><th>Name</th><th class="num">Days / year</th><th>Monthly accrual</th><th>Half day</th><th class="num">Max at once</th><th class="num">Document above (days)</th><th>Unpaid</th></tr></thead><tbody>
    ${[...C.leaveTypes, { code: '', name: '', quota: 0 }].map((l, i) => `<tr><td><input class="i" id="lt-c${i}" name="code" value="${esc(l.code)}" style="width:70px" placeholder="${i === C.leaveTypes.length ? 'New' : ''}"></td><td><input class="i" id="lt-n${i}" name="name" value="${esc(l.name)}"></td><td><input class="i" id="lt-q${i}" name="quota" type="number" step="0.5" value="${l.quota}" style="width:80px"></td>
    <td><input type="checkbox" id="lt-a${i}" name="accrual" value="${i}" ${l.accrual ? 'checked' : ''}></td><td><input type="checkbox" id="lt-h${i}" name="half" value="${i}" ${l.half !== false ? 'checked' : ''}></td><td><input class="i" id="lt-m${i}" name="maxDays" type="number" step="0.5" value="${l.maxDays ?? ''}" style="width:80px"></td><td><input class="i" id="lt-d${i}" name="docAbove" type="number" step="0.5" value="${l.docAbove ?? ''}" style="width:80px"></td><td><input type="checkbox" id="lt-u${i}" name="unpaid" value="${i}" ${l.unpaid ? 'checked' : ''}></td></tr>`).join('')}
    </tbody></table></div><div class="body row"><button class="btn pri" type="submit">Save leave policy</button><span class="tiny muted">Clear a code to remove that leave type. Individual balances can be adjusted on an employee’s profile.</span></div></form>`, { list: true });
  if (tab === 'depts') body += card('Departments', `<form data-f="cfg-depts"><div class="tbl-wrap"><table class="t"><thead><tr><th>Name</th><th>Code</th><th>Head</th></tr></thead><tbody>
    ${[...C.depts, { id: '', name: '', code: '', headId: '' }].map((d, i) => `<tr><td><input type="hidden" name="id" value="${esc(d.id)}"><input class="i" id="d-n${i}" name="name" value="${esc(d.name)}" placeholder="${d.id ? '' : 'New department'}"></td><td><input class="i" id="d-c${i}" name="code" value="${esc(d.code)}" style="width:90px"></td><td><select class="i" id="d-h${i}" name="headId">${peopleOpts(d.headId, '—')}</select></td></tr>`).join('')}
    </tbody></table></div><div class="body row"><button class="btn pri" type="submit">Save departments</button><span class="tiny muted">Clear a name to remove a department. Use code ACC for Accounts — expense claims route to its head.</span></div></form>`, { list: true });
  if (tab === 'ann') body += `<div class="grid g2">${card('Post an announcement', `<form data-f="ann-add" class="fgrid"><label class="f full">Title<input class="i" id="a-t" name="title" required></label><label class="f full">Message<textarea class="i" id="a-b" name="body" rows="4" required></textarea></label><label class="f">Show until<input class="i" id="a-u" type="date" name="until"></label><label class="check"><input type="checkbox" id="a-n" name="notify" checked> Alert everyone</label><div class="full"><button class="btn pri" type="submit">Post</button></div></form>`)}
    ${card('Current', `<ul class="list">${(C.announcements || []).slice().reverse().map((a) => `<li><div class="grow"><b>${esc(a.title)}</b><div class="small muted">${esc(a.body)}</div></div><button class="btn sm ghost" data-a="ann-del" data-id="${a.id}">Remove</button></li>`).join('') || '<li class="muted">None.</li>'}</ul>`, { list: true })}</div>`;
  return shell(body, 'Settings', 'Policies used across attendance, leave and approvals');
}

/* ═════════════ Setup / gate screens ═════════════ */
function vSetup() {
  if (S.revoked) return `<div class="splash"><h1>Access changed</h1><p class="muted">Your access to this app changed. Reload the page.</p></div>`;
  if (!S.uid) return `<div class="splash"><div class="brand"><div class="mark">OH</div><div><b>OfficeHub</b><small>Office management</small></div></div><h1>Sign in to Claude to use OfficeHub</h1><p class="muted">Open this app from your Claude account so it knows who you are.</p></div>`;
  const anyAdmin = S.emps.some((e) => e.userId && ['ADMIN', 'HR'].includes(e.role));
  if (S.owner && !anyAdmin) return `<div class="splash"><div class="brand"><div class="mark">OH</div><div><b>OfficeHub</b><small>First-time setup</small></div></div>
    <h1>Set up your office</h1><p class="muted">You own this app. Create your administrator profile — then add departments and employees. On the People page you link each employee to their Claude login, so they’re recognised when they open the app.</p>
    <form data-f="setup" class="card body fgrid" style="padding:16px">
      <label class="f full">Company<input class="i" id="su-co" name="company" value="${esc(cfg().company)}" required></label>
      <label class="f">Your name<input class="i" id="su-n" name="name" value="${esc(S.myName)}" required></label>
      <label class="f">Employee code<input class="i" id="su-c" name="code" value="AMR001" required></label>
      <label class="f">Work email<input class="i" id="su-e" name="email" type="email" value="${esc(S.myEmail || '')}"></label>
      <label class="f">Designation<input class="i" id="su-d" name="designation" placeholder="e.g. Global Marketing Manager"></label>
      <label class="f full">Departments (comma separated, CODE:Name)<input class="i" id="su-dp" name="depts" value="MGT:Management, HR:Human Resources, ACC:Accounts & Finance, MKT:Marketing, SAL:Sales, OPS:Operations, QA:Quality & Regulatory"></label>
      <div class="full"><button class="btn pri" type="submit">Create office</button></div></form></div>`;
  return vSignup();
  return `<div class="splash"><div class="brand"><div class="mark">OH</div><div><b>OfficeHub</b><small>${esc(cfg().company)}</small></div></div><h1>You’re not set up yet</h1>
    <p>Ask HR or the administrator to add you on the People page and link your Claude login${S.myName ? ` (<b>${esc(S.myName)}</b>)` : ''}. Once they do, reload this page and you’ll be signed in automatically.</p>
    ${S.readonly ? '<p class="muted small">Also ask them to share the app with you as a Contributor, so you can check in and submit requests.</p>' : ''}</div>`;
}
</script>
