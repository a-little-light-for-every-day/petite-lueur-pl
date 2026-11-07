import test from 'node:test';
import assert from 'node:assert/strict';
import{newOperations,applyOperation,balance,reportMatchesExistingReceipt}from'../operations-domain.js';

const NOW='2026-11-06T11:00:00.000Z';
const BANK_TIME='2026-11-06T11:23:00.000Z';
function fixture(){
 let s=newOperations(),n=0;
 const go=c=>{const r=applyOperation(s,c,{id:'reconcile-'+(++n),now:NOW});s=r.state;return r.result};
 const group_id=go({type:'group_save',title:'PLAVE 耳機測試',status:'open',payment_due_at:'2026-11-08T15:59:00.000Z'}).group_id;
 const a=go({type:'order_save',id:'EARPHONE-A',name:'顧客 A',email:'customer-a@example.com',group_id,items:[{name:'耳機',sku:'A',quantity:1,unit_price_twd:1775,shipping_units:1}]}).order_id;
 const b=go({type:'order_save',id:'EARPHONE-B',name:'顧客 B',email:'customer-b@example.com',group_id,items:[{name:'耳機',sku:'B',quantity:1,unit_price_twd:1775,shipping_units:1}]}).order_id;
 return{go,group_id,a,b,get state(){return s}};
}
function report(f,orderId,email,extra={}){return f.go({type:'payment_report',order_id:orderId,authenticated_email:email,amount_twd:1775,method:'台新銀行',phase:'first',paid_at:BANK_TIME,last5:'95328',...extra}).report_id}
function purchase(f,orderId){const o=f.state.orders.find(o=>o.id===orderId);f.go({type:'purchase_record',shop:'官方商店',official_order:'OFFICIAL-'+orderId,currency:'KRW',original_amount:60000,actual_twd:0,evidence:'已完成官方採購證明',advance_approved:true,advance_reason:'已核准代墊',items:[{order_id:orderId,item_id:o.items[0].id,quantity:1}]});}

test('new payment report records phase, time, last five and never settles a bank transfer by itself',()=>{
 const f=fixture(),id=report(f,f.a,'customer-a@example.com');
 const r=f.state.reports.find(r=>r.id===id);
 assert.equal(r.phase,'first');assert.equal(r.paid_at,BANK_TIME);assert.equal(r.last5,'95328');assert.equal(r.status,'pending');assert.equal(f.state.receipts.length,0);
 assert.throws(()=>report(f,f.a,'customer-a@example.com'),/相同回報/);
 assert.throws(()=>report(f,f.a,'customer-a@example.com',{paid_at:'2026-11-06T19:23'}),/日期與時間/);
});

test('two customers reporting the same amount do not authorize sharing one bank deposit',()=>{
 const f=fixture();f.go({type:'close_group',group_id:f.group_id});
 const reportA=report(f,f.a,'customer-a@example.com'),reportB=report(f,f.b,'customer-b@example.com',{last5:'12345'});
 const firstA=f.state.invoices.find(x=>x.order_id===f.a),firstB=f.state.invoices.find(x=>x.order_id===f.b);
 f.go({type:'receipt_confirm',customer_email:'customer-a@example.com',amount_twd:1775,kind:'bank_confirmed',transaction_id:'TAISHIN-20261106-1923-A',evidence:'台新銀行實際入帳明細',confirmed:true,report_id:reportA,allocations:[{invoice_id:firstA.id,amount_twd:1775}]});
 assert.equal(balance(f.state,firstA),0);assert.equal(balance(f.state,firstB),1775);assert.equal(f.state.reports.find(x=>x.id===reportB).status,'pending');
 assert.throws(()=>f.go({type:'receipt_confirm',customer_email:'customer-b@example.com',amount_twd:1775,kind:'bank_confirmed',transaction_id:'TAISHIN-20261106-1923-A',evidence:'重複款項',confirmed:true,report_id:reportB,allocations:[{invoice_id:firstB.id,amount_twd:1775}]}),/重複/);
 assert.throws(()=>f.go({type:'receipt_confirm',customer_email:'customer-b@example.com',amount_twd:1775,kind:'bank_confirmed',transaction_id:'DIFFERENT-REFERENCE',evidence:'客人錯誤歸屬',confirmed:true,report_id:reportA,allocations:[{invoice_id:firstB.id,amount_twd:1775}]}),/已核對|不符/);
});

test('payment phase and claimed amount must match the invoice and verified bank receipt',()=>{
 const f=fixture();f.go({type:'close_group',group_id:f.group_id});
 const bill=f.state.invoices.find(x=>x.order_id===f.a),reportId=report(f,f.a,'customer-a@example.com',{phase:'second'});
 const basic={type:'receipt_confirm',customer_email:'customer-a@example.com',amount_twd:1775,kind:'bank_confirmed',transaction_id:'BANK-X',evidence:'銀行明細已核實',confirmed:true,report_id:reportId,allocations:[{invoice_id:bill.id,amount_twd:1775}]};
 assert.throws(()=>f.go(basic),/付款階段不符/);
 assert.throws(()=>f.go({...basic,amount_twd:100}),/金額與入帳不符/);
 assert.equal(f.state.receipts.length,0);
});

