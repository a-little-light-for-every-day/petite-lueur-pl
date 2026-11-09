// PL-owned intake capacity is separate from official per-item purchase limits.
// The owner approved a three-piece combined cap across the seven skirt variants.
export const MAYLA_VIOLET_SKIRT_GROUP = 'e09cf779-5a89-46d0-ac33-400b6d2da7a3';
export const HANAYUME_23_CLAIM_GROUP = 'a36fc0e8-5317-4184-962b-f35751101377';
const groupCaps = new Map([[MAYLA_VIOLET_SKIRT_GROUP, 3], [HANAYUME_23_CLAIM_GROUP, 5]]);

export function groupAcceptingApplications(group, now=Date.now()) {
 if(group?.status!=='open')return false;
 if(group.id===HANAYUME_23_CLAIM_GROUP&&!group.deadline)return true;
 return !!group.deadline&&Date.parse(group.deadline)>now;
}

export function remainingGroupCapacity(state, groupId) {
 const limit = groupCaps.get(groupId);
 if (!limit) return null;
 const used = (state.orders || [])
  .filter(o => o.group_id === groupId && !['cancelled', 'excluded'].includes(o.status))
  .reduce((n, o) => n + (o.items || []).reduce((count, item) => count + (Number(item.quantity) || 0), 0), 0);
 return Math.max(0, limit - used);
}
