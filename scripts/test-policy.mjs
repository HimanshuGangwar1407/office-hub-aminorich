// Tests for company policies (server/policy.js) and how they reach the access layer (server/access.js).
// Run: node scripts/test-policy.mjs
import assert from 'node:assert/strict';
import { buildCtx, accessFor, canReadDoc } from '../server/access.js';
import { policyApplicable, policyVisible, policyWriteProblem, policyFileWriteProblem, POLICY_CATEGORIES } from '../server/policy.js';

const ctx = buildCtx([
  { path: 'cfg/main', data: { depts: [{ id: 'd1', name: 'Sales', headId: 'E9' }, { id: 'd2', name: 'Ops', headId: 'E10' }] } },
  { path: 'emp/E1', data: { role: 'ADMIN', active: true, deptId: 'd1' } },
  { path: 'emp/E2', data: { role: 'HR', active: true, deptId: 'd1' } },
  { path: 'emp/E3', data: { role: 'EMPLOYEE', active: true, deptId: 'd1' } },
  { path: 'emp/E4', data: { role: 'EMPLOYEE', active: true, deptId: 'd2' } },
  { path: 'emp/E9', data: { role: 'EMPLOYEE', active: true, deptId: 'd1' } },
  { path: 'emp/E10', data: { role: 'EMPLOYEE', active: true, deptId: 'd2' } },
  { path: 'emp/E12', data: { role: 'EMPLOYEE', active: true, deptId: 'd1', managerId: 'E9' } },
  { path: 'emp/E13', data: { role: 'EMPLOYEE', active: false, deptId: 'd1', managerId: 'E9' } },
]);
const session = (empId, role, extra = {}) => ({ uid: 'u' + empId, empId, role, active: true, admin: role === 'ADMIN', hr: ['ADMIN', 'HR'].includes(role), ...extra });
const ADMIN = session('E1', 'ADMIN'), HR = session('E2', 'HR'), E3 = session('E3', 'EMPLOYEE'), E4 = session('E4', 'EMPLOYEE'), HEAD = session('E9', 'EMPLOYEE'), HEAD2 = session('E10', 'EMPLOYEE');
const pol = (audience, published = true, createdBy = 'E2') => ({ title: 'Leave rules', content: 'Text', category: 'General', audience, published, publishedAt: published ? 1 : null, attachments: [], createdBy, createdAt: 1, updatedAt: 1 });
const COMPANY = { scope: 'company' }, D1 = { scope: 'depts', depts: ['d1'] }, PEOPLE_E4 = { scope: 'people', people: ['E4'] };

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('a published company-wide policy applies to everyone', () => {
  assert.equal(policyApplicable(pol(COMPANY), E3, ctx), true);
  assert.equal(policyApplicable(pol(COMPANY), E4, ctx), true);
});
test('a department policy applies to that department only', () => {
  assert.equal(policyApplicable(pol(D1), E3, ctx), true);
  assert.equal(policyApplicable(pol(D1), E4, ctx), false);
});
test('a people policy applies to the named person only', () => {
  assert.equal(policyApplicable(pol(PEOPLE_E4), E4, ctx), true);
  assert.equal(policyApplicable(pol(PEOPLE_E4), E3, ctx), false);
});
test('drafts are never applicable to employees', () => {
  assert.equal(policyApplicable(pol(COMPANY, false), E3, ctx), false);
});
test('managers see every policy, drafts included', () => {
  assert.equal(policyVisible(pol(D1, false), E4, ctx, true), true);
  assert.equal(policyVisible(pol(D1, false), E4, ctx, false), false);
});
test('a deleted policy (no data) is passed on so clients drop their copy', () => {
  assert.equal(policyVisible(null, E3, ctx, false), true);
});

