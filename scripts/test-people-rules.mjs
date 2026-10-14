// Tests who may read and write attendance, work logs, tasks, requests, private employee fields, payroll and the
// audit log (server/people-rules.js). Run: node scripts/test-people-rules.mjs
import assert from 'node:assert/strict';
import { teamOf, peopleAccess, peopleReadable, shapeEmp, shapePayroll, shapeReq, peopleWriteProblem, auditEntry, PRIVATE_EMP_FIELDS, empManageProblem } from '../server/people-rules.js';

// Sales: head HEAD; MGR reports to HEAD; E1, E2 report to MGR. Ops: O1 (no manager). Accounts (ACC): ACC1.
const ctx = {
  emps: new Map(Object.entries({
    HEAD: { deptId: 'sales' }, MGR: { deptId: 'sales', managerId: 'HEAD' }, E1: { deptId: 'sales', managerId: 'MGR' }, E2: { deptId: 'sales', managerId: 'MGR' },
    O1: { deptId: 'ops' }, OHEAD: { deptId: 'ops' }, ACC1: { deptId: 'acc' }, HRP: { deptId: 'ops' }, DIRP: { deptId: 'ops' }, ADM: { deptId: 'ops' }, PAYU: { deptId: 'ops' },
  })),
  depts: [{ id: 'sales', headId: 'HEAD' }, { id: 'ops', headId: 'OHEAD' }, { id: 'acc', code: 'ACC', headId: null }],
};
const sess = (empId, role = 'EMPLOYEE', o = {}) => ({ empId, role, active: true, hr: ['ADMIN', 'HR'].includes(role), admin: role === 'ADMIN', salary: role === 'ADMIN' || role === 'HR', ...o });
const who = (empId, role, o) => { const s = sess(empId, role, o); return { s, P: peopleAccess(s, ctx) }; };
const can = (w, path, data) => peopleReadable(path, data, w.s, w.P);
const att = (empId) => ({ empId, month: '2026-10', days: { '14': [{ t: 1 }] } });
const E1 = who('E1'), E2 = who('E2'), MGR = who('MGR', 'MANAGER'), HEAD = who('HEAD'), O1 = who('O1'), OHEAD = who('OHEAD'), ACC1 = who('ACC1'),
  HR = who('HRP', 'HR'), DIR = who('DIRP', 'DIRECTOR'), ADM = who('ADM', 'ADMIN'), PAYU = who('PAYU', 'EMPLOYEE', { salary: true }), GONE = who('E1', 'EMPLOYEE', { active: false });

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('a team is the reporting chain below someone plus the departments they head', () => {
  assert.deepEqual([...teamOf('MGR', ctx)].sort(), ['E1', 'E2']);
  assert.deepEqual([...teamOf('HEAD', ctx)].sort(), ['E1', 'E2', 'MGR']);
  assert.deepEqual([...teamOf('E1', ctx)], []);
  assert.deepEqual([...teamOf('OHEAD', ctx)].sort(), ['ACC1', 'ADM', 'DIRP', 'HRP', 'O1', 'PAYU'].filter((x) => ctx.emps.get(x).deptId === 'ops').sort());
});

test('an account with the Manager role manages their whole department', () => {
  const c2 = { emps: new Map([...ctx.emps, ['M2', { deptId: 'ops', role: 'MANAGER' }], ['X2', { deptId: 'ops', role: 'MANAGER', active: false }]]), depts: ctx.depts };
  assert.deepEqual([...teamOf('M2', c2)].sort(), ['ADM', 'DIRP', 'HRP', 'O1', 'OHEAD', 'PAYU', 'X2'], 'everyone in Operations');
  assert.deepEqual([...teamOf('X2', c2)], [], 'not when the account is inactive');
  const s = sess('M2', 'MANAGER'), P = peopleAccess(s, c2);
  assert.equal(peopleReadable('att/O1_2026-10', att('O1'), s, P), true, 'their department’s attendance');
  assert.equal(peopleReadable('att/E1_2026-10', att('E1'), s, P), false, 'not another department’s');
  assert.equal(peopleReadable('task/t9', { assigneeId: 'O1', assignerId: 'OHEAD' }, s, P), true);
});

