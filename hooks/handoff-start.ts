#!/usr/bin/env bun
/**
 * SessionStart on startup and /clear: show Chris the summary line of each
 * handoff that waits for this session, and tell Claude to pick it up on the
 * first prompt. A handoff waits for the session when it is the project's
 * handoff at <handoffs>/projects/<scope>.md, or a named handoff at
 * <handoffs>/<name>.md whose `cwd:` line is the session's directory or one
 * that holds it. The full handoff texts and the session directory's
 * `git status` and `git log -5` go in the context when they stay within
 * 10,000 characters. Inside Herdr (HERDR_ENV=1, HERDR_PANE_ID set) the project
 * handoff of this pane is <handoffs>/projects/<scope>/<pane>.md, and the
 * hook lists each other file of that folder whose pane Herdr no longer has
 * as orphaned: Claude asks before it picks one up. There the flat file is
 * picked up by its path, as pickup with no argument reads the pane's file.
 * No handoff, no output.
 * Headless (`claude -p`) sessions and factory jobs are skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { handoffsDir } from "../lib/paths.ts";
import { repoScope } from "../vault/lib/vault.ts";
import { probe } from "../lib/git.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
if (process.env.ALEPH_JOB_ID || process.env.CLAUDE_CODE_ENTRYPOINT?.startsWith("sdk")) process.exit(0);

const cwd = resolve(input.cwd ?? process.cwd());
const scope = repoScope(cwd);
const dir = handoffsDir();
const own = join(dir, "projects", `${scope}.md`);
const under = (text: string) => {
  const at = text.match(/^cwd:\s*(.+)$/m)?.[1].trim();
  return !!at && (cwd === resolve(at) || cwd.startsWith(`${resolve(at)}/`));
};
const pane = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined;
const folder = join(dir, "projects", scope);
const live = pane ? Bun.spawnSync(["herdr", "pane", "list"], { stdout: "pipe", stderr: "ignore" }) : undefined;
const has = (id: string) => new RegExp(`(^|[^\\w:-])${id.replace(/\W/g, "\\$&")}([^\\w:-]|$)`).test(live!.stdout.toString());
const panes = pane && existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : [];
const mine = panes.filter((id) => id === pane);
const orphans = live?.exitCode === 0 ? panes.filter((id) => id !== pane && !has(id)) : [];
const named = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && !/^\d{4}-\d\d-\d\d-/.test(f)) : [];
const pick = (id: string, orphan: boolean) => ({ path: join(folder, `${id}.md`), name: "", orphan, text: readFileSync(join(folder, `${id}.md`), "utf8") });
const handoffs = [
  ...mine.map((id) => pick(id, false)),
  ...(existsSync(own) ? [{ path: own, name: "", orphan: false, text: readFileSync(own, "utf8") }] : []),
  ...named.map((f) => ({ path: join(dir, f), name: f.slice(0, -3), orphan: false, text: readFileSync(join(dir, f), "utf8") })).filter((h) => under(h.text)),
  ...orphans.map((id) => pick(id, true)),
];
if (!handoffs.length) process.exit(0);

const when = (path: string) => {
  const at = statSync(path).mtime;
  const hhmm = at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return at.toDateString() === new Date().toDateString() ? hhmm : `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${hhmm}`;
};
const summary = (text: string) => text.match(/^summary:\s*(.+)$/m)?.[1].trim() ?? "no summary line";

const short = handoffs.map((h) => h.orphan ? `An orphaned handoff waits at ${h.path}: ${summary(h.text)}. Its Herdr pane is gone. Ask Chris whether to pick it up. Do not run the aleph:pickup skill on your own; if Chris says yes, run it with the argument ${h.path}.` : `A handoff ${h.name ? `named ${h.name}` : "for this project"} waits at ${h.path}: ${summary(h.text)}. On the user's first prompt, run the aleph:pickup skill ${h.name || (pane && h.path === own) ? `with the argument ${h.name || own}` : "with no argument"} before anything else, unless that prompt is plainly about other work; then do that work and say in one line that the handoff still waits.`).join("\n");
const status = probe(cwd, "status");
const gitPart = status.ok ? `\n\ngit status:\n${status.out}\n\ngit log -5:\n${probe(cwd, "log", "-5").out}` : "";
const texts = handoffs.map((h) => `${h.path}:\n\n${h.text.trim()}`).join("\n\n");
const full = `${short}\n\nThe handoff text follows. The pickup skill needs no Read of the file.\n\n${texts}${gitPart}`;
const additionalContext = full.length > 10000 ? short : full;

console.log(JSON.stringify({
  systemMessage: handoffs.map((h) => `handoff ${h.orphan ? "orphaned" : "waiting"} (${h.name || scope}, ${when(h.path)}): ${summary(h.text)}`).join("\n"),
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext,
  },
}));
