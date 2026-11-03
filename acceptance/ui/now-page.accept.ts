// Archived goal tests from ui/now-page.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { job, state } from "../../ui/fixtures/status-state.ts";
import { withAttn, full } from "../../ui/test-now.ts";

test("needs shows name, reason and stat, and no copy commands", () => {
  const h = withAttn(state);
  for (const t of ["aleph-27", "Held path: hooks/lib/digest.ts", "a.ts | 2 +-"]) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd=");
});

test("stuck, running and delivered show their jobs", () => {
  expect(withAttn(state)).toContain("types failed");
  expect(withAttn(state)).toContain("aleph-30");
  expect(withAttn(state)).toContain("aleph-36");
  expect(withAttn(state)).toContain("worker");
});

test("Status has no Standing permissions section", () => {
  const s = full;
  expect(view.view.render(s)).not.toContain("Standing permissions");
  expect(view.view.render(s)).not.toContain('data-act="revoke"');
});

const done = (n: number) => ({ id: `aleph-${n}`, title: `Done ${n}`, href: `#/issues/aleph/${n}`, finished: "2026-10-27T16:30:00Z",
  jobs: [job({ name: `triage-aleph-${n}`, condition: "done", outcome: "goal", run: { kind: "triage", started: "2026-10-27T10:00:00Z" } }),
    job({ name: `aleph-${n}`, condition: "landed", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc", run: { kind: "land", started: "2026-10-27T15:00:00Z" } })] });

test("Latest done lists the issue as a card with a 3-line face and no link to a commit, a land run or a triage run", () => {
  const h = view.renderLanes({ ...state, done: [{ ...done(5), since: "2026-10-27T10:00:00Z", finished: "2026-10-27T15:30:00Z" }, done(4)] }).match(/<section id="lane-done"[^]*?<\/section>/)![0];
  expect(h).toContain('<h2 id="h-done">Latest done</h2></div>');
  expect(h).toContain('<a href="#/issues/aleph/5" class="t" title="Done 5">Done 5</a>');
  expect(h).toContain('<span class="num dur">5h30m</span>');
  expect(h).not.toContain("/commit/");
  expect(h).not.toContain("#/jobs/");
  expect(h).not.toContain("<code>");
  expect(h.indexOf("Done 5")).toBeLessThan(h.indexOf("Done 4"));
});

test("a done part is its own card with a 3/4 link to its parent", () => {
  const h = view.renderLanes({ ...state, done: [{ ...done(5), id: "aleph-5.3", part: { n: 3, m: 4, parent: "aleph-5", href: "#/issues/aleph/5" } }] });
  expect(h).toContain('<a class="part" href="#/issues/aleph/5" title="Part 3 of 4 of aleph-5">3/4</a>');
});

test("the meta row is the id, status, priority, part, date, duration, then why it waits", () => {
  const h = view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 7, title: "t", priority: "high", stage: "blocked", at: "2026-10-27T10:05:00", since: "2026-10-27T09:00:00", why: "Waits on aleph-630", kind: "waits_on", part: { n: 3, m: 4, parent: "aleph-6", href: "#/issues/aleph/6" } }] });
  const row = h.match(/<section id="lane-queued"[^]*?<div class="ih">[^]*?<\/div>/)![0];
  const order = ["idl", "badge quiet\">blocked", "badge need\">high", 'class="part"', "num date\">10/27 10:05", "num dur", 'class="why" title="Waits on aleph-630"'].map((x) => row.indexOf(x));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("Queued cards show why each goal waits", () => {
  const w = (id: number, why: string, kind: string, more: any = {}) => ({ repo: "aleph", id, title: `t${id}`, why, kind, ...more });
  const lanes = view.renderLanes({ ...state, queued: [
    w(1, "Waits on aleph-630", "waits_on", { waits: [{ id: "aleph-630", href: "#/issues/aleph/630", state: "working" }] }),
    w(3, "Starts at the next dispatch", "ready"),
    w(4, "Waiting for a slot (12 of 12 running)", "gate"),
  ] });
  const q = lanes.match(/<section id="lane-queued"[^]*?<\/section>/)![0];
  expect(q).toContain('<span class="why" title="Waits on aleph-630">Waits on aleph-630</span>');
  expect(q).not.toContain('data-act="unblock"');
  expect(q).toContain("Starts at the next dispatch");
  expect(q).toContain("Waiting for a slot (12 of 12 running)");
  expect(q.match(/>Waiting for a slot/g)?.length).toBe(1);
  expect(q).toContain('href="#/issues/aleph/1"');
  expect(view.renderLanes({ ...state, running: [], queued: [{ repo: "aleph", id: 5, title: "x" }] })).not.toContain('class="why"');
});

test("the page order is the status line, Awaiting you, the scorecard, the lanes, the causes; the window picker, no flow strip", () => {
  const page = view.view.render(full);
  const order = ['class="lede"', 'class="asof"', 'class="say', 'data-act="pause"', 'id="needs"', 'id="scorecard"', 'id="lane-running"', 'id="lane-queued"', 'id="lane-done"', 'id="causes"'];
  const at = order.map((t) => page.indexOf(t));
  expect(at.every((v) => v >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  for (const t of ["wpick", 'id="flow"', 'id="lane-incoming"', 'id="speed"', 'id="efficiency"']) expect(page).not.toContain(t);
});

const pressedIn = (h: string) => [...(h.match(/data-name="window">(.*?)<\/div>/)?.[1] ?? "").matchAll(/data-value="(\w+)" aria-pressed="(\w+)"/g)];

test("the page head holds the Hour, Day, Week, Month picker with the chosen window pressed", () => {
  const page = view.view.render(full, {}, new URLSearchParams("window=month"));
  const head = page.match(/<header class="ph">.*?<\/header>/)![0];
  expect(head).toContain("<h1>Status</h1>");
  expect(head).toContain('class="aside"');
  expect(pressedIn(head).map((m) => m[1])).toEqual(["hour", "day", "week", "month"]);
  expect(pressedIn(head).filter((m) => m[2] === "true").map((m) => m[1])).toEqual(["month"]);
  for (const t of [">Hour<", ">Day<", ">Week<", ">Month<"]) expect(head).toContain(t);
  expect(pressedIn(view.view.render(full, {}, new URLSearchParams())).filter((m) => m[2] === "true").map((m) => m[1])).toEqual(["week"]);
});
