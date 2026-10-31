// PL3 staging-only version upload. Secrets come from Cloudflare Builds secrets,
// never from the repository or Worker runtime configuration.
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const names = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "OTP_PEPPER",
  "SESSION_SECRET",
];

// Optional feature secrets; omitted integrations remain locked.
// Formal sync requires its own cohort/URL/enable gates in Worker runtime variables.
const optionalNames = [
  ...(process.env.PL3_SYNC_WEBHOOK_SECRET ? ["PL3_SYNC_WEBHOOK_SECRET"] : []),
  ...(process.env.PL3_FORMAL_SYNC_SECRET ? ["PL3_FORMAL_SYNC_SECRET"] : []),
];
const missing = names.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(
    "PL3 staging upload halted: missing Cloudflare Builds secrets: " +
      missing.join(", ")
  );
  process.exit(1);
}

const directory = mkdtempSync(join(tmpdir(), "pl3-staging-secrets-"));
const file = join(directory, "secrets.json");

try {
  const secrets = Object.fromEntries([...names, ...optionalNames].map((name) => [name, process.env[name]]));
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600, flag: "wx" });

  // Upload only. Never promote the candidate to live traffic automatically.
  const result = spawnSync(
    "npx",
    ["--yes", "wrangler", "versions", "upload", "--config", "pl3/wrangler.jsonc", "--secrets-file", file],
    { stdio: "inherit", shell: false }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  try { unlinkSync(file); } finally { rmdirSync(directory); }
}
