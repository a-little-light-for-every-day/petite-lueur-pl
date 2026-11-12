import {BENEFIT_GROUP} from '../benefit-checkout.js';

// The customer intake window and the owner-facing settlement lifecycle are separate.
// A group may have stopped accepting orders while still awaiting purchases or payment.
export function groupIntakeExpired(group, now = Date.now()) {
 const cutoff = Date.parse(group?.deadline || '');
 return Number.isFinite(cutoff) && cutoff <= now;
}

export function groupIntakeLabel(group, now = Date.now()) {
 if(group?.status === 'draft') return '草稿';
 if(group?.status === 'cancelled') return '流團';
 if(group?.status === 'closed') return '收單已截止・已結案';
 if(group?.status !== 'open') return '狀態待確認';
 if(!group?.deadline || !Number.isFinite(Date.parse(group.deadline))) return '未開放接單・截止待設定';
 if(!groupIntakeExpired(group, now)) return '收單中';
 if(group.id === BENEFIT_GROUP && group.sale_phase === 'awaiting_second') return '收單已截止・二販處理中';
 return '收單已截止・待結案';
}

export function groupSettlementLabel(group) {
 if(group?.status === 'closed') return '已結案';
 if(group?.status === 'cancelled') return '已取消';
 if(group?.status === 'draft') return '尚未開始';
 if(group?.id === BENEFIT_GROUP && group.sale_phase === 'awaiting_second') return '等待二販核實';
 if(group?.id === BENEFIT_GROUP && group.sale_phase === 'finished') return '二販已核實・待結案';
 return '尚未結案';
}