test('employees cannot post policies', () => {
  assert.match(policyWriteProblem('set', 'policy/p1', pol(COMPANY, true, 'E3'), null, E3, ctx), /Only administrators, HR and managers/);
});
test('a department head may post for their own department', () => {
  assert.equal(policyWriteProblem('set', 'policy/p1', pol(D1, true, 'E9'), null, HEAD, ctx), null);
});
test('a manager may not post for another department or for the whole company', () => {
  assert.match(policyWriteProblem('set', 'policy/p1', pol({ scope: 'depts', depts: ['d2'] }, true, 'E9'), null, HEAD, ctx), /departments you head/);
  assert.match(policyWriteProblem('set', 'policy/p1', pol(COMPANY, true, 'E9'), null, HEAD, ctx), /company-wide/);
});
test('a manager may target their own direct reports, not other employees', () => {
  assert.equal(policyWriteProblem('set', 'policy/p1', pol({ scope: 'people', people: ['E12'] }, true, 'E9'), null, HEAD, ctx), null);
  assert.match(policyWriteProblem('set', 'policy/p1', pol({ scope: 'people', people: ['E4'] }, true, 'E9'), null, HEAD, ctx), /report to you/);
});
test('HR and administrators may target anyone and publish company-wide', () => {
  assert.equal(policyWriteProblem('set', 'policy/p1', pol(COMPANY, true, 'E2'), null, HR, ctx), null);
  assert.equal(policyWriteProblem('set', 'policy/p1', pol({ scope: 'people', people: ['E4'] }, true, 'E1'), null, ADMIN, ctx), null);
});
test('audiences must exist and be non-empty', () => {
  assert.match(policyWriteProblem('set', 'policy/p1', pol({ scope: 'depts', depts: ['nope'] }, true, 'E2'), null, HR, ctx), /Unknown department/);
  assert.match(policyWriteProblem('set', 'policy/p1', pol({ scope: 'people', people: ['E99'] }, true, 'E2'), null, HR, ctx), /Unknown person/);
  assert.match(policyWriteProblem('set', 'policy/p1', pol({ scope: 'depts', depts: [] }, true, 'E2'), null, HR, ctx), /at least one department/);
  assert.match(policyWriteProblem('set', 'policy/p1', pol({ scope: 'everyone' }, true, 'E2'), null, HR, ctx), /Choose who/);
  assert.match(policyWriteProblem('set', 'policy/p1', pol({ scope: 'people', people: ['E13'] }, true, 'E2'), null, HR, ctx), /Unknown person/, 'inactive people cannot be targeted');
});
test('a post is in the poster’s own name', () => {
  assert.match(policyWriteProblem('set', 'policy/p1', pol(COMPANY, true, 'E1'), null, HR, ctx), /own name/);
});
test('field validation: title, text, category, publish state, attachments', () => {
  const bad = (patch, re) => assert.match(policyWriteProblem('set', 'policy/p1', { ...pol(COMPANY, true, 'E2'), ...patch }, null, HR, ctx), re, JSON.stringify(patch).slice(0, 60));
  bad({ title: 'ab' }, /title/);
  bad({ content: '   ' }, /policy text is required/);
  bad({ category: 'Gossip' }, /category/);
  bad({ published: 'yes' }, /Publish the policy/);
  bad({ published: true, publishedAt: null }, /Publish date is missing/);
  bad({ attachments: [1, 2, 3, 4].map(() => ({ fid: 'abcd1234', size: 10, chunks: 1, store: 'policyfile' })) }, /Attach up to 3/);
  bad({ attachments: [{ fid: 'abcd1234', size: 10, chunks: 1, store: 'blob' }] }, /could not be read/);
  bad({ extra: 'x' }, /Unknown policy field/);
});
test('the categories cover the usual policy areas', () => {
  for (const c of ['HR & people', 'Leave & attendance', 'Expenses & finance', 'IT & security']) assert.ok(POLICY_CATEGORIES.includes(c));
});

