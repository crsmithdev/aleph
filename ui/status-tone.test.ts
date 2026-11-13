import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { verdict } from "../lib/status-words.ts";

let base: string, factory: string, server: TestServer, stop: () => void, restoreEnv: () => void;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-tone-"));
  factory = join(base, "factory");
  for (const d of [join(base, "runs"), factory, join(base, "issues", ".git", "refs", "remotes", "origin")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(base, "repos.json"), JSON.stringify({ p: { path: join(base, "p") } }));
  restoreEnv = withEnv({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_ISSUES: join(base, "issues"), ALEPH_FACTORY_DIR: factory });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => { stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`);

test("the status tone is the Status page's verdict, and its change is signalled on the stream", async () => {
  expect(await (await get("/api/status")).json()).toEqual({ tone: "fine" });
  const ctl = new AbortController();
  const reader = (await fetch(`http://127.0.0.1:${server.port}/api/events`, { signal: ctl.signal })).body!.getReader();
  await reader.read(); // the first ping
  writeFileSync(join(factory, "paused"), "2026-11-13T00:00:00.000Z");
  let text = "";
  try { while (!/event: change\ndata: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value); } finally { ctl.abort(); }
  expect(text).toContain("/api/status");
  expect(await (await get("/api/status")).json()).toEqual({ tone: "warning" });
  expect(verdict(await (await get("/api/factory")).json()).tone).toBe("warning");
});
