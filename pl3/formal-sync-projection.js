// PL3 formal downstream projection. No outbound writes or customer PII.
export class ProjectionBlocked extends Error {
  constructor(code, message) { super(message); this.name="ProjectionBlocked"; this.code=code; this.status=409; }
}
const blocked=(code,message)=>{throw new ProjectionBlocked(code,message);};
const clean=(x,max=2000)=>String(x??"").trim().slice(0,max);
const asInt=(x)=>Number(x);
const orderStates={pending:"訂購申請待確認",cancelled:"已取消"};
const fulfillmentStates={
  pending:"待處理",
  ordered:"已向日本商店下單",
  japan_warehouse:"日本倉庫已到貨",
  international_shipping:"國際運送中",
  taiwan_warehouse:"商品已抵台",
  domestic_shipping:"台灣已寄出",
  delivered:"已完成"
};
export function buildFormalProjection(order,lines,event) {
  if(!order||!order.id||!order.group_id||!Array.isArray(lines)||lines.length<1)
    blocked("MISSING_ORDER","Order or line items missing");
  if(!event||!event.id||event.entity_id!==order.id||!["order.created","payment.reviewed","fulfillment.advanced"].includes(event.event_type))
    blocked("EVENT_MISMATCH","Invalid source event");
  const total=asInt(order.total_twd);
  if(!Number.isInteger(total)||total<1||total>22000)blocked("TOTAL_INVALID","Order total outside validated range");
  let calculated=0;
  const sheetItems=[];
  for(const line of lines) {
    const quantity=asInt(line.quantity),price=asInt(line.unit_price_twd);
    if(!line.id||!line.product_id||!clean(line.product_name,200)||!Number.isInteger(quantity)||quantity<1||
       !Number.isInteger(price)||price<1)
      blocked("LINE_INVALID","Invalid order line");
    if(!Object.hasOwn(fulfillmentStates,line.fulfillment_status||"pending"))
      blocked("FULFILLMENT_UNMAPPED","Unmapped fulfillment stage");
    calculated+=price*quantity;
    sheetItems.push({
      item_id:clean(line.id,128),
      product_id:clean(line.product_id,128),
      cells:{
        A:clean(line.product_name,200),B:clean(line.product_id,128),C:quantity,D:price,
        E:clean(line.variant,100),F:fulfillmentStates[line.fulfillment_status||"pending"],
        I:clean(order.id,128)
      }
    });
  }
  if(calculated!==total)blocked("TOTAL_MISMATCH","Line totals do not equal order total");
  const notionOrderStatus=orderStates[order.status];
  if(!notionOrderStatus)blocked("ORDER_STATUS_UNMAPPED","Order state requires owner-approved mapping");
  // Existing PL2 Notion has no generic paid option. A first/second payment phase
  // must be captured explicitly before a paid order can be projected.
  if(order.payment_status!=="unpaid")
    blocked("PAYMENT_PHASE_REQUIRED","Paid or refunded status requires a reviewed payment phase");
  const summary=sheetItems.map(item=>item.cells.A+" × "+item.cells.C).join("、").slice(0,1800);
  const orderCells={A:clean(order.id,128),D:notionOrderStatus,F:total,I:summary};
  const notion={
    "訂單編號":clean(order.id,128),
    "網站訂單識別碼":clean(order.id,128),
    "商品款":total,
    "商品明細":summary,
    "狀態":notionOrderStatus
  };
  const lifecycle=sheetItems.map(x=>x.cells.F);
  // Cancellation is an order-level terminal state. Fulfillment must never
  // overwrite it in the Notion mirror, even if a purchase was made earlier.
  if(order.status!=="cancelled"&&lifecycle.length===1&&lifecycle[0]!=="待處理")
    notion["狀態"]=lifecycle[0];
  // Do not export name/email, payment references, owner cost, or private notes.
  return {
    schema_version:1,source:"PL3_D1",event_id:clean(event.id,200),
    event_type:event.event_type,order_id:clean(order.id,128),
    group_id:clean(order.group_id,128),source_revision:clean(order.updated_at||order.created_at,80),
    amount_twd:total,
    sheet:{order:{key:clean(order.id,128),cells:orderCells},items:sheetItems},
    notion:{key:clean(order.id,128),properties:notion},
    warnings:["Customer identity deliberately omitted; owner approval required before export"]
  };
}
