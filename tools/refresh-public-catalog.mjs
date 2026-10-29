// Public-data boundary for Petite Lueur PL. Never publish the private Notion/Sheets ledger.
const GAS_PUBLIC_STORE = 'https://script.google.com/macros/s/AKfycbx4PHYxXV1YMsA4h9PCduQ0pAStXFq8TdQV2bEPt3lxr2x-ciq6zNJmFF-Gx1ByTgtYhQ/exec';

const PRODUCT_FIELDS = [
  'id', 'code', 'title', 'price', 'source', 'kind', 'onsite',
  'onsiteCapacity', 'selectionStock', 'selectionPreorderLimit',
  'selectionWait', 'image', 'images', 'statuses', 'status', 'note',
  'sourceUrl', 'officialXPostUrl', 'priceJpy', 'preorderDeadline',
  'expectedShip', 'variantText', 'maxPurchase', 'officialPurchaseLimit',
  'officialPurchaseLimitScope', 'officialPurchaseLimitOriginal',
  'purchaseLimitConfidence', 'purchaseLimitNote', 'bonusText',
  'campaignCode', 'campaignName', 'productType', 'shippingShares',
  'published', 'autoSoldOut', 'sort', 'limitMode', 'reserved',
  'remaining', 'variantRemaining', 'soldOut', 'displayMode',
  'imagePublicApproved',
];
const NEWS_FIELDS = [
  'id', 'title', 'summary', 'date', 'kind',
  'sourceUrl', 'postUrl', 'coverUrl', 'discoveryUrl',
];
const SETTINGS_FIELDS = [
  'seoTitle', 'seoDescription', 'seoKeywords', 'seoImageUrl',
  'lineUrl', 'instagramUrl', 'threadsUrl', 'linePayMoneyEnabled',
  'taiwanPayEnabled', 'ctbcCashDepositEnabled', 'canonicalUrl',
];

function pick(source, fields) {
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field)) result[field] = source[field];
  }
  return result;
}

export function approvedPublicCatalog(raw) {
  if (!raw || raw.ok !== true || !Array.isArray(raw.products)) {
    throw new Error('Public catalog response is malformed');
  }
  // The server owns approval; a GitHub sync may only narrow, never widen it.
  const products = raw.products.filter(p => p &&
    p.published === true && p.displayMode === 'formal' &&
    p.approved !== false && p.isApproved !== false &&
    p.internalOnly !== true &&
    typeof p.code === 'string' && p.code.trim() &&
    typeof p.title === 'string' && p.title.trim()
  ).map(p => pick(p, PRODUCT_FIELDS));
  if (products.length === 0 || products.length > 10000) {
    throw new Error('Unexpected approved product count: ' + products.length);
  }
  const news = Array.isArray(raw.news)
    ? raw.news.filter(n => n && typeof n.title === 'string').map(n => pick(n, NEWS_FIELDS))
    : [];
  const settings = raw.siteSettings && typeof raw.siteSettings === 'object'
    ? pick(raw.siteSettings, SETTINGS_FIELDS)
    : {};
  // Existing storefront uses this public Boolean to hide bank details.
  settings.privateBankDetails = raw.siteSettings?.privateBankDetails === true;

  return {
    ok: true,
    products,
    campaigns: [],
    orderMaxTwd: Number.isInteger(raw.orderMaxTwd) ? raw.orderMaxTwd : 22000,
    siteSettings: settings,
    news,
    sourceMode: 'approved-public-catalog',
    cacheHit: false,
  };
}

export async function getLiveApprovedCatalog(previousCount) {
  const response = await fetch(GAS_PUBLIC_STORE, {
    redirect: 'follow',
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(110_000),
  });
  if (!response.ok) throw new Error('Public GAS HTTP ' + response.status);
  if (Number(response.headers.get('content-length') || 0) > 5_000_000) {
    throw new Error('Public catalog response exceeds size limit');
  }
  const html = await response.text();
  if (html.length > 5_000_000) throw new Error('Public catalog response exceeds size limit');
  const marker = html.indexOf('plInitialStoreData');
  if (marker < 0) throw new Error('Live public catalog marker missing');
  const nearby = html.slice(marker, marker + 1_200_000);
  const match = nearby.match(/data-payload.{0,40}?(eyJ[A-Za-z0-9_-]{100,})/);
  if (!match || match[1].length > 1_100_000) {
    throw new Error('Live public catalog payload missing or oversized');
  }
  const raw = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  const current = approvedPublicCatalog(raw);
  // Backend outages or malformed exports must not erase most published stock.
  if (previousCount > 10 && current.products.length < previousCount * 0.4) {
    throw new Error('Unusually large catalog drop ' + previousCount +
      ' -> ' + current.products.length + '; review required');
  }
  return current;
}
