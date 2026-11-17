#!/usr/bin/env bun
/**
 * PostToolUse on Write: when the written file is a project handoff
 * (<handoffs>/projects/*.md or a terminal's <handoffs>/projects/<repo>/*.md), end the turn with the next step as the stop
 * reason. Inside Herdr (HERDR_ENV=1, HERDR_PANE_ID set), when the file is this
 * pane's, also start handoff-cycle.ts detached: it clears the pane and picks the file up
 * once the pane is idle. Inside the Herdr desktop app (HC_TERMINAL_ID set, and
 * no Herdr pane), the file is hc-<HC_TERMINAL_ID>.md and the cycle runs on `hc`.
 * Any other path prints nothing.
 */
import { join } from "node:path";
import { handoffOf } from "../lib/handoffs.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
const path = String(input.tool_input?.file_path ?? "");
const h = handoffOf(path);
if (h?.kind !== "project" && h?.kind !== "pane") process.exit(0);

const pane = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined;
const term = !pane ? process.env.HC_TERMINAL_ID : undefined;
const me = pane ?? (term ? `hc-${term}` : undefined);
const cycle = h.kind === "pane" && h.name === me;
if (cycle) Bun.spawn(["bun", join(import.meta.dir, "handoff-cycle.ts"), pane ? "herdr" : "hc", pane ?? term!, h.path], { detached: true, stdio: ["ignore", "ignore", "ignore"] }).unref();

console.log(JSON.stringify({
  continue: false,
  stopReason: cycle
    ? `Handoff saved to ${path}. The session clears and picks up on its own; do not run /clear.`
    : `Handoff saved to ${path}. Run /clear; the next session picks it up on your first prompt.`,
}));
