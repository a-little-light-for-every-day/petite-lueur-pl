import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatTaiwanCutoff, legacyOperationsCatalog } from '../storefront-handoff.js';

test('PL storefront displays Taiwan intake cutoff while retaining the ISO deadline for order checks', () => {
 const raw = '2026-11-15T14:00:00.000Z';
 assert.equal(formatTaiwanCutoff(raw), '2026/11/15 22:00（台灣時間）');
 const state = {
  groups: [{ id: 'MAYLA', title: 'MAYLA × Violet Evergarden', status: 'open', deadline: raw }],
  products: [{ id: 'skirt', group_id: 'MAYLA', name: '聯名大圓傘裙', price_twd: 5970, status: 'available', published: true, shipping_units: 8 }],
  orders: [],
 };
 const result = legacyOperationsCatalog(state);
 assert.equal(result.products.length, 1);
 assert.equal(result.products[0].preorderDeadline, raw);
 assert.equal(result.products[0].preorderDeadlineLabel, '2026/11/15 22:00（台灣時間）');
 assert.equal(result.campaigns[0].deadline, raw);
 const storefront = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
 assert.match(storefront, /detailLabel">PL 收單截止<\/div>/);
 assert.match(storefront, /preorderDeadlineLabel\|\|deadlineDisplayTaiwan\(p\.preorderDeadline\)/);
});
