// Reconcile a previously completed PL2 payment without recording it as new PL3 cash.
// This intentionally does not create receipts, allocations, notices, or shipments.
const fail=message=>{throw Object.assign(new Error(message),{status:409});};
const requireTrue=(condition,message)=>{if(!condition)fail(message);};
const validAmount=value=>Number.isSafeInteger(value)&&value>=0;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const validProof=value=>typeof value==='string'&&value.trim().length>=20&&value.length<=2000;

export function settleLegacyPayment(s,c,{now,id}){
 requireTrue(c.confirmed===true,'歷史帳款必須由主購逐筆確認');
 requireTrue(typeof c.order_id==='string'&&typeof c.expected_source_url==='string','缺少原單識別資料');
 const o=s.orders.find(x=>x.id===c.order_id);
 requireTrue(o&&o.source_url===c.expected_source_url&&o.source_payment_status==='第二次付款已核對',
  '僅能處理原來源可核對且已記載二補已完成的歷史客單');
 requireTrue(o.goods_twd===c.expected_goods_twd&&o.goods_twd>0,'商品款與原訂單不一致');
 requireTrue(!o.legacy_payment_reconciliation,'這筆歷史帳款已補正，禁止重複入帳');
 const bills=s.invoices.filter(x=>x.order_id===o.id&&x.status!=='void');
 requireTrue(bills.length===2&&bills.some(x=>x.phase==='first')&&bills.some(x=>x.phase==='second'),
  '既有一補／二補帳款與預期不符，請先人工核對');
 const first=bills.find(x=>x.phase==='first'),second=bills.find(x=>x.phase==='second');
 requireTrue(first.id==='PL2:'+o.id+':first'&&second.id==='PL2:'+o.id+':second',
  '此流程只適用舊版 PL2 帳款，不可更動新訂單');
 requireTrue(first.finalized!==true&&second.finalized!==true&&first.notified===true&&second.notified===true,
  '此流程只補舊版已通知、尚未完成營運映射的帳款');
 requireTrue(first.amount_twd===o.goods_twd&&second.amount_twd===0,
  '原帳款金額已變動，禁止覆蓋');
 requireTrue(!s.allocations.some(x=>bills.some(b=>b.id===x.invoice_id)&&!x.reversed_at),
  '已存在實收分配，禁止重複補登歷史款項');
 requireTrue(!bills.some(b=>b.legacy_settlement),'已有歷史結算紀錄，禁止重複執行');
 requireTrue(c.first?.amount_twd===o.goods_twd&&validDate(c.first.paid_at)&&/^\d{5}$/.test(c.first.bank_last5||'')&&validProof(c.first.evidence),
  '一補須核對原商品款、入帳日期、銀行末五碼及依據');
 const secondAmount=c.second?.international_twd+c.second?.domestic_twd+(c.second?.other_twd||0);
 requireTrue(validAmount(c.second?.international_twd)&&validAmount(c.second?.domestic_twd)&&validAmount(c.second?.other_twd||0)&&secondAmount>0,
  '二補費用必須逐項核對');
 requireTrue(validAmount(c.second?.net_payout_twd)&&validAmount(c.second?.platform_deduction_twd)
  &&c.second.net_payout_twd>0&&c.second.net_payout_twd+c.second.platform_deduction_twd===secondAmount,
  '平台實撥及扣款差額必須與二補總額相符');
 requireTrue(validDate(c.second.paid_at)&&validProof(c.second.evidence)&&typeof c.second.tracking==='string'&&c.second.tracking.trim().length>=8,
  '二補須核對平台撥款日期、原物流單號及實際證據');
 requireTrue(c.second.deduction_detail_confirmed===false||c.second.deduction_detail_confirmed===true,
  '須區分平台扣款明細是否已獨立核實');

 first.finalized=true;
 first.channel='transfer';
 first.legacy_settlement={id:id+':first',recognized_twd:o.goods_twd,received_at:c.first.paid_at,
  bank_last5:c.first.bank_last5,evidence:c.first.evidence.trim(),recorded_at:now,source:'PL2',new_cash:false};
 second.finalized=true;
 second.amount_twd=secondAmount;
 second.channel='cod';
 second.costs=[{kind:'international',amount_twd:c.second.international_twd},
  {kind:'domestic',amount_twd:c.second.domestic_twd},
  ...(c.second.other_twd?[{kind:'packaging',amount_twd:c.second.other_twd}]:[])];
 second.legacy_settlement={id:id+':second',recognized_twd:secondAmount,received_at:c.second.paid_at,
  net_payout_twd:c.second.net_payout_twd,platform_deduction_twd:c.second.platform_deduction_twd,
  deduction_detail_confirmed:c.second.deduction_detail_confirmed,tracking:c.second.tracking.trim(),
  evidence:c.second.evidence.trim(),recorded_at:now,source:'PL2',new_cash:false};
 o.legacy_payment_reconciliation={at:now,first_invoice_id:first.id,second_invoice_id:second.id,
  no_new_cash:true,no_payment_notice:true,second_platform_detail_pending:!c.second.deduction_detail_confirmed};
 o.source_issues=(o.source_issues||[]).filter(x=>!['RECEIPT_NOT_VERIFIED','SECOND_RECEIPT_ALLOCATION_REQUIRED'].includes(x));
 return{order_id:o.id,first_paid_twd:o.goods_twd,second_gross_twd:secondAmount,
  second_platform_net_twd:c.second.net_payout_twd,second_platform_deduction_twd:c.second.platform_deduction_twd,
  receipts_created:0,allocations_created:0,notices_created:0};
}
