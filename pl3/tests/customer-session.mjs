import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import worker from '../worker-api-candidate.js';

const BASE = 'https://worker.example';
const EMAIL = 'customer@example.com';
const SECRET = 'test-only-customer-session-secret';
const PEPPER = 'test-only-otp-pepper';
const CODE = '123456';
const digest = s => createHash('sha256').update(s).digest('base64url');
function signed(email = EMAIL, exp = Math.floor(Date.now() / 1000) + 3600) {
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  return payload + '.' + createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function envFor() {
  const record = { id:'otp-test', code_hash:digest(PEPPER + ':' + EMAIL + ':' + CODE), expires_at:new Date(Date.now() + 600000).toISOString(), attempts:0 };
  return {
    SESSION_SECRET: SECRET, OTP_PEPPER: PEPPER,
    DB: { prepare(sql) { return {
      bind() { return this; },
      async first() { return sql.includes('FROM otp_codes') ? record : null; },
      async run() { if(!sql.includes('UPDATE otp_codes SET used_at')) throw Error('Unexpected mutation');return { meta:{ changes:1 } }; },
      async all() { return { results:[] }; }
    }; } }
  };
}
const customerCookie = token => '__Host-pl3_customer=' + token;
async function get(path, cookie = '') {
  const res = await worker.fetch(new Request(BASE + path, { headers:cookie ? { Cookie:cookie } : {} }), envFor());
  return { status:res.status, body:await res.json() };
}

test('successful email OTP creates one-hour HttpOnly host-only session cookie', async () => {
  const res = await worker.fetch(new Request(BASE + '/api/auth/verify-code', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ email:EMAIL, code:CODE })
  }), envFor());
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.expires_in, 3600);
  const cookie = res.headers.get('Set-Cookie');
  assert.match(cookie, /^__Host-pl3_customer=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
  assert.match(cookie, /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600/);
  assert.doesNotMatch(cookie, /Domain=/);
  const restored = await get('/api/auth/session', cookie.split(';')[0]);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.email, EMAIL);
});

test('cross-page customer routes accept signed cookie and never reveal other emails', async () => {
  const cookie = customerCookie(signed());
  for (const path of ['/api/auth/session', '/api/orders']) {
    const result = await get(path, cookie);
    assert.equal(result.status, 200, path);
  }
  assert.equal((await get('/api/auth/session', customerCookie(signed('other@example.com')))).body.email, 'other@example.com');
  assert.equal((await get('/api/auth/session')).status, 401);
  assert.equal((await get('/api/auth/session', customerCookie(signed(EMAIL, Math.floor(Date.now()/1000)-1)))).status, 401);
  assert.equal((await get('/api/auth/session', customerCookie('malformed'))).status, 401);
});

test('cookie-based customer changes require a same-origin action header', async () => {
  const cookie=customerCookie(signed());
  const send=(origin,action)=>worker.fetch(new Request(BASE+'/api/operations/checkout', {
    method:'POST', headers:{ Cookie:cookie, Origin:origin, 'Content-Type':'application/json', ...(action?{'X-PL3-Admin-Action':'1'}:{}) },body:'{}'
  }),envFor());
  assert.equal((await send('https://evil.example',true)).status,403);
  assert.equal((await send(BASE,false)).status,403);
  // Valid CSRF proof reaches order validation (rather than rejecting auth).
  const allowed = await send(BASE,true);
  assert.notEqual(allowed.status,401);
  assert.notEqual(allowed.status,403);
});

test('clearing customer cookie requires same-origin action and does not affect admin cookie', async () => {
  const logout=(origin,action)=>worker.fetch(new Request(BASE+'/api/auth/session/logout', {
    method:'POST',headers:{ Origin:origin,...(action?{'X-PL3-Admin-Action':'1'}:{}) }
  }),envFor());
  assert.equal((await logout('https://evil.example',true)).status,403);
  const res=await logout(BASE,true);
  assert.equal(res.status,200);
  assert.match(res.headers.get('Set-Cookie'),/^__Host-pl3_customer=;.*Max-Age=0/);
});
