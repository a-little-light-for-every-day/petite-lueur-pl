# PL 3.0 staging rollout gate

This branch is **not production-ready**. Existing GitHub Pages main and Apps Script order flow remain unchanged.

## Completed in pl3-development
- Read-only D1 catalog Worker candidate and catalog preview.
- Existing staging D1: 8 core tables, 6 indexes, 90 products imported for group PL-AIKATSU-261031 (verified via Cloudflare screenshots).
- Migration 0002 adds idempotency, OTP rate limits, payment review, audit and sync outbox storage.
- Authenticated Worker API candidate: GET /health, /api/groups, /api/products?group_id=, POST /api/auth/request-code, POST /api/auth/verify-code, GET/POST /api/orders, POST /api/payment-reports.

## Explicit deployment prerequisites
1. **Back up** `pl3-staging`, and apply `pl3/migrations/0002_operational.sql` to *staging only*. Never apply untested schema to production.
2. Configure Worker D1 binding `DB` -> `pl3-staging` and secrets `OTP_PEPPER`, `SESSION_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`. Never put secrets in git, public HTML or screenshots.
3. Confirm DNS/sending domain verification and mail deliverability for Resend.
4. Verify actual `groups.status`, `products.status`, group deadlines, quantity semantics and checkout total policy against the D1 schema and business rules. Candidate checkout currently accepts only group `status='open'`, product `status='active'`, published groups, and an NT$22,000 cap.
5. Run migrations and integration tests against a **separate disposable test database** before staging. Test OTP expiry, wrong code, resend rate limits, email isolation, duplicate idempotency keys, stale price, max quantity, payment report and transaction rollback.
6. Manually reconcile imported 90 products, source currency conversion, pricing and missing official image URLs. Group is review-required and unpublished; do not publish without owner approval.
7. Implement and test the complete admin review and fulfillment workflow, order notification email, source-of-truth sync, retryable outbox processor, data retention and audit policies. Current candidate does **not** implement those.
8. Connect staging frontend to staging API behind a private test path; test customer ordering, payment reporting and tracking in multiple browsers.
9. Confirm source sheet, Notion, existing Apps Script, payment procedures and legacy orders; migrate incrementally with an explicit rollback and cutover plan.
10. Only after owner sign-off and all tests, open PR for review, merge to `main` and deploy production. The existing formal site must not be redirected early.

## Security notes
- Checkout calculates totals from D1 prices rather than trusting browser totals.
- Customer order list is scoped to authenticated email.
- Payment reports are `pending_review`, never auto-mark paid.
- Browser-only CORS **does not** authenticate requests; email OTP and signed bearer token are required.
- This is a candidate, not a finished commerce system. Add CSRF/abuse and concurrency testing before deployment.
