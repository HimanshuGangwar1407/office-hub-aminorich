<script>
/* ═════════════ Policies ═════════════
   Company, department and group policies. Managers (administrators, HR, directors, managers and department heads)
   post them; the server decides who may see what (server/policy.js). Employees only receive published policies that
   apply to them; managers also see drafts. */
const POL = { list: [], sub: false };
const POL_CATS = ['HR & people', 'Leave & attendance', 'Expenses & finance', 'IT & security', 'Health & safety', 'Code of conduct', 'Operations', 'General'];
const POL_ST = { draft: ['Draft', ''], published: ['Published', 't-ok'] };
const POL_MAX_FILES = 3, POL_MAX_BYTES = 6 * 1024 * 1024;
const polManager = () => isManager() || S.me?.role === 'MANAGER';
const polCanCompany = () => isHR();
const polDeptChoices = () => cfg().depts.filter((d) => isHR() || d.headId === S.me.id);
const polPeopleChoices = () => active().filter((e) => e.id !== S.me.id && (isHR() || e.managerId === S.me.id)).sort((a, b) => a.name.localeCompare(b.name));
const polStatus = (p) => (p.published === true ? 'published' : 'draft');

function polScopeText(p) {
  const a = p.audience || {};
  if (a.scope === 'company') return 'Company-wide';
  if (a.scope === 'depts') return `Departments: ${(a.depts || []).map((id) => deptOf(id)?.name || 'Unknown').join(', ')}`;
  return `Selected people (${(a.people || []).length})`;
}

function polEnsure() {
  if (!S.db || !S.me || POL.sub) return;
  POL.sub = true;
  S.db.collection('policy').onSnapshot((q) => { POL.list = docsOf(q); schedule(); }, () => {});
}

function polRows() {
  const q = ui('polQ', '').trim().toLowerCase(), cat = ui('polCat', ''), sc = ui('polScope', ''), st = ui('polSt', '');
  return POL.list.filter((p) => (!cat || p.category === cat) && (!sc || p.audience?.scope === sc) && (!st || polStatus(p) === st)
    && (!q || [p.title, p.content, p.category].some((x) => String(x || '').toLowerCase().includes(q))))
    .sort((a, b) => (b.publishedAt || b.updatedAt || 0) - (a.publishedAt || a.updatedAt || 0));
}

function vPolicies() {
  polEnsure();
  const mgr = polManager(), rows = polRows();
  const filters = `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">
    <input class="i" data-i="polQ" placeholder="Search title or text" value="${esc(ui('polQ', ''))}" style="min-width:230px">
    <select class="i" style="width:auto;min-width:160px" data-c="polCat" aria-label="Category">${opts(POL_CATS.map((c) => [c, c]), ui('polCat', ''), 'All categories')}</select>
    <select class="i" style="width:auto;min-width:160px" data-c="polScope" aria-label="Audience">${opts([['company', 'Company-wide'], ['depts', 'Departments'], ['people', 'Selected people']], ui('polScope', ''), 'Any audience')}</select>
    ${mgr ? `<select class="i" style="width:auto;min-width:140px" data-c="polSt" aria-label="Status">${opts([['published', 'Published'], ['draft', 'Drafts']], ui('polSt', ''), 'Any status')}</select>` : ''}
  </div>`;
  const list = rows.length
    ? `<div class="card" style="overflow:hidden;padding:0">${rows.map(polRow).join('')}</div>`
    : empty(POL.list.length ? 'No policies match these filters.' : (mgr ? 'No policies yet. Use “+ New policy” to post one.' : 'No policies apply to you yet.'));
  return shell(`${filters}${list}`, 'Policies',
    mgr ? 'Post company, department or group policies, and publish when they are ready' : 'Policies that apply to you',
    mgr ? '<button class="btn pri" data-a="pol-new">+ New policy</button>' : '');
}

function polRow(p) {
  return `<button class="cmp-row" data-a="pol-open" data-id="${esc(p.id)}">
    <span class="grow" style="min-width:0;text-align:left"><b class="trunc" style="display:block">${esc(p.title)}</b>
    <span class="tiny muted">${esc(p.category)} · ${esc(polScopeText(p))} · ${p.attachments?.length ? `${p.attachments.length} attachment${p.attachments.length > 1 ? 's' : ''} · ` : ''}by ${esc(nameOf(p.createdBy))} · ${fmtDT(p.publishedAt || p.updatedAt)}</span></span>
    <span class="cmp-pills">${polManager() ? pill(POL_ST, polStatus(p)) : ''}</span>
  </button>`;
}

