import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { issueCard, jobCard, landCard, triageCard } from "./views/cards.js";

const now = "2026-10-28T12:00:00.000Z";
const job = { name: "aleph-9", item: { title: "Do <it>" }, state: "running", phase: "worker", model: "opus", started: "2026-10-28T10:00:00.000Z", cost: 1.5, href: "#/jobs/aleph-9" };
const land = { name: "aleph-8", item: { title: "Landed one" }, state: "landed", commit: "abcdef1234", started: "2026-10-28T09:00:00.000Z", ended: "2026-10-28T09:30:00.000Z", cost: 2, checks: [{ name: "tests", seconds: 71, ok: true }] };
const triage = { name: "triage-aleph-3", item: { title: "Sort <it>" }, state: "done", outcome: "needs-chris", started: "2026-10-28T11:00:00.000Z", ended: "2026-10-28T11:04:00.000Z", cost: 0.2 };
const issue = { id: "aleph-3", title: "An issue", status: "open", href: "#/issues/aleph/3", labels: ["goal", "ui"], notes: 2, created: "2026-10-20", updated: "2026-10-25" };

// The compact card is a wrapper with at most two block children.
const blocks = (h: string) => h.match(/<div class="(?:c1|c2)">/g)?.length ?? 0;

const cards: [string, (size: "full" | "compact") => string][] = [
  ["issueCard", (size) => issueCard(issue, size)],
  ["landCard", (size) => landCard(land, size, now)],
  ["jobCard", (size) => jobCard(job, size, now)],
  ["triageCard", (size) => triageCard(triage, size, now)],
];

describe("cards", () => {
  for (const [name, make] of cards) {
    test(`${name} renders a full and a compact size`, () => {
      const full = make("full"), compact = make("compact");
      expect(full).toContain('class="job-card big');
      expect(full).toContain('<div class="ih">');
      expect(compact).toContain('class="card compact');
      expect(compact).not.toContain("<dl");
      expect(compact).toContain('class="badge');
      expect(compact).toContain('class="id"');
    });
    test(`${name} compact is at most two lines: two block children`, () => {
      const c = make("compact");
      expect(blocks(c)).toBeLessThanOrEqual(2);
      expect(c.match(/<(div|p|h\d|ul|dl|table)[ >]/g)!.length).toBe(3); // the wrapper and its two lines
      expect(c).not.toContain("\n");
    });
  }

  test("the full land card is the Status page card", () => {
    const h = landCard(land, "full", now);
    expect(h).toContain('<article class="job-card big del"><div class="ih"><span class="id">aleph-8</span><h3>Landed one</h3><span class="badge done">Landed</span></div>');
    expect(h).toContain("<dt>Commit</dt><dd><code>abcdef1</code></dd>");
    expect(h).not.toContain("<dt>Tests</dt>");
  });

  test("the triage card is in the land card's style and names the outcome", () => {
    const h = triageCard(triage, "full", now);
    expect(h).toContain('<article class="job-card big del triage"><div class="ih"><span class="id">triage-aleph-3</span><h3>Sort &lt;it&gt;</h3><span class="badge need">Needs Chris</span></div>');
    expect(h).toContain("<dt>Took</dt><dd>4m</dd>");
    expect(triageCard({ ...triage, outcome: "goal" }, "full", now)).toContain('<span class="badge done">Goal</span>');
    expect(triageCard({ ...triage, outcome: "closed" }, "full", now)).toContain(">Closed<");
    expect(triageCard({ ...triage, outcome: "live-check" }, "full", now)).toContain(">Live check<");
    expect(triageCard({ ...triage, state: "running", outcome: undefined, ended: undefined }, "full", now)).toContain('<span class="badge run">Triaging</span>');
    expect(triageCard({ ...triage, outcome: undefined, reason: "failed: x" }, "full", now)).toContain(">No verdict<");
  });

  test("titles are escaped; ids link when there is an href", () => {
    expect(jobCard(job, "compact", now)).toContain("Do &lt;it&gt;");
    expect(jobCard(job, "compact", now)).toContain('<a class="id" href="#/jobs/aleph-9">');
    expect(issueCard(issue, "full")).toContain("<dt>Labels</dt><dd>goal, ui</dd>");
  });
});