test('attendance and work logs: the person, their managers and management — nobody else', () => {
  for (const p of ['att/E1_2026-10', 'wlog/E1_2026-10-14']) {
    const d = p.startsWith('att') ? att('E1') : { empId: 'E1', date: '2026-10-14' };
    for (const w of [E1, MGR, HEAD, HR, DIR, ADM]) assert.equal(can(w, p, d), true, `${w.s.empId} ${p}`);
    for (const w of [E2, O1, OHEAD, ACC1, GONE]) assert.equal(can(w, p, d), false, `${w.s.empId} ${p}`);
  }
  assert.equal(can(PAYU, 'att/E1_2026-10', att('E1')), true, 'payroll users read attendance');
  assert.equal(can(PAYU, 'wlog/E1_2026-10-14', { empId: 'E1' }), false, 'but not work logs');
});

test('tasks: assignee, assigner, reviewer, people asked to look, the assignee’s managers, the task’s department head, management', () => {
  const t = { assigneeId: 'E1', assignerId: 'O1', reviewerId: 'ACC1', watchers: ['OHEAD'], deptId: 'sales' };
  for (const w of [E1, O1, ACC1, OHEAD, MGR, HEAD, HR, DIR, ADM]) assert.equal(can(w, 'task/t1', t), true, w.s.empId);
  for (const w of [E2, PAYU]) assert.equal(can(w, 'task/t1', t), false, w.s.empId);
  assert.equal(can(OHEAD, 'task/t2', { assigneeId: 'E2', assignerId: 'E1', deptId: 'ops' }), true, 'head of the task’s department');
});

test('requests: the employee, who raised it, its approvers, anyone it was escalated to, managers, management', () => {
  const r = { type: 'LEAVE', empId: 'E1', raisedBy: 'E1', steps: [{ by: 'MGR' }, { by: 'HRP' }], watchers: ['DIRP'] };
  for (const w of [E1, MGR, HEAD, HR, DIR, ADM]) assert.equal(can(w, 'req/r1', r), true, w.s.empId);
  for (const w of [E2, O1, OHEAD, ACC1]) assert.equal(can(w, 'req/r1', r), false, w.s.empId);
  assert.equal(can(O1, 'req/r2', { type: 'LEAVE', empId: 'E1', raisedBy: 'E1', steps: [{ by: 'O1' }] }), true, 'a chosen approver outside the team');
  assert.equal(can(ACC1, 'req/r3', { type: 'EXPENSE', empId: 'E1', raisedBy: 'E1', steps: [{ by: 'MGR' }] }), true, 'accounts staff see expense claims');
  assert.equal(can(ACC1, 'req/r4', { type: 'LEAVE', empId: 'E1', raisedBy: 'E1', steps: [] }), false, 'but not leave');
  assert.equal(can(PAYU, 'req/r5', { type: 'LEAVE', empId: 'E1', steps: [] }), true, 'payroll users read leave');
  assert.equal(can(PAYU, 'req/r6', { type: 'EXPENSE', empId: 'E1', steps: [] }), false);
  assert.equal(peopleReadable('req/r7', { type: 'WFH_OD', empId: 'E1', steps: [] }, O1.s, O1.P, true), true, 'WFH requests for location viewers (WFH dashboard)');
});

test('audit log: administrators only; deletion markers carry nothing', () => {
  assert.equal(can(ADM, 'audit/a1', { action: 'X' }), true);
  for (const w of [HR, DIR, MGR, E1]) assert.equal(can(w, 'audit/a1', { action: 'X' }), false, w.s.empId);
  assert.equal(can(E2, 'att/E1_2026-10', null), true, 'a deletion marker (no content)');
  assert.equal(can(E1, 'seq/REQ', { n: 1 }), false);
  assert.equal(peopleReadable('emp/E1', {}, E1.s, E1.P), undefined, 'other collections are not governed here');
});

test('private employee fields go only to the person, their managers, management and payroll', () => {
  const e = { name: 'E1', deptId: 'sales', role: 'EMPLOYEE', email: 'e1@x', dob: '1990-01-01', phone: '9', leaveAdj: { x: 1 }, history: [1], exitDate: '2027-01-01', prefs: { email: false } };
  for (const w of [E1, MGR, HEAD, HR, DIR, PAYU]) assert.deepEqual(shapeEmp('E1', e, w.P), e, w.s.empId);
  const d = shapeEmp('E1', e, E2.P);
  for (const k of PRIVATE_EMP_FIELDS) assert.equal(k in d, false, k);
  assert.equal(d.name, 'E1'); assert.equal(d.email, 'e1@x'); assert.deepEqual(d.prefs, { email: false }, 'email opt-out stays visible so notifications respect it');
});

