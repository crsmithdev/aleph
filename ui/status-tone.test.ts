import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPaused } from "../jobs/lib/gates/factory-status.ts";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { verdict } from "../lib/status-words.ts";
import { writeRepos } from "../tests/projects.ts";

let base: string, factory: string, server: TestServer, stop: () => void, restoreEnv: () => void;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-tone-"));
  factory = join(base, "factory");
  for (const d of [join(base, "runs"), factory, join(base, "issues", ".git", "refs", "remotes", "origin")]) mkdirSync(d, { recursive: true });
  writeRepos({ p: { path: join(base, "p") } }, join(base, "issues"));
  // systemctl answers the tick timer with a next run a minute out: the tone is the factory's, not the host's timers, and a CI runner has no tick timer.
  const systemctl = join(base, "systemctl");
  writeFileSync(systemctl, `#!/bin/sh\ncase "$2" in list-timers) echo '[{"unit":"aleph-tick.timer","next":'$(( ($(date +%s) + 60) * 1000000 ))'}]';; esac\n`, { mode: 0o755 });
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_ITEMS: join(base, "issues"), ALEPH_FACTORY_DIR: factory, ALEPH_SYSTEMCTL: systemctl });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => { setPaused(false); stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`);

test("the status tone is the Status page's verdict, and its change is signalled on the stream", async () => {
  expect(await (await get("/api/status")).json()).toEqual({ tone: "fine" });
  const ctl = new AbortController();
  const reader = (await fetch(`http://127.0.0.1:${server.port}/api/events`, { signal: ctl.signal })).body!.getReader();
  await reader.read(); // the first ping
  setPaused(true);
  let text = "";
  try { while (!/event: change\ndata: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value); } finally { ctl.abort(); }
  expect(text).toContain("/api/status");
  expect(await (await get("/api/status")).json()).toEqual({ tone: "warning" });
  expect(verdict(await (await get("/api/factory")).json()).tone).toBe("warning");
});
