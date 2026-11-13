import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../worker-api-candidate.js";

const secret = "local-owner-test-key";
const owner = "petitelueur.pl@gmail.com";
const rows = [
  { id: "test-order", customer_email: "customer@example.com", status: "pending" }
];
const reports = [
  { id: "test-report", order_id: "test-order", status: "pending_review" }
];
const fulfillments = [{ id: "test-fulfillment", status: "pending" }];
const events = [{ id: "audit-1", action: "payment.reviewed" }];
const db = {
  prepare(sql) {
    return { async all() {
      return { results: sql.includes("FROM payment_reports pr") ? reports :
        sql.includes("FROM fulfillments f") ? fulfillments :
        sql.includes("FROM audit_events") ? events : rows };
    }};
  }
};
function signed(email) {
  const payload = Buffer.from(JSON.stringify({
    email, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600
  })).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return "Bearer " + payload + "." + mac;
}
async function call(path, auth, env = {
  DB: db, PL3_ADMIN_EMAIL: owner, SESSION_SECRET: secret
}) {
  const request = new Request("https://worker.example" + path, {
    headers: auth ? { Authorization: auth } : {}
  });
  const response = await worker.fetch(request, env);
  return { status: response.status, data: await response.json() };
}
test("owner order overview requires authentication", async () => {
  const result = await call("/api/admin/orders");
  assert.equal(result.status, 401);
});
test("non-owner cannot read other customers or payment reports", async () => {
  for (const path of ["/api/admin/orders", "/api/admin/payment-reports"]) {
    const result = await call(path, signed("other@example.com"));
    assert.equal(result.status, 403);
    assert.equal(result.data.error, "Forbidden");
  }
});
test("signed owner sees read-only orders and pending review queue", async () => {
  const orders = await call("/api/admin/orders", signed(owner));
  const pending = await call("/api/admin/payment-reports", signed(owner));
  assert.equal(orders.status, 200);
  assert.deepEqual(orders.data.orders, rows);
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.data.reports, reports);
});
test("owner endpoint fails closed without server-side owner configuration", async () => {
  const result = await call("/api/admin/orders", signed(owner),
    { DB: db, SESSION_SECRET: secret });
  assert.equal(result.status, 503);
});

test("owner-only fulfillment and audit history reject non-owner", async () => {
  for (const path of ["/api/admin/fulfillments", "/api/admin/audit-events"]) {
    const no = await call(path, signed("other@example.com"));
    assert.equal(no.status, 403);
  }
});
test("owner reads fulfillment queue and audit history", async () => {
  const a = await call("/api/admin/fulfillments", signed(owner));
  const b = await call("/api/admin/audit-events", signed(owner));
  assert.equal(a.status, 200);
  assert.deepEqual(a.data.fulfillments, fulfillments);
  assert.equal(b.status, 200);
  assert.deepEqual(b.data.events, events);
});

test("production refuses legacy public QA page, staging requires explicit gate and owner", async () => {
  const response = await worker.fetch(new Request("https://worker.example/admin-test"), {
    DB: db, PL3_ADMIN_EMAIL: owner, SESSION_SECRET: secret
  });
  assert.equal(response.status,404);
  const gated = await worker.fetch(new Request("https://worker.example/admin-test",{headers:{Authorization:signed(owner)}}), {
    DB: db,PL3_ADMIN_EMAIL:owner,SESSION_SECRET:secret,PL3_PRODUCTION_CUTOVER:'false',PL3_ENABLE_TEST_ROUTES:'true'
  });
  assert.equal(gated.status,200);
  assert.match(await gated.text(),/主購工作台/);
  const prod = await worker.fetch(new Request("https://worker.example/admin-test",{headers:{Authorization:signed(owner)}}), {
    DB:db,PL3_ADMIN_EMAIL:owner,SESSION_SECRET:secret,PL3_PRODUCTION_CUTOVER:'true',PL3_ENABLE_TEST_ROUTES:'true'
  });
  assert.equal(prod.status,404);
});

test('legacy payment preview is owner-only and never invokes order persistence',async()=>{
 const body={rows:[{source_id:'legacy-test',source_url:'https://notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',source_revision:'2026-11-03',goods_twd:100,received_twd:null,second_twd:null,order_status:'待採購',payment_status:'付款資料已提交'}],items:[]};
 for(const [auth,expected] of [[signed(owner),200],[signed('other@example.com'),403],[null,401]]){
  const request=new Request('https://worker.example/api/admin/legacy-payments/preview',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},body:JSON.stringify(body)});
  const r=await worker.fetch(request,{PL3_ADMIN_EMAIL:owner,SESSION_SECRET:secret,DB:{prepare(){throw Error('Preview must never touch order database');}}});
  assert.equal(r.status,expected);
  if(expected===200){const json=await r.json();assert.equal(json.preview.safe_to_import,false);assert.equal(json.preview.counts.review,1);}
 }
});
test('legacy malformed snapshot is rejected without exposing input',async()=>{
 const request=new Request('https://worker.example/api/admin/legacy-payments/preview',{method:'POST',headers:{Authorization:signed(owner),'Content-Type':'application/json'},body:JSON.stringify({rows:[null],items:[]})});
 const r=await worker.fetch(request,{PL3_ADMIN_EMAIL:owner,SESSION_SECRET:secret,DB:db});
 assert.equal(r.status,400);assert.match((await r.json()).error,/Invalid legacy/);
});

test('persisted legacy archive is private to owner',async()=>{
 for(const auth of [undefined,signed('other@example.com')]){
  const r=await call('/api/admin/legacy-payments/archive',auth);
  assert.equal(r.status,auth?403:401);
 }
});

test('operations install, import, commands and private files require owner auth',async()=>{
 for(const path of ['/api/admin/ops','/api/admin/ops/install','/api/admin/ops/import','/api/admin/ops/command','/api/admin/ops/attachment']){
  const res=await worker.fetch(new Request('https://worker.example'+path,{method:path.endsWith('/ops')?'GET':'POST',headers:{Authorization:signed('other@example.com'),'Content-Type':'application/json'},body:path.endsWith('/ops')?undefined:'{}'}),{DB:db,PL3_ADMIN_EMAIL:owner,SESSION_SECRET:secret});assert.equal(res.status,403);
 }
});
test('operations console and customer portal serve a real built application shell',async()=>{
 for(const path of ['/admin-operations','/account']){const r=await worker.fetch(new Request('https://worker.example'+path),{DB:db});assert.equal(r.status,200);const html=await r.text();assert.match(html,/operations-app\.js/);assert.match(html,/viewport/);assert.equal(r.headers.get('X-Frame-Options'),'DENY');}
 const r=await worker.fetch(new Request('https://worker.example/operations-app.js'),{DB:db});assert.equal(r.status,200);assert.match(await r.text(),/Refine|refine/);
});

test('public page previews use customer titles', async()=>{
 for(const [path,title] of [['/account','訂單查詢'],['/shop','商品與團次'],['/services','詢價與委託']]){
  const response=await worker.fetch(new Request('https://worker.example'+path),{DB:db});
  assert.equal(response.status,200);
  const html=await response.text();
  assert.ok(html.includes('<title>Petite Lueur PL｜'+title+'</title>'));
  assert.ok(html.includes('property="og:title" content="Petite Lueur PL｜'+title+'"'));
  assert.doesNotMatch(html,/營運工作台/);
 }
});
