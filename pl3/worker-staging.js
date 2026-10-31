// PL 3.0 staging — read-only catalog API. Deploy only to pl3-staging-api.
const ALLOWED_ORIGIN = "https://a-little-light-for-every-day.github.io";
function respond(body, status = 200, origin = "") {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (origin === ALLOWED_ORIGIN) headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  return new Response(JSON.stringify(body), { status, headers });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method !== "GET") return respond({ ok: false, error: "Method not allowed" }, 405, origin);
    try {
      if (url.pathname === "/health") {
        const row = await env.DB.prepare("SELECT 1 AS connected").first();
        return respond({ ok: row?.connected === 1, service: "pl3-staging-api", database: "pl3-staging" }, 200, origin);
      }
      if (url.pathname === "/api/groups") {
        const rows = await env.DB.prepare("SELECT id,title,source_url,status,order_deadline,purchase_deadline FROM groups WHERE published=1 ORDER BY created_at DESC LIMIT 200").all();
        return respond({ ok: true, groups: rows.results || [] }, 200, origin);
      }
      if (url.pathname === "/api/products") {
        const id = url.searchParams.get("group_id");
        if (!id || id.length > 128) return respond({ ok: false, error: "Valid group_id is required" }, 400, origin);
        const group = await env.DB.prepare("SELECT id FROM groups WHERE id=? AND published=1 LIMIT 1").bind(id).first();
        if (!group) return respond({ ok: false, error: "Group not found" }, 404, origin);
        const rows = await env.DB.prepare("SELECT id,group_id,official_sku,name,variant,image_url,price_twd,currency,quantity_limit,status,sort_order FROM products WHERE group_id=? ORDER BY sort_order ASC,name ASC LIMIT 500").bind(id).all();
        return respond({ ok: true, group_id: id, products: rows.results || [] }, 200, origin);
      }
      return respond({ ok: false, error: "Not Found" }, 404, origin);
    } catch (error) {
      console.error("PL3 staging API", error);
      return respond({ ok: false, error: "Internal server error" }, 500, origin);
    }
  }
};
