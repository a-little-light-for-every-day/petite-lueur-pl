# PL 3.0 operations, sync, and legacy migration contract

Status: **design/implementation gate — do not enable production writes**.
Validated on 2026-11-01: staging Gmail OTP, test checkout, idempotency, customer lookup, payment report and six D1 row-count checks. This does not validate owner review, automatic sync, or legacy imports.

## Sources and ownership

- D1 `pl3-staging` is the write target for new PL3 staging transactions.
- PL2 Apps Script and existing Notion/Google Sheets remain the source of truth for real legacy orders until reconciliation and owner sign-off.
- Google Sheet: `Petite Lueur PL｜商品三邊同步總表` (`1Ts9N_UCnn5YITrT6M3CmliKswB78q6gtoxQR9zNkEPI`).
- Relevant tabs were inspected read-only through Google Sheets metadata and bounded header reads. No customer rows or credentials belong in this contract.

| D1 concept | Google Sheet tab | Safe field mapping |
| --- | --- | --- |
| `groups` | `📌 團次管理` | `title` → 團次名稱; `id` → 團次編號; order deadline → PL 結單時間. Status requires a reviewed translation map. |
| `orders` | `🧾 客戶訂單` | `id` → 訂單編號, `customer_name` → 訂購姓名, `customer_email` → Email, `total_twd` → 商品款 NT$. Other payment/fulfillment fields require separate review. |
| `order_items` | `🛒 訂單明細` | product ID → 商品編號, quantity → 數量, unit price → 台幣單價, variant → 規格, order ID → 所屬訂單. Do not infer relationship from a Notion URL alone. |
| `payment_reports` | `🧾 客戶訂單` and approved financial review workflow | A report is **not** a confirmed receipt. Keep it in pending review; only owner bank-statement verification may mark paid. Do not append a revenue row merely from a report. |
| `sync_outbox` | `同步紀錄` | Audit timestamp/source/outcome/summary after successful destination acknowledgement, keyed by event UUID. |

## Owner/admin workflow (not yet live)

1. Authorize owner by a valid signed session token **and** server-side owner email allowlist; never use a client-side flag as authorization.
2. Read pending payment reports with order context; present amount, method and reference last-five.
3. Owner manually compares actual bank statement, then explicitly confirms or rejects. Do not infer payment based on matching amounts or self-reported last five.
4. Record review outcome and actor in `audit_events`; update payment status in an atomic D1 transaction and emit `sync_outbox` event. Prevent double review, double financial booking, and partial updates.
5. Fulfillment updates must use the real `fulfillments` schema, a defined state transition map, actor and audit event; never expose private sourcing/cost to customer views.

## Outbox delivery contract (not yet live)

1. A dedicated authenticated sync worker pulls only pending D1 events.
2. Use stable `sync_outbox.id` as the event idempotency key in **each** destination; send only allowlisted columns.
3. Await destination acknowledgement before `status=delivered`; failures increment `attempts`, set `last_error` and `next_attempt_at` with bounded backoff.
4. Store external destination identifiers and origin revision; do not fan out an echo event back to D1.
5. Write conflicts into existing `同步衝突` classification workflow; do not silently overwrite manually edited Notion/Sheets rows.
6. Secrets remain in Cloudflare encrypted runtime/build configuration, not GitHub, static Pages, logs, or spreadsheets.
7. A valid Google Sheets connector in this assistant does **not** mean the deployed Worker has an OAuth/service account authorization. Set up a separately authenticated service connector before enabling background writes.

## PL2 migration and reconciliation (not yet live)

1. Export snapshots from actual PL2 Apps Script, Notion, and official Google Sheet; keep a recoverable backup and provenance/revision timestamps.
2. Import to **staging staging tables**, not `orders`, with original source ID, source system, external Notion page ID, row identifier and raw status (redacting sensitive transport fields).
3. Generate a stable migration identity `(source_system, source_record_id)`. Do **not** merge by customer email/name alone; some records are private quotes, reservations or unplaced orders.
4. Normalize statuses using an owner-approved mapping. Payment verified by owner is distinct from customer report; shipping stage is distinct from order stage.
5. Compare row counts, amounts, product quantity/variant, fulfillment state, payment confirmations and source links. Quarantine ambiguous or conflicting records for owner approval.
6. Dry-run twice and verify second run inserts zero duplicates; produce discrepancy report. No customer notifications during import.
7. Perform an owner-approved limited cutover with rollback, only after Notion/Sheets sync and owner workflow are proven.

## Next technical dependency

Read exact D1 table definitions for `orders`, `fulfillments`, `payment_reports`, `audit_events`, and `sync_outbox` before implementing write endpoints. `groups` and `products` were already inspected. Do not invent allowed status values or columns.
