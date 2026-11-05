import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOperation,balance,newOperations,operationalTasks} from '../operations-domain.js';

// All identifying values in this fixture are synthetic. Never commit customer PII.
const oid='PL-260928-123456';
const source='https://app.notion.com/p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const firstId='PL2:'+oid+':first',secondId='PL2:'+oid+':second';
const state=()=>({...newOperations(),orders:[{
 id:oid,source_url:source,source_status:'台灣已寄出',source_payment_status:'第二次付款已核對',
 source_issues:['SECOND_RECEIPT_ALLOCATION_REQUIRED','RECEIPT_NOT_VERIFIED','KEEP_OTHER'],
 goods_twd:900,group_id:'g',email:'existing@example.com',name:'既有顧客',status:'active',items:[],
}],invoices:[
 {id:firstId,order_id:oid,phase:'first',amount_twd:900,channel:'transfer',finalized:false,notified:true,source_status:'第二次付款已核對',status:'open'},
 {id:secondId,order_id:oid,phase:'second',amount_twd:0,channel:'transfer',finalized:false,notified:true,source_status:'第二次付款已核對',status:'open'},
],notices:[{id:'historical-shipping',order_ids:[oid],kind:'shipping',status:'sent'}]});
const command=()=>({type:'legacy_payment_reconcile_single',confirmed:true,order_id:oid,
 expected_source_url:source,expected_goods_twd:900,
 first:{amount_twd:900,paid_at:'2026-09-28',bank_last5:'12345',evidence:'範例Notion訂單第一階段於9月28日確認入帳，保留原款不重列。'},
 second:{international_twd:110,domestic_twd:38,other_twd:0,net_payout_twd:110,
  platform_deduction_twd:38,paid_at:'2026-10-30',tracking:'TEST-TRACK-1234',
  deduction_detail_confirmed:false,evidence:'主購確認10月30日賣貨便淨撥110元已入帳；實收差額38元之名目待平台明細核對。'}});
const apply=(s,c=command())=>applyOperation(s,c,{id:'legacy-pay',now:'2026-11-06T00:00:00.000Z'});

test('historical first 900 and second 148 settle without creating new cash, notifications or duplicating income',()=>{
 const before=state();
 assert.equal(balance(before,before.invoices[0]),null);
 const {state:s,result}=apply(before);
 assert.deepEqual(s.receipts,[]);
 assert.deepEqual(s.allocations,[]);
 assert.deepEqual(s.notices,before.notices);
 assert.equal(s.orders[0].name,before.orders[0].name);
 assert.equal(s.orders[0].email,before.orders[0].email);
 assert.equal(s.invoices[0].amount_twd,900);
 assert.equal(s.invoices[1].amount_twd,148);
 assert.equal(s.invoices[1].legacy_settlement.net_payout_twd,110);
 assert.equal(s.invoices[1].legacy_settlement.platform_deduction_twd,38);
 assert.equal(s.invoices[1].legacy_settlement.deduction_detail_confirmed,false);
 assert.equal(s.invoices[0].legacy_settlement.new_cash,false);
 assert.deepEqual(s.invoices.map(b=>balance(s,b)),[0,0]);
 assert.equal(operationalTasks(s).filter(t=>t.type==='invoice').length,0);
 assert.deepEqual(s.orders[0].source_issues,['KEEP_OTHER']);
 assert.deepEqual([result.receipts_created,result.allocations_created,result.notices_created],[0,0,0]);
 assert.throws(()=>apply(s),/已補正/);
 assert.equal(before.invoices[0].finalized,false);
});

test('mismatched source, existing funds, invoice changes and payout discrepancies fail closed',()=>{
 const base=state(),c=command();
 assert.throws(()=>apply(base,{...c,expected_source_url:'wrong'}),/原來源/);
 assert.throws(()=>apply(base,{...c,expected_goods_twd:899}),/商品款/);
 assert.throws(()=>apply(base,{...c,second:{...c.second,net_payout_twd:111}}),/相符/);
 assert.throws(()=>apply(base,{...c,second:{...c.second,deduction_detail_confirmed:undefined}}),/區分/);
 assert.throws(()=>apply(base,{...c,first:{...c.first,bank_last5:'1234'}}),/末五碼/);
 assert.throws(()=>apply({...base,allocations:[{receipt_id:'existing',invoice_id:firstId,amount_twd:100}]},c),/已存在實收分配/);
 assert.throws(()=>apply({...base,invoices:[{...base.invoices[0],finalized:true},base.invoices[1]]},c),/尚未完成/);
 assert.throws(()=>apply({...base,invoices:[{...base.invoices[0],id:'PL3:first'},base.invoices[1]]},c),/只適用舊版/);
});
