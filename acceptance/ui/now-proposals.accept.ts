// Archived goal tests from ui/now-proposals.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { held, state } from "../../ui/fixtures/status-state.ts";
import { asksOf, withAttn, problem, prop } from "../../ui/test-now.ts";

test("a proposal is a row with Yes-like buttons and its signals folded", () => {
  const h = withAttn({ ...state, asks: asksOf([held], [], [prop]) });
  const row = h.match(/<article class="job-card small issue-row proposal-check"[^]*?<\/article>/)![0];
  expect(problem(row)).toContain("Do not mock the db");
  expect(row).toContain('<span class="t">Lesson: No db mocks</span>');
  expect(row).toContain('class="act primary" type="button" data-act="approve" data-id="l-1234abcd" data-label="Add a check to aleph">Add a check to aleph<');
  expect(row).toContain('data-act="decline" data-id="l-1234abcd" data-label="Add no check">');
  expect(row).toContain('data-reason="proposal-check:aleph"');
  expect(row).toContain('data-label="Add a check to aleph [auto-yes]"');
  expect(row.match(/<details class="more"/g)?.length).toBe(1);
  expect(row).toContain('<a href="https://lf/trace/t2">');
  expect(row).not.toContain("<script>");
  expect(row).toContain("&lt;script&gt;");
});
