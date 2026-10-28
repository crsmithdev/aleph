import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/contents.js";
// @ts-ignore
import { view as specView } from "./views/spec.js";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]) {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}
let base: string, server: Awaited<ReturnType<typeof serve>>;
const saved: Record<string, string | undefined> = {};
const getJson = async (p: string) => (await fetch(`http://127.0.0.1:${server.port}${p}`)).json() as Promise<any>;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-specs-"));
  const a = join(base, "a"), b = join(base, "b"), c = join(base, "c");
  mkdirSync(join(a, "docs", "specs"), { recursive: true });
  mkdirSync(join(b, "docs", "specs"), { recursive: true });
  mkdirSync(c);
  writeFileSync(join(a, "docs", "specs", "2026-10-01-alpha.md"), "intro\n\n# Alpha spec\n\n- one\n\n<script>x</script>\n");
  writeFileSync(join(a, "docs", "specs", "2026-10-05-beta.md"), "no heading here\n");
  writeFileSync(join(a, "docs", "specs", "notes.txt"), "skipped");
  writeFileSync(join(b, "docs", "specs", "2026-09-01-gamma.md"), "# Gamma\n");
  const remote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ a: { path: a }, b: { path: b }, c: { path: c } }));
  for (const [k, val] of Object.entries({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_ITEMS: items, ALEPH_FACTORY_DIR: join(base, "factory") })) {
    saved[k] = process.env[k];
    process.env[k] = val;
  }
  Object.assign(process.env, gitEnv);
  server = await serve(0, { warm: false });
});
afterAll(() => {
  server.stop(true);
  for (const [k, val] of Object.entries(saved)) if (val === undefined) delete process.env[k]; else process.env[k] = val;
  rmSync(base, { recursive: true, force: true });
});

describe("specs", () => {
  test("/api/specs lists one row per .md file, newest first, with date, title and project", async () => {
    const d = await getJson("/api/specs");
    expect(d).toEqual([
      { project: "a", file: "2026-10-05-beta.md", date: "2026-10-05", title: "2026-10-05-beta.md" },
      { project: "a", file: "2026-10-01-alpha.md", date: "2026-10-01", title: "Alpha spec" },
      { project: "b", file: "2026-09-01-gamma.md", date: "2026-09-01", title: "Gamma" },
    ]);
  });

  test("?project= keeps one project; /api/contents carries the specs and honours it", async () => {
    expect((await getJson("/api/specs?project=b")).map((s: any) => s.file)).toEqual(["2026-09-01-gamma.md"]);
    expect((await getJson("/api/contents")).specs.length).toBe(3);
    expect((await getJson("/api/contents?project=b")).specs.map((s: any) => s.project)).toEqual(["b"]);
  });

  test("/api/specs/:project/:file gives the body; unknown or unsafe names are 404", async () => {
    const s = await getJson("/api/specs/a/2026-10-01-alpha.md");
    expect(s.title).toBe("Alpha spec");
    expect(s.body).toContain("- one");
    for (const p of ["/api/specs/a/nope.md", "/api/specs/zz/x.md", "/api/specs/a/notes.txt", "/api/specs/a/..%2F..%2Frepos.json"]) {
      expect((await fetch(`http://127.0.0.1:${server.port}${p}`)).status).toBe(404);
    }
  });

  test("Contents shows a Specs table after Issues: Date, Title, Project, rows link to the spec page", async () => {
    const d = await getJson("/api/contents");
    const h = v.view.render(d, {}, new URLSearchParams());
    expect(h.indexOf("<h2>Issues")).toBeLessThan(h.indexOf("<h2>Specs"));
    expect(h).toContain('<h2>Specs <small class="quiet">3</small></h2>');
    const t = h.split('<div id="specs-table">')[1].split("</table>")[0];
    expect([...t.matchAll(/<th class="c-(\w+)"/g)].map((m) => m[1])).toEqual(["date", "title", "project"]);
    expect(t).toContain('data-sort="date"');
    expect(t).toContain('<a href="#/specs/a/2026-10-01-alpha.md">Alpha spec</a>');
    expect(t.indexOf("2026-10-05")).toBeLessThan(t.indexOf("2026-09-01"));
  });

  test("the Project filter and the header sort apply to the Specs table", async () => {
    const d = await getJson("/api/contents");
    const h = v.view.render(d, {}, new URLSearchParams("project=b"));
    expect(h).toContain('<h2>Specs <small class="quiet">1</small></h2>');
    expect(h).toContain("Gamma");
    expect(h.split('<div id="specs-table">')[1]).not.toContain("Alpha spec");
    expect(v.view.render({ specs: [] }, {}, new URLSearchParams())).toContain("No spec matches.");
    const up = v.view.render(d, {}, new URLSearchParams("ssort=title&sdir=asc")).split('<div id="specs-table">')[1];
    expect(up.indexOf("2026-10-05-beta.md")).toBeLessThan(up.indexOf("Alpha spec"));
    expect(up.indexOf("Alpha spec")).toBeLessThan(up.indexOf("Gamma"));
  });

  test("the spec page renders the Markdown, escaping HTML", async () => {
    const s = await getJson("/api/specs/a/2026-10-01-alpha.md");
    expect(specView.path).toBe("/specs/:project/:file");
    expect(specView.api({ project: "a", file: "x.md" })).toBe("/api/specs/a/x.md");
    const h = specView.render(s);
    expect(h).toContain("<li>one</li>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("<h1>Alpha spec</h1>");
  });
});
