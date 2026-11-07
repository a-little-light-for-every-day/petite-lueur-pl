// A display-only projection. Commands and accounting calculations must keep the full state.
export function groupScope(state, groupId = '') {
 const s = state;
 const orders = groupId ? s.orders.filter(o => o.group_id === groupId) : s.orders;
 const orderIds = new Set(orders.map(o => o.id));
 const containsOrder = id => orderIds.has(id);
 const invoices = groupId ? s.invoices.filter(b => containsOrder(b.order_id)) : s.invoices;
 const invoiceIds = new Set(invoices.map(b => b.id));
 const reports = groupId ? (s.reports || []).filter(r => containsOrder(r.order_id)) : (s.reports || []);
 const notices = groupId ? s.notices.filter(n =>
  (n.order_ids || []).some(containsOrder) ||
  (n.invoice_ids || []).some(id => invoiceIds.has(id))
 ) : s.notices;
 const purchases = groupId ? s.purchases.filter(p => (p.items || []).some(i => containsOrder(i.order_id))) : s.purchases;
 const shipments = groupId ? s.shipments.filter(sh => (sh.items || []).some(i => containsOrder(i.order_id))) : s.shipments;
 const allocations = groupId ? s.allocations.filter(a => !a.reversed_at && invoiceIds.has(a.invoice_id)) : s.allocations;
 const receiptIds = new Set(allocations.map(a => a.receipt_id));
 const receipts = groupId ? s.receipts.filter(r => receiptIds.has(r.id)) : s.receipts;
 const serviceRequests = groupId ? (s.service_requests || []).filter(r => containsOrder(r.order_id)) : (s.service_requests || []);
 const products = groupId ? (s.products || []).filter(p => p.group_id === groupId) : (s.products || []);
 const groups = groupId ? s.groups.filter(g => g.id === groupId) : s.groups;
 const campaigns = groupId ? (s.config.benefit_campaigns || []).filter(c => c.group_id === groupId) : (s.config.benefit_campaigns || []);
 const history = groupId ? (s.history || []).filter(h =>
  h.result?.group_id === groupId || containsOrder(h.result?.order_id) ||
  (h.result?.invoice_id && invoiceIds.has(h.result.invoice_id)) ||
  (h.result?.purchase_id && purchases.some(p => p.id === h.result.purchase_id)) ||
  (h.result?.shipment_id && shipments.some(sh => sh.id === h.result.shipment_id))
 ) : (s.history || []);
 const receiptIsCrossGroup = receipt => {
  const ids = s.allocations.filter(a => !a.reversed_at && a.receipt_id === receipt.id)
   .map(a => s.invoices.find(b => b.id === a.invoice_id)?.order_id)
   .map(id => s.orders.find(o => o.id === id)?.group_id).filter(Boolean);
  return new Set(ids).size > 1;
 };
 const matchesTask = t => {
  if (!groupId) return true;
  if (t.type === 'group' || t.type === 'star_trace') return t.object_id === groupId;
  if (t.type === 'order') return containsOrder(t.object_id);
  if (t.type === 'invoice') return invoiceIds.has(t.object_id);
  if (t.type === 'report') return reports.some(r => r.id === t.object_id);
  if (t.type === 'notice') return notices.some(n => n.id === t.object_id);
  if (t.type === 'credit') return receipts.some(r => r.id === t.object_id);
  if (t.type === 'service') return serviceRequests.some(r => r.id === t.object_id);
  if (t.type === 'purchase') return purchases.some(p => p.id === t.object_id) || orders.some(o => o.items.some(l => l.id === t.object_id));
  if (t.type === 'warehouse' || t.type === 'shipment') return orders.some(o => o.items.some(l => l.id === t.object_id));
  return false;
 };
 return {groupId,orders,orderIds,invoices,invoiceIds,reports,notices,purchases,shipments,receipts,allocations,serviceRequests,products,groups,campaigns,history,receiptIsCrossGroup,matchesTask};
}
