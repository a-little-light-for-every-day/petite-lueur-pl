import test from "node:test";
import assert from "node:assert/strict";
import { buildFormalProjection, ProjectionBlocked } from "../formal-sync-projection.js";
import { drainFormalOutbox, formalEnabled, formalStatus } from "../formal-sync.js";

const GROUP="PL3-FORMAL-LOCAL";
const ORDER={id:"o1",group_id:GROUP,status:"pending",payment_status:"unpaid",total_twd:350,created_at:"2026-11-01 00:00:00",updated_at:"2026-11-01 00:00:00"};
const LINES=[{id:"i1",product_id:"sku-1",product_name:"PL3 商品",variant:"限定",quantity:1,unit_price_twd:350,fulfillment_status:"ordered"}];
const EVENT={id:"event-1",entity_id:"o1",group_id:GROUP,entity_type:"order",event_type:"order.created",status:"pending",rowid:1};
function harness(){
  const state={order:{...ORDER},lines:LINES.map(x=>({...x})),events:[{...EVENT}],deliveries:new Map(),links:new Map(),conflicts:[]};
  const key=(event,dest)=>event+"|"+dest;
  const env={
    PL3_FORMAL_SYNC_ENABLED:"true",PL3_FORMAL_ALLOWED_GROUP_ID:GROUP,
    PL3_FORMAL_SYNC_SECRET:"test-only-long-key",PL3_FORMAL_SHEETS_WEBHOOK_URL:"https://script.google.com/macros/s/SHEET/exec",
    PL3_FORMAL_NOTION_WEBHOOK_URL:"https://script.google.com/macros/s/NOTION/exec",
    DB:{
      prepare(sql){
        return {
          sql,args:[],
          bind(...args){this.args=args;return this;},
          async all(){
            if(sql.includes("FROM sync_outbox s"))return {results:state.events.filter(e=>e.status==="pending").map(e=>({...e}))};
            if(sql.includes("FROM order_items oi"))return {results:state.lines.map(x=>({...x}))};
            throw Error("Unknown all SQL: "+sql);
          },
          async first(){
            if(sql.includes("FROM orders WHERE id=?"))return this.args[0]===state.order.id?{...state.order}:null;
            if(sql.includes("FROM formal_sync_deliveries"))return state.deliveries.get(key(this.args[0],this.args[1]))||null;
            if(sql.includes("FROM formal_sync_links"))return state.links.get(key(this.args[0],this.args[1]))||null;
            throw Error("Unknown first SQL: "+sql);
          },
          async run(){
            const a=this.args;
            if(sql.startsWith("INSERT OR IGNORE INTO formal_sync_deliveries")){
              const k=key(a[0],a[1]);
              if(!state.deliveries.has(k))state.deliveries.set(k,{status:"pending",attempts:0,next_attempt_at:null});
              return {meta:{changes:1}};
            }
            if(sql.startsWith("UPDATE formal_sync_deliveries SET status='processing'")){
              const d=state.deliveries.get(key(a[1],a[2]));
              if(!d||d.status!==a[3]||(d.next_attempt_at&&d.next_attempt_at>a[4]))return {meta:{changes:0}};
              d.status="processing";d.attempts++;d.next_attempt_at=a[0];return {meta:{changes:1}};
            }
            if(sql.startsWith("UPDATE formal_sync_deliveries SET status='delivered'")){
              const d=state.deliveries.get(key(a[2],a[3]));
              if(!d||d.status!=="processing")return {meta:{changes:0}};
              d.status="delivered";d.next_attempt_at=null;d.remote_id=a[0];d.remote_revision=a[1];return {meta:{changes:1}};
            }
            if(sql.startsWith("UPDATE formal_sync_deliveries SET status='conflict'")){
              const d=state.deliveries.get(key(a[1],a[2]));
              if(d){d.status="conflict";d.next_attempt_at=null;}
              return {meta:{changes:d?1:0}};
            }
            if(sql.startsWith("UPDATE formal_sync_deliveries SET status=?")){
              const d=state.deliveries.get(key(a[3],a[4]));
              if(d){d.status=a[0];d.next_attempt_at=a[1];d.last_error=a[2];}
              return {meta:{changes:d?1:0}};
            }
            if(sql.startsWith("INSERT INTO formal_sync_links")){
              state.links.set(key(a[0],a[1]),{remote_id:a[2],remote_revision:a[3],projection_hash:a[4]});
              return {meta:{changes:1}};
            }
            if(sql.startsWith("INSERT OR IGNORE INTO formal_sync_conflicts")){
              if(!state.conflicts.some(x=>x.id===a[0]))state.conflicts.push({id:a[0],event_id:a[1],reason:a[4]});
              return {meta:{changes:1}};
            }
            if(sql.startsWith("UPDATE sync_outbox SET status='blocked'")){
              const e=state.events.find(x=>x.id===a[0]);if(e)e.status="blocked";
              return {meta:{changes:e?1:0}};
            }
            if(sql.startsWith("UPDATE sync_outbox SET status='delivered'")){
              const e=state.events.find(x=>x.id===a[0]);if(e)e.status="delivered";
              return {meta:{changes:e?1:0}};
            }
            throw Error("Unknown run SQL: "+sql);
          }
        };
      },
      async batch(statements){const rows=[];for(const s of statements)rows.push(await s.run());return rows;}
    }
  };
  return {env,state,key};
}
const ack=(destination,eventId="event-1")=>new Response(JSON.stringify({
  ok:true,ack_event_id:eventId,destination,remote_id:destination+"-id",remote_revision:destination+"-rev1"
}),{status:200});
test("formal projections reconcile totals, map statuses and omit customer secrets",()=>{
  const projection=buildFormalProjection({...ORDER,customer_email:"private@example.com",customer_name:"Real Person"},LINES,EVENT);
  assert.equal(projection.amount_twd,350);
  assert.equal(projection.sheet.order.cells.A,"o1");
  assert.equal(projection.sheet.order.cells.F,350);
  assert.equal(projection.sheet.items[0].cells.I,"o1");
  assert.equal(projection.notion.properties["狀態"],"已向日本商店下單");
  assert.doesNotMatch(JSON.stringify(projection),/private@example.com|Real Person|client_secret|token/i);
});
test("paid with unknown payment phase or mismatched amounts is blocked",()=>{
  assert.throws(()=>buildFormalProjection({...ORDER,payment_status:"paid"},LINES,EVENT),{code:"PAYMENT_PHASE_REQUIRED"});
  assert.throws(()=>buildFormalProjection({...ORDER,total_twd:351},LINES,EVENT),{code:"TOTAL_MISMATCH"});
  assert.throws(()=>buildFormalProjection(ORDER,[{...LINES[0],fulfillment_status:"mystery"}],EVENT),{code:"FULFILLMENT_UNMAPPED"});
});
test("formal delivery is fail-closed until explicit cohort and credentials",async()=>{
  const {env}=harness();delete env.PL3_FORMAL_SYNC_ENABLED;
  assert.equal(formalEnabled(env),false);
  assert.equal(formalStatus(env).enabled,false);
  await assert.rejects(drainFormalOutbox(env),e=>e.status===503);
  env.PL3_FORMAL_SYNC_ENABLED="true";env.PL3_FORMAL_ALLOWED_GROUP_ID="PL3-QA-EXAMPLE";
  await assert.rejects(drainFormalOutbox(env),e=>e.status===503);
});
test("two independently acknowledged destinations mark one outbox event delivered",async()=>{
  const {env,state,key}=harness(),calls=[];
  const transport=async(url,options)=>{
    const msg=JSON.parse(JSON.parse(options.body).body);calls.push(msg.destination);
    assert.equal(msg.projection.sheet.order.key,"o1");return ack(msg.destination);
  };
  const first=await drainFormalOutbox(env,3,transport);
  assert.deepEqual(first,{ok:true,examined:1,delivered:1,retry:0,conflict:0,dead:0});
  assert.deepEqual(calls,["sheets","notion"]);
  assert.equal(state.deliveries.get(key("event-1","sheets")).status,"delivered");
  assert.equal(state.deliveries.get(key("event-1","notion")).status,"delivered");
  assert.equal(state.events[0].status,"delivered");
  const again=await drainFormalOutbox(env,3,transport);
  assert.equal(again.examined,0);
  assert.equal(calls.length,2);
});
test("partial failure retries only the unfinished target without duplicating first target",async()=>{
  const {env,state,key}=harness(),calls=[];
  const first=await drainFormalOutbox(env,2,async(url,opt)=>{
    const msg=JSON.parse(JSON.parse(opt.body).body);calls.push(msg.destination);
    return msg.destination==="sheets"?ack("sheets"):new Response(JSON.stringify({ok:false}),{status:503});
  });
  assert.equal(first.delivered,0);assert.equal(first.retry,1);
  assert.equal(state.deliveries.get(key("event-1","sheets")).status,"delivered");
  const failing=state.deliveries.get(key("event-1","notion"));
  assert.equal(failing.status,"retry");
  failing.next_attempt_at=null;
  const second=await drainFormalOutbox(env,2,async(url,opt)=>{
    const msg=JSON.parse(JSON.parse(opt.body).body);calls.push(msg.destination);
    return ack(msg.destination);
  });
  assert.equal(second.delivered,1);
  assert.deepEqual(calls,["sheets","notion","notion"]);
  assert.equal(state.events[0].status,"delivered");
});
test("destination revision conflict is quarantined without silent overwrite",async()=>{
  const {env,state,key}=harness();
  const result=await drainFormalOutbox(env,2,async(url,opt)=>{
    const msg=JSON.parse(JSON.parse(opt.body).body);
    return msg.destination==="sheets" ? new Response(JSON.stringify({ok:false,conflict:true}),{status:409}) : ack("notion");
  });
  assert.equal(result.conflict,1);
  assert.equal(state.deliveries.get(key("event-1","sheets")).status,"conflict");
  assert.equal(state.events[0].status,"pending");
  assert.equal(state.conflicts.length,1);
});
test("mapping conflict blocks unsafe payment projection without contacting externals",async()=>{
  const {env,state}=harness();state.order.payment_status="paid";
  let hits=0;
  const result=await drainFormalOutbox(env,2,async()=>{hits++;return ack("sheets");});
  assert.equal(result.conflict,1);assert.equal(hits,0);
  assert.equal(state.events[0].status,"blocked");
  assert.equal(state.conflicts.length,1);
});
