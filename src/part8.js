<script>
/* ═════════════ Chats: department channels, groups and direct messages ═════════════
   Storage: chat/{id} holds the chat's metadata. Each person writes only their OWN monthly
   message bucket chat/{id}/b/{YYYY-MM}_{empId}[_n], so simultaneous senders never overwrite
   each other. Files go to the artifact's file store when the type is supported there, otherwise
   they are split into chunk documents under blob/. Read positions live in each viewer's
   private data/users/{uid}/prefs/reads document. */
const CHAT = { list: [], reads: {}, openId: null, unsub: null, buckets: [], uploading: null, assets: undefined, blobUrls: {} };
const ASSET_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json' };
const CHUNK_TYPES = ['xlsx', 'docx', 'pptx', 'zip', 'pdf', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'json', 'md'];
const MAX_FILE = 20 * 1024 * 1024, MAX_CHUNKED = 6 * 1024 * 1024, CHUNK = 190 * 1024;
const extOf = (n) => (String(n).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const fsize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

function chatMembers(c) {
  if (c.kind === 'dept') return active().filter((e) => e.deptId === c.deptId || deptOf(c.deptId)?.headId === e.id).map((e) => e.id);
  if (c.kind === 'all') return active().map((e) => e.id);
  return (c.members || []).filter((id) => empById(id));
}
const inChat = (c) => chatMembers(c).includes(S.me.id) || (c.kind === 'dept' && isMgmt());
function myChats() {
  const out = [];
  out.push({ id: 'all', kind: 'all', name: 'Everyone', ...(CHAT.list.find((c) => c.id === 'all') || {}) });
  for (const d of cfg().depts) { const id = 'dept-' + d.id; out.push({ id, kind: 'dept', deptId: d.id, name: d.name, ...(CHAT.list.find((c) => c.id === id) || {}) }); }
  for (const c of CHAT.list) if ((c.kind === 'group' || c.kind === 'dm') && !c.archived) out.push(c);
  return out.filter(inChat).map((c) => ({ ...c, title: chatTitle(c) }));
}
function chatTitle(c) {
  if (c.kind === 'dm') { const other = (c.members || []).find((m) => m !== S.me.id); return nameOf(other); }
  return c.name;
}
const unreadIn = (c) => !!(c.last && c.last.by !== S.me.id && c.last.at > (CHAT.reads[c.id] || 0));
const unreadCount = () => myChats().filter(unreadIn).length;

/* ── subscriptions ── */
function chatSubscribe() {
  subscribe('chat', S.db.collection('chat'), (q) => { CHAT.list = docsOf(q); });
  if (S.uid) S.db.doc(`data/users/${S.uid}/reads`).onSnapshot((s) => { CHAT.reads = s.exists ? { ...s.data() } : {}; schedule(); }, () => {});
  window.claude.use('assets').then((a) => { CHAT.assets = a || null; }).catch(() => { CHAT.assets = null; });
}
function openChat(id) {
  if (CHAT.openId === id && CHAT.unsub) return;
  CHAT.unsub?.(); CHAT.buckets = []; CHAT.openId = id; CHAT.stick = true;
  const m = today().slice(0, 7), pm = addDays(m + '-01', -1).slice(0, 7);
  CHAT.unsub = S.db.collection(`chat/${id}/b`).where('month', 'in', [pm, m]).onSnapshot((q) => { CHAT.buckets = docsOf(q); markRead(id); schedule(); }, () => toast('Messages stopped updating — reload the page.', 'warn'));
  markRead(id);
}
let readT = 0;
function markRead(id) {
  const c = myChats().find((x) => x.id === id);
  const at = Math.max(c?.last?.at || 0, Date.now());
  if (!S.uid || (CHAT.reads[id] || 0) >= (c?.last?.at || 0) && CHAT.reads[id]) return;
  CHAT.reads = { ...CHAT.reads, [id]: at };
  clearTimeout(readT);
  readT = setTimeout(() => S.db.doc(`data/users/${S.uid}/reads`).set(clean(CHAT.reads)).catch(() => {}), 800);
}
function messagesOf() {
  const all = [];
  const reacts = [];
  for (const b of CHAT.buckets) for (const m of b.msgs || []) { if (m.react) reacts.push({ ...m, by: b.by }); else all.push({ ...m, by: b.by, bucket: b.id }); }
  all.sort((a, b) => a.at - b.at);
  for (const r of reacts) { const t = all.find((m) => m.id === r.react.to); if (t) { t.reacts = t.reacts || {}; t.reacts[r.by] = r.react.e; } }
  return all;
}

/* ── writing ── */
async function ensureChatDoc(c) {
  if (CHAT.list.some((x) => x.id === c.id)) return;
  await put(`chat/${c.id}`, { kind: c.kind, name: c.name, deptId: c.deptId || null, created: Date.now(), createdBy: S.me.id });
}
async function appendMine(chatId, entry) {
  const m = today().slice(0, 7);
  const mine = CHAT.buckets.filter((b) => b.by === S.me.id && b.month === m).sort((a, b) => (a.part || 0) - (b.part || 0));
  let b = mine[mine.length - 1];
  if (!b || JSON.stringify(b.msgs || []).length > 200000) {
    const part = b ? (b.part || 0) + 1 : 0;
    b = { id: `${m}_${S.me.id}${part ? '_' + part : ''}`, month: m, by: S.me.id, part, msgs: [] };
  }
  const msgs = [...(b.msgs || []), entry];
  await put(`chat/${chatId}/b/${b.id}`, { month: b.month, by: S.me.id, part: b.part || 0, msgs });
  CHAT.buckets = [...CHAT.buckets.filter((x) => x.id !== b.id), { ...b, msgs }];
}
async function sendMessage(text, file = null) {
  const c = myChats().find((x) => x.id === CHAT.openId);
  if (!c) fail('Open a chat first.');
  if (!text.trim() && !file) return;
  await ensureChatDoc(c);
  const reply = CHAT.replyTo ? { id: CHAT.replyTo.id, by: CHAT.replyTo.by, text: (CHAT.replyTo.text || CHAT.replyTo.file?.name || '').slice(0, 120) } : null;
  const t = text.trim();
  const mentions = typeof mentionsOf === 'function' ? mentionsOf(t, c) : [];
  const tags = typeof tagsOf === 'function' ? tagsOf(t) : [];
  const msg = { id: newId(), at: Date.now(), text: t, file, reply, mentions: mentions.length ? mentions : undefined, tags: tags.length ? tags : undefined };
  await appendMine(c.id, clean(msg));
  CHAT.replyTo = null;
  const preview = file ? `📎 ${file.name}${t ? ' — ' + t : ''}` : t;
  await patch(`chat/${c.id}`, { last: { at: msg.at, by: S.me.id, text: preview.slice(0, 120) } });
  const members = chatMembers(c);
  const menIds = (mentions.includes('*') ? members : mentions).filter((id) => id !== S.me.id && members.includes(id));
  if (menIds.length) await notify(menIds, { title: `${S.me.name} mentioned you in ${chatTitle(c)}`, body: t.slice(0, 200), go: { view: 'chats', chat: c.id, msg: msg.id } });
  if (reply && reply.by !== S.me.id && !menIds.includes(reply.by)) await notify([reply.by], { title: `${S.me.name} replied to you in ${chatTitle(c)}`, body: t.slice(0, 200), go: { view: 'chats', chat: c.id, msg: msg.id } });
  if (c.kind === 'dm') { const other = (c.members || []).find((m) => m !== S.me.id); if (other && c.last?.by !== S.me.id) await notify([other], { title: `Message from ${S.me.name}`, body: preview.slice(0, 160), go: { view: 'chats', chat: c.id } }); }
}
async function editMine(msgId, change) {
  const b = CHAT.buckets.find((x) => x.by === S.me.id && (x.msgs || []).some((m) => m.id === msgId));
  if (!b) fail('You can only change your own messages.');
  const msgs = b.msgs.map((m) => (m.id === msgId ? { ...m, ...change } : m));
  await put(`chat/${CHAT.openId}/b/${b.id}`, { month: b.month, by: b.by, part: b.part || 0, msgs });
}
async function react(msgId, e) {
  const prev = CHAT.buckets.flatMap((b) => (b.by === S.me.id ? b.msgs || [] : [])).filter((m) => m.react?.to === msgId).pop();
  if (prev?.react.e === e) await appendMine(CHAT.openId, { id: newId(), at: Date.now(), react: { to: msgId, e: '' } });
  else await appendMine(CHAT.openId, { id: newId(), at: Date.now(), react: { to: msgId, e } });
}

/* ── files ── */
async function uploadFile(file) {
  const ext = extOf(file.name);
  if (['xls', 'doc', 'ppt'].includes(ext)) fail(`Old .${ext} files can’t be shared here. Save it as .${ext}x and try again, or share a Drive / OneDrive link.`);
  if (file.size > MAX_FILE) fail('Files up to 20 MB can be shared. For bigger files, share a Drive / OneDrive link.');
  if (CHAT.assets && ASSET_TYPES[ext]) {
    try {
      const r = await CHAT.assets.upload(file, { type: ASSET_TYPES[ext] });
      return { name: file.name, size: file.size, ext, asset: r.id };
    } catch (e) { if (!['not_granted', 'capability_disabled', 'capability_removed'].includes(e?.code)) { if (e?.code === 'too_large') fail('That file is too large.'); if (e?.code === 'quota_or_state') fail('The app’s file storage is full. Ask the admin to clear old files.'); } }
  }
  if (!CHUNK_TYPES.includes(ext)) fail(`.${ext || 'this'} files can’t be shared here. Supported: PDF, Excel (.xlsx), Word (.docx), PowerPoint (.pptx), images, CSV, text and ZIP.`);
  if (file.size > MAX_CHUNKED) fail(`${ext.toUpperCase()} files up to 6 MB can be shared. For bigger ones, share a Drive / OneDrive link.`);
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const b64 = btoa(bin), fid = newId(), n = Math.ceil(b64.length / CHUNK);
  for (let i = 0; i < n; i++) {
    CHAT.uploading = `${file.name} — ${Math.round((i / n) * 100)}%`; schedule();
    await put(`blob/${fid}_${i}`, { fid, i, n, by: S.me.id, data: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  return { name: file.name, size: file.size, ext, fid, chunks: n };
}
async function fileBlob(f) {
  if (f.asset) { const r = await fetch('/_blob/' + f.asset); if (!r.ok) fail('That file is no longer available.'); return r.blob(); }
  let b64 = '';
  for (let i = 0; i < f.chunks; i++) { const s = await docRef(`blob/${f.fid}_${i}`).get(); if (!s.exists) fail('That file is no longer available.'); b64 += s.data().data; }
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: ASSET_TYPES[f.ext] || 'application/octet-stream' });
}
async function saveFile(f) {
  if (!S.dl) fail('Downloads aren’t available in this view.');
  const blob = await fileBlob(f);
  try { await S.dl.save({ filename: f.name, data: blob }); } catch (e) { if (e?.code === 'rejected_extension') fail(`.${f.ext} files can’t be downloaded here.`); if (e?.code !== 'declined') throw e; }
}
async function previewSrc(f) {
  if (f.asset) return '/_blob/' + f.asset;
  const key = f.fid;
  if (!CHAT.blobUrls[key]) CHAT.blobUrls[key] = URL.createObjectURL(await fileBlob(f));
  return CHAT.blobUrls[key];
}

/* ── view ── */
const isImg = (f) => ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(f.ext);
function fileChip(f, msgId) {
  const icon = { pdf: 'PDF', xlsx: 'XLS', csv: 'CSV', docx: 'DOC', pptx: 'PPT', zip: 'ZIP', txt: 'TXT', md: 'TXT', json: 'JSN', mp4: 'VID', webm: 'VID' }[f.ext] || 'IMG';
  const img = isImg(f) ? `<img class="chat-img" alt="${esc(f.name)}" ${f.asset ? `src="/_blob/${esc(f.asset)}"` : `data-lazy="${esc(f.fid)}"`} data-a="chat-open-file" data-m="${msgId}" loading="lazy">` : '';
  return `${img}<button class="chat-file" data-a="chat-file" data-m="${msgId}"><span class="ficon">${icon}</span><span class="grow" style="min-width:0;text-align:left"><span class="trunc" style="display:block">${esc(f.name)}</span><span class="tiny muted">${fsize(f.size)} · Download</span></span></button>`;
}
function vChats() {
  const chats = myChats(), q = ui('chQ', '').toLowerCase();
  let openId = S.ui.chat || CHAT.openId;
  if (openId && !chats.some((c) => c.id === openId)) openId = null;
  if (openId) openChat(openId); else { CHAT.unsub?.(); CHAT.unsub = null; CHAT.openId = null; }
  const list = chats.filter((c) => !q || c.title.toLowerCase().includes(q)).sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0) || a.title.localeCompare(b.title));
  const group = (label, kinds) => { const items = list.filter((c) => kinds.includes(c.kind)); return items.length ? `<div class="chat-sec">${label}</div>${items.map((c) => `<button class="chat-item ${c.id === openId ? 'on' : ''}" data-a="chat-open" data-id="${esc(c.id)}">${c.kind === 'dm' ? avatar(c.title) : `<span class="av" style="background:${c.kind === 'group' ? 'var(--gold)' : 'var(--accent)'};color:var(--accent-ink)">${c.kind === 'all' ? '★' : esc(initials(c.title))}</span>`}<span class="grow" style="min-width:0"><span class="row" style="justify-content:space-between;flex-wrap:nowrap"><b class="trunc">${esc(c.title)}</b><span class="tiny muted">${c.last ? (ymd(new Date(c.last.at)) === today() ? hm(c.last.at) : fmtDs(ymd(new Date(c.last.at)))) : ''}</span></span><span class="row" style="justify-content:space-between;flex-wrap:nowrap"><span class="tiny muted trunc">${c.last ? `${c.last.by === S.me.id ? 'You: ' : c.kind === 'dm' ? '' : esc(nameOf(c.last.by).split(' ')[0]) + ': '}${esc(c.last.text)}` : c.kind === 'dm' ? 'Say hello' : `${chatMembers(c).length} members`}</span>${unreadIn(c) ? '<span class="dotu" aria-label="unread"></span>' : ''}</span></span></button>`).join('')}` : ''; };
  const side = `<aside class="chat-side ${openId ? 'has-open' : ''}"><div class="row" style="padding:10px;gap:6px;flex-wrap:nowrap"><input class="i" id="ch-q" data-i="chQ" placeholder="Search chats" value="${esc(ui('chQ', ''))}"><button class="btn pri sm" data-a="chat-new" title="New group or message">New</button></div>
    <div class="dm-pick"><select class="i" id="ch-dm" data-c="chatDM" aria-label="Message a person">${peopleGroups(null, { blank: '✉ Message a person…', exclude: [S.me.id] })}</select></div><div class="chat-list">${group('Company', ['all'])}${group('Departments', ['dept'])}${group('Groups', ['group'])}${group('Direct messages', ['dm'])}${list.length ? '' : empty('No chats match.')}</div></aside>`;
  let main = `<section class="chat-main empty-main">${empty('Pick a chat on the left, or press <b>New</b> to start a group or a direct message.')}</section>`;
  const c = chats.find((x) => x.id === openId);
  if (c) {
    const msgs = messagesOf(), fq = ui('chFind', '').toLowerCase(), tab = ui('chTab', 'msgs');
    const members = chatMembers(c);
    let body = '';
    if (tab === 'files') {
      const files = msgs.filter((m) => m.file && !m.deleted).reverse();
      body = files.length ? `<div class="chat-files">${files.map((m) => `<div class="chat-frow">${fileChip(m.file, m.id)}<div class="tiny muted">${esc(nameOf(m.by))} · ${fmtDT(m.at)}${m.text ? ` · ${esc(m.text.slice(0, 80))}` : ''}</div></div>`).join('')}</div>` : empty('No documents shared in this chat yet. Use the paperclip to share one.');
    } else if (tab === 'members') {
      const admin = c.kind === 'group' && ((c.admins || [c.createdBy]).includes(S.me.id) || isHR());
      body = `<div style="padding:12px 16px" class="grid">${members.map((id) => `<div class="row" style="justify-content:space-between">${person(id, empById(id)?.designation || '')}${c.kind === 'group' && (c.admins || [c.createdBy]).includes(id) ? '<span class="pill t-acc">Group admin</span>' : ''}${admin && id !== S.me.id ? `<button class="btn sm ghost" data-a="chat-remove" data-id="${id}">Remove</button>` : ''}</div>`).join('')}
        ${admin ? `<form data-f="chat-add" class="row" style="flex-wrap:nowrap;margin-top:8px"><select class="i" id="ch-add" name="emp">${peopleOpts('', 'Add someone…', active().filter((e) => !members.includes(e.id)).map((e) => e.id))}</select><button class="btn">Add</button></form>
          <form data-f="chat-rename" class="row" style="flex-wrap:nowrap"><input class="i" id="ch-ren" name="name" value="${esc(c.name)}"><button class="btn">Rename</button></form>` : ''}
        ${c.kind === 'dept' ? '<p class="tiny muted">Members follow the department on the People page.</p>' : ''}
        ${c.kind === 'group' ? `<button class="btn danger" data-a="chat-leave">Leave group</button>` : ''}</div>`;
    } else {
      let lastDay = '';
      const shown = msgs.filter((m) => !fq || (m.text || '').toLowerCase().includes(fq) || (m.file?.name || '').toLowerCase().includes(fq));
      body = `<div class="chat-msgs" id="chat-msgs">${shown.length ? '' : empty(fq ? 'No messages match.' : 'No messages yet — say hello.')}${shown.map((m) => {
        const d = ymd(new Date(m.at)), mine = m.by === S.me.id;
        const sep = d !== lastDay ? `<div class="chat-day"><span>${d === today() ? 'Today' : d === addDays(today(), -1) ? 'Yesterday' : fmtD(d)}</span></div>` : '';
        lastDay = d;
        const rx = Object.values(m.reacts || {}).filter(Boolean).reduce((a, e) => ((a[e] = (a[e] || 0) + 1), a), {});
        return `${sep}<div class="bubble-row ${mine ? 'mine' : ''}" id="m-${m.id}"><div class="bubble">
          ${!mine && c.kind !== 'dm' ? `<div class="tiny" style="font-weight:600;color:hsl(${hue(nameOf(m.by))} 45% 40%)">${esc(nameOf(m.by))}</div>` : ''}
          ${m.deleted ? '<i class="muted small">Message deleted</i>' : `${m.reply ? `<div class="quote"><b class="tiny">${esc(nameOf(m.reply.by))}</b><div class="tiny trunc">${esc(m.reply.text)}</div></div>` : ''}${m.file ? fileChip(m.file, m.id) : ''}${m.text ? `<div class="btext">${linkify(m.text)}</div>` : ''}`}
          <div class="bmeta"><span>${hm(m.at)}${m.edited ? ' · edited' : ''}</span>${!m.deleted ? `<span class="bacts"><button data-a="chat-react" data-m="${m.id}" data-e="👍" title="Like">👍</button><button data-a="chat-react" data-m="${m.id}" data-e="✅" title="Done">✅</button><button data-a="chat-reply" data-m="${m.id}" title="Reply">Reply</button>${mine ? `<button data-a="chat-del" data-m="${m.id}" title="Delete">Delete</button>` : ''}${m.text && !m.deleted ? `<button data-a="chat-task" data-m="${m.id}" title="Turn into a task">Task</button>` : ''}</span>` : ''}</div>
          ${Object.keys(rx).length ? `<div class="rx">${Object.entries(rx).map(([e, n]) => `<span>${e} ${n}</span>`).join('')}</div>` : ''}
        </div></div>`;
      }).join('')}</div>`;
    }
    const canWrite = !S.readonly && (c.kind !== 'all' || isHR() || !c.hrOnly);
    main = `<section class="chat-main">
      <header class="chat-head"><button class="btn ghost sm chat-back" data-a="chat-close" aria-label="Back to chats">‹</button>
        <div class="grow" style="min-width:0"><b class="trunc" style="display:block">${esc(c.title)}</b><span class="tiny muted">${c.kind === 'dm' ? esc(empById((c.members || []).find((x) => x !== S.me.id))?.designation || '') : `${members.length} members${c.kind === 'dept' ? ' · department' : c.kind === 'all' ? ' · whole company' : ' · group'}`}</span></div>
        <input class="i" id="ch-find" data-i="chFind" placeholder="Search in chat" value="${esc(ui('chFind', ''))}" style="width:150px">
      </header>
      <div class="tabs" style="margin:0;padding:0 10px">${[['msgs', 'Messages'], ['files', `Documents (${msgs.filter((m) => m.file && !m.deleted).length})`], ['members', 'Members']].map(([k, l]) => `<button class="tab" aria-selected="${tab === k}" data-a="ui" data-k="chTab" data-v="${k}">${l}</button>`).join('')}</div>
      ${body}
      ${tab === 'msgs' && canWrite ? `<form data-f="chat-send" class="composer">
        ${CHAT.replyTo ? `<div class="quote row" style="justify-content:space-between;flex-wrap:nowrap"><span class="trunc tiny">Replying to <b>${esc(nameOf(CHAT.replyTo.by))}</b>: ${esc(CHAT.replyTo.text || CHAT.replyTo.file?.name || '')}</span><button type="button" class="btn ghost sm" data-a="chat-unreply">✕</button></div>` : ''}
        ${CHAT.uploading ? `<div class="tiny muted">Uploading ${esc(CHAT.uploading)}…</div>` : ''}
        <div class="row" style="flex-wrap:nowrap;align-items:flex-end">
          <label class="btn ghost" title="Share a document (PDF, Excel, Word, PowerPoint, images, CSV, ZIP)" style="cursor:pointer">📎<input type="file" id="ch-file" data-c="chatFile" hidden></label>
          <textarea class="i" id="ch-text" name="text" rows="1" placeholder="Message ${esc(c.title)} — @name to mention, Enter to send" style="min-height:40px;max-height:140px"></textarea>
          <button class="btn pri" type="submit">Send</button></div></form>` : ''}
    </section>`;
  }
  return shell(`<div class="chat-wrap ${openId ? 'open' : ''}">${side}${main}</div>`, 'Chats', 'Department channels, groups and direct messages — with shared documents', '<button class="btn pri" data-a="chat-new">New group</button>');
}
function linkify(t) { return esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/@([A-Za-z][\w.-]*)/g, '<b style="color:var(--accent)">@$1</b>').replace(/\n/g, '<br>'); }
function chatAfterRender(prevScroll) {
  const box = document.getElementById('chat-msgs');
  if (!box) return;
  if (CHAT.stick || prevScroll == null) box.scrollTop = box.scrollHeight; else box.scrollTop = prevScroll;
  box.onscroll = () => { CHAT.stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80; };
  box.querySelectorAll('img[data-lazy]').forEach(async (img) => {
    const m = messagesOf().find((x) => x.file?.fid === img.dataset.lazy);
    if (!m) return;
    try { img.src = await previewSrc(m.file); img.removeAttribute('data-lazy'); } catch { img.remove(); }
  });
}
function newChatModal() {
  return `${mhead('New chat')}<form data-f="chat-create"><div class="body fgrid">
    <label class="f full">Type<select class="i" id="nc-kind" name="kind">${opts([['group', 'Group (any people, any departments)'], ['dm', 'Direct message (one person)']], 'group')}</select></label>
    <label class="f full">Group name (for groups)<input class="i" id="nc-name" name="name" placeholder="e.g. Vietnam distributor launch"></label>
    <div class="full"><div class="small muted" style="margin-bottom:4px">People</div><div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 10px" class="grid g2">
      ${active().filter((e) => e.id !== S.me.id).sort((a, b) => a.name.localeCompare(b.name)).map((e) => `<label class="check"><input type="checkbox" id="nc-${e.id}" name="members" value="${e.id}"> ${esc(e.name)} <span class="tiny muted">${esc(deptOf(e.deptId)?.code || '')}</span></label>`).join('')}</div></div>
    <p class="tiny muted full">Group members are visible to the people in the group. Treat chats as office-internal: don’t share salaries, bank details or passwords here.</p>
  </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri">Create</button></footer></form>`;
}

