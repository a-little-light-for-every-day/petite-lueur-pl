# PL3 staging mobile owner dashboard — QA-only release

This release improves the existing /admin-test interface without changing D1 schema or payment rules.

## Owner mobile workflow

- Summary cards display counts of pending payment reports, unfinished fulfillments, orders within seven days of their GROUP ORDER DEADLINE, and past-deadline orders. Group deadlines are not payment deadlines.
- Payment review queue displays reported vs order amount, last five digits, customer and report metadata, and a mismatch warning. **Never infer bank receipt from a report.** There is no automatic "paid" action in this browser UI.
- QA report rejection requires a written reason and confirmation and creates the existing audit and outbox event.
- Fulfillment rows show a numbered step, available tracking references, and clearly marked QA-only next-step simulation.
- Audit history is read-only with human-readable action labels and original identifiers.
- Backend /api/admin/payment-reviews and /api/admin/fulfillment-advances now reject mutations for orders whose group_id does not start with PL3-QA-. The full bank-statement confirmation requirement for approval remains in place.
- Existing owner HttpOnly session, CSRF restriction, 7-day idle and 30-day absolute expiry are preserved.

## Safe rollout and acceptance

1. GitHub CI `node --test pl3/tests/*.mjs` and syntax check pass.
2. Cloudflare Builds `node pl3/upload-staging.mjs` uploads a new staging version only. Do not automatically promote.
3. The owner verifies the newest version ID, then promotes **only pl3-staging-api**, not PL2. Roll back to the previously tested 7ade898b version if the dashboard errors.
4. On mobile, open `/admin-test`, sign in or reuse the HttpOnly session, and check four tabs. The seeded QA data should show no pending payment reports, one in-progress fulfillment and one order (unless manually modified). Check summaries and history.
5. No need to click a QA simulation button to validate a read-only layout; doing so changes D1 and adds audit/outbox events.

## Explicitly out of scope

Production order syncing, PL2 migration, recurring notifications/cron, actual bank receipts, real purchasing, and Notion/Sheets formal writes. QA event-ledger sync stays QA-only and should not be interpreted as a full production reconciliation.
