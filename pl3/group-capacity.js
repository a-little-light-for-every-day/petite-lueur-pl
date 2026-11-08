// PL-owned intake capacity is separate from official per-item purchase limits.
// The owner approved a three-piece combined cap across the seven skirt variants.
export const MAYLA_VIOLET_SKIRT_GROUP = 'e09cf779-5a89-46d0-ac33-400b6d2da7a3';
const groupCaps = new Map([[MAYLA_VIOLET_SKIRT_GROUP, 3]]);

export function remainingGroupCapacity(state, groupId) {
 const limit = groupCaps.get(groupId);
 if (!limit) return null;
 const used = (state.orders || [])
  .filter(o => o.group_id === groupId && !['cancelled', 'excluded'].includes(o.status))
  .reduce((n, o) => n + (o.items || []).reduce((count, item) => count + (Number(item.quantity) || 0), 0), 0);
 return Math.max(0, limit - used);
}
