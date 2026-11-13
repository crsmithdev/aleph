#!/usr/bin/env bun
/**
 * PostToolUse on Read and Bash, async: log each episode page the call opened
 * (lib/episode-use.ts). A Bash call counts when its command names the page's
 * path, as `cat` or `head` does.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { logUse } from "../lib/episode-use.ts";
import { layout } from "../lib/layout.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
const text = String(input.tool_input?.file_path ?? input.tool_input?.command ?? "").replaceAll("~/", `${homedir()}/`);
const titles = text.split(`${join(layout().factory, "episodes")}/`).slice(1).map((s) => /^(.+?)\.md/.exec(s)?.[1]).filter((t): t is string => !!t);
logUse("opened", [...new Set(titles)], input.session_id ?? null);
