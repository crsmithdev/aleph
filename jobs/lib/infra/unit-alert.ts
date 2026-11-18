/**
 * The script `aleph-alert@.service` runs when a unit fails: `bun unit-alert.ts <unit>` posts one Sidetone tell that names the unit.
 * It imports nothing from the factory, so a broken tick cannot break it. A stamp file keeps it to one tell per unit in 30 minutes.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const unit = process.argv[2];
const WINDOW_MS = 30 * 60_000;
// Not lib/paths.ts: the script loads nothing from the factory.
const dir = process.env.ALEPH_FACTORY_DIR ?? `${process.env.HOME}/.aleph/factory`;
const stamp = join(dir, `alert-${unit}.stamp`);

if (existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < WINDOW_MS) process.exit(0);

const url = process.env.SIDETONE_TELL_URL ?? "https://127.0.0.1:3100/tell";
// The certificate names the tailnet host, not the loopback, so skip the check there only.
const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: `${unit} failed` }),
  signal: AbortSignal.timeout(10_000),
  tls: loopback ? { rejectUnauthorized: false } : undefined,
} as RequestInit);
if (!res.ok) { console.error(`tell answered ${res.status}`); process.exit(1); }
mkdirSync(dir, { recursive: true });
writeFileSync(stamp, "");
