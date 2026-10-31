# PL 3.0 Gmail API configuration (staging only)

PL 3.0 uses the existing sender `petitelueur.pl@gmail.com` via the Gmail API rather than Resend. Do not switch traffic until OAuth and email delivery are proven.

## Google Cloud setup (owner action)
1. Create/select a Google Cloud project owned by the PL Gmail account. Enable Gmail API.
2. Configure Google OAuth consent screen, with the PL account as a test user if the app is in testing.
3. Request only `https://www.googleapis.com/auth/gmail.send`. Do not request Gmail read or modify access.
4. Create an OAuth Client ID and securely authorize the sender account via OAuth 2.0 with offline access.
5. Obtain a refresh token through a trustworthy OAuth flow and store it exclusively as a Cloudflare Worker secret. Never paste tokens into GitHub, chats, issues, screenshots or client-side code.
6. Add the following Cloudflare **Secret** variables to pl3-staging-api:
   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - `GMAIL_REFRESH_TOKEN`
   - `OTP_PEPPER` (long random secret)
   - `SESSION_SECRET` (different long random secret)
   - `GMAIL_SENDER` = `petitelueur.pl@gmail.com` (may be a plaintext variable)
7. Confirm the exact Gmail address selected in OAuth is the permitted sender.
8. Test sending a code only to an owner-controlled email before any customer requests.

Google OAuth refresh-token longevity can be limited while the app is in Testing; check Google's current OAuth policy before production.

## Safety and rollback
- Current Worker active deployment stays untouched while the GitHub integration runs `wrangler versions upload`.
- Never log OTPs, OAuth credentials, access tokens, refresh tokens, customer addresses, payment instructions or order contents.
- Complete D1 migration 0002 and integration tests before turning on the new Worker version.
- Cloudflare GitHub build passing alone is not a working end-to-end OTP verification.
