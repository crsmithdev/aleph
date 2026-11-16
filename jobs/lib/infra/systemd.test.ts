import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimerInterval, timer } from "./systemd.ts";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "aleph-systemd-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** timer() against a systemctl stand-in that runs `script`. */
function withSystemctl(script: string) {
  const bin = join(dir, `systemctl-${Math.random().toString(36).slice(2)}`);
  writeFileSync(bin, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const before = process.env.ALEPH_SYSTEMCTL;
  process.env.ALEPH_SYSTEMCTL = bin;
  try { return timer("aleph-tick.timer"); }
  finally { if (before === undefined) delete process.env.ALEPH_SYSTEMCTL; else process.env.ALEPH_SYSTEMCTL = before; }
}
const list = (json: string) => `[ "$2" = list-timers ] && echo '${json}' && exit 0`;

test("next is the list-timers next field, from microseconds to ms", () => {
  expect(withSystemctl(`${list('[{"unit":"aleph-tick.timer","next":1793383745000000}]')}\nexit 1`))
    .toEqual({ next: 1793383745000, running: false, err: null });
});

test("no next run and the service activating or active is a running tick", () => {
  for (const word of ["activating", "active"]) expect(withSystemctl(`${list('[{"unit":"aleph-tick.timer","next":null}]')}\necho ${word}; exit 3`)).toEqual({ next: null, running: true, err: null });
});

test("no next run and the service failed or inactive is a dead timer", () => {
  for (const word of ["failed", "inactive"]) expect(withSystemctl(`${list("[]")}\necho ${word}; exit 3`)).toEqual({ next: null, running: false, err: null });
});

test("systemctl failing gives its first line as err", () => {
  expect(withSystemctl("echo 'Failed to connect to bus'; exit 1")).toEqual({ next: null, running: false, err: "Failed to connect to bus" });
});

test("setTimerInterval writes the drop-in with the unit file's boot triggers, then reloads and restarts the timer", () => {
  const bin = join(dir, "systemctl-set"), units = join(dir, "units"), calls = join(dir, "calls");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${calls}\n`, { mode: 0o755 });
  const before = { bin: process.env.ALEPH_SYSTEMCTL, units: process.env.ALEPH_UNIT_DIR };
  process.env.ALEPH_SYSTEMCTL = bin; process.env.ALEPH_UNIT_DIR = units;
  try {
    expect(setTimerInterval("tick", "5min")).toBeNull();
    expect(setTimerInterval("tick", "5 min")).toContain("whole number");
    expect(setTimerInterval("nope", "5min")).toContain("only tick and suite");
  } finally {
    if (before.bin === undefined) delete process.env.ALEPH_SYSTEMCTL; else process.env.ALEPH_SYSTEMCTL = before.bin;
    if (before.units === undefined) delete process.env.ALEPH_UNIT_DIR; else process.env.ALEPH_UNIT_DIR = before.units;
  }
  const conf = readFileSync(join(units, "aleph-tick.timer.d", "interval.conf"), "utf8");
  expect(conf).toContain("[Timer]\nOnUnitActiveSec=\n");
  expect(conf).toMatch(/OnBootSec=/);
  expect(conf).toContain("OnUnitActiveSec=5min\n");
  expect(readFileSync(calls, "utf8")).toBe("--user daemon-reload\n--user restart aleph-tick.timer\n");
});
