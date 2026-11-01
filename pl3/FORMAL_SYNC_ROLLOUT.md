# PL 3.0 formal order mirror: integrated staging release (NOT activated)

Status: **code and automated harness ready for staging**, **formal writes OFF** by default.
This implementation does not modify PL2, does not send a customer email, does not
approve any bank transfer, and does not import historical orders.

## What is implemented

- A strictly allowlisted PL3 formal cohort (ID must match `PL3-FORMAL-...`),
  manual-only owner API, isolated from the existing `PL3-QA-` outbox drain.
- Read-only field projection from D1 with per-line amount arithmetic, status
  translations and a privacy allowlist; no customer name/email, bank details,
  owner sourcing costs, or private admin notes leave D1.
- **Independent** Notion and Google Sheets deliveries. Each must return the
  matching event ID, destination, external ID, and external revision. D1 records
  each acknowledgement separately, uses bounded exponential retry and
  dead-letter at attempt 6. A failed target does not repeat the delivered target.
- Optimistic concurrency: Sheets compares a managed-cell checksum; Notion checks
  `last_edited_time`. Unexpected edits, missing pages, duplicate IDs or
  unapproved status/payment mapping require owner review, never overwrite.
- Receiver replay recovery: when a Sheets write succeeded but its event-ledger
  append failed, a retry repairs only the missing ledger if all managed cells,
  revision and item event markers match exactly. Notion retries reuse a page
  bearing the same event ID; diverged records are quarantined.
- A standalone formal Apps Script receiver (not the existing PL2 or QA script);
  idempotent event ledger, HMAC signature, script lock, explicit cohort and
  destinations. It **refuses** the known PL2 workbook and Notion source IDs.
- A read-only legacy snapshot comparison utility; **no** PL2 import function.

## Field contract (only these fields are automatic)

| D1 source | Approved PL3-only Sheet mirror | PL3-only Notion property |
| --- | --- | --- |
| `orders.id` | `PL3 Orders.order_id` | `訂單編號` (title), `網站訂單識別碼` (rich text) |
| `orders.group_id` | `PL3 Orders.group_id` | no write |
| `orders.status` | `PL3 Orders.status` | `狀態` selected from verified existing options |
| `orders.total_twd` | `PL3 Orders.amount_twd` | `商品款` (number) |
| `order_items` | `PL3 Items` one row per immutable `item_id` | `商品明細` (summary, rich text) |
| `fulfillments.status` | `PL3 Items.fulfillment_status` | `狀態` when exactly one item |
| event identity | `PL3 Sync Ledger.event_id` | `PL3 同步事件` (new rich-text property) |

Existing real PL2 Sheet:
`🧾 客戶訂單` A:O and `🛒 訂單明細` A:K have customer
and manual payment fields. The formal adapter deliberately **never edits those
tabs**. In particular payment progress, second installment, due dates,
notifications, pickup, and original Notion URL have no automatic mapping.

Actual PL2 Notion payment options distinguish first payment, second payment,
reports and bank-verified amounts; the D1 `paid` flag alone cannot justify one.
**Any non-`unpaid` D1 order stays in the mapping-conflict queue
(`PAYMENT_PHASE_REQUIRED`)** until an explicit reviewed payment-phase
schema and owner-approved rule exist. Similarly unknown order/fulfillment states
are blocked. The projection is a **safe subset**, not the final financial ledger.

## Files

- `pl3/formal-sync-projection.js`: pure projection and constraints.
- `pl3/formal-sync.js`: independent two-target outbox, retries, leases, metrics.
- `pl3/formal-sync-adapter.gs`: separately deployed Apps Script receiver.
- `pl3/migrations/0004_formal_sync.sql`: additive D1 delivery, link,
  conflict and legacy *review-only* tables.
- `pl3/legacy-reconcile.mjs`: offline readonly PL2 vs staged comparison.
- `pl3/tests/formal-sync.mjs` and `pl3/tests/legacy-reconcile.mjs`: automatic
  mapping, isolation, retry, mismatch and replay tests.

## Safe staging setup (not performed by repository commit)

1. Backup **pl3-staging** D1. Apply `pl3/migrations/0004_formal_sync.sql`
   **only** to that staging database, never to PL2 D1.
2. Create a **new empty PL3-only** Google workbook, and a **new PL3-only**
   Notion data source accessible only to a dedicated integration. Do **not**
   select the current real PL2 workbook `1Ts9N_...EPI` or existing
   `8c7c6206-...-32a5` Notion data source.
3. Add to the new Notion source the following exact property names/types:
   `訂單編號` (title), `網站訂單識別碼` (rich text),
   `商品款` (number), `商品明細` (rich text),
   `狀態` (select, options `訂購申請待確認`, `已取消`,
   `已向日本商店下單`, `日本倉庫已到貨`, `國際運送中`,
   `商品已抵台`, `台灣已寄出`, `已完成`),
   `PL3 同步事件` (rich text). Do not remove options used by PL2.
