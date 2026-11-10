import{normalizeBenefitPreference,BENEFIT_GROUP}from './benefit-checkout.js';
import{starTraceAdmission}from './star-trace-admission.js';
import{applyBenefit}from './operations-benefits.js';
import{completeLegacyOperations}from './legacy-operations-reconcile.js';
import{settleLegacyPayment}from './legacy-payment-settlement.js';
import{applyService}from './operations-services.js';
// PL operating model. Pure commands, explicit evidence, no external calls.
const failure=(m,status=400)=>Object.assign(new Error(m),{status});
const must=(ok,m,status=400)=>{if(!ok)throw failure(m,status);};
const text=(v,n=300)=>String(v??'').trim().slice(0,n);
const email=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))&&!/[\r\n]/.test(v);
const money=v=>{must(Number.isSafeInteger(v)&&v>=0,'金額須為非負整數');return v;};
const positive=v=>{must(Number.isSafeInteger(v)&&v>0,'數量／金額須為正整數');return v;};
const taiwanDeadline=v=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(v)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}（台灣時間）`;
};
const purchaseItemKey=x=>String(x.order_id)+'\u0000'+String(x.item_id);
function validatePurchaseItems(s,items,advance,already=[]){
 must(Array.isArray(items)&&items.length>0&&items.length<=100,'請指定實購品項');
 const seen=new Set(already.map(purchaseItemKey));
 for(const x of items){
  const key=purchaseItemKey(x);must(!seen.has(key),'同一品項已登錄至該官方訂單，請勿重複分配',409);seen.add(key);
  const o=order(s,x.order_id),l=o.items.find(v=>v.id===x.item_id);
  must(open(o)&&l,'找不到有效品項');must(!['fee','service','forwarding'].includes(l.fulfillment_kind),'服務、手續費與轉運品不能登錄實物採購');
  positive(x.quantity);must(!l.hold||l.hold.released_at,'品項延後條件尚未解除');
  must(firstPaid(s,o)||(advance?.approved===true&&text(advance.reason)),'一補未清償；如已核准代墊須明確登錄原因');
  must(x.quantity<=l.quantity-l.purchased,'實購超過待買數量');l.purchased+=x.quantity;
 }
}
export const newOperations=()=>({schema:1,service_requests:[],products:[],groups:[],orders:[],invoices:[],receipts:[],allocations:[],notices:[],purchases:[],shipments:[],refunds:[],reports:[],config:{card_limit_twd:22000,card_available_twd:null},history:[]});
// First-stage preorder billing is for the confirmed goods price only. Keep
// unconfirmed international freight separate for the second-stage settlement.
const reviewItemSignature=items=>JSON.stringify(items.map(l=>[l.id,l.name,l.sku,l.variant,l.quantity,l.unit_price_twd,l.shipping_units_confirmed!==false]));
export const balance=(s,b)=>{if(b.status==='void')return 0;if(b.amount_twd===null)return null;const allocated=s.allocations.filter(x=>x.invoice_id===b.id&&!x.reversed_at).reduce((n,x)=>n+x.amount_twd,0)+(b.legacy_settlement?.recognized_twd||0);const sourceVerified=b.phase==='first'?['第一階段已核對','第二次付款已核對'].includes(b.source_status):b.source_status==='第二次付款已核對';if(sourceVerified&&b.amount_twd>allocated)return null;return Math.max(0,b.amount_twd-allocated);};
export const credit=(s,r)=>r.amount_twd-s.allocations.filter(x=>x.receipt_id===r.id&&!x.reversed_at).reduce((n,x)=>n+x.amount_twd,0)-s.refunds.filter(x=>x.receipt_id===r.id).reduce((n,x)=>n+x.amount_twd,0);
// A payment report is only an unverified claim. Linking it to an EXISTING
// bank receipt must never create another receipt or allocation. The receipt
// must already have an active allocation to that report's own order/phase.
export function reportMatchesExistingReceipt(s,report,receipt){
 if(!report||!receipt||report.status!=='pending'||receipt.kind!=='bank_confirmed')return false;
 const reportedEmail=String(report.customer_email||'').trim().toLowerCase();
 if(!email(reportedEmail)||reportedEmail!==String(receipt.customer_email||'').trim().toLowerCase()||report.amount_twd!==receipt.amount_twd)return false;
 return s.allocations.some(a=>a.receipt_id===receipt.id&&!a.reversed_at&&a.amount_twd>0&&s.invoices.some(b=>b.id===a.invoice_id&&b.order_id===report.order_id&&(!report.phase||b.phase===report.phase)&&b.status!=='void'));
}
const order=(s,id)=>{const o=s.orders.find(x=>x.id===id);must(o,'找不到訂單',404);return o;};
const invoice=(s,id)=>{const x=s.invoices.find(x=>x.id===id);must(x,'找不到帳款',404);return x;};
const open=o=>!['cancelled','excluded','completed','waitlisted','review_pending'].includes(o.status);
const firstPaid=(s,o)=>{const b=s.invoices.find(x=>x.order_id===o.id&&x.phase==='first');return b&&b.finalized&&balance(s,b)===0;};
const noticesChanged=(s,ids)=>{for(const n of s.notices)if(!['sent','sending','unknown'].includes(n.status)&&n.order_ids.some(id=>ids.includes(id))){
 if(n.kind==='first-payment-confirmed'&&n.dependency===noticeDependency(s,n))continue;
 n.status='void';
}};
export function noticeDependency(s,n){return JSON.stringify({orders:n.order_ids.map(id=>{const o=order(s,id);return [id,o.email,o.status,o.name];}),invoices:n.invoice_ids.map(id=>{const b=invoice(s,id);return [id,b.amount_twd,b.finalized,b.channel,b.due_at,b.status,balance(s,b)];})});}
export function noticeContent(n){return JSON.stringify([n.to,n.subject,n.body,n.attachments||[],n.dependency]);}
// Delivery status is derived from the immutable, typed notice records. An old
// invoice.notified flag is not proof that either specific email was delivered:
// older imports and receipt confirmations both used to set that same flag.
export function invoiceNotificationStatus(s,b){
 const notices=(s.notices||[]).filter(n=>Array.isArray(n.invoice_ids)&&n.invoice_ids.includes(b.id));
 const classify=kind=>{
  const matches=notices.filter(n=>n.kind===kind);
  const precedence=['sent','unknown','sending','queued','draft','failed','void'];
  const notice=precedence.map(status=>matches.slice().reverse().find(n=>n.status===status)).find(Boolean);
  return notice?{status:notice.status,notice_id:notice.id,sent_at:notice.status==='sent'?notice.sent_at||null:null,gmail_message_id:notice.status==='sent'?notice.gmail_message_id||null:null}:{status:'none',notice_id:null,sent_at:null,gmail_message_id:null};
 };
 const payment_notice=classify('payment'),receipt_confirmation=classify('first-payment-confirmed');
 if(payment_notice.status==='none'&&b.notified===true)payment_notice.status='legacy_unverified';
 return {payment_notice,receipt_confirmation};
}
export function makeNotice(s,ids,kind,id,now){
 const bills=ids.map(x=>invoice(s,x));must(bills.length>0&&new Set(ids).size===ids.length,'請選擇不重複的帳款');
 const orders=[...new Set(bills.map(x=>x.order_id))].map(x=>order(s,x));
 must(orders.every(open),'取消／缺貨單不建立付款通知');must(orders.every(x=>email(x.email)),'缺少有效收件Email');
 must(new Set(orders.map(x=>x.email.toLowerCase())).size===1,'合併付款通知必須屬於同一收件Email');
 must(bills.every(x=>x.finalized&&x.amount_twd!==null&&x.status!=='void'&&x.channel!=='cod'&&balance(s,x)>0),'帳款未確認、已清償或為貨到付款，不能寄此付款通知');
 must(new Set(bills.map(x=>x.phase)).size===1,'一補與二補請分開通知');
 if(kind==='payment')must(bills.every(x=>!x.notified),'已通知帳款請使用明確的催款／更新通知，避免重寄');
 const existing=s.notices.find(n=>n.kind===kind&&JSON.stringify([...n.invoice_ids].sort())===JSON.stringify([...ids].sort())&&!['void','failed'].includes(n.status));
 if(existing)return existing;
 const phase=bills[0].phase==='first'?'第一階段':'第二階段', total=bills.reduce((n,b)=>n+balance(s,b),0);
 const list=orders.map(o=>o.id+'\n'+(o.items.length?o.items.filter(l=>o.group_id!==BENEFIT_GROUP||l.purchased>0).map(l=>{const q=o.group_id===BENEFIT_GROUP?l.purchased:l.quantity;return '・'+l.name+(l.variant?'｜'+l.variant:'')+' ×'+q+(l.unit_price_twd===null?'':' · NT$'+(l.unit_price_twd*q));}).join('\n'):o.raw_item_text)).join('\n\n');
 const deadlines=[...new Set(bills.map(x=>x.due_at).filter(Boolean))].map(taiwanDeadline);
 const costLabels={japan:'海外境內運費',international:'國際運費',packaging:'包材',tax:'稅費',domestic:'台灣配送費'};
 const breakdown=bills[0].phase==='second'?bills.map(b=>b.order_id+'\n'+(b.costs||[]).map(x=>'・'+costLabels[x.kind]+'：NT$'+x.amount_twd).join('\n')+(b.carry_twd?'\n・一補轉入尾款：NT$'+b.carry_twd:'')).join('\n\n'):'';
 const n={id,kind,to:orders[0].email,subject:`【Petite Lueur PL】${phase}付款通知｜${orders.length===1?orders[0].id:'合併付款'}`,body:`您好：\n\n${phase}付款資訊如下。\n\n${list}\n\n${breakdown?breakdown+'\n\n':''}本次應付：NT$${total.toLocaleString('en-US')}\n${deadlines.length?'付款期限：'+deadlines.join('、')+'\n':''}\n${phase==='第一階段'?'本次為已確認商品款，後續運費及相關分攤費用於二補另行結算。':'本次為已核准的運費及相關分攤費用；帳款明細以查單頁為準。'}\n主要付款方式為台新銀行轉帳，另提供中國信託銀行轉帳、中國信託無卡存款及台灣 Pay。請至下方查單頁驗證訂購 Email，選擇台新銀行匯款、中國信託銀行轉帳或中國信託無卡存款後，即可查看當次付款帳號；台灣 Pay 請洽官方確認收款資訊。付款完成後，請在同頁提交付款回報，填寫金額、付款日期時間、方式及適用時的轉出帳號末五碼。回報不等於入帳完成，須待主購核實銀行款項後才標示已收款。\n\n訂單查詢與付款回報：https://a-little-light-for-every-day.petitelueur-pl.workers.dev/account\n\nPetite Lueur PL`,attachments:[],order_ids:orders.map(x=>x.id),invoice_ids:ids,status:'draft',version:1,created_at:now};
 n.dependency=noticeDependency(s,n);s.notices.push(n);return n;
}
// A bank-confirmed, fully allocated invoice creates a REVIEW DRAFT only.
// The immutable invoice identity is the deduplication key, including voided drafts;
// a voided acknowledgement must be explicitly handled by the owner, not auto-regenerated.
function makePaidConfirmationDraft(s,b,id,now){
 if(!b||b.phase!=='first'||!b.finalized||b.status==='void'||b.amount_twd===null||balance(s,b)!==0)return null;
 const o=order(s,b.order_id);
 if(!open(o)||!email(o.email)||b.channel==='cod')return null;
 const existing=s.notices.find(n=>n.kind==='first-payment-confirmed'&&n.invoice_ids.includes(b.id));
 if(existing)return existing;
 const n={id,kind:'first-payment-confirmed',to:o.email,
  subject:'【Petite Lueur PL】第一階段款項已確認入帳｜'+o.id,
  body:`您好：\n\n已確認收到您的第一階段商品款，款項核對完成。\n\n訂單編號：${o.id}\n訂購商品：\n${o.items.map(l=>'・'+l.name+(l.variant?'｜'+l.variant:'')+' ×'+l.quantity).join('\n')}\n第一階段已收款：NT$${b.amount_twd.toLocaleString('en-US')}\n第一階段待收款：NT$0\n\n後續海外及國際運費、包材與其他實際分攤費用，會於第二階段另行通知。訂單與付款紀錄可至 https://a-little-light-for-every-day.petitelueur-pl.workers.dev/account 查詢。\n\nPetite Lueur PL`,
  attachments:[],order_ids:[o.id],invoice_ids:[b.id],status:'draft',version:1,created_at:now};
 n.dependency=noticeDependency(s,n);s.notices.push(n);return n;
}
function allocate(s,r,entries){
 must(Array.isArray(entries)&&entries.length>0,'請指定款項分配');
 for(const a of entries){const b=invoice(s,a.invoice_id),o=order(s,b.order_id);positive(a.amount_twd);must(open(o)&&b.finalized&&b.status!=='void'&&b.amount_twd!==null,'帳款尚未確認或已作廢');must((o.email?.trim().toLowerCase()||'order:'+o.id)===(r.customer_key||r.customer_email?.trim().toLowerCase()),'禁止跨顧客分配款項');must(b.channel!=='cod'||r.kind==='cod_settled','貨到付款必須確認平台實際撥款');must(a.amount_twd<=b.amount_twd-(b.legacy_settlement?.recognized_twd||0)-s.allocations.filter(x=>x.invoice_id===b.id&&!x.reversed_at).reduce((n,x)=>n+x.amount_twd,0)&&a.amount_twd<=credit(s,r),'分配金額超過待收或可用餘額');s.allocations.push({id:r.id+':'+b.id+':'+s.allocations.length,receipt_id:r.id,invoice_id:b.id,amount_twd:a.amount_twd});}
}
export function applyOperation(original,c,{now=new Date().toISOString(),id=crypto.randomUUID()}={}){
 const s=structuredClone(original);must(c&&typeof c.type==='string','操作類型不完整');let result={};const changed=[];
 if(c.type.startsWith('service_'))return applyService(s,c,{id,now},applyOperation);
 if(c.type.startsWith('benefit_'))return applyBenefit(s,c,{id,now});
 switch(c.type){
 case 'legacy_order_import_single':{
  must(c.confirmed===true,'請確認已核對舊版原單及正式資料庫');
  const oid=text(c.order_id,100),name=text(c.name),customerEmail=text(c.email,320).toLowerCase();
  must(/^PL-\d{6}-\d{5,8}$/.test(oid),'原單號格式不正確');
  must(!s.orders.some(o=>o.id===oid),'原單號已存在，禁止覆寫或重複匯入',409);
  must(s.groups.some(g=>g.id===c.group_id),'找不到對應的正式團次');
  must(name&&email(customerEmail),'原單姓名或Email無效');
  must(Array.isArray(c.items)&&c.items.length===1,'單筆安全匯入僅接受一項已核對商品');
  const l=c.items[0];must(text(l.name)&&text(l.sku),'原商品名稱或SKU不可空白');
  const quantity=positive(l.quantity),unitPrice=positive(l.unit_price_twd),shippingUnits=positive(l.shipping_units);
  must(quantity*unitPrice===positive(c.expected_goods_twd),'商品數量與原單總額不符');
  const sourceURL=text(c.source_url,2000);
  must(/^https:\/\/(?:www\.)?notion\.so\/(?:p\/)?[a-f0-9-]{32,36}\/?$/i.test(sourceURL),'須提供正式 Notion 原單頁面網址');
  must(c.source_revision&&Number.isFinite(Date.parse(c.source_revision)),'須提供原 Notion 最後修改時間');
  must(c.source_status==='訂購申請待確認'&&c.source_payment_status==='尚未通知付款','僅接受尚未通知付款的原單');
  const item={id:text(l.id,160)||oid+':01',name:text(l.name),sku:text(l.sku),variant:text(l.variant),quantity,unit_price_twd:unitPrice,purchased:0,overseas:0,transit:0,taiwan:0,shipped:0,delivered:0,shipping_units:shippingUnits,shipping_units_confirmed:true,fulfillment_kind:'physical',hold:null};
  must(!s.orders.some(o=>o.items?.some(x=>x.id===item.id)),'原履約項目識別碼已存在，禁止重複匯入',409);
  s.orders.push({id:oid,group_id:c.group_id,name,email:customerEmail,status:'review_pending',items:[item],goods_twd:quantity*unitPrice,first_channel:'transfer',raw_item_text:'',created_at:text(c.original_created_at,60)||now,source_url:sourceURL,source_revision:c.source_revision,source_status:c.source_status,source_payment_status:c.source_payment_status,notified_first:false,legacy_import:{at:now,evidence:text(c.evidence,1000),no_payment_notice:true}});
  changed.push(oid);result={order_id:oid,status:'review_pending',notices_created:0,invoices_created:0};break;
 }
 case 'legacy_reconcile':{result=completeLegacyOperations(s,c,{now,id});break;}
 case 'legacy_payment_reconcile_single':{result=settleLegacyPayment(s,c,{now,id});break;}
 case 'catalog_restore_approved':{
  must(c.confirmed===true,'請確認沿用舊站已公開核准的內容');let published=0;const blocked=[];
  for(const p of s.products||[]){const x=p.source_snapshot;if(x?.published!==true||x.displayMode!=='formal')continue;
   if(!s.groups.some(g=>g.id===p.group_id&&g.status==='open'&&g.deadline&&Date.parse(g.deadline)>Date.parse(now))){blocked.push({id:p.id,reason:'團次未開放或已截止'});continue;}
   if(p.name!==x.title||p.price_twd!==x.price||p.variant!==(x.variantText||'')||p.image_url!==(x.image||'')){blocked.push({id:p.id,reason:'內容與已核准來源不同'});continue;}
   if(p.image_url&&x.imagePublicApproved!==true){blocked.push({id:p.id,reason:'圖片未核准'});continue;}
   if(!p.shipping_units_confirmed){blocked.push({id:p.id,reason:'運費份數待確認'});continue;}
   if(p.status==='sold_out'){blocked.push({id:p.id,reason:'已售完'});continue;}
   if(!p.published){p.published=true;p.image_official=!!p.image_url;p.publication_evidence='舊站已公開核准商品原樣移轉';p.updated_at=now;published++;}
  }result={published,blocked};break;
 }
 case 'catalog_migrate':{
  const g=s.groups.find(g=>g.id===c.group_id);must(g&&c.confirmed,'請確認商品歸屬團次');must(Array.isArray(c.products)&&c.products.length>0&&c.products.length<=500,'商品匯入範圍無效');s.products=s.products||[];let imported=0;
  for(const x of c.products){const pid='catalog:'+text(x.id,160);if(s.products.some(p=>p.id===pid))continue;must(x.id&&text(x.name)&&Number.isSafeInteger(x.price_twd)&&x.price_twd>0,'來源商品價格或名稱不完整');s.products.push({id:pid,group_id:g.id,name:text(x.name),sku:text(x.official_sku||x.id),sku_confirmed:!!x.official_sku,variant:text(x.variant),price_twd:x.price_twd,shipping_units:Number.isSafeInteger(x.shipping_units)&&x.shipping_units>0?x.shipping_units:1,shipping_units_confirmed:Number.isSafeInteger(x.shipping_units)&&x.shipping_units>0,quantity_limit:x.quantity_limit||null,source_url:text(x.source_url||g.source_url,2000),image_url:text(x.image_url,2000),image_official:false,published:false,status:x.status==='sold_out'?'sold_out':'available',source_snapshot:x.source_snapshot||x,updated_at:now});imported++;}result={imported};break;
 }
 case 'catalog_batch_draft':{
  const g=s.groups.find(x=>x.id===c.group_id);
  must(g&&c.confirmed===true,'請確認商品草稿的團次歸屬');
  must(Array.isArray(c.products)&&c.products.length>0&&c.products.length<=500,'商品匯入範圍無效');
  const items=s.products||[],seen=new Set(),pending=[];let skipped=0;
  for(const x of c.products){
   const sourceId=text(x?.id,160),name=text(x?.name),variant=text(x?.variant),url=text(x?.source_url,2000);
   must(sourceId&&sourceId===String(x.id).trim()&&name&&Number.isSafeInteger(x.price_twd)&&x.price_twd>0,'來源商品編號、名稱或售價不完整');
   must(!seen.has(sourceId),'同次匯入含重複來源商品編號：'+sourceId);seen.add(sourceId);
   let parsed;try{parsed=new URL(url);}catch{throw failure('商品來源網址無效：'+sourceId);}
   must(parsed.protocol==='https:','商品須有 HTTPS 官方來源：'+sourceId);
   const image=text(x.image_url,2000);
   if(image){let imageURL;try{imageURL=new URL(image);}catch{throw failure('圖片來源網址無效：'+sourceId);}
    must(imageURL.protocol==='https:','圖片須為 HTTPS：'+sourceId);
   }
   const pid='catalog:'+sourceId,sku=text(x.official_sku||sourceId);
   const old=items.find(p=>p.id===pid);
   if(old){
    must(old.group_id===g.id&&old.name===name&&old.variant===variant&&old.price_twd===x.price_twd&&old.source_url===url&&old.image_url===image&&old.sku===sku&&old.published===false,
     '來源編號已存在但資料不同，請先人工核對：'+sourceId,409);
    skipped++;continue;
   }
   must(!items.some(p=>p.group_id===g.id&&p.sku===sku&&p.variant===variant)&&!pending.some(p=>p.sku===sku&&p.variant===variant),
    '商品貨號與規格重複：'+sourceId,409);
   const units=Number.isSafeInteger(x.shipping_units)&&x.shipping_units>0?x.shipping_units:1;
   pending.push({id:pid,group_id:g.id,name,sku,sku_confirmed:!!x.official_sku,variant,price_twd:x.price_twd,
    shipping_units:units,shipping_units_confirmed:false,quantity_limit:null,source_url:url,image_url:image,
    image_official:false,published:false,status:x.status==='sold_out'?'sold_out':'available',
    source_snapshot:{...x,published:false,group_id:g.id},updated_at:now});
  }
  s.products=items.concat(pending);result={imported:pending.length,skipped};break;
 }
 case 'product_save':{
  must(s.groups.some(g=>g.id===c.group_id),'請指定有效團次');must(text(c.name)&&text(c.sku),'商品名稱與官方貨號必填');money(c.price_twd);must(c.price_twd>0,'售價須大於0');if(c.quantity_limit!==null&&c.quantity_limit!==undefined)positive(c.quantity_limit);
  const validURL=v=>{try{return new URL(v).protocol==='https:'}catch{return false}};
  must(validURL(c.source_url),'請填官方HTTPS來源');if(c.image_url)must(validURL(c.image_url),'圖片必須是HTTPS網址');
  if(c.published)must(c.confirmed===true&&(!c.image_url||c.image_official===true),'上架前須確認商品內容；有圖時須為官方原圖');
  const prior=(s.products||[]).find(p=>p.id===c.id);const pid=prior?.id||id;
  const shippingConfirmed=c.shipping_units_confirmed!==false;
  if(shippingConfirmed)positive(c.shipping_units);
  if(c.published&&!shippingConfirmed)must(c.manual_review_required===true,'國際運費待實算商品必須啟用人工審核申請，不能作為一般訂單');
  must(!(s.products||[]).some(p=>p.id!==pid&&p.group_id===c.group_id&&p.sku===text(c.sku)&&p.variant===text(c.variant)),'同團貨號與規格重複');
  const p={id:pid,group_id:c.group_id,name:text(c.name),sku:text(c.sku),sku_confirmed:c.sku_confirmed===true||(prior?.sku===text(c.sku)&&prior.sku_confirmed===true),variant:text(c.variant),price_twd:c.price_twd,shipping_units:shippingConfirmed?c.shipping_units:null,shipping_units_confirmed:shippingConfirmed,manual_review_required:!shippingConfirmed&&c.manual_review_required===true,quantity_limit:c.quantity_limit||null,source_url:text(c.source_url,2000),image_url:text(c.image_url,2000),image_official:c.image_official===true,published:c.published===true,setting_evidence:text(c.setting_evidence||prior?.setting_evidence,5000),status:c.status==='sold_out'?'sold_out':'available',updated_at:now};
  s.products=s.products||[];if(prior)Object.assign(prior,p);else s.products.push(p);result={product_id:pid};break;
 }
 case 'order_group':{
  const o=order(s,c.order_id);must(c.confirmed&&text(c.evidence),'請確認團次歸屬及依據');must(s.groups.some(g=>g.id===c.group_id),'找不到團次');o.group_id=c.group_id;o.group_evidence=text(c.evidence,2000);result={order_id:o.id};break;
 }
 case 'group_save':{
  const g=s.groups.find(x=>x.id===c.id);must(text(c.title),'請輸入團次名稱');if(c.auto_close)must(c.deadline&&Number.isFinite(Date.parse(c.deadline))&&c.payment_due_at&&Date.parse(c.payment_due_at)>Date.parse(c.deadline),'自動結單須設定有效截止與付款期限');
  if((g?.id||c.id)===BENEFIT_GROUP&&c.auto_close)must(false,'STAR TRACE 須先核實二販結果再由主購結案，不支援到期自動產生一補',409);
  if((g?.id||c.id)===BENEFIT_GROUP&&c.status==='closed')must(g?.sale_phase==='finished','搶購團應先核實一販與二販結果，不可提前標記結單',409);
  if((g?.id||c.id)===BENEFIT_GROUP&&c.status==='closed'&&g?.status!=='closed')must(false,'請使用「結單／產生一補草稿」完成 STAR TRACE 結案；不可從編輯團次直接跳過帳款核對',409);
  if(c.create_only)must(!g,'原團次 ID 已存在，禁止覆寫；請使用編輯團次',409);
  const data={id:g?.id||text(c.id,160)||id,title:text(c.title),deadline:c.deadline||null,payment_due_at:c.payment_due_at||null,source_url:text(c.source_url,2000),auto_close:c.auto_close===true,status:['open','closed','draft','cancelled'].includes(c.status)?c.status:g?.status||'open'};
  if(g)Object.assign(g,data);else s.groups.push(data);result={group_id:data.id};break;
 }
 case 'order_save':{
  const prior=s.orders.find(x=>x.id===c.id);must(!prior||!s.invoices.some(b=>b.order_id===prior.id&&(b.notified||s.allocations.some(a=>a.invoice_id===b.id))),'已通知／收款訂單不可直接改價，請以調整單處理',409);
  must(s.groups.some(g=>g.id===c.group_id&&g.status==='open'),'團次未開放建單');must(email(c.email),'請填有效Email');must(text(c.name),'請填訂購姓名');must(Array.isArray(c.items)&&c.items.length>0&&c.items.length<=50,'請填商品明細');
  const items=c.items.map((l,i)=>({id:prior?.items?.[i]?.id||id+':'+i,name:text(l.name),sku:text(l.sku),variant:text(l.variant),quantity:positive(l.quantity),unit_price_twd:money(l.unit_price_twd),purchased:0,overseas:0,transit:0,taiwan:0,shipped:0,delivered:0,shipping_units:l.shipping_units_confirmed===false?null:positive(l.shipping_units||1),shipping_units_confirmed:l.shipping_units_confirmed!==false,fulfillment_kind:['service','fee','forwarding'].includes(l.fulfillment_kind)?l.fulfillment_kind:'physical',hold:l.hold||null}));must(items.every(x=>x.name),'商品名稱不可空白');
  const reviewRequired=items.some(l=>l.shipping_units_confirmed===false);
  const status=reviewRequired?'review_pending':c.group_id===BENEFIT_GROUP&&c.admission?.status==='waitlisted'?'waitlisted':prior?.status||'active';
  const o={id:prior?.id||text(c.id)||'PL3-'+id,group_id:c.group_id,email:c.email.trim().toLowerCase(),name:text(c.name),status,items,goods_twd:items.reduce((n,l)=>n+l.quantity*l.unit_price_twd,0),first_channel:c.first_channel==='cod'?'cod':'transfer',raw_item_text:'',created_at:prior?.created_at||now,source_url:null,notified_first:false,acceptance:c.acceptance||null,admission:c.admission||prior?.admission||null,application:c.application?{contact:text(c.application.contact,200),delivery_method:text(c.application.delivery_method,200),no_abandon_confirmed:c.application.no_abandon_confirmed===true}:prior?.application||null,benefit_preference:c.benefit_preference?{...c.benefit_preference,...normalizeBenefitPreference(c.benefit_preference)}:prior?.benefit_preference||null};
  if(prior){noticesChanged(s,[prior.id]);Object.assign(prior,o);for(const b of s.invoices.filter(x=>x.order_id===o.id&&x.phase==='first'))b.amount_twd=o.goods_twd;}else s.orders.push(o);if(c.benefit_preference){const campaign=(s.config.benefit_campaigns||[]).find(p=>p.group_id===o.group_id);if(campaign&&!campaign.tickets)campaign.preferences[o.email]={members:o.benefit_preference.members,allow_repeat:o.benefit_preference.allow_repeat,prefer_full_set:o.benefit_preference.prefer_full_set!==false,accept_other:false,evidence:'客人Email驗證後隨訂單 '+o.id+' 提交；'+now};}changed.push(o.id);result={order_id:o.id,status:o.status};break;
 }
 case 'order_review':{
  const o=order(s,c.order_id);must(o.status==='review_pending','僅可審核待人工確認的申請',409);
  must(c.confirmed===true&&text(c.evidence),'請填寫主購確認結果及依據');
  must(!s.invoices.some(b=>b.order_id===o.id&&b.status!=='void'),'申請待審期間不得有付款帳款',409);
  o.status='active';o.review={approved_at:now,evidence:text(c.evidence,2000),items_signature:reviewItemSignature(o.items)};
  changed.push(o.id);result={order_id:o.id,status:o.status};break;
 }
 case 'order_promote':{
  const o=order(s,c.order_id);must(o.group_id===BENEFIT_GROUP&&o.status==='waitlisted','僅可將本團候補單升為可採購單');must(c.confirmed===true&&text(c.evidence),'請確認可用代墊預算及候補升級依據');
  const g=s.groups.find(x=>x.id===o.group_id);must(g?.status==='open'&&Date.parse(g.deadline)>Date.parse(now),'團次已截止，不可自動升級候補',409);
  const admission=starTraceAdmission(s,o.items);must(admission.status==='active','候補單成本仍超過可用代墊額度',409);
  o.status='active';o.admission={...admission,promoted_at:now,promotion_evidence:text(c.evidence,2000)};
  changed.push(o.id);result={order_id:o.id,status:o.status};break;
 }
 case 'order_details':{
  const o=order(s,c.id);must(text(c.name)&&email(c.email),'請填姓名與有效Email');
  if(c.email.trim().toLowerCase()!==o.email?.toLowerCase())must(!s.allocations.some(a=>s.invoices.some(b=>b.id===a.invoice_id&&b.order_id===o.id))&&!s.notices.some(n=>n.order_ids.includes(o.id)&&['sent','sending','unknown'].includes(n.status)),'此單已有款項或寄送紀錄，Email需另行核對身分，不可直接更換',409);
  must(Array.isArray(c.items)&&c.items.length>0&&c.items.length<=50,'請補商品明細');
  const lines=c.items.map((x,i)=>{const old=o.items.find(l=>l.id===x.id);const q=positive(x.quantity),price=money(x.unit_price_twd);must(text(x.name),'商品名稱不可空白');must(!old||q>=old.purchased,'需求數量不得小於已實購');return {...(old||{id:id+':'+i,purchased:0,overseas:0,transit:0,taiwan:0,shipped:0,delivered:0}),name:text(x.name),sku:text(x.sku),variant:text(x.variant),quantity:q,unit_price_twd:price,shipping_units:x.shipping_units_confirmed===false?null:positive(x.shipping_units||1),shipping_units_confirmed:x.shipping_units_confirmed!==false};});
  must(o.items.filter(l=>l.purchased>0).every(l=>lines.some(x=>x.id===l.id)),'不可移除已採購品項');must(lines.reduce((n,l)=>n+l.quantity*l.unit_price_twd,0)===o.goods_twd,'明細總額必須等於原商品款，不能直接改動舊帳');
  if(o.review&&reviewItemSignature(o.items)!==reviewItemSignature(lines)&&lines.some(l=>l.shipping_units_confirmed===false)){o.review=null;o.status='review_pending';}
  o.items=lines;o.name=text(c.name);o.email=c.email.trim().toLowerCase();changed.push(o.id);break;
 }
 case 'star_trace_sale_update':{
  const g=s.groups.find(x=>x.id===BENEFIT_GROUP);must(g,'找不到 STAR TRACE 團次');
  must(c.confirmed===true&&text(c.evidence),'須確認官方一販／二販結果與證據');
  must(['first_complete','second_complete','no_second_sale'].includes(c.phase),'不支援的搶購階段');
  const prior=g.sale_phase||'intake';
  must(prior!=='finished','此團搶購階段已結束，不可覆寫',409);
  if(c.phase==='first_complete')must(prior==='intake','一販結果已登錄，不能重複順延',409);
  else must(prior==='awaiting_second','請先登錄一販結果與順延名單',409);
  g.sale_phase=c.phase==='first_complete'?'awaiting_second':'finished';
  g.sale_result=c.phase;g.sale_evidence=text(c.evidence,2000);g.sale_updated_at=now;
  const remaining=s.orders.filter(o=>o.group_id===BENEFIT_GROUP&&open(o)).flatMap(o=>o.items.filter(l=>l.purchased<l.quantity).map(l=>({order_id:o.id,item_id:l.id,remaining:l.quantity-l.purchased})));
  result={sale_phase:g.sale_phase,carryover:c.phase==='first_complete'?remaining:[],unfulfilled:c.phase!=='first_complete'?remaining:[]};
  break;
 }
 case 'close_group':{
  const g=s.groups.find(x=>x.id===c.group_id);must(g,'找不到團次');must(g.status!=='cancelled','團次已取消');must(c.payment_due_at||g.payment_due_at,'請確認一補付款期限');const due=c.payment_due_at||g.payment_due_at;must(Number.isFinite(Date.parse(due)),'付款期限格式錯誤');
  if(g.id===BENEFIT_GROUP)must(g.sale_phase==='finished','STAR TRACE 一販未購得自動順延二販；須先確認二販結束或官方無二販，禁止提前結單與發付款通知',409);
  g.status='closed';g.closed_at=g.closed_at||now;g.payment_due_at=due;result={drafts:[],blocked:[]};
  for(const o of s.orders.filter(o=>o.group_id===g.id&&open(o))){
   if(/^【未搶到】/.test(o.raw_item_text||'')){result.blocked.push({order_id:o.id,reason:'來源明確標示未搶到，不建立商品款或付款通知'});continue;}
   const confirmedGoods=o.group_id===BENEFIT_GROUP?o.items.reduce((n,l)=>n+l.purchased*l.unit_price_twd,0):o.goods_twd;
   if(o.group_id===BENEFIT_GROUP&&confirmedGoods===0){result.blocked.push({order_id:o.id,reason:'尚無官方實購證據，不建立一補帳款'});continue;}
   let b=s.invoices.find(x=>x.order_id===o.id&&x.phase==='first');
   if(!b){if(!Number.isSafeInteger(confirmedGoods)||confirmedGoods<=0){result.blocked.push({order_id:o.id,reason:'商品款尚未確認'});continue;}b={id:'first:'+o.id,order_id:o.id,phase:'first',amount_twd:confirmedGoods,channel:o.first_channel||'transfer',finalized:true,status:'open',notified:o.notified_first===true,due_at:due,carry_twd:0};s.invoices.push(b);}
   if(b.notified||b.channel==='cod'||balance(s,b)===0)continue;
   try{const n=makeNotice(s,[b.id],'payment',id+':'+o.id,now);result.drafts.push(n.id);}catch(e){result.blocked.push({order_id:o.id,reason:e.message});}
  }break;
 }
 case 'invoice_confirm':{
  const b=invoice(s,c.invoice_id);must(b.phase==='first'&&!b.notified&&!s.allocations.some(a=>a.invoice_id===b.id&&!a.reversed_at),'此帳款請使用既有通知／款項調整流程',409);must(c.confirmed===true&&text(c.evidence),'請確認報價與來源');positive(c.amount_twd);const invoicedOrder=order(s,b.order_id),expected=invoicedOrder.group_id===BENEFIT_GROUP?invoicedOrder.items.reduce((n,l)=>n+l.purchased*l.unit_price_twd,0):invoicedOrder.goods_twd;must(c.amount_twd===expected,'金額須與實際採購商品款一致');b.amount_twd=c.amount_twd;b.finalized=true;b.evidence=text(c.evidence,2000);changed.push(b.order_id);break;
 }
 case 'invoice_due_extend':{
  const b=invoice(s,text(c.invoice_id,200)),o=order(s,b.order_id);
  must(c.confirmed===true&&text(c.reason,2000),'請確認並填寫延長付款期限原因');
  must(open(o)&&b.status==='open'&&b.finalized&&b.channel!=='cod'&&balance(s,b)>0,'此帳款已結清、取消或不可延期',409);
  const previous=text(c.expected_due_at,60),next=text(c.due_at,60);
  must(previous===b.due_at,'帳款期限已被其他操作更新，請重新整理',409);
  must(Number.isFinite(Date.parse(next))&&Date.parse(next)>Date.parse(now)&&Date.parse(next)>Date.parse(previous),'新期限須晚於原期限且為未來時間');
  b.due_at=next;
  b.deadline_changes=b.deadline_changes||[];
  b.deadline_changes.push({id,at:now,from:previous,to:next,reason:text(c.reason,2000)});
  // Sent notices are immutable. Unsigned drafts with stale dependencies are invalidated.
  changed.push(b.order_id);
  result={invoice_id:b.id,previous_due_at:previous,due_at:next,notice_created:false};break;
 }
 case 'first_invoice_issue':{
  const o=order(s,c.order_id),g=s.groups.find(x=>x.id===o.group_id);
  must(open(o)&&g,'訂單無法建立商品款帳款');
  must(c.confirmed===true&&text(c.evidence),'請確認官方採購證據與商品款');
  must(!s.invoices.some(b=>b.order_id===o.id&&b.phase==='first'&&b.status!=='void'),'此訂單已有一補帳款，不可重複建立',409);
  must(o.items.length>0&&o.items.every(l=>l.purchased===l.quantity&&l.quantity>0),'須所有品項已實際購得，未購得品項請勿提前請款');
  must(o.items.every(l=>(s.purchases||[]).reduce((sum,p)=>sum+(p.items||[]).filter(x=>x.order_id===o.id&&x.item_id===l.id).reduce((n,x)=>n+x.quantity,0),0)>=l.quantity),'缺少對應的官方採購紀錄，不能僅憑狀態建立應收');
  const expected=o.items.reduce((sum,l)=>sum+l.quantity*l.unit_price_twd,0);
  positive(expected);must(c.amount_twd===expected,'金額須與實際購得商品款一致');
  const due=text(c.due_at,60)||g.payment_due_at;
  must(due&&Number.isFinite(Date.parse(due)),'請確認付款期限');
  const b={id:'first:'+o.id,order_id:o.id,phase:'first',amount_twd:expected,channel:o.first_channel||'transfer',finalized:true,status:'open',notified:false,due_at:due,carry_twd:0,evidence:text(c.evidence,2000),created_at:now};
  s.invoices.push(b);changed.push(o.id);result={invoice_id:b.id,amount_twd:expected,notice_created:false};break;
 }
 case 'first_invoice_preorder_issue':{
  const o=order(s,c.order_id),g=s.groups.find(x=>x.id===o.group_id);
  must(o.status==='active'&&g?.status==='open','僅可對已確認、仍開團的正式客單建立預購一補',409);
  must(email(o.email)&&text(o.name),'顧客姓名與Email須完整');
  must(c.confirmed===true&&text(c.evidence,2000),'請確認官方可訂購狀態、客單與報價依據');
  must(!s.invoices.some(b=>b.order_id===o.id&&b.phase==='first'&&b.status!=='void'),'此訂單已有一補帳款，不可重複建立',409);
  must(o.items.length>0&&o.items.every(l=>l.quantity>0&&Number.isSafeInteger(l.unit_price_twd)&&l.unit_price_twd>0),'商品規格或報價尚未核對');
  // Shipping units do not affect the goods-only first bill. A customer order
  // with unconfirmed shipping requires its own documented manual approval;
  // never invent a unit count just to release collection.
  if(o.items.some(l=>l.shipping_units_confirmed===false)){
   must(o.review?.approved_at&&text(o.review.evidence)&&(!o.review.items_signature||o.review.items_signature===reviewItemSignature(o.items)),'運費待實算客單須先完成與目前商品明細一致的人工審核',409);
   must(o.items.every(l=>l.shipping_units_confirmed!==false||l.shipping_units==null),'待實算運費份數不得暫填');
  }
  must(o.items.every(l=>l.purchased===0),'已有實購紀錄的客單請使用已購得一補流程');
  const expected=o.items.reduce((sum,l)=>sum+l.quantity*l.unit_price_twd,0);
  positive(expected);must(c.amount_twd===expected,'金額須與訂單商品款一致');
  const due=text(c.due_at,60)||g.payment_due_at;
  must(due&&Number.isFinite(Date.parse(due))&&Date.parse(due)>Date.parse(now),'請設定未來的付款期限');
  const b={id:'first:'+o.id,order_id:o.id,phase:'first',amount_twd:expected,channel:o.first_channel||'transfer',finalized:true,status:'open',notified:false,due_at:due,carry_twd:0,evidence:text(c.evidence,2000),created_at:now,issue_basis:'preorder_confirmed'};
  s.invoices.push(b);changed.push(o.id);result={invoice_id:b.id,amount_twd:expected,notice_created:false};break;
 }
 case 'owner_test_notice':{must(!s.notices.some(n=>n.kind==='owner-test'&&['draft','queued','sending','unknown'].includes(n.status)),'已有未完成的主購驗收信，請先檢視該草稿');const n={id,kind:'owner-test',to:'petitelueur.pl@gmail.com',subject:'【Petite Lueur PL】3.0 寄信驗收',body:'您好：\n\n這是 PL 3.0 官方信箱寄送測試，僅供主購驗收。未建立客戶帳款、未要求付款，也未發送任何客戶通知。\n\nPetite Lueur PL',attachments:[],order_ids:[],invoice_ids:[],status:'draft',version:1,created_at:now};n.dependency=noticeDependency(s,n);s.notices.push(n);result={notice_id:n.id};break;}
 case 'notice_draft':{const n=makeNotice(s,c.invoice_ids,c.kind==='reminder'?'reminder':'payment',id,now);result={notice_id:n.id};break;}
 case 'notice_edit':{
  const n=s.notices.find(x=>x.id===c.notice_id);must(n,'找不到通知');must(['draft','failed'].includes(n.status),'通知已核准或寄出，不能修改',409);must(text(c.subject,200)&&text(c.body,10000),'主旨／內文不可空白');must(!/[\r\n]/.test(c.subject),'主旨不可換行');must(!/實刷|實際利潤|內部成本|女士|小姐|先生/.test(c.body),'對客內容包含內部成本或不適當稱謂');
  n.subject=text(c.subject,200);n.body=text(c.body,10000);if(c.attachments)n.attachments=c.attachments;n.version++;n.dependency=noticeDependency(s,n);break;
 }
 case 'notice_approve':{
  const n=s.notices.find(x=>x.id===c.notice_id);must(n,'找不到通知');must(n.status==='draft'&&n.version===c.version,'通知版本已變動，請重新審核',409);must(c.confirmed===true&&c.content===noticeContent(n),'請確認目前完整收件對象與內文',409);must(n.dependency===noticeDependency(s,n),'帳款／訂單已更新，請重新產生通知',409);must(email(n.to)&&!/[\r\n]/.test(n.subject),'寄送資訊無效');n.status='queued';n.approved_at=now;result={notice_id:n.id,queue:true};break;
 }
 case 'notice_backfill_sent':{
  const n=s.notices.find(x=>x.id===c.notice_id);must(n,'找不到通知');
  must(['draft','failed','unknown'].includes(n.status),'已核准、寄送中或已寄出的通知不可回填',409);
  must(c.version===n.version&&c.content===noticeContent(n),'通知內容或版本已變動，請重新核對',409);
  must(c.confirmed===true&&text(c.evidence,2000)?.length>=8,'請提供 Gmail 寄件備查證據並確認');
  must(typeof c.gmail_message_id==='string'&&/^[A-Za-z0-9_-]{8,160}$/.test(c.gmail_message_id),'Gmail 郵件 ID 格式無效');
  must(!s.notices.some(x=>x.id!==n.id&&x.gmail_message_id===c.gmail_message_id),'這個 Gmail 郵件 ID 已綁定其他通知',409);
  must(n.dependency===noticeDependency(s,n),'帳款／訂單資料已更新，請重新核對通知',409);
  n.status='sent';n.gmail_message_id=c.gmail_message_id;n.gmail_thread_id=text(c.gmail_thread_id,160)||null;
  n.sent_at=c.sent_at;n.backfill_evidence=text(c.evidence,2000);n.backfilled_at=now;n.error_code=null;
  if(['payment','reminder'].includes(n.kind))for(const bid of n.invoice_ids){const b=s.invoices.find(x=>x.id===bid);if(b)b.notified=true;}
  result={notice_id:n.id,backfilled:true};break;
 }
 case 'notice_cancel':{const n=s.notices.find(x=>x.id===c.notice_id);must(n&&['draft','queued','failed'].includes(n.status),'通知不可撤銷',409);n.status='void';break;}
 case 'payment_report':{
  const o=order(s,c.order_id);must(open(o)&&o.email?.toLowerCase()===c.authenticated_email?.toLowerCase(),'禁止回報他人訂單',403);
  positive(c.amount_twd);
  must(['台新銀行','台灣 Pay','中國信託銀行轉帳','中國信託無卡存款','銀行匯款'].includes(c.method),'付款方式無效');
  must(!c.last5||/^\d{5}$/.test(c.last5),'末五碼格式錯誤');
  const reportPhase=c.phase==null||c.phase===''?null:c.phase;
  must(reportPhase===null||['first','second'].includes(reportPhase),'付款階段無效');
  const paidAt=c.paid_at==null||c.paid_at===''?null:text(c.paid_at,60);
  must(!paidAt||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(paidAt)&&Number.isFinite(Date.parse(paidAt)),'請填有效付款日期與時間');
  s.reports=s.reports||[];
  must(!s.reports.some(r=>r.order_id===o.id&&r.status==='pending'&&r.amount_twd===c.amount_twd&&r.last5===(c.last5||'')&&(r.phase??null)===reportPhase&&(!paidAt||!r.paid_at||r.paid_at===paidAt)),'相同回報正在核對，請勿重複',409);
  s.reports.push({id,order_id:o.id,customer_email:o.email,amount_twd:c.amount_twd,method:c.method,last5:c.last5||'',phase:reportPhase,paid_at:paidAt,note:text(c.note,1000),status:'pending',created_at:now});
  result={report_id:id,status:'pending'};break;
 }
 case 'receipt_confirm':{
  must(c.confirmed===true&&text(c.evidence)&&text(c.transaction_id),'請確認真實入帳並填交易識別碼及證據');const codOrder=c.customer_order_id?order(s,c.customer_order_id):null;must(email(c.customer_email)||(codOrder&&!codOrder.email&&codOrder.first_channel==='cod'&&c.kind==='cod_settled'),'收款顧客識別無效；無Email的COD僅可按原訂單核對平台撥款');positive(c.amount_twd);must(['bank_confirmed','cod_settled'].includes(c.kind),'請指定銀行實收或COD實際撥款');must(!s.receipts.some(r=>r.transaction_id===text(c.transaction_id)),'此交易已入帳，請勿重複',409);
  if(c.report_id){const report=(s.reports||[]).find(x=>x.id===c.report_id);must(report&&report.status==='pending','此回報已核對或不存在',409);must(report.customer_email?.toLowerCase()===c.customer_email?.toLowerCase()&&report.amount_twd===c.amount_twd,'付款回報顧客或金額與入帳不符');must(Array.isArray(c.allocations)&&c.allocations.every(a=>{const b=s.invoices.find(b=>b.id===a.invoice_id);return b?.order_id===report.order_id&&(!report.phase||b.phase===report.phase);}), '付款回報與所選客單或付款階段不符');}
  const r={id,transaction_id:text(c.transaction_id),customer_email:email(c.customer_email)?c.customer_email.trim().toLowerCase():null,customer_key:email(c.customer_email)?c.customer_email.trim().toLowerCase():'order:'+codOrder.id,customer_order_id:codOrder?.id||null,amount_twd:c.amount_twd,kind:c.kind,evidence:text(c.evidence,2000),received_at:c.received_at||now};s.receipts.push(r);allocate(s,r,c.allocations);changed.push(...c.allocations.map(a=>invoice(s,a.invoice_id).order_id));if(c.report_id){const report=(s.reports||[]).find(x=>x.id===c.report_id);must(report&&report.customer_email===r.customer_email,'付款回報歸屬不符');report.status='confirmed';report.receipt_id=r.id;}result={receipt_id:r.id,credit_twd:credit(s,r)};break;
 }
 case 'receipt_link_reports':{
  must(c.confirmed===true&&text(c.evidence,2000),'請核對原銀行交易與跨客單分配並填寫證據');
  const r=s.receipts.find(x=>x.id===c.receipt_id);must(r,'找不到既有實收紀錄',404);
  must(text(c.expected_transaction_id)===r.transaction_id,'原實收交易識別碼已變更，請重新整理',409);
  must(Array.isArray(c.report_ids)&&c.report_ids.length>0&&c.report_ids.length<=30&&new Set(c.report_ids).size===c.report_ids.length,'請選擇不重複的付款回報');
  for(const rid of c.report_ids){
   const report=(s.reports||[]).find(x=>x.id===rid);
   must(reportMatchesExistingReceipt(s,report,r),'付款回報與既有銀行入帳／客單分配不符，或已完成核對',409);
  }
  for(const rid of c.report_ids){
   const report=s.reports.find(x=>x.id===rid);
   report.status='confirmed';report.receipt_id=r.id;
   report.linked_existing_receipt_at=now;report.link_evidence=text(c.evidence,2000);
  }
  result={receipt_id:r.id,report_ids:[...c.report_ids],linked_reports:c.report_ids.length,receipts_created:0,allocations_created:0,notices_created:0};break;
 }
 case 'first_payment_confirmation_backfill':{
  must(c.confirmed===true&&text(c.evidence,1000),'請提供人工核對依據');
  const b=invoice(s,c.invoice_id);must(b.phase==='first'&&b.finalized&&balance(s,b)===0,'一補尚未確認清償');
  must(s.allocations.some(a=>a.invoice_id===b.id&&!a.reversed_at),'缺少實際核帳分配，不能補建確認信');
  const n=makePaidConfirmationDraft(s,b,id,now);must(n,'此單不符合付款確認通知條件');
  must(n.id===id&&n.status==='draft','此單已有付款確認通知紀錄，請先核對，不得重複建立');
  result={notice_id:n.id,created:n.id===id};break;
 }
 case 'receipt_date_correct':{
  const r=s.receipts.find(x=>x.id===c.receipt_id);
  must(r&&c.confirmed===true&&text(c.evidence),'請確認原收款與日期更正證據');
  must(r.received_at===c.expected_received_at,'收款日期已變動，請重新整理再核對',409);
  const value=text(c.received_at,10);
  must(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'請填有效實際入帳日期 YYYY-MM-DD');
  must(value!==r.received_at,'日期未變更');
  r.date_corrections=r.date_corrections||[];
  r.date_corrections.push({id,at:now,previous_received_at:r.received_at,received_at:value,evidence:text(c.evidence,2000)});
  r.received_at=value;
  changed.push(...s.allocations.filter(a=>a.receipt_id===r.id&&!a.reversed_at).map(a=>invoice(s,a.invoice_id).order_id));
  result={receipt_id:r.id,received_at:value};break;
 }
 case 'credit_allocate':{const r=s.receipts.find(x=>x.id===c.receipt_id);must(r&&c.confirmed===true,'請確認抵用來源');allocate(s,r,c.allocations);changed.push(...c.allocations.map(a=>invoice(s,a.invoice_id).order_id));break;}
 case 'carry_to_second':{
  const o=order(s,c.order_id),a=s.invoices.find(x=>x.order_id===o.id&&x.phase==='first');must(a&&a.finalized,'一補尚未確認');positive(c.amount_twd);must(c.amount_twd<=balance(s,a)&&c.confirmed===true&&text(c.evidence),'請確認尾款移轉及證據');let b=s.invoices.find(x=>x.order_id===o.id&&x.phase==='second');
  if(!b){b={id:'second:'+o.id,order_id:o.id,phase:'second',amount_twd:null,channel:'transfer',finalized:false,status:'draft',notified:false,carry_twd:0};s.invoices.push(b);}must(!b.notified&&!s.allocations.some(x=>x.invoice_id===b.id),'二補已通知／收款，不能直接移轉',409);must(!b.carry_twd,'此單已記錄尾款移轉',409);
  a.amount_twd-=c.amount_twd;b.carry_twd=c.amount_twd;b.carry_evidence=text(c.evidence,2000);
  if(b.amount_twd!==null){must(typeof c.included_in_second==='boolean','請確認來源二補是否已含此尾款');if(!c.included_in_second)b.amount_twd+=c.amount_twd;else must(b.amount_twd>=c.amount_twd,'二補金額小於移入尾款');}changed.push(o.id);break;
 }
 case 'hold_release':{const o=order(s,c.order_id),l=o.items.find(x=>x.id===c.item_id);must(l?.hold&&c.confirmed===true&&text(c.evidence),'請確認解除條件與證據');l.hold={...l.hold,released_at:now,release_evidence:text(c.evidence,2000)};break;}
 case 'purchase_record':{
  must(text(c.official_order)&&text(c.shop)&&text(c.evidence),'請填官方訂單、通路與證據');must(['JPY','KRW','TWD'].includes(c.currency),'幣別無效');money(c.original_amount);money(c.actual_twd);must(Array.isArray(c.items)&&c.items.length>0,'請指定實購品項');
  must(!s.purchases.some(p=>p.shop===text(c.shop)&&p.official_order===text(c.official_order)),'官方訂單已登錄，請勿重複',409);
  const budgetMode=c.budget_mode||'current';
  must(['current','historical'].includes(budgetMode),'信用卡預算處理方式無效');
  if(budgetMode==='historical'){
   const purchasedAt=text(c.purchased_at,10),todayTaipei=new Date(new Date(now).getTime()+8*60*60*1000).toISOString().slice(0,10);
   must(/^\d{4}-\d{2}-\d{2}$/.test(purchasedAt)&&!Number.isNaN(Date.parse(purchasedAt))&&new Date(purchasedAt).toISOString().slice(0,10)===purchasedAt&&purchasedAt<=todayTaipei,'已付款補登須填不晚於今日的實際官方下單日期');
   must(c.historical_confirmed===true&&text(c.historical_reason),'請確認這是過去已完成刷卡的採購，並填補登原因與核實依據');
  }else if(c.actual_twd>0){must(s.config.card_available_twd!==null,'請先確認信用卡實際可用額度');must(c.actual_twd<=s.config.card_available_twd&&c.actual_twd<=s.config.card_limit_twd,'超過已確認可用額度／單批上限');}
  validatePurchaseItems(s,c.items,{approved:c.advance_approved,reason:c.advance_reason});
  const cardBudgetImpact=budgetMode==='current'?c.actual_twd:0;
  if(cardBudgetImpact)s.config.card_available_twd-=cardBudgetImpact;
  s.purchases.push({id,shop:text(c.shop),official_order:text(c.official_order),evidence:text(c.evidence,2000),currency:c.currency,original_amount:c.original_amount,actual_twd:c.actual_twd||null,budget_mode:budgetMode,purchased_at:budgetMode==='historical'?text(c.purchased_at,10):null,historical_reason:budgetMode==='historical'?text(c.historical_reason,2000):null,card_budget_impact_twd:cardBudgetImpact,items:c.items.map(x=>({...x})),created_at:now});result={purchase_id:id,allocated_items:c.items.length,card_budget_impact_twd:cardBudgetImpact};break;
 }
 case 'purchase_allocate':{
  const p=s.purchases.find(x=>x.id===c.purchase_id);must(p,'找不到既有官方訂單',404);
  must(c.confirmed===true&&text(c.evidence),'請確認官方訂單證明及追加分配依據');
  must(c.expected_original_amount===p.original_amount,'官方訂單金額已變動，請重新整理核對',409);
  money(c.original_amount);must(c.original_amount>=p.original_amount,'官方訂單總額不得在追加分配時調低');
  validatePurchaseItems(s,c.items,{approved:c.advance_approved,reason:c.advance_reason},p.items);
  const before=p.original_amount;p.items.push(...c.items.map(x=>({...x})));
  p.original_amount=c.original_amount;
  p.allocation_history=p.allocation_history||[];
  p.allocation_history.push({id,at:now,evidence:text(c.evidence,2000),items:c.items.map(x=>({...x})),previous_original_amount:before,original_amount:p.original_amount});
  result={purchase_id:p.id,official_order:p.official_order,allocated_items:c.items.length,official_order_total_original:p.original_amount,card_charge_added_twd:0};break;
 }
 case 'movement_record':{
  const stages=['purchased','overseas','transit','taiwan','shipped','delivered'];must(['overseas','transit','taiwan','delivered'].includes(c.stage),'此階段請使用專用出貨操作');must(text(c.evidence),'請填物流／入庫證據');must(Array.isArray(c.items)&&c.items.length>0,'請指定品項');
  for(const x of c.items){const o=order(s,x.order_id),l=o.items.find(i=>i.id===x.item_id);must(l&&open(o),'找不到有效品項');must(!['fee','service'].includes(l.fulfillment_kind),'服務與手續費不能登錄實物物流');positive(x.quantity);const prev=stages[stages.indexOf(c.stage)-1];must(x.quantity<=(l.fulfillment_kind==='forwarding'&&c.stage==='overseas'?l.quantity:l[prev])-l[c.stage],'超過上一階段已確認數量');l[c.stage]+=x.quantity;}
  result={stage:c.stage};break;
 }
 case 'second_settle':{
  const o=order(s,c.order_id);must(open(o)&&c.confirmed===true&&text(c.evidence),'請確認費用來源');const costs=['japan','international','packaging','tax','domestic'].map(k=>({kind:k,amount_twd:money(c.costs?.[k]??0)}));let b=s.invoices.find(x=>x.order_id===o.id&&x.phase==='second');
  must(!b||(!b.notified&&!s.allocations.some(a=>a.invoice_id===b.id)),'二補已通知／收款，須另建調整紀錄',409);const carry=b?.carry_twd||0;
  if(!b){b={id:'second:'+o.id,order_id:o.id,phase:'second',carry_twd:0,notified:false,status:'open',channel:'transfer'};s.invoices.push(b);}Object.assign(b,{amount_twd:costs.reduce((n,x)=>n+x.amount_twd,0)+carry,finalized:true,costs,evidence:text(c.evidence,2000),due_at:c.due_at||null,status:'open'});changed.push(o.id);result={invoice_id:b.id};break;
 }
 case 'shipment_record':{
  must(text(c.tracking)&&text(c.carrier)&&text(c.recipient)&&text(c.destination)&&text(c.phone),'請填物流單號、配送方式與完整收件資料');must(c.confirmed===true&&Array.isArray(c.items)&&c.items.length>0,'請確認出貨清單');let cod=0;const cod_claims=[];const ids=[...new Set(c.items.map(x=>x.order_id))];
  for(const oid of ids){const o=order(s,oid);must(open(o),'取消單不能出貨');for(const phase of ['first','second']){const b=s.invoices.find(x=>x.order_id===oid&&x.phase===phase);must(b?.finalized&&b.amount_twd!==null,'一補／二補尚未確認');const due=balance(s,b);if(b.channel==='cod'){const reserved=s.shipments.flatMap(sh=>sh.cod_claims||[]).filter(x=>x.invoice_id===b.id).reduce((n,x)=>n+x.amount_twd,0);const collect=Math.max(0,due-reserved);cod+=collect;if(collect)cod_claims.push({invoice_id:b.id,amount_twd:collect});}else must(due===0,'尚有未收款項，不能出貨');}}
  must(c.expected_cod_twd===cod,'商品COD金額已變動，請重新確認寄件金額',409);
  for(const x of c.items){const o=order(s,x.order_id),l=o.items.find(i=>i.id===x.item_id);must(l,'找不到品項');must(!['fee','service'].includes(l.fulfillment_kind),'服務與手續費不能登錄實物出貨');positive(x.quantity);must(x.quantity<=l.taiwan-l.shipped,'超過台灣倉可寄數量');l.shipped+=x.quantity;}
  must(!s.shipments.some(x=>x.carrier===text(c.carrier)&&x.tracking===text(c.tracking)),'物流單號已登錄',409);
  const shipment={id,carrier:text(c.carrier),tracking:text(c.tracking),recipient:text(c.recipient),phone:text(c.phone),destination:text(c.destination,1000),items:c.items,cod_twd:cod,cod_claims,created_at:now};s.shipments.push(shipment);
  for(const oid of ids){const o=order(s,oid);if(!email(o.email))continue;const n={id:id+':'+oid,kind:'shipping',to:o.email,subject:'【Petite Lueur PL】出貨通知｜'+oid,body:`您好：\n\n訂單 ${oid} 已完成本次寄件登錄。\n配送方式：${shipment.carrier}\n物流單號：${shipment.tracking}\n${cod?'貨到付款金額請依寄件單與查單資訊核對。\n':''}\nPetite Lueur PL`,attachments:[],order_ids:[oid],invoice_ids:[],status:'draft',version:1,created_at:now};n.dependency=noticeDependency(s,n);s.notices.push(n);}result={shipment_id:id};break;
 }
 case 'order_cancel':{const o=order(s,c.order_id);must(open(o)||['waitlisted','review_pending'].includes(o.status),'已完成或取消的訂單不可直接取消');must(c.confirmed===true&&text(c.reason),'請確認取消原因');must(o.items.every(l=>!l.purchased&&!l.overseas&&!l.transit&&!l.taiwan&&!l.shipped),'已有實購或到倉品項，請先處理官方取消／退款或售後');o.status='cancelled';for(const b of s.invoices.filter(x=>x.order_id===o.id)){b.status='void';for(const a of s.allocations.filter(x=>x.invoice_id===b.id&&!x.reversed_at))a.reversed_at=now;}changed.push(o.id);break;}
 case 'refund_record':{const r=s.receipts.find(x=>x.id===c.receipt_id);must(r&&c.confirmed===true&&text(c.evidence)&&text(c.reference),'請確認實際退款及證據');positive(c.amount_twd);must(!s.refunds.some(x=>x.reference===text(c.reference)),'退款交易已登錄',409);must(c.amount_twd<=credit(s,r),'退款超過未分配餘額；已分配款項須先完成帳務調整');s.refunds.push({id,receipt_id:r.id,amount_twd:c.amount_twd,reference:text(c.reference),evidence:text(c.evidence,2000),created_at:now});break;}
 case 'card_budget':{must(c.confirmed===true&&text(c.evidence),'請確認真實卡額');money(c.available_twd);positive(c.limit_twd);s.config={...s.config,card_available_twd:c.available_twd,card_limit_twd:c.limit_twd,card_evidence:text(c.evidence,2000),card_updated_at:now};break;}
 case 'payment_accounts_config':{
  must(c.confirmed===true,'請確認要儲存收款帳號');
  const bankTransfer=text(c.bank_transfer,32),ctbcCash=text(c.ctbc_cash,32);
  must(/^\d{10,16}$/.test(bankTransfer)&&/^\d{10,16}$/.test(ctbcCash),'兩組收款帳號皆須為 10～16 位數字');
  s.config={...s.config,payment_accounts:{bank_transfer:bankTransfer,ctbc_cash:ctbcCash},payment_accounts_updated_at:now};
  // Keep full account numbers out of commands' result and operations history.
  result={updated:true,bank_transfer_last4:bankTransfer.slice(-4),ctbc_cash_last4:ctbcCash.slice(-4)};
  break;
 }
 default:throw failure('不支援的操作');
 }
 if(changed.length)noticesChanged(s,changed);
 // Create the confirmation AFTER invalidating stale payment requests; otherwise
 // noticesChanged would void the fresh draft in the same operation.
 if(['receipt_confirm','credit_allocate'].includes(c.type)){
  const drafts=[];
  for(const bid of new Set((c.allocations||[]).map(a=>a.invoice_id))){
   const b=invoice(s,bid);
   const n=makePaidConfirmationDraft(s,b,id+':paid:'+bid,now);
   if(n?.created_at===now&&n.id===id+':paid:'+bid)drafts.push(n.id);
  }
  result={...result,payment_confirmation_drafts:drafts};
 }
 s.history.push({id,type:c.type,at:now,result});if(s.history.length>500)s.history=s.history.slice(-500);
 return {state:s,result};
}
export function operationalTasks(s,now=new Date().toISOString()){
 const tasks=[];const add=(type,id,title,detail,priority=2)=>tasks.push({id:type+':'+id,type,object_id:id,title,detail,priority});
 const starGroup=s.groups.find(g=>g.id===BENEFIT_GROUP);if(starGroup?.sale_phase==='awaiting_second')add('star_trace',starGroup.id,'一販未購得品項順延二販','原訂單保留，待官方二販結果確認後再結單',1);
 for(const o of s.orders.filter(o=>o.status==='review_pending'))add('order',o.id,'待實算申請需主購人工審核',o.id+' · 不產生帳款或付款通知',1);
 for(const g of s.groups)if(g.status==='open'&&g.deadline&&g.deadline<now&&!(g.id===BENEFIT_GROUP&&g.sale_phase!=='finished'))add('group',g.id,'團次已到結單時間',g.title,1);
 for(const n of s.notices)if(['draft','failed','unknown','queued'].includes(n.status))add('notice',n.id,n.status==='draft'?'通知待審核':n.status==='unknown'?'寄送結果不明，禁止直接重寄':n.status==='queued'?'通知待寄出':'通知失敗',n.subject,n.status==='unknown'?0:1);
 for(const r of s.reports||[])if(r.status==='pending')add('report',r.id,'客人付款回報待核帳',r.order_id+' · NT$'+r.amount_twd,1);
 for(const b of s.invoices){if(b.status==='void')continue;const due=balance(s,b);if(!b.finalized)add('invoice',b.id,'帳款金額待確認',b.order_id);else if(due>0&&b.channel==='cod')add('invoice',b.id,'貨到付款待平台撥款',b.order_id+' · NT$'+due);else if(due>0)add('invoice',b.id,b.due_at&&b.due_at<now?'付款已逾期':'等待付款',b.order_id+' · NT$'+due,b.due_at&&b.due_at<now?1:3);}
 for(const p of s.purchases)if(p.actual_twd===null)add('purchase',p.id,'實際刷卡金額待核對',p.shop+' · '+p.official_order,1);
 for(const b of s.invoices)if(b.finalized&&b.amount_twd!==null&&balance(s,b)===null)add('invoice',b.id,'歷史已核對款項待補入帳證據',b.order_id+' · 不列為未付款、不催繳',1);
 for(const o of s.orders.filter(open)){if(!email(o.email)&&o.first_channel!=='cod')add('order',o.id,'缺少Email，無法通知',o.id,1);if(!o.items.length)add('order',o.id,'商品明細待補齊',o.id,1);for(const l of o.items.filter(l=>!['service','fee'].includes(l.fulfillment_kind))){if(l.hold&&!l.hold.released_at)add('purchase',l.id,'採購延後，須確認解除條件',o.id+' · '+l.name+' · '+l.hold.until,1);else if(l.fulfillment_kind==='forwarding'&&l.overseas<l.quantity)add('warehouse',l.id,'轉運品等待海外倉入庫',o.id+' · '+l.name);else if(l.fulfillment_kind!=='forwarding'&&l.purchased<l.quantity&&firstPaid(s,o))add('purchase',l.id,'可採購',o.id+' · '+l.name+' ×'+(l.quantity-l.purchased));if(l.purchased>l.overseas)add('warehouse',l.id,'等待海外倉入庫',o.id+' · '+l.name,3);if(l.taiwan>l.shipped)add('shipment',l.id,'台灣倉待出貨',o.id+' · '+l.name);}}
 for(const r of s.service_requests||[]){if(r.status==='pending')add('service',r.id,'委託待核實報價',r.description,1);if(r.status==='accepted'&&['payment','korea'].includes(r.kind)&&firstPaid(s,order(s,r.order_id)))add('service',r.id,'已收款委託待實際履行',r.description,1);}
 for(const r of s.receipts)if(credit(s,r)>0)add('credit',r.id,'溢付款待分配／退款',r.customer_email+' · NT$'+credit(s,r));
 return tasks.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
}

