import {newOperations,applyOperation,operationalTasks,noticeContent,noticeDependency} from './operations-domain.js';
const schema=`CREATE TABLE IF NOT EXISTS pl_ops_state(id TEXT PRIMARY KEY CHECK(id='main'),version INTEGER NOT NULL DEFAULT 0,document_json TEXT NOT NULL CHECK(json_valid(document_json)),last_command_id TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pl_ops_commands(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,actor TEXT NOT NULL,command_type TEXT NOT NULL,result_json TEXT NOT NULL CHECK(json_valid(result_json)),version INTEGER NOT NULL UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pl_ops_mail(id TEXT PRIMARY KEY,notice_id TEXT NOT NULL UNIQUE,snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','sent','failed','unknown','void')),approved_by TEXT NOT NULL,approved_at TEXT NOT NULL,gmail_message_id TEXT,gmail_thread_id TEXT,error_code TEXT,claimed_at TEXT,sent_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pl_ops_attachments(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,base64_data TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`;
export const opsError=(m,status=400)=>Object.assign(new Error(m),{status});
const entityKinds=['products','groups','orders','invoices','receipts','allocations','notices','purchases','shipments','refunds','reports'];
const entitySchema="CREATE TABLE IF NOT EXISTS pl_ops_entities(kind TEXT NOT NULL,id TEXT NOT NULL,document_json TEXT NOT NULL CHECK(json_valid(document_json)),updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS pl_ops_entity_history(command_id TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,version INTEGER NOT NULL,before_json TEXT,after_json TEXT,actor TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(command_id,kind,entity_id));";
const hash=async t=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function installOperations(env){for(const statement of (schema+entitySchema).split(';').map(x=>x.trim()).filter(Boolean))await env.DB.prepare(statement).run();await env.DB.prepare("INSERT OR IGNORE INTO pl_ops_state(id,document_json) VALUES('main',?)").bind(JSON.stringify(newOperations())).run();return {ok:true};}
export async function loadOperations(env){
 const row=await env.DB.prepare("SELECT version,document_json FROM pl_ops_state WHERE id='main'").first();if(!row)throw opsError('營運資料尚未初始化',503);
 const meta=JSON.parse(row.document_json),state={...newOperations(),...meta};
 const entities=await env.DB.prepare('SELECT kind,document_json FROM pl_ops_entities ORDER BY kind,id').all();
 if(!Array.isArray(meta.groups)){for(const kind of entityKinds)state[kind]=[];for(const r of entities.results||[])if(entityKinds.includes(r.kind))state[r.kind].push(JSON.parse(r.document_json));}
 return {version:row.version,state,legacy_document:Array.isArray(meta.groups)};
}
export async function operationsView(env){
 const {version,state}=await loadOperations(env);const mail=await env.DB.prepare('SELECT notice_id,status,gmail_message_id,gmail_thread_id,error_code,sent_at FROM pl_ops_mail ORDER BY updated_at DESC LIMIT 500').all();
 for(const m of mail.results||[]){const n=state.notices.find(x=>x.id===m.notice_id);if(n&&n.status!=='void')Object.assign(n,{status:m.status,gmail_message_id:m.gmail_message_id,gmail_thread_id:m.gmail_thread_id,error_code:m.error_code,sent_at:m.sent_at});}
 return {ok:true,version,state,tasks:operationalTasks(state),capabilities:{mail_enabled:env.PL3_OPS_MAIL_ENABLED==='true',sync:'not_connected',source_mode:'PL2仍為原始來源；此區操作獨立留存，不會自動覆寫舊站'}};
}
async function commit(env,current,next,{key,type,requestHash,actor,result,notice}){
 const changes=[];
 for(const kind of entityKinds){const oldMap=new Map((current.state[kind]||[]).map(x=>[x.id,JSON.stringify(x)]));const seen=new Set();for(const x of next[kind]||[]){const json=JSON.stringify(x);seen.add(x.id);if(current.legacy_document||oldMap.get(x.id)!==json)changes.push({kind,id:x.id,before:oldMap.get(x.id)||null,after:json});}for(const [id,before]of oldMap)if(!seen.has(id))changes.push({kind,id,before,after:null});}
 const metadata=JSON.stringify({schema:next.schema,config:next.config,history:next.history});const changesJson=JSON.stringify(changes);
 const stmts=[env.DB.prepare("UPDATE pl_ops_state SET document_json=?,version=version+1,last_command_id=?,updated_at=CURRENT_TIMESTAMP WHERE id='main' AND version=?").bind(metadata,key,current.version),
 env.DB.prepare("INSERT INTO pl_ops_commands(id,request_hash,actor,command_type,result_json,version) SELECT ?,?,?,?,?,version FROM pl_ops_state WHERE id='main' AND last_command_id=?").bind(key,requestHash,actor,type,JSON.stringify(result),key),
 env.DB.prepare("INSERT INTO pl_ops_entities(kind,id,document_json) SELECT json_extract(value,'$.kind'),json_extract(value,'$.id'),json_extract(value,'$.after') FROM json_each(?) WHERE json_extract(value,'$.after') IS NOT NULL AND EXISTS(SELECT 1 FROM pl_ops_state WHERE id='main' AND last_command_id=?) ON CONFLICT(kind,id) DO UPDATE SET document_json=excluded.document_json,updated_at=CURRENT_TIMESTAMP").bind(changesJson,key),
 env.DB.prepare("DELETE FROM pl_ops_entities WHERE EXISTS(SELECT 1 FROM json_each(?) WHERE json_extract(value,'$.kind')=pl_ops_entities.kind AND json_extract(value,'$.id')=pl_ops_entities.id AND json_extract(value,'$.after') IS NULL) AND EXISTS(SELECT 1 FROM pl_ops_state WHERE id='main' AND last_command_id=?)").bind(changesJson,key),
 env.DB.prepare("INSERT INTO pl_ops_entity_history(command_id,kind,entity_id,version,before_json,after_json,actor) SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.id'),s.version,json_extract(value,'$.before'),json_extract(value,'$.after'),? FROM json_each(?) CROSS JOIN pl_ops_state s WHERE s.id='main' AND s.last_command_id=?").bind(key,actor,changesJson,key)];
 if(notice){const record=JSON.stringify(notice);stmts.push(env.DB.prepare("INSERT INTO pl_ops_mail(id,notice_id,snapshot_json,approved_by,approved_at) SELECT ?,?,?,?,? FROM pl_ops_state WHERE id='main' AND last_command_id=? ON CONFLICT(notice_id) DO UPDATE SET id=excluded.id,snapshot_json=excluded.snapshot_json,status='queued',approved_by=excluded.approved_by,approved_at=excluded.approved_at,error_code=NULL,claimed_at=NULL WHERE pl_ops_mail.status IN('failed','void')").bind(key,notice.id,record,actor,notice.approved_at,key));}
 let res;try{res=await env.DB.batch(stmts);}catch{throw opsError('操作發生衝突，請重新整理後重試',409);}
 if(!res[0]?.meta?.changes)throw opsError('資料已被更新，請重新整理後再操作',409);
 return {ok:true,version:current.version+1,result};
}
export async function executeOperation(body,actor,env,{requestIdentity}={}){
 const {key,version,command}=body||{};if(!/^[\w:-]{8,160}$/.test(key||'')||!Number.isInteger(version))throw opsError('缺少操作識別碼或資料版本');
 const requestHash=await hash(JSON.stringify(requestIdentity===undefined?{version,command}:requestIdentity));const prior=await env.DB.prepare('SELECT request_hash,result_json,version FROM pl_ops_commands WHERE id=?').bind(key).first();
 if(prior){if(prior.request_hash!==requestHash)throw opsError('操作識別碼已被不同內容使用',409);return {ok:true,replayed:true,version:prior.version,result:JSON.parse(prior.result_json)};}
 const current=await loadOperations(env);if(current.state.notices.some(n=>n.status==='sending'))throw opsError('通知正在寄送，請稍後重新整理再操作',423);if(current.version!==version)throw opsError('資料版本已變動，請重新整理',409);
 if(command.type==='notice_edit'&&command.attachments){if(!Array.isArray(command.attachments)||command.attachments.length>4)throw opsError('每封最多4份附件');const verified=[];for(const x of command.attachments){const file=await env.DB.prepare('SELECT id,name,mime_type,size_bytes,sha256 FROM pl_ops_attachments WHERE id=?').bind(x.id).first();if(!file)throw opsError('附件不存在');verified.push(file);}if(verified.reduce((n,x)=>n+x.size_bytes,0)>2000000)throw opsError('附件合計上限2MB');command.attachments=verified;}
 const {state,result}=applyOperation(current.state,command,{id:key});const n=result.queue?state.notices.find(x=>x.id===result.notice_id):null;
 const out=await commit(env,current,state,{key,type:command.type,requestHash,actor,result,notice:n});
 return {...out,notice_id:result.notice_id||null};
}
// One-time private import. Full operational records, no mail queued or external statuses overwritten.
export async function importOperations(body,actor,env){
 const current=await loadOperations(env);if(current.state.orders.length)throw opsError('已有營運客單，不可覆蓋匯入；請逐單處理差異',409);
 if(!body||!Array.isArray(body.orders)||!Array.isArray(body.groups)||body.orders.length>300||body.groups.length>300)throw opsError('匯入內容無效');
 const s=newOperations();const ids=new Set();
 for(const g of body.groups){if(!g.id||ids.has(g.id))throw opsError('團次識別碼重複');ids.add(g.id);s.groups.push({...g,auto_close:false});}
 ids.clear();
 for(const o of body.orders){if(!o.id||ids.has(o.id)||!Array.isArray(o.items)||!s.groups.some(g=>g.id===o.group_id))throw opsError('訂單識別碼或團次關聯錯誤');ids.add(o.id);s.orders.push(o);}
 for(const list of ['invoices','receipts','allocations']){if(!Array.isArray(body[list]))throw opsError('款項結構不完整');s[list]=body[list];}
 // Reconcile every imported fund and bill instead of accepting arbitrary paid flags.
 for(const b of s.invoices){if(!ids.has(b.order_id)||!['first','second'].includes(b.phase)||!(b.amount_twd===null||Number.isSafeInteger(b.amount_twd)&&b.amount_twd>=0))throw opsError('匯入帳款無效');}
 if(new Set(s.invoices.map(b=>b.order_id+':'+b.phase)).size!==s.invoices.length||new Set(s.receipts.map(r=>r.id)).size!==s.receipts.length)throw opsError('重複帳款／收款');
 for(const r of s.receipts){if(!Number.isSafeInteger(r.amount_twd)||r.amount_twd<=0||!r.evidence)throw opsError('匯入收款缺證據');const used=s.allocations.filter(a=>a.receipt_id===r.id).reduce((n,a)=>n+a.amount_twd,0);if(used>r.amount_twd)throw opsError('匯入分配超過實收');}
 for(const b of s.invoices){const used=s.allocations.filter(a=>a.invoice_id===b.id).reduce((n,a)=>n+a.amount_twd,0);if(used&&(b.amount_twd===null||used>b.amount_twd))throw opsError('匯入分配超過帳款');}
 for(const a of s.allocations){const r=s.receipts.find(x=>x.id===a.receipt_id),b=s.invoices.find(x=>x.id===a.invoice_id),o=s.orders.find(x=>x.id===b?.order_id);if(!r||!b||!o||!Number.isSafeInteger(a.amount_twd)||a.amount_twd<=0||r.customer_email?.toLowerCase()!==o.email?.toLowerCase())throw opsError('匯入款項歸屬錯誤');}
 s.history.push({id:'initial-import',type:'legacy_import',at:new Date().toISOString(),result:{orders:s.orders.length}});
 return commit(env,current,s,{key:'ops-initial-import',type:'legacy_import',requestHash:await hash(JSON.stringify(body)),actor,result:{orders:s.orders.length,groups:s.groups.length}});
}
export async function persistMailResult(env,noticeId,status,fields={}){
 // Mail result is merged into the current aggregate with CAS, so concurrent business edits survive.
 for(let attempt=0;attempt<4;attempt++){const cur=await loadOperations(env),before=structuredClone(cur.state),n=cur.state.notices.find(x=>x.id===noticeId);if(!n)return;if(n.status==='void')return;Object.assign(n,{status,...fields});if(status==='sent')for(const bid of n.invoice_ids){const b=cur.state.invoices.find(x=>x.id===bid);if(b)b.notified=true;}
 const key='mail-result:'+crypto.randomUUID();try{await commit(env,{...cur,state:before},cur.state,{key,type:'mail.result',requestHash:await hash(JSON.stringify([noticeId,status,fields])),actor:'system:mail-delivery',result:{notice_id:noticeId,status}});return;}catch(e){if(e.status!==409)throw e;}}
 // Delivery row is authoritative even if business view was busy; never resend to repair this.
}
export async function sendQueuedNotice(env,noticeId,send){
 if(env.PL3_OPS_MAIL_ENABLED!=='true')return {status:'disabled'};
 const r=await env.DB.prepare("SELECT * FROM pl_ops_mail WHERE notice_id=?").bind(noticeId).first();if(!r||r.status!=='queued')return {status:r?.status||'missing'};
 const snap=JSON.parse(r.snapshot_json),{state}=await loadOperations(env),n=state.notices.find(x=>x.id===noticeId);
 if(!n||n.status!=='queued'||noticeContent(n)!==noticeContent(snap)||n.dependency!==noticeDependency(state,n)){
 await env.DB.prepare("UPDATE pl_ops_mail SET status='void',error_code='APPROVAL_STALE',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(r.id).run();return {status:'void'};}
 const claim=await env.DB.prepare("UPDATE pl_ops_mail SET status='sending',claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(r.id).run();if(!claim.meta?.changes)return {status:'already_claimed'};
 // Recheck after acquiring the send claim. Later edits cannot recall an in-flight external request.
 const latest=await loadOperations(env),approved=latest.state.notices.find(x=>x.id===noticeId);
 if(!approved||approved.status!=='queued'||noticeContent(approved)!==noticeContent(snap)||approved.dependency!==noticeDependency(latest.state,approved)){
 await env.DB.prepare("UPDATE pl_ops_mail SET status='void',error_code='APPROVAL_STALE' WHERE id=? AND status='sending'").bind(r.id).run();return {status:'void'};}
 const beforeReservation=structuredClone(latest.state);approved.status='sending';
 try{await commit(env,{...latest,state:beforeReservation},latest.state,{key:'mail-claim:'+crypto.randomUUID(),type:'mail.claimed',requestHash:await hash(r.id),actor:'system:mail-delivery',result:{notice_id:noticeId}});}catch(e){if(e.status!==409)throw e;await env.DB.prepare("UPDATE pl_ops_mail SET status='void',error_code='APPROVAL_STALE' WHERE id=? AND status='sending'").bind(r.id).run();return {status:'void'};}
 try{const sent=await send(snap,r.id);await env.DB.prepare("UPDATE pl_ops_mail SET status='sent',gmail_message_id=?,gmail_thread_id=?,sent_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'").bind(sent.id,sent.threadId||null,r.id).run();await persistMailResult(env,noticeId,'sent',{gmail_message_id:sent.id,gmail_thread_id:sent.threadId||null});return {status:'sent',gmail_message_id:sent.id};}
 catch(e){const status=e.definite?'failed':'unknown',code=e.code||'DELIVERY_UNCERTAIN';await env.DB.prepare("UPDATE pl_ops_mail SET status=?,error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'").bind(status,code,r.id).run();await persistMailResult(env,noticeId,status,{error_code:code});return {status,error_code:code};}
}
export async function recoverMailClaims(env){
 // A lost acknowledgement is not a safe retry. Surface old in-flight requests for investigation.
 const stale=await env.DB.prepare("SELECT notice_id FROM pl_ops_mail WHERE status='sending' AND claimed_at<datetime('now','-5 minutes')").all();
 await env.DB.prepare("UPDATE pl_ops_mail SET status='unknown',error_code='ACKNOWLEDGEMENT_MISSING',updated_at=CURRENT_TIMESTAMP WHERE status='sending' AND claimed_at<datetime('now','-5 minutes')").run();
 for(const row of stale.results||[])await persistMailResult(env,row.notice_id,'unknown',{error_code:'ACKNOWLEDGEMENT_MISSING'});
}

export async function saveOperationsAttachment(body,actor,env){
 if(!body||!['image/png','image/jpeg','application/pdf'].includes(body.mime_type)||!body.name||typeof body.base64_data!=='string'||body.base64_data.length>1400000||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64_data))throw opsError('只支援1MB以下PNG、JPEG或PDF');
 let raw;try{raw=Uint8Array.from(atob(body.base64_data),c=>c.charCodeAt(0));}catch{throw opsError('附件格式錯誤');}
 if(!raw.length||raw.length>1000000)throw opsError('附件大小超過1MB或內容空白');
 const valid=body.mime_type==='application/pdf'?String.fromCharCode(...raw.slice(0,5))==='%PDF-':body.mime_type==='image/png'?raw[0]===137&&raw[1]===80&&raw[2]===78&&raw[3]===71:raw[0]===255&&raw[1]===216&&raw[2]===255;
 if(!valid)throw opsError('附件實際格式與副檔名不符');
 const id=crypto.randomUUID(),name=String(body.name).replace(/[\r\n\x00-\x1f]/g,'').slice(0,150),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(x=>x.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT INTO pl_ops_attachments(id,name,mime_type,size_bytes,sha256,base64_data,created_by) VALUES(?,?,?,?,?,?,?)').bind(id,name,body.mime_type,raw.length,sha256,body.base64_data,actor).run();return {ok:true,file:{id,name,mime_type:body.mime_type,size_bytes:raw.length,sha256}};
}

export function publicOperationsCatalog(state){
 const now=Date.now();const groups=state.groups.filter(g=>g.status==='open'&&g.deadline&&Date.parse(g.deadline)>now);
 const products=(state.products||[]).filter(p=>p.published&&(!p.image_url||p.image_official)&&p.status==='available'&&groups.some(g=>g.id===p.group_id));
 return {ok:true,groups:groups.filter(g=>products.some(p=>p.group_id===g.id)).map(({id,title,deadline})=>({id,title,deadline})),products:products.map(({id,group_id,name,sku,variant,price_twd,quantity_limit,image_url,source_url})=>({id,group_id,name,sku,variant,price_twd,quantity_limit,image_url,source_url}))};
}
export async function checkoutOperations(body,email,env){
 if(!/^[a-zA-Z0-9_-]{16,100}$/.test(body.key||''))throw opsError('訂單識別碼無效');
 if(!Array.isArray(body.items)||!body.items.length||body.items.length>50||new Set(body.items.map(x=>x.product_id)).size!==body.items.length)throw opsError('商品選擇無效');
 const identity={email,name:body.name,group_id:body.group_id,items:body.items,adult_confirmed:body.adult_confirmed,terms_confirmed:body.terms_confirmed};
 if(body.adult_confirmed!==true||body.terms_confirmed!==true)throw opsError('請確認成年及購物須知');
 const requestHash=await hash(JSON.stringify(identity));const key='checkout:'+body.key;
 const prior=await env.DB.prepare('SELECT request_hash,result_json,version FROM pl_ops_commands WHERE id=?').bind(key).first();
 if(prior){if(prior.request_hash!==requestHash)throw opsError('識別碼已被其他內容使用',409);return {ok:true,replayed:true,version:prior.version,result:JSON.parse(prior.result_json)};}
 const current=await loadOperations(env),catalog=publicOperationsCatalog(current.state);if(!catalog.groups.some(g=>g.id===body.group_id))throw opsError('團次已截止或未開放',409);
 const items=body.items.map(x=>{const p=(current.state.products||[]).find(p=>p.id===x.product_id&&p.group_id===body.group_id&&catalog.products.some(a=>a.id===p.id));if(!p||!Number.isSafeInteger(x.quantity)||x.quantity<1||x.quantity>99||(p.quantity_limit&&x.quantity>p.quantity_limit))throw opsError('商品或數量已不可訂購',409);return {name:p.name,sku:p.sku,variant:p.variant,quantity:x.quantity,unit_price_twd:p.price_twd,shipping_units:p.shipping_units};});
 if(items.reduce((n,x)=>n+x.quantity*x.unit_price_twd,0)>22000)throw opsError('超過本單商品款上限',409);
 return executeOperation({key,version:current.version,command:{type:'order_save',id:'PL3-'+body.key,group_id:body.group_id,email,name:body.name,items,first_channel:'transfer',acceptance:{adult_confirmed:true,terms_confirmed:true,terms_version:'PL3-two-stage-20261104',accepted_at:new Date().toISOString()}}},email,env,{requestIdentity:identity});
}
