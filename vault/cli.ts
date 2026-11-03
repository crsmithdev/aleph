#!/usr/bin/env bun
/**
 * vault <init|write|adopt|recall [--episodes] [--scope]|lint [--fix]|consolidate|archive|compile|misses [--days N]> — the
 * mechanical half of /aleph:vault.
 * Vault path: $ALEPH_VAULT or ~/.aleph/vault. JSON on stdout, findings on
 * stderr, exit 1 on refusal. See docs/specs/2026-09-04-memory-vault.md.
 */
import { Exit, run } from "./lib/ops.ts";

try {
  await run(process.argv.slice(2));
} catch (e) {
  if (!(e instanceof Exit)) throw e;
  process.exit(e.code);
}
