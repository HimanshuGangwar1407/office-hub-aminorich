// All OfficeHub API routes. Used by api/main.js on Vercel and by scripts/dev-server.mjs locally.
import { q, getPool, ensureSchema, writeDoc, getDoc, parentOf } from './db.js';
import { sessionFrom, hashPassword, checkPassword, passwordProblem, newUid, makeToken, cookieHeader, safeEqual } from './auth.js';
import { chatWriteProblem, clearedChatsProblem } from './chat-rules.js';
import { locWriteProblem, LIVE_STOPPED } from './loc-rules.js';
import { buildCtx, accessFor, canReadDoc, shapeDoc, empWriteProblem, chatAccessProblem, ntfWriteProblem, mailWriteProblem, blobReadable, blobWriteProblem, refUsesFile } from './access.js';
import { isAssignableCtx, complaintWriteProblem, buildComplaint } from './complaints.js';

const SALARY = new Set(['pay', 'payroll', 'fines']);
// managerId and deptId decide who may see someone's WFH locations (server/loc-rules.js), so only HR may change them
const PROTECTED_EMP = ['role', 'userId', 'active', 'status', 'code', 'email', 'managerId', 'deptId'];
const PATH_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}(\/[A-Za-z0-9_\-.~:@+]{1,200}){1,14}$/;
const MAX_DOC = 900 * 1024;
const H12 = 12 * 3600000, D7 = 7 * 24 * 3600000;

const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const lower = (s) => String(s || '').trim().toLowerCase();
const isDocPath = (p) => PATH_RE.test(p) && p.split('/').length % 2 === 0;

// Who sees what depends on the employee records, the department list and chat membership (server/access.js).
// Employees and settings change rarely: they are cached per server instance and re-read when their latest version or
// count changes, and at least once a minute. Chat membership is read fresh every time (only the few fields needed),
// because new messages update the chat records constantly and that must not force re-reading everything.
let empCache = { stamp: null, at: 0, rows: null };
async function accessContext() {
  const [st, chats] = await Promise.all([
    q(`SELECT parent, max(v)::text AS v, count(*)::int AS n FROM docs WHERE parent IN ('emp', 'cfg') GROUP BY parent ORDER BY parent`),
    q(`SELECT path, data->>'kind' AS kind, data->'members' AS members, data->'admins' AS admins, data->>'createdBy' AS "createdBy" FROM docs WHERE parent = 'chat' AND NOT deleted`),
  ]);
  const stamp = st.rows.map((r) => `${r.parent}:${r.v}:${r.n}`).join('|');
  if (!empCache.rows || empCache.stamp !== stamp || empCache.at < Date.now() - 60000) {
    empCache = { stamp, at: Date.now(), rows: (await q(`SELECT path, data FROM docs WHERE (parent = 'emp' OR path = 'cfg/main') AND NOT deleted`)).rows };
  }
  const chatRows = chats.rows.map((r) => ({ path: r.path, data: { kind: r.kind, members: r.members || [], admins: r.admins || undefined, createdBy: r.createdBy || undefined } }));
  return buildCtx([...empCache.rows, ...chatRows]);
}
const accessOf = async (s) => accessFor(s, await accessContext());

// The chat messages and location records that use a shared file (blob/{fid}_{i}): only those written by the person who
// uploaded the file count (refUsesFile). A file is readable when one of them is. Paths are cached for 30 seconds.
const refCache = new Map();
const fidOf = (path, data) => String(data?.fid || path.split('/')[1]?.replace(/_\d+$/, '') || '');
async function blobRefs(fid, by) {
  if (!/^[A-Za-z0-9]{4,64}$/.test(fid) || !by) return [];
  const key = `${fid}|${by}`, hit = refCache.get(key);
  if (hit && hit.at > Date.now() - 30000) return hit.paths;
  const rows = (await q(`SELECT path, data FROM docs WHERE NOT deleted AND ((parent = 'loc' AND data->>'empId' = $2) OR (parent LIKE 'chat/%/b' AND data->>'by' = $2)) AND data::text LIKE $1 LIMIT 50`, [`%"${fid}"%`, by])).rows;
  const paths = rows.filter((r) => refUsesFile(r.path, r.data, fid, by)).map((r) => r.path);
  if (refCache.size > 5000) refCache.clear();
  refCache.set(key, { at: Date.now(), paths });
  return paths;
}