function polDetail() {
  const p = POL.list.find((x) => x.id === S.ui.polOpen);
  if (!p) return null;
  const mgr = polManager(), author = p.createdBy === S.me.id || isHR();
  const files = (p.attachments || []).map((f, i) => `<button class="chat-file" data-a="pol-file" data-id="${esc(p.id)}" data-n="${i}"><span class="ficon">${esc((f.ext || 'file').slice(0, 3).toUpperCase())}</span><span class="grow" style="min-width:0;text-align:left"><span class="trunc" style="display:block">${esc(f.name)}</span><span class="tiny muted">${fsize(f.size)} · Download</span></span></button>`).join('') || '<span class="tiny muted">No attachments.</span>';
  const who = mgr ? `<div class="kv" style="grid-template-columns:1fr"><div><span>Audience</span><b>${esc(polScopeText(p))}</b></div>${p.audience?.scope === 'people' ? `<div><span>People</span><b>${(p.audience.people || []).map((id) => esc(nameOf(id))).join(', ')}</b></div>` : ''}</div>` : '';
  const controls = mgr && author ? `<div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn" data-a="pol-edit" data-id="${esc(p.id)}">Edit</button>
      <button class="btn ${p.published ? '' : 'pri'}" data-a="pol-toggle" data-id="${esc(p.id)}">${p.published ? 'Unpublish' : 'Publish'}</button>
    </div>` : '';
  return `${mhead(esc(p.title), `${esc(p.category)} · ${esc(polScopeText(p))}`)}
    <div class="body">
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">${mgr ? pill(POL_ST, polStatus(p)) : ''}<span class="tiny muted">By ${esc(nameOf(p.createdBy))} · ${p.publishedAt ? `published ${fmtDT(p.publishedAt)}` : `last updated ${fmtDT(p.updatedAt)}`}</span></div>
      ${who}
      <h3 style="margin:14px 0 6px">Policy</h3>
      <div class="cmp-desc">${esc(p.content)}</div>
      <h3 style="margin:14px 0 6px">Attachments</h3>
      <div class="chat-files" style="padding:0">${files}</div>
      ${controls ? `<div style="margin-top:14px">${controls}</div>` : ''}
    </div>
    <footer>${mgr && (isHR()) ? `<button type="button" class="btn danger" data-a="pol-delete" data-id="${esc(p.id)}">Delete policy</button>` : ''}<button type="button" class="btn" data-a="close">Close</button></footer>`;
}

