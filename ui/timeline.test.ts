import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add, note, setStatus } from "../todo/lib/todo.ts";
import { routes, timeline } from "./api/timeline.ts";
// @ts-ignore plain JS, shared with the page
import { cancelTarget, contentsText, duration, mark, mountTimeline, nextSort, redirect, renderEvent, renderStream, renderTimeline, sortRows, stamp, stripOption, statusOf, subtypeOf, view } from "./views/timeline.js";

let base: string, jobsDir: string;
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
  for (const [k, v] of Object.entries({
    ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items, ALEPH_VAULT: vault,
  })) { saved[k] = process.env[k]; process.env[k] = v; }
  Object.assign(process.env, gitEnv);

  process.env.GIT_COMMITTER_DATE = at(4);
  writeList({ key: "fac" }, "seed", (doc) => {
    add(doc, "an issue", { now: new Date(at(1)) });
    add(doc, "closed issue", { now: new Date(at(4)) });
    setStatus(doc.items[1], "done", new Date(at(1)));
    note(doc.items[0], "triage: for Chris: which way?", new Date(at(1, 11)));
    note(doc.items[0], "Chris decided: go left", new Date(at(1, 12)));
    note(doc.items[0], "Claude decided: go right", new Date(at(1, 13)));
    note(doc.items[0], "a plain note", new Date(at(1, 14)));
    return true;
  }, true);
  delete process.env.GIT_COMMITTER_DATE;
  run("20261027-000001-a", { job: "fac-1", name: "fac-1", repo: "fac", state: "needs-you", started: at(0, 9), ended: at(0, 10) });
  run("20261027-000002-a", { job: "fac-2", name: "fac-2", repo: "fac", state: "running", started: at(0, 11) });
  run("20261027-000003-a", { job: "oth-1", name: "oth-1", repo: "other", state: "failed", started: at(1, 9), ended: at(1, 10) });
});
afterAll(() => {
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
    expect(seen).toContain(dayKey(3));
    expect(seen).toContain(dayKey(4));
  });

  test("each kind has its mark and link", async () => {
    const all = (await Promise.all([0, 1, 2, 3, 4].map(async (n) => (await timeline({ now, before: at(n, 23, 30) })).days[0]?.events ?? []))).flat();
    const find = (kind: string, what: string) => all.find((e) => e.kind === kind && e.what === what)!;
    expect(find("job", "started").href).toBe("#/jobs/fac-2");
    expect(find("job", "held")).toMatchObject({ state: "needs-you", href: "#/jobs/fac-1" });
    expect(find("job", "failed")).toMatchObject({ state: "failed", href: "#/jobs/oth-1" });
    expect(find("land", "landed")).toMatchObject({ title: "first commit", href: "#/projects/fac" });
    expect(find("issue", "opened").href).toMatch(/^#\/issues\/fac\/\d+$/);
    expect(find("issue", "closed").title).toContain("closed issue");
    expect(all.some((e: any) => e.kind === "session")).toBe(false);
    expect(find("note", "noted")).toMatchObject({ title: "wrote [[Some Note]]", href: "#/memory/Some%20Note" });
    expect(mark(find("job", "held")).tone).toBe("need");
    expect(mark(find("job", "started")).tone).toBe("run");
  });

  test("the project filter keeps one project", async () => {
    const t = await timeline({ now, project: "other", before: at(0, 23) });
    expect(t.days[0].events.map((e) => e.title)).toEqual(["oth-1", "oth-1"]);
    const s = await timeline({ now, project: "other" });
    expect(s.strip!.filter((i) => i.kind === "job")).toHaveLength(1);
  });

  test("the strip lists items: jobs as bars, a running job with no end, the rest as points", async () => {
    const t = await timeline({ now });
    const n = (k: string) => t.strip!.filter((i) => i.kind === k).length;
    expect(n("job")).toBe(3);
    expect(n("session")).toBe(0);
    expect(n("note")).toBe(1);
    expect(t.strip!.some((i) => i.kind === "job" && i.name === "fac-1" && i.start === at(0, 9) && i.end === at(0, 10))).toBe(true);
    expect(t.strip!.find((i) => i.name === "fac-2")).toMatchObject({ kind: "job", end: null, day: dayKey(0) });
    expect(t.strip!.find((i) => i.kind === "note")!.end).toBeNull();
    const opt = stripOption(t.strip!, undefined, now.getTime());
    expect(opt.series.map((x: any) => x.name)).toEqual(["Jobs", "Lands", "Issues", "Notes"]);
    for (const x of opt.series) expect(x).toMatchObject({ type: "line", stack: "events" }), expect(x.areaStyle).toBeDefined();
    expect(opt.xAxis.data).toHaveLength(30);
    expect(opt.xAxis.data.at(-1)).toBe(dayKey(0));
    const series = (n: string) => opt.series.find((x: any) => x.name === n).data;
    expect(series("Jobs").reduce((a: number, b: number) => a + b, 0)).toBe(3);
    expect(series("Jobs").at(-1)).toBe(2);
  });

  test("hiding a kind removes its series", async () => {
    const t = await timeline({ now });
    const some = stripOption(t.strip!, ["job", "note"], now.getTime());
    expect(some.series.map((x: any) => x.name)).toEqual(["Jobs", "Notes"]);
    expect(stripOption(t.strip!, [], now.getTime()).series).toEqual([]);
  });

  test("the route validates before", async () => {
    const url = new URL("http://x/api/timeline?before=nope");
    expect((await routes["GET /api/timeline"](new Request(url), {}, url) as Response).status).toBe(400);
  });
});

