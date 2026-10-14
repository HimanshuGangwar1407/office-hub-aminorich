<script>
/* ═════════════ Render loop ═════════════ */
const VIEW_FN = { dashboard: vDashboard, policies: vPolicies, chats: vChats2, attendance: vAttendance, wfhlive: vWfhLive, leave: vLeave, tasks: vTasks, worklog: vWorklog, approvals: vApprovals, claims: vClaims, complaints: vComplaints, deptdash: vDeptDash, hrdash: vHrDash, mgmtdash: vMgmtDash, departments: vDepartments, people: vPeople, reports: vReports, settings: vSettings };
let raf = 0, viewChanged = true;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function morph(root, html, fresh = false) {
  const keep = {};
  if (!fresh) root.querySelectorAll('input[id],select[id],textarea[id]').forEach((el) => {
    if (el.type === 'file' || el.type === 'hidden' || el.dataset.c || el.dataset.i) return;
    const dirty = el.type === 'checkbox' || el.type === 'radio' ? el.checked !== el.defaultChecked : el.tagName === 'SELECT' ? [...el.options].some((o) => o.selected !== o.defaultSelected) : el.value !== el.defaultValue;
    if (dirty) keep[el.id] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
  });
  const ae = document.activeElement, aid = !fresh && root.contains(ae) ? ae.id : null;
  let sel = null; try { sel = aid && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null; } catch { sel = null; }
  const scroll = root.querySelector('.overlay')?.scrollTop;
  root.innerHTML = html;
  for (const [id, v] of Object.entries(keep)) { const el = document.getElementById(id); if (el && root.contains(el)) { if (el.type === 'checkbox' || el.type === 'radio') el.checked = v; else el.value = v; } }
  if (aid) { const el = document.getElementById(aid); if (el && root.contains(el)) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(...sel); } catch { /* not a text field */ } } }
  if (scroll) { const o = root.querySelector('.overlay'); if (o) o.scrollTop = scroll; }
}
function render() {
  if (!S.db) return;
  if (!NEED.every((k) => S.loaded.has(k))) return;
  identify();
  if (S.me && !VIEWS.find((v) => v[0] === S.view && v[2]())) S.view = 'dashboard';
  const prevChatScroll = viewChanged ? null : document.getElementById('chat-msgs')?.scrollTop;
  const authed = S.me ? isAuthed() : false;
  if (S.me && authed !== true && S.authWas !== authed) viewChanged = true;
  S.authWas = authed;
  const html = !S.me ? vSetup() : authed === true ? VIEW_FN[S.view]() : vLogin();
  morph($('#app'), html, viewChanged);
  if (authed === true && S.view === 'chats') chatAfterRender(prevChatScroll);
  if (authed === true && S.view === 'wfhlive') wfhAfterRender();
  if (viewChanged) window.scrollTo(0, 0);
  viewChanged = false;
  if (M) { if (authed === true) drawModal(false); else closeModal(); }
  if (authed === true && S.loaded.has('tpl')) runRecurring();
}
function go(target) {
  const [v, sub] = String(target).split(':');
  const map = {
    'tasks:overdue': { tStatus: 'OVERDUE', tView: 'list' }, 'tasks:blocked': { tStatus: 'BLOCKED', tView: 'list' }, 'tasks:today': { tStatus: 'TODAY', tView: 'list' },
    'tasks:mine-board': { tScope: 'mine', tView: 'board' }, 'tasks:mine': { tScope: 'mine', tView: 'list', tStatus: 'OPEN' }, 'tasks:mine-today': { tScope: 'mine', tView: 'list', tStatus: 'TODAY' }, 'tasks:mine-overdue': { tScope: 'mine', tView: 'list', tStatus: 'OVERDUE' }, 'approvals:team': { apTab: 'team' }, 'worklog:team': { wlTab: 'team' },
  };
  if (v === 'attendance' && sub) S.ui.attTab = sub;
  Object.assign(S.ui, map[target] || {});
  if (v === 'tasks' && !sub) S.ui.tStatus = 'OPEN';
  setView(v);
}
function setView(v) { S.view = v; viewChanged = true; try { history.replaceState(null, '', '#' + v); } catch { /* frame may refuse */ } closeModal(); schedule(); }

