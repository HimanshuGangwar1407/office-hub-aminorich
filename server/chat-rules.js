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
