import{legacyOperationsCatalog}from './storefront-handoff.js';
import storefrontPreview from './storefront-preview-html.js';
import storefrontCutover from './storefront-cutover-source.js';
import operationsReceiverSource from './operations-receiver-source.js';
import{operationsMirrorStatus,drainOperationsMirror}from './operations-mirror.js';
import{exportOperationsBackup,restoreOperationsBackup,verifyOperationsBackup}from './operations-backup.js';
import{customerServiceView}from './operations-services.js';
import {readApprovedLegacyCatalog,planLegacyCatalogImport,legacyProductDraft} from './catalog-source.js';
import { checkoutOperations,claimReadyInventory,readyPublicCatalog,publicOperationsCatalog,installOperations,operationsView,executeOperation,importOperations,sendQueuedNotice,recoverMailClaims,loadOperations,saveOperationsAttachment } from "./operations-store.js";
import { sendOperationsMail,gmailAccess } from "./operations-mail.js";
import { balance,applyOperation,operatingStatus } from "./operations-domain.js";
import { paymentInstructionsFor } from './payment-instructions.js';
import { BENEFIT_GROUP } from './benefit-checkout.js';
import {installStarTrace,readStarTrace,commandStarTrace} from './star-trace-store.js';
import starTraceHtml from './star-trace-html.js';
import operationsHtml from "./operations-html.js";
import operationsBundle from "./operations-bundle.js";
import homepageHtml from "./homepage-html.js";
import privacyHtml from "./privacy-html.js";
import { readLegacyArchive } from "./legacy-source-store.js";
import { mapLegacyPayments } from "./legacy-payment-mapper.js";
import { reviewPayment, advanceFulfillment } from "./admin-operations.js";
import { drainOutbox } from "./sync-outbox.js";
import {qaPaymentStart,qaPaymentDrain,qaPaymentStatus} from './qa-payment-phases.js';
import { inspectFormalSync, formalProjectionForOrder, drainFormalOutbox } from "./formal-sync.js";
import adminHtml from "./admin-html.js";
import { createAdminSession, readAdminSession, revokeAdminSession, revokeAllAdminSessions, requireRecentAdminSession, stepUpScopeForOperationsCommand, sessionCookie, clearSessionCookie, requireSameOriginAction } from "./admin-session.js";
import { customerSessionCookie, readCustomerSessionCookie, clearCustomerSessionCookie } from "./customer-session.js";
// PL 3.0 staging API candidate. Requires migration 0002 and Worker secrets.
// Never deploy as production before integration tests and reconciliation.
const ORIGIN = "https://a-little-light-for-every-day.github.io";
// Report-only policy keeps the enforced UI policy unchanged while measuring breakage.
const CSP_MONITOR = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; font-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; report-uri /api/security/csp-report";
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")), c=>c.charCodeAt(0));
async function digest(s) { return b64(await crypto.subtle.digest("SHA-256",encoder.encode(s))); }
async function hmac(secret, s) {
  const key = await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return b64(await crypto.subtle.sign("HMAC",key,encoder.encode(s)));
}
function response(body,status=200,origin="") {
  const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Vary":"Origin"};
  if(origin===ORIGIN) headers["Access-Control-Allow-Origin"]=ORIGIN;
  return new Response(JSON.stringify(body),{status,headers});
}
function emailOf(x) { const s=String(x||"").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=254?s:null; }
function fail(message,status=400) { const e=new Error(message); e.status=status; throw e; }
async function jsonBody(request) {
  if(Number(request.headers.get("content-length")||0)>32768) fail("Request too large",413);
  const text=await request.text();
  if(text.length>32768) fail("Request too large",413);
  try { return JSON.parse(text); } catch { fail("Invalid JSON"); }
}
function requireConfig(env,...names) { for(const n of names) if(!env[n]) fail("Service not configured",503); }
async function tokenFor(env,email) {
  const expiry=Math.floor(Date.now()/1000)+3600;
  const payload=b64(encoder.encode(JSON.stringify({email,iat:Math.floor(Date.now()/1000),exp:expiry})));
  return payload+"."+await hmac(env.SESSION_SECRET,payload);
}
async function authorizedEmail(request,env) {
  requireConfig(env,"SESSION_SECRET");
  const bearer=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get("Authorization")||"");
  // Cookie-backed writes need same-origin proof. Bearer-based existing clients
  // remain supported and never silently fall back from an invalid bearer.
  const token=bearer?.[1]||(!request.headers.has("Authorization")&&readCustomerSessionCookie(request));
  if(!token) fail("Authentication required",401);
  if(!bearer&&request.method!=="GET")requireSameOriginAction(request);
  const [payload,signature]=token.split(".");
  const expected=await hmac(env.SESSION_SECRET,payload);
  if(signature.length!==expected.length) fail("Invalid session",401);
  let difference=0;for(let i=0;i<signature.length;i++)difference|=signature.charCodeAt(i)^expected.charCodeAt(i);
  if(difference) fail("Invalid session",401);
  let data;try{data=JSON.parse(new TextDecoder().decode(unb64(payload)));}catch{fail("Invalid session",401);}
  if(!data||!emailOf(data.email)||!Number.isInteger(data.exp)||data.exp<=Date.now()/1000) fail("Expired session",401);
  return data.email;
}
// Gmail API only: OAuth credentials are Worker secrets, never sent to the browser.
async function sendOtpViaGmail(env,to,code) {
  requireConfig(env,"GMAIL_CLIENT_ID","GMAIL_CLIENT_SECRET","GMAIL_REFRESH_TOKEN","GMAIL_SENDER");
  const sender=emailOf(env.GMAIL_SENDER);
  if(!sender) fail("Invalid Gmail sender configuration",503);
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      client_id:env.GMAIL_CLIENT_ID,
      client_secret:env.GMAIL_CLIENT_SECRET,
      refresh_token:env.GMAIL_REFRESH_TOKEN,
      grant_type:"refresh_token"
    })
  });
  if(!tokenResponse.ok) {
    console.error("Gmail OAuth token exchange failed",tokenResponse.status);
    fail("Email service unavailable",503);
  }
  const token=await tokenResponse.json();
  if(!token.access_token) fail("Email service unavailable",503);
  const subject="Petite Lueur 驗證碼";
  const mail=[
    "From: Petite Lueur PL <"+sender+">",
    "To: "+to,
    "Subject: =?UTF-8?B?"+btoa(String.fromCharCode(...encoder.encode(subject)))+"?=",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    btoa(String.fromCharCode(...encoder.encode("您的驗證碼為 "+code+"，10 分鐘內有效。若非本人操作請忽略。")))
  ].join("\r\n");
  const sent=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{
    method:"POST",
    headers:{"Authorization":"Bearer "+token.access_token,"Content-Type":"application/json"},
    body:JSON.stringify({raw:b64(encoder.encode(mail))})
  });
  if(!sent.ok) {
    console.error("Gmail send failed",sent.status);
    fail("Unable to send verification email",503);
  }
}
async function otpRequest(body,env,request) {
  requireConfig(env,"OTP_PEPPER","GMAIL_CLIENT_ID","GMAIL_CLIENT_SECRET","GMAIL_REFRESH_TOKEN","GMAIL_SENDER");
  const email=emailOf(body.email);if(!email) fail("Invalid email");
  const windowStart=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
  const latest=await env.DB.prepare("SELECT created_at FROM otp_codes WHERE email=? ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if(latest&&Date.parse(String(latest.created_at).replace(" ","T")+ (String(latest.created_at).includes("Z")?"":"Z"))>Date.now()-60000)
    fail("請稍後再要求新的驗證碼",429);
  // The Cloudflare-provided IP is HMAC-like pepper-hashed before persisting; never store raw IPs.
  const ip=request?.headers.get("CF-Connecting-IP")||"";
  const ipKey=ip?"ip:"+await digest(env.OTP_PEPPER+":ip:"+ip):null;
  const claims=[{key:email,purpose:"otp",limit:5},...(ipKey?[{key:ipKey,purpose:"otp_ip",limit:30}]:[])];
  for(const claim of claims) {
    const rate=await env.DB.prepare("SELECT count FROM email_rate_limits WHERE email=? AND purpose=? AND window_start=?")
      .bind(claim.key,claim.purpose,windowStart).first();
    if((rate?.count||0)>=claim.limit)fail("Too many requests",429);
  }
  // Claim counters before sending, so concurrent requests cannot bypass the hourly ceiling.
  for(const claim of claims) {
    const reserved=await env.DB.prepare("INSERT INTO email_rate_limits(email,purpose,window_start,count) VALUES(?,?,?,1) ON CONFLICT(email,purpose,window_start) DO UPDATE SET count=count+1 WHERE count<? RETURNING count")
      .bind(claim.key,claim.purpose,windowStart,claim.limit).first();
    if(!reserved)fail("Too many requests",429);
  }
  const bytes=crypto.getRandomValues(new Uint32Array(1));
  const code=String(bytes[0]%1000000).padStart(6,"0");
  const id=crypto.randomUUID();
  const expires=new Date(Date.now()+10*60000).toISOString();
  const hash=await digest(env.OTP_PEPPER+":"+email+":"+code);
  await env.DB.prepare("INSERT INTO otp_codes(id,email,code_hash,expires_at) VALUES(?,?,?,?)").bind(id,email,hash,expires).run();
  await sendOtpViaGmail(env,email,code);
  return {ok:true,message:"Verification code sent"};
}
async function otpVerify(body,env) {
  requireConfig(env,"OTP_PEPPER","SESSION_SECRET");
  const email=emailOf(body.email),code=String(body.code||"");
  if(!email||!/^\d{6}$/.test(code)) fail("Invalid verification data");
  const record=await env.DB.prepare("SELECT id,code_hash,expires_at,attempts FROM otp_codes WHERE email=? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if(!record||Date.parse(record.expires_at)<=Date.now()||record.attempts>=5) fail("Code expired or invalid",401);
  const hash=await digest(env.OTP_PEPPER+":"+email+":"+code);
  if(hash!==record.code_hash) {
    await env.DB.prepare("UPDATE otp_codes SET attempts=attempts+1 WHERE id=? AND used_at IS NULL").bind(record.id).run();
    fail("Code expired or invalid",401);
  }
  const used=await env.DB.prepare("UPDATE otp_codes SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL AND attempts<5").bind(record.id).run();
  if(used.meta?.changes!==1) fail("Code already used",401);
  return {ok:true,token:await tokenFor(env,email),expires_in:3600};
}
const FORMAL_QA_GROUP="PL3-FORMAL-REHEARSAL-01";
const FORMAL_QA_PRODUCT="PL3-TEST-PRODUCT-20261101-01";
const FORMAL_QA_EMAIL="pl3-qa@example.invalid";
async function checkout(body,email,env,{privateQa=false}={}) {
  const key=String(body.idempotency_key||"");
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail("Invalid idempotency key");
  const name=String(body.customer_name||"").trim().slice(0,120);
  if(!name) fail("Customer name required");
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>50) fail("Invalid items");
  const groupId=String(body.group_id||"");
  if(!groupId||groupId.length>128) fail("Invalid group");
  const canonical=body.items.map(x=>({id:String(x.product_id||""),quantity:Number(x.quantity)}));
  if(canonical.some(x=>!x.id||x.id.length>128||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99)) fail("Invalid quantities");
  if(new Set(canonical.map(x=>x.id)).size!==canonical.length) fail("Duplicate products");
  const requestHash=await digest(JSON.stringify({email,groupId,name,items:canonical}));
  const previous=await env.DB.prepare("SELECT order_id,request_hash FROM api_idempotency WHERE key=?").bind(key).first();
  if(previous) {if(previous.request_hash!==requestHash) fail("Idempotency key reused",409);return {ok:true,order_id:previous.order_id,replayed:true};}
  const group=await env.DB.prepare("SELECT id,status,published,order_deadline FROM groups WHERE id=?").bind(groupId).first();
  if(privateQa){
    if(groupId!==FORMAL_QA_GROUP||env.PL3_FORMAL_ALLOWED_GROUP_ID!==FORMAL_QA_GROUP||!group||group.status!=="draft"||Number(group.published||0)!==0||canonical.length!==1||canonical[0].id!==FORMAL_QA_PRODUCT||canonical[0].quantity!==1)fail("QA cohort unavailable",409);
  }else{
    if(!group||group.published!==1||group.status!=="open") fail("Group unavailable",409);
    if(group.order_deadline&&Date.parse(group.order_deadline)<=Date.now()) fail("Group closed",409);
  }
  const selections=[];let total=0;
  for(const item of canonical) {
    const p=await env.DB.prepare("SELECT id,group_id,name,variant,price_twd,quantity_limit,status FROM products WHERE id=? AND group_id=?").bind(item.id,groupId).first();
    if(!p||!["available","active"].includes(p.status)||!Number.isInteger(p.price_twd)||p.price_twd<1) fail("Product unavailable",409);
    if(p.quantity_limit!=null&&item.quantity>p.quantity_limit) fail("Quantity limit exceeded",409);
    total+=p.price_twd*item.quantity;
    selections.push({p,quantity:item.quantity});
  }
  if(total>22000) fail("Order exceeds NT$22,000 cap",409);
  const orderId=crypto.randomUUID();
  const statements=[env.DB.prepare("INSERT INTO orders(id,customer_email,customer_name,group_id,status,payment_status,total_twd) VALUES(?,?,?,?, 'pending','unpaid',?)").bind(orderId,email,name,groupId,total)];
  for(const {p,quantity} of selections) {
    const itemId=crypto.randomUUID();
    statements.push(env.DB.prepare("INSERT INTO order_items(id,order_id,product_id,product_name,variant,quantity,unit_price_twd) VALUES(?,?,?,?,?,?,?)").bind(itemId,orderId,p.id,p.name,p.variant,quantity,p.price_twd));
    statements.push(env.DB.prepare("INSERT INTO fulfillments(id,order_item_id) VALUES(?,?)").bind(crypto.randomUUID(),itemId));
  }
  statements.push(env.DB.prepare("INSERT INTO api_idempotency(key,request_hash,order_id) VALUES(?,?,?)").bind(key,requestHash,orderId));
  statements.push(env.DB.prepare("INSERT INTO sync_outbox(id,entity_type,entity_id,event_type,payload_json) VALUES(?,'order',?,'order.created',?)").bind(crypto.randomUUID(),orderId,JSON.stringify({order_id:orderId})));
  try {await env.DB.batch(statements);} catch(e) {
    const repeated=await env.DB.prepare("SELECT order_id,request_hash FROM api_idempotency WHERE key=?").bind(key).first();
    if(repeated&&repeated.request_hash===requestHash)return {ok:true,order_id:repeated.order_id,replayed:true};
    console.error("Checkout database failure",e);fail("Order could not be created",409);
  }
  return {ok:true,order_id:orderId,total_twd:total};
}
async function orders(email,env) {
  const result=await env.DB.prepare("SELECT id,group_id,status,payment_status,total_twd,created_at FROM orders WHERE customer_email=? ORDER BY created_at DESC LIMIT 100").bind(email).all();
  return {ok:true,orders:result.results||[]};
}
async function authorizedOwner(request,env) {
  requireConfig(env,"PL3_ADMIN_EMAIL");
  // PowerShell QA uses a short-lived bearer. Only same-origin admin UI uses cookies.
  const bearer=request.headers.get("Authorization");
  const email=bearer ? await authorizedEmail(request,env) : (await readAdminSession(request,env)).email;
  if(email!==emailOf(env.PL3_ADMIN_EMAIL)) fail("Forbidden",403);
  if(!bearer&&request.method!=="GET") requireSameOriginAction(request);
  return email;
}
async function requireOwnerStepUp(request,env,scope="high") {
  const bearer=request.headers.get("Authorization");
  if(bearer) {
    // The owner API bearer is accepted only immediately after an OTP challenge.
    await authorizedOwner(request,env);
    const payload=bearer.slice(7).split(".")[0];
    let data;try{data=JSON.parse(new TextDecoder().decode(unb64(payload)));}catch{fail("Authentication required",401);}
    const now=Math.floor(Date.now()/1000);
    if(!Number.isInteger(data.iat)||data.iat>now+60||now-data.iat>300)fail("高風險操作須重新驗證 Email。",428);
  } else {
    const session=await readAdminSession(request,env);
    requireRecentAdminSession(session,scope);
  }
}
async function privateQaCheckout(body,env){
  if(env.PL3_FORMAL_SYNC_ENABLED!=="true"&&env.PL3_FORMAL_SYNC_ENABLED!=="1")fail("QA sync is not enabled",409);
  const key=String(body.idempotency_key||"");
  return checkout({idempotency_key:key,customer_name:"PL3 假資料驗收｜禁止核帳",group_id:FORMAL_QA_GROUP,items:[{product_id:FORMAL_QA_PRODUCT,quantity:1}]},FORMAL_QA_EMAIL,env,{privateQa:true});
}
async function privateQaPaymentReport(body,env){
  if(env.PL3_FORMAL_ALLOWED_GROUP_ID!==FORMAL_QA_GROUP)fail("QA cohort unavailable",409);
  const id=String(body.order_id||"");
  if(!/^[a-f0-9-]{36}$/.test(id))fail("Invalid QA order",400);
  const order=await env.DB.prepare("SELECT id,total_twd FROM orders WHERE id=? AND group_id=? AND customer_email=? AND customer_name=? AND payment_status='unpaid'").bind(id,FORMAL_QA_GROUP,FORMAL_QA_EMAIL,"PL3 假資料驗收｜禁止核帳").first();
  if(!order)fail("QA order not found or already settled",404);
  const already=await env.DB.prepare("SELECT id,status FROM payment_reports WHERE order_id=? ORDER BY created_at DESC LIMIT 1").bind(id).first();
  if(already)return {ok:true,report_id:already.id,status:already.status,replayed:true};
  return paymentReport({order_id:id,method:"other",amount_twd:order.total_twd,reference_last5:"",note:"PL3 QA ONLY｜虛構付款回報；禁止核帳、通知、入帳"},FORMAL_QA_EMAIL,env);
}
async function ownerOrders(env) {
  const result=await env.DB.prepare(
    "SELECT o.id,o.customer_email,o.customer_name,o.group_id,o.status,o.payment_status,o.total_twd,o.created_at,g.order_deadline FROM orders o LEFT JOIN groups g ON g.id=o.group_id ORDER BY o.created_at DESC LIMIT 100"
  ).all();
  return {ok:true,orders:result.results||[]};
}
async function ownerFulfillments(env) {
  const result=await env.DB.prepare(
    "SELECT f.id,f.status,f.updated_at,f.purchase_reference,f.warehouse_tracking,f.international_tracking,f.taiwan_tracking,oi.order_id,oi.product_name,oi.variant,oi.quantity,o.group_id,o.customer_email,o.customer_name,o.payment_status FROM fulfillments f JOIN order_items oi ON oi.id=f.order_item_id JOIN orders o ON o.id=oi.order_id ORDER BY f.updated_at DESC LIMIT 100"
  ).all();
  return {ok:true,fulfillments:result.results||[]};
}
async function ownerAuditEvents(env) {
  const result=await env.DB.prepare(
    "SELECT id,actor_type,action,object_type,object_id,created_at FROM audit_events ORDER BY created_at DESC LIMIT 100"
  ).all();
  return {ok:true,events:result.results||[]};
}
async function ownerPaymentReports(env) {
  const result=await env.DB.prepare(
    "SELECT pr.id,pr.order_id,pr.method,pr.amount_twd,pr.reference_last5,pr.note,pr.status,pr.created_at,o.customer_email,o.customer_name,o.total_twd,o.payment_status FROM payment_reports pr JOIN orders o ON o.id=pr.order_id WHERE pr.status='pending_review' ORDER BY pr.created_at DESC LIMIT 100"
  ).all();
  return {ok:true,reports:result.results||[]};
}
async function paymentReport(body,email,env) {
  const orderId=String(body.order_id||"");
  const method=String(body.method||"");
  const amount=Number(body.amount_twd);
  const last5=String(body.reference_last5||"");
  if(!orderId||!["bank_transfer","other"].includes(method)||!Number.isInteger(amount)||amount<1||amount>22000||!/^\d{0,5}$/.test(last5))fail("Invalid payment report");
  const own=await env.DB.prepare("SELECT id,total_twd FROM orders WHERE id=? AND customer_email=?").bind(orderId,email).first();
  if(!own)fail("Order not found",404);
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO payment_reports(id,order_id,method,amount_twd,reference_last5,note) VALUES(?,?,?,?,?,?)").bind(id,orderId,method,amount,last5,String(body.note||"").slice(0,500)).run();
  return {ok:true,report_id:id,status:"pending_review"};
}
export default {
  async scheduled(event,env,ctx){ctx.waitUntil((async()=>{try{
    // Only short-lived authentication artifacts are automatically purged.
    // Financial receipts, customer orders, payment evidence and backups are untouched.
    await env.DB.prepare("DELETE FROM otp_codes WHERE datetime(expires_at)<datetime('now','-2 days')").run();
    await env.DB.prepare("DELETE FROM email_rate_limits WHERE datetime(window_start)<datetime('now','-2 days')").run();
    await recoverMailClaims(env);await drainOperationsMirror(env,{limit:2});const current=await loadOperations(env);for(const g of current.state.groups.filter(g=>g.auto_close&&g.status==='open'&&g.id!==BENEFIT_GROUP&&g.deadline&&Date.parse(g.deadline)<=Date.now())){const latest=await loadOperations(env);await executeOperation({key:'auto-close:'+g.id+':'+Date.parse(g.deadline),version:latest.version,command:{type:'close_group',group_id:g.id,payment_due_at:g.payment_due_at}},'system:approved-deadline',env);}const rows=await env.DB.prepare("SELECT notice_id FROM pl_ops_mail WHERE status='queued' ORDER BY approved_at LIMIT 5").all();for(const r of rows.results||[])await sendQueuedNotice(env,r.notice_id,(n,key)=>sendOperationsMail(env,n,key));}catch{console.error("Operations scheduled task unavailable");}})());},
  async fetch(request,env) {
    const url=new URL(request.url),origin=request.headers.get("Origin")||"";
    if(request.method==="OPTIONS") {
      if(origin!==ORIGIN)return response({error:"Origin forbidden"},403,origin);
      return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Authorization,Content-Type","Access-Control-Max-Age":"600","Vary":"Origin"}});
    }
    try {
      if(!env.DB)fail("Database binding missing",503);
      if(url.pathname==="/api/security/csp-report"&&request.method==="POST"){
        if(Number(request.headers.get("content-length")||0)>8192)return new Response(null,{status:413});
        const body=await request.text();if(body.length>8192)return new Response(null,{status:413});
        // Reports can contain private URLs. Log only allowlisted directive names.
        try {
          const report=JSON.parse(body),violation=report?.["csp-report"]?.["violated-directive"]||report?.[0]?.body?.effectiveDirective||"";
          const directive=String(violation).split(" ")[0];
          if(["default-src","script-src","style-src","img-src","connect-src","font-src","base-uri","object-src","frame-ancestors"].includes(directive))console.warn("PL3 CSP report-only violation",directive);
        }catch{/* Invalid reports are ignored without logging user-controlled bodies. */}
        return new Response(null,{status:204});
      }
      if(request.method==="GET"&&["/","/index.html"].includes(url.pathname))return new Response(homepageHtml,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":"default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'","Content-Security-Policy-Report-Only":CSP_MONITOR}});
      if(request.method==="GET"&&["/privacy","/privacy.html"].includes(url.pathname))return new Response(privacyHtml,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'","Content-Security-Policy-Report-Only":CSP_MONITOR}});
      // Public, read-only storefront markup for the official front-door Worker.
      // The owner-only /storefront-preview diagnostic remains gated below.
      if(url.pathname==='/public-storefront'&&request.method==='GET')return new Response(storefrontPreview,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}});
      // Diagnostic pages must never be served by the production-cutover worker.
      // Staging access requires an explicit flag and an authenticated owner.
      if(url.pathname==="/admin-test"&&request.method==="GET"&&env.PL3_PRODUCTION_CUTOVER!=="true"&&env.PL3_ENABLE_TEST_ROUTES==="true") {
        await authorizedOwner(request,env);
        return new Response(adminHtml,{status:200,headers:{
          "Content-Type":"text/html; charset=utf-8",
          "Cache-Control":"no-store",
          "X-Content-Type-Options":"nosniff",
          "X-Frame-Options":"DENY",
          "Referrer-Policy":"no-referrer",
          "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        }});
      }
      if(url.pathname==='/storefront-preview'&&request.method==='GET'&&env.PL3_PRODUCTION_CUTOVER!=="true"&&env.PL3_ENABLE_TEST_ROUTES==="true"){
        await authorizedOwner(request,env);
        return new Response(storefrontPreview,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}});
      }
      if(url.pathname==='/storefront-cutover.js'&&request.method==='GET')return new Response(storefrontCutover,{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      if(url.pathname==='/api/operations/legacy-catalog'&&request.method==='GET')return response(legacyOperationsCatalog((await loadOperations(env)).state),200,origin);
      if(["/admin-operations","/account","/shop","/services"].includes(url.pathname)&&request.method==="GET")return new Response(operationsHtml,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' https: data:; base-uri 'none'; frame-ancestors 'none'","Content-Security-Policy-Report-Only":CSP_MONITOR}});
      if(url.pathname==="/operations-app.js"&&request.method==="GET")return new Response(operationsBundle,{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
      if(url.pathname==="/api/operations/service-requests"&&request.method==="GET"){const email=await authorizedEmail(request,env);return response({ok:true,requests:customerServiceView((await loadOperations(env)).state,email)},200,origin);}
      if(['/api/operations/service-request','/api/operations/service-action'].includes(url.pathname)&&request.method==='POST'){
        const email=await authorizedEmail(request,env),body=await jsonBody(request),current=await loadOperations(env);if(!/^[a-zA-Z0-9_-]{16,100}$/.test(body.key||''))fail('申請識別碼無效');const type=url.pathname.endsWith('/service-request')?'service_request':body.type;if(!['service_request','service_customer_accept','service_customer_decline'].includes(type))fail('服務操作無效');
        return response(await executeOperation({key:'service:'+body.key,version:current.version,command:{...body,type,authenticated_email:email}},email,env,{requestIdentity:{...body,type,authenticated_email:email}}),200,origin);
      }
      if(url.pathname==="/api/operations/catalog"&&request.method==="GET")return response(publicOperationsCatalog((await loadOperations(env)).state),200,origin);
      if(url.pathname==="/api/operations/ready-catalog"&&request.method==="GET")return response(readyPublicCatalog((await loadOperations(env)).state),200,origin);
      if(url.pathname==="/api/operations/ready-claim"&&request.method==="POST")return response(await claimReadyInventory(await jsonBody(request),await authorizedEmail(request,env),env),200,origin);
      if(url.pathname==="/api/operations/checkout"&&request.method==="POST")return response(await checkoutOperations(await jsonBody(request),await authorizedEmail(request,env),env),200,origin);
      if(url.pathname.startsWith("/api/admin/ops")){
        const actor=await authorizedOwner(request,env);
        // The command endpoint chooses the step-up window from its validated
        // command type below; every other protected operation stays high-risk.
        if((request.method==="POST"&&!["/api/admin/ops/mail-health","/api/admin/ops/command"].includes(url.pathname))||url.pathname==="/api/admin/ops/export")await requireOwnerStepUp(request,env);
        if(url.pathname==="/api/admin/ops/receiver-source"&&request.method==="GET")return new Response(operationsReceiverSource,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
        if(url.pathname==="/api/admin/ops/export"&&request.method==="GET"){
          return response(await exportOperationsBackup(env),200,origin);
        }
        if(url.pathname==="/api/admin/ops/sync-retry-blocked"&&request.method==="POST"){const r=await env.DB.prepare("UPDATE pl_ops_sync_deliveries SET status='pending',error_code=NULL,next_retry_at=NULL WHERE status='blocked'").run();return response({ok:true,requeued:r.meta?.changes||0},200,origin);}
        if(url.pathname==="/api/admin/ops/sync-recheck-revisions"&&request.method==="POST"){const r=await env.DB.prepare("UPDATE pl_ops_sync_deliveries SET status='pending',error_code=NULL,next_retry_at=NULL WHERE status='conflict' AND destination='notion' AND error_code='OPS_NOTION_REVISION_CHANGED'").run();return response({ok:true,requeued:r.meta?.changes||0},200,origin);}
        if(url.pathname==="/api/admin/ops/sync-recheck-sheet-format"&&request.method==="POST"){const r=await env.DB.prepare("UPDATE pl_ops_sync_deliveries SET status='pending',error_code=NULL,next_retry_at=NULL WHERE status='conflict' AND destination='sheets' AND error_code='OPS_SHEET_MANUAL_EDIT'").run();return response({ok:true,requeued:r.meta?.changes||0},200,origin);}
        if(url.pathname==="/api/admin/ops/sync-status"&&request.method==="GET")return response(await operationsMirrorStatus(env),200,origin);
        if(url.pathname==="/api/admin/ops/sync-drain"&&request.method==="POST")return response(await drainOperationsMirror(env),200,origin);
        if(url.pathname==="/api/admin/ops/backup-verify"&&request.method==="POST")return response(await verifyOperationsBackup(env,actor),200,origin);
        if(url.pathname==="/api/admin/ops/restore"&&request.method==="POST"){const raw=await request.text();if(raw.length>20000000)fail('備份超過20MB',413);const b=JSON.parse(raw);return response(await restoreOperationsBackup(b.file,actor,env,{confirmed:b.confirmed,expected_version:b.expected_version}),200,origin);}
        if(url.pathname==="/api/admin/ops/catalog-public-preview"&&request.method==="POST"){
          const products=await readApprovedLegacyCatalog();const current=await loadOperations(env);const plan=planLegacyCatalogImport(products,current.state.groups);return response({ok:true,total:products.length,matched:plan.matched.length,matched_products:plan.matched.map(p=>({code:p.id,name:p.name,variant:p.variant,group_id:p.group_id,price:p.price_twd})),unmatched:plan.unmatched,groups:[...new Set(plan.matched.map(p=>p.group_id))]},200,origin);
        }
        if(url.pathname==="/api/admin/ops/catalog-public-import"&&request.method==="POST"){
          const body=await jsonBody(request);if(body.confirmed!==true)fail('請確認移入舊站已核准商品草稿');
          const products=await readApprovedLegacyCatalog();let current=await loadOperations(env);if(current.version!==body.version)fail('資料已變動，請重新整理',409);const plan=planLegacyCatalogImport(products,current.state.groups);const waiting=plan.unmatched.filter(x=>x.product&&Number.isSafeInteger(x.product.price)&&x.product.price>0);if(waiting.length){if(!current.state.groups.some(g=>g.id==='catalog-unassigned')){await executeOperation({key:'catalog-unassigned:'+body.key,version:current.version,command:{type:'group_save',id:'catalog-unassigned',title:'商品｜待確認團次',status:'draft'}},actor,env);current=await loadOperations(env);}for(const x of waiting)plan.matched.push(legacyProductDraft(x.product,'catalog-unassigned'));}let imported=0;for(const gid of [...new Set(plan.matched.map(p=>p.group_id))]){current=await loadOperations(env);const rows=plan.matched.filter(p=>p.group_id===gid);const r=await executeOperation({key:'catalog-public:'+body.key+':'+gid,version:current.version,command:{type:'catalog_migrate',group_id:gid,confirmed:true,products:rows}},actor,env);imported+=r.result.imported;}return response({ok:true,imported,unmatched:plan.unmatched.length},200,origin);
        }
        if(url.pathname==="/api/admin/ops/catalog-source"&&request.method==="GET")return response({ok:true,groups:(await env.DB.prepare('SELECT * FROM groups LIMIT 300').all()).results||[],products:(await env.DB.prepare('SELECT * FROM products LIMIT 1000').all()).results||[]},200,origin);
        if(url.pathname==="/api/admin/ops/catalog-migrate"&&request.method==="POST"){
          const body=await jsonBody(request);const source=await env.DB.prepare('SELECT * FROM products WHERE group_id=? LIMIT 500').bind(body.source_group_id).all();
          return response(await executeOperation({key:body.key,version:body.version,command:{type:'catalog_migrate',group_id:body.group_id,confirmed:body.confirmed,products:source.results||[]}},actor,env),200,origin);
        }
        if(url.pathname==="/api/admin/ops/install"&&request.method==="POST")return response(await installOperations(env),200,origin);
        if(url.pathname==="/api/admin/ops"&&request.method==="GET")return response(await operationsView(env),200,origin);
        if(url.pathname==="/api/admin/ops/import"&&request.method==="POST"){
          const raw=await request.text();if(raw.length>1000000)fail("Import too large",413);let data;try{data=JSON.parse(raw);}catch{fail("Invalid JSON");}return response(await importOperations(data,actor,env),200,origin);
        }
        if(url.pathname==="/api/admin/ops/command"&&request.method==="POST"){
          const body=await jsonBody(request);
          await requireOwnerStepUp(request,env,stepUpScopeForOperationsCommand(body.command?.type));
          if(body.command?.type==='payment_report'||['service_request','service_customer_accept','service_customer_decline'].includes(body.command?.type))fail("Use customer payment report endpoint");
          const result=await executeOperation(body,actor,env);
          if(result.result?.queue&&!result.replayed)result.delivery=await sendQueuedNotice(env,result.result.notice_id,(n,key)=>sendOperationsMail(env,n,key));
          return response(result,200,origin);
        }
        if(url.pathname==="/api/admin/ops/mail-drain"&&request.method==="POST"){
          await recoverMailClaims(env);const rows=await env.DB.prepare("SELECT notice_id FROM pl_ops_mail WHERE status='queued' ORDER BY approved_at LIMIT 3").all();const results=[];for(const r of rows.results||[])results.push(await sendQueuedNotice(env,r.notice_id,(n,key)=>sendOperationsMail(env,n,key)));return response({ok:true,results},200,origin);
        }
        if(url.pathname==="/api/admin/ops/mail-health"&&request.method==="POST"){
          try{await gmailAccess(env);return response({ok:true,oauth_exchange:'healthy',send_permission:'not_tested',long_term_authorization:'not_verified'},200,origin);}catch(e){return response({ok:false,error:e.code||'GMAIL_UNAVAILABLE'},503,origin);}
        }
      }
      if(url.pathname.startsWith('/api/admin/star-trace')){
        const actor=await authorizedOwner(request,env);
        if(request.method==='POST')await requireOwnerStepUp(request,env);
        if(url.pathname==='/api/admin/star-trace'&&request.method==='GET')return response(await readStarTrace(env),200,origin);
        if(url.pathname==='/api/admin/star-trace/install'&&request.method==='POST')return response(await installStarTrace(env),200,origin);
        if(url.pathname==='/api/admin/star-trace/command'&&request.method==='POST')return response(await commandStarTrace(env,actor,await jsonBody(request)),200,origin);
      }
      if(url.pathname==='/admin-star-trace'&&request.method==='GET'){
        await authorizedOwner(request,env);
        return new Response(starTraceHtml,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
      }
      if(url.pathname==="/api/operations/my-orders"&&request.method==="GET"){
        const customer=await authorizedEmail(request,env);const {state}=await loadOperations(env);const owned=state.orders.filter(o=>o.email?.toLowerCase()===customer);
        return response({ok:true,orders:owned.map(o=>({id:o.id,status:o.status,live_status:operatingStatus(state,o),source_status:o.source_status,raw_item_text:o.raw_item_text,application:o.application?{contact:o.application.contact,delivery_method:o.application.delivery_method}:null,benefit_preference:o.benefit_preference?{members:o.benefit_preference.members,allow_repeat:o.benefit_preference.allow_repeat,prefer_full_set:o.benefit_preference.prefer_full_set!==false}:null,items:o.items.map(l=>({name:l.name,variant:l.variant,quantity:l.quantity,sku:l.sku,unit_price_twd:l.unit_price_twd,fulfillment_kind:l.fulfillment_kind,purchased:l.purchased,overseas:l.overseas,transit:l.transit,taiwan:l.taiwan,shipped:l.shipped,delivered:l.delivered})),invoices:state.invoices.filter(b=>b.order_id===o.id).map(b=>({id:b.id,phase:b.phase,amount_twd:b.amount_twd,outstanding_twd:balance(state,b),finalized:b.finalized,channel:b.channel,due_at:b.due_at,costs:b.costs,carry_twd:b.carry_twd,payment_options:paymentInstructionsFor(state,o,b)})),shipments:state.shipments.filter(sh=>sh.items.some(i=>i.order_id===o.id)).map(sh=>({carrier:sh.carrier,tracking:sh.tracking,cod_twd:sh.cod_twd})),reports:(state.reports||[]).filter(r=>r.order_id===o.id).map(r=>({amount_twd:r.amount_twd,phase:r.phase||null,paid_at:r.paid_at||null,status:r.status,created_at:r.created_at}))}))},200,origin);
      }
      if(url.pathname==="/api/operations/payment-report"&&request.method==="POST"){
        const customer=await authorizedEmail(request,env),body=await jsonBody(request),current=await loadOperations(env);
        return response(await executeOperation({key:body.key,version:current.version,command:{...body,type:undefined,...body.command,type:'payment_report',authenticated_email:customer}},customer,env),200,origin);
      }
      if(url.pathname==="/health"&&request.method==="GET") {
        const row=await env.DB.prepare("SELECT 1 AS connected").first();
        return response({ok:row?.connected===1,service:"pl3-staging-api"},200,origin);
      }
      if(url.pathname==="/api/groups"&&request.method==="GET"){
        const rows=await env.DB.prepare("SELECT id,title,status,order_deadline FROM groups WHERE published=1 ORDER BY created_at DESC LIMIT 100").all();
        return response({ok:true,groups:rows.results||[]},200,origin);
      }
      if(url.pathname==="/api/products"&&request.method==="GET"){
        const groupId=url.searchParams.get("group_id");
        if(!groupId||groupId.length>128)fail("Invalid group");
        const group=await env.DB.prepare("SELECT id FROM groups WHERE id=? AND published=1").bind(groupId).first();
        if(!group)fail("Group not found",404);
        const rows=await env.DB.prepare("SELECT id,group_id,official_sku,name,variant,image_url,price_twd,quantity_limit,status,sort_order FROM products WHERE group_id=? ORDER BY sort_order,name LIMIT 500").bind(groupId).all();
        return response({ok:true,products:rows.results||[]},200,origin);
      }
      if(url.pathname==="/api/auth/request-code"&&request.method==="POST")return response(await otpRequest(await jsonBody(request),env,request),200,origin);
      if(url.pathname==="/api/auth/verify-code"&&request.method==="POST"){
        const verified=await otpVerify(await jsonBody(request),env);
        const result=response(verified,200,origin);
        // Cross-origin legacy bearer callers keep working, but the browser's
        // same-origin customer pages can restore their session across routes.
        result.headers.set("Set-Cookie",customerSessionCookie(verified.token));
        return result;
      }
      if(url.pathname==="/api/auth/session"&&request.method==="GET")return response({ok:true,email:await authorizedEmail(request,env)},200,origin);
      if(url.pathname==="/api/auth/session/logout"&&request.method==="POST"){
        requireSameOriginAction(request);
        const result=response({ok:true},200,origin);
        result.headers.set("Set-Cookie",clearCustomerSessionCookie());
        return result;
      }
      if(url.pathname==="/api/admin/session/start"&&request.method==="POST") {
        // Explicit OTP proof, never create a permanent session from an existing cookie.
        if(!request.headers.get("Authorization")) fail("Authentication required",401);
        requireSameOriginAction(request);
        const owner=await authorizedOwner(request,env);
        await requireOwnerStepUp(request,env);
        const session=await createAdminSession(env,owner);
        const result=response({ok:true,email:owner,expires_at:session.expiresAt},200,origin);
        result.headers.set("Set-Cookie",sessionCookie(session.token));
        return result;
      }
      if(url.pathname==="/api/admin/session"&&request.method==="GET") {
        const owner=await authorizedOwner(request,env);
        const session=await readAdminSession(request,env);
        return response({ok:true,email:owner,expires_at:session.expiresAt},200,origin);
      }
      if(url.pathname==="/api/admin/session/logout"&&request.method==="POST") {
        requireSameOriginAction(request);
        const session=await readAdminSession(request,env);
        requireConfig(env,"PL3_ADMIN_EMAIL");
        if(session.email!==emailOf(env.PL3_ADMIN_EMAIL)) fail("Forbidden",403);
        await revokeAdminSession(env,session);
        const result=response({ok:true},200,origin);
        result.headers.set("Set-Cookie",clearSessionCookie());
        return result;
      }
      if(url.pathname==="/api/admin/session/revoke-all"&&request.method==="POST") {
        requireSameOriginAction(request);
        const session=await readAdminSession(request,env);
        await requireOwnerStepUp(request,env);
        requireConfig(env,"PL3_ADMIN_EMAIL");
        if(session.email!==emailOf(env.PL3_ADMIN_EMAIL))fail("Forbidden",403);
        const revoked=await revokeAllAdminSessions(env,session.email);
        const result=response({ok:true,revoked},200,origin);
        result.headers.set("Set-Cookie",clearSessionCookie());
        return result;
      }
      if(url.pathname==="/api/admin/legacy-payments/archive"&&request.method==="GET") {
        await authorizedOwner(request,env);
        return response(await readLegacyArchive(env),200,origin);
      }
      if(url.pathname==="/api/admin/legacy-payments/preview"&&request.method==="POST") {
        await authorizedOwner(request,env);
        await requireOwnerStepUp(request,env);
        const body=await jsonBody(request);
        if(!Array.isArray(body.rows)||!Array.isArray(body.items)||body.rows.length>100||body.items.length>500)
          fail("Invalid legacy review snapshot");
        let preview;
        try { preview=mapLegacyPayments(body.rows,body.items,{evidenceByOrder:body.evidenceByOrder||{}}); }
        catch { fail("Invalid legacy mapping; verify source identities, amounts and evidence"); }
        return response({ok:true,preview},200,origin);
      }
      if(url.pathname==="/api/admin/formal-sync/status"&&request.method==="GET") {
        await authorizedOwner(request,env);
        return response(await inspectFormalSync(env),200,origin);
      }
      if(url.pathname==="/api/admin/qa/checkout"&&request.method==="POST") {
        await authorizedOwner(request,env);
        await requireOwnerStepUp(request,env);
        return response(await privateQaCheckout(await jsonBody(request),env),201,origin);
      }
      if(url.pathname==="/api/admin/qa/payment-report"&&request.method==="POST") {
        await authorizedOwner(request,env);
        await requireOwnerStepUp(request,env);
        return response(await privateQaPaymentReport(await jsonBody(request),env),201,origin);
      }
      if(url.pathname==="/api/admin/formal-sync/preview"&&request.method==="GET") {
        await authorizedOwner(request,env);
        const id=url.searchParams.get("order_id")||"";
        if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))fail("Invalid order ID");
        return response({ok:true,preview:await formalProjectionForOrder(env,id)},200,origin);
      }
      if(url.pathname==="/api/admin/formal-sync/drain"&&request.method==="POST") {
        await authorizedOwner(request,env);
        await requireOwnerStepUp(request,env);
        return response(await drainFormalOutbox(env),200,origin);
      }
      if(url.pathname==="/api/admin/fulfillments"&&request.method==="GET") {
        await authorizedOwner(request,env);
        return response(await ownerFulfillments(env),200,origin);
      }
      if(url.pathname==="/api/admin/audit-events"&&request.method==="GET") {
        await authorizedOwner(request,env);
        return response(await ownerAuditEvents(env),200,origin);
      }
      if(url.pathname==="/api/admin/orders"&&request.method==="GET") {
        await authorizedOwner(request,env);
        return response(await ownerOrders(env),200,origin);
      }
      if(url.pathname==="/api/admin/sync/drain"&&request.method==="POST") {
        await authorizedOwner(request,env);
        await requireOwnerStepUp(request,env);
        return response(await drainOutbox(env),200,origin);
      }
      if(url.pathname.startsWith('/api/admin/qa-payment-phases/')){
        await authorizedOwner(request,env);
        if(request.method==='POST')await requireOwnerStepUp(request,env);
        if(url.pathname.endsWith('/start')&&request.method==='POST')return response(await qaPaymentStart(env),200,origin);
        if(url.pathname.endsWith('/drain')&&request.method==='POST')return response(await qaPaymentDrain(env),200,origin);
        if(url.pathname.endsWith('/status')&&request.method==='GET')return response(await qaPaymentStatus(env),200,origin);
      }
      if(url.pathname==="/api/admin/payment-reports"&&request.method==="GET") {
        await authorizedOwner(request,env);
        return response(await ownerPaymentReports(env),200,origin);
      }
      if(url.pathname==="/api/admin/payment-reviews"&&request.method==="POST") {
        const actor=await authorizedOwner(request,env);
        await requireOwnerStepUp(request,env);
        return response(await reviewPayment(await jsonBody(request),actor,env),200,origin);
      }
      if(url.pathname==="/api/admin/fulfillment-advances"&&request.method==="POST") {
        const actor=await authorizedOwner(request,env);
        await requireOwnerStepUp(request,env);
        return response(await advanceFulfillment(await jsonBody(request),actor,env),200,origin);
      }
      if(url.pathname==="/api/orders"&&request.method==="GET")return response(await orders(await authorizedEmail(request,env),env),200,origin);
      if(url.pathname==="/api/orders"&&request.method==="POST"){
        const email=await authorizedEmail(request,env);
        return response(await checkout(await jsonBody(request),email,env),201,origin);
      }
      if(url.pathname==="/api/payment-reports"&&request.method==="POST"){
        const email=await authorizedEmail(request,env);
        return response(await paymentReport(await jsonBody(request),email,env),201,origin);
      }
      return response({ok:false,error:"Not Found"},404,origin);
    }catch(error){
      const status=error.status||500;
      if(status===500)console.error("PL3 API failure",error);
      return response({ok:false,error:status===500?"Internal server error":error.message},status,origin);
    }
  }
};