/* ═════════════ Click actions ═════════════ */
const byId = (list, id) => list.find((x) => x.id === id);
async function onAction(a, el, ev) {
  const id = el.dataset.id;
  switch (a) {
    case 'nav': S.ui.moreOpen = ''; return setView(el.dataset.v);
    case 'go': return go(el.dataset.go);
    case 'ui': S.ui[el.dataset.k] = el.dataset.v; if (el.dataset.k === 'wlDate') S.ui.wlMonth = el.dataset.v.slice(0, 7); viewChanged = false; return schedule();
    case 'close': return closeModal();
    case 'punch': {
      if (!cfg().webPunch) return toast('Check-in from the app is switched off.', 'warn');
      if (needsLoc(S.me.id, today())) return openModal(() => locForm(punchMode()));
      return act(async () => { const out = punchMode() === 'out'; await addPunches(S.me.id, today(), [Date.now()], 'web'); if (out) await stopLive(true, true); }, 'Punch recorded at ' + hm(Date.now()));
    }
    case 'wl-day': { const d = el.dataset.d; if (!d) return; Object.assign(S.ui, { wlDate: d, wlMonth: d.slice(0, 7), wlTab: 'mine' }); if (S.view !== 'worklog') return setView('worklog'); return schedule(); }
    case 'wl-month': S.ui.wlMonth = el.dataset.m; return schedule();
    case 'tf-rm': if (M?.asg) { M.asg = M.asg.filter((x) => x !== id); drawModal(); } return;
    case 'tf-me': if (M?.asg && !M.asg.includes(S.me.id)) { M.asg.push(S.me.id); drawModal(); } return;
    case 'tf-team': if (M?.asg) { for (const x of myTeam()) if (!M.asg.includes(x) && empById(x)?.active !== false) M.asg.push(x); drawModal(); } return;
    case 'new-task': S.ui.preAssignee = el.dataset.assignee || null; return openModal(() => taskForm());
    case 'task': ev.preventDefault(); return openModal(() => taskDetail(id));
    case 'templates': return openModal(templatesModal);
    case 'apply-leave': return openModal(leaveForm);
    case 'new-req': { const t = el.dataset.t, d = el.dataset.d; if (t === 'EXPENSE') return openModal(claimForm); return openModal(() => reqForm(t, { date: d })); }
    case 'claim-bill': { const r = byId(S.reqs, id), f = r?.data.claim?.lines?.[+el.dataset.i]?.file; if (f) return act(() => saveFile(f)); return; }
    case 'req': return openModal(() => reqDetail(id));
    case 'new-dreq': return openModal(dreqForm);
    case 'dreq': return openModal(() => dreqDetail(id));
    case 'emp': S.ui.pickUid = null; return openModal(() => empForm(id));
    case 'emp-new': S.ui.pickUid = null; return openModal(() => empForm(null));
    case 'ntf': return openModal(ntfModal);
    case 'ntf-open': {
      const n = byId(S.ntf, id);
      if (n && !n.read) act(() => patch(`ntf/${n.id}`, { read: true }));
      if (n?.go) { closeModal(); if (n.go.view) setView(n.go.view); if (n.go.chat) { S.ui.chat = n.go.chat; S.ui.chTab = 'msgs'; S.ui.chFind = ''; schedule(); if (n.go.msg && typeof chatAction2 === 'function') setTimeout(() => chatAction2('chat-jump', { dataset: { m: n.go.msg } }), 400); } if (n.go.task) openModal(() => taskDetail(n.go.task)); if (n.go.req) openModal(() => reqDetail(n.go.req)); if (n.go.dreq) openModal(() => dreqDetail(n.go.dreq)); }
      return;
    }
    case 'ntf-readall': return act(async () => { for (const n of S.ntf.filter((x) => !x.read)) await patch(`ntf/${n.id}`, { read: true }); }, 'All marked read');
    case 't-status': { const t = byId(S.tasks, id); const ok = await act(() => setTaskStatus(t, el.dataset.to), el.dataset.to === 'IN_REVIEW' ? 'Sent for review' : 'Updated'); return ok; }
    case 't-block': { const t = byId(S.tasks, id); return confirmBox('Mark as blocked', 'Say what the task is waiting for. The assigner is alerted.', (v) => setTaskStatus(t, 'BLOCKED', v), { input: 'Waiting for…', danger: false }); }
    case 't-cancel': { const t = byId(S.tasks, id); return confirmBox(`Cancel ${t.code}?`, 'The assignee is told it’s no longer needed.', (v) => setTaskStatus(t, 'CANCELLED', v), { input: 'Reason' }); }
    case 't-hours': { const t = byId(S.tasks, id); return confirmBox('Log hours', `Add time spent on ${t.code}.`, async (v) => { const h = +v; if (!(h > 0 && h <= 24)) fail('Enter hours between 0 and 24.'); await patch(`task/${t.id}`, { hours: round2((t.hours || 0) + h), history: hist(t, `Logged ${h} h`) }); }, { input: 'Hours', danger: false }); }
    case 't-extend': {
      const t = byId(S.tasks, id);
      return openModal(() => `${mhead(`More time for ${esc(t.code)}`)}<form data-f="extend" data-id="${t.id}"><div class="body fgrid"><label class="f">New due date<input class="i" id="ex-d" type="date" name="due" min="${addDays(t.due, 1)}" required></label><span class="small muted" style="align-self:end">Current: ${fmtD(t.due)}</span><label class="f full">Why is more time needed?<textarea class="i" id="ex-r" name="reason" required></textarea></label></div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Send to ${esc(nameOf(t.assignerId))}</button></footer></form>`);
    }
    case 't-edit': { const t = byId(S.tasks, id); return openModal(() => taskForm(t)); }
    case 't-sub': { const t = byId(S.tasks, id); S.ui.preAssignee = t.assigneeId; S.ui.parentId = t.id; return openModal(() => taskForm()); }
    case 'cl-toggle': {
      const t = byId(S.tasks, id), i = +el.dataset.i, cl = (t.checklist || []).map((c, k) => (k === i ? { ...c, d: !c.d } : c));
      return act(() => patch(`task/${t.id}`, { checklist: cl }));
    }
    case 'req-cancel': { const r = byId(S.reqs, id); return confirmBox(`Cancel ${r.code}?`, 'The approver will no longer see it.', () => cancelRequest(r)); }
    case 'req-escalate': return act(() => escalate(byId(S.reqs, id)), 'Escalated — the approver and their manager were alerted');
    case 'cancel-leave': {
      const r = byId(S.reqs, id);
      return confirmBox('Cancel approved leave?', `${fmtD(r.data.from)}${r.data.to !== r.data.from ? ' – ' + fmtD(r.data.to) : ''} · ${r.data.days} day(s). Your manager approves the cancellation and the balance is restored.`, (v) => createRequest('LEAVE', `Cancel leave ${fmtDs(r.data.from)}${r.data.to !== r.data.from ? '–' + fmtDs(r.data.to) : ''}`, { ...r.data, cancelOf: r.id, reason: v, days: 0 }, { ctx: { approver: r.data.approver } }), { input: 'Reason', danger: false });
    }
    case 'leave-adj': {
      const e = empById(id), lt = $('#ef-adj-lt').value, v = +$('#ef-adj-v').value, why = $('#ef-adj-r').value.trim();
      if (!v || !why) return toast('Enter the days to add or remove and a reason.', 'warn');
      const key = `${today().slice(0, 4)}_${lt}`;
      return act(async () => { await patch(`emp/${e.id}`, { leaveAdj: { ...(e.leaveAdj || {}), [key]: round2((+(e.leaveAdj?.[key] || 0)) + v) } }); await audit('LEAVE_BALANCE_ADJUSTED', { emp: e.id, lt, by: v, why }); $('#ef-adj-v').value = ''; $('#ef-adj-r').value = ''; }, 'Balance adjusted');
    }
    case 'tpl-toggle': { const t = byId(S.tpls, id); return act(() => patch(`tpl/${t.id}`, { active: t.active === false })); }
    case 'tpl-del': return confirmBox('Delete this recurring task?', 'Tasks already created stay.', () => docRef(`tpl/${id}`).delete());
    case 'hol-del': return act(() => saveCfg({ holidays: cfg().holidays.filter((h) => h.date !== el.dataset.d) }), 'Holiday removed');
    case 'ann-del': return act(() => saveCfg({ announcements: (cfg().announcements || []).filter((x) => x.id !== id) }), 'Removed');
    case 'do-import': {
      const imp = S.ui.import; if (!imp?.punches?.length) return;
      el.disabled = true;
      return act(async () => { const r = await importPunches(imp.punches); if (r.latest > (cfg().importedThrough || '')) await saveCfg({ importedThrough: r.latest }); await audit('ATTENDANCE_IMPORTED', { punches: r.added, through: r.latest }); S.ui.import = null; toast(`${r.added} new punches imported through ${fmtD(r.latest)}`); });
    }
    case 'export-report': { const r = buildReport(ui('rKey', 'attendance')); return exportXlsx(r.title.replace(/[\\/:*?[\]]/g, '-').slice(0, 60), r.cols, r.rows); }
    case 'export-tasks': return exportXlsx('Tasks', ['Code', 'Title', 'Assignee', 'Assigned by', 'Priority', 'Status', 'Overdue', 'Start', 'Due', 'Project', 'Hours', 'Completed'], S.tasks.filter((t) => isMgmt() || canSee(t.assigneeId) || t.assignerId === S.me.id).sort(taskSort).map((t) => [t.code, t.title, nameOf(t.assigneeId), nameOf(t.assignerId), t.priority, TSTAT[effStatus(t)][0], overdue(t) ? 'Yes' : '', t.start, t.due, t.project || '', t.hours || 0, t.completedAt ? fmtDT(t.completedAt) : '']));
    case 'export-people': return exportXlsx('Employees', ['Code', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Reports to', 'Role', 'Status', 'Joining', 'Biometric ID'], S.emps.filter((e) => isMgmt() || canSee(e.id)).map((e) => [e.code, e.name, e.email || '', e.phone || '', deptOf(e.deptId)?.name || '', e.designation || '', e.managerId ? nameOf(e.managerId) : '', e.role, e.status || 'ACTIVE', e.joining || '', e.bioId || '']));
    case 'export-att-day': { const d = ui('attDate', today()); return exportXlsx(`Attendance ${d}`, ['Code', 'Name', 'Department', 'Status', 'In', 'Out', 'Worked (h)', 'Late (min)', 'Location', 'Notes'], scope().map(empById).filter(Boolean).map((e) => { const s = dayStatus(e, d); return [e.code, e.name, deptOf(e.deptId)?.name || '', STATUS[s.code]?.[0] || '', hm(s.inT), hm(s.outT), round2(s.work / 60), s.lateMin || '', locText(e.id, d), s.note]; })); }
    default: if (a === 'cmdk-open') return openCmdk(); if (a === 'cmdk-go') return cmdkRun(cmdkItems()[+el.dataset.i || 0]); if (a.startsWith('pol-')) return polAction(a, el, ev); if (a.startsWith('dd-')) return ddAction(a, el, ev); if (a.startsWith('rd-')) return rdAction(a, el, ev); if (a.startsWith('cmp-')) return cmpAction(a, el, ev); if (a.startsWith('chat-') || a.startsWith('cmdk-')) return chatAction2(a, el, ev); if (a.startsWith('loc-')) return locAction(a, el, ev); if (a.startsWith('pay-')) return payAction(a, el, ev); if (a.startsWith('claim-') || a.startsWith('cl-')) return claimAction(a, el, ev);
      if (a === 'acct') { S.ui.moreOpen = ''; return openModal(accountModal); }
      if (a === 'acct-signout') { await stopLive(true, true).catch(() => {}); return signOut(); }
      if (a === 'acct-reset') { const e = empById(id); return confirmBox(`Reset ${e.name}’s password?`, 'They will be signed out and asked to create a new password the next time they open OfficeHub.', async () => { if (!e.userId) fail('This employee has no account yet.'); if (S.canEdit === false) fail('You need Editor access to the app to reset passwords.'); await S.db.doc(`auth/${e.userId}`).delete(); await audit('PASSWORD_RESET', { emp: e.id }); await notify([e.id], { title: 'Your OfficeHub password was reset', body: `Reset by ${S.me.name}. Open OfficeHub to create a new one.` }); }, { danger: true }); }
      if (a.startsWith('mail-')) return mailAction(a);
      if (a === 'acc-edit') { const k = el.dataset.k; return openModal(() => accessForm(k)); }
      if (a === 'acc-rm') { if (M?.acc) { M.acc.people = M.acc.people.filter((x) => x !== id); drawModal(); } return; }
      if (a === 'dm') return act(() => startDM(id));
      return;
    case 'wl-all': document.querySelectorAll('form[data-f=worklog] input[type=radio][value=W]').forEach((r) => { if (!document.querySelector(`input[name="${r.name}"][value=C]:checked`)) r.click(); }); return;
    case 'wl-copy': { const pl = S.wlogs.find((w) => w.empId === S.me.id && w.date === el.dataset.d); if (!pl) return; for (const [k, src] of [['extra', 'extra'], ['outcomes', 'outcomes'], ['blockers', 'blockersNote'], ['tomorrow', 'tomorrowNote']]) { const x = document.getElementById('wl-' + k); if (x && !x.value) x.value = pl[src] || ''; } return toast('Copied — edit anything that changed'); }
    case 'export-register': { S.ui.rKey = 'attendance'; S.ui.rMonth = ui('regMonth', today().slice(0, 7)); const r = buildReport('attendance'); return exportXlsx(r.title, r.cols, r.rows); }
  }
}
const saveCfg = (partial) => put('cfg/main', { ...strip(cfg()), ...partial });

/* ═════════════ Forms ═════════════ */
async function onSubmit(f, form, fd, submitter) {
  const v = (k) => String(fd.get(k) ?? '').trim();
  const id = form.dataset.id;
  switch (f) {
    case 'confirm': { const fn = M?.onConfirm; return act(async () => { await fn(v('v')); closeModal(); }, 'Done'); }
    case 'setup': return act(async () => {
      const depts = v('depts').split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [c, ...n] = s.split(':'); return { id: newId(), code: c.trim().toUpperCase(), name: (n.join(':') || c).trim(), headId: '' }; });
      const meId = newId();
      await put('cfg/main', { ...strip(cfg()), company: v('company'), depts: (S.cfg?.depts?.length ? S.cfg.depts : depts).map((d, i) => (i === 0 && !d.headId ? { ...d, headId: meId } : d)) });
      await put(`emp/${meId}`, { code: v('code').toUpperCase(), name: v('name'), email: v('email').toLowerCase(), designation: v('designation'), role: 'ADMIN', userId: S.uid, status: 'ACTIVE', active: true, joining: today(), deptId: (S.cfg?.depts?.[0] || depts[0])?.id || null, created: Date.now() });
      await audit('OFFICE_CREATED', { company: v('company') });
    }, 'Office created. Next: add departments’ heads and employees.');
    case 'task': return act(async () => {
      const title = v('title'), due = v('due'), start = v('start') || today();
      if (!title) fail('Give the task a title.');
      if (due < start) fail('The due date is before the start date.');
      const base = { title, desc: v('desc'), priority: v('priority') || 'MEDIUM', start, due, project: v('project'), deptId: v('deptId') || null, dependsOn: v('dependsOn') || null, reviewerId: v('reviewerId') || S.me.id, needsReview: fd.get('needsReview') === 'on', criteria: v('criteria'), links: v('links') };
      const lines = v('checklist').split('\n').map((s) => s.trim()).filter(Boolean);
      if (id) {
        const t = byId(S.tasks, id), asg = v('assignee');
        const changes = [];
        if (t.due !== due) changes.push(`due ${fmtD(t.due)} → ${fmtD(due)}`);
        if (t.assigneeId !== asg) changes.push(`reassigned ${nameOf(t.assigneeId)} → ${nameOf(asg)}`);
        if (t.priority !== base.priority) changes.push(`priority ${t.priority} → ${base.priority}`);
        const cl = lines.map((x) => ({ t: x, d: !!(t.checklist || []).find((c) => c.t === x)?.d }));
        await patch(`task/${id}`, { ...base, assigneeId: asg, checklist: cl, deptId: base.deptId || t.deptId, history: hist(t, `Edited${changes.length ? ': ' + changes.join('; ') : ''}`) });
        if (t.assigneeId !== asg) await notify([asg], { title: `Task assigned to you: ${title}`, body: `${t.code} · due ${fmtD(due)}`, go: { view: 'tasks', task: id } });
        else if (changes.length) await notify([asg], { title: `Task updated: ${t.code}`, body: changes.join('; '), go: { view: 'tasks', task: id } });
        if (t.due !== due) await audit('TASK_DEADLINE_CHANGED', { task: t.code, from: t.due, to: due });
        closeModal(); openModal(() => taskDetail(id)); return;
      }
      const who = fd.getAll('assignees').map(String);
      if (!who.length) fail('Choose at least one person to assign the task to.');
      if (fd.get('allowDup') !== 'on') {
        const dup = S.tasks.filter((t) => openTask(t) && who.includes(t.assigneeId) && t.title.trim().toLowerCase() === title.toLowerCase());
        if (dup.length) fail(`Possible duplicate: ${dup.map((d) => `${d.code} (${nameOf(d.assigneeId)})`).join(', ')} is already open. Tick “Create even if…” to continue.`);
      }
      const group = who.length > 1 ? newId() : null;
      let first = null, codes = [...S.tasks];
      for (const a of who) {
        const tid = newId(), code = await serverCode('TSK', codes);
        codes.push({ code });
        await put(`task/${tid}`, { ...base, code, assigneeId: a, assignerId: S.me.id, deptId: base.deptId || empById(a)?.deptId || null, status: 'TODO', parentId: S.ui.parentId || null, group, checklist: lines.map((x) => ({ t: x, d: false })), comments: [], created: Date.now(), history: [{ at: Date.now(), by: S.me.id, a: `Created and assigned to ${nameOf(a)}` }] });
        if (a !== S.me.id) await notify([a], { title: `New task: ${title}`, body: `${code} · ${PRIO[base.priority][0]} · due ${fmtD(due)}`, go: { view: 'tasks', task: tid } });
        first = first || tid;
      }
      S.ui.parentId = null;
      closeModal(); toast(who.length > 1 ? `${who.length} tasks created` : 'Task created');
      if (who.length === 1) openModal(() => taskDetail(first));
    });
    case 'extend': return act(async () => {
      const t = byId(S.tasks, id);
      if (S.reqs.some((r) => r.type === 'EXTENSION' && r.data.taskId === t.id && r.status === 'PENDING')) fail('An extension request is already waiting for approval.');
      await createRequest('EXTENSION', `More time for ${t.code}: ${fmtDs(t.due)} → ${fmtDs(v('due'))}`, { taskId: t.id, oldDue: t.due, newDue: v('due'), reason: v('reason'), assigner: t.assignerId }, { ctx: { assigner: t.assignerId } });
      await patch(`task/${t.id}`, { history: hist(t, `Asked to extend to ${fmtD(v('due'))}: ${v('reason')}`) });
      closeModal();
    }, 'Extension request sent');
    case 'cl-add': { const t = byId(S.tasks, id); if (!v('t')) return; return act(() => patch(`task/${t.id}`, { checklist: [...(t.checklist || []), { t: v('t'), d: false }] })).then(() => { const i = $('#cl-new'); if (i) i.value = ''; }); }
    case 'comment': {
      const t = byId(S.tasks, id), text = v('text'); if (!text) return;
      return act(async () => {
        await patch(`task/${t.id}`, { comments: [...(t.comments || []), { by: S.me.id, at: Date.now(), text }] });
        const inp = form.querySelector('input'); if (inp) { inp.value = ''; inp.defaultValue = ''; }
        await notify([t.assigneeId, t.assignerId, t.reviewerId], { title: `New comment on ${t.code}`, body: text.slice(0, 200), go: { view: 'tasks', task: t.id } });
        await mentionNotify(text, `${t.code} ${t.title}`, { view: 'tasks', task: t.id });
      });
    }
    case 'review': case 'decide': {
      const r = byId(S.reqs, id);
      return act(async () => {
        const dec = submitter?.value || 'APPROVED', amt = fd.has('apprAmt') ? Math.round(+v('apprAmt')) : null, cap = r.amountApproved ?? r.data.claim?.net;
        if (dec === 'APPROVED' && amt != null && (!(amt > 0) || amt > cap)) fail(`Enter an amount between ₹1 and ${money(cap)}.`);
        if (dec === 'APPROVED' && amt != null && amt < cap && !v('comment')) fail('Say why you are approving less than claimed.');
        await decide(r, dec, v('comment'));
        if (dec === 'APPROVED' && amt != null && amt !== cap) await patch(`req/${r.id}`, { amountApproved: amt, amountApprovedBy: S.me.id });
        if (f === 'decide') closeModal();
      }, submitter?.value === 'APPROVED' ? 'Approved' : submitter?.value === 'REJECTED' ? 'Rejected' : 'Sent back');
    }
    case 'resubmit': return act(() => resubmit(byId(S.reqs, id), v('note')), 'Resubmitted');
    case 'leave': return act(async () => {
      const lt = cfg().leaveTypes.find((x) => x.code === v('lt')), half = fd.get('half') === 'on', from = v('from'), to = half ? from : v('to') || from;
      if (!lt) fail('Choose a leave type.');
      if (to < from) fail('The end date is before the start date.');
      if (half && lt.half === false) fail(`${lt.name} can’t be taken as a half day.`);
      const days = leaveDaysCount(from, to, half);
      if (!days) fail('Those dates are all weekly offs or holidays.');
      if (lt.maxDays && days > lt.maxDays) fail(`${lt.name} allows at most ${lt.maxDays} days at a time.`);
      if (lt.docAbove != null && days > lt.docAbove && !v('doc')) fail(`Add a link to a supporting document — ${lt.name} longer than ${lt.docAbove} day(s) needs one.`);
      const clash = reqsOf('LEAVE', S.me.id).find((r) => ['PENDING', 'APPROVED'].includes(r.status) && !r.data.cancelled && !r.data.cancelOf && r.data.from <= to && r.data.to >= from);
      if (clash) fail(`These dates overlap your ${clash.data.lt} request for ${fmtD(clash.data.from)}.`);
      const bal = balances(S.me, +from.slice(0, 4)).find((b) => b.lt.code === lt.code);
      if (lt.quota > 0 && days > bal.avail) fail(`Not enough ${lt.code}: ${bal.avail} available, ${days} requested. Apply the rest as Leave Without Pay.`);
      const warnings = [from < today() ? 'Back-dated' : '', lt.code === 'CL' && from <= addDays(today(), 0) ? 'Short notice' : ''].filter(Boolean).join(', ');
      await createRequest('LEAVE', `${lt.code} · ${days} day(s) · ${fmtDs(from)}${to !== from ? '–' + fmtDs(to) : ''}`, { lt: lt.code, from, to, half, session: half ? v('session') : '', days, reason: v('reason'), doc: v('doc'), warnings, approver: v('approver') || null }, { ctx: { days, approver: v('approver') } });
      closeModal();
    }, 'Leave request sent for approval');
    case 'req': return act(async () => {
      const type = form.dataset.t, data = {};
      for (const [k, val] of fd.entries()) if (!['title', 'amount'].includes(k) && String(val).trim()) data[k] = String(val).trim();
      const amount = fd.get('amount') ? +fd.get('amount') : null;
      let title = v('title');
      if (type === 'CORRECTION') {
        if (!data.inT && !data.outT) fail('Enter the missing check-in or check-out time.');
        if (S.reqs.some((r) => r.type === 'CORRECTION' && r.empId === S.me.id && r.status === 'PENDING' && r.data.date === data.date)) fail('You already have a correction waiting for that date.');
        title = `Attendance correction · ${fmtDs(data.date)}`;
      }
      if (type === 'WFH_OD') { data.to = data.to || data.from; if (data.to < data.from) fail('Check the dates.'); title = `${data.kind === 'OD' ? 'Official duty' : 'Work from home'} · ${fmtDs(data.from)}${data.to !== data.from ? '–' + fmtDs(data.to) : ''}`; }
      if (type === 'OVERTIME') title = `Overtime · ${fmtDs(data.date)} · ${data.hours} h`;
      await createRequest(type, title || RTYPE[type], data, { amount, ctx: { amount, approver: data.approver } });
      closeModal();
    }, 'Request sent');
    case 'worklog': return act(async () => {
      const date = form.dataset.date, key = `${S.me.id}_${date}`, prev = S.wlogs.find((w) => w.id === key);
      if (date > today()) fail('You can’t fill a work log for a future date.');
      const items = [], warn = [];
      for (const [k, val] of fd.entries()) {
        if (!k.startsWith('s_')) continue;
        const tid = k.slice(2), st = String(val), note = v('n_' + tid), hrs = +fd.get('h_' + tid) || 0;
        if (st !== 'N' || note || hrs) items.push({ id: tid, st, note, hrs });
      }
      const label = (it) => { const t = byId(S.tasks, it.id); return `${t?.code || ''} ${t?.title || ''}${it.hrs ? ` (${it.hrs} h)` : ''}${it.note ? ` — ${it.note}` : ''}`; };
      const shown = [...form.querySelectorAll('input[type=radio]:checked')].map((r) => r.name.slice(2));
      const notToday = shown.filter((id) => !items.some((x) => x.id === id && x.st !== 'N'));
      const done = [...items.filter((x) => x.st === 'C').map((x) => '✓ ' + label(x)), ...items.filter((x) => x.st === 'W').map((x) => '• ' + label(x)), ...(v('extra') ? ['• ' + v('extra')] : [])].join('\n');
      if (!done && !items.some((x) => x.st === 'B')) fail('Mark at least one task as worked on, completed or blocked — or add other work in the notes.');
      const blockedLines = items.filter((x) => x.st === 'B').map((x) => label(x));
      const openLeft = shown.filter((id) => !items.some((x) => x.id === id && x.st === 'C')).map((id) => byId(S.tasks, id)).filter(Boolean);
      const body = {
        empId: S.me.id, date, planned: shown.map((id) => { const t = byId(S.tasks, id); return t ? `${t.code} ${t.title}` : ''; }).filter(Boolean).join('\n'),
        done, pending: notToday.map((id) => { const t = byId(S.tasks, id); return t ? `${t.code} ${t.title}` : ''; }).filter(Boolean).join('\n'),
        outcomes: v('outcomes'), extra: v('extra'), blockers: [...blockedLines, v('blockers')].filter(Boolean).join('\n'),
        tomorrow: v('tomorrow') || openLeft.slice(0, 6).map((t) => `${t.code} ${t.title}`).join('\n'),
        tasks: items, blockersNote: v('blockers'), tomorrowNote: v('tomorrow'), at: Date.now(), firstAt: prev?.firstAt || prev?.at || Date.now(), review: prev?.review || '', reviewedBy: prev?.reviewedBy || null,
      };
      await put(`wlog/${key}`, body);
      for (const it of items) {
        let t = byId(S.tasks, it.id); if (!t) continue;
        const before = (prev?.tasks || []).find((x) => x.id === it.id);
        const dh = round2(it.hrs - (before?.hrs || 0));
        if (dh || it.note !== (before?.note || '') || it.st !== before?.st) {
          await patch(`task/${t.id}`, { hours: round2((t.hours || 0) + dh), history: hist(t, `Work log ${fmtDs(date)}: ${{ W: 'worked on it', C: 'completed', B: 'blocked', N: 'not today' }[it.st]}${it.note ? ' — ' + it.note : ''}${it.hrs ? ` (${it.hrs} h)` : ''}`) });
        }
        try {
          if (it.st === 'C' && openTask(t) && t.status !== 'IN_REVIEW') {
            if ((t.checklist || []).some((c) => !c.d)) { const cl = t.checklist.map((c) => ({ ...c, d: true })); await patch(`task/${t.id}`, { checklist: cl }); t = { ...t, checklist: cl }; }
            await setTaskStatus(t, t.needsReview && t.reviewerId && t.reviewerId !== S.me.id ? 'IN_REVIEW' : 'DONE', it.note);
          } else if (it.st === 'B' && openTask(t) && t.status !== 'BLOCKED' && t.status !== 'IN_REVIEW') {
            await setTaskStatus(t, 'BLOCKED', it.note || 'Blocked — see work log');
          } else if (it.st === 'W' && ['TODO', 'BLOCKED'].includes(t.status)) {
            await setTaskStatus(t, 'IN_PROGRESS', it.note);
          }
        } catch (e) { warn.push(`${t.code}: ${e.message}`); }
      }
      if (body.blockers && body.blockers !== (prev?.blockers || '')) await notify([managerOf(S.me)], { title: `${S.me.name} needs help`, body: body.blockers, go: { view: 'worklog' } });
      if (warn.length) toast(`Saved. Some tasks weren’t changed — ${warn.join(' · ')}`, 'warn');
    }, 'Work log saved');
    case 'wl-review': return act(async () => {
      const l = byId(S.wlogs, id);
      await patch(`wlog/${l.id}`, { review: v('note'), reviewedBy: S.me.id });
      if (v('note')) await notify([l.empId], { title: 'Feedback on your work log', body: v('note'), go: { view: 'worklog' } });
    }, 'Marked reviewed');
    case 'dreq': return act(async () => {
      const fromDept = v('fromDept') || S.me.deptId, toDept = v('toDept');
      if (!fromDept) fail('You need a department on your profile to raise requests. Ask HR.');
      if (!toDept) fail('Choose the department.');
      const head = deptOf(toDept)?.headId, owner = v('ownerId') || head;
      const rid = newId(), code = nextCode('DR', S.dreqs);
      await put(`dreq/${rid}`, { code, fromDept, toDept, byId: S.me.id, ownerId: owner || null, title: v('title'), desc: v('desc'), due: v('due'), priority: v('priority'), links: v('links'), status: 'OPEN', created: Date.now(), log: [{ by: S.me.id, at: Date.now(), kind: 'status', text: 'Request raised' }] });
      await notify([owner, head], { title: `New request from ${deptOf(fromDept)?.name}: ${v('title')}`, body: `${code} · needed by ${fmtD(v('due'))}`, go: { view: 'departments', dreq: rid } });
      closeModal(); openModal(() => dreqDetail(rid));
    }, 'Request raised');
    case 'dr-status': return act(async () => {
      const r = byId(S.dreqs, id), st = v('status'), note = v('note'), late = r.due < today() && st !== 'RESOLVED';
      if ((st === 'BLOCKED' || late) && note.length < 3) fail(late ? 'This is past its date — give a reason for the delay.' : 'Say what it’s blocked on.');
      await patch(`dreq/${r.id}`, { status: st, delay: st === 'BLOCKED' || late ? note : r.delay || '', resolvedAt: st === 'RESOLVED' ? Date.now() : null, log: [...(r.log || []), { by: S.me.id, at: Date.now(), kind: 'status', text: `Status → ${DRSTAT[st][0]}${note ? ': ' + note : ''}` }] });
      await notify([r.byId], { title: `${r.code}: ${st === 'RESOLVED' ? 'resolved — please confirm' : DRSTAT[st][0].toLowerCase()}`, body: note, go: { view: 'departments', dreq: r.id } });
    }, 'Updated');
    case 'dr-hand': return act(async () => {
      const r = byId(S.dreqs, id), to = v('ownerId'); if (!to) fail('Choose who takes it over.');
      await patch(`dreq/${r.id}`, { ownerId: to, log: [...(r.log || []), { by: S.me.id, at: Date.now(), kind: 'handover', text: `Handed over to ${nameOf(to)}` }] });
      await notify([to], { title: `${r.code} handed over to you`, body: r.title, go: { view: 'departments', dreq: r.id } });
    }, 'Handed over');
    case 'dr-confirm': return act(async () => {
      const r = byId(S.dreqs, id), yes = submitter?.value === 'yes', note = v('note');
      if (!yes && note.length < 3) fail('Say what is still missing.');
      await patch(`dreq/${r.id}`, { status: yes ? 'CLOSED' : 'IN_PROGRESS', closedAt: yes ? Date.now() : null, resolvedAt: yes ? r.resolvedAt : null, log: [...(r.log || []), { by: S.me.id, at: Date.now(), kind: 'status', text: yes ? `Confirmed and closed${note ? ': ' + note : ''}` : `Reopened: ${note}` }] });
      await notify([r.ownerId], { title: `${r.code} ${yes ? 'confirmed & closed' : 'reopened'}`, body: note, go: { view: 'departments', dreq: r.id } });
    }, 'Updated');
    case 'dr-comment': {
      const r = byId(S.dreqs, id), text = v('text'); if (!text) return;
      return act(async () => {
        await patch(`dreq/${r.id}`, { log: [...(r.log || []), { by: S.me.id, at: Date.now(), kind: 'comment', text }] });
        const inp = form.querySelector('input'); if (inp) { inp.value = ''; inp.defaultValue = ''; }
        await notify([r.byId, r.ownerId], { title: `New message on ${r.code}`, body: text.slice(0, 200), go: { view: 'departments', dreq: r.id } });
        await mentionNotify(text, `${r.code} ${r.title}`, { view: 'departments', dreq: r.id });
      });
    }
    case 'emp': return act(async () => {
      if (!canEditEmp(id ? empById(id) : null)) fail('You can’t add or change this person. HR, directors, and managers (for their own department) can.');
      const body = {}; for (const k of ['name', 'code', 'email', 'phone', 'designation', 'deptId', 'managerId', 'role', 'bioId', 'status', 'joining', 'probEnd', 'dob', 'exitDate', 'clearance', 'assets', 'userId']) if (fd.has(k)) body[k] = v(k); // fields not on this person's form (e.g. the login link, HR only) stay as they are
      body.email = body.email.toLowerCase(); body.code = body.code.toUpperCase();
      if (!body.name || !body.code) fail('Name and employee code are required.');
      if (S.emps.some((e) => e.id !== id && e.code === body.code)) fail(`Employee code ${body.code} is already used.`);
      if (body.bioId && S.emps.some((e) => e.id !== id && e.bioId === body.bioId)) fail(`Biometric ID ${body.bioId} is already on another employee.`);
      if (body.managerId && body.managerId === id) fail('Someone can’t report to themselves.');
      if (body.role === 'ADMIN' && S.me.role !== 'ADMIN' && empById(id)?.role !== 'ADMIN') fail('Only an administrator can make someone an administrator.');
      if (id && id === S.me.id && body.role !== S.me.role) fail('You can’t change your own role.');
      if (!isHR() && S.me.role === 'MANAGER') {
        if (body.deptId !== S.me.deptId) fail('People you add or change must be in your own department.');
        if (['HR', 'DIRECTOR', 'ADMIN'].includes(body.role) && body.role !== empById(id)?.role) fail('Managers can only give the Employee or Manager role.');
      }
      body.active = body.status !== 'EXITED';
      if ('userId' in body) body.userId = body.userId || null;
      if (id) {
        const e = empById(id), h = [...(e.history || [])], T = today();
        if (e.deptId !== body.deptId) h.push({ kind: 'Transfer', date: T, from: deptOf(e.deptId)?.name || '', to: deptOf(body.deptId)?.name || '' });
        if (e.managerId !== body.managerId) h.push({ kind: 'Manager change', date: T, from: nameOf(e.managerId), to: nameOf(body.managerId) });
        if (e.designation !== body.designation) h.push({ kind: 'Designation', date: T, from: e.designation, to: body.designation });
        if ((e.status || 'ACTIVE') !== body.status) h.push({ kind: 'Status', date: T, from: e.status || 'ACTIVE', to: body.status });
        if (e.role !== body.role) await audit('ROLE_CHANGED', { emp: id, from: e.role, to: body.role });
        await patch(`emp/${id}`, { ...body, history: h });
        if (fd.has('salary') && canSalary() && String(PAY.map[id]?.monthly ?? '') !== v('salary')) { await put(`pay/${id}`, { monthly: +v('salary') || 0, updated: Date.now(), by: S.me.id }); await audit('SALARY_CHANGED', { emp: id }); }
        if (e.managerId !== body.managerId && body.managerId) await notify([body.managerId], { title: `${body.name} now reports to you`, go: { view: 'people' } });
      } else {
        if (body.email && S.emps.some((e) => (e.email || '') === body.email)) fail('An employee with that email already exists.');
        const nid = newId();
        await put(`emp/${nid}`, { ...body, created: Date.now(), history: [{ kind: 'Joined', date: body.joining || today(), from: '', to: body.designation }] });
        if (fd.has('salary') && canSalary() && +v('salary')) await put(`pay/${nid}`, { monthly: +v('salary'), updated: Date.now(), by: S.me.id });
      }
      closeModal();
    }, 'Saved');
    case 'tpl': return act(async () => {
      if (!v('title')) fail('Give it a title.');
      await put(`tpl/${newId()}`, { title: v('title'), assigneeId: v('assigneeId'), priority: v('priority'), freq: v('freq'), dow: +v('dow'), dom: Math.min(28, Math.max(1, +v('dom') || 1)), dueIn: +v('dueIn') || 0, needsReview: fd.get('needsReview') === 'on', checklist: v('checklist').split('\n').map((s) => s.trim()).filter(Boolean), createdBy: S.me.id, active: true, lastGen: '' });
      recurringRan = false; form.reset();
    }, 'Recurring task added');
    case 'cfg-general': return act(async () => { await saveCfg({ company: v('company') || cfg().company, attSource: v('attSource'), slaHours: Math.max(1, +v('slaHours') || 24), hrLeaveAbove: +v('hrLeaveAbove') || 0, directorExpenseAbove: +v('directorExpenseAbove') || 0, webPunch: fd.get('webPunch') === 'on', wfhLoc: v('wfhLoc') || 'required', locEveryH: Math.max(0, Math.min(12, +v('locEveryH') || 0)), liveEveryMin: Math.max(2, Math.min(60, Math.round(+v('liveEveryMin') || 10))) }); await audit('SETTINGS_CHANGED', { section: 'general' }); }, 'Settings saved');
    case 'cfg-shift': return act(async () => { await saveCfg({ shift: { start: v('start'), end: v('end'), grace: +v('grace') || 0, halfMin: +v('halfMin') || 240 }, weeklyOff: fd.getAll('wo').map(Number), secondSat: fd.get('secondSat') === 'on' }); await audit('SETTINGS_CHANGED', { section: 'shift' }); }, 'Shift saved');
    case 'hol-add': return act(async () => { await saveCfg({ holidays: [...cfg().holidays.filter((h) => h.date !== v('date')), { date: v('date'), name: v('name'), optional: fd.get('optional') === 'on' }] }); form.reset(); }, 'Holiday added');
    case 'cfg-leave': return act(async () => {
      const codes = fd.getAll('code'), names = fd.getAll('name'), q = fd.getAll('quota'), mx = fd.getAll('maxDays'), dc = fd.getAll('docAbove');
      const on = (k) => new Set(fd.getAll(k).map(Number));
      const acc = on('accrual'), half = on('half'), unp = on('unpaid');
      const lts = codes.map((c, i) => ({ code: String(c).trim().toUpperCase(), name: String(names[i]).trim(), quota: +q[i] || 0, accrual: acc.has(i), half: half.has(i), maxDays: mx[i] === '' ? null : +mx[i], docAbove: dc[i] === '' ? null : +dc[i], unpaid: unp.has(i) })).filter((l) => l.code && l.name);
      if (!lts.length) fail('Keep at least one leave type.');
      await saveCfg({ leaveTypes: lts }); await audit('LEAVE_POLICY_CHANGED', { types: lts.map((l) => `${l.code}:${l.quota}`) });
    }, 'Leave policy saved');
    case 'cfg-depts': return act(async () => {
      const ids = fd.getAll('id'), names = fd.getAll('name'), codes = fd.getAll('code'), heads = fd.getAll('headId');
      const depts = ids.map((d, i) => ({ id: String(d) || newId(), name: String(names[i]).trim(), code: String(codes[i]).trim().toUpperCase() || String(names[i]).trim().slice(0, 3).toUpperCase(), headId: String(heads[i]) || '' })).filter((d) => d.name);
      await saveCfg({ depts }); await audit('DEPARTMENTS_CHANGED', { count: depts.length });
    }, 'Departments saved');
    default: if (f.startsWith('pol-')) return polSubmit(f, form, fd); if (f.startsWith('cmp-')) return cmpSubmit(f, form, fd); if (f.startsWith('chat-')) return chatSubmit2(f, form, fd); if (f === 'loc') return locSubmit(form, fd); if (f === 'loc-live') return liveSubmit(form, fd); if (['pay-rules', 'acc-save', 'pay-fine'].includes(f)) return paySubmit(f, form, fd); if (f === 'claim') return claimSubmit(form, fd); if (f.startsWith('auth-') || f === 'acct-prefs') return authSubmit(f, form, fd); if (f === 'claim-paid') return claimPaidSubmit(form, fd); if (f === 'claim-pol') return claimPolSubmit(form, fd); return;
    case 'ann-add': return act(async () => {
      await saveCfg({ announcements: [...(cfg().announcements || []), { id: newId(), title: v('title'), body: v('body'), until: v('until'), by: S.me.id, at: Date.now() }].slice(-20) });
      if (fd.get('notify') === 'on') await notify(active().map((e) => e.id), { title: `Announcement: ${v('title')}`, body: v('body').slice(0, 200), go: { view: 'dashboard' } });
      form.reset();
    }, 'Announcement posted');
  }
}

