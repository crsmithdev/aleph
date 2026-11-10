import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { timer } from "./systemd.ts";

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