function polForm(p) {
  const a = p?.audience || { scope: polCanCompany() ? 'company' : 'depts' };
  const deptChecked = new Set(a.scope === 'depts' ? a.depts || [] : []), peopleChecked = new Set(a.scope === 'people' ? a.people || [] : []);
  const scopes = [...(polCanCompany() ? [['company', 'Company-wide']] : []), ['depts', 'Departments'], ['people', 'Selected people']];
  const depts = polDeptChoices(), people = polPeopleChoices();
  const kept = (p?.attachments || []).map((f) => `<label class="check"><input type="checkbox" name="drop" value="${esc(f.fid)}"> Remove ${esc(f.name)}</label>`).join('');
  return `${mhead(p ? 'Edit policy' : 'New policy', 'Employees see a published policy only if it applies to them.')}
    <form data-f="${p ? 'pol-save' : 'pol-create'}" data-id="${p ? esc(p.id) : ''}"><div class="body fgrid">
      <label class="f full">Title<input class="i" name="title" required minlength="3" maxlength="150" value="${esc(p?.title || '')}" placeholder="e.g. Annual leave carry-forward"></label>
      <label class="f">Category<select class="i" name="category" required>${opts(POL_CATS.map((c) => [c, c]), p?.category || '', 'Choose…')}</select></label>
      <label class="f">Audience<select class="i" name="scope" id="pol-scope">${opts(scopes, a.scope)}</select></label>
      <div class="f full"><span class="small muted">Departments (for a department policy)</span>
        <div style="max-height:150px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px" class="grid">${depts.map((d) => `<label class="check"><input type="checkbox" name="depts" value="${esc(d.id)}" ${deptChecked.has(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('') || '<span class="tiny muted">No departments you head.</span>'}</div></div>
      <div class="f full"><span class="small muted">People (for a group or individual policy)</span>
        <div style="max-height:170px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px" class="grid g2">${people.map((e) => `<label class="check"><input type="checkbox" name="people" value="${esc(e.id)}" ${peopleChecked.has(e.id) ? 'checked' : ''}> ${esc(e.name)} <span class="tiny muted">${esc(deptOf(e.deptId)?.code || '')}</span></label>`).join('') || '<span class="tiny muted">No one you manage yet.</span>'}</div></div>
      <label class="f full">Policy text<textarea class="i" name="content" required minlength="10" maxlength="20000" rows="8" placeholder="Write the policy in full">${esc(p?.content || '')}</textarea></label>
      ${kept ? `<div class="f full"><span class="small muted">Current attachments</span>${kept}</div>` : ''}
      <label class="f full">Attach files (optional: up to ${POL_MAX_FILES} files, 6 MB each)<input class="i" type="file" name="files" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.csv,.txt,.zip"></label>
      <label class="check full"><input type="checkbox" name="publish" ${p?.published ? 'checked' : ''}> Publish now (otherwise saved as a draft)</label>
    </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">${p ? 'Save' : 'Save policy'}</button></footer></form>`;
}

/* ── actions and forms ── */
async function polAction(a, el) {
  switch (a) {
    case 'pol-new': return openModal(() => polForm(null));
    case 'pol-open': S.ui.polOpen = el.dataset.id; return openModal(polDetail);
    case 'pol-edit': { const p = POL.list.find((x) => x.id === el.dataset.id); if (p) return openModal(() => polForm(p)); return; }
    case 'pol-file': { const p = POL.list.find((x) => x.id === el.dataset.id), f = p?.attachments?.[+el.dataset.n]; if (f) return act(() => saveFile(f)); return; }
    case 'pol-toggle': {
      const p = POL.list.find((x) => x.id === el.dataset.id);
      if (!p) return;
      const now = Date.now(), publish = !p.published;
      return act(async () => {
        await patch(`policy/${p.id}`, { published: publish, publishedAt: publish ? (p.publishedAt || now) : null, updatedAt: now });
        await audit(publish ? 'POLICY_PUBLISHED' : 'POLICY_UNPUBLISHED', { policy: p.id });
      }, publish ? 'Policy published' : 'Policy unpublished');
    }
    case 'pol-delete': {
      const p = POL.list.find((x) => x.id === el.dataset.id);
      if (!p) return;
      return confirmBox(`Delete “${p.title}”?`, 'The policy and its attachments are removed for everyone. This cannot be undone.', () => polDelete(p));
    }
  }
}

async function polSubmit(f, form, fd) {
  if (f === 'pol-create' || f === 'pol-save') return polSave(f, form, fd);
}

async function polSave(f, form, fd) {
  const scope = String(fd.get('scope') || '');
  const depts = fd.getAll('depts').map(String), people = fd.getAll('people').map(String);
  if (scope === 'depts' && !depts.length) return toast('Choose at least one department.', 'warn');
  if (scope === 'people' && !people.length) return toast('Choose at least one person.', 'warn');
  if (scope === 'company' && !polCanCompany()) return toast('Only HR or an administrator can publish a company-wide policy.', 'warn');
  const audience = scope === 'company' ? { scope } : scope === 'depts' ? { scope, depts } : { scope, people };
  const old = f === 'pol-save' ? POL.list.find((x) => x.id === form.dataset.id) : null;
  const dropped = fd.getAll('drop').map(String);
  const files = fd.getAll('files').filter((x) => x && x.size);
  const kept = (old?.attachments || []).filter((x) => !dropped.includes(x.fid));
  if (kept.length + files.length > POL_MAX_FILES) return toast(`Attach up to ${POL_MAX_FILES} files.`, 'warn');
  for (const file of files) {
    if (file.size > POL_MAX_BYTES) return toast(`${file.name} is larger than 6 MB.`, 'warn');
    if (!CHUNK_TYPES.includes(extOf(file.name))) return toast(`${file.name}: that file type can’t be attached.`, 'warn');
  }
  const publish = fd.get('publish') === 'on', id = old ? old.id : newId();
  return act(async () => {
    try {
      const added = [];
      for (const file of files) {
        const { fid, chunks } = await putChunked(new Uint8Array(await file.arrayBuffer()), file.name, 'policyfile');
        added.push({ fid, chunks, name: file.name, size: file.size, ext: extOf(file.name), mime: ASSET_TYPES[extOf(file.name)] || '', store: 'policyfile' });
      }
      const now = Date.now();
      const data = { title: String(fd.get('title') || '').trim(), content: String(fd.get('content') || '').trim(), category: String(fd.get('category') || ''), audience, published: publish, publishedAt: publish ? (old?.publishedAt || now) : null, attachments: [...kept, ...added], updatedAt: now };
      if (old) await patch(`policy/${id}`, data);
      else await put(`policy/${id}`, { ...data, createdBy: S.me.id, createdAt: now });
      await audit(publish && !old?.published ? 'POLICY_PUBLISHED' : 'POLICY_SAVED', { policy: id });
      closeModal();
    } finally { CHAT.uploading = null; schedule(); }
  }, publish ? 'Policy published' : 'Draft saved');
}

async function polDelete(p) {
  await act(async () => {
    for (const f of p.attachments || []) for (let i = 0; i < (f.chunks || 0); i++) await docRef(`policyfile/${f.fid}_${i}`).delete();
    await docRef(`policy/${p.id}`).delete();
    await audit('POLICY_DELETED', { policy: p.id });
    S.ui.polOpen = null;
    closeModal();
  }, 'Policy deleted');
}
</script>
