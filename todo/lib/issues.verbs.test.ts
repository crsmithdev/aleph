import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Refusal } from "../../jobs/lib/refusal.ts";
import { loadRegistry } from "../../jobs/lib/ledger.ts";
import { breakItem, doc, env, fx, parse, remoteItem, sec, seed, sh, tasks, useFixture } from "../fixture.ts";
import { config } from "./store.ts";
import { renderItem } from "./todo.ts";
import * as verbs from "./issues.ts";

setDefaultTimeout(30000);

// The verbs of `aleph issue`, called in-process as jobs/cli.ts calls them, under the CLI's environment.
// todo/cli.test.ts keeps the CLI test of each verb's wiring.
useFixture();
let saved: Record<string, string | undefined> = {};
beforeEach(() => { saved = { ...process.env }; Object.assign(process.env, env()); });
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

const proj = () => loadRegistry().proj!;
/** The verb's value with the exit code the CLI would give: 1 for a refusal. */
async function code<T>(f: () => T | Promise<T>): Promise<{ code: number; value?: T }> {
  try { return { code: 0, value: await f() }; } catch (e) { if (!(e instanceof Refusal)) throw e; return { code: 1 }; }
}
const add = async (title: string, fields: verbs.Fields = {}) => { verbs.checkFields(fields); return verbs.add(proj(), title, fields); };
const list = (o: { status?: string; label?: string } = {}) => verbs.list(proj(), o).map(verbs.brief(proj().key));
const show = (id: number) => { const i = verbs.show(proj(), id); return { ...verbs.brief(proj().key)(i), request: i.request, spec: i.spec, notes: i.notes }; };
/** The lines `aleph issue lint` prints on stderr, and its exit code. */
function lint(): { code: number; err: string } {
  try {
    const l = verbs.lint(proj());
    return { code: l.findings.length ? 1 : 0, err: l.findings.map((f) => `item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`).join("\n") };
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    return { code: 1, err: e.message };
  }
}

test("a write from a store clone that is behind lands on top of main and keeps main's change", async () => {
  const other = join(fx.base, "other");
  sh(fx.base, "git", "clone", "-q", fx.remote, other);
  writeFileSync(join(other, "readme.txt"), "x\n");
  sh(other, "git", "add", "readme.txt");
  sh(other, "git", "commit", "-qm", "readme");
  sh(other, "git", "push", "-q", "origin", "main");
  expect((await code(() => add("After the readme"))).code).toBe(0);
  expect(sh(fx.base, "git", "--git-dir", fx.remote, "log", "--format=%s", "-2", "main")).toBe("proj: todo: add an item\nreadme");
  expect(existsSync(join(fx.items, "readme.txt"))).toBe(true);
});

test("a write with a changed file in the store's checkout still reaches main, and says the checkout did not follow", async () => {
  writeFileSync(join(fx.items, tasks, "proj-3.md"), "local edit\n");
  const a = await code(() => add("Despite the edit"));
  expect(a.code).toBe(0);
  expect(remoteItem(4)).toContain("Despite the edit");
  expect(a.value!.follow).toContain(`main checkout not updated: it has changes in ${tasks}/proj-3.md`);
  expect(doc(3)).toBe("local edit\n");
});

test("add allocates the next id and list shows it", async () => {
  const a = await code(() => add("Teach the gate to count"));
  expect(a.code).toBe(0);
  expect(a.value!.result.added).toBe(4);
  const rows = list();
  expect(rows.map((r: any) => r.id)).toEqual([3, 4]);
  expect(rows[1]).toMatchObject({ status: "open", priority: "medium", source: "chris", areas: [] });
  expect(rows[1]).not.toHaveProperty("labels");
});

test("a title that YAML would misread is quoted in the file and comes back exactly", async () => {
  const title = '`/play` says "done" \\ then # drops it';
  expect((await code(() => add(title))).code).toBe(0);
  expect(remoteItem(4)).toContain(`title: ${JSON.stringify(title)}\n`);
  expect(show(4).title).toBe(title);
});

test("labels filter, and a flag value never lands in the title", async () => {
  await add("Audio thing", { labels: ["audio", "phone"], priority: "high" });
  await add("Other thing", { labels: ["build"] });
  const rows = list();
  expect(rows.map((r: any) => r.title)).toEqual(["An old item", "Audio thing", "Other thing"]);
  expect(rows[1]).toMatchObject({ priority: "high", areas: ["audio", "phone"] });
  expect(list({ label: "audio" }).map((r: any) => r.id)).toEqual([4]);
});

