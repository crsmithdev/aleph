// The Ask cards of v6 phase 5: three kinds, a compact face (title and buttons) and an open one (description, what each
// button does, the recommended mark, Technical details closed).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { asksOf } from "./test-now.ts";
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
  [job({ name: "aleph-27", condition: "awaiting", reason: "held path hooks/x.ts", item: { id: 27, title: "Digest" }, ask: { kind: "approval", reason: "held-path", ...CASE(["land", "drop"], "land") } })],
  [
    issueAsk(41, "question", { ask: { kind: "input", reason: "question", question: "A or B?", options: [], why: [], ...CASE(["decide", "deny"], "decide") } }),
    issueAsk(42, "no-commit", { ask: { kind: "input", reason: "no-commit", question: "q", options: [], why: [], ...CASE(["rerun", "close"], "rerun") } }),
  ], []);
const card = (row: string) => row.match(/^<article[^]*<\/article>$/)![0];

test("one card per kind: the title opens with the kind label, and the tag names the stop", () => {
  const items = four();
  expect(items.map((i) => [i.reason, i.card, i.tag])).toEqual([
    ["held-path", "approve", "Security change"], ["question", "decide", "Your choice"], ["no-commit", "unstick", "No change"],
  ]);
  for (const [i, label] of items.map((x, k) => [x, ["Approve", "Decide", "Unstick"][k]] as const)) {
    const row = card(view.askRow(i, "2026-10-27T17:00:00Z"));
    expect(row).toContain(`data-card="${i.card}"`);
    expect(row).toContain(`<span class="t"><b class="ask-kind">${label}:</b> <span class="ask-title">the doc-claim check in the verify gate</span></span>`);
    expect(row).toContain(`<span class="ask-tag">${i.tag}</span>`);
  }
});

test("the compact face is the title and the buttons; the open face adds the description and what each button does", () => {
  const row = view.askRow(four()[0], "2026-10-27T17:00:00Z");
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
  const row = view.askRow(four()[0], "2026-10-27T17:00:00Z");
  expect(row).toContain('<div class="choice rec"><button class="act primary" type="button" data-act="land"');
  expect(row.match(/<span class="rec-note">Recommended<\/span>/g)).toHaveLength(1);
  expect(row).toContain('<div class="choice"><button class="act" type="button" data-act="drop"');
});

test("Technical details are closed by default and hold the director's details and why it recommends", () => {
  const row = view.askRow(four()[0], "2026-10-27T17:00:00Z");
  const tech = row.match(/<details class="more"[^>]*>[^]*?<\/details>/)![0];
  expect(tech).not.toMatch(/^<details[^>]* open/);
  expect(tech).toContain("<summary>Technical details</summary>");
  expect(tech).toContain("hooks/ is on SECURITY_PATHS.");
  expect(tech).toContain("Recommended, Land it: It is safe.");
});

test("each held path names its change: a package file is a package change", () => {
  const [i] = asksOf([job({ name: "aleph-28", condition: "awaiting", reason: "held path bun.lock", item: { id: 28, title: "Bump" }, ask: { kind: "approval", reason: "held-path" } })]);
  expect(i.tag).toBe("Package change");
});

test("an old Ask with none of the new fields still renders: the item's title, the fixed text, no mark", () => {
  const [i] = asksOf([], [issueAsk(50, "run-cap", { title: "Loops a lot", ask: { kind: "input", reason: "run-cap", question: "q", options: [], why: [], situation: "It started three times." } })]);
  expect(i.headline).toBe("Loops a lot");
  const row = view.askRow(i, "2026-10-27T17:00:00Z");
  expect(row).toContain('<b class="ask-kind">Unstick:</b> <span class="ask-title">Loops a lot</span>');
  expect(row).toContain('<span class="ask-tag">Looping</span>');
  expect(row).toContain("Clears the Ask and lets the factory start the goal again.");
  expect(row).not.toContain("rec-note");
  // An item from before the cards, with no card, headline or tag: the kind comes from its input or approval.
  const bare = view.askRow({ key: "run:x-1", reason: "held-path", kind: "approval", id: "x-1", href: "", title: "Old run", problem: "p", situation: "s", escalated: true, actions: [], details: {} }, "2026-10-27T17:00:00Z");
  expect(bare).toContain('<b class="ask-kind">Approve:</b> <span class="ask-title">Old run</span>');
  expect(bare).not.toContain("ask-tag");
});

test("an Ask still with the director shows its title and fixed text, and no button", () => {
  const [i] = asksOf([], [issueAsk(51, "no-commit", { title: "Empty runs", ask: { kind: "input", reason: "no-commit", question: "q", options: [], why: [] } })]);
  const row = view.askRow(i, "2026-10-27T17:00:00Z");
  expect(row).toContain('<b class="ask-kind">Unstick:</b> <span class="ask-title">Empty runs</span>');
  expect(row).toContain("With the director");
  expect(row).not.toContain("<button");
});
