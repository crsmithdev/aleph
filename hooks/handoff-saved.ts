#!/usr/bin/env bun
/**
 * PostToolUse on Write: when the written file is a project handoff
 * (<handoffs>/projects/*.md or a Herdr pane's <handoffs>/projects/<repo>/*.md), end the turn with the next step as the stop
 * reason. Any other path prints nothing.
 */
import { dirname, join, resolve } from "node:path";
import { handoffsDir } from "../lib/paths.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
const path = String(input.tool_input?.file_path ?? "");
const projects = join(resolve(handoffsDir()), "projects");
const at = dirname(resolve(path));
if (!path.endsWith(".md") || (at !== projects && dirname(at) !== projects)) process.exit(0);

console.log(JSON.stringify({
  continue: false,
  stopReason: `Handoff saved to ${path}. Run /clear; the next session picks it up on your first prompt.`,
}));