4. Create a **new standalone** Apps Script project, copy
   `pl3/formal-sync-adapter.gs`, then set its **Script Properties**:
   `PL3_FORMAL_SYNC_SECRET` (unique long random secret, same as Worker),
   `PL3_FORMAL_ALLOWED_GROUP_ID` (one exact **new** test group,
   e.g. `PL3-FORMAL-REHEARSAL-01`), `PL3_FORMAL_WRITES_ENABLED=true`,
   `PL3_FORMAL_SPREADSHEET_ID`, `PL3_FORMAL_NOTION_DATA_SOURCE_ID`,
   `PL3_FORMAL_NOTION_TOKEN` (new token, only access to new source).
   Deploy new web app **execute as owner**, access **Anyone** only if
   HMAC and hardcoded source guards remain intact. It can be publicly invoked
   but unsigned payloads must be refused.
5. In **Cloudflare Builds secrets** add `PL3_FORMAL_SYNC_SECRET` matching the
   receiver. In Worker **runtime variables** add
   `PL3_FORMAL_SHEETS_WEBHOOK_URL` and
   `PL3_FORMAL_NOTION_WEBHOOK_URL` with the new Apps Script `/exec` URL
   (one script supports both destinations, so the two URLs may match),
   `PL3_FORMAL_ALLOWED_GROUP_ID` exactly matching step 4,
   `PL3_FORMAL_SYNC_ENABLED=true` **only after** the staging rehearsal.
   None of these flags are enabled in `wrangler.jsonc` automatically.
6. Upload Worker using existing `node pl3/upload-staging.mjs`; **upload is not
   a promotion**. Inspect build bindings, manually promote the verified version
   to staging Worker traffic. Leave PL2 untouched.
7. Owner authenticates on `/admin-test` and can call:
   - GET `/api/admin/formal-sync/status` — migration readiness, counts,
     backlog and open conflicts (never credentials).
   - GET `/api/admin/formal-sync/preview?order_id=<id>` — read-only subset.
   - POST `/api/admin/formal-sync/drain` with `{"limit":2}` —
     authorized **manual** dispatch, no cron or automatic promotion.
   Never run this against an unapproved group; the Worker enforces the exact
   group ID at SQL selection and the receiver repeats the check.

## Acceptance and failure injection

**Before allowing live customers**:
- Create only a brand-new, synthetic staging order in the approved formal
  group, with `payment_status=unpaid` and fully mapped statuses.
- Confirm one order row, all its item rows, one Notion page and two D1
  delivery ACKs; compare line sum and order total in all three stores.
- Rerun drain; expect `examined=0`, no added rows or page.
- Temporarily make **Notion destination unavailable**; send a second
  synthetic event, verify Sheets succeeds once, Notion `retry`, then
  restore and verify only Notion retries. Repeat in reverse with Sheets.
- Edit one managed Sheet cell or Notion page property manually, trigger the
  next event and confirm `conflict` / no overwrite. Restore via an
  **explicit owner-reviewed conflict resolution**, not an automatic overwrite.
- Test malformed signature, unknown cohort, wrong event ACK, overlarge
  payload, missing D1 migration and missing secret: all must fail closed.
- `/api/admin/formal-sync/status` must show `open_conflicts=0` and no
  `dead`/unprocessed `retry` before any wider rollout.

**Note:** Apps Script ContentService can return HTTP 200 for a business
conflict; its response has `conflict:true`, which the Worker recognizes.

## Read-only PL2 migration preview (NOT an importer)

Prepare two **sanitized** arrays (no customer names, email, phone, bank details)
from backed-up PL2 and staged comparison data. Each row must have stable
`source_system`, `source_id`, `source_revision`, `amount_twd`,
`payment_phase`, `status`, and `items:[{sku,variant,quantity,unit_price_twd}]`.

Run:
```powershell
node pl3/legacy-reconcile.mjs sanitized-pl2.json sanitized-pl3.json
```

It reports counts, aggregate amounts, item/quantity/phase discrepancies and
duplicate/missing identities. It **never writes D1, Notion, Sheets, or PL2**.
Owner approval of source semantics, verified payment phases, privacy, backup,
row-level match and rollback must precede any actual migration.

## Release/activation boundaries

- Code commit alone: **no external writes**.
- Cloudflare version upload alone: **no staging traffic change**.
- Promoted Worker with `PL3_FORMAL_SYNC_ENABLED` absent: **no formal delivery**.
- Explicit allowlist and signed, distinct PL3 receiver: limited cohort only.
- Real PL2 existing order migration / official source writes / automated cron:
  **not included, not approved, not enabled**.

Do not paste tokens, OTPs, secret contents or bank references into GitHub
issues, builds, ChatGPT, D1 logs, or Sheets cells.
