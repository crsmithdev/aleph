import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const factory = mkdtempSync(join(tmpdir(), "aleph-episode-open-"));
afterAll(() => rmSync(factory, { recursive: true, force: true }));

async function hook(input: object): Promise<void> {
  const p = Bun.spawn(["bun", join(import.meta.dir, "episode-open.ts")], { stdin: new Blob([JSON.stringify(input)]), env: { ...process.env, ALEPH_FACTORY_DIR: factory } });
  await p.exited;
}

test("a Read or a Bash call that names an episode page logs it opened; other paths log nothing", async () => {
  const page = join(factory, "episodes", "aleph-7 Show the push error.md");
  await hook({ session_id: "s1", tool_name: "Read", tool_input: { file_path: page } });
  await hook({ session_id: "s2", tool_name: "Bash", tool_input: { command: `cat "${page}" | head; cat "${join(factory, "episodes", "aleph-8 Two.md")}"` } });
  await hook({ session_id: "s3", tool_name: "Read", tool_input: { file_path: "/tmp/notes.md" } });
  const lines = readFileSync(join(factory, "episode-use.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(lines.map(({ title, event, session }) => ({ title, event, session }))).toEqual([
    { title: "aleph-7 Show the push error", event: "opened", session: "s1" },
    { title: "aleph-7 Show the push error", event: "opened", session: "s2" },
    { title: "aleph-8 Two", event: "opened", session: "s2" },
  ]);
});
