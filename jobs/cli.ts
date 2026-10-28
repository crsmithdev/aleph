#!/usr/bin/env bun
/**
 * aleph <job|run|land|checked|recheck|drop|jobs|issue|unit|tick|report|pause|resume|sandbox|status|judge>
 * — detached agent jobs, plain runs, each repo's issues, and the factory.
 * Ledger: $ALEPH_JOBS_DIR or ~/.aleph/jobs. Registry: $ALEPH_REPOS or
 * ~/.aleph/repos.json. JSON on stdout, findings on stderr, exit 1 on refusal.
 * See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { allRuns, isLive, loadRegistry, newsLine, updateRun, type Entry, type Repo } from "./lib/ledger.ts";
import { allJobs, findJob, goal, isOpen, issue as issueOf, readFile, view, type Job } from "./lib/job.ts";
import { git, onMain, removeBranch, reviewBack, unit } from "./lib/unit.ts";
import { clearDecision } from "./lib/decision.ts";
import { fetchOrigin } from "./lib/git.ts";
import { judgeChoice, setJudgeChoice } from "../hooks/lib/jev.ts";
import * as todos from "../todo/lib/todo.ts";
import * as store from "../todo/lib/store.ts";
import { triage } from "../todo/lib/triage.ts";
import { behind, dispatchDetached, factoryDir, factoryLog, health, hold, paused, probeDue, report, setPaused, triageDetached, triageNow, triageStep } from "./lib/factory.ts";
import { checkName, checked, drop, land, recheck, refuse, Refusal, repoOf, runDispatch, startJob, startPlain, type Start } from "./lib/transitions.ts";
import { probe } from "./lib/probe.ts";
import { sweep } from "./lib/deps.ts";
import { runReview2 } from "./lib/review2.ts";
import { derive, FACTS_REF, itemStates, readFacts, recentRepos, type ItemState } from "./lib/status.ts";

const DAY_MS = 24 * 3600_000;

const out = (value: unknown) => console.log(JSON.stringify(value, null, 2));

const [cmd, ...rest] = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}
// A flag's value is not a positional. Every flag here takes one, so leaving a
// name off this list silently folds its value into the next argument: `todo add
// <repo> "<title>" --labels jobs` put "jobs" on the end of the title.
const VALUED = ["--spec", "--model", "--todo", "--priority", "--labels", "--status", "--label", "--body", "--title", "--due", "--waiting-on"];
const positional = rest.filter((a, i) => !a.startsWith("--") && !VALUED.includes(rest[i - 1]));
/** What a start is written down as in its run's `command.txt`: the argv as typed. */
const command = process.argv.slice(2);

/** Print the started run, then wait for a foreground unit: the transition has dropped its locks. */
async function started(s: Start): Promise<void> {
  out(s.started);
  await s.child?.exited;
}

async function job(): Promise<void> {
  repoOf(positional[0]);
  checkName(positional[1]);
  const specArg = flag("spec") ?? refuse("--spec <file|-> is required");
  const [repo, name] = positional;
  const spec = specArg === "-" ? await Bun.stdin.text() : readFileSync(specArg, "utf8");
  const todoArg = flag("todo");
  await started(await startJob({ repo, name, spec, todo: todoArg === undefined ? undefined : Number(todoArg), model: flag("model"), land: rest.includes("--land") }, { command }));
}

async function plain(): Promise<void> {
  const dash = rest.indexOf("--");
  await started(await startPlain({ name: rest[0], argv: dash >= 0 ? rest.slice(dash + 1) : [], cwd: process.cwd() }, { command }));
}

/**
 * The ledger follows git. An open job whose work is on origin/<main> becomes
 * landed, quietly, with its issue done. An open job with no branch and
 * no worktree left is "gone": nothing is left to land. Every other open job
 * is "unlanded". Each repo is fetched once.
 */
