// Run against a locally seeded D1 Worker: npm run test:smoke
const base = process.env.PL3_TEST_BASE_URL || 'http://127.0.0.1:8787';
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const health = await fetch(base + '/api/health');
assert(health.ok, 'Health endpoint unavailable');
const h = await health.json();
assert(h.environment === 'staging', 'Wrong environment');

const catalog = await fetch(base + '/api/catalog', { cache: 'no-store' });
assert(catalog.ok, 'Catalog endpoint unavailable');
assert(catalog.headers.get('cache-control') === 'no-store', 'Catalog must not use stale cache');
const body = await catalog.json();
assert(body.environment === 'staging', 'Wrong catalog environment');
assert(body.count === 1, 'Expected only 1 approved/unexpired/demo product');
assert(body.products[0].id === 'demo-product-visible', 'Unexpected published product');
for (const product of body.products) {
  for (const key of ['email','nameOfBuyer','bankAccount','realCost','adminNote','codeHash']) {
    assert(!(key in product), 'Leaked private field ' + key);
  }
}
const post = await fetch(base + '/api/catalog', { method: 'POST' });
assert(post.status === 405, 'Staging must not allow public writes');
console.log('PL3 staging smoke checks passed: health, visibility, expiry, privacy, read-only API.');
