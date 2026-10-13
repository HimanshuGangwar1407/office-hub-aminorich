<script>
'use strict';
/* ═════════════ Utilities ═════════════ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const dow = (s) => new Date(s + 'T00:00').getDay();
const monthEnd = (m) => { const d = new Date(m + '-01T00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymd(d); };
const eachDay = (a, b) => { const out = []; for (let d = a; d <= b && out.length < 400; d = addDays(d, 1)) out.push(d); return out; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtD = (s) => s ? `${s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : '—';
const fmtDs = (s) => s ? `${s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]}` : '—';
const fmtM = (m) => `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const hm = (ms) => ms ? new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDT = (ms) => ms ? `${fmtDs(ymd(new Date(ms)))}, ${hm(ms)}` : '—';
const mins = (m) => m ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : '—';
const ago = (ms) => { const s = (Date.now() - ms) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const minOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cap = (s) => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const initials = (n) => String(n || '?').replace(/^Dr\.?\s*/, '').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = (n) => `<span class="av" style="background:hsl(${hue(n)} 42% 42%)" aria-hidden="true">${esc(initials(n))}</span>`;
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const round2 = (n) => Math.round(n * 100) / 100;

/* ═════════════ State ═════════════ */
const S = {
  db: null, user: null, dl: null, uid: null, owner: false, myName: '', myEmail: null,
  cfg: null, emps: [], reqs: [], tasks: [], dreqs: [], tpls: [], att: {}, wlogs: [], ntf: [], locs: [],
  loaded: new Set(), view: 'dashboard', ui: {}, me: null, readonly: false,
};
const NEED = ['cfg', 'emp', 'req', 'task', 'dreq', 'att', 'tpl', 'wlog', 'chat'];

const DEFAULT_CFG = {
  company: 'Aminorich Nutrients', attSource: 'web', importedThrough: '', webPunch: true, wfhLoc: 'required', locEveryH: 3, liveEveryMin: 10,
  shift: { start: '09:30', end: '18:00', grace: 15, halfMin: 240 }, weeklyOff: [0], secondSat: true,
  holidays: [], announcements: [],
  leaveTypes: [
    { code: 'CL', name: 'Casual Leave', quota: 12, accrual: true, half: true, maxDays: 3, docAbove: null },
    { code: 'SL', name: 'Sick Leave', quota: 7, accrual: false, half: true, maxDays: null, docAbove: 2 },
    { code: 'LWP', name: 'Leave Without Pay', quota: 0, accrual: false, half: true, unpaid: true },
  ],
  depts: [], slaHours: 24, hrLeaveAbove: 2, directorExpenseAbove: 25000,
};
const cfg = () => S.cfg || DEFAULT_CFG;

/* ═════════════ People & permissions ═════════════ */
const active = () => S.emps.filter((e) => e.active !== false && e.status !== 'EXITED');
const empById = (id) => S.emps.find((e) => e.id === id);
const nameOf = (id) => empById(id)?.name || 'Someone';
const deptOf = (id) => cfg().depts.find((d) => d.id === id);
const isMgmt = (e = S.me) => ['ADMIN', 'HR', 'DIRECTOR'].includes(e?.role);
const isHR = (e = S.me) => ['ADMIN', 'HR'].includes(e?.role);
function teamOf(id) {
  const out = new Set();
  const walk = (m) => S.emps.filter((e) => e.managerId === m && !out.has(e.id)).forEach((e) => { out.add(e.id); walk(e.id); });
  walk(id);
  cfg().depts.filter((d) => d.headId === id).forEach((d) => S.emps.filter((e) => e.deptId === d.id && e.id !== id).forEach((e) => out.add(e.id)));
  return [...out];
}
const myTeam = () => (S.me ? teamOf(S.me.id) : []);
const isManager = () => isMgmt() || myTeam().length > 0;
function scope() { return isMgmt() ? active().map((e) => e.id) : [S.me.id, ...myTeam()]; }
const canSee = (empId) => isMgmt() || empId === S.me?.id || myTeam().includes(empId);
const firstRole = (role, not) => active().find((e) => e.role === role && e.id !== not)?.id || null;