test('payroll: salary users see the run; employees only their own line of a finalised month', () => {
  const run = { month: '2026-09', status: 'FINAL', at: 1, totals: { net: 9 }, rules: {}, rows: [{ e: 'E1', n: 100 }, { e: 'E2', n: 200 }] };
  assert.deepEqual(shapePayroll(run, HR.s, HR.P), run);
  assert.deepEqual(shapePayroll(run, E1.s, E1.P).rows, [{ e: 'E1', n: 100 }]);
  assert.equal('totals' in shapePayroll(run, E1.s, E1.P), false);
  assert.equal(shapePayroll({ ...run, status: 'DRAFT' }, E1.s, E1.P), undefined, 'drafts are not shown');
  assert.equal(shapePayroll(run, O1.s, O1.P), undefined, 'not in the run');
});

test('writes: own and team attendance; work logs are your own (managers only add a review)', () => {
  assert.equal(peopleWriteProblem('set', 'att/E1_2026-10', att('E1'), null, E1.s, E1.P), null);
  assert.equal(peopleWriteProblem('set', 'att/E1_2026-10', att('E1'), att('E1'), MGR.s, MGR.P), null);
  assert.notEqual(peopleWriteProblem('set', 'att/E1_2026-10', att('E1'), att('E1'), E2.s, E2.P), null);
  assert.notEqual(peopleWriteProblem('set', 'att/E1_2026-10', att('E1'), att('E1'), O1.s, O1.P), null, 'a chosen approver outside the team can’t overwrite the month');
  assert.notEqual(peopleWriteProblem('update', 'att/E1_2026-10', { empId: 'E2' }, att('E1'), E1.s, E1.P), null, 'moving it to someone else');
  assert.equal(peopleWriteProblem('set', 'att/E1_2026-10', att('E1'), att('E1'), HR.s, HR.P), null);
  const wl = { empId: 'E1', date: '2026-10-14', done: 'x' };
  assert.equal(peopleWriteProblem('set', 'wlog/E1_2026-10-14', wl, null, E1.s, E1.P), null);
  assert.equal(peopleWriteProblem('update', 'wlog/E1_2026-10-14', { review: 'good', reviewedBy: 'MGR' }, wl, MGR.s, MGR.P), null);
  assert.notEqual(peopleWriteProblem('update', 'wlog/E1_2026-10-14', { done: 'edited' }, wl, MGR.s, MGR.P), null);
  assert.notEqual(peopleWriteProblem('set', 'wlog/E1_2026-10-14', wl, null, E2.s, E2.P), null);
});

test('writes: tasks', () => {
  const t = { assigneeId: 'E1', assignerId: 'MGR', deptId: 'sales', status: 'TODO' };
  assert.equal(peopleWriteProblem('set', 'task/t1', { ...t, assignerId: 'O1', assigneeId: 'E2' }, null, O1.s, O1.P), null, 'anyone may assign a task in their own name');
  assert.notEqual(peopleWriteProblem('set', 'task/t1', { ...t, assignerId: 'MGR' }, null, O1.s, O1.P), null, 'not in someone else’s name');
  assert.equal(peopleWriteProblem('set', 'task/t1', { ...t, assignerId: 'HEAD' }, null, E1.s, E1.P), null, 'a recurring task generated by its assignee');
  assert.equal(peopleWriteProblem('update', 'task/t1', { status: 'IN_PROGRESS' }, t, E1.s, E1.P), null);
  assert.notEqual(peopleWriteProblem('update', 'task/t1', { status: 'DONE' }, t, E2.s, E2.P), null);
  assert.equal(peopleWriteProblem('update', 'task/t1', { status: 'DONE' }, { ...t, reviewerId: 'O1' }, O1.s, O1.P), null, 'the reviewer');
  assert.notEqual(peopleWriteProblem('update', 'task/t1', { assignerId: 'E1' }, t, E1.s, E1.P), null, 'taking over as assigner');
  assert.notEqual(peopleWriteProblem('delete', 'task/t1', undefined, t, E1.s, E1.P), null, 'the assignee can’t delete it');
  assert.equal(peopleWriteProblem('delete', 'task/t1', undefined, t, MGR.s, MGR.P), null);
});

