import { expect, test } from "bun:test";

// `aleph help | head -1`: the reader closes the pipe after one line, and the CLI must not throw EPIPE.
test("aleph exits 0 with no error when stdout closes early", () => {
  const r = Bun.spawnSync(["bash", "-c", 'bun jobs/cli.ts help | head -1 >/dev/null; echo "${PIPESTATUS[0]}"'], { cwd: import.meta.dir + "/..", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  expect(r.stdout.toString().trim()).toBe("0");
});
