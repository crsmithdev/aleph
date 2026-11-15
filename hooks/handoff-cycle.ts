#!/usr/bin/env bun
/**
 * Detached by handoff-saved: wait until Herdr reports the pane idle, then
 * clear the session and pick up the pane's handoff. Usage: handoff-cycle.ts <pane> <handoff path>.
 * A failed step stops the cycle.
 */
const [pane, path] = process.argv.slice(2);
const steps = [
  // done is idle after unseen work, which a pane in an unfocused tab reports; blocked must not match.
  ["agent", "wait", pane, "--until", "idle", "--until", "done"],
  ["agent", "prompt", pane, "/clear", "--wait"],
  ["agent", "prompt", pane, `/aleph:pickup ${path}`, "--wait"],
];
for (const step of steps) {
  if (Bun.spawnSync(["herdr", ...step], { stdout: "ignore", stderr: "ignore" }).exitCode) process.exit(1);
}
