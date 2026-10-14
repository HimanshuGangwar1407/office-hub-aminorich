// Who may read and write people's work records: attendance (att), daily work logs (wlog), tasks (task), approval
// requests (req), the private parts of employee records (emp), payroll runs (payroll) and the audit log (audit).
//
// The rule, everywhere: a person's records go to
//   - the person themselves;
//   - their managers — the reporting-manager chain upwards and the head of their department (the app's "team");
//   - Admin, HR and Directors (company-wide management, as elsewhere in the app);
// plus, for a specific record, the people that record names: a request's approvers (steps), the person who raised
// it and anyone it was escalated to (watchers); a task's assigner, reviewer and people asked to look at it
// (watchers). Two narrow extras keep existing duties working: accounts staff (department code ACC) handle expense
// claims, and accounts with salary access read the attendance, leave and employee inputs payroll needs.
// Pure functions of the session, the access context and the record, so they can be tested without a database.

const MGMT = ['ADMIN', 'HR', 'DIRECTOR'];
// parts of an employee record that only the person, their managers, management and payroll may see
export const PRIVATE_EMP_FIELDS = ['dob', 'phone', 'bioId', 'probEnd', 'exitDate', 'clearance', 'assets', 'history', 'leaveAdj', 'address', 'emergency', 'bank', 'pan', 'aadhaar', 'notes'];

/** Everyone under `empId`: direct and indirect reports, plus everyone in departments they head. */
export function teamOf(empId, ctx) {
  const out = new Set();
  if (!empId) return out;
  const byMgr = new Map();
  for (const [id, e] of ctx.emps) { const m = e?.managerId; if (!m) continue; if (!byMgr.has(m)) byMgr.set(m, []); byMgr.get(m).push(id); }
  const walk = (m) => { for (const id of byMgr.get(m) || []) if (!out.has(id)) { out.add(id); walk(id); } };
  walk(empId);
  for (const d of ctx.depts || []) if (d?.headId === empId) for (const [id, e] of ctx.emps) if (e?.deptId === d.id && id !== empId) out.add(id);
  out.delete(empId);
  return out;
}

/** People-related permissions of a session. */
export function peopleAccess(s, ctx) {
  const active = !!s?.bootstrap || !!s?.active;
  const mgmt = !!s?.bootstrap || (active && MGMT.includes(s?.role));
  const team = active && !mgmt && s?.empId ? teamOf(s.empId, ctx) : new Set();
  const accDept = (ctx.depts || []).find((d) => d?.code === 'ACC')?.id || null;
  const myDept = ctx.emps.get(s?.empId)?.deptId || null;
  const accounts = active && (!!s?.hr || (!!accDept && myDept === accDept));
  const salary = active && !!s?.salary;
  const headOf = new Set((ctx.depts || []).filter((d) => d?.headId && d.headId === s?.empId).map((d) => d.id));
  // can see / manage this person's work records
  const person = (empId) => active && !!empId && (mgmt || empId === s.empId || team.has(empId));
  const hrOrSelf = (empId) => active && (!!s?.hr || !!s?.bootstrap || empId === s?.empId);
  return { active, mgmt, team, headOf, accounts, salary, person, hrOrSelf, admin: !!s?.bootstrap || (active && !!s?.admin) };
}

const named = (list, empId) => Array.isArray(list) && list.includes(empId);
const reqParties = (r) => [r?.empId, r?.raisedBy, ...((r?.steps || []).map((x) => x?.by)), ...(r?.watchers || [])].filter(Boolean);
const taskParties = (t) => [t?.assigneeId, t?.assignerId, t?.reviewerId, ...(t?.watchers || [])].filter(Boolean);

/** Can the session read this record? `data` is null for a deleted record (only its id is sent). Returns undefined for
 *  collections this module doesn't govern. `P` is peopleAccess(s, ctx); `locViewer` = may see everyone's WFH locations. */
export function peopleReadable(path, data, s, P, locViewer = false) {
  const c = path.split('/')[0];
  if (!['att', 'wlog', 'task', 'req', 'audit', 'seq'].includes(c)) return undefined;
  if (!P.active) return false;
  if (c === 'seq') return false;
  if (c === 'audit') return P.admin; // system-level: administrators only
  if (!data) return true; // a deletion marker carries no content
  if (c === 'att') return P.person(data.empId) || P.salary;
  if (c === 'wlog') return P.person(data.empId);
  if (c === 'task') return P.person(data.assigneeId) || taskParties(data).includes(s.empId) || (!!data.deptId && P.headOf.has(data.deptId));
  if (c === 'req') {
    if (P.person(data.empId) || reqParties(data).includes(s.empId)) return true;
    if (data.type === 'EXPENSE' && P.accounts) return true;
    if (data.type === 'LEAVE' && P.salary) return true; // payroll needs approved and unpaid leave
    if (data.type === 'WFH_OD' && (P.salary || locViewer)) return true; // WFH dashboard / payroll WFH rules
    return false;
  }
  return false;
}

