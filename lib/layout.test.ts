import { expect, test } from "bun:test";
import { conn } from "./db.ts";
import { eventsAfter, lastSeq, logEvent, logSetting, readEvents } from "./layout.ts";
import { sayText } from "./naming.ts";

const job = (id: string, role: string, extra: Record<string, unknown> = {}) =>
  conn().query("INSERT INTO jobs (id, role, by, state, made, started, project, target, model, tier, cost, commit_sha) VALUES (?, ?, 'rule', 'landed', 1, '2026-11-14T10:00:00Z', ?, ?, ?, ?, ?, ?)")
    .run(id, role, ...(["project", "target", "model", "tier", "cost", "commit"].map((k) => extra[k] ?? null) as [string, string, string, string, number, string]));

test("an event round-trips through event_rows with the fields of the jobs it names", () => {
  job("job.1", "build", { project: "project.1", target: "issue.9", model: "sonnet", tier: "worker-medium", cost: 1.5, commit: "abc1234" });
  job("job.2", "review", { project: "project.1", target: "issue.9" });
  const e = logEvent({ subject: "job.2", action: "returned", object: "job.1", detail: "a check failed" });
  const [row] = readEvents(0).filter((r) => r.seq === eventsAfter(0).at(-1)!.seq);
  expect(row).toMatchObject({ time: e.time, subject: "job.2", action: "returned", object: "job.1", detail: "a check failed", subject_role: "review", object_role: "build", object_target: "issue.9", project: "project.1", model: "sonnet", tier: "worker-medium", cost: 1.5, commit_sha: "abc1234" });
  expect(sayText(row)).toBe("J-00001 returned by review: a check failed");
});

test("readEvents keeps the order of seq and the window of its time", () => {
  const a = logEvent({ time: "2026-11-14T09:00:00.000Z", subject: "rule", action: "started", object: "w-old" });
  logEvent({ subject: "rule", action: "started", object: "w-new" });
  const names = (since: number) => readEvents(since).map((r) => r.object).filter((o) => o.startsWith("w-"));
  expect(names(0)).toEqual(["w-old", "w-new"]);
  expect(names(Date.parse(a.time) + 1)).toEqual(["w-new"]);
});

test("eventsAfter gives only the later events, and a setting is an event on settings", () => {
  const seq = lastSeq();
  logSetting("the factory is paused");
  expect(eventsAfter(seq).map((r) => [r.subject, r.action, r.object, r.detail])).toEqual([["human", "changed", "settings", "the factory is paused"]]);
});
