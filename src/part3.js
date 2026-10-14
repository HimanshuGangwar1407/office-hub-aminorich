<script>
/* ═════════════ Data layer ═════════════ */
const clean = (o) => JSON.parse(JSON.stringify(o));
function toast(msg, tone = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${tone === 'bad' ? 't-bad' : tone === 'warn' ? 't-warn' : 't-ok'}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), tone === 'bad' ? 7000 : 3500);
}
function fail(msg) { const e = new Error(msg); e.user = true; throw e; }
function errText(e) {
  if (e?.user) return e.message;
  // The server never signals view-only access. A bad request (invalid_argument) is shown as-is and must not lock the app.
  if (e?.code === 'invalid_argument' && e.message) return e.message;
  if (e?.code === 'quota_exceeded') return 'The app database is full. Ask the admin to archive old records.';
  if (e?.code === 'resource_exhausted') return 'Too many changes at once — wait a moment and try again.';
  return 'That didn’t save. Check your connection and try again.';
}
async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { if (!e?.user) console.error(e); toast(errText(e), 'bad'); return false; }
}
const docRef = (p) => S.db.doc(p);
const put = (p, d) => docRef(p).set(clean(d));
const patch = (p, d) => docRef(p).update(clean(d));
const strip = (o) => { const { id, ...rest } = o; return rest; };
async function notify(ids, n) {
  const to = [...new Set(ids.filter(Boolean))].filter((id) => id !== S.me?.id || n.self);
  for (const id of to) {
    await S.db.collection('ntf').doc().set(clean({ to: id, at: Date.now(), title: n.title, body: n.body || '', go: n.go || null, read: false, from: S.me?.id || null }));
    try { await queueMail(id, n); } catch { /* email queue is best-effort */ }
  }
}
async function audit(action, detail) { await S.db.collection('audit').doc().set(clean({ at: Date.now(), by: S.me?.id || null, action, detail })); }

function subscribe(key, ref, map) {
  ref.onSnapshot((snap) => { map(snap); S.loaded.add(key); schedule(); },
    (e) => { if (e.code === 'revoked') { S.revoked = true; schedule(); } else toast('Live updates paused — reload the page if data looks stale.', 'warn'); });
}
const docsOf = (q) => q.docs.map((d) => ({ id: d.id, ...d.data() }));
let ntfSubFor = null;
function ensureNtfSub() {
  if (!S.me || ntfSubFor === S.me.id) return;
  ntfSubFor = S.me.id;
  subscribe('ntf', S.db.collection('ntf').where('to', '==', S.me.id), (q) => { S.ntf = docsOf(q).sort((a, b) => b.at - a.at); });
}
let linking = false;
async function identify() {
  const byUid = S.uid ? S.emps.find((e) => e.userId === S.uid) : null;
  S.me = byUid && byUid.active !== false ? byUid : null;
  if (S.me) { ensureNtfSub(); return; }
  if (!byUid && S.myEmail && !linking && !S.readonly) {
    const match = S.emps.find((e) => !e.userId && e.active !== false && (e.email || '').toLowerCase() === S.myEmail.toLowerCase());
    if (match && S.uid) { linking = true; await act(() => patch(`emp/${match.id}`, { userId: S.uid })); linking = false; }
  }
}

