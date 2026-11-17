import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trimUse } from "./episode-use.ts";
import { withEnv } from "../ui/server.testkit.ts";

let dir: string, restore: () => void;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "episode-use-"));
  restore = withEnv({ ALEPH_FACTORY_DIR: dir });
});
afterAll(() => { restore(); rmSync(dir, { recursive: true, force: true }); });

test("trimUse on a log whose last line is cut off keeps every whole line dated on or after the cut", () => {
  const file = join(dir, "episode-use.jsonl");
  const line = (date: string, title: string) => JSON.stringify({ date, title, event: "shown" });
  writeFileSync(file, [line("2026-11-01", "old"), line("2026-11-10", "cut day"), line("2026-11-12", "new")].join("\n") + '\n{"date":"2026-11-14","ti');
  trimUse("2026-11-10");
  expect(readFileSync(file, "utf8")).toBe(`${line("2026-11-10", "cut day")}\n${line("2026-11-12", "new")}\n`);
});
