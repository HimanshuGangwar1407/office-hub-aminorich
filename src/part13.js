<script>
/* ═════════════ Chat 2.0 (Slack/Teams-style) + quick search (Ctrl/⌘ K) ═════════════
   Adds: @mentions with autocomplete (people, @everyone), #tags you can click to filter, grouped messages with
   avatars, emoji reactions, edit, pin, starred chats, "new messages" line, a Mentions inbox, and — through the
   room capability — who is online right now and who is typing. */
const CH2 = { pop: null, editing: null, picker: null, room: null, peers: [], typingT: 0, seenFor: null, seenAt: 0, lastPresence: '' };
const QUICK_RX = ['👍', '✅', '😂', '🙏', '🎉', '👀'];
const EMOJI = ['👍', '✅', '😂', '🙏', '🎉', '👀', '❤️', '🔥', '👏', '💯', '🤝', '😊', '🙌', '⚠️', '❌', '📌'];

/* ── presence: online now / typing (room capability; the page works without it) ── */
(function initRoom() {
  const go = () => window.claude?.use?.('room').then((r) => {
    if (!r) return; CH2.room = r;
    r.onPeers((ch) => { CH2.peers = ch.peers; if (S.view === 'chats' || S.view === 'people') schedule(); }, () => { CH2.room = null; });
  }).catch(() => {});
  setTimeout(go, 0);
})();
function setPresence(patch) {
  if (!CH2.room || !S.me) return;
  const next = { emp: S.me.id, chat: CHAT.openId || null, typing: false, ...patch };
  const key = JSON.stringify(next); if (key === CH2.lastPresence) return; CH2.lastPresence = key;
  CH2.room.presence(next).catch(() => {});
}
const peerEmp = (p) => (p.by ? S.emps.find((e) => e.userId === p.by) : null);
function onlineIds() { const s = new Set(); for (const p of CH2.peers) { if (p.kind !== 'viewer') continue; const e = peerEmp(p); if (e) s.add(e.id); } return s; }
function typingIn(chatId) { const out = new Set(); for (const p of CH2.peers) { if (p.isMe || !p.presence?.typing || p.presence?.chat !== chatId) continue; const e = peerEmp(p); if (e) out.add(e.name.split(' ')[0]); } return [...out]; }
const onlineDot = (id, on) => (on.has(id) ? '<span class="ondot" title="Online now"></span>' : '');

