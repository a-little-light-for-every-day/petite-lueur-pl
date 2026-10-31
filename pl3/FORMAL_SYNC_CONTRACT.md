# PL 3.0 official order synchronization contract (proposed, NOT live)

**Gate:** implementation/design only. No PL2 migration, no production Notion/Sheets writes, and no automatic cron scheduling are enabled by this document.

## Sources of truth

- **Existing PL2 orders:** current Apps Script + real Notion + Google Sheets remain authoritative until row-level reconciliation and owner sign-off.
- **New PL3 orders (future cutover only):** Cloudflare D1 authoritative for the new transaction's identity, ordered items, payment review and fulfillment; Notion and Google Sheets are downstream projections.
- **Existing product-only three-way sync:** separate PL2 synchronization currently handles product records; it excludes customer orders, payments and relations. Do not assume this legacy sync already handles new PL3 orders.
- **QA:** `PL3-QA-` records go only to the dedicated QA Sheet and QA Notion page, never to official order tables. The current `pl3/staging-sync-adapter.gs` rejects non-QA groups; do **not** repurpose or broaden it by changing one flag.

## Actual destination columns/properties checked read-only

Google workbook: `Petite Lueur PL｜商品三邊同步總表` (`1Ts9N_UCnn5YITrT6M3CmliKswB78q6gtoxQR9zNkEPI`).

| D1 field | Real Sheet tab | Column | Sync rule |
| --- | --- | --- | --- |
| `orders.id` | `🧾 客戶訂單` | A `訂單編號` | Immutable external identity, always search before insert |
| `orders.customer_name` | `🧾 客戶訂單` | B `訂購姓名` | **Owner-approved** identity visibility; avoid leaking to customer views |
| `orders.customer_email` | `🧾 客戶訂單` | C `Email` | Private; least privilege |
| `orders.status` | `🧾 客戶訂單` | D `訂單狀態` | Use a separately approved mapping, not raw API value |
| `orders.payment_status` | `🧾 客戶訂單` | E `付款進度` | Only `paid` after bank-statement confirmation; keep stages separate |
| `orders.total_twd` | `🧾 客戶訂單` | F `商品款 NT$` | Integer; no costs |
| `order_items` | `🛒 訂單明細` | A/B/C/D/E/I | Name, SKU, quantity, unit price, variant, linked order ID |
| `fulfillments.status` | `🛒 訂單明細` | F `履約進度` | Owner-approved translation of stage |
| `sync_outbox` | `同步紀錄` | A:D `時間/來源/結果/摘要` | Concise audit; external event ID in summary or a new approved key field |
| Conflicts | `同步衝突` | Existing classification workflow | Append conflict/owner review; never silently overwrite |

The existing Sheet `🧾 客戶訂單` includes other manual columns (second payment, due dates, notifications, pickup, Notion link). **Preserve** those until independently mapped. Its column O Notion link/formula must not be overwritten.

Notion database: `Petite Lueur PL｜訂單與預購管理`, data source `collection://8c7c6206-6e5a-4850-aac6-712d261432a5`.

| D1 | Notion property | Rule |
| --- | --- | --- |
| `orders.id` | `訂單編號` (title), `網站訂單識別碼` (text) | Unique ID; query exact before create |
| `orders.total_twd` | `商品款` (number) | No costs; numeric check |
| Order summary | `商品明細` (text) | Summary only; actual lines go to `訂單商品明細` relation after approved mapping |
| Order and payment progression | `狀態`, `付款狀態` (select) | Never create implicit new options or assume API enums equal Notion names |
| Customer identity | `顧客姓名`, `Email` | PL privacy rule: prefer customer alias for Notion; do not blindly copy legal name |
| Sync progress | `同步狀態` (select) | `待同步` / `已同步` / `需處理` according to destination acknowledgment |

## State transitions requiring owner-approved mapping

