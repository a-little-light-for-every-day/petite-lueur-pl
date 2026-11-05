import {BENEFIT_GROUP} from './benefit-checkout.js';
import {STAR_TRACE_PRODUCTS} from './plave-star-trace.js';

// Owner-approved rush-order ceiling: leave NT$5,000 of the available NT$25,000 untouched.
// This is a conservative planning rate, not the final LINE Pay/card exchange rate.
export const STAR_TRACE_ADVANCE_LIMIT_TWD = 20000;
export const STAR_TRACE_ESTIMATED_KRW_PER_TWD = 27 / 1000;

const officialPrice = new Map(STAR_TRACE_PRODUCTS.map(p => [p.id, p.tax_included_krw]));
const trustedOwnerTestIds = new Set(['PL3-41d8879f-c673-449e-9e77-cfd8ef98fadf']);

export function starTraceCost(lines) {
  let amountKrw = 0;
  for (const line of lines) {
    const sku = String(line.sku || '');
    const id = sku.match(/(?:WV-PLAVE-|sales\/)(\d{5})/)?.[1];
    const price = officialPrice.get(id);
    if (!price || !Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw Object.assign(new Error('STAR TRACE 商品韓幣成本無法確認，請暫勿送出'), {status:409});
    }
    amountKrw += price * line.quantity;
  }
  if (!Number.isSafeInteger(amountKrw)) throw new Error('商品成本超過安全計算範圍');
  return {amount_krw:amountKrw, estimated_twd:Math.ceil(amountKrw * 27 / 1000)};
}

export function starTraceAdmission(state, lines) {
  const requested = starTraceCost(lines);
  const occupied = (state.orders || [])
    .filter(order => order.group_id === BENEFIT_GROUP &&
      !['cancelled', 'excluded', 'waitlisted'].includes(order.status) &&
      !trustedOwnerTestIds.has(order.id))
    .reduce((total, order) => total + starTraceCost(order.items).estimated_twd, 0);
  const available = Math.max(0, STAR_TRACE_ADVANCE_LIMIT_TWD - occupied);
  const status = requested.estimated_twd <= available ? 'active' : 'waitlisted';
  return {...requested, occupied_twd:occupied, remaining_before_twd:available,
    limit_twd:STAR_TRACE_ADVANCE_LIMIT_TWD, status,
    estimation:'KRW 含稅官方售價 × 0.027 TWD/KRW；非最終實刷金額'};
}
