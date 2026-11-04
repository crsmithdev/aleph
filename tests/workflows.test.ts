/**
 * Every workflow file in .github/workflows/ parses as YAML with a `jobs` key. The parser must also reject a plain
 * scalar that contains ": ", so a pass on the real files means the parser checks YAML.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", ".github", "workflows");

for (const file of readdirSync(DIR).filter((name) => name.endsWith(".yml"))) {
  test(`${file} parses as YAML with a jobs key`, () => {
    // The 7b5bdf514 form of ci.yml: the parser must reject it, or a pass below means nothing.
    const text = 'steps:\n  - run: echo "runner cores: $(nproc)" && bun run test:all\n';
    expect(() => Bun.YAML.parse(text)).toThrow();
    const parsed = Bun.YAML.parse(readFileSync(join(DIR, file), "utf8"));
    expect(parsed).toHaveProperty("jobs");
  });
}
