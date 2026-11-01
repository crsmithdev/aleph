import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, repo, seedItem, setup, specFile, state, teardown } from "./cli.helpers";

beforeAll(() => {
  setup();
  const regs = JSON.parse(readFileSync(join(base, "repos.json"), "utf8"));
  regs.resfac = { path: repo, sandbox: true, autoland: true, checks: [] };
  writeFileSync(join(base, "repos.json"), JSON.stringify(regs));
});
afterAll(teardown);

test("a research goal runs with search and fetch only, brings no repo and does not land", async () => {
  const worker = join(base, "fake-research");
  const args = join(base, "research-args");
  writeFileSync(worker, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${args}\ncat > /dev/null\necho '{"type":"result","is_error":false,"result":"A report with no links."}'\n`);
  chmodSync(worker, 0o755);
  const id = seedItem("resfac", "Find it out", { areas: ["research"] }, "Goal: find it out");
  const r = await aleph(["job", "resfac", "res1", "--on", String(id), "--spec", specFile("Goal: find it out\n")], { ALEPH_WORKER_CMD: worker });
  const run = state(r.json.run);
  expect(run.condition).toBe("stuck");
  expect(run.reason).toBe("the report cites no source");
  expect(run.next).toBeUndefined();
  const argv = readFileSync(args, "utf8").split("\n");
  expect(argv[argv.indexOf("--tools") + 1]).toBe("WebSearch");
  expect(argv).toContain("--strict-mcp-config");
  expect(existsSync(join(repo, ".git", "refs", "heads", "factory", "res1"))).toBe(false);
}, 60_000);
