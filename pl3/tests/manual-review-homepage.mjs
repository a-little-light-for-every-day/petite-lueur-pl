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

test('published shipping-pending model opens the branded order drawer for PL3 review', () => {
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
  assert.match(html, /<button[^>]+data-pl-review="model-1"[^>]+plOpenReviewApplication\(this\.dataset\.plReview\)/);
  assert.doesNotMatch(html, /\/shop#cart=/, 'no longer routes to a separate unbranded page');
  assert.doesNotMatch(html, /data-pl-order=/, 'legacy checkout must not open');
});

test('unapproved pending-shipping items cannot get an application link', () => {
  const html = render({id: 'model-2', title: '草稿模型', price: 7590, shippingPending: true, manualReviewRequired: false});
  assert.doesNotMatch(html, /人工審核申請 ＋/);
  assert.match(html, /詢問確認/);
});

test('branded review drawer uses verified PL3 checkout and preserves review-only status', () => {
  assert.match(homepage, /id="plReviewOverlay" class="overlay hidden"/);
  for (const id of ['plReviewName', 'plReviewEmail', 'plReviewContact', 'plReviewDelivery', 'plReviewAdult', 'plReviewTerms', 'plReviewOtp'])
    assert.match(homepage, new RegExp('id="' + id + '"'));
  assert.match(homepage, /plReviewApi\('\/api\/auth\/request-code'/);
  assert.match(homepage, /plReviewApi\('\/api\/auth\/verify-code'/);
  assert.match(homepage, /plReviewApi\('\/api\/operations\/checkout',\{key:plReviewAttempt,review_only:true/);
  assert.match(homepage, /result\.result\?\.status!=='review_pending'/);
});
