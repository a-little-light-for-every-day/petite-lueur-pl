import test from "node:test";
import assert from "node:assert/strict";
import frontdoor from "../frontdoor-worker.js";

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
