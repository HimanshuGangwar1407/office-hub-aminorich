// Tests who may read and write WFH / official-duty location records (server/loc-rules.js). Run: node scripts/test-loc-rules.mjs
import assert from 'node:assert/strict';
import { locEmpOf, locVisible, locWriteProblem, teamOf, seesAllLocations, locScope, LIVE_STOPPED } from '../server/loc-rules.js';

// DIR heads Sales; MGR reports to DIR; EMP and EMP2 report to MGR; OTHER is in Ops with no manager link.
const emps = [
  { id: 'DIR', managerId: null, deptId: 'ops' }, { id: 'MGR', managerId: 'DIR', deptId: 'sales' },
  { id: 'EMP', managerId: 'MGR', deptId: 'sales' }, { id: 'EMP2', managerId: 'MGR', deptId: 'sales' },
  { id: 'OTHER', managerId: null, deptId: 'ops' }, { id: 'HEADED', managerId: null, deptId: 'mkt' },
];
const depts = [{ id: 'mkt', headId: 'EMP2' }];
const as = (empId, role = 'EMPLOYEE', extra = {}) => ({ empId, role, active: true, ...extra });
const can = (s, owner) => locVisible(`loc/${owner}_2026-10-13`, s, teamOf(s.empId, emps, depts));
const rec = (empId, o = {}) => ({ empId, date: '2026-10-13', kind: 'WFH', last: 1, pings: [{ t: 1, lat: 1, lng: 2 }], ...o });

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('record paths name the employee', () => {
  assert.equal(locEmpOf('loc/EMP_2026-10-13'), 'EMP');
  assert.equal(locEmpOf('loc/a_b_2026-10-13'), 'a_b');
  assert.equal(locEmpOf('loc/EMP'), null);
  assert.equal(locEmpOf('task/EMP_2026-10-13'), null);
});

test('everyone sees their own location', () => {
  assert.equal(can(as('EMP'), 'EMP'), true);
});

test('colleagues cannot see each other’s location', () => {
  assert.equal(can(as('EMP'), 'EMP2'), false);
  assert.equal(can(as('OTHER'), 'EMP'), false);
  assert.equal(can(as('EMP'), 'MGR'), false, 'reports cannot see their manager');
});

test('managers see their reports at every level; department heads see their department', () => {
  assert.equal(can(as('MGR'), 'EMP'), true);
  assert.equal(can(as('DIR'), 'EMP'), true, 'manager’s manager');
  assert.equal(can(as('DIR'), 'OTHER'), false);
  assert.equal(can(as('EMP2'), 'HEADED'), true, 'department head');
  assert.equal(can(as('EMP2'), 'EMP'), false);
});

test('HR, admins and directors see everyone; inactive accounts see nothing', () => {
  for (const role of ['HR', 'ADMIN', 'DIRECTOR']) assert.equal(can(as('OTHER', role), 'EMP'), true, role);
  assert.equal(can(as('EMP', 'EMPLOYEE', { active: false }), 'EMP'), false);
  assert.equal(can(as('OTHER', 'ADMIN', { active: false }), 'EMP'), false);
  assert.equal(seesAllLocations({ bootstrap: true }), true);
  assert.equal(seesAllLocations(as('MGR', 'MANAGER')), false);
});

test('only the employee can write their own location records', () => {
  assert.equal(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP'), null, as('EMP')), null);
  assert.equal(locWriteProblem('update', 'loc/EMP_2026-10-13', { last: 2 }, rec('EMP'), as('EMP')), null);
  assert.equal(locWriteProblem('delete', 'loc/EMP_2026-10-13', undefined, rec('EMP'), as('EMP')), null);
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP'), null, as('MGR')), null, 'manager');
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP'), null, as('ADMIN', 'ADMIN')), null, 'admin');
  assert.notEqual(locWriteProblem('delete', 'loc/EMP_2026-10-13', undefined, rec('EMP'), as('HR', 'HR')), null, 'HR delete');
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('MGR'), null, as('EMP')), null, 'record naming someone else');
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP', { date: '2026-10-12' }), null, as('EMP')), null, 'wrong date');
  assert.notEqual(locWriteProblem('set', 'loc/EMP', rec('EMP'), null, as('EMP')), null, 'bad path');
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP'), null, {}), null, 'no employee');
});

test('live sharing needs recorded consent and a well-formed state', () => {
  const ok = { on: true, since: 5, every: 10, consentAt: 4 };
  assert.equal(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP', { live: ok }), null, as('EMP')), null);
  assert.equal(locWriteProblem('update', 'loc/EMP_2026-10-13', { live: { ...ok, on: false, stoppedAt: 9 } }, rec('EMP', { live: ok }), as('EMP')), null);
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP', { live: { on: true, since: 5, every: 10 } }), null, as('EMP')), null, 'no consent');
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP', { live: { ...ok, on: 'yes' } }), null, as('EMP')), null);
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP', { live: { ...ok, every: -1 } }), null, as('EMP')), null);
  assert.notEqual(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP', { pings: 'x' }), null, as('EMP')), null);
});

test('a stopped sharing run cannot switch itself back on; a new Start can', () => {
  const stopped = rec('EMP', { live: { on: false, since: 5, every: 10, consentAt: 4, run: 'r1', stoppedAt: 9 } });
  assert.equal(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP', { live: { on: true, since: 5, every: 10, consentAt: 4, run: 'r1' } }), stopped, as('EMP')), LIVE_STOPPED);
  assert.equal(locWriteProblem('set', 'loc/EMP_2026-10-13', rec('EMP', { live: { on: true, since: 3, every: 10, consentAt: 3, run: 'r2' } }), stopped, as('EMP')), null, 'new run, even with an earlier clock');
  assert.equal(locWriteProblem('update', 'loc/EMP_2026-10-13', { last: 10 }, stopped, as('EMP')), null, 'other changes are fine');
});

test('the visibility signature changes when someone’s team changes', () => {
  const a = locScope(as('MGR'), teamOf('MGR', emps, depts));
  const b = locScope(as('MGR'), teamOf('MGR', emps.filter((e) => e.id !== 'EMP2'), depts));
  assert.notEqual(a, b);
  assert.equal(locScope(as('X', 'HR'), new Set()), 'all');
});

console.log(`\n${n} tests passed`);
