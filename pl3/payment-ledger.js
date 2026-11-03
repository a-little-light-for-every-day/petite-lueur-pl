// Pure accounting: no network, database writes, automatic allocations, or customer identity matching.
const money = (n, label) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`INVALID_MONEY:${label}`);
  return n;
};
const unique = (rows, label) => {
  const ids = new Set();
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error(`DUPLICATE_OR_MISSING_ID:${label}`);
    ids.add(row.id);
  }
};
export function calculatePaymentLedger({ invoices = [], receipts = [], allocations = [] }) {
  unique(invoices, 'invoice'); unique(receipts, 'receipt'); unique(allocations, 'allocation');
  const phases=new Set(), confirmedEvidence=new Set();
  const bills = new Map(invoices.map(x => {
    const phaseKey=JSON.stringify([x.order_id,x.phase]);
    if(phases.has(phaseKey)) throw new Error('DUPLICATE_ORDER_PHASE');
    phases.add(phaseKey);
    if (!x.order_id || !['first','second'].includes(x.phase) || !['transfer','cod','unknown'].includes(x.channel))
      throw new Error('INVALID_INVOICE');
    if (x.amount_twd !== null) money(x.amount_twd, 'invoice');
    return [x.id, {...x, allocated_twd:0}];
  }));
  const funds = new Map(receipts.map(x => {
    money(x.amount_twd, 'receipt');
    if (!x.evidence || !['bank_confirmed','cod_settled','reported'].includes(x.status)) throw new Error('INVALID_RECEIPT');
    if(x.status!=='reported'){
      if(confirmedEvidence.has(x.evidence)) throw new Error('DUPLICATE_RECEIPT_EVIDENCE');
      confirmedEvidence.add(x.evidence);
    }
    return [x.id, {...x, allocated_twd:0}];
  }));
  for (const x of allocations) {
    const bill=bills.get(x.invoice_id), receipt=funds.get(x.receipt_id);
    money(x.amount_twd, 'allocation');
    if (!x.amount_twd || !bill || !receipt || receipt.status === 'reported') throw new Error('UNVERIFIED_ALLOCATION');
    if (bill.amount_twd === null) throw new Error('UNKNOWN_INVOICE_AMOUNT');
    // Cross-order / cross-phase use requires an explicit reviewed authorization, never name/email matching.
    if (receipt.order_id !== bill.order_id && !x.authorization_evidence) throw new Error('CROSS_ORDER_AUTHORIZATION_REQUIRED');
    if (bill.channel === 'cod' && receipt.status !== 'cod_settled') throw new Error('COD_SETTLEMENT_REQUIRED');
    bill.allocated_twd += x.amount_twd; receipt.allocated_twd += x.amount_twd;
    if (bill.allocated_twd > bill.amount_twd || receipt.allocated_twd > receipt.amount_twd) throw new Error('OVER_ALLOCATION');
  }
  return {
    invoices:[...bills.values()].map(x => ({...x, outstanding_twd:x.amount_twd === null ? null : x.amount_twd-x.allocated_twd,
      status:x.amount_twd === null ? 'amount_unknown' : x.allocated_twd === x.amount_twd ? 'settled' :
        x.allocated_twd ? 'partial' : x.channel === 'cod' ? 'awaiting_cod_settlement' : 'unpaid'})),
    receipts:[...funds.values()].map(x => ({...x, unallocated_twd:x.status === 'reported' ? 0 : x.amount_twd-x.allocated_twd,
      usable:x.status !== 'reported'}))
  };
}
// A payment notice can contain multiple orders without changing their identities or creating another invoice.
export function paymentNoticeTotal(invoiceIds, invoices) {
  if (new Set(invoiceIds).size !== invoiceIds.length) throw new Error('DUPLICATE_NOTICE_MEMBER');
  const found=invoiceIds.map(id=>invoices.find(x=>x.id===id));
  if(found.some(x=>!x||x.amount_twd===null)) throw new Error('NOTICE_AMOUNT_UNKNOWN');
  return found.reduce((sum,x)=>sum+money(x.amount_twd,'notice'),0);
}
