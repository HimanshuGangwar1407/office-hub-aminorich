<script>
/* ═════════════ Access control, salary sheet, direct messages ═════════════
   Salaries live in pay/{empId} and payroll runs in payroll/{YYYY-MM}. Those two collections are
   protected by the app's database rules: only people who are Editors of this app (and the owner)
   can read or write them — everyone else gets nothing back, whatever the screen shows. */

/* ── who can see which window / tab ── */
const ROLES = [['ADMIN', 'Administrator'], ['DIRECTOR', 'Director'], ['HR', 'HR'], ['MANAGER', 'Manager'], ['EMPLOYEE', 'Employee']];
const ACCESS_KEYS = [['chats', 'Chats'], ['attendance', 'Attendance'], ['salary', 'Attendance › Salary sheet'], ['leave', 'Leave'], ['tasks', 'Tasks'], ['worklog', 'Work log'], ['approvals', 'Approvals'], ['claims', 'Expense claims'],
  ['departments', 'Departments'], ['people', 'People'], ['reports', 'Reports'], ['settings', 'Settings']];
const ACCESS_DEFAULT_TXT = { people: 'Managers, HR, directors', reports: 'Managers, HR, directors', settings: 'HR and administrators', salary: 'HR and administrators' };
function accessRule(k) { const a = cfg().access?.[k]; return a && (a.roles?.length || a.depts?.length || a.people?.length) ? a : null; }
function canView(k, def = () => true) {
  if (!S.me) return false;
  if (S.me.role === 'ADMIN' || k === 'dashboard') return true; // administrators see every window
  const a = accessRule(k);
  if (a) return !!(a.roles?.includes(S.me.role) || a.depts?.includes(S.me.deptId) || a.people?.includes(S.me.id));
  return def();
}
const canSalary = () => canView('salary', () => isHR());
function accessSummary(k) {
  const a = accessRule(k);
  if (!a) return `<span class="muted">${esc(ACCESS_DEFAULT_TXT[k] || 'Everyone')}</span> <span class="tiny muted">(default)</span>`;
  const parts = [...(a.roles || []).map((r) => ROLES.find((x) => x[0] === r)?.[1] || r), ...(a.depts || []).map((d) => deptOf(d)?.name || 'Department'), ...(a.people || []).map(nameOf)];
  return `${esc(parts.join(', '))} <span class="tiny muted">+ administrators</span>`;
}
function accessForm(k) {
  if (!M) return '';
  if (!M.acc) { const a = accessRule(k) || {}; M.acc = { roles: [...(a.roles || [])], depts: [...(a.depts || [])], people: [...(a.people || [])] }; }
  const A = M.acc, label = ACCESS_KEYS.find((x) => x[0] === k)?.[1] || k;
  return `${mhead(`Who can see “${esc(label)}”`, 'Administrators always see everything. Leave everything unticked to go back to the default.')}
  <form data-f="acc-save" data-k="${k}"><div class="body grid" style="gap:14px">
    <div><div class="sec-l">Roles</div><div class="row" style="gap:14px">${ROLES.filter((r) => r[0] !== 'ADMIN').map(([r, l]) => `<label class="check"><input type="checkbox" id="ac-r-${r}" name="roles" value="${r}" ${A.roles.includes(r) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
    <div><div class="sec-l">Departments</div><div class="row" style="gap:14px">${cfg().depts.map((d) => `<label class="check"><input type="checkbox" id="ac-d-${d.id}" name="depts" value="${d.id}" ${A.depts.includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}</div></div>
    <div><div class="sec-l">Particular people</div>
      <select class="i" id="ac-add" data-c="accAdd">${peopleGroups(null, { blank: '+ Add a person…', exclude: A.people })}</select>
      <div class="row" style="margin-top:8px;gap:6px">${A.people.map((id) => `<span class="chip"><input type="hidden" name="people" value="${id}">${esc(nameOf(id))}<button type="button" class="chip-x" data-a="acc-rm" data-id="${id}" aria-label="Remove ${esc(nameOf(id))}">✕</button></span>`).join('') || '<span class="small muted">Nobody added.</span>'}</div></div>
    ${k === 'salary' ? '<p class="tiny muted" style="margin:0">Salary figures are also protected in the database: besides being allowed here, a person must be an <b>Editor</b> of this app (Share → change their access) to load them.</p>' : '<p class="tiny muted" style="margin:0">This hides the window in the menu. Shared records such as tasks or requests are still visible where they belong to the person (e.g. their own approvals).</p>'}
  </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button type="submit" class="btn" name="reset" value="1">Reset to default</button><button type="submit" class="btn pri">Save</button></footer></form>`;
}
function accessCard() {
  return card('Who can see each window', `<div class="tbl-wrap"><table class="t"><thead><tr><th>Window / tab</th><th>Visible to</th><th></th></tr></thead><tbody>
    <tr><td>Dashboard</td><td class="muted">Everyone</td><td></td></tr>
    ${ACCESS_KEYS.map(([k, l]) => `<tr><td>${esc(l)}</td><td class="small">${accessSummary(k)}</td><td style="text-align:right"><button class="btn sm" data-a="acc-edit" data-k="${k}">Change</button></td></tr>`).join('')}
  </tbody></table></div><p class="tiny muted" style="padding:10px 16px;margin:0">Administrators (${esc(active().filter((e) => e.role === 'ADMIN').map((e) => e.name).join(', ') || '—')}) always see every window. Change someone’s role on the People page.</p>`, { list: true });
}

/* ── direct messages ── */
async function startDM(other) {
  if (!other || other === S.me.id) return;
  const ids = [S.me.id, other].sort(), id = `dm-${ids[0]}-${ids[1]}`;
  if (!CHAT.list.some((c) => c.id === id)) await put(`chat/${id}`, { kind: 'dm', members: ids, created: Date.now(), createdBy: S.me.id });
  Object.assign(S.ui, { chat: id, chTab: 'msgs' });
  if (S.view !== 'chats') setView('chats'); else schedule();
  setTimeout(() => document.getElementById('ch-text')?.focus(), 120);
}

/* ── salary data (protected collections, loaded only for people allowed to see salaries) ── */
const PAY = { sub: false, map: {}, runs: {}, fines: [], err: '', loaded: false };
function ensurePay() {
  if (PAY.sub || !canSalary() || !S.db) return;
  PAY.sub = true;
  if (S.canEdit === false) { PAY.err = 'not_editor'; PAY.loaded = true; return; }
  S.db.collection('pay').onSnapshot((q) => { const m = {}; q.docs.forEach((d) => { m[d.id] = d.data(); }); PAY.map = m; PAY.loaded = true; PAY.err = ''; schedule(); },
    (e) => { PAY.err = e?.code || 'denied'; PAY.loaded = true; schedule(); });
  S.db.collection('fines').onSnapshot((q) => { PAY.fines = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.at - a.at); schedule(); }, () => {});
  S.db.collection('payroll').onSnapshot((q) => { const m = {}; q.docs.forEach((d) => { m[d.id] = { id: d.id, ...d.data() }; }); PAY.runs = m; schedule(); }, () => {});
}
const PAYCFG = () => { const c = { fullH: 8, missH: 4, wfhCut: 25, ...(cfg().pay || {}) }; if (c.missH == null) c.missH = c.halfH ?? 4; return c; };
const PCODE = { P: ['Full hours', 't-ok'], S: ['Short hours', 't-warn'], A: ['Absent', 't-bad'], I: ['Missing check-out', 't-warn'],
  LV: ['Paid leave', 't-vio'], HL: ['Half-day leave', 't-vio'], LWP: ['Leave without pay', 't-bad'], WFH: ['Work from home', 't-info'], OD: ['Official duty', 't-info'], WO: ['Sunday (paid off)', ''], H: ['Holiday (paid)', ''], NJ: ['Not on payroll', ''], F: ['Not yet', ''] };
const workMin = (empId, d) => { const ps = punchesOn(empId, d); return ps.length > 1 ? Math.round((ps[ps.length - 1].t - ps[0].t) / 60000) : 0; };
const hhmm = (m) => { m = Math.round(m || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
/* one day: required minutes (what the company expects) and credited minutes (what counts as worked) */
function payDay(emp, d, P = PAYCFG()) {
  const T = today(), full = Math.round(P.fullH * 60);
  const r = { d, k: '', w: 0, req: 0, cred: 0, wfh: false, note: '' };
  if (d >= T) { r.k = 'F'; return r; }
  if ((emp.joining && d < emp.joining) || (emp.exitDate && d > emp.exitDate)) { r.k = 'NJ'; return r; }
  if (weeklyOff(d)) { r.k = 'WO'; return r; }
  const hol = holidayOn(d); if (hol) { r.k = 'H'; r.note = hol.name; return r; }
  const ps = punchesOn(emp.id, d); r.w = workMin(emp.id, d); r.req = full;
  const worked = () => (ps.length === 1 ? Math.round(P.missH * 60) : r.w);
  const lv = leaveOn(emp.id, d);
  if (lv) {
    const lt = cfg().leaveTypes.find((x) => x.code === lv.data.lt), unpaid = lt?.unpaid || lv.data.lt === 'LWP';
    if (!lv.data.half) { r.k = unpaid ? 'LWP' : 'LV'; r.cred = unpaid ? 0 : full; r.note = lv.data.lt; return r; }
    r.k = 'HL'; r.cred = (unpaid ? 0 : full / 2) + worked(); r.note = `${lv.data.lt} half day${unpaid ? ' (unpaid)' : ' (paid ' + hhmm(full / 2) + ')'}`; return r;
  }
  const rem = remoteOn(emp.id, d);
  if (rem && rem.data.kind === 'OD') { r.k = 'OD'; r.cred = full; r.note = rem.data.location || ''; return r; }
  if (rem) { r.k = 'WFH'; r.wfh = true; r.cred = ps.length ? worked() : full; r.note = `${P.wfhCut}% of the day’s pay deducted${ps.length ? '' : ' · no punches, full hours assumed'}`; return r; }
  if (ps.length === 1) { r.k = 'I'; r.cred = worked(); r.note = `Missing check-out — ${hhmm(r.cred)} credited until a correction is approved`; return r; }
  if (!ps.length) { r.k = 'A'; return r; }
  r.cred = r.w; r.k = r.w >= full ? 'P' : 'S';
  return r;
}
const FINE_CATS = ['Late coming', 'Absent without notice', 'Left early without approval', 'Misconduct', 'Damage / loss of company property', 'Policy / safety violation', 'Other'];
const finesFor = (empId, m) => PAY.fines.filter((f) => f.empId === empId && f.month === m && f.status !== 'WAIVED');
/* the month: base pay for days on payroll, minus pay for the total hours short (extra hours are not paid), minus WFH cut, minus fines */
function payFor(emp, m, P = PAYCFG()) {
  const days = eachDay(m + '-01', monthEnd(m)), salary = +(PAY.map[emp.id]?.monthly || 0), rate = salary / days.length, hourRate = rate / P.fullH;
  const rows = days.map((d) => payDay(emp, d, P));
  const n = (...k) => rows.filter((x) => k.includes(x.k)).length;
  const counted = rows.filter((x) => !['F', 'NJ'].includes(x.k)).length;
  const req = rows.reduce((a, x) => a + x.req, 0), cred = rows.reduce((a, x) => a + x.cred, 0);
  const short = Math.max(0, req - cred), extra = Math.max(0, cred - req);
  const base = Math.round(rate * counted), shortCut = Math.round((short / 60) * hourRate);
  const wfhDays = n('WFH'), wfhCut = Math.round(wfhDays * rate * (P.wfhCut / 100));
  const earned = Math.max(0, base - shortCut - wfhCut);
  const fl = finesFor(emp.id, m), fines = fl.reduce((a, f) => a + (+f.amount || 0), 0);
  return { emp, salary, rate, hourRate, rows, counted, base, req, cred, short, extra, shortCut, wfhCut, wfh: wfhDays, deduction: shortCut + wfhCut, earned, fines, fineList: fl, net: Math.max(0, earned - fines),
    present: n('P'), shortDays: n('S'), absent: n('A'), leave: n('LV') + n('HL') * 0.5, lwp: n('LWP'), od: n('OD'), missing: n('I'), off: n('WO', 'H'), workDays: rows.filter((x) => x.req).length, partial: rows.some((x) => x.k === 'F') };
}

/* ── the salary sheet (a tab inside Attendance) ── */
function vSalary() {
  ensurePay();
  if (!PAY.loaded) return card('Salary sheet', '<p class="muted">Loading salaries…</p>');
  if (PAY.err) return card('Salary sheet', `<p>Salary figures are protected and couldn’t be loaded for your login.</p><p class="small muted">Ask the app owner to open <b>Share</b> and make you an <b>Editor</b> of OfficeHub, then reload.</p>`);
  const T = today(), m = ui('payMonth', addDays(T.slice(0, 7) + '-01', -1).slice(0, 7)), P = PAYCFG(), dept = ui('payDept', ''), q = (ui('payQ', '') || '').toLowerCase();
  const ppl = active().concat(S.emps.filter((e) => e.status === 'EXITED' && e.exitDate >= m + '-01')).filter((e) => (!e.joining || e.joining <= monthEnd(m)) && (!dept || e.deptId === dept) && (!q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q))).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  const res = ppl.map((e) => payFor(e, m, P));
  const run = PAY.runs[m], tot = res.reduce((a, r) => ({ s: a.s + r.salary, b: a.b + r.base, sc: a.sc + r.shortCut, w: a.w + r.wfhCut, f: a.f + r.fines, n: a.n + r.net, sh: a.sh + r.short, ex: a.ex + r.extra }), { s: 0, b: 0, sc: 0, w: 0, f: 0, n: 0, sh: 0, ex: 0 });
  const locked = run?.status === 'FINAL', mFines = PAY.fines.filter((f) => f.month === m);
  const noSal = res.filter((r) => !r.salary).length, partial = m >= T.slice(0, 7);
  const wd = eachDay(m + '-01', partial ? addDays(T, -1) : monthEnd(m)).filter(workingDay).length;
  return `<div class="filters"><input type="month" class="i" id="pay-m" data-c="payMonth" value="${m}" max="${T.slice(0, 7)}"><select class="i" id="pay-d" data-c="payDept">${deptOpts(dept, 'All departments')}</select><input class="i" id="pay-q" data-i="payQ" placeholder="Search name or code" value="${esc(ui('payQ', ''))}">
      <button class="btn pri" data-a="pay-export">Export to Excel</button><button class="btn" data-a="pay-csv" title="Comma-separated file — opens in Excel, Google Sheets, Tally import">CSV</button>${locked ? '' : '<button class="btn" data-a="pay-fine">+ Add fine</button>'}${run?.status === 'FINAL' ? `<span class="pill t-ok" style="align-self:center">Finalised ${fmtDT(run.at)}</span>${S.me.role === 'ADMIN' ? '<button class="btn" data-a="pay-reopen">Reopen</button>' : ''}` : `<button class="btn" data-a="pay-run" ${partial ? 'title="The month is not over — the run will be a draft up to yesterday"' : ''}>${run ? 'Re-run payroll' : 'Run payroll'}</button>${run ? `<button class="btn" data-a="pay-final">Finalise</button>` : ''}`}</div>
    ${partial ? `<div class="alert t-warn" style="cursor:default;margin-bottom:12px">${fmtM(m)} is still running — hours are counted up to yesterday.</div>` : ''}
    ${noSal ? `<div class="alert t-warn" style="cursor:default;margin-bottom:12px">${noSal} employee(s) have no salary set — open them on the People page to add it.</div>` : ''}
    <div class="kstrip" style="grid-template-columns:repeat(6,minmax(0,1fr))">
      <div class="kt"><span class="l">Company working hours</span><span class="v">${wd * P.fullH}<small> h · ${wd} days</small></span></div><div class="kt"><span class="l">Monthly salaries</span><span class="v">${money(tot.s)}</span></div>
      <div class="kt"><span class="l">Short-time deduction</span><span class="v bad">${money(tot.sc)}</span></div><div class="kt"><span class="l">WFH deduction</span><span class="v bad">${money(tot.w)}</span></div>
      <div class="kt"><span class="l">Fines (${res.reduce((a, r) => a + r.fineList.length, 0)})</span><span class="v bad">${money(tot.f)}</span></div>
      <div class="kt"><span class="l">Net payable ${partial ? 'so far' : ''}</span><span class="v ok">${money(tot.n)}</span></div></div>
    ${card(`Salary sheet · ${fmtM(m)}`, `<div class="tbl-wrap"><table class="t pay"><thead><tr><th>Employee</th><th class="num">Monthly salary</th><th class="num">Per hour</th><th class="num" title="Working days × ${P.fullH} h (leave and official duty count as worked)">Required h</th><th class="num" title="Hours actually worked + paid leave / official duty hours">Worked h</th><th class="num">Short h</th><th class="num" title="Extra hours are not paid">Extra h<br><span class="tiny">not paid</span></th><th class="num">Absent</th><th class="num">LWP</th><th class="num">Leave</th><th class="num">WFH</th><th class="num" title="Missing check-out">Miss. punch</th><th class="num">Short-time cut</th><th class="num">WFH cut</th><th class="num">Fines</th><th class="num">Net pay</th></tr></thead><tbody>
      ${res.map((r) => `<tr class="click" data-a="pay-emp" data-id="${r.emp.id}"><td>${person(r.emp.id, `${r.emp.code || ''} · ${deptOf(r.emp.deptId)?.code || ''}`)}</td><td class="num">${r.salary ? money(r.salary) : '<span class="muted">not set</span>'}</td><td class="num">${r.salary ? '₹' + round2(r.hourRate).toLocaleString('en-IN') : ''}</td>
        <td class="num">${hhmm(r.req)}</td><td class="num">${hhmm(r.cred)}</td><td class="num" style="color:var(--bad);font-weight:600">${r.short ? hhmm(r.short) : ''}</td><td class="num muted">${r.extra ? hhmm(r.extra) : ''}</td>
        <td class="num" style="color:var(--bad)">${r.absent || ''}</td><td class="num" style="color:var(--bad)">${r.lwp || ''}</td><td class="num">${r.leave || ''}</td><td class="num">${r.wfh || ''}</td><td class="num" style="color:var(--warn)">${r.missing || ''}</td>
        <td class="num" style="color:var(--bad)">${r.shortCut ? money(r.shortCut) : ''}</td><td class="num" style="color:var(--bad)">${r.wfhCut ? money(r.wfhCut) : ''}</td><td class="num" style="color:var(--bad)" title="${esc(r.fineList.map((f) => `${money(f.amount)} — ${f.reason}`).join('\n'))}">${r.fines ? money(r.fines) : ''}</td><td class="num"><b>${money(r.net)}</b></td></tr>`).join('')}
    </tbody><tfoot><tr><td><b>Total</b></td><td class="num"><b>${money(tot.s)}</b></td><td colspan="3"></td><td class="num" style="color:var(--bad)"><b>${hhmm(tot.sh)}</b></td><td class="num muted">${hhmm(tot.ex)}</td><td colspan="5"></td><td class="num" style="color:var(--bad)"><b>${money(tot.sc)}</b></td><td class="num" style="color:var(--bad)"><b>${money(tot.w)}</b></td><td class="num" style="color:var(--bad)"><b>${money(tot.f)}</b></td><td class="num"><b>${money(tot.n)}</b></td></tr></tfoot></table></div>`, { list: true })}
    ${card(`Fines · ${fmtM(m)} <span class="count">${mFines.length}</span>`, mFines.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Employee</th><th>Date</th><th>Type</th><th>Reason</th><th class="num">Amount</th><th>Added by</th><th>Status</th><th></th></tr></thead><tbody>
      ${mFines.map((f) => `<tr><td>${person(f.empId, empById(f.empId)?.code || '')}</td><td class="small">${fmtD(f.date)}</td><td class="small">${esc(f.category)}</td><td class="small" style="max-width:320px;white-space:normal">${esc(f.reason)}${f.status === 'WAIVED' ? `<div class="tiny muted">Waived by ${esc(nameOf(f.waivedBy))}: ${esc(f.waiveReason || '')}</div>` : ''}</td><td class="num" style="${f.status === 'WAIVED' ? 'text-decoration:line-through;color:var(--muted)' : 'color:var(--bad)'}">${money(f.amount)}</td><td class="small">${esc(nameOf(f.by))}<div class="tiny muted">${fmtDT(f.at)}</div></td><td>${f.status === 'WAIVED' ? '<span class="pill">Waived</span>' : '<span class="pill t-bad">Active</span>'}</td><td style="text-align:right">${!locked && f.status !== 'WAIVED' ? `<button class="btn sm" data-a="pay-waive" data-id="${f.id}">Waive</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="body">${empty(locked ? 'No fines this month.' : 'No fines this month. Use “+ Add fine” to record one — it is deducted from that month’s net pay.')}</div>`, { list: true, actions: locked ? '' : '<button class="btn sm" data-a="pay-fine">+ Add fine</button>' })}
    ${card('How pay is calculated', `<form data-f="pay-rules" class="fgrid">
      <div class="full small" style="line-height:1.7"><b>Pay is by the minute, for the whole month.</b><br>
      1. <b>Required hours</b> = company working days × ${P.fullH} h (Mon–Sat; Sundays and holidays are paid off and not counted). Approved paid leave and official duty count as ${P.fullH} h worked; a half-day leave counts ${hhmm(P.fullH * 30)}.<br>
      2. <b>Worked hours</b> = first check-in to last check-out, every working day, added up for the month — so extra time on one day covers short time on another.<br>
      3. If worked &lt; required, only the <b>missing minutes</b> are cut: short hours × per-hour rate (monthly salary ÷ days in month ÷ ${P.fullH}). Example: 7 h on one day and nothing extra elsewhere = 1 h (60 min) cut. <b>Extra hours are not paid</b> — there is no overtime.<br>
      4. Absent days and leave without pay add ${P.fullH} h each to the short time. A missing check-out credits ${hhmm(P.missH * 60)} until a correction is approved.<br>
      5. Work from home: hours count as usual, plus <b>${P.wfhCut}% of that day’s pay</b> is cut. <b>Fines</b> come off the net pay of their month.</div>
      ${isHR() ? `<label class="f">Required hours per working day<input class="i" id="pr-f" name="fullH" type="number" min="1" max="12" step="0.25" value="${P.fullH}"></label><label class="f">Hours credited for a missing check-out<input class="i" id="pr-h" name="missH" type="number" min="0" max="12" step="0.5" value="${P.missH}"></label>
      <label class="f">WFH deduction (% of that day’s pay)<input class="i" id="pr-w" name="wfhCut" type="number" min="0" max="100" value="${P.wfhCut}"></label>
      <div class="full"><button class="btn" type="submit">Save rules</button></div>` : ''}</form>`)}`;
}
function payDetail(empId, m) {
  const e = empById(empId); if (!e) return null;
  const r = payFor(e, m), P = PAYCFG();
  const kt = (l, v, c = '') => `<div class="kt"><span class="l">${l}</span><span class="v ${c}">${v}</span></div>`;
  return `${mhead(`${esc(e.name)} — ${fmtM(m)}`, `${esc(e.code || '')} · ${esc(e.designation || '')} · monthly ${r.salary ? money(r.salary) : 'not set'} · ${money(Math.round(r.rate))}/day · ₹${round2(r.hourRate).toLocaleString('en-IN')}/hour`)}
  <div class="body"><div class="kstrip" style="grid-template-columns:repeat(4,minmax(0,1fr))">${kt('Required hours', hhmm(r.req))}${kt('Worked hours', hhmm(r.cred))}${kt('Short (deducted)', r.short ? hhmm(r.short) : '0:00', r.short ? 'bad' : 'ok')}${kt('Extra (not paid)', r.extra ? hhmm(r.extra) : '0:00')}</div>
  <div class="paycalc"><div><span>Pay for ${r.counted} day(s) on payroll (${money(Math.round(r.rate))} × ${r.counted})</span><b>${money(r.base)}</b></div>
    <div><span>Short time ${hhmm(r.short)} × ₹${round2(r.hourRate).toLocaleString('en-IN')}/h</span><b class="bad">− ${money(r.shortCut)}</b></div>
    ${r.wfh ? `<div><span>Work from home ${r.wfh} day(s) × ${P.wfhCut}% of ${money(Math.round(r.rate))}</span><b class="bad">− ${money(r.wfhCut)}</b></div>` : ''}
    ${r.fineList.map((f) => `<div><span>Fine · ${fmtDs(f.date)} · ${esc(f.category)} — ${esc(f.reason)}</span><b class="bad">− ${money(f.amount)}</b></div>`).join('')}
    <div class="tot"><span>Net pay</span><b>${money(r.net)}</b></div></div>
  <div class="tbl-wrap"><table class="t"><thead><tr><th>Date</th><th>Day</th><th>In – out</th><th class="num">Worked</th><th class="num">Required</th><th class="num">+ / −</th><th>Counted as</th><th>Note</th></tr></thead><tbody>
  ${r.rows.filter((x) => x.k !== 'F').map((x) => { const ps = punchesOn(empId, x.d), diff = x.cred - x.req; return `<tr><td>${fmtDs(x.d)}</td><td class="muted">${DAYS[dow(x.d)]}</td><td class="small">${ps.length ? `${hm(ps[0].t)} – ${ps.length > 1 ? hm(ps[ps.length - 1].t) : '?'}` : ''}</td><td class="num">${x.req || x.cred ? hhmm(x.cred) : ''}</td><td class="num muted">${x.req ? hhmm(x.req) : ''}</td><td class="num" style="${diff < 0 ? 'color:var(--bad);font-weight:600' : 'color:var(--ok)'}">${x.req ? (diff < 0 ? '−' + hhmm(-diff) : diff > 0 ? '+' + hhmm(diff) : '0:00') : ''}</td><td><span class="pill ${PCODE[x.k]?.[1] || ''}">${esc(PCODE[x.k]?.[0] || x.k)}</span></td><td class="small muted">${esc(x.note)}</td></tr>`; }).join('')}
  </tbody><tfoot><tr><td colspan="3"><b>Month</b></td><td class="num"><b>${hhmm(r.cred)}</b></td><td class="num"><b>${hhmm(r.req)}</b></td><td class="num" style="${r.short ? 'color:var(--bad)' : 'color:var(--ok)'}"><b>${r.short ? '−' + hhmm(r.short) : '+' + hhmm(r.extra)}</b></td><td colspan="2" class="small muted">${r.short ? 'Short time is deducted' : 'Extra time is not paid'}</td></tr></tfoot></table></div></div><footer>${PAY.runs[m]?.status === 'FINAL' ? '' : `<button class="btn" data-a="pay-fine" data-id="${empId}">+ Add fine</button>`}<button class="btn" data-a="pay-emp-export" data-id="${empId}">Export to Excel</button><span style="flex:1"></span><button class="btn" data-a="close">Close</button></footer>`;
}
function fineForm(pre) {
  const T = today(), m = ui('payMonth', addDays(T.slice(0, 7) + '-01', -1).slice(0, 7)), d = m === T.slice(0, 7) ? T : monthEnd(m);
  return `${mhead('Add a fine', `Deducted from ${fmtM(m)} net pay · the employee is told the amount and reason`)}<form data-f="pay-fine"><div class="body fgrid">
    <label class="f full">Employee<select class="i" id="fn-e" name="empId" required>${peopleGroups(pre || null, { blank: 'Choose a person…' })}</select></label>
    <label class="f">Date of the incident<input class="i" id="fn-d" type="date" name="date" required value="${d}" min="${m}-01" max="${monthEnd(m) < T ? monthEnd(m) : T}"></label>
    <label class="f">Amount (₹)<input class="i" id="fn-a" type="number" name="amount" min="1" step="1" required placeholder="e.g. 500"></label>
    <label class="f full">Type<select class="i" id="fn-c" name="category">${opts(FINE_CATS.map((c) => [c, c]))}</select></label>
    <label class="f full">Reason (shown to the employee)<textarea class="i" id="fn-r" name="reason" rows="3" required minlength="5" placeholder="e.g. Late by more than 30 minutes on 4 occasions despite written warning on 12 Sep"></textarea></label>
    <label class="check full"><input type="checkbox" id="fn-n" name="notify" checked> Notify the employee</label>
  </div><footer><button type="button" class="btn" data-a="close">Cancel</button><button class="btn pri" type="submit">Add fine</button></footer></form>`;
}
const hrs = (m) => round2((m || 0) / 60);
function payBook(m) {
  const rs = payRows(m), days = eachDay(m + '-01', monthEnd(m)), P = PAYCFG();
  const sum = (k) => rs.reduce((a, r) => a + (r[k] || 0), 0);
  const summary = { name: `Salary ${m}`, cols: ['Code', 'Name', 'Department', 'Designation', 'Monthly salary', 'Per day', 'Per hour', 'Days on payroll', 'Working days', 'Required hours', 'Worked hours', 'Short hours (deducted)', 'Extra hours (not paid)', 'Absent days', 'LWP days', 'Paid leave days', 'WFH days', 'Missing check-outs', 'Base pay', 'Short-time deduction', 'WFH deduction', 'Fines', 'Net pay'],
    rows: rs.map((r) => [r.emp.code, r.emp.name, deptOf(r.emp.deptId)?.name || '', r.emp.designation || '', r.salary, Math.round(r.rate), round2(r.hourRate), r.counted, r.workDays, hrs(r.req), hrs(r.cred), hrs(r.short), hrs(r.extra), r.absent, r.lwp, r.leave, r.wfh, r.missing, r.base, r.shortCut, r.wfhCut, r.fines, r.net]) };
  summary.rows.push(['', 'TOTAL', '', '', sum('salary'), '', '', '', '', hrs(sum('req')), hrs(sum('cred')), hrs(sum('short')), hrs(sum('extra')), sum('absent'), sum('lwp'), sum('leave'), sum('wfh'), sum('missing'), sum('base'), sum('shortCut'), sum('wfhCut'), sum('fines'), sum('net')]);
  const fines = { name: 'Fines', cols: ['Code', 'Name', 'Date', 'Type', 'Reason', 'Amount', 'Status', 'Added by', 'Added on', 'Waived by', 'Waive reason'],
    rows: PAY.fines.filter((f) => f.month === m).map((f) => [empById(f.empId)?.code || '', nameOf(f.empId), f.date, f.category, f.reason, +f.amount, f.status === 'WAIVED' ? 'Waived' : 'Active', nameOf(f.by), fmtDT(f.at), f.waivedBy ? nameOf(f.waivedBy) : '', f.waiveReason || '']) };
  const cellOf = (x) => (['F', 'NJ'].includes(x.k) ? '' : ['WO', 'H', 'LV', 'LWP', 'OD', 'A'].includes(x.k) ? x.k : `${hrs(x.cred)}${x.k === 'WFH' ? ' WFH' : x.k === 'I' ? ' I' : ''}`);
  const daywise = { name: 'Day-wise hours', cols: ['Code', 'Name', ...days.map((d) => `${+d.slice(8)} ${DAYS[dow(d)].slice(0, 2)}`), 'Worked h', 'Required h', 'Short h'], rows: rs.map((r) => [r.emp.code, r.emp.name, ...r.rows.map(cellOf), hrs(r.cred), hrs(r.req), hrs(r.short)]) };
  const legend = { name: 'Codes & rules', cols: ['Code', 'Meaning'], rows: [...Object.entries(PCODE).map(([k, v]) => [k, v[0]]), ['', ''], ['Numbers', 'Hours credited that day'], ['Required', `${P.fullH} h per working day (Mon–Sat, excluding holidays)`], ['Deduction', 'Only the total short hours for the month × per-hour rate; extra hours are not paid'], ['WFH', `${P.wfhCut}% of that day’s pay is deducted`]] };
  return [summary, fines, daywise, legend];
}
function payRows(m) {
  const P = PAYCFG();
  return active().concat(S.emps.filter((e) => e.status === 'EXITED' && e.exitDate >= m + '-01')).filter((e) => !e.joining || e.joining <= monthEnd(m)).sort((a, b) => (a.code || '').localeCompare(b.code || '')).map((e) => payFor(e, m, P));
}
async function payAction(a, el) {
  const m = ui('payMonth', addDays(today().slice(0, 7) + '-01', -1).slice(0, 7));
  switch (a) {
    case 'pay-emp': return openModal(() => payDetail(el.dataset.id, m));
    case 'pay-export': return exportBook(`Salary sheet ${fmtM(m)} - ${cfg().company}`, payBook(m));
    case 'pay-csv': return exportBook(`Salary sheet ${fmtM(m)}`, payBook(m).slice(0, 1), { csv: true });
    case 'pay-emp-export': { const e = empById(el.dataset.id), r = payFor(e, m); return exportBook(`Salary ${e.code || ''} ${e.name} ${fmtM(m)}`, [
      { name: 'Day-wise', cols: ['Date', 'Day', 'In', 'Out', 'Worked (h)', 'Required (h)', 'Difference (h)', 'Counted as', 'Note'], rows: [...r.rows.filter((x) => x.k !== 'F').map((x) => { const ps = punchesOn(e.id, x.d); return [x.d, DAYS[dow(x.d)], ps[0] ? hm(ps[0].t) : '', ps.length > 1 ? hm(ps[ps.length - 1].t) : '', x.req || x.cred ? hrs(x.cred) : '', x.req ? hrs(x.req) : '', x.req ? hrs(x.cred - x.req) : '', PCODE[x.k]?.[0] || x.k, x.note]; }),
        [], ['', '', '', 'Month', hrs(r.cred), hrs(r.req), hrs(r.cred - r.req)], [], ['', '', '', '', '', '', '', 'Base pay (₹)', r.base], ['', '', '', '', '', '', '', `Short ${hhmm(r.short)} × ₹${round2(r.hourRate)}/h`, -r.shortCut], ['', '', '', '', '', '', '', 'WFH deduction (₹)', -r.wfhCut], ['', '', '', '', '', '', '', 'Fines (₹)', -r.fines], ['', '', '', '', '', '', '', 'Net pay (₹)', r.net]] },
      { name: 'Fines', cols: ['Date', 'Type', 'Reason', 'Amount'], rows: r.fineList.map((f) => [f.date, f.category, f.reason, +f.amount]) }]); }
    case 'pay-fine': { if (PAY.runs[m]?.status === 'FINAL') return toast('This month is finalised — an administrator must reopen it to add fines.', 'warn'); const pre = el.dataset.id; return openModal(() => fineForm(pre)); }
    case 'pay-waive': { const f = PAY.fines.find((x) => x.id === el.dataset.id); if (!f) return; return confirmBox(`Waive ${money(f.amount)} fine for ${nameOf(f.empId)}?`, 'It stays on record as waived and is no longer deducted.', async (why) => { await patch(`fines/${f.id}`, { status: 'WAIVED', waivedBy: S.me.id, waivedAt: Date.now(), waiveReason: why }); await audit('FINE_WAIVED', { emp: f.empId, amount: f.amount }); await notify([f.empId], { title: `Fine of ${money(f.amount)} waived`, body: why }); }, { input: 'Reason for waiving', danger: false }); }
    case 'pay-run': return act(async () => {
      if (PAY.runs[m]?.status === 'FINAL') fail('This month is finalised. An administrator must reopen it first.');
      const rs = payRows(m), sum = (k) => rs.reduce((a, r) => a + (r[k] || 0), 0);
      await put(`payroll/${m}`, { month: m, at: Date.now(), by: S.me.id, status: 'DRAFT', method: 'hours', rules: PAYCFG(), partial: m >= today().slice(0, 7),
        totals: { employees: rs.length, salary: sum('salary'), base: sum('base'), shortMin: sum('short'), shortCut: sum('shortCut'), wfhCut: sum('wfhCut'), fines: sum('fines'), net: sum('net') },
        rows: rs.map((r) => ({ e: r.emp.id, s: r.salary, dc: r.counted, rq: r.req, wk: r.cred, sh: r.short, ex: r.extra, a: r.absent, u: r.lwp, l: r.leave, w: r.wfh, mp: r.missing, b: r.base, sc: r.shortCut, wd: r.wfhCut, fi: r.fines, n: r.net })) });
      await audit('PAYROLL_RUN', { month: m, employees: rs.length });
    }, `Payroll calculated for ${fmtM(m)}`);
    case 'pay-final': return confirmBox(`Finalise ${fmtM(m)} payroll?`, 'The saved figures are locked. Re-running needs an administrator to reopen it.', async () => { await patch(`payroll/${m}`, { status: 'FINAL', finalAt: Date.now(), finalBy: S.me.id }); await audit('PAYROLL_FINAL', { month: m }); }, { danger: false });
    case 'pay-reopen': return act(async () => { await patch(`payroll/${m}`, { status: 'DRAFT' }); await audit('PAYROLL_REOPEN', { month: m }); }, 'Reopened');
  }
}
async function paySubmit(f, form, fd) {
  const v = (k) => String(fd.get(k) ?? '').trim();
  if (f === 'pay-rules') return act(async () => {
    if (!isHR()) fail('Only HR can change pay rules.');
    const fullH = +v('fullH') || 8, missH = Math.max(0, +v('missH') || 0);
    if (missH > fullH) fail('Hours credited for a missing check-out can’t be more than a full day.');
    await saveCfg({ pay: { fullH, missH, wfhCut: Math.max(0, Math.min(100, +v('wfhCut') || 0)) } });
    await audit('PAY_RULES_CHANGED', { fullH, missH });
  }, 'Pay rules saved');
  if (f === 'pay-fine') return act(async () => {
    if (!canSalary() || S.canEdit === false) fail('Only HR or an administrator with Editor access can add fines.');
    const empId = v('empId'), amount = Math.round(+v('amount')), date = v('date'), reason = v('reason'), m = date.slice(0, 7);
    if (!empId) fail('Choose the employee.');
    if (!(amount > 0)) fail('Enter the fine amount.');
    if (reason.length < 5) fail('Write the reason — the employee will see it.');
    if (PAY.runs[m]?.status === 'FINAL') fail(`${fmtM(m)} payroll is finalised — reopen it first.`);
    const sal = +(PAY.map[empId]?.monthly || 0), already = finesFor(empId, m).reduce((a, x) => a + (+x.amount || 0), 0);
    if (sal && amount + already > sal) fail(`Fines can’t exceed the monthly salary (${money(sal)}).`);
    await put(`fines/${newId()}`, { empId, month: m, date, amount, category: v('category'), reason, status: 'ACTIVE', by: S.me.id, at: Date.now() });
    await audit('FINE_ADDED', { emp: empId, amount, month: m });
    if (fd.get('notify') === 'on') await notify([empId], { title: `Fine of ${money(amount)} — ${v('category')}`, body: `${reason} (deducted from ${fmtM(m)} salary)` });
    closeModal();
  }, 'Fine added');
  if (f === 'acc-save') return act(async () => {
    if (S.me.role !== 'ADMIN') fail('Only an administrator can change who sees what.');
    const k = form.dataset.k, reset = fd.get('reset') === '1';
    const acc = { ...(cfg().access || {}) };
    if (reset) delete acc[k]; else acc[k] = { roles: fd.getAll('roles').map(String), depts: fd.getAll('depts').map(String), people: fd.getAll('people').map(String) };
    await saveCfg({ access: acc }); await audit('ACCESS_CHANGED', { window: k }); closeModal();
  }, 'Access updated');
}
</script>
<style>
.pay td,.pay th{white-space:nowrap}
.paycalc{border:1px solid var(--line);border-radius:10px;margin-bottom:14px;overflow:hidden}
.paycalc>div{display:flex;justify-content:space-between;gap:12px;padding:8px 14px;border-bottom:1px solid var(--line);font-size:.9rem}
.paycalc>div:last-child{border-bottom:0}
.paycalc .tot{background:var(--sunk);font-size:1rem}
.paycalc b.bad{color:var(--bad)}
.dm-pick{padding:8px 10px;border-bottom:1px solid var(--line)}
.pay tfoot td{border-top:2px solid var(--line);padding-top:8px}
</style>
