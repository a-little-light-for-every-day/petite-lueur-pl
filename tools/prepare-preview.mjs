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

// The actual customer actions use the origin-restricted Apps Script bridge.
// The existing customer-facing layout is unchanged, including email OTP lookup.
html = html.replace('<body>', '<body data-pl-public-site="live">');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
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