export function operatingStatus(s,o){
 if(o.status==='cancelled')return '已取消';if(o.status==='excluded')return '取消／缺貨歷史';if(o.status==='waitlisted')return '候補中／尚未取得採購名額';if(o.status==='review_pending')return '申請已送出／待主購人工審核（暫不付款）';
 if(o.status==='completed')return '已完成';const lines=(o.items||[]).filter(l=>!['service','fee'].includes(l.fulfillment_kind)),sum=k=>lines.reduce((n,l)=>n+(Number(l[k])||0),0),q=sum('quantity');
 if(q&&sum('delivered')===q)return '已完成';if(sum('shipped')>0)return sum('shipped')===q?'台灣已寄出':'部分已寄出';
 const bills=s.invoices.filter(b=>b.order_id===o.id&&b.status!=='void'),second=bills.find(b=>b.phase==='second'),first=bills.find(b=>b.phase==='first');
 if(q&&sum('taiwan')>0){if(!second?.finalized)return '商品抵台／待二補結算';if(balance(s,second)>0)return second.channel==='cod'?'抵台／二補貨到付款':'等待第二次付款';return '抵台／待出貨';}
 if(sum('transit')>0)return '國際運送中';if(sum('overseas')>0)return '海外倉庫已到貨';
 const sale=o.group_id===BENEFIT_GROUP?s.groups.find(g=>g.id===BENEFIT_GROUP)?.sale_phase:null;
 if(sum('purchased')>0){if(sale==='awaiting_second'&&sum('purchased')<q)return '部分已購得／餘量順延二販';return sum('purchased')===q?'預購等待中':sale==='finished'?'部分購得／未購得待公告':'部分已採購';}
 if(sale==='awaiting_second')return '一販未購得／自動順延二販';
 if(sale==='finished')return '搶購未購得／待退款或結案公告';
 if(lines.some(l=>l.hold&&!l.hold.released_at))return '採購延後／待確認解除';if(first?.finalized&&balance(s,first)===0)return o.service_kind==='forwarding'?'轉運品等待海外倉入庫':['payment','korea'].includes(o.service_kind)?'已收款／待執行服務':'已收款／待採購';if(first?.channel==='cod')return '商品款貨到付款';if(first?.finalized&&balance(s,first)>0)return '待第一階段付款';return o.source_status||'訂購申請待確認';
}
