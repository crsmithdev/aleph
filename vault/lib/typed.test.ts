import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { today } from "../../lib/day.ts";
import { use } from "../../lib/langfuse.ts";
import { maintain } from "./maintain.ts";
import { archive, init, write } from "./ops.ts";

// The ops as functions: a result is data, and `root` is an argument, so an op runs against any vault whatever the environment names.
const KEYS = ["ALEPH_VAULT", "ALEPH_HANDOFFS_DIR", "ALEPH_BACKUPS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_JUDGE", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
let base = "", saved: Record<string, string | undefined> = {};

const draft = (title: string, supersedes = "[]"): string => {
  const path = join(base, `${title}.md`);
  const fm = `kind: gotcha\nscope: aleph\nconfidence: measured\nupdated: ${today()}\nsupersedes: ${supersedes}\nsources: [trace:abc123]\n`;
  writeFileSync(path, `---\n${fm}---\n**Claim.** ${title} does a thing, as of 2026-09-04.\n\n## Details\nd\n\n## Evidence\n- trace abc123\n\n## Related\n`);
  return path;
};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  base = mkdtempSync(join(tmpdir(), "vault-typed-"));
  Object.assign(process.env, {
    ALEPH_JUDGE: "haiku", ALEPH_HANDOFFS_DIR: join(base, "handoffs"), ALEPH_BACKUPS_DIR: join(base, "backups"), ALEPH_FACTORY_DIR: join(base, "factory"),
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  });
  use({ base: "http://down.test", observations: async () => { throw new Error("down"); } } as any);
});
afterEach(() => {
  use(null);
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  rmSync(base, { recursive: true, force: true });
});

test("write and archive return a commit on success and findings on a refusal", async () => {
  const root = join(base, "vault");
  expect((await init(root)).ok).toBe(true);

  const done = await write(root, draft("Typed Note"), "seed");
  expect(done).toMatchObject({ ok: true, value: { op: "write", title: "Typed Note", path: "wiki/gotchas/Typed Note.md" }, warnings: [] });
  expect(done.ok && done.value.commit).toMatch(/^[0-9a-f]{7,}$/);

  const refused = await write(root, draft("Bad Note", "[Nothing Here]"), "seed");
  expect(refused).toMatchObject({ ok: false, findings: [{ rule: "supersedes", note: "Bad Note" }] });
  expect(existsSync(join(root, "wiki/gotchas/Bad Note.md"))).toBe(false);

  const gone = await archive(root, "Typed Note", "over");
  expect(gone).toMatchObject({ ok: true, value: { op: "archive", title: "Typed Note", path: "archive/Typed Note.md", inbound: [] } });
  expect(await archive(root, "Typed Note", "again")).toMatchObject({ ok: false, findings: [{ rule: "archive", detail: "no live wiki note has that title" }] });
  expect(await write(join(base, "none"), draft("Lost"), "x")).toMatchObject({ ok: false, findings: [], error: `no vault at ${join(base, "none")}; run: aleph memory init` });
});

test("maintain keeps its own root for the lint and adopt it runs, whatever the environment names", async () => {
  const mine = join(base, "mine"), other = join(base, "other");
  await init(mine);
  await init(other);
  process.env.ALEPH_VAULT = other;
  // A note written into wiki/ that git has never seen: maintain adopts it.
  mkdirSync(join(mine, "wiki/gotchas"), { recursive: true });
  writeFileSync(join(mine, "wiki/gotchas/Loose Note.md"), readFileSync(draft("Loose Note"), "utf8"));

  const r = await maintain(mine, false);
  expect(r).toMatchObject({ ok: true, value: { adopt: [{ note: "Loose Note", adopted: true }] } });
  const log = Bun.spawnSync(["git", "-C", mine, "log", "--format=%s"]).stdout.toString();
  expect(log).toContain("adopt: Loose Note");
  expect(Bun.spawnSync(["git", "-C", other, "log", "--format=%s"]).stdout.toString()).not.toContain("adopt");
});