/* ═════════════ Calendar & attendance ═════════════ */
const holidayOn = (d) => cfg().holidays.find((h) => h.date === d && !h.optional);
function weeklyOff(d) {
  const w = dow(d);
  if ((cfg().weeklyOff || [0]).includes(w)) return true;
  if (cfg().secondSat && w === 6) { const dom = +d.slice(8); return dom >= 8 && dom <= 14; }
  return false;
}
const workingDay = (d) => !holidayOn(d) && !weeklyOff(d);
const attKey = (empId, m) => `${empId}_${m}`;
const punchesOn = (empId, d) => ((S.att[attKey(empId, d.slice(0, 7))]?.days || {})[d.slice(8)] || []).slice().sort((a, b) => a.t - b.t);
const reqsOf = (type, empId) => S.reqs.filter((r) => r.type === type && r.empId === empId);
const leaveOn = (empId, d) => reqsOf('LEAVE', empId).find((r) => r.status === 'APPROVED' && !r.data.cancelled && !r.data.cancelOf && r.data.from <= d && r.data.to >= d);
const remoteOn = (empId, d) => reqsOf('WFH_OD', empId).find((r) => r.status === 'APPROVED' && r.data.from <= d && (r.data.to || r.data.from) >= d);
const STATUS = {
  P: ['Present', 't-ok'], L: ['Late', 't-warn'], A: ['Absent', 't-bad'], HD: ['Half day', 't-warn'], LV: ['On leave', 't-vio'], WFH: ['Work from home', 't-info'],
  OD: ['Official duty', 't-info'], I: ['Incomplete', 't-warn'], WO: ['Weekly off', ''], H: ['Holiday', ''], NI: ['Not in yet', ''], PS: ['Pending import', ''], '': ['—', ''],
};
function dayStatus(emp, d) {
  const T = today();
  const r = { code: '', inT: null, outT: null, work: 0, lateMin: 0, note: '' };
  if (!emp || d > T || (emp.joining && d < emp.joining) || (emp.exitDate && d > emp.exitDate)) return r;
  const ps = punchesOn(emp.id, d);
  r.inT = ps[0]?.t || null; r.outT = ps.length > 1 ? ps[ps.length - 1].t : null;
  r.work = r.inT && r.outT ? Math.round((r.outT - r.inT) / 60000) : 0;
  r.punches = ps;
  const sh = cfg().shift;
  if (r.inT) { const lm = minOfDay(r.inT) - toMin(sh.start); if (lm > (sh.grace || 0)) r.lateMin = lm; }
  const lv = leaveOn(emp.id, d);
  const hol = holidayOn(d);
  if (lv && !lv.data.half) { r.code = 'LV'; r.note = lv.data.lt; return r; }
  if (hol || weeklyOff(d)) { r.code = hol ? 'H' : 'WO'; r.note = hol?.name || ''; if (ps.length) r.note += ' · worked'; return r; }
  const rem = remoteOn(emp.id, d);
  if (!ps.length) {
    if (rem) { r.code = rem.data.kind === 'OD' ? 'OD' : 'WFH'; return r; }
    if (lv?.data.half) { r.code = 'HD'; r.note = 'Half-day leave'; return r; }
    if (d === T) { r.code = 'NI'; return r; }
    if (cfg().attSource === 'device' && (!cfg().importedThrough || d > cfg().importedThrough)) { r.code = 'PS'; return r; }
    r.code = 'A'; return r;
  }
  if (ps.length === 1) { r.code = d === T ? (r.lateMin ? 'L' : 'P') : 'I'; if (d !== T) r.note = 'Missing check-out'; return r; }
  if (lv?.data.half) { r.code = 'HD'; r.note = 'Half-day leave'; return r; }
  if (d !== T && r.work < (sh.halfMin || 240)) { r.code = 'HD'; r.note = 'Short hours'; return r; }
  r.code = r.lateMin ? 'L' : 'P';
  if (rem) r.note = rem.data.kind === 'OD' ? 'Official duty' : 'WFH';
  return r;
}
const presentish = (c) => ['P', 'L', 'HD', 'I', 'WFH', 'OD'].includes(c);

/* ═════════════ Leave ═════════════ */
function leaveDaysCount(from, to, half) { if (half) return 0.5; return eachDay(from, to).filter(workingDay).length; }
function balances(emp, year = +today().slice(0, 4)) {
  const out = [];
  for (const lt of cfg().leaveTypes) {
    let months = 12;
    const jy = emp.joining ? +emp.joining.slice(0, 4) : 0;
    if (jy === year) months = 12 - +emp.joining.slice(5, 7) + 1;
    if (jy > year) months = 0;
    let ent = lt.quota * months / 12;
    if (lt.accrual) {
      const cy = +today().slice(0, 4);
      const curMonth = year < cy ? 12 : year > cy ? 0 : +today().slice(5, 7);
      const startM = jy === year ? +emp.joining.slice(5, 7) : 1;
      ent = lt.quota / 12 * Math.max(0, curMonth - startM + 1);
    }
    ent = round2(ent + (+(emp.leaveAdj?.[`${year}_${lt.code}`] || 0)));
    const mine = reqsOf('LEAVE', emp.id).filter((r) => r.data.lt === lt.code && r.data.from.startsWith(String(year)) && !r.data.cancelled);
    const used = round2(mine.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.data.days, 0));
    const pending = round2(mine.filter((r) => r.status === 'PENDING').reduce((s, r) => s + r.data.days, 0));
    out.push({ lt, entitled: ent, used, pending, avail: round2(ent - used - pending) });
  }
  return out;
}

