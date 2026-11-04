/**
 * Intake: the one agent run before work starts on an issue. Code first does what it can: an issue that a commit
 * on main names in an `Issue:` trailer is done, and an issue of kind `flake` goes to the flake tracker; neither
 * costs a run. Else one read-only `claude -p` run gives one route: `build` (with a spec, or with parts when one
 * run cannot do the work), `close`, `done` or `ask`. Code then checks the spec (`problems`): a failed check sends
 * the run back once with the problems, in the same session, and a second failure asks Chris (`intake-failed`).
 * Each run is a job in the ledger, kind `intake`, with its cost in its state.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { areasOf, isSorted, labels, noteFlake, partsOf, planSet, reader, sort, sourceOf } from "../../todo/lib/store.ts";
import { always, askNote, awaitsChris, refIn, setAsk, logAlways, normalizeAsk, plainAsk, type Ask } from "./ask.ts";
import { allRuns, onOf, lock, type Repo, type Run } from "./ledger.ts";
import { causeOf } from "./outcome.ts";
import { endLost, openRun } from "./agent-run.ts";
import { factoryDir, gates, mainRed } from "./factory-status.ts";
import { redCi } from "./ci.ts";
import { fetchOrigin, git } from "./git.ts";
import { withMainClone } from "./main-clone.ts";
import { itemOnMain } from "./status.ts";
import { INTAKE_TRIES } from "./settings.ts";
import { OPUS_MODEL } from "./agent-call.ts";
import { NO_OUTPUT } from "./structured.ts";

/** The model an intake run asks for; `ui/usage.ts` books its cost under this name. */
export const INTAKE_MODEL = OPUS_MODEL;

/** A spec as intake gives it: each section a field. `new` marks a file of the Edit surface that the run creates. */
export interface Spec { goal: string; surface: { path: string; new: boolean }[]; oracle: string[] }
export interface Part { title: string; spec: Spec; after: number[] }

export type Route =
  | { route: "build"; reason: string; spec?: Spec; parts?: Part[]; after: string[] }
  | { route: "close"; reason: string }
  | { route: "done"; reason: string; commit: string }
  | { route: "ask"; reason: string; ask: Ask };

/** The routes as recorded on the run and counted. */
export type Applied = "build" | "close" | "done" | "ask";
export type Counts = Partial<Record<Applied, number>>;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const REF = /^[a-z0-9-]+-\d+(\.\d+)?$/;

const str = { type: "string", minLength: 1 };
const refs = { type: "array", items: { type: "string", pattern: REF.source } };
const SPEC_SCHEMA = {
  type: "object", additionalProperties: false, required: ["goal", "edit_surface", "oracle"],
  properties: {
    goal: { type: "string", minLength: 1, description: "The behaviour in at most 3 sentences." },
    edit_surface: {
      type: "array", minItems: 1,
      items: { type: "object", additionalProperties: false, required: ["path", "new"], properties: { path: str, new: { type: "boolean", description: "True for a file the run creates." } } },
    },
    oracle: { type: "array", minItems: 1, items: str, description: "Each check that tells the work is done: a command in backticks and what it observes." },
  },
};
const route = (name: string, fields: Record<string, object>, optional: string[] = []) => ({
  type: "object", additionalProperties: false,
  required: ["route", "reason", ...Object.keys(fields).filter((k) => !optional.includes(k))],
  properties: { route: { const: name }, reason: str, ...fields },
});

/**
 * The JSON schema of intake's reply: one route under `verdict`. The API refuses a `oneOf` at the top
 * level, so the union sits one level down.
 */