describe("timeline view", () => {
  test("renders the stream table with one row per event, a running job's start included", async () => {
    const t = await timeline({ now });
    const html = renderTimeline(t);
    expect(html).toContain('id="tl-stream"');
    expect(html).toContain('href="#/jobs/fac-2"');
    expect(html).toContain('<span class="badge run">started</span>');
    expect(t.rows!.filter((r) => r.kind === "job" && r.title === "fac-1").map((r) => r.what).sort()).toEqual(["held", "started"]);
    expect(t.rows!.find((r) => r.title === "fac-1" && r.what === "held")).toMatchObject({ state: "needs-you", at: at(0, 10) });
    expect(t.rows!.filter((r) => r.title === "fac-2").map((r) => r.what)).toEqual(["started"]);
    expect(view.path).toBe("/timeline");
    expect(typeof view.mount).toBe("function");
  });

  test("each row has the eight columns, in order", async () => {
    const t = await timeline({ now });
    const html = renderStream(t.rows!, 0, now.getTime());
    for (const kind of ["job", "land", "issue", "note"]) {
      expect(html).toMatch(new RegExp(`<tr class="evr" data-kind="${kind}">(<td class="c-[a-z]+"[^>]*>.*?</td>){8}</tr>`));
    }
    const row = renderEvent(t.rows!.find((r: any) => r.kind === "job")!);
    expect([...row.matchAll(/<td class="(c-\w+)"/g)].map((m) => m[1])).toEqual(["c-time", "c-status", "c-type", "c-sub", "c-id", "c-title", "c-con", "c-act"]);
  });

  test("time is MM/DD HH:MM, or the day alone", () => {
    expect(stamp({ at: new Date(2026, 9, 7, 9, 5).toISOString() })).toBe("10/07 09:05");
    expect(stamp({ at: new Date(2026, 9, 7, 9, 5).toISOString(), dateOnly: true })).toBe("10/07");
  });

  test("a job's end row has the verb as its badge, type, subtype, id link, title and contents", () => {
    const h = renderEvent({ at: "2026-10-27T10:25:00", kind: "job", what: "landed", state: "landed", sub: "agent", id: "aleph-9", title: "Do it", href: "#/jobs/aleph-9", project: "aleph", cost: 1.5, details: [["took", "25m"], ["model", "opus"]] });
    for (const t of ['<span class="badge done">landed</span>', '<td class="c-type">job</td>', '<td class="c-sub">agent</td>', '<a class="id" href="#/jobs/aleph-9">aleph-9</a>', '<td class="c-title">Do it</td>', "Took</span> 25m", "Cost</span> $1.50", "Model</span> opus", "Project</span> aleph"]) expect(h).toContain(t);
    expect(h.match(/<a /g)).toHaveLength(1);
    expect(h).not.toContain("running");
  });

  test("the status is the event's verb, not the thing's state", () => {
    const e = { kind: "job", title: "j", at: "2026-10-27T10:00:00" };
    expect(statusOf({ ...e, what: "started", state: "running" })).toEqual({ text: "started", tone: "run" });
    for (const [what, state] of [["passed", "done"], ["held", "needs-you"], ["landed", "landed"], ["dropped", "dropped"], ["failed", "failed"], ["stuck", "stuck"]]) expect(statusOf({ ...e, what, state }).text).toBe(what);
    expect(["opened", "triaged", "decided", "closed", "dropped"].map((what) => statusOf({ kind: "issue", what, state: "open" }).text)).toEqual(["opened", "triaged", "decided", "closed", "dropped"]);
    expect(statusOf({ kind: "note", what: "noted" }).text).toBe("noted");
    expect(renderEvent({ ...e, what: "started", state: "running", id: "j", href: "#/jobs/j" })).toContain('<span class="badge run">started</span>');
  });

  test("contents is one line, with its full text in the title", () => {
    const e = { at: "2026-10-26T00:00:00", kind: "issue", what: "opened", state: "open", title: "t", id: "aleph-3", href: "#/issues/aleph/3", project: "aleph", details: [["labels", "followup,goal"], ["notes", "2"]] };
    expect(contentsText(e)).toBe("Project aleph · Labels followup, goal · Notes 2");
    const h = renderEvent(e);
    expect(h).toContain('<td class="c-con" title="Project aleph · Labels followup, goal · Notes 2">');
    expect(h).not.toContain("c2");
    expect(h).not.toContain("<br");
    expect(renderTimeline({ rows: [] })).toContain("text-overflow: ellipsis");
  });

  test("the title takes the width left, and the X is an icon button in the last cell", () => {
    const css = renderTimeline({ rows: [] });
    expect(css).toMatch(/\.c-title \{ width: 100%/);
    expect(css).not.toContain("table-layout: fixed");
    expect(css).toContain(".cancel:hover");
    expect(css).toContain(".cancel:focus-visible");
    const h = renderEvent({ at: at(0), kind: "job", what: "started", state: "running", title: "j", id: "j", href: "#/jobs/j" });
    expect(h).toMatch(/<td class="c-act"><button type="button" class="cancel" data-cancel [^>]*><svg [^>]*>.*<\/svg><\/button>/);
    // every row has the cell, with or without a button
    expect(renderEvent({ at: at(0), kind: "note", what: "noted", title: "n", href: "#/memory" })).toMatch(/<td class="c-act"><span class="cmsg"/);
  });

  test("an issue has opened, triaged and decided rows from its timestamped notes", async () => {
    const t = await timeline({ now, days: 30 });
    const mine = t.rows!.filter((e) => e.kind === "issue" && e.title === "an issue");
    expect(mine.map((e) => e.what).sort()).toEqual(["decided", "decided", "opened", "triaged"]);
    expect(mine.find((e) => e.what === "triaged")!.at).toBe(new Date(at(1, 11)).toISOString());
    expect(mine.filter((e) => e.what === "decided").map((e) => e.at).sort()).toEqual([new Date(at(1, 12)).toISOString(), new Date(at(1, 13)).toISOString()]);
    // a decided row has no X; the issue is still open, so its opened row has
    expect(renderStream(t.rows!, 0, now.getTime(), 1000)).toMatch(/data-cancel/);
    expect(renderEvent(mine.find((e) => e.what === "triaged")!)).not.toContain("data-cancel");
    expect(renderStream(mine.filter((e) => e.what !== "opened"), 0, now.getTime())).not.toContain("data-cancel");
  });

  test("subtypes", () => {
    expect(subtypeOf({ kind: "job", sub: "land" })).toBe("land");
    expect(subtypeOf({ kind: "issue", what: "closed" })).toBe("closed");
    expect(subtypeOf({ kind: "note" })).toBe("daily");
  });

  test("a running job counts its duration to now", () => {
    const e = { at: "2026-10-27T10:00:00", kind: "job", what: "started", state: "running", title: "j", id: "j", href: "#/jobs/j" };
    expect(duration(e, Date.parse("2026-10-27T10:40:00"))).toBe("40m");
    expect(renderEvent(e, Date.parse("2026-10-27T11:05:00"))).toContain("1h05m");
    expect(renderEvent(e)).toContain(">started<");
  });

  test("the stream pages at 100 rows with Older and Newer", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ at: new Date(2026, 9, 27, 0, 0, 250 - i).toISOString(), kind: "note", what: "noted", title: `n${i}`, href: "#/memory" }));
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
    expect(h).toContain("Labels</span> goal, ui");
    expect(h).toContain('<td class="c-time">10/26</td>');
    expect(h).not.toContain("Cost");
  });

  test("the title is HTML-escaped", () => {
    const h = renderEvent({ at: "2026-10-27T10:00:00Z", kind: "job", what: "started", title: "Fix <it>", href: "#/jobs/x", details: [["model", "<b>"]] });
    expect(h).toContain("Fix &lt;it&gt;");
    expect(h).not.toContain("<it>");
    expect(h).toContain("Model</span> &lt;b&gt;");
  });

  test("the page has all four kinds checked, the strip, a header row and rows of several kinds", async () => {
    const t = await timeline({ now });
    const html = renderTimeline(t);
    expect(html.match(/<input type="checkbox" data-kind="\w+" checked>/g)).toHaveLength(4);
    expect(html).not.toContain("Sessions");
    expect(html).toContain('id="tl-strip"');
    expect([...html.matchAll(/<th class="c-\w+"[^>]*>(?:<button[^>]*>)?(\w*)/g)].map((m) => m[1])).toEqual(["Time", "Status", "Type", "Subtype", "Id", "Title", "Contents", ""]);
    const all = renderStream(t.rows!, 0, now.getTime(), 1000);
    expect(new Set(all.match(/data-kind="\w+"/g)).size).toBeGreaterThan(1);
  });

  test("the h1 is Activity", () => {
    expect(renderTimeline({ rows: [] })).toContain("<h1>Activity</h1>");
  });

  test("shift-click on a kind shows only that kind; again shows all; a plain click toggles", () => {
    const kinds = ["job", "land", "issue", "note"];
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
    const ended = evs.find((e) => e.kind === "job" && e.what === "held")!;
    expect(ended).toMatchObject({ state: "needs-you", project: "fac", title: "fac-1" });
    expect(ended.details).toContainEqual(["took", "1h00m"]);
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
  test("#/list opens the Timeline and drops the whole query, project too", () => {
    expect(redirect("#/list")).toBe("#/timeline");
    expect(redirect("#/list?set=issues")).toBe("#/timeline");
    expect(redirect("#/list?set=jobs&project=aleph")).toBe("#/timeline");
    expect(redirect("#/timeline?set=x")).toBeNull();
    expect(redirect("#/listing")).toBeNull();
  });
  test("the view is Timeline at /timeline in the factory group, and no List view is left", () => {
    expect(view).toMatchObject({ path: "/timeline", title: "Activity", group: "factory", order: 1 });
    expect(existsSync(new URL("./views/list.js", import.meta.url).pathname)).toBe(false);
    expect(readFileSync(new URL("./index.html", import.meta.url), "utf8")).toContain("redirect");
  });
});

