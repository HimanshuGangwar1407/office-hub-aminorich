<script>
/* ═════════════ Vercel host overrides ═════════════
   On Vercel, sign-in is handled by the server (HttpOnly session cookie, scrypt password hashes in Postgres),
   so the in-page password screens of the artifact build are replaced here. Loaded after every other part
   except the boot part, so these declarations win. */
function isAuthed() { return !!S.me; }
function signOut() {
  fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).finally(() => location.reload());
}
async function authSubmit(f, form, fd) {
  const v = (k) => String(fd.get(k) ?? '');
  try {
    if (f === 'auth-change') {
      if (v('pw') !== v('pw2')) fail('The two new passwords don’t match.');
      await OH.api('auth/change', { current: v('cur'), password: v('pw') });
      closeModal(); toast('Password changed');
      return;
    }
    if (f === 'acct-prefs') { await patch(`emp/${S.me.id}`, { prefs: { ...(S.me.prefs || {}), email: fd.get('mail') === 'on' } }); closeModal(); toast('Saved'); return; }
  } catch (e) { toast(e.user || e instanceof Error ? e.message : errText(e), 'bad'); }
}
// Shown only if the signed-in account is not linked to an active employee any more.
function vSignup() {
  return `<div class="splash"><div class="brand"><div class="mark">OH</div><div><b>OfficeHub</b><small>${esc(cfg().company)}</small></div></div>
    <h1>Your account isn’t active</h1><p class="muted">Your login is not linked to an active employee record. Ask HR to check your record on the People page.</p>
    <p><button class="btn" data-a="acct-signout">Sign out</button></p></div>`;
}
</script>