export const INTAKE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdict"],
  properties: {
    verdict: {
      oneOf: [
        route("build", {
          spec: SPEC_SCHEMA,
          parts: {
            type: "array", minItems: 1, maxItems: 6,
            items: {
              type: "object", additionalProperties: false, required: ["title", "spec", "after"],
              properties: {
                title: { type: "string", minLength: 1, maxLength: 60 },
                spec: SPEC_SCHEMA,
                after: { type: "array", items: { type: "integer", minimum: 1 }, description: "The numbers of earlier parts that must land first, from 1." },
              },
            },
          },
          after: refs,
        }, ["spec", "parts", "after"]),
        route("close", {}),
        route("done", { commit: { type: "string", pattern: "^[0-9a-f]{7,40}$" } }),
        route("ask", {
          question: str,
          options: {
            type: "array", minItems: 2, maxItems: 4,
            items: { type: "object", additionalProperties: false, required: ["label", "line"], properties: { label: str, line: str, after: { type: "string", pattern: REF.source } } },
          },
          recommended: str,
          why: { type: "array", minItems: 2, maxItems: 4, items: str },
        }),
      ],
    },
  },
};

function specOf(raw: any): Spec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const surface = (Array.isArray(raw.edit_surface) ? raw.edit_surface : []).map((s: any) => ({ path: text(s?.path) ?? "", new: s?.new === true })).filter((s: { path: string }) => s.path);
  const oracle = (Array.isArray(raw.oracle) ? raw.oracle : []).map(text).filter(Boolean) as string[];
  return { goal: text(raw.goal) ?? "", surface, oracle };
}

/** The route in intake's structured output, or why there is none. The spec's own problems are `problems`'s. */
export function parseRoute(reply: any): Route | string {
  if (reply === undefined) return NO_OUTPUT;
  const raw = reply?.verdict;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "no verdict object";
  const reason = text(raw.reason);
  if (!reason) return `${raw.route} without a reason`;
  switch (raw.route) {
    case "build": {
      const after = (Array.isArray(raw.after) ? raw.after : []).map((x: unknown) => String(x).trim()).filter((x: string) => REF.test(x));
      const parts = Array.isArray(raw.parts) && raw.parts.length
        ? raw.parts.map((p: any) => ({ title: (text(p?.title) ?? "").replace(/\s+/g, " "), spec: specOf(p?.spec) ?? { goal: "", surface: [], oracle: [] }, after: Array.isArray(p?.after) ? p.after : [] }))
        : undefined;
      return { route: "build", reason, ...(raw.spec ? { spec: specOf(raw.spec) } : {}), ...(parts ? { parts } : {}), after };
    }
    case "close": return { route: "close", reason };
    case "ask": {
      const question = text(raw.question);
      if (!question) return "ask without a question";
      const ask = normalizeAsk(raw, { kind: "input", reason: "question" });
      return { route: "ask", reason, ask: ask ? { ...ask, kind: "input", reason: "question" } : plainAsk("question", question) };
    }
    case "done": {
      const commit = text(raw.commit);
      if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) return "done without a commit";
      return { route: "done", reason, commit };
    }
    default: return `unknown route ${JSON.stringify(raw.route)}`;
  }
}

/** The spec as the issue keeps it: the three sections in Markdown. */
export const specText = (s: Spec): string =>
  `## Goal\n${s.goal}\n\n## Edit surface\n${s.surface.map((p) => `- ${p.path}${p.new ? " (new)" : ""}`).join("\n")}\n\n## Oracle\n${s.oracle.map((o) => `- ${o}`).join("\n")}`;

const COMMANDS = new Set(["bun", "bunx", "npm", "npx", "pnpm", "yarn", "node", "deno", "make", "pytest", "python", "python3", "cargo", "go", "bash", "sh", "git", "tsc", "jest", "vitest", "ruby", "rake", "mvn", "gradle"]);