/* ── message text: escape, then format, mentions, tags, links ── */
function fmtMsg(m) {
  let t = esc(m.text || '');
  const codes = []; t = t.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<b>$2</b>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>').replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?]|$)/g, '$1<s>$2</s>');
  const ids = m.mentions || [];
  const names = ids.filter((x) => x !== '*').map((id) => [id, empById(id)?.name]).filter((x) => x[1]).sort((a, b) => b[1].length - a[1].length);
  for (const [id, n] of names) t = t.split('@' + esc(n)).join(`<button class="men ${id === S.me.id ? 'me' : ''}" data-a="dm" data-id="${id}" title="Message ${esc(n)}">@${esc(n)}</button>`);
  t = t.replace(/@(everyone|here)\b/g, '<span class="men me">@$1</span>');
  if (!ids.length) t = t.replace(/(^|\s)@([A-Za-z][\w.-]*)/g, '$1<b class="men">@$2</b>');
  t = t.replace(/(^|[\s>(])#([A-Za-z0-9][\w-]{1,30})/g, '$1<button class="htag" data-a="chat-tag" data-t="$2">#$2</button>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return t.replace(/\n/g, '<br>');
}
const tagsOf = (text) => [...new Set((String(text).match(/(^|\s)#([A-Za-z0-9][\w-]{1,30})/g) || []).map((x) => x.trim().slice(1).toLowerCase()))];
function mentionsOf(text, c) {
  const members = chatMembers(c), out = new Set();
  if (/@(everyone|here)\b/.test(text)) out.add('*');
  for (const id of members) { const n = empById(id)?.name; if (n && text.includes('@' + n)) out.add(id); }
  for (const h of (text.match(/@([A-Za-z][\w.-]*)/g) || []).map((x) => x.slice(1).toLowerCase())) { // short @firstname still works
    const hit = members.filter((id) => (empById(id)?.name || '').toLowerCase().split(/\s+/)[0] === h); if (hit.length === 1) out.add(hit[0]);
  }
  return [...out];
}

/* ── the chat page ── */
function vChats2() {
  const chats = myChats(), q = ui('chQ', '').toLowerCase(), on = onlineIds(), fav = new Set(CHAT.reads._fav || []);
  let openId = S.ui.chat || CHAT.openId;
  const mentionsView = openId === '@mentions';
  if (openId && !mentionsView && !chats.some((c) => c.id === openId)) openId = null;
  if (openId && !mentionsView) openChat(openId); else { CHAT.unsub?.(); CHAT.unsub = null; CHAT.openId = null; }
  if (openId !== CH2.seenFor) { CH2.seenFor = openId; CH2.seenAt = CHAT.reads[openId] || 0; CH2.editing = null; CH2.pop = null; }
  setPresence({ chat: mentionsView ? null : openId || null });
  const ments = S.ntf.filter((n) => n.go?.chat && /mentioned you|replied to you/.test(n.title));
  const unM = ments.filter((n) => !n.read).length;
  const list = chats.filter((c) => !q || c.title.toLowerCase().includes(q)).sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0) || a.title.localeCompare(b.title));
  const item = (c) => { const other = c.kind === 'dm' ? (c.members || []).find((x) => x !== S.me.id) : null; const typ = typingIn(c.id);
    return `<button class="chat-item ${c.id === openId ? 'on' : ''} ${unreadIn(c) ? 'unread' : ''}" data-a="chat-open" data-id="${esc(c.id)}"><span class="av-wrap">${c.kind === 'dm' ? avatar(c.title) : `<span class="av chav ck-${c.kind}">${c.kind === 'all' ? '★' : c.kind === 'dept' ? '#' : esc(initials(c.title))}</span>`}${other ? onlineDot(other, on) : ''}</span>
    <span class="grow" style="min-width:0"><span class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:6px"><b class="trunc">${esc(c.title)}</b><span class="tiny muted">${c.last ? (ymd(new Date(c.last.at)) === today() ? hm(c.last.at) : fmtDs(ymd(new Date(c.last.at)))) : ''}</span></span>
    <span class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:6px"><span class="tiny ${typ.length ? 'typing-t' : 'muted'} trunc">${typ.length ? `${esc(typ.join(', '))} typing…` : c.last ? `${c.last.by === S.me.id ? 'You: ' : c.kind === 'dm' ? '' : esc(nameOf(c.last.by).split(' ')[0]) + ': '}${esc(c.last.text)}` : c.kind === 'dm' ? 'Say hello' : `${chatMembers(c).length} members`}</span>${unreadIn(c) ? '<span class="dotu" aria-label="unread"></span>' : ''}</span></span></button>`; };
  const group = (label, items) => (items.length ? `<div class="chat-sec">${label}</div>${items.map(item).join('')}` : '');
  const side = `<aside class="chat-side ${openId ? 'has-open' : ''}"><div class="chat-side-top"><input class="i" id="ch-q" data-i="chQ" placeholder="Search chats" value="${esc(ui('chQ', ''))}"><button class="btn pri sm" data-a="chat-new" title="New group">+ Group</button></div>
    <div class="dm-pick"><select class="i" id="ch-dm" data-c="chatDM" aria-label="Message a person">${peopleGroups(null, { blank: '✉ Message a person…', exclude: [S.me.id] })}</select></div>
    <div class="chat-list"><button class="chat-item ment ${mentionsView ? 'on' : ''}" data-a="chat-open" data-id="@mentions"><span class="av chav ck-ment">@</span><span class="grow"><b>Mentions</b><span class="tiny muted" style="display:block">Where people tagged you</span></span>${unM ? `<span class="ct">${unM}</span>` : ''}</button>
      ${group('Starred', list.filter((c) => fav.has(c.id)))}${group('Company', list.filter((c) => c.kind === 'all' && !fav.has(c.id)))}${group('Departments', list.filter((c) => c.kind === 'dept' && !fav.has(c.id)))}${group('Groups', list.filter((c) => c.kind === 'group' && !fav.has(c.id)))}${group('Direct messages', list.filter((c) => c.kind === 'dm' && !fav.has(c.id)))}${list.length ? '' : empty('No chats match.')}
      <div class="chat-sec">Online now · ${on.size}</div><div class="online-row">${[...on].filter((id) => id !== S.me.id).slice(0, 14).map((id) => `<button class="av-wrap" data-a="dm" data-id="${id}" title="${esc(nameOf(id))} — message">${avatar(nameOf(id))}<span class="ondot"></span></button>`).join('') || '<span class="tiny muted" style="padding:0 14px">Only you right now</span>'}</div></div></aside>`;
  let main = `<section class="chat-main empty-main">${empty('Pick a chat on the left, or message a person from the list.')}</section>`;
  if (mentionsView) {
    main = `<section class="chat-main"><header class="chat-head"><button class="btn ghost sm chat-back" data-a="chat-close" aria-label="Back to chats">‹</button><div class="grow"><b>Mentions</b><span class="tiny muted" style="display:block">Messages where someone tagged you</span></div>${unM ? '<button class="btn sm" data-a="chat-ment-read">Mark all read</button>' : ''}</header>
      <div class="chat-msgs">${ments.length ? ments.slice(0, 60).map((n) => `<button class="ment-row ${n.read ? '' : 'new'}" data-a="chat-ment" data-id="${n.id}">${avatar(nameOf(n.from))}<span class="grow" style="min-width:0;text-align:left"><span class="row" style="justify-content:space-between"><b class="small">${esc(n.title)}</b><span class="tiny muted">${fmtDT(n.at)}</span></span><span class="small muted" style="display:block">${esc(n.body || '')}</span></span></button>`).join('') : empty('Nobody has tagged you yet. When someone writes @' + esc(S.me.name.split(' ')[0]) + ', it shows here.')}</div></section>`;
  }
  const c = chats.find((x) => x.id === openId);
  if (c) {
    const msgs = messagesOf(), fq = ui('chFind', '').toLowerCase(), tab = ui('chTab', 'msgs'), members = chatMembers(c), pins = c.pins || [];
    const other = c.kind === 'dm' ? (c.members || []).find((x) => x !== S.me.id) : null, typ = typingIn(c.id);
    let body = '';
    if (tab === 'files') {
      const files = msgs.filter((m) => m.file && !m.deleted).reverse();
      body = files.length ? `<div class="chat-files">${files.map((m) => `<div class="chat-frow">${fileChip(m.file, m.id)}<div class="tiny muted">${esc(nameOf(m.by))} · ${fmtDT(m.at)}${m.text ? ` · ${esc(m.text.slice(0, 80))}` : ''}</div></div>`).join('')}</div>` : empty('No documents shared in this chat yet. Use the paperclip to share one.');
    } else if (tab === 'pins') {
      body = `<div class="chat-files">${pins.length ? pins.slice().reverse().map((p) => `<button class="pin-row" data-a="chat-jump" data-m="${p.id}"><span class="pin-ico">📌</span><span class="grow" style="min-width:0;text-align:left"><b class="small">${esc(nameOf(p.by))}</b> <span class="tiny muted">${fmtDT(p.at)} · pinned by ${esc(nameOf(p.pinnedBy))}</span><span class="small" style="display:block">${esc(String(p.text || '').replace(/[*_~`]/g, ''))}</span></span></button>`).join('') : empty('Nothing pinned yet. Hover a message and press 📌 to keep it here.')}</div>`;
    } else if (tab === 'members') {
      const admin = isGroupAdmin(c);
      body = `<div style="padding:12px 16px;overflow:auto" class="grid">${members.slice().sort((a, b) => on.has(b) - on.has(a)).map((id) => `<div class="row" style="justify-content:space-between"><span class="row" style="gap:6px">${person(id, empById(id)?.designation || '')}${on.has(id) ? '<span class="pill t-ok">Online</span>' : ''}</span><span class="row" style="gap:6px">${c.kind === 'group' && (c.admins || [c.createdBy]).includes(id) ? '<span class="pill t-acc">Group admin</span>' : ''}${id !== S.me.id ? `<button class="btn sm" data-a="dm" data-id="${id}">Message</button>` : ''}${admin && id !== S.me.id ? `<button class="btn sm ghost" data-a="chat-remove" data-id="${id}">Remove</button>` : ''}</span></div>`).join('')}
        ${admin ? `<form data-f="chat-add" class="row" style="flex-wrap:nowrap;margin-top:8px"><select class="i" id="ch-add" name="emp">${peopleGroups('', { blank: 'Add someone…', exclude: members })}</select><button class="btn">Add</button></form>
          <form data-f="chat-rename" class="row" style="flex-wrap:nowrap"><input class="i" id="ch-ren" name="name" value="${esc(c.name)}"><button class="btn">Rename</button></form>` : ''}
        ${c.kind === 'dept' ? '<p class="tiny muted">Members follow the department on the People page.</p>' : ''}
        ${admin ? '<button class="btn danger" data-a="chat-delete">Delete group</button>' : ''}
        ${c.kind === 'group' ? `<button class="btn danger" data-a="chat-leave">Leave group</button>` : ''}</div>`;
    } else {
      const tagQ = fq.startsWith('#') ? fq.slice(1) : null;
      const shown = msgs.filter((m) => !fq || (tagQ ? (m.tags || tagsOf(m.text || '')).includes(tagQ) : (m.text || '').toLowerCase().includes(fq) || (m.file?.name || '').toLowerCase().includes(fq)));
      let lastDay = '', prev = null, newShown = false;
      const pinned = new Set(pins.map((p) => p.id));
      body = `${pins.length ? `<button class="pinbar" data-a="ui" data-k="chTab" data-v="pins">📌 <b>${pins.length} pinned</b><span class="trunc">${esc(String(pins[pins.length - 1].text || '').replace(/[*_~`]/g, ''))}</span></button>` : ''}${fq ? `<div class="filterbar">Showing ${tagQ ? `messages tagged <b>#${esc(tagQ)}</b>` : `messages with “${esc(fq)}”`} · ${shown.length} <button class="btn sm ghost" data-a="ui" data-k="chFind" data-v="">Clear</button></div>` : ''}
      <div class="chat-msgs" id="chat-msgs">${shown.length ? '' : empty(fq ? 'No messages match.' : 'No messages yet — say hello.')}${shown.map((m) => {
        const d = ymd(new Date(m.at)), mine = m.by === S.me.id;
        const sep = d !== lastDay ? `<div class="chat-day"><span>${d === today() ? 'Today' : d === addDays(today(), -1) ? 'Yesterday' : `${DAYS[dow(d)]}, ${fmtD(d)}`}</span></div>` : '';
        const nw = !newShown && !fq && CH2.seenAt && m.at > CH2.seenAt && !mine ? ((newShown = true), '<div class="newline"><span>New messages</span></div>') : '';
        const cont = !sep && !nw && prev && prev.by === m.by && m.at - prev.at < 5 * 60000 && !m.reply && !prev.deleted;
        lastDay = d; prev = m;
        const meTagged = !mine && ((m.mentions || []).includes(S.me.id) || (m.mentions || []).includes('*'));
        const rxBy = Object.entries(m.reacts || {}).filter(([, e]) => e).reduce((a, [by, e]) => ((a[e] = a[e] || []).push(by), a), {});
        const sys = !m.file && /^(.+) (added|removed|left)( |$)/.test(m.text || '') && (m.text || '').startsWith(nameOf(m.by));
        if (sys) return `${sep}${nw}<div class="msg-sys">${esc(m.text)} · ${hm(m.at)}</div>`;
        return `${sep}${nw}<div class="msg ${cont ? 'cont' : ''} ${meTagged ? 'hl' : ''} ${pinned.has(m.id) ? 'pinned' : ''}" id="m-${m.id}">
          <div class="msg-av">${cont ? `<span class="msg-t">${hm(m.at)}</span>` : `<span class="av-wrap">${avatar(nameOf(m.by))}${onlineDot(m.by, on)}</span>`}</div>
          <div class="msg-body">
            ${cont ? '' : `<div class="msg-h"><b>${esc(nameOf(m.by))}</b>${mine ? '<span class="you">you</span>' : ''}<span class="tiny muted">${esc(empById(m.by)?.designation || '')}</span><span class="tiny muted">${hm(m.at)}</span>${pinned.has(m.id) ? '<span class="tiny">📌</span>' : ''}</div>`}
            ${m.deleted ? '<i class="muted small">Message deleted</i>' : `${m.reply ? `<button class="quote" data-a="chat-jump" data-m="${m.reply.id}"><b class="tiny">${esc(nameOf(m.reply.by))}</b><span class="tiny trunc" style="display:block">${esc(m.reply.text)}</span></button>` : ''}${m.file ? (m.file.voice ? voiceChip(m.file) : fileChip(m.file, m.id)) : ''}${m.text ? `<div class="btext">${fmtMsg(m)}${m.edited ? ' <span class="tiny muted">(edited)</span>' : ''}</div>` : ''}`}
            ${Object.keys(rxBy).length ? `<div class="rxs">${Object.entries(rxBy).map(([e, bys]) => `<button class="rxp ${bys.includes(S.me.id) ? 'on' : ''}" data-a="chat-react" data-m="${m.id}" data-e="${e}" title="${esc(bys.map(nameOf).join(', '))}">${e} <b>${bys.length}</b></button>`).join('')}<button class="rxp add" data-a="chat-pick" data-m="${m.id}" aria-label="Add reaction">+</button></div>` : ''}
            ${CH2.picker === m.id ? `<div class="rx-picker">${EMOJI.map((e) => `<button data-a="chat-react" data-m="${m.id}" data-e="${e}">${e}</button>`).join('')}</div>` : ''}
          </div>
          ${m.deleted ? '' : `<div class="msg-tools" role="toolbar" aria-label="Message actions">${QUICK_RX.slice(0, 3).map((e) => `<button data-a="chat-react" data-m="${m.id}" data-e="${e}" title="React ${e}">${e}</button>`).join('')}<button data-a="chat-pick" data-m="${m.id}" title="More reactions">😊+</button><button data-a="chat-reply" data-m="${m.id}" title="Reply">↩</button><button data-a="chat-pin" data-m="${m.id}" title="${pinned.has(m.id) ? 'Unpin' : 'Pin'}">📌</button>${mine && m.text ? `<button data-a="chat-edit" data-m="${m.id}" title="Edit">✎</button>` : ''}${m.text ? `<button data-a="chat-task" data-m="${m.id}" title="Make a task">☑</button>` : ''}${mine ? `<button data-a="chat-del" data-m="${m.id}" title="Delete">🗑</button>` : ''}</div>`}
        </div>`;
      }).join('')}</div>`;
    }
    const canWrite = !S.readonly && (c.kind !== 'all' || isHR() || !c.hrOnly);
    const ed = CH2.editing;
    main = `<section class="chat-main">
      <header class="chat-head"><button class="btn ghost sm chat-back" data-a="chat-close" aria-label="Back to chats">‹</button>
        <span class="av-wrap">${c.kind === 'dm' ? avatar(c.title) : `<span class="av chav ck-${c.kind}">${c.kind === 'all' ? '★' : c.kind === 'dept' ? '#' : esc(initials(c.title))}</span>`}${other ? onlineDot(other, on) : ''}</span>
        <div class="grow" style="min-width:0"><b class="trunc" style="display:block">${esc(c.title)}</b><span class="tiny ${typ.length ? 'typing-t' : 'muted'}">${typ.length ? `${esc(typ.join(', '))} ${typ.length > 1 ? 'are' : 'is'} typing…` : c.kind === 'dm' ? `${esc(empById(other)?.designation || '')}${on.has(other) ? ' · <span class="on-t">online</span>' : ''}` : `${members.length} members · ${members.filter((x) => on.has(x)).length} online${c.kind === 'dept' ? ' · department' : c.kind === 'all' ? ' · whole company' : ''}`}</span></div>
        <input class="i" id="ch-find" data-i="chFind" placeholder="Search · #tag" value="${esc(ui('chFind', ''))}" style="width:170px">
        <button class="btn ghost sm" data-a="chat-fav" title="${fav.has(c.id) ? 'Unstar' : 'Star'} this chat" aria-pressed="${fav.has(c.id)}">${fav.has(c.id) ? '★' : '☆'}</button>
      </header>
      <div class="tabs chat-tabs">${[['msgs', 'Messages'], ['pins', `Pinned${pins.length ? ` (${pins.length})` : ''}`], ['files', `Files (${msgs.filter((m) => m.file && !m.deleted).length})`], ['members', `Members (${members.length})`]].map(([k, l]) => `<button class="tab" aria-selected="${tab === k}" data-a="ui" data-k="chTab" data-v="${k}">${l}</button>`).join('')}</div>
      ${body}
      ${tab === 'msgs' && canWrite ? `<form data-f="chat-send" class="composer">
        ${ed ? `<div class="quote row" style="justify-content:space-between;flex-wrap:nowrap;border-color:var(--c-amber)"><span class="trunc tiny"><b>Editing your message</b> — Enter to save, Esc to cancel</span><button type="button" class="btn ghost sm" data-a="chat-unedit">✕</button></div>` : ''}
        ${CHAT.replyTo ? `<div class="quote row" style="justify-content:space-between;flex-wrap:nowrap"><span class="trunc tiny">Replying to <b>${esc(nameOf(CHAT.replyTo.by))}</b>: ${esc(CHAT.replyTo.text || CHAT.replyTo.file?.name || '')}</span><button type="button" class="btn ghost sm" data-a="chat-unreply">✕</button></div>` : ''}
        ${CHAT.uploading ? `<div class="tiny muted">Uploading ${esc(CHAT.uploading)}…</div>` : ''}
        <div class="comp-box"><div id="men-pop" class="men-pop" ${CH2.pop ? '' : 'hidden'}>${menPopHtml()}</div>
          ${VOICE.rec ? voiceBar() : ''}
          <textarea class="i" id="ch-text" name="text" rows="1" placeholder="Message ${esc(c.kind === 'dm' ? c.title : '#' + c.title)} · @ to tag someone · # to tag a topic">${ed ? esc(ed.text) : ''}</textarea>
          <div class="comp-bar"><span class="row" style="gap:2px"><label class="cbtn" title="Share a document (PDF, Excel, Word, PowerPoint, images, CSV, ZIP)">📎<input type="file" id="ch-file" data-c="chatFile" hidden></label>${VOICE.rec ? '' : '<button type="button" class="cbtn" data-a="chat-voice" title="Record a voice message" aria-label="Record a voice message">🎤</button>'}<button type="button" class="cbtn" data-a="chat-at" title="Tag someone">@</button><button type="button" class="cbtn" data-a="chat-hash" title="Add a topic tag">#</button><button type="button" class="cbtn" data-a="chat-emo" title="Emoji">😊</button><button type="button" class="cbtn" data-a="chat-fmt" data-w="*" title="Bold"><b>B</b></button><button type="button" class="cbtn" data-a="chat-fmt" data-w="_" title="Italic"><i>I</i></button></span>
            <span class="row" style="gap:8px"><span class="tiny muted hide-sm">Shift+Enter for a new line</span><button class="btn pri sm" type="submit">${ed ? 'Save' : 'Send'}</button></span></div>
          ${CH2.emo ? `<div class="emo-pop">${EMOJI.map((e) => `<button type="button" data-a="chat-ins" data-t="${e}">${e}</button>`).join('')}</div>` : ''}</div></form>` : ''}
    </section>`;
  }
  return shell(`<div class="chat-wrap ${openId ? 'open' : ''}">${side}${main}</div>`, 'Chats', 'Channels, groups and direct messages — tag people with @, topics with #', '<button class="btn pri" data-a="chat-new">+ Group</button>');
}

/* ── @ / # autocomplete ── */
function menCandidates(kind, q) {
  q = q.toLowerCase();
  if (kind === '#') {
    const seen = {}; for (const m of messagesOf()) for (const t of m.tags || tagsOf(m.text || '')) seen[t] = (seen[t] || 0) + 1;
    const base = ['urgent', 'todo', 'decision', 'followup', 'invoice', 'dispatch', 'payment', 'meeting'];
    for (const b of base) seen[b] = seen[b] || 0;
    return Object.entries(seen).filter(([t]) => t.startsWith(q)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => ({ k: '#', v: t, label: '#' + t, sub: n ? `${n} message(s)` : 'new topic' }));
  }
  const c = myChats().find((x) => x.id === CHAT.openId); if (!c) return [];
  const on = onlineIds();
  const ppl = chatMembers(c).filter((id) => id !== S.me.id).map(empById).filter(Boolean).filter((e) => !q || e.name.toLowerCase().split(/\s+/).some((p) => p.startsWith(q)) || e.name.toLowerCase().startsWith(q)).sort((a, b) => on.has(b.id) - on.has(a.id) || a.name.localeCompare(b.name)).slice(0, 7)
    .map((e) => ({ k: '@', v: e.name, id: e.id, label: e.name, sub: `${e.designation || ''}${on.has(e.id) ? ' · online' : ''}` }));
  const extra = c.kind !== 'dm' && 'everyone'.startsWith(q) ? [{ k: '@', v: 'everyone', label: '@everyone', sub: `Notify all ${chatMembers(c).length} members` }] : [];
  return [...ppl, ...extra];
}
function menPopHtml() {
  const p = CH2.pop; if (!p || !p.items.length) return '';
  return p.items.map((it, i) => `<button type="button" class="men-it ${i === p.idx ? 'on' : ''}" data-a="chat-men-pick" data-i="${i}">${it.k === '@' && it.id ? avatar(it.v) : `<span class="av chav ck-ment">${it.k}</span>`}<span class="grow" style="min-width:0"><b class="small">${esc(it.label)}</b><span class="tiny muted" style="display:block">${esc(it.sub)}</span></span></button>`).join('');
}
function menUpdate(ta) {
  const pos = ta.selectionStart, before = ta.value.slice(0, pos), mm = before.match(/(^|\s)([@#])([\w.-]*)$/);
  if (!mm) { if (CH2.pop) { CH2.pop = null; menPaint(); } return; }
  const items = menCandidates(mm[2], mm[3]);
  CH2.pop = items.length ? { kind: mm[2], start: pos - mm[3].length - 1, items, idx: Math.min(CH2.pop?.idx || 0, items.length - 1) } : null;
  menPaint();
}
function menPaint() { const el = document.getElementById('men-pop'); if (!el) return; el.hidden = !CH2.pop; el.innerHTML = menPopHtml(); }
function menPick(i) {
  const ta = document.getElementById('ch-text'), p = CH2.pop; if (!ta || !p) return;
  const it = p.items[i]; if (!it) return;
  const ins = (it.k === '@' ? '@' : '#') + it.v + ' ';
  ta.value = ta.value.slice(0, p.start) + ins + ta.value.slice(ta.selectionStart);
  const at = p.start + ins.length; ta.focus(); ta.setSelectionRange(at, at);
  CH2.pop = null; menPaint(); autosize(ta);
}
const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight + 2) + 'px'; };
function insertAtCaret(txt, wrap) {
  const ta = document.getElementById('ch-text'); if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
  const ins = wrap ? `${wrap}${sel || 'text'}${wrap}` : txt;
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e); ta.focus();
  const at = wrap && !sel ? s + 1 : s + ins.length; ta.setSelectionRange(at, wrap && !sel ? at + 4 : at); autosize(ta);
}
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'ch-text') return;
  autosize(ev.target); menUpdate(ev.target);
  setPresence({ typing: !!ev.target.value.trim() }); clearTimeout(CH2.typingT); CH2.typingT = setTimeout(() => setPresence({ typing: false }), 3500);
});
document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k' && S.me && S.view) { ev.preventDefault(); openCmdk(); return; }
  if (ev.target.id === 'cmdk-q') { cmdkKey(ev); return; }
  if (ev.target.id !== 'ch-text') return;
  if (CH2.pop) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); CH2.pop.idx = (CH2.pop.idx + (ev.key === 'ArrowDown' ? 1 : -1) + CH2.pop.items.length) % CH2.pop.items.length; menPaint(); return; }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); menPick(CH2.pop.idx); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); CH2.pop = null; menPaint(); return; }
  }
  if (ev.key === 'Escape' && CH2.editing) { ev.stopPropagation(); CH2.editing = null; ev.target.value = ''; schedule(); }
  if (ev.key === 'ArrowUp' && !ev.target.value && !CH2.editing) { const last = messagesOf().filter((m) => m.by === S.me.id && m.text && !m.deleted).pop(); if (last) { ev.preventDefault(); CH2.editing = last; schedule(); setTimeout(() => { const t = $('#ch-text'); if (t) { t.value = last.text; autosize(t); t.focus(); } }, 30); } }
}, true);

