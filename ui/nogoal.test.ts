import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
// @ts-ignore plain JS, shared with the page
import { BODY_TEMPLATE, renderIssues, renderIssue } from "./views/issues.js";
// @ts-ignore plain JS, shared with the page
import { renderDetail } from "./views/projects.js";
// @ts-ignore plain JS, shared with the page
import { renderLanes } from "./views/now.js";

/** What a reader sees: no style or script blocks, no tags, no attribute values. */
const visible = (html: string) =>
  html.replace(/<(style|script)[\s\S]*?<\/\1>/g, "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ");
const noGoal = (html: string) => expect(visible(html)).not.toMatch(/goal/i);
// Attributes the reader meets too: placeholders, titles and aria labels.
const attrs = (html: string) => [...html.matchAll(/\b(?:title|placeholder|aria-label|data-label)="([^"]*)"/g)].map((m) => m[1]).join(" ");

const project = {
  key: "aleph", path: "/x/aleph", factory: true, openItems: 2, openGoals: 1, behind: 0, notes: 1, activity: "2026-10-25T00:00:00Z",
  baseline: { commit: "abcdef1234", ok: true }, lastLanded: null,
  items: [{ id: 3, title: "An issue", labels: [] }], commits: [], jobs: [], vault: [],
};

// The Issue page, the Issues page and the Status lanes use the work model's names, so they say goal (see state.test.ts and issues.test.ts); the pages below keep the old rule.
describe("the UI never says goal", () => {
  const pages: [string, string][] = [
    ["project detail", renderDetail(project)],
    ["now issues", renderLanes({ stuck: [], issues: [{ id: 3, title: "x", repo: "aleph" }], factory: { health: [] } })],
  ];
  for (const [name, html] of pages) test(name, () => { noGoal(html); noGoal(attrs(html)); });

  test("the form still files a spec", () => {
    const form = renderIssues({ projects: [], issues: [] });
    expect(form).toContain("build it in the factory");
    expect(form).toContain('name="spec"');
  });
});