/* ═════════════ Tasks ═════════════ */
const TSTAT = { TODO: ['To do', 't-info'], UPCOMING: ['Upcoming', ''], IN_PROGRESS: ['In progress', 't-vio'], BLOCKED: ['Blocked', 't-bad'], IN_REVIEW: ['In review', 't-warn'], DONE: ['Completed', 't-ok'], CANCELLED: ['Cancelled', ''] };
const PRIO = { CRITICAL: ['Critical', 't-bad'], HIGH: ['High', 't-warn'], MEDIUM: ['Medium', 't-info'], LOW: ['Low', ''] };
const PRANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const openTask = (t) => !['DONE', 'CANCELLED'].includes(t.status);
const effStatus = (t) => (t.status === 'TODO' && t.start > today() ? 'UPCOMING' : t.status);
const overdue = (t, on = today()) => openTask(t) && t.due < on;
const taskSort = (a, b) => (overdue(b) - overdue(a)) || (PRANK[a.priority] - PRANK[b.priority]) || a.due.localeCompare(b.due);
const canManageTask = (t) => t.assignerId === S.me.id || isMgmt() || (t.assigneeId !== S.me.id && myTeam().includes(t.assigneeId));
function nextCode(prefix, list) { const n = list.map((x) => +String(x.code || '').split('-')[1] || 0); return `${prefix}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(4, '0')}`; }

/* ═════════════ Approvals ═════════════ */
const RTYPE = {
  LEAVE: 'Leave', CORRECTION: 'Attendance correction', WFH_OD: 'WFH / official duty', EXTENSION: 'Deadline extension', REVIEW: 'Task review',
  OVERTIME: 'Overtime', EXPENSE: 'Expense claim', PURCHASE: 'Purchase request', DOCUMENT: 'Document / letter', HR_HELP: 'Help from HR', CHANGE: 'Employee / asset change',
};
const RSTAT = { PENDING: ['Pending', 't-warn'], APPROVED: ['Approved', 't-ok'], REJECTED: ['Rejected', 't-bad'], RETURNED: ['Sent back', 't-warn'], CANCELLED: ['Cancelled', ''] };
function managerOf(emp) {
  if (emp.managerId && empById(emp.managerId)?.active !== false) return emp.managerId;
  const head = deptOf(emp.deptId)?.headId;
  if (head && head !== emp.id) return head;
  return firstRole('DIRECTOR', emp.id) || firstRole('ADMIN', emp.id);
}
function chainFor(type, emp, ctx = {}) {
  const C = cfg();
  const steps = [];
  const add = (label, id) => { if (id && id !== emp.id && !steps.some((s) => s.by === id)) steps.push({ label, by: id }); };
  const mgr = managerOf(emp), hr = firstRole('HR', emp.id) || firstRole('ADMIN', emp.id), dir = firstRole('DIRECTOR', emp.id);
  const acc = C.depts.find((d) => d.code === 'ACC')?.headId;
  switch (type) {
    case 'LEAVE': add('Reporting manager', mgr); if ((ctx.days || 0) > (C.hrLeaveAbove ?? 2) || ctx.forceHR) add('HR', hr); break;
    case 'CORRECTION': add('Reporting manager', mgr); add('HR', hr); break;
    case 'WFH_OD': case 'OVERTIME': add('Reporting manager', mgr); break;
    case 'EXTENSION': add('Task assigner', ctx.assigner || mgr); break;
    case 'REVIEW': add('Reviewer', ctx.reviewer || mgr); break;
    case 'EXPENSE': add('Reporting manager', mgr); add('Accounts', acc); if ((ctx.amount || 0) > (C.directorExpenseAbove ?? 25000)) add('Director', dir); break;
    case 'PURCHASE': add('Budget owner', mgr); add('Director', dir); break;
    default: add('HR', hr);
  }
  if (!steps.length) add('Approver', dir || firstRole('ADMIN', emp.id) || hr);
  const pick = ctx.approver && ctx.approver !== emp.id && empById(ctx.approver)?.active !== false ? ctx.approver : null;
  if (pick && steps[0]?.by !== pick) return [{ label: 'Approver (chosen)', by: pick }, ...steps.slice(1).filter((s) => s.by !== pick)];
  return steps;
}
const curStep = (r) => r.steps.find((s) => s.status === 'PENDING');
const pastSLA = (r) => { const s = curStep(r); return r.status === 'PENDING' && s?.at && (Date.now() - s.at) / 3600000 > (cfg().slaHours || 24); };
const myInbox = () => S.reqs.filter((r) => r.status === 'PENDING' && curStep(r)?.by === S.me.id);
</script>
