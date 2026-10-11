<script>
/* ═════════════ OfficeHub account & password, email alerts ═════════════
   On top of the Claude sign-in, every person creates an OfficeHub account (employee code + work email + password).
   The password hash lives in auth/{their Claude id}: only that person can read it; administrators can only delete it
   (that is the "reset password" action). Sessions are remembered in this browser only. */
const AUTH = { doc: undefined, sub: false, busy: false, err: '', mode: '' };
const SESSION_KEY = 'oh_session';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function pwHash(pw, saltB64, iter = 120000) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return { salt: b64(salt), hash: b64(bits), iter };
}
function pwProblem(pw, pw2) {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.';
  if (pw2 != null && pw !== pw2) return 'The two passwords don’t match.';
  return '';
}
const readSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
const writeSession = (s) => { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* storage blocked: session lasts this page load */ } AUTH.mem = s; };
function authWatch() {
  if (AUTH.sub || !S.db || !S.uid) return;
  AUTH.sub = true;
  S.db.doc(`auth/${S.uid}`).onSnapshot((s) => { AUTH.doc = s.exists ? s.data() : null; schedule(); }, () => { AUTH.doc = null; schedule(); });
}
function isAuthed() {
  if (!S.me) return false;
  authWatch();
  if (AUTH.doc === undefined) return null; // still loading
  if (!AUTH.doc) return false;
  const s = AUTH.mem || readSession();
  return !!(s && s.uid === S.uid && s.v === AUTH.doc.ver && s.exp > Date.now());
}
const authCard = (title, sub, body) => `<div class="auth"><div class="auth-art" aria-hidden="true"><div class="auth-brand"><div class="mark">${esc(initials(cfg().company || 'OH'))}</div><div><b>OfficeHub</b><small>${esc(cfg().company)}</small></div></div>
  <div class="auth-copy"><h2>Your office, in one place.</h2><p>Attendance, leave, tasks, approvals, claims and salary — for everyone at ${esc(cfg().company)}.</p></div>
  <div class="auth-dots">${['var(--c-teal)', 'var(--c-amber)', 'var(--c-coral)', 'var(--c-sky)', 'var(--c-leaf)'].map((c) => `<span style="background:${c}"></span>`).join('')}</div></div>
  <div class="auth-panel"><div class="auth-box"><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}${AUTH.err ? `<div class="alert t-bad" style="cursor:default;margin:12px 0">${esc(AUTH.err)}</div>` : ''}${body}</div></div></div>`;
