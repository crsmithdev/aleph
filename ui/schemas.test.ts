import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMAS, check, epochs } from "./schemas.ts";
import { loadRoutes } from "./server.ts";

let base: string, proc: ReturnType<typeof Bun.spawn>, port: number;
const at = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-schemas-"));
  const build = Bun.spawnSync([process.execPath, join(import.meta.dir, "fixtures", "review", "build.ts"), join(base, "home")], { stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  const env: Record<string, string> = { ...process.env as Record<string, string>, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" };
  for (const l of build.stdout.toString().trim().split("\n")) env[l.slice(0, l.indexOf("="))] = l.slice(l.indexOf("=") + 1);
  proc = Bun.spawn([process.execPath, join(import.meta.dir, "server.ts"), "--port", "0"], { env: { ...env, HOME: join(base, "empty") }, stdout: "pipe", stderr: "ignore" });
  const line = new TextDecoder().decode((await (proc.stdout as ReadableStream<Uint8Array>).getReader().read()).value);
  port = Number(new URL(line.trim()).port);
});
afterAll(() => { proc.kill(); rmSync(base, { recursive: true, force: true }); });

test("every GET route has a schema, and every schema is a GET route", async () => {
  const gets = (await loadRoutes(join(import.meta.dir, "api"))).filter((r) => r.method === "GET").map((r) => r.path).sort();
  expect(Object.keys(SCHEMAS).sort()).toEqual(gets);
});

test("every route answers in its schema, or with { error } when it fails, and sends no epoch-ms time", async () => {
  const job = (await (await at("/api/jobs?window=month")).json() as any).jobs[0].id;
  const note = (await (await at("/api/memory")).json() as any).notes[0]?.title ?? "none";
  const args: Record<string, string> = { id: "demo-1", name: "x.png", file: "output.log", title: note, source: "memory", key: "MEMORY.md", project: "demo", n: "1" };
  const urls: Record<string, string> = { "/api/jobs/:id": `/api/jobs/${encodeURIComponent(job)}`, "/api/sessions/:id": "/api/sessions/s1", "/api/memory/search": "/api/memory/search?q=build" };
  const fits: string[] = [], bad: string[] = [];
  for (const [path, schema] of Object.entries(SCHEMAS)) {
    if (schema === "text") continue;
    const url = urls[path] ?? path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(args[k]));
    const res = await at(url), body = await res.json();
    bad.push(...[...check(res.ok ? schema : { error: "string" }, body), ...epochs(body)].map((b) => `${url} (${res.status}) ${b}`));
    if (res.ok) fits.push(path);
  }
  expect(bad).toEqual([]);
  // The fixture serves these in full; the Langfuse routes fail there, and their tests check them with a fake Langfuse.
  for (const p of ["/api/factory", "/api/automation", "/api/flow", "/api/issues", "/api/issues/:id", "/api/issues/:id/jobs", "/api/jobs", "/api/jobs/:id", "/api/projects", "/api/models", "/api/memory", "/api/memory/search"]) expect(fits).toContain(p);
});
