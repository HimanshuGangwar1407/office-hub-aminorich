// Who may read and write which records, beyond the simple per-collection rules in app.js.
// Everything here is a pure function of the session and an access context built from the employee records,
// the chat records and the department list (see buildCtx), so it can be tested without a database.
//
//  - chats: the company chat is for everyone; a department chat for that department, its head and management;
//    direct and group chats (and their messages) only for their members.
//  - employee records: the usual work-from-home location (wfhLoc) is only sent to people who may see that
//    employee's locations; non-HR users may only change their own preferences and usual WFH location
//    (and Admin / HR / Manager accounts may reset someone's usual WFH location).
//  - notifications: only the recipient reads or changes them.  mail log: HR, and each person their own.
//  - files (blob/*): readable when you may read a chat message or location record that uses the file;
//    changed or deleted only by the uploader, a group admin deleting the group's files, or HR.
import { seesAllLocations, locVisible } from './loc-rules.js';
import { isGroupAdmin } from './chat-rules.js';
import { canReadComplaint, isComplaintStaffCtx } from './complaints.js';
import { isPolicyManager, policyVisible } from './policy.js';

const MGMT = ['ADMIN', 'HR', 'DIRECTOR'];
const SELF_EDITABLE = new Set(['prefs', 'wfhLoc']);

/** rows: [{ path, data }] for emp/*, chat/* and cfg/main (not deleted). */
export function buildCtx(rows) {
  const emps = new Map(), chats = new Map(), policies = new Map();
  let depts = [];
  for (const { path, data } of rows) {
    if (!data) continue;
    const [c, id, more] = path.split('/');
    if (c === 'emp' && id && !more) emps.set(id, data);
    else if (c === 'chat' && id && !more) chats.set(id, data);
    else if (c === 'policy' && id && !more) policies.set(id, data); // only { published, audience } are loaded for policies
    else if (path === 'cfg/main') depts = Array.isArray(data.depts) ? data.depts : [];
  }
  return { emps, chats, depts, policies };
}

const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** What this session may see, given the context. */
export function accessFor(s, ctx) {
  const active = !!s?.bootstrap || !!s?.active;
  const all = seesAllLocations(s);
  const mgmt = !!s?.bootstrap || (active && MGMT.includes(s?.role));
  const myDept = ctx.emps.get(s?.empId)?.deptId || null;
  const heads = new Set(ctx.depts.filter((d) => d && d.headId && d.headId === s?.empId).map((d) => d.id));
  function chatOk(id) {
    if (!active || !id) return false;
    if (s.bootstrap || id === 'all') return true;
    if (id.startsWith('dept-')) { const d = id.slice(5); return mgmt || myDept === d || heads.has(d); }
    const c = ctx.chats.get(id);
    if (!c) return false;
    return (c.members || []).includes(s.empId) || (c.kind === 'group' && (c.admins || [c.createdBy]).includes(s.empId));
  }
  const seesEmpLoc = (empId) => all || empId === s?.empId;
  // chats whose membership can change while they already have messages (groups, departments): when this list
  // changes, the browser must reload its copy so it gets — or drops — their older messages
  const shared = [...ctx.chats.keys()].filter((id) => !id.startsWith('dm-') && id !== 'all' && chatOk(id));
  for (const d of ctx.depts) if (d?.id && chatOk('dept-' + d.id)) shared.push('dept-' + d.id);
  // complaint staff see every complaint (never the complainant's identity); administrators also see who raised one
  const complaintStaff = active && isComplaintStaffCtx(s, ctx);
  // policies this session may see: when that set changes (publish, unpublish, a department change), the browser
  // reloads its copy, so policies it may no longer see are dropped
  const policyMgr = active && isPolicyManager(s, ctx);
  const visiblePolicies = [...ctx.policies.keys()].filter((id) => policyVisible(ctx.policies.get(id), s, ctx, policyMgr)).sort();
  const sig = `${all ? 'all' : 'own'}.c${hash([...new Set(shared)].sort().join(','))}.k${complaintStaff ? 1 : 0}${s?.admin ? 'a' : ''}.p${hash(visiblePolicies.join(','))}`;
  return { s, ctx, active, all, mgmt, chatOk, seesEmpLoc, complaintStaff, policyMgr, sig };
}

/** Can this record be sent to the session? `data` is null for deleted records. (Files are checked separately.) */
export function canReadDoc(path, data, A) {
  const { s } = A;
  const [c, a, b] = path.split('/');
  if (!A.active) return false;
  if (c === 'auth') return false;
  if (c === 'data') return a === 'users' && b === s.uid;
  if (c === 'pay' || c === 'payroll' || c === 'fines') return !!s.salary;
  if (c === 'loc') return locVisible(path, s);
  if (c === 'chat') return A.chatOk(a);
  if (c === 'ntf') return !data || data.to === s.empId;
  if (c === 'mail') return !data || !!s.hr || data.empId === s.empId;
  if (c === 'blob') return false;
  if (c === 'complaint' || c === 'complaintsecret' || c === 'complaintfile') return canReadComplaint(path, data, s, A.complaintStaff);
  if (c === 'policy') return policyVisible(data, s, A.ctx, A.policyMgr);
  if (c === 'policyfile') return false; // read only through a policy the reader may see (app.js)
  return true;
}

/** The version of a readable record this session gets: the usual WFH location only goes to people who may see it. */
export function shapeDoc(path, data, A) {
  if (!data || !path.startsWith('emp/') || data.wfhLoc == null) return data;
  const id = path.slice(4);
  if (id.includes('/') || A.seesEmpLoc(id)) return data;
  const { wfhLoc, ...rest } = data;
  return rest;
}