/** A request this session reads only as a location viewer (the WFH dashboard) or for payroll: no reason or notes. */
export function shapeReq(data, s, P) {
  if (!data || P.person(data.empId) || reqParties(data).includes(s?.empId) || P.salary) return data;
  if (data.type === 'EXPENSE' && P.accounts) return data;
  const { from, to, kind, lt, days, half } = data.data || {};
  return { type: data.type, empId: data.empId, status: data.status, code: data.code, steps: [], created: data.created, data: { from, to, kind, lt, days, half } };
}

/** The version of an employee record this session gets: private fields only for those allowed. */
export const SECRET_EMP_FIELDS = ['bank', 'pan', 'aadhaar'];
export function shapeEmp(id, data, P) {
  if (!data || P.salary || P.hrOrSelf(id)) return data;
  const out = { ...data };
  for (const k of P.person(id) ? SECRET_EMP_FIELDS : PRIVATE_EMP_FIELDS) delete out[k];
  return out;
}

/** Payroll runs: salary users get everything; anyone else only their own line of a finalised month (their payslip). */
export function shapePayroll(data, s, P) {
  if (!data) return data;
  if (P.salary) return data;
  if (data.status !== 'FINAL' || !s?.empId) return undefined;
  const row = (data.rows || []).find((r) => r?.e === s.empId);
  if (!row) return undefined;
  return { month: data.month, status: data.status, at: data.at, method: data.method, partial: data.partial, rows: [row] };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const changedKeys = (next, old) => [...new Set([...Object.keys(old || {}), ...Object.keys(next || {})])].filter((k) => !same(next?.[k], old?.[k]));
const only = (keys, allowed) => keys.every((k) => allowed.includes(k));
const DECIDED = ['APPROVED', 'REJECTED', 'RETURNED'];

/** Did the approval steps change only the way the current approver's decision changes them? */
function stepsByApprover(oldSteps, newSteps, cur) {
  if (!Array.isArray(newSteps) || newSteps.length !== oldSteps.length) return false;
  for (let i = 0; i < oldSteps.length; i++) {
    const a = oldSteps[i] || {}, b = newSteps[i] || {};
    if (a.by !== b.by) return false;
    if (i < cur && a.status !== b.status) return false; // earlier decisions stay as they were
    if (i === cur && a.status !== b.status && !DECIDED.includes(b.status)) return false;
    if (i > cur && a.status !== b.status && !['PENDING', 'SKIPPED'].includes(b.status)) return false; // the next step opens, or the rest are skipped
  }
  return true;
}
const newlyApproved = (oldSteps = [], newSteps = []) => (newSteps || []).some((b, i) => b?.status === 'APPROVED' && oldSteps[i]?.status !== 'APPROVED');

/** Returns a user-facing reason a write to att / wlog / task / req / audit / seq is not allowed, null if allowed,
 *  undefined for other collections. `X` holds facts app.js looked up: X.task — the task a REVIEW / EXTENSION request is
 *  about; X.cancelApprovers — people who approved a cancellation of this leave. */
export function peopleWriteProblem(op, path, data, old, s, P, X = {}) {
  const [c, id] = path.split('/');
  if (!['att', 'wlog', 'task', 'req', 'audit', 'seq'].includes(c)) return undefined;
  if (!P.active) return 'Your account is not active.';
  if (c === 'seq') return 'Codes are given out by the server.';
  if (c === 'audit') {
    if (old || op !== 'set') return 'The audit log cannot be changed.';
    if (data?.by == null && s?.bootstrap) return null; // first-time setup, before the owner has an employee record
    return data?.by === s.empId ? null : 'Audit entries are recorded in your own name.';
  }
  const next = op === 'update' ? { ...(old || {}), ...(data || {}) } : op === 'set' ? data || {} : null;
  // a record's id names whose it is — for everyone, management included — so nobody can claim someone else's month or day
  if (c === 'att' && next && id !== `${next.empId}_${next.month}`) return 'Bad attendance record.';
  if (c === 'wlog' && next && id !== `${next.empId}_${next.date}`) return 'Bad work-log record.';
  if (c === 'req') return reqProblem(op, next, old, s, P, X);
  if (P.mgmt) return null;
  if (c === 'att') {
    const who = old?.empId ?? next?.empId;
    if (next && old && next.empId !== old.empId) return 'Attendance records can’t be moved to someone else.';
    return P.person(who) ? null : 'You can only change your own or your team’s attendance.';
  }
  if (c === 'wlog') {
    const who = old?.empId ?? next?.empId;
    if (next && old && next.empId !== old.empId) return 'Work logs can’t be moved to someone else.';
    if (who === s.empId) return null;
    // a manager may only add their review to a team member's log
    if (P.person(who) && old && op === 'update' && Object.keys(data || {}).every((k) => ['review', 'reviewedBy'].includes(k))) return null;
    return 'You can only write your own work log (managers can add a review).';
  }
  // task
  if (!old) {
    if (op === 'delete') return null;
    if (next.assignerId === s.empId || next.assigneeId === s.empId || P.person(next.assigneeId)) return null;
    return 'You can only create tasks you assign, or for yourself or your team.';
  }
  if (!(P.person(old.assigneeId) || taskParties(old).includes(s.empId) || (!!old.deptId && P.headOf.has(old.deptId)))) return 'You can’t change this task.';
  const assigner = old.assignerId === s.empId, manages = old.assigneeId !== s.empId && P.person(old.assigneeId);
  if (op === 'delete') return assigner || manages ? null : 'Only the person who assigned a task, or the assignee’s manager, can delete it.';
  const K = changedKeys(next, old);
  if (K.includes('assignerId') && !assigner) return 'Only the person who assigned a task can hand that role to someone else.';
  if (assigner || manages) return null; // they plan the task: title, dates, assignee, reviewer, priority…
  const assignee = old.assigneeId === s.empId, reviewer = old.reviewerId === s.empId;
  if (assignee || reviewer) {
    if (!only(K, ['status', 'blockedReason', 'completedAt', 'history', 'hours', 'checklist', 'comments', 'watchers'])) return 'Only the person who assigned the task (or a manager) can change its plan — deadline, assignee, reviewer or priority.';
    if (K.includes('status') && next.status === 'DONE' && old.needsReview && !reviewer) return 'This task needs a review before it can be completed.';
    if (K.includes('status') && reviewer && !assignee && !['DONE', 'IN_PROGRESS'].includes(next.status)) return 'A reviewer can only complete the task or send it back.';
    return null;
  }
  // anyone else who can see it (people asked to look at it, the department's head): comments only
  return only(K, ['comments', 'watchers', 'history']) ? null : 'You can comment on this task, but not change it.';
}

function reqProblem(op, next, old, s, P, X) {
  if (op === 'delete') return P.mgmt ? null : 'Requests can’t be deleted — cancel it instead.';
  if (!old) {
    // every request starts waiting for its first approver: it can't be created already decided
    if (next.raisedBy !== s.empId) return 'Requests are raised in your own name.';
    if (next.status !== 'PENDING' || next.decided) return 'A new request starts as pending.';
    const st = Array.isArray(next.steps) ? next.steps : [];
    if (st.some((x, i) => x?.status !== (i === 0 ? 'PENDING' : 'WAITING'))) return 'A new request starts with its first approver.';
    if (['REVIEW', 'EXTENSION'].includes(next.type)) {
      // about a task: raised by someone working on it, for its assignee
      const t = X.task;
      if (!t || next.empId !== t.assigneeId) return 'That task doesn’t exist, or the request isn’t for its assignee.';
      if (!(P.mgmt || [t.assigneeId, t.assignerId, t.reviewerId].includes(s.empId) || P.person(t.assigneeId))) return 'Only people working on a task can raise a request about it.';
      return null;
    }
    return next.empId === s.empId || P.person(next.empId) ? null : 'You can only raise requests for yourself or your team.';
  }
  const K = changedKeys(next, old);
  if (K.some((k) => ['empId', 'raisedBy', 'type', 'code'].includes(k))) return 'A request’s employee, requester, type and number can’t change.';
  const own = old.empId === s.empId || old.raisedBy === s.empId;
  if (P.mgmt) {
    // management may correct requests, but never approve their own
    if (old.empId === s.empId && ((K.includes('status') && next.status === 'APPROVED') || newlyApproved(old.steps, next.steps))) return 'You can’t approve your own request.';
    return null;
  }
  const involved = P.person(old.empId) || reqParties(old).includes(s.empId) || (old.type === 'EXPENSE' && P.accounts) || (X.cancelApprovers || []).includes(s.empId);
  if (!involved) return 'You can’t change this request.';
  if (only(K, ['watchers', 'comments'])) return null;
  const cur = (old.steps || []).findIndex((x) => x?.status === 'PENDING');
  // the current approver decides: approve, reject or send back — their own step only
  if (cur >= 0 && old.steps[cur].by === s.empId && old.empId !== s.empId && old.status === 'PENDING') {
    if (!only(K, ['status', 'steps', 'decided', 'amountApproved', 'amountApprovedBy', 'watchers', 'comments'])) return 'An approver can only record their decision.';
    if (!['PENDING', ...DECIDED].includes(next.status)) return 'Bad decision.';
    if (K.includes('steps') && !stepsByApprover(old.steps || [], next.steps, cur)) return 'An approver can only decide their own step.';
    return null;
  }
  // the requester: cancel, resubmit after it was sent back, or remind / escalate — never approve
  if (own) {
    if (!only(K, ['status', 'steps', 'decided', 'data', 'watchers', 'comments'])) return 'You can only cancel, resubmit or escalate your request.';
    if (newlyApproved(old.steps, next.steps) || (K.includes('status') && !['CANCELLED', 'PENDING'].includes(next.status))) return 'You can’t decide your own request.';
    if (K.includes('status') && next.status === 'PENDING' && old.status !== 'RETURNED') return 'Only a request that was sent back can be resubmitted.';
    if (K.includes('data') && !(old.status === 'RETURNED' && next.status === 'PENDING')) return 'A request’s details can only change when you resubmit it.';
    return null;
  }
  // accounts record that an approved expense claim was paid
  if (old.type === 'EXPENSE' && P.accounts && old.status === 'APPROVED' && only(K, ['paid', 'watchers', 'comments'])) return null;
  // whoever approved a cancellation marks the original leave as cancelled
  if ((X.cancelApprovers || []).includes(s.empId) && old.type === 'LEAVE' && only(K, ['data']) && same({ ...next.data, cancelled: undefined }, { ...old.data, cancelled: undefined }) && next.data?.cancelled === true) return null;
  return 'You can’t change this request.';
}

// fields of an employee record whose changes are always audited (who someone reports to, what they may do)
const AUDITED_EMP_FIELDS = ['role', 'deptId', 'managerId', 'status', 'active', 'designation', 'code', 'email', 'joining', 'exitDate'];

/** An audit entry the server records for a sensitive change, or null. Written by the server itself, so it can't be
 *  skipped or forged by the browser: attendance changed by someone other than the employee, decisions on requests,
 *  and changes to an employee's role, department, manager or employment status. */
export function auditEntry(op, path, data, old, s, now = Date.now()) {
  const [c, id] = path.split('/');
  const next = op === 'update' ? { ...(old || {}), ...(data || {}) } : op === 'set' ? data || null : null;
  const by = s?.empId || null;
  if (c === 'att') {
    const emp = next?.empId || old?.empId;
    if (!emp || emp === by) return null;
    const days = [...new Set([...Object.keys(old?.days || {}), ...Object.keys(next?.days || {})])].filter((d) => !same(old?.days?.[d], next?.days?.[d])).sort();
    if (op !== 'delete' && !days.length) return null;
    return { at: now, by, action: op === 'delete' ? 'ATTENDANCE_DELETED' : 'ATTENDANCE_EDITED', detail: { emp, month: next?.month || old?.month || null, days } };
  }
  if (c === 'req') {
    if (!old || !next) return null;
    const stepsChanged = (next.steps || []).some((st, i) => st?.status !== old.steps?.[i]?.status && ['APPROVED', 'REJECTED', 'RETURNED'].includes(st?.status));
    if (next.status === old.status && !stepsChanged) return null;
    return { at: now, by, action: next.status !== old.status ? `REQUEST_${next.status}` : 'REQUEST_STEP_DECIDED', detail: { req: next.code || id, type: next.type, emp: next.empId, from: old.status, to: next.status } };
  }
  if (c === 'emp' && path.split('/').length === 2) {
    const changes = {};
    for (const k of AUDITED_EMP_FIELDS) if (!same(next?.[k], old?.[k])) changes[k] = [old?.[k] ?? null, next?.[k] ?? null];
    if (op === 'delete') return old ? { at: now, by, action: 'EMPLOYEE_REMOVED', detail: { emp: id } } : null;
    if (!old) return { at: now, by, action: 'EMPLOYEE_ADDED', detail: { emp: id } };
    return Object.keys(changes).length ? { at: now, by, action: 'EMPLOYEE_CHANGED', detail: { emp: id, changes } } : null;
  }
  return null;
}