test('purchased order can issue first invoice before group closes without emailing; purchase proof is mandatory',()=>{
 const f=fixture(),cmd={type:'first_invoice_issue',order_id:f.a,amount_twd:1775,evidence:'官方訂單已確認',confirmed:true,due_at:'2026-11-08T15:59:00.000Z'};
 assert.throws(()=>f.go(cmd),/所有品項已實際購得/);
 purchase(f,f.a);
 const created=f.go(cmd);
 assert.equal(created.amount_twd,1775);assert.equal(created.notice_created,false);
 assert.equal(f.state.invoices.length,1);assert.equal(f.state.notices.length,0);
 assert.equal(f.state.groups.find(g=>g.id===f.group_id).status,'open');
 assert.throws(()=>f.go(cmd),/已有一補帳款/);
});

test('a report with no finalized invoice remains pending and cannot be directly marked received',()=>{
 const f=fixture(),id=report(f,f.a,'customer-a@example.com');
 assert.throws(()=>f.go({type:'receipt_confirm',customer_email:'customer-a@example.com',amount_twd:1775,kind:'bank_confirmed',transaction_id:'NO-INVOICE',evidence:'銀行有收到',confirmed:true,report_id:id,allocations:[]}),/款項分配/);
 assert.equal(f.state.reports[0].status,'pending');assert.equal(f.state.receipts.length,0);
});

test('fully confirmed first payment creates one review-only acknowledgement after bank allocation',()=>{
 const f=fixture();f.go({type:'close_group',group_id:f.group_id});
 const first=f.state.invoices.find(b=>b.order_id===f.a);
 const reportId=report(f,f.a,'customer-a@example.com');
 f.go({type:'receipt_confirm',customer_email:'customer-a@example.com',amount_twd:1775,kind:'bank_confirmed',transaction_id:'REAL-BANK-001',evidence:'實際銀行入帳已核對',confirmed:true,report_id:reportId,allocations:[{invoice_id:first.id,amount_twd:1775}]});
 const confirmed=f.state.notices.filter(n=>n.kind==='first-payment-confirmed');
 assert.equal(confirmed.length,1);assert.equal(confirmed[0].status,'draft');
 assert.equal(confirmed[0].to,'customer-a@example.com');assert.match(confirmed[0].body,/第一階段已收款：NT\$1,775/);
 assert.doesNotMatch(confirmed[0].body,/REAL-BANK-001/);
 assert.equal(f.state.invoices.find(b=>b.id===first.id).notified,false);
 assert.throws(()=>f.go({type:'first_payment_confirmation_backfill',invoice_id:first.id,confirmed:true,evidence:'回補確認'}),/已有付款確認通知/);
 assert.equal(f.state.notices.filter(n=>n.kind==='first-payment-confirmed').length,1);
});

test('partial funds create no paid acknowledgement; owner can explicitly backfill historical paid invoice exactly once',()=>{
 const f=fixture();f.go({type:'close_group',group_id:f.group_id});
 const first=f.state.invoices.find(b=>b.order_id===f.a);
 f.go({type:'receipt_confirm',customer_email:'customer-a@example.com',amount_twd:100,kind:'bank_confirmed',transaction_id:'REAL-PARTIAL',evidence:'入帳100',confirmed:true,allocations:[{invoice_id:first.id,amount_twd:100}]});
 assert.equal(f.state.notices.filter(n=>n.kind==='first-payment-confirmed').length,0);
 f.go({type:'receipt_confirm',customer_email:'customer-a@example.com',amount_twd:1675,kind:'bank_confirmed',transaction_id:'REAL-REMAINING',evidence:'入帳1675',confirmed:true,allocations:[{invoice_id:first.id,amount_twd:1675}]});
 assert.equal(f.state.notices.filter(n=>n.kind==='first-payment-confirmed').length,1);
 const historical=structuredClone(f.state);historical.notices=historical.notices.filter(n=>n.kind!=='first-payment-confirmed');
 let s=historical;const cmd={type:'first_payment_confirmation_backfill',invoice_id:first.id,confirmed:true,evidence:'歷史已核實收款'};
 s=applyOperation(s,cmd,{id:'backfill-1',now:NOW}).state;
 assert.equal(s.notices.filter(n=>n.kind==='first-payment-confirmed').length,1);
 assert.throws(()=>applyOperation(s,cmd,{id:'backfill-2',now:NOW}),/已有付款確認通知/);
});

