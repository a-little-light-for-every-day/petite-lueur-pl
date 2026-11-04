import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleCatalogProducts, selectedGroupCart } from '../catalog-search.js';

const catalog = {
  groups: [
    { id: 'given', title: 'GIVEN 海へ 角色拆團' },
    { id: 'tamon', title: '多聞くん 壓克力' },
  ],
  products: [
    { id: 'p1', group_id: 'given', name: '真冬立牌', variant: '藍色', sku: 'ABC-01', price_twd: 480 },
    { id: 'p2', group_id: 'given', name: '立夏吊飾', variant: '紅色', sku: 'ABC-02', price_twd: 250 },
    { id: 'p3', group_id: 'tamon', name: '福原多聞立牌', variant: 'A', sku: '4970381943066', price_twd: 530 },
  ],
};

test('public search finds a product across groups, variants and SKU without changing published groups', () => {
  assert.deepEqual(visibleCatalogProducts(catalog, '多聞').map(x => x.id), ['p3']);
  assert.deepEqual(visibleCatalogProducts(catalog, '真冬 藍色').map(x => x.id), ['p1']);
  assert.deepEqual(visibleCatalogProducts(catalog, 'ＡＢＣ－０２').map(x => x.id), ['p2']);
  assert.deepEqual(visibleCatalogProducts(catalog, 'GIVEN').map(x => x.id), ['p1', 'p2']);
  assert.deepEqual(visibleCatalogProducts(catalog, '多聞', 'given'), []);
});

test('search filters never remove a selected cart item or include another group at checkout', () => {
  const cart = { p1: 2, p2: 1, p3: 1 };
  assert.deepEqual(visibleCatalogProducts(catalog, '真冬', 'given').map(x => x.id), ['p1']);
  const review = selectedGroupCart(catalog.products, cart, 'given');
  assert.deepEqual(review.products.map(x => x.id), ['p1', 'p2']);
  assert.equal(review.quantity, 3);
  assert.equal(review.total, 1210);
});

test('unknown group and no query cannot leak orphan products into customer search', () => {
  assert.deepEqual(visibleCatalogProducts({ groups: [], products: catalog.products }, '').map(x => x.id), []);
});
