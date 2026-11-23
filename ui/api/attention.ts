/**
 * `GET /api/attention`: each page's attention rows by its route, `{ "/hooks": [{ tone, text, act? }] }`. The sidebar's dots and
 * the pages' own rows read this one answer. A row exists only while its problem does.
 * `/api/attention/facts` holds the rows that the build Worker reads (a file, the vault, the transcripts): the updater keeps it and
 * signals its change. The Sessions row is the updater's own mark on the `/api/sessions` key, which the Worker cannot see, so this
 * route adds it. It builds no Sessions, Issues or Jobs answer: they take minutes.
 */
import { backendHold } from "../../jobs/lib/gates/holds.ts";
import { latestReport } from "../../jobs/lib/learning/monitor-table.ts";
import { BACKENDS } from "../../jobs/lib/routing/models.ts";
import { vaultDir } from "../../lib/paths.ts";
// @ts-ignore the module is plain JS, shared with the page
import { count, dur, plural } from "../views/lib/format.js";
import type { Routes } from "../server.ts";
import { respond, updater } from "../updater.ts";
import { byCause, scan } from "./hooks.ts";
import { lintOf, start, vaultNotes } from "./memory.ts";
import { downModels } from "./models.ts";
import { parseScope, type Scope } from "./scope.ts";

/** One problem of a page: its tone, its line and, optionally, the action that removes it. */
export type Row = { tone: "error" | "need"; text: string; act?: { label: string; href: string } };

const FULL = 0.95; // share of the start budget at which the start context counts as full
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Automation: the backend hold after an API credit error, and the newest monitor report's findings. */
function automation(): Row[] {
  const hold = backendHold(), report = latestReport(), link = hold?.why.match(/https?:\/\/\S+/)?.[0];
  const [, m, d] = report?.day.split("-").map(Number) ?? [];
  return [
    // The why is the backend's own error: its first sentence names the fault, the rest is its advice.
    ...(hold ? [{ tone: "error" as const, text: `${BACKENDS[hold.via]}: ${hold.why.split(". ")[0]}`, ...(link ? { act: { label: "Add credits", href: link } } : {}) }] : []),
    ...(report?.findings.length ? [{ tone: "need" as const, text: `Monitor, ${MONTH[m - 1]} ${d}: ${plural(report.findings.length, "finding")}`, act: { label: "Read", href: "#/automation?monitor=1" } }] : []),
  ];
}

/** Memory: a start context at its budget, and the lint findings with a refusal. */
async function memory(): Promise<Row[]> {
  const root = vaultDir(), all = await vaultNotes(root), { bytes, budget } = start(root, all).aleph as { bytes: number; budget: number };
  const lint = lintOf(root, all), found = lint.refuse.length + lint.warn.length;
  return [
    ...(bytes >= FULL * budget ? [{ tone: "need" as const, text: `Start context ${count(bytes)} B of ${count(budget)} B`, act: { label: "Health", href: "#/memory?view=health" } }] : []),
    // A refused note is the error tone, as the Needs-you strip has it.
    ...(lint.refuse.length ? [{ tone: "error" as const, text: `${count(found)} ${found === 1 ? "lint finding" : "lint findings"}, ${count(lint.refuse.length)} refused`, act: { label: "Health", href: "#/memory?view=health" } }] : []),
  ];
}

/** Hooks: the hook errors of the week, with the cause of most of them. */
function hooks(): Row[] {
  const errs = byCause(scan(parseScope(new URL("http://localhost/")) as Scope).fails), n = errs.reduce((s, e) => s + e.n, 0);
  return n ? [{ tone: "error", text: `${count(n)} hook errors, ${count(errs[0].n)} from a ${errs[0].cause.toLowerCase()}`, act: { label: "Errors", href: "#/hooks?view=errors" } }] : [];
}

/** The rows the build Worker reads, by route. Issues and Jobs have none: a failed run waits in Status, and their answers are too slow to read here. */
async function facts(): Promise<Record<string, Row[]>> {
  const down = await downModels();
  return {
    "/automation": automation(),
    "/factory/agents": down.map((m) => ({ tone: "error" as const, text: `Local model down: ${m}` })),
    "/issues": [],
    "/factory/jobs": [],
    "/memory": await memory(),
    "/hooks": hooks(),
  };
}

export const routes: Routes = {
  "GET /api/attention/facts": async () => Response.json(await facts()),
  "GET /api/attention": async (_req, _params, url) => {
    const rows = await (await respond(new URL("/api/attention/facts", url))).json() as Record<string, Row[]>, mark = updater.mark("/api/sessions");
    return Response.json({ ...rows, "/sessions": mark ? [{ tone: "need", text: `Sessions is ${dur((Date.now() - Date.parse(mark.since)) / 1000)} old: ${mark.error}` }] : [] });
  },
};
