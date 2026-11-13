import { describe, expect, test } from "bun:test";
// @ts-ignore plain JS, shared with the page
import { renderIssues } from "./views/issues.js";

describe("the UI never says goal", () => {
  test("the form still files a spec", () => {
    const form = renderIssues({ projects: [], issues: [] });
    expect(form).toContain("build it in the factory");
    expect(form).toContain('name="spec"');
  });
});
