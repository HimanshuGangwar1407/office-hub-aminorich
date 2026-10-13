// Company policies: who may post them, and who may read them. Pure functions of the session and the access context
// (server/access.js), so they can be tested without a database.
//
// Storage:
//   policy/{id}       — { title, content, category, audience: { scope, depts?, people? }, published, publishedAt,
//                         attachments: [{ name, size, ext, mime, fid, chunks, store: 'policyfile' }],
//                         createdBy, createdAt, updatedAt }
//   policyfile/{fid}_{i} — attachment chunks: readable only through a policy the reader may see; no uploader recorded.
//
// Who may post: the same manager rule as the rest of the app (administrators, HR, directors, managers, department heads,
// and anyone with direct reports). HR and administrators may target anyone; other managers may target only the
// departments they head and the people who report to them, and only HR may publish a company-wide policy.
// Who may read: managers see every policy (drafts included). Everyone else sees only published policies that apply to them.
import { isComplaintStaffCtx as isPolicyManagerCtx } from './complaints.js';

export const POLICY_CATEGORIES = ['HR & people', 'Leave & attendance', 'Expenses & finance', 'IT & security', 'Health & safety', 'Code of conduct', 'Operations', 'General'];
export const POLICY_SCOPES = ['company', 'depts', 'people'];
const MAX_FILES = 3, MAX_FILE = 6 * 1024 * 1024, MAX_CONTENT = 20000;
const FIELDS = new Set(['title', 'content', 'category', 'audience', 'published', 'publishedAt', 'attachments', 'createdBy', 'createdAt', 'updatedAt']);
const FILE_KEYS = new Set(['fid', 'i', 'n', 'data']);

/** Managers may post, see drafts, and manage policies. */
export const isPolicyManager = (s, ctx) => isPolicyManagerCtx(s, ctx);

/** Whether an employee-facing policy applies to this session: published, and for everyone, their department, or them by name. */
export function policyApplicable(data, s, ctx) {
  if (!data || data.published !== true) return false;
  const a = data.audience || {};
  if (a.scope === 'company') return true;
  if (a.scope === 'depts') { const me = ctx.emps.get(s.empId); return !!me && (a.depts || []).includes(me.deptId); }
  if (a.scope === 'people') return (a.people || []).includes(s.empId);
  return false;
}

/** Read rule. `data` null means a deleted record; passing it on lets clients drop their copy. */
export function policyVisible(data, s, ctx, manager) {
  if (!data) return true;
  return !!manager || policyApplicable(data, s, ctx);
}

/** Who a policy may be aimed at, for this poster. Returns a user-facing reason to refuse, or null. */
export function policyAudienceProblem(a, s, ctx) {
  if (!a || typeof a !== 'object' || Array.isArray(a) || !POLICY_SCOPES.includes(a.scope)) return 'Choose who the policy is for.';
  if (a.scope === 'company') return s.hr ? null : 'Only HR or an administrator can publish a company-wide policy.';
  const list = a.scope === 'depts' ? a.depts : a.people;
  const noun = a.scope === 'depts' ? 'department' : 'person';
  if (!Array.isArray(list) || !list.length || list.length > 500 || list.some((x) => typeof x !== 'string')) return `Choose at least one ${noun}.`;
  if (a.scope === 'depts') {
    for (const id of list) {
      const d = (ctx.depts || []).find((x) => x && x.id === id);
      if (!d) return 'Unknown department.';
      if (!s.hr && d.headId !== s.empId) return 'You can only post for departments you head.';
    }
  } else {
    for (const id of list) {
      const e = ctx.emps.get(id);
      if (!e || e.active === false) return 'Unknown person.';
      if (!s.hr && e.managerId !== s.empId) return 'You can only post for people who report to you.';
    }
  }
  return null;
}

/** Write rule for policy records. */
export function policyWriteProblem(op, path, data, old, s, ctx) {
  const [c, id] = String(path).split('/');
  if (c !== 'policy' || !id) return null;
  if (!s.active) return 'Your account is not active.';
  if (!isPolicyManager(s, ctx)) return 'Only administrators, HR and managers can post policies.';
  if (op === 'delete') return s.hr ? null : 'Only HR or an administrator can delete a policy.';
  if (!old && op === 'update') return 'That policy no longer exists.';
  const next = op === 'update' ? { ...(old || {}), ...(data || {}) } : data || {};
  for (const k of Object.keys(next)) if (!FIELDS.has(k)) return 'Unknown policy field.';
  if (!old) {
    if (next.createdBy !== s.empId) return 'Policies are posted in your own name.';
  } else {
    if (!s.hr && old.createdBy !== s.empId) return 'Only the author, HR or an administrator can change this policy.';
    if (next.createdBy !== old.createdBy || next.createdAt !== old.createdAt) return 'The author and date of a policy can’t be changed.';
  }
  const title = String(next.title ?? '').trim();
  if (title.length < 3 || title.length > 150) return 'The title should be 3 to 150 characters.';
  const content = String(next.content ?? '').trim();
  if (!content || content.length > MAX_CONTENT) return `The policy text is required (up to ${MAX_CONTENT.toLocaleString('en-US')} characters).`;
  if (!POLICY_CATEGORIES.includes(next.category)) return 'Choose a category.';
  if (typeof next.published !== 'boolean') return 'Publish the policy or save it as a draft.';
  if (next.publishedAt != null && typeof next.publishedAt !== 'number') return 'Bad publish date.';
  if (next.published && next.publishedAt == null) return 'Publish date is missing.';
  const files = next.attachments ?? [];
  if (!Array.isArray(files) || files.length > MAX_FILES) return `Attach up to ${MAX_FILES} files.`;
  for (const f of files) {
    if (!f || typeof f !== 'object' || !/^[a-z0-9]{4,40}$/i.test(String(f.fid || ''))) return 'An attachment could not be read.';
    if (!(Number.isInteger(f.chunks) && f.chunks >= 1 && f.chunks <= 200) || !(f.size > 0 && f.size <= MAX_FILE)) return 'An attachment could not be read.';
    if (f.store !== 'policyfile') return 'An attachment could not be read.';
  }
  return policyAudienceProblem(next.audience, s, ctx);
}

/** Write rule for attachment chunks: policy managers upload, administrators or HR remove. */
export function policyFileWriteProblem(op, data, s, ctx) {
  if (!s.active) return 'Your account is not active.';
  if (op === 'delete') return s.hr ? null : 'Only HR or an administrator can remove policy files.';
  if (!isPolicyManager(s, ctx)) return 'Only administrators, HR and managers can upload policy files.';
  if (data && (typeof data !== 'object' || Object.keys(data).some((k) => !FILE_KEYS.has(k)))) return 'Attachments can only hold file data.';
  return null;
}