test('writes: requests are created pending, in your own name, for yourself or your team', () => {
  const r = { type: 'LEAVE', empId: 'E1', raisedBy: 'E1', status: 'PENDING', steps: [{ by: 'MGR', status: 'PENDING' }, { by: 'HRP', status: 'WAITING' }], data: { days: 1 } };
  assert.equal(peopleWriteProblem('set', 'req/r1', r, null, E1.s, E1.P), null);
  assert.notEqual(peopleWriteProblem('set', 'req/r1', { ...r, raisedBy: 'E2' }, null, E1.s, E1.P), null, 'in someone else’s name');
  assert.notEqual(peopleWriteProblem('set', 'req/r1', { ...r, raisedBy: 'O1' }, null, O1.s, O1.P), null, 'for someone outside your team');
  assert.equal(peopleWriteProblem('set', 'req/r1', { ...r, raisedBy: 'MGR' }, null, MGR.s, MGR.P), null, 'a manager for their team');
  assert.notEqual(peopleWriteProblem('set', 'req/r1', { ...r, status: 'APPROVED' }, null, E1.s, E1.P), null, 'created already approved');
  assert.notEqual(peopleWriteProblem('set', 'req/r1', { ...r, steps: [{ by: 'MGR', status: 'APPROVED' }, { by: 'HRP', status: 'APPROVED' }] }, null, E1.s, E1.P), null, 'with its steps already approved');
  assert.notEqual(peopleWriteProblem('set', 'req/r1', { ...r, status: 'APPROVED' }, null, HR.s, HR.P), null, 'not even HR creates a decided request');
});

test('writes: a task review / extension only from someone working on that task, for its assignee', () => {
  const task = { assigneeId: 'E1', assignerId: 'O1', reviewerId: 'ACC1' };
  const rv = { type: 'REVIEW', empId: 'E1', raisedBy: 'O1', status: 'PENDING', steps: [{ by: 'ACC1', status: 'PENDING' }], data: { taskId: 't1' } };
  assert.equal(peopleWriteProblem('set', 'req/r9', rv, null, O1.s, O1.P, { task }), null, 'the assigner');
  assert.equal(peopleWriteProblem('set', 'req/r9', { ...rv, raisedBy: 'E1' }, null, E1.s, E1.P, { task }), null, 'the assignee');
  assert.notEqual(peopleWriteProblem('set', 'req/r9', { ...rv, raisedBy: 'E2' }, null, E2.s, E2.P, { task }), null, 'an unrelated colleague');
  assert.notEqual(peopleWriteProblem('set', 'req/r9', { ...rv, empId: 'E2' }, null, O1.s, O1.P, { task }), null, 'for someone who isn’t the assignee');
  assert.notEqual(peopleWriteProblem('set', 'req/r9', rv, null, O1.s, O1.P, { task: null }), null, 'about a task that doesn’t exist');
});

test('writes: only the current approver decides — and only their own step', () => {
  const r = { type: 'LEAVE', code: 'REQ-1', empId: 'E1', raisedBy: 'E1', status: 'PENDING', steps: [{ by: 'MGR', status: 'PENDING' }, { by: 'HRP', status: 'WAITING' }], watchers: ['O1'] };
  const approve = { steps: [{ by: 'MGR', status: 'APPROVED' }, { by: 'HRP', status: 'PENDING' }] };
  assert.equal(peopleWriteProblem('update', 'req/r1', approve, r, MGR.s, MGR.P), null, 'the manager approves their step');
  assert.equal(peopleWriteProblem('update', 'req/r1', { status: 'REJECTED', decided: 5, steps: [{ by: 'MGR', status: 'REJECTED' }, { by: 'HRP', status: 'SKIPPED' }] }, r, MGR.s, MGR.P), null, 'or rejects');
  assert.notEqual(peopleWriteProblem('update', 'req/r1', { status: 'APPROVED', steps: [{ by: 'MGR', status: 'APPROVED' }, { by: 'HRP', status: 'APPROVED' }] }, r, MGR.s, MGR.P), null, 'but can’t approve HR’s step too');
  assert.notEqual(peopleWriteProblem('update', 'req/r1', approve, r, E1.s, E1.P), null, 'the requester can’t approve');
  assert.notEqual(peopleWriteProblem('update', 'req/r1', { status: 'APPROVED' }, r, E1.s, E1.P), null);
  assert.notEqual(peopleWriteProblem('update', 'req/r1', approve, r, O1.s, O1.P), null, 'someone @mentioned can’t decide');
  assert.equal(peopleWriteProblem('update', 'req/r1', { watchers: ['O1', 'E2'] }, r, O1.s, O1.P), null, 'but may add watchers');
  assert.equal(peopleWriteProblem('update', 'req/r1', { steps: [{ by: 'MGR', status: 'PENDING' }, { by: 'HRP', status: 'APPROVED' }] }, r, HR.s, HR.P), null, 'HR (management) may correct someone else’s request');
  assert.notEqual(peopleWriteProblem('update', 'req/r1', { data: { days: 9 } }, r, MGR.s, MGR.P), null, 'an approver can’t edit the details');
  assert.notEqual(peopleWriteProblem('delete', 'req/r1', undefined, r, E1.s, E1.P), null, 'requests can’t be deleted by the requester');
  const own = { ...r, empId: 'HRP', raisedBy: 'HRP', steps: [{ by: 'DIRP', status: 'PENDING' }] };
  assert.notEqual(peopleWriteProblem('update', 'req/r2', { status: 'APPROVED', steps: [{ by: 'DIRP', status: 'APPROVED' }] }, own, HR.s, HR.P), null, 'HR can’t approve their own request');
  const ownA = { ...r, empId: 'ADM', raisedBy: 'ADM', steps: [{ by: 'DIRP', status: 'PENDING' }] };
  assert.equal(peopleWriteProblem('update', 'req/r3', { status: 'APPROVED', steps: [{ by: 'DIRP', status: 'APPROVED', actedBy: 'ADM' }] }, ownA, ADM.s, ADM.P), null, 'administrators approve their own requests');
  assert.equal(peopleWriteProblem('update', 'req/r1', approve, r, ADM.s, ADM.P), null, 'and decide anyone’s step');
});