/* ── actions ── */
async function chatAction2(a, el, ev) {
  const msg = () => messagesOf().find((m) => m.id === el.dataset.m);
  const c = () => myChats().find((x) => x.id === CHAT.openId);
  switch (a) {
    case 'chat-open': voiceStop(true); CH2.picker = null; CH2.emo = false; CHAT.replyTo = null; CH2.editing = null; S.ui.chat = el.dataset.id; S.ui.chTab = 'msgs'; S.ui.chFind = ''; CHAT.stick = true; viewChanged = false; schedule(); setTimeout(() => document.getElementById('ch-text')?.focus(), 60); return;
    case 'chat-men-pick': return menPick(+el.dataset.i);
    case 'chat-at': case 'chat-hash': { const ta = $('#ch-text'); if (!ta) return; const s = ta.selectionStart, pre = s && !/\s/.test(ta.value[s - 1]) ? ' ' : ''; insertAtCaret(pre + (a === 'chat-at' ? '@' : '#')); menUpdate(ta); return; }
    case 'chat-emo': CH2.emo = !CH2.emo; return schedule();
    case 'chat-ins': CH2.emo = false; schedule(); setTimeout(() => insertAtCaret(el.dataset.t), 20); return;
    case 'chat-fmt': return insertAtCaret('', el.dataset.w);
    case 'chat-pick': CH2.picker = CH2.picker === el.dataset.m ? null : el.dataset.m; return schedule();
    case 'chat-react': CH2.picker = null; return act(() => react(el.dataset.m, el.dataset.e));
    case 'chat-tag': S.ui.chFind = '#' + el.dataset.t.toLowerCase(); S.ui.chTab = 'msgs'; return schedule();
    case 'chat-fav': { const fav = new Set(CHAT.reads._fav || []); fav.has(CHAT.openId) ? fav.delete(CHAT.openId) : fav.add(CHAT.openId); CHAT.reads = { ...CHAT.reads, _fav: [...fav] }; schedule(); return S.db.doc(`data/users/${S.uid}/reads`).set(clean(CHAT.reads)).catch(() => toast('Couldn’t save — try again.', 'bad')); }
    case 'chat-edit': { const m = msg(); CH2.editing = m; schedule(); setTimeout(() => { const t = $('#ch-text'); if (t) { t.value = m.text; autosize(t); t.focus(); } }, 30); return; }
    case 'chat-unedit': CH2.editing = null; { const t = $('#ch-text'); if (t) t.value = ''; } return schedule();
    case 'chat-pin': return act(async () => {
      const ch = c(), m = msg(); await ensureChatDoc(ch);
      const pins = ch.pins || [], has = pins.some((p) => p.id === m.id);
      await patch(`chat/${ch.id}`, { pins: has ? pins.filter((p) => p.id !== m.id) : [...pins, { id: m.id, by: m.by, at: m.at, text: (m.text || m.file?.name || '').slice(0, 200), pinnedBy: S.me.id }].slice(-30) });
    }, msg()?.id && (c()?.pins || []).some((p) => p.id === msg().id) ? 'Unpinned' : 'Pinned');
    case 'chat-jump': { S.ui.chTab = 'msgs'; S.ui.chFind = ''; CHAT.stick = false; schedule(); setTimeout(() => { const n = document.getElementById('m-' + el.dataset.m); if (n) { n.scrollIntoView({ block: 'center' }); n.classList.add('flash'); setTimeout(() => n.classList.remove('flash'), 1600); } else toast('That message is older than this view shows.', 'warn'); }, 80); return; }
    case 'chat-ment': { const n = S.ntf.find((x) => x.id === el.dataset.id); if (!n) return; if (!n.read) act(() => patch(`ntf/${n.id}`, { read: true })); S.ui.chat = n.go.chat; S.ui.chTab = 'msgs'; S.ui.chFind = ''; schedule(); if (n.go.msg) setTimeout(() => chatAction2('chat-jump', { dataset: { m: n.go.msg } }), 400); return; }
    case 'chat-ment-read': return act(async () => { for (const n of S.ntf.filter((x) => x.go?.chat && /mentioned you|replied to you/.test(x.title) && !x.read)) await patch(`ntf/${n.id}`, { read: true }); }, 'All marked read');
    case 'chat-voice': return voiceStart();
    case 'chat-voice-send': return voiceStop(false);
    case 'chat-voice-cancel': return voiceStop(true);
    case 'chat-delete': return groupDeleteAsk();
    default: return chatAction(a, el, ev);
  }
}
async function chatSubmit2(f, form, fd) {
  if (f !== 'chat-send') return chatSubmit(f, form, fd);
  const ta = $('#ch-text'), text = ta?.value || '';
  if (!text.trim()) return;
  if (CH2.pop) return;
  ta.value = ''; ta.defaultValue = ''; ta.style.height = '';
  setPresence({ typing: false }); CHAT.stick = true;
  if (CH2.editing) {
    const m = CH2.editing, ch = myChats().find((x) => x.id === CHAT.openId);
    const ok = await act(() => editMine(m.id, { text: text.trim(), edited: true, mentions: mentionsOf(text, ch), tags: tagsOf(text) }));
    if (ok) { CH2.editing = null; schedule(); } else ta.value = text;
    return;
  }
  const ok = await act(() => sendMessage(text));
  if (!ok && ta) ta.value = text;
}

