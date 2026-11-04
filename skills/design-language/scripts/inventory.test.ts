import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (text: string) => {
  const f = join(mkdtempSync(join(tmpdir(), "inv-")), "x.js");
  writeFileSync(f, text);
  const out = Bun.spawnSync(["bun", join(import.meta.dir, "inventory.ts"), f]).stdout.toString();
  return out.split("\n").filter(Boolean).map((l) => l.split("\t").slice(1));
};

test("font shorthand gives size and weight rows", () => {
  const r = run("a { font: 600 13px/1.4 var(--font); }");
  expect(r).toContainEqual(["size", "font", "13px", "literal"]);
  expect(r).toContainEqual(["type", "font", "600", "literal"]);
});

test("selector hex is not a colour, real one is", () => {
  expect(run('el.querySelector("#eff");').filter((x) => x[0] === "colour")).toEqual([]);
  expect(run("a { color: #eff; }").filter((x) => x[0] === "colour")).toHaveLength(1);
});

test("@media in a regex literal is not a media query, real one is", () => {
  expect(run("const M = /@media\\s*([^{]+)/g;").filter((x) => x[1] === "@media")).toEqual([]);
  expect(run("@media (max-width: 720px) {").filter((x) => x[1] === "@media")).toHaveLength(1);
});
