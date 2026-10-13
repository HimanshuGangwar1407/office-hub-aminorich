// Tests for the complaint rules in server/complaints.js: anonymity, who can read what, who can change what, and input checks.
// Run: node scripts/test-complaints.mjs
import assert from 'node:assert/strict';
import { ownerKeyFor, isComplaintStaff, isAssignable, canReadComplaint, complaintWriteProblem, buildComplaint, CATEGORIES, SLA_MS } from '../server/complaints.js';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-for-complaint-rules-only-0123456789';
const NOW = 1760000000000;
const ADMIN = { uid: 'U1', empId: 'E1', role: 'ADMIN', active: true, admin: true, hr: true };
const HR = { uid: 'U2', empId: 'E2', role: 'HR', active: true, admin: false, hr: true };
const EMP = { uid: 'U3', empId: 'E3', role: 'EMPLOYEE', active: true, admin: false, hr: false };
const EMP2 = { uid: 'U4', empId: 'E4', role: 'EMPLOYEE', active: true, admin: false, hr: false };
const GONE = { uid: 'U5', empId: 'E5', role: 'HR', active: false, admin: false, hr: false };
const goodInput = { category: 'Safety', subject: 'Broken fire exit', description: 'The exit on floor two is blocked by boxes every day.', priority: 'HIGH' };

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

// A complaint as it is stored, built by the real submit code.
const built = buildComplaint(goodInput, EMP, NOW);
const stored = JSON.parse(JSON.stringify(built.doc));
const PATH = `complaint/${built.id}`;

test('a complaint document contains no identity of any kind', () => {
  const text = JSON.stringify(stored);
  assert.ok(!text.includes(EMP.empId), 'employee id must not appear in the complaint');
  assert.ok(!text.includes(EMP.uid), 'user id must not appear in the complaint');
  for (const key of ['by', 'empId', 'name', 'userId', 'createdBy', 'raisedBy', 'email']) assert.ok(!(key in stored), `no "${key}" field`);
});

test('the complainant is recorded only in the secret record', () => {
  assert.deepEqual(built.secret, { by: EMP.empId, at: NOW });
});

test('owner key is stable per employee, differs between employees, and is not the employee id', () => {
  assert.equal(ownerKeyFor('E3'), ownerKeyFor('E3'));
  assert.notEqual(ownerKeyFor('E3'), ownerKeyFor('E4'));
  assert.ok(!ownerKeyFor('E3').includes('E3'));
  assert.equal(stored.ownerKey, ownerKeyFor('E3'));
});

test('readers: administrators and staff read every complaint; the owner reads only their own', () => {
  assert.equal(canReadComplaint(PATH, stored, ADMIN, true), true);
  assert.equal(canReadComplaint(PATH, stored, HR, true), true);
  assert.equal(canReadComplaint(PATH, stored, EMP, false), true, 'owner');
  assert.equal(canReadComplaint(PATH, stored, EMP2, false), false, 'another employee');
  assert.equal(canReadComplaint(PATH, stored, HR, false), false, 'HR without the staff flag is not special');
});

test('HR and managers (staff) read complaints but never the complainant record', () => {
  assert.equal(canReadComplaint(`complaintsecret/${built.id}`, built.secret, HR, true), false);
  assert.equal(canReadComplaint(`complaintsecret/${built.id}`, built.secret, EMP, false), false);
  assert.equal(canReadComplaint(`complaintsecret/${built.id}`, built.secret, ADMIN, true), true);
});

test('attachments are readable by staff only', () => {
  const chunk = { fid: 'abc123', i: 0, n: 1, data: 'x' };
  assert.equal(canReadComplaint('complaintfile/abc123_0', chunk, HR, true), true);
  assert.equal(canReadComplaint('complaintfile/abc123_0', chunk, EMP, false), false);
  assert.equal(canReadComplaint('complaintfile/abc123_0', chunk, ADMIN, true), true);
});

test('inactive accounts read nothing', () => {
  assert.equal(canReadComplaint(PATH, stored, GONE, true), false);
  assert.equal(canReadComplaint(PATH, stored, { ...GONE, admin: true }, true), false);
});

test('a deleted or unknown complaint is not readable by a non-staff employee', () => {
  assert.equal(canReadComplaint(PATH, null, EMP2, false), false);
});

