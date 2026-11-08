import {paymentInstructionsFor} from './payment-instructions.js';

const TABLE=`CREATE TABLE IF NOT EXISTS pl3_qa_payment_bill(
 id TEXT PRIMARY KEY,stage TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`;
const RUN='PL3-QA-PAYMENT-DISPLAY';
const TEST_AMOUNT=321;
const allowed=new Set(['not_notified','notified','settled','cancelled','overdue']);
const emailOf=value=>String(value||'').trim().toLowerCase();
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};

function enabled(env){
 if(env.PL3_QA_PAYMENT_ENABLED!=='true'||!emailOf(env.PL3_QA_PAYMENT_EMAIL))fail('隔離付款驗收未啟用',503);
}
export async function qaPaymentBillSet(env,stage='not_notified',now=new Date().toISOString()){
 enabled(env);if(!allowed.has(stage))fail('測試帳款狀態無效');
 await env.DB.prepare(TABLE).run();
 const id=RUN;
 await env.DB.prepare(`INSERT INTO pl3_qa_payment_bill(id,stage,created_at,updated_at) VALUES(?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET stage=excluded.stage,updated_at=excluded.updated_at`).bind(id,stage,now,now).run();
 return {ok:true,id,stage};
}
export async function qaPaymentBillStatus(env){
 enabled(env);await env.DB.prepare(TABLE).run();
 const row=await env.DB.prepare('SELECT id,stage,created_at,updated_at FROM pl3_qa_payment_bill WHERE id=?').bind(RUN).first();
 return {ok:true,bill:row||null};
}
export async function qaPaymentBillForCustomer(env,state,customer,now=Date.now()){
 if(env.PL3_QA_PAYMENT_ENABLED!=='true'||emailOf(customer)!==emailOf(env.PL3_QA_PAYMENT_EMAIL))return null;
 await env.DB.prepare(TABLE).run();
 const row=await env.DB.prepare('SELECT id,stage FROM pl3_qa_payment_bill WHERE id=?').bind(RUN).first();
 if(!row)return null;
 const stage=row.stage, cancelled=stage==='cancelled';
 const order={id:RUN,email:emailOf(customer),name:'隔離驗收測試客人',status:cancelled?'cancelled':'accepted',items:[],raw_item_text:'PL3 付款畫面隔離驗收'};
 const dueAt=stage==='overdue'?'2000-01-01T00:00:00.000Z':'2099-01-01T00:00:00.000Z';
 const bill={id:'first:'+RUN,order_id:RUN,phase:'first',amount_twd:TEST_AMOUNT,channel:'transfer',finalized:stage!=='not_notified',notified:stage!=='not_notified',status:cancelled?'void':'open',due_at:dueAt,costs:[],carry_twd:0};
 const isolatedState={...state,allocations:stage==='settled'?[...(state.allocations||[]),{invoice_id:bill.id,amount_twd:TEST_AMOUNT}]:state.allocations||[]};
 return {id:order.id,status:order.status,live_status:stage,source_status:'隔離測試',raw_item_text:order.raw_item_text,application:null,benefit_preference:null,items:[],invoices:[{id:bill.id,phase:'first',amount_twd:bill.amount_twd,outstanding_twd:stage==='settled'?0:TEST_AMOUNT,finalized:bill.finalized,channel:bill.channel,due_at:bill.due_at,costs:[],carry_twd:0,payment_options:paymentInstructionsFor(isolatedState,order,bill,now)}],shipments:[],reports:[]};
}
