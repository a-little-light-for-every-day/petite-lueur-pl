// PL3 formal two-destination sync engine. OFF unless explicitly enabled for ONE cohort.
// QA event-ledger drain remains entirely separate in sync-outbox.js.
import { buildFormalProjection, ProjectionBlocked } from "./formal-sync-projection.js";
const encoder=new TextEncoder();
const fail=(message,status=503)=>{const e=new Error(message);e.status=status;throw e;};
const isoAfter=(seconds)=>new Date(Date.now()+seconds*1000).toISOString();
const DSTS=["sheets","notion"];
const MAX_ATTEMPTS=6;
const errorText=(value)=>String(value||"Delivery failed").replace(/[\r\n]/g," ").slice(0,120);
async function sign(secret,body){
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(body))))
    .map(x=>x.toString(16).padStart(2,"0")).join("");
}
function destinationUrl(env,destination){
  const raw=destination==="sheets"?env.PL3_FORMAL_SHEETS_WEBHOOK_URL:env.PL3_FORMAL_NOTION_WEBHOOK_URL;
  let url;try{url=new URL(raw);}catch{fail("Formal destination not configured");}
  if(url.protocol!=="https:"||url.host!=="script.google.com"||!/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)||url.username||url.password)
    fail("Formal destination allowlist mismatch");
  return url.toString();
}
export function formalEnabled(env){
  return env.PL3_FORMAL_SYNC_ENABLED==="true" &&
    /^PL3-FORMAL-[A-Za-z0-9_-]+$/.test(String(env.PL3_FORMAL_ALLOWED_GROUP_ID||"")) &&
    !!env.PL3_FORMAL_SYNC_SECRET && !!env.PL3_FORMAL_SHEETS_WEBHOOK_URL && !!env.PL3_FORMAL_NOTION_WEBHOOK_URL;
}
export function formalStatus(env){
  return {ok:true,enabled:formalEnabled(env),mode:"manual-only",legacy_import_enabled:false};
}
export async function inspectFormalSync(env){
  const summary={...formalStatus(env),migration_ready:false,events:{pending:0,retry:0,blocked:0,delivered:0},
    deliveries:{pending:0,processing:0,retry:0,delivered:0,conflict:0,dead:0},open_conflicts:0};
  try {
    const rows=await env.DB.prepare(
      "SELECT s.status,COUNT(*) AS count FROM sync_outbox s JOIN orders o ON o.id=s.entity_id WHERE s.entity_type='order' AND o.group_id=? GROUP BY s.status"
    ).bind(env.PL3_FORMAL_ALLOWED_GROUP_ID||"").all();
    for(const r of rows.results||[])if(Object.hasOwn(summary.events,r.status))summary.events[r.status]=Number(r.count)||0;
    const counts=await env.DB.prepare(
      "SELECT d.status,COUNT(*) AS count FROM formal_sync_deliveries d JOIN sync_outbox s ON s.id=d.event_id JOIN orders o ON o.id=s.entity_id WHERE o.group_id=? GROUP BY d.status"
    ).bind(env.PL3_FORMAL_ALLOWED_GROUP_ID||"").all();
    for(const r of counts.results||[])if(Object.hasOwn(summary.deliveries,r.status))summary.deliveries[r.status]=Number(r.count)||0;
    const conflicts=await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM formal_sync_conflicts c JOIN orders o ON o.id=c.order_id WHERE o.group_id=? AND c.resolved_at IS NULL"
    ).bind(env.PL3_FORMAL_ALLOWED_GROUP_ID||"").first();
    summary.open_conflicts=Number(conflicts?.count)||0;summary.migration_ready=true;
  }catch(error){
    if(!/no such table/i.test(String(error?.message)))throw error;
  }
  return summary;
}
function requireFormalConfig(env){
  if(!formalEnabled(env))fail("Formal sync locked; explicit cohort and credentials required");
  for(const name of DSTS)destinationUrl(env,name);
}
export async function formalProjectionForOrder(env,orderId,event=null){
  const order=await env.DB.prepare(
    "SELECT id,group_id,status,payment_status,total_twd,created_at,updated_at FROM orders WHERE id=?"
  ).bind(orderId).first();
  if(!order)fail("Order not found",404);
  const rows=await env.DB.prepare(
    "SELECT oi.id,oi.product_id,oi.product_name,oi.variant,oi.quantity,oi.unit_price_twd,COALESCE(f.status,'pending') AS fulfillment_status FROM order_items oi LEFT JOIN fulfillments f ON f.order_item_id=oi.id WHERE oi.order_id=? ORDER BY oi.id"
  ).bind(orderId).all();
  return buildFormalProjection(order,rows.results||[],event||{id:"preview:"+orderId,entity_id:orderId,event_type:"order.created"});
}
async function recordBlocked(env,event,reason){
  const code=errorText(reason);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO formal_sync_conflicts(id,event_id,order_id,destination,reason) VALUES(?,?,?,?,?)"
    ).bind("pl3:conflict:"+event.id+":mapping",event.id,event.entity_id,"mapping",code),
    env.DB.prepare("UPDATE sync_outbox SET status='blocked' WHERE id=? AND status IN ('pending','retry')")
      .bind(event.id)
  ]);
}
async function loadLink(env,orderId,destination){
  return await env.DB.prepare(
    "SELECT remote_id,remote_revision,projection_hash FROM formal_sync_links WHERE order_id=? AND destination=?"
  ).bind(orderId,destination).first();
}
async function deliver(env,event,destination,projection,transport){
  await env.DB.prepare(
    "INSERT OR IGNORE INTO formal_sync_deliveries(event_id,destination) VALUES(?,?)"
  ).bind(event.id,destination).run();
  const stamp=new Date().toISOString();
  const selected=await env.DB.prepare(
    "SELECT status,attempts,next_attempt_at FROM formal_sync_deliveries WHERE event_id=? AND destination=?"
  ).bind(event.id,destination).first();
  if(!selected)return "retry";
  if(selected.status==="delivered")return "delivered";
  if(selected.status==="conflict"||selected.status==="dead")return selected.status;
  if(selected.next_attempt_at&&selected.next_attempt_at>stamp)return "retry";
  const claimed=await env.DB.prepare(
    "UPDATE formal_sync_deliveries SET status='processing',attempts=attempts+1,next_attempt_at=? WHERE event_id=? AND destination=? AND status=? AND (next_attempt_at IS NULL OR next_attempt_at<=?)"
  ).bind(isoAfter(120),event.id,destination,selected.status,stamp).run();
  if(claimed.meta?.changes!==1)return "retry";
  const attempts=Number(selected.attempts||0)+1;
  try{
    const link=await loadLink(env,event.entity_id,destination);
    const content=JSON.stringify({
      event_id:event.id,destination,order_id:event.entity_id,group_id:event.group_id,
      event_type:event.event_type,expected_remote_id:link?.remote_id||null,
      expected_remote_revision:link?.remote_revision||null,projection
    });
    if(content.length>30000)throw Error("Payload too large");
    const payload=JSON.stringify({body:content,signature:await sign(env.PL3_FORMAL_SYNC_SECRET,content)});
    const response=await transport(destinationUrl(env,destination),{
      // Apps Script cold starts and Notion writes can exceed 15 seconds.
      // Stay below the 120-second claim lease so another drain cannot overlap.
      method:"POST",headers:{"Content-Type":"application/json"},body:payload,signal:AbortSignal.timeout(45000)
    });
    const ack=await response.json().catch(()=>({}));
    if(response.status===409||ack.conflict===true){
      await env.DB.batch([
        env.DB.prepare("UPDATE formal_sync_deliveries SET status='conflict',next_attempt_at=NULL,last_error=? WHERE event_id=? AND destination=? AND status='processing'")
          .bind("Destination revision conflict",event.id,destination),
        env.DB.prepare("INSERT OR IGNORE INTO formal_sync_conflicts(id,event_id,order_id,destination,reason) VALUES(?,?,?,?,?)")
          .bind("pl3:conflict:"+event.id+":"+destination,event.id,event.entity_id,destination,"Destination revision conflict")
      ]);
      return "conflict";
    }
    if(ack.ok===false&&/^(SIGNATURE_INVALID|CONFIGURATION_INVALID|DESTINATION_ACCESS_DENIED|NOTION_ACCESS_DENIED|NOTION_SCHEMA_INVALID|DESTINATION_BUSY|RECEIVER_UNAVAILABLE)$/.test(ack.error_code||""))
      throw Error("Receiver: "+ack.error_code);
    if(!response.ok||ack.ok!==true||ack.ack_event_id!==event.id||ack.destination!==destination||
       typeof ack.remote_id!=="string"||!ack.remote_id||typeof ack.remote_revision!=="string"||!ack.remote_revision)
      throw Error("Destination acknowledgement missing (HTTP "+response.status+")");
    const hash=await crypto.subtle.digest("SHA-256",encoder.encode(JSON.stringify(projection)));
    const projectionHash=Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("");
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE formal_sync_deliveries SET status='delivered',next_attempt_at=NULL,last_error=NULL,remote_id=?,remote_revision=?,delivered_at=CURRENT_TIMESTAMP WHERE event_id=? AND destination=? AND status='processing'"
      ).bind(ack.remote_id.slice(0,200),ack.remote_revision.slice(0,120),event.id,destination),
      env.DB.prepare(
        "INSERT INTO formal_sync_links(order_id,destination,remote_id,remote_revision,projection_hash) VALUES(?,?,?,?,?) ON CONFLICT(order_id,destination) DO UPDATE SET remote_id=excluded.remote_id,remote_revision=excluded.remote_revision,projection_hash=excluded.projection_hash,updated_at=CURRENT_TIMESTAMP"
      ).bind(event.entity_id,destination,ack.remote_id.slice(0,200),ack.remote_revision.slice(0,120),projectionHash)
    ]);
    return "delivered";
  }catch(error){
    const dead=attempts>=MAX_ATTEMPTS;
    const backoff=Math.min(60*(2**(attempts-1)),3600);
    const note=errorText(error?.message);
    await env.DB.prepare(
      "UPDATE formal_sync_deliveries SET status=?,next_attempt_at=?,last_error=? WHERE event_id=? AND destination=? AND status='processing'"
    ).bind(dead?"dead":"retry",dead?null:isoAfter(backoff),note,event.id,destination).run();
    return dead?"dead":"retry";
  }
}
export async function drainFormalOutbox(env,maxEvents=2,transport=fetch){
  requireFormalConfig(env);
  const pending=await env.DB.prepare(
    "SELECT s.id,s.entity_id,s.entity_type,s.event_type,s.status,o.group_id FROM sync_outbox s JOIN orders o ON o.id=s.entity_id WHERE s.entity_type='order' AND o.group_id=? AND s.status IN ('pending','retry') AND NOT EXISTS (SELECT 1 FROM sync_outbox prior WHERE prior.entity_id=s.entity_id AND prior.rowid<s.rowid AND prior.status!='delivered') ORDER BY s.rowid ASC LIMIT ?"
  ).bind(env.PL3_FORMAL_ALLOWED_GROUP_ID,Math.min(Math.max(Number(maxEvents)||1,1),3)).all();
  const result={ok:true,examined:0,delivered:0,retry:0,conflict:0,dead:0};
  for(const event of pending.results||[]){
    result.examined++;
    let projection;
    try{projection=await formalProjectionForOrder(env,event.entity_id,event);}
    catch(error){
      if(error instanceof ProjectionBlocked){
        await recordBlocked(env,event,error.code);
        result.conflict++;continue;
      }
      throw error;
    }
    const outcomes=[];
    for(const destination of DSTS)outcomes.push(await deliver(env,event,destination,projection,transport));
    if(outcomes.every(x=>x==="delivered")){
      await env.DB.prepare("UPDATE sync_outbox SET status='delivered',next_attempt_at=NULL,last_error=NULL WHERE id=? AND status IN ('pending','retry')")
        .bind(event.id).run();
      result.delivered++;
    } else if(outcomes.some(x=>x==="conflict"))result.conflict++;
    else if(outcomes.some(x=>x==="dead"))result.dead++;
    else result.retry++;
  }
  return result;
}