/* ── chat actions & forms (called from the main handlers) ── */
async function chatAction(a, el) {
  const msg = () => messagesOf().find((m) => m.id === el.dataset.m);
  switch (a) {
    case 'chat-open': S.ui.chat = el.dataset.id; S.ui.chTab = 'msgs'; S.ui.chFind = ''; CHAT.replyTo = null; CHAT.stick = true; viewChanged = false; schedule(); setTimeout(() => document.getElementById('ch-text')?.focus(), 60); return;
    case 'chat-close': S.ui.chat = null; CHAT.unsub?.(); CHAT.unsub = null; CHAT.openId = null; return schedule();
    case 'chat-new': return openModal(newChatModal);
    case 'chat-reply': CHAT.replyTo = msg(); schedule(); setTimeout(() => document.getElementById('ch-text')?.focus(), 40); return;
    case 'chat-unreply': CHAT.replyTo = null; return schedule();
    case 'chat-react': return act(() => react(el.dataset.m, el.dataset.e));
    case 'chat-del': return confirmBox('Delete this message?', 'Everyone in the chat will see “Message deleted”.', () => editMine(el.dataset.m, { text: '', file: null, deleted: true }));
    case 'chat-file': return act(() => saveFile(msg().file));
    case 'chat-open-file': { const m = msg(); if (!m) return; const src = await previewSrc(m.file).catch(() => null); if (src) openModal(() => `${mhead(esc(m.file.name), `${esc(nameOf(m.by))} · ${fmtDT(m.at)}`)}<div class="body"><img src="${esc(src)}" alt="${esc(m.file.name)}" style="width:100%;border-radius:8px"></div><footer><button class="btn" data-a="close">Close</button></footer>`); return; }
    case 'chat-task': { const m = msg(); S.ui.preAssignee = null; openModal(() => taskForm()); setTimeout(() => { const t = $('#tf-title'), d = $('#tf-desc'); if (t) t.value = m.text.split('\n')[0].slice(0, 120); if (d) d.value = `From chat “${chatTitle(myChats().find((c) => c.id === CHAT.openId) || {})}” — ${nameOf(m.by)}, ${fmtDT(m.at)}:\n${m.text}`; }, 50); return; }
    case 'chat-leave': return confirmBox('Leave this group?', 'You’ll stop seeing its messages.', async () => { const c = CHAT.list.find((x) => x.id === CHAT.openId); await patch(`chat/${c.id}`, { members: (c.members || []).filter((m) => m !== S.me.id) }); await appendMine(c.id, { id: newId(), at: Date.now(), text: `${S.me.name} left the group` }); S.ui.chat = null; });
    case 'chat-remove': { const c = CHAT.list.find((x) => x.id === CHAT.openId), who = el.dataset.id; return confirmBox(`Remove ${nameOf(who)}?`, 'They’ll stop seeing this group.', async () => { await patch(`chat/${c.id}`, { members: (c.members || []).filter((m) => m !== who) }); await appendMine(c.id, { id: newId(), at: Date.now(), text: `${S.me.name} removed ${nameOf(who)}` }); }); }
  }
}
async function chatSubmit(f, form, fd) {
  const v = (k) => String(fd.get(k) ?? '').trim();
  switch (f) {
    case 'chat-send': {
      const ta = $('#ch-text'), text = ta?.value || '';
      if (!text.trim()) return;
      ta.value = ''; ta.defaultValue = '';
      CHAT.stick = true;
      const ok = await act(() => sendMessage(text));
      if (!ok && ta) ta.value = text;
      return;
    }
    case 'chat-create': return act(async () => {
      const kind = v('kind'), members = fd.getAll('members').map(String);
      if (!members.length) fail('Choose at least one person.');
      if (kind === 'dm') {
        if (members.length !== 1) fail('Pick exactly one person for a direct message.');
        const ids = [S.me.id, members[0]].sort(), id = `dm-${ids[0]}-${ids[1]}`;
        if (!CHAT.list.some((c) => c.id === id)) await put(`chat/${id}`, { kind: 'dm', members: ids, created: Date.now(), createdBy: S.me.id });
        closeModal(); S.ui.chat = id; return;
      }
      if (!v('name')) fail('Give the group a name.');
      const id = 'g-' + newId();
      await put(`chat/${id}`, { kind: 'group', name: v('name'), members: [S.me.id, ...members], admins: [S.me.id], created: Date.now(), createdBy: S.me.id });
      await notify(members, { title: `${S.me.name} added you to “${v('name')}”`, go: { view: 'chats', chat: id } });
      closeModal(); S.ui.chat = id; S.ui.chTab = 'msgs';
    }, 'Chat created');
    case 'chat-add': return act(async () => {
      const c = CHAT.list.find((x) => x.id === CHAT.openId), who = v('emp'); if (!who) fail('Choose someone.');
      await patch(`chat/${c.id}`, { members: [...new Set([...(c.members || []), who])] });
      await appendMine(c.id, { id: newId(), at: Date.now(), text: `${S.me.name} added ${nameOf(who)}` });
      await notify([who], { title: `${S.me.name} added you to “${c.name}”`, go: { view: 'chats', chat: c.id } });
    }, 'Added');
    case 'chat-rename': return act(() => patch(`chat/${CHAT.openId}`, { name: v('name') }), 'Renamed');
  }
}
async function chatFilePicked(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const caption = $('#ch-text')?.value || '';
  await act(async () => {
    CHAT.uploading = file.name; schedule();
    try {
      const meta = await uploadFile(file);
      const ta = $('#ch-text'); if (ta) { ta.value = ''; ta.defaultValue = ''; }
      CHAT.stick = true;
      await sendMessage(caption, meta);
    } finally { CHAT.uploading = null; schedule(); }
  }, 'Document shared');
}
</script>
<style>
.chat-wrap{display:grid;grid-template-columns:300px minmax(0,1fr);height:calc(100vh - 150px);min-height:460px;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:var(--surface)}
.chat-side{border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0}
.chat-list{overflow:auto;flex:1}
.chat-sec{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:10px 14px 4px}
.chat-item{display:flex;gap:10px;align-items:center;width:100%;border:0;background:none;padding:9px 12px;text-align:left;cursor:pointer;border-bottom:1px solid var(--line);font-size:.88rem}
.chat-item:hover{background:var(--sunk)} .chat-item.on{background:var(--accent-soft)}
.chat-item .av{width:36px;height:36px;font-size:13px}
.dotu{width:10px;height:10px;border-radius:50%;background:var(--accent);flex:none}
.chat-main{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg)}
.chat-main.empty-main{justify-content:center}
.chat-head{display:flex;gap:10px;align-items:center;padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--line)}
.chat-back{display:none}
.chat-msgs{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:4px;background:var(--bg) radial-gradient(color-mix(in srgb,var(--line) 55%,transparent) 1px,transparent 1px) 0 0/16px 16px}
.chat-day{text-align:center;margin:10px 0 4px}.chat-day span{background:var(--surface);border:1px solid var(--line);border-radius:99px;padding:2px 10px;font-size:.72rem;color:var(--muted)}
.bubble-row{display:flex}.bubble-row.mine{justify-content:flex-end}
.bubble{max-width:min(560px,82%);background:var(--surface);border:1px solid var(--line);border-radius:12px 12px 12px 4px;padding:7px 10px 5px;font-size:.9rem;box-shadow:0 1px 1px rgba(0,0,0,.04);min-width:0}
.mine .bubble{background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 25%,var(--line));border-radius:12px 12px 4px 12px}
.btext{white-space:normal;overflow-wrap:anywhere}
.bmeta{display:flex;justify-content:space-between;gap:10px;font-size:.68rem;color:var(--muted);margin-top:3px}
@media (hover:none){.bubble .bacts{display:inline-flex!important}}
.bacts{display:none;gap:2px}.bubble:hover .bacts,.bubble:focus-within .bacts{display:inline-flex}
.bacts button{border:0;background:none;color:var(--muted);cursor:pointer;font-size:.7rem;padding:0 3px}.bacts button:hover{color:var(--accent)}
.rx{display:flex;gap:4px;margin-top:3px}.rx span{background:var(--sunk);border-radius:99px;padding:0 6px;font-size:.72rem}
.quote{border-left:3px solid var(--accent);background:color-mix(in srgb,var(--sunk) 70%,transparent);border-radius:6px;padding:3px 8px;margin-bottom:4px;min-width:0}
.chat-file{display:flex;gap:10px;align-items:center;border:1px solid var(--line);background:var(--surface);border-radius:9px;padding:7px 10px;cursor:pointer;width:min(320px,100%);margin:3px 0;color:var(--ink)}
.ficon{width:34px;height:38px;border-radius:5px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font:700 10px var(--f-mono);flex:none}
.chat-img{display:block;max-width:min(280px,100%);max-height:220px;border-radius:8px;margin:3px 0;cursor:zoom-in}
.chat-files{overflow:auto;flex:1;padding:12px 14px;display:grid;gap:10px;align-content:start}
.chat-frow{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.composer{padding:10px;background:var(--surface);border-top:1px solid var(--line);display:grid;gap:6px}
@media (max-width:860px){
  .chat-wrap{grid-template-columns:1fr;height:calc(100vh - 190px)}
  .chat-wrap.open .chat-side{display:none} .chat-wrap:not(.open) .chat-main{display:none}
  .chat-back{display:inline-flex} #ch-find{display:none}
}
</style>
<style>
.card details>.body{padding:12px 16px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;flex-wrap:wrap}
.seg label{padding:5px 10px;font-size:.8rem;cursor:pointer;border-right:1px solid var(--line);color:var(--muted);background:var(--surface)}
.seg label:last-child{border-right:0}
.seg input{position:absolute;opacity:0;pointer-events:none}
.seg label:has(input:checked).s-W{background:var(--vio-soft);color:var(--vio);font-weight:600}
.seg label:has(input:checked).s-C{background:var(--ok-soft);color:var(--ok);font-weight:600}
.seg label:has(input:checked).s-B{background:var(--bad-soft);color:var(--bad);font-weight:600}
.seg label:has(input:checked).s-N{background:var(--sunk);color:var(--ink)}
.seg label:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:-2px}
</style>
