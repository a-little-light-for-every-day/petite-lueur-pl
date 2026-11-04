import test from "node:test";
import assert from "node:assert/strict";
import frontdoor from "../frontdoor-worker.js";
import approvedStorefront from "../storefront-preview-html.js";
import legacyCutover from "../storefront-cutover-source.js";

const HOST = "https://a-little-light-for-every-day.petitelueur-pl.workers.dev";

test("PL3 front door passes original same-origin request through service binding", async () => {
  const seen = [];
  const env = {PL3_BACKEND: {fetch(request) {
    seen.push(request);
    return new Response("PL3", {status: 200, headers: {"Set-Cookie": "__Host-pl3_customer=example; Path=/; Secure; HttpOnly; SameSite=Strict"}});
  }}};
  const request = new Request(HOST + "/api/auth/session", {
    method: "POST",
    headers: {Origin: HOST, "Sec-Fetch-Site": "same-origin", "X-PL3-Admin-Action": "1"},
    body: "{}"
  });
  const result = await frontdoor.fetch(request, env);
  assert.equal(result.status, 200);
  assert.equal(seen[0], request);
  assert.equal(new URL(seen[0].url).origin, seen[0].headers.get("Origin"));
  assert.match(result.headers.get("Set-Cookie"), /__Host-pl3_customer/);
});

test("PL3 front door rejects unbound host before reaching backend", async () => {
  let called = false;
  const result = await frontdoor.fetch(new Request("https://wrong.example/account"), {
    PL3_BACKEND: {fetch() { called = true; }}
  });
  assert.equal(result.status, 404);
  assert.equal(called, false);
});

test("PL3 branded homepage restores the approved six-card storefront and same-origin handoff", async () => {
  const seen = [];
  const env = {PL3_BACKEND: {fetch(request) {
    seen.push(new URL(request.url).pathname);
    return new Response(approvedStorefront);
  }}};
  const result = await frontdoor.fetch(new Request(HOST + "/"), env);
  assert.equal(result.status, 200);
  assert.deepEqual(seen, ["/storefront-preview"]);
  const html = await result.text();
  assert.match(html, /今天需要哪一項 PL 服務/);
  assert.match(html, /日本周邊情報/);
  assert.match(html, /data-pl3-cutover="1"/);
  assert.match(html, /src="\/storefront-cutover\.js"/);
  assert.doesNotMatch(html, /src="https:\/\/pl3-staging-api\.petitelueur-pl\.workers\.dev\/storefront-cutover\.js"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/a-little-light-for-every-day\.petitelueur-pl\.workers\.dev\/">/);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
});

test("PL3 cutover uses canonical same-origin APIs and preserves checkout routes", async () => {
  const env = {PL3_BACKEND: {fetch: () => new Response(legacyCutover)}};
  const result = await frontdoor.fetch(new Request(HOST + "/storefront-cutover.js"), env);
  assert.equal(result.status, 200);
  const js = await result.text();
  assert.match(js, /const base=location\.origin,old=/);
  assert.match(js, /go\('\/shop','\#cart='/);
  assert.match(js, /api\/operations\/legacy-catalog/);
  assert.doesNotMatch(js, /const base='https:\/\/pl3-staging-api/);
});

test("PL3 restoration fails closed if the backend no longer provides the reviewed layout", async () => {
  const env = {PL3_BACKEND: {fetch: () => new Response("<html>unreviewed design</html>")}};
  const result = await frontdoor.fetch(new Request(HOST), env);
  assert.equal(result.status, 502);
});
