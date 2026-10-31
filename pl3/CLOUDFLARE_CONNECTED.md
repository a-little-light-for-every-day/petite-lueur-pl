# Cloudflare staging deployment connection
GitHub integration: a-little-light-for-every-day/petite-lueur-pl
Branch: pl3-development
Cloudflare Worker: pl3-staging-api
Build root: /
Deploy command: npx wrangler versions upload --config pl3/wrangler.jsonc

This commit is deliberately safe: versions upload does NOT promote the candidate to live traffic.
Before activation, apply migration 0002 to staging D1, configure OTP/session/email secrets and pass end-to-end testing.
Never commit secret values. Do not merge this development branch into main without review.
