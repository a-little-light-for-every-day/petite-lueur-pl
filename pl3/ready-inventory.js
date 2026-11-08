// PL-owned stock is separate from suppliers' stock and ordinary open preorders.
// Every change passes through the operations versioned command transaction.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const qty=v=>Number.isSafeInteger(v)&&v>=0;
export const READY_GROUP='PL-READY-INVENTORY';
export const READY_LOCATIONS=['taiwan_stock','japan_stock','purchased_preorder'];
export function readyAvailable(s,item){
 const reserved=(s.ready_claims||[]).filter(c=>c.stock_id===item.id&&['held','confirmed'].includes(c.status)).reduce((n,c)=>n+c.quantity,0);
 return Math.max(0,item.quantity-reserved);
}
export function readyPublicCatalog(s){
 const items=(s.ready_stock||[]).filter(x=>x.published===true&&x.approved===true&&x.official_image===true&&READY_LOCATIONS.includes(x.location)&&readyAvailable(s,x)>0);
 return {ok:true,items:items.map(x=>({id:x.id,name:x.name,variant:x.variant,sku:x.sku,price_twd:x.price_twd,image_url:x.image_url,source_url:x.source_url,location:x.location,available:readyAvailable(s,x),shipping_units:x.shipping_units,shipping_pending:x.shipping_units===null}))};
}
export function applyReadyOperation(s,c,{id,now}){
 s.ready_stock=s.ready_stock||[];s.ready_claims=s.ready_claims||[];
 if(c.type==='ready_stock_save'){
  if(c.confirmed!==true||!clean(c.evidence,2000))fail('須先核對官方採購及可售數量');
  if(!clean(c.name)||!clean(c.sku)||!clean(c.official_order_id)||!clean(c.source_url))fail('商品、官方貨號、採購編號與來源不可空白');
  if(!/^https:\/\//.test(c.source_url)||c.image_url&&!/^https:\/\//.test(c.image_url))fail('官方來源／圖片必須是 HTTPS');
  if(!qty(c.quantity)||!Number.isSafeInteger(c.price_twd)||c.price_twd<=0||c.price_twd>22000)fail('商品數量或價格無效');
  if(!READY_LOCATIONS.includes(c.location))fail('商品所在地無效');
  if(c.shipping_units!==null&&(!Number.isSafeInteger(c.shipping_units)||c.shipping_units<=0))fail('運費份數無效');
  if(c.published===true&&(!c.official_image||!c.approved))fail('未核准的商品及圖片不能公開');
  const prior=s.ready_stock.find(x=>x.id===c.id),taken=prior?prior.quantity-readyAvailable(s,prior):0;
  if(c.quantity<taken)fail('已保留或已售數量不可被庫存調整覆蓋',409);
  if(!prior&&s.ready_stock.some(x=>x.official_order_id===clean(c.official_order_id)&&x.sku===clean(c.sku)&&x.variant===clean(c.variant)))fail('相同採購／貨號／規格已存在，請編輯原庫存',409);
  const item={id:prior?.id||id,name:clean(c.name),variant:clean(c.variant),sku:clean(c.sku),official_order_id:clean(c.official_order_id),source_url:clean(c.source_url,2000),image_url:clean(c.image_url,2000),official_image:c.official_image===true,location:c.location,quantity:c.quantity,price_twd:c.price_twd,shipping_units:c.shipping_units,approved:c.approved===true,published:c.published===true,evidence:clean(c.evidence,2000),updated_at:now};
  if(prior)Object.assign(prior,item);else s.ready_stock.push(item);
  return {stock_id:item.id,available:readyAvailable(s,item)};
 }
 if(c.type==='ready_claim'){
  if(!clean(c.email)||!/^\S+@\S+\.\S+$/.test(c.email)||!clean(c.name))fail('請完成姓名與 Email 驗證');
  if(!Array.isArray(c.items)||!c.items.length||c.items.length>50||new Set(c.items.map(x=>x.stock_id)).size!==c.items.length)fail('商品明細無效');
  const lines=c.items.map((line,i)=>{
   const item=s.ready_stock.find(x=>x.id===line.stock_id);
   if(!item||!item.approved||!item.published||!item.official_image||!qty(line.quantity)||line.quantity<1||line.quantity>readyAvailable(s,item))fail('商品已售完或可認領數量不足，請重新整理',409);
   return {id:id+':'+i,stock_id:item.id,name:item.name,sku:item.sku,variant:item.variant,quantity:line.quantity,unit_price_twd:item.price_twd,purchased:0,overseas:0,transit:0,taiwan:0,shipped:0,delivered:0,shipping_units:item.shipping_units,shipping_units_confirmed:item.shipping_units!==null,fulfillment_kind:'physical',hold:null};
  });
  const total=lines.reduce((n,l)=>n+l.quantity*l.unit_price_twd,0);if(total>22000)fail('單次申請商品款不得超過 NT$22,000');
  const orderId='PL3-READY-'+id;
  s.orders.push({id:orderId,group_id:READY_GROUP,email:clean(c.email,320).toLowerCase(),name:clean(c.name),status:'review_pending',items:lines,goods_twd:total,first_channel:'transfer',raw_item_text:'',created_at:now,acceptance:c.acceptance,application:null,ready_inventory:true});
  for(const line of lines)s.ready_claims.push({id:id+':'+line.stock_id,stock_id:line.stock_id,order_id:orderId,item_id:line.id,quantity:line.quantity,status:'held',created_at:now});
  return {order_id:orderId,status:'review_pending',goods_twd:total};
 }
 if(c.type==='ready_claim_release'){
  const order=s.orders.find(x=>x.id===c.order_id&&x.ready_inventory===true);
  if(!order||order.status!=='review_pending'||c.confirmed!==true||!clean(c.reason))fail('只有未確認承接的備貨認領可直接釋出');
  for(const claim of s.ready_claims.filter(x=>x.order_id===order.id&&x.status==='held')){claim.status='released';claim.released_at=now;claim.reason=clean(c.reason);}
  order.status='cancelled';return {order_id:order.id,status:'cancelled'};
 }
 fail('不支援的庫存操作');
}
