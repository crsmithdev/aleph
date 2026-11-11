import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { passed } from "./keep-earn.ts";

test("passed decodes the entities of a junit case name", () => {
  const dir = mkdtempSync(join(tmpdir(), "keep-earn-"));
  writeFileSync(join(dir, ".keep-earn.xml"), `<testsuites><testsuite name="a.test.ts"><testcase name="a &quot;b&quot; &amp; c" classname="x" file="a.test.ts"/></testsuite></testsuites>`);
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    expect(passed(["a.test.ts"])?.has(`a.test.ts > a "b" & c`)).toBe(true);
  } finally {
    process.chdir(cwd);
  }
});
