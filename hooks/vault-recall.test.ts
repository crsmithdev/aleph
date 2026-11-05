import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "vault-recall.ts");
const PROMPT = "how should the jev screen judge bounded calls?";
let dir: string;
let server: ReturnType<typeof Bun.serve>;
let asked: any[] = [];
let answer: (id: string) => number;
let status = 200;
let lf: ReturnType<typeof Bun.serve>;
let posts: any[] = [];

const note = (vault: string, title: string, claim: string) => {
  mkdirSync(join(vault, "wiki", "concepts"), { recursive: true });
  writeFileSync(join(vault, "wiki", "concepts", `${title}.md`), `---\nkind: concept\n---\n${claim}\n\nMore text.\n`);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-recall-"));
  note(dir, "Jev Screens Bounded Judgments", "Jev answers bounded questions before Haiku.");
  note(dir, "Koan Cases Are First Attested By The Jingde Record", "Koan collections cite the Jingde record.");
  note(dir, "Blog Posts Use The Writer's Voice", "Posts are written in the author's voice.");
  lf = Bun.serve({ port: 0, async fetch(req) { posts.push(await req.json()); return Response.json({}); } });
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      asked.push(body);
      if (status !== 200) return Response.json({ error: { message: "down" } }, { status });
      return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: answer(id) }])), usage: { cost: 0 } });
    },
  });
});
afterAll(() => { lf.stop(true); server.stop(true); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { posts = []; asked = []; status = 200; answer = () => 0.9; });

async function run(vault: string, prompt = PROMPT, env: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const p = Bun.spawn(["bun", HOOK], {
    stdin: new Blob([JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt, ...extra })]),
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, ALEPH_VAULT: vault, ALEPH_JUDGE_FILE: join(dir, "judge"), ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test", ALEPH_JUDGE: "jev", LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", ALEPH_SPOOL: join(dir, "spool"), ...env },
  });
  const out = await new Response(p.stdout).text();
  return { out, code: await p.exited };
}

test("no note above 0.7: no output", async () => {
  answer = () => 0.4;
  const r = await run(dir);
  expect(r).toEqual({ out: "", code: 0 });
  expect(asked.length).toBe(1);
});

test("with ALEPH_JUDGE=haiku: no output and Jev is not asked", async () => {
  expect(await run(dir, PROMPT, { ALEPH_JUDGE: "haiku" })).toEqual({ out: "", code: 0 });
  expect(asked).toEqual([]);
});

test("60 matching notes: at most 20 questions, at most 3 injected", async () => {
  const big = mkdtempSync(join(tmpdir(), "aleph-recall-big-"));
  for (let i = 0; i < 60; i++) note(big, `Jev Screen Number ${i}`, `Claim ${i}.`);
  const r = await run(big);
  rmSync(big, { recursive: true, force: true });
  expect(Object.keys(asked[0].questions).length).toBe(20);
  expect(JSON.parse(r.out).hookSpecificOutput.additionalContext.split("\n").length).toBe(4);
});

const spansOf = () => posts.flatMap((p) => p.resourceSpans.flatMap((r: any) => r.scopeSpans.flatMap((x: any) => x.spans)));
const meta = (sp: any) => Object.fromEntries(sp.attributes.filter((a: any) => a.key.startsWith("langfuse.observation.metadata.")).map((a: any) => [a.key.split(".").pop(), a.value.intValue !== undefined ? Number(a.value.intValue) : (a.value.boolValue ?? a.value.stringValue)]));
let n = 0;
const turn = () => ({ prompt_id: `p-${++n}`, session_id: `s-${n}` });

test("no matching note: a span with candidates 0 and no Jev request", async () => {
  const r = await run(dir, "completely unrelated zebra pasture grazing", {}, turn());
  expect(r.out).toBe("");
  expect(asked).toEqual([]);
  expect(meta(spansOf()[0])).toMatchObject({ candidates: 0, asked: 0, kept: 0, capped: false });
});

test("a failing Langfuse changes nothing the hook prints", async () => {
  const r = await run(dir, PROMPT, { LANGFUSE_BASE_URL: "http://127.0.0.1:1" }, turn());
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain("Jev Screens Bounded Judgments");
});

const injected = (out: string) => out ? JSON.parse(out).hookSpecificOutput.additionalContext : "";

test("a note whose words are only in its body is a candidate", async () => {
  const r = await run(dir, "what do those collections cite, then?", {}, turn());
  expect(Object.values(asked[0].questions).map((q: any) => q.instructions).join("\n")).toContain("Koan Cases Are First Attested");
  expect(injected(r.out)).toContain("Koan Cases Are First Attested");
});

test("a note injected once is not injected again in the same session", async () => {
  const t = turn();
  expect(injected((await run(dir, PROMPT, {}, t)).out)).toContain("Jev Screens Bounded Judgments");
  expect(injected((await run(dir, PROMPT, {}, { ...t, prompt_id: "again" })).out)).not.toContain("Jev Screens Bounded Judgments");
  expect(injected((await run(dir, PROMPT, {}, turn())).out)).toContain("Jev Screens Bounded Judgments");
});

test("a core note of the session's scope is not asked about: its line is already in the start context", async () => {
  const v = mkdtempSync(join(tmpdir(), "aleph-recall-core-"));
  note(v, "Jev Screens Bounded Judgments", "Jev answers bounded questions before Haiku.");
  mkdirSync(join(v, "wiki", "decisions"), { recursive: true });
  writeFileSync(join(v, "wiki", "decisions", "Jev Screen Is Always On.md"), "---\nkind: decision\nscope: global\ncore: Jev screens bounded calls\n---\nJev screen claim.\n");
  await run(v, PROMPT, {}, turn());
  rmSync(v, { recursive: true, force: true });
  const asked0 = Object.values(asked[0].questions).map((q: any) => q.instructions).join("\n");
  expect(asked0).toContain("Jev Screens Bounded Judgments");
  expect(asked0).not.toContain("Jev Screen Is Always On");
});
