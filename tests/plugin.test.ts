import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(
  readFileSync(join(import.meta.dir, "../.claude-plugin/plugin.json"), "utf8"),
);
const description: string = manifest.description;

describe("plugin.json description", () => {
  test("holds no count of skills", () => {
    expect(description).not.toMatch(
      /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+skills\b/i,
    );
  });

  test("still names the skills, the hooks and the vault", () => {
    expect(description).toMatch(/skills/i);
    expect(description).toMatch(/hooks/i);
    expect(description).toMatch(/vault/i);
  });
});
