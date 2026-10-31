/**
 * One-time host script of aleph-908: new titles for every open issue and goal in the work store.
 * The dry run asks a read-only model call for titles and prints id, old title, new title. `--apply` comes later.
 */
import { git, fetchOrigin } from "./lib/git.ts";
import { replyOf } from "./lib/gate.ts";
import * as store from "../todo/lib/store.ts";
import { refOf, status, type Issue } from "../todo/lib/todo.ts";

export const MODEL = "claude-opus-5-5";
const BATCH = 40;
const MAX = 60;

export interface Item { id: string; title: string; kind: "issue" | "goal"; parent?: { id: string; title: string }; siblings: string[] }

/** The outermost JSON object of a reply, or null. */
function parseObject(output: string): any {
  for (const s of [output.trim(), output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try { const v = JSON.parse(s); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch {}
  }
  return null;
}

export function promptFor(items: Item[]): string {
  return `You retitle work items. The rule for a title: a grammatically correct phrase or sentence of at most ${MAX} characters. A part of a larger group is titled \`[<group>] <title>\`, and the parts of one group (the goals of one issue) share one \`[<group>]\` name. A title that already obeys the rule stays exactly the same.

Items:
${items.map((i) => JSON.stringify({ id: i.id, title: i.title, kind: i.kind, ...(i.parent ? { parent_issue: i.parent } : {}), ...(i.kind === "goal" ? { sibling_titles: i.siblings } : {}) })).join("\n")}

Reply with one JSON object and nothing else, one entry per item:

{"titles": [{"id": "<repo>-<ref>", "title": "<new title>"}]}
`;
}

/** Batches of about BATCH items; an issue and its goals stay together. */
export function batches(items: Item[]): Item[][] {
  const groups = new Map<string, Item[]>();
  for (const i of items) {
    const root = i.kind === "goal" && i.parent ? i.parent.id : i.id;
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  const out: Item[][] = [];
  let cur: Item[] = [];
  for (const g of groups.values()) {
    if (cur.length && cur.length + g.length > BATCH) { out.push(cur); cur = []; }
    cur.push(...g);
  }
  if (cur.length) out.push(cur);
  return out;
}

async function ask(items: Item[]): Promise<string> {
  const argv = [process.env.ALEPH_RETITLE_CMD ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--model", MODEL];
  const p = Bun.spawn(argv, { env: process.env, stdin: new Blob([promptFor(items)]), stdout: "pipe", stderr: "pipe" });
  const [o, , code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`the model call exited ${code}`);
  return replyOf(o).text;
}

/** The new title of each sent id; a batch's refusals go to `refuse` and keep the old title. */
async function retitle(items: Item[], refuse: (id: string, why: string) => void): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let raw: any;
  try {
    raw = parseObject(await ask(items));
    if (!raw || !Array.isArray(raw.titles)) throw new Error(raw ? "no titles list" : "no JSON");
  } catch (e: any) {
    for (const i of items) refuse(i.id, `model call failed: ${e?.message ?? e}`);
    return out;
  }
  const sent = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  for (const [n, t] of raw.titles.entries()) {
    const id = typeof t?.id === "string" ? t.id : "";
    const title = typeof t?.title === "string" ? t.title.trim() : "";
    if (!sent.has(id)) { refuse(id || `entry ${n + 1}`, "id was not sent"); continue; }
    if (seen.has(id)) { refuse(id, "id answered twice"); continue; }
    seen.add(id);
    if (!title) refuse(id, "empty title");
    else if ([...title].length > MAX) refuse(id, `title is ${[...title].length} characters, over ${MAX}`);
    else out.set(id, title);
  }
  for (const id of sent) if (!seen.has(id)) refuse(id, "left out of the reply");
  return out;
}

/** Every open item of every repo in the store. */
export function openItems(): Item[] {
  const dir = store.storeDir();
  const f = fetchOrigin(dir, "main");
  if (!f.ok) throw new Error(`work store fetch failed: ${f.out}`);
  const ls = git(dir, "ls-tree", "-r", "--name-only", "origin/main");
  const keys = ls.out.split("\n").map((p) => /^([^/]+)\/backlog\/config\.yml$/.exec(p)?.[1]).filter((k): k is string => !!k);
  const docs = store.readLists(keys.map((key) => ({ key })));
  const items: Item[] = [];
  docs.forEach((doc, n) => {
    if (!doc) return;
    const key = keys[n];
    const id = (it: Issue) => `${key}-${refOf(it)}`;
    const byId = new Map(doc.items.map((it) => [id(it), it]));
    for (const it of doc.items) {
      if (status(it) !== "open") continue;
      if (store.kindOf(it) !== "goal") { items.push({ id: id(it), title: it.title, kind: "issue", siblings: [] }); continue; }
      const pid = store.issueOf(it);
      const parent = pid ? byId.get(pid) : undefined;
      const siblings = parent
        ? store.goalsOf(parent).map((g) => byId.get(g)).filter((g): g is Issue => !!g && g !== it && status(g) === "open").map((g) => g.title)
        : [];
      items.push({ id: id(it), title: it.title, kind: "goal", ...(pid ? { parent: { id: pid, title: parent?.title ?? "" } } : {}), siblings });
    }
  });
  return items;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--apply")) { console.error("--apply comes later"); return 1; }
  const items = openItems();
  const rows: string[][] = [["id", "old title", "new title"]];
  for (const batch of batches(items)) {
    const got = await retitle(batch, (id, why) => console.error(`${id}: ${why}`));
    for (const i of batch) {
      const t = got.get(i.id);
      rows.push([i.id, i.title, t === undefined || t === i.title ? "same" : t]);
    }
  }
  for (const r of rows) console.log(r.join("\t"));
  return 0;
}

if (import.meta.main) process.exit(await main());
