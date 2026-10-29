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

// Keep the Shopping Guide useful even when the read-only GAS guide endpoint is slow.
// This is a build-only, narrow replacement: the original 864 KB store source remains untouched.
const plGuideStart = '  function loadShoppingGuide(){';
const plGuideEnd = '\n\n\n  function setGuideMode(mode){';
const plGuideBeginIndex = html.indexOf(plGuideStart);
const plGuideEndIndex = html.indexOf(plGuideEnd, plGuideBeginIndex);
if (plGuideBeginIndex < 0 || plGuideEndIndex < 0 || html.indexOf(plGuideStart, plGuideBeginIndex + 1) >= 0 || !html.slice(plGuideBeginIndex,plGuideEndIndex).includes("call('plGetShoppingGuide').then(data=>{")) {
  throw new Error('Shopping Guide source changed; audit before publishing');
}
const plGuideReplacement = "  let plGuideRequestSequence=0;\n  function plGuideBasicNotice(host, waiting){\n    if(!host)return;\n    host.innerHTML=\n      '<p class=\"guideRuleLead\"><strong>購物須知｜基本提醒</strong><br>完整條款正在向 PL 官方系統確認中；以下僅供先行閱讀，正式內容以主購確認及當次通知為準。</p>'+\n      '<div class=\"guideExample\"><strong>① 訂購申請：</strong>送出後仍須由主購確認商品、規格、數量及能否接單，不代表已正式購買。</div>'+\n      '<div class=\"guideExample\"><strong>② 付款與費用：</strong>請依當次付款通知及私訊提供的收款資料付款；日本國際運費、包材及必要稅費依實際情況於後續結算。</div>'+\n      '<div class=\"guideExample\"><strong>③ 出貨：</strong>日本官方下單、入庫、國際運送與台灣配送依訂單進度辦理；可到網站使用 Email 驗證查單。</div>'+\n      (waiting\n        ? '<p class=\"guideRuleLead\">最新完整版仍在背景載入；連線成功會自動顯示。</p>'\n        : '<p class=\"guideRuleLead\">目前無法取得最新完整版，請先切換「購物流程」閱讀，或向 PL 官方 LINE 確認當次規則。</p><button type=\"button\" class=\"legacyPrimary\" onclick=\"loadShoppingGuide()\">重新載入完整購物須知</button>');\n  }\n  function loadShoppingGuide(){\n    if(window.PL_OFFLINE_PREVIEW){\n      const host=$('guideRulesDynamic');\n      if(host)host.innerHTML='<p class=\"guideRuleLead\">這是離線網頁預覽。完整購物須知請以正式商店為準。</p>';\n      shoppingGuideLoaded=true;\n      return;\n    }\n    if(shoppingGuideLoaded||shoppingGuideLoading)return;\n    shoppingGuideLoading=true;\n    const sequence=++plGuideRequestSequence;\n    const host=$('guideRulesDynamic');\n    plGuideBasicNotice(host,true);\n    const slowTimer=setTimeout(()=>{\n      if(sequence!==plGuideRequestSequence||shoppingGuideLoaded)return;\n      shoppingGuideLoading=false;\n      plGuideBasicNotice(host,false);\n    },12000);\n    call('plGetShoppingGuide').then(data=>{\n      clearTimeout(slowTimer);\n      if(sequence!==plGuideRequestSequence)return;\n      shoppingGuideLoading=false;\n      if(!data||!data.ok||typeof data.html!=='string'||!data.html.trim()){\n        plGuideBasicNotice(host,false);\n        return;\n      }\n      shoppingGuideLoaded=true;\n      if(host){\n        host.innerHTML=data.html;\n        host.querySelectorAll('.noticeStrip').forEach(node=>{\n          const label=node.querySelector('b');\n          if(label&&/^目前版本[：:]/.test(label.textContent.trim()))node.remove();\n        });\n      }\n    }).catch(()=>{\n      clearTimeout(slowTimer);\n      if(sequence!==plGuideRequestSequence)return;\n      shoppingGuideLoading=false;\n      plGuideBasicNotice(host,false);\n    });\n  }";
html = html.slice(0, plGuideBeginIndex) + plGuideReplacement + html.slice(plGuideEndIndex);

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
if (!adminHtml.includes('PL_GAS_ADMIN_CALL') || /BRIDGE_SECRET|NOTION_API_TOKEN/.test(adminHtml)) {
  throw new Error('Owner UI failed the static security check');
}
fs.mkdirSync('dist/admin', { recursive: true });
fs.writeFileSync('dist/admin/index.html', adminHtml);
// LINE and the storefront now consume the same approved publication dataset.
fs.writeFileSync('dist/public-catalog.json', JSON.stringify({
  ...data,
  generatedAt: new Date().toISOString(),
}, null, 2) + '\n');

