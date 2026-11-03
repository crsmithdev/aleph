// Archived goal tests from ui/lib.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore lib.js is plain JS, shared with the page
import { localId, repoIdLink, repoOf, STATES, badge, priorityBadge, chart, chips, filterBar, idLink, pageHead, pager, sortHead, sectionHead, shortModel, when, chartTheme, clock, cmd, diffHtml, empty, error, esc, failMessage, loading, md, money, mountView, recordState, restoreState, span, tone, searchBox } from "../../ui/lib.js";

test("chartTheme holds the token colours in the order given", () => {
  const t = { bg: "#111", surface: "#222", ink: "#eee", rule: "#444", run: "#1", done: "#2", need: "#3", stuck: "#4", sans: "X" };
  const th = chartTheme(t);
  expect(th.color).toEqual(["#1", "#2", "#3", "#4", "#C792EA", "#89DDFF"]);
  expect(th.textStyle.color).toBe("#eee");
  expect(th.valueAxis.splitLine.lineStyle.color).toBe("#444");
  expect(th.tooltip.backgroundColor).toBe("#222");
});

test("tone maps every job state to one badge tone", () => {
  expect(STATES.map(tone)).toEqual(["run", "done", "need", "stuck", "stuck", "done", "done", "quiet"]);
  expect(tone("held")).toBe("quiet");
});
