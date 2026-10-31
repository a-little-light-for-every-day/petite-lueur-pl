// Manual-only staging outbox delivery. Never enable a schedule until a verified
// downstream adapter deduplicates X-PL3-Event-ID before touching Notion/Sheets.
const encoder = new TextEncoder();
const fail = (message, status = 503) => {
  const e = new Error(message); e.status = status; throw e;
};
function isoAfter(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
async function signature(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, encoder.encode(payload))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function drainOutbox(env, maxEvents = 3) {
  if (!env.PL3_SYNC_WEBHOOK_URL || !env.PL3_SYNC_WEBHOOK_SECRET) {
    fail("Sync adapter not configured");
  }
  let url;
  try { url = new URL(env.PL3_SYNC_WEBHOOK_URL); }
  catch { fail("Invalid sync destination"); }
  if (url.protocol !== "https:" || url.username || url.password) {
    fail("Sync destination must be HTTPS");
  }
  const now = new Date().toISOString();
  // Exclude ALL QA orders: never copy test traffic into real Notion/Sheets.
  const pending = await env.DB.prepare(
    "SELECT s.id,s.entity_type,s.entity_id,s.event_type,s.payload_json,s.status,s.attempts,o.group_id FROM sync_outbox s JOIN orders o ON o.id=s.entity_id WHERE s.entity_type='order' AND (o.group_id NOT LIKE 'PL3-QA-%' OR ?=1) AND ((s.status IN ('pending','retry') AND (s.next_attempt_at IS NULL OR s.next_attempt_at<=?)) OR (s.status='processing' AND s.next_attempt_at<=?)) ORDER BY s.created_at ASC LIMIT ?"
  ).bind(env.PL3_SYNC_ALLOW_QA === 'true' ? 1 : 0, now, now, Math.min(Math.max(Number(maxEvents) || 1, 1), 3)).all();
  const summary = { ok: true, examined: 0, delivered: 0, retry: 0 };
  for (const event of pending.results || []) {
    const claimed = await env.DB.prepare(
      "UPDATE sync_outbox SET status='processing',attempts=attempts+1,next_attempt_at=? WHERE id=? AND status=? AND (next_attempt_at IS NULL OR next_attempt_at<=?)"
    ).bind(isoAfter(120), event.id, event.status, now).run();
    if (claimed.meta?.changes !== 1) continue;
    summary.examined++;
    try {
      let payload;
      try { payload = JSON.parse(event.payload_json); }
      catch { throw new Error("Invalid event JSON"); }
      // Send an immutable event ID and no credentials, no private bank details.
      const body = JSON.stringify({
        event_id: event.id, entity_type: event.entity_type,
        entity_id: event.entity_id, group_id: event.group_id, event_type: event.event_type, payload
      });
      const signedBody = JSON.stringify({ body, signature: await signature(env.PL3_SYNC_WEBHOOK_SECRET, body) });
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PL3-Event-ID": event.id,
          "X-PL3-Signature": "sha256=" +
            await signature(env.PL3_SYNC_WEBHOOK_SECRET, body)
        },
        body: signedBody,
        signal: AbortSignal.timeout(15000)
      });
      const ack = await res.json().catch(() => ({}));
      if (!res.ok || ack.ok !== true || ack.ack_event_id !== event.id) {
        throw new Error("Destination acknowledgement missing (HTTP " + res.status + ")");
      }
      await env.DB.prepare(
        "UPDATE sync_outbox SET status='delivered',next_attempt_at=NULL,last_error=NULL WHERE id=? AND status='processing'"
      ).bind(event.id).run();
      summary.delivered++;
    } catch (error) {
      // Retry with bounded backoff; the stable event ID is the dedupe key.
      const attempts = Math.min(Number(event.attempts || 0) + 1, 10);
      const delay = Math.min(60 * (2 ** Math.max(0, attempts - 1)), 3600);
      await env.DB.prepare(
        "UPDATE sync_outbox SET status='retry',next_attempt_at=?,last_error=? WHERE id=? AND status='processing'"
      ).bind(isoAfter(delay), String(error?.message || "Sync delivery failed").slice(0,180), event.id).run();
      summary.retry++;
    }
  }
  return summary;
}
