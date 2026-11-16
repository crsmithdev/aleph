/**
 * The smoke test after a delivery: each tick asks aleph-ui for its page and its Status
 * data. One failure can be a restart in progress, so the health line needs two ticks in a row.
 */
import { getJson, putJson } from "../../../lib/db.ts";
import { uiPort } from "../infra/settings.ts";
import { factoryCookie } from "../infra/ui-token.ts";
import { errText } from "../../../lib/errtext.ts";

const PATHS = ["/", "/api/factory"];
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
      return `${path}: ${errText(e)}`;
    }
  }
  return null;
}

const read = (): Smoke => getJson("state", "smoke", { fails: 0 });

/** One smoke test: the count of failures in a row, kept in `state`, with the first failure's time. Returns why it failed, or null. */
export async function smokeStep(base?: string, now = Date.now()): Promise<string | null> {
  const reason = await smokeProblem(base);
  const last = read();
  putJson("state", "smoke", (reason ? { fails: last.fails + 1, reason, at: last.at ?? new Date(now).toISOString() } : { fails: 0 }));
  return reason;
}

/** The health line, once FAILS_TO_REPORT ticks in a row failed. */
export function smokeLine(): string | null {
  const s = read();
  return s.fails >= FAILS_TO_REPORT ? `health: aleph-ui has failed its smoke test since ${s.at}: ${s.reason}` : null;
}
