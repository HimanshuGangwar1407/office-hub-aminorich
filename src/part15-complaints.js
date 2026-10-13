<script>
/* ═════════════ Complaints & grievances ═════════════
   Anonymous by design. The server keeps each complainant's identity in a separate record that only
   administrators can read. HR, managers and directors see every complaint, with the complainant shown as
   "Anonymous". Everyone else sees only the complaints they raised. All of these rules are enforced in
   server/complaints.js; this panel only shows what the server sends. */
const CMP = { list: [], names: null, sub: false, subAdmin: false };
const CMP_CATS = ['Harassment', 'Discrimination', 'Safety', 'Pay or benefits', 'Workplace conflict', 'Policy violation', 'Other'];
const CMP_PRI = { LOW: ['Low', ''], MEDIUM: ['Medium', 't-acc'], HIGH: ['High', 't-warn'], URGENT: ['Urgent', 't-bad'] };
const CMP_ST = { OPEN: ['Open', 't-acc'], WORKING: ['Working', 't-warn'], RESOLVED: ['Resolved', 't-ok'], CLOSED: ['Closed', ''] };
const CMP_SLA = { within: ['Within SLA', 't-ok'], due: ['Due soon', 't-warn'], breached: ['Breached', 't-bad'] };
const CMP_SOON_MS = 24 * 3600000, CMP_MAX_FILES = 3, CMP_MAX_BYTES = 6 * 1024 * 1024;
const cmpStaff = () => isManager() || S.me?.role === 'MANAGER';
const cmpIsAdmin = () => S.me?.role === 'ADMIN';
const cmpCanAssign = (e) => ['ADMIN', 'HR', 'DIRECTOR', 'MANAGER'].includes(e.role) || cfg().depts.some((d) => d.headId === e.id) || S.emps.some((x) => x.managerId === e.id);

/* SLA: 7 days from when the complaint is raised. Closed items are judged on when they were resolved. */
function cmpSla(c, now = Date.now()) {
  if (c.status === 'RESOLVED' || c.status === 'CLOSED') return (c.resolvedAt || c.closedAt || c.updatedAt || now) <= c.dueAt ? 'within' : 'breached';
  if (now > c.dueAt) return 'breached';
  return c.dueAt - now <= CMP_SOON_MS ? 'due' : 'within';
}

function cmpEnsure() {
  if (!S.db || !S.me) return;
  if (!CMP.sub) { CMP.sub = true; S.db.collection('complaint').onSnapshot((q) => { CMP.list = docsOf(q); schedule(); }, () => {}); }
  if (cmpIsAdmin() && !CMP.subAdmin) {
    CMP.subAdmin = true;
    S.db.collection('complaintsecret').onSnapshot((q) => { CMP.names = Object.fromEntries(docsOf(q).map((d) => [d.id, d.by])); schedule(); }, () => {});
  }
}

