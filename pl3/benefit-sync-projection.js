import {benefitSummary} from './operations-benefits.js';

// The existing benefit desk remains the source of truth for its campaigns.
// Translate it to the independent STAR TRACE receiver contract without
// guessing product SKUs or changing historical order records.
export function benefitCampaignProjection(state,campaign){
  const summary=benefitSummary(state,campaign);
  const people=new Map(summary.people.map(person=>[person.key,person]));
  const customers=summary.people.map(person=>({
    customer_order_id:person.order_ids[0],customer_key:person.key,
    customer_order_ids:person.order_ids,display_name:person.name,
    eligible_krw:person.amount_krw,hoodie_qty:person.hoodie_qty,
    earphone_qty:person.earphone_qty,eligible_for_draw:person.eligible,
    preferences:person.preference?.members||[],
    prefer_full_set:person.preference?.prefer_full_set!==false,
    accepts_duplicates:person.preference?.allow_repeat===true,
    accepts_nonpreferred:person.preference?.accept_other===true
  }));
  const qualifications=summary.people.map(person=>({
    customer_order_id:person.order_ids[0],customer_key:person.key,
    customer_order_ids:person.order_ids,eligible_krw:person.amount_krw,
    slots:person.qualifications,to_next_krw:person.next_krw,
    eligible_for_draw:person.eligible,priority_full_set:person.priority_full_set
  }));
  const official_orders=summary.batches.map(batch=>({
    official_order_id:batch.official_order,checkout_id:batch.id,
    eligible_krw:batch.amount_krw,gifts_expected:batch.expected_cards,
    to_next_krw:batch.next_krw,evidence:batch.evidence
  }));
  const received_cards=campaign.cards.map(card=>({...card,card_id:card.id}));
  const tickets=[...(campaign.tickets||[])].sort((a,b)=>a.rank-b.rank);
  const allocated=tickets.filter(t=>t.card_id).map(t=>({
    slot_id:t.id,customer_order_id:t.order_ids[0],customer_key:t.customer_key,
    card_id:t.card_id,member:t.member,rank:t.rank,full_set_priority:t.full_set_priority===true,
    status:t.fulfillment?.stage||t.stage||'待裝箱',fulfillment:t.fulfillment||null
  }));
  const unallocated=tickets.filter(t=>!t.card_id).map(t=>({
    slot_id:t.id,customer_order_id:t.order_ids[0],customer_key:t.customer_key,
    rank:t.rank,reason:'尚未配卡'
  }));
  const used=new Set(allocated.map(t=>t.card_id));
  return {group_id:campaign.id,campaign_group_id:campaign.group_id,
    title:campaign.title,threshold_krw:campaign.threshold_krw,
    customers,qualifications,official_orders,received_cards,
    draw_order:tickets.map(t=>t.id),draw_evidence:campaign.draw_command_id||null,
    allocation:{allocated,unallocated,extra_cards:received_cards.filter(c=>!used.has(c.card_id)),
      adjustment_history:campaign.audit.filter(x=>x.type==='benefit_swap'),
      packing_history:campaign.audit.filter(x=>x.type==='benefit_fulfillment')},
    audit_events:campaign.audit.map(x=>({...x,event_id:x.id})),
    benefit_summary:{qualifications:summary.qualifications,actual_cards:summary.actual_cards,
      remaining:summary.remaining}
  };
}
