import {STAR_TRACE_GROUP,eligibility,officialGiftCount,createSlots,allocateCards,adjustAllocation,updatePacking} from './plave-star-trace.js';

const schema=`CREATE TABLE IF NOT EXISTS pl_star_trace_state (
  group_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0,
  document_json TEXT NOT NULL CHECK(json_valid(document_json)),updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pl_star_trace_events (
  event_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,request_hash TEXT NOT NULL,
  actor TEXT NOT NULL,operation TEXT NOT NULL,before_version INTEGER NOT NULL,
  after_version INTEGER NOT NULL,details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
const initial=()=>({group_id:STAR_TRACE_GROUP,customers:[],official_orders:[],cards:[],draw_order:[],draw_evidence:'',allocation:null,notes:[]});
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const err=(s,code=400)=>Object.assign(new Error(s),{status:code});
export async function installStarTrace(env){
  for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(sql).run();
  await env.DB.prepare('INSERT OR IGNORE INTO pl_star_trace_state(group_id,document_json) VALUES(?,?)').bind(STAR_TRACE_GROUP,JSON.stringify(initial())).run();
  return {ok:true};
}
export async function readStarTrace(env){
  const row=await env.DB.prepare('SELECT version,document_json FROM pl_star_trace_state WHERE group_id=?').bind(STAR_TRACE_GROUP).first();
  if(!row)throw err('請先初始化 STAR TRACE 資料表',503);
  const document=JSON.parse(row.document_json);
  return {ok:true,version:row.version,document,computed:{
    customers:document.customers.map(c=>({customer_order_id:c.customer_order_id,...eligibility(c.lines)})),
    official_orders:officialGiftCount(document.official_orders)
  }};
}
export async function readStarTraceAudit(env){
 const rows=(await env.DB.prepare('SELECT event_id,group_id,actor,operation,before_version,after_version,details_json,created_at FROM pl_star_trace_events WHERE group_id=? ORDER BY after_version ASC').bind(STAR_TRACE_GROUP).all()).results||[];
 return rows.map(({details_json,...r})=>({...r,details:JSON.parse(details_json)}));
}
// Owner-only API. Every command is an optimistic, audited D1 transaction.
export async function commandStarTrace(env,actor,input){
  if(!input||typeof input!=='object'||!/^[\w:-]{12,160}$/.test(input.key||''))throw err('缺少唯一操作識別碼');
  if(!Number.isSafeInteger(input.version)||input.version<0)throw err('資料版本無效');
  const requestHash=await sha(JSON.stringify({version:input.version,action:input.action,payload:input.payload}));
  const prior=await env.DB.prepare('SELECT request_hash,after_version FROM pl_star_trace_events WHERE event_id=?').bind(input.key).first();
  if(prior){if(prior.request_hash!==requestHash)throw err('操作識別碼已使用於不同資料',409);return {...await readStarTrace(env),replayed:true};}
  const old=await readStarTrace(env);
  if(old.version!==input.version)throw err('資料已變動，請重新整理',409);
  const next=structuredClone(old.document),p=input.payload||{};
  switch(input.action){
    case 'save_customers':{
      if(next.allocation)throw err('已抽籤，不可直接改寫資格');
      if(!Array.isArray(p.customers)||p.customers.length>500)throw err('客單資料不完整');
      createSlots(p.customers);next.customers=p.customers;break;
    }
    case 'save_official_orders':{
      if(next.allocation)throw err('已抽籤，不可直接改寫官方單');
      if(!Array.isArray(p.official_orders)||p.official_orders.length>200)throw err('官方單資料不完整');
      officialGiftCount(p.official_orders);next.official_orders=p.official_orders;break;
    }
    case 'record_received_cards':{
      if(next.allocation)throw err('已抽籤，不可直接覆寫卡池');
      if(!Array.isArray(p.cards)||p.cards.length>1000)throw err('實寄卡片資料不完整');
      const slots=createSlots(next.customers);
      allocateCards({slots,draw_order:slots.map(x=>x.id),cards:p.cards,draw_evidence:'validation-only'});
      next.cards=p.cards;break;
    }
    case 'perform_recorded_draw':{
      if(next.allocation)throw err('已抽籤，禁止重抽');
      const slots=createSlots(next.customers);
      next.allocation=allocateCards({slots,draw_order:p.draw_order,cards:next.cards,draw_evidence:p.draw_evidence});
      next.draw_order=p.draw_order;next.draw_evidence=p.draw_evidence;break;
    }
    case 'adjust_card':next.allocation=adjustAllocation(next.allocation,p.change,{actor,evidence:p.evidence,at:new Date().toISOString()});break;
    case 'packing':next.allocation=updatePacking(next.allocation,p.slot_id,p.status,{actor,evidence:p.evidence,at:new Date().toISOString()});break;
    default:throw err('未知特典操作');
  }
  // An audited state change and its event ID are committed together.
  const result=await env.DB.batch([
    env.DB.prepare('UPDATE pl_star_trace_state SET version=version+1,document_json=?,updated_at=CURRENT_TIMESTAMP WHERE group_id=? AND version=?').bind(JSON.stringify(next),STAR_TRACE_GROUP,old.version),
    env.DB.prepare('INSERT INTO pl_star_trace_events(event_id,group_id,request_hash,actor,operation,before_version,after_version,details_json) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pl_star_trace_state WHERE group_id=? AND version=?)').bind(input.key,STAR_TRACE_GROUP,requestHash,actor,input.action,old.version,old.version+1,JSON.stringify(p),STAR_TRACE_GROUP,old.version+1)
  ]);
  if(!result[0]?.meta?.changes||!result[1]?.meta?.changes)throw err('寫入衝突，請重新整理',409);
  return readStarTrace(env);
}