const P = 'policy/p1', old = pol(D1, true, 'E9');
test('only the author, HR or an administrator may change a policy', () => {
  assert.equal(policyWriteProblem('update', P, { title: 'New title' }, old, HEAD, ctx), null);
  assert.match(policyWriteProblem('update', P, { title: 'New title' }, old, HEAD2, ctx), /Only the author/);
  assert.equal(policyWriteProblem('update', P, { title: 'New title', audience: COMPANY }, old, HR, ctx), null);
});
test('a policy’s author and date cannot be changed', () => {
  assert.match(policyWriteProblem('update', P, { createdBy: 'E2' }, old, HR, ctx), /can’t be changed/);
  assert.match(policyWriteProblem('update', P, { createdAt: 99 }, old, HR, ctx), /can’t be changed/);
});
test('publish and unpublish are changes by the author or HR', () => {
  assert.equal(policyWriteProblem('update', P, { published: false, publishedAt: null }, old, HEAD, ctx), null);
  assert.equal(policyWriteProblem('update', P, { published: true, publishedAt: 5 }, { ...old, published: false }, HEAD, ctx), null);
});
test('deleting a policy is for HR and administrators only', () => {
  assert.match(policyWriteProblem('delete', P, undefined, old, HEAD, ctx), /Only HR or an administrator/);
  assert.equal(policyWriteProblem('delete', P, undefined, old, HR, ctx), null);
});

test('policy attachments: managers upload, HR removes, no uploader is recorded', () => {
  assert.equal(policyFileWriteProblem('set', { fid: 'abc123', i: 0, n: 1, data: 'x' }, HEAD, ctx), null);
  assert.match(policyFileWriteProblem('set', { fid: 'abc123', i: 0, n: 1, data: 'x' }, E3, ctx), /Only administrators, HR and managers/);
  assert.match(policyFileWriteProblem('set', { fid: 'abc123', i: 0, n: 1, data: 'x', by: 'E9' }, HEAD, ctx), /file data/);
  assert.match(policyFileWriteProblem('delete', undefined, HEAD, ctx), /HR or an administrator/);
  assert.equal(policyFileWriteProblem('delete', undefined, HR, ctx), null);
});

test('through the access layer: an employee sees only applicable published policies', () => {
  const pubCompany = { path: 'policy/a', data: pol(COMPANY) };
  const draft = { path: 'policy/b', data: pol(COMPANY, false) };
  const dept2 = { path: 'policy/c', data: pol({ scope: 'depts', depts: ['d2'] }) };
  const A4 = accessFor(E4, buildCtx([...ctx.emps.entries()].map(([id, d]) => ({ path: `emp/${id}`, data: d })).concat([{ path: 'cfg/main', data: { depts: [...ctx.depts] } }, { path: 'policy/a', data: { published: true, audience: COMPANY } }, { path: 'policy/b', data: { published: false, audience: COMPANY } }, { path: 'policy/c', data: { published: true, audience: { scope: 'depts', depts: ['d2'] } } }])));
  assert.equal(canReadDoc(pubCompany.path, pubCompany.data, A4), true);
  assert.equal(canReadDoc(draft.path, draft.data, A4), false);
  assert.equal(canReadDoc(dept2.path, dept2.data, A4), true, 'E4 is in d2');
  assert.equal(canReadDoc('policyfile/abc123_0', { fid: 'abc123' }, A4), false, 'attachments are read through a policy, not by sync');
});
test('a manager sees drafts through the access layer', () => {
  const rows = [{ path: 'cfg/main', data: { depts: [...ctx.depts] } }, { path: 'emp/E9', data: ctx.emps.get('E9') }, { path: 'policy/b', data: { published: false, audience: COMPANY } }];
  const A = accessFor(HEAD, buildCtx(rows));
  assert.equal(A.policyMgr, true);
  assert.equal(canReadDoc('policy/b', { published: false, audience: COMPANY }, A), true);
});
test('the sync scope changes when a policy becomes visible to an employee', () => {
  const base = [{ path: 'cfg/main', data: { depts: [...ctx.depts] } }, { path: 'emp/E4', data: ctx.emps.get('E4') }];
  const before = accessFor(E4, buildCtx([...base, { path: 'policy/a', data: { published: false, audience: COMPANY } }])).sig;
  const after = accessFor(E4, buildCtx([...base, { path: 'policy/a', data: { published: true, audience: COMPANY } }])).sig;
  assert.notEqual(before, after);
});

console.log(`\n${n} tests passed`);
