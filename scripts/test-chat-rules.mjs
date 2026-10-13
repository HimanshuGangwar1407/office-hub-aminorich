// Tests the group-chat permission rules in server/chat-rules.js. Run: node scripts/test-chat-rules.mjs
import assert from 'node:assert/strict';
import { chatWriteProblem, isGroupAdmin, clearedChatsProblem } from '../server/chat-rules.js';

const ADMIN = 'E1', MEMBER = 'E2', OTHER = 'E3', OUTSIDER = 'E4';
const as = (empId) => ({ empId });
const group = () => ({ kind: 'group', name: 'Launch', members: [ADMIN, MEMBER, OTHER], admins: [ADMIN], createdBy: ADMIN, created: 1 });
const allowed = (...args) => assert.equal(chatWriteProblem(...args), null, JSON.stringify(args.slice(0, 2)));
const denied = (...args) => assert.notEqual(chatWriteProblem(...args), null, `expected denial: ${args[1]}`);

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

test('group admin (creator) can rename, change members and delete', () => {
  const g = group();
  allowed('update', 'chat/g-1', { name: 'Renamed' }, g, as(ADMIN));
  allowed('update', 'chat/g-1', { members: [ADMIN, MEMBER, OTHER, OUTSIDER] }, g, as(ADMIN));
  allowed('update', 'chat/g-1', { members: [ADMIN, MEMBER] }, g, as(ADMIN));
  allowed('delete', 'chat/g-1', undefined, g, as(ADMIN));
});

test('admin cannot change the group type or creator', () => {
  denied('update', 'chat/g-1', { createdBy: MEMBER }, group(), as(ADMIN));
  denied('update', 'chat/g-1', { kind: 'dept' }, group(), as(ADMIN));
});

test('ordinary members can post metadata (last message, pins) and leave', () => {
  const g = group();
  allowed('update', 'chat/g-1', { last: { at: 2, by: MEMBER, text: 'hi' } }, g, as(MEMBER));
  allowed('update', 'chat/g-1', { pins: [{ id: 'm1' }] }, g, as(MEMBER));
  allowed('update', 'chat/g-1', { members: [ADMIN, OTHER] }, g, as(MEMBER));
});

test('ordinary members cannot rename, add people, remove others or delete', () => {
  const g = group();
  denied('update', 'chat/g-1', { name: 'Hijacked' }, g, as(MEMBER));
  denied('update', 'chat/g-1', { members: [ADMIN, MEMBER, OTHER, OUTSIDER] }, g, as(MEMBER));
  denied('update', 'chat/g-1', { members: [ADMIN, MEMBER] }, g, as(MEMBER));
  denied('update', 'chat/g-1', { admins: [MEMBER] }, g, as(MEMBER));
  denied('delete', 'chat/g-1', undefined, g, as(MEMBER));
});

test('someone outside the group cannot change it', () => {
  denied('update', 'chat/g-1', { last: { at: 2, by: OUTSIDER, text: 'x' } }, group(), as(OUTSIDER));
});

test('creating a group must name the caller as creator', () => {
  allowed('set', 'chat/g-2', { kind: 'group', name: 'New', members: [MEMBER, OTHER], admins: [MEMBER], createdBy: MEMBER }, null, as(MEMBER));
  denied('set', 'chat/g-3', { kind: 'group', name: 'Fake', members: [MEMBER], admins: [ADMIN], createdBy: ADMIN }, null, as(MEMBER));
});

test('company, department and direct chats keep their existing rules', () => {
  allowed('update', 'chat/dept-1', { last: { at: 2, by: MEMBER, text: 'x' } }, { kind: 'dept', name: 'Sales' }, as(MEMBER));
  allowed('update', 'chat/dm-a-b', { last: { at: 2, by: MEMBER, text: 'x' } }, { kind: 'dm', members: [ADMIN, MEMBER] }, as(MEMBER));
});

test('non-chat paths are not affected', () => {
  allowed('update', 'emp/E2', { name: 'x' }, { name: 'y' }, as(MEMBER));
});

test('members write only their own message buckets', () => {
  const g = group();
  allowed('set', 'chat/g-1/b/2026-10_E2', { month: '2026-10', by: MEMBER, msgs: [] }, null, as(MEMBER), g);
  denied('set', 'chat/g-1/b/2026-10_E3', { month: '2026-10', by: OTHER, msgs: [] }, null, as(MEMBER), g);
  allowed('update', 'chat/g-1/b/2026-10_E2', { msgs: [] }, { by: MEMBER, msgs: [] }, as(MEMBER), g);
  denied('update', 'chat/g-1/b/2026-10_E3', { msgs: [] }, { by: OTHER, msgs: [] }, as(MEMBER), g);
});

