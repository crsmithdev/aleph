import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { isVersion, missingSections, oracleCommands, outsideSurface, specVersion, surfacePaths } from "./issue-spec.ts";

const SPEC = "## Goal\nShip it.\n\n## Edit surface (the files the run may change)\n- `jobs/lib/infra/layout.ts` (new)\n- ui/views/now.js: the row.\n- README.md\n\n## Oracle\n- `bun test jobs/lib/infra/layout.test.ts` passes.\n";
const item = (over: { title?: string; request?: string; spec?: string } = {}) => ({ title: "T", request: "R", spec: SPEC, ...over }) as any;

test("missingSections names each required section that is absent or empty, in order", () => {
  expect(missingSections(SPEC)).toEqual([]);
  expect(missingSections("## Goal\nx\n## Oracle\ny")).toEqual(["Edit surface"]);
  expect(missingSections("## Goal\n\n## Edit surface\na.ts\n")).toEqual(["Goal", "Oracle"]);
  expect(missingSections("")).toEqual(["Goal", "Edit surface", "Oracle"]);
});

test("surfacePaths lists the paths of the Edit surface only, without trailing dots", () => {
  const paths = surfacePaths(SPEC);
  expect(paths).toEqual(expect.arrayContaining(["jobs/lib/infra/layout.ts", "ui/views/now.js", "README.md"]));
  expect(paths).not.toContain("jobs/lib/infra/layout.test.ts");
  expect(surfacePaths("## Edit surface\nChange a/b.ts.")).toEqual(["Change", "a/b.ts"]);
  expect(surfacePaths("## Goal\nx")).toEqual([]);
});

test("a ./ before a path of the Edit surface or a changed file does not change what is inside", () => {
  expect(outsideSurface("## Edit surface\n- ./src/a.ts\n- ./lib/", ["src/a.ts", "./lib/b.ts", "src/c.ts"])).toEqual(["src/c.ts"]);
});

test("specVersion is short and changes with the title, the request or the spec", () => {
  const v = specVersion(item());
  expect(v).toMatch(/^[0-9a-f]{12}$/);
  expect(specVersion(item())).toBe(v);
  for (const over of [{ title: "U" }, { request: "S" }, { spec: SPEC + "more" }]) expect(specVersion(item(over))).not.toBe(v);
});

test("isVersion takes the version now and the older forms, and refuses a version of another text", () => {
  const i = item();
  expect(isVersion(i, specVersion(i) + "\n")).toBe(true);
  // The spec check's notes before issue-spec.ts: a hash of the trimmed spec.
  expect(isVersion(i, createHash("sha256").update(SPEC.trim()).digest("hex").slice(0, 12))).toBe(true);
  // The rescue's asked-spec files before issue-spec.ts: the JSON text of the title, request and spec.
  expect(isVersion(i, JSON.stringify(["T", "R", SPEC]))).toBe(true);
  expect(isVersion(i, specVersion(item({ request: "S" })))).toBe(false);
  expect(isVersion(i, JSON.stringify(["T", "S", SPEC]))).toBe(false);
});

test("a placeholder of more than one word is not runnable; a redirection with a space is", () => {
  const body = "## Oracle\n`bun test <that file>`\n`bun test <test file path>`\n`bun test jobs/lib/infra/layout.test.ts 2>&1`\n`bun test jobs/lib/infra/layout.test.ts <in >out`\n`bun test jobs/lib/infra/layout.test.ts > out.log`";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/infra/layout.test.ts 2>&1", "bun test jobs/lib/infra/layout.test.ts <in >out", "bun test jobs/lib/infra/layout.test.ts > out.log"]);
});

test("a bun test file without .test or .spec in its name gets a ./ path; other arguments stay", () => {
  const body = "## Oracle\n`bun test acceptance/ui/lib.accept.ts`\n`bun test ./acceptance/a.accept.ts jobs/lib/infra/layout.test.ts -t x`\n`bunx tsc`";
  expect(oracleCommands(body)).toEqual(["bun test ./acceptance/ui/lib.accept.ts", "bun test ./acceptance/a.accept.ts jobs/lib/infra/layout.test.ts -t x", "bunx tsc"]);
});
