/**
 * The smoke test after a delivery: each tick asks aleph-ui for its page and its Status
 * data. One failure can be a restart in progress, so the health line needs two ticks in a row.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { layout } from "../infra/layout.ts";
import { uiPort } from "../infra/settings.ts";
import { factoryCookie } from "../infra/ui-token.ts";

/** The file that holds the count of failures in a row. */
export const smokeFile = () => join(layout().factory, "smoke.json");

const PATHS = ["/", "/api/state"];
const TIMEOUT_MS = 15_000;
const FAILS_TO_REPORT = 2;
const port = uiPort;

interface Smoke { fails: number; reason?: string; at?: string }

/** Why aleph-ui failed, or null when each path answers 2xx. */
export async function smokeProblem(base = `http://127.0.0.1:${port()}`): Promise<string | null> {
  for (const path of PATHS) {
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { cookie: factoryCookie() } });
      if (!r.ok) return `${path} answered ${r.status}`;
    } catch (e) {
      return `${path}: ${e instanceof Error ? e.message : e}`;
    }
  }
  return null;
}

const read = (file: string): Smoke => {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return { fails: 0 }; }
};

/** One smoke test: the count of failures in a row, kept in `file`, with the first failure's time. */
export async function smokeStep(file = smokeFile(), base?: string, now = Date.now()): Promise<void> {
  const reason = await smokeProblem(base);
  const last = read(file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(reason ? { fails: last.fails + 1, reason, at: last.at ?? new Date(now).toISOString() } : { fails: 0 }));
}

/** The health line, once FAILS_TO_REPORT ticks in a row failed. */
export function smokeLine(file = smokeFile()): string | null {
  const s = read(file);
  return s.fails >= FAILS_TO_REPORT ? `health: aleph-ui has failed its smoke test since ${s.at}: ${s.reason}` : null;
}
