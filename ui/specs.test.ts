import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/issues.js";
// @ts-ignore
import { view as specView } from "./views/spec.js";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]) {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}
let base: string, server: TestServer, stop: () => void, restoreEnv: () => void;
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
  restoreEnv = withEnv({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_ISSUES: items, ALEPH_FACTORY_DIR: join(base, "factory"), ...gitEnv });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

describe("specs", () => {
  test("/api/specs/:project/:file gives the body; unknown or unsafe names are 404", async () => {
    const s = await getJson("/api/specs/a/2026-10-01-alpha.md");
    expect(s.title).toBe("Alpha spec");
    expect(s.body).toContain("- one");
    for (const p of ["/api/specs/a/nope.md", "/api/specs/zz/x.md", "/api/specs/a/notes.txt", "/api/specs/a/..%2F..%2Frepos.json"]) {
      expect((await fetch(`http://127.0.0.1:${server.port}${p}`)).status).toBe(404);
    }
  });

  test("Issues shows no specs; the spec routes stay", async () => {
    const d = await getJson("/api/issues");
    expect(d).not.toHaveProperty("specs");
    expect(v.view.render(d, {}, new URLSearchParams())).not.toContain("<h2>Specs");
  });

  test("the spec page renders the Markdown, escaping HTML", async () => {
    const s = await getJson("/api/specs/a/2026-10-01-alpha.md");
    expect(specView.path).toBe("/specs/:project/:file");
    expect(specView.api({ project: "a", file: "x.md" })).toBe("/api/specs/a/x.md");
    const h = specView.render(s);
    expect(h).toContain("<li>one</li>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("<h1>Alpha spec</h1>");
    expect(h).toContain("<code>a/docs/specs/2026-10-01-alpha.md</code>");
    expect(h).toContain('class="status-row"');
  });
});