async function checkWrite(op, path, data, old, s, A) {
  const [c, a, b] = path.split('/');
  const no = (m) => fail(403, 'permission_denied', m || 'You don’t have permission to change this.');
  if (!s.active) no('Your account is not active. Ask HR.');
  if (c === 'auth') no();
  if (c === 'loc') { const bad = locWriteProblem(op, path, data, old, s); if (bad === LIVE_STOPPED) fail(409, 'live_stopped', bad); if (bad) no(bad); return; }
  if (c === 'chat') { const bad = chatAccessProblem(op, path, data, old, A); if (bad) no(bad); return; }
  if (c === 'ntf') { const bad = ntfWriteProblem(op, data, old, s); if (bad) no(bad); return; }
  if (c === 'mail') { const bad = mailWriteProblem(op, data, old, A); if (bad) no(bad); return; }
  if (c === 'complaint' || c === 'complaintsecret' || c === 'complaintfile') {
    // assignees must be HR or managers; the rules themselves are in server/complaints.js
    const assigneeOk = typeof data?.assignedTo === 'string' && data.assignedTo ? isAssignableCtx(data.assignedTo, A.ctx) : !data?.assignedTo;
    const bad = complaintWriteProblem(op, path, data, old, s, { staff: A.complaintStaff, assigneeOk });
    if (bad) no(bad);
    return;
  }
  if (c === 'blob') { const bad = blobWriteProblem(op, data, old, old && old.by !== s.empId ? await blobRefs(fidOf(path, old), old.by) : [], A); if (bad) no(bad); return; }
  if (c === 'data') {
    if (!(a === 'users' && b === s.uid)) no();
    if (path === `data/users/${s.uid}/cleared`) { const bad = clearedChatsProblem(op, data, old); if (bad) fail(400, 'invalid_argument', bad); }
    return;
  }
  if (SALARY.has(c)) { if (!s.salary) no('Only HR or an administrator can change salary data.'); return; }
  if (c === 'cfg') {
    if (!s.hr && !s.bootstrap) no('Only HR or an administrator can change settings.');
    const next = op === 'update' ? { ...(old || {}), ...data } : data || {};
    if (!s.admin && JSON.stringify(next.access || null) !== JSON.stringify(old?.access || null)) no('Only an administrator can change who sees which windows.');
    return;
  }
  if (c === 'emp' && path.split('/').length === 2) {
    const next = op === 'update' ? { ...(old || {}), ...data } : op === 'set' ? data : null;
    // userId links an employee to a login. Only the server sets it — except the owner's own record during first-time setup.
    if (next && (next.userId || '') !== (old?.userId || '') && !(s.bootstrap && !old && next.userId === s.uid)) no('Logins are linked when the employee creates their account.');
    if (s.hr || s.bootstrap) return;
    if (!old || op === 'delete') no('Only HR can add or remove employees.');
    for (const k of PROTECTED_EMP) if (JSON.stringify(next[k] ?? null) !== JSON.stringify(old[k] ?? null)) no('Only HR can change role, code, email, status, manager or department.');
    const bad = empWriteProblem(op, path, data, old, A); if (bad) no(bad);
  }
}

async function mailIfQueued(path, data) {
  if (!path.startsWith('mail/') || data?.status !== 'QUEUED' || !data.to) return;
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) return;
  let status = 'SENT', error = null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [data.to], subject: String(data.subject || 'OfficeHub').slice(0, 200), text: String(data.text || '') }),
    });
    clearTimeout(t);
    if (!r.ok) { status = 'FAILED'; error = (await r.text()).slice(0, 300); }
  } catch (e) { status = 'FAILED'; error = String(e.message || e).slice(0, 300); }
  await q(`UPDATE docs SET data = data || $2::jsonb, v = nextval('docs_v'), at = now() WHERE path = $1`, [path, { status, sentAt: Date.now(), error, via: 'resend' }]);
}

async function needSession(req) {
  const s = await sessionFrom(req.headers);
  if (!s) fail(401, 'unauthenticated', 'Please sign in.');
  return s;
}

function sessionCookie(req, uid, ver, ms) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL === '1';
  return cookieHeader(makeToken(uid, Number(ver), ms), ms, secure);
}

