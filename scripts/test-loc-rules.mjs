// Tests who may read and write WFH / official-duty location records (server/loc-rules.js). Run: node scripts/test-loc-rules.mjs
import assert from 'node:assert/strict';
import { locEmpOf, locVisible, locWriteProblem, seesAllLocations, LOCATION_VIEWER_ROLES, LIVE_STOPPED, LIVE_EXPIRED, LIVE_MAX_MS, liveExpired } from '../server/loc-rules.js';

// Only Admin, HR and Manager accounts see other people's locations; everyone sees their own.
const as = (empId, role = 'EMPLOYEE', extra = {}) => ({ empId, role, active: true, ...extra });
const can = (s, owner) => locVisible(`loc/${owner}_2026-10-13`, s);
const rec = (empId, o = {}) => ({ empId, date: '2026-10-13', kind: 'WFH', last: 1, pings: [{ t: 1, lat: 1, lng: 2 }], ...o });
// a fixed clock for the live-sharing tests, so the 8-hour window is exact
const NOW = Date.parse('2026-10-13T10:00:00Z');
const H = 3600000, MIN = 60000;
const P = 'loc/EMP_2026-10-13';
const live = (o) => ({ on: true, since: NOW, every: 10, consentAt: NOW, run: 'r1', ...o });

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
  assert.equal(locWriteProblem('set', P, rec('EMP'), null, as('EMP'), NOW), null);
  assert.equal(locWriteProblem('update', P, { last: 2 }, rec('EMP'), as('EMP'), NOW), null);
  assert.equal(locWriteProblem('delete', P, undefined, rec('EMP'), as('EMP'), NOW), null);
  assert.notEqual(locWriteProblem('set', P, rec('EMP'), null, as('MGR'), NOW), null, 'manager');
  assert.notEqual(locWriteProblem('set', P, rec('EMP'), null, as('ADMIN', 'ADMIN'), NOW), null, 'admin');
  assert.notEqual(locWriteProblem('delete', P, undefined, rec('EMP'), as('HR', 'HR'), NOW), null, 'HR delete');
  assert.notEqual(locWriteProblem('set', P, rec('MGR'), null, as('EMP'), NOW), null, 'record naming someone else');
  assert.notEqual(locWriteProblem('set', P, rec('EMP', { date: '2026-10-12' }), null, as('EMP'), NOW), null, 'wrong date');
  assert.notEqual(locWriteProblem('set', 'loc/EMP', rec('EMP'), null, as('EMP'), NOW), null, 'bad path');
  assert.notEqual(locWriteProblem('set', P, rec('EMP'), null, {}, NOW), null, 'no employee');
});

test('live sharing needs recorded consent and a well-formed state', () => {
  assert.equal(locWriteProblem('set', P, rec('EMP', { live: live() }), null, as('EMP'), NOW), null);
  assert.equal(locWriteProblem('update', P, { live: live({ on: false, stoppedAt: NOW + 1 }) }, rec('EMP', { live: live() }), as('EMP'), NOW), null);
  assert.notEqual(locWriteProblem('set', P, rec('EMP', { live: { on: true, since: NOW, every: 10, run: 'r1' } }), null, as('EMP'), NOW), null, 'no consent');
  assert.notEqual(locWriteProblem('set', P, rec('EMP', { live: live({ on: 'yes' }) }), null, as('EMP'), NOW), null);
  assert.notEqual(locWriteProblem('set', P, rec('EMP', { live: live({ every: -1 }) }), null, as('EMP'), NOW), null);
  assert.notEqual(locWriteProblem('set', P, rec('EMP', { pings: 'x' }), null, as('EMP'), NOW), null);
});

test('a stopped sharing run cannot switch itself back on; a new Start can', () => {
  const stopped = rec('EMP', { live: live({ on: false, stoppedAt: NOW - MIN }) });
  assert.equal(locWriteProblem('set', P, rec('EMP', { live: live() }), stopped, as('EMP'), NOW), LIVE_STOPPED);
  assert.equal(locWriteProblem('set', P, rec('EMP', { live: live({ run: 'r2', consentAt: NOW }) }), stopped, as('EMP'), NOW), null, 'a new Start now');
  assert.equal(locWriteProblem('update', P, { last: NOW }, stopped, as('EMP'), NOW), null, 'other changes are fine');
});

test('a share lasts 8 hours from its start and no longer', () => {
  assert.equal(LIVE_MAX_MS, 8 * H);
  assert.equal(liveExpired(live(), NOW + 8 * H - 1), false, 'one millisecond before 8 hours');
  assert.equal(liveExpired(live(), NOW + 8 * H), true, 'exactly 8 hours');
  assert.equal(liveExpired(live({ on: false }), NOW + 9 * H), false, 'a stopped share is not "expired"');
  const running = rec('EMP', { live: live() });
  assert.equal(locWriteProblem('update', P, { last: NOW + 7 * H }, running, as('EMP'), NOW + 7 * H), null, 'sending inside the window');
  assert.equal(locWriteProblem('update', P, { last: NOW + 8 * H, live: live() }, running, as('EMP'), NOW + 8 * H), LIVE_EXPIRED, 'after 8 hours the share cannot continue');
});

test('after 8 hours the employee can still record that the share stopped', () => {
  const expired = rec('EMP', { live: live() });
  assert.equal(locWriteProblem('update', P, { live: live({ on: false, stoppedAt: NOW + 8 * H }) }, expired, as('EMP'), NOW + 9 * H), null);
});

test('starting again after an expiry gives a new 8 hours', () => {
  const expired = rec('EMP', { live: live() });
  const later = NOW + 9 * H;
  assert.equal(locWriteProblem('set', P, rec('EMP', { live: live({ run: 'r2', since: later, consentAt: later }) }), expired, as('EMP'), later), null);
});

test('a new share cannot be backdated to extend the old window', () => {
  const later = NOW + 9 * H;
  assert.equal(locWriteProblem('set', P, rec('EMP', { live: live({ run: 'r3', since: NOW, consentAt: later }) }), null, as('EMP'), later), 'Live sharing must start now.');
  assert.equal(locWriteProblem('set', P, rec('EMP', { live: live({ run: 'r3', since: later + 11 * MIN }) }), null, as('EMP'), later), 'Live sharing must start now.', 'nor set in the future');
});

test('the start time of a running share cannot be changed', () => {
  const running = rec('EMP', { live: live() });
  assert.equal(locWriteProblem('update', P, { live: live({ since: NOW + 7 * H }) }, running, as('EMP'), NOW + 8.5 * H), 'Bad live-sharing record.');
});

console.log(`\n${n} tests passed`);