test('writes: the requester cancels, resubmits after a send-back, or escalates', () => {
  const r = { type: 'LEAVE', code: 'REQ-1', empId: 'E1', raisedBy: 'E1', status: 'PENDING', steps: [{ by: 'MGR', status: 'PENDING' }, { by: 'HRP', status: 'WAITING' }], data: { days: 1 } };
  assert.equal(peopleWriteProblem('update', 'req/r1', { status: 'CANCELLED', decided: 5, steps: [{ by: 'MGR', status: 'SKIPPED' }, { by: 'HRP', status: 'SKIPPED' }] }, r, E1.s, E1.P), null);
  assert.equal(peopleWriteProblem('update', 'req/r1', { steps: [{ by: 'MGR', status: 'PENDING', escalated: 9 }, { by: 'HRP', status: 'WAITING' }], watchers: ['HEAD'] }, r, E1.s, E1.P), null, 'escalate');
  const ret = { ...r, status: 'RETURNED', steps: [{ by: 'MGR', status: 'RETURNED' }, { by: 'HRP', status: 'WAITING' }] };
  assert.equal(peopleWriteProblem('update', 'req/r1', { status: 'PENDING', decided: null, data: { days: 1, resubmitNote: 'fixed' }, steps: [{ by: 'MGR', status: 'PENDING' }, { by: 'HRP', status: 'WAITING' }] }, ret, E1.s, E1.P), null, 'resubmit');
  assert.notEqual(peopleWriteProblem('update', 'req/r1', { data: { days: 5 } }, r, E1.s, E1.P), null, 'changing a pending request’s details');
});

test('writes: accounts record payments; a leave cancellation’s approver marks the original', () => {
  const claim = { type: 'EXPENSE', code: 'REQ-2', empId: 'E1', raisedBy: 'E1', status: 'APPROVED', steps: [{ by: 'MGR', status: 'APPROVED' }] };
  assert.equal(peopleWriteProblem('update', 'req/r3', { paid: { at: 1, by: 'ACC1' } }, claim, ACC1.s, ACC1.P), null);
  assert.notEqual(peopleWriteProblem('update', 'req/r3', { status: 'REJECTED' }, claim, ACC1.s, ACC1.P), null, 'but not decide claims');
  assert.notEqual(peopleWriteProblem('update', 'req/r3', { paid: { at: 1 } }, { ...claim, status: 'PENDING' }, ACC1.s, ACC1.P), null, 'nor pay one not yet approved');
  assert.notEqual(peopleWriteProblem('delete', 'req/r3', undefined, claim, ACC1.s, ACC1.P), null, 'nor delete it');
  const leave = { type: 'LEAVE', code: 'REQ-3', empId: 'E1', raisedBy: 'E1', status: 'APPROVED', steps: [{ by: 'MGR', status: 'APPROVED' }], data: { days: 1 } };
  assert.equal(peopleWriteProblem('update', 'req/r4', { data: { days: 1, cancelled: true } }, leave, O1.s, O1.P, { cancelApprovers: ['O1'] }), null);
  assert.notEqual(peopleWriteProblem('update', 'req/r4', { data: { days: 3, cancelled: true } }, leave, O1.s, O1.P, { cancelApprovers: ['O1'] }), null, 'only the cancelled flag');
  assert.notEqual(peopleWriteProblem('update', 'req/r4', { data: { days: 1, cancelled: true } }, leave, O1.s, O1.P, {}), null, 'without an approved cancellation');
});

