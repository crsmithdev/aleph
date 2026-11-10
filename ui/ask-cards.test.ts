// The Ask cards of v6 phase 5: three kinds, a compact face (title and buttons) and an open one (description, what each
// button does, the recommended mark, Technical details closed).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
// @ts-ignore cards.js is plain JS, shared with the page
import { askCard } from "./views/cards.js";
import { shortId } from "../lib/naming.ts";
import { ASK_REASONS } from "../jobs/lib/asks/ask.ts";
import { asksOf, prop } from "./test-now.ts";
import { job } from "./fixtures/status-state.ts";

const CASE = (actions: string[], rec: string) => ({
  headline: "the doc-claim check in the verify gate",
  situation: "This work adds a check that compares the docs with the code. Both reviews passed.",
  effects: actions.map((a) => ({ action: a, text: `What ${a} does.` })),
  recommend: { action: rec, why: "it is safe" },
  details: "hooks/ is on SECURITY_PATHS.",
});
const issueAsk = (n: number, reason: string, o: object = {}) => ({ id: `aleph-${n}`, title: `Issue ${n}`, status: "open", href: `#/issues/aleph/${n}`, labels: [], notes: 0, created: "", updated: "", reason, question: "q", ...o });

/** One escalated Ask of each kind: a held run, an issue's question, and a no-commit stop. */
const four = () => asksOf(
  [job({ name: "aleph-27", condition: "waiting", reason: "held path hooks/x.ts", item: { id: 27, title: "Digest" }, ask: { kind: "approval", reason: "held-path", ...CASE(["land", "drop"], "land") } })],
  [
    issueAsk(41, "question", { ask: { kind: "input", reason: "question", question: "A or B?", options: [], why: [], ...CASE(["decide", "deny"], "decide") } }),
    issueAsk(42, "no-commit", { ask: { kind: "input", reason: "no-commit", question: "q", options: [], why: [], ...CASE(["rerun", "close"], "rerun") } }),
  ], []);
const card = (row: string) => row.match(/^<article[^]*<\/article>$/)![0];

test("one card per kind: the title opens with the kind label, and the tag names the stop", () => {
  const items = four();
  expect(items.map((i) => [i.reason, i.card, i.tag])).toEqual([
    ["held-path", "approve", "protected"], ["question", "decide", "question"], ["no-commit", "unstick", "failed"],
  ]);
  for (const [i, label] of items.map((x, k) => [x, ["Approve", "Decide", "Unstick"][k]] as const)) {
    const row = card(askCard(i, "2026-10-27T17:00:00Z"));
    expect(row).toContain(`data-card="${i.card}"`);
    expect(row).toContain(`data-annotate="${shortId(i.id)}"`);
    expect(row).toContain(`<span class="t"><b class="ask-kind">${label}:</b> <span class="ask-title">the doc-claim check in the verify gate</span></span>`);
    expect(row).toContain(`<span class="ask-tag">${i.tag}</span>`);
  }
});

test("the compact face is the title and the buttons; the open face adds the description and what each button does", () => {
  const row = askCard(four()[0], "2026-10-27T17:00:00Z");
  const fold = row.match(/<details class="ask-fold"[^>]*>[^]*?<\/details>/)![0];
  // The description sits in the title's fold, closed by default; the buttons sit outside it, so the compact face shows them.
  expect(fold).not.toMatch(/^<details[^>]* open/);
  expect(fold).toContain('<p class="situation">This work adds a check that compares the docs with the code. Both reviews passed.</p>');
  expect(fold).not.toContain("<button");
  expect(row.slice(row.indexOf(fold) + fold.length)).toContain('data-label="Land it"');
  // Each button carries what it does; the page shows it only while the fold is open.
  expect(row).toMatch(/data-label="Land it">Land it<\/button><div class="choice-text"><span class="effect">What land does\.<\/span>/);
  const css = readFileSync(join(import.meta.dir, "app.css"), "utf8");
  expect(css).toContain(".issue-row[data-card] .choice-text { display: none; }");
  expect(css).toContain(".issue-row[data-card]:has(.ask-fold[open]) .choice-text { display: flex;");
  expect(css).toContain(".issue-row[data-card]:not(:has(.ask-fold[open])) .ask-box > details.more { display: none; }");
});

test("the recommended button is marked and filled; the others are not", () => {
  const row = askCard(four()[0], "2026-10-27T17:00:00Z");
  expect(row).toContain('<div class="choice rec"><button class="act primary" type="button" data-act="land"');
  expect(row.match(/<span class="rec-note">Recommended<\/span>/g)).toHaveLength(1);
  expect(row).toContain('<div class="choice"><button class="act" type="button" data-act="drop"');
});