test("lint refuses an unknown status and a duplicate id, and --fix cannot save it", () => {
  seed(`# To do\n\n## 8. One\n---\nid: 8\nstatus: maybe\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nA.\n\n## 8. Two\n---\nid: 8\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nB.\n`);
  const r = lint();
  expect(r.code).toBe(1);
  expect(r.err).toContain('closed_as "maybe" is not done or dropped');
  expect(r.err).toContain("2 items share id 8");
  // `--fix` exits 1 when findings remain.
  expect(verbs.lintFix(proj()).result.remaining.length).toBeGreaterThan(0);
});

test("add takes a body of several lines", async () => {
  // The CLI reads it from stdin with `--request -` and trims it.
  expect((await code(() => add("Count at the gate", { request: "Why it matters.\n\nDone when the gate counts.\n".trim() }))).code).toBe(0);
  expect(show(4).request).toBe("Why it matters.\n\nDone when the gate counts.");
  expect(remoteItem(4)).toContain("---\n<!-- request -->\nWhy it matters.\n\nDone when the gate counts.");
});

test("park: the reason is a note, closed_as stays unset, list shows parked and --status parked filters", async () => {
  await add("Needs a look");
  const p = await code(() => verbs.edit(proj(), 4, { status: "parked" }, "needs more investigation"));
  expect(p.code).toBe(0);
  expect(p.value!.result.status).toBe("parked");
  expect(doc(4)).not.toContain("closed_as");
  expect(doc(4)).toContain("needs more investigation");
  const ids = (o: { status?: string } = {}) => list(o).map((r: any) => r.id);
  expect(ids()).toEqual([3, 4]);
  expect(ids({ status: "parked" })).toEqual([4]);
});

test("lint refuses a labels field and a waiting_on field and names the item", async () => {
  await add("Broken");
  breakItem("labels: [ui]\nwaiting_on: proj-1");
  const l = lint();
  expect(l.code).toBe(1);
  expect(l.err).toContain("item 4: labels is retired");
  expect(l.err).toContain("item 4: waiting_on is retired");
});

test("aleph issue lint reads a dotted goal file and names it by its dotted id", () => {
  const parent = parse("# To do\n\n## 5. Parent\n---\nid: 5\nstatus: open\ncreated: 2026-09-01\nupdated: 2026-09-01\n---\n\nBody.\n").items[0];
  parent.fm.kind = "task";
  const goal = { ...parent, sub: 1, title: "Goal", fm: { ...parent.fm, id: "5.1" } };
  const put = (due?: string) => {
    seed(null);
    mkdirSync(join(fx.items, tasks), { recursive: true });
    writeFileSync(join(fx.items, "proj", "backlog", "config.yml"), config("proj"));
    writeFileSync(join(fx.items, tasks, "proj-5.md"), renderItem("proj", parent));
    const g = due ? { ...goal, fm: { ...goal.fm, created: due } } : goal;
    writeFileSync(join(fx.items, tasks, "proj-5.1.md"), renderItem("proj", g));
    sh(fx.items, "git", "add", "-A");
    sh(fx.items, "git", "commit", "-qm", "dotted");
    sh(fx.items, "git", "push", "-q", "origin", "main");
  };
  put("soon");
  const bad = lint();
  expect(bad.code).toBe(1);
  expect(bad.err).toContain('item 5.1: created "soon"');
  expect(bad.err).not.toContain("share id 5");
  expect(bad.err).not.toContain("id says 5.1");
  put();
  const ok = lint();
  expect(ok.err).toBe("");
  expect(ok.code).toBe(0);
});

test("lint refuses an after ref that is not <repo>-<n>[.<k>]", () => {
  seed(`# To do\n\n${sec(20, "kind: goal\nafter: [proj-1.2]\nlabels: []")}\n${sec(21, "kind: goal\nafter: [proj-x]\nlabels: []")}`);
  const r = lint();
  expect(r.code).toBe(1);
  expect(r.err).toContain("after: proj-x");
  expect(r.err).not.toContain("proj-1.2");
});

test("add and edit refuse a title over 60 characters, with a final period or with ': ', and write no commit", async () => {
  const head = () => sh(fx.base, "git", "--git-dir", fx.remote, "rev-parse", "main");
  const before = head();
  for (const t of ["x".repeat(61), "Fix it.", "Check foo: bar"]) {
    expect((await code(() => add(t))).code).toBe(1);
    expect((await code(() => verbs.edit(proj(), 3, { title: t }))).code).toBe(1);
  }
  expect(head()).toBe(before);
});
