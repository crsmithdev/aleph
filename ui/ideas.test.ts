import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../jobs/commands.ts";
import { add, drop, note } from "../ideas/ideas.ts";
import { withEnv, withServer } from "./test-server.ts";
// @ts-ignore plain JS, shared with the page
import { chips, count, empty, error, filterBar, loadingLine, repoIdLink, searchBox, statusRow, when } from "./lib.js";
// @ts-ignore
import { renderKpis } from "./timeline.js";
// @ts-ignore
import { ideaView, renderIdea, renderIdeas } from "./views/ideas.js";

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
  // An idea of its own: the lens adds a result and a cost that the other tests do not expect.
  add("Delta", "sketch");
  try {
    process.env.FAKE_COST = "0.1";
    expect((await post("/api/ideas/delta/lenses/prior-art")).status).toBe(200);
    for (let i = 0; i < 5000 && (await json("/api/ideas/delta")).lenses.length === 0; i++);
    expect((await json("/api/ideas/delta")).lenses).toHaveLength(1);
  } finally { rmSync(join(base, "ideas", "delta"), { recursive: true, force: true }); }
}, 30000);

test("a .md lens result loads behind loadingLine(), and a failed fetch puts error() in the pane", async () => {
  const d = { slug: "alpha", title: "Alpha", status: "exploring", writeup: "", log: [], running: [], lenses: [{ lens: "prior-art", file: "lenses/p.md", at: "2026-11-02 09:00" }] };
  const h = renderIdea(d);
  expect(h).toContain(`<div class="md" data-src="/api/ideas/alpha/lenses/p.md">${loadingLine("the result")}</div>`);
  const el: any = { dataset: { src: "/x.md" }, innerHTML: "" }, was = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 404, text: async () => "nope" })) as any;
  try {
    ideaView.mount({ querySelectorAll: () => [el], querySelector: () => ({ addEventListener() {} }) } as any, d);
    await new Promise((r) => setTimeout(r, 0));
  } finally { globalThis.fetch = was; }
  expect(el.innerHTML).toBe(error("/x.md answered 404"));
});

const row = (slug: string, title: string) => ({ slug, title, last: "2026-01-02", status: "exploring", target: "aleph", lenses: [], questions: 1234, spent: 0.5 });

test("renderIdeas rows are rowlink rows with the link in the wide cell, Updated through when() and the count through count()", () => {
  const h = renderIdeas([row("alpha", "Alpha"), row("beta", "Beta")], "exploring");
  expect(h).toContain("<tr><th>Idea</th><th>Status</th><th>Target</th><th>Lenses</th><th class=\"num\">Open Questions</th><th class=\"num\">Spent</th><th class=\"num\">Updated</th></tr>");
  expect(h).toContain('<tr class="rowlink"><td class="wide" title="Alpha"><a href="#/ideas/alpha">Alpha</a></td><td>');
  expect(h).toContain('<tr class="rowlink"><td class="wide" title="Beta"><a href="#/ideas/beta">Beta</a></td><td>');
  expect(h).toContain(`<td class="num">${count(1234)}</td>`);
  expect(h).toContain(`<td class="time">${when("2026-01-02T00:00")}</td>`);
});

test("renderIdeas puts searchBox() before the filter bar, both inside the Ideas card, and empty() when no row shows", () => {
  const h = renderIdeas([row("alpha", "Alpha")], "exploring", "");
  const filter = filterBar([{ label: "Status", name: "status", options: ["exploring", "built", "dropped"], value: "exploring" }]);
  const box = searchBox("ideas-search", "", "Search titles and targets");
  expect(h.indexOf(box)).toBeGreaterThan(h.indexOf('<section class="card'));
  expect(h.indexOf(box) + box.length).toBe(h.indexOf(filter));
  expect(h.indexOf(filter)).toBeLessThan(h.indexOf("</section>"));
  expect(renderIdeas([], "built")).toContain(empty("No built ideas.", "Add one with <code>aleph idea add</code>."));
  const none = renderIdeas([row("alpha", "Alpha")], "exploring", "zzz");
  expect(none).toContain(empty("No exploring ideas.", "Add one with <code>aleph idea add</code>."));
  expect(none).toContain('value="zzz"');
});

test("renderIdea draws an empty log with empty(), built issues with repoIdLink(), a statusRow() and the renderKpis() strip", () => {
  const d = { slug: "alpha", title: "Alpha", status: "exploring", target: "aleph", writeup: "", log: [], running: [], built: ["aleph-12"], lenses: [{ lens: "prior-art", file: "lenses/p.html", at: "2026-11-02 09:00" }, { lens: "prior-art", file: "lenses/o.html", at: "2026-11-01 09:00" }] };
  const h = renderIdea(d);
  expect(h).toContain(empty("No log yet.", "Add a line with <code>aleph idea note</code>."));
  expect(h).toContain(repoIdLink("aleph-12", "#/issues/aleph/12"));
  expect(h).toContain(statusRow('<span class="badge run">exploring</span>', "", chips(["aleph"])));
  expect(h).toContain(renderKpis([{ k: "Results", v: "2" }, { k: "Running", v: "0" }, { k: "Built", v: repoIdLink("aleph-12", "#/issues/aleph/12"), text: true }]));
  expect(h).toContain('<h3 class="sub-head">Older Results</h3><div class="list"><a href="/api/ideas/alpha/lenses/o.html" target="_blank">');
  expect(h).toContain('11/01 09:00</a></div><button class="act" type="button" data-lens="prior-art">Queue job</button>');
});

test("a queue that fails says the act name, then failed:, then the reason", async () => {
  const d = { slug: "alpha", title: "Alpha", status: "exploring", writeup: "", log: [], running: [], lenses: [] };
  const msg: any = { textContent: "" }, btn: any = { dataset: { lens: "prior-art" }, parentElement: { querySelector: () => msg } };
  const root: any = { querySelectorAll: () => [], querySelector: () => ({ addEventListener() {} }) }, was = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 422, text: async () => JSON.stringify({ error: "no lens named x" }) })) as any;
  try {
    ideaView.mount(root, d);
    await root.onclick({ target: { closest: (sel: string) => (sel === "button[data-lens]" ? btn : null) } });
  } finally { globalThis.fetch = was; }
  expect(msg.textContent).toBe("Queue job failed: no lens named x");
});
