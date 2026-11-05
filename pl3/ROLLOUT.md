# PL 3.0 staging rollout gate

This branch is **not production-ready**. Existing GitHub Pages main and Apps Script order flow remain unchanged.

## Completed in pl3-development
- Read-only D1 catalog Worker candidate and catalog preview.
- Existing staging D1: 8 core tables, 6 indexes, 90 products imported for group PL-AIKATSU-261031 (verified via Cloudflare screenshots).
- Migration 0002 adds idempotency, OTP rate limits, payment review, audit and sync outbox storage.
- Authenticated Worker API candidate: GET /health, /api/groups, /api/products?group_id=, POST /api/auth/request-code, POST /api/auth/verify-code, GET/POST /api/orders, POST /api/payment-reports.

## Explicit deployment prerequisites
1. **Back up** `pl3-staging`, and apply `pl3/migrations/0002_operational.sql` to *staging only*. Never apply untested schema to production.
2. Configure Worker D1 binding `DB` -> `pl3-staging`; use Gmail API OAuth via encrypted `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, plus `OTP_PEPPER` and `SESSION_SECRET`. Keep `GMAIL_SENDER` and `PL3_ADMIN_EMAIL` as explicit non-secret addresses. Never put secret values in git, public HTML, or screenshots.
3. Confirm Google Gmail API sender authorization and mail delivery; Gmail OTP send/verify was tested successfully on staging.
4. Verify actual `groups.status`, `products.status`, group deadlines, quantity semantics and checkout total policy against the D1 schema and business rules. Candidate checkout currently accepts only group `status='open'`, product `status='active'`, published groups, and an NT$22,000 cap.
5. Run migrations and integration tests against a **separate disposable test database** before staging. Test OTP expiry, wrong code, resend rate limits, email isolation, duplicate idempotency keys, stale price, max quantity, payment report and transaction rollback.
6. Manually reconcile imported 90 products, source currency conversion, pricing and missing official image URLs. Group is review-required and unpublished; do not publish without owner approval.
7. Owner-only review and fulfillment mutation candidates are implemented on the development branch with unit tests but are **not yet deployed or live-tested**. Order notification email, source-of-truth sync, retryable outbox processor, data retention and external audit reconciliation remain outstanding.
8. Connect staging frontend to staging API behind a private test path; test customer ordering, payment reporting and tracking in multiple browsers.
9. Confirm source sheet, Notion, existing Apps Script, payment procedures and legacy orders; migrate incrementally with an explicit rollback and cutover plan.
10. Only after owner sign-off and all tests, open PR for review, merge to `main` and deploy production. The existing formal site must not be redirected early.

## Security notes
- Checkout calculates totals from D1 prices rather than trusting browser totals.
- Customer order list is scoped to authenticated email.
- Payment reports are `pending_review`, never auto-mark paid.
- Browser-only CORS **does not** authenticate requests; email OTP and signed bearer token are required.
- This is a candidate, not a finished commerce system. Add CSRF/abuse and concurrency testing before deployment.

## 2026-11-01 actual staging acceptance evidence
- Gmail OAuth OTP send/verify succeeded and the official mailbox received a test message.
- Browser OTP lookup succeeded.
- Dedicated QA order `9e4b1895-b5bc-4989-b084-56f74f63ebd7`: NT$350, one item, one fulfillment, one idempotency record, one pending payment report, one sync outbox record. Duplicate submission returned the same order ID; all six D1 row-count checks returned 1.
- QA group subsequently returned no published results from `/api/groups` (read-only public check).
- New owner-only review and fulfillment endpoints are development candidates, not production verified.
- The test order remains in D1 staging as evidence; legacy orders have not been migrated and Notion/Sheets are not receiving automatic D1 writes.
- See `SYNC_AND_MIGRATION_PLAN.md` for source-of-truth boundaries and safe migration stages.
