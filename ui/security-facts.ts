/**
 * Prints the held paths (gate.ts SECURITY_PATHS) and the profile of a worker step (sandbox.ts) as JSON, for /api/gates.
 * It runs as its own process: the UI server imports no security path (jobs/lib/ui-graph.test.ts), so a change to them
 * shows on the next request with no restart.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECURITY_PATHS } from "../jobs/lib/gate.ts";
import { layout } from "../jobs/lib/layout.ts";
import { profile } from "../jobs/lib/sandbox.ts";

/** The profile of a worker step (unit.ts: read in.bundle, write home, work and tmp), as sandbox.ts builds it, with the run folder as `<run>`. */
export function sandboxPolicy() {
  const dir = mkdtempSync(join(tmpdir(), "aleph-gates-"));
  try {
    const s = JSON.parse(readFileSync(profile(dir, { read: ["in.bundle"], write: ["home", "work", "tmp"] }), "utf8"));
    const socks = join(layout().sandbox, ".s");
    const rel = (p: string) => (p.startsWith(dir) ? `<run>${p.slice(dir.length)}` : p.startsWith(socks) ? `${socks}/<run>` : p);
    return {
      read: (s.filesystem.allowRead as string[]).map(rel),
      write: (s.filesystem.allowWrite as string[]).map(rel),
      denied: s.filesystem.denyRead as string[],
      network: { domains: s.network.allowedDomains as string[], localBinding: !!s.network.allowLocalBinding },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) console.log(JSON.stringify({ held: SECURITY_PATHS, sandbox: sandboxPolicy() }));
