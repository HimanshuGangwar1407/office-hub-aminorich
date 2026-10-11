<script>
/* ═════════════ Location sharing for WFH / official duty ═════════════
   Storage: loc/{empId}_{date} = { empId, date, kind, last, pings:[{ t, src, lat, lng, acc, link, addr, photo, mode }] }
   src: 'gps' (device location), 'live-gps' (auto-update while the app is open), 'link' (Maps pin link / coordinates),
        'live' (a Google Maps live-location-sharing link — it keeps moving on the map by itself). */
const LOC = { live: false, timer: null, lastErr: '' };
const LOC_EVERY_MIN = 15;
const locOf = (empId, d) => S.locs.find((l) => l.empId === empId && l.date === d);
const lastPing = (l) => l?.pings?.[l.pings.length - 1] || null;
const punchMode = () => (punchesOn(S.me.id, today()).length % 2 === 0 ? 'in' : 'out');
const needsLoc = (empId, d) => (cfg().wfhLoc || 'required') !== 'off' && !!remoteOn(empId, d);
const remoteKind = (empId, d) => { const r = remoteOn(empId, d); return r ? (r.data.kind === 'OD' ? 'OD' : 'WFH') : ''; };

function parseCoords(s) {
  s = String(s || '');
  const pats = [/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/, /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|sll|destination|center|daddr)=(?:loc:)?(-?\d{1,2}\.\d+)(?:,|%2C)\s*(?:\+|%20)?(-?\d{1,3}\.\d+)/i,
    /^\s*(-?\d{1,2}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)\s*$/, /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/];
  for (const p of pats) { const m = s.match(p); if (m) { const lat = +m[1], lng = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) return { lat, lng }; } }
  return null;
}
const mapUrl = (p) => (p.lat != null ? `https://www.google.com/maps?q=${p.lat},${p.lng}` : p.link);
function kmBetween(a, b) {
  const R = 6371, r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const kmTxt = (k) => (k < 1 ? `${Math.round(k * 1000)} m` : `${k.toFixed(k < 10 ? 1 : 0)} km`);
function awayFromHome(empId, p) {
  const home = empById(empId)?.wfhLoc;
  if (!home || p?.lat == null) return null;
  return kmBetween(home, p);
}
const SRC_LABEL = { gps: 'Device location', 'live-gps': 'Auto-update', link: 'Map pin', live: 'Live link' };

function tryGps() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res({ err: 'This browser can’t share location.' });
    const done = setTimeout(() => res({ err: 'Location took too long to arrive.' }), 12000);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(done); res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy || 0) }); },
        (e) => { clearTimeout(done); res({ err: e?.code === 1 ? 'Location access is blocked in this window.' : 'Your location couldn’t be found.' }); },
        { enableHighAccuracy: true, timeout: 11000, maximumAge: 60000 });
    } catch { clearTimeout(done); res({ err: 'Location access is blocked in this window.' }); }
  });
}

async function addPing(empId, d, ping) {
  const cur = locOf(empId, d);
  const pings = [...(cur?.pings || []), ping].slice(-60);
  await put(`loc/${empId}_${d}`, { empId, date: d, kind: remoteKind(empId, d) || cur?.kind || '', last: ping.t, pings });
  S.locs = [...S.locs.filter((l) => l !== cur), { id: `${empId}_${d}`, empId, date: d, last: ping.t, pings }];
}

/* live auto-update — only works where the browser allows device location */
function startLive() {
  stopLive(true); LOC.live = true;
  LOC.timer = setInterval(async () => {
    if (!S.me) return;
    const g = await tryGps();
    if (g.err) { LOC.lastErr = g.err; stopLive(true); toast('Live location stopped: ' + g.err, 'warn'); schedule(); return; }
    await act(() => addPing(S.me.id, today(), { t: Date.now(), src: 'live-gps', lat: g.lat, lng: g.lng, acc: g.acc, mode: 'update' }));
    schedule();
  }, LOC_EVERY_MIN * 60000);
}
function stopLive(quiet) { clearInterval(LOC.timer); LOC.timer = null; if (LOC.live && !quiet) toast('Live location stopped'); LOC.live = false; }

