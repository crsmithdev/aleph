// Archived goal tests from ui/memory.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "../../ui/test-server.ts";
import { clearCache } from "../../ui/api/memory.ts";
// @ts-ignore plain JS, shared with the page
import { md, priorityBadge } from "../../ui/lib.js";
// @ts-ignore
import * as v from "../../ui/views/memory.js";
// @ts-ignore
import { view as noteView } from "../../ui/views/memory-note.js";

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void;
const at = (p: string) => fetch(`http://127.0.0.1:${server.port}${p}`);
const today = new Date().toISOString().slice(0, 10);

function note(dir: string, title: string, kind: string, scope: string, body: string) {
  writeFileSync(join(base, "vault", "wiki", dir, `${title}.md`),
    `---\nkind: ${kind}\nscope: ${scope}\nconfidence: measured\nupdated: ${today}\nsupersedes: []\nsources: [trace:abc123]\n---\n${body}\n`);
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-memory-"));
  const root = join(base, "vault");
  for (const d of ["decisions", "gotchas", "concepts"]) mkdirSync(join(root, "wiki", d), { recursive: true });
  mkdirSync(join(root, "daily"));
  writeFileSync(join(root, "Home.md"), "# Home\n\n## Decisions\n\n- [[Use Bun]] — why we run on Bun\n\n## Gotchas\n\n- [[Other trap]] — elsewhere\n\nHealth: 2 notes\n");
  note("decisions", "Use Bun", "decision", "aleph", "**Claim.** We use Bun.\n\n## Related\n[[Other trap]]");
  note("gotchas", "Other trap", "gotcha", "other", "**Claim.** A trap; see [[Use Bun]].");
  note("concepts", "Bunny", "concept", "aleph", "**Claim.** Mentions bun in the body.");
  writeFileSync(join(root, "MEMORY.md"), "# Memory\n\nChris prefers short answers.\n");
  mkdirSync(join(root, "wiki", "episodes"), { recursive: true });
  note("episodes", "Goal aleph-1", "episode", "aleph", "**Claim.** It went fine.");
  const hand = join(base, "handoffs");
  mkdirSync(hand);
  writeFileSync(join(hand, "current.md"), "# Handoff\n\n## Intent\n\nFinish the memory tab.\n");
  writeFileSync(join(hand, "2026-10-01-120000-x.md"), "## Intent\nOld work.\n");
  const restoreHandoffs = withEnv({ ALEPH_HANDOFFS_DIR: hand });
  writeFileSync(join(root, "daily", `${today}.md`), `# ${today}\n\n- 10:00 write [[Use Bun]] — why\n- 10:05 write [[Other trap]] — why\n`);
  // A closed port makes `vault misses` fail whatever keys a dotenv file supplies; the cache is cleared so no answer from an earlier file in this worker is served.
  const restoreVault = withEnv({ ALEPH_VAULT: root, LANGFUSE_BASE_URL: "http://127.0.0.1:9", LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" });
  // memoryTypes reads the repo registry, the work store and the job runs: point them at small fixtures so the first request is quick and the TTL test's clock is not spent on the network or ~/.aleph.
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdio: "ignore" });
  git(base, "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  git(base, "clone", "-q", join(base, "items.git"), join(base, "items"));
  git(join(base, "items"), "commit", "-q", "--allow-empty", "-m", "start");
  git(join(base, "items"), "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), "{}");
  mkdirSync(join(base, "jobs"));
  const restoreStore = withEnv({ ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_JOBS_DIR: join(base, "jobs") });
  restoreEnv = () => { restoreStore(); restoreVault(); restoreHandoffs(); };
  clearCache();
  ({ server, stop } = await withServer());
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("every memory type has its block", async () => {
  const t: any = (await (await at("/api/memory")).json()).types;
  expect(t.working.current.intent).toBe("Finish the memory tab.");
  expect(t.working.archived.map((h: any) => [h.date, h.intent])).toEqual([["2026-10-01", "Old work."]]);
  expect(t.semantic.memory.first).toBe("Chris prefers short answers.");
  expect(t.semantic.notes.map((n: any) => n.title)).toContain("Use Bun");
  expect(t.episodic.episodes.map((n: any) => n.title)).toEqual(["Goal aleph-1"]);
  expect(t.episodic.daily.latest).toEqual([today]);
  expect(t.procedural.skills).toContain("vault");
  expect(t.procedural.claudeMd.path).toBe("identity/CLAUDE.md");
  for (const k of ["retrieval", "prospective", "gates"]) expect(t[k]).toBeDefined();
});
