// Tests who may read and write chats, employee records, notifications, mail and files (server/access.js).
// Run: node scripts/test-access-rules.mjs
import assert from 'node:assert/strict';
import { buildCtx, accessFor, canReadDoc, shapeDoc, empWriteProblem, chatAccessProblem, ntfWriteProblem, mailWriteProblem, blobReadable, blobWriteProblem, refUsesFile } from '../server/access.js';

// MGR manages EMP and EMP2 (sales). HEAD heads marketing (MKT). OTHER is in ops.
const rows = [
  ['emp/MGR', { name: 'Mgr', role: 'MANAGER', deptId: 'sales', email: 'mgr@x.in' }],
  ['emp/EMP', { name: 'Emp', role: 'EMPLOYEE', managerId: 'MGR', deptId: 'sales', email: 'emp@x.in', wfhLoc: { lat: 1, lng: 2, addr: 'Home' } }],
  ['emp/EMP2', { name: 'Emp2', role: 'EMPLOYEE', managerId: 'MGR', deptId: 'sales', email: 'emp2@x.in' }],
  ['emp/HEAD', { name: 'Head', role: 'EMPLOYEE', deptId: 'ops', email: 'head@x.in' }],
  ['emp/MKT', { name: 'Mkt', role: 'EMPLOYEE', deptId: 'mkt', email: 'mkt@x.in' }],
  ['emp/OTHER', { name: 'Other', role: 'EMPLOYEE', deptId: 'ops', email: 'other@x.in' }],
  ['cfg/main', { depts: [{ id: 'sales', name: 'Sales' }, { id: 'mkt', name: 'Marketing', headId: 'HEAD' }, { id: 'ops', name: 'Ops' }] }],
  ['chat/dm-EMP-OTHER', { kind: 'dm', members: ['EMP', 'OTHER'] }],
  ['chat/g-1', { kind: 'group', name: 'Launch', members: ['EMP', 'MKT'], admins: ['EMP'], createdBy: 'EMP' }],
].map(([path, data]) => ({ path, data }));
const ctx = buildCtx(rows);
const S = (empId, role = 'EMPLOYEE', o = {}) => accessFor({ uid: 'u-' + empId, empId, role, active: true, hr: ['ADMIN', 'HR'].includes(role), salary: role === 'ADMIN', ...o }, ctx);
const emp = S('EMP'), other = S('OTHER'), mgr = S('MGR', 'MANAGER'), head = S('HEAD'), mkt = S('MKT'), hr = S('HRP', 'HR'), dir = S('DIRP', 'DIRECTOR'), gone = S('EMP', 'EMPLOYEE', { active: false });

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('direct chats and their messages are only for the two people in them', () => {
  for (const p of ['chat/dm-EMP-OTHER', 'chat/dm-EMP-OTHER/b/2026-10_EMP']) {
    assert.equal(canReadDoc(p, {}, emp), true); assert.equal(canReadDoc(p, {}, other), true);
    for (const A of [mgr, hr, dir, head]) assert.equal(canReadDoc(p, {}, A), false, A.s.empId);
  }
});
test('group chats are for their members; the company chat for everyone', () => {
  assert.equal(canReadDoc('chat/g-1/b/2026-10_MKT', {}, mkt), true);
  assert.equal(canReadDoc('chat/g-1', {}, other), false);
  assert.equal(canReadDoc('chat/g-gone/b/x', {}, emp), false, 'a deleted group');
  for (const A of [emp, other, gone.active ? gone : emp]) assert.equal(canReadDoc('chat/all/b/x', {}, A), true);
});
test('department chats are for the department, its head and management', () => {
  assert.equal(canReadDoc('chat/dept-sales/b/x', {}, emp), true);
  assert.equal(canReadDoc('chat/dept-sales/b/x', {}, other), false);
  assert.equal(canReadDoc('chat/dept-mkt', {}, head), true, 'head of marketing');
  assert.equal(canReadDoc('chat/dept-mkt', {}, hr), true);
  assert.equal(canReadDoc('chat/dept-mkt', {}, dir), true);
});
test('inactive accounts read nothing', () => {
  assert.equal(canReadDoc('task/t1', {}, gone), false);
  assert.equal(canReadDoc('chat/all', {}, gone), false);
});
test('the usual WFH (home) location is only sent to people who may see that employee’s locations', () => {
  const e = rows.find((r) => r.path === 'emp/EMP').data;
  for (const A of [emp, mgr, hr, S('ADM', 'ADMIN'), S('MGR2', 'MANAGER')]) assert.deepEqual(shapeDoc('emp/EMP', e, A).wfhLoc, e.wfhLoc, A.s.empId);
  for (const A of [other, head, dir, S('EMP2')]) { const d = shapeDoc('emp/EMP', e, A); assert.equal('wfhLoc' in d, false, A.s.empId); assert.equal(d.name, 'Emp'); }
});
test('notifications: only the recipient reads or changes them; anyone may notify, in their own name', () => {
  const nt = { to: 'EMP', from: 'MGR', body: 'Home, Zoo Road' };
  assert.equal(canReadDoc('ntf/n1', nt, emp), true);
  for (const A of [mgr, other, hr]) assert.equal(canReadDoc('ntf/n1', nt, A), false, A.s.empId);
  assert.equal(ntfWriteProblem('set', { to: 'EMP', from: 'OTHER' }, null, other.s), null);
  assert.notEqual(ntfWriteProblem('set', { to: 'EMP', from: 'MGR' }, null, other.s), null, 'pretending to be someone else');
  assert.equal(ntfWriteProblem('update', { read: true }, nt, emp.s), null);
  assert.notEqual(ntfWriteProblem('update', { read: true }, nt, mgr.s), null);
  assert.notEqual(ntfWriteProblem('delete', undefined, nt, other.s), null);
});
test('mail log: HR sees all, others only their own; mail only to an employee’s address on file', () => {
  const m = { to: 'emp@x.in', empId: 'EMP', status: 'QUEUED' };
  assert.equal(canReadDoc('mail/m1', m, hr), true); assert.equal(canReadDoc('mail/m1', m, emp), true); assert.equal(canReadDoc('mail/m1', m, other), false);
  assert.equal(mailWriteProblem('set', m, null, other), null);
  assert.notEqual(mailWriteProblem('set', { ...m, to: 'attacker@evil.com' }, null, other), null);
  assert.notEqual(mailWriteProblem('set', { ...m, empId: 'NOPE' }, null, other), null);
  assert.notEqual(mailWriteProblem('update', { status: 'SENT' }, m, other), null);
  assert.equal(mailWriteProblem('update', { status: 'QUEUED' }, m, hr), null);
});
test('files are readable by the uploader and by anyone who can read a message or location that uses them', () => {
  const blob = { fid: 'f1', i: 0, by: 'EMP', data: 'x' };
  const dmRef = ['chat/dm-EMP-OTHER/b/2026-10_EMP'], locRef = ['loc/EMP_2026-10-13'];
  assert.equal(blobReadable(blob, [], emp), true, 'uploader');
  assert.equal(blobReadable(blob, dmRef, other), true); assert.equal(blobReadable(blob, dmRef, mgr), false); assert.equal(blobReadable(blob, dmRef, hr), false);
  assert.equal(blobReadable(blob, locRef, mgr), true); assert.equal(blobReadable(blob, locRef, other), false);
  assert.equal(blobReadable(blob, [], other), false, 'not used anywhere you can see');
  assert.equal(blobReadable(blob, dmRef, gone), false);
});
test('files: uploaded in your own name; changed or deleted by the uploader, HR, or a group admin deleting the group', () => {
  const blob = { fid: 'f1', by: 'MKT' }, gRef = ['chat/g-1/b/2026-10_MKT'];
  assert.equal(blobWriteProblem('set', { by: 'EMP' }, null, [], emp), null);
  assert.notEqual(blobWriteProblem('set', { by: 'MKT' }, null, [], emp), null);
  assert.notEqual(blobWriteProblem('set', { by: 'EMP' }, blob, [], emp), null, 'overwriting someone’s file');
  assert.notEqual(blobWriteProblem('delete', undefined, blob, [], other), null);
  assert.equal(blobWriteProblem('delete', undefined, blob, [], mkt), null, 'uploader');
  assert.equal(blobWriteProblem('delete', undefined, blob, gRef, emp), null, 'group admin');
  assert.notEqual(blobWriteProblem('delete', undefined, blob, gRef, other), null);
  assert.equal(blobWriteProblem('delete', undefined, blob, [], hr), null);
});
test('employee records: people change only their own preferences and usual WFH location', () => {
  const e = rows.find((r) => r.path === 'emp/EMP').data;
  assert.equal(empWriteProblem('update', 'emp/EMP', { prefs: { email: false } }, e, emp), null);
  assert.equal(empWriteProblem('update', 'emp/EMP', { wfhLoc: { lat: 3, lng: 4 } }, e, emp), null);
  assert.notEqual(empWriteProblem('update', 'emp/EMP', { leaveAdj: { '2026_CL': 5 } }, e, emp), null);
  assert.notEqual(empWriteProblem('update', 'emp/EMP', { designation: 'CEO' }, e, emp), null);
  assert.notEqual(empWriteProblem('update', 'emp/EMP', { prefs: { email: false } }, e, other), null, 'someone else’s');
  assert.notEqual(empWriteProblem('update', 'emp/EMP', { wfhLoc: null }, e, other), null);
  assert.equal(empWriteProblem('update', 'emp/EMP', { wfhLoc: null }, e, mgr), null, 'manager resets a report’s usual location');
  assert.notEqual(empWriteProblem('update', 'emp/EMP', { wfhLoc: null }, e, dir), null, 'directors no longer see locations');
  assert.equal(empWriteProblem('update', 'emp/EMP', { wfhLoc: null }, e, S('MGR2', 'MANAGER')), null, 'any Manager account');
  assert.notEqual(empWriteProblem('update', 'emp/EMP', { wfhLoc: { lat: 9, lng: 9 } }, e, mgr), null, 'but not set it');
  assert.notEqual(empWriteProblem('delete', 'emp/EMP', undefined, e, emp), null);
});
test('chats: only members write; a direct chat is created between you and one other person', () => {
  assert.equal(chatAccessProblem('set', 'chat/dm-EMP-OTHER/b/2026-10_OTHER', { by: 'OTHER' }, null, other), null);
  assert.notEqual(chatAccessProblem('set', 'chat/dm-EMP-OTHER/b/2026-10_MGR', { by: 'MGR' }, null, mgr), null, 'posting into someone’s DM');
  assert.notEqual(chatAccessProblem('update', 'chat/dm-EMP-OTHER', { pins: [] }, { kind: 'dm', members: ['EMP', 'OTHER'] }, mgr), null);
  assert.equal(chatAccessProblem('set', 'chat/dm-EMP2-MGR', { kind: 'dm', members: ['EMP2', 'MGR'] }, null, mgr), null);
  assert.notEqual(chatAccessProblem('set', 'chat/dm-EMP-EMP2', { kind: 'dm', members: ['EMP', 'EMP2'] }, null, mgr), null, 'a DM between two other people');
  assert.notEqual(chatAccessProblem('set', 'chat/dm-MGR-OTHER', { kind: 'dm', members: ['MGR', 'OTHER', 'EMP'] }, null, mgr), null);
  assert.notEqual(chatAccessProblem('set', 'chat/dm-x', { kind: 'dm', members: ['MGR', 'OTHER'] }, null, mgr), null, 'id must match the members');
  assert.equal(chatAccessProblem('set', 'chat/g-2', { kind: 'group', members: ['OTHER', 'EMP'], createdBy: 'OTHER' }, null, other), null);
  assert.notEqual(chatAccessProblem('set', 'chat/g-3', { kind: 'group', members: ['EMP'], createdBy: 'OTHER' }, null, other), null);
  assert.equal(chatAccessProblem('set', 'chat/dept-sales/b/2026-10_EMP', { by: 'EMP' }, null, emp), null);
  assert.notEqual(chatAccessProblem('set', 'chat/dept-sales/b/2026-10_OTHER', { by: 'OTHER' }, null, other), null);
});
test('a file reference only counts when the uploader put it there (no quoting someone’s file id)', () => {
  assert.equal(refUsesFile('chat/dm-EMP-OTHER/b/2026-10_EMP', { by: 'EMP', msgs: [{ file: { fid: 'f1' } }] }, 'f1', 'EMP'), true);
  assert.equal(refUsesFile('loc/EMP_2026-10-13', { empId: 'EMP', pings: [{ photo: { fid: 'f1' } }] }, 'f1', 'EMP'), true);
  assert.equal(refUsesFile('chat/g-9/b/2026-10_OTHER', { by: 'OTHER', msgs: [{ file: { fid: 'f1' } }] }, 'f1', 'EMP'), false, 'someone else’s message quoting it');
  assert.equal(refUsesFile('loc/OTHER_2026-10-13', { empId: 'OTHER', pings: [{ photo: { fid: 'f1' } }] }, 'f1', 'EMP'), false);
  assert.equal(refUsesFile('chat/dm-EMP-OTHER/b/2026-10_EMP', { by: 'EMP', msgs: [{ text: 'f1' }] }, 'f1', 'EMP'), false, 'just mentioning the id');
  assert.equal(refUsesFile('task/t1', { by: 'EMP', msgs: [{ file: { fid: 'f1' } }] }, 'f1', 'EMP'), false);
});
test('chat ids are reserved, and only HR changes who is in a company, department or direct chat', () => {
  const all = { kind: 'all', name: 'Everyone' }, dm = { kind: 'dm', members: ['EMP', 'OTHER'] };
  assert.notEqual(chatAccessProblem('set', 'chat/all', { kind: 'group', members: ['OTHER'], admins: ['OTHER'], createdBy: 'OTHER' }, null, other), null, 'claiming the company chat as a group');
  assert.notEqual(chatAccessProblem('update', 'chat/all', { kind: 'group', members: ['OTHER'], admins: ['OTHER'] }, all, other), null);
  assert.notEqual(chatAccessProblem('update', 'chat/all', { members: ['OTHER'] }, all, other), null);
  assert.equal(chatAccessProblem('update', 'chat/all', { last: { at: 1, by: 'OTHER', text: 'x' }, pins: [] }, all, other), null, 'posting metadata is fine');
  assert.notEqual(chatAccessProblem('set', 'chat/dept-sales', { kind: 'group', members: ['EMP'] }, null, emp), null);
  assert.notEqual(chatAccessProblem('set', 'chat/dept-sales', { kind: 'dept', deptId: 'ops' }, null, emp), null);
  assert.equal(chatAccessProblem('set', 'chat/dept-sales', { kind: 'dept', name: 'Sales', deptId: 'sales' }, null, emp), null);
  assert.notEqual(chatAccessProblem('update', 'chat/dm-EMP-OTHER', { members: ['EMP', 'MGR'] }, dm, emp), null, 'adding a third person to a DM');
  assert.equal(chatAccessProblem('update', 'chat/dm-EMP-OTHER', { pins: [{ id: 'm1' }] }, dm, emp), null);
  assert.notEqual(chatAccessProblem('delete', 'chat/dm-EMP-OTHER', undefined, dm, emp), null);
  assert.notEqual(chatAccessProblem('delete', 'chat/all', undefined, all, other), null);
  assert.notEqual(chatAccessProblem('set', 'chat/whatever', { kind: 'group', members: ['OTHER'] }, null, other), null, 'groups use g- ids');
  assert.equal(chatAccessProblem('update', 'chat/all', { members: [] }, all, hr), null, 'HR can');
});

test('the visibility signature changes when someone joins a group, but not when a new direct chat starts', () => {
  const before = S('OTHER').sig;
  const joined = accessFor(other.s, buildCtx(rows.map((r) => (r.path === 'chat/g-1' ? { ...r, data: { ...r.data, members: [...r.data.members, 'OTHER'] } } : r)))).sig;
  const newDm = accessFor(other.s, buildCtx([...rows, { path: 'chat/dm-MGR-OTHER', data: { kind: 'dm', members: ['MGR', 'OTHER'] } }])).sig;
  assert.notEqual(before, joined); assert.equal(before, newDm);
});

console.log(`\n${n} tests passed`);
