// Who may change chat documents. Pure functions so they can be tested without a database.
// Group chats: the person who created the group is its admin. Admins can rename, change members and delete the group.
// Other members can only post (last message), pin, and remove themselves (leave).
// Company, department and direct chats keep their existing rules.

export const isGroupAdmin = (chat, empId) => !!chat && chat.kind === 'group' && !!empId && (chat.admins || [chat.createdBy]).includes(empId);

const MEMBER_KEYS = new Set(['last', 'pins', 'members']);

/** Returns a user-facing reason the write is not allowed, or null when it is allowed. `parent` is the chat document for chat/{id}/b/... paths. */
export function chatWriteProblem(op, path, data, old, s, parent) {
  const parts = String(path || '').split('/');
  if (parts[0] !== 'chat') return null;
  const empId = s.empId;
  if (parts.length === 2) return chatDocProblem(op, data, old, empId);
  if (parts.length === 4 && parts[2] === 'b') return bucketProblem(op, data, old, empId, parent, parts[1]);
  return 'Bad chat path.';
}

function chatDocProblem(op, data, old, empId) {
  const notAdmin = 'Only the group admin can change or delete this group.';
  if (!old) {
    if (op === 'delete') return null;
    if (data?.kind === 'group' && data.createdBy !== empId) return 'A group can only be created by the person creating it.';
    return null;
  }
  if (old.kind !== 'group') return null;
  if (isGroupAdmin(old, empId)) {
    const changesType = data?.kind !== undefined && data.kind !== old.kind;
    const changesCreator = data?.createdBy !== undefined && data.createdBy !== old.createdBy;
    if (op !== 'delete' && (changesType || changesCreator)) return 'The group type and creator can’t be changed.';
    return null;
  }
  if (op === 'delete') return notAdmin;
  const oldMembers = old.members || [];
  if (!oldMembers.includes(empId)) return 'You are not a member of this group.';
  const next = op === 'update' ? { ...old, ...data } : data || {};
  for (const k of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (MEMBER_KEYS.has(k)) continue;
    if (JSON.stringify(next[k] ?? null) !== JSON.stringify(old[k] ?? null)) return notAdmin;
  }
  const nextMembers = next.members || [];
  if (nextMembers.some((id) => !oldMembers.includes(id))) return 'Only the group admin can add people.';
  if (oldMembers.some((id) => !nextMembers.includes(id) && id !== empId)) return 'Only the group admin can remove people.';
  return null;
}

function bucketProblem(op, data, old, empId, parent, chatId) {
  if (op === 'delete') {
    if (isGroupAdmin(parent, empId)) return null;
    if (old && old.by === empId) return null;
    return 'Only the group admin can delete messages in this group.';
  }
  if (parent?.kind === 'group') {
    if (!(parent.members || []).includes(empId)) return 'You are not a member of this group.';
  } else if (!parent && String(chatId).startsWith('g-')) {
    return 'That group no longer exists.';
  }
  if (old && old.by !== empId) return 'You can only change your own messages.';
  if (data && data.by !== undefined && data.by !== empId) return 'You can only write your own messages.';
  return null;
}

// data/users/{uid}/cleared — the direct chats a person deleted for themselves:
// { [chatId]: { at, n: { bucketId: [count, last entry id, its time] }, last: 'at|by' of the latest message, pend?: same for a send still landing, p: [pin ids], nt: [notification ids] } }.
// Only the owner can write it (checked in app.js); this keeps its contents well formed.
const CLEARED_KEY = /^dm-[A-Za-z0-9_\-.~:@+]{1,200}$/;
const ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const time = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const mark = (v) => Array.isArray(v) && v.length === 3 && Number.isInteger(v[0]) && v[0] >= 0 && typeof v[1] === 'string' && ID.test(v[1]) && time(v[2]);
const ids = (v, max) => v === undefined || (Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && ID.test(x)));
function clearedEntryProblem(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return 'Bad chat deletion record.';
  if (!time(e.at)) return 'Bad chat deletion time.';
  if (!e.n || typeof e.n !== 'object' || Array.isArray(e.n)) return 'Bad chat deletion record.';
  const n = Object.entries(e.n);
  if (n.length > 500 || n.some(([k, v]) => !ID.test(k) || !mark(v))) return 'Bad chat deletion record.';
  for (const s of [e.last, e.pend]) if (s !== undefined && (typeof s !== 'string' || s.length > 400)) return 'Bad chat deletion record.';
  if (!ids(e.p, 100) || !ids(e.nt, 300)) return 'Bad chat deletion record.';
  return null;
}
export function clearedChatsProblem(op, data, old) {
  if (op === 'delete') return null;
  const next = op === 'update' ? { ...(old || {}), ...(data || {}) } : data || {};
  const keys = Object.keys(next);
  if (keys.length > 5000) return 'Too many deleted chats.';
  for (const k of keys) {
    if (!CLEARED_KEY.test(k)) return 'Only direct chats can be deleted this way.';
    const bad = clearedEntryProblem(next[k]); if (bad) return bad;
  }
  return null;
}
