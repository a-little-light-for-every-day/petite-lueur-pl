// PL3 official hostname. Restore the approved GitHub Pages shop presentation
// from the backend's read-only storefront preview, while keeping the operations
// Worker as the sole database, OAuth, session and scheduled-sync owner.
const HOST = "a-little-light-for-every-day.petitelueur-pl.workers.dev";
const BACKEND_ORIGIN = "https://pl3-staging-api.petitelueur-pl.workers.dev";
const LEGACY_ORIGIN = "https://a-little-light-for-every-day.github.io/petite-lueur-pl/";

function publicResponse(body, type) {
  return new Response(body, {headers: {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  }});
}

function restoreApprovedLayout(html, origin) {
  const script = `src="${BACKEND_ORIGIN}/storefront-cutover.js"`;
  if (html.split('data-pl3-cutover="1"').length !== 2 || html.split(script).length !== 2)
    throw Error("The approved storefront preview has changed; do not silently restore an unverified layout.");
  return html.replace(script, 'src="/storefront-cutover.js"')
    .replace(`<link rel="canonical" href="${LEGACY_ORIGIN}">`, `<link rel="canonical" href="${origin}/">`)
    .replace(`<meta property="og:url" content="${LEGACY_ORIGIN}">`, `<meta property="og:url" content="${origin}/">`)
    .replace(`<a href="${LEGACY_ORIGIN}privacy.html">`, '<a href="/privacy">');
}

function sameOriginCutover(js) {
  const entry = `const base='${BACKEND_ORIGIN}',old=`;
  if (js.split(entry).length !== 2 || !js.includes("window.PL3_OPERATING_STOREFRONT=true"))
    throw Error("The PL3 storefront handoff has changed; review before publishing.");
  return js.replace(entry, 'const base=location.origin,old=');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== HOST) {
      return new Response("Not Found", { status: 404 });
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const previewUrl = new URL("/storefront-preview", url);
      const source = await env.PL3_BACKEND.fetch(new Request(previewUrl));
      if (!source.ok) return new Response("商店目前無法載入，請稍後再試。", {status: 503});
      try {
        return publicResponse(restoreApprovedLayout(await source.text(), url.origin), "text/html; charset=utf-8");
      } catch {
        return new Response("商店版型驗證失敗，已暫停載入以保護訂購流程。", {status: 502});
      }
    }
    if (request.method === "GET" && url.pathname === "/storefront-cutover.js") {
      const source = await env.PL3_BACKEND.fetch(new Request(url));
      if (!source.ok) return new Response("Storefront adapter unavailable", {status: 503});
      try {
        return publicResponse(sameOriginCutover(await source.text()), "application/javascript; charset=utf-8");
      } catch {
        return new Response("Storefront adapter validation failed", {status: 502});
      }
    }
    return env.PL3_BACKEND.fetch(request);
  }
};
