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
  for (const sel of [".metric:hover", ".ev.one", "#offline", "main {"]) {
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

test("the page builds the sidebar from /api/views and has no project selector", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  for (const s of ["/api/views", 'aria-current="page"', '"factory", "Factory"', '"memory", "Memory"']) expect(html).toContain(s);
  for (const s of ['id="project"', 'class="proj"', "All projects", "/api/projects/keys"]) expect(html).not.toContain(s);
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
  expect(html).toMatch(/view\.render\([^]*mountView\(view, \$\("view"\), data, query\)/);
});

test("route writes the loading line to the view before the first load", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const body = html.slice(html.indexOf("function route()"));
  const a = body.indexOf("loading(");
  const b = body.indexOf("load(shown, true)");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
});

test("load records state before render and restores it after, only on a refresh", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const body = html.slice(html.indexOf("async function load("));
  const rec = body.indexOf("recordState(");
  const render = body.indexOf("view.render(");
  const rest = body.indexOf("restoreState(");
  expect(rec).toBeGreaterThan(-1);
  expect(render).toBeGreaterThan(rec);
  expect(rest).toBeGreaterThan(render);
  expect(body.slice(rec - 40, rec)).toContain("first ? null");
});

test("load records the open state of details[data-keep] before the render and restores it after", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const body = html.slice(html.indexOf("async function load("));
  const rec = body.indexOf("details[data-keep]");
  const render = body.indexOf('$("view").innerHTML = view.render');
  const restore = body.indexOf("details[data-keep]", rec + 1);
  expect(rec).toBeGreaterThan(-1);
  expect(render).toBeGreaterThan(rec);
  expect(restore).toBeGreaterThan(render);
  expect(body.slice(0, rec)).toContain("first");
});

test("the sidebar lists Status, Activity (/timeline), then the rest, with Tools for /activity and no Jobs or Projects", async () => {
  const dir = new URL("./views/", import.meta.url);
  const names = (await import("node:fs")).readdirSync(dir).filter((n) => n.endsWith(".js") && !n.startsWith("_"));
  const all: any[] = [];
  for (const n of names) for (const m of Object.values(await import(new URL(n, dir).href))) if (m && typeof (m as any).path === "string") all.push(m);
  const shown = all.filter((v) => !v.path.includes(":") && v.nav !== false);
  const factory = shown.filter((v) => v.group === "factory").sort((a, b) => a.order - b.order);
  expect(factory.slice(0, 2).map((v) => [v.title, v.path])).toEqual([["Status", "/"], ["Activity", "/timeline"]]);
  const claude = shown.filter((v) => v.group === "claude").sort((a, b) => a.order - b.order).map((v) => v.title);
  expect(claude).toEqual(["Sessions", "Tools", "Skills"]);
  expect(factory.some((v) => v.path === "/sessions")).toBe(false);
  expect(readFileSync(new URL("./index.html", import.meta.url), "utf8")).toContain('["claude", "Claude"]');
  expect(shown.find((v) => v.path === "/activity")?.title).toBe("Tools");
  expect(shown.some((v) => v.path === "/jobs" || v.path === "/projects")).toBe(false);
  expect(all.some((v) => v.path === "/jobs")).toBe(true);
  expect(all.some((v) => v.path === "/jobs/:name" || v.path === "/projects/:key")).toBe(true);
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  expect(html).toContain("v.nav !== false");
});
