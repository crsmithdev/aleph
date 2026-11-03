import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { state as handWritten } from "./fixtures/status-state.ts";

let base: string, proc: ReturnType<typeof Bun.spawn>, port: number;
const get = async (p: string) => (await fetch(`http://127.0.0.1:${port}${p}`)).json() as Promise<any>;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-fixture-"));
  const build = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "review", "build.ts"), join(base, "home")], { stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  const env: Record<string, string> = { ...process.env as Record<string, string>, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" };
  for (const l of build.stdout.toString().trim().split("\n")) env[l.slice(0, l.indexOf("="))] = l.slice(l.indexOf("=") + 1);
  proc = Bun.spawn([process.execPath, join(import.meta.dir, "server.ts"), "--port", "0"], { env: { ...env, HOME: join(base, "empty") }, stdout: "pipe", stderr: "ignore" });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const line = new TextDecoder().decode((await reader.read()).value);
  port = Number(new URL(line.trim()).port);
});
afterAll(() => { proc.kill(); rmSync(base, { recursive: true, force: true }); });

test("the hand-written Status state has only keys that /api/state really sends", async () => {
  const real = await get("/api/state");
  const extra = (mine: object, theirs: object) => Object.keys(mine).filter((k) => !(k in theirs));
  expect(extra(handWritten, real)).toEqual([]);
  expect(extra(handWritten.factory, real.factory)).toEqual([]);
});