/* ═════════════ Approval actions ═════════════ */
async function createRequest(type, title, data, { amount = null, ctx = {}, empId } = {}) {
  const emp = empById(empId || S.me.id);
  const chain = chainFor(type, emp, { ...ctx, amount });
  const now = Date.now(), code = await serverCode('REQ', S.reqs);
  const r = {
    code, type, empId: emp.id, raisedBy: S.me.id, title, data, amount, status: 'PENDING', created: now,
    steps: chain.map((s, i) => ({ ...s, status: i ? 'WAITING' : 'PENDING', at: i ? null : now })),
  };
  const id = newId();
  await put(`req/${id}`, r);
  await notify([chain[0].by], { title: `Approval needed: ${title}`, body: `${RTYPE[type]} from ${emp.name}`, go: { view: 'approvals', req: id } });
  return { id, ...r };
}
async function decide(r, decision, comment) {
  const steps = r.steps.map((s) => ({ ...s }));
  const i = steps.findIndex((s) => s.status === 'PENDING');
  if (i < 0 || (steps[i].by !== S.me.id && S.me.role !== 'ADMIN')) fail('You are not the current approver for this request.');
  if (decision !== 'APPROVED' && !comment.trim()) fail('Write a reason before rejecting or sending back.');
  const now = Date.now();
  steps[i] = { ...steps[i], status: decision, comment: comment.trim(), done: now, ...(steps[i].by !== S.me.id ? { actedBy: S.me.id } : {}) }; // an administrator deciding for the approver
  let status = r.status;
  if (decision === 'APPROVED') {
    const n = steps.findIndex((s, k) => k > i && s.status === 'WAITING');
    if (n >= 0) { steps[n] = { ...steps[n], status: 'PENDING', at: now }; }
    else status = 'APPROVED';
    await put(`req/${r.id}`, { ...strip(r), steps, status, decided: status === 'APPROVED' ? now : null });
    if (n >= 0) await notify([steps[n].by], { title: `Approval needed: ${r.title}`, body: `${RTYPE[r.type]} from ${nameOf(r.empId)}`, go: { view: 'approvals', req: r.id } });
    if (status === 'APPROVED') {
      await applyApproved({ ...r, steps, status });
      await notify([r.empId], { title: `Approved: ${r.title}`, body: comment, go: { view: 'approvals', req: r.id } });
    }
  } else {
    steps.forEach((s) => { if (s.status === 'WAITING') s.status = 'SKIPPED'; });
    status = decision;
    await put(`req/${r.id}`, { ...strip(r), steps, status, decided: now });
    await applyClosed(r);
    await notify([r.empId], { title: `${decision === 'REJECTED' ? 'Rejected' : 'Sent back'}: ${r.title}`, body: comment, go: { view: 'approvals', req: r.id } });
  }
}
async function addPunches(empId, date, times, src) {
  const m = date.slice(0, 7), key = attKey(empId, m);
  const doc = clean(S.att[key] || { empId, month: m, year: +m.slice(0, 4), days: {} });
  delete doc.id;
  const dd = date.slice(8);
  const list = doc.days[dd] || [];
  for (const t of times) if (!list.some((p) => Math.abs(p.t - t) < 60000)) list.push({ t, s: src });
  doc.days[dd] = list.sort((a, b) => a.t - b.t);
  await put(`att/${key}`, doc);
}
async function applyApproved(r) {
  const d = r.data || {};
  if (r.type === 'CORRECTION') {
    const ts = [d.inT, d.outT].filter(Boolean).map((t) => new Date(`${d.date}T${t}`).getTime());
    await addPunches(r.empId, d.date, ts, 'correction');
    await audit('ATTENDANCE_CORRECTED', { emp: r.empId, date: d.date, in: d.inT, out: d.outT, req: r.code });
  }
  if (r.type === 'EXTENSION' || r.type === 'REVIEW') {
    const t = S.tasks.find((x) => x.id === d.taskId);
    if (t) {
      const hist = [...(t.history || []), { at: Date.now(), by: S.me.id, a: r.type === 'REVIEW' ? 'Review accepted — completed' : `Due date extended ${fmtD(t.due)} → ${fmtD(d.newDue)}` }];
      if (r.type === 'REVIEW') await patch(`task/${t.id}`, { status: 'DONE', completedAt: Date.now(), history: hist });
      else await patch(`task/${t.id}`, { due: d.newDue, history: hist });
    }
  }
  if (r.type === 'LEAVE' && d.cancelOf) {
    const orig = S.reqs.find((x) => x.id === d.cancelOf);
    if (orig) await patch(`req/${orig.id}`, { data: { ...orig.data, cancelled: true } });
  }
  if (r.type === 'LEAVE') await audit('LEAVE_APPROVED', { emp: r.empId, req: r.code, days: d.days, lt: d.lt });
}
async function applyClosed(r) {
  if (r.type === 'REVIEW') {
    const t = S.tasks.find((x) => x.id === r.data.taskId);
    if (t && t.status === 'IN_REVIEW') await patch(`task/${t.id}`, { status: 'IN_PROGRESS', history: [...(t.history || []), { at: Date.now(), by: S.me.id, a: 'Changes requested' }] });
  }
}
async function cancelRequest(r) {
  if (r.empId !== S.me.id && r.raisedBy !== S.me.id) fail('Only the requester can cancel.');
  await put(`req/${r.id}`, { ...strip(r), status: 'CANCELLED', decided: Date.now(), steps: r.steps.map((s) => (s.status === 'PENDING' || s.status === 'WAITING' ? { ...s, status: 'SKIPPED' } : s)) });
  await applyClosed(r);
}
async function resubmit(r, note) {
  const emp = empById(r.empId);
  const chain = chainFor(r.type, emp, { days: r.data.days, amount: r.amount, assigner: r.data.assigner, reviewer: r.data.reviewer, approver: r.data.approver });
  const now = Date.now();
  await put(`req/${r.id}`, { ...strip(r), status: 'PENDING', decided: null, data: { ...r.data, resubmitNote: note }, steps: chain.map((s, i) => ({ ...s, status: i ? 'WAITING' : 'PENDING', at: i ? null : now })) });
  if (r.type === 'REVIEW') { const t = S.tasks.find((x) => x.id === r.data.taskId); if (t) await patch(`task/${t.id}`, { status: 'IN_REVIEW' }); }
  await notify([chain[0].by], { title: `Resubmitted: ${r.title}`, body: note, go: { view: 'approvals', req: r.id } });
}
async function escalate(r) {
  const s = curStep(r);
  if (!s) return;
  const boss = empById(s.by)?.managerId || firstRole('DIRECTOR', s.by);
  await put(`req/${r.id}`, { ...strip(r), steps: r.steps.map((x) => (x === s ? { ...x, escalated: Date.now() } : x)), watchers: [...new Set([...(r.watchers || []), boss].filter(Boolean))] });
  await notify([s.by], { title: `Reminder: ${r.code} is waiting for you`, body: r.title, go: { view: 'approvals', req: r.id } });
  if (boss) await notify([boss], { title: `Escalated: ${r.code} pending with ${nameOf(s.by)}`, body: `${r.title} — past the ${cfg().slaHours} h response time`, go: { view: 'approvals', req: r.id } });
}

