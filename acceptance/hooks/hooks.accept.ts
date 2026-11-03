// Archived goal tests from hooks/hooks.test.ts: `bun run accept` runs them, `bun run test` does not.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchObservations } from "../../hooks/lib/otlp.ts";

const HOOKS = join(import.meta.dir, "../../hooks");

describe("dotenv", () => {

  test("langfuseConfig does not export ALEPH_UI_PASSWORD from ~/.aleph/.env", () => {
    const home = mkdtempSync(join(tmpdir(), "aleph-home-"));
    mkdirSync(join(home, ".aleph"));
    writeFileSync(join(home, ".aleph", ".env"), "ALEPH_UI_PASSWORD=secret\nLANGFUSE_PUBLIC_KEY=pk-file\nLANGFUSE_SECRET_KEY=sk-file\n");
    // a child process: langfuseConfig() reads the default path and writes process.env
    const env: Record<string, string | undefined> = { ...process.env, HOME: home };
    for (const key of ["ALEPH_UI_PASSWORD", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "ALEPH_ENV_FILE"]) delete env[key];
    const script = `import { langfuseConfig } from ${JSON.stringify(join(HOOKS, "lib", "env.ts"))};
const config = langfuseConfig();
console.log(JSON.stringify({ config, password: process.env.ALEPH_UI_PASSWORD ?? null }));`;
    const run = Bun.spawnSync([process.execPath, "-e", script], { env, stdout: "pipe", stderr: "pipe" });
    rmSync(home, { recursive: true, force: true });
    expect(run.stderr.toString()).toBe("");
    const out = JSON.parse(run.stdout.toString().trim());
    expect(out.config.publicKey).toBe("pk-file");
    expect(out.password).toBeNull();
  });
});

describe("fetchObservations", () => {
  function fake(failPage?: number, opts: { pages?: number; delay?: number; failOnce?: number } = {}) {
    const state = { open: 0, maxOpen: 0, seen: new Set<number>() };
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const page = Number(new URL(req.url).searchParams.get("page"));
        state.maxOpen = Math.max(state.maxOpen, ++state.open);
        await Bun.sleep(opts.delay ?? 100);
        state.open--;
        const again = state.seen.has(page);
        state.seen.add(page);
        if (page === opts.failOnce && !again) return new Response("boom", { status: 500 });
        if (page === failPage) return new Response("boom", { status: 500 });
        return Response.json({ data: [{ id: `o${page}a` }, { id: `o${page}b` }], meta: { page, totalPages: opts.pages ?? 4 } });
      },
    });
    const cfg: any = { baseUrl: `http://localhost:${server.port}`, publicKey: "pk", secretKey: "sk" };
    return { server, state, cfg };
  }

  test("returns all rows in page order", async () => {
    const { server, cfg } = fake();
    try {
      const rows = await fetchObservations(cfg, new Date(0), new Date());
      expect(rows.map((r: any) => r.id)).toEqual(["o1a", "o1b", "o2a", "o2b", "o3a", "o3b", "o4a", "o4b"]);
    } finally { server.stop(true); }
  });

  test("fetches pages 2..n concurrently", async () => {
    const { server, state, cfg } = fake();
    try {
      await fetchObservations(cfg, new Date(0), new Date());
      expect(state.maxOpen).toBeGreaterThanOrEqual(2);
      expect(state.maxOpen).toBeLessThanOrEqual(4);
    } finally { server.stop(true); }
  });

  test("the timeout is per request: a run longer than timeoutMs passes when each page is shorter", async () => {
    const { server, state, cfg } = fake(undefined, { pages: 21, delay: 150 });
    try {
      const t0 = Date.now();
      const rows = await fetchObservations(cfg, new Date(0), new Date(), 500);
      expect(Date.now() - t0).toBeGreaterThan(500);
      expect(state.maxOpen).toBeLessThanOrEqual(4);
      expect(rows.map((r: any) => r.id)).toEqual(Array.from({ length: 21 }, (_, i) => [`o${i + 1}a`, `o${i + 1}b`]).flat());
    } finally { server.stop(true); }
  });

  test("a page that fails once is tried again", async () => {
    const { server, cfg } = fake(undefined, { failOnce: 3 });
    try {
      const rows = await fetchObservations(cfg, new Date(0), new Date());
      expect(rows).toHaveLength(8);
    } finally { server.stop(true); }
  });
});