function cmpRows() {
  const q = ui('cmpQ', '').trim().toLowerCase(), st = ui('cmpSt', ''), pr = ui('cmpPr', ''), cat = ui('cmpCat', ''), sla = ui('cmpSla', ''), who = ui('cmpWho', '');
  return CMP.list.filter((c) => (!st || c.status === st) && (!pr || c.priority === pr) && (!cat || c.category === cat) && (!sla || cmpSla(c) === sla)
    && (!who || (who === 'mine' ? c.assignedTo === S.me.id : !c.assignedTo))
    && (!q || [c.code, c.subject, c.description, c.category].some((x) => String(x || '').toLowerCase().includes(q))))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function vComplaints() {
  cmpEnsure();
  const staff = cmpStaff(), all = CMP.list, rows = cmpRows();
  const n = (f) => all.filter(f).length;
  const summary = staff ? `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:12px">
    ${[['Open or working', n((c) => c.status === 'OPEN' || c.status === 'WORKING')], ['Due soon', n((c) => (c.status === 'OPEN' || c.status === 'WORKING') && cmpSla(c) === 'due')], ['Breached', n((c) => (c.status === 'OPEN' || c.status === 'WORKING') && cmpSla(c) === 'breached')], ['Resolved or closed', n((c) => c.status === 'RESOLVED' || c.status === 'CLOSED')]]
      .map(([l, v]) => `<div class="card body" style="min-width:150px;padding:10px 14px"><span class="tiny muted">${l}</span><div style="font:600 1.4rem var(--f-display)">${v}</div></div>`).join('')}</div>` : '';
  const filters = `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <input class="i" data-i="cmpQ" placeholder="Search code, subject or description" value="${esc(ui('cmpQ', ''))}" style="min-width:230px">
    <select class="i" style="width:auto;min-width:150px" data-c="cmpSt" aria-label="Status">${opts(Object.entries(CMP_ST).map(([k, v]) => [k, v[0]]), ui('cmpSt', ''), 'All statuses')}</select>
    <select class="i" style="width:auto;min-width:150px" data-c="cmpPr" aria-label="Priority">${opts(Object.entries(CMP_PRI).map(([k, v]) => [k, v[0]]), ui('cmpPr', ''), 'All priorities')}</select>
    <select class="i" style="width:auto;min-width:150px" data-c="cmpCat" aria-label="Category">${opts(CMP_CATS.map((c) => [c, c]), ui('cmpCat', ''), 'All categories')}</select>
    <select class="i" style="width:auto;min-width:150px" data-c="cmpSla" aria-label="SLA">${opts([['within', 'Within SLA'], ['due', 'Due soon'], ['breached', 'Breached']], ui('cmpSla', ''), 'Any SLA')}</select>
    ${staff ? `<select class="i" style="width:auto;min-width:150px" data-c="cmpWho" aria-label="Assignment">${opts([['mine', 'Assigned to me'], ['none', 'Unassigned']], ui('cmpWho', ''), 'Everything')}</select>` : ''}
  </div>`;
  const list = rows.length
    ? `<div class="card" style="overflow:hidden;padding:0">${rows.map(cmpRow).join('')}</div>`
    : empty(all.length ? 'No complaints match these filters.' : 'No complaints yet. Use “+ New complaint” to raise one. You can stay anonymous.');
  const intro = staff ? '' : '<p class="tiny muted" style="margin:0 0 12px">These are the complaints you raised. HR and managers see them without your name. Only the administrator can see who raised a complaint, and only to act on a serious case.</p>';
  return shell(`${summary}${filters}${intro}${list}`, 'Complaints & grievances',
    staff ? 'Every complaint, with the complainant kept anonymous' : 'Raise a concern privately and track it',
    '<button class="btn pri" data-a="cmp-new">+ New complaint</button>');
}

function cmpRow(c) {
  const assignee = c.assignedTo ? nameOf(c.assignedTo) : 'Not assigned';
  return `<button class="cmp-row" data-a="cmp-open" data-id="${esc(c.id)}">
    <span class="grow" style="min-width:0;text-align:left"><b class="trunc" style="display:block">${esc(c.code)} · ${esc(c.subject)}</b>
    <span class="tiny muted">${esc(c.category)} · raised ${fmtDT(c.createdAt)} · due ${fmtDT(c.dueAt)}</span></span>
    <span class="cmp-pills">${pill(CMP_PRI, c.priority)}${pill(CMP_ST, c.status)}${pill(CMP_SLA, cmpSla(c))}</span>
    ${cmpStaff() ? `<span class="tiny muted" style="min-width:110px;text-align:right">${esc(assignee)}</span>` : ''}
  </button>`;
}

function cmpNewModal() {
  return `${mhead('New complaint', 'Your name is not shown to HR or managers. The system keeps a record of who raised it, which only the administrator can see.')}
    <form data-f="cmp-create"><div class="body fgrid">
      <label class="f">Category<select class="i" name="category" required>${opts(CMP_CATS.map((c) => [c, c]), '', 'Choose…')}</select></label>
      <label class="f">Priority<select class="i" name="priority">${opts(Object.entries(CMP_PRI).map(([k, v]) => [k, v[0]]), 'MEDIUM')}</select></label>
      <label class="f full">Subject<input class="i" name="subject" required minlength="3" maxlength="150" placeholder="A short summary"></label>
      <label class="f full">Description<textarea class="i" name="description" required minlength="10" maxlength="4000" rows="6" placeholder="What happened, when and where. Names are optional."></textarea></label>
      <label class="f full">Attachments (optional: up to ${CMP_MAX_FILES} files, 6 MB each)<input class="i" type="file" name="files" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.csv,.txt,.zip"></label>
      <p class="tiny muted full" style="margin:0">Check attachments before you send them: they can contain names or other details that identify you.</p>
    </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Submit</button></footer></form>`;
}

function cmpDetail() {
  const c = CMP.list.find((x) => x.id === S.ui.cmpOpen);
  if (!c) return null;
  const staff = cmpStaff(), admin = cmpIsAdmin();
  const who = admin
    ? (CMP.names ? `${esc(CMP.names[c.id] ? nameOf(CMP.names[c.id]) : 'Unknown')} <span class="tiny muted">· visible to administrators only</span>` : 'Loading…')
    : staff ? 'Anonymous' : 'You (anonymous to HR and managers)';
  const files = (c.attachments || []).map((f, i) => (staff
    ? `<button class="chat-file" data-a="cmp-file" data-id="${esc(c.id)}" data-n="${i}"><span class="ficon">${esc((f.ext || 'file').slice(0, 3).toUpperCase())}</span><span class="grow" style="min-width:0;text-align:left"><span class="trunc" style="display:block">${esc(f.name)}</span><span class="tiny muted">${fsize(f.size)} · Download</span></span></button>`
    : `<div class="tiny muted">📎 ${esc(f.name)} (${fsize(f.size)})</div>`)).join('') || '<span class="tiny muted">No attachments.</span>';
  const history = (c.log || []).slice().reverse().map((l) => `<div class="tiny" style="padding:4px 0;border-bottom:1px solid var(--line)"><b>${esc(nameOf(l.by))}</b> · ${fmtDT(l.at)} — ${esc(l.text)}</div>`).join('') || '<span class="tiny muted">No updates yet.</span>';
  const manage = staff ? `<form data-f="cmp-update" data-id="${esc(c.id)}" class="card body fgrid" style="padding:12px">
      <label class="f">Status<select class="i" name="status">${opts(Object.entries(CMP_ST).map(([k, v]) => [k, v[0]]), c.status)}</select></label>
      <label class="f">Priority<select class="i" name="priority">${opts(Object.entries(CMP_PRI).map(([k, v]) => [k, v[0]]), c.priority)}</select></label>
      <label class="f full">Assigned to<select class="i" name="assignedTo">${opts(active().filter(cmpCanAssign).sort((a, b) => a.name.localeCompare(b.name)).map((e) => [e.id, e.name]), c.assignedTo || '', 'Not assigned')}</select></label>
      <label class="f full">Add a note to the record<textarea class="i" name="note" rows="2" maxlength="2000" placeholder="Optional"></textarea></label>
      <div class="full"><button class="btn pri">Save changes</button></div></form>` : '';
  return `${mhead(`${esc(c.code)} · ${esc(c.subject)}`, `${esc(c.category)} · raised ${fmtDT(c.createdAt)}`)}
    <div class="body">
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">${pill(CMP_PRI, c.priority)}${pill(CMP_ST, c.status)}${pill(CMP_SLA, cmpSla(c))}<span class="tiny muted">Due ${fmtDT(c.dueAt)}</span></div>
      <div class="kv" style="grid-template-columns:1fr"><div><span>Complainant</span><b>${who}</b></div>${staff ? `<div><span>Assigned to</span><b>${c.assignedTo ? esc(nameOf(c.assignedTo)) : 'Not assigned'}</b></div>` : ''}</div>
      <h3 style="margin:14px 0 4px">Description</h3>
      <div class="cmp-desc">${esc(c.description)}</div>
      <h3 style="margin:14px 0 6px">Attachments</h3>
      <div class="chat-files" style="padding:0">${files}</div>
      ${manage}
      <h3 style="margin:14px 0 6px">History</h3>
      <div>${history}</div>
    </div>
    <footer>${admin && staff ? `<button type="button" class="btn danger" data-a="cmp-delete" data-id="${esc(c.id)}">Delete complaint</button>` : ''}<button type="button" class="btn" data-a="close">Close</button></footer>`;
}

/* ── actions and forms ── */
async function cmpAction(a, el) {
  switch (a) {
    case 'cmp-new': return openModal(cmpNewModal);
    case 'cmp-open': S.ui.cmpOpen = el.dataset.id; return openModal(cmpDetail);
    case 'cmp-file': {
      const c = CMP.list.find((x) => x.id === el.dataset.id), f = c?.attachments?.[+el.dataset.n];
      if (f) return act(() => saveFile(f));
      return;
    }
    case 'cmp-delete': {
      const c = CMP.list.find((x) => x.id === el.dataset.id);
      if (!c) return;
      return confirmBox(`Delete ${c.code}?`, 'The complaint, its history, its attachments and the complainant record are removed for good.', () => cmpDelete(c));
    }
  }
}
async function cmpSubmit(f, form, fd) {
  if (f === 'cmp-create') return cmpCreate(fd);
  if (f === 'cmp-update') return cmpUpdate(form, fd);
}

async function cmpApi(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw Object.assign(new Error((j && j.message) || 'That didn’t save. Check your connection and try again.'), { user: true });
  return j || {};
}

async function cmpCreate(fd) {
  const files = fd.getAll('files').filter((x) => x && x.size);
  if (files.length > CMP_MAX_FILES) return toast(`Attach up to ${CMP_MAX_FILES} files.`, 'warn');
  for (const f of files) {
    if (f.size > CMP_MAX_BYTES) return toast(`${f.name} is larger than 6 MB.`, 'warn');
    if (!CHUNK_TYPES.includes(extOf(f.name))) return toast(`${f.name}: that file type can’t be attached.`, 'warn');
  }
  const ok = await act(async () => {
    try {
      const attachments = [];
      for (const f of files) {
        const { fid, chunks } = await putChunked(new Uint8Array(await f.arrayBuffer()), f.name, 'complaintfile');
        attachments.push({ fid, chunks, name: f.name, size: f.size, ext: extOf(f.name), mime: ASSET_TYPES[extOf(f.name)] || '' });
      }
      await cmpApi('complaints/submit', { category: fd.get('category'), priority: fd.get('priority'), subject: fd.get('subject'), description: fd.get('description'), attachments });
      closeModal();
    } finally { CHAT.uploading = null; schedule(); }
  }, 'Complaint submitted. Thank you for speaking up.');
  return ok;
}

async function cmpUpdate(form, fd) {
  const c = CMP.list.find((x) => x.id === form.dataset.id);
  if (!c) return toast('That complaint no longer exists.', 'warn');
  const status = String(fd.get('status')), priority = String(fd.get('priority'));
  const assignedTo = String(fd.get('assignedTo') || '') || null, note = String(fd.get('note') || '').trim();
  const now = Date.now(), changes = [];
  if (status !== c.status) changes.push(`status ${CMP_ST[c.status][0]} → ${CMP_ST[status][0]}`);
  if (priority !== c.priority) changes.push(`priority ${CMP_PRI[priority][0]}`);
  if (assignedTo !== (c.assignedTo || null)) changes.push(assignedTo ? `assigned to ${nameOf(assignedTo)}` : 'unassigned');
  if (!changes.length && !note) return toast('Nothing to save.', 'warn');
  const log = [...(c.log || [])];
  if (changes.length) log.push({ at: now, by: S.me.id, text: changes.join('; ') });
  if (note) log.push({ at: now, by: S.me.id, text: note });
  const doc = { status, priority, assignedTo, log, updatedAt: now };
  if ((status === 'RESOLVED' || status === 'CLOSED') && !c.resolvedAt) doc.resolvedAt = now;
  if (status === 'CLOSED' && !c.closedAt) doc.closedAt = now;
  if (status === 'OPEN' || status === 'WORKING') { doc.resolvedAt = null; doc.closedAt = null; }
  return act(async () => {
    await patch(`complaint/${c.id}`, doc);
    if (assignedTo && assignedTo !== c.assignedTo) await notify([assignedTo], { title: 'A complaint was assigned to you', body: `${c.code} · ${c.category}`, go: { view: 'complaints' } });
    await audit('COMPLAINT_UPDATED', { complaint: c.id, status });
  }, 'Saved');
}

async function cmpDelete(c) {
  await act(async () => {
    for (const f of c.attachments || []) for (let i = 0; i < (f.chunks || 0); i++) await docRef(`complaintfile/${f.fid}_${i}`).delete();
    await docRef(`complaintsecret/${c.id}`).delete();
    await docRef(`complaint/${c.id}`).delete();
    await audit('COMPLAINT_DELETED', { complaint: c.id });
    S.ui.cmpOpen = null;
    closeModal();
  }, 'Complaint deleted');
}
</script>
<style>
.cmp-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;width:100%;border:0;border-bottom:1px solid var(--line);background:none;padding:12px 14px;cursor:pointer;color:var(--ink);text-align:left}
.cmp-row:hover{background:var(--sunk)}
.cmp-row:last-child{border-bottom:0}
.cmp-pills{display:flex;gap:6px;flex-wrap:wrap}
.cmp-desc{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.92rem;line-height:1.55;background:var(--sunk);border-radius:10px;padding:10px 12px}
</style>
