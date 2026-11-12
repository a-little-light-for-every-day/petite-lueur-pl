# PL3 staging owner mobile session rollout

Scope: `pl3-staging-api` and `pl3-staging` only. PL2 is not connected or migrated. Do not merge the implementation into main or promote untested versions.

## What changes

- The existing Gmail OTP flow still verifies the owner. After a successful OTP, `POST /api/admin/session/start` (valid one-hour owner Bearer only) creates a random 256-bit opaque token.
- Only a SHA-256 digest of the token is stored in the staging D1 `admin_sessions` table. The token is sent only as `__Host-pl3_admin` cookie, with `Secure; HttpOnly; SameSite=Strict; Path=/`. It is never returned as a JSON value, never kept in localStorage, and is unavailable to page JavaScript.
- Existing admin PowerShell bearer calls still work; browser admin calls use same-origin cookies. Cookie-backed POST requires the exact request Origin, `X-PL3-Admin-Action: 1`, and same-origin Fetch Metadata when present.
- The server enforces a 30-day absolute session limit and a 7-day inactivity timeout. Activity extends the inactivity deadline at most once an hour. Each explicit logout revokes its D1 token immediately and expires the browser cookie. Revocation across devices is not implemented yet.
- The session API works only for the server-configured `PL3_ADMIN_EMAIL`; other OTP users cannot receive owner cookies.

## Sensitive action re-verification windows

- The persistent login remains 30 days absolute / 7 days idle. It does not authorize unlimited financial changes.
- `receipt_confirm` (a real bank/platform receipt supported by explicit evidence and allocation) and `credit_allocate` may reuse the most recent owner Email OTP sign-in for **2 hours**. A customer payment report alone never creates bank receipt.
- All other admin mutations, including `payment_accounts_config`, notification approval, exports, restores and all-session revocation, retain the **15-minute** recent-authentication limit. The short-lived bearer still requires an OTP issued within 5 minutes.
- After a window expires, the existing login remains valid to view the console; only the protected action triggers OTP. The unsaved form remains available, and the operation is **not** automatically retried after verification.
- No new OTP email provider, D1 schema migration, payment automation or customer email is introduced by this change.

## First: apply additive D1 schema

Do **not** promote the new Worker before this succeeds. Apply ONLY to the D1 database named `pl3-staging` (not PL2 production). Make a staging backup first.

Cloudflare D1 Studio: select `pl3-staging`, paste and run the exact SQL in `pl3/migrations/0003_admin_sessions.sql`, or, from a checkout of this branch:

```bash
npx wrangler d1 execute pl3-staging --config pl3/wrangler.jsonc --remote --file pl3/migrations/0003_admin_sessions.sql
```

Confirm read-only:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name='admin_sessions';
```

Expected: one row, `admin_sessions`. No old table or order data should change.

## Then: tests and staged version

1. Confirm GitHub Action `PL3 staging API checks` passes the `pl3/tests/admin-session.mjs` tests.
2. Cloudflare Builds automatically runs `node pl3/upload-staging.mjs` to **upload a version**, not switch live traffic. Note its new version ID.
3. Only then manually promote that **staging** version to 100%; leave PL2 unchanged. If D1 migration was skipped, do not promote.
4. On the official owner's iPhone, visit `https://pl3-staging-api.petitelueur-pl.workers.dev/admin-test` and OTP sign in once. Refresh the page; it should automatically restore the dashboard without another email.
5. Close and reopen Safari and verify the same result. Test all four dashboard tabs without changing QA orders, payments, or fulfillments.
6. Press Logout and verify that a reload now requests OTP again. Old PowerShell short-term owner Bearer tests may still work for their separate 1-hour TTL; do not paste tokens into chat.
7. If an error occurs, leave the previous staging version active and capture only HTTP status/error text without cookies, OTP, or secrets.

## Limitations

No biometric unlock, cross-device logout, or account-wide session revocation yet. This is a staging-only browser session, not permission to operate on PL2 production orders. A stolen unlocked phone must be treated as a potential account compromise until its session expires or is revoked.