describe("obs hook text blocks", () => {
  test("Stop sends one text event per assistant text block, in order, and skips thinking", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aleph-txt-"));
    const transcript = join(dir, "t.jsonl");
    const a = (id: string, sec: number, block: any) => ({ type: "assistant", isSidechain: false, requestId: id, timestamp: `2026-09-03T10:00:0${sec}.000Z`, message: { role: "assistant", model: "claude-fable-5-1", usage: { input_tokens: 1, output_tokens: 1 }, content: [block] } });
    const result = (sec: number) => ({ type: "user", isSidechain: false, timestamp: `2026-09-03T10:00:0${sec}.000Z`, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } });
    const lines = [
      { type: "user", promptId: "pt", isSidechain: false, timestamp: "2026-09-03T10:00:00.000Z", message: { role: "user", content: "hi" } },
      a("r1", 1, { type: "thinking", thinking: "" }),
      a("r1", 1, { type: "text", text: "first" }),
      a("r1", 2, { type: "tool_use", id: "t", name: "Bash", input: {} }),
      result(3),
      a("r2", 4, { type: "text", text: "second" }),
      a("r2", 5, { type: "tool_use", id: "t", name: "Bash", input: {} }),
      result(6),
      a("r3", 7, { type: "text", text: "third" }),
    ];
    writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const posted: any[] = [];
    const server = Bun.serve({ port: 0, fetch: async (req) => { posted.push(await req.json()); return new Response("{}"); } });
    const spool = mkdtempSync(join(tmpdir(), "aleph-txt-spool-"));
    const proc = Bun.spawn(["bun", join(HOOKS, "obs.ts")], {
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: "s-txt", cwd: "/tmp/proj", hook_event_name: "Stop", prompt_id: "pt", transcript_path: transcript, last_assistant_message: "third" })),
      env: { ...process.env, LANGFUSE_BASE_URL: `http://127.0.0.1:${server.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", ALEPH_SPOOL: spool },
      stdout: "pipe", stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
    server.stop();
    const spans = posted[0].resourceSpans[0].scopeSpans[0].spans;
    const attr = (span: any, key: string) => span.attributes.find((x: any) => x.key === key)?.value?.stringValue;
    const turn = spans.find((s: any) => s.name === "turn");
    const texts = spans.filter((s: any) => s.name === "text");
    expect(texts.map((s: any) => attr(s, "langfuse.observation.output"))).toEqual(["first", "second", "third"]);
    expect(texts.map((s: any) => s.startTimeUnixNano)).toEqual([...texts.map((s: any) => s.startTimeUnixNano)].sort());
    for (const t of texts) expect(t.parentSpanId).toBe(turn.spanId);
    rmSync(dir, { recursive: true, force: true });
    rmSync(spool, { recursive: true, force: true });
  });
});

describe("a guard that cannot run denies", () => {
  async function run(script: string, stdin: string) {
    const proc = Bun.spawn(["bun", script], { stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    return { code, stderr: await new Response(proc.stderr).text() };
  }
  for (const name of ["git-guard", "secret-scan"]) {
    test(`${name}: throws after load -> exit 2, named on stderr`, async () => {
      const r = await run(join(HOOKS, `${name}.ts`), "not json");
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(name);
      expect(r.stderr).toContain("JSON");
    });
  }
});

describe("hooks.json runs each guard through sh, so a guard that cannot parse denies", () => {
  const hooksJson = JSON.parse(readFileSync(join(HOOKS, "hooks.json"), "utf8"));
  function entry(name: string): { command: string; args: string[] } {
    const all = Object.values(hooksJson.hooks).flat().flatMap((g: any) => g.hooks);
    const found = all.filter((h: any) => (h.args ?? []).some((a: string) => a.endsWith(`/hooks/${name}.ts`)));
    expect(found.length).toBe(1);
    return found[0];
  }
  /** Run the entry as hooks.json gives it, with the guard path pointed at `script`. */
  async function runEntry(name: string, script: string, stdin: string) {
    const { command, args } = entry(name);
    expect(command).toBe("sh");
    const argv = args.map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}/hooks/" + name + ".ts", script));
    const proc = Bun.spawn([command, ...argv], { stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
  }
  for (const name of ["git-guard", "secret-scan"]) {
    test(`${name}: a missing guard file -> exit 2, named on stderr`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "aleph-missing-"));
      try {
        const r = await runEntry(name, join(dir, `${name}.ts`), "{}");
        expect(r.code).toBe(2);
        expect(r.stderr).toContain(`${name}.ts`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