function sharedTransferFixture(){
 let s=newOperations(),seq=0;
 const go=command=>{const out=applyOperation(s,command,{id:'shared-'+(++seq),now:NOW});s=out.state;return out.result};
 const group_id=go({type:'group_save',title:'偶像學園 × しまむら',status:'open',payment_due_at:'2026-11-08T15:59:00.000Z'}).group_id;
 const parts=[['PL-261030-620754',145],['PL-261101-401172',550],['PL-261101-620605',195],['PL-261030-945416',415]];
 const email='mandychou0916@example.com';
 for(const [oid,amount]of parts)go({type:'order_save',id:oid,name:'同一付款人',email,group_id,items:[{name:'官方商品',sku:oid,quantity:1,unit_price_twd:amount,shipping_units:1}]});
 go({type:'close_group',group_id});
 const reports=parts.map(([oid])=>go({type:'payment_report',order_id:oid,authenticated_email:email,amount_twd:1300,phase:'first',paid_at:BANK_TIME,last5:'12498',method:'台新銀行'}).report_id);
 const allocations=parts.map(([oid,amount])=>({invoice_id:s.invoices.find(b=>b.order_id===oid&&b.phase==='first').id,amount_twd:oid==='PL-261030-945416'?410:amount}));
 const receipt_id=go({type:'receipt_confirm',customer_email:email,amount_twd:1300,kind:'bank_confirmed',transaction_id:'ONE-REAL-BANK-1300',evidence:'已核實唯一實際銀行入帳',confirmed:true,allocations}).receipt_id;
 return{get state(){return s},go,parts,reports,receipt_id,email};
}

test('one previously allocated NT$1300 receipt links four pending order reports without creating NT$5200 income',()=>{
 const f=sharedTransferFixture();
 const before=structuredClone(f.state);
 assert.equal(before.receipts.length,1);
 assert.equal(before.reports.filter(r=>r.status==='pending').length,4);
 assert.ok(f.reports.every(rid=>reportMatchesExistingReceipt(before,before.reports.find(r=>r.id===rid),before.receipts[0])));
 const result=f.go({type:'receipt_link_reports',receipt_id:f.receipt_id,expected_transaction_id:'ONE-REAL-BANK-1300',report_ids:f.reports,confirmed:true,evidence:'比對原銀行實收、四張客單及145／550／195／410分配'});
 assert.equal(result.linked_reports,4);
 assert.equal(result.receipts_created,0);assert.equal(result.allocations_created,0);assert.equal(result.notices_created,0);
 for(const name of ['receipts','allocations','invoices','notices','refunds'])assert.deepEqual(f.state[name],before[name],name+'不可被修改');
 assert.ok(f.state.reports.every(r=>r.status==='confirmed'&&r.receipt_id===f.receipt_id&&r.link_evidence));
 assert.equal(f.state.receipts.reduce((sum,r)=>sum+r.amount_twd,0),1300);
 assert.equal(f.state.allocations.reduce((sum,a)=>sum+a.amount_twd,0),1300);
 assert.equal(balance(f.state,f.state.invoices.find(b=>b.order_id==='PL-261030-945416')),5);
 assert.equal(f.state.history.at(-1).type,'receipt_link_reports');
 assert.throws(()=>f.go({type:'receipt_link_reports',receipt_id:f.receipt_id,expected_transaction_id:'ONE-REAL-BANK-1300',report_ids:f.reports,confirmed:true,evidence:'重複核對'}),/已完成核對/);
});

test('linking an existing receipt demands matching order allocation, original transaction ID and explicit evidence',()=>{
 const f=sharedTransferFixture();
 const base={type:'receipt_link_reports',receipt_id:f.receipt_id,expected_transaction_id:'ONE-REAL-BANK-1300',report_ids:f.reports,confirmed:true,evidence:'已比對銀行證明'};
 assert.throws(()=>f.go({...base,confirmed:false}),/核對原銀行交易/);
 assert.throws(()=>f.go({...base,evidence:''}),/填寫證據/);
 assert.throws(()=>f.go({...base,expected_transaction_id:'OTHER'}),/已變更/);
 assert.throws(()=>f.go({...base,report_ids:[f.reports[0],f.reports[0]]}),/不重複/);
 assert.throws(()=>f.go({...base,report_ids:['missing']}),/不符/);
 assert.throws(()=>f.go({...base,report_ids:[]}),/付款回報/);
 const altered=structuredClone(f.state);altered.allocations=altered.allocations.filter(a=>a.invoice_id!==altered.invoices.find(b=>b.order_id==='PL-261030-945416').id);
 assert.throws(()=>applyOperation(altered,{...base,report_ids:[f.reports[3]]},{id:'no-order-allocation',now:NOW}),/分配不符/);
 const wrongAmount=structuredClone(f.state);wrongAmount.reports[0].amount_twd=1305;
 assert.throws(()=>applyOperation(wrongAmount,{...base,report_ids:[f.reports[0]]},{id:'wrong-amount',now:NOW}),/分配不符/);
 const wrongEmail=structuredClone(f.state);wrongEmail.reports[0].customer_email='someone-else@example.com';
 assert.throws(()=>applyOperation(wrongEmail,{...base,report_ids:[f.reports[0]]},{id:'wrong-email',now:NOW}),/分配不符/);
 const wrongPhase=structuredClone(f.state);wrongPhase.reports[0].phase='second';
 assert.throws(()=>applyOperation(wrongPhase,{...base,report_ids:[f.reports[0]]},{id:'wrong-phase',now:NOW}),/分配不符/);
 assert.deepEqual(f.state.reports.map(r=>r.status),['pending','pending','pending','pending']);
});
