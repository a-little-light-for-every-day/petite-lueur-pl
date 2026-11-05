import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const homepage = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const first = homepage.indexOf('function plCampaignItemHtml(');
const last = homepage.indexOf('function plInfoCampaignCard(', first);
assert.ok(first > 0 && last > first, 'homepage item renderer found');

function render(product) {
  const context = {
    activeMode: 'formal',
    window: {PL_STATIC_HOSTED: false},
    plCatalogVerified: true,
    plExactVariantSources: () => null,
    storeMode: () => 'formal',
    plModeOriginalLink: () => 'https://www.neowing.co.jp/product/NEOGDS-1098444',
    esc: text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
    isOrderable: () => false,
    plPublicCampaignOpen: () => true,
    deadlineExpired: () => false,
    money: n => 'NT$' + Number(n).toLocaleString('en-US'),
    encodeURIComponent,
    JSON,
    Number,
    String
  };
  vm.createContext(context);
  vm.runInContext(homepage.slice(first, last), context);
  return context.plCampaignItemHtml(product);
}

test('published shipping-pending model links directly to PL3 review-only application', () => {
  const p = {
    id: 'model-1',
    title: '席娜＆美美 1/8 模型',
    code: 'NEOGDS-1098444',
    price: 7590,
    shippingPending: true,
    manualReviewRequired: true,
    soldOut: false
  };
  const html = render(p);
  assert.match(html, /運費待實算・人工審核申請/);
  assert.match(html, /人工審核申請 ＋/);
  const href = html.match(/href="(\/shop#cart=[^"]+)"/);
  assert.ok(href);
  assert.deepEqual(JSON.parse(decodeURIComponent(href[1].split('#cart=')[1])), [{product_id: p.id, quantity: 1}]);
  assert.doesNotMatch(html, /data-pl-order=/, 'legacy checkout must not open');
});

test('unapproved pending-shipping items cannot get an application link', () => {
  const html = render({id: 'model-2', title: '草稿模型', price: 7590, shippingPending: true, manualReviewRequired: false});
  assert.doesNotMatch(html, /人工審核申請 ＋/);
  assert.match(html, /詢問確認/);
});