test('writes: attendance and work-log ids must name their owner (nobody can claim someone else’s month or day)', () => {
  assert.notEqual(peopleWriteProblem('set', 'att/E2_2026-11', { empId: 'E1', month: '2026-11', days: {} }, null, E1.s, E1.P), null);
  assert.notEqual(peopleWriteProblem('set', 'att/E1_2026-11', { empId: 'E1', month: '2026-12', days: {} }, null, E1.s, E1.P), null, 'the month must match too');
  assert.notEqual(peopleWriteProblem('set', 'att/E2_2026-11', { empId: 'E1', month: '2026-11', days: {} }, null, HR.s, HR.P), null, 'for management as well');
  assert.notEqual(peopleWriteProblem('set', 'wlog/E2_2026-11-02', { empId: 'E1', date: '2026-11-02' }, null, E1.s, E1.P), null);
  assert.equal(peopleWriteProblem('set', 'wlog/E1_2026-11-02', { empId: 'E1', date: '2026-11-02' }, null, E1.s, E1.P), null);
});

test('writes: assignees and reviewers work a task; only its assigner or a manager changes the plan', () => {
  const t = { assigneeId: 'E1', assignerId: 'O1', reviewerId: 'ACC1', needsReview: true, deptId: 'sales', status: 'IN_PROGRESS', due: '2026-10-20', watchers: ['OHEAD'] };
  assert.equal(peopleWriteProblem('update', 'task/t1', { status: 'IN_REVIEW' }, t, E1.s, E1.P), null);
  assert.equal(peopleWriteProblem('update', 'task/t1', { hours: 3, checklist: [{ t: 'a', d: true }] }, t, E1.s, E1.P), null);
  assert.notEqual(peopleWriteProblem('update', 'task/t1', { status: 'DONE', completedAt: 1 }, t, E1.s, E1.P), null, 'skipping the review');
  assert.notEqual(peopleWriteProblem('update', 'task/t1', { due: '2026-12-31' }, t, E1.s, E1.P), null, 'moving the deadline without an extension');
  assert.notEqual(peopleWriteProblem('update', 'task/t1', { reviewerId: 'E1' }, t, E1.s, E1.P), null, 'choosing their own reviewer');
  assert.equal(peopleWriteProblem('update', 'task/t1', { status: 'DONE', completedAt: 1 }, { ...t, status: 'IN_REVIEW' }, ACC1.s, ACC1.P), null, 'the reviewer completes it');
  assert.notEqual(peopleWriteProblem('update', 'task/t1', { status: 'CANCELLED' }, t, ACC1.s, ACC1.P), null, 'but can’t cancel it');
  assert.equal(peopleWriteProblem('update', 'task/t1', { comments: [{ by: 'OHEAD', t: 'hi' }] }, t, OHEAD.s, OHEAD.P), null, 'someone asked to look comments');
  assert.notEqual(peopleWriteProblem('update', 'task/t1', { status: 'DONE' }, t, OHEAD.s, OHEAD.P), null, 'but nothing more');
  assert.equal(peopleWriteProblem('update', 'task/t1', { due: '2026-12-31', reviewerId: 'MGR' }, t, O1.s, O1.P), null, 'the assigner plans it');
  assert.equal(peopleWriteProblem('update', 'task/t1', { due: '2026-12-31' }, t, MGR.s, MGR.P), null, 'and the assignee’s manager');
});

test('reads: Manager accounts see WFH requests only as dates (no reasons); the most sensitive fields stay with the person and HR', () => {
  const r = { type: 'WFH_OD', code: 'REQ-9', empId: 'O1', raisedBy: 'O1', status: 'APPROVED', steps: [{ by: 'OHEAD' }], data: { from: '2026-10-14', to: '2026-10-14', kind: 'WFH', reason: 'Doctor visit' }, created: 1 };
  const shaped = shapeReq(r, MGR.s, MGR.P);
  assert.equal(shaped.data.reason, undefined); assert.equal(shaped.data.from, '2026-10-14'); assert.deepEqual(shaped.steps, []);
  assert.equal(shapeReq(r, OHEAD.s, OHEAD.P).data.reason, 'Doctor visit', 'their own manager sees it all');
  const e = { name: 'E1', dob: '1990', bank: 'HDFC 123', pan: 'ABCDE1234F' };
  assert.equal(shapeEmp('E1', e, MGR.P).bank, undefined, 'a manager doesn’t get bank / PAN / Aadhaar');
  assert.equal(shapeEmp('E1', e, MGR.P).dob, '1990', 'but gets the other private fields');
  assert.equal(shapeEmp('E1', e, HR.P).bank, 'HDFC 123'); assert.equal(shapeEmp('E1', e, E1.P).pan, 'ABCDE1234F');
});