/* ═════════════ Task actions ═════════════ */
const hist = (t, a) => [...(t.history || []), { at: Date.now(), by: S.me.id, a }];
async function setTaskStatus(t, to, note = '') {
  const mgr = canManageTask(t), mine = t.assigneeId === S.me.id;
  if (!mgr && !mine) fail('You can’t change this task.');
  if (!openTask(t) && !(to === 'IN_PROGRESS' && mgr)) fail('This task is closed. Its assigner can reopen it.');
  const pendingReview = S.reqs.find((r) => r.type === 'REVIEW' && r.data.taskId === t.id && r.status === 'PENDING');
  if (to === 'IN_PROGRESS' || to === 'TODO') {
    if (pendingReview) fail('This task is waiting for review. Ask the reviewer to accept it or send it back.');
    if (to === 'IN_PROGRESS' && t.dependsOn) {
      const dep = S.tasks.find((x) => x.id === t.dependsOn);
      if (dep && dep.status !== 'DONE') fail(`Waiting on ${dep.code} (${dep.title}) — finish that first.`);
    }
    await patch(`task/${t.id}`, { status: to, blockedReason: null, completedAt: null, history: hist(t, !openTask(t) ? `Reopened${note ? ': ' + note : ''}` : t.status === 'BLOCKED' ? 'Unblocked' : to === 'IN_PROGRESS' ? 'Started work' : 'Moved to To do') });
    return;
  }
  if (to === 'BLOCKED') {
    if (note.trim().length < 3) fail('Say what the task is waiting for.');
    await patch(`task/${t.id}`, { status: 'BLOCKED', blockedReason: note.trim(), history: hist(t, `Blocked: ${note.trim()}`) });
    await notify([t.assignerId, t.assigneeId], { title: `Blocked: ${t.code} ${t.title}`, body: note, go: { view: 'tasks', task: t.id } });
    return;
  }
  if (to === 'CANCELLED') {
    if (!mgr) fail('Only the assigner or a manager can cancel a task.');
    if (note.trim().length < 3) fail('Give a reason for cancelling.');
    await patch(`task/${t.id}`, { status: 'CANCELLED', history: hist(t, `Cancelled: ${note}`) });
    await notify([t.assigneeId], { title: `Cancelled: ${t.code} ${t.title}`, body: note, go: { view: 'tasks', task: t.id } });
    return;
  }
  if (to === 'IN_REVIEW' || to === 'DONE') {
    if (t.status === 'IN_REVIEW' && pendingReview) {
      if (to !== 'DONE') fail('Already submitted for review.');
      await decide(pendingReview, 'APPROVED', note);
      return;
    }
    if ((t.checklist || []).some((c) => !c.d)) fail('Tick off every checklist item first.');
    if (t.needsReview && t.reviewerId && t.reviewerId !== S.me.id) {
      await patch(`task/${t.id}`, { status: 'IN_REVIEW', history: hist(t, `Submitted for review${note ? ': ' + note : ''}`) });
      await createRequest('REVIEW', `Review ${t.code}: ${t.title}`, { taskId: t.id, note, reviewer: t.reviewerId, assigner: t.assignerId }, { ctx: { reviewer: t.reviewerId }, empId: t.assigneeId });
    } else {
      await patch(`task/${t.id}`, { status: 'DONE', completedAt: Date.now(), history: hist(t, 'Completed') });
      if (t.assignerId !== S.me.id) await notify([t.assignerId], { title: `Completed: ${t.code} ${t.title}`, go: { view: 'tasks', task: t.id } });
    }
  }
}
async function mentionNotify(text, title, go) {
  const handles = (text.match(/@([A-Za-z][\w.-]*)/g) || []).map((h) => h.slice(1).toLowerCase());
  if (!handles.length) return;
  const ids = active().filter((e) => handles.some((h) => e.name.toLowerCase().split(/\s+/)[0] === h || (e.code || '').toLowerCase() === h)).map((e) => e.id);
  const deptHeads = cfg().depts.filter((d) => handles.includes(d.code.toLowerCase())).map((d) => d.headId);
  const who = [...new Set([...ids, ...deptHeads].filter((x) => x && x !== S.me?.id))];
  const rec = go?.task ? ['task', S.tasks.find((t) => t.id === go.task)] : go?.req ? ['req', S.reqs.find((r) => r.id === go.req)] : null;
  if (rec?.[1] && who.some((x) => !(rec[1].watchers || []).includes(x))) await patch(`${rec[0]}/${rec[1].id}`, { watchers: [...new Set([...(rec[1].watchers || []), ...who])] }).catch(() => {});
  await notify([...ids, ...deptHeads], { title: `You were mentioned: ${title}`, body: text.slice(0, 200), go });
}

