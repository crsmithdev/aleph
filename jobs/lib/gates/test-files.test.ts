import { expect, test } from "bun:test";
import { isTestFile } from "./test-files";

test("isTestFile", () => {
  for (const p of ["src/a.test.ts", "x.accept.ts", "a.spec.js", "tests/helper.ts", "pkg/test/h.ts", "a/__tests__/h.ts", "pkg/test_a.py", "pkg/a_test.py", "pkg/a_test.go"]) expect([p, isTestFile(p)]).toEqual([p, true]);
  for (const p of ["src/a.ts", "src/latest/a.ts", "pkg/atest_a.py"]) expect([p, isTestFile(p)]).toEqual([p, false]);
});
