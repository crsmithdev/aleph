// Archived goal tests from ui/page.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("index.html loads Web Awesome and ECharts at pinned versions", () => {
  const html = readFileSync(new URL("./index.html", new URL("../../ui/", import.meta.url)), "utf8");
  expect(html).toMatch(/cdn\.jsdelivr\.net\/npm\/@awesome\.me\/webawesome@\d+\.\d+\.\d+\/dist-cdn\/webawesome\.loader\.js/);
  expect(html).toContain('<script src="/vendor/echarts.min.js"></script>');
  expect(html).not.toMatch(/cdn\.jsdelivr\.net\/npm\/echarts/);
  expect(readFileSync(new URL("./app.css", new URL("../../ui/", import.meta.url)), "utf8")).toContain("--wa-color-brand-fill-loud: var(--run)");
});