/* photo: shrink on the phone before upload so it is quick and small */
async function shrinkImage(file, max = 1280) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.72));
    return blob ? new File([blob], `location-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
async function locPhotoPicked(el) {
  const file = el.files?.[0]; if (!file || !M) return;
  if (!/^image\//.test(file.type)) { toast('Choose a photo (JPG or PNG).', 'warn'); return; }
  M.photoBusy = true; drawModal();
  await act(async () => { M.photo = await uploadFile(await shrinkImage(file)); });
  if (M) { M.photoBusy = false; drawModal(); }
}

/* ── the share form ── */
function locForm(mode) {
  if (!M) return '';
  M.mode = mode;
  const T = today(), kind = remoteKind(S.me.id, T), req = cfg().wfhLoc !== 'optional';
  const home = S.me.wfhLoc, g = M.gps;
  const btn = mode === 'in' ? 'Share location & check in' : mode === 'out' ? 'Share location & check out' : 'Share location';
  return `${mhead(mode === 'update' ? 'Share my location' : mode === 'in' ? 'Check in — share your location' : 'Check out — share your location',
    `${kind === 'OD' ? 'Official duty' : kind === 'WFH' ? 'Work from home' : 'Location update'} · ${fmtD(T)} · your reporting manager and HR can see this`)}
  <form data-f="loc" data-mode="${mode}"><div class="body fgrid">
    <div class="full locbox">
      <div class="row" style="justify-content:space-between;gap:10px"><div><b>1. Use this device’s location</b><div class="tiny muted">Fastest — works on phones and browsers that allow location.</div></div>
        <button type="button" class="btn ${g ? '' : 'pri'}" data-a="loc-gps" ${M.gpsBusy ? 'disabled' : ''}>${M.gpsBusy ? 'Finding you…' : g ? 'Refresh' : 'Use my location'}</button></div>
      ${g ? `<div class="small" style="margin-top:8px;color:var(--ok)">Found: ${g.lat}, ${g.lng} (±${g.acc} m) · <a href="${mapUrl(g)}" target="_blank" rel="noopener">check on map</a></div>` : ''}
      ${M.gpsErr ? `<div class="small" style="margin-top:8px;color:var(--warn)">${esc(M.gpsErr)} Use option 2 instead — it takes 10 seconds.</div>` : ''}
    </div>
    <div class="full locbox">
      <b>2. Paste a Google Maps link</b>
      <label class="f" style="margin-top:6px"><span class="sr">Map link or coordinates</span><input class="i" id="lc-link" name="link" placeholder="https://maps.app.goo.gl/…  or  26.1445, 91.7362" ${g ? '' : 'autofocus'}></label>
      <label class="check" style="margin-top:6px"><input type="checkbox" id="lc-live" name="liveLink"> This is a <b>live location</b> link (it keeps updating on the map)</label>
      <details style="margin-top:6px"><summary class="small" style="cursor:pointer;color:var(--accent)">How do I get the link?</summary><div class="small" style="padding:6px 0 0">
        <p style="margin:0 0 6px"><b>Live location for the whole day (recommended):</b> open Google Maps on your phone → tap your profile picture → <i>Location sharing</i> → <i>New share</i> → choose <i>Until you turn this off</i> (or 9 hours) → <i>Copy to clipboard</i> → paste here and tick “live location”. Your manager sees you move on the map in real time; stop it from Google Maps after work.</p>
        <p style="margin:0"><b>Just your current spot:</b> Google Maps → tap the blue dot → <i>Share location</i> or <i>Share</i> → <i>Copy</i> → paste here.</p></div></details>
    </div>
    <label class="f full">Where are you? (address or landmark, optional)<input class="i" id="lc-addr" name="addr" placeholder="e.g. Home, Zoo Road, Guwahati / Client office — Apollo Pharmacy, Jorhat"></label>
    <div class="f full" style="display:grid;gap:4px"><span>Photo <span class="muted">(optional — e.g. your workspace or the client site)</span></span>
      ${M.photo ? `<div class="row small" style="color:var(--ok)">Photo attached · ${fsize(M.photo.size)} <button type="button" class="btn sm ghost" data-a="loc-photo-rm">Remove</button></div>`
        : `<input class="i" type="file" id="lc-photo" accept="image/*" data-c="locPhoto" ${M.photoBusy ? 'disabled' : ''}>${M.photoBusy ? '<span class="tiny muted">Uploading…</span>' : ''}`}</div>
    ${g ? `<label class="check full"><input type="checkbox" id="lc-auto" name="auto" ${LOC.live ? 'checked' : ''}> Keep updating my location every ${LOC_EVERY_MIN} minutes while OfficeHub is open</label>` : ''}
    ${kind === 'WFH' && !home ? `<label class="check full"><input type="checkbox" id="lc-home" name="saveHome" checked> Save this as my usual work-from-home location (managers will see if you’re far from it)</label>` : ''}
  </div><footer>
    <button type="button" class="btn" data-a="close">Cancel</button>
    ${mode !== 'update' && !req ? `<button type="submit" class="btn" name="skip" value="1">Check ${mode} without location</button>` : ''}
    <button type="submit" class="btn pri" ${M.photoBusy || M.gpsBusy ? 'disabled' : ''}>${btn}</button></footer></form>`;
}

async function locSubmit(form, fd) {
  const v = (k) => String(fd.get(k) ?? '').trim();
  const mode = form.dataset.mode, T = today(), skip = fd.get('skip') === '1';
  return act(async () => {
    const g = M?.gps, link = v('link'), parsed = parseCoords(link);
    if (!skip) {
      if (!g && !link) fail('Tap “Use my location” or paste a Google Maps link.');
      if (link && !parsed && !/^https?:\/\/\S+$/i.test(link)) fail('Paste a link starting with https:// — or coordinates like 26.1445, 91.7362.');
      const pos = g || parsed || {};
      const liveLink = fd.get('liveLink') === 'on' && !!link;
      const ping = { t: Date.now(), src: g ? 'gps' : liveLink ? 'live' : 'link', mode, lat: pos.lat ?? null, lng: pos.lng ?? null, acc: g?.acc ?? null, link: link || null, addr: v('addr').slice(0, 200), photo: M?.photo || null };
      await addPing(S.me.id, T, ping);
      if (fd.get('saveHome') === 'on' && pos.lat != null) await patch(`emp/${S.me.id}`, { wfhLoc: { lat: pos.lat, lng: pos.lng, addr: ping.addr || '', at: Date.now() } });
      if (g && fd.get('auto') === 'on' && mode !== 'out') startLive();
      if (mode === 'out' || fd.get('auto') !== 'on') stopLive(true);
      const far = awayFromHome(S.me.id, ping);
      if (far != null && far > 2 && remoteKind(S.me.id, T) === 'WFH') {
        const mgr = S.me.managerId;
        if (mgr) await notify([mgr], { title: `${S.me.name} shared a WFH location ${kmTxt(far)} from their usual one`, body: ping.addr || '', go: { view: 'attendance' } });
      }
    } else if (mode === 'out') stopLive(true);
    if (mode === 'in' || mode === 'out') await addPunches(S.me.id, T, [Date.now()], 'web');
    closeModal();
    toast(mode === 'update' ? 'Location shared' : `${mode === 'in' ? 'Checked in' : 'Checked out'} at ${hm(Date.now())}${skip ? '' : ' · location shared'}`);
  });
}

async function locAction(a, el) {
  switch (a) {
    case 'loc-share': return openModal(() => locForm('update'));
    case 'loc-stop': stopLive(); return schedule();
    case 'loc-gps': {
      if (!M) return;
      M.gpsBusy = true; M.gpsErr = ''; drawModal();
      const g = await tryGps(); if (!M) return;
      M.gpsBusy = false;
      if (g.err) M.gpsErr = g.err; else M.gps = g;
      return drawModal();
    }
    case 'loc-photo-rm': if (M) { M.photo = null; drawModal(); } return;
    case 'loc-view': return openModal(() => locDetail(el.dataset.e, el.dataset.d));
    case 'loc-pic': {
      const l = locOf(el.dataset.e, el.dataset.d), p = l?.pings?.[+el.dataset.i]; if (!p?.photo) return;
      return act(async () => { const src = await previewSrc(p.photo); if (M) { M.pic = src; drawModal(); } });
    }
    case 'loc-pic-close': if (M) { M.pic = null; drawModal(); } return;
    case 'loc-home-clear': return act(() => patch(`emp/${el.dataset.e}`, { wfhLoc: null }), 'Usual WFH location cleared — it will be set again at the next check-in');
  }
}

/* ── views ── */
function locDetail(empId, d) {
  const e = empById(empId), l = locOf(empId, d), pings = l?.pings || [];
  const home = e?.wfhLoc;
  if (M?.pic) return `${mhead('Photo')}<div class="body" style="text-align:center"><img src="${esc(M.pic)}" alt="Location photo" style="max-width:100%;max-height:70vh;border-radius:8px"></div><footer><button class="btn" data-a="loc-pic-close">Back</button></footer>`;
  return `${mhead(`${esc(e?.name || 'Someone')} — locations`, `${fmtD(d)} · ${remoteKind(empId, d) === 'OD' ? 'Official duty' : remoteKind(empId, d) === 'WFH' ? 'Work from home' : 'Attendance day'}`)}
  <div class="body">
    ${home ? `<div class="small muted" style="margin-bottom:10px">Usual WFH location: <a href="${mapUrl(home)}" target="_blank" rel="noopener">${esc(home.addr || `${home.lat}, ${home.lng}`)}</a>${isHR() || isMgmt() ? ` · <button class="btn sm ghost" data-a="loc-home-clear" data-e="${empId}">Reset</button>` : ''}</div>` : ''}
    ${pings.length ? `<ul class="list">${pings.map((p, i) => { const far = awayFromHome(empId, p); return `<li style="display:block">
      <div class="row" style="justify-content:space-between"><b>${hm(p.t)}</b><span class="row" style="gap:6px">${p.mode === 'in' ? '<span class="pill t-ok">Check-in</span>' : p.mode === 'out' ? '<span class="pill">Check-out</span>' : ''}<span class="pill ${p.src === 'live' ? 't-info' : ''}">${SRC_LABEL[p.src] || 'Shared'}</span></span></div>
      ${p.addr ? `<div class="small">${esc(p.addr)}</div>` : ''}
      <div class="small muted">${p.lat != null ? `${p.lat}, ${p.lng}${p.acc ? ` (±${p.acc} m)` : ''}` : 'Coordinates inside the link'}${far != null ? ` · <span style="${far > 2 ? 'color:var(--warn);font-weight:600' : ''}">${kmTxt(far)} from usual WFH location</span>` : ''}</div>
      <div class="row" style="margin-top:4px;gap:6px">${mapUrl(p) ? `<a class="btn sm" href="${esc(mapUrl(p))}" target="_blank" rel="noopener">${p.src === 'live' ? 'Open live location' : 'Open in Maps'}</a>` : ''}${p.photo ? `<button class="btn sm" data-a="loc-pic" data-e="${empId}" data-d="${d}" data-i="${i}">View photo</button>` : ''}</div></li>`; }).reverse().join('')}</ul>`
      : empty('No location shared for this day.')}
    <p class="tiny muted" style="margin-top:10px">“Live link” opens Google Maps’ own live-location page, which keeps moving for as long as the employee shares it. Other entries are the spot at that time.</p>
  </div><footer><button class="btn" data-a="close">Close</button></footer>`;
}

/* small cell for the daily board */
function locCell(empId, d) {
  const l = locOf(empId, d), p = lastPing(l);
  if (!p) return needsLoc(empId, d) && d <= today() ? '<span class="tiny" style="color:var(--warn)">Not shared</span>' : '';
  const far = awayFromHome(empId, p), live = l.pings.some((x) => x.src === 'live' || x.src === 'live-gps');
  return `<button class="btn sm ghost" data-a="loc-view" data-e="${empId}" data-d="${d}" style="padding:2px 6px;text-align:left"><span class="small">${live ? '<b style="color:var(--accent)">Live</b> · ' : ''}${hm(p.t)}${l.pings.length > 1 ? ` (${l.pings.length})` : ''}</span>${far != null && far > 2 ? `<br><span class="tiny" style="color:var(--warn)">${kmTxt(far)} away</span>` : p.addr ? `<br><span class="tiny muted trunc" style="display:inline-block;max-width:150px">${esc(p.addr)}</span>` : ''}</button>`;
}
const locText = (empId, d) => { const p = lastPing(locOf(empId, d)); return p ? `${hm(p.t)} ${p.addr || ''} ${mapUrl(p) || ''}`.trim() : ''; };

/* my-day strip on the dashboard */
function myLocStrip() {
  if (!S.me) return '';
  const T = today(), kind = remoteKind(S.me.id, T), l = locOf(S.me.id, T), p = lastPing(l);
  if (!kind && !p) return '';
  const every = +(cfg().locEveryH ?? 3), out = punchesOn(S.me.id, T).length % 2 === 0 && punchesOn(S.me.id, T).length > 0;
  const stale = p && every > 0 && !out && !LOC.live && p.src !== 'live' && Date.now() - p.t > every * 3600000;
  const tone = !p || stale ? 'var(--warn)' : 'var(--ok)';
  const msg = LOC.live ? `Live location on · last update ${hm(p?.t)}`
    : !p ? `${kind === 'OD' ? 'Official duty' : 'Working from home'} today — share your location`
    : p.src === 'live' ? `Live location link shared at ${hm(p.t)}`
    : stale ? `Location last shared at ${hm(p.t)} — please share again` : `Location shared at ${hm(p.t)}`;
  return `<div class="locstrip" style="border-color:${tone}"><span class="dot" style="background:${tone}"></span><span class="grow small">${msg}</span>
    ${p ? `<button class="btn sm ghost" data-a="loc-view" data-e="${S.me.id}" data-d="${T}">View</button>` : ''}
    ${LOC.live ? '<button class="btn sm" data-a="loc-stop">Stop</button>' : `<button class="btn sm ${!p || stale ? 'pri' : ''}" data-a="loc-share">${p ? 'Share again' : 'Share location'}</button>`}</div>`;
}

/* manager alert */
function locAlertCount(ids, d) {
  if ((cfg().wfhLoc || 'required') === 'off') return 0;
  const [h, m] = (cfg().shift?.start || '09:30').split(':').map(Number);
  const now = new Date(); if (now.getHours() * 60 + now.getMinutes() < h * 60 + m + 30) return 0;
  return ids.filter((id) => id !== S.me?.id && remoteOn(id, d) && !lastPing(locOf(id, d))).length;
}
</script>
<style>
.locbox{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--sunk)}
.locstrip{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-left-width:4px;border-radius:8px;padding:6px 8px;margin:8px 0 0}
.locstrip .dot{width:8px;height:8px;border-radius:50%;flex:none}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--sunk);border-radius:999px;padding:3px 4px 3px 10px;font-size:13px}
.chip-x{border:0;background:transparent;color:var(--muted);cursor:pointer;border-radius:50%;width:22px;height:22px;font-size:11px}
.chip-x:hover{background:var(--line);color:var(--ink)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

/* ── dashboard ── */
.dayband{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;margin-bottom:14px}
.day-seg{padding:14px 16px;border-left:1px solid var(--line);min-width:0}
.day-seg:first-child{border-left:0}
.sec-l{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin-bottom:8px}
.sec-h{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;margin:26px 0 10px}
.sec-h .muted{text-transform:none;letter-spacing:0;font-weight:400}
.mini-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.mini-kpis button{background:var(--sunk);border:0;border-radius:8px;padding:8px 6px;text-align:left;cursor:pointer;color:var(--ink);min-width:0}
.mini-kpis button:hover,.kt:hover{outline:1px solid var(--line)}
.mini-kpis b{display:block;font-size:1.3rem;line-height:1.1}
.mini-kpis span{font-size:.7rem;color:var(--muted)}
b.bad,.v.bad{color:var(--bad)} b.warn,.v.warn{color:var(--warn)} .v.ok{color:var(--ok)}
.dgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:14px;align-items:start}
.span3{grid-column:1/-1}
.kstrip{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;margin-bottom:14px}
.kt{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;text-align:left;cursor:pointer;color:var(--ink);min-width:0}
.kt .l{display:block;font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kt .v{display:block;font-size:1.45rem;font-weight:700;line-height:1.2}
.kt small{font-size:.8rem;color:var(--muted);font-weight:500}
.count{display:inline-block;min-width:20px;padding:0 6px;border-radius:999px;background:var(--sunk);color:var(--muted);font-size:.72rem;font-weight:600;text-align:center;margin-left:4px}
.card-tabs{margin:0;padding:0 8px}
.more{padding:8px 16px;border-top:1px solid var(--line)}
.list.cols2{display:grid;grid-template-columns:1fr 1fr}
.list.cols2>li{border-right:1px solid var(--line)}
.bar{height:6px;border-radius:3px;background:var(--sunk);margin-top:4px;overflow:hidden}
.bar span{display:block;height:100%;background:var(--ok);border-radius:3px}
.date-chip{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;width:40px;height:40px;border-radius:8px;background:var(--sunk);font-size:.65rem;color:var(--muted);text-transform:uppercase;flex:none;line-height:1.1}
.date-chip b{font-size:.95rem;color:var(--ink)}
.dot-s{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:6px;vertical-align:1px}
.dot-s.d-ok{background:var(--ok)} .dot-s.d-bad{background:var(--bad)} .dot-s.d-warn{background:var(--warn)}
/* ── work-log colours ── */
.wc-ok{--wc:var(--ok);--wcs:var(--ok-soft)} .wc-late{--wc:var(--vio);--wcs:var(--vio-soft)} .wc-miss{--wc:var(--bad);--wcs:var(--bad-soft)} .wc-due{--wc:var(--warn);--wcs:var(--warn-soft)} .wc-none{--wc:var(--line);--wcs:transparent}
.wl7{display:flex;gap:4px;margin-top:8px}
.wl7-d{flex:1;height:28px;border-radius:6px;border:1px solid var(--wc);background:var(--wcs);color:var(--wc);font-size:.7rem;font-weight:600;cursor:pointer;padding:0}
.wl7-d.wc-none{color:var(--muted)}
.wl-layout{display:grid;grid-template-columns:minmax(300px,360px) 1fr;gap:16px;align-items:start}
.wl-cal{position:sticky;top:12px}
.wl-cal header h2{flex:1;text-align:center}
.cal-h,.cal-g{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.cal-h span{font-size:.7rem;color:var(--muted);text-align:center;padding-bottom:2px}
.cal-d{aspect-ratio:1/1;border-radius:8px;border:1px solid var(--wc);background:var(--wcs);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:0;color:var(--ink);min-width:0}
.cal-d .n{font-weight:600;font-size:.92rem}
.cal-d.wc-ok .n,.cal-d.wc-late .n,.cal-d.wc-miss .n{color:var(--wc)}
.cal-d.wc-ok,.cal-d.wc-late,.cal-d.wc-miss{border-width:2px}
.cal-d .s{font-size:.55rem;color:var(--wc);font-weight:600;text-transform:uppercase;letter-spacing:.02em}
.cal-d.wc-none{border-color:transparent}
.cal-d.off .n{color:var(--muted)}
.cal-d:disabled{opacity:.35;cursor:default}
.cal-d.today{box-shadow:inset 0 0 0 1px var(--ink)}
.cal-d.sel{outline:2px solid var(--accent);outline-offset:1px}
.cal-legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;font-size:.78rem;color:var(--muted)}
.cal-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--wc);margin-right:5px;vertical-align:-1px}
.cal-legend b{color:var(--ink)}
.wl-dayhead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:12px 16px}
.wlg td{padding:1px}
.sq{width:16px;height:16px;border-radius:4px;border:1px solid var(--wc);background:var(--wcs);cursor:pointer;padding:0;display:block;margin:auto}
.sq.wc-ok,.sq.wc-late,.sq.wc-miss{background:var(--wc)}
.sq.sel{outline:2px solid var(--accent);outline-offset:1px}
@media (max-width:1100px){.dayband{grid-template-columns:1fr 1fr}.day-seg:nth-child(3){border-left:0}.day-seg:nth-child(n+3){border-top:1px solid var(--line)}.kstrip{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:860px){.dayband,.dgrid,.wl-layout{grid-template-columns:1fr}.day-seg{border-left:0;border-top:1px solid var(--line)}.day-seg:first-child{border-top:0}.span3{grid-column:auto}.list.cols2{grid-template-columns:1fr}.wl-cal{position:static}.hide-sm{display:none}}
@media (max-width:520px){.kstrip{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
