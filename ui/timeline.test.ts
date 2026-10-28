import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add, note, setStatus } from "../todo/lib/todo.ts";
import { routes, timeline } from "./api/timeline.ts";
// @ts-ignore plain JS, shared with the page
import { cancelTarget, contentsText, duration, idText, kindsHash, mark, mountTimeline, nextSort, parseKinds, pickKind, redirect, renderEvent, renderMore, renderStream, rowKey, parseOpen, renderTimeline, sortRows, stamp, stripOption, statusOf, view } from "./views/timeline.js";

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
  for (const [k, v] of Object.entries({
    ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items, ALEPH_VAULT: vault,
  })) { saved[k] = process.env[k]; process.env[k] = v; }
  Object.assign(process.env, gitEnv);

  process.env.GIT_COMMITTER_DATE = at(4);
  writeList({ key: "fac" }, "seed", (doc) => {
    add(doc, "an issue", { now: new Date(at(1)), labels: ["goal"] });
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
  run("20261027-000005-a", { job: "fac-5", name: "fac-5", kind: "triage", repo: "fac", state: "done", started: at(0, 8), ended: at(0, 8, 5) });
  run("20261027-000004-a", { job: "fac-3", name: "fac-3", repo: "fac", todo: 1, state: "done", started: at(1, 15), ended: at(1, 16) });
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

describe("timeline api", () => {
  test("the first page leaves out days and carries strip items of kind and day only", async () => {
    const t = await timeline({ now });
    expect(t.days).toBeUndefined();
    expect(Object.keys(t.strip![0]).sort()).toEqual(["day", "kind"]);
  });

  test("the newest day, newest event first", async () => {
    const t = await timeline({ now, before: new Date(now.getTime() + 1).toISOString() });
    expect(t.days).toHaveLength(1);
    expect(t.days![0].day).toBe(dayKey(0));
    const times = t.days![0].events.map((e) => e.at);
    expect(times).toEqual([...times].sort().reverse());
    expect(t.days![0].events.map((e) => [e.kind, e.what, e.title])).toContainEqual(["job", "started", "fac-2"]);
    expect(t.next).not.toBeNull();
  });

  test("before pages back one day at a time until the end", async () => {
    const seen: string[] = [];
    let p = await timeline({ now, before: new Date(now.getTime() + 1).toISOString() });
    seen.push(p.days![0].day);
    while (p.next) {
      p = await timeline({ now, before: p.next });
      expect(p.days).toHaveLength(1);
      expect(p.days![0].day < seen.at(-1)!).toBe(true);
      seen.push(p.days![0].day);
    }
    expect(seen).toContain(dayKey(1));
    expect(seen).toContain(dayKey(4));
  });

  test("each kind has its mark and link", async () => {
    const all = (await Promise.all([0, 1, 2, 3, 4].map(async (n) => (await timeline({ now, before: at(n, 23, 30) })).days![0]?.events ?? []))).flat();
    const find = (kind: string, what: string) => all.find((e) => e.kind === kind && e.what === what)!;
    expect(find("job", "started").href).toBe("#/jobs/fac-2");
    expect(find("job", "held")).toMatchObject({ state: "needs-you", href: "#/jobs/fac-1" });
    expect(find("job", "failed")).toMatchObject({ state: "failed", href: "#/jobs/oth-1" });
    expect(find("land", "landed")).toMatchObject({ title: "first commit", href: "#/projects/fac" });
    expect(find("issue", "opened").href).toMatch(/^#\/issues\/fac\/\d+$/);
    expect(find("issue", "closed").title).toContain("closed issue");
    expect(all.some((e: any) => e.kind === "session")).toBe(false);
    expect(all.some((e: any) => e.kind === "note")).toBe(false);
    expect(mark(find("job", "held")).tone).toBe("need");
    expect(mark(find("job", "started")).tone).toBe("run");
  });

  test("job rows show the goal's title and run kind, lands how they came, issues labels and notes; triage runs and notes are gone", async () => {
    const rows = (await timeline({ now, days: 30 })).rows!;
    expect(rows.filter((e) => e.kind === "job" && e.id === "fac-3").map((e) => [e.title, e.sub])).toEqual([["an issue", "agent"], ["an issue", "agent"]]);
    expect(rows.find((e) => e.id === "fac-1")!.title).toBe("fac-1");
    expect(rows.some((e) => e.id === "fac-5")).toBe(false);
    expect(rows.some((e) => (e.kind as string) === "note")).toBe(false);
    expect(rows.find((e) => e.kind === "land" && e.title === "first commit")).toMatchObject({ sub: "direct", project: "fac" });
    expect(rows.find((e) => e.kind === "issue" && e.title === "an issue")!.details).toContainEqual(["labels", "goal"]);
    expect(rows.find((e) => e.kind === "issue" && e.title === "an issue")!.details).toContainEqual(["notes", "4"]);
    expect(rows.every((e) => e.project)).toBe(true);
  });

  test("the project filter keeps one project", async () => {
    const t = await timeline({ now, project: "other", before: at(0, 23) });
    expect(t.days![0].events.map((e) => e.title)).toEqual(["oth-1", "oth-1"]);
    const s = await timeline({ now, project: "other" });
    expect(s.strip!.filter((i) => i.kind === "job")).toHaveLength(1);
  });

  test("the strip lists items: jobs as bars, a running job with no end, the rest as points", async () => {
    const t = await timeline({ now });
    const n = (k: string) => t.strip!.filter((i) => i.kind === k).length;
    expect(n("job")).toBe(4);
    expect(n("session")).toBe(0);
    expect(n("note")).toBe(0);
    expect(t.strip!.filter((i) => i.kind === "job" && i.day === dayKey(0))).toHaveLength(2);
    const opt = stripOption(t.strip!, undefined, now.getTime());
    expect(opt.series.map((x: any) => x.name)).toEqual(["Jobs", "Lands", "Issues"]);
    for (const x of opt.series) expect(x).toMatchObject({ type: "line", stack: "events" }), expect(x.areaStyle).toBeDefined();
    expect(opt.xAxis.data).toHaveLength(30);
    expect(opt.xAxis.data.at(-1)).toBe(dayKey(0));
    const series = (n: string) => opt.series.find((x: any) => x.name === n).data;
    expect(series("Jobs").reduce((a: number, b: number) => a + b, 0)).toBe(4);
    expect(series("Jobs").at(-1)).toBe(2);
  });

  test("hiding a kind removes its series", async () => {
    const t = await timeline({ now });
    const some = stripOption(t.strip!, ["job", "issue"], now.getTime());
    expect(some.series.map((x: any) => x.name)).toEqual(["Jobs", "Issues"]);
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

  test("each row has the eight columns, in order, with a Project and no Subtype", async () => {
    const t = await timeline({ now });
    const html = renderStream(t.rows!, 1000, now.getTime());
    for (const kind of ["job", "land", "issue"]) {
      expect(html).toMatch(new RegExp(`<tr class="evr" data-kind="${kind}"[^>]*>(<td class="c-[a-z]+[^"]*"[^>]*>.*?</td>){8}</tr>`));
    }
    const row = renderEvent(t.rows!.find((r: any) => r.kind === "job")!);
    expect([...row.matchAll(/<td class="(c-\w+)/g)].map((m) => m[1])).toEqual(["c-id", "c-title", "c-status", "c-type", "c-project", "c-con", "c-time", "c-act"]);
  });

  test("time is the shared when (Oct 07 09:05), or the day alone", () => {
    const y = new Date().getFullYear();
    expect(stamp({ at: new Date(y, 9, 7, 9, 5).toISOString() })).toBe("Oct 07 09:05");
    expect(stamp({ at: new Date(y, 9, 7, 9, 5).toISOString(), dateOnly: true })).toBe("Oct 07");
  });

  test("a job's end row has the verb as its badge, type, project, #id link, title and contents of run kind, model, cost, took", () => {
    const h = renderEvent({ at: "2026-10-27T10:25:00", kind: "job", what: "landed", state: "landed", sub: "agent", id: "aleph-9", title: "Do it", href: "#/jobs/aleph-9", project: "aleph", cost: 1.5, details: [["took", "25m"], ["model", "opus"]] });
    for (const t of ['<span class="badge done">landed</span>', '<td class="c-type">job</td>', '<td class="c-project">aleph</td>', '<a class="idl" href="#/jobs/aleph-9">aleph-9</a>', '<td class="c-title wide" title="Do it">Do it</td>']) expect(h).toContain(t);
    expect(contentsText({ kind: "job", sub: "agent", cost: 1.5, details: [["took", "25m"], ["model", "opus"]] })).toBe("run: agent  model: opus  cost: $1.50  took: 25m");
    expect(h).not.toContain("Project");
    expect(h).not.toContain("Cost");
    expect(h.match(/<a /g)).toHaveLength(1);
  });

  test("ids are the full id, a sha stays a sha", () => {
    expect(idText({ kind: "issue", id: "aleph-247" })).toBe("aleph-247");
    expect(idText({ kind: "job", id: "fac-1" })).toBe("fac-1");
    expect(idText({ kind: "land", id: "abc1234" })).toBe("abc1234");
    expect(renderEvent({ at: "2026-10-27T10:00:00", kind: "land", what: "landed", state: "landed", title: "t", id: "abc1234", href: "#/projects/fac", project: "fac", sub: "direct", details: [["commit", "abc1234"]] })).toContain('href="#/projects/fac">abc1234</a>');
  });

  test("a land's contents are its commit and by hand or direct; an issue's are label chips and the note count", () => {
    expect(contentsText({ kind: "land", sub: "by hand", commit: "abcdef0123", details: [["took", "5m"], ["model", "m"], ["commit", "abcdef0"]] })).toBe("commit: abcdef0  landed: by hand");
    expect(contentsText({ kind: "land", sub: "direct", details: [["commit", "abc1234"]] })).toBe("commit: abc1234  landed: direct");
    expect(contentsText({ kind: "land", details: [["commit", "abc1234"]] })).toBe("commit: abc1234");
    const h = renderEvent({ at: "2026-10-26T00:00:00", kind: "issue", what: "opened", state: "open", title: "t", id: "aleph-3", href: "#/issues/aleph/3", project: "aleph", details: [["labels", "followup,goal"], ["notes", "2"]] });
    expect(h).toContain('<span class="chips"><span class="chip">followup</span><span class="chip">factory</span></span>');
    expect(h).toContain('<span><b class="k">notes:</b> 2</span>');
    expect(h).toContain('<b class="k">labels:</b> <span class="chips"><span class="chip">followup</span>');
    expect(h).not.toContain("Labels");
  });

  test("contents are key: value pairs with a bold key, separated by space, no dot", () => {
    const h = renderEvent({ at: "2026-10-27T10:25:00", kind: "job", what: "passed", state: "done", sub: "agent", id: "a-9", title: "t", href: "#/jobs/a-9", cost: 0.42, details: [["took", "3m"], ["model", "opus"]] });
    expect(h).toContain('<b class="k">run:</b> agent</span> <span><b class="k">model:</b> opus</span> <span><b class="k">cost:</b> $0.42</span> <span><b class="k">took:</b> 3m</span>');
    expect(h).not.toContain("·");
    expect(h).not.toContain("sep");
    expect(renderTimeline({ rows: [] })).not.toContain(".sep");
    expect(renderTimeline({ rows: [] })).toMatch(/\.k \{ color: var\(--muted\)/);
  });

  describe("expanding rows", () => {
    const job = { at: "2026-10-27T10:25:00", kind: "job", what: "held", state: "needs-you", sub: "agent", id: "a-9", title: "t", href: "#/jobs/a-9", cost: 1.5, details: [["state", "needs-you"], ["reason", "held path"], ["took", "3m"], ["branch", "factory/a-9"], ["folder", "a-9-x"]] };
    const issue = { at: "2026-10-26T10:00:00", kind: "issue", what: "opened", state: "open", id: "a-3", title: "x".repeat(70), href: "#/issues/a/3", details: [["status", "open"], ["labels", "goal"], ["waiting on", "a-2"], ["last note", "did it"]] };

    test("the extra row lists every detail as key: value, the long title, and a link to the page", () => {
      const h = renderMore(job, Date.now());
      for (const t of ['<td colspan="8">', '<b class="k">reason:</b> held path', '<b class="k">branch:</b> factory/a-9', '<b class="k">folder:</b> a-9-x', '<b class="k">cost:</b> $1.50', '<b class="k">run:</b> agent', 'href="#/jobs/a-9"']) expect(h).toContain(t);
      const i = renderMore(issue, Date.now());
      for (const t of ['<b class="k">waiting on:</b> a-2', '<b class="k">last note:</b> did it', '<b class="k">labels:</b> factory', `<b class="k">title:</b> ${issue.title}`, 'href="#/issues/a/3"']) expect(i).toContain(t);
      expect(renderMore(job, 0)).not.toContain('class="k">title:');
    });

    test("only rows in the open set get an extra row", () => {
      expect(renderStream([job, issue])).not.toContain('class="more"');
      const h = renderStream([job, issue], 50, Date.now(), undefined, new Set([rowKey(job)]));
      expect(h.match(/<tr class="more"/g)).toHaveLength(1);
      expect(h).toContain('aria-expanded="true"');
      expect(h).toContain('aria-expanded="false"');
    });

    test("the open rows live in the hash, next to the kinds", () => {
      const k = rowKey(job);
      const hash = kindsHash(new Set(["job", "land", "issue"]), new Set([k]));
      expect(hash.startsWith("#/timeline?open=")).toBe(true);
      expect(parseOpen(new URLSearchParams(hash.split("?")[1])).has(k)).toBe(true);
      expect(kindsHash(new Set(["job"]), new Set([k]))).toContain("kinds=job&open=");
      expect(kindsHash(new Set(["job", "land", "issue"]))).toBe("#/timeline");
      expect(renderTimeline({ rows: [job] }, new URLSearchParams(hash.split("?")[1]))).toContain('<tr class="more"');
    });

    function mount(query?: URLSearchParams) {
      const stream: any = { innerHTML: "", addEventListener(_: string, f: any) { this.h = f; } };
      const keys: any = {};
      (globalThis as any).document = { addEventListener: (_: string, f: any) => { keys.f = f; }, removeEventListener() {} };
      mountTimeline({ querySelector: (q: string) => (q === "#tl-stream" ? stream : null), querySelectorAll: () => [] } as any, { rows: [job, issue] }, query ?? new URLSearchParams());
      const rowEl = () => ({ dataset: { key: rowKey(job) } });
      const click = (hit: string | null) => stream.h({ target: { closest: (s: string) => (hit && s.includes(hit) ? rowEl() : null) } });
      return { stream, keys, click };
    }
    const extra = (s: any) => s.innerHTML.match(/<tr class="more"/g)?.length ?? 0;

    test("a click on a row opens its extra row, a second click or Escape closes it", () => {
      const m = mount();
      try {
        m.click("tr.evr"); expect(extra(m.stream)).toBe(1);
        m.click("tr.evr"); expect(extra(m.stream)).toBe(0);
        m.click("tr.evr"); expect(extra(m.stream)).toBe(1);
        m.keys.f({ key: "a" }); expect(extra(m.stream)).toBe(1);
        m.keys.f({ key: "Escape" }); expect(extra(m.stream)).toBe(0);
      } finally { delete (globalThis as any).document; }
    });

    test("a click on a link or button inside the row does not expand it; a reload keeps open rows", () => {
      const m = mount();
      try {
        m.stream.h({ target: { closest: (s: string) => (s === "a, button" ? {} : null) } });
        expect(extra(m.stream)).toBe(0);
        const again = mount(new URLSearchParams({ open: rowKey(job) }));
        // the hash had it open, so a click closes it (the stream is drawn by render, not by mount)
        again.click("tr.evr"); expect(extra(again.stream)).toBe(0);
      } finally { delete (globalThis as any).document; }
    });
  });

  test("the status is the event's verb, not the thing's state", () => {
    const e = { kind: "job", title: "j", at: "2026-10-27T10:00:00" };
    expect(statusOf({ ...e, what: "started", state: "running" })).toEqual({ text: "started", tone: "run" });
    for (const [what, state] of [["passed", "done"], ["held", "needs-you"], ["landed", "landed"], ["dropped", "dropped"], ["failed", "failed"], ["stuck", "stuck"]]) expect(statusOf({ ...e, what, state }).text).toBe(what);
    expect(["opened", "triaged", "decided", "closed", "dropped"].map((what) => statusOf({ kind: "issue", what, state: "open" }).text)).toEqual(["opened", "triaged", "decided", "closed", "dropped"]);
    expect(renderEvent({ ...e, what: "started", state: "running", id: "j", href: "#/jobs/j" })).toContain('<span class="badge run">started</span>');
  });

  test("contents is one line, with its full text in the title", () => {
    const e = { at: "2026-10-26T00:00:00", kind: "issue", what: "opened", state: "open", title: "t", id: "aleph-3", href: "#/issues/aleph/3", project: "aleph", details: [["labels", "followup,goal"], ["notes", "2"]] };
    expect(contentsText(e)).toBe("labels: followup factory  notes: 2");
    const h = renderEvent(e);
    expect(h).toContain('<td class="c-con" title="labels: followup factory  notes: 2">');
    expect(h).not.toContain("<br");
    expect(renderTimeline({ rows: [] })).toContain("text-overflow: ellipsis");
  });

  test("the title is the shared wide cell, and the X is an icon button in the last cell", () => {
    const css = renderTimeline({ rows: [] });
    expect(css).not.toMatch(/\.c-title \{ width: 100%/);
    expect(renderEvent({ at: at(0), kind: "job", what: "x", title: "j" })).toContain('class="c-title wide"');
    expect(css).not.toContain("table-layout: fixed");
    expect(css).toContain(".cancel:hover");
    expect(css).toContain(".cancel:focus-visible");
    const h = renderEvent({ at: at(0), kind: "job", what: "started", state: "running", title: "j", id: "j", href: "#/jobs/j" });
    expect(h).toMatch(/<td class="c-act"><button type="button" class="cancel" data-cancel [^>]*><svg [^>]*>.*<\/svg><\/button>/);
    // every row has the cell, with or without a button
    expect(renderEvent({ at: at(0), kind: "issue", what: "triaged", title: "n", href: "#/issues/a/1" })).toMatch(/<td class="c-act"><span class="cmsg"/);
  });

  test("an issue has opened, triaged and decided rows from its timestamped notes", async () => {
    const t = await timeline({ now, days: 30 });
    const mine = t.rows!.filter((e) => e.kind === "issue" && e.title === "an issue");
    expect(mine.map((e) => e.what).sort()).toEqual(["decided", "decided", "opened", "triaged"]);
    expect(mine.find((e) => e.what === "triaged")!.at).toBe(new Date(at(1, 11)).toISOString());
    expect(mine.filter((e) => e.what === "decided").map((e) => e.at).sort()).toEqual([new Date(at(1, 12)).toISOString(), new Date(at(1, 13)).toISOString()]);
    // a decided row has no X; the issue is still open, so its opened row has
    expect(renderStream(t.rows!, 1000, now.getTime())).toMatch(/data-cancel/);
    expect(renderEvent(mine.find((e) => e.what === "triaged")!)).not.toContain("data-cancel");
    expect(renderStream(mine.filter((e) => e.what !== "opened"), 1000, now.getTime())).not.toContain("data-cancel");
  });

  test("a running job counts its duration to now", () => {
    const e = { at: "2026-10-27T10:00:00", kind: "job", what: "started", state: "running", title: "j", id: "j", href: "#/jobs/j" };
    expect(duration(e, Date.parse("2026-10-27T10:40:00"))).toBe("40m");
    expect(renderEvent(e, Date.parse("2026-10-27T11:05:00"))).toContain("1h05m");
    expect(renderEvent(e)).toContain(">started<");
  });

  test("the stream shows 50 rows and the shared pager, Show 50 more", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ at: new Date(2026, 9, 27, 0, 0, 250 - i).toISOString(), kind: "issue", what: "opened", title: `n${i}`, href: "#/issues/a/1" }));
    const rowsIn = (h: string) => h.match(/class="evr"/g)?.length ?? 0;
    const p0 = renderStream(rows), p1 = renderStream(rows, 100), p2 = renderStream(rows, 150);
    expect([rowsIn(p0), rowsIn(p1), rowsIn(p2)]).toEqual([50, 100, 120]);
    expect(p0).toContain('data-more="50">Show 50 more</button>');
    expect(p0).toContain("50 of 120");
    expect(p1).toContain('data-more="20"');
    expect(p2).not.toContain("data-more");
    expect(p2).toContain("120 of 120");
  });

  test("an issue row without cost has an empty cost cell and a day-only time", () => {
    const h = renderEvent({ at: "2026-10-26T00:00:00", kind: "issue", what: "opened", state: "open", title: "aleph-3 x", href: "#/issues/aleph/3", dateOnly: true, details: [["labels", "goal,ui"]] });
    expect(h).toContain('<td class="c-time time">Oct 26</td>');
    expect(h).not.toContain("$");
  });

  test("the title is HTML-escaped", () => {
    const h = renderEvent({ at: "2026-10-27T10:00:00Z", kind: "job", what: "started", title: "Fix <it>", href: "#/jobs/x", details: [["model", "<b>"]] });
    expect(h).toContain("Fix &lt;it&gt;");
    expect(h).not.toContain("<it>");
    expect(h).toContain("&lt;b&gt;");
  });

  test("the page has the segmented kind control, the strip, a header row and rows of several kinds", async () => {
    const t = await timeline({ now });
    const html = renderTimeline(t);
    expect(html).not.toContain('type="checkbox"');
    expect([...html.matchAll(/<button type="button" data-value="(\w+)" aria-pressed="(\w+)">(\w+)</g)].map((m) => m.slice(1).join(":"))).toEqual(["all:true:All", "job:false:Jobs", "land:false:Lands", "issue:false:Issues"]);
    expect(html).toContain('<div class="seg"');
    expect(html).toContain('<header class="ph"><h1>Activity</h1>');
    expect(html).not.toContain("Sessions");
    expect(html).not.toContain("Notes</button>");
    expect(html).toContain('id="tl-strip"');
    expect([...html.matchAll(/<th(?: [^>]*)?>(?:<button[^>]*>)?(\w*)/g)].map((m) => m[1])).toEqual(["Id", "Title", "Status", "Type", "Project", "Contents", "Time", ""]);
    const all = renderStream(t.rows!, 1000, now.getTime());
    expect(new Set(all.match(/data-kind="\w+"/g)).size).toBeGreaterThan(1);
  });

  test("the kinds in the hash are read, and rendered", () => {
    const rows = ["job", "land", "issue"].map((kind, i) => ({ at: new Date(2026, 9, 27, 10, i).toISOString(), kind, what: "x", title: kind, href: "#/x" }));
    expect([...parseKinds(new URLSearchParams("kinds=land,issue"))]).toEqual(["land", "issue"]);
    expect([...parseKinds(new URLSearchParams("kinds=nope"))]).toEqual(["job", "land", "issue"]);
    expect([...parseKinds(new URLSearchParams())]).toEqual(["job", "land", "issue"]);
    expect(kindsHash(new Set(["land", "job"]))).toBe("#/timeline?kinds=job,land");
    expect(kindsHash(new Set(["job", "land", "issue"]))).toBe("#/timeline");
    const html = renderTimeline({ rows }, new URLSearchParams("kinds=land"));
    expect(html).toContain('data-value="land" aria-pressed="true"');
    expect(html).toContain('data-value="all" aria-pressed="false"');
    expect(html.match(/<tr class="evr"/g)).toHaveLength(1);
  });

  test("the h1 is Activity", () => {
    expect(renderTimeline({ rows: [] })).toContain("<h1>Activity</h1>");
  });

  test("pickKind: a click shows one kind, a modifier click toggles, All resets", () => {
    const all = ["job", "land", "issue"];
    const on = new Set(all);
    expect([...pickKind(on, "land", false)]).toEqual(["land"]);
    expect([...pickKind(on, "job", true)].sort()).toEqual(["job", "land"]);
    expect([...pickKind(on, "land", true)]).toEqual(["job"]);
    expect([...pickKind(on, "job", true)].sort()).toEqual([...all].sort());
    pickKind(on, "issue", false);
    expect([...pickKind(on, "all", false)].sort()).toEqual([...all].sort());
  });

  test("clicks on the control redraw the stream and set aria-pressed; shift, ctrl and meta keep the others", () => {
    const kinds = ["job", "land", "issue"];
    const rows = kinds.map((kind, i) => ({ at: new Date(2026, 9, 27, 10, i).toISOString(), kind, what: "x", title: kind, href: "#/x" }));
    const stream = { innerHTML: "", addEventListener() {}, querySelector() { return null; } };
    const buttons = ["all", ...kinds].map((kind) => ({ dataset: { value: kind }, pressed: "", setAttribute(_: string, v: string) { this.pressed = v; }, closest() { return this; } }));
    let click: (ev: unknown) => void = () => {};
    const root = {
      querySelector: (q: string) => q === "#tl-stream" ? stream : q === ".fbar .seg" ? { addEventListener: (_: string, f: typeof click) => { click = f; } } : null,
      querySelectorAll: () => buttons,
    };
    mountTimeline(root, { rows }, new URLSearchParams());
    const pressed = () => buttons.filter((b) => b.pressed === "true").map((b) => b.dataset.value);
    const shown = () => [...stream.innerHTML.matchAll(/<tr class="evr" data-kind="(\w+)"/g)].map((m) => m[1]);
    const press = (kind: string, mods: object = {}) => click({ target: buttons.find((x) => x.dataset.value === kind), ...mods });
    press("job");
    expect(shown()).toEqual(["job"]);
    expect(pressed()).toEqual(["job"]);
    press("land", { shiftKey: true });
    expect(shown().sort()).toEqual(["job", "land"]);
    press("issue", { ctrlKey: true });
    press("job", { metaKey: true });
    expect(shown().sort()).toEqual(["issue", "land"]);
    expect(pressed().sort()).toEqual(["issue", "land"]);
    press("all");
    expect(shown().sort()).toEqual([...kinds].sort());
    expect(pressed()).toEqual(["all"]);
  });

  test("api events carry details, cost and state", async () => {
    const evs = (await timeline({ now, before: new Date(now.getTime() + 1).toISOString() })).days![0].events;
    const ended = evs.find((e) => e.kind === "job" && e.what === "held")!;
    expect(ended).toMatchObject({ state: "needs-you", project: "fac", title: "fac-1" });
    expect(ended.details).toContainEqual(["took", "1h00m"]);
    expect(ended.details!.map(([k]) => k)).not.toContain("state");
    expect(ended.details!.map(([k]) => k)).not.toContain("run");
    const issue = (await timeline({ now, days: 30 })).rows!.find((e) => e.kind === "issue" && e.title === "an issue")!;
    expect(issue.details).toContainEqual(["status", "open"]);
    const land = (await timeline({ now, days: 30 })).rows!.find((e) => e.kind === "land")!;
    expect(land.details!.map(([k]) => k)).not.toContain("message");
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
  test("a Chris decided note gives a decided row at its minute; no note, no row; an old note is outside the window", async () => {
    const stamp = (d: Date) => `${d.toLocaleDateString("sv")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const recent = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9, 5);
    const old = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 200, 9, 5);
    writeList({ key: "fac" }, "decide", (doc) => {
      const a = add(doc, "decided issue", { now: new Date() }), b = add(doc, "undecided issue", { now: new Date() }), c = add(doc, "old decision", { now: new Date() });
      a.notes.push(`- ${stamp(recent)}: Chris decided: A: do a`);
      b.notes.push(`- ${stamp(recent)}: triage: something else`);
      c.notes.push(`- ${stamp(old)}: Chris decided: A: do a`);
      return true;
    });
    const evs = (await issueEvents()).filter((e) => e.what === "decided");
    const hit = evs.filter((e) => e.title === "decided issue");
    expect(hit.length).toBe(1);
    expect(hit[0].kind).toBe("issue");
    expect(hit[0].state).toBe("open");
    expect(hit[0].at).toBe(recent.toISOString());
    expect(evs.some((e) => e.title === "undecided issue")).toBe(false);
    expect(evs.some((e) => e.title === "old decision")).toBe(false);
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
    { at: "2026-10-27T10:00:00", kind: "land", what: "landed", title: "b", id: "abc1234", href: "#/x" },
    { at: "2026-10-27T12:00:00", kind: "job", what: "started", state: "running", title: "a", id: "j2", href: "#/x" },
    { at: "2026-10-27T11:00:00", kind: "issue", what: "opened", state: "open", title: "c", id: "x-3", href: "#/x" },
  ];
  const titles = (r: any[]) => r.map((e) => e.title).join("");
  test("default is Time, newest first; a second click reverses; the header shows it", () => {
    expect(titles(sortRows(rows))).toBe("acb");
    expect(titles(sortRows(rows, { key: "time", dir: 1 }))).toBe("bca");
    expect(nextSort({ key: "time", dir: -1 }, "time")).toEqual({ key: "time", dir: 1 });
    expect(nextSort({ key: "time", dir: -1 }, "title")).toEqual({ key: "title", dir: 1 });
    expect(renderStream(rows)).toContain('aria-sort="descending"><button type="button" data-sort="time">Time<span class="arr" aria-hidden="true">▼');
    expect(renderStream(rows, 50, Date.now(), { key: "title", dir: 1 })).toContain('aria-sort="ascending"><button type="button" data-sort="title">Title<span class="arr" aria-hidden="true">▲');
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
    const order = () => [...stream.innerHTML.matchAll(/class="c-title wide" title="\w">(\w)</g)].map((m) => m[1]).join("");
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