function reconcile(all: Entry[][]): Map<string, string> {
  const registry = loadRegistry();
  const fetched = new Set<string>();
  const fates = new Map<string, string>();
  // Only Chris's git pull moves a checkout: the ledger fetches and reads refs.
  for (const runs of all.filter(isOpen)) {
    const last = runs.at(-1)!;
    const repo = last.run.repo ? registry[last.run.repo] : undefined;
    if (!repo || last.run.kind === "plain" || isLive(last.folder)) continue;
    if (!fetched.has(repo.key)) {
      fetched.add(repo.key);
      fetchOrigin(repo.path);
    }
    const found = onMain(repo, last.run);
    if (found) {
      updateRun(last.folder, { state: "landed", commit: found.commit, reason: `found on main (${found.how})`, needs: undefined, told: true });
      removeBranch(repo, last.run);
      const todo = issueOf(runs);
      const why = todo === undefined ? null : store.close(repo, todo, `job ${last.run.name} found on main as ${found.commit.slice(0, 7)}`);
      if (why) console.error(`warn: issue ${todo} not closed: ${why}`);
      continue;
    }
    const branch = last.run.branch && git(repo.path, "rev-parse", "--verify", "-q", `refs/heads/${last.run.branch}`).ok;
    fates.set(last.run.job, branch || (last.run.worktree && existsSync(last.run.worktree)) ? "unlanded" : "gone");
  }
  return fates;
}

function summary(runs: Job, fates = new Map<string, string>()) {
  const v = view(runs);
  return {
    name: v.name, repo: v.repo, kind: v.run.kind, job: v.job, run: v.run.id, goal: goal(runs), state: v.state, needs: v.needs, phase: v.phase,
    reason: v.reason, say: v.say, review2: v.review2, ...(v.check ? { check: v.check } : {}), fate: fates.get(v.job), session: v.session, started: v.started, ended: v.ended,
    ...(v.lost ? { lost: true } : {}),
  };
}

function jobs(): void {
  if (rest.includes("--news")) {
    const news: { run: string; line: string }[] = [];
    for (const e of allRuns()) {
      if (e.run.state === "running" || e.run.told) continue;
      news.push({ run: e.id, line: newsLine(e.run, e.run.repo ? loadRegistry()[e.run.repo]?.note : undefined) });
      updateRun(e.folder, { told: true });
    }
    return out(news);
  }
  const fates = reconcile(allJobs());
  const all = allJobs();
  const name = positional[0];
  // A job that landed with its check open stays in the list until `aleph checked`.
  // A job that ended in the last 24 hours follows the open ones, the latest first.
  if (!name) {
    const listed = (j: Entry[]) => isOpen(j) || (j.at(-1)!.run.state === "landed" && j.at(-1)!.run.check === "open");
    const ended = (j: Entry[]) => Date.parse(j.at(-1)!.run.ended ?? "");
    const recent = all.filter((j) => !listed(j) && Date.now() - ended(j) < DAY_MS).sort((a, b) => ended(b) - ended(a));
    return out([...all.filter(listed), ...recent].map((j) => summary(j, fates)));
  }
  const runs = findJob(name, null, all);
  if (!runs) refuse(`no job named ${name}`);
  const last = runs!.at(-1)!;
  const checks = readFile(last, "checks.log");
  out({
    ...summary(runs!, fates), question: last.run.question, result: readFile(last, "result.md"),
    checks: checks?.trimEnd().split("\n").slice(-40).join("\n"), land: readFile(last, "land.log"),
  });
}

/** After `aleph issue add` or `edit` of an open goal in a factory repo: a dispatch, so the goal starts at once. It never fails the write. */
function dispatchAfterGoal(repo: Repo, item: todos.Item): void {
  if (!repo.sandbox || !store.isGoal(item)) return;
  dispatchDetached();
}

/**
 * aleph issue <add|list|show|note|done|drop|lint> <repo> ... — every repo in the
 * registry has a list in the work store (todo/lib/store.ts). Status is a
 * field, so an item never moves and never gets a new number.
 */