function vLogin() {
  const e = S.me, d = AUTH.doc;
  if (d === undefined) return `<div class="splash"><p class="muted">Checking your account…</p></div>`;
  if (!d) return authCard(`Create your password`, `Hi ${esc(e.name.split(' ')[0])} — set a password for your OfficeHub account. You’ll use it with your work email or employee code to sign in.`, `
    <form data-f="auth-create" class="grid" style="gap:12px;margin-top:16px">
      <div class="auth-who">${avatar(e.name)}<div><b>${esc(e.name)}</b><div class="small muted">${esc(e.code || '')} · ${esc(e.email || 'no email on record')}</div></div></div>
      <label class="f">New password<input class="i" type="password" id="au-p1" name="pw" autocomplete="new-password" required minlength="8"></label>
      <label class="f">Repeat password<input class="i" type="password" id="au-p2" name="pw2" autocomplete="new-password" required></label>
      <label class="check"><input type="checkbox" id="au-mail" name="mail" ${e.prefs?.email === false ? '' : 'checked'}> Email me my alerts${e.email ? ` at ${esc(e.email)}` : ''}</label>
      <button class="btn pri big" type="submit" ${AUTH.busy ? 'disabled' : ''}>${AUTH.busy ? 'Saving…' : 'Create account'}</button>
      <p class="tiny muted" style="margin:0">At least 8 characters with letters and a number. Forgot it later? HR or an administrator can reset it.</p></form>`);
  const lock = d.lockUntil && d.lockUntil > Date.now();
  return authCard('Sign in', `Welcome back${e ? ', ' + esc(e.name.split(' ')[0]) : ''}.`, `
    <form data-f="auth-login" class="grid" style="gap:12px;margin-top:16px">
      <label class="f">Work email or employee code<input class="i" id="au-id" name="id" autocomplete="username" value="${esc(e.email || e.code || '')}" required></label>
      <label class="f">Password<input class="i" type="password" id="au-pw" name="pw" autocomplete="current-password" required ${lock ? 'disabled' : ''}></label>
      <label class="check"><input type="checkbox" id="au-keep" name="keep" checked> Keep me signed in on this device for 7 days</label>
      <button class="btn pri big" type="submit" ${AUTH.busy || lock ? 'disabled' : ''}>${lock ? `Locked until ${hm(d.lockUntil)}` : AUTH.busy ? 'Checking…' : 'Sign in'}</button>
      <p class="tiny muted" style="margin:0">Forgot your password? Ask HR or an administrator to reset it, then create a new one here.</p></form>`);
}
function vSignup() {
  return authCard('Create your account', 'Use the employee code and work email HR has on record for you.', `
    <form data-f="auth-signup" class="grid" style="gap:12px;margin-top:16px">
      <label class="f">Employee code<input class="i" id="su2-c" name="code" required placeholder="e.g. AMR112" autocomplete="off"></label>
      <label class="f">Work email<input class="i" type="email" id="su2-e" name="email" required value="${esc(S.myEmail || '')}" autocomplete="email"></label>
      <label class="f">Password<input class="i" type="password" id="su2-p1" name="pw" required minlength="8" autocomplete="new-password"></label>
      <label class="f">Repeat password<input class="i" type="password" id="su2-p2" name="pw2" required autocomplete="new-password"></label>
      <label class="check"><input type="checkbox" id="su2-m" name="mail" checked> Email me my alerts</label>
      <button class="btn pri big" type="submit" ${AUTH.busy ? 'disabled' : ''}>${AUTH.busy ? 'Creating…' : 'Create account'}</button>
      <p class="tiny muted" style="margin:0">Not on the employee list yet? Ask HR to add you on the People page first.${S.readonly ? ' Also ask the owner to share OfficeHub with you as a Contributor.' : ''}</p></form>`);
}
async function authSubmit(f, form, fd) {
  const v = (k) => String(fd.get(k) ?? '');
  AUTH.err = ''; AUTH.busy = true; schedule();
  try {
    if (f === 'auth-signup') {
      const code = v('code').trim().toUpperCase(), email = v('email').trim().toLowerCase();
      const e = S.emps.find((x) => (x.code || '').toUpperCase() === code && x.active !== false);
      if (!e || (e.email || '').toLowerCase() !== email) throw new Error('That employee code and email don’t match our records. Check them, or ask HR.');
      if (e.userId && e.userId !== S.uid) throw new Error('This employee already has an account on another login. Ask HR to reset it if that isn’t you.');
      const bad = pwProblem(v('pw'), v('pw2')); if (bad) throw new Error(bad);
      const h = await pwHash(v('pw'));
      await put(`auth/${S.uid}`, { ...h, ver: Date.now(), empId: e.id, created: Date.now(), fails: 0 });
      await patch(`emp/${e.id}`, { userId: S.uid, prefs: { ...(e.prefs || {}), email: fd.get('mail') === 'on' } });
      writeSession({ uid: S.uid, v: (await S.db.doc(`auth/${S.uid}`).get()).data().ver, exp: Date.now() + 12 * 3600000 });
      const hrs = active().filter((x) => ['HR', 'ADMIN'].includes(x.role)).map((x) => x.id);
      await S.db.collection('ntf').doc().set(clean({ to: hrs[0] || e.id, at: Date.now(), title: `${e.name} created an OfficeHub account`, body: `${e.code} · ${e.email}`, go: { view: 'people' }, read: false, from: e.id }));
      await S.db.collection('audit').doc().set(clean({ at: Date.now(), by: e.id, action: 'ACCOUNT_CREATED', detail: { emp: e.id } }));
    }
    if (f === 'auth-create') {
      const bad = pwProblem(v('pw'), v('pw2')); if (bad) throw new Error(bad);
      const h = await pwHash(v('pw')), ver = Date.now();
      await put(`auth/${S.uid}`, { ...h, ver, empId: S.me.id, created: Date.now(), fails: 0 });
      await patch(`emp/${S.me.id}`, { prefs: { ...(S.me.prefs || {}), email: fd.get('mail') === 'on' } });
      writeSession({ uid: S.uid, v: ver, exp: Date.now() + 12 * 3600000 });
      await audit('ACCOUNT_CREATED', { emp: S.me.id });
    }
    if (f === 'auth-login') {
      const d = AUTH.doc, id = v('id').trim().toLowerCase(), e = S.me;
      if (d.lockUntil && d.lockUntil > Date.now()) throw new Error(`Too many wrong attempts. Try again after ${hm(d.lockUntil)}.`);
      const idOk = id === (e.email || '').toLowerCase() || id === (e.code || '').toLowerCase();
      const h = await pwHash(v('pw'), d.salt, d.iter);
      if (!idOk || h.hash !== d.hash) {
        const fails = (d.fails || 0) + 1;
        await patch(`auth/${S.uid}`, fails >= 5 ? { fails: 0, lockUntil: Date.now() + 15 * 60000 } : { fails });
        throw new Error(fails >= 5 ? 'Too many wrong attempts — sign-in is locked for 15 minutes.' : `Wrong email/code or password. ${5 - fails} attempt(s) left.`);
      }
      if (d.fails || d.lockUntil) await patch(`auth/${S.uid}`, { fails: 0, lockUntil: null });
      writeSession({ uid: S.uid, v: d.ver, exp: Date.now() + (fd.get('keep') === 'on' ? 7 * 24 : 12) * 3600000 });
    }
    if (f === 'auth-change') {
      const d = AUTH.doc, cur = await pwHash(v('cur'), d.salt, d.iter);
      if (cur.hash !== d.hash) throw new Error('Your current password is wrong.');
      const bad = pwProblem(v('pw'), v('pw2')); if (bad) throw new Error(bad);
      const h = await pwHash(v('pw')), ver = Date.now();
      await put(`auth/${S.uid}`, { ...d, ...h, ver, fails: 0, lockUntil: null });
      writeSession({ uid: S.uid, v: ver, exp: Date.now() + 12 * 3600000 });
      await audit('PASSWORD_CHANGED', { emp: S.me.id });
      toast('Password changed');
    }
    if (f === 'acct-prefs') { await patch(`emp/${S.me.id}`, { prefs: { ...(S.me.prefs || {}), email: fd.get('mail') === 'on' } }); toast('Saved'); }
    AUTH.busy = false; AUTH.err = '';
    if (['auth-change', 'acct-prefs'].includes(f)) closeModal();
    viewChanged = true; schedule();
  } catch (e) { AUTH.busy = false; AUTH.err = e.user || e instanceof Error && !e.code ? e.message : errText(e); if (['auth-change', 'acct-prefs'].includes(f)) { toast(AUTH.err, 'bad'); AUTH.err = ''; } schedule(); }
}
function signOut() { writeSession(null); AUTH.mem = null; closeModal(); S.ui.moreOpen = ''; viewChanged = true; schedule(); }
function accountModal() {
  const e = S.me;
  return `${mhead('My account', `${esc(e.code || '')} · ${esc(e.email || '')}`)}<div class="body grid" style="gap:16px">
    <form data-f="acct-prefs" class="card body grid" style="gap:10px"><h3>Email alerts</h3>
      <label class="check"><input type="checkbox" id="ac-mail" name="mail" ${e.prefs?.email === false ? '' : 'checked'}> Send my alerts (approvals, tasks, leave, claims, fines) to ${esc(e.email || 'my work email')}</label>
      <p class="tiny muted" style="margin:0">${mailReady() ? 'Email delivery is switched on for the office.' : 'Your alerts are queued for email. They are delivered once the office connects an email service (Settings → Email alerts).'}</p>
      <div><button class="btn" type="submit">Save</button></div></form>
    <form data-f="auth-change" class="card body fgrid"><h3 class="full">Change password</h3>
      <label class="f full">Current password<input class="i" type="password" id="cp-cur" name="cur" autocomplete="current-password" required></label>
      <label class="f">New password<input class="i" type="password" id="cp-n1" name="pw" autocomplete="new-password" required minlength="8"></label>
      <label class="f">Repeat new password<input class="i" type="password" id="cp-n2" name="pw2" autocomplete="new-password" required></label>
      <div class="full"><button class="btn" type="submit">Change password</button></div></form>
  </div><footer><button class="btn danger" data-a="acct-signout">Sign out</button><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}

/* ── email alerts: every alert is also queued as an email in mail/ for people who opted in ── */
const mailReady = () => !!(window.OH_SESSION?.mail || cfg().mail?.enabled);
async function queueMail(empId, n) {
  const e = empById(empId);
  if (!e?.email || e.prefs?.email === false || e.active === false) return;
  await S.db.collection('mail').doc().set(clean({ to: e.email, toName: e.name, empId, subject: `[OfficeHub] ${n.title}`, text: `${n.title}\n\n${n.body || ''}\n\nOpen OfficeHub to see the details.\n— ${cfg().company}`, at: Date.now(), status: 'QUEUED', by: S.me?.id || null }));
}
const MAIL = { sub: false, list: [] };
function ensureMail() { if (MAIL.sub || !S.db) return; MAIL.sub = true; S.db.collection('mail').where('at', '>=', Date.now() - 30 * 86400000).onSnapshot((q) => { MAIL.list = docsOf(q).sort((a, b) => b.at - a.at); schedule(); }, () => {}); }
function mailCard() {
  ensureMail();
  const q = MAIL.list.filter((m) => m.status === 'QUEUED'), sent = MAIL.list.filter((m) => m.status === 'SENT');
  const optedOut = active().filter((e) => e.prefs?.email === false).length, noMail = active().filter((e) => !e.email).length;
  return `<div class="grid g2">${card('Email alerts', `<div class="grid" style="gap:10px">
      <div class="alert ${mailReady() ? 't-ok' : 't-warn'}" style="cursor:default">${mailReady() ? 'Email delivery is on.' : '<b>No email service is connected yet.</b> Every alert is being queued as an email (below). Claude-hosted apps can’t send email on their own — delivery needs an email connection (Gmail / Outlook connector for your Claude organisation, or the Vercel version with an SMTP or email-API key).'}</div>
      <div class="kv" style="grid-template-columns:1fr"><div><span>Queued (last 30 days)</span><b>${q.length}</b></div><div><span>Marked sent</span><b>${sent.length}</b></div><div><span>People who switched email alerts off</span><b>${optedOut}</b></div><div><span>People with no email on record</span><b style="${noMail ? 'color:var(--warn)' : ''}">${noMail}</b></div></div>
      <div class="row"><button class="btn" data-a="mail-export" ${q.length ? '' : 'disabled'}>Export queued emails</button><button class="btn" data-a="mail-sent" ${q.length ? '' : 'disabled'}>Mark all as sent</button></div>
      <p class="tiny muted" style="margin:0">The export (Excel/CSV: to, subject, message) can be sent with Outlook or Gmail mail merge until a live connection is set up.</p></div>`)}
    ${card(`Email outbox <span class="count">${q.length}</span>`, q.length ? `<ul class="list">${q.slice(0, 12).map((m) => `<li style="display:block"><div class="row" style="justify-content:space-between"><b class="trunc small">${esc(m.subject)}</b><span class="tiny muted">${fmtDT(m.at)}</span></div><div class="tiny muted">To ${esc(m.toName || '')} &lt;${esc(m.to)}&gt;</div></li>`).join('')}</ul>` : empty('No emails waiting.'), { list: true })}</div>`;
}
async function mailAction(a) {
  const q = MAIL.list.filter((m) => m.status === 'QUEUED');
  if (a === 'mail-export') return exportBook(`OfficeHub email outbox ${today()}`, [{ name: 'Outbox', cols: ['To name', 'To email', 'Subject', 'Message', 'Queued at'], rows: q.map((m) => [m.toName || '', m.to, m.subject, m.text, fmtDT(m.at)]) }]);
  if (a === 'mail-sent') return act(async () => { for (const m of q) await patch(`mail/${m.id}`, { status: 'SENT', sentAt: Date.now(), sentBy: S.me.id }); }, `${q.length} marked as sent`);
}
</script>
<style>
/* ── sign-in screens ── */
.auth{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);background:var(--bg)}
.auth-art{background:linear-gradient(160deg,var(--rail) 0%,color-mix(in srgb,var(--rail) 70%,var(--c-teal)) 100%);color:var(--rail-ink);padding:40px clamp(24px,5vw,64px);display:flex;flex-direction:column;justify-content:space-between;gap:24px;position:relative;overflow:hidden}
.auth-art::after{content:"";position:absolute;right:-120px;bottom:-120px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--c-amber) 55%,transparent),transparent 70%);opacity:.5}
.auth-brand{display:flex;gap:12px;align-items:center}.auth-brand b{font:700 1.3rem var(--f-display)}.auth-brand small{display:block;color:var(--rail-muted);text-transform:uppercase;letter-spacing:.06em;font-size:.72rem}
.auth-brand .mark{background:var(--rail-act);color:var(--rail)}
.auth-copy h2{font:700 clamp(1.6rem,3vw,2.4rem)/1.15 var(--f-display);max-width:14ch}
.auth-copy p{color:var(--rail-muted);max-width:36ch;font-size:1rem}
.auth-dots{display:flex;gap:8px;position:relative;z-index:1}.auth-dots span{width:28px;height:8px;border-radius:99px}
.auth-panel{display:grid;place-items:center;padding:32px 16px}
.auth-box{width:min(400px,100%)}
.auth-box h1{font-size:1.7rem}
.auth-who{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:10px;background:var(--sunk)}
.btn.big{min-height:44px;justify-content:center;font-size:1rem}
@media (max-width:860px){.auth{grid-template-columns:1fr}.auth-art{padding:24px 16px}.auth-copy h2{font-size:1.4rem}.auth-copy p,.auth-dots{display:none}}
</style>
