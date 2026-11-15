#!/usr/bin/env bun
/**
 * Detached by handoff-saved: wait until the pane or terminal is idle, then
 * clear the session and pick up its handoff. Usage: handoff-cycle.ts <herdr|hc> <pane or terminal> <handoff path>.
 * A failed step stops the cycle.
 */
const [runtime, id, path] = process.argv.slice(2);
const steps = runtime === "hc" ? [
  ["hc", "wait", id],
  ["hc", "send", id, "/clear"],
  ["hc", "wait", id],
  ["hc", "send", id, `/aleph:pickup ${path}`],
] : [
  // done is idle after unseen work, which a pane in an unfocused tab reports; blocked must not match.
  ["herdr", "agent", "wait", id, "--until", "idle", "--until", "done"],
  ["herdr", "agent", "prompt", id, "/clear", "--wait"],
  ["herdr", "agent", "prompt", id, `/aleph:pickup ${path}`, "--wait"],
];
for (const step of steps) {
  if (Bun.spawnSync(step, { stdout: "ignore", stderr: "ignore" }).exitCode) process.exit(1);
}
