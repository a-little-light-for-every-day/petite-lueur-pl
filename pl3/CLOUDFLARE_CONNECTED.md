# Cloudflare staging deployment connection

GitHub integration: `a-little-light-for-every-day/petite-lueur-pl`
Branch: `pl3-development`
Cloudflare Worker: `pl3-staging-api`
Build root: `/`

## Required Cloudflare Builds configuration

In **Workers & Pages → pl3-staging-api → Settings → Build** set:

- Deploy command: `node pl3/upload-staging.mjs`
- Build command: leave blank.
- Build secrets (encrypted **Build** secrets, separate from Worker runtime secrets):
  - `GMAIL_CLIENT_ID`
  - `GMAIL_CLIENT_SECRET`
  - `GMAIL_REFRESH_TOKEN`
  - `OTP_PEPPER`
  - `SESSION_SECRET`

Set the values in Cloudflare's **Build secrets** UI, never in GitHub, commit messages, chat, or plain-text build variables. If values are no longer available, do not attempt to recover them from encrypted Worker secrets; plan a deliberate rotation instead.

The upload script reads only the five Build secrets, writes a mode-0600 temporary JSON file outside the repository, passes that file to `wrangler versions upload --secrets-file`, and removes the file afterward, including on upload failure. Missing values stop the build before any version upload. `secrets.required` in `pl3/wrangler.jsonc` continues to enforce presence of all five values.

**IMPORTANT**: `wrangler versions upload` only creates a new Worker version; it does **not** activate it for live traffic. Do not change to `wrangler deploy` or `wrangler versions deploy` until end-to-end staging tests pass. The public PL 2.0 website and production Worker stay unchanged.

## Validation

After Build secrets and deploy command are saved, trigger a fresh build on `pl3-development` (or retry with current Build settings). Confirm the build lists all required bindings without exposing values, then test Gmail OTP only on the new staging candidate. Stop if missing-secret errors persist. Never commit secret values; do not merge the development branch into `main` without review.

## History

Original deploy command: `npx wrangler versions upload --config pl3/wrangler.jsonc`. Prior Git-integrated uploads did not carry the five runtime secrets, despite their presence in the Worker dashboard. Adding `keep_vars` did not fix that distinction. The 2026-11-01 update requires secrets as encrypted Cloudflare **Build** secrets and uploads them explicitly to the new version.
