import fs from 'node:fs';

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
const data = JSON.parse(Buffer.from(payload[2], 'base64url').toString('utf8'));
if (!Array.isArray(data.products) || data.products.some(p => p.published === false)) {
  throw new Error('Unpublished product detected in public catalog snapshot');
}
if (data.siteSettings) {
  data.siteSettings.canonicalUrl = origin + '/petite-lueur-pl/';
}
const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
html = html.replace(payloadPattern, (_, before, _old, after) => before + encoded + after);

// The actual customer actions use the origin-restricted Apps Script bridge.
// The existing customer-facing layout is unchanged, including email OTP lookup.
html = html.replace('<body>', '<body data-pl-public-site="live">');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
