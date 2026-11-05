# PL3 staging acceptance — 2026-11-03 (Asia/Taipei)

## Verified live

- Official owner Gmail OTP login succeeded. Refresh and a newly opened admin tab restored the same server-side session without another OTP.
- Owner dashboard keeps the selected section in its URL hash after refresh; the storefront link opens separately (`noopener noreferrer`) so it does not replace the dashboard.
- Receiver v4 on the existing isolated formal endpoint accepts UTF-8 Chinese payloads. A public known-vector check passed with explicit UTF-8 and failed with the Apps Script default encoding. Matching secrets alone did not fix this defect.
- The isolated formal workbook initially lacked access for the receiver's execution account. Access for the official owner account was corrected on that workbook only.
- Synthetic order `PL3-FORMAL-TEST-ORDER-20261101-01`: one item, quantity 1, NT$100, unpaid. Sheets contains one order, one item and one event-ledger row. Notion contains one matching page with the same event, amount, summary and status.
- Both destination acknowledgements were recorded in D1. Final UI: pending 0, delivered events 1, delivered destinations 2, retry/dead/conflict 0.
- A Notion timeout after Sheets success was recovered by retrying Notion only. The successful Sheets delivery was preserved.
- Replaying the completed drain returned examined 0 with no new rows or pages.
- Automated tests: 55 passed, 0 failed, including Chinese UTF-8 HMAC regression, replay recovery, partial failure, conflict quarantine, ownership, session expiry/revocation, checkout idempotency and report-versus-bank-verification separation.

## Corrections implemented

- Explicit `Utilities.Charset.UTF_8` in the Apps Script HMAC verifier.
- Fixed, non-sensitive receiver error codes for diagnosis; arbitrary exception text is not returned as a credential-bearing payload.
- Dashboard shows destination retry, dead and conflict counts instead of hiding them behind order-event counts.
- Formal delivery timeout increased from 15 to 45 seconds, below the existing 120-second claim lease, to accommodate the observed Apps Script/Notion latency.

## Scope and remaining release gates

This verifies the isolated PL3 staging workflow, **not a production cutover**.

- PL2, current customer orders, pricing, Ensky's 11/4 deferral and real payment records were not migrated or overwritten.
- No customer notification or procurement was triggered. Only owner verification mail and isolated synthetic sync records were used.
- Real first-/second-installment schema, COD/partial payments, overpayment credit, legacy row-level reconciliation and rollback still require implementation and review before enabling real order writes.
- Real customer financial records deliberately remain blocked by the existing projection guard; the staging paid/unpaid flag must not be mapped blindly to PL2 payment phases.
- Mobile Safari process-close/reopen and physical iPhone acceptance were not performed. Browser refresh/new-tab session restoration was verified; this is not evidence of actual iPhone testing.
- Production remains on PL2. Do not merge the development branch or redirect live customer traffic based only on this rehearsal.

## Evidence locations

- Worker: `pl3-staging-api`, D1: `pl3-staging`.
- Owner UI: <https://pl3-staging-api.petitelueur-pl.workers.dev/admin-test>
- Isolated Sheets: <https://docs.google.com/spreadsheets/d/1V1OoNYnes0EpdV_dERAMcElveL-nC5kmQ66geXXKooo/edit>
- Notion test page: <https://app.notion.com/40d52485b66081d29264d2258d3e53aa>

No secrets, session credentials, OTPs, bank references or real customer identities are included here.
