import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "./test-server.ts";
import { add, drop, read } from "../lib/annotations.ts";

let base: string, at: Awaited<ReturnType<typeof withServer>>["at"], stop: () => void, restoreEnv: () => void;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-annotations-"));
  restoreEnv = withEnv({ ALEPH_ANNOTATIONS: join(base, "notes", "annotations.json"), ALEPH_JOBS_DIR: join(base, "runs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ISSUES: join(base, "issues") });
  ({ at, stop } = await withServer({ warm: false }));
});

afterAll(() => { stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

const post = (path: string, body: unknown) => at(`/api/annotations${path}`, { method: "POST", headers: { "X-Aleph-UI": "1", "content-type": "application/json" }, body: JSON.stringify(body) });

test("a put runs aleph annotation, GET lists the note and a drop removes it", async () => {
  const note = { id: "n1", url: "/", selector: "h1", text: "", html: "", note: "hi", at: "2026-11-10T00:00:00Z" };
  expect((await post("", note)).status).toBe(200);
  expect(read().map((n) => [n.id, n.by, n.status])).toEqual([["n1", "you", "open"]]);
  expect(((await (await at("/api/annotations")).json()) as { note: string }[]).map((n) => n.note)).toEqual(["hi"]);
  // A note with no selector is refused: the CLI says why and the route answers 422.
  expect((await post("", { ...note, id: "n2", selector: "" })).status).toBe(422);
  expect((await post("/n1/drop", {})).status).toBe(200);
  expect(read()).toEqual([]);
  expect(await (await at("/api/annotations")).json()).toEqual([]);
});

test("a direct write to the file sends a change naming /api/annotations", async () => {
  const ctl = new AbortController();
  const reader = (await at("/api/events", { signal: ctl.signal })).body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toMatch(/^event: ping/);
  const { id } = add("h1", "direct", { url: "/" });
  try {
    let text = "";
    while (!/event: change\ndata: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
    ctl.abort();
    expect(JSON.parse(text.match(/event: change\ndata: (.*)\n/)![1]).keys).toContain("/api/annotations");
  } finally { drop(id); }
});
