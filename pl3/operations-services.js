// Customer-facing intake contains no address, phone, payment proof, or banking credentials.
export const SERVICE_KINDS={proxy:'日本代購',ordering:'日本網站代下單',payment:'日本代付',korea:'韓國代刷／代付',forwarding:'代收／轉運'};
const fail=m=>{throw Object.assign(Error(m),{status:400})};
const text=(x,n=2000)=>String(x||'').trim().slice(0,n);
const amount=n=>{if(!Number.isSafeInteger(n)||n<0)fail('金額須為非負整數');return n};
export function applyService(s,c,{id,now},apply){
 s.service_requests=s.service_requests||[];let result={};const owned=()=>{const r=s.service_requests.find(r=>r.id===c.request_id);if(!r)fail('找不到申請');if(c.type.startsWith('service_customer_')&&r.email!==c.authenticated_email)fail('禁止操作他人申請');return r};
 if(c.type==='service_request'){
  if(!SERVICE_KINDS[c.kind]||!c.authenticated_email)fail('服務類型或身分無效');let u;try{u=new URL(c.product_url)}catch{fail('請填商品或委託來源網址')}if(u.protocol!=='https:')fail('請使用HTTPS商品來源');if(/animate-onlineshop|animate\.co\.jp/i.test(u.hostname))fail('此通路不列為PL商業代購通路');
  if(!Number.isInteger(c.quantity)||c.quantity<1||c.quantity>99)fail('數量須為1至99');const r={id,email:c.authenticated_email,kind:c.kind,product_url:u.href,description:text(c.description),quantity:c.quantity,note:text(c.note),status:'pending',quote:null,quote_version:0,created_at:now};if(!r.description)fail('請填商品、款式與委託內容');s.service_requests.push(r);result={request_id:id};
 }else if(c.type==='service_quote'){
  const r=owned();if(!['pending','quoted'].includes(r.status))fail('此申請不可重新報價');if(!c.confirmed||!text(c.evidence))fail('請核實可承接通路、報價及來源');if(!Array.isArray(c.items)||!c.items.length||c.items.length>50)fail('請提供報價明細');
  const items=c.items.map((x,i)=>{if(!text(x.name)||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99)fail('報價商品或數量無效');amount(x.unit_price_twd);if(x.unit_price_twd===0)fail('商品或代付本金金額須大於0');return {name:text(x.name,300),sku:text(x.sku,160),variant:text(x.variant,300),quantity:x.quantity,unit_price_twd:x.unit_price_twd,shipping_units:Number.isInteger(x.shipping_units)&&x.shipping_units>0?x.shipping_units:1,fulfillment_kind:['payment','korea','forwarding'].includes(r.kind)?'service':'physical'};});
  if(c.checkout_count!==undefined&&(!Number.isInteger(c.checkout_count)||c.checkout_count<1||c.checkout_count>50))fail('結帳筆數須為1至50');const fee=amount(c.service_fee_twd||0);if(r.kind==='ordering'&&fee!==100*(c.checkout_count||1)&&!text(c.fee_exception))fail('代下單每同站同結帳收NT$100；例外須有明確核准原因');if(fee)items.push({name:'委託服務費',sku:'SERVICE-FEE',variant:'',quantity:1,unit_price_twd:fee,shipping_units:1,fulfillment_kind:'fee'});
  const total=items.reduce((n,x)=>n+x.quantity*x.unit_price_twd,0);if(total>22000)fail('超過本單商品款上限');if(!Number.isFinite(Date.parse(c.expires_at))||Date.parse(c.expires_at)<=Date.parse(now)||!Number.isFinite(Date.parse(c.payment_due_at))||Date.parse(c.payment_due_at)<=Date.parse(now))fail('請設定有效報價及付款期限');
  r.quote={items,total_twd:total,service_fee_twd:fee,expires_at:c.expires_at,payment_due_at:c.payment_due_at,terms:text(c.terms)||'第一階段為已確認商品款／委託本金與服務費；後續實際運費及分攤另行結算。未確認款項不執行採購或代付。',evidence:text(c.evidence),fee_exception:text(c.fee_exception)};r.quote_version++;r.status='quoted';r.updated_at=now;result={request_id:r.id,quote_version:r.quote_version};
 }else if(c.type==='service_customer_accept'){
  const r=owned();if(r.status!=='quoted'||!r.quote||c.quote_version!==r.quote_version||Date.parse(r.quote.expires_at)<=Date.parse(now)||!c.confirmed||!c.adult_confirmed)fail('請確認目前有效報價、成年及委託內容');if(!text(c.name,120))fail('確認正式委託時請填訂購姓名');
  const groupId='service:'+r.id;let next=apply(s,{type:'group_save',id:groupId,title:'個別委託｜'+r.id,status:'open',payment_due_at:r.quote.payment_due_at},{id:id+':group',now}).state;
  next=apply(next,{type:'order_save',id:'PL3-SVC-'+r.id,group_id:groupId,email:r.email,name:text(c.name,120),items:r.quote.items,first_channel:'transfer',acceptance:{terms_version:'service-quote:'+r.quote_version,accepted_at:now,adult_confirmed:true,terms_confirmed:true}},{id:id+':order',now}).state;
  const o=next.orders.find(o=>o.id==='PL3-SVC-'+r.id);o.service_kind=r.kind;o.service_request_id=r.id;next=apply(next,{type:'close_group',group_id:groupId,payment_due_at:r.quote.payment_due_at},{id:id+':close',now}).state;
  const rr=next.service_requests.find(x=>x.id===r.id);rr.status='accepted';rr.order_id=o.id;rr.accepted_quote_version=r.quote_version;rr.accepted_at=now;s=next;result={request_id:r.id,order_id:o.id};
 }else if(c.type==='service_customer_decline'){
  const r=owned();if(!['pending','quoted'].includes(r.status))fail('已成立的委託須由主購處理取消及退款');r.status='declined';r.updated_at=now;result={request_id:r.id};
 }else if(c.type==='service_complete'){
  const r=owned(),o=s.orders.find(o=>o.id===r.order_id);if(r.status!=='accepted'||!o||!['payment','korea','forwarding'].includes(r.kind))fail('此服務須使用商品履約流程');const b=s.invoices.find(b=>b.order_id===o.id&&b.phase==='first');const used=s.allocations.filter(a=>a.invoice_id===b?.id&&!a.reversed_at).reduce((n,a)=>n+a.amount_twd,0);if(!b?.finalized||used<b.amount_twd||!c.confirmed||!text(c.evidence)||!text(c.official_reference))fail('須核實商品款清償、實際完成憑證及官方識別碼');r.status='completed';r.official_reference=text(c.official_reference);r.completion_evidence=text(c.evidence);r.completed_at=now;o.service_completed_at=now;o.status='completed';result={request_id:r.id,order_id:o.id};
 }else fail('服務操作類型無效');
 s.history.push({id,type:c.type,at:now,result});s.history=s.history.slice(-500);return {state:s,result};
}
export function customerServiceView(s,email){return(s.service_requests||[]).filter(r=>r.email===email).map(r=>({id:r.id,kind:r.kind,description:r.description,product_url:r.product_url,quantity:r.quantity,status:r.status,quote_version:r.quote_version,quote:r.quote?{items:r.quote.items,total_twd:r.quote.total_twd,expires_at:r.quote.expires_at,payment_due_at:r.quote.payment_due_at,terms:r.quote.terms}:null,order_id:r.order_id,official_reference:r.official_reference,created_at:r.created_at}));}
