// Passwords (scrypt) and signed session cookies (HMAC-SHA256). No third-party crypto needed.
import crypto from 'node:crypto';
import { q, getDoc } from './db.js';

const COOKIE = 'oh_sid';

export function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw Object.assign(new Error('SESSION_SECRET must be set to a random string of at least 32 characters (Vercel → Settings → Environment Variables).'), { status: 500, code: 'config' });
  return s;
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function checkPassword(pw, stored) {
  const [kind, s, h] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.';
  return '';
}
export const newUid = () => 'u_' + crypto.randomBytes(16).toString('base64url').slice(0, 22);
export const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
export function makeToken(uid, ver, ms) {
  const body = Buffer.from(JSON.stringify({ uid, ver, exp: Date.now() + ms })).toString('base64url');
  return `${body}.${sign(body)}`;
}
function readToken(tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig || !safeEqual(sign(body), sig)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
export function cookieHeader(token, ms, secure) {
  const parts = [`${COOKIE}=${token || ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? Math.floor(ms / 1000) : 0}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
export function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

const HR = ['ADMIN', 'HR'];

/** Resolve who is calling: user row, employee record, and what they may do. Returns null when signed out. */
export async function sessionFrom(headers) {
  const tok = readToken(parseCookies(headers.cookie)[COOKIE]);
  if (!tok) return null;
  const r = await q('SELECT * FROM users WHERE uid = $1', [tok.uid]);
  const u = r.rows[0];
  if (!u || Number(u.ver) !== tok.ver) return null;
  let emp = null, empId = u.emp_id;
  if (empId) { const d = await getDoc(`emp/${empId}`); emp = d?.data || null; }
  if (!emp && u.owner) {
    // first-time setup: the owner's employee record is created by the app with userId = their uid
    const m = await q(`SELECT path, data FROM docs WHERE parent = 'emp' AND NOT deleted AND data->>'userId' = $1 LIMIT 1`, [u.uid]);
    if (m.rowCount) { emp = m.rows[0].data; empId = m.rows[0].path.slice(4); await q('UPDATE users SET emp_id = $2 WHERE uid = $1', [u.uid, empId]).catch(() => {}); }
  }
  const cfg = (await getDoc('cfg/main'))?.data || {};
  const anyAdmin = emp || !u.owner ? true : (await q(`SELECT 1 FROM docs WHERE parent = 'emp' AND NOT deleted AND data->>'role' = 'ADMIN' AND COALESCE(data->>'userId','') <> '' LIMIT 1`)).rowCount > 0;
  const bootstrap = !!u.owner && !emp && !anyAdmin;
  const role = bootstrap ? 'ADMIN' : emp?.role || null;
  const active = bootstrap || (emp && emp.active !== false);
  let salary = false;
  if (active && role === 'ADMIN') salary = true;
  else if (active && emp) {
    const a = cfg.access?.salary;
    const has = a && (a.roles?.length || a.depts?.length || a.people?.length);
    salary = has ? !!(a.roles?.includes(role) || a.depts?.includes(emp.deptId) || a.people?.includes(empId)) : HR.includes(role);
  }
  return { uid: u.uid, user: u, empId, emp, role, hr: active && HR.includes(role), admin: active && role === 'ADMIN', salary, active, bootstrap, owner: !!u.owner, exp: tok.exp };
}
