import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { triage } from "./triage.ts";
import * as issues from "./todo.ts";

let dir: string;
let server: ReturnType<typeof Bun.serve>;
let reply: { status: number; answers: Record<string, number> };
let asked: any[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-triage-"));
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: any = await req.json();
      asked.push(body);
      const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "noul", noul: reply.answers[id] ?? 0.1 }]));
      return Response.json(reply.status === 200 ? { model: "typesafe/jev-1.13", answers } : { error: { message: "down" } }, { status: reply.status });
    },
  });
  Object.assign(process.env, { ALEPH_JUDGE_FILE: join(dir, "judge"), ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
});
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); delete process.env.ALEPH_JUDGE; delete process.env.ALEPH_JUDGE_FILE; });
beforeEach(() => { asked = []; reply = { status: 200, answers: {} }; delete process.env.ALEPH_JUDGE; });

function list(n = 3): issues.Doc {
  const doc = issues.blank("r");
  issues.add(doc, "item one", { labels: ["obs"] });
  issues.add(doc, "item two", { labels: ["factory"] });
  for (let i = 3; i <= n; i++) issues.add(doc, `item ${i}`);
  return doc;
}

test("one noul per label and per open item, with the new item as state", async () => {
  await triage(list(), "new title", "new body");
  expect(asked[0].state).toEqual({ new_item: { title: "new title", body: "new body" } });
  const ids = Object.keys(asked[0].questions).sort();
  expect(ids).toEqual(["item:1", "item:2", "item:3", "label:factory", "label:obs"]);
  expect(Object.values<any>(asked[0].questions).every((q) => q.type === "noul")).toBe(true);
});

test("labels and duplicates at p >= 0.7", async () => {
  reply.answers = { "label:obs": 0.9, "label:factory": 0.2, "item:2": 0.8 };
  expect(await triage(list(), "t")).toEqual({ labels: ["obs"], maybeSame: [{ id: 2, title: "item two", p: 0.8 }] });
});

test("closed items are not asked about", async () => {
  const doc = list();
  issues.setStatus(doc.items[0], "done");
  await triage(doc, "t");
  expect(Object.keys(asked[0].questions)).not.toContain("item:1");
});

test("80 open items: at most 50 questions, newest first", async () => {
  await triage(list(80), "t");
  const ids = Object.keys(asked[0].questions);
  expect(ids.length).toBe(50);
  expect(ids).toContain("item:80");
  expect(ids).not.toContain("item:1");
});

test("a Jev error gives an empty triage", async () => {
  reply.status = 500;
  expect(await triage(list(), "t")).toEqual({ labels: [], maybeSame: [] });
});

test("with haiku, Jev is not asked", async () => {
  process.env.ALEPH_JUDGE = "haiku";
  expect(await triage(list(), "t")).toEqual({ labels: [], maybeSame: [] });
  expect(asked).toEqual([]);
});