async function empByLogin(id) {
  const r = await q(`SELECT path, data FROM docs WHERE parent = 'emp' AND NOT deleted AND (lower(data->>'email') = $1 OR lower(data->>'code') = $1)`, [lower(id)]);
  return r.rows.map((x) => ({ id: x.path.slice(4), ...x.data }));
}

async function addDoc(client, coll, data) {
  const id = newUid().slice(2).toLowerCase();
  await writeDoc(client, 'set', `${coll}/${id}`, data);
}

const routes = {
  /* ── public ── */
  'GET public': async () => {
    await ensureSchema();
    const cfg = (await getDoc('cfg/main'))?.data;
    const users = (await q('SELECT count(*)::int AS n FROM users')).rows[0].n;
    const docs = (await q('SELECT count(*)::int AS n FROM docs')).rows[0].n;
    return { company: cfg?.company || 'OfficeHub', hasUsers: users > 0, hasData: docs > 0 };
  },

  /* ── session & accounts ── */
  'GET session': async (req) => {
    const s = await needSession(req);
    return { uid: s.uid, empId: s.empId, name: s.emp?.name || '', email: s.emp?.email || s.user.login_email || '', owner: s.owner || s.admin, bootstrap: s.bootstrap, canEdit: s.salary || s.hr, salary: s.salary, hr: s.hr, active: s.active, exp: s.exp, mail: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM) };
  },
  'POST auth/signup': async (req) => {
    await ensureSchema();
    const { code, email, password, mail } = req.body || {};
    const c = String(code || '').trim().toUpperCase(), e = lower(email);
    const r = await q(`SELECT path, data FROM docs WHERE parent = 'emp' AND NOT deleted AND upper(data->>'code') = $1`, [c]);
    const row = r.rows.find((x) => lower(x.data.email) === e && x.data.active !== false);
    if (!c || !e || !row) fail(400, 'invalid_argument', 'That employee code and email don’t match our records. Check them, or ask HR.');
    const bad = passwordProblem(password); if (bad) fail(400, 'invalid_argument', bad);
    const empId = row.path.slice(4);
    if ((await q('SELECT 1 FROM users WHERE emp_id = $1', [empId])).rowCount) fail(409, 'exists', 'This employee already has an account. Sign in, or ask HR to reset the password.');
    const uid = newUid(), ver = Date.now();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO users (uid, emp_id, login_email, pw, ver, created) VALUES ($1, $2, $3, $4, $5, $6)', [uid, empId, e, hashPassword(password), ver, Date.now()]);
      await writeDoc(client, 'update', `emp/${empId}`, { userId: uid, prefs: { ...(row.data.prefs || {}), email: mail !== false } });
      const hrs = await client.query(`SELECT path FROM docs WHERE parent = 'emp' AND NOT deleted AND data->>'role' IN ('HR','ADMIN') AND COALESCE(data->>'active','true') <> 'false' ORDER BY data->>'role' DESC LIMIT 1`);
      const to = hrs.rows[0]?.path.slice(4) || empId;
      await addDoc(client, 'ntf', { to, at: Date.now(), title: `${row.data.name} created an OfficeHub account`, body: `${row.data.code} · ${row.data.email}`, go: { view: 'people' }, read: false, from: empId });
      await addDoc(client, 'audit', { at: Date.now(), by: empId, action: 'ACCOUNT_CREATED', detail: { emp: empId } });
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
    return { ok: true, _cookie: sessionCookie(req, uid, ver, H12) };
  },
  'POST auth/login': async (req) => {
    await ensureSchema();
    const { id, password, keep } = req.body || {};
    const emps = await empByLogin(id);
    let u = null;
    for (const e of emps) { const r = await q('SELECT * FROM users WHERE emp_id = $1', [e.id]); if (r.rowCount) { u = r.rows[0]; if (e.active === false) fail(403, 'inactive', 'Your employee record is inactive. Ask HR.'); break; } }
    if (!u) { const r = await q('SELECT * FROM users WHERE owner AND emp_id IS NULL AND login_email = $1', [lower(id)]); u = r.rows[0] || null; }
    if (!u) {
      if (emps.length) fail(401, 'no_account', 'You haven’t created your account yet — use “Create account”.');
      fail(401, 'bad_login', 'Wrong email/code or password.');
    }
    if (Number(u.lock_until) > Date.now()) fail(429, 'locked', `Too many wrong attempts. Try again after ${new Date(Number(u.lock_until)).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`);
    if (!checkPassword(String(password || ''), u.pw)) {
      const fails = u.fails + 1;
      if (fails >= 5) { await q('UPDATE users SET fails = 0, lock_until = $2 WHERE uid = $1', [u.uid, Date.now() + 15 * 60000]); fail(429, 'locked', 'Too many wrong attempts — sign-in is locked for 15 minutes.'); }
      await q('UPDATE users SET fails = $2 WHERE uid = $1', [u.uid, fails]);
      fail(401, 'bad_login', `Wrong email/code or password. ${5 - fails} attempt(s) left.`);
    }
    if (u.fails || Number(u.lock_until)) await q('UPDATE users SET fails = 0, lock_until = 0 WHERE uid = $1', [u.uid]);
    return { ok: true, _cookie: sessionCookie(req, u.uid, u.ver, keep ? D7 : H12) };
  },
  'POST auth/logout': async (req) => ({ ok: true, _cookie: cookieHeader('', 0, (req.headers['x-forwarded-proto'] || '').includes('https')) }),
  'POST auth/change': async (req) => {
    const s = await needSession(req);
    const { current, password } = req.body || {};
    if (!checkPassword(String(current || ''), s.user.pw)) fail(400, 'invalid_argument', 'Your current password is wrong.');
    const bad = passwordProblem(password); if (bad) fail(400, 'invalid_argument', bad);
    const ver = Date.now();
    await q('UPDATE users SET pw = $2, ver = $3, fails = 0, lock_until = 0 WHERE uid = $1', [s.uid, hashPassword(password), ver]);
    await addDoc(getPool(), 'audit', { at: Date.now(), by: s.empId, action: 'PASSWORD_CHANGED', detail: { emp: s.empId } });
    return { ok: true, _cookie: sessionCookie(req, s.uid, ver, H12) };
  },
  'POST auth/reset': async (req) => {
    const s = await needSession(req);
    if (!s.hr) fail(403, 'permission_denied', 'Only HR or an administrator can reset passwords.');
    const { uid } = req.body || {};
    const r = await q('DELETE FROM users WHERE uid = $1 AND uid <> $2', [String(uid || ''), s.uid]);
    if (!r.rowCount) fail(404, 'not_found', 'That account doesn’t exist (or is your own — use “Change password” instead).');
    return { ok: true };
  },

  /* ── data ── */
  /* Raise a complaint. The server builds the record, so clients cannot choose who the complainant is.
     The complaint and its complainant record are written together, in one transaction. */
  'POST complaints/submit': async (req) => {
    const s = await needSession(req);
    const built = buildComplaint(req.body || {}, s);
    const expected = built.doc.attachments.flatMap((a) => Array.from({ length: a.chunks }, (_, i) => `complaintfile/${a.fid}_${i}`));
    if (expected.length) {
      const r = await q('SELECT COUNT(*)::int AS n FROM docs WHERE path = ANY($1::text[]) AND NOT deleted', [expected]);
      if (r.rows[0].n !== expected.length) fail(400, 'invalid_argument', 'An attachment did not finish uploading. Try attaching it again.');
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await writeDoc(client, 'set', `complaint/${built.id}`, built.doc);
      await writeDoc(client, 'set', `complaintsecret/${built.id}`, built.secret);
      // The audit entry records the action only: no complainant, so it cannot identify anyone.
      await addDoc(client, 'audit', { at: built.doc.createdAt, by: null, action: 'COMPLAINT_RAISED', detail: { complaint: built.id } });
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    return { ok: true, id: built.id, code: built.doc.code };
  },
  'POST sync': async (req) => {
    const s = await needSession(req);
    if (!s.active) fail(403, 'revoked', 'Your account is not active.');
    const since = Math.max(0, Number(req.body?.since) || 0);
    const r = await q(
      `SELECT path, data, v, deleted, at > now() - interval '5 seconds' AS fresh FROM docs
       WHERE v > $1 AND parent NOT LIKE 'blob%' AND parent NOT LIKE 'complaintfile%' ${since ? '' : 'AND NOT deleted'} ORDER BY v LIMIT 4000`, [since]);
    // built after reading the batch, so a chat created just before it is already known
    const docs = [], A = await accessOf(s);
    let next = since, stop = false;
    for (const row of r.rows) {
      if (row.fresh) stop = true;
      if (!stop) next = Number(row.v);
      if (canReadDoc(row.path, row.deleted ? null : row.data, A)) docs.push(row.deleted ? { p: row.path, v: Number(row.v), x: 1 } : { p: row.path, v: Number(row.v), d: shapeDoc(row.path, row.data, A) });
    }
    // presence ("online now", "typing…") for chat
    const now = Date.now(), peer = String(req.body?.peer || '').slice(0, 64);
    if (peer && req.body?.presence !== undefined) {
      await q(`INSERT INTO presence (peer, uid, state, at) VALUES ($1, $2, $3, $4) ON CONFLICT (peer) DO UPDATE SET uid = EXCLUDED.uid, state = EXCLUDED.state, at = EXCLUDED.at`, [peer, s.uid, JSON.stringify(req.body.presence || {}).length < 2000 ? req.body.presence : {}, now]);
      if (Math.random() < 0.05) q('DELETE FROM presence WHERE at < $1', [now - 3600000]).catch(() => {});
    }
    const peers = (await q('SELECT peer, uid, state, at FROM presence WHERE at > $1', [now - 75000])).rows.map((p) => ({ peer: p.peer, by: p.uid, presence: p.state || {}, at: Number(p.at) }));
    return { docs, next, more: r.rows.length === 4000, scope: `${s.uid}:${s.salary ? 'S' : ''}:${A.sig}`, peers };
  },
  'GET doc': async (req) => {
    const s = await needSession(req);
    // Not "path": on Vercel the /api/* rewrite already sets path=doc, so a second path= becomes ambiguous.
    const path = String(req.query.p || '');
    if (!isDocPath(path)) fail(400, 'invalid_argument', 'Bad path.');
    const A = await accessOf(s), d = await getDoc(path);
    if (path.startsWith('blob/')) return d && blobReadable(d.data, await blobRefs(fidOf(path, d.data), d.data?.by), A) ? { exists: true, data: d.data, v: d.v } : { exists: false };
    if (!canReadDoc(path, d?.data ?? null, A)) return { exists: false };
    return d ? { exists: true, data: shapeDoc(path, d.data, A), v: d.v } : { exists: false };
  },
  'POST write': async (req) => {
    const s = await needSession(req);
    const { op, path, data } = req.body || {};
    if (!isDocPath(String(path || ''))) fail(400, 'invalid_argument', 'Bad path.');
    if (op !== 'delete' && (typeof data !== 'object' || !data || Array.isArray(data))) fail(400, 'invalid_argument', 'Bad data.');
    if (op !== 'delete' && JSON.stringify(data).length > MAX_DOC) fail(413, 'too_large', 'That record is too large.');
    const old = (await getDoc(path))?.data || null;
    await checkWrite(op, path, data, old, s, await accessOf(s));
    const parts = path.split('/');
    const parent = parts[0] === 'chat' && parts.length === 4 ? (await getDoc(`chat/${parts[1]}`))?.data || null : null;
    const chatBad = chatWriteProblem(op, path, data, old, s, parent);
    if (chatBad) fail(403, 'permission_denied', chatBad);
    const v = await writeDoc(getPool(), op, path, op === 'delete' ? null : data);
    if (op !== 'delete') await mailIfQueued(path, op === 'update' ? { ...(old || {}), ...data } : data);
    return { v };
  },
  'POST lease': async (req) => {
    const s = await needSession(req);
    const { path, holder, ttlMs } = req.body || {};
    if (!isDocPath(String(path || ''))) fail(400, 'invalid_argument', 'Bad path.');
    const now = Date.now(), exp = now + Math.min(Math.max(Number(ttlMs) || 20000, 1000), 120000);
    const h = `${s.uid}:${String(holder || '').slice(0, 80)}`;
    const r = await q(`INSERT INTO leases (path, holder, expires) VALUES ($1, $2, $3) ON CONFLICT (path) DO UPDATE SET holder = EXCLUDED.holder, expires = EXCLUDED.expires
      WHERE leases.expires < $4 OR leases.holder = EXCLUDED.holder RETURNING expires`, [path, h, exp, now]);
    if (r.rowCount) return { acquired: true, expiresAt: new Date(exp).toISOString(), holder };
    const cur = await q('SELECT expires FROM leases WHERE path = $1', [path]);
    return { acquired: false, expiresAt: new Date(Number(cur.rows[0]?.expires || now)).toISOString() };
  },

  /* ── one-time setup (protected by SETUP_KEY) ── */
  'POST setup/import': async (req) => {
    await ensureSchema();
    const key = process.env.SETUP_KEY;
    if (!key || key.length < 12) fail(500, 'config', 'Set SETUP_KEY (12+ characters) in Vercel → Settings → Environment Variables first.');
    if (!safeEqual(req.body?.key || '', key)) fail(403, 'permission_denied', 'Wrong setup key.');
    const docs = req.body?.docs;
    if (!docs || typeof docs !== 'object') fail(400, 'invalid_argument', 'That file isn’t an OfficeHub export.');
    const n = (await q('SELECT count(*)::int AS n FROM docs')).rows[0].n;
    if (n && !req.body.replace) fail(409, 'exists', `The database already has ${n} records. Tick “Replace existing data” to overwrite them.`);
    const entries = Object.entries(docs).filter(([p, d]) => isDocPath(p) && !p.startsWith('auth/') && d && typeof d === 'object');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      if (req.body.replace) await client.query('TRUNCATE docs, users, leases, presence');
      for (let i = 0; i < entries.length; i += 500) {
        const chunk = entries.slice(i, i + 500);
        await client.query(`INSERT INTO docs (path, parent, data, v) SELECT p, par, d, nextval('docs_v') FROM unnest($1::text[], $2::text[], $3::jsonb[]) AS t(p, par, d)
          ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, v = EXCLUDED.v, deleted = false, at = now()`,
        [chunk.map(([p]) => p), chunk.map(([p]) => parentOf(p)), chunk.map(([p, d]) => JSON.stringify(p.startsWith('emp/') ? { ...d, userId: undefined } : d))]);
      }
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
    return { ok: true, imported: entries.length };
  },
  'POST setup/owner': async (req) => {
    await ensureSchema();
    const key = process.env.SETUP_KEY;
    if (!key || key.length < 12) fail(500, 'config', 'Set SETUP_KEY (12+ characters) in Vercel → Settings → Environment Variables first.');
    if (!safeEqual(req.body?.key || '', key)) fail(403, 'permission_denied', 'Wrong setup key.');
    if ((await q('SELECT 1 FROM users LIMIT 1')).rowCount) fail(409, 'exists', 'Accounts already exist. Sign in on the main page instead.');
    const email = lower(req.body?.email);
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) fail(400, 'invalid_argument', 'Enter a valid email.');
    const bad = passwordProblem(req.body?.password); if (bad) fail(400, 'invalid_argument', bad);
    const uid = newUid(), ver = Date.now();
    await q('INSERT INTO users (uid, emp_id, login_email, pw, ver, owner, created) VALUES ($1, NULL, $2, $3, $4, true, $5)', [uid, email, hashPassword(req.body.password), ver, Date.now()]);
    return { ok: true, _cookie: sessionCookie(req, uid, ver, H12) };
  },
};

/** Framework-neutral entry: { method, route, query, body, headers } → { status, body, headers } */
export async function handle(req) {
  const fn = routes[`${req.method} ${req.route}`];
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (!fn) return { status: 404, headers, body: { code: 'not_found', message: 'No such API route.' } };
  if (req.method === 'POST' && !String(req.headers['content-type'] || '').includes('application/json')) return { status: 415, headers, body: { code: 'invalid_argument', message: 'Send JSON.' } };
  try {
    await ensureSchema();
    const out = (await fn(req)) || {};
    if (out._cookie) { headers['Set-Cookie'] = out._cookie; delete out._cookie; }
    return { status: 200, headers, body: out };
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    return { status, headers, body: { code: e.code || 'internal', message: status >= 500 && e.code !== 'config' ? 'Something went wrong on the server. Try again.' : e.message } };
  }
}
