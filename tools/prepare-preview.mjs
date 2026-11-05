import fs from 'node:fs';
import { approvedPublicCatalog, getLiveApprovedCatalog } from './refresh-public-catalog.mjs';

// The branded organization is the only production publishing destination.
const owner = String(process.env.GITHUB_REPOSITORY_OWNER || '').toLowerCase();
if (owner !== 'a-little-light-for-every-day') {
  throw new Error('The PL storefront may only publish from its branded organization');
}
const origin = 'https://a-little-light-for-every-day.github.io';
const legacyOrigin = 'https://saoririri.github.io';
let html = fs.readFileSync('index.html', 'utf8');
html = html.replaceAll(legacyOrigin, origin);

// Only an already approved public catalog snapshot is bundled into public Pages.
// Customer/order data and all server-side credentials remain in Apps Script/Notion.
const payloadPattern = /(<div\b[^>]*\bid="plInitialStoreData"[^>]*\bdata-payload=")([^"]+)(")/;
const payload = html.match(payloadPattern);
if (!payload) throw new Error('Approved public catalog snapshot is missing');
const previous = JSON.parse(Buffer.from(payload[2], 'base64url').toString('utf8'));
const approvedSnapshot = approvedPublicCatalog(previous);
let data = approvedSnapshot;
if (process.env.PL_REFRESH_CATALOG === 'true') {
  try {
    const fresh = await getLiveApprovedCatalog(approvedSnapshot.products.length);
    // A sudden partial group is an unsafe cache regression, not an instruction
    // to silently unpublish otherwise approved SKUs.
    const countAikatsu = items => items.filter(p => p.campaignCode === 'PL-AIKATSU-261031').length;
    const before = countAikatsu(approvedSnapshot.products);
    const after = countAikatsu(fresh.products);
    if (before >= 90 && after < before) {
      throw new Error('Partial Aikatsu catalog in live export: ' + after + '/' + before);
    }
    data = fresh;
  } catch (error) {
    // Keep the already approved, field-whitelisted snapshot on transient GAS
    // export failures; do not publish an empty catalog or private data.
    console.warn('PL approved catalog refresh unavailable; preserving existing snapshot:', error.message);
    data = { ...approvedSnapshot, sourceMode: 'approved-snapshot-fallback', cacheHit: true };
  }
}
if (data.siteSettings) {
  data.siteSettings.canonicalUrl = origin + '/petite-lueur-pl/';
}
// The Aikatsu catalogue may fall back to an approved snapshot during a slow Notion read.
// Keep the approved 90 SKUs, exact official item identifier, and hard 12:00 close consistent.
// Server-side acceptance is independently enforced by Apps Script v259.
const aikatsuCode = 'PL-AIKATSU-261031';
const aikatsuProducts = data.products.filter(p => p.campaignCode === aikatsuCode);
if (aikatsuProducts.length < 90) {
  throw new Error('Aikatsu approved catalogue incomplete: ' + aikatsuProducts.length);
}
const aikatsuNotice = 'PL 收單至台灣時間 10/31 12:00；若提前額滿，將立即停止收單。';
data.products = data.products.map(product => {
  if (product.campaignCode !== aikatsuCode) return product;
  const note = String(product.note || '').trim();
  return {
    ...product,
    ...(product.code === '584-1127'
      ? { title: '偶像學園｜女裝上衣 Sweetie Berry｜粉色女裝上衣 L' }
      : {}),
    preorderDeadline: '2026-10-31T12:00:00+08:00',
    note: note.includes(aikatsuNotice) ? note : [note, aikatsuNotice].filter(Boolean).join(' '),
  };
});

const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
html = html.replace(payloadPattern, (_, before, _old, after) => before + encoded + after);

// Allow slow Notion-backed public catalog refresh to complete in the background.
// The existing 12s UI race and 45s transport timeout cut off valid ~60s GAS work.
// These replacements affect ONLY the GitHub Pages build, not the GAS storefront.
const shortEnhancementTimeout = "new Promise((_,reject)=>setTimeout(()=>reject(new Error('enhancement timeout')),12000))";
const shortTransportTimeout = "reject(new Error('服務連線逾時，請稍後重試'));},45000)";
if (!html.includes(shortEnhancementTimeout) || !html.includes(shortTransportTimeout)) {
  throw new Error('Storefront RPC timeout source was changed; audit before publishing');
}
html = html.replace(shortEnhancementTimeout, "new Promise((_,reject)=>setTimeout(()=>reject(new Error('enhancement timeout')),90000))");
html = html.replace(shortTransportTimeout, "reject(new Error('服務連線逾時，請稍後重試'));},110000)");

// Temporarily hide the legacy accessories purchasing flow, without deleting its content.
const accessoryFlowIntro = '飾品選物與日本現地代購則依各自流程處理。';
if (!html.includes(accessoryFlowIntro) || !html.includes('id="guideFlow_accessory"') || !html.includes('data-flow="accessory"')) {
  throw new Error('Accessory guide structure changed; audit before publishing');
}
html = html.replace(accessoryFlowIntro, '日本現地代購則依實際購買結果處理。');
html = html.replace("['preorder','grab','accessory','onsite'].includes(type)", "['preorder','grab','onsite'].includes(type)");
const accessoryGuideStyle = '<style id="plHideAccessoriesGuide">#guideFlow_accessory,.guideFlowChoice[data-flow="accessory"]{display:none!important}</style>';
if (!html.includes('</head>')) throw new Error('Missing HTML head');
html = html.replace('</head>', accessoryGuideStyle + '\n</head>');

// The actual customer actions use the origin-restricted Apps Script bridge.
// The existing customer-facing layout is unchanged, including email OTP lookup.
html = html.replace('<body>', '<body data-pl-public-site="live">');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
// Publish only brand-approved social preview and logo assets.
fs.mkdirSync('dist/assets', { recursive: true });
for (const asset of ['pl-social-preview-20261030.jpg', 'pl-social-preview-20261030.png', 'pl-logo.jpg']) {
  fs.copyFileSync('assets/' + asset, 'dist/assets/' + asset);
}

// The owner UI is static only. All privileged data stays behind the GAS OTP bridge.
const adminHtml = fs.readFileSync('admin/index.html', 'utf8');
const pl3Admin = adminHtml.includes('data-pl3-admin-redirect="1"') && adminHtml.includes('https://pl3-staging-api.petitelueur-pl.workers.dev/admin-operations');
if ((!pl3Admin && !adminHtml.includes('PL_GAS_ADMIN_CALL')) || /BRIDGE_SECRET|NOTION_API_TOKEN/.test(adminHtml)) {
  throw new Error('Owner UI failed the static security check');
}
fs.mkdirSync('dist/admin', { recursive: true });
fs.writeFileSync('dist/admin/index.html', adminHtml);
// The existing LINE webhook reads this file. Publish only the live PL3 catalog.
const lineCatalogUrl = 'https://pl3-staging-api.petitelueur-pl.workers.dev/api/operations/legacy-catalog';
const lineResponse = await fetch(lineCatalogUrl, { signal: AbortSignal.timeout(20000) });
if (!lineResponse.ok) throw new Error('PL3 LINE catalog unavailable: HTTP ' + lineResponse.status);
const lineCatalog = await lineResponse.json();
if (lineCatalog.ok !== true || lineCatalog.sourceMode !== 'PL3-operating-catalog' ||
    !Array.isArray(lineCatalog.products)) throw new Error('Invalid PL3 LINE catalog');
const taipeiClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const lineProducts = lineCatalog.products
  .filter(p => p.published === true && p.displayMode === 'formal' &&
    p.soldOut !== true && Date.parse(p.preorderDeadline) > Date.now())
  .map(p => ({
    id: p.id, code: p.code, title: p.title, price: p.price, shippingShares: p.shippingShares,
    campaignCode: p.campaignCode, campaignName: p.campaignName, kind: p.kind,
    preorderDeadline: taipeiClock.format(new Date(p.preorderDeadline)),
    status: p.status, published: true, displayMode: 'formal', soldOut: false,
    image: p.imagePublicApproved ? p.image : '',
    sourceUrl: p.sourceUrl,
  }));
fs.writeFileSync('dist/public-catalog.json', JSON.stringify({
  ok: true, products: lineProducts, generatedAt: new Date().toISOString(),
  sourceMode: 'PL3-operating-catalog',
}, null, 2) + '\n');


// Publish only the isolated PL3 OTP test page. It is not linked from the storefront.
// No other PL3 files (Worker code, configuration or credentials) enter public Pages.
const pl3AuthTest = fs.readFileSync('pl3/auth-test.html', 'utf8');
if (!pl3AuthTest.includes('PL 3.0｜安全查單測試') ||
    !pl3AuthTest.includes('id="request-form"') ||
    !pl3AuthTest.includes('id="verify-form"') ||
    /GMAIL_CLIENT_SECRET|GMAIL_REFRESH_TOKEN|SESSION_SECRET|OTP_PEPPER/.test(pl3AuthTest)) {
  throw new Error('PL3 test page failed the explicit public-file check');
}
fs.mkdirSync('dist/pl3', { recursive: true });
fs.writeFileSync('dist/pl3/auth-test.html', pl3AuthTest);

// Publish the factual application data-use disclosure alongside the storefront.
fs.copyFileSync('privacy.html','dist/privacy.html');
