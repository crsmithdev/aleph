// The investigator's routes: Investigate starts a detached run through the CLI, and File, Note and Dismiss on a
// recommended issue run the one issue path and record the fate on the run's result.json.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seed } from "../jobs/job.testkit.ts";
import { withEnv, withServer } from "./server.testkit.ts";

let base: string, calls: string, folder: string, id: string, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>;
const post = (path: string, body: object) => at(path, { method: "POST", headers: { "X-Aleph-UI": "1" }, body: JSON.stringify(body) });
const recorded = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
const fates = () => JSON.parse(readFileSync(join(folder, "result.json"), "utf8")).issues.map((i: { fate?: string }) => i.fate);
const finding = (title: string, existing: string | null = null) => ({ title, kind: "bug", spec: "Do it.", evidence: ["a.ts:1"], impact: 3, risk: 2, effort: 1, existing });

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-investigate-"));
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\nif [ "$1 $2" = "issue add" ]; then cat > ${calls}.stdin; echo '{"added":12}'; else echo '{}'; fi\n`);
  chmodSync(fake, 0o755);
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_DB: join(base, "aleph.db"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake });
  ({ id, folder } = seed({ role: "investigator", name: "issue.1", repo: "r", state: "done", started: "2026-11-20T06:30:00Z" } as any));
  writeFileSync(join(folder, "result.json"), JSON.stringify({ summary: "s", timeline: [], causes: [], issues: [finding("File this one"), finding("Note this one", "issue.2"), finding("Dismiss this one")] }));
  ({ stop, at } = await withServer({ warm: false }));
});
afterAll(() => { stop(); restoreEnv(); rmSync(base, { recursive: true, force: true }); });

test("Investigate starts a detached run on the subject through the CLI", async () => {
  expect((await post("/api/investigate", { subject: "issue.1" })).status).toBe(200);
  expect(recorded().at(-1)).toBe("investigate --detach -- issue.1");
});

test("File adds the issue with its spec, evidence and a ref to the subject, once", async () => {
  const path = `/api/investigations/${encodeURIComponent(id)}/0`;
  expect((await post(path, { act: "file" })).status).toBe(200);
  expect(recorded().at(-1)).toBe("issue add --spec - --kind bug --refs issue.1 -- r File this one");
  expect(readFileSync(`${calls}.stdin`, "utf8")).toContain("Evidence: a.ts:1");
  expect(fates()[0]).toBe("filed issue.12");
  const again = await post(path, { act: "file" });
  expect([again.status, (await again.json()).error]).toEqual([422, "already filed issue.12"]);
});

test("Note adds a note to the open issue that covers it, and Dismiss only records the fate", async () => {
  const before = recorded().length;
  expect((await post(`/api/investigations/${encodeURIComponent(id)}/1`, { act: "note" })).status).toBe(200);
  expect(recorded().at(-1)).toStartWith("issue note -- issue.2 Note this one: Do it.");
  expect((await post(`/api/investigations/${encodeURIComponent(id)}/2`, { act: "dismiss" })).status).toBe(200);
  expect(recorded().length).toBe(before + 1);
  expect(fates()).toEqual(["filed issue.12", "noted issue.2", "dismissed"]);
  expect((await post(`/api/investigations/${encodeURIComponent(id)}/9`, { act: "dismiss" })).status).toBe(404);
});
