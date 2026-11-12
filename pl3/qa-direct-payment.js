import worker from './worker-api-candidate.js';
import { executeOperation, installOperations, loadOperations } from './operations-store.js';

export async function runDirectPaymentQa(env, origin) {
 if (env.PL3_QA_ISOLATED !== 'true' || ['PL3_OPS_MAIL_ENABLED','PL3_OPS_SYNC_ENABLED','PL3_FORMAL_SYNC_ENABLED','PL3_PRODUCTION_CUTOVER'].some(key => env[key] !== 'false')) {
  throw Error('QA side effects must be disabled');
 }
 const db = {
  prepare: sql => env.DB.prepare(sql.replace(/\bpl_ops_/g, 'pl3_direct_qa_ops_')),
  batch: statements => env.DB.batch(statements)
 };
 const sessionSecret = crypto.randomUUID();
 const qa = {...env, DB:db, SESSION_SECRET:sessionSecret, PL3_QA_PAYMENT_ENABLED:'false'};
 const runId = crypto.randomUUID();
 const groupId = 'QA-DIRECT-'+runId;
 const email = runId+'@example.invalid';
 const deadline = new Date(Date.now()+3600000).toISOString();
 const fakeAccount = '00000000000000';
 await installOperations(qa);
 const execute = async (suffix, command) => executeOperation({
  key:'direct-qa:'+runId+':'+suffix, version:(await loadOperations(qa)).version, command
 }, 'owner:qa-direct-isolated', qa);
 await execute('accounts',{type:'payment_accounts_config',bank_transfer:fakeAccount,ctbc_cash:fakeAccount,confirmed:true});
 await execute('group',{type:'group_save',id:groupId,title:'QA 直接匯款',status:'open',deadline,payment_due_at:deadline,capacity_limit:15,direct_payment:true});
 const product = await execute('product',{type:'product_save',name:'QA 商品',sku:'QA-DIRECT',group_id:groupId,price_twd:765,shipping_units_confirmed:false,source_url:'https://example.invalid/',published:true,confirmed:true});
 const bytes = new TextEncoder();
 const base64url = value => btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const signingKey = await crypto.subtle.importKey('raw',bytes.encode(sessionSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 async function request(path, body, address=email, expected=200) {
  const claims = base64url(bytes.encode(JSON.stringify({email:address,exp:Math.floor(Date.now()/1000)+600})));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,bytes.encode(claims))));
  const response = await worker.fetch(new Request(new URL(path,origin),{
   method:body?'POST':'GET',
   headers:{Authorization:'Bearer '+claims+'.'+signature,'Content-Type':'application/json'},
   body:body?JSON.stringify(body):undefined
  }),qa);
  if (response.status!==expected) throw Error(path+' returned '+response.status);
  return response.json();
 }
 const checkout = {key:runId,group_id:groupId,name:'QA 客戶',items:[{product_id:product.result.product_id,quantity:15}],adult_confirmed:true,terms_confirmed:true};
 const placed = await request('/api/operations/checkout',checkout);
 const orderId = placed.result.order_id;
 if (!placed.result.direct_payment || !(await request('/api/operations/checkout',checkout)).replayed) throw Error('Checkout replay mismatch');
 await request('/api/operations/checkout',{...checkout,key:crypto.randomUUID()},email,409);
 const account = await request('/api/operations/my-orders');
 const bill = account.orders.find(order=>order.id===orderId)?.invoices.find(invoice=>invoice.phase==='first');
 if (bill?.outstanding_twd!==11475 || bill.due_at!==deadline || bill.payment_options?.[0]?.account!==fakeAccount) throw Error('Invoice or payment instructions mismatch');
 if ((await request('/api/operations/my-orders',null,'other-'+email)).orders.length) throw Error('Cross-account order exposure');
 const report = await request('/api/operations/payment-report',{key:'direct-qa-report-'+runId,command:{order_id:orderId,phase:'first',method:'銀行匯款',amount_twd:11475,last5:'00000'}});
 const {state}=await loadOperations(qa);
 if (report.result.status!=='pending' || state.reports.find(row=>row.order_id===orderId)?.status!=='pending' || state.receipts.length || state.notices.length) throw Error('Unexpected payment report side effects');
 await execute('cancel',{type:'order_cancel',order_id:orderId,confirmed:true,reason:'QA 測試結束'});
 const replacement=await request('/api/operations/checkout',{...checkout,key:crypto.randomUUID()});
 await execute('cleanup',{type:'order_cancel',order_id:replacement.result.order_id,confirmed:true,reason:'QA 驗證名額已釋出'});
 return {ok:true,environment:'QA_ONLY',run_id:runId,quantity:15,goods_twd:11475,checkout_replay:true,full_group_rejected:true,cancelled_capacity_released:true,payment_instructions:true,other_account_hidden:true,payment_report:'pending',receipts:0,notifications:0};
}