/* ═════════════ Recurring tasks (generated when anyone opens the app; a lease prevents duplicates) ═════════════ */
let recurringRan = false;
async function runRecurring() {
  if (recurringRan || S.readonly) return;
  recurringRan = true;
  const T = today(), dom = +T.slice(8), codes = S.tasks.slice();
  const mayRun = (tp) => tp.assigneeId === S.me?.id || tp.createdBy === S.me?.id || isMgmt() || myTeam().includes(tp.assigneeId);
  for (const tp of S.tpls.filter((x) => x.active !== false && (x.lastGen || '') < T && mayRun(x))) {
    const due = tp.freq === 'DAILY' ? workingDay(T) : tp.freq === 'WEEKLY' ? dow(T) === +tp.dow : dom === +tp.dom;
    if (!due) continue;
    try {
      const ref = docRef(`tpl/${tp.id}`);
      const lease = await ref.acquire({ holder: S.uid || newId(), ttlMs: 20000 });
      if (!lease.acquired) continue;
      const fresh = await ref.get();
      if (!fresh.exists || (fresh.data().lastGen || '') >= T) continue;
      const id = newId(), code = await serverCode('TSK', codes);
      await put(`task/${id}`, {
        code, title: tp.title, desc: tp.desc || '', assigneeId: tp.assigneeId, assignerId: tp.createdBy, reviewerId: tp.needsReview ? tp.createdBy : null,
        needsReview: !!tp.needsReview, deptId: empById(tp.assigneeId)?.deptId || null, project: tp.project || 'Recurring', priority: tp.priority || 'MEDIUM', status: 'TODO',
        start: T, due: addDays(T, +tp.dueIn || 0), checklist: (tp.checklist || []).map((x) => ({ t: x, d: false })), comments: [], created: Date.now(), tplId: tp.id,
        history: [{ at: Date.now(), by: null, a: 'Created from recurring template' }],
      });
      await patch(`tpl/${tp.id}`, { lastGen: T });
      codes.push({ code });
    } catch (e) { console.warn('recurring', e); }
  }
}