test('non-members cannot post into a group', () => {
  denied('set', 'chat/g-1/b/2026-10_E4', { month: '2026-10', by: OUTSIDER, msgs: [] }, null, as(OUTSIDER), group());
});

test('removed members lose write access', () => {
  const g = { ...group(), members: [ADMIN, OTHER] };
  denied('set', 'chat/g-1/b/2026-10_E2', { month: '2026-10', by: MEMBER, msgs: [] }, null, as(MEMBER), g);
});

test('only the admin (or the author) can delete messages in a group', () => {
  const g = group();
  denied('delete', 'chat/g-1/b/2026-10_E3', undefined, { by: OTHER, msgs: [] }, as(MEMBER), g);
  allowed('delete', 'chat/g-1/b/2026-10_E3', undefined, { by: OTHER, msgs: [] }, as(ADMIN), g);
  allowed('delete', 'chat/g-1/b/2026-10_E2', undefined, { by: MEMBER, msgs: [] }, as(MEMBER), g);
});

test('a deleted group cannot be written into again', () => {
  denied('set', 'chat/g-1/b/2026-10_E2', { month: '2026-10', by: MEMBER, msgs: [] }, null, as(MEMBER), null);
});

test('isGroupAdmin only accepts groups', () => {
  assert.equal(isGroupAdmin(group(), ADMIN), true);
  assert.equal(isGroupAdmin(group(), MEMBER), false);
  assert.equal(isGroupAdmin({ kind: 'dept', createdBy: ADMIN }, ADMIN), false);
});

const cleared = (o = {}) => ({ at: 1700000000000, n: { '2026-10_E1': [3, 'm3', 1699999990000], '2026-10_E2': [1, 'm9', 1700000000000] }, last: '1700000000000|E2', p: ['m1'], nt: ['n1'], ...o });

test('deleted-chats record accepts direct chats with message counts', () => {
  assert.equal(clearedChatsProblem('set', { 'dm-E1-E2': cleared() }, null), null);
  assert.equal(clearedChatsProblem('set', { 'dm-E1-E2': { at: 1, n: {} } }, null), null);
  assert.equal(clearedChatsProblem('set', { 'dm-E1-E2': cleared({ pend: '1700000000001|E1' }) }, null), null);
  assert.equal(clearedChatsProblem('update', { 'dm-E1-E3': cleared() }, { 'dm-E1-E2': cleared() }), null);
  assert.equal(clearedChatsProblem('delete', undefined, { 'dm-E1-E2': cleared() }), null);
});

test('deleted-chats record rejects group/company chats and malformed entries', () => {
  const bad = (data, old = null) => assert.notEqual(clearedChatsProblem('update', data, old), null, JSON.stringify(data));
  assert.notEqual(clearedChatsProblem('set', { 'g-1': cleared() }, null), null);
  assert.notEqual(clearedChatsProblem('set', { all: cleared() }, null), null);
  bad({ 'dm-E1-E2': 5 });
  bad({ 'dm-E1-E2': null });
  bad({ 'dm-E1-E2': cleared({ at: 'soon' }) });
  bad({ 'dm-E1-E2': cleared({ at: -1 }) });
  bad({ 'dm-E1-E2': cleared({ n: null }) });
  bad({ 'dm-E1-E2': cleared({ n: { '2026-10_E1': 3 } }) });
  bad({ 'dm-E1-E2': cleared({ n: { '2026-10_E1': [-1, 'm1', 1] } }) });
  bad({ 'dm-E1-E2': cleared({ n: { '2026-10_E1': [1.5, 'm1', 1] } }) });
  bad({ 'dm-E1-E2': cleared({ n: { '2026-10_E1': [1, 'bad/id', 1] } }) });
  bad({ 'dm-E1-E2': cleared({ n: { '2026-10_E1': [1, 'm1', 'x'] } }) });
  bad({ 'dm-E1-E2': cleared({ n: { 'bad/id': [1, 'm1', 1] } }) });
  bad({ 'dm-E1-E2': cleared({ last: 7 }) });
  bad({ 'dm-E1-E2': cleared({ pend: 7 }) });
  bad({ 'dm-E1-E2': cleared({ p: 'm1' }) });
  bad({ 'dm-E1-E2': cleared({ nt: [1] }) });
  bad({ 'dm-E1-E3': cleared() }, { 'dept-1': cleared() });
});

console.log(`\n${n} tests passed`);