async function todoCmd(): Promise<void> {
  const [verb, repoKey, ...args] = positional;
  const sub = verb ?? refuse("usage: aleph issue <add|list|show|note|edit|decide|done|drop|hidden|lint> <repo> ...");
  if (!repoKey && (sub === "list" || sub === "lint")) return todoRecent(sub);
  const repo = loadRegistry()[repoKey ?? ""] ?? refuse(repoKey ? `no repo named ${repoKey}` : "name a repo");

  const pick = (doc: todos.Doc): todos.Item => {
    const id = Number(args[0]);
    if (!Number.isInteger(id)) refuse("name an issue by its number");
    return todos.find(doc, id) ?? refuse(`${repo.key} has no issue ${id}`);
  };
  // Every verb but `add` needs a list on main; `add` starts one.
  const write = <T>(message: string, change: (doc: todos.Doc) => T | null, create = false) => {
    let written;
    try {
      written = store.writeList(repo, message, change, create);
    } catch (e: any) {
      if (e instanceof Refusal) throw e;
      refuse(e?.message ?? String(e));
    }
    if (written?.follow) console.error(`warn: ${written.follow}`);
    return written;
  };
  // `--body -` reads the body from stdin: it is prose of several lines.
  const bodyArg = flag("body");
  const body = bodyArg === undefined ? undefined : (bodyArg === "-" ? await Bun.stdin.text() : bodyArg).trim();
  const labelsArg = flag("labels");
  const labels = labelsArg === undefined ? undefined : labelsArg.split(",").map((s) => s.trim()).filter(Boolean);
  // `none` removes the field; a bad value is refused before anything is written.
  const due = flag("due");
  if (due !== undefined && due !== "none" && !todos.validDate(due)) refuse("--due takes YYYY-MM-DD or none");
  const status = flag("status");
  if (status !== undefined && !(todos.STATUSES as readonly string[]).includes(status)) refuse(`--status takes ${todos.STATUSES.join(", ")}`);
  const waitingOn = flag("waiting-on");
  if (waitingOn !== undefined && waitingOn !== "none" && !todos.parseRef(waitingOn)) refuse("--waiting-on takes <repo>-<n> or none");

  switch (sub) {
    case "add": {
      const title = args.join(" ").trim() || refuse("give the item a title");
      const t = await triage(store.reader().list(repo.key), title, body ?? "");
      const w = write("todo: add an item", (doc) => todos.add(doc, title, { priority: flag("priority"), labels: labels ?? t.labels, body, due, waitingOn }), true)!;
      for (const m of t.maybeSame) console.error(`aleph-${m.id} may be the same task: ${m.title}`);
      out({ repo: repo.key, added: w.value.id, title: w.value.title, commit: w.commit, ...(t.maybeSame.length ? { maybeSame: t.maybeSame } : {}) });
      dispatchAfterGoal(repo, w.value);
      if (!store.hasLabel(w.value, store.GOAL)) triageDetached(repo, w.value.id);
      return;
    }
    case "list": {
      const rows = listRows(readTodo(repo));
      if (rest.includes("--json")) { out(rows.map(brief)); return; }
      if (!rows.length) { console.log("no issues"); return; }
      printRows(rows);
      return;
    }
    case "show": {
      const i = pick(readTodo(repo));
      if (rest.includes("--json")) { out({ ...brief(i), body: i.body, notes: i.notes, hidden: hiddenCount(repo, i.id) }); return; }
      console.log(`## ${i.id}. ${i.title}`);
      console.log(`status ${todos.status(i)}   priority ${i.fm.priority ?? "-"}   labels ${store.labels(i).join(", ") || "-"}   updated ${i.fm.updated ?? "-"}`);
      console.log(`due ${i.fm.due ?? "-"}   waiting_on ${i.fm.waiting_on ?? "-"}`);
      console.log(`hidden checks: ${hiddenCount(repo, i.id)}`);
      if (i.body.trim()) console.log(`\n${i.body}`);
      if (i.notes.length) console.log(`\n### Notes\n${i.notes.join("\n")}`);
      return;
    }
    case "hidden": {
      const i = pick(readTodo(repo));
      const paths = args.slice(1);
      let have: Record<string, string>;
      try {
        if (!paths.length) {
          have = store.readHidden(repo, i.id);
          if (rest.includes("--json")) { out(Object.keys(have)); return; }
          if (!Object.keys(have).length) console.log("no hidden checks");
          for (const n of Object.keys(have)) console.log(n);
          return;
        }
        const files: Record<string, string> = {};
        for (const p of paths) {
          if (!existsSync(p) || !statSync(p).isFile()) refuse(`${p} is not a file`);
          files[basename(p)] = readFileSync(p, "utf8");
        }
        const w = store.writeHidden(repo, i.id, files);
        if (w.follow) console.error(`warn: ${w.follow}`);
        out({ repo: repo.key, id: i.id, hidden: Object.keys(files), commit: w.commit });
      } catch (e: any) {
        if (e instanceof Refusal) throw e;
        refuse(e?.message ?? String(e));
      }
      return;
    }
    case "note": {
      const text = args.slice(1).join(" ").trim() || refuse("give the note some text");
      // Chris's answer to a `needs-chris` issue: not a worker's note (ALEPH_JOB_ID) and not the factory's own.
      const answer = !process.env.ALEPH_JOB_ID && !/^(triage|job \S+ landed)\b/.test(text);
      const w = write(`todo: a note on item ${args[0]}`, (doc) => {
        const i = pick(doc);
        const line = todos.note(i, text);
        const answered = answer && store.needsChris(i);
        if (answered) store.label(i, [], [store.NEEDS_CHRIS]);
        return { id: i.id, line, answered };
      })!;
      out({ repo: repo.key, id: w.value.id, note: w.value.line, commit: w.commit });
      if (w.value.answered) triageDetached(repo, w.value.id);
      return;
    }
    case "decide": {
      // Chris's answer to a `needs-chris` issue, in one write: the decision note, `needs-chris` out, `goal` in.
      const text = args.slice(1).join(" ").trim() || refuse("give the decision");
      const w = write(`todo: item ${args[0]}: decided`, (doc) => {
        const i = pick(doc);
        if (todos.status(i) !== "open" || !store.needsChris(i)) refuse(`${repo.key}-${i.id} is not waiting for a decision`);
        todos.note(i, text);
        clearDecision(i);
        store.label(i, [store.GOAL], [store.NEEDS_CHRIS]);
        todos.edit(i, { waitingOn });
        return i;
      })!;
      out({ repo: repo.key, ...brief(w.value), commit: w.commit });
      dispatchAfterGoal(repo, w.value);
      return;
    }
    case "edit": {
      const title = flag("title")?.trim();
      const priority = flag("priority");
      if (title === undefined && body === undefined && priority === undefined && labels === undefined && due === undefined && waitingOn === undefined && status === undefined) refuse("give --title, --body, --priority, --labels, --due or --waiting-on (or --status)");
      if (title === "") refuse("the title cannot be empty");
      const w = write(`todo: edit item ${args[0]}`, (doc) => {
        const i = pick(doc);
        todos.edit(i, { title, body, priority, labels, due, waitingOn });
        if (status !== undefined) todos.setStatus(i, status as todos.Status);
        return i;
      })!;
      out({ repo: repo.key, ...brief(w.value), commit: w.commit });
      dispatchAfterGoal(repo, w.value);
      return;
    }
    case "done":
    case "drop": {
      const text = args.slice(1).join(" ").trim();
      if (sub === "drop" && !text) refuse("say why it is dropped");
      const w = write(`todo: item ${args[0]} ${sub === "done" ? "done" : "dropped"}`, (doc) => {
        const i = pick(doc);
        todos.setStatus(i, sub === "done" ? "done" : "dropped");
        if (text) todos.note(i, text);
        return i;
      })!;
      out({ repo: repo.key, id: w.value.id, status: todos.status(w.value), title: w.value.title, commit: w.commit });
      return;
    }
    case "lint": {
      if (rest.includes("--fix")) {
        const w = write("todo: lint --fix", (doc) => { const fixed = todos.fix(doc); return fixed.length ? { fixed, left: todos.lint(doc, itemExists(repo.key, doc)) } : null; });
        const left = w?.value.left ?? todos.lint(readTodo(repo), itemExists(repo.key));
        out({ repo: repo.key, fixed: w?.value.fixed ?? [], remaining: left });
        if (left.length) process.exit(1);
        return;
      }
      const doc = readTodo(repo);
      const findings = todos.lint(doc, itemExists(repo.key, doc));
      if (!findings.length) { out({ repo: repo.key, items: doc.items.length, findings: [] }); return; }
      for (const f of findings) console.error(`item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
      refuse(`${findings.length} problem${findings.length > 1 ? "s" : ""} in the ${repo.key} list`);
    }
    default: refuse("usage: aleph issue <add|list|show|note|edit|done|drop|hidden|lint> <repo> ...");
  }
}

/** How many hidden check files an item has in the store. */
const hiddenCount = (repo: Repo, id: number): number => Object.keys(store.readHidden(repo, id)).length;

const brief = (i: todos.Item) => ({ id: i.id, title: i.title, status: todos.status(i), priority: i.fm.priority ?? null, labels: store.labels(i), updated: i.fm.updated ?? null, due: i.fm.due ?? null, waiting_on: i.fm.waiting_on ?? null, notes: i.notes.length, legacy: i.legacy || undefined });
const ready = (i: todos.Item) => [i.fm.due ? `due ${i.fm.due}` : "", i.fm.waiting_on ? `waits ${i.fm.waiting_on}` : ""].filter(Boolean).join("  ");

/** The items of a list that pass `--status` and `--label`. */
function listRows(doc: todos.Doc): todos.Item[] {
  const want = flag("status");
  if (want && !todos.STATUSES.includes(want as todos.Status)) refuse(`status must be one of ${todos.STATUSES.join(", ")}`);
  const label = flag("label");
  return doc.items
    .filter((i) => (want ? todos.status(i) === want : true))
    .filter((i) => (label ? store.hasLabel(i, label) : true));
}

function printRows(rows: todos.Item[], indent = ""): void {
  const w = String(Math.max(...rows.map((i) => i.id))).length;
  for (const i of rows) console.log(`${indent}${String(i.id).padStart(w)}  ${todos.status(i).padEnd(7)} ${i.title}${ready(i) ? `  (${ready(i)})` : ""}`);
}

/**
 * The registry's repos with a ledger run or an item update in the last 7
 * days, the latest first, each with its list (null when the store has none).
 */
function listRecent(): { repo: Repo; doc: todos.Doc | null }[] {
  const repos = Object.values(loadRegistry());
  let docs: (todos.Doc | null)[] = [];
  try { docs = store.readLists(repos); } catch (e: any) { refuse(e?.message ?? String(e)); }
  return recentRepos(repos, docs).map((n) => ({ repo: repos[n], doc: docs[n] }));
}

/** `aleph issue list` and `aleph issue lint` with no repo: each recent repo. */
function todoRecent(sub: "list" | "lint"): void {
  const lists = listRecent().filter((r) => r.doc);
  if (sub === "lint") {
    const results = lists.map(({ repo, doc }) => ({ repo: repo.key, items: doc!.items.length, findings: todos.lint(doc!, itemExists(repo.key, doc!)) }));
    for (const r of results) for (const f of r.findings) console.error(`${r.repo} item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
    out(results);
    if (results.some((r) => r.findings.length)) process.exit(1);
    return;
  }
  const rows = lists.map(({ repo, doc }) => ({ repo: repo.key, items: listRows(doc!) })).filter((r) => r.items.length);
  if (rest.includes("--json")) { out(rows.map((r) => ({ repo: r.repo, items: r.items.map(brief) }))); return; }
  if (!rows.length) { console.log("no issues"); return; }
  for (const r of rows) { console.log(r.repo); printRows(r.items, "  "); }
}

/** `aleph triage <repo>-<n>`: triage one issue now, under the dispatch's gates. */
async function triageCmd(): Promise<void> {
  const ref = todos.parseRef(rest[0] ?? "") ?? refuse("usage: aleph triage <repo>-<n>");
  const repo = loadRegistry()[ref.repo] ?? refuse(`no repo ${ref.repo}`);
  out(await triageNow(repo, ref.id));
}

/** `aleph dispatch`: start every ready goal up to the live cap. A run's end and `aleph issue` call it. */
async function dispatchCmd(): Promise<void> {
  out(await runDispatch());
}

/**
 * `aleph tick`, from the timer: the nightly probe when due, and the dependency sweep only after a
 * passing probe, then a dispatch as the fallback for what no run's end and no issue write has
 * started. A failed probe starts no run and no sweep.
 */
async function tickCmd(): Promise<void> {
  if (!paused() && probeDue()) {
    const repo = Object.values(loadRegistry()).find((r) => r.sandbox);
    if (repo) {
      mkdirSync(factoryDir(), { recursive: true });
      const p = await probe(repo, join(factoryDir(), "probe.log"));
      factoryLog(`probe ${p.ok ? "passed" : `failed: ${p.failed.join("; ")}`}`);
      if (p.ok) {
        const proposed = await sweep(Object.values(loadRegistry()).filter((r) => r.sandbox), factoryLog);
        if (proposed.length) factoryLog(`proposed ${proposed.join("; ")}`);
      }
    }
  }
  const d = await runDispatch();
  const t = !d.held ? await triageStep() : { triaged: {}, skipped: [] };
  out({ ...d, skipped: [...d.skipped, ...t.skipped], triaged: t.triaged });
}

/**
 * `aleph report`: the runs not yet shown, how far each factory repo's
 * checkout is behind origin, and the health line. With --hook it prints the
 * SessionStart hook's JSON, and nothing when there is nothing to say.
 */
function reportCmd(): void {
  const lines = [report()];
  for (const repo of Object.values(loadRegistry()).filter((r) => r.sandbox)) {
    fetchOrigin(repo.path);
    lines.push(behind(repo) ?? "");
  }
  const h = hold();
  if (h) lines.push(h.line);
  lines.push(...health());
  const text = lines.filter(Boolean).join("\n\n");
  if (!rest.includes("--hook")) { console.log(text || "nothing new"); return; }
  if (!text) return;
  const msg = `aleph report\n\n${text}`;
  out({ systemMessage: msg, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: msg } });
}

/**
 * `aleph status <repo>-<n>`: the issue's derived state; with no issue, see statusRecent. In Chris's session the
 * facts come from the store and the ledger; in a sandbox, where neither is,
 * they come from the bundle's snapshot at refs/aleph/facts in the current repo.
 */
function statusCmd(): void {
  if (!positional[0]) return statusRecent();
  const m = (positional[0] ?? "").match(/^(.+)-(\d+)$/) ?? refuse("usage: aleph status [<repo>-<n>] [--json]");
  const [, key, n] = m!;
  const repo = loadRegistry()[key];
  let s: ItemState | undefined;
  if (repo) {
    try { s = itemStates(repo, { fetch: true, items: [Number(n)] })[0]; } catch (e: any) { refuse(e?.message ?? String(e)); }
  } else {
    const cwd = process.cwd();
    const snap = readFacts(cwd);
    if (!snap || snap.repo !== key) refuse(`no repo named ${key} in the registry, and no ${FACTS_REF} for it here`);
    s = derive(cwd, `refs/remotes/origin/${snap!.main}`, snap!, Number(n)) ?? undefined;
  }
  if (!s) refuse(`${key} has no issue ${n}`);
  if (rest.includes("--json")) return out(s);
  console.log(`${s!.item} ${s!.state}: ${s!.why}`);
}

/** `aleph status` with no issue: the derived state of each open issue in each recent repo. */
function statusRecent(): void {
  const states: ItemState[] = [];
  for (const { repo, doc } of listRecent()) {
    const open = (doc?.items ?? []).filter((i) => todos.status(i) === "open");
    if (!open.length) continue;
    try { states.push(...itemStates(repo, { fetch: true, doc, items: open.map((i) => i.id) })); }
    catch (e: any) { console.error(`warn: ${repo.key}: ${e?.message ?? e}`); }
  }
  if (rest.includes("--json")) return out(states);
  if (!states.length) { console.log("no open items"); return; }
  for (const s of states) console.log(`${s.item} ${s.state}: ${s.why}`);
}

/** Whether `<repo>-<n>` names an item in the work store; `own` is the list already read for `key`. */
function itemExists(key: string, own?: todos.Doc): (repo: string, id: number) => boolean {
  const lists = store.reader();
  const registry = loadRegistry();
  return (r, id) => (own && r === key ? todos.find(own, id) : registry[r] ? lists.item(r, id) : undefined) !== undefined;
}

/** The repo's list in the work store; a refusal when the store has none or the fetch fails. */
function readTodo(repo: store.Place): todos.Doc {
  let doc: todos.Doc | null = null;
  try { doc = store.readList(repo); } catch (e: any) { refuse(e?.message ?? String(e)); }
  return doc ?? refuse(`the work store has no list for ${repo.key}`);
}

try {
  switch (cmd) {
    case "job": await job(); break;
    case "run": await plain(); break;
    case "jobs": jobs(); break;
    case "recheck": await started(await recheck(positional[0], { command })); break;
    case "review2": {
      const folder = resolve(positional[0] ?? refuse("usage: aleph review2 <run-folder>"));
      try { await runReview2(folder); } catch (e: any) { refuse(e.message); }
      await reviewBack(folder);
      break;
    }
    case "drop": out(await drop(positional[0], { reason: positional.slice(1).join(" "), quiet: rest.includes("--quiet") })); break;
    case "unit": await unit(resolve(positional[0])); break;
    case "land": await started(await land(positional[0], { checked: rest.includes("--checked") }, { command })); break;
    case "checked": out(checked(positional[0])); break;
    case "issue": case "todo": await todoCmd(); break;
    case "tick": await tickCmd(); break;
    case "dispatch": await dispatchCmd(); break;
    case "triage": await triageCmd(); break;
    case "status": statusCmd(); break;
    case "report": reportCmd(); break;
    case "pause": setPaused(true); out({ paused: true }); break;
    case "resume": setPaused(false); out({ paused: false }); dispatchDetached(); break;
    case "judge": {
      const v = positional[0];
      if (v === "jev" || v === "haiku") setJudgeChoice(v);
      else if (v !== undefined) refuse("usage: aleph judge [jev|haiku]");
      out({ judge: judgeChoice() });
      break;
    }
    case "sandbox": {
      if (positional[0] !== "probe") refuse("usage: aleph sandbox probe");
      const repo = Object.values(loadRegistry()).find((r) => r.sandbox) ?? refuse("no repo in the registry has sandbox: true");
      mkdirSync(factoryDir(), { recursive: true });
      const p = await probe(repo, join(factoryDir(), "probe.log"));
      out(p);
      if (!p.ok) process.exit(1);
      break;
    }
    default: refuse("usage: aleph <job|run|land|checked|recheck|drop|jobs|issue|tick|report|pause|resume|sandbox|status|judge|dispatch> ...");
  }
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(e.message);
  process.exit(1);
}