/* ═════════════ Attendance import (Excel/CSV report from the biometric machine) ═════════════ */
function parseWhen(v, timeV) {
  if (v instanceof Date && !isNaN(v)) {
    if (timeV instanceof Date) { const d = new Date(v); d.setHours(timeV.getHours(), timeV.getMinutes(), timeV.getSeconds()); return d; }
    if (typeof timeV === 'string' && /\d{1,2}:\d{2}/.test(timeV)) { const [h, m, s] = timeV.split(':').map(Number); const d = new Date(v); d.setHours(h, m, s || 0); return d; }
    if (typeof timeV === 'number' && timeV < 1) { const d = new Date(v); const secs = Math.round(timeV * 86400); d.setHours(Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60); return d; }
    return v;
  }
  const s = String(v || '').trim() + (timeV != null && timeV !== '' ? ' ' + String(timeV).trim() : '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (m) { let h = +m[4]; if (m[7]) { h = h % 12 + (/pm/i.test(m[7]) ? 12 : 0); } const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1], h, +m[5], +(m[6] || 0)); }
  return null;
}
function analyseSheet(rows) {
  if (!rows.length) return { error: 'The file has no rows.' };
  const keys = Object.keys(rows[0]);
  const find = (...names) => keys.find((k) => names.includes(k.toLowerCase().replace(/[^a-z]/g, '')));
  const idK = find('userid', 'empcode', 'employeecode', 'pin', 'badge', 'enrollno', 'employeeid', 'empid', 'id', 'code', 'cardno', 'biometricid', 'ecode');
  const dtK = find('datetime', 'punchtime', 'logdate', 'checktime', 'timestamp', 'attendancedatetime', 'logtime');
  const dateK = find('date', 'attendancedate', 'punchdate', 'workdate');
  const timeK = find('time', 'punchtimeonly');
  const inK = find('intime', 'in', 'checkin', 'firstin', 'timein');
  const outK = find('outtime', 'out', 'checkout', 'lastout', 'timeout');
  if (!idK) return { error: `Couldn’t find an employee ID column. Columns found: ${keys.join(', ')}` };
  const byKey = new Map();
  for (const e of S.emps) { if (e.bioId) byKey.set(String(e.bioId).trim().toLowerCase(), e); if (e.code) byKey.set(String(e.code).trim().toLowerCase(), e); }
  const out = []; const unknown = new Set(); let bad = 0;
  for (const r of rows) {
    const key = String(r[idK] ?? '').trim().toLowerCase();
    if (!key) continue;
    const emp = byKey.get(key);
    if (!emp) { unknown.add(String(r[idK]).trim()); continue; }
    const whens = [];
    if (dtK) whens.push(parseWhen(r[dtK]));
    else if (dateK && (inK || outK)) { if (r[inK]) whens.push(parseWhen(r[dateK], r[inK])); if (r[outK]) whens.push(parseWhen(r[dateK], r[outK])); }
    else if (dateK && timeK) whens.push(parseWhen(r[dateK], r[timeK]));
    else if (dateK) whens.push(parseWhen(r[dateK]));
    for (const w of whens) { if (!w || isNaN(w) || w.getTime() > Date.now() + 600000) { bad++; continue; } out.push({ emp, t: w.getTime() }); }
  }
  return { punches: out, unknown: [...unknown], bad, cols: { idK, dtK, dateK, timeK, inK, outK } };
}
async function importPunches(list) {
  const groups = new Map();
  for (const p of list) { const d = ymd(new Date(p.t)); const k = `${p.emp.id}|${d}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p.t); }
  const byDoc = new Map();
  for (const [k, ts] of groups) { const [empId, d] = k.split('|'); const dk = attKey(empId, d.slice(0, 7)); if (!byDoc.has(dk)) byDoc.set(dk, { empId, m: d.slice(0, 7), days: {} }); byDoc.get(dk).days[d.slice(8)] = ts; }
  let added = 0, latest = '';
  for (const [dk, g] of byDoc) {
    const doc = clean(S.att[dk] || { empId: g.empId, month: g.m, year: +g.m.slice(0, 4), days: {} });
    delete doc.id;
    for (const [dd, ts] of Object.entries(g.days)) {
      const list = doc.days[dd] || [];
      for (const t of ts) if (!list.some((p) => Math.abs(p.t - t) < 60000)) { list.push({ t, s: 'device' }); added++; }
      doc.days[dd] = list.sort((a, b) => a.t - b.t);
      const d = `${g.m}-${dd}`; if (d > latest) latest = d;
    }
    await put(`att/${dk}`, doc);
  }
  return { added, latest };
}

/* ═════════════ Export ═════════════ */
async function exportXlsx(name, cols, rows) { return exportBook(name, [{ name, cols, rows }]); }
async function exportBook(fileName, sheets, { csv = false } = {}) {
  if (!S.dl) { toast('Downloads aren’t available in this view.', 'warn'); return; }
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '-');
  let data, filename;
  if (!csv && window.XLSX) {
    const wb = XLSX.utils.book_new(), used = new Set();
    for (const sh of sheets) {
      const ws = XLSX.utils.aoa_to_sheet([sh.cols, ...sh.rows]);
      ws['!cols'] = sh.cols.map((c, i) => ({ wch: Math.min(50, Math.max(String(c).length, ...sh.rows.slice(0, 200).map((r) => String(r[i] ?? '').length)) + 2) }));
      if (sh.rows.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sh.rows.length, c: sh.cols.length - 1 } }) };
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };
      let n = sh.name.replace(/[\\/:*?[\]]/g, '-').slice(0, 31), k = 2; while (used.has(n)) n = `${sh.name.slice(0, 27)} (${k++})`; used.add(n);
      XLSX.utils.book_append_sheet(wb, ws, n);
    }
    data = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); filename = `${safe}.xlsx`;
  } else {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const sh = sheets[0];
    data = new Blob(['\ufeff' + [sh.cols, ...sh.rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }); filename = `${safe}.csv`;
    if (!csv) toast('Excel library didn’t load — saved as CSV (opens in Excel).', 'warn');
  }
  try { await S.dl.save({ filename, data }); toast('Saved ' + filename); }
  catch (e) { if (e?.code !== 'declined') toast('The file couldn’t be saved here.', 'bad'); }
}
</script>
