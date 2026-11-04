// Isolated QA only. No production outbox, customer messages or Notion token.
import {loadOperations} from './operations-store.js';
const RECEIVER='https://script.google.com/macros/s/AKfycbzd6MP0MveFRr0FtOsq5I81Om6y8jJuWuCLFlNYX_j9trPwrTAWSO9wkpUFdtozH7Um9w/exec';
const ORDER='QA-E2E-20261104-ORDER';
export function isolatedQaGate(env){
 if(env.PL3_QA_ISOLATED!=='true'||env.PL3_OPS_MAIL_ENABLED!=='false'||env.PL3_OPS_SYNC_ENABLED!=='false'||env.PL3_FORMAL_SYNC_ENABLED!=='false'||env.PL3_PRODUCTION_CUTOVER!=='false')throw Error('QA isolation required');
 if(env.PL3_QA_SYNC_ENABLED!=='true'||env.PL3_QA_SYNC_RECEIVER!==RECEIVER||!env.PL3_QA_SYNC_SECRET)throw Error('QA sync not connected');
}
export function qaLedgerEvents(s){
 const o=s.orders.find(o=>o.id===ORDER);
 if(!o||o.email!=='pl3-qa-e2e@example.invalid'||s.orders.length!==1)throw Error('Synthetic QA order required');
 const bills=s.invoices.filter(b=>b.order_id===o.id),first=bills.find(b=>b.phase==='first'),second=bills.find(b=>b.phase==='second');
 const paid=b=>s.allocations.filter(a=>a.invoice_id===b.id&&!a.reversed_at).reduce((n,a)=>n+a.amount_twd,0);
 if(!first||!second||!first.finalized||!second.finalized)throw Error('Complete QA ledger required');
 const carry=second.carry_twd,firstReceived=paid(first),secondReceived=paid(second);
 if(o.goods_twd!==890||first.amount_twd!==800||firstReceived!==800||carry!==90||second.amount_twd!==228||secondReceived!==228||s.reports.filter(r=>r.order_id===o.id).length!==2||s.notices.some(n=>['queued','sending','sent'].includes(n.status)))throw Error('QA ledger reconciliation failed');
 const stages=[['first_invoiced',o.goods_twd,0,o.goods_twd,0],['first_partial',o.goods_twd,firstReceived,carry,carry],['first_carry_applied',first.amount_twd,firstReceived,0,carry],['second_invoiced',second.amount_twd,0,second.amount_twd,carry],['second_settled',second.amount_twd,secondReceived,0,carry]];
 return stages.map(([stage,invoice_twd,received_twd,outstanding_twd,carry_twd],i)=>({event_id:'qa_d1_e2e_'+ORDER+'_'+(i+1),event_type:'payment.phase.qa',entity_id:o.id,group_id:'PL3-QA-E2E-PAYMENTS',payload:{order_id:o.id,stage,invoice_twd,received_twd,outstanding_twd,carry_twd}}));
}
export async function qaHmac(secret,body){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function qaTriggerAuthorized(raw,env,now=Date.now()){
 try{isolatedQaGate(env);const outer=JSON.parse(raw),body=JSON.parse(outer.body);if(body.action!=='qa_d1_sync'||!Number.isFinite(body.issued_at)||Math.abs(now-body.issued_at)>60000||!/^[a-f0-9]{64}$/.test(outer.signature||''))return false;const signature=await qaHmac(env.PL3_QA_SYNC_SECRET,'pl3-qa-trigger\n'+outer.body);let diff=0;for(let i=0;i<64;i++)diff|=signature.charCodeAt(i)^outer.signature.charCodeAt(i);return diff===0;}catch{return false;}
}
export async function syncQaLedger(env,transport=fetch){
 isolatedQaGate(env);const loaded=await loadOperations(env),events=qaLedgerEvents(loaded.state);
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS pl3_qa_e2e_delivery(id TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,ack_at TEXT)').run();
 const outcomes=[];
 for(const event of events){const body=JSON.stringify(event),prior=await env.DB.prepare('SELECT body,status FROM pl3_qa_e2e_delivery WHERE id=?').bind(event.event_id).first();if(prior&&prior.body!==body)throw Error('QA event content changed');
  // Re-send even delivered events: the receiver verifies both exact copies, never appends duplicates.
  await env.DB.prepare("INSERT OR IGNORE INTO pl3_qa_e2e_delivery(id,body,status) VALUES(?,?,'pending')").bind(event.event_id,body).run();
  let ok=false;try{const res=await transport(RECEIVER,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body,signature:await qaHmac(env.PL3_QA_SYNC_SECRET,body)}),signal:AbortSignal.timeout(30000)});const ack=await res.json();ok=res.ok&&ack.ok===true&&ack.ack_event_id===event.event_id;}catch{}
  await env.DB.prepare("UPDATE pl3_qa_e2e_delivery SET status=?,attempts=attempts+1,ack_at=CASE WHEN ?='delivered' THEN CURRENT_TIMESTAMP ELSE ack_at END WHERE id=?").bind(ok?'delivered':'retry',ok?'delivered':'retry',event.event_id).run();outcomes.push({event_id:event.event_id,stage:event.payload.stage,status:ok?'delivered':'retry'});
  if(!ok)break;
 }
 return {ok:outcomes.length===5&&outcomes.every(x=>x.status==='delivered'),environment:'QA_ONLY',source_version:loaded.version,events:outcomes,notifications_sent:0};
}