describe("sorting", () => {
  const rows = [
    { at: "2026-10-27T10:00:00", kind: "note", what: "written", title: "b", href: "#/x" },
    { at: "2026-10-27T12:00:00", kind: "job", what: "started", state: "running", title: "a", id: "j2", href: "#/x" },
    { at: "2026-10-27T11:00:00", kind: "issue", what: "opened", state: "open", title: "c", id: "x-3", href: "#/x" },
  ];
  const titles = (r: any[]) => r.map((e) => e.title).join("");
  test("default is Time, newest first; a second click reverses; the header shows it", () => {
    expect(titles(sortRows(rows))).toBe("acb");
    expect(titles(sortRows(rows, { key: "time", dir: 1 }))).toBe("bca");
    expect(nextSort({ key: "time", dir: -1 }, "time")).toEqual({ key: "time", dir: 1 });
    expect(nextSort({ key: "time", dir: -1 }, "title")).toEqual({ key: "title", dir: 1 });
    expect(renderStream(rows)).toContain('aria-sort="descending"><button type="button" data-sort="time">Time ▼');
    expect(renderStream(rows, 0, Date.now(), 100, { key: "title", dir: 1 })).toContain('aria-sort="ascending"><button type="button" data-sort="title">Title ▲');
    expect(renderStream(rows)).not.toContain('data-sort="con"');
  });
  test("each sortable key orders the rows", () => {
    expect(titles(sortRows(rows, { key: "type", dir: 1 }))).toBe("cab");
    expect(titles(sortRows(rows, { key: "title", dir: -1 }))).toBe("cba");
    expect(titles(sortRows(rows, { key: "id", dir: 1 }))).toBe("bac");
  });
  test("clicking a header redraws sorted; a second click reverses", () => {
    const stream: any = { innerHTML: "", addEventListener(_: string, f: any) { this.h = f; } };
    mountTimeline({ querySelector: (q: string) => (q === "#tl-stream" ? stream : null), querySelectorAll: () => [] } as any, { rows });
    const order = () => [...stream.innerHTML.matchAll(/class="c-title">(\w)</g)].map((m) => m[1]).join("");
    const click = (key: string) => stream.h({ target: { closest: (s: string) => (s.includes("data-sort") ? { dataset: { sort: key } } : null) } });
    click("title"); expect(order()).toBe("abc");
    click("title"); expect(order()).toBe("cba");
  });
});

