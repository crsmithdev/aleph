import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blind, runAb, unblind, type Row } from "./ab.ts";

const dir = mkdtempSync(join(tmpdir(), "ab-"));
const log = join(dir, "argv.jsonl");
const judgeLog = join(dir, "judge-prompt.txt");
const variants = [{ name: "alpha-skill", dir: "/plugins/alpha" }, { name: "beta-skill", dir: "/plugins/beta" }];

/** A stand-in for `claude`: a run answers with a session id and a cost, in text that names no variant; the judge (it has no --plugin-dir) logs its prompt and scores the label of the alpha run's text 9 and the others 3. */
const stub = join(dir, "claude-stub.ts");
writeFileSync(stub, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + "\\n");
const at = argv.indexOf("--plugin-dir");
if (at < 0) {
  const prompt = await Bun.stdin.text();
  appendFileSync(${JSON.stringify(judgeLog)}, prompt);
  const scores = [...prompt.matchAll(/## (O\\d+)\\n(.*)/g)].map((m) => ({ label: m[1], scores: { quality: m[2].includes("short") ? 9 : 3 } }));
  process.stdout.write(JSON.stringify({ structured_output: { scores } }));
} else {
  const who = argv[at + 1].split("/").pop();
  process.stdout.write(JSON.stringify({ result: who === "alpha" ? "a short answer" : "a long answer", session_id: "sess-" + who + "-" + Math.random().toString(36).slice(2), total_cost_usd: who === "alpha" ? 0.25 : 0.5 }));
}
`);
chmodSync(stub, 0o755);

const posts: any[] = [];
const server = Bun.serve({ port: 0, async fetch(req) { posts.push({ path: new URL(req.url).pathname, body: await req.json() }); return Response.json({ id: "x" }); } });
let rows: Row[];

beforeAll(async () => {
  const cfg = { baseUrl: `http://127.0.0.1:${server.port}`, publicKey: "pk", secretKey: "sk" };
  rows = await runAb({ variants, cases: [{ prompt: "do the thing", cwd: dir }], cmd: stub, cfg });
});
afterAll(() => server.stop(true));

test("a run with no runs flag starts 3 runs per variant, each with its own plugin dir", () => {
  const runs = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]).filter((a) => a.includes("--plugin-dir"));
  expect(runs.map((a) => a[a.indexOf("--plugin-dir") + 1])).toEqual([...Array(3).fill("/plugins/alpha"), ...Array(3).fill("/plugins/beta")]);
  expect(rows.length).toBe(6);
});

test("the judge prompt has only anonymous labels, and a scored label maps back to its variant for every order", () => {
  const outputs = ["answer from alpha 1", "answer from alpha 2", "answer from beta 1", "answer from beta 2"];
  const perms = (xs: number[]): number[][] => xs.length < 2 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  const judge = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]).filter((a) => !a.includes("--plugin-dir"));
  expect(judge.length).toBe(1);
  const sent = readFileSync(judgeLog, "utf8");
  expect([...sent.matchAll(/## (O\d+)\n/g)].map((m) => m[1])).toEqual(["O1", "O2", "O3", "O4", "O5", "O6"]);
  for (const leak of [...variants.map((v) => v.name), ...variants.map((v) => v.dir), "alpha", "beta", "plugins"]) {
    expect(sent).not.toContain(leak);
    expect(judge[0].join(" ")).not.toContain(leak);
  }
  const all = perms([0, 1, 2, 3]);
  expect(all.length).toBe(24);
  for (const p of all) {
    const { prompt, order } = blind("task", outputs.map((_, i) => `output ${i}`), () => p);
    // The judge scores label k with the index it sees in the text.
    const answer = { scores: [...prompt.matchAll(/## (O\d+)\noutput (\d)/g)].map((m) => ({ label: m[1], scores: { quality: Number(m[2]) } })) };
    expect(answer.scores.length).toBe(4);
    const back = unblind(answer, order);
    expect([...back.entries()].map(([at, s]) => [at, s.quality])).toEqual(expect.arrayContaining([[0, 0], [1, 1], [2, 2], [3, 3]]));
  }
});

test("each run's session gets the judge's scores and one cost score", () => {
  const scores = posts.filter((p) => p.path === "/api/public/scores").map((p) => p.body);
  expect(scores.length).toBe(12);
  for (const r of rows) {
    expect(r.session).toStartWith(r.variant === "alpha-skill" ? "sess-alpha-" : "sess-beta-");
    const mine = scores.filter((s) => s.sessionId === r.session).map((s) => [s.name, s.value]);
    expect(mine).toEqual([["quality", r.variant === "alpha-skill" ? 9 : 3], ["cost", r.variant === "alpha-skill" ? 0.25 : 0.5]]);
  }
});
