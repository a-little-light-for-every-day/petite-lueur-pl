// PL operating model. Pure commands, explicit evidence, no external calls.
const failure=(m,status=400)=>Object.assign(new Error(m),{status});
const must=(ok,m,status=400)=>{if(!ok)throw failure(m,status);};
const text=(v,n=300)=>String(v??'').trim().slice(0,n);
const email=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''))&&!/[\r\n]/.test(v);
const money=v=>{must(Number.isSafeInteger(v)&&v>=0,'金額須為非負整數');return v;};
const positive=v=>{must(Number.isSafeInteger(v)&&v>0,'數量／金額須為正整數');return v;};
export const newOperations=()=>({schema:1,products:[],groups:[],orders:[],invoices:[],receipts:[],allocations:[],notices:[],purchases:[],shipments:[],refunds:[],reports:[],config:{card_limit_twd:22000,card_available_twd:null},history:[]});
export const balance=(s,b)=>{if(b.status==='void')return 0;if(b.amount_twd===null)return null;const allocated=s.allocations.filter(x=>x.invoice_id===b.id&&!x.reversed_at).reduce((n,x)=>n+x.amount_twd,0);const sourceVerified=b.phase==='first'?['第一階段已核對','第二次付款已核對'].includes(b.source_status):b.source_status==='第二次付款已核對';if(sourceVerified&&b.amount_twd>allocated)return null;return Math.max(0,b.amount_twd-allocated);};
export const credit=(s,r)=>r.amount_twd-s.allocations.filter(x=>x.receipt_id===r.id&&!x.reversed_at).reduce((n,x)=>n+x.amount_twd,0)-s.refunds.filter(x=>x.receipt_id===r.id).reduce((n,x)=>n+x.amount_twd,0);
const order=(s,id)=>{const o=s.orders.find(x=>x.id===id);must(o,'找不到訂單',404);return o;};
const invoice=(s,id)=>{const x=s.invoices.find(x=>x.id===id);must(x,'找不到帳款',404);return x;};
const open=o=>!['cancelled','excluded'].includes(o.status);
const firstPaid=(s,o)=>{const b=s.invoices.find(x=>x.order_id===o.id&&x.phase==='first');return b&&b.finalized&&balance(s,b)===0;};
const noticesChanged=(s,ids)=>{for(const n of s.notices)if(!['sent','sending','unknown'].includes(n.status)&&n.order_ids.some(id=>ids.includes(id)))n.status='void';};
export function noticeDependency(s,n){return JSON.stringify({orders:n.order_ids.map(id=>{const o=order(s,id);return [id,o.email,o.status,o.name];}),invoices:n.invoice_ids.map(id=>{const b=invoice(s,id);return [id,b.amount_twd,b.finalized,b.channel,b.due_at,b.status,balance(s,b)];})});}
export function noticeContent(n){return JSON.stringify([n.to,n.subject,n.body,n.attachments||[],n.dependency]);}
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
 const list=orders.map(o=>o.id+'\n'+(o.items.length?o.items.map(l=>'・'+l.name+(l.variant?'｜'+l.variant:'')+' ×'+l.quantity+(l.unit_price_twd===null?'':' · NT$'+(l.unit_price_twd*l.quantity))).join('\n'):o.raw_item_text)).join('\n\n');
 const deadlines=[...new Set(bills.map(x=>x.due_at).filter(Boolean))];
 const costLabels={japan:'海外境內運費',international:'國際運費',packaging:'包材',tax:'稅費',domestic:'台灣配送費'};
 const breakdown=bills[0].phase==='second'?bills.map(b=>b.order_id+'\n'+(b.costs||[]).map(x=>'・'+costLabels[x.kind]+'：NT$'+x.amount_twd).join('\n')+(b.carry_twd?'\n・一補轉入尾款：NT$'+b.carry_twd:'')).join('\n\n'):'';
 const n={id,kind,to:orders[0].email,subject:`【Petite Lueur PL】${phase}付款通知｜${orders.length===1?orders[0].id:'合併付款'}`,body:`您好：\n\n${phase}付款資訊如下。\n\n${list}\n\n${breakdown?breakdown+'\n\n':''}本次應付：NT$${total.toLocaleString('en-US')}\n${deadlines.length?'付款期限：'+deadlines.join('、')+'\n':''}\n${phase==='第一階段'?'本次為已確認商品款，後續運費及相關分攤費用於二補另行結算。':'本次為已核准的運費及相關分攤費用；帳款明細以查單頁為準。'}\n付款方式提供銀行匯款、台灣 Pay及中國信託無卡存款，請回覆索取當次收款資料。完成後請提供轉帳日期、金額及末五碼，以利核對；實際以銀行入帳為準。\n\n訂單查詢：https://pl3-staging-api.petitelueur-pl.workers.dev/account\n\nPetite Lueur PL`,attachments:[],order_ids:orders.map(x=>x.id),invoice_ids:ids,status:'draft',version:1,created_at:now};
 n.dependency=noticeDependency(s,n);s.notices.push(n);return n;
}
function allocate(s,r,entries){
 must(Array.isArray(entries)&&entries.length>0,'請指定款項分配');
 for(const a of entries){const b=invoice(s,a.invoice_id),o=order(s,b.order_id);positive(a.amount_twd);must(open(o)&&b.finalized&&b.status!=='void'&&b.amount_twd!==null,'帳款尚未確認或已作廢');must(o.email.toLowerCase()===r.customer_email.toLowerCase(),'禁止跨顧客分配款項');must(b.channel!=='cod'||r.kind==='cod_settled','貨到付款必須確認平台實際撥款');must(a.amount_twd<=b.amount_twd-s.allocations.filter(x=>x.invoice_id===b.id&&!x.reversed_at).reduce((n,x)=>n+x.amount_twd,0)&&a.amount_twd<=credit(s,r),'分配金額超過待收或可用餘額');s.allocations.push({id:r.id+':'+b.id+':'+s.allocations.length,receipt_id:r.id,invoice_id:b.id,amount_twd:a.amount_twd});}
}
export function applyOperation(original,c,{now=new Date().toISOString(),id=crypto.randomUUID()}={}){
 const s=structuredClone(original);must(c&&typeof c.type==='string','操作類型不完整');let result={};const changed=[];
 switch(c.type){
 case 'catalog_migrate':{
  const g=s.groups.find(g=>g.id===c.group_id);must(g&&c.confirmed,'請確認商品歸屬團次');must(Array.isArray(c.products)&&c.products.length>0&&c.products.length<=500,'商品匯入範圍無效');s.products=s.products||[];let imported=0;
  for(const x of c.products){const pid='catalog:'+text(x.id,160);if(s.products.some(p=>p.id===pid))continue;must(x.id&&text(x.name)&&Number.isSafeInteger(x.price_twd)&&x.price_twd>0,'來源商品價格或名稱不完整');s.products.push({id:pid,group_id:g.id,name:text(x.name),sku:text(x.official_sku||x.id),sku_confirmed:!!x.official_sku,variant:text(x.variant),price_twd:x.price_twd,shipping_units:Number.isSafeInteger(x.shipping_units)&&x.shipping_units>0?x.shipping_units:1,shipping_units_confirmed:Number.isSafeInteger(x.shipping_units)&&x.shipping_units>0,quantity_limit:x.quantity_limit||null,source_url:text(x.source_url||g.source_url,2000),image_url:text(x.image_url,2000),image_official:false,published:false,status:x.status==='sold_out'?'sold_out':'available',source_snapshot:x.source_snapshot||x,updated_at:now});imported++;}result={imported};break;
 }
 case 'product_save':{
  must(s.groups.some(g=>g.id===c.group_id),'請指定有效團次');must(text(c.name)&&text(c.sku),'商品名稱與官方貨號必填');money(c.price_twd);must(c.price_twd>0,'售價須大於0');positive(c.shipping_units);if(c.quantity_limit!==null&&c.quantity_limit!==undefined)positive(c.quantity_limit);
  const validURL=v=>{try{return new URL(v).protocol==='https:'}catch{return false}};
  must(validURL(c.source_url),'請填官方HTTPS來源');must(!/animate/i.test(c.source_url),'Animate不列為商業採購通路');if(c.image_url)must(validURL(c.image_url),'圖片必須是HTTPS網址');
  if(c.published)must(c.confirmed===true&&c.image_official===true&&c.image_url,'上架前須確認官方原圖與商品內容');
  const prior=(s.products||[]).find(p=>p.id===c.id);const pid=prior?.id||id;
  must(!(s.products||[]).some(p=>p.id!==pid&&p.group_id===c.group_id&&p.sku===text(c.sku)&&p.variant===text(c.variant)),'同團貨號與規格重複');
  const p={id:pid,group_id:c.group_id,name:text(c.name),sku:text(c.sku),sku_confirmed:true,variant:text(c.variant),price_twd:c.price_twd,shipping_units:c.shipping_units,shipping_units_confirmed:true,quantity_limit:c.quantity_limit||null,source_url:text(c.source_url,2000),image_url:text(c.image_url,2000),image_official:c.image_official===true,published:c.published===true,status:c.status==='sold_out'?'sold_out':'available',updated_at:now};
  s.products=s.products||[];if(prior)Object.assign(prior,p);else s.products.push(p);result={product_id:pid};break;
 }
 case 'order_group':{
  const o=order(s,c.order_id);must(c.confirmed&&text(c.evidence),'請確認團次歸屬及依據');must(s.groups.some(g=>g.id===c.group_id),'找不到團次');o.group_id=c.group_id;o.group_evidence=text(c.evidence,2000);result={order_id:o.id};break;
 }
 case 'group_save':{
  const g=s.groups.find(x=>x.id===c.id);must(text(c.title),'請輸入團次名稱');if(c.auto_close)must(c.deadline&&Number.isFinite(Date.parse(c.deadline))&&c.payment_due_at&&Date.parse(c.payment_due_at)>Date.parse(c.deadline),'自動結單須設定有效截止與付款期限');
  const data={id:g?.id||text(c.id,160)||id,title:text(c.title),deadline:c.deadline||null,payment_due_at:c.payment_due_at||null,source_url:text(c.source_url,2000),auto_close:c.auto_close===true,status:['open','closed','draft','cancelled'].includes(c.status)?c.status:g?.status||'open'};
  if(g)Object.assign(g,data);else s.groups.push(data);result={group_id:data.id};break;
 }
 case 'order_save':{
  const prior=s.orders.find(x=>x.id===c.id);must(!prior||!s.invoices.some(b=>b.order_id===prior.id&&(b.notified||s.allocations.some(a=>a.invoice_id===b.id))),'已通知／收款訂單不可直接改價，請以調整單處理',409);
  must(s.groups.some(g=>g.id===c.group_id&&g.status==='open'),'團次未開放建單');must(email(c.email),'請填有效Email');must(text(c.name),'請填訂購姓名');must(Array.isArray(c.items)&&c.items.length>0&&c.items.length<=50,'請填商品明細');
  const items=c.items.map((l,i)=>({id:prior?.items?.[i]?.id||id+':'+i,name:text(l.name),sku:text(l.sku),variant:text(l.variant),quantity:positive(l.quantity),unit_price_twd:money(l.unit_price_twd),purchased:0,overseas:0,transit:0,taiwan:0,shipped:0,delivered:0,shipping_units:positive(l.shipping_units||1),hold:l.hold||null}));must(items.every(x=>x.name),'商品名稱不可空白');
  const o={id:prior?.id||text(c.id)||'PL3-'+id,group_id:c.group_id,email:c.email.trim().toLowerCase(),name:text(c.name),status:'active',items,goods_twd:items.reduce((n,l)=>n+l.quantity*l.unit_price_twd,0),first_channel:c.first_channel==='cod'?'cod':'transfer',raw_item_text:'',created_at:prior?.created_at||now,source_url:null,notified_first:false};
  if(prior){noticesChanged(s,[prior.id]);Object.assign(prior,o);for(const b of s.invoices.filter(x=>x.order_id===o.id&&x.phase==='first'))b.amount_twd=o.goods_twd;}else s.orders.push(o);changed.push(o.id);result={order_id:o.id};break;
 }
 case 'order_details':{
  const o=order(s,c.id);must(text(c.name)&&email(c.email),'請填姓名與有效Email');
  if(c.email.trim().toLowerCase()!==o.email?.toLowerCase())must(!s.allocations.some(a=>s.invoices.some(b=>b.id===a.invoice_id&&b.order_id===o.id))&&!s.notices.some(n=>n.order_ids.includes(o.id)&&['sent','sending','unknown'].includes(n.status)),'此單已有款項或寄送紀錄，Email需另行核對身分，不可直接更換',409);
  must(Array.isArray(c.items)&&c.items.length>0&&c.items.length<=50,'請補商品明細');
  const lines=c.items.map((x,i)=>{const old=o.items.find(l=>l.id===x.id);const q=positive(x.quantity),price=money(x.unit_price_twd);must(text(x.name),'商品名稱不可空白');must(!old||q>=old.purchased,'需求數量不得小於已實購');return {...(old||{id:id+':'+i,purchased:0,overseas:0,transit:0,taiwan:0,shipped:0,delivered:0}),name:text(x.name),sku:text(x.sku),variant:text(x.variant),quantity:q,unit_price_twd:price,shipping_units:positive(x.shipping_units||1)};});
  must(o.items.filter(l=>l.purchased>0).every(l=>lines.some(x=>x.id===l.id)),'不可移除已採購品項');must(lines.reduce((n,l)=>n+l.quantity*l.unit_price_twd,0)===o.goods_twd,'明細總額必須等於原商品款，不能直接改動舊帳');o.items=lines;o.name=text(c.name);o.email=c.email.trim().toLowerCase();changed.push(o.id);break;
 }
 case 'close_group':{
  const g=s.groups.find(x=>x.id===c.group_id);must(g,'找不到團次');must(g.status!=='cancelled','團次已取消');must(c.payment_due_at||g.payment_due_at,'請確認一補付款期限');const due=c.payment_due_at||g.payment_due_at;must(Number.isFinite(Date.parse(due)),'付款期限格式錯誤');
  g.status='closed';g.closed_at=g.closed_at||now;g.payment_due_at=due;result={drafts:[],blocked:[]};
  for(const o of s.orders.filter(o=>o.group_id===g.id&&open(o))){
   let b=s.invoices.find(x=>x.order_id===o.id&&x.phase==='first');
   if(!b){if(!Number.isSafeInteger(o.goods_twd)||o.goods_twd<=0){result.blocked.push({order_id:o.id,reason:'商品款尚未確認'});continue;}b={id:'first:'+o.id,order_id:o.id,phase:'first',amount_twd:o.goods_twd,channel:o.first_channel||'transfer',finalized:true,status:'open',notified:o.notified_first===true,due_at:due,carry_twd:0};s.invoices.push(b);}
   if(b.notified||b.channel==='cod'||balance(s,b)===0)continue;
   try{const n=makeNotice(s,[b.id],'payment',id+':'+o.id,now);result.drafts.push(n.id);}catch(e){result.blocked.push({order_id:o.id,reason:e.message});}
  }break;
 }
 case 'invoice_confirm':{
  const b=invoice(s,c.invoice_id);must(b.phase==='first'&&!b.notified&&!s.allocations.some(a=>a.invoice_id===b.id&&!a.reversed_at),'此帳款請使用既有通知／款項調整流程',409);must(c.confirmed===true&&text(c.evidence),'請確認報價與來源');positive(c.amount_twd);must(c.amount_twd===order(s,b.order_id).goods_twd,'金額須與原商品款一致');b.amount_twd=c.amount_twd;b.finalized=true;b.evidence=text(c.evidence,2000);changed.push(b.order_id);break;
 }
 case 'notice_draft':{const n=makeNotice(s,c.invoice_ids,c.kind==='reminder'?'reminder':'payment',id,now);result={notice_id:n.id};break;}
 case 'notice_edit':{
  const n=s.notices.find(x=>x.id===c.notice_id);must(n,'找不到通知');must(['draft','failed'].includes(n.status),'通知已核准或寄出，不能修改',409);must(text(c.subject,200)&&text(c.body,10000),'主旨／內文不可空白');must(!/[\r\n]/.test(c.subject),'主旨不可換行');must(!/實刷|實際利潤|內部成本|女士|小姐|先生/.test(c.body),'對客內容包含內部成本或不適當稱謂');
  n.subject=text(c.subject,200);n.body=text(c.body,10000);if(c.attachments)n.attachments=c.attachments;n.version++;n.dependency=noticeDependency(s,n);break;
 }
 case 'notice_approve':{
  const n=s.notices.find(x=>x.id===c.notice_id);must(n,'找不到通知');must(n.status==='draft'&&n.version===c.version,'通知版本已變動，請重新審核',409);must(c.confirmed===true&&c.content===noticeContent(n),'請確認目前完整收件對象與內文',409);must(n.dependency===noticeDependency(s,n),'帳款／訂單已更新，請重新產生通知',409);must(email(n.to)&&!/[\r\n]/.test(n.subject),'寄送資訊無效');n.status='queued';n.approved_at=now;result={notice_id:n.id,queue:true};break;
 }
 case 'notice_cancel':{const n=s.notices.find(x=>x.id===c.notice_id);must(n&&['draft','queued','failed'].includes(n.status),'通知不可撤銷',409);n.status='void';break;}
 case 'payment_report':{
  const o=order(s,c.order_id);must(open(o)&&o.email.toLowerCase()===c.authenticated_email?.toLowerCase(),'禁止回報他人訂單',403);positive(c.amount_twd);must(['銀行匯款','台灣 Pay','中國信託無卡存款'].includes(c.method),'付款方式無效');must(!c.last5||/^\d{5}$/.test(c.last5),'末五碼格式錯誤');s.reports=s.reports||[];must(!s.reports.some(r=>r.order_id===o.id&&r.status==='pending'&&r.amount_twd===c.amount_twd&&r.last5===(c.last5||'')),'相同回報正在核對，請勿重複',409);s.reports.push({id,order_id:o.id,customer_email:o.email,amount_twd:c.amount_twd,method:c.method,last5:c.last5||'',note:text(c.note,1000),status:'pending',created_at:now});result={report_id:id};break;
 }
 case 'receipt_confirm':{
  must(c.confirmed===true&&text(c.evidence)&&text(c.transaction_id),'請確認真實入帳並填交易識別碼及證據');must(email(c.customer_email),'收款顧客Email無效');positive(c.amount_twd);must(['bank_confirmed','cod_settled'].includes(c.kind),'請指定銀行實收或COD實際撥款');must(!s.receipts.some(r=>r.transaction_id===text(c.transaction_id)),'此交易已入帳，請勿重複',409);
  const r={id,transaction_id:text(c.transaction_id),customer_email:c.customer_email.trim().toLowerCase(),amount_twd:c.amount_twd,kind:c.kind,evidence:text(c.evidence,2000),received_at:c.received_at||now};s.receipts.push(r);allocate(s,r,c.allocations);changed.push(...c.allocations.map(a=>invoice(s,a.invoice_id).order_id));if(c.report_id){const report=(s.reports||[]).find(x=>x.id===c.report_id);must(report&&report.customer_email===r.customer_email,'付款回報歸屬不符');report.status='confirmed';report.receipt_id=r.id;}result={receipt_id:r.id,credit_twd:credit(s,r)};break;
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
  must(text(c.official_order)&&text(c.shop)&&text(c.evidence),'請填官方訂單、通路與證據');must(!/animate|アニメイト/i.test(c.shop),'此通路不列為PL商業代購採購通路');must(['JPY','KRW','TWD'].includes(c.currency),'幣別無效');money(c.original_amount);money(c.actual_twd);must(Array.isArray(c.items)&&c.items.length>0,'請指定實購品項');
  must(!s.purchases.some(p=>p.shop===text(c.shop)&&p.official_order===text(c.official_order)),'官方訂單已登錄，請勿重複',409);
  if(c.actual_twd>0){must(s.config.card_available_twd!==null,'請先確認信用卡實際可用額度');must(c.actual_twd<=s.config.card_available_twd&&c.actual_twd<=s.config.card_limit_twd,'超過已確認可用額度／單批上限');}
  for(const x of c.items){const o=order(s,x.order_id),l=o.items.find(v=>v.id===x.item_id);must(open(o)&&l,'找不到有效品項');positive(x.quantity);must(!l.hold||l.hold.released_at,'品項延後條件尚未解除');must(firstPaid(s,o)||(c.advance_approved===true&&text(c.advance_reason)),'一補未清償；如已核准代墊須明確登錄原因');must(x.quantity<=l.quantity-l.purchased,'實購超過待買數量');l.purchased+=x.quantity;}
  if(c.actual_twd)s.config.card_available_twd-=c.actual_twd;
  s.purchases.push({id,shop:text(c.shop),official_order:text(c.official_order),evidence:text(c.evidence,2000),currency:c.currency,original_amount:c.original_amount,actual_twd:c.actual_twd,items:c.items,created_at:now});break;
 }
 case 'movement_record':{
  const stages=['purchased','overseas','transit','taiwan','shipped','delivered'];must(['overseas','transit','taiwan','delivered'].includes(c.stage),'此階段請使用專用出貨操作');must(text(c.evidence),'請填物流／入庫證據');must(Array.isArray(c.items)&&c.items.length>0,'請指定品項');
  for(const x of c.items){const o=order(s,x.order_id),l=o.items.find(i=>i.id===x.item_id);must(l&&open(o),'找不到有效品項');positive(x.quantity);const prev=stages[stages.indexOf(c.stage)-1];must(x.quantity<=l[prev]-l[c.stage],'超過上一階段已確認數量');l[c.stage]+=x.quantity;}
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
  for(const x of c.items){const o=order(s,x.order_id),l=o.items.find(i=>i.id===x.item_id);must(l,'找不到品項');positive(x.quantity);must(x.quantity<=l.taiwan-l.shipped,'超過台灣倉可寄數量');l.shipped+=x.quantity;}
  must(!s.shipments.some(x=>x.carrier===text(c.carrier)&&x.tracking===text(c.tracking)),'物流單號已登錄',409);
  const shipment={id,carrier:text(c.carrier),tracking:text(c.tracking),recipient:text(c.recipient),phone:text(c.phone),destination:text(c.destination,1000),items:c.items,cod_twd:cod,cod_claims,created_at:now};s.shipments.push(shipment);
  for(const oid of ids){const o=order(s,oid);if(!email(o.email))continue;const n={id:id+':'+oid,kind:'shipping',to:o.email,subject:'【Petite Lueur PL】出貨通知｜'+oid,body:`您好：\n\n訂單 ${oid} 已完成本次寄件登錄。\n配送方式：${shipment.carrier}\n物流單號：${shipment.tracking}\n${cod?'貨到付款金額請依寄件單與查單資訊核對。\n':''}\nPetite Lueur PL`,attachments:[],order_ids:[oid],invoice_ids:[],status:'draft',version:1,created_at:now};n.dependency=noticeDependency(s,n);s.notices.push(n);}result={shipment_id:id};break;
 }
 case 'order_cancel':{const o=order(s,c.order_id);must(c.confirmed===true&&text(c.reason),'請確認取消原因');must(o.items.every(l=>!l.purchased),'已有實購品項，請先處理官方取消／退款或售後');o.status='cancelled';for(const b of s.invoices.filter(x=>x.order_id===o.id)){b.status='void';for(const a of s.allocations.filter(x=>x.invoice_id===b.id&&!x.reversed_at))a.reversed_at=now;}changed.push(o.id);break;}
 case 'refund_record':{const r=s.receipts.find(x=>x.id===c.receipt_id);must(r&&c.confirmed===true&&text(c.evidence)&&text(c.reference),'請確認實際退款及證據');positive(c.amount_twd);must(!s.refunds.some(x=>x.reference===text(c.reference)),'退款交易已登錄',409);must(c.amount_twd<=credit(s,r),'退款超過未分配餘額；已分配款項須先完成帳務調整');s.refunds.push({id,receipt_id:r.id,amount_twd:c.amount_twd,reference:text(c.reference),evidence:text(c.evidence,2000),created_at:now});break;}
 case 'card_budget':{must(c.confirmed===true&&text(c.evidence),'請確認真實卡額');money(c.available_twd);positive(c.limit_twd);s.config={...s.config,card_available_twd:c.available_twd,card_limit_twd:c.limit_twd,card_evidence:text(c.evidence,2000),card_updated_at:now};break;}
 default:throw failure('不支援的操作');
 }
 if(changed.length)noticesChanged(s,changed);
 s.history.push({id,type:c.type,at:now,result});if(s.history.length>500)s.history=s.history.slice(-500);
 return {state:s,result};
}
export function operationalTasks(s,now=new Date().toISOString()){
 const tasks=[];const add=(type,id,title,detail,priority=2)=>tasks.push({id:type+':'+id,type,object_id:id,title,detail,priority});
 for(const g of s.groups)if(g.status==='open'&&g.deadline&&g.deadline<now)add('group',g.id,'團次已到結單時間',g.title,1);
 for(const n of s.notices)if(['draft','failed','unknown','queued'].includes(n.status))add('notice',n.id,n.status==='draft'?'通知待審核':n.status==='unknown'?'寄送結果不明，禁止直接重寄':n.status==='queued'?'通知待寄出':'通知失敗',n.subject,n.status==='unknown'?0:1);
 for(const r of s.reports||[])if(r.status==='pending')add('report',r.id,'客人付款回報待核帳',r.order_id+' · NT$'+r.amount_twd,1);
 for(const b of s.invoices){if(b.status==='void')continue;const due=balance(s,b);if(!b.finalized)add('invoice',b.id,'帳款金額待確認',b.order_id);else if(due>0&&b.channel==='cod')add('invoice',b.id,'貨到付款待平台撥款',b.order_id+' · NT$'+due);else if(due>0)add('invoice',b.id,b.due_at&&b.due_at<now?'付款已逾期':'等待付款',b.order_id+' · NT$'+due,b.due_at&&b.due_at<now?1:3);}
 for(const b of s.invoices)if(b.finalized&&b.amount_twd!==null&&balance(s,b)===null)add('invoice',b.id,'歷史已核對款項待補入帳證據',b.order_id+' · 不列為未付款、不催繳',1);
 for(const o of s.orders.filter(open)){if(!email(o.email))add('order',o.id,'缺少Email，無法通知',o.id,1);if(!o.items.length)add('order',o.id,'商品明細待補齊',o.id,1);for(const l of o.items){if(l.hold&&!l.hold.released_at)add('purchase',l.id,'採購延後，須確認解除條件',o.id+' · '+l.name+' · '+l.hold.until,1);else if(l.purchased<l.quantity&&firstPaid(s,o))add('purchase',l.id,'可採購',o.id+' · '+l.name+' ×'+(l.quantity-l.purchased));if(l.purchased>l.overseas)add('warehouse',l.id,'等待海外倉入庫',o.id+' · '+l.name,3);if(l.taiwan>l.shipped)add('shipment',l.id,'台灣倉待出貨',o.id+' · '+l.name);}}
 for(const r of s.receipts)if(credit(s,r)>0)add('credit',r.id,'溢付款待分配／退款',r.customer_email+' · NT$'+credit(s,r));
 return tasks.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
}