/* ── group admin: the person who creates a group can rename it, change members and delete it ── */
const isGroupAdmin = (c) => !!c && c.kind === 'group' && (c.admins || [c.createdBy]).includes(S.me.id);
function groupDeleteAsk() {
  const c = myChats().find((x) => x.id === CHAT.openId);
  if (!isGroupAdmin(c)) return toast('Only the group admin can delete this group.', 'warn');
  return confirmBox(`Delete “${c.name}”?`, 'The group, its messages and shared files are removed for everyone. This can’t be undone.', () => groupDelete(c));
}
async function groupDelete(c) {
  await act(async () => {
    // Files and messages go first: the server only lets the admin delete them while the group still exists.
    const snap = await S.db.collection(`chat/${c.id}/b`).get();
    for (const b of docsOf(snap)) {
      for (const m of b.msgs || []) if (m.file?.fid) for (let i = 0; i < (m.file.chunks || 0); i++) await docRef(`blob/${m.file.fid}_${i}`).delete();
      await docRef(`chat/${c.id}/b/${b.id}`).delete();
    }
    await docRef(`chat/${c.id}`).delete();
    S.ui.chat = null; CHAT.openId = null; CHAT.unsub?.(); CHAT.unsub = null;
  }, 'Group deleted');
}

/* ── voice messages: recorded in the browser, sent as a chunked audio file, played inline ── */
const VOICE = { rec: null, stream: null, parts: [], t0: 0, timer: null, cancel: false, mime: '', chatId: null, starting: false };
const VOICE_MAX_MS = 5 * 60000;
const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const voiceChip = (f) => `<div class="voice-note"><audio controls preload="none" data-lazy="${esc(f.fid)}" aria-label="Voice message, ${fmtSecs(f.dur || 0)}"></audio><span class="tiny muted">${f.dur ? fmtSecs(f.dur) : ''} · voice</span></div>`;
const voiceBar = () => `<div class="voice-bar"><span class="rec-dot" aria-hidden="true"></span><b id="voice-t">${fmtSecs(Math.floor((Date.now() - VOICE.t0) / 1000))}</b><span class="tiny muted grow">Recording… (max 5 min)</span><button type="button" class="btn ghost sm" data-a="chat-voice-cancel">Cancel</button><button type="button" class="btn pri sm" data-a="chat-voice-send">Send voice</button></div>`;
async function voiceStart() {
  if (VOICE.rec || VOICE.starting) return;
  if (!CHAT.openId) return toast('Open a chat first.', 'warn');
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return toast('Voice messages aren’t supported in this browser.', 'warn');
  VOICE.starting = true;
  try {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast('Allow microphone access to send a voice message.', 'warn'); }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    Object.assign(VOICE, { rec, stream, parts: [], t0: Date.now(), cancel: false, mime: rec.mimeType || type || 'audio/webm', chatId: CHAT.openId });
    rec.ondataavailable = (e) => { if (e.data?.size) VOICE.parts.push(e.data); };
    rec.onstop = voiceFinish;
    rec.start(1000);
    VOICE.timer = setInterval(() => {
      const el = document.getElementById('voice-t');
      if (el) el.textContent = fmtSecs(Math.floor((Date.now() - VOICE.t0) / 1000));
      if (Date.now() - VOICE.t0 >= VOICE_MAX_MS) voiceStop(false);
    }, 500);
    schedule();
  } finally { VOICE.starting = false; }
}
function voiceStop(cancel) {
  if (!VOICE.rec) return;
  VOICE.cancel = cancel;
  if (VOICE.rec.state !== 'inactive') VOICE.rec.stop();
}
async function voiceFinish() {
  const { parts, mime, cancel, chatId, t0, stream, timer } = VOICE;
  clearInterval(timer);
  stream?.getTracks().forEach((t) => t.stop());
  Object.assign(VOICE, { rec: null, stream: null, parts: [], timer: null });
  const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
  schedule();
  if (cancel) return;
  if (CHAT.openId !== chatId) return toast('Voice message discarded — you switched chats.', 'warn');
  const blob = new Blob(parts, { type: mime });
  if (!blob.size) return toast('Nothing was recorded.', 'warn');
  if (blob.size > MAX_CHUNKED) return toast('That voice message is too long to send. Try a shorter one.', 'warn');
  const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
  await act(async () => {
    try {
      const { fid, chunks } = await putChunked(new Uint8Array(await blob.arrayBuffer()), 'Voice message');
      CHAT.stick = true;
      await sendMessage('', { name: 'Voice message', size: blob.size, ext, mime, fid, chunks, voice: true, dur: secs });
    } finally { CHAT.uploading = null; schedule(); }
  });
}

