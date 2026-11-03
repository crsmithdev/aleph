// Archived goal tests from jobs/systemd/systemd.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const unit = readFileSync(join((import.meta.dir + "/../../../jobs/systemd"), "aleph-ui.service"), "utf8");

test("aleph-ui.service keeps the UI unit's behaviour with %h paths", () => {
  expect(unit).toContain("ExecStart=%h/aleph/bin/aleph-ui --port 3020");
  expect(unit).toContain("WorkingDirectory=%h/aleph");
  expect(unit).toContain("Restart=always");
  expect(unit).toContain("RestartSec=2");
  expect(unit).toContain("WantedBy=default.target");
});

test("aleph-ui.service header gives the link command", () => {
  expect(unit).toContain("systemctl --user link ~/aleph/jobs/systemd/aleph-ui.service");
});

test("aleph-ui.service holds no /home/ path", () => {
  expect(unit).not.toContain("/home/");
});

test("docs/ui.md gives the link-and-enable step for aleph-ui.service", () => {
  const doc = readFileSync(join((import.meta.dir + "/../../../jobs/systemd"), "../../docs/ui.md"), "utf8");
  expect(doc).toContain("systemctl --user link ~/aleph/jobs/systemd/aleph-ui.service");
  expect(doc).toContain("systemctl --user enable --now aleph-ui.service");
  expect(doc).toContain("jobs/systemd/aleph-ui.service");
});
