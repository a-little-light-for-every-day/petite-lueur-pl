// QA-only STAR TRACE D1 -> Apps Script -> Sheets/Notion verification.
// Loaded only by pl3-qa-e2e Worker; QA branch watched separately by Cloudflare.
// This module must never be loaded by the public production worker.
import {installStarTrace,readStarTrace,commandStarTrace} from './star-trace-store.js';
import {isolatedQaGate,qaHmac} from './qa-e2e-sync.js';

const RECEIVER='https://script.google.com/macros/s/AKfycbzd6MP0MveFRr0FtOsq5I81Om6y8jJuWuCLFlNYX_j9trPwrTAWSO9wkpUFdtozH7Um9w/exec';
const ORDER='QA-E2E-20261104-ORDER';
const preferences=['藝俊','諾亞','斑比','銀虎','河玟'];
const slot=n=>`${ORDER}:slot:${n}`;
async function seed(env){
  await installStarTrace(env);
  let state=await readStarTrace(env);
  if(state.version===0){
    const commands=[
      ['save_customers',{customers:[{customer_order_id:ORDER,lines:[{product_id:'71386',quantity:1,eligible_krw:128000}],preferences,accepts_duplicates:false}]}],
      ['save_official_orders',{official_orders:[{official_order_id:'QA-WEVERSE-STAR-01',eligible_krw:128000}]}],
      ['record_received_cards',{cards:[{card_id:'QA-CARD-01',member:'藝俊'},{card_id:'QA-CARD-02',member:'諾亞'}]}],
      ['perform_recorded_draw',{draw_order:[slot(2),slot(1)],draw_evidence:'QA fake draw: second slot first; NO customer allocation'}]
    ];
    for(const [i,[action,payload]] of commands.entries()){
      const req={key:'qa:startrace:20261105:'+i,version:state.version,action,payload};
      state=await commandStarTrace(env,'owner:qa-isolated',req);
      const repeat=await commandStarTrace(env,'owner:qa-isolated',req);
      if(!repeat.replayed||repeat.version!==state.version)throw Error('D1 idempotency failed');
    }
  }
  const doc=state.document;
  if(state.version!==4||doc.customers.length!==1||doc.customers[0].customer_order_id!==ORDER||
     doc.official_orders.length!==1||doc.allocation?.allocated.length!==2||
     doc.allocation.allocated[0].slot_id!==slot(2))throw Error('QA D1 STAR TRACE fixture mismatch');
  return state;
}
export async function syncQaStarTrace(env,transport=fetch){
  isolatedQaGate(env);
  const state=await seed(env);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS pl3_qa_star_delivery(id TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,ack_at TEXT)').run();
  const qualification=state.computed.customers[0];
  const fixture=[
    {phase:'qualified',slot_id:'',member:''},
    {phase:'drawn',slot_id:slot(2),member:'YEJUN'},
    {phase:'allocated',slot_id:slot(1),member:'NOAH'}
  ];
  const outcomes=[];
  for(const [i,part] of fixture.entries()){
    const event={event_id:`qa_star_trace_${ORDER}_${i+1}`,event_type:'star_trace.qa',
      entity_id:ORDER,group_id:'PL3-QA-STAR-TRACE',
      payload:{order_id:ORDER,eligible_krw:qualification.eligible_krw,
        qualification_count:qualification.slots,...part}};
    const body=JSON.stringify(event),id=event.event_id;
    const existing=await env.DB.prepare('SELECT body FROM pl3_qa_star_delivery WHERE id=?').bind(id).first();
    if(existing&&existing.body!==body)throw Error('QA delivery changed after first attempt');
    await env.DB.prepare("INSERT OR IGNORE INTO pl3_qa_star_delivery(id,body,status) VALUES(?,?,'pending')").bind(id,body).run();
    let ok=true;
    // Intentionally deliver each event twice; receiver verifies both destinations on replay.
    for(let replay=0;replay<2;replay++){
      try{
        const res=await transport(RECEIVER,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({body,signature:await qaHmac(env.PL3_QA_SYNC_SECRET,body)}),signal:AbortSignal.timeout(30000)});
        const ack=await res.json();
        if(!res.ok||ack.ok!==true||ack.ack_event_id!==id)ok=false;
      }catch{ok=false;}
      if(!ok)break;
    }
    await env.DB.prepare("UPDATE pl3_qa_star_delivery SET status=?,attempts=attempts+1,ack_at=CASE WHEN ?='delivered' THEN CURRENT_TIMESTAMP ELSE ack_at END WHERE id=?").bind(ok?'delivered':'retry',ok?'delivered':'retry',id).run();
    outcomes.push({event_id:id,phase:part.phase,status:ok?'delivered_twice':'retry'});
    if(!ok)break;
  }
  const rows=await env.DB.prepare('SELECT id,status,attempts FROM pl3_qa_star_delivery ORDER BY id').all();
  return {ok:outcomes.length===3&&outcomes.every(x=>x.status==='delivered_twice'),
    environment:'QA_ONLY',d1_version:state.version,qualifications:qualification.slots,
    expected_cards:state.computed.official_orders[0].gifts_expected,
    d1_events:4,events:outcomes,delivery_rows:rows.results,notifications_sent:0};
}
