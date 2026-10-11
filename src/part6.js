<script>
/* ═════════════ Modals ═════════════ */
let M = null;
function openModal(render) { M = { render }; drawModal(true); }
function closeModal() { M = null; $('#modal').innerHTML = ''; }
function drawModal(fresh) {
  const root = $('#modal');
  if (!M) { root.innerHTML = ''; return; }
  const inner = M.render();
  if (inner == null) { closeModal(); return; }
  const html = `<div class="overlay" data-bg="1"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`;
  fresh ? (root.innerHTML = html) : morph(root, html);
  if (fresh) setTimeout(() => root.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 30);
}
const mhead = (title, sub = '') => `<header><div><h2>${title}</h2>${sub ? `<div class="small muted">${sub}</div>` : ''}</div><button class="btn ghost sm" data-a="close" aria-label="Close">✕</button></header>`;
function confirmBox(title, text, onYes, { input = null, danger = true } = {}) {
  openModal(() => `${mhead(esc(title))}<form data-f="confirm"><div class="body"><p>${esc(text)}</p>${input ? `<label class="f">${esc(input)}<input class="i" id="cf-in" name="v" required></label>` : ''}</div><footer><button type="button" class="btn" data-a="close">Back</button><button class="btn ${danger ? 'danger' : 'pri'}" type="submit">Confirm</button></footer></form>`);
  M.onConfirm = onYes;
}

