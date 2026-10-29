import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { issueCard, triageCard } from "./views/cards.js";
// @ts-ignore plain JS, shared with the page
import { BODY_TEMPLATE, renderContents, renderIssue } from "./views/contents.js";
// @ts-ignore plain JS, shared with the page
import { renderCard, renderDetail } from "./views/projects.js";
// @ts-ignore plain JS, shared with the page
import { renderLanes } from "./views/now.js";

/** What a reader sees: no style or script blocks, no tags, no attribute values. */
const visible = (html: string) =>
  html.replace(/<(style|script)[\s\S]*?<\/\1>/g, "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
const noGoal = (html: string) => expect(visible(html)).not.toMatch(/goal/i);
// Attributes the reader meets too: placeholders, titles and aria labels.
const attrs = (html: string) => [...html.matchAll(/\b(?:title|placeholder|aria-label|data-label)="([^"]*)"/g)].map((m) => m[1]).join(" ");

const issue = { id: "aleph-3", title: "An issue", status: "open", href: "#/issues/aleph/3", labels: ["goal", "ui"], notes: 2, created: "2026-10-20", updated: "2026-10-25" };
const project = {
  key: "aleph", path: "/x/aleph", factory: true, openItems: 2, openGoals: 1, behind: 0, notes: 1, activity: "2026-10-25T00:00:00Z",
  baseline: { commit: "abcdef1234", ok: true }, lastLanded: null,
  items: [{ id: 3, title: "An issue", labels: ["goal"] }], commits: [], jobs: [], vault: [],
};

describe("the UI never says goal", () => {
  const pages: [string, string][] = [
    ["issueCard full", issueCard(issue, "full")],
    ["issueCard compact", issueCard(issue, "compact")],
    ["triageCard full", triageCard({ name: "triage-aleph-3", state: "done", outcome: "goal", item: { title: "x" } }, "full")],
    ["triageCard compact", triageCard({ name: "triage-aleph-3", state: "done", outcome: "goal", item: { title: "x" } }, "compact")],
    ["project card", renderCard(project)],
    ["project detail", renderDetail(project)],
    ["inventory", renderContents({ projects: [project], issues: [{ repo: "aleph", id: 3, title: "An issue", status: "open", labels: ["goal"], updated: "2026-10-25" }] }, { status: "" })],
    ["issue detail", renderIssue({ repo: "aleph", id: 3, title: "t", status: "open", frontmatter: { labels: ["goal"] }, body: BODY_TEMPLATE, notes: [], jobs: [], commits: [] })],
    ["now issues", renderLanes({ needs: [], stuck: [], issues: [{ id: 3, title: "x", repo: "aleph" }], factory: { health: [] } })],
  ];
  for (const [name, html] of pages) test(name, () => { noGoal(html); noGoal(attrs(html)); });

  test("the goal label shows as factory, and the form still adds it", () => {
    expect(issueCard(issue, "full")).toContain("factory, ui");
    expect(triageCard({ name: "t", state: "done", outcome: "goal" }, "full")).toContain("To factory");
    const form = renderContents({ projects: [], issues: [] });
    expect(form).toContain("Build in the factory");
    expect(form).toContain('name="goal"');
  });
});
