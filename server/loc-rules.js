// Who may see and write WFH / official-duty location records: loc/{empId}_{YYYY-MM-DD}.
// Everyone sees their own. Accounts with the Admin, HR or Manager role see everyone's (the WFH Live Location
// Dashboard); nobody else does — not Directors, and not team leads with another role. Only the employee writes their
// own records, so every location on file was shared from that employee's own signed-in session.
// Pure functions so they can be tested without a database.

export const LOCATION_VIEWER_ROLES = ['ADMIN', 'HR', 'MANAGER'];
const LOC_PATH = /^loc\/(.+)_(\d{4}-\d{2}-\d{2})$/;

export const locEmpOf = (path) => LOC_PATH.exec(String(path || ''))?.[1] || null;
export const seesAllLocations = (s) => !!s && (!!s.bootstrap || (!!s.active && LOCATION_VIEWER_ROLES.includes(s.role)));

/** Can session `s` read this location record? */
export function locVisible(path, s) {
  if (!s?.active && !s?.bootstrap) return false;
  if (seesAllLocations(s)) return true;
  const id = locEmpOf(path);
  return !!id && id === s.empId;
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
