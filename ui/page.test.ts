import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("index.html's style sheet has balanced braces", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  expect(m).not.toBeNull();
  const css = m![1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"\n]*"|'[^'\n]*'/g, "");
  let depth = 0;
  let min = 0;
  for (const ch of css) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    min = Math.min(min, depth);
  }
  expect(min).toBe(0);
  expect(depth).toBe(0);
});

test("the new rules sit at the top level, outside any @media block", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"\n]*"|'[^'\n]*'/g, "");
  let depth = 0;
  for (const sel of [".dot.off", ".ev.one", "#offline", "main {"]) {
    const i = css.indexOf(sel === "main {" ? "\nmain {" : "\n" + sel);
    expect(i).toBeGreaterThan(-1);
    depth = 0;
    for (const ch of css.slice(0, i)) depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
    expect(depth).toBe(0);
  }
});

test("the Memory view's classes have top-level rules, and .two stacks at 720px", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const css = html.match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"\n]*"|'[^'\n]*'/g, "");
  // Selectors of the rules at brace depth 0; @media preludes are included, their inner rules are not.
  const top: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) top.push(css.slice(start, i).trim());
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  const selectors = top.flatMap((p) => p.split(",").map((s) => s.trim()));
  for (const cls of [".two", ".search", ".results", ".writes"]) expect(selectors).toContain(cls);
  expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.two \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});

test("the page builds the sidebar from /api/views and keeps the project filter", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  for (const s of ["/api/views", "/api/projects/keys", 'aria-current="page"', "project=", '"factory", "Factory"', '"memory", "Memory"']) expect(html).toContain(s);
  expect(html).not.toContain("/render.js");
});

test("index.html loads Web Awesome and ECharts at pinned versions", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  expect(html).toMatch(/cdn\.jsdelivr\.net\/npm\/@awesome\.me\/webawesome@\d+\.\d+\.\d+\/dist-cdn\/webawesome\.loader\.js/);
  expect(html).toMatch(/cdn\.jsdelivr\.net\/npm\/echarts@\d+\.\d+\.\d+\/dist\/echarts\.min\.js/);
  expect(html).toContain("--wa-color-brand-fill-loud: var(--run)");
});

test("the shell calls a view's mount after render, through mountView", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  expect(html).toMatch(/view\.render\([^]*mountView\(view, \$\("view"\), data\)/);
});
