import { test, expect, describe } from "bun:test";
import { openDb } from "../../src/platform/db.ts";
import { joinAudit, DEFAULT_BASELINE } from "../../src/obs/join-audit.ts";

function seed(rows: Array<[string, string]>) {
  const db = openDb(":memory:");
  let n = 0;
  for (const [trace, kind] of rows) {
    db.run(
      "INSERT INTO events (id, ts, kind, origin, trace_id, caused_by, actor, file, offset) VALUES (?,?,?,?,?,?,?,?,?)",
      [`evt_${++n}`, "2026-08-20T00:00:00.000Z", kind, "system", trace, null, "daemon", "x.jsonl", n],
    );
  }
  return db;
}

describe("join audit", () => {
  test("a turn trace is joined; boot events are classified orphans; delta stays 0", () => {
    const db = seed([
      ["a".repeat(32), "channel.message_received"],
      ["a".repeat(32), "session.turn_started"],
      ["a".repeat(32), "session.turn_completed"],
      ["b".repeat(32), "daemon.started"],
      ["c".repeat(32), "daemon.boot_step"],
    ]);
    const r = joinAudit(db, "2026-01-01T00:00:00.000Z", DEFAULT_BASELINE);
    expect(r.traces).toBe(3);
    expect(r.orphans).toBe(2);
    expect(r.baseline).toBe(2);
    expect(r.delta).toBe(0);
  });

  test("an unclassified orphan shows up as delta, with its kinds named", () => {
    const db = seed([
      ["a".repeat(32), "session.turn_started"],
      ["d".repeat(32), "routing.decided"],
    ]);
    const r = joinAudit(db, "2026-01-01T00:00:00.000Z", DEFAULT_BASELINE);
    expect(r.delta).toBe(1);
    expect(r.unexpected[0]!.kinds).toEqual(["routing.decided"]);
  });
});
