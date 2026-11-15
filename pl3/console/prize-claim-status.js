import { balance, operatingStatus } from '../operations-domain.js';

export function isDrawnPrizeClaim(group) {
  // Existing groups identify already drawn prizes in their title.
  return /已抽中(?:指定款|認領)/.test(group?.title ?? '');
}

export function consoleOrderProgress(state, order, group) {
  if (
    isDrawnPrizeClaim(group)
    && order.status === 'active'
    && order.items.length > 0
    && !order.items.some(item => item.overseas || item.transit || item.taiwan || item.shipped || item.delivered)
  ) {
    return '等待官方出貨';
  }
  return operatingStatus(state, order);
}

export function prizeClaimFirstPayment(state, invoice) {
  if (invoice.phase !== 'first' || invoice.status === 'void' || !invoice.finalized) return null;
  const outstanding = balance(state, invoice);
  if (outstanding === null) return '一補待核對';
  if (outstanding > 0) return '一補未收款';
  return invoice.amount_twd > 0 ? '一補已收款' : '一補免付款';
}
