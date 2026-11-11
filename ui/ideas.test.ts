import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../jobs/commands.ts";
import { add, drop, note } from "../ideas/ideas.ts";
import { withEnv, withServer } from "./test-server.ts";
// @ts-ignore ideas.js is plain JS, shared with the page
import { renderIdeas } from "./views/ideas.js";

// The fake lens agent: it writes result.md and ends as stream-json does, with the cost $FAKE_COST.
const FAKE = `#!/usr/bin/env bash
cat > /dev/null
echo "# found" > result.md
echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"s1","total_cost_usd":'$FAKE_COST'}'
`;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let base = "", at: (p: string, i?: RequestInit) => Promise<Response>, stop = () => {}, restore = () => {};
const json = async (p: string) => (await at(p)).json() as Promise<any>;
const lens = (slug: string, name: string, cost: string) => { process.env.FAKE_COST = cost; return run(["idea", "lens", slug, name], { stderr: () => {}, stdin: async () => "" }); };

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-ideas-"));
  writeFileSync(join(base, "claude"), FAKE);
  chmodSync(join(base, "claude"), 0o755);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ aleph: { path: base, code: "a" } }));
  restore = withEnv({ ALEPH_IDEAS: join(base, "ideas"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ISSUES: join(base, "issues"), ALEPH_LENS_CMD: join(base, "claude"), FAKE_COST: "0.5", ...gitEnv });
  add("Alpha", "sketch", "aleph");
  add("Beta", "sketch");
  add("Gamma", "sketch");
  drop("gamma");
  note("alpha", "? who pays");
  note("alpha", "decided yes");
  note("alpha", "? which repo");
  await lens("alpha", "prior-art", "0.5");
  await lens("alpha", "red-team", "0.25");
  const dir = join(base, "ideas", "alpha", "lenses");
  rmSync(dir, { recursive: true });
  mkdirSync(dir);
  writeFileSync(join(dir, "prior-art-2026-11-01-0900.html"), "<p>old</p>");
  writeFileSync(join(dir, "prior-art-2026-11-02-0900.md"), "newer");
  ({ at, stop } = await withServer({ warm: false }));
});
afterAll(() => { stop(); restore(); rmSync(base, { recursive: true, force: true }); });

test("the list has the exploring ideas with Spent and open questions, and ?status= picks another status", async () => {
  const rows = await json("/api/ideas");
  expect(rows.map((r: any) => r.slug)).toEqual(["alpha", "beta"]);
  expect(rows[0]).toMatchObject({ title: "Alpha", target: "aleph", status: "exploring", questions: 2, spent: 0.75 });
  expect(rows[0].lenses).toEqual(["prior-art"]);
  expect(rows[1]).toMatchObject({ questions: 0, spent: 0 });
  expect(rows[1].target).toBeUndefined();
  expect((await json("/api/ideas?status=dropped")).map((r: any) => r.slug)).toEqual(["gamma"]);
});

test("an idea lists its results newest first; a result file has a CSP with no network; a bad name is 404", async () => {
  const d = await json("/api/ideas/alpha");
  expect(d).toMatchObject({ title: "Alpha", writeup: "sketch" });
  expect(d.lenses.map((l: any) => l.file)).toEqual(["lenses/prior-art-2026-11-02-0900.md", "lenses/prior-art-2026-11-01-0900.html"]);
  const r = await at("/api/ideas/alpha/lenses/prior-art-2026-11-02-0900.md");
  expect(await r.text()).toBe("newer");
  expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
  for (const p of ["/api/ideas/alpha/lenses/..%2Fidea.md", "/api/ideas/alpha/lenses/nope.md", "/api/ideas/nope"]) expect((await at(p)).status).toBe(404);
});

test("POST refuses an unknown lens or idea, else starts the lens and answers at once", async () => {
  const post = (p: string) => at(p, { method: "POST", headers: { "X-Aleph-UI": "1" } });
  expect((await post("/api/ideas/alpha/lenses/nope")).status).toBe(422);
  expect((await post("/api/ideas/nope/lenses/prior-art")).status).toBe(422);
  const before = (await json("/api/ideas/alpha")).lenses.length;
  process.env.FAKE_COST = "0.1";
  expect((await post("/api/ideas/alpha/lenses/prior-art")).status).toBe(200);
  for (let i = 0; i < 5000 && (await json("/api/ideas/alpha")).lenses.length === before; i++);
  expect((await json("/api/ideas/alpha")).lenses).toHaveLength(before + 1);
}, 30000);

test("renderIdeas puts the Idea title first, with its link in each row's first cell", () => {
  const row = (slug: string, title: string) => ({ slug, title, last: "2026-01-02", status: "exploring", target: "aleph", lenses: [], questions: 1, spent: 0.5 });
  const h = renderIdeas([row("alpha", "Alpha"), row("beta", "Beta")], "exploring");
  expect(h).toContain("<tr><th>Idea</th><th>Last Change</th><th>Status</th><th>Target</th><th>Lenses</th><th class=\"num\">Open Questions</th><th class=\"num\">Spent</th></tr>");
  expect(h).toContain('<tr><td class="wide" title="Alpha"><a href="#/ideas/alpha">Alpha</a></td><td class="time">');
  expect(h).toContain('<tr><td class="wide" title="Beta"><a href="#/ideas/beta">Beta</a></td><td class="time">');
});
