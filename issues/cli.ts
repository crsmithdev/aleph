import type { Ctx } from "../cli/commands.ts";
import { loadRegistry, type Repo } from "../jobs/lib/records/ledger.ts";
import { openJobOfIssue } from "../jobs/lib/records/job.ts";
import { askOfItem } from "../jobs/lib/asks/ask.ts";
import { dispatchAfterIssue, filing } from "../jobs/lib/transitions/filing.ts";
import { dispatchDetached, intakeDetached } from "../jobs/lib/transitions/launch.ts";
import { drop } from "../jobs/lib/transitions/transitions.ts";
import { fit } from "../jobs/lib/roles/title.ts";
import { refuse } from "../lib/refusal.ts";
import { issueKey, parseId, parseKey, shownKey } from "../lib/naming.ts";
import { jobId } from "../lib/env.ts";
import * as issues from "../lib/issue-file.ts";
import * as store from "../lib/store.ts";
import * as verbs from "./lib/issues.ts";

/**
 * aleph issue <add|list|show|note|done|drop|lint> <repo> ... — every repo in the
 * registry has a list in the work store. The verbs are issues/lib/issues.ts; this
 * parses argv, prints, and starts the dispatch or intake a write calls for.
 */
export async function todoCmd(ctx: Ctx, use: string): Promise<void> {
  let [verb, repoKey, ...args] = ctx.positional;
  const json = ctx.rest.includes("--json");
  const fixing = ctx.rest.includes("--fix");
  const stat = ctx.flag("status");
  const label = ctx.flag("label");
  // `--request -` or `--spec -` reads that part from stdin: it is prose of several lines.
  const requestArg = ctx.flag("request"), specArg = ctx.flag("spec");
  const labelsArg = ctx.flag("labels");
  const afterArg = ctx.flag("after"), refsArg = ctx.flag("refs");
  const fields: verbs.Fields = {
    title: ctx.flag("title"),
    kind: ctx.flag("kind"),
    request: requestArg === undefined ? undefined : (requestArg === "-" ? await ctx.stdin() : requestArg).trim(),
    spec: specArg === undefined ? undefined : (specArg === "-" ? await ctx.stdin() : specArg).trim(),
    priority: ctx.flag("priority"),
    labels: labelsArg === undefined ? undefined : labelsArg.split(",").map((s) => s.trim()).filter(Boolean),
    source: ctx.flag("source"),
    status: stat,
    ...(afterArg === undefined ? {} : { after: afterArg.split(",").map((s) => s.trim()).filter(Boolean) }),
    ...(refsArg === undefined ? {} : { refs: refsArg.split(",").map((s) => s.trim()).filter(Boolean) }),
    // `--media <file>` may repeat.
    media: ctx.rest.flatMap((a, i) => (a === "--media" && ctx.rest[i + 1] !== undefined ? [ctx.rest[i + 1]] : [])),
  };
  const sub = verb ?? refuse(use);
  const registry = loadRegistry();
  const named = parseKey(repoKey);
  const ref = named?.kind === "issue" ? null : parseId(repoKey);
  if (named?.kind === "issue" && sub !== "add") {
    repoKey = store.projectOfIssue(named.n) ?? refuse(`no issue ${repoKey}`);
    args = [String(named.n), ...args];
  } else if (ref && sub !== "add") {
    repoKey = ref.repo;
    args = [String(ref.n), ...args];
  }
  if (!repoKey && (sub === "list" || sub === "lint")) return todoRecent(ctx, sub, registry, { status: stat, label, kind: ctx.flag("kind") }, json);
  const repo = registry[repoKey ?? ""] ?? refuse(repoKey ? `no repo named ${repoKey}` : "name a repo");
  verbs.checkFields(fields);
  const id = parseKey(args[0])?.n ?? Number(args[0]);
  const text = args.slice(1).join(" ").trim();
  const warn = (follow: string | null | undefined) => { if (follow) ctx.err(`warn: ${follow}`); };

  switch (sub) {
    case "add": {
      const a = await verbs.add(repo, args.join(" "), fields, filing);
      warn(a.follow);
      for (const m of a.result.maybeSame ?? []) ctx.err(`${shownKey(issueKey(m.id), repo.code)} may be the same task: ${m.title}`);
      ctx.out(a.result);
      return;
    }
    case "list": {
      const rows = verbs.list(repo, { status: stat, label, kind: ctx.flag("kind") });
      if (json) { ctx.out(rows.map(verbs.brief)); return; }
      if (!rows.length) { ctx.log("no issues"); return; }
      printRows(ctx, rows, repo.key);
      return;
    }
    case "show": {
      const i = verbs.show(repo, id);
      if (json) { ctx.out({ ...verbs.brief(i), request: i.request, spec: i.spec, notes: i.notes, media: issues.mediaOf(i) }); return; }
      ctx.log(`## ${shown(repo.key, i)}. ${i.title}`);
      const ask = askOfItem(i);
      ctx.log(`${issues.status(i)}   source ${issues.sourceOf(i)}   priority ${issues.priorityOf(i)}   updated ${issues.updated(i) ?? "-"}`);
      ctx.log(`after ${issues.afterOf(i).map(shownRef).join(", ") || "-"}   refs ${issues.refsOf(i).map(shownRef).join(", ") || "-"}   areas ${issues.areasOf(i).join(", ") || "-"}`);
      ctx.log(`ask ${ask ? `${ask.reason}: ${ask.question}` : "-"}`);
      if (i.request.trim()) ctx.log(`\n## Request\n\n${i.request}`);
      if (i.spec.trim()) ctx.log(`\n${i.spec}`);
      if (i.notes.length) ctx.log(`\n### Notes\n${i.notes.join("\n")}`);
      const media = issues.mediaOf(i);
      if (media.length) ctx.log(`\n### Media\n${media.map((m) => `- ${m}`).join("\n")}`);
      return;
    }
    case "note": {
      // The user's answer to an issue that waits for them: not a worker's note (ALEPH_JOB_ID) and not the factory's own.
      const n = verbs.note(repo, id, text, verbs.isAnswer(text, jobId()));
      warn(n.follow);
      ctx.out(n.result);
      if (n.answered) intakeDetached(repo, n.result.id);
      return;
    }
    case "attach": {
      // `aleph issue attach <repo> <n> <file>...`: images or PDFs.
      const a = verbs.attach(repo, id, args.slice(1));
      warn(a.follow);
      ctx.out(a.result);
      return;
    }
    case "decide": {
      const d = verbs.decide(repo, id, text, fields);
      warn(d.follow);
      ctx.out(d.result);
      // The note is the user's answer: the intake that follows a note takes the issue from here.
      intakeDetached(repo, d.item.id);
      return;
    }
    case "edit": {
      const e = verbs.edit(repo, id, fields, text);
      warn(e.follow);
      ctx.out(e.result);
      dispatchAfterIssue(repo, e.item);
      return;
    }
    case "done":
    case "drop": {
      const c = verbs.close(repo, id, sub, text);
      warn(c.follow);
      ctx.out(c.result);
      // The dropped issue's open job goes with it, or its Ask outlives the issue. The close note is the issue's record.
      const open = sub === "drop" ? openJobOfIssue(repo.key, id)?.[0].run.name : undefined;
      if (open) await drop(open, { reason: `issue ${repo.key}-${id} was dropped`, quiet: true });
      // An issue that waited on this issue can start, and a dropped part can set its parent's Ask: the dispatch takes both.
      if (repo.sandbox) dispatchDetached();
      return;
    }
    case "retitle": {
      const r = await verbs.retitle(repo, fit);
      warn(r.follow);
      for (const t of r.result.retitled) ctx.log(`${shownKey(issueKey(t.id), repo.code)}: ${t.title}`);
      return;
    }
    case "lint": {
      if (fixing) {
        const l = verbs.lintFix(repo);
        warn(l.follow);
        ctx.out(l.result);
        if (l.result.remaining.length) ctx.code = 1;
        return;
      }
      const l = verbs.lint(repo);
      if (!l.findings.length) { ctx.out({ repo: l.repo, items: l.items, findings: [] }); return; }
      for (const f of l.findings) ctx.err(`item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
      refuse(`${l.findings.length} problem${l.findings.length > 1 ? "s" : ""} in the ${repo.key} list`);
    }
    default: refuse(use);
  }
}


/** `aleph issue list` and `aleph issue lint` with no repo: each recent repo. */
function todoRecent(ctx: Ctx, sub: "list" | "lint", registry: Record<string, Repo>, o: { status?: string; label?: string; kind?: string }, json: boolean): void {
  const repos = Object.values(registry);
  if (sub === "lint") {
    const results = verbs.lintRecent(repos);
    for (const r of results) for (const f of r.findings) ctx.err(`${r.repo} item ${f.id}: ${f.problem}${f.fixable ? " (--fix repairs this)" : ""}`);
    ctx.out(results);
    if (results.some((r) => r.findings.length)) ctx.code = 1;
    return;
  }
  const rows = verbs.listRecent(repos, o).map((r) => ({ repo: r.repo.key, items: r.items }));
  if (json) { ctx.out(rows.map((r) => ({ repo: r.repo, items: r.items.map(verbs.brief) }))); return; }
  if (!rows.length) { ctx.log("no issues"); return; }
  for (const r of rows) { ctx.log(r.repo); printRows(ctx, r.items, r.repo, "  "); }
}


/** An issue key as the terminal shows it, with the code of the project that holds that issue. */
const shownRef = (r: string): string => {
  const name = store.projectsOnMain().get(parseKey(r)?.n ?? 0);
  return shownKey(r, name && loadRegistry()[name]?.code);
};
const ready = (i: issues.Issue) => (issues.afterOf(i).length ? `after ${issues.afterOf(i).map(shownRef).join(",")}` : "");
/** The issue's key as the terminal shows it: `a1234`, with its project's code. */
const shown = (key: string, i: issues.Issue): string => shownKey(issueKey(i.id), loadRegistry()[key]?.code);

function printRows(ctx: Ctx, rows: issues.Issue[], key: string, indent = ""): void {
  const refs = rows.map((i) => shown(key, i));
  const w = refs.reduce((m, r) => Math.max(m, r.length), 0);
  for (const [n, i] of rows.entries()) ctx.log(`${indent}${refs[n].padStart(w)}  ${issues.status(i).padEnd(7)} ${issues.priorityOf(i).padEnd(8)} ${i.title}${ready(i) ? `  (${ready(i)})` : ""}`);
}