| D1 state/event | Existing Notion option | Gate |
| --- | --- | --- |
| `orders.status=pending` | `訂購申請待確認` | Allowed only for real validated PL3 checkout |
| Payment report received (`pending_review`) | `付款資料已提交` | **Not paid**. Only after identifying stage 1 vs stage 2 |
| `payment.reviewed` with verified bank deposit | `第一階段已核對` | Requires explicit phase 1; second payment uses a different option |
| Payment report `rejected` | **No exact existing option** | **Conflict / owner review**, not `已付款`, not an invented select |
| `fulfillment=ordered` | `已向日本商店下單` | Owner verifies actual purchase, not just software transition |
| `fulfillment=japan_warehouse` | `日本倉庫已到貨` | Actual warehouse receipt only |
| `fulfillment=international_shipping` | `國際運送中` | Tracking or owner evidence |
| `fulfillment=taiwan_warehouse` | `商品已抵台` | Inbound verification |
| `fulfillment=domestic_shipping/delivered` | Needs verified Notion option | Hold as conflict until mapped |

`payment_reports.status` and `orders.payment_status` are separate. The owner-approved bank-statement confirmation is the only step that can mark payment received; customer-supplied reference-last-five is not proof.

## Safe production adapter requirements before enablement

1. **Separate deployment and secrets** from the isolated QA Apps Script. Use a dedicated production Notion integration and Google Sheets authorization scoped to only the approved operational database/spreadsheet.
2. **Reconciliation table in D1:** `source_system, source_id, notion_page_id, sheet_row_key, notion_last_edited_time, sheet_revision, last_event_id, synced_at, sync_status` as a separate migration. Unique `(source_system,source_id)`; never match by name/email.
3. **Operation identity:** `sync_outbox.id` (event ID) plus immutable `order_id` or `order_item_id` and destination-specific ledger. Each target must upsert by exact ID before acknowledging; reruns must create zero new rows.
4. **Two-target acknowledgement:** record Notion success and Sheets success independently. Only mark delivered when both confirmed; partial failure retries only the unfinished target. Never claim exactly-once delivery from a successful HTTP response alone.
5. **No feedback loop:** D1-originated events update downstream projections only. Manual Notion/Sheet edits produce a conflict queue; they must not overwrite D1 automatically.
6. **Optimistic concurrency:** read destination version/last-edit before update. On mismatch, record existing value, proposed value and source revision under `同步衝突`. Wait for owner decision.
7. **Privacy:** allowlist exported fields; never export Gmail tokens, bank account numbers, PL procurement cost, private notes, OTP data, or full bank transaction details. No automatic customer notifications triggered by sync.
8. **Failure management:** bounded exponential retry, 429 handling, delivery counters and privacy-safe logs, owner-visible stuck/conflict queue. Dead-letter on repeated failures instead of infinite retry.
9. **Dry run:** use fake records, compare D1/Notion/Sheet row counts and value totals, replay twice with zero duplicates, manually inject Notion and Sheet partial failures, restore and verify checkpoint recovery.
10. **Cutover approval:** owner reviews translation tables, customer identity handling, financial totals and conflict backlog, then explicitly approves a limited non-QA staging cohort. No PL2 migration before this gate.

## Mobile owner dashboard

- Staging UI: `GET /admin-test` on `pl3-staging-api`. Mobile-responsive sections: **現在待辦**, **即將到期**, **逾期未處理**, **歷史紀錄**.
- Server-side owner authorization checks `PL3_ADMIN_EMAIL` plus signed Gmail OTP bearer token on every `/api/admin/*` route.
- Only QA group rows expose mutation buttons; production mutations require a future approval gate. Payment review and fulfillment progression require explicit confirmation.
- The initial staging page retains its session **in memory only** (up to 3600 seconds). The requested persistent mobile owner login needs an HttpOnly, Secure, SameSite session cookie with rotation, server-side revocation and idle/absolute expiry; **never** store owner bearer tokens in localStorage.
- The frontend is not the security boundary; the Worker must continue enforcing authorization and data validation.

## What is *not* done yet

- No owner page published to the official PL2 Pages site.
- No production Notion/Sheets order writes.
- No automatic cron or full failure-injection tests.
- No PL2 historic records imported.
