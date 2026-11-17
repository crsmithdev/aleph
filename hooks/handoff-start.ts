#!/usr/bin/env bun
/**
 * SessionStart on startup and /clear: show Chris the summary line, else the
 * Intent line, of each handoff that waits for this session, and tell Claude to pick it up on the
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
 * Inside the Herdr desktop app (HC_TERMINAL_ID set, and no Herdr
 * pane) the same holds for <scope>/hc-<HC_TERMINAL_ID>.md: the hook lists each
 * other hc- file of that folder whose terminal `hc get` does not find as orphaned.
 * Each runtime ignores the other's files.
 * No handoff, no output.
 * Headless (`claude -p`) sessions and factory jobs are skipped.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { handoffs, intent, type Handoff } from "../lib/handoffs.ts";
import { repoScope } from "../vault/lib/vault.ts";
import { probe } from "../lib/git.ts";
import { jobId } from "../lib/env.ts";
import { clock } from "../lib/day.ts";

const input = JSON.parse((await Bun.stdin.text()) || "{}");
if (jobId() || process.env.CLAUDE_CODE_ENTRYPOINT?.startsWith("sdk")) process.exit(0);

const cwd = resolve(input.cwd ?? process.cwd());
const scope = repoScope(cwd);
const all = handoffs();
const own = all.find((h) => h.kind === "project" && h.scope === scope);
const under = (text: string) => {
  const at = text.match(/^cwd:\s*(.+)$/m)?.[1].trim();
  return !!at && (cwd === resolve(at) || cwd.startsWith(`${resolve(at)}/`));
};
const pane = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined;
const live = pane ? Bun.spawnSync(["herdr", "pane", "list"], { stdout: "pipe", stderr: "ignore" }) : undefined;
const has = (id: string) => new RegExp(`(^|[^\\w:-])${id.replace(/\W/g, "\\$&")}([^\\w:-]|$)`).test(live!.stdout.toString());
const term = !pane ? process.env.HC_TERMINAL_ID : undefined;
const me = pane ?? (term ? `hc-${term}` : undefined);
// A pane's file is <pane>.md, a desktop terminal's is hc-<terminal>.md; each runtime sees only its own.
const panes = me ? all.filter((h) => h.kind === "pane" && h.scope === scope && !!pane !== h.name.startsWith("hc-")) : [];
const gone = (id: string) => pane ? !has(id) : Bun.spawnSync(["hc", "get", id.slice(3)], { stdout: "ignore", stderr: "ignore" }).exitCode !== 0;
const orphans = pane && live?.exitCode !== 0 ? [] : panes.filter((h) => h.name !== me && gone(h.name));
const pick = (h: Handoff, orphan = false) => ({ path: h.path, name: h.kind === "named" ? h.name : "", orphan, text: readFileSync(h.path, "utf8") });
const waiting = [
  ...panes.filter((h) => h.name === me).map((h) => pick(h)),
  ...(own ? [pick(own)] : []),
  ...all.filter((h) => h.kind === "named").map((h) => pick(h)).filter((h) => under(h.text)),
  ...orphans.map((h) => pick(h, true)),
];
if (!waiting.length) process.exit(0);

const when = (path: string) => {
  const at = statSync(path).mtime;
  return at.toDateString() === new Date().toDateString() ? clock(at) : `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clock(at)}`;
};

const short = waiting.map((h) => h.orphan ? `An orphaned handoff waits at ${h.path}: ${intent(h.text)}. Its ${pane ? "Herdr pane" : "terminal"} is gone. Ask Chris whether to pick it up. Do not run the aleph:pickup skill on your own; if Chris says yes, run it with the argument ${h.path}.` : `A handoff ${h.name ? `named ${h.name}` : "for this project"} waits at ${h.path}: ${intent(h.text)}. On the user's first prompt, run the aleph:pickup skill ${h.name || (me && h.path === own?.path) ? `with the argument ${h.name || h.path}` : "with no argument"} before anything else, unless that prompt is plainly about other work; then do that work and say in one line that the handoff still waits.`).join("\n");
const status = probe(cwd, "status");
const gitPart = status.ok ? `\n\ngit status:\n${status.out}\n\ngit log -5:\n${probe(cwd, "log", "-5").out}` : "";
const texts = waiting.map((h) => `${h.path}:\n\n${h.text.trim()}`).join("\n\n");
const full = `${short}\n\nThe handoff text follows. The pickup skill needs no Read of the file.\n\n${texts}${gitPart}`;
const additionalContext = full.length > 10000 ? short : full;

console.log(JSON.stringify({
  systemMessage: waiting.map((h) => `handoff ${h.orphan ? "orphaned" : "waiting"} (${h.name || scope}, ${when(h.path)}): ${intent(h.text)}`).join("\n"),
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext,
  },
}));
