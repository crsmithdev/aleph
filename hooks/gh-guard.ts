#!/usr/bin/env bun
/**
 * PreToolUse on Bash: a `gh` command that writes to a GitHub repo the user
 * does not own asks first. A post there reaches other people. Reads go
 * through. The target is the repo named by `-R`/`--repo`, by a github.com URL,
 * by `repos/<owner>/<repo>` in `gh api`, or else the origin of the directory
 * the command runs in. A write whose target cannot be found asks. The user is
 * `ALEPH_GH_USER`, or else the login of `gh api user`.
 */
/*
 * A hook that exits 1 does not block the tool, so a guard that throws before
 * its verdict exits 2 (deny) with its name and the error on stderr.
 */
import { resolve } from "node:path";
import { GH_USER_CMD } from "../lib/env.ts";
import { probe } from "../lib/git.ts";

try {
  const input = JSON.parse(await Bun.stdin.text());
  const command: string = input.tool_input?.command ?? "";
  if (!/\bgh\s/.test(command)) process.exit(0);

  const VERBS = new Set([
    "create", "comment", "edit", "close", "reopen", "delete", "merge", "review", "fork", "lock", "unlock",
    "pin", "unpin", "transfer", "ready", "rename", "archive", "unarchive", "sync", "set", "develop",
    "rerun", "cancel", "upload", "add", "remove", "enable", "disable", "run",
  ]);
  const WORD = `"[^"]*"|'[^']*'|[^\\s;&|()]+`;
  const unquote = (w: string) => w.replace(/^(["'])(.*)\1$/, "$2");

  /** The owner of a github.com remote URL, or null. */
  function remoteOwner(dir: string | null): string | null {
    if (!dir) return null;
    return probe(dir, "remote", "get-url", "origin").out.match(/github\.com[:/]([^/\s]+)\//)?.[1] ?? null;
  }

  /** The owner a write in `part` goes to, "" for a read, or null when the target is unknown. */
  function target(part: string, dir: string | null): string | null | "" {
    const m = part.match(/\bgh\s+(\S+)(?:\s+(\S+))?/);
    if (!m) return "";
    const [, group, verb] = m;
    if (group === "api") {
      const method = part.match(/(?:-X|--method)[\s=]+["']?(\w+)/)?.[1]?.toUpperCase();
      const fields = /\s(?:-[fF]|--field|--raw-field|--input)[\s=]/.test(part);
      const write = method ? method !== "GET" : fields && !/\bgraphql\b/.test(part);
      if (!write && !/\bmutation\b/.test(part)) return "";
      return part.match(/\brepos\/([^/\s"']+)\//)?.[1] ?? null;
    }
    if (!verb || !VERBS.has(verb)) return "";
    const named = part.match(new RegExp(`(?:-R|--repo)[\\s=]+(${WORD})`))?.[1];
    if (named) return unquote(named).replace(/^(?:https?:\/\/)?github\.com\//, "").split("/")[0];
    const url = part.match(/github\.com\/([^/\s"']+)\//)?.[1];
    if (url) return url;
    const positional = group === "repo" ? part.match(/\bgh\s+repo\s+\S+\s+([\w.-]+)\/[\w.-]+/)?.[1] : undefined;
    return positional ?? remoteOwner(dir);
  }

  let dir: string | null = input.cwd ?? process.cwd();
  const owners: (string | null)[] = [];
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const cd = part.match(new RegExp(`^\\s*cd\\s+(${WORD})`))?.[1];
    if (cd !== undefined) {
      const path = unquote(cd);
      dir = dir === null || (cd[0] !== "'" && /[$`]/.test(path)) ? null : resolve(dir, path.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
      continue;
    }
    const owner = target(part, dir);
    if (owner !== "") owners.push(owner);
  }
  if (owners.length === 0) process.exit(0);

  const user = process.env.ALEPH_GH_USER
    || Bun.spawnSync(GH_USER_CMD, { stdout: "pipe", stderr: "ignore" }).stdout.toString().trim();
  const foreign = owners.filter((o) => o === null || o.toLowerCase() !== user.toLowerCase());
  if (foreign.length === 0) process.exit(0);

  const named = foreign.map((o) => o ?? "an unknown owner").join(", ");
  console.log(JSON.stringify({ hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: `gh-guard: this command writes to a GitHub repo of ${named}, not of ${user || "the user"}. A post there reaches other people.`,
  } }));
} catch (e) {
  console.error(`gh-guard: the guard failed (${e instanceof Error ? (e.stack ?? e.message) : String(e)}), so this tool call is denied. Fix the hook and retry.`);
  process.exit(2);
}
