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

test("the page builds the sidebar from /api/views and keeps the project filter", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  for (const s of ["/api/views", "/api/projects/keys", 'aria-current="page"', "project=", '"factory", "Factory"', '"memory", "Memory"']) expect(html).toContain(s);
  expect(html).not.toContain("/render.js");
});
