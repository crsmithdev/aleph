import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const unit = readFileSync(join(import.meta.dir, "aleph-ui.service"), "utf8");

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