test('employees cannot create complaints directly; they must use the form', () => {
  assert.match(complaintWriteProblem('set', PATH, stored, null, EMP, { staff: false }), /complaint form/);
});

test('only staff may change a complaint; employees may not even change their own', () => {
  assert.match(complaintWriteProblem('update', PATH, { status: 'WORKING' }, stored, EMP, { staff: false }), /HR and managers/);
});

test('staff can change status, priority, assignment and add to the history', () => {
  const ctx = { staff: true, assigneeOk: true };
  assert.equal(complaintWriteProblem('update', PATH, { status: 'WORKING' }, stored, HR, ctx), null);
  assert.equal(complaintWriteProblem('update', PATH, { priority: 'URGENT' }, stored, HR, ctx), null);
  assert.equal(complaintWriteProblem('update', PATH, { assignedTo: 'E2' }, stored, HR, ctx), null);
  assert.equal(complaintWriteProblem('update', PATH, { log: [{ at: NOW + 1, action: 'note', text: 'Spoke to facilities' }] }, stored, HR, ctx), null);
});

test('staff cannot change the subject, description, category, owner key or attachments', () => {
  const ctx = { staff: true, assigneeOk: true };
  for (const patch of [{ subject: 'changed' }, { description: 'changed description' }, { category: 'Other' }, { ownerKey: 'x' }, { attachments: [{ fid: 'abcd1234' }] },{ code: 'CMP-000000' }]) {
    assert.match(complaintWriteProblem('update', PATH, patch, stored, HR, ctx), /can’t be changed/, JSON.stringify(patch));
  }
});

test('status and priority must be known values', () => {
  const ctx = { staff: true, assigneeOk: true };
  assert.match(complaintWriteProblem('update', PATH, { status: 'DONE' }, stored, HR, ctx), /Unknown status/);
  assert.match(complaintWriteProblem('update', PATH, { priority: 'MAX' }, stored, HR, ctx), /Unknown priority/);
});

test('complaints can only be assigned to HR or a manager', () => {
  assert.match(complaintWriteProblem('update', PATH, { assignedTo: 'E4' }, stored, HR, { staff: true, assigneeOk: false }), /HR or a manager/);
});

test('the history cannot be rewritten or truncated', () => {
  const withLog = { ...stored, log: [{ at: 1, text: 'first' }, { at: 2, text: 'second' }] };
  const ctx = { staff: true, assigneeOk: true };
  assert.match(complaintWriteProblem('update', PATH, { log: [{ at: 1, text: 'edited' }, { at: 2, text: 'second' }] }, withLog, HR, ctx), /history/);
  assert.match(complaintWriteProblem('update', PATH, { log: [{ at: 1, text: 'first' }] }, withLog, HR, ctx), /history/);
});

test('deleting a complaint is for administrators only', () => {
  assert.match(complaintWriteProblem('delete', PATH, undefined, stored, HR, { staff: true }), /administrator/);
  assert.equal(complaintWriteProblem('delete', PATH, undefined, stored, ADMIN, { staff: true }), null);
});

test('complainant records are written by the server only; admins may delete them with the complaint', () => {
  assert.match(complaintWriteProblem('set', `complaintsecret/${built.id}`, { by: 'E2' }, null, ADMIN, {}), /server only/);
  assert.match(complaintWriteProblem('update', `complaintsecret/${built.id}`, { by: 'E2' }, built.secret, ADMIN, {}), /server only/);
  assert.equal(complaintWriteProblem('delete', `complaintsecret/${built.id}`, undefined, built.secret, ADMIN, {}), null);
  assert.match(complaintWriteProblem('delete', `complaintsecret/${built.id}`, undefined, built.secret, HR, {}), /server only/);
});

test('attachment chunks hold file data only, and only administrators may delete them', () => {
  assert.equal(complaintWriteProblem('set', 'complaintfile/abc123_0', { fid: 'abc123', i: 0, n: 1, data: 'x' }, null, EMP, {}), null);
  assert.match(complaintWriteProblem('set', 'complaintfile/abc123_0', { fid: 'abc123', i: 0, n: 1, data: 'x', by: 'E3' }, null, EMP, {}), /file data/);
  assert.match(complaintWriteProblem('delete', 'complaintfile/abc123_0', undefined, { fid: 'abc123' }, HR, {}), /administrator/);
});