test('writes: the audit log is append-only and in your own name; codes come from the server', () => {
  assert.equal(peopleWriteProblem('set', 'audit/a1', { by: 'E1', action: 'X' }, null, E1.s, E1.P), null);
  assert.notEqual(peopleWriteProblem('set', 'audit/a1', { by: 'MGR', action: 'X' }, null, E1.s, E1.P), null);
  assert.notEqual(peopleWriteProblem('set', 'audit/a1', { action: 'X' }, null, E1.s, E1.P), null, 'no anonymous “system” entries from the browser');
  for (const w of [E1, HR, DIR]) {
    assert.notEqual(peopleWriteProblem('update', 'audit/a1', { action: 'Y' }, { by: 'E1' }, w.s, w.P), null, w.s.empId);
    assert.notEqual(peopleWriteProblem('delete', 'audit/a1', undefined, { by: 'E1' }, w.s, w.P), null, w.s.empId);
  }
  assert.equal(peopleWriteProblem('update', 'audit/a1', { action: 'Y' }, { by: 'E1' }, ADM.s, ADM.P), null, 'administrators correct entries');
  assert.equal(peopleWriteProblem('delete', 'audit/a1', undefined, { by: 'E1' }, ADM.s, ADM.P), null, 'and remove them');
  assert.notEqual(peopleWriteProblem('set', 'audit/a2', { by: 'E1', action: 'X' }, null, ADM.s, ADM.P), null, 'new entries are still in your own name');
  assert.deepEqual(auditEntry('delete', 'audit/a1', undefined, { by: 'E1', action: 'X' }, ADM.s, 9), { at: 9, by: 'ADM', action: 'AUDIT_ENTRY_DELETED', detail: { entry: 'a1', action: 'X' } });
  assert.equal(auditEntry('update', 'audit/a1', { action: 'Y' }, { by: 'E1', action: 'X' }, ADM.s, 9).action, 'AUDIT_ENTRY_EDITED');
  assert.equal(auditEntry('set', 'audit/a3', { by: 'ADM', action: 'X' }, null, ADM.s), null, 'ordinary new entries are not doubled');
  assert.notEqual(peopleWriteProblem('set', 'seq/REQ', { n: 1 }, null, ADM.s, ADM.P), null);
  assert.notEqual(peopleWriteProblem('set', 'att/E1_2026-10', att('E1'), null, GONE.s, GONE.P), null, 'inactive accounts');
  assert.equal(peopleWriteProblem('set', 'emp/E1', {}, null, E1.s, E1.P), undefined);
});

test('the server audits attendance edited by others, request decisions and role changes', () => {
  assert.equal(auditEntry('set', 'att/E1_2026-10', att('E1'), null, E1.s), null, 'own check-in');
  const a = auditEntry('set', 'att/E1_2026-10', { ...att('E1'), days: { '14': [{ t: 1 }], '15': [{ t: 2 }] } }, att('E1'), MGR.s, 5);
  assert.deepEqual(a, { at: 5, by: 'MGR', action: 'ATTENDANCE_EDITED', detail: { emp: 'E1', month: '2026-10', days: ['15'] } });
  const r = { type: 'LEAVE', code: 'REQ-0001', empId: 'E1', status: 'PENDING', steps: [{ by: 'MGR', status: 'PENDING' }] };
  assert.equal(auditEntry('update', 'req/r1', { status: 'APPROVED', steps: [{ by: 'MGR', status: 'APPROVED' }] }, r, MGR.s, 6).action, 'REQUEST_APPROVED');
  assert.equal(auditEntry('update', 'req/r1', { steps: [{ by: 'MGR', status: 'APPROVED' }, { by: 'HRP', status: 'PENDING' }] }, r, MGR.s, 6).action, 'REQUEST_STEP_DECIDED');
  assert.equal(auditEntry('update', 'req/r1', { title: 'x' }, r, E1.s), null);
  const e = auditEntry('update', 'emp/E1', { role: 'MANAGER', phone: '1' }, { role: 'EMPLOYEE', phone: '0' }, HR.s, 7);
  assert.deepEqual(e, { at: 7, by: 'HRP', action: 'EMPLOYEE_CHANGED', detail: { emp: 'E1', changes: { role: ['EMPLOYEE', 'MANAGER'] } } }, 'only role / department / manager / status fields — no private values');
  assert.equal(auditEntry('update', 'emp/E1', { prefs: { email: false } }, { prefs: {} }, E1.s), null);
});

