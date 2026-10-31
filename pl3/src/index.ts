/**
 * PL 3.0 staging Worker.
 * Stage 1 exposes only two GET endpoints and demo static assets.
 * No order creation, OTP, payment, sync ingestion, or admin writes are enabled.
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface PublicProduct {
  id: string;
  campaignId: string;
  campaignCode: string | null;
  campaignName: string;
  closesAtUtc: string | null;
  sku: string | null;
  variantKey: string;
  name: string;
  variant: string | null;
  priceTwd: number;
  imageUrl: string | null;
  officialUrl: string | null;
  sortOrder: number;
}

const PUBLIC_FIELDS = `
  SELECT
    p.id AS id,
    c.id AS campaignId,
    c.campaign_code AS campaignCode,
    c.title AS campaignName,
    c.closes_at_utc AS closesAtUtc,
    p.merchant_sku AS sku,
    p.variant_key AS variantKey,
    p.title AS name,
    p.variant_label AS variant,
    p.price_twd AS priceTwd,
    p.image_url AS imageUrl,
    p.official_url AS officialUrl,
    p.sort_order AS sortOrder
  FROM products AS p
  INNER JOIN campaigns AS c ON c.id = p.campaign_id
  WHERE
    p.public_approved = 1
    AND p.lifecycle_status = 'active'
    AND (p.available_units IS NULL OR p.available_units > 0)
    AND c.public_approved = 1
    AND c.lifecycle_status IN ('open','reopened')
    AND (c.closes_at_utc IS NULL OR c.closes_at_utc > ?1)
  ORDER BY c.closes_at_utc ASC, p.sort_order ASC, p.id ASC
`;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') {
        return json({ ok: false, error: 'Method not allowed' }, 405);
      }
      if (url.pathname === '/api/health') {
        return json({ ok: true, environment: 'staging', service: 'workers-d1-readonly' });
      }
      if (url.pathname === '/api/catalog') {
        const asOf = new Date().toISOString();
        try {
          const results = await env.DB.prepare(PUBLIC_FIELDS)
            .bind(asOf)
            .all<PublicProduct>();
          return json({
            ok: true,
            environment: 'staging',
            asOf,
            count: results.results.length,
            products: results.results,
          });
        } catch {
          return json({ ok: false, error: 'Catalog temporarily unavailable' }, 503);
        }
      }
      return json({ ok: false, error: 'Not found' }, 404);
    }
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set('x-robots-tag', 'noindex, nofollow');
    headers.set('cache-control', 'no-store');
    return new Response(asset.body, { status: asset.status, headers });
  },
} satisfies ExportedHandler<Env>;