/* ═════════════ Events ═════════════ */
document.addEventListener('click', (ev) => {
  if (ev.target.dataset?.bg) { closeModal(); return; }
  const el = ev.target.closest('[data-a]');
  if (!el) return;
  if (el.tagName === 'A') ev.preventDefault();
  if (el.closest('.kcard') && ev.target.closest('a')) ev.preventDefault();
  onAction(el.dataset.a, el, ev);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && M) closeModal();
  if (ev.key === 'Enter' && !ev.shiftKey && ev.target.id === 'ch-text' && !ev.isComposing) { ev.preventDefault(); ev.target.form?.requestSubmit(); }
});
document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.c === 'chatFile') { chatFilePicked(el); return; }
  if (el.dataset.c === 'locPhoto') { locPhotoPicked(el); return; }
  if (el.closest?.('form[data-f=claim]') && (['clKind', 'clOD', 'clFrom', 'clTo', 'clCat', 'clBill'].includes(el.dataset.c) || el.dataset.calc)) { if (el.dataset.calc) clRecalc(el); else claimChange(el); return; }
  if (el.dataset.c === 'accAdd') { if (el.value && M?.acc && !M.acc.people.includes(el.value)) M.acc.people.push(el.value); el.value = ''; drawModal(); return; }
  if (el.dataset.c === 'chatDM') { const v = el.value; el.value = ''; if (v) act(() => startDM(v)); return; }
  if (el.dataset.c === 'taskAdd') { if (el.value && M?.asg && !M.asg.includes(el.value)) M.asg.push(el.value); el.value = ''; drawModal(); return; }
  if (el.dataset.c === 'importFile') {
    const file = el.files?.[0]; if (!file) return;
    if (!window.XLSX) { toast('The spreadsheet reader didn’t load. Reload and try again.', 'bad'); return; }
    const rd = new FileReader();
    rd.onload = () => { try { const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: true }); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true }); S.ui.import = analyseSheet(rows); } catch (e) { S.ui.import = { error: 'That file couldn’t be read. Save it as .xlsx or .csv and try again.' }; } schedule(); };
    rd.readAsArrayBuffer(file);
    return;
  }
  if (el.dataset.c) { S.ui[el.dataset.c] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.c === 'wlDate' && el.value) S.ui.wlMonth = el.value.slice(0, 7); schedule(); }
});
let inputT = 0;
document.addEventListener('input', async (ev) => {
  const el = ev.target;
  if (el.dataset.i) { S.ui[el.dataset.i] = el.value; clearTimeout(inputT); inputT = setTimeout(schedule, 150); }
  if (el.dataset.search === 'people') {
    const menu = $('#ef-menu'); if (!S.user || !menu) return;
    const hits = await S.user.search(el.value);
    menu.hidden = !hits.length;
    menu.innerHTML = '';
    for (const h of hits) { const b = document.createElement('button'); b.type = 'button'; b.dataset.pick = h.id; const img = document.createElement('img'); img.src = h.avatarUrl; img.alt = ''; img.width = 22; img.height = 22; img.style.borderRadius = '50%'; const s = document.createElement('span'); s.textContent = h.name + (h.email ? ` · ${h.email}` : ''); b.append(img, s); menu.append(b); }
  }
});
document.addEventListener('focusin', async (ev) => { if (ev.target.dataset?.search === 'people' && S.user) ev.target.dispatchEvent(new Event('input', { bubbles: true })); });
document.addEventListener('mousedown', (ev) => {
  const b = ev.target.closest('[data-pick]'); if (!b) return;
  ev.preventDefault();
  S.ui.pickUid = b.dataset.pick; $('#ef-uid').value = b.dataset.pick; $('#ef-find').value = b.textContent; $('#ef-menu').hidden = true;
  toast('Claude login selected — save to link it');
});
document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-f]'); if (!form) return;
  ev.preventDefault();
  if (S.readonly && !['confirm'].includes(form.dataset.f)) { toast('You have view-only access to this app.', 'warn'); return; }
  onSubmit(form.dataset.f, form, new FormData(form, ev.submitter), ev.submitter);
});
document.addEventListener('dragstart', (ev) => { const c = ev.target.closest?.('[data-drag]'); if (c) ev.dataTransfer.setData('text/plain', c.dataset.drag); });
document.addEventListener('dragover', (ev) => { const col = ev.target.closest?.('[data-drop]'); if (col) { ev.preventDefault(); col.classList.add('over'); } });
document.addEventListener('dragleave', (ev) => { const col = ev.target.closest?.('[data-drop]'); if (col) col.classList.remove('over'); });
document.addEventListener('drop', (ev) => {
  const col = ev.target.closest?.('[data-drop]'); if (!col) return;
  ev.preventDefault(); col.classList.remove('over');
  const t = byId(S.tasks, ev.dataTransfer.getData('text/plain')), to = col.dataset.drop;
  if (!t || t.status === to) return;
  if (to === 'BLOCKED') { onAction('t-block', { dataset: { id: t.id } }, ev); return; }
  act(() => setTaskStatus(t, to === 'IN_REVIEW' ? 'IN_REVIEW' : to), 'Moved');
});

