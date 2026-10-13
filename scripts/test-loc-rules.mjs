// Tests who may read and write WFH / official-duty location records (server/loc-rules.js). Run: node scripts/test-loc-rules.mjs
import assert from 'node:assert/strict';
import { locEmpOf, locVisible, locWriteProblem, seesAllLocations, LOCATION_VIEWER_ROLES, LIVE_STOPPED } from '../server/loc-rules.js';

// Only Admin, HR and Manager accounts see other people's locations; everyone sees their own.
const as = (empId, role = 'EMPLOYEE', extra = {}) => ({ empId, role, active: true, ...extra });
const can = (s, owner) => locVisible(`loc/${owner}_2026-10-13`, s);
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
});

test('Admin, HR and Manager accounts see everyone’s; nobody else does', () => {
  assert.deepEqual(LOCATION_VIEWER_ROLES, ['ADMIN', 'HR', 'MANAGER']);
  for (const role of ['ADMIN', 'HR', 'MANAGER']) assert.equal(can(as('X', role), 'EMP'), true, role);
  assert.equal(can(as('DIR', 'DIRECTOR'), 'EMP'), false, 'directors');
  assert.equal(can(as('LEAD', 'EMPLOYEE'), 'EMP'), false, 'a team lead whose role is Employee');
  assert.equal(seesAllLocations({ bootstrap: true }), true, 'first-time setup (the owner)');
});

test('inactive accounts see nothing — not even with a viewer role', () => {
  assert.equal(can(as('EMP', 'EMPLOYEE', { active: false }), 'EMP'), false);
  for (const role of ['ADMIN', 'HR', 'MANAGER']) assert.equal(can(as('X', role, { active: false }), 'EMP'), false, role);
  assert.equal(can(null, 'EMP'), false);
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

console.log(`\n${n} tests passed`);
