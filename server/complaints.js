// Complaints / grievances: the rules that keep complainants anonymous, enforced on the server.
//
// Storage (one document per item; all access rules live in this file):
//   complaint/{id}          — the complaint itself. Holds NO identity. "ownerKey" is an HMAC of the
//                             complainant's employee id, so only that employee can match it.
//   complaintsecret/{id}    — { by, at }: the complainant's employee id. Readable by administrators only.
//   complaintfile/{fid}_{i} — attachment chunks. Readable by staff only; no uploader is recorded.
//
// Who sees what:
//   administrators  — everything, including the complainant's identity (complaintsecret)
//   staff           — HR, directors, managers, department heads, anyone with direct reports:
//                     all complaints and attachments; the complainant is shown as "Anonymous"
//   everyone else   — only the complaints they raised (matched by ownerKey)
import { createHmac, randomBytes } from 'node:crypto';

export const CATEGORIES = ['Harassment', 'Discrimination', 'Safety', 'Pay or benefits', 'Workplace conflict', 'Policy violation', 'Other'];
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const STATUSES = ['OPEN', 'WORKING', 'RESOLVED', 'CLOSED'];
export const SLA_MS = 7 * 86400000;
const MAX_FILES = 3, MAX_FILE = 6 * 1024 * 1024;
const STAFF_ROLES = ['ADMIN', 'HR', 'DIRECTOR', 'MANAGER'];
const MUTABLE = new Set(['status', 'priority', 'assignedTo', 'log', 'updatedAt', 'resolvedAt', 'closedAt']);
const CHUNK_KEYS = new Set(['fid', 'i', 'n', 'data']);

const invalid = (message) => Object.assign(new Error(message), { status: 400, code: 'invalid_argument' });

/** Stable tag for an employee id. It needs SESSION_SECRET, so HR cannot compute it for anyone. */
export function ownerKeyFor(empId) {
  const secret = process.env.SESSION_SECRET || '';
  if (secret.length < 32) throw Object.assign(new Error('SESSION_SECRET is not set.'), { status: 500, code: 'config' });
  return createHmac('sha256', secret).update(`complaint:${String(empId)}`).digest('hex');
}

const isStaffRole = (role) => STAFF_ROLES.includes(role);

/** Staff can see every complaint. Mirrors the app's manager rule: management roles, department heads, or anyone with direct reports. */
export async function isComplaintStaff(who, q, cfgDoc) {
  if (!who.active || !who.empId) return false;
  if (isStaffRole(who.role)) return true;
  if ((cfgDoc?.depts || []).some((d) => d.headId === who.empId)) return true;
  const r = await q(`SELECT 1 FROM docs WHERE parent = 'emp' AND NOT deleted AND data->>'managerId' = $1
    AND COALESCE(data->>'active', 'true') <> 'false' LIMIT 1`, [who.empId]);
  return r.rowCount > 0;
}

/** Whether an employee record may be assigned complaints (HR or a manager). */
export async function isAssignable(empId, q, cfgDoc) {
  const r = await q(`SELECT data FROM docs WHERE path = $1 AND NOT deleted`, [`emp/${empId}`]);
  if (!r.rowCount) return false;
  const e = r.rows[0].data || {};
  return isComplaintStaff({ active: e.active !== false && e.status !== 'EXITED', role: e.role, empId }, q, cfgDoc);
}

/** Read rule for complaint documents. `staff` is isComplaintStaff() for the session. */
export function canReadComplaint(path, data, s, staff) {
  const [c] = path.split('/');
  if (!s.active) return false;
  if (c === 'complaintsecret') return !!s.admin;
  if (c === 'complaintfile') return !!staff;
  if (c !== 'complaint') return true;
  if (s.admin || staff) return true;
  return !!data && !!s.empId && data.ownerKey === ownerKeyFor(s.empId);
}