/* ═════════════ Boot ═════════════ */
(async function boot() {
  const splash = (msg) => { $('#app').innerHTML = `<div class="splash"><div class="brand"><div class="mark">OH</div><div><b>OfficeHub</b><small>Office management</small></div></div><p>${msg}</p></div>`; };
  if (!window.claude?.use) { splash('Open OfficeHub inside Claude — it keeps your office data in Claude’s shared database.'); return; }
  const [db, user, dl] = await Promise.all(['db', 'user', 'downloads'].map((n) => window.claude.use(n).catch(() => null)));
  if (!db) { splash('Sign in to Claude to use OfficeHub. If you’re signed in, ask the owner to share the app with you.'); return; }
  Object.assign(S, { db, user, dl });
  if (user) {
    const me = await user.me();
    Object.assign(S, { uid: me.id, owner: me.isOwner, myName: me.name, myEmail: me.email });
    const w = await user.can('data.write');
    try { S.canEdit = await user.canEdit(); } catch { S.canEdit = null; }
    S.readonly = w === false;
  }
  const h = (location.hash || '').slice(1);
  if (VIEW_FN[h]) S.view = h;
  const Y = new Date().getFullYear();
  subscribe('cfg', db.doc('cfg/main'), (s) => { S.cfg = s.exists ? { ...DEFAULT_CFG, ...s.data(), shift: { ...DEFAULT_CFG.shift, ...(s.data().shift || {}) } } : null; });
  subscribe('emp', db.collection('emp'), (q) => { S.emps = docsOf(q); });
  subscribe('req', db.collection('req'), (q) => { S.reqs = docsOf(q); });
  subscribe('task', db.collection('task'), (q) => { S.tasks = docsOf(q); });
  subscribe('dreq', db.collection('dreq'), (q) => { S.dreqs = docsOf(q); });
  subscribe('tpl', db.collection('tpl'), (q) => { S.tpls = docsOf(q); });
  subscribe('att', db.collection('att').where('year', 'in', [Y - 1, Y]), (q) => { const m = {}; for (const d of q.docs) m[d.id] = { id: d.id, ...d.data() }; S.att = m; });
  chatSubscribe();
  subscribe('loc', db.collection('loc').where('date', '>=', addDays(today(), -40)), (q) => { S.locs = docsOf(q); });
  subscribe('wlog', db.collection('wlog').where('date', '>=', addDays(today(), -62)), (q) => { S.wlogs = docsOf(q); });
})();
</script>