test("Technical details are closed by default and hold the director's details and why it recommends", () => {
  const row = askCard(four()[0], "2026-10-27T17:00:00Z");
  const tech = row.match(/<details class="more"[^>]*>[^]*?<\/details>/)![0];
  expect(tech).not.toMatch(/^<details[^>]* open/);
  expect(tech).toContain("<summary>Technical details</summary>");
  expect(tech).toContain("hooks/ is on SECURITY_PATHS.");
  expect(tech).toContain("Recommended, Land it: It is safe.");
});

test("each held path names its change: a package file is a package change", () => {
  const [i] = asksOf([job({ name: "aleph-28", condition: "waiting", reason: "held path bun.lock", item: { id: 28, title: "Bump" }, ask: { kind: "approval", reason: "held-path", ...CASE(["land", "drop"], "land") } })]);
  expect(i.tag).toBe("protected");
});

test("an old Ask with none of the new fields still renders: the item's title, the fixed text, no mark", () => {
  const [i] = asksOf([], [issueAsk(50, "run-cap", { title: "Loops a lot", ask: { kind: "input", reason: "run-cap", question: "q", options: [], why: [], situation: "It started three times." } })]);
  expect(i.headline).toBe("Loops a lot");
  const row = askCard(i, "2026-10-27T17:00:00Z");
  expect(row).toContain('<b class="ask-kind">Unstick:</b> <span class="ask-title">Loops a lot</span>');
  expect(row).toContain('<span class="ask-tag">capped</span>');
  expect(row).toContain("Clears the Ask and lets the factory start the issue again.");
  expect(row).not.toContain("the goal");
  expect(row).not.toContain("rec-note");
});

test("one Ask per reason: the card, its label and its tag come from the server item", () => {
  const want: Record<string, [string, string, string]> = {
    "held-path": ["approve", "Approve", "protected"], review: ["approve", "Approve", "returned"], question: ["decide", "Decide", "question"],
    "no-commit": ["unstick", "Unstick", "failed"], "part-dropped": ["decide", "Decide", "incomplete"], "intake-failed": ["unstick", "Unstick", "failed"],
    rescue: ["unstick", "Unstick", "waiting"], "run-cap": ["unstick", "Unstick", "capped"],
    "proposal-check": ["approve", "Approve", "proposal"], "proposal-claude-md": ["approve", "Approve", "proposal"], "proposal-skill": ["approve", "Approve", "proposal"],
  };
  expect(Object.keys(want).sort()).toEqual(Object.keys(ASK_REASONS).sort());
  const plain = Object.keys(want).filter((r) => !r.startsWith("proposal-"));
  const items = asksOf([], plain.map((r, n) => issueAsk(60 + n, r, { title: `Stop ${r}`, ask: { kind: "input", reason: r, question: "q", options: [], why: [], ...CASE([], "") } })),
    ["check", "claude-md", "skill"].map((k, n) => ({ ...prop, id: `l-${n}`, kind: k, situation: "S." })));
  expect(items.map((i) => i.reason).sort()).toEqual(Object.keys(want).sort());
  for (const i of items) {
    const [kind, label, tag] = want[i.reason];
    const row = card(askCard(i, "2026-10-27T17:00:00Z"));
    expect(row).toContain(`data-card="${kind}" data-reason="${i.reason}"`);
    expect(row).toContain(`<b class="ask-kind">${label}:</b>`);
    expect(row).toContain(`<span class="ask-tag">${tag}</span>`);
  }
});

test("an Ask still with the director shows its title and fixed text, and no button", () => {
  const [i] = asksOf([], [issueAsk(51, "no-commit", { title: "Empty runs", ask: { kind: "input", reason: "no-commit", question: "q", options: [], why: [] } })]);
  const row = askCard(i, "2026-10-27T17:00:00Z");
  expect(row).toContain('<b class="ask-kind">Unstick:</b> <span class="ask-title">Empty runs</span>');
  expect(row).toContain("With the director");
  expect(row).not.toContain("<button");
});

test("the id, priority, date and runtime sit inside the coloured box of an Ask card and of a stuck card", () => {
  const stuck = view.renderNeeds({ asks: [], stuck: [job({ name: "aleph-30", condition: "failed", item: { id: 30, title: "T", priority: "high" } })], factory: { health: [] }, now: "2026-10-27T17:00:00Z" });
  for (const row of [askCard({ ...four()[0], priority: "high" }, "2026-10-27T17:00:00Z"), stuck]) {
    const [before, box] = row.split('<div class="ask-box">');
    expect(before).not.toContain('class="ih"');
    const head = box.slice(0, box.indexOf("<details"));
    for (const c of ['class="idl"', 'class="badge', 'class="num date"', 'class="num dur"']) expect(head).toContain(c);
  }
});
