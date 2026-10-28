import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add, setStatus } from "../todo/lib/todo.ts";
import { clearCache } from "./langfuse.ts";
import { routes, timeline } from "./api/timeline.ts";
// @ts-ignore plain JS, shared with the page
import { duration, mark, redirect, renderEvent, renderStream, renderTimeline, stripOption, view, mountTimeline } from "./views/timeline.js";

let base: string, jobsDir: string, fake: ReturnType<typeof Bun.serve>;
const saved: Record<string, string | undefined> = {};
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  // A fixed commit date: the wall clock can be later than `now` (23:00), which would hide the commit.
  const date = at(0, 12);
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const real = new Date();
const now = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 23, 0, 0);
const at = (daysAgo: number, hour = 10, min = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, min).toISOString();
const dayKey = (daysAgo: number) => at(daysAgo, 12).slice(0, 10) === "" ? "" : new Date(at(daysAgo, 12)).toLocaleDateString("sv");
function run(id: string, extra: Record<string, unknown>) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "agent", told: true, started: at(0), ...extra }));
}
const traces = [
  { id: "t1", sessionId: "s1", name: "fac", timestamp: at(2, 9), input: "fix the thing", totalCost: 0.5, metadata: { cwd: "/w/fac" } },
  { id: "t2", sessionId: "s2", name: "other", timestamp: at(2, 8), input: "other work", totalCost: 1, metadata: { cwd: "/w/other" } },
];

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-tl-"));
  jobsDir = join(base, "jobs");
  mkdirSync(jobsDir);
  const remote = join(base, "fac.git"), repo = join(base, "fac");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, repo);
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "first commit");
  sh(repo, "git", "push", "-q", "origin", "main");
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true, checks: [] }, other: { path: join(base, "none"), sandbox: true, checks: [] } }));
  const vault = join(base, "vault");
  mkdirSync(join(vault, "daily"), { recursive: true });
  const d3 = new Date(at(3, 12)).toLocaleDateString("sv");
  writeFileSync(join(vault, "daily", `${d3}.md`), "# daily\n- 14:30 wrote [[Some Note]]\n");
  fake = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/api/public/traces") return Response.json({ data: traces, meta: { totalPages: 1 } });
      return Response.json({ data: [], meta: { totalPages: 1 } });
    },
  });
  for (const [k, v] of Object.entries({
    ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items, ALEPH_VAULT: vault,
    LANGFUSE_BASE_URL: `http://127.0.0.1:${fake.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk",
  })) { saved[k] = process.env[k]; process.env[k] = v; }
  Object.assign(process.env, gitEnv);
  clearCache();

  process.env.GIT_COMMITTER_DATE = at(4);
  writeList({ key: "fac" }, "seed", (doc) => {
    add(doc, "an issue", { now: new Date(at(1)) });
    add(doc, "closed issue", { now: new Date(at(4)) });
    setStatus(doc.items[1], "done", new Date(at(1)));
    return true;
  }, true);
  delete process.env.GIT_COMMITTER_DATE;
  run("20261027-000001-a", { job: "fac-1", name: "fac-1", repo: "fac", state: "needs-you", started: at(0, 9), ended: at(0, 10) });
  run("20261027-000002-a", { job: "fac-2", name: "fac-2", repo: "fac", state: "running", started: at(0, 11) });
  run("20261027-000003-a", { job: "oth-1", name: "oth-1", repo: "other", state: "failed", started: at(1, 9), ended: at(1, 10) });
});
afterAll(() => {
  fake.stop(true);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

describe("timeline api", () => {
  test("the first page is the newest day, newest event first, with the strip", async () => {
    const t = await timeline({ now });
    expect(t.days).toHaveLength(1);
    expect(t.days[0].day).toBe(dayKey(0));
    const times = t.days[0].events.map((e) => e.at);
    expect(times).toEqual([...times].sort().reverse());
    expect(t.days[0].events.map((e) => [e.kind, e.what, e.title])).toContainEqual(["job", "started", "fac-2"]);
    expect(t.langfuse).toBe("ok");
    expect(t.strip!.length).toBeGreaterThan(0);
    expect(t.next).not.toBeNull();
  });

  test("before pages back one day at a time until the end", async () => {
    const seen: string[] = [];
    let p = await timeline({ now });
    seen.push(p.days[0].day);
    while (p.next) {
      p = await timeline({ now, before: p.next });
      expect(p.days).toHaveLength(1);
      expect(p.days[0].day < seen.at(-1)!).toBe(true);
      seen.push(p.days[0].day);
    }
    expect(seen).toContain(dayKey(1));
    expect(seen).toContain(dayKey(2));
    expect(seen).toContain(dayKey(3));
    expect(seen).toContain(dayKey(4));
  });

  test("each kind has its mark and link", async () => {
    const all = (await Promise.all([0, 1, 2, 3, 4].map(async (n) => (await timeline({ now, before: at(n, 23, 30) })).days[0]?.events ?? []))).flat();
    const find = (kind: string, what: string) => all.find((e) => e.kind === kind && e.what === what)!;
    expect(find("job", "started").href).toBe("#/jobs/fac-2");
    expect(find("job", "ended")).toMatchObject({ state: "needs-you", href: "#/jobs/fac-1" });
    expect(find("land", "landed")).toMatchObject({ title: "first commit", href: "#/projects/fac" });
    expect(find("issue", "opened").href).toMatch(/^#\/issues\/fac\/\d+$/);
    expect(find("issue", "closed").title).toContain("closed issue");
    expect(find("session", "started")).toMatchObject({ title: "fix the thing", href: "#/sessions/s1", cost: 0.5 });
    expect(find("note", "written")).toMatchObject({ title: "wrote [[Some Note]]", href: "#/memory/Some%20Note" });
    expect(mark(find("job", "ended")).tone).toBe("need");
    expect(mark(find("job", "started")).tone).toBe("run");
  });

  test("the project filter keeps one project", async () => {
    const t = await timeline({ now, project: "other", before: at(0, 23) });
    expect(t.days[0].events.map((e) => e.title)).toEqual(["oth-1", "oth-1"]);
    const s = await timeline({ now, project: "other" });
    expect(s.strip!.filter((i) => i.kind === "job")).toHaveLength(1);
    expect(s.strip!.filter((i) => i.kind === "session")).toHaveLength(1);
  });

  test("the strip lists items: jobs as bars, a running job with no end, the rest as points", async () => {
    const t = await timeline({ now });
    const n = (k: string) => t.strip!.filter((i) => i.kind === k).length;
    expect(n("job")).toBe(3);
    expect(n("session")).toBe(2);
    expect(n("note")).toBe(1);
    expect(t.strip!.some((i) => i.kind === "job" && i.name === "fac-1" && i.start === at(0, 9) && i.end === at(0, 10))).toBe(true);
    expect(t.strip!.find((i) => i.name === "fac-2")).toMatchObject({ kind: "job", end: null, day: dayKey(0) });
    expect(t.strip!.find((i) => i.kind === "note")!.end).toBeNull();
    const opt = stripOption(t.strip!, undefined, now.getTime());
    expect(opt.yAxis.data).toEqual(["Jobs", "Lands", "Issues", "Sessions", "Notes"]);
    const jobs = opt.series[0].data.filter((d: any) => d.value[6] === "job");
    const f1 = jobs.find((d: any) => d.name === "fac-1").value, f2 = jobs.find((d: any) => d.name === "fac-2").value;
    expect(f1[2] - f1[1]).toBe(3600_000);
    expect(f2[2]).toBe(now.getTime());
    const some = stripOption(t.strip!, ["job"], now.getTime());
    expect(some.yAxis.data).toEqual(["Jobs"]);
    expect(some.series[0].data.every((d: any) => d.value[6] === "job")).toBe(true);
  });

  test("the route validates before", async () => {
    const url = new URL("http://x/api/timeline?before=nope");
    expect((await routes["GET /api/timeline"](new Request(url), {}, url) as Response).status).toBe(400);
  });
});

describe("timeline view", () => {
  test("renders the stream table with one row per job, a running one included", async () => {
    const t = await timeline({ now });
    const html = renderTimeline(t);
    expect(html).toContain('id="tl-stream"');
    expect(html).toContain('href="#/jobs/fac-2"');
    expect(html).toContain('<span class="chip run">running</span>');
    expect(t.rows!.filter((r) => r.kind === "job" && r.title === "fac-1")).toHaveLength(1);
    expect(t.rows!.find((r) => r.title === "fac-1")).toMatchObject({ state: "needs-you", end: at(0, 10) });
    expect(view.path).toBe("/timeline");
    expect(typeof view.mount).toBe("function");
  });

  test("a job row has its chip, id link, plain title, cost and Details in their cells", () => {
    const h = renderEvent({ at: "2026-10-27T10:00:00", end: "2026-10-27T10:25:00", kind: "job", what: "started", state: "landed", id: "aleph-9", title: "Do it", href: "#/jobs/aleph-9", project: "aleph", cost: 1.5, details: [["took", "25m"], ["model", "opus"]] });
    for (const t of ['>job</span>', '<td class="num">25m</td>', '<td><a href="#/jobs/aleph-9">aleph-9</a></td>', '<td class="ttl">Do it</td>', '<td class="num">$1.50</td>', '<td class="det"><span class="k">took 25m</span><span class="k">model opus</span></td>']) expect(h).toContain(t);
    expect(h).not.toMatch(/[▷■⬆○✓✕◆✎]/);
    expect(h.match(/<a /g)).toHaveLength(1);
    expect(h).not.toContain("running");
  });

  test("a running job counts its duration to now", () => {
    const e = { at: "2026-10-27T10:00:00", kind: "job", what: "started", state: "running", title: "j", id: "j", href: "#/jobs/j" };
    expect(duration(e, Date.parse("2026-10-27T10:40:00"))).toBe("40m");
    expect(renderEvent(e, Date.parse("2026-10-27T11:05:00"))).toContain("1h05m");
    expect(renderEvent(e)).toContain("running");
  });

  test("the stream pages at 100 rows with Older and Newer", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ at: new Date(2026, 9, 27, 0, 0, 250 - i).toISOString(), kind: "note", what: "written", title: `n${i}`, href: "#/memory" }));
    const rowsIn = (h: string) => h.match(/class="evr"/g)?.length ?? 0;
    const p0 = renderStream(rows, 0), p1 = renderStream(rows, 1), p2 = renderStream(rows, 2);
    expect([rowsIn(p0), rowsIn(p1), rowsIn(p2)]).toEqual([100, 100, 50]);
    expect(p0).toContain(">Older</button>");
    expect(p0).toMatch(/data-page="-1" disabled/);
    expect(p2).toMatch(/data-page="3" disabled/);
    expect(p2).toContain("Page 3 of 3");
  });

  test("an issue row shows its labels; a row without cost has an empty cost cell", () => {
    const h = renderEvent({ at: "2026-10-26T00:00:00", kind: "issue", what: "opened", state: "open", title: "aleph-3 x", href: "#/issues/aleph/3", dateOnly: true, details: [["labels", "goal,ui"]] });
    expect(h).toContain("labels goal,ui");
    expect(h).toContain('<td class="num"></td><td class="det">');
  });

  test("the title is HTML-escaped", () => {
    const h = renderEvent({ at: "2026-10-27T10:00:00Z", kind: "job", what: "started", title: "Fix <it>", href: "#/jobs/x", details: [["model", "<b>"]] });
    expect(h).toContain("Fix &lt;it&gt;");
    expect(h).not.toContain("<it>");
    expect(h).toContain("model &lt;b&gt;");
  });

  test("the page has all five kinds checked, the strip, a header row and rows of several kinds", async () => {
    const t = await timeline({ now });
    const html = renderTimeline(t);
    expect(html.match(/<input type="checkbox" data-kind="\w+" checked>/g)).toHaveLength(5);
    expect(html).toContain('id="tl-strip"');
    expect(html.match(/<th>(\w+)<\/th>/g)!.join("")).toBe("<th>Time</th><th>Duration</th><th>Kind</th><th>Id</th><th>Title</th><th>Cost</th><th>Details</th>");
    const all = renderStream(t.rows!);
    expect(new Set(all.match(/data-kind="\w+"/g)).size).toBeGreaterThan(1);
  });

  test("the h1 is Activity", () => {
    expect(renderTimeline({ rows: [] })).toContain("<h1>Activity</h1>");
  });

  test("shift-click on a kind shows only that kind; again shows all; a plain click toggles", () => {
    const kinds = ["job", "land", "issue", "session", "note"];
    const rows = kinds.map((kind, i) => ({ at: new Date(2026, 9, 27, 10, i).toISOString(), kind, what: "x", title: kind, href: "#/x" }));
    const stream = { innerHTML: "", addEventListener() {}, querySelector() { return null; } };
    const boxes = kinds.map((kind) => ({ dataset: { kind }, checked: true }));
    let click: (ev: unknown) => void = () => {};
    const root = {
      querySelector: (q: string) => q === "#tl-stream" ? stream : q === ".kinds" ? { addEventListener: (_: string, f: typeof click) => { click = f; } } : null,
      querySelectorAll: () => boxes,
    };
    mountTimeline(root, { rows });
    const checked = () => boxes.filter((b) => b.checked).map((b) => b.dataset.kind);
    const shown = () => [...stream.innerHTML.matchAll(/<tr class="evr" data-kind="(\w+)"/g)].map((m) => m[1]);
    // The browser toggles the box before the click handlers run.
    const press = (kind: string, shiftKey: boolean) => { const b = boxes.find((x) => x.dataset.kind === kind)!; b.checked = !b.checked; click({ target: b, shiftKey }); };
    press("job", true);
    expect(checked()).toEqual(["job"]);
    expect(shown()).toEqual(["job"]);
    press("job", true);
    expect(checked()).toEqual(kinds);
    expect(shown().sort()).toEqual([...kinds].sort());
    press("land", false);
    expect(checked()).toEqual(kinds.filter((k) => k !== "land"));
    expect(shown()).not.toContain("land");
    press("land", false);
    expect(checked()).toEqual(kinds);
  });

  test("api events carry details, cost and state", async () => {
    const evs = (await timeline({ now })).days[0].events;
    const ended = evs.find((e) => e.kind === "job" && e.what === "ended")!;
    expect(ended).toMatchObject({ state: "needs-you", project: "fac", title: "fac-1" });
    expect(ended.details).toContainEqual(["took", "1h00m"]);
    const sess = (await timeline({ now, before: at(2, 23) })).days[0].events.find((e) => e.kind === "session")!;
    expect(sess.details).toContainEqual(["turns", "1"]);
  });
});

describe("issue events from the work store's git log", () => {
  const issueEvents = async () => (await timeline({ now, days: 30 })).rows!.filter((e) => e.kind === "issue");
  test("opened sits at the commit that added the item, closed at the last commit that changed it", async () => {
    const t0 = Date.now();
    writeList({ key: "fac" }, "open", (doc) => { add(doc, "fresh issue", { now: new Date() }); return true; });
    const t1 = Date.now();
    writeList({ key: "fac" }, "later", (doc) => { setStatus(doc.items.find((i) => i.title === "fresh issue")!, "done", new Date()); return true; });
    const evs = await issueEvents();
    const opened = evs.find((e) => e.what === "opened" && e.title === "fresh issue")!;
    const closed = evs.find((e) => e.what === "closed" && e.title === "fresh issue")!;
    expect(opened.dateOnly).toBeUndefined();
    expect(closed.dateOnly).toBeUndefined();
    expect(Math.abs(Date.parse(opened.at) - t0)).toBeLessThan(60_000);
    expect(Date.parse(closed.at)).toBeGreaterThanOrEqual(Math.floor(t1 / 1000) * 1000);
    expect(Date.parse(closed.at)).toBeGreaterThanOrEqual(Date.parse(opened.at));
    expect(Date.parse(closed.at) - Date.now()).toBeLessThan(2000);
  });
  test("git log runs once per repo, not once per item", async () => {
    writeList({ key: "fac" }, "many", (doc) => { for (let i = 0; i < 200; i++) add(doc, `bulk ${i}`, { now: new Date() }); return true; });
    const t = performance.now();
    const evs = await issueEvents();
    expect(performance.now() - t).toBeLessThan(1000);
    expect(evs.filter((e) => e.what === "opened").length).toBeGreaterThanOrEqual(200);
  });
});

describe("the List address", () => {
  test("#/list opens the Timeline and drops the List query", () => {
    expect(redirect("#/list")).toBe("#/timeline");
    expect(redirect("#/list?set=issues")).toBe("#/timeline");
    expect(redirect("#/list?set=jobs&project=aleph")).toBe("#/timeline?project=aleph");
    expect(redirect("#/timeline?set=x")).toBeNull();
    expect(redirect("#/listing")).toBeNull();
  });
  test("the view is Timeline at /timeline in the factory group, and no List view is left", () => {
    expect(view).toMatchObject({ path: "/timeline", title: "Activity", group: "factory", order: 1 });
    expect(existsSync(new URL("./views/list.js", import.meta.url).pathname)).toBe(false);
    expect(readFileSync(new URL("./index.html", import.meta.url), "utf8")).toContain("redirect");
  });
});
