import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../worker-api-candidate.js";

const OWNER = "petitelueur.pl@gmail.com";
const SECRET = "local-only-session-secret";
const BASE = "https://worker.example";
const STATE = () => ({ sessions: new Map(), orders: [{id:"qa-order",group_id:"PL3-QA-LOCAL",total_twd:350}] });
function signed(email=OWNER, issuedAt=Math.floor(Date.now()/1000)) {
  const payload=Buffer.from(JSON.stringify({email,iat:issuedAt,exp:Math.floor(Date.now()/1000)+3600})).toString("base64url");
  return "Bearer "+payload+"."+createHmac("sha256",SECRET).update(payload).digest("base64url");
}
function envFor(state) {
  return {
    SESSION_SECRET:SECRET,PL3_ADMIN_EMAIL:OWNER,
    DB: {
      prepare(sql) {
        return {
          args:[], bind(...args){this.args=args;return this;},
          async run(){
            if(sql.startsWith("INSERT INTO admin_sessions")) {
              const [id,hash,owner_email,created_at,last_seen_at,expires_at,idle_expires_at]=this.args;
              state.sessions.set(hash,{id,hash,owner_email,created_at,last_seen_at,expires_at,idle_expires_at,revoked_at:null});
              return {meta:{changes:1}};
            }
            if(sql.startsWith("UPDATE admin_sessions SET revoked_at")) {
              if(this.args.length===2){const [time,owner]=this.args;let changed=0;for(const row of state.sessions.values())if(row.owner_email===owner&&row.revoked_at===null){row.revoked_at=time;changed++;}return {meta:{changes:changed}};}
              const [time,id,hash]=this.args;const row=state.sessions.get(hash);
              if(row?.id===id)row.revoked_at=time;
              return {meta:{changes:row?1:0}};
            }
            if(sql.startsWith("UPDATE admin_sessions SET last_seen_at")) {
              const [time,idle,id,hash]=this.args;
              const row=state.sessions.get(hash);
              if(row?.id===id){row.last_seen_at=time;row.idle_expires_at=idle;}
              return {meta:{changes:row?1:0}};
            }
            throw new Error("Unexpected SQL run: "+sql);
          },
          async first(){
            if(sql.includes("FROM admin_sessions")) {
              const [hash,now,nowIdle]=this.args;
              const row=state.sessions.get(hash);
              return row&&row.revoked_at===null&&row.expires_at>now&&row.idle_expires_at>nowIdle?row:null;
            }
            throw new Error("Unexpected SQL first: "+sql);
          },
          async all(){
            if(sql.includes("FROM orders o"))return {results:state.orders};
            throw new Error("Unexpected SQL all: "+sql);
          }
        };
      }
    }
  };
}
async function call(env,path,{method="GET",bearer="",cookie="",origin=BASE,action=false}={}) {
  const headers={};
  if(bearer)headers.Authorization=bearer;
  if(cookie)headers.Cookie=cookie;
  if(origin)headers.Origin=origin;
  if(action)headers["X-PL3-Admin-Action"]="1";
  const response=await worker.fetch(new Request(BASE+path,{method,headers}),env);
  return {status:response.status,body:await response.json(),cookie:response.headers.get("Set-Cookie")||""};
}
async function signedIn(state) {
  const env=envFor(state);
  const created=await call(env,"/api/admin/session/start",{method:"POST",bearer:signed(),action:true});
  assert.equal(created.status,200);
  assert.match(created.cookie,/^__Host-pl3_admin=[A-Za-z0-9_-]{43};/);
  return {env,cookie:created.cookie.split(";")[0]};
}
test("valid owner OTP bearer creates opaque HttpOnly host-only persistent cookie",async()=>{
  const state=STATE(),{env,cookie}=await signedIn(state);
  assert.equal(state.sessions.size,1);
  const session=await call(env,"/api/admin/session",{cookie});
  assert.equal(session.status,200);
  assert.equal(session.body.email,OWNER);
  const active=await call(env,"/api/admin/orders",{cookie});
  assert.equal(active.status,200);
  assert.deepEqual(active.body.orders,state.orders);
  const setCookie=(await call(env,"/api/admin/session/start",{method:"POST",bearer:signed(),action:true})).cookie;
  assert.match(setCookie,/HttpOnly; Secure; SameSite=Strict; Max-Age=2592000/);
  assert.doesNotMatch(setCookie,/Domain=/);
});
test("a non-owner or missing bearer cannot create an owner session",async()=>{
  const state=STATE(),env=envFor(state);
  assert.equal((await call(env,"/api/admin/session/start",{method:"POST",bearer:signed("attacker@example.com"),action:true})).status,403);
  assert.equal((await call(env,"/api/admin/session/start",{method:"POST",action:true})).status,401);
  assert.equal(state.sessions.size,0);
});
test("cookie cannot submit administrator writes from a foreign origin or without action header",async()=>{
  const state=STATE(),{env,cookie}=await signedIn(state);
  const path="/api/admin/payment-reviews";
  assert.equal((await call(env,path,{method:"POST",cookie,origin:"https://evil.example",action:true})).status,403);
  assert.equal((await call(env,path,{method:"POST",cookie})).status,403);
  // Even the logout route is a state change and must be CSRF-protected.
  assert.equal((await call(env,"/api/admin/session/logout",{method:"POST",cookie,origin:"https://evil.example",action:true})).status,403);
  assert.equal((await call(env,"/api/admin/session",{cookie})).status,200);
});
test("logout revokes the server-side session and clears the cookie",async()=>{
  const state=STATE(),{env,cookie}=await signedIn(state);
  const out=await call(env,"/api/admin/session/logout",{method:"POST",cookie,action:true});
  assert.equal(out.status,200);
  assert.match(out.cookie,/Max-Age=0/);
  assert.equal((await call(env,"/api/admin/session",{cookie})).status,401);
  assert.equal((await call(env,"/api/admin/orders",{cookie})).status,401);
});
test("expired or idle sessions fail closed",async()=>{
  const state=STATE(),{env,cookie}=await signedIn(state);
  const row=[...state.sessions.values()][0];
  row.idle_expires_at=Math.floor(Date.now()/1000)-1;
  assert.equal((await call(env,"/api/admin/session",{cookie})).status,401);
});
test("stale OTP proof cannot mint a fresh high-privilege session",async()=>{
  const env=envFor(STATE());
  assert.equal((await call(env,"/api/admin/session/start",{method:"POST",bearer:signed(OWNER,Math.floor(Date.now()/1000)-600),action:true})).status,428);
});
test("long-lived owner view remains available, sensitive actions require fresh verification",async()=>{
  const state=STATE(),{env,cookie}=await signedIn(state);
  const row=[...state.sessions.values()][0];row.created_at-=1800;
  assert.equal((await call(env,"/api/admin/session",{cookie})).status,200);
  assert.equal((await call(env,"/api/admin/ops/export",{cookie})).status,428);
});
test("revoke all devices invalidates every owner cookie",async()=>{
  const state=STATE(),{env,cookie}=await signedIn(state);
  const second=await call(env,"/api/admin/session/start",{method:"POST",bearer:signed(),action:true});
  const secondCookie=second.cookie.split(";")[0];
  const revoked=await call(env,"/api/admin/session/revoke-all",{method:"POST",cookie,action:true});
  assert.equal(revoked.status,200);assert.equal(revoked.body.revoked,2);
  assert.equal((await call(env,"/api/admin/session",{cookie})).status,401);
  assert.equal((await call(env,"/api/admin/session",{cookie:secondCookie})).status,401);
});