const changedKeys = (next, old) => [...new Set([...Object.keys(old || {}), ...Object.keys(next || {})])].filter((k) => JSON.stringify(next?.[k] ?? null) !== JSON.stringify(old?.[k] ?? null));

/** Employee records, for people who are not HR (HR and first-time setup are handled in app.js). */
export function empWriteProblem(op, path, data, old, A) {
  const id = path.slice(4);
  if (!old || op === 'delete') return 'Only HR can add or remove employees.';
  const next = op === 'update' ? { ...old, ...(data || {}) } : data || {};
  const keys = changedKeys(next, old);
  if (!keys.length) return null;
  if (id === A.s.empId) return keys.every((k) => SELF_EDITABLE.has(k)) ? null : 'Only HR can change that part of your record.';
  // Admin / HR / Manager accounts may reset someone's usual WFH location (it is set again at the next check-in)
  if (keys.length === 1 && keys[0] === 'wfhLoc' && next.wfhLoc == null && A.seesEmpLoc(id)) return null;
  return 'Only HR can change someone else’s record.';
}

// Chat ids decide what a chat is: "all" is the company chat, dept-* a department chat, dm-* a direct chat, g-* a group.
const kindOfId = (id) => (id === 'all' ? 'all' : id.startsWith('dept-') ? 'dept' : id.startsWith('dm-') ? 'dm' : id.startsWith('g-') ? 'group' : null);
const SHAPE_KEYS = ['kind', 'members', 'admins', 'createdBy', 'deptId'];

/** Chat records: who may create or change a chat, or write messages into it. Runs before chatWriteProblem. */
export function chatAccessProblem(op, path, data, old, A) {
  const parts = path.split('/'), id = parts[1], { s } = A;
  const kind = kindOfId(id);
  if (!kind) return 'Bad chat.';
  if (parts.length === 2 && op !== 'delete') {
    const next = op === 'update' ? { ...(old || {}), ...(data || {}) } : data || {};
    if ((next.kind ?? kind) !== kind) return 'Bad chat.';
    if (!old) {
      if (kind === 'dm') {
        const m = Array.isArray(next.members) ? next.members : [];
        if (m.length !== 2 || !m.includes(s.empId) || m[0] === m[1] || id !== `dm-${[...m].sort().join('-')}`) return 'A direct chat is between you and one other person.';
        return null;
      }
      if (kind === 'group') return (next.members || []).includes(s.empId) ? null : 'You must be a member of a group you create.';
      if (kind === 'dept' && next.deptId != null && next.deptId !== id.slice(5)) return 'Bad chat.';
    } else if (kind !== 'group' && !s.hr) {
      // who is in a company, department or direct chat is fixed; group membership is checked in chat-rules (admins)
      for (const k of SHAPE_KEYS) if (JSON.stringify(next[k] ?? null) !== JSON.stringify(old[k] ?? null)) return 'Only HR can change who is in this chat.';
    }
  }
  if (parts.length === 2 && op === 'delete' && kind !== 'group' && !s.hr) return 'Only HR can remove this chat.';
  if (!A.chatOk(id)) return 'You are not in this chat.';
  return null;
}

/** Notifications: anyone may notify someone (as themselves); only the recipient marks them read or removes them. */
export function ntfWriteProblem(op, data, old, s) {
  if (!old) {
    if (op === 'delete') return null;
    if (data?.from != null && data.from !== s.empId) return 'Notifications are sent in your own name.';
    return null;
  }
  return old.to === s.empId ? null : 'You can only change your own notifications.';
}

/** Mail queue: only to an employee's own address on file; changing or removing queued mail is for HR. */
export function mailWriteProblem(op, data, old, A) {
  if (A.s.hr || A.s.bootstrap) return null;
  if (old || op === 'delete') return 'Only HR can change the mail queue.';
  const e = A.ctx.emps.get(data?.empId);
  if (!e?.email || String(data?.to || '').toLowerCase() !== String(e.email).toLowerCase()) return 'Mail can only go to an employee’s address on file.';
  if (data?.status !== 'QUEUED') return 'Bad mail record.';
  return null;
}

/** Does this chat message bucket or location record really use the file? Only when the person who uploaded the file
 *  put it there — otherwise anyone could quote a file id in their own records to read it, or as a group admin delete it. */
export function refUsesFile(path, data, fid, by) {
  if (!data || !by || !fid) return false;
  if (/^loc\/[^/]+$/.test(path)) return data.empId === by && (data.pings || []).some((p) => p?.photo?.fid === fid);
  if (/^chat\/[^/]+\/b\/[^/]+$/.test(path)) return data.by === by && (data.msgs || []).some((m) => m?.file?.fid === fid);
  return false;
}

/** refs: paths of the chat messages and location records that use the file (checked with refUsesFile). */
export function blobReadable(data, refs, A) {
  if (!A.active || !data) return false;
  if (A.s.bootstrap || data.by === A.s.empId) return true;
  return refs.some((p) => canReadDoc(p, {}, A));
}
export function blobWriteProblem(op, data, old, refs, A) {
  const { s } = A;
  if (!old) return op === 'delete' || data?.by === s.empId ? null : 'Files are uploaded in your own name.';
  if (old.by === s.empId || s.hr || s.bootstrap) return op === 'delete' || data?.by === s.empId ? null : 'Files are uploaded in your own name.';
  // a group admin deleting the group also removes the files people shared in it
  if (op === 'delete' && refs.some((p) => /^chat\/[^/]+\/b\//.test(p) && isGroupAdmin(A.ctx.chats.get(p.split('/')[1]), s.empId))) return null;
  return 'Only the person who shared this file can change it.';
}
