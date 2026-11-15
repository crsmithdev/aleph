#!/usr/bin/env bun
/**
 * PostToolUse on Write: when the written file is a project handoff
 * (<handoffs>/projects/*.md or a Herdr pane's <handoffs>/projects/<repo>/*.md), end the turn with the next step as the stop
 * reason. Inside Herdr (HERDR_ENV=1, HERDR_PANE_ID set), when the file is this
 * pane's, also start handoff-cycle.ts detached: it clears the pane and picks the file up
 * once the pane is idle. Any other path prints nothing.
 */
import { basename, dirname, join, resolve } from "node:path";
import { handoffsDir } from "../lib/paths.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
const path = String(input.tool_input?.file_path ?? "");
const projects = join(resolve(handoffsDir()), "projects");
const at = dirname(resolve(path));
if (!path.endsWith(".md") || (at !== projects && dirname(at) !== projects)) process.exit(0);

const pane = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined;
const cycle = !!pane && basename(path) === `${pane}.md` && dirname(at) === projects;
if (cycle) Bun.spawn(["bun", join(import.meta.dir, "handoff-cycle.ts"), pane, resolve(path)], { detached: true, stdio: ["ignore", "ignore", "ignore"] }).unref();

console.log(JSON.stringify({
  continue: false,
  stopReason: cycle
    ? `Handoff saved to ${path}. The session clears and picks up on its own; do not run /clear.`
    : `Handoff saved to ${path}. Run /clear; the next session picks it up on your first prompt.`,
}));
