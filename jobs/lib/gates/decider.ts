/**
 * The one reader of the facts a start or an intake decision needs. Every caller of the deciders (the dispatch, Run now, the
 * stall check, the intake queue, the filing, the Queued lane, the Issue page) asks it, so the done rule, the red baseline and
 * the parent's list are the same everywhere. A caller differs only in `fresh`: true fetches the store and each project repo
 * (what a start needs); false reads what was last fetched (a page or the tick, which wait for no network).
 * A decider reads one list and one stage table for each repo, once.
 */
import { projectOfIssue, readList, reader, type Reader } from "../../../lib/store.ts";
import * as issues from "../../../lib/todo.ts";
import { errText } from "../../../lib/errtext.ts";
import { logEvent } from "../../../lib/layout.ts";
import { issueKey, parseKey } from "../../../lib/naming.ts";
import type { Job } from "../records/job.ts";
import { loadRegistry, type Repo } from "../records/ledger.ts";
import { repoStages } from "../records/status.ts";
import type { Stage } from "../records/stage.ts";
import { issueFacts } from "./factory-status.ts";
import { decideIntake } from "./intake-decision.ts";
import { issueDecision, refDone, type IssueDecision, type IssueFacts } from "./issue-decision.ts";
import { decideStart, type Route, type StartDecision } from "./start-decision.ts";
import { mainRed } from "./tables.ts";

/**
 * What a decision is for. `cheap` is the first look before the dispatch's lock: the facts it has with no jobs. Else `jobs`
 * are the ledger as the caller read it, and `lists` the parent's list when the caller re-reads it. With a `route` the decision is a
 * start with its size; without, only the issue's own gates bind (Run now), and `gates` are the factory's when the caller shows a lane.
 */
type Own = { jobs: Job[]; lists?: Reader; now?: number };
type Mode = { cheap: true } | (Own & { gates?: Partial<Pick<IssueFacts, "paused" | "waiting" | "full">> }) | (Own & { route: Route });

/** A repo's list as read, and its stage for each item by number. */
interface Read { doc: issues.Doc | null; stages: Map<string, Stage>; read: boolean }

export function decider(o: { fresh: boolean; jobs?: Job[]; lists?: Reader; registry?: Record<string, Repo> }) {
  const reg = o.registry ?? loadRegistry();
  const lists = o.lists ?? reader({ fetch: o.fresh });
  const redOf = mainRed();
  const known = new Map<string, Read>();
  // The store as last fetched: a fetch since the first read may have added the item.
  const later = o.fresh ? reader({ fetch: false }) : lists;

  const readOf = (repo: Repo): Read => {
    if (!known.has(repo.key)) {
      const k: Read = { doc: null, stages: new Map(), read: false };
      try {
        k.doc = o.fresh ? readList(repo) : lists.list(repo.key);
        for (const s of repoStages(repo, { fetch: o.fresh, doc: k.doc, jobs: o.jobs })) k.stages.set(s.id.slice(repo.key.length + 1), s);
        k.read = !!k.doc;
      } catch (e) { logEvent({ subject: "rule", action: "failed", object: "filing", detail: `store read of ${repo.key}: ${errText(e)}` }); }
      known.set(repo.key, k);
    }
    return known.get(repo.key)!;
  };

  /** Whether `issue.<n>` (or `<repo>-<n>`) is done, by `refDone`. An item that its read lacks is looked up in `later`; an item that read has is not absent. */
  const done = (key: string): boolean => {
    // An `issue.<n>` key names its project through the items repo; the rest of the check reads `<repo>-<n>`.
    const k = parseKey(key);
    const r = issues.parseIssueRef(k?.kind === "issue" ? `${projectOfIssue(k.n)}-${k.n}` : key);
    const repo = r && reg[r.repo];
    if (!r || !repo) return false;
    const { doc, stages, read } = readOf(repo);
    const item = (doc ? issues.find(doc, r.id) : undefined) ?? (read ? later.item(r.repo, r.id) : undefined);
    return refDone(item, read, stages.get(String(r.id))?.stage);
  };

  /** The stage of each item of the repo, by number. */
  const stagesOf = (repo: Repo): Map<string, Stage> => readOf(repo).stages;

  /** The decision for `item` of `repo`. */
  function decide(repo: Repo, item: issues.Issue, mode: Exclude<Mode, { route: Route }>): IssueDecision;
  function decide(repo: Repo, item: issues.Issue, mode: Extract<Mode, { route: Route }>): Promise<StartDecision>;
  function decide(repo: Repo, item: issues.Issue, mode: Mode): IssueDecision | Promise<StartDecision> {
    if ("cheap" in mode) return issueDecision({ name: issueKey(issues.idOf(item)), ref: `${repo.key}-${issues.idOf(item)}`, item, done, red: redOf(repo) });
    const f = { ...issueFacts(repo, item, mode.jobs, mode.now, mode.lists ?? lists), done, red: redOf(repo) };
    return "route" in mode ? decideStart(repo, f, mode.jobs, mode.route) : issueDecision({ ...f, ...mode.gates });
  }

  /** The decision of intake for `item` of `doc`, its repo's list. */
  const intake = (repo: Repo, item: issues.Issue, doc: issues.Doc) => decideIntake(repo, item, { doc, done, red: redOf(repo) });

  return { lists, done, stagesOf, decide, intake };
}

export type Decider = ReturnType<typeof decider>;
