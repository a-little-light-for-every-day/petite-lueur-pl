import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePaymentLedger, paymentNoticeTotal} from '../payment-ledger.js';
import {mapLegacyPayments} from '../legacy-payment-mapper.js';
const bill={id:'a:first',order_id:'a',phase:'first',channel:'transfer',amount_twd:890};
const receipt={id:'r',order_id:'a',amount_twd:800,status:'bank_confirmed',evidence:'receipt-confirmation'};
const allocation={id:'alloc',receipt_id:'r',invoice_id:'a:first',amount_twd:800};
test('partial first payment retains 90 outstanding; reported payment cannot settle',()=>{
 const x=calculatePaymentLedger({invoices:[bill],receipts:[receipt],allocations:[allocation]});
 assert.equal(x.invoices[0].outstanding_twd,90); assert.equal(x.invoices[0].status,'partial');
 assert.throws(()=>calculatePaymentLedger({invoices:[bill],receipts:[{...receipt,status:'reported'}],allocations:[allocation]}),/UNVERIFIED/);
});
test('overpayment is unallocated credit; it is never automatically spent on second phase',()=>{
 const x=calculatePaymentLedger({invoices:[{...bill,amount_twd:1540},{...bill,id:'a:second',phase:'second',amount_twd:null}],receipts:[{...receipt,amount_twd:1600}],allocations:[{...allocation,amount_twd:1540}]});
 assert.equal(x.receipts[0].unallocated_twd,60); assert.equal(x.invoices[1].status,'amount_unknown');
});
test('COD remains outstanding until platform settlement, even with bank or customer report',()=>{
 const invoices=[{...bill,channel:'cod'}];
 assert.equal(calculatePaymentLedger({invoices}).invoices[0].status,'awaiting_cod_settlement');
 assert.throws(()=>calculatePaymentLedger({invoices,receipts:[receipt],allocations:[allocation]}),/COD_SETTLEMENT/);
 assert.equal(calculatePaymentLedger({invoices,receipts:[{...receipt,status:'cod_settled'}],allocations:[allocation]}).invoices[0].status,'partial');
});
test('receipt allocation cannot be duplicated, exceed funds, or move across customers silently',()=>{
 assert.throws(()=>calculatePaymentLedger({invoices:[bill],receipts:[receipt],allocations:[allocation,allocation]}),/DUPLICATE/);
 assert.throws(()=>calculatePaymentLedger({invoices:[bill],receipts:[receipt],allocations:[{...allocation,amount_twd:801}]}),/OVER_ALLOCATION/);
 assert.throws(()=>calculatePaymentLedger({invoices:[bill],receipts:[{...receipt,order_id:'b'}],allocations:[allocation]}),/CROSS_ORDER/);
});
test('consolidated notice references existing bills without duplicating prior notices',()=>{
 const invoices=[415,145,550,195].map((amount_twd,i)=>({...bill,id:String(i),order_id:'order-'+i,amount_twd}));
 assert.equal(paymentNoticeTotal(['0','1','2','3'],invoices),1305);
 assert.throws(()=>paymentNoticeTotal(['0','0'],invoices),/DUPLICATE/);
});
const url='https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const row={source_id:'legacy',source_url:url,source_revision:'2026-11-03T13:40:00Z',goods_twd:890,received_twd:800,second_twd:128,order_status:'已向日本商店下單',payment_status:'付款資料已提交'};
const items=[{source_id:'line1',order_source_url:url,quantity:1,unit_price_twd:890}];
test('carry included in second 128 is not added twice; source values remain intact',()=>{
 const r=mapLegacyPayments([row],items,{evidenceByOrder:{legacy:{receipt:{status:'bank_confirmed',amount_twd:800,evidence:'receipt'},carry:{amount_twd:90,included_in_second:true,evidence:'carry-confirmation'}}}}).orders[0];
 assert.deepEqual(r.ledger.invoices.map(x=>[x.amount_twd,x.outstanding_twd]),[[800,0],[128,128]]);
 assert.equal(r.source_amounts.goods_twd,890); assert.equal(r.safe_to_import,false);
});
test('blank second is unknown; zero is explicit zero, and second verified does not reuse first receipt',()=>{
 const r=mapLegacyPayments([{...row,second_twd:'',payment_status:'第二次付款已核對'}],items).orders[0];
 assert.equal(r.ledger.invoices[1].amount_twd,null); assert.ok(r.issues.includes('SECOND_RECEIPT_ALLOCATION_REQUIRED'));
 assert.equal(r.ledger.receipts[0].status,'reported');
});
test('same amount, email or shipping method never joins orders; cancelled stays excluded',()=>{
 const rows=[{...row,order_status:'取消',payment_status:'尚未通知付款',delivery:'賣貨便38'}];
 const r=mapLegacyPayments(rows,items).orders[0];
 assert.equal(r.disposition,'excluded'); assert.equal(r.ledger.invoices[0].channel,'unknown');
 assert.throws(()=>mapLegacyPayments([row,row],items),/DUPLICATE/);
});
test('missing verified amount, missing item relation and purchase hold are quarantined',()=>{
 const r=mapLegacyPayments([{...row,received_twd:'',payment_status:'第一階段已核對'}],[],{evidenceByOrder:{legacy:{purchase_hold:{until:'2026-11-04',reason:'credit limit'}}}}).orders[0];
 assert.ok(r.issues.includes('VERIFIED_AMOUNT_MISSING')); assert.ok(r.issues.includes('ITEM_RELATION_MISSING')); assert.equal(r.purchase_hold.until,'2026-11-04');
});

test('a phase or the same confirmed receipt evidence cannot create duplicate charges or funds',()=>{
 assert.throws(()=>calculatePaymentLedger({invoices:[bill,{...bill,id:'another'}]}),/DUPLICATE_ORDER_PHASE/);
 assert.throws(()=>calculatePaymentLedger({receipts:[receipt,{...receipt,id:'r2'}]}),/DUPLICATE_RECEIPT_EVIDENCE/);
});
