import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smokeLine, smokeProblem, smokeStep } from "./smoke.ts";

const dir = mkdtempSync(join(tmpdir(), "smoke-"));
let status = 200;
let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x", { status }) });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

test("a 2xx passes; a bad status and a closed port each give a reason", async () => {
  status = 200;
  expect(await smokeProblem(base)).toBeNull();
  status = 500;
  expect(await smokeProblem(base)).toBe("/ answered 500");
  expect(await smokeProblem("http://127.0.0.1:1")).toStartWith("/: ");
});

test("the health line needs two failures in a row, and a pass clears it", async () => {
  const file = join(dir, "sub", "smoke.json");
  status = 500;
  await smokeStep(file, base, Date.parse("2026-11-01T10:00:00Z"));
  expect(smokeLine(file)).toBeNull();
  await smokeStep(file, base, Date.parse("2026-11-01T10:05:00Z"));
  expect(smokeLine(file)).toBe("health: aleph-ui has failed its smoke test since 2026-11-01T10:00:00.000Z: / answered 500");
  status = 200;
  await smokeStep(file, base);
  expect(smokeLine(file)).toBeNull();
});
