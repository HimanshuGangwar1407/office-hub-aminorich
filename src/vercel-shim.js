<script>
/* ═════════════ OfficeHub on Vercel — browser bridge ═════════════
   The app was first built as a Claude artifact, which talks to `window.claude.use('db' | 'user' | …)`.
   This file provides the same small API backed by OfficeHub's own server (/api/*) and Postgres:
   - db: a local mirror of every record you may read, kept fresh by polling /api/sync; queries run locally.
   - user: who is signed in (server session cookie). Signed-out visitors get the sign-in / sign-up screen.
   - room: "online now" / "typing…" through the same sync call.  downloads: normal browser downloads. */
(function () {
  'use strict';
  const POLL_MS = 5000, POLL_HIDDEN_MS = 45000, PRESENCE_EVERY_MS = 20000;

  async function api(path, body, method) {
    const r = await fetch('/api/' + path, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    let j = null; try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) { const e = new Error((j && j.message) || `Request failed (${r.status})`); e.code = (j && j.code) || (r.status === 401 ? 'unauthenticated' : r.status === 403 ? 'permission_denied' : 'unavailable'); e.status = r.status; throw e; }
    return j || {};
  }

  /* ── session ── */
  let sessionP = null;
  const getSession = () => (sessionP = sessionP || api('session').catch((e) => (e.status === 401 ? null : Promise.reject(e))));

  /* ── local mirror ── */
  const docs = new Map();          // path -> { d: data, v }
  const listeners = new Set();
  let since = 0, scope = null, synced = false, syncWaiters = [], timer = 0, busy = false;
  const peer = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let presence = null, presenceDirty = false, presenceSent = 0, peers = [], peerFns = new Set();
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const parentOf = (p) => p.split('/').slice(0, -1).join('/');
  const idOf = (p) => p.split('/').pop();
  const ready = () => (synced ? Promise.resolve() : new Promise((r) => syncWaiters.push(r)));
  const autoId = () => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const b = crypto.getRandomValues(new Uint8Array(20)); for (const x of b) s += a[x % 36]; return s; };
  const fieldOf = (d, f) => f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
  const cmp = (a, b) => (a === b ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : 1);

  function docSnap(path, entry) {
    const data = entry ? entry.d : undefined;
    return { id: idOf(path), ref: { path, id: idOf(path) }, exists: !!entry, data: () => clone(data), get: (f) => clone(fieldOf(data, f)), metadata: { hasPendingWrites: !!(entry && entry.pending) } };
  }
  function runQuery(qy) {
    let out = [];
    for (const [p, e] of docs) if (parentOf(p) === qy.coll && qy.wh.every((w) => match(fieldOf(e.d, w[0]), w[1], w[2]))) out.push([p, e]);
    for (const [f, dir] of qy.ob.slice().reverse()) out.sort((a, b) => cmp(fieldOf(a[1].d, f), fieldOf(b[1].d, f)) * (dir === 'desc' ? -1 : 1));
    if (!qy.ob.length) out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (qy.lim != null) out = out.slice(0, qy.lim);
    return out;
  }
  function match(v, op, x) {
    switch (op) {
      case '==': return v === x || (v == null && x == null);
      case '!=': return v !== x;
      case '<': return v != null && v < x;
      case '<=': return v != null && v <= x;
      case '>': return v != null && v > x;
      case '>=': return v != null && v >= x;
      case 'in': return Array.isArray(x) && x.includes(v);
      case 'not-in': return Array.isArray(x) && !x.includes(v);
      case 'array-contains': return Array.isArray(v) && v.includes(x);
      case 'array-contains-any': return Array.isArray(v) && Array.isArray(x) && x.some((y) => v.includes(y));
      default: throw Object.assign(new Error('Unsupported query: ' + op), { code: 'invalid_argument' });
    }
  }
  function qSnap(rows) { const ds = rows.map(([p, e]) => docSnap(p, e)); return { docs: ds, size: ds.length, empty: !ds.length, forEach: (fn) => ds.forEach(fn) }; }
  const sigOf = (rows) => rows.map(([p, e]) => p + '@' + e.v).join('|');

  function notify(changedParents) {
    for (const l of listeners) {
      if (changedParents && !changedParents.has(l.kind === 'doc' ? parentOf(l.path) : l.q.coll)) continue;
      fire(l);
    }
  }
  function fire(l) {
    try {
      if (l.kind === 'doc') { const e = docs.get(l.path); const sig = e ? String(e.v) : '-'; if (sig === l.sig) return; l.sig = sig; l.next(docSnap(l.path, e)); }
      else { const rows = runQuery(l.q); const sig = sigOf(rows); if (sig === l.sig) return; l.sig = sig; l.next(qSnap(rows)); }
    } catch (e) { console.error(e); }
  }
  function addListener(l) { listeners.add(l); ready().then(() => { if (listeners.has(l)) fire(l); }); return () => listeners.delete(l); }

  /* ── sync loop ── */
  async function sync() {
    if (busy) return; busy = true; clearTimeout(timer);
    try {
      let again = true;
      while (again) {
        const body = { since, peer };
        if (presence && (presenceDirty || Date.now() - presenceSent > PRESENCE_EVERY_MS)) { body.presence = presence; presenceDirty = false; presenceSent = Date.now(); }
        const r = await api('sync', body);
        if (scope && r.scope !== scope) { docs.clear(); since = 0; scope = r.scope; continue; } // permissions changed: reload everything
        scope = r.scope;
        const changed = new Set();
        for (const row of r.docs) {
          const cur = docs.get(row.p);
          if (cur && cur.v >= row.v && !cur.pending) continue;
          if (cur && cur.pending) continue; // our own write is in flight; its answer will settle it
          if (row.x) docs.delete(row.p); else docs.set(row.p, { d: row.d, v: row.v });
          changed.add(parentOf(row.p));
        }
        again = r.more && r.next > since;
        since = Math.max(since, r.next);
        if (Array.isArray(r.peers)) setPeers(r.peers);
        if (!synced) { synced = true; syncWaiters.splice(0).forEach((f) => f()); }
        else if (changed.size) notify(changed);
      }
      online(true);
    } catch (e) {
      if (e.status === 401) { location.reload(); return; }
      if (e.code === 'revoked') { location.reload(); return; }
      online(false);
    } finally {
      busy = false;
      timer = setTimeout(sync, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('focus', () => sync());
  let wasOnline = true;
  function online(ok) {
    if (ok === wasOnline) return; wasOnline = ok;
    let b = document.getElementById('oh-offline');
    if (!ok && !b) { b = document.createElement('div'); b.id = 'oh-offline'; b.textContent = 'Connection lost — retrying…'; b.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);background:#b3261e;color:#fff;padding:8px 14px;border-radius:999px;font:500 13px system-ui;z-index:9999'; document.body.appendChild(b); }
    if (ok && b) b.remove();
  }

  /* ── writes ── */
  async function write(op, path, data) {
    if (path.startsWith('auth/') && op === 'delete') { await api('auth/reset', { uid: path.split('/')[1] }); return; } // HR "reset password"
    const prev = docs.get(path);
    if (op === 'set') docs.set(path, { d: clone(data), v: prev ? prev.v : 0, pending: true });
    else if (op === 'update') { if (!prev) throw Object.assign(new Error('That record no longer exists.'), { code: 'not_found' }); docs.set(path, { d: { ...prev.d, ...clone(data) }, v: prev.v, pending: true }); }
    else docs.delete(path);
    notify(new Set([parentOf(path)]));
    try {
      const r = await api('write', { op, path, data: op === 'delete' ? undefined : data });
      if (op === 'delete') { /* stays deleted */ } else { const cur = docs.get(path); if (cur) docs.set(path, { d: cur.d, v: r.v }); }
      notify(new Set([parentOf(path)]));
    } catch (e) {
      if (prev) docs.set(path, prev); else docs.delete(path);
      notify(new Set([parentOf(path)]));
      throw e;
    }
  }

  /* ── db namespace (subset of the artifact db API that OfficeHub uses) ── */
  function docRef(path) {
    return {
      id: idOf(path), path,
      async get() {
        if (path.startsWith('blob/') || !synced) { const r = await api('doc?p=' + encodeURIComponent(path)); return docSnap(path, r.exists ? { d: r.data, v: r.v } : null); }
        return docSnap(path, docs.get(path));
      },
      set: (data) => write('set', path, data),
      update: (data) => write('update', path, data),
      delete: () => write('delete', path),
      acquire: (o = {}) => api('lease', { path, holder: o.holder, ttlMs: o.ttlMs }),
      onSnapshot(next, error) { return addListener({ kind: 'doc', path, next, error, sig: null }); },
    };
  }
  function query(coll, wh = [], ob = [], lim = null) {
    const qy = { coll, wh, ob, lim };
    return {
      where: (f, op, v) => query(coll, [...wh, [f, op, v]], ob, lim),
      orderBy: (f, dir = 'asc') => query(coll, wh, [...ob, [f, dir]], lim),
      limit: (n) => query(coll, wh, ob, n),
      async get() { await ready(); return qSnap(runQuery(qy)); },
      onSnapshot(next, error) { return addListener({ kind: 'query', q: qy, next, error, sig: null }); },
      doc: (id) => docRef(`${coll}/${id || autoId()}`),
    };
  }
  const db = { doc: (p) => docRef(p), collection: (p) => query(p) };

  /* ── room (presence) ── */
  function setPeers(list) {
    const now = Date.now();
    peers = list.map((p) => Object.freeze({ peer: p.peer, by: p.by, kind: 'viewer', guest: false, isMe: p.peer === peer || p.by === SESSION?.uid, sameTab: p.peer === peer, presence: Object.freeze(p.presence || {}), updatedAt: p.at || now }));
    if (presence && !peers.some((p) => p.sameTab)) peers.push(Object.freeze({ peer, by: SESSION?.uid, kind: 'viewer', guest: false, isMe: true, sameTab: true, presence: Object.freeze({ ...presence }), updatedAt: now }));
    const ch = Object.freeze({ peers: Object.freeze(peers.slice()) });
    peerFns.forEach((fn) => { try { fn(ch); } catch (e) { console.error(e); } });
  }
  const room = {
    presence(patch) { presence = { ...(presence || {}), ...patch }; for (const k in presence) if (presence[k] === null) delete presence[k]; presenceDirty = true; clearTimeout(room._t); room._t = setTimeout(sync, 400); return Promise.resolve(); },
    onPeers(fn) { peerFns.add(fn); setTimeout(() => fn(Object.freeze({ peers: Object.freeze(peers.slice()) })), 0); return () => peerFns.delete(fn); },
    emit: () => Promise.resolve(), on: () => () => {}, connected: () => true, join: () => room, leave: () => Promise.resolve(),
  };

  /* ── downloads ── */
  const downloads = {
    async save({ filename, data, type }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = filename || 'download'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
  };

  /* ── user ── */
  let SESSION = null;
  const user = {
    async me() { return { id: SESSION.uid, isOwner: !!SESSION.owner, name: SESSION.name || '', email: null, guest: false }; },
    async id() { return SESSION.uid; },
    isOwner: () => !!SESSION.owner,
    async canEdit() { return !!SESSION.canEdit; },
    async can(name) { return name === 'data.write' ? true : null; },
    async profiles() { return {}; },
    async search() { return []; },
  };

  /* ── sign-in / create-account screen (shown before the app starts) ── */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function showAuth() {
    let info = { company: 'OfficeHub', hasUsers: true, hasData: true };
    try { info = await api('public'); } catch (e) { info.error = e.message; }
    let mode = 'login', err = '', busy2 = false; const vals = {};
    const app = document.getElementById('app');
    const draw = () => {
      const ini = esc((info.company || 'OH').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
      const panel = !info.hasData && !info.hasUsers
        ? `<h1>Set up OfficeHub</h1><p class="muted">This office has no data yet. Open the <a href="/setup.html">setup page</a> to import your data or create the first administrator.</p>${info.error ? `<div class="alert t-bad" style="margin-top:12px">${esc(info.error)}</div>` : ''}`
        : mode === 'login'
          ? `<h1>Sign in</h1><p class="muted">Welcome back.</p>${err ? `<div class="alert t-bad" style="cursor:default;margin:12px 0">${esc(err)}</div>` : ''}
            <form id="oh-login" class="grid" style="gap:12px;margin-top:16px">
              <label class="f">Work email or employee code<input class="i" name="id" autocomplete="username" required autofocus></label>
              <label class="f">Password<input class="i" type="password" name="password" autocomplete="current-password" required></label>
              <label class="check"><input type="checkbox" name="keep" checked> Keep me signed in on this device for 7 days</label>
              <button class="btn pri big" type="submit" ${busy2 ? 'disabled' : ''}>${busy2 ? 'Checking…' : 'Sign in'}</button>
              <p class="small muted" style="margin:0">First time here? <a href="#" id="oh-to-signup">Create your account</a> with the employee code and email HR has on record.</p>
              <p class="tiny muted" style="margin:0">Forgot your password? Ask HR or an administrator to reset it, then create your account again.</p></form>`
          : `<h1>Create your account</h1><p class="muted">Use the employee code and work email HR has on record for you.</p>${err ? `<div class="alert t-bad" style="cursor:default;margin:12px 0">${esc(err)}</div>` : ''}
            <form id="oh-signup" class="grid" style="gap:12px;margin-top:16px">
              <label class="f">Employee code<input class="i" name="code" required placeholder="e.g. AMR112" autocomplete="off"></label>
              <label class="f">Work email<input class="i" type="email" name="email" required autocomplete="email"></label>
              <label class="f">Password<input class="i" type="password" name="password" required minlength="8" autocomplete="new-password"></label>
              <label class="f">Repeat password<input class="i" type="password" name="password2" required autocomplete="new-password"></label>
              <label class="check"><input type="checkbox" name="mail" checked> Email me my alerts</label>
              <button class="btn pri big" type="submit" ${busy2 ? 'disabled' : ''}>${busy2 ? 'Creating…' : 'Create account'}</button>
              <p class="tiny muted" style="margin:0">At least 8 characters with letters and a number. Not on the employee list yet? Ask HR to add you first.</p>
              <p class="small muted" style="margin:0">Already have an account? <a href="#" id="oh-to-login">Sign in</a></p></form>`;
      app.innerHTML = `<div class="auth"><div class="auth-art" aria-hidden="true"><div class="auth-brand"><div class="mark">${ini}</div><div><b>OfficeHub</b><small>${esc(info.company)}</small></div></div>
        <div class="auth-copy"><h2>Your office, in one place.</h2><p>Attendance, leave, tasks, approvals, claims and salary — for everyone at ${esc(info.company)}.</p></div>
        <div class="auth-dots">${['var(--c-teal)', 'var(--c-amber)', 'var(--c-coral)', 'var(--c-sky)', 'var(--c-leaf)'].map((c) => `<span style="background:${c}"></span>`).join('')}</div></div>
        <div class="auth-panel"><div class="auth-box">${panel}</div></div></div>`;
      app.querySelectorAll('form input:not([type=password]):not([type=checkbox])').forEach((i) => { if (vals[i.name]) i.value = vals[i.name]; i.addEventListener('input', () => { vals[i.name] = i.value; }); });
      const sw = (m) => (ev) => { ev.preventDefault(); mode = m; err = ''; draw(); };
      app.querySelector('#oh-to-signup')?.addEventListener('click', sw('signup'));
      app.querySelector('#oh-to-login')?.addEventListener('click', sw('login'));
      app.querySelector('form')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.target), v = (k) => String(fd.get(k) || '');
        if (mode === 'signup' && v('password') !== v('password2')) { err = 'The two passwords don’t match.'; draw(); return; }
        busy2 = true; err = ''; draw();
        try {
          if (mode === 'login') await api('auth/login', { id: v('id'), password: v('password'), keep: fd.get('keep') === 'on' });
          else await api('auth/signup', { code: v('code'), email: v('email'), password: v('password'), mail: fd.get('mail') === 'on' });
          location.reload();
        } catch (e) { busy2 = false; err = e.message; draw(); }
      });
    };
    draw();
  }

  /* ── window.claude.use(name) ── */
  const NEVER = new Promise(() => {});
  let started = false;
  async function use(name) {
    const s = await getSession().catch(() => null);
    if (!s) { if (!started) { started = true; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showAuth); else showAuth(); } return NEVER; }
    SESSION = s; window.OH_SESSION = s;
    if (!timer && !busy) sync();
    if (name === 'db') return db;
    if (name === 'user') return user;
    if (name === 'downloads') return downloads;
    if (name === 'room') return room;
    return null; // assets, comments, … are not used on this host (chat files are stored in the database)
  }
  window.claude = { use };
  window.OH = { api, sync: () => sync(), docs };
})();
</script>