test('HR, directors and managers (own department) add and change employees; administrator access stays with administrators', () => {
  const mp = (w, op, id, data, old) => empManageProblem(op, id, data, old, w.s, w.P, ctx);
  const e1 = { name: 'E1', deptId: 'sales', role: 'EMPLOYEE', designation: 'Exec' }, adm = { name: 'A', deptId: 'ops', role: 'ADMIN' }, hrp = { name: 'H', deptId: 'sales', role: 'HR' };
  for (const w of [HR, ADM, DIR, MGR]) {
    assert.equal(mp(w, 'set', 'N1', { name: 'New', deptId: 'sales', role: 'EMPLOYEE' }, null), null, 'add ' + w.s.role);
    assert.equal(mp(w, 'update', 'E1', { designation: 'Senior Exec' }, e1), null, 'edit ' + w.s.role);
  }
  assert.equal(mp(DIR, 'update', 'E1', { role: 'HR', deptId: 'ops' }, e1), null, 'directors move people and give HR / Director roles');
  assert.equal(mp(DIR, 'update', 'HRP', { designation: 'Lead' }, hrp), null);
  assert.equal(mp(MGR, 'update', 'E1', { role: 'MANAGER', managerId: 'MGR' }, e1), null, 'managers promote within their department');
  assert.equal(mp(MGR, 'update', 'MGR', { designation: 'Sales lead' }, { deptId: 'sales', role: 'MANAGER' }), null, 'own record');
  for (const w of [ADM, HR, DIR]) {
    assert.equal(mp(w, 'update', 'E1', { role: 'ADMIN' }, e1), null, 'grant admin ' + w.s.role);
    assert.equal(mp(w, 'set', 'N5', { name: 'x', deptId: 'ops', role: 'ADMIN' }, null), null, 'add an admin ' + w.s.role);
    assert.equal(mp(w, 'update', 'ADM2', { role: 'HR' }, adm), null, 'remove admin ' + w.s.role);
  }
  assert.equal(mp(DIR, 'update', 'ADM2', { designation: 'x' }, adm), null, 'directors edit administrator records');
  assert.match(mp(MGR, 'update', 'E1', { role: 'ADMIN' }, e1), /administrator|Employee or Manager/, 'managers never give admin');
  assert.match(mp(MGR, 'update', 'ADM2', { designation: 'x' }, { ...adm, deptId: 'sales' }), /Only HR/, 'managers never edit admins');
  assert.equal(mp(ADM, 'update', 'ADM', { role: 'HR' }, adm), null, 'administrators may change their own role');
  assert.match(mp(DIR, 'update', 'DIRP', { role: 'ADMIN' }, { deptId: 'ops', role: 'DIRECTOR' }), /own role/, 'others may not — not even to administrator');
  assert.match(mp(HR, 'update', 'HRP', { role: 'DIRECTOR' }, { deptId: 'ops', role: 'HR' }), /own role/);
  assert.match(mp(MGR, 'update', 'MGR', { role: 'DIRECTOR' }, { deptId: 'sales', role: 'MANAGER' }), /own role/);
  assert.match(mp(DIR, 'delete', 'E1', undefined, e1), /Only HR/);
  assert.match(mp(MGR, 'update', 'E1', { leaveAdj: { CL: 5 } }, e1), /leave/);
  assert.match(mp(MGR, 'update', 'O1', { designation: 'x' }, { deptId: 'ops', role: 'EMPLOYEE' }), /own department/);
  assert.match(mp(MGR, 'update', 'E1', { deptId: 'ops' }, e1), /own department/);
  assert.match(mp(MGR, 'set', 'N2', { name: 'x', deptId: 'ops', role: 'EMPLOYEE' }, null), /own department/);
  assert.match(mp(MGR, 'set', 'N3', { name: 'x', deptId: 'sales', role: 'HR' }, null), /Employee or Manager/);
  assert.match(mp(MGR, 'update', 'E1', { role: 'DIRECTOR' }, e1), /Employee or Manager/);
  assert.match(mp(MGR, 'update', 'HRP', { designation: 'x' }, hrp), /Only HR/);
  assert.equal(mp(E1, 'update', 'E1', { designation: 'x' }, e1), undefined, 'employees fall through to the older own-record rules');
  assert.equal(mp(HEAD, 'set', 'N4', { deptId: 'sales' }, null), undefined, 'heading a department is not a manager role');
  assert.equal(mp(who('MGR', 'MANAGER', { active: false }), 'update', 'E1', { designation: 'x' }, e1), undefined, 'inactive');
});

console.log(`\n${n} tests passed`);