/* ── quick search / command palette (Ctrl/⌘ K) ── */
const CMDK = { idx: 0 };
function openCmdk() { if (!S.me || isAuthed() !== true) return; CMDK.idx = 0; S.ui.cmdq = ''; openModal(cmdkModal); setTimeout(() => $('#cmdk-q')?.focus(), 30); }
function cmdkItems() {
  const q = (S.ui.cmdq || '').trim().toLowerCase(), out = [];
  const vis = VIEWS.filter((v) => v[2]());
  const has = (s) => String(s || '').toLowerCase().includes(q);
  for (const [k, l] of vis) if (!q || has(l)) out.push({ g: 'Go to', ico: k, label: l, a: 'nav', v: k });
  if (canSalary() && (!q || has('salary payroll'))) out.push({ g: 'Go to', ico: 'attendance', label: 'Salary sheet & payroll', a: 'cmdk-tab', v: 'attendance', tab: ['attTab', 'salary'] });
  if (q) {
    [['Apply for leave', 'apply-leave'], ['New task', 'new-task'], ['New expense claim', 'claim-new'], ['Raise a request', 'new-req'], ['New group chat', 'chat-new'], ['My account & password', 'acct']].filter(([l]) => has(l)).forEach(([l, a]) => out.push({ g: 'Actions', ico: 'more', label: l, a }));
    active().filter((e) => has(e.name) || has(e.code) || has(e.designation)).slice(0, 6).forEach((e) => out.push({ g: 'People', av: e.name, label: e.name, sub: `${e.code || ''} · ${e.designation || ''}`, a: e.id === S.me.id ? 'acct' : 'dm', id: e.id }));
    S.tasks.filter((t) => (canSee(t.assigneeId) || t.assignerId === S.me.id) && (has(t.title) || has(t.code))).slice(0, 6).forEach((t) => out.push({ g: 'Tasks', ico: 'tasks', label: `${t.code} · ${t.title}`, sub: `${nameOf(t.assigneeId)} · due ${fmtDs(t.due)}`, a: 'task', id: t.id }));
    S.reqs.filter((r) => (r.empId === S.me.id || curStep(r)?.by === S.me.id || canSee(r.empId)) && (has(r.title) || has(r.code))).slice(0, 6).forEach((r) => out.push({ g: 'Requests', ico: 'approvals', label: `${r.code} · ${r.title}`, sub: `${nameOf(r.empId)} · ${RSTAT[r.status]?.[0] || r.status}`, a: 'req', id: r.id }));
    myChats().filter((c) => has(c.title)).slice(0, 5).forEach((c) => out.push({ g: 'Chats', ico: 'chats', label: c.title, sub: c.kind === 'dm' ? 'Direct message' : `${chatMembers(c).length} members`, a: 'cmdk-chat', id: c.id }));
  }
  return out.slice(0, 30);
}
function cmdkModal() {
  const items = cmdkItems(); CMDK.idx = Math.min(CMDK.idx, Math.max(0, items.length - 1));
  let g = '';
  return `<div class="cmdk"><div class="cmdk-in"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4"/></svg><input class="i" id="cmdk-q" data-i="cmdq" value="${esc(S.ui.cmdq || '')}" placeholder="Search people, tasks, requests, chats — or jump to a page" autocomplete="off"><kbd>Esc</kbd></div>
    <div class="cmdk-list">${items.map((it, i) => { const head = it.g !== g ? `<div class="cmdk-g">${(g = it.g)}</div>` : ''; return `${head}<button class="cmdk-it ${i === CMDK.idx ? 'on' : ''}" data-a="cmdk-go" data-i="${i}">${it.av ? avatar(it.av) : `<span class="cmdk-ico">${ico(it.ico)}</span>`}<span class="grow" style="min-width:0"><span class="trunc" style="display:block">${esc(it.label)}</span>${it.sub ? `<span class="tiny muted trunc" style="display:block">${esc(it.sub)}</span>` : ''}</span><span class="tiny muted">↵</span></button>`; }).join('') || empty('Nothing matches.')}</div>
    <div class="cmdk-foot tiny muted">↑ ↓ to move · Enter to open · Ctrl/⌘ K anywhere</div></div>`;
}
function cmdkKey(ev) {
  const items = cmdkItems();
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); CMDK.idx = (CMDK.idx + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); drawModal(); }
  if (ev.key === 'Enter') { ev.preventDefault(); cmdkRun(items[CMDK.idx]); }
}
function cmdkRun(it) {
  if (!it) return;
  closeModal();
  const fake = { dataset: { v: it.v, id: it.id, go: it.v } };
  if (it.a === 'cmdk-tab') { S.ui[it.tab[0]] = it.tab[1]; return setView(it.v); }
  if (it.a === 'cmdk-chat') { S.ui.chat = it.id; S.ui.chTab = 'msgs'; return setView('chats'); }
  onAction(it.a, fake, new Event('click'));
}
</script>
<style>
/* ── chat 2.0 ── */
.chat-wrap{grid-template-columns:300px minmax(0,1fr);height:calc(100vh - 140px);box-shadow:0 1px 2px rgba(20,40,30,.05)}
.chat-side{background:color-mix(in srgb,var(--c-sky) 4%,var(--surface))}
.chat-side-top{display:flex;gap:6px;padding:10px;flex-wrap:nowrap}
.chat-item{border-bottom:0;border-radius:10px;margin:1px 6px;width:calc(100% - 12px);padding:8px 8px}
.chat-item.on{background:color-mix(in srgb,var(--c-sky) 16%,var(--surface))}
.chat-item.unread b{font-weight:700}
.chat-item.ment{margin-top:4px}
.av-wrap{position:relative;display:inline-flex;flex:none;border:0;background:none;padding:0;cursor:pointer}
.ondot{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:#2fb36d;border:2px solid var(--surface)}
.chav{color:#fff;font-weight:700}
.ck-all{background:var(--c-gold)} .ck-dept{background:var(--c-sky)} .ck-group{background:var(--c-violet)} .ck-ment{background:var(--c-coral)}
.typing-t{color:var(--c-teal);font-style:italic} .on-t{color:#2fb36d;font-weight:600}
.online-row{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 14px}
.chat-head{gap:10px}
.chat-tabs{margin:0;padding:0 10px;background:var(--surface)}
.chat-msgs{gap:0;padding:8px 0 12px;background:var(--surface)}
.msg{display:grid;grid-template-columns:52px minmax(0,1fr);gap:0;padding:6px 16px 4px 8px;position:relative;border-left:3px solid transparent}
.msg.cont{padding-top:1px}
.msg:hover{background:color-mix(in srgb,var(--sunk) 60%,transparent)}
.msg.hl{background:color-mix(in srgb,var(--c-amber) 10%,transparent);border-left-color:var(--c-amber)}
.msg.pinned{border-left-color:var(--c-coral)}
.msg.flash{animation:flash 1.6s ease-out}@keyframes flash{0%{background:color-mix(in srgb,var(--c-sky) 30%,transparent)}100%{background:transparent}}
.msg-av{display:flex;justify-content:center;padding-top:2px}
.msg-av .av{width:36px;height:36px;font-size:13px}
.msg-t{font-size:.66rem;color:var(--muted);visibility:hidden;padding-top:3px}
.msg:hover .msg-t{visibility:visible}
.msg-h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.msg-h b{font-size:.92rem}
.you{font-size:.62rem;background:var(--sunk);color:var(--muted);border-radius:4px;padding:0 4px;text-transform:uppercase;letter-spacing:.05em}
.msg .btext{font-size:.92rem;line-height:1.5}
.btext code{font-family:var(--f-mono);font-size:.84em;background:var(--sunk);border:1px solid var(--line);border-radius:4px;padding:0 4px}
.men{display:inline;border:0;padding:0 3px;border-radius:4px;background:color-mix(in srgb,var(--c-sky) 15%,transparent);color:var(--c-sky);font-weight:600;cursor:pointer;font-size:inherit}
.men.me{background:color-mix(in srgb,var(--c-amber) 22%,transparent);color:color-mix(in srgb,var(--c-amber) 80%,var(--ink))}
.htag{display:inline;border:0;padding:0 2px;background:none;color:var(--c-violet);font-weight:600;cursor:pointer;font-size:inherit}
.htag:hover{text-decoration:underline}
.msg .quote{display:block;width:100%;text-align:left;border:0;border-left:3px solid var(--c-sky);cursor:pointer;color:var(--ink)}
.msg-sys{text-align:center;font-size:.74rem;color:var(--muted);padding:6px 0}
.msg-tools{position:absolute;right:14px;top:-14px;display:none;background:var(--surface);border:1px solid var(--line);border-radius:9px;box-shadow:var(--shadow);padding:2px;z-index:2}
.msg:hover .msg-tools,.msg:focus-within .msg-tools{display:flex}
.msg-tools button{border:0;background:none;border-radius:6px;padding:3px 6px;cursor:pointer;font-size:.9rem;color:var(--ink)}
.msg-tools button:hover{background:var(--sunk)}
@media (hover:none){.msg-tools{position:static;display:flex;box-shadow:none;border:0;grid-column:2;justify-self:start;margin-top:2px;padding:0}}
.rxs{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.rxp{border:1px solid var(--line);background:var(--surface);border-radius:99px;padding:0 8px;font-size:.8rem;cursor:pointer;line-height:1.7}
.rxp.on{border-color:var(--c-sky);background:color-mix(in srgb,var(--c-sky) 14%,var(--surface))}
.rxp.add{color:var(--muted)}
.rx-picker,.emo-pop{display:flex;flex-wrap:wrap;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:4px;margin-top:4px;width:max-content;max-width:100%}
.rx-picker button,.emo-pop button{border:0;background:none;font-size:1.15rem;padding:3px 5px;border-radius:6px;cursor:pointer}.rx-picker button:hover,.emo-pop button:hover{background:var(--sunk)}
.newline{display:flex;align-items:center;gap:8px;margin:8px 16px;color:var(--c-coral);font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.newline::before,.newline::after{content:"";flex:1;height:1px;background:var(--c-coral)}
.chat-day{position:sticky;top:0;z-index:1}
.pinbar{display:flex;gap:8px;align-items:center;width:100%;border:0;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--c-coral) 8%,var(--surface));padding:7px 14px;font-size:.84rem;cursor:pointer;text-align:left;color:var(--ink);min-width:0}
.filterbar{padding:6px 14px;font-size:.84rem;background:color-mix(in srgb,var(--c-violet) 8%,var(--surface));border-bottom:1px solid var(--line)}
.pin-row,.ment-row{display:flex;gap:10px;align-items:flex-start;width:100%;border:1px solid var(--line);background:var(--surface);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--ink)}
.ment-row{border:0;border-bottom:1px solid var(--line);border-radius:0}.ment-row.new{background:color-mix(in srgb,var(--c-amber) 9%,var(--surface))}
.composer{padding:10px 14px 12px}
.comp-box{position:relative;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.comp-box:focus-within{border-color:var(--c-sky);box-shadow:0 0 0 3px color-mix(in srgb,var(--c-sky) 18%,transparent)}
.comp-box textarea{border:0;box-shadow:none!important;min-height:44px;max-height:160px;resize:none;background:transparent;padding:10px 12px}
.comp-bar{display:flex;justify-content:space-between;align-items:center;padding:4px 6px 6px;border-top:1px solid color-mix(in srgb,var(--line) 60%,transparent)}
.cbtn{border:0;background:none;border-radius:7px;min-width:30px;height:30px;cursor:pointer;color:var(--muted);font-size:.95rem;display:inline-grid;place-items:center}
.cbtn:hover{background:var(--sunk);color:var(--ink)}
.men-pop{position:absolute;left:8px;right:8px;bottom:calc(100% + 6px);background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:4px;max-height:280px;overflow:auto;z-index:5}
.men-it{display:flex;gap:10px;align-items:center;width:100%;border:0;background:none;border-radius:8px;padding:6px 8px;cursor:pointer;color:var(--ink);text-align:left}
.men-it.on,.men-it:hover{background:color-mix(in srgb,var(--c-sky) 13%,var(--surface))}
.emo-pop{position:absolute;bottom:44px;left:6px;z-index:5}
.voice-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 10px;margin:4px 6px 0;border-radius:10px;background:color-mix(in srgb,var(--c-coral) 10%,var(--surface));font-size:.86rem}
.rec-dot{width:10px;height:10px;border-radius:50%;background:var(--c-coral);flex:none;animation:recpulse 1.2s ease-in-out infinite}
@keyframes recpulse{50%{opacity:.25}}
.voice-note{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:3px 0}
.voice-note audio{max-width:min(300px,100%);height:36px}
/* ── quick search ── */
.modal:has(.cmdk){width:min(640px,100%);overflow:hidden}
.cmdk-in{display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line)}
.cmdk-in .i{border:0;box-shadow:none!important;font-size:1.02rem;padding:6px 0}
kbd{font:600 .7rem var(--f-mono);border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;padding:1px 6px;color:var(--muted);background:var(--sunk)}
.cmdk-list{max-height:min(60vh,460px);overflow:auto;padding:6px}
.cmdk-g{font-size:.66rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);padding:10px 10px 4px;font-weight:600}
.cmdk-it{display:flex;gap:10px;align-items:center;width:100%;border:0;background:none;border-radius:9px;padding:8px 10px;cursor:pointer;text-align:left;color:var(--ink)}
.cmdk-it.on,.cmdk-it:hover{background:color-mix(in srgb,var(--sec,var(--accent)) 12%,var(--surface))}
.cmdk-ico{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:var(--sunk);color:var(--muted);flex:none}
.cmdk-foot{padding:8px 14px;border-top:1px solid var(--line)}
.searchbtn{color:var(--muted)}
@media (max-width:860px){.chat-wrap{height:calc(100vh - 200px)}.msg{grid-template-columns:44px minmax(0,1fr)}.msg-av .av{width:30px;height:30px}}
</style>