test('submissions are validated', () => {
  const bad = (patch) => assert.throws(() => buildComplaint({ ...goodInput, ...patch }, EMP, NOW), (e) => e.code === 'invalid_argument', JSON.stringify(patch));
  bad({ category: 'Gossip' });
  bad({ subject: 'ab' });
  bad({ description: 'too short' });
  bad({ description: 'x'.repeat(4001) });
  bad({ priority: 'EXTREME' });
  bad({ attachments: [1, 2, 3, 4].map(() => ({ fid: 'abcd1234', size: 10, chunks: 1 })) });
  bad({ attachments: [{ fid: '../../x', size: 10, chunks: 1 }] });
  bad({ attachments: [{ fid: 'abcd1234', size: 7 * 1024 * 1024, chunks: 1 }] });
  bad({ attachments: [{ fid: 'abcd1234', size: 10, chunks: 0 }] });
});

test('a valid submission gets SLA dates and clean attachment metadata', () => {
  const b = buildComplaint({ ...goodInput, attachments: [{ fid: 'abcd1234', name: 'photo\r\n../x.jpg', size: 900, ext: 'JPG', mime: 'image/jpeg', chunks: 2 }] }, EMP, NOW);
  assert.equal(b.doc.status, 'OPEN');
  assert.equal(b.doc.dueAt, NOW + SLA_MS);
  assert.equal(SLA_MS, 7 * 86400000);
  assert.equal(b.doc.attachments[0].name, 'photo .. x.jpg');
  assert.equal(b.doc.attachments[0].ext, 'jpg');
  assert.equal(b.doc.attachments[0].store, 'complaintfile');
  assert.match(b.doc.code, /^CMP-[0-9A-F]{6}$/);
});

test('an employee without an active record cannot raise a complaint', () => {
  assert.throws(() => buildComplaint(goodInput, { ...GONE, empId: null }, NOW), (e) => e.code === 'permission_denied');
});

test('categories cover the requested grievance types', () => {
  for (const c of ['Harassment', 'Discrimination', 'Safety', 'Pay or benefits']) assert.ok(CATEGORIES.includes(c));
});

const fakeDb = ({ headIds = [], reports = [], emps = {} } = {}) => async (sql, params) => {
  if (sql.includes("data->>'managerId'")) return { rowCount: reports.includes(params[0]) ? 1 : 0, rows: [] };
  if (sql.includes('FROM docs WHERE path')) {
    const e = emps[params[0].slice(4)];
    return e ? { rowCount: 1, rows: [{ data: e }] } : { rowCount: 0, rows: [] };
  }
  throw new Error('unexpected query: ' + sql.slice(0, 60));
};

await (async () => {
  const cfgDoc = { depts: [{ id: 'd1', headId: 'E9' }] };
  const who = (empId, role) => ({ empId, role, active: true });
  const check = async (name, actual, expected) => {
    assert.equal(actual, expected, name);
    n++; console.log('ok -', name);
  };
  await check('an employee with nothing is not staff', await isComplaintStaff(who('E3', 'EMPLOYEE'), fakeDb(), cfgDoc), false);
  await check('HR is staff', await isComplaintStaff(who('E2', 'HR'), fakeDb(), cfgDoc), true);
  await check('a manager is staff', await isComplaintStaff(who('E7', 'MANAGER'), fakeDb(), cfgDoc), true);
  await check('a department head is staff', await isComplaintStaff(who('E9', 'EMPLOYEE'), fakeDb(), cfgDoc), true);
  await check('an employee with direct reports is staff', await isComplaintStaff(who('E6', 'EMPLOYEE'), fakeDb({ reports: ['E6'] }), cfgDoc), true);
  await check('an inactive person is never staff', await isComplaintStaff({ empId: 'E2', role: 'HR', active: false }, fakeDb(), cfgDoc), false);
  await check('HR can be assigned complaints', await isAssignable('E2', fakeDb({ emps: { E2: { role: 'HR', active: true } } }), cfgDoc), true);
  await check('a plain employee cannot be assigned', await isAssignable('E3', fakeDb({ emps: { E3: { role: 'EMPLOYEE', active: true } } }), cfgDoc), false);
  await check('a missing record cannot be assigned', await isAssignable('E8', fakeDb(), cfgDoc), false);
})();

console.log(`\n${n} tests passed`);