/** Write rule for complaint paths. Returns a user-facing reason to refuse, or null to allow. */
export function complaintWriteProblem(op, path, data, old, s, ctx = {}) {
  const [c, id] = String(path).split('/');
  if (!s.active) return 'Your account is not active.';
  if (c === 'complaintsecret') {
    return op === 'delete' && s.admin ? null : 'Complainant records are written by the server only.';
  }
  if (c === 'complaintfile') {
    if (op === 'delete') return s.admin ? null : 'Only an administrator can delete attachments.';
    if (data && (typeof data !== 'object' || Object.keys(data).some((k) => !CHUNK_KEYS.has(k)))) return 'Attachments can only hold file data.';
    return null;
  }
  if (c !== 'complaint' || !id) return null;
  if (!old) return 'Complaints are raised through the complaint form.';
  if (op === 'delete') return s.admin ? null : 'Only an administrator can delete a complaint.';
  if (!ctx.staff) return 'Only HR and managers can change a complaint.';
  const next = op === 'update' ? { ...old, ...data } : data || {};
  for (const k of new Set([...Object.keys(old), ...Object.keys(data || {})])) {
    if (MUTABLE.has(k)) continue;
    if (JSON.stringify(next[k] ?? null) !== JSON.stringify(old[k] ?? null)) return `${k} can’t be changed.`;
  }
  if (!STATUSES.includes(next.status)) return 'Unknown status.';
  if (!PRIORITIES.includes(next.priority)) return 'Unknown priority.';
  if (next.assignedTo && !ctx.assigneeOk) return 'Complaints can only be assigned to HR or a manager.';
  const oldLog = old.log || [], newLog = next.log || [];
  if (newLog.length < oldLog.length || JSON.stringify(newLog.slice(0, oldLog.length)) !== JSON.stringify(oldLog)) return 'The history of a complaint can’t be edited.';
  return null;
}

/** Validates a submission and builds the two documents. Pure: the caller stores them and checks the attachments exist. */
export function buildComplaint(input, s, now = Date.now()) {
  if (!s.active || !s.empId) throw Object.assign(new Error('Only active employees can raise a complaint.'), { status: 403, code: 'permission_denied' });
  const category = String(input?.category || '');
  if (!CATEGORIES.includes(category)) throw invalid('Choose a category.');
  const subject = String(input?.subject || '').trim();
  if (subject.length < 3 || subject.length > 150) throw invalid('The subject should be 3 to 150 characters.');
  const description = String(input?.description || '').trim();
  if (description.length < 10 || description.length > 4000) throw invalid('The description should be 10 to 4000 characters.');
  const priority = input?.priority ? String(input.priority) : 'MEDIUM';
  if (!PRIORITIES.includes(priority)) throw invalid('Choose a priority.');
  const files = Array.isArray(input?.attachments) ? input.attachments : [];
  if (files.length > MAX_FILES) throw invalid(`Attach up to ${MAX_FILES} files.`);
  const attachments = files.map((f) => {
    const fid = String(f?.fid || '');
    const size = Number(f?.size), chunks = Number(f?.chunks);
    if (!/^[a-z0-9]{4,40}$/i.test(fid)) throw invalid('An attachment could not be read. Try uploading it again.');
    if (!(size > 0 && size <= MAX_FILE)) throw invalid('Each attachment can be up to 6 MB.');
    if (!(Number.isInteger(chunks) && chunks >= 1 && chunks <= 200)) throw invalid('An attachment could not be read. Try uploading it again.');
    return {
      name: String(f?.name || 'attachment').replace(/[\r\n\\/]+/g, ' ').slice(0, 120),
      size, ext: String(f?.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8),
      mime: String(f?.mime || '').slice(0, 80), fid, chunks, store: 'complaintfile',
    };
  });
  const id = randomBytes(9).toString('hex');
  const doc = {
    code: `CMP-${id.slice(0, 6).toUpperCase()}`, category, subject, description, priority, status: 'OPEN',
    createdAt: now, dueAt: now + SLA_MS, updatedAt: now, assignedTo: null, attachments, log: [], ownerKey: ownerKeyFor(s.empId),
  };
  return { id, doc, secret: { by: s.empId, at: now } };
}
