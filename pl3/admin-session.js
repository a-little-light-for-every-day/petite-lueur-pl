// PL3 staging owner sessions: opaque server-side tokens, no JS-readable persistent credential.
// Do not extend these cookies to PL2 or cross-origin Pages.
const COOKIE = "__Host-pl3_admin";
const ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;
const IDLE_SECONDS = 7 * 24 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const newToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
async function hashToken(token) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}
function reject(message = "Authentication required", status = 401) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function cookieToken(request) {
  const entry = (request.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  const value = entry ? entry.slice(COOKIE.length + 1) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function sessionCookie(token, maxAge = ABSOLUTE_SECONDS) {
  return COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}
export function clearSessionCookie() {
  return COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
export function requireSameOriginAction(request) {
  const source = request.headers.get("Origin");
  const destination = new URL(request.url).origin;
  const site = request.headers.get("Sec-Fetch-Site");
  if (source !== destination || request.headers.get("X-PL3-Admin-Action") !== "1" || (site && site !== "same-origin")) {
    reject("Admin action origin forbidden", 403);
  }
}
export async function createAdminSession(env, email) {
  const token = newToken(), stamp = nowSeconds(), expiresAt = stamp + ABSOLUTE_SECONDS;
  await env.DB.prepare(
    "INSERT INTO admin_sessions(id,token_hash,owner_email,created_at,last_seen_at,expires_at,idle_expires_at) VALUES(?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), await hashToken(token), email, stamp, stamp, expiresAt, stamp + IDLE_SECONDS).run();
  return { token, expiresAt };
}
export async function readAdminSession(request, env) {
  const token = cookieToken(request);
  if (!token) reject();
  const hash = await hashToken(token), stamp = nowSeconds();
  const row = await env.DB.prepare(
    "SELECT id,owner_email,last_seen_at,expires_at,idle_expires_at FROM admin_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>?"
  ).bind(hash, stamp, stamp).first();
  if (!row) reject("Session expired or revoked");
  // Throttle idle extension to reduce D1 writes; absolute lifetime never extends.
  if (stamp - row.last_seen_at > 3600) {
    await env.DB.prepare(
      "UPDATE admin_sessions SET last_seen_at=?,idle_expires_at=? WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>?"
    ).bind(stamp, Math.min(stamp + IDLE_SECONDS, row.expires_at), row.id, hash, stamp, stamp).run();
  }
  return { id: row.id, email: row.owner_email, expiresAt: row.expires_at, hash };
}
export async function revokeAdminSession(env, session) {
  await env.DB.prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=? AND token_hash=? AND revoked_at IS NULL")
    .bind(nowSeconds(), session.id, session.hash).run();
}
