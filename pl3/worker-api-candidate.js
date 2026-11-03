import { mapLegacyPayments } from "./legacy-payment-mapper.js";
import { reviewPayment, advanceFulfillment } from "./admin-operations.js";
import { drainOutbox } from "./sync-outbox.js";
import { inspectFormalSync, formalProjectionForOrder, drainFormalOutbox } from "./formal-sync.js";
import adminHtml from "./admin-html.js";
import { createAdminSession, readAdminSession, revokeAdminSession, sessionCookie, clearSessionCookie, requireSameOriginAction } from "./admin-session.js";
// PL 3.0 staging API candidate. Requires migration 0002 and Worker secrets.
// Never deploy as production before integration tests and reconciliation.
const ORIGIN = "https://a-little-light-for-every-day.github.io";
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
  const payload=b64(encoder.encode(JSON.stringify({email,exp:expiry})));
  return payload+"."+await hmac(env.SESSION_SECRET,payload);
}
async function authorizedEmail(request,env) {
  requireConfig(env,"SESSION_SECRET");
  const match=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get("Authorization")||"");
  if(!match) fail("Authentication required",401);
  const [payload,signature]=match[1].split(".");
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
async function otpRequest(body,env) {
  requireConfig(env,"OTP_PEPPER","GMAIL_CLIENT_ID","GMAIL_CLIENT_SECRET","GMAIL_REFRESH_TOKEN","GMAIL_SENDER");
  const email=emailOf(body.email);if(!email) fail("Invalid email");
  const windowStart=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString();
  const rate=await env.DB.prepare("SELECT count FROM email_rate_limits WHERE email=? AND purpose='otp' AND window_start=?").bind(email,windowStart).first();
  if((rate?.count||0)>=5) fail("Too many requests",429);
  const bytes=crypto.getRandomValues(new Uint32Array(1));
  const code=String(bytes[0]%1000000).padStart(6,"0");
  const id=crypto.randomUUID();
  const expires=new Date(Date.now()+10*60000).toISOString();
  const hash=await digest(env.OTP_PEPPER+":"+email+":"+code);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO otp_codes(id,email,code_hash,expires_at) VALUES(?,?,?,?)").bind(id,email,hash,expires),
    env.DB.prepare("INSERT INTO email_rate_limits(email,purpose,window_start,count) VALUES(?,'otp',?,1) ON CONFLICT(email,purpose,window_start) DO UPDATE SET count=count+1").bind(email,windowStart)
  ]);
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
async function checkout(body,email,env) {
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
  if(!group||group.published!==1||group.status!=="open") fail("Group unavailable",409);
  if(group.order_deadline&&Date.parse(group.order_deadline)<=Date.now()) fail("Group closed",409);
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
  async fetch(request,env) {
    const url=new URL(request.url),origin=request.headers.get("Origin")||"";
    if(request.method==="OPTIONS") {
      if(origin!==ORIGIN)return response({error:"Origin forbidden"},403,origin);
      return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Authorization,Content-Type","Access-Control-Max-Age":"600","Vary":"Origin"}});
    }
    try {
      if(!env.DB)fail("Database binding missing",503);
      if(url.pathname==="/admin-test"&&request.method==="GET") {
        return new Response(adminHtml,{status:200,headers:{
          "Content-Type":"text/html; charset=utf-8",
          "Cache-Control":"no-store",
          "X-Content-Type-Options":"nosniff",
          "X-Frame-Options":"DENY",
          "Referrer-Policy":"no-referrer",
          "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        }});
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
      if(url.pathname==="/api/auth/request-code"&&request.method==="POST")return response(await otpRequest(await jsonBody(request),env),200,origin);
      if(url.pathname==="/api/auth/verify-code"&&request.method==="POST")return response(await otpVerify(await jsonBody(request),env),200,origin);
      if(url.pathname==="/api/admin/session/start"&&request.method==="POST") {
        // Explicit OTP proof, never create a permanent session from an existing cookie.
        if(!request.headers.get("Authorization")) fail("Authentication required",401);
        requireSameOriginAction(request);
        const owner=await authorizedOwner(request,env);
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
      if(url.pathname==="/api/admin/legacy-payments/preview"&&request.method==="POST") {
        await authorizedOwner(request,env);
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
      if(url.pathname==="/api/admin/formal-sync/preview"&&request.method==="GET") {
        await authorizedOwner(request,env);
        const id=url.searchParams.get("order_id")||"";
        if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))fail("Invalid order ID");
        return response({ok:true,preview:await formalProjectionForOrder(env,id)},200,origin);
      }
      if(url.pathname==="/api/admin/formal-sync/drain"&&request.method==="POST") {
        await authorizedOwner(request,env);
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
        return response(await drainOutbox(env),200,origin);
      }
      if(url.pathname==="/api/admin/payment-reports"&&request.method==="GET") {
        await authorizedOwner(request,env);
        return response(await ownerPaymentReports(env),200,origin);
      }
      if(url.pathname==="/api/admin/payment-reviews"&&request.method==="POST") {
        const actor=await authorizedOwner(request,env);
        return response(await reviewPayment(await jsonBody(request),actor,env),200,origin);
      }
      if(url.pathname==="/api/admin/fulfillment-advances"&&request.method==="POST") {
        const actor=await authorizedOwner(request,env);
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