export function operatingStatus(s,o){
 if(o.status==='cancelled')return '已取消';if(o.status==='excluded')return '取消／缺貨歷史';
 const lines=o.items||[],sum=k=>lines.reduce((n,l)=>n+(Number(l[k])||0),0),q=sum('quantity');
 if(q&&sum('delivered')===q)return '已完成';if(sum('shipped')>0)return sum('shipped')===q?'台灣已寄出':'部分已寄出';
 const bills=s.invoices.filter(b=>b.order_id===o.id&&b.status!=='void'),second=bills.find(b=>b.phase==='second'),first=bills.find(b=>b.phase==='first');
 if(q&&sum('taiwan')>0){if(!second?.finalized)return '商品抵台／待二補結算';if(balance(s,second)>0)return second.channel==='cod'?'抵台／二補貨到付款':'等待第二次付款';return '抵台／待出貨';}
 if(sum('transit')>0)return '國際運送中';if(sum('overseas')>0)return '海外倉庫已到貨';if(sum('purchased')>0)return sum('purchased')===q?'預購等待中':'部分已採購';
 if(lines.some(l=>l.hold&&!l.hold.released_at))return '採購延後／待確認解除';if(first?.finalized&&balance(s,first)===0)return '已收款／待採購';if(first?.channel==='cod')return '商品款貨到付款';if(first?.finalized&&balance(s,first)>0)return '待第一階段付款';return o.source_status||'訂購申請待確認';
}
