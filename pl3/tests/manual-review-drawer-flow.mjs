import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const first = html.indexOf('  // Keep the approved storefront checkout drawer for shipping-pending goods.');
const last = html.indexOf('  function plCampaignItemHtml(', first);
assert.ok(first >= 0 && last > first);

function harness({reviewPending = true} = {}) {
  const ids = ['plReviewOverlay','plReviewLoading','plReviewForm','plReviewSuccess','plReviewName','plReviewEmail','plReviewContact','plReviewOtp','plReviewQty','plReviewAdult','plReviewNoAbandon','plReviewTerms','plReviewOtpStep','plReviewSendCode','plReviewSubmit','plReviewMessage','plReviewProductName','plReviewProductCode','plReviewPrice','plReviewCount','plReviewTotal','plReviewSuccessId','plReviewDelivery','cartOverlay','productOverlay','guideOverlay'];
  const nodes = Object.fromEntries(ids.map(id => [id, {value: '', textContent: '', checked: false, disabled: false, className: '', style: {}, focus() { this.focused = true; }, classList: {
    values: new Set(['hidden']), add(x) { this.values.add(x); }, remove(x) { this.values.delete(x); }, contains(x) { return this.values.has(x); }
  }}]));
  const calls = [];
  const product = {id:'catalog:NEOGDS-1098444',group_id:'NEOWING-KIMISHINU-FIG-261028',name:'席娜＆美美 1/8 模型',sku:'NEOGDS-1098444',variant:'雙人組',price_twd:7590,quantity_limit:3,shipping_pending:reviewPending,manual_review_required:reviewPending};
  const responses = {
    '/api/operations/catalog': {ok:true,groups:[{id:product.group_id,title:'模型團'}],products:[product]},
    '/api/auth/request-code': {ok:true},
    '/api/auth/verify-code': {ok:true,token:'verified-token'},
    '/api/operations/checkout': {ok:true,result:{status:'review_pending',order_id:'PL3-review-test'}}
  };
  const context = {window:{PL_OFFLINE_PREVIEW:false},document:{getElementById:id=>nodes[id],activeElement:nodes.plReviewSendCode,addEventListener(){},body:{style:{}}},crypto:{randomUUID:()=> '12345678-1234-1234-1234-123456789012'},fetch:async(path,init)=>{calls.push({path,init});return {ok:true,json:async()=>responses[path]};},money:n=>'NT$'+n.toLocaleString('en-US'),Number,String,JSON,Error,RegExp};
  vm.createContext(context);
  vm.runInContext(html.slice(first,last),context);
  return {context,nodes,calls,product};
}

test('review drawer matches the PL3 catalog, verifies email and sends a review-only application', async () => {
  const {context,nodes,calls,product} = harness();
  await context.plOpenReviewApplication(product.id);
  assert.equal(nodes.plReviewOverlay.classList.contains('hidden'),false);
  assert.equal(nodes.plReviewForm.classList.contains('hidden'),false);
  assert.equal(nodes.plReviewPrice.textContent,'NT$7,590');
  assert.equal(nodes.plReviewQty.max,'2','enforce NT$22,000 checkout cap');

  nodes.plReviewName.value='測試人';nodes.plReviewEmail.value='owner@example.com';nodes.plReviewContact.value='@customer';nodes.plReviewDelivery.value='7-ELEVEN 賣貨便－運費 NT$38';
  nodes.plReviewAdult.checked=true;nodes.plReviewNoAbandon.checked=true;nodes.plReviewTerms.checked=true;
  await context.plReviewRequestCode();
  assert.equal(nodes.plReviewOtpStep.classList.contains('hidden'),false);
  nodes.plReviewOtp.value='123456';
  await context.plReviewSubmitApplication();
  const checkout=calls.find(x=>x.path==='/api/operations/checkout');
  assert.ok(checkout);
  const body=JSON.parse(checkout.init.body);
  assert.equal(body.review_only,true);
  assert.equal(body.group_id,product.group_id);
  assert.equal(body.contact,'@customer');
  assert.equal(body.delivery_method,'7-ELEVEN 賣貨便－運費 NT$38');
  assert.equal(body.no_abandon_confirmed,true);
  assert.equal(body.items[0].product_id,product.id);
  assert.equal(checkout.init.headers.Authorization,'Bearer verified-token');
  assert.equal(nodes.plReviewSuccess.classList.contains('hidden'),false);
  assert.match(nodes.plReviewSuccessId.textContent,/PL3-review-test/);
  assert.equal(calls.some(x=>x.path==='plStoreSubmitOrder'),false);
});

test('rejects a product that is no longer manual-review eligible before requesting OTP', async () => {
  const {context,nodes,calls,product}=harness({reviewPending:false});
  await context.plOpenReviewApplication(product.id);
  assert.equal(nodes.plReviewForm.classList.contains('hidden'),true);
  assert.match(nodes.plReviewLoading.textContent,/未開放人工審核/);
  assert.equal(calls.length,1);
});