/** Whether an Oracle names a test file or a command a shell runs. `aleph check` is not one. */
export function realOracle(text: string): boolean {
  if (/\baleph check\b/.test(text)) return false;
  if (/[\w./-]+\.(test|spec)\.[a-z]+\b|(^|[\s`/])(tests?|__tests__)\/[\w./-]+|\btest_[\w-]+\.py\b|_test\.(go|py)\b/m.test(text)) return true;
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const word = m[1].trim().split(/\s+/)[0];
    if (COMMANDS.has(word) || word.startsWith("./") || (word && Bun.which(word))) return true;
  }
  return false;
}

/** A test file, which sits beside the code it tests. */
const TEST_FILE = /\.(test|spec|accept)\.[a-z]+$|(^|\/)test_[\w-]+\.py$|_test\.(go|py)$/;
/** A placeholder left for the reader: `???`, `TBD`, a section that is only `TODO`, or `<name>` in a command or a path. */
const PLACEHOLDER = /\?\?\?|\bTBD\b/;
const BRACKETS = /<[A-Za-z][\w-]*(?: [A-Za-z][\w-]*)*>/;

/** Whether `path` is a file or folder on the repo's `origin/<main>`. */
const onMainTree = (repo: Repo, path: string): boolean => git(repo.path, "cat-file", "-e", `origin/${repo.main}:${path.replace(/^\.\//, "").replace(/\/$/, "")}`).ok;

/** The problems code finds in one spec; `at` names the spec in each. */
function specProblems(repo: Repo, s: Spec, at: string): string[] {
  const out: string[] = [];
  if (!s.goal) out.push(`${at}: the Goal is empty`);
  if (!s.surface.length) out.push(`${at}: the Edit surface is empty`);
  if (!s.oracle.length) out.push(`${at}: the Oracle is empty`);
  for (const [name, t] of [["Goal", s.goal], ["Oracle", s.oracle.join("\n")]] as const) {
    if (PLACEHOLDER.test(t) || /^\s*TODO\s*$/m.test(t)) out.push(`${at}: the ${name} holds a placeholder (???, TBD or TODO): write the real text`);
  }
  for (const p of s.surface) {
    if (BRACKETS.test(p.path) || PLACEHOLDER.test(p.path)) { out.push(`${at}: the Edit surface path ${p.path} is a placeholder`); continue; }
    if (p.path.startsWith("/") || p.path.split("/").includes("..")) { out.push(`${at}: the Edit surface path ${p.path} is not a path in the repo`); continue; }
    if (!p.new && !onMainTree(repo, p.path)) out.push(`${at}: the Edit surface names ${p.path}, which is not on main; name a file that exists, or mark it new`);
  }
  const oracle = s.oracle.join("\n");
  if (s.oracle.length && !realOracle(oracle)) out.push(`${at}: the Oracle names no command or test file (and there is no \`aleph check\`)`);
  for (const m of oracle.matchAll(/`([^`\n]+)`/g)) {
    const cmd = m[1].trim();
    if (BRACKETS.test(cmd)) out.push(`${at}: the Oracle command \`${cmd}\` holds a placeholder`);
    if (!/^bun test\s/.test(cmd)) continue;
    for (const arg of cmd.split(/\s+/).slice(2).filter((a) => !a.startsWith("-") && /\.[jt]sx?$/.test(a))) {
      if (!arg.startsWith("./") && !/\.(test|spec)\.[jt]sx?$/.test(arg)) out.push(`${at}: \`${cmd}\` names ${arg}, which bun reads as a name filter: write ./${arg}`);
    }
  }
  // A test file the Oracle names must be on main, or in the Edit surface for the run to make.
  const surface = s.surface.map((p) => p.path.replace(/^\.\//, ""));
  for (const m of new Set([...oracle.matchAll(/(?:^|[\s`(])\.?\/?([\w.@-]+(?:\/[\w.@-]+)*\.(?:test|spec)\.[jt]sx?)\b/g)].map((m) => m[1]))) {
    if (!onMainTree(repo, m) && !surface.some((p) => m === p || m.startsWith(p.endsWith("/") ? p : `${p}/`))) out.push(`${at}: the Oracle names ${m}, which is not on main and not in the Edit surface`);
  }
  return out;
}

/**
 * The problems code finds in a `build` route: each spec's (the parts' or the one spec), the parts' titles and
 * `after` lists, and the issue's `after` refs. An issue to plan must be split into parts. None: it may be applied.
 */
export function problems(repo: Repo, item: issues.Issue, v: Extract<Route, { route: "build" }>, doc = reader().list(repo.key)): string[] {
  const out: string[] = [];
  const rest = doc ? partsOf(doc, item).length > 0 : false;
  if (v.parts) {
    const least = rest ? 1 : 2;
    if (v.parts.length < least || v.parts.length > 6) out.push(`${v.parts.length} parts: give ${least} to 6, or one spec and no parts`);
    v.parts.forEach((p, i) => {
      const n = i + 1;
      const bad = p.title ? issues.titleProblem(p.title, { part: true }) : "it has no title";
      if (bad) out.push(`part ${n}: ${bad}`);
      if (p.after.some((w) => !Number.isInteger(w) || w < 1 || w >= n)) out.push(`part ${n}: its after names a part that is not an earlier part`);
      out.push(...specProblems(repo, p.spec, `part ${n}`));
    });
  } else if (v.spec) {
    if (planSet(item)) out.push(rest ? "this issue asks to plan the rest: give parts" : "a run of this issue reached its time box: split it into parts");
    out.push(...specProblems(repo, v.spec, "the spec"));
  } else {
    out.push("a build gives a spec or parts");
  }
  for (const r of v.after) {
    if (r === `${repo.key}-${issues.refOf(item)}`) { out.push(`after names this issue, ${r}`); continue; }
    if (r.startsWith(`${repo.key}-`) && !(doc && issues.find(doc, r.slice(repo.key.length + 1)))) out.push(`after names ${r}, which is not an issue of ${repo.key}`);
  }
  return out;
}

/** The open issues of the repo, one line each, but not the issue taken in: the others a duplicate can name. */
function openIssues(repo: Repo, item: issues.Issue): string {
  const others = (reader().list(repo.key)?.items ?? []).filter((o) => o.id !== item.id && issues.status(o) === "open");
  return others.map((o) => `${repo.key}-${issues.refOf(o)}: ${o.title.replace(/\s+/g, " ").trim()}`).join("\n") || "(none)";
}

/** The ref of the repo's main, `origin/<main>`, when the repo has it. */
function mainRef(repo: Repo): string | null {
  const ref = `origin/${repo.main}`;
  return git(repo.path, "rev-parse", "--verify", "-q", `${ref}^{commit}`).ok ? ref : null;
}

/** The commits on main since the day the item was created, one line each: what an issue may already be done by. */
function mainSince(repo: Repo, item: issues.Issue): string {
  const ref = mainRef(repo);
  if (!ref) return "(main is not readable)";
  // `created` is a day; start a day early, so a time zone cannot drop the commits of the day itself.
  const day = new Date(`${String(item.fm.created ?? "").trim()}T00:00:00Z`);
  const r = git(repo.path, "log", "--oneline", "--no-decorate", ...(isNaN(+day) ? ["-n", "50"] : [`--since=${new Date(+day - 864e5).toISOString()}`]), ref);
  return (r.ok && r.out.trim()) || "(none)";
}

/** The full sha of `commit` when it is a commit on main, else null. */
function commitOnMain(repo: Repo, commit: string): string | null {
  const ref = mainRef(repo);
  if (!ref) return null;
  const full = git(repo.path, "rev-parse", "--verify", "-q", `${commit}^{commit}`);
  if (!full.ok) return null;
  const sha = full.out.trim();
  return git(repo.path, "merge-base", "--is-ancestor", sha, ref).ok ? sha : null;
}

/** The rules for the parts' titles and `after` lists. */
const PART_RULES = `Each "title" is ${issues.TITLE_RULE}. When the work is part of a larger group, it opens with the group in brackets ("[Status layout] Put the metrics on the left"), and the 60 characters include the brackets. Each part's Goal says only what that part does: the checks of each part are written from its own Goal. A part's "after" lists the earlier parts (the first is 1) that must land first, only when it changes a file that part changes or uses what that part adds: parts with an empty "after" run side by side, so do not chain parts in a line by habit.`;

export function prompt(repo: Repo, item: issues.Issue, doc = reader().list(repo.key)): string {
  const parts = doc ? partsOf(doc, item) : [];
  const split = planSet(item)
    ? parts.length
      ? `\n# Plan the rest\n\nIts parts so far:\n${parts.map((p) => `- ${repo.key}-${issues.refOf(p)} (${issues.status(p)}): ${p.title}`).join("\n")}\n\nChris asked to plan the rest: return "build" with 1 to 6 more "parts" for what the done parts do not cover.\n`
      : `\n# Split it\n\nA run of this issue reached its time box: return "build" with 2 to 6 "parts".\n`
    : "";
  return `You take in one open issue of the repo ${repo.key}, before any work starts on it. Your working directory is a clone of main: read the code to decide, with your read-only tools. Change nothing. Code checks your reply.

# Issue ${repo.key}-${issues.refOf(item)}: ${item.title}

Source: ${sourceOf(item)}. Kind: ${String(item.fm.kind ?? "task")}.

${item.request.trim() || "(no text)"}
${item.spec.trim() ? `\n# Its spec now\n\n${item.spec.trim()}\n\nKeep what is right in it, and fix what the rules below find wrong.\n` : ""}${item.notes.length ? `\nNotes:\n${item.notes.join("\n")}\n` : ""}${split}
# Open issues of ${repo.key}

${openIssues(repo, item)}

# Commits on main since ${String(item.fm.created ?? "").trim() || "the issue was created"}

${mainSince(repo, item)}

# Your reply

One "verdict", with a "reason": one sentence that says why.

- "build": factory runs do the work. Give one "spec" when one run of under an hour can do it all; a small change in several folders is still one spec. Else give 2 to 6 "parts" and no spec: each part is work one run can do alone, and together they do the whole issue. "after" names the issues (\`<repo>-<n>\` or \`<repo>-<n>.<k>\`) that must be done first, only when the work needs that issue's change, not just because the two issues touch the same file or table.
- "close": it is already fixed, a duplicate of an open issue above (name it: "duplicate of <repo>-<n>"), stale, or not worth doing.
- "done": a commit on main already makes the change: give its sha as "commit". Before a "build", read the commits above, and grep main for the names the issue gives. When unsure, "build".
- "ask": a choice only Chris can make: what the product does for him, what he sees, what it costs, or what to work on first; or a check against a live system that he runs. The "question" is one plain sentence. Give 2 to 4 "options", each with a short "label", a "line" that says what it does, and an "after" (\`<repo>-<n>\`) only when it means waiting for that issue; 2 to 4 short "why" lines; and "recommended", one option's label exactly. Use plain words: no file paths, function names or code. Each option must be something a factory run can do.

Never ask Chris how to build it: code structure, which module, naming, test shape, whether to wait for another issue, or whether a refactor is worth it. Decide those, and "build" or "close".

When the source is \`worker\` and all the issue asks for is a new test of behaviour that works today, a rerun of a check elsewhere, or a screenshot or a measurement with no change behind it: "close", with the reason "test-only follow-up". A worker issue that names a defect still builds.

# The spec

A builder builds it alone, and nobody answers questions during the run. The request is the ground truth: the Goal says what it asks, in its words where they fit. A tentative word in the request ("perhaps", "maybe", "could") leaves that choice to the worker: say so, or leave it out.

- "goal": the behaviour in at most 3 sentences. No implementation design. Write no claim about current code that you did not read: open each file, function and command you name.
- "edit_surface": each file the run may change, as a path from the repo's root. A path that is not on main must have "new": true.
- "oracle": each check that tells it is done, as a command in backticks typed as in a shell (such as \`bun run test\`, or \`bun test path/to/x.test.ts\` for one file), and the behaviour it observes. Name only commands and test files that exist, or a test file the Edit surface makes. There is no \`aleph check\` command. The factory runs the repo's checks itself, so do not ask for a new committed test: a bug fix gets one regression test at the lowest layer that shows the bug, and new lasting behaviour gets a row in its module's existing test file. A check counts when an assertion observes the changed output, state or error: not a read of the source text, "does not throw", a snapshot alone, or a manual look. Each Oracle item checks code inside the Edit surface.
- No vague word without a measure ("fast", "robust", "handles errors"), no placeholder (TODO, ???, <...>), and no two clauses that cannot both be true.

# Parts

${PART_RULES}
`;
}

/**
 * Add the parts `<repo>-<id>.k` to the issue in a write, which clears its `plan` and its spec. Each part's `after` is the
 * earlier parts it names and the issue's own `after`. The parts' refs.
 */
export function addParts(repo: Repo, doc: issues.Doc, issue: issues.Issue, parts: Part[], after: string[] = []): string[] {
  const refs: string[] = [];
  for (const c of parts) {
    const part = issues.addPart(doc, issue, { title: c.title, spec: specText(c.spec), after: [...after, ...c.after.map((w) => refs[w - 1])] });
    refs.push(`${repo.key}-${issues.refOf(part)}`);
  }
  delete issue.fm.plan;
  issue.spec = "";
  issues.note(issue, `intake: split into ${refs.map((r, i) => `${r} (${parts[i].title})`).join(", ")}; this issue closes when they are done`);
  return refs;
}

/** Whether the build route is a worker's test-only follow-up: every path of its Edit surfaces is a test file. */
const testOnly = (item: issues.Issue, v: Extract<Route, { route: "build" }>): boolean => {
  const paths = [...(v.parts?.flatMap((p) => p.spec.surface) ?? v.spec?.surface ?? [])].map((p) => p.path);
  return sourceOf(item) === "worker" && item.fm.kind !== "bug" && paths.length > 0 && paths.every((p) => TEST_FILE.test(p));
};

/** A red-main issue's red, while its repo's main or CI is still red; else null. Intake does not close such an issue: the fix may lie outside the repo, and that is Chris's to decide. */
function stillRed(repo: Repo, item: issues.Issue): string | null {
  if (!areasOf(item).includes("red-main") && !labels(item).includes("red-main")) return null;
  return mainRed()(repo) ?? (redCi().some((c) => c.repo === repo.key) ? "GitHub CI on main is red" : null);
}

/** Apply a route to the item through the work store; the route applied, or null when the item changed under the run. */
function apply(repo: Repo, id: number, v: Route): Applied | null {
  const ref = `${repo.key}-${id}`;
  let standing = false;
  const ok = sort(repo, id, `intake ${ref}: ${v.route}`, (item, doc) => {
    if (v.route === "build") {
      // An open item with an Ask (a proposal too) waits for Chris: an after-link to it would stall this issue on his answer.
      const waits = v.after.filter((r) => {
        const o = r.startsWith(`${repo.key}-`) ? issues.find(doc, r.slice(repo.key.length + 1)) : undefined;
        return o !== undefined && issues.status(o) === "open" && awaitsChris(refIn(repo.key, o));
      });
      const after = v.after.filter((r) => !waits.includes(r));
      if (after.length) item.fm.after = after;
      item.fm.intake = "build";
      issues.note(item, `intake: build${after.length ? `, after ${after.join(", ")}` : ""}: ${v.reason}`);
      if (waits.length) issues.note(item, `intake: dropped after ${waits.join(", ")}: it waits for Chris`);
      if (v.parts) addParts(repo, doc, item, v.parts, after);
      else item.spec = specText(v.spec!);
    } else if (v.route === "done") {
      issues.setStatus(item, "done", undefined, v.reason);
      issues.note(item, `intake: already on main in ${v.commit}: ${v.reason}`);
    } else if (v.route === "close") {
      issues.setStatus(item, "done", undefined, v.reason);
    } else if (v.ask.recommended && always("question")?.action === "recommended") {
      // The issue stays unsorted: the next intake reads this note and routes it.
      const o = v.ask.options.find((x) => x.label === v.ask.recommended) ?? v.ask.options[0]!;
      issues.note(item, `always: took the recommendation ${o.label}: ${o.line}${o.after ? ` (after ${o.after})` : ""}`);
      standing = true;
    } else {
      issues.note(item, `intake: for Chris: ${askNote(v.ask)}`);
    }
  });
  if (ok && v.route === "ask" && !standing) setAsk(ref, v.ask);
  if (ok && standing) logAlways("question", "recommended", ref);
  return ok ? v.route : null;
}

/** Set the `intake-failed` Ask on the item with `why`; the line to report, or null when the item changed. */
function askFailed(repo: Repo, id: number, why: string): string | null {
  const ref = `${repo.key}-${id}`;
  const written = sort(repo, id, `intake ${ref}: failed`, (item) => {
    issues.note(item, `intake: failed: ${why}`);
  });
  if (written) setAsk(ref, plainAsk("intake-failed", `Intake failed: ${why}`));
  return written ? `${ref}: intake failed; asked Chris` : null;
}

/**
 * After a run with no usable reply: when the item's intake runs with none reach the
 * limit, give it an Ask (reason `intake-failed`) so later ticks skip it. The line to report, or null.
 */
function giveUp(repo: Repo, id: number, reason: string): string | null {
  // After a standing retry, only the runs since it count. The mark names the runs that counted before it:
  // a time would not do, because the wall clock can step back (WSL2 steps it back every half minute).
  const mark = join(factoryDir(), "standing-retry", `${repo.key}-${id}`);
  let before: string[] = [];
  try { before = JSON.parse(readFileSync(mark, "utf8")); } catch {}
  const runs = allRuns().filter((e) => e.run.kind === "intake" && e.run.repo === repo.key && onOf(e.run) === id
    && !before.includes(e.id)
    && causeOf(e.run) === "no-answer");
  const n = runs.length;
  if (n < INTAKE_TRIES()) return null;
  const grant = always("intake-failed")?.action;
  const ref = `${repo.key}-${id}`;
  if (grant === "retry") {
    mkdirSync(join(factoryDir(), "standing-retry"), { recursive: true });
    writeFileSync(mark, JSON.stringify([...before, ...runs.map((e) => e.id)]));
    logAlways("intake-failed", "retry", ref);
    return `${ref}: no verdict in ${n} intake runs; standing: intake again next tick`;
  }
  if (grant === "close") {
    const closed = sort(repo, id, `intake ${ref}: no verdict`, (item) => {
      issues.setStatus(item, "done");
      issues.note(item, `intake: no verdict in ${n} runs; standing: closed`);
    });
    if (closed) logAlways("intake-failed", "close", ref);
    return closed ? `${ref}: no verdict in ${n} intake runs; standing: closed` : null;
  }
  return askFailed(repo, id, `no verdict in ${n} runs: ${reason}`);
}

/**
 * What code decides with no run: an issue an `Issue:` trailer on main names is done, and an issue of kind `flake`
 * is a note on the flake tracker. The route applied, or null when a run must decide.
 */
function byCode(repo: Repo, item: issues.Issue): { applied: Applied | null; line: string } | null {
  const ref = `${repo.key}-${item.id}`;
  if (item.fm.kind === "flake") {
    const noted = noteFlake(repo, `${ref}: ${item.title}${item.request.trim() ? `: ${item.request.trim().replace(/\s+/g, " ")}` : ""}`);
    if (typeof noted === "string") return { applied: null, line: `${ref}: flake not noted: ${noted}` };
    const ok = sort(repo, item.id, `intake ${ref}: flake`, (i) => {
      issues.setStatus(i, "done");
      issues.note(i, `intake: a flake, noted on ${repo.key}-${noted.id}`);
    });
    return { applied: ok ? "close" : null, line: `${ref}: a flake` };
  }
  fetchOrigin(repo.path, repo.main);
  const sha = itemOnMain(repo, item.id);
  if (!sha) return null;
  const ok = sort(repo, item.id, `intake ${ref}: done`, (i) => {
    issues.setStatus(i, "done", undefined, `commit ${sha} on main names it`);
    issues.note(i, `intake: already on main in ${sha}: its Issue trailer names this issue`);
  });
  return { applied: ok ? "done" : null, line: `${ref}: already on main in ${sha}` };
}

/** One intake of one item and its route applied; counts and skipped lines are added to. */
async function intakeItem(repo: Repo, id: number, counts: Counts, skipped: string[]): Promise<void> {
  const name = `${repo.key}-${id}`;
  // One intake of an item at a time: an issue write's run and the tick may meet.
  const release = await lock(`intake-${name}`, 0);
  if (!release) { skipped.push(`${name}: another intake is running`); return; }
  try {
    // Read again under the lock: an intake that just ended may have sorted it.
    const doc = reader().list(repo.key);
    const item = doc ? issues.find(doc, id) : undefined;
    if (!doc || !item || issues.status(item) !== "open" || isSorted(doc, item, repo)) return;
    const coded = byCode(repo, item);
    if (coded) {
      if (coded.applied) counts[coded.applied] = (counts[coded.applied] ?? 0) + 1;
      else skipped.push(coded.line);
      return;
    }
    // `shown`: the tick's own line reports an intake, so the report has no line for the run.
    const run = openRun({ role: "intake", who: "intake", model: INTAKE_MODEL, seconds: 900, flags: ["--tools", "Read", "Grep", "Glob"], schema: INTAKE_SCHEMA, name: `intake-${name}`, command: `intake ${name}: ${item.title}`, shown: true, repo: repo.key, on: name });
    const noAnswer = (reason: string) => run.end(reason, { cause: "no-answer" });
    try {
      // The agent reads a fresh clone at `origin/<main>`; the prompt's commits and the done check read the fetched `origin/<main>`.
      const got = await withMainClone(repo, "intake-", async (dir): Promise<Route | { failed: string }> => {
        let v = parseRoute(await run.askData(prompt(repo, item, doc), dir));
        for (let round = 0; ; round++) {
          const bad = typeof v === "string" ? [`the reply is malformed: ${v}`]
            : v.route === "done" && !commitOnMain(repo, v.commit) ? [`done names ${v.commit}, which is not a commit on main`]
            : v.route === "build" ? problems(repo, item, v, doc) : [];
          if (!bad.length) return v as Route;
          if (round === 1 || (typeof v === "string" && v === NO_OUTPUT)) return { failed: bad.join("; ") };
          v = parseRoute(await run.askAgain(`Code checked your reply and found these problems:\n${bad.map((b) => `- ${b}`).join("\n")}\n\nReply again with the whole verdict, with each problem fixed.`, dir));
        }
      });
      if ("failed" in got) {
        noAnswer(`failed: ${got.failed}`);
        // A reply that failed the check twice asks Chris now; a run with no reply counts toward INTAKE_TRIES.
        const line = got.failed === `the reply is malformed: ${NO_OUTPUT}` ? giveUp(repo, id, got.failed) : askFailed(repo, id, got.failed);
        skipped.push(line ?? `${name}: intake failed: ${got.failed}`);
        return;
      }
      let v: Route = got;
      if (v.route === "done") v.commit = commitOnMain(repo, v.commit)!.slice(0, 12);
      if (v.route === "build" && testOnly(item, v)) v = { route: "close", reason: "test-only follow-up" };
      const red = stillRed(repo, item);
      if (red && (v.route === "close" || v.route === "done")) v = { route: "ask", reason: v.reason, ask: plainAsk("question", `Main is still red (${red}), and intake would close this issue: ${v.reason}`) };
      const applied = apply(repo, id, v);
      if (applied) {
        counts[applied] = (counts[applied] ?? 0) + 1;
        run.end(v.reason, { route: applied });
      } else {
        run.end("the item changed during the run");
        skipped.push(`${name}: changed during the intake`);
      }
    } catch (e: any) {
      const reason = `failed: ${e?.message ?? e}`;
      noAnswer(reason);
      skipped.push(giveUp(repo, id, reason) ?? `${name}: intake failed: ${e?.message ?? e}`);
    }
  } finally {
    release();
  }
}

const lockOf = (run: Run): string | null => (run.repo && onOf(run) !== undefined ? `intake-${run.repo}-${onOf(run)}` : null);
const endLostIntakes = () => endLost("intake", lockOf, "a verdict");

/** Take in one open issue now, if it is one the tick would take in. */
export async function intakeIssue(repo: Repo, id: number): Promise<{ counts: Counts; skipped: string[] }> {
  const counts: Counts = {};
  const skipped: string[] = [];
  await endLostIntakes();
  const blocked = gates({ only: ["live-cap"] });
  if (blocked) { skipped.push(`intake: ${blocked.why}`); return { counts, skipped }; }
  await intakeItem(repo, id, counts, skipped);
  return { counts, skipped };
}


/** `build 1, close 2` for the tick's line; "none" when nothing was taken in. */
export const countsLine = (c: Counts): string =>
  Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