describe("Cancel controls", () => {
  const base = { at: at(0), end: undefined, details: [] };
  const job = { ...base, kind: "job", what: "started", state: "running", title: "fac-9", id: "fac-9", href: "#/jobs/fac-9" };
  const landed = { ...base, kind: "job", what: "landed", state: "landed", title: "fac-8", id: "fac-8", href: "#/jobs/fac-8" };
  const open = { ...base, kind: "issue", what: "opened", state: "open", title: "t", id: "fac-3", href: "#/issues/fac/3" };
  const done = { ...base, kind: "issue", what: "closed", state: "done", title: "t", id: "fac-2", href: "#/issues/fac/2" };

  test("a running job and an open issue have the X; a landed job and a done issue have an empty cell", () => {
    expect(renderEvent(job)).toContain("data-cancel");
    expect(renderEvent(open)).toContain("data-cancel");
    expect(renderEvent(landed)).not.toContain("data-cancel");
    expect(renderEvent(done)).not.toContain("data-cancel");
    // the opened row of an issue that was since closed gets none either
    expect(renderStream([done, { ...open, href: done.href }])).not.toContain("data-cancel");
    expect(cancelTarget(job)!.url).toBe("/api/drop/fac-9");
    expect(cancelTarget(open)!.url).toBe("/api/issues/fac/3/drop");
  });

  function click(rows: any[], respond: () => Response) {
    const sent: { url: string; init: any }[] = [];
    const calls: string[] = [];
    const real = { fetch: globalThis.fetch, confirm: (globalThis as any).confirm, alert: (globalThis as any).alert };
    (globalThis as any).fetch = async (url: string, init: any) => { sent.push({ url, init }); return respond(); };
    (globalThis as any).confirm = () => { calls.push("confirm"); return true; };
    (globalThis as any).alert = () => { calls.push("alert"); };
    const classes = new Set<string>();
    const msg: any = { textContent: "", className: "cmsg" };
    const btn: any = { dataset: {}, textContent: "✕", disabled: false, isConnected: true, remove() {}, classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } };
    const tr: any = { querySelector: () => msg, set outerHTML(h: string) { tr.html = h; }, html: "" };
    btn.closest = () => tr;
    let handler: any;
    const stream: any = { innerHTML: "", addEventListener: (_: string, h: any) => { handler = h; }, querySelectorAll: () => [tr] };
    const root: any = { querySelector: (sel: string) => (sel === "#tl-stream" ? stream : null), querySelectorAll: () => [] };
    mountTimeline(root, { rows, now: new Date().toISOString() });
    const ev = { target: { closest: (sel: string) => (sel.includes("data-cancel") ? btn : null) } };
    const restore = () => Object.assign(globalThis, real);
    return { sent, calls, btn, msg, tr, classes, press: () => handler(ev), restore };
  }

  test("one click arms and sends nothing; a second sends one request; no dialog", async () => {
    const c = click([job], () => Response.json({ code: 0, stdout: "{}", stderr: "" }));
    try {
      await c.press();
      expect(c.classes.has("arm")).toBe(true);
      expect(c.sent).toHaveLength(0);
      await c.press();
      expect(c.sent).toHaveLength(1);
      expect(c.sent[0].url).toBe("/api/drop/fac-9");
      expect(JSON.parse(c.sent[0].init.body).reason).toBe("cancelled from the Activity page");
      expect(c.tr.html).not.toContain("data-cancel");
      expect(c.tr.html).toContain("dropped");
      expect(c.calls).toEqual([]);
    } finally { c.restore(); }
  });

  test("an issue's Cancel posts to the issue route and a failure shows the server's error", async () => {
    const c = click([open], () => Response.json({ error: "no such issue" }, { status: 404 }));
    try {
      await c.press(); await c.press();
      expect(c.sent.map((x) => x.url)).toEqual(["/api/issues/fac/3/drop"]);
      expect(c.msg.textContent).toBe("no such issue");
      expect(c.classes.has("arm")).toBe(false);
    } finally { c.restore(); }
  });
});
