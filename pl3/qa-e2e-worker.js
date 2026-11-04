import {qaTriggerAuthorized,syncQaLedger} from './qa-e2e-sync.js';
import {syncQaStarTrace} from './qa-star-trace-sync.js';
import productionWorker from './worker-api-candidate.js';
import {installOperations,loadOperations,executeOperation} from './operations-store.js';
import {balance} from './operations-domain.js';

const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
async function authenticated(request,env){
  if(env.PL3_QA_ISOLATED!=='true'||!env.PL3_QA_ADMIN_TOKEN)return false;
  const submitted=request.headers.get('x-pl3-qa-token')||'';
  if(!submitted||submitted.length!==env.PL3_QA_ADMIN_TOKEN.length)return false;
  const [a,b]=await Promise.all([submitted,env.PL3_QA_ADMIN_TOKEN].map(async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))));
  let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;
}
export async function run(env){
  if(env.PL3_OPS_MAIL_ENABLED!=='false'||env.PL3_OPS_SYNC_ENABLED!=='false'||env.PL3_PRODUCTION_CUTOVER!=='false')throw Error('QA side effects not disabled');
  await installOperations(env);
  const existing=await loadOperations(env);
  if(existing.state.orders.length||existing.state.receipts.length)throw Error('QA database is not empty; refuse repeat run');
  const testId='QA-E2E-20261104';
  let sequence=0;
  async function execute(command){
    const version=(await loadOperations(env)).version;
    const key='qa-e2e:'+String(++sequence).padStart(3,'0');
    const body={key,version,command};
    const first=await executeOperation(body,'owner:qa-isolated',env);
    const replay=await executeOperation(body,'owner:qa-isolated',env);
    if(!replay.replayed||replay.version!==first.version)throw Error('Idempotency failed for '+key);
    return first.result;
  }
  const group=(await execute({type:'group_save',id:testId+'-GROUP',title:'QA 假資料｜禁止採購與收款',status:'open',payment_due_at:'2099-11-05T12:00:00Z'})).group_id;
  const orderId=(await execute({type:'order_save',id:testId+'-ORDER',name:'QA 假客戶｜禁止通知',email:'pl3-qa-e2e@example.invalid',group_id:group,items:[{name:'QA 假商品',sku:'QA-ONLY',quantity:2,unit_price_twd:445,shipping_units:1}]})).order_id;
  await execute({type:'close_group',group_id:group});
  let state=(await loadOperations(env)).state;
  const first=state.invoices.find(x=>x.order_id===orderId&&x.phase==='first');
  if(!first||first.amount_twd!==890)throw Error('First invoice incorrect');
  await execute({type:'payment_report',order_id:orderId,authenticated_email:'pl3-qa-e2e@example.invalid',amount_twd:800,method:'銀行匯款'});
  state=(await loadOperations(env)).state;
  if(balance(state,state.invoices.find(x=>x.id===first.id))!==890)throw Error('Unverified report changed balance');
  await execute({type:'receipt_confirm',customer_email:'pl3-qa-e2e@example.invalid',amount_twd:800,kind:'bank_confirmed',transaction_id:'qa-e2e-fake-first',evidence:'QA synthetic evidence; no actual payment',confirmed:true,allocations:[{invoice_id:first.id,amount_twd:800}]});
  await execute({type:'carry_to_second',order_id:orderId,amount_twd:90,confirmed:true,evidence:'QA synthetic carry',included_in_second:false});
  await execute({type:'second_settle',order_id:orderId,costs:{international:100,domestic:38},confirmed:true,evidence:'QA synthetic shipping'});
  state=(await loadOperations(env)).state;
  const second=state.invoices.find(x=>x.order_id===orderId&&x.phase==='second');
  if(!second||second.amount_twd!==228)throw Error('Second invoice incorrect');
  await execute({type:'payment_report',order_id:orderId,authenticated_email:'pl3-qa-e2e@example.invalid',amount_twd:228,method:'銀行匯款'});
  await execute({type:'receipt_confirm',customer_email:'pl3-qa-e2e@example.invalid',amount_twd:228,kind:'bank_confirmed',transaction_id:'qa-e2e-fake-second',evidence:'QA synthetic evidence; no actual payment',confirmed:true,allocations:[{invoice_id:second.id,amount_twd:228}]});
  state=(await loadOperations(env)).state;
  const invoices=state.invoices.filter(x=>x.order_id===orderId),receipts=state.receipts.filter(x=>x.customer_email==='pl3-qa-e2e@example.invalid');
  const reports=state.reports.filter(x=>x.order_id===orderId),notices=state.notices.filter(x=>x.order_ids?.includes(orderId));
  if(invoices.length!==2||receipts.length!==2||reports.length!==2||invoices.some(x=>balance(state,x)!==0)||notices.some(x=>['queued','sending','sent'].includes(x.status)))throw Error('Final QA ledger mismatch '+JSON.stringify({invoices:invoices.map(x=>[x.phase,x.amount_twd,balance(state,x)]),receipts:receipts.length,reports:reports.length,notices:notices.map(x=>x.status)}));
  const queued=await env.DB.prepare('SELECT COUNT(*) AS n FROM pl_ops_mail').first();
  if(queued.n!==0)throw Error('Unapproved notice queued');
  return {ok:true,environment:'QA_ONLY',test_id:testId,group_id:group,order_id:orderId,commands:sequence,idempotency_replays:sequence,
    first_invoice:890,first_confirmed:800,first_carry:90,second_invoice:228,second_confirmed:228,
    reports:reports.length,receipts:receipts.length,invoices:invoices.length,notice_drafts:notices.length,notifications_sent:0,external_sync:'disabled'};
}
const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PL3 獨立 QA</title><main style="max-width:600px;margin:50px auto;font:16px/1.6 system-ui"><h1>PL3｜完全隔離帳務驗收</h1><p>僅使用虛構客戶和假付款；不寄信，不同步正式帳款。</p><input type="password" id="token" placeholder="QA 專用測試憑證" style="width:100%;padding:10px;box-sizing:border-box"><p><button id="run" style="padding:12px">執行一次測試</button></p><pre id="out" style="white-space:pre-wrap"></pre></main><script>document.getElementById('run').onclick=async()=>{const o=document.getElementById('out');o.textContent='測試中…';try{const r=await fetch('/qa/run',{method:'POST',headers:{'x-pl3-qa-token':document.getElementById('token').value}});o.textContent=JSON.stringify(await r.json(),null,2)}catch(e){o.textContent=String(e)}}</script></html>`;
export default {
 async fetch(request,env,ctx){
  const u=new URL(request.url);
  if(u.pathname==='/qa'&&request.method==='GET')return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",'x-frame-options':'DENY'}});
  if(u.pathname==='/qa/sync'){
   if(request.method!=='POST')return reply({ok:false,error:'Method not allowed'},405);
   const raw=await request.text();
   if(raw.length>2048||!await qaTriggerAuthorized(raw,env))return reply({ok:false,error:'QA signed authorization required'},403);
   try{return reply(await syncQaLedger(env))}catch{return reply({ok:false,error:'QA sync incomplete; production data untouched'},409)}
  }
  if(u.pathname==='/qa/star-trace/run'){
   if(request.method!=='POST')return reply({ok:false,error:'Method not allowed'},405);
   if(!await authenticated(request,env))return reply({ok:false,error:'QA authorization required'},403);
   try{return reply(await syncQaStarTrace(env))}catch(e){console.error('QA STAR TRACE sync failed',e);return reply({ok:false,error:String(e.message||e)},409)}
  }
  if(u.pathname==='/qa/run'){
   if(request.method!=='POST')return reply({ok:false,error:'Method not allowed'},405);
   if(!await authenticated(request,env))return reply({ok:false,error:'QA authorization required'},403);
   try{return reply(await run(env))}catch(e){console.error('QA E2E failed',e);return reply({ok:false,error:String(e.message||e)},409)}
  }
  return productionWorker.fetch(request,env,ctx);
 }
};
