# PL3 isolated Notion + Google Sheets sync QA runbook

**Status:** Receiver code committed. **Not deployed or authorized** until the owner performs steps below. No PL2 records, customers, or live sheets may be used for this test.

## Architecture

`pl3-staging-api` D1 `sync_outbox` -> owner-only `POST /api/admin/sync/drain` -> signed HTTPS POST -> **new standalone Apps Script** (`staging-sync-adapter.gs`) -> **new QA spreadsheet** and **new QA Notion parent page**.

The Apps Script receiver will accept only group IDs starting `PL3-QA-`; sends no mail, changes no production records, and does not touch existing PL2 Apps Script project.

Notion and Sheets are written in one owner-invoked Apps Script execution, with a script lock and a stable event ID. If Notion fails after Sheets succeeds, the Cloudflare outbox retries; the receiver finds the Sheet row by event ID and does not append another. If the response is lost after Notion succeeds, the receiver checks Notion child-page titles before creating. **No exactly-once guarantee without endpoint verification**: reconcile unexpected partial failures before expanding beyond QA.

## Prepare separate QA destinations (never use the production Sheet)

1. Create a **new Google spreadsheet** named `PL3 QA｜同步驗收（獨立）`.
2. Create a worksheet tab named exactly `PL3 Sync QA Events`. Set row 1, columns A:H exactly:
   `event_id | event_type | entity_id | group_id | order_id | change | received_at | note`.
3. Create a **new, empty Notion page** named `PL3 QA｜同步驗收（獨立）`. It must not be the existing order database.
4. Create a **dedicated Notion internal integration** with the smallest permissions that can read child blocks and insert pages. Grant it access **only to the new QA parent page**, not to the PL2 order database. Save its token privately.
5. Note the QA spreadsheet ID and QA Notion page ID. Neither is a password.

## New Apps Script web app

1. Open https://script.google.com/home/projects/create under the Google account that owns the QA spreadsheet. Do **not** edit `Petite Lueur PL｜Gmail・Notion 橋接` or the PL2 Web app.
2. Name it `PL3 QA Sync Receiver`; paste `pl3/staging-sync-adapter.gs` into Code.gs.
3. In **Project Settings -> Script Properties**, set these exact keys:
   - `PL3_QA_SPREADSHEET_ID`: new QA spreadsheet ID.
   - `PL3_QA_NOTION_PAGE_ID`: new QA parent page ID.
   - `PL3_QA_NOTION_TOKEN`: dedicated QA Notion integration secret.
   - `PL3_SYNC_WEBHOOK_SECRET`: a newly generated unpredictable secret, same as Cloudflare secret below.
4. Deploy as **Web app**, execute as **Me** (the owner), access **Anyone** (the endpoint must be remotely reachable). Requests are authenticated with HMAC-SHA256 inside the POST body, because Apps Script Web App `doPost(e)` does not expose arbitrary HTTP request headers. The endpoint is not intended for browser use.
5. Copy the deployed `/exec` URL. Do not use `/dev` for Cloudflare. If company policy prevents an anonymously accessible Web app, stop and choose a different authenticated bridge.
6. The first Google/Notion scope approval is made by the script owner. Do not submit secrets or the actual webhook secret in chat.

## Cloudflare setup (staging Worker ONLY)

In **Cloudflare -> Workers & Pages -> pl3-staging-api**:
- `PL3_SYNC_WEBHOOK_URL`: the new Apps Script `https://script.google.com/macros/s/.../exec` deployment URL, **plain variable**, not confidential.
- `PL3_SYNC_ALLOW_QA`: `true` **plain variable**, required only during isolated QA.
- `PL3_SYNC_WEBHOOK_SECRET`: same new random secret as Apps Script **encrypted Worker secret**.
- Also add `PL3_SYNC_WEBHOOK_SECRET` as an **encrypted Cloudflare Builds secret**, since `pl3/upload-staging.mjs` generates a candidate version's secret bindings from Builds. Never put a secret in `wrangler.jsonc`, GitHub Actions, or a repository commit.

Cloudflare Builds command remains `node pl3/upload-staging.mjs`: it **uploads a version only**. Manually inspect the version's bindings, then promote only to **staging** traffic. Never automatically deploy to the live PL2 storefront.

## Verify with only existing QA events

1. Ensure the owner has a fresh Gmail OTP session and the new staging Worker version is active.
2. Call `POST /api/admin/sync/drain` with the owner bearer token and empty JSON body; this route uses a maximum of 3 due events per invocation.
3. Expected JSON: `{"ok":true,"examined":...,"delivered":...,"retry":...}`. A `retry` count means the destination did not acknowledge and **requires investigation**; do not immediately re-send repeatedly.
4. Query `sync_outbox` in D1 read-only to check `status,attempts,last_error`; inspect QA Google Sheet rows and QA Notion pages for matching immutable event IDs.
5. Run the same drain once more. Each event ID must exist **once in each destination**. The second call should not produce duplicates.
6. Cross-check the payment-review event stays `rejected` and the order stays `unpaid`. The fulfillment event should read `ordered`. **No** financial revenue rows or customer notifications should be written.
7. After QA, set `PL3_SYNC_ALLOW_QA=false` and keep manual drain; production order synchronization remains **disabled until additional field mappings, permissions, error handling, and conflict reconciliation are approved**.

### Read-only D1 verification

```sql
SELECT id, entity_id, event_type, status, attempts, next_attempt_at, last_error
FROM sync_outbox
WHERE entity_id = '9e4b1895-b5bc-4989-b084-56f74f63ebd7'
ORDER BY created_at, id;
```

The initial `order.created` event and the later `payment.reviewed`/`fulfillment.advanced` events should show the final delivery state. This adapter does not yet write into the **real** `🧾 客戶訂單`, `🛒 訂單明細`, or Notion order database; that is a separate cutover gate.

## Troubleshooting

- `Sync adapter not configured` (503): Worker runtime URL or secret missing on **active version**.
- API returns `retry: 1`: check Apps Script **Executions** and D1 `last_error`. Avoid posting real tokens to chat.
- Google failure: QA spreadsheet ID, exact sheet name/headers, or Google permissions.
- Notion failure: QA integration token or parent page not shared to integration.
- Repeated sync event: check both QA destinations by exact event ID; do not delete real data.
- Never try to fix a rejected/unpaid QA order by marking it paid.
