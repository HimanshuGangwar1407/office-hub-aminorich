// Who may see and write WFH / official-duty location records: loc/{empId}_{YYYY-MM-DD}.
// Mirrors the app's canSee(): ADMIN, HR and DIRECTOR see everyone; managers see the people under them (all levels)
// and department heads see their department; everyone sees their own. Only the employee writes their own records,
// so every location on file was shared from that employee's own signed-in session.
// Pure functions so they can be tested without a database.

const SEES_ALL = ['ADMIN', 'HR', 'DIRECTOR'];
const LOC_PATH = /^loc\/(.+)_(\d{4}-\d{2}-\d{2})$/;

export const locEmpOf = (path) => LOC_PATH.exec(String(path || ''))?.[1] || null;
export const seesAllLocations = (s) => !!s && (s.bootstrap || (!!s.active && SEES_ALL.includes(s.role)));

/** Everyone under `empId`: direct and indirect reports, plus the departments they head. emps: [{ id, managerId, deptId }]. */
export function teamOf(empId, emps, depts) {
  const out = new Set();
  if (!empId) return out;
  const byMgr = new Map();
  for (const e of emps) { if (!e.managerId) continue; if (!byMgr.has(e.managerId)) byMgr.set(e.managerId, []); byMgr.get(e.managerId).push(e.id); }
  const walk = (m) => { for (const id of byMgr.get(m) || []) if (!out.has(id)) { out.add(id); walk(id); } };
  walk(empId);
  for (const d of depts || []) if (d && d.headId === empId) for (const e of emps) if (e.deptId === d.id && e.id !== empId) out.add(e.id);
  out.delete(empId);
  return out;
}

/** Can session `s` read this location record? `team` is teamOf(s.empId, …). */
export function locVisible(path, s, team) {
  if (!s?.active && !s?.bootstrap) return false;
  if (seesAllLocations(s)) return true;
  const id = locEmpOf(path);
  if (!id) return false;
  return id === s.empId || !!team?.has(id);
}

const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// A sharing run that was stopped (on any device) can't switch itself back on: only a new Start (a new run id) can.
export const LIVE_STOPPED = 'Live sharing was stopped. Press Start to share again.';

/** Returns a user-facing reason the write is not allowed, or null when it is allowed. */
export function locWriteProblem(op, path, data, old, s) {
  const id = locEmpOf(path);
  if (!id) return 'Bad location record.';
  if (!s?.empId || id !== s.empId) return 'You can only share your own location.';
  if (op === 'delete') return null;
  const next = op === 'update' ? { ...(old || {}), ...(data || {}) } : data || {};
  if (next.empId !== s.empId) return 'You can only share your own location.';
  if (next.date !== path.slice(-10)) return 'Bad location record.';
  if (next.pings !== undefined && (!Array.isArray(next.pings) || next.pings.length > 200)) return 'Bad location record.';
  const l = next.live;
  if (l !== undefined && l !== null) {
    if (typeof l !== 'object' || Array.isArray(l) || typeof l.on !== 'boolean') return 'Bad live-sharing record.';
    for (const k of ['since', 'consentAt', 'stoppedAt', 'every']) if (l[k] !== undefined && l[k] !== null && !num(l[k])) return 'Bad live-sharing record.';
    if (l.on && !num(l.consentAt)) return 'Live location needs your consent first.';
    if (l.run !== undefined && (typeof l.run !== 'string' || l.run.length > 40)) return 'Bad live-sharing record.';
    const was = old?.live;
    if (l.on && was && was.on === false && was.run && l.run === was.run) return LIVE_STOPPED;
  }
  return null;
}

/** A short signature of what this session may see, so the browser reloads its copy when that changes. */
export function locScope(s, team) {
  if (seesAllLocations(s)) return 'all';
  const ids = [...(team || [])].sort().join(',');
  let h = 0; for (let i = 0; i < ids.length; i++) h = (h * 31 + ids.charCodeAt(i)) | 0;
  return `t${team?.size || 0}.${(h >>> 0).toString(36)}`;
}
