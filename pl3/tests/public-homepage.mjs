import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker-api-candidate.js";

const env = {DB:{}};
const get = (path) => worker.fetch(new Request("https://pl3.example" + path), env);

test("PL3 official homepage is available on its own root origin", async () => {
  for (const path of ["/", "/index.html"]) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /^text\/html/);
    assert.match(response.headers.get("Content-Security-Policy"), /default-src 'none'/);
    const html = await response.text();
    assert.match(html, /Petite Lueur PL/);
    assert.match(html, /href="\/shop"/);
    assert.match(html, /href="\/services"/);
    assert.match(html, /href="\/account"/);
    assert.match(html, /href="\/privacy"/);
    assert.match(html, /data:image\/jpeg;base64,/);
    assert.doesNotMatch(html, /__PL_OFFICIAL_LOGO__|script\.google\.com\/macros/);
  }
});

test("PL3 privacy notice is same-origin and available at both paths", async () => {
  for (const path of ["/privacy", "/privacy.html"]) {
    const response = await get(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /資料使用與隱私說明/);
    assert.match(html, /gmail\.send/);
    assert.match(html, /href="\/"/);
  }
});

test("public pages do not expose operational admin content", async () => {
  const html = await (await get("/")).text();
  assert.doesNotMatch(html, /\/api\/admin\/ops|SESSION_SECRET|OTP_PEPPER/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});