/* Task form */
function taskForm(t) {
  const T = today(), isNew = !t;
  if (M && !M.asg) M.asg = S.ui.preAssignee ? [S.ui.preAssignee] : [];
  const load = (id) => { const o = S.tasks.filter((x) => x.assigneeId === id && openTask(x)); return [o.length, o.filter((x) => overdue(x)).length]; };
  const others = S.tasks.filter((x) => openTask(x) && x.id !== t?.id).sort((a, b) => b.code.localeCompare(a.code));
  return `${mhead(isNew ? 'New task' : `Edit ${esc(t.code)}`)}<form data-f="task" data-id="${t?.id || ''}"><div class="body fgrid">
    <label class="f full">Title<input class="i" id="tf-title" name="title" required value="${esc(t?.title || '')}" placeholder="e.g. Reconcile HDFC current account — September"></label>
    <label class="f full">Details<textarea class="i" id="tf-desc" name="desc" rows="3">${esc(t?.desc || '')}</textarea></label>
    ${isNew ? `<div class="full"><label class="f">Assign to <span class="muted">(pick one or several — each person gets their own copy of the task)</span>
        <select class="i" id="tf-add" data-c="taskAdd">${peopleGroups(null, { blank: '+ Add a person…', exclude: M.asg, load: true })}</select></label>
      <div class="row" style="margin-top:6px;gap:6px">${M.asg.map((id) => { const [o, od] = load(id); return `<span class="chip"><input type="hidden" name="assignees" value="${id}">${esc(nameOf(id))}${id === S.me.id ? ' (me)' : ''} <span class="tiny" style="${o >= 6 ? 'color:var(--warn);font-weight:600' : 'color:var(--muted)'}">${o} open${od ? ` · <span style="color:var(--bad)">${od} overdue</span>` : ''}</span><button type="button" class="chip-x" data-a="tf-rm" data-id="${id}" aria-label="Remove ${esc(nameOf(id))}">✕</button></span>`; }).join('') || '<span class="small muted">Nobody chosen yet.</span>'}
        ${myTeam().length ? '<button type="button" class="btn sm ghost" data-a="tf-team">+ My whole team</button>' : ''}${!M.asg.includes(S.me.id) ? '<button type="button" class="btn sm ghost" data-a="tf-me">+ Me</button>' : ''}</div></div>`
    : `<label class="f">Assignee<select class="i" id="tf-asg" name="assignee">${peopleGroups(t.assigneeId)}</select></label>`}
    <label class="f">Priority<select class="i" id="tf-pr" name="priority">${opts(Object.entries(PRIO).map(([k, v]) => [k, v[0]]), t?.priority || 'MEDIUM')}</select></label>
    <label class="f">Start<input class="i" id="tf-start" type="date" name="start" value="${t?.start || T}"></label>
    <label class="f">Due<input class="i" id="tf-due" type="date" name="due" required value="${t?.due || addDays(T, 1)}"></label>
    <label class="f">Project / process<input class="i" id="tf-proj" name="project" value="${esc(t?.project || '')}" list="projects"></label>
    <label class="f">Department<select class="i" id="tf-dept" name="deptId">${deptOpts(t?.deptId, 'Assignee’s department')}</select></label>
    <label class="f">Depends on<select class="i" id="tf-dep" name="dependsOn">${opts(others.map((x) => [x.id, `${x.code} · ${x.title.slice(0, 40)}`]), t?.dependsOn, 'Nothing')}</select></label>
    <label class="f">Reviewer<select class="i" id="tf-rev" name="reviewerId">${peopleGroups(t?.reviewerId || S.me.id)}</select></label>
    <label class="check full"><input type="checkbox" id="tf-nr" name="needsReview" ${t ? (t.needsReview ? 'checked' : '') : 'checked'}> Reviewer must accept the work before it counts as completed</label>
    <label class="f full">Checklist / milestones (one per line)<textarea class="i" id="tf-cl" name="checklist" rows="3">${esc((t?.checklist || []).map((c) => c.t).join('\n'))}</textarea></label>
    <label class="f full">Completion criteria<input class="i" id="tf-cc" name="criteria" value="${esc(t?.criteria || '')}" placeholder="How will we know it’s done?"></label>
    <label class="f full">Links to files (Drive, SharePoint, email) — one per line<textarea class="i" id="tf-links" name="links" rows="2">${esc(t?.links || '')}</textarea></label>
    ${isNew ? '<label class="check full"><input type="checkbox" id="tf-dup" name="allowDup"> Create even if a similar open task exists</label>' : ''}
    <datalist id="projects">${[...new Set(S.tasks.map((x) => x.project).filter(Boolean))].map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
  </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri" type="submit">${isNew ? 'Create task' : 'Save changes'}</button></footer></form>`;
}
function taskDetail(id) {
  const t = S.tasks.find((x) => x.id === id);
  if (!t) return `${mhead('Opening…')}<div class="body muted">Loading the latest data…</div>`;
  const mine = t.assigneeId === S.me.id, mgr = canManageTask(t), st = effStatus(t), closed = !openTask(t);
  const rev = S.reqs.find((r) => r.type === 'REVIEW' && r.data.taskId === t.id && r.status === 'PENDING');
  const iReview = rev && curStep(rev)?.by === S.me.id;
  const dep = t.dependsOn && S.tasks.find((x) => x.id === t.dependsOn);
  const subs = S.tasks.filter((x) => x.parentId === t.id);
  const cl = t.checklist || [];
  return `${mhead(esc(t.title), `${esc(t.code)} · ${pill(TSTAT, st)} ${pill(PRIO, t.priority)} ${overdue(t) ? '<span class="pill t-bad">Overdue</span>' : ''}`)}
  <div class="body grid" style="gap:16px">
    ${iReview ? `<form data-f="review" data-id="${rev.id}" class="alert t-warn" style="display:block;cursor:default"><b>${esc(nameOf(t.assigneeId))} submitted this for your review.</b>${rev.data.note ? ` “${esc(rev.data.note)}”` : ''}<div class="row" style="margin-top:8px"><input class="i" id="rv-c" name="comment" placeholder="Comment (needed to request changes)" style="flex:1;min-width:180px"><button class="btn pri" name="d" value="APPROVED">Accept & complete</button><button class="btn" name="d" value="RETURNED">Request changes</button></div></form>` : ''}
    ${t.desc ? `<p style="white-space:pre-wrap;margin:0">${esc(t.desc)}</p>` : ''}
    <div class="kv"><div><span>Assignee</span><b>${esc(nameOf(t.assigneeId))}</b></div><div><span>Assigned by</span><span>${esc(nameOf(t.assignerId))}</span></div>
      <div><span>Start</span><span>${fmtD(t.start)}</span></div><div><span>Due</span><b style="${overdue(t) ? 'color:var(--bad)' : ''}">${fmtD(t.due)}</b></div>
      <div><span>Reviewer</span><span>${t.needsReview ? esc(nameOf(t.reviewerId)) : 'No review'}</span></div><div><span>Project</span><span>${esc(t.project || '—')}</span></div>
      <div><span>Department</span><span>${esc(deptOf(t.deptId)?.name || '—')}</span></div><div><span>Hours logged</span><span>${t.hours || 0}</span></div>
      ${dep ? `<div><span>Depends on</span><a href="#" data-a="task" data-id="${dep.id}">${esc(dep.code)} (${esc(TSTAT[dep.status][0])})</a></div>` : ''}${t.criteria ? `<div><span>Done when</span><span>${esc(t.criteria)}</span></div>` : ''}</div>
    ${t.status === 'BLOCKED' ? `<div class="alert t-bad" style="cursor:default"><b>Blocked:</b> ${esc(t.blockedReason || '')}</div>` : ''}
    ${t.links ? `<div class="small">${t.links.split('\n').filter(Boolean).map((l) => /^https?:\/\//.test(l.trim()) ? `<a href="${esc(l.trim())}" target="_blank" rel="noopener" class="trunc" style="display:block">${esc(l.trim())}</a>` : `<div>${esc(l)}</div>`).join('')}</div>` : ''}
    <div><h3>Checklist ${cl.length ? `(${cl.filter((c) => c.d).length}/${cl.length})` : ''}</h3>
      ${cl.map((c, i) => `<label class="check" style="margin-top:6px"><input type="checkbox" id="cl-${t.id}-${i}" data-a="cl-toggle" data-id="${t.id}" data-i="${i}" ${c.d ? 'checked' : ''} ${(mine || mgr) && !closed ? '' : 'disabled'}><span style="${c.d ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(c.t)}</span></label>`).join('') || '<div class="small muted">No checklist.</div>'}
      ${(mine || mgr) && !closed ? `<form data-f="cl-add" data-id="${t.id}" class="row" style="margin-top:8px;flex-wrap:nowrap"><input class="i" id="cl-new" name="t" placeholder="Add an item"><button class="btn sm">Add</button></form>` : ''}</div>
    ${subs.length ? `<div><h3>Subtasks</h3>${subs.map((s) => `<div class="row small" style="margin-top:4px"><a href="#" data-a="task" data-id="${s.id}">${esc(s.code)} ${esc(s.title)}</a>${pill(TSTAT, s.status)}</div>`).join('')}</div>` : ''}
    ${(mine || mgr) && !S.readonly ? `<div><h3>Update</h3><div class="row" style="margin-top:8px">
      ${!closed && ['TODO', 'UPCOMING', 'BLOCKED'].includes(st) ? `<button class="btn pri" data-a="t-status" data-id="${t.id}" data-to="IN_PROGRESS">${st === 'BLOCKED' ? 'Unblock & resume' : 'Start work'}</button>` : ''}
      ${!closed && ['TODO', 'IN_PROGRESS'].includes(st) ? `<button class="btn pri" data-a="t-status" data-id="${t.id}" data-to="${t.needsReview && t.reviewerId !== S.me.id ? 'IN_REVIEW' : 'DONE'}">${t.needsReview && t.reviewerId !== S.me.id ? 'Submit for review' : 'Mark complete'}</button>` : ''}
      ${!closed && st !== 'BLOCKED' && st !== 'IN_REVIEW' ? `<button class="btn" data-a="t-block" data-id="${t.id}">Mark blocked</button>` : ''}
      ${mine && !closed ? `<button class="btn" data-a="t-extend" data-id="${t.id}">Ask for more time</button><button class="btn" data-a="t-hours" data-id="${t.id}">Log hours</button>` : ''}
      ${mgr && !closed ? `<button class="btn" data-a="t-edit" data-id="${t.id}">Edit / reassign</button><button class="btn" data-a="t-sub" data-id="${t.id}">Add subtask</button><button class="btn danger" data-a="t-cancel" data-id="${t.id}">Cancel task</button>` : ''}
      ${mgr && closed ? `<button class="btn" data-a="t-status" data-id="${t.id}" data-to="IN_PROGRESS">Reopen</button>` : ''}
    </div>${rev && !iReview ? `<p class="tiny muted">Waiting for review by ${esc(nameOf(curStep(rev)?.by))} (${esc(rev.code)}).</p>` : ''}</div>` : ''}
    <div><h3>Discussion</h3>
      ${(t.comments || []).map((c) => `<div style="margin-top:10px">${person(c.by, fmtDT(c.at))}<div style="margin:4px 0 0 36px;white-space:pre-wrap">${esc(c.text).replace(/@([A-Za-z][\w.-]*)/g, '<b style="color:var(--accent)">@$1</b>')}</div></div>`).join('') || '<div class="small muted">No comments yet.</div>'}
      <form data-f="comment" data-id="${t.id}" class="row" style="margin-top:10px;flex-wrap:nowrap"><input class="i" id="cm-${t.id}" name="text" placeholder="Write an update — @Neha mentions a person, @ACC alerts a department head"><button class="btn">Post</button></form></div>
    <details><summary class="small muted" style="cursor:pointer">History (${(t.history || []).length})</summary>${(t.history || []).slice().reverse().map((h) => `<div class="tiny" style="margin-top:6px"><b>${esc(h.a)}</b> · ${esc(h.by ? nameOf(h.by) : 'System')} · ${fmtDT(h.at)}</div>`).join('')}</details>
  </div>`;
}

/* Leave & requests */
function approverPick(def, after = '') {
  return `<label class="f full">Send for approval to<select class="i" id="rq-appr" name="approver">${peopleGroups(def, { exclude: [S.me.id] })}</select>
    <span class="tiny muted">Defaults to ${esc(nameOf(def))}. Choose anyone else if they should approve this instead.${after ? ' ' + after + '.' : ''}</span></label>`;
}
function leaveForm() {
  const bals = balances(S.me);
  return `${mhead('Apply for leave')}<form data-f="leave"><div class="body fgrid">
    <label class="f full">Leave type<select class="i" id="lf-lt" name="lt">${opts(bals.map((b) => [b.lt.code, `${b.lt.name}${b.lt.quota ? ` — ${b.avail} available` : ''}`]))}</select></label>
    <label class="f">From<input class="i" id="lf-from" type="date" name="from" required value="${addDays(today(), 1)}"></label>
    <label class="f">To<input class="i" id="lf-to" type="date" name="to"></label>
    <label class="check"><input type="checkbox" id="lf-half" name="half"> Half day</label>
    <label class="f"><select class="i" id="lf-sess" name="session">${opts([['First half', 'First half'], ['Second half', 'Second half']])}</select></label>
    <label class="f full">Reason<textarea class="i" id="lf-reason" name="reason" required rows="2"></textarea></label>
    <label class="f full">Supporting document link (needed for sick leave above the policy limit)<input class="i" id="lf-doc" name="doc" placeholder="Link to medical certificate in Drive / email"></label>
    ${approverPick(chainFor('LEAVE', S.me, { days: 1 })[0]?.by, `HR is added after the approver for leave longer than ${cfg().hrLeaveAbove ?? 2} day(s)`)}
    <p class="tiny muted full">Weekly offs and holidays inside the dates aren’t counted. Overlapping requests and insufficient balances are blocked.</p>
  </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri" type="submit">Submit for approval</button></footer></form>`;
}
function reqForm(type, extra = {}) {
  const T = today();
  if (!type) return `${mhead('Raise a request')}<div class="body grid g2">${[['WFH_OD', 'Work from home or official duty'], ['CORRECTION', 'Fix a missing or wrong punch'], ['OVERTIME', 'Extra hours worked'], ['EXPENSE', 'Claim travel or other expenses'], ['PURCHASE', 'Buy equipment or materials'], ['DOCUMENT', 'Salary certificate, experience letter…'], ['CHANGE', 'Change my details, assets'], ['HR_HELP', 'A question or problem for HR']].map(([k, d]) => `<button class="btn" style="justify-content:flex-start;white-space:normal;text-align:left" data-a="new-req" data-t="${k}"><span><b style="font-weight:600">${RTYPE[k]}</b><br><span class="small muted">${d}</span></span></button>`).join('')}
    <button class="btn" style="justify-content:flex-start" data-a="apply-leave"><span><b style="font-weight:600">Leave (CL/SL)</b><br><span class="small muted">Apply on the leave form</span></span></button></div>`;
  const f = {
    CORRECTION: `<label class="f">Date<input class="i" id="rq-date" type="date" name="date" required max="${T}" value="${extra.date || addDays(T, -1)}"></label><span></span><label class="f">Actual check-in<input class="i" id="rq-in" type="time" name="inT"></label><label class="f">Actual check-out<input class="i" id="rq-out" type="time" name="outT"></label>`,
    WFH_OD: `<label class="f">Type<select class="i" id="rq-kind" name="kind">${opts([['WFH', 'Work from home'], ['OD', 'Official duty / travel']])}</select></label><label class="f">Location (for official duty)<input class="i" id="rq-loc" name="location"></label><label class="f">From<input class="i" id="rq-from" type="date" name="from" required value="${T}"></label><label class="f">To<input class="i" id="rq-to" type="date" name="to"></label>`,
    OVERTIME: `<label class="f">Date<input class="i" id="rq-date" type="date" name="date" required max="${T}"></label><label class="f">Hours<input class="i" id="rq-h" type="number" step="0.5" min="0.5" name="hours" required></label>`,
    EXPENSE: `<label class="f">Amount (₹)<input class="i" id="rq-amt" type="number" min="1" step="0.01" name="amount" required></label><label class="f">Category<select class="i" id="rq-cat" name="category">${opts(['Travel', 'Local conveyance', 'Food & stay', 'Client meeting', 'Office supplies', 'Other'].map((x) => [x, x]))}</select></label><label class="f">Bill date<input class="i" id="rq-bd" type="date" name="billDate"></label><label class="f">Bills link<input class="i" id="rq-bl" name="link" placeholder="Drive folder with bills"></label>`,
    PURCHASE: `<label class="f">Estimated amount (₹)<input class="i" id="rq-amt" type="number" min="1" name="amount" required></label><label class="f">Vendor<input class="i" id="rq-ven" name="vendor"></label>`,
    DOCUMENT: `<label class="f">Document<select class="i" id="rq-doc" name="document">${opts(['Salary certificate', 'Experience letter', 'Employment verification', 'Address proof letter', 'Form 16 copy', 'Other'].map((x) => [x, x]))}</select></label><label class="f">Purpose<input class="i" id="rq-pur" name="purpose"></label>`,
    CHANGE: '', HR_HELP: '',
  }[type] || '';
  const ch = chainFor(type, S.me, { amount: 1, days: 1 });
  const chain = ch.slice(1).map((s) => `${s.label} (${nameOf(s.by)})`).join(' → ');
  return `${mhead(esc(RTYPE[type]))}<form data-f="req" data-t="${type}"><div class="body fgrid">
    ${['CHANGE', 'HR_HELP', 'PURCHASE', 'EXPENSE', 'DOCUMENT'].includes(type) ? `<label class="f full">Subject<input class="i" id="rq-title" name="title" required></label>` : ''}
    ${f}<label class="f full">${type === 'CORRECTION' ? 'Reason' : 'Details'}<textarea class="i" id="rq-det" name="reason" rows="3" ${['CORRECTION', 'WFH_OD', 'HR_HELP', 'CHANGE'].includes(type) ? 'required' : ''}></textarea></label>
    ${approverPick(ch[0]?.by, `${chain ? 'Then: ' + esc(chain) : ''}${type === 'EXPENSE' ? ` (+ Director above ${money(cfg().directorExpenseAbove)})` : ''}`)}
  </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri" type="submit">Submit</button></footer></form>`;
}
const DLABEL = { from: 'From', to: 'To', lt: 'Leave type', days: 'Days', half: 'Half day', session: 'Session', reason: 'Reason', doc: 'Document link', date: 'Date', inT: 'Check-in', outT: 'Check-out', kind: 'Type', location: 'Location', hours: 'Hours', category: 'Category', billDate: 'Bill date', link: 'Link', vendor: 'Vendor', document: 'Document', purpose: 'Purpose', newDue: 'New due date', oldDue: 'Current due date', note: 'Note', resubmitNote: 'Resubmission note', warnings: 'Flags' };
function reqDetail(id) {
  const r = S.reqs.find((x) => x.id === id);
  if (!r) return `${mhead('Opening…')}<div class="body muted">Loading the latest data…</div>`;
  const s = curStep(r), canDecide = r.status === 'PENDING' && s?.by === S.me.id, isReq = r.empId === S.me.id || r.raisedBy === S.me.id;
  let ctx = '';
  if (r.type === 'LEAVE') {
    const e = empById(r.empId), bals = e ? balances(e, +r.data.from.slice(0, 4)) : [];
    const mates = e ? active().filter((x) => x.id !== e.id && x.managerId && x.managerId === e.managerId) : [];
    const away = mates.filter((m) => reqsOf('LEAVE', m.id).some((x) => ['APPROVED', 'PENDING'].includes(x.status) && !x.data.cancelled && x.data.from <= r.data.to && x.data.to >= r.data.from));
    ctx = `<div class="card body" style="background:var(--sunk);border:0"><h3>Leave context</h3><div class="row small" style="margin-top:6px">${bals.map((b) => `<span>${esc(b.lt.code)}: <b>${b.lt.quota ? b.avail : '—'}</b> left</span>`).join(' · ')}</div><div class="small" style="margin-top:4px">Team members away then: ${away.length ? esc(away.map((a) => a.name).join(', ')) : 'none'}</div>${r.data.cancelOf ? '<div class="small" style="color:var(--warn);margin-top:4px">This asks to cancel leave that was already approved — approving restores the balance.</div>' : ''}</div>`;
  }
  if (r.type === 'CORRECTION') {
    const e = empById(r.empId), ds = dayStatus(e, r.data.date);
    ctx = `<div class="card body" style="background:var(--sunk);border:0"><h3>Recorded on ${fmtD(r.data.date)}</h3><div class="small">${stPill(ds.code)} In ${hm(ds.inT)} · Out ${hm(ds.outT)} · punches: ${(ds.punches || []).map((p) => `${hm(p.t)} (${p.s})`).join(', ') || 'none'}</div><div class="tiny muted">Approving adds correction punches; the original punches stay.</div></div>`;
  }
  if (isClaim(r)) ctx = claimCtx(r, canDecide);
  return `${mhead(esc(r.title), `${esc(r.code)} · ${RTYPE[r.type]} · ${pill(RSTAT, r.status)} ${pastSLA(r) ? '<span class="pill t-bad">Past response time</span>' : ''}`)}
  <div class="body grid" style="gap:14px">
    <div>${person(r.empId, `${empById(r.empId)?.designation || ''} · raised ${fmtDT(r.created)}`)}</div>
    ${isClaim(r) ? '' : `<div class="kv">${r.amount ? `<div><span>Amount</span><b>${money(r.amount)}</b></div>` : ''}${Object.entries(r.data || {}).filter(([k, v]) => DLABEL[k] && v !== '' && v != null && v !== false).map(([k, v]) => `<div><span>${DLABEL[k]}</span><span>${/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtD(v) : v === true ? 'Yes' : /^https?:/.test(String(v)) ? `<a href="${esc(v)}" target="_blank" rel="noopener">Open link</a>` : esc(v)}</span></div>`).join('')}</div>`}
    ${ctx}
    <div><h3 style="margin-bottom:8px">Approval chain</h3><ol class="timeline"><li class="APPROVED"><b>Submitted</b> by ${esc(nameOf(r.raisedBy || r.empId))} <span class="tiny muted">${fmtDT(r.created)}</span></li>
      ${r.steps.map((x) => `<li class="${x.status}"><b>${esc(x.label)}</b> — ${esc(nameOf(x.by))} ${pill({ WAITING: ['Not reached', ''], SKIPPED: ['Skipped', ''], ...RSTAT }, x.status)}${x.comment ? `<div class="small" style="font-style:italic">“${esc(x.comment)}”</div>` : ''}<div class="tiny muted">${x.done ? 'Decided ' + fmtDT(x.done) : x.at ? 'Waiting since ' + fmtDT(x.at) : ''}${x.escalated ? ' · escalated' : ''}</div></li>`).join('')}</ol></div>
    ${canDecide && !S.readonly ? `<form data-f="decide" data-id="${r.id}" class="grid" style="gap:8px">${isClaim(r) ? claimApprField(r) : ''}<textarea class="i" id="dc-${r.id}" name="comment" rows="2" placeholder="Comment (required to reject or send back)"></textarea><div class="row"><button class="btn pri" name="d" value="APPROVED">Approve</button><button class="btn" name="d" value="RETURNED">Send back</button><button class="btn danger" name="d" value="REJECTED">Reject</button></div></form>` : ''}
    ${isReq && r.status === 'RETURNED' ? `<form data-f="resubmit" data-id="${r.id}" class="row" style="flex-wrap:nowrap"><input class="i" id="rs-${r.id}" name="note" placeholder="What did you change or clarify?" required><button class="btn pri">Resubmit</button></form>` : ''}
    ${isReq && ['PENDING', 'RETURNED'].includes(r.status) ? `<div class="row">${pastSLA(r) && !s?.escalated ? `<button class="btn" data-a="req-escalate" data-id="${r.id}">Escalate to ${esc(nameOf(empById(s.by)?.managerId) || 'their manager')}</button>` : ''}<button class="btn danger" data-a="req-cancel" data-id="${r.id}">Cancel request</button></div>` : ''}
    ${r.data.taskId ? `<button class="btn" data-a="task" data-id="${r.data.taskId}">Open the task</button>` : ''}
  </div>`;
}

/* Department requests */
function dreqForm() {
  const T = today();
  return `${mhead('Request another department', 'e.g. Accounts asks Sales to confirm distributor balances by a date')}<form data-f="dreq"><div class="body fgrid">
    ${isMgmt() ? `<label class="f">From department<select class="i" id="dr-from" name="fromDept">${deptOpts(S.me.deptId)}</select></label>` : ''}
    <label class="f">To department<select class="i" id="dr-to" name="toDept" required>${deptOpts('', 'Choose…')}</select></label>
    <label class="f">Responsible person<select class="i" id="dr-own" name="ownerId">${peopleOpts('', 'Department head')}</select></label>
    <label class="f full">What do you need?<input class="i" id="dr-title" name="title" required></label>
    <label class="f full">Details<textarea class="i" id="dr-desc" name="desc" rows="3"></textarea></label>
    <label class="f">Needed by<input class="i" id="dr-due" type="date" name="due" value="${addDays(T, 2)}" required></label>
    <label class="f">Priority<select class="i" id="dr-pr" name="priority">${opts(Object.entries(PRIO).map(([k, v]) => [k, v[0]]), 'MEDIUM')}</select></label>
    <label class="f full">Links to files (Excel, email, Drive)<textarea class="i" id="dr-links" name="links" rows="2"></textarea></label>
  </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri" type="submit">Raise request</button></footer></form>`;
}
function dreqDetail(id) {
  const r = S.dreqs.find((x) => x.id === id);
  if (!r) return `${mhead('Opening…')}<div class="body muted">Loading the latest data…</div>`;
  const to = deptOf(r.toDept), from = deptOf(r.fromDept);
  const responder = r.ownerId === S.me.id || to?.headId === S.me.id || S.me.deptId === r.toDept || isMgmt();
  const requester = r.byId === S.me.id || from?.headId === S.me.id;
  const late = r.due < today() && !['RESOLVED', 'CLOSED'].includes(r.status);
  return `${mhead(esc(r.title), `${esc(r.code)} · ${esc(from?.name)} → ${esc(to?.name)} · ${pill(DRSTAT, r.status)} ${late ? '<span class="pill t-bad">Late</span>' : ''}`)}
  <div class="body grid" style="gap:14px">
    ${r.desc ? `<p style="white-space:pre-wrap;margin:0">${esc(r.desc)}</p>` : ''}
    <div class="kv"><div><span>Raised by</span><span>${esc(nameOf(r.byId))}</span></div><div><span>With now</span><b>${esc(nameOf(r.ownerId))}</b></div><div><span>Needed by</span><b style="${late ? 'color:var(--bad)' : ''}">${fmtD(r.due)}</b></div><div><span>Priority</span>${pill(PRIO, r.priority)}</div>${r.delay ? `<div><span>Delay reason</span><span>${esc(r.delay)}</span></div>` : ''}</div>
    ${r.links ? `<div class="small">${r.links.split('\n').filter(Boolean).map((l) => /^https?:\/\//.test(l.trim()) ? `<a href="${esc(l.trim())}" target="_blank" rel="noopener" class="trunc" style="display:block">${esc(l.trim())}</a>` : esc(l)).join('<br>')}</div>` : ''}
    ${responder && !['CLOSED'].includes(r.status) && !S.readonly ? `<form data-f="dr-status" data-id="${r.id}" class="row"><select class="i" id="drs-${r.id}" name="status" style="width:auto">${opts(Object.entries(DRSTAT).filter(([k]) => k !== 'CLOSED').map(([k, v]) => [k, v[0]]), r.status === 'OPEN' ? 'IN_PROGRESS' : r.status)}</select><input class="i" id="drn-${r.id}" name="note" placeholder="${late ? 'Reason for the delay (required)' : 'Note'}" style="flex:1;min-width:160px"><button class="btn pri">Update</button></form>
      <form data-f="dr-hand" data-id="${r.id}" class="row"><select class="i" id="drh-${r.id}" name="ownerId" style="width:auto">${peopleOpts('', 'Hand over to…', active().filter((e) => e.deptId === r.toDept).map((e) => e.id))}</select><button class="btn">Hand over</button></form>` : ''}
    ${requester && r.status === 'RESOLVED' ? `<form data-f="dr-confirm" data-id="${r.id}" class="alert t-ok" style="display:block;cursor:default"><b>Marked resolved. Is it done to your satisfaction?</b><div class="row" style="margin-top:8px"><input class="i" id="drc-${r.id}" name="note" placeholder="Comment" style="flex:1"><button class="btn pri" name="d" value="yes">Confirm & close</button><button class="btn" name="d" value="no">Not yet — reopen</button></div></form>` : ''}
    <div><h3>Conversation & handovers</h3>${(r.log || []).map((c) => `<div style="margin-top:10px">${person(c.by, fmtDT(c.at))}<div style="margin:4px 0 0 36px;white-space:pre-wrap;${c.kind !== 'comment' ? 'color:var(--muted)' : ''}">${esc(c.text)}</div></div>`).join('')}
      <form data-f="dr-comment" data-id="${r.id}" class="row" style="margin-top:10px;flex-wrap:nowrap"><input class="i" id="drm-${r.id}" name="text" placeholder="Reply or share information"><button class="btn">Post</button></form></div>
  </div>`;
}

/* Employees */
function empForm(id) {
  const e = id ? empById(id) : null, hr = isHR();
  if (id && !e) return null;
  const T = today(), bals = e ? balances(e) : [];
  const ro = !hr ? 'disabled' : '';
  return `${mhead(e ? esc(e.name) : 'Add employee', e ? `${esc(e.code)} · ${esc(e.designation || '')}` : 'Link their Claude login below so they’re recognised when they open OfficeHub')}
  <form data-f="emp" data-id="${e?.id || ''}"><div class="body fgrid">
    <label class="f">Full name<input class="i" id="ef-n" name="name" required value="${esc(e?.name || '')}" ${ro}></label>
    <label class="f">Employee code<input class="i" id="ef-c" name="code" required value="${esc(e?.code || '')}" ${ro}></label>
    <label class="f">Work email<input class="i" id="ef-e" type="email" name="email" value="${esc(e?.email || '')}" ${ro}></label>
    <label class="f">Phone<input class="i" id="ef-p" name="phone" value="${esc(e?.phone || '')}" ${ro}></label>
    <label class="f">Designation<input class="i" id="ef-d" name="designation" value="${esc(e?.designation || '')}" ${ro}></label>
    <label class="f">Department<select class="i" id="ef-dp" name="deptId" ${ro}>${deptOpts(e?.deptId, '—')}</select></label>
    <label class="f">Reports to<select class="i" id="ef-m" name="managerId" ${ro}>${peopleOpts(e?.managerId, '—', active().filter((x) => x.id !== e?.id).map((x) => x.id))}</select></label>
    <label class="f">Role in this app<select class="i" id="ef-r" name="role" ${ro}>${opts([['EMPLOYEE', 'Employee'], ['MANAGER', 'Manager'], ['HR', 'HR'], ['DIRECTOR', 'Director'], ['ADMIN', 'Administrator']], e?.role || 'EMPLOYEE')}</select></label>
    <label class="f">Biometric ID (on the machine)<input class="i" id="ef-b" name="bioId" value="${esc(e?.bioId || '')}" ${ro}></label>
    <label class="f">Status<select class="i" id="ef-s" name="status" ${ro}>${opts([['ACTIVE', 'Active'], ['PROBATION', 'Probation'], ['ON_NOTICE', 'On notice'], ['EXITED', 'Exited']], e?.status || 'ACTIVE')}</select></label>
    <label class="f">Joining date<input class="i" id="ef-j" type="date" name="joining" value="${e?.joining || ''}" ${ro}></label>
    <label class="f">Probation ends<input class="i" id="ef-pe" type="date" name="probEnd" value="${e?.probEnd || ''}" ${ro}></label>
    <label class="f">Date of birth<input class="i" id="ef-dob" type="date" name="dob" value="${e?.dob || ''}" ${ro}></label>
    <label class="f">Last working day (exit)<input class="i" id="ef-x" type="date" name="exitDate" value="${e?.exitDate || ''}" ${ro}></label>
    <label class="f full">Exit clearance / handover notes<input class="i" id="ef-cl" name="clearance" value="${esc(e?.clearance || '')}" placeholder="Handover done; laptop returned; accounts cleared…" ${ro}></label>
    ${canSalary() ? (ensurePay(), PAY.err ? '<p class="tiny muted full">Salary is protected — you need Editor access to the app to see or change it.</p>' : `<label class="f">Monthly salary (₹, gross)<input class="i" id="ef-sal" name="salary" type="number" min="0" step="100" value="${e ? (PAY.map[e.id]?.monthly ?? '') : ''}" placeholder="e.g. 35000"></label><span class="tiny muted" style="align-self:end">Visible only to HR and administrators.</span>`) : ''}
    <label class="f full">Assets issued<input class="i" id="ef-as" name="assets" value="${esc(e?.assets || '')}" placeholder="Laptop Dell 5440 (SN…), SIM, ID card" ${ro}></label>
    ${hr ? `<div class="full ppl"><div class="small muted" style="margin-bottom:4px">Claude login: ${e?.userId ? '<span class="pill t-ok">Linked</span>' : '<span class="pill">Not linked</span>'} — search by name to link</div>
      <input class="i" id="ef-find" data-search="people" placeholder="Search your organisation by name or email" autocomplete="off"><input type="hidden" id="ef-uid" name="userId" value="${esc(S.ui.pickUid ?? e?.userId ?? '')}"><div class="menu" id="ef-menu" hidden></div></div>` : ''}
  </div>
  ${e ? `<div class="body" style="border-top:1px solid var(--line)"><h3>Leave balances ${T.slice(0, 4)}</h3><div class="row small" style="margin-top:6px">${bals.map((b) => `<span>${esc(b.lt.code)} <b>${b.lt.quota ? b.avail : '—'}</b> left (${b.used} used)</span>`).join(' · ')}</div>
    ${hr ? `<div class="row" style="margin-top:8px"><select class="i" id="ef-adj-lt" style="width:auto">${opts(cfg().leaveTypes.map((l) => [l.code, l.code]))}</select><input class="i" id="ef-adj-v" type="number" step="0.5" placeholder="+/- days" style="width:110px"><input class="i" id="ef-adj-r" placeholder="Reason (kept in audit log)" style="flex:1;min-width:140px"><button type="button" class="btn" data-a="leave-adj" data-id="${e.id}">Adjust</button></div>` : ''}
    ${(e.history || []).length ? `<h3 style="margin-top:12px">History</h3>${e.history.slice().reverse().map((h) => `<div class="tiny" style="margin-top:4px"><b>${esc(h.kind)}</b> ${fmtD(h.date)} — ${esc(h.from || '—')} → ${esc(h.to || '—')}</div>`).join('')}` : ''}</div>` : ''}
  <footer>${e ? `<button type="button" class="btn" data-a="new-task" data-assignee="${e.id}">Assign a task</button>${e.id !== S.me.id ? `<button type="button" class="btn" data-a="dm" data-id="${e.id}">Message</button>` : ''}${hr && e.userId && e.id !== S.me.id ? `<button type="button" class="btn danger" data-a="acct-reset" data-id="${e.id}">Reset password</button>` : ''}` : ''}<span style="flex:1"></span><button type="button" class="btn" data-a="close">Close</button>${hr ? `<button class="btn pri" type="submit">${e ? 'Save' : 'Add employee'}</button>` : ''}</footer></form>`;
}

/* Templates & notifications */
function templatesModal() {
  const list = S.tpls.filter((t) => isMgmt() || t.createdBy === S.me.id || canSee(t.assigneeId));
  return `${mhead('Recurring tasks', 'Created automatically on their day when anyone opens OfficeHub')}<div class="body grid" style="gap:14px">
    ${list.length ? `<ul class="list card">${list.map((t) => `<li><div class="grow"><b style="font-weight:600">${esc(t.title)}</b><div class="tiny muted">${esc(nameOf(t.assigneeId))} · ${t.freq === 'DAILY' ? 'Every working day' : t.freq === 'WEEKLY' ? 'Every ' + DAYS[+t.dow] : 'Monthly on day ' + t.dom} · last created ${fmtD(t.lastGen)}</div></div>${pill(PRIO, t.priority)}<button class="btn sm" data-a="tpl-toggle" data-id="${t.id}">${t.active === false ? 'Resume' : 'Pause'}</button><button class="btn sm ghost" data-a="tpl-del" data-id="${t.id}">Delete</button></li>`).join('')}</ul>` : empty('No recurring tasks yet.')}
    <form data-f="tpl" class="card body fgrid"><h3 class="full">New recurring task</h3>
      <label class="f full">Title<input class="i" id="tp-t" name="title" required placeholder="e.g. Daily bank & cash book update"></label>
      <label class="f">Assignee<select class="i" id="tp-a" name="assigneeId">${peopleOpts(S.me.id, null, isMgmt() ? null : [S.me.id, ...myTeam()])}</select></label>
      <label class="f">Priority<select class="i" id="tp-p" name="priority">${opts(Object.entries(PRIO).map(([k, v]) => [k, v[0]]), 'MEDIUM')}</select></label>
      <label class="f">Repeats<select class="i" id="tp-f" name="freq">${opts([['DAILY', 'Every working day'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly']])}</select></label>
      <label class="f">Weekly on<select class="i" id="tp-d" name="dow">${opts(DAYS.map((d, i) => [i, d]), 1)}</select></label>
      <label class="f">Monthly on day<input class="i" id="tp-m" type="number" min="1" max="28" name="dom" value="1"></label>
      <label class="f">Due after (days)<input class="i" id="tp-due" type="number" min="0" name="dueIn" value="0"></label>
      <label class="f full">Checklist (one per line)<textarea class="i" id="tp-cl" name="checklist" rows="2"></textarea></label>
      <label class="check full"><input type="checkbox" id="tp-r" name="needsReview"> I review it before it counts as done</label>
      <div class="full"><button class="btn pri" type="submit">Add recurring task</button></div></form></div>`;
}
function ntfModal() {
  const list = S.ntf.slice(0, 80);
  return `${mhead('Alerts')}<div class="body" style="padding:0">${list.length ? `<ul class="list">${list.map((n) => `<li data-a="ntf-open" data-id="${n.id}" style="cursor:pointer;${n.read ? 'opacity:.6' : ''}"><div class="grow"><div style="${n.read ? '' : 'font-weight:600'}">${esc(n.title)}</div>${n.body ? `<div class="small muted" style="white-space:pre-wrap">${esc(n.body)}</div>` : ''}<div class="tiny muted">${ago(n.at)}</div></div></li>`).join('')}</ul>` : empty('You’re all caught up.')}</div>
  <footer><button class="btn" data-a="ntf-readall">Mark all read</button><button class="btn" data-a="close">Close</button></footer>`;
}
</script>
