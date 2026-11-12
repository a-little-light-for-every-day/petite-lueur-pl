// A group's total intake capacity is configured in PL3's owner console.
// Existing caps remain as fallbacks until those historical groups are edited.
export const MAYLA_VIOLET_SKIRT_GROUP = 'e09cf779-5a89-46d0-ac33-400b6d2da7a3';
export const HANAYUME_23_CLAIM_GROUP = 'a36fc0e8-5317-4184-962b-f35751101377';
const legacyGroupCaps = new Map([[MAYLA_VIOLET_SKIRT_GROUP, 3], [HANAYUME_23_CLAIM_GROUP, 5]]);

export function groupCapacityLimit(state, groupId) {
 const group=(state.groups||[]).find(g=>g.id===groupId);
 if(!group)return null;
 if(Object.prototype.hasOwnProperty.call(group,'capacity_limit'))
  return Number.isSafeInteger(group.capacity_limit)&&group.capacity_limit>0?group.capacity_limit:null;
 return legacyGroupCaps.get(groupId)??null;
}

export function occupiedGroupQuantity(state, groupId, {excludeOrderId=null}={}) {
 return (state.orders||[])
  .filter(o=>o.group_id===groupId&&o.id!==excludeOrderId&&!['cancelled','excluded'].includes(o.status))
  .reduce((n,o)=>n+(o.items||[]).reduce((count,item)=>count+(Number(item.quantity)||0),0),0);
}

export function groupAcceptingApplications(group, now=Date.now()) {
 if(group?.status!=='open')return false;
 if(group.id===HANAYUME_23_CLAIM_GROUP&&!group.deadline)return true;
 return !!group.deadline&&Date.parse(group.deadline)>now;
}

export function remainingGroupCapacity(state, groupId) {
 const limit=groupCapacityLimit(state,groupId);
 if(limit===null)return null;
 return Math.max(0,limit-occupiedGroupQuantity(state,groupId));
}
