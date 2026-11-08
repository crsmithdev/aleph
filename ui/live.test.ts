import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "../jobs/lib/records/ledger.ts";
import { putRun } from "../jobs/lib/records/record.ts";
import { withEnv, withServer, type TestServer } from "./test-server.ts";

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-live-"));
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_ISSUES: join(base, "issues"), ALEPH_FACTORY_DIR: join(base, "factory") });
  // A fixed clock: the newest point of a frame is the hour (week) or the day (cost) that holds it.
  setSystemTime(new Date("2026-11-08T10:30:00Z"));
  ({ server, stop } = await withServer({ warm: false }));
});

afterAll(() => {
  stop();
  restoreEnv();
  setSystemTime();
  rmSync(base, { recursive: true, force: true });
});

/** Opens `/api/live` and reads its `row` events, each `{ key, row }`. */
async function open(path = "/api/live") {
  const ctl = new AbortController();
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { signal: ctl.signal });
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = "";
  return {
    type: res.headers.get("content-type"),
    /** The data of the next `row` event; the pings in between carry none. */
    async row(): Promise<{ key: string; row: any }> {
      for (;;) {
        const i = buf.indexOf("\n\n");
        if (i < 0) {
          const { value, done } = await reader.read();
          if (done) throw new Error("the stream ended");
          buf += dec.decode(value);
          continue;
        }
        const block = buf.slice(0, i), data = block.split("\n").find((l) => l.startsWith("data: "));
        buf = buf.slice(i + 2);
        if (data) return JSON.parse(data.slice(6));
      }
    },
    close: () => ctl.abort(),
  };
}

/** A build run of the window that ends a minute ago, so it falls in the newest point of the live frame. */
const build = (): Run => ({ kind: "build", job: "j1", name: "j1", told: true, condition: "passed", model: "claude-opus-5-5", cost: 0.5, started: "2026-11-08T10:00:00Z", ended: "2026-11-08T10:29:00Z" });

test("the stream answers text/event-stream, and a run written to the store sends the live row again", async () => {
  const s = await open();
  expect(s.type).toBe("text/event-stream");
  // On connect: one row per panel key, the newest row of its frame, with no run yet to count.
  const first = [await s.row(), await s.row()];
  expect(first).toEqual([
    { key: "factory/agents/live", row: { at: "2026-11-08T10:00:00.000Z" } },
    { key: "factory/agents/cost", row: { at: "2026-11-08T00:00:00.000Z" } },
  ]);
  // Half a second after the record changes, the same two keys come again with the run's own numbers.
  putRun("r-1", build());
  const again = [await s.row(), await s.row()];
  expect(again).toEqual([
    { key: "factory/agents/live", row: { at: "2026-11-08T10:00:00.000Z", worker: 0.48 } },
    { key: "factory/agents/cost", row: { at: "2026-11-08T00:00:00.000Z", "claude-opus-5-5": 0.5 } },
  ]);
  s.close();
});
