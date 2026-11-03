import { calculatePaymentLedger } from './payment-ledger.js';
// A sanitized, provenance-preserving review projection. Never an operational import.
const pageId = value => String(value||'').replace(/-/g,'').match(/[a-f0-9]{32}/i)?.[0]?.toLowerCase() || null;
const amount = value => value === '' || value === null || value === undefined ? null :
  Number.isSafeInteger(Number(value)) && Number(value)>=0 ? Number(value) : null;
export function mapLegacyPayments(rows, items, { evidenceByOrder = {} } = {}) {
  const identities=new Set(), pages=new Set();
  for(const row of rows) {
    if(!row.source_id || identities.has(row.source_id)) throw new Error('DUPLICATE_OR_MISSING_SOURCE_ID');
    identities.add(row.source_id);
    const page=pageId(row.source_url);
    if(page && pages.has(page)) throw new Error('DUPLICATE_SOURCE_PAGE');
    if(page) pages.add(page);
  }
  const receiptEvidence=new Set();
  const mapped=rows.map(row=>{
    const issues=[], proof=evidenceByOrder[row.source_id]||{};
    if(!row.source_revision) issues.push('SOURCE_REVISION_MISSING');
    const ownPage=pageId(row.source_url);
    const lines=ownPage ? items.filter(x=>pageId(x.order_source_url)===ownPage).map(x=>({source_id:x.source_id,order_source_url:x.order_source_url,sku:x.sku,quantity:x.quantity,unit_price_twd:x.unit_price_twd,variant:x.variant||'',fulfillment:x.fulfillment||'',official_batch:x.official_batch||''})) : [];
    if(!ownPage) issues.push('SOURCE_PAGE_MISSING');
    if(!lines.length) issues.push('ITEM_RELATION_MISSING');
    const first=amount(row.goods_twd), second=amount(row.second_twd), received=amount(row.received_twd);
    if(first===null) issues.push('FIRST_AMOUNT_UNKNOWN');
    if(second===null) issues.push('SECOND_AMOUNT_UNKNOWN');
    const lineTotal=lines.reduce((sum,x)=>sum+(amount(x.quantity)||0)*(amount(x.unit_price_twd)||0),0);
    if(lines.some(x=>!Number.isSafeInteger(x.quantity)||x.quantity<1)) issues.push('INVALID_LINE');
    const pricesUnknown=lines.some(x=>amount(x.unit_price_twd)===null);
    if(pricesUnknown) issues.push('HISTORICAL_PRICE_UNKNOWN');
    if(!pricesUnknown && first!==null && lineTotal!==first) issues.push('ITEM_AMOUNT_MISMATCH');
    const excluded=/取消|撤單|撤回|售罄|官方缺貨|官方砍單/.test(row.order_status||'');
    const verifiedFirst=row.payment_status==='第一階段已核對';
    const verifiedSecond=row.payment_status==='第二次付款已核對';
    // An official receipt confirmation may supersede a stale "report submitted" cell.
    const receiptProof=proof.receipt;
    const confirmed=receiptProof?.status==='bank_confirmed' && receiptProof.evidence ? amount(receiptProof.amount_twd) : verifiedFirst ? received : null;
    if(verifiedFirst && received===null && !receiptProof) issues.push('VERIFIED_AMOUNT_MISSING');
    if(verifiedSecond) issues.push('SECOND_RECEIPT_ALLOCATION_REQUIRED');
    const channel=proof.cod?.evidence ? 'cod' : 'unknown';
    const carry=proof.carry;
    let effectiveFirst=first, effectiveSecond=second;
    if(carry) {
      if(!carry.evidence || amount(carry.amount_twd)===null || first===null || carry.amount_twd>first) issues.push('CARRY_INVALID');
      else if(carry.included_in_second!==true && carry.included_in_second!==false) issues.push('CARRY_INCLUSION_UNKNOWN');
      else {
        effectiveFirst=first-carry.amount_twd;
        effectiveSecond=second===null ? null : second+(carry.included_in_second?0:carry.amount_twd);
        if(second!==null && carry.included_in_second && second<carry.amount_twd) issues.push('CARRY_EXCEEDS_SECOND');
      }
    }
    const prefix=`PL2:${row.source_id}`;
    const invoices=[{id:prefix+':first',order_id:row.source_id,phase:'first',channel,amount_twd:effectiveFirst},
      {id:prefix+':second',order_id:row.source_id,phase:'second',channel:'unknown',amount_twd:effectiveSecond}];
    const receipts=[], allocations=[];
    if(confirmed!==null && confirmed>0) {
      receipts.push({id:prefix+':receipt:first',order_id:row.source_id,amount_twd:confirmed,status:'bank_confirmed',
        evidence:receiptProof?.evidence || `${row.source_url}#revision=${row.source_revision}`});
      if(channel==='cod') issues.push('COD_AND_BANK_CONFIRMATION_CONFLICT');
      else if(effectiveFirst!==null && effectiveFirst>0) allocations.push({id:prefix+':allocation:first',receipt_id:receipts[0].id,invoice_id:invoices[0].id,amount_twd:Math.min(confirmed,effectiveFirst)});
    } else if(received!==null && received>0) {
      receipts.push({id:prefix+':reported',order_id:row.source_id,amount_twd:received,status:'reported',evidence:row.source_url||'source-row'});
      issues.push('RECEIPT_NOT_VERIFIED');
    }
    for(const receipt of receipts.filter(x=>x.status!=='reported')) {
      if(receiptEvidence.has(receipt.evidence)) throw new Error('DUPLICATE_RECEIPT_EVIDENCE');
      receiptEvidence.add(receipt.evidence);
    }
    const ledger=calculatePaymentLedger({invoices,receipts,allocations});
    if(ledger.receipts.some(x=>x.unallocated_twd>0)) issues.push('UNALLOCATED_CREDIT_REQUIRES_REVIEW');
    if(proof.purchase_hold) issues.push('PURCHASE_HOLD');
    return {source_system:'PL2',source_id:row.source_id,source_url:row.source_url,source_revision:row.source_revision,
      raw_order_status:row.order_status,raw_payment_status:row.payment_status,
      source_amounts:{goods_twd:first,received_twd:received,second_twd:second},
      raw_item_text:row.raw_item_text||'',raw_structured_items:row.raw_structured_items||null,lines,ledger,carry:carry||null,purchase_hold:proof.purchase_hold||null,
      disposition:excluded?'excluded':issues.length?'review':'ready_for_review',issues,
      safe_to_import:false};
  });
  const linked=new Set(mapped.flatMap(x=>x.lines.map(l=>l.source_id)));
  return {mode:'read_only_review',safe_to_import:false,orders:mapped,
    orphan_item_ids:items.filter(x=>!linked.has(x.source_id)).map(x=>x.source_id),
    counts:{orders:mapped.length,excluded:mapped.filter(x=>x.disposition==='excluded').length,
      review:mapped.filter(x=>x.disposition==='review').length,ready_for_review:mapped.filter(x=>x.disposition==='ready_for_review').length}};
}
