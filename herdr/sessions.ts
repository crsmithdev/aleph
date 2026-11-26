// The live Claude sessions of the Herdr terminals as data for the Deck mod's queue: what each one waits on, from its
// `hc` status and the tail of its transcript, and the issues and shelf items the whole transcript filed.
// `--json` prints one array, one record per `claude-code` terminal, sub-agents included: `parent` is the address of the terminal that ran `hc run`.
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { allJobs, loadRegistry } from "../jobs/lib/records/ledger.ts";
import { repoStages } from "../jobs/lib/records/status.ts";
import { issueId, shownId } from "../lib/naming.ts";
import { readFetched } from "../lib/store.ts";

type Opt = { label: string; key?: string; send?: string };
export type Kind = "dialog" | "working" | "choice" | "asks" | "plain";
export type Issue = { id: string; title: string; stage: string; url: string };
export type Shelved = { id: string; title: string; pending: number; url: string };
export type Found = { issues: Issue[]; shelf: Shelved[] };
export type Session = { address: string; parent: string | null; session: string | null; at: number | null; kind: Kind; text: string; opts: Opt[] } & Found;
type Block = { type: string; text?: string; content?: string | Block[]; name?: string; id?: string; tool_use_id?: string; input?: any };
type Line = { type: string; timestamp?: string; message?: { content: string | Block[] } };

const TAIL = 256 * 1024; // bytes of a transcript to read
const TEXT_MAX = 200; // chars of a record's text
const ESC: Opt = { label: "esc", key: "esc" };
// A last line that tells the person to act: "say go", or a "Next action:" with one of these verbs after it. "Next action: none." does not match.
// a last line that waits for the person: "say go", a verb for them after "Next action:", or a line that starts with one.
// "Tell me when" and "tell me once" wait for a later event, not for the person now
const CLOSER = /\bsay go\b|\bnext action:.*\b(?:say|tell me(?! (?:when|once)\b)|pick|name|answer|reply|confirm)\b|^\W*(?:say|tell me(?! (?:when|once)\b)|pick|answer|reply|confirm)\b/i;
const SHELF = "http://127.0.0.1:3020/shelf/items"; // the shelf server's item list
const SHELF_ID = "\\d{8}-\\d{6}-[a-z0-9]{4}";

const hc = (...args: string[]) => JSON.parse(Bun.spawnSync(["hc", ...args]).stdout.toString());
const blocks = (l: Line): Block[] => (typeof l.message?.content === "string" ? [{ type: "text", text: l.message.content }] : l.message?.content ?? []);
const cut = (t: string) => (t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 1)}…` : t);
const bare = (t: string) => cut(t.replaceAll("**", "").trim());

/** The user and assistant lines in the last `TAIL` bytes of a transcript file, without the first line when the read starts mid-line. */
export function tail(file: string): Line[] {
  const size = statSync(file).size, from = Math.max(0, size - TAIL), buf = Buffer.alloc(size - from), fd = openSync(file, "r");
  readSync(fd, buf, 0, buf.length, from);
  closeSync(fd);
  const lines = buf.toString().split("\n");
  if (from > 0) lines.shift();
  return lines.flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).filter((l) => l.type === "assistant" || l.type === "user");
}

/** The text blocks of the last assistant line that has text, joined with a newline. */
export const answer = (lines: Line[]) => {
  const l = lines.findLast((l) => l.type === "assistant" && blocks(l).some((b) => b.type === "text" && b.text?.trim()));
  return l ? blocks(l).filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
};

/** The last `tool_use` of the transcript. */
const lastTool = (lines: Line[]) => lines.findLast((l) => l.type === "assistant" && blocks(l).some((b) => b.type === "tool_use"));

/** What a working session runs: the last tool as `<name>: <arg>`, with the arg's first line. */
export function working(lines: Line[]): string {
  const b = blocks(lastTool(lines) ?? { type: "assistant" }).findLast((b) => b.type === "tool_use");
  if (!b) return "";
  const arg = [b.input?.command, b.input?.description, b.input?.file_path, b.input?.pattern].find((a) => typeof a === "string" && a);
  return bare(`${b.name}: ${arg?.split("\n")[0] ?? ""}`);
}

/** The question the session waits on: the first question of a last `AskUserQuestion` that no `tool_result` answers, else null. */
export function pending(lines: Line[]): { text: string; opts: Opt[] } | null {
  const at = lines.findLastIndex((l) => l.type === "assistant" && blocks(l).some((b) => b.type === "tool_use"));
  const ask = at < 0 ? undefined : blocks(lines[at]).findLast((b) => b.type === "tool_use");
  if (ask?.name !== "AskUserQuestion") return null;
  if (lines.slice(at + 1).some((l) => blocks(l).some((b) => b.type === "tool_result" && b.tool_use_id === ask.id))) return null;
  const q = ask.input?.questions?.[0];
  return q ? { text: bare(q.question), opts: (q.options ?? []).map((o: any, i: number) => ({ label: o.label, key: String(i + 1) })) } : null;
}

/** How an answer ends, by its last paragraph: a question, a numbered list, a closer that tells the person to act, or none. */
export function sort(text: string): { kind: Kind; text: string; opts: Opt[] } {
  const rows = text.split("\n").map((l) => l.trimEnd());
  const end = rows.findLastIndex((l) => l.trim()), from = rows.slice(0, end + 1).findLastIndex((l) => !l.trim()) + 1;
  const para = rows.slice(from, end + 1);
  const asks = para.findLast((l) => /\?[*`) ]*$/.test(l));
  if (asks) return { kind: "asks", text: bare(asks), opts: [{ label: "yes", send: "yes" }, { label: "no", send: "no" }] };
  const nums = para.filter((l) => /^\s*\d+[.)]\s/.test(l));
  if (nums.length >= 2) {
    const i = para.indexOf(nums[0]);
    return { kind: "choice", text: bare(i > 0 ? para[i - 1] : nums[0]), opts: nums.map((l) => ({ label: l.match(/\d+/)![0], send: l.match(/\d+/)![0] })) };
  }
  if (CLOSER.test(rows[end] ?? "")) return { kind: "asks", text: bare(rows[end]), opts: /\bgo\b/i.test(rows[end]) ? [{ label: "go", send: "go" }] : [] };
  return { kind: "plain", text: bare(rows[end] ?? ""), opts: [] };
}

/** The record of one terminal from its `hc get` and the tail of its transcript. */
export function record(address: string, got: any, lines: Line[], found: Found = { issues: [], shelf: [] }): Session {
  const { state, msg = "" } = got.status ?? {}, session = got.labels?.["claude-resume.session"] ?? null;
  const at = lines.findLast((l) => l.type === "assistant")?.timestamp;
  const base = { address, parent: got.parent ?? null, session, at: at ? Date.parse(at) : null, ...found };
  if (state === "blocked") {
    const ask = pending(lines) ?? { text: bare(msg), opts: [] };
    return { ...base, kind: "dialog", ...ask, opts: [...ask.opts, ESC] };
  }
  if (state === "working") return { ...base, kind: "working", text: working(lines) || bare(msg), opts: [] };
  return lines.length ? { ...base, ...sort(answer(lines)) } : { ...base, kind: "plain", text: bare(msg), opts: [] };
}

/** The transcript file of a terminal from its labels, or "" when the labels or the file are missing. */
function transcript(got: any): string {
  const { "claude-resume.session": id, "claude-resume.cwd": cwd } = got.labels ?? {};
  const file = id && cwd && join(homedir(), ".claude/projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`);
  return file && Bun.file(file).size ? file : "";
}

type Term = { address: string; got: any; lines: Line[]; scan: Scan };
type Scan = { added: { repo: string; n: number; title: string }[]; puts: { id: string; title?: string }[] };
const text = (b: Block): string => (typeof b.content === "string" ? b.content : (b.content ?? []).map((c: Block) => c.text ?? "").join("\n"));

/** Every issue added and shelf item put in the whole transcript, in order. A plain string search skips the lines that cannot hold a tool call. */
export function scan(file: string): Scan {
  const res: Scan = { added: [], puts: [] }, calls = new Map<string, { kind: "add" | "mcp" | "cli"; title?: string }>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.includes('"tool_use"') && /aleph issue add|shelf put|mcp__shelf__put/.test(line)) {
      for (const b of blocks(JSON.parse(line)).filter((b) => b.type === "tool_use")) {
        const cmd = b.input?.command ?? "";
        if (b.name === "mcp__shelf__put") calls.set(b.id!, { kind: "mcp", title: b.input?.title });
        else if (cmd.includes("aleph issue add")) calls.set(b.id!, { kind: "add" });
        else if (cmd.includes("shelf put")) calls.set(b.id!, { kind: "cli" });
      }
    } else if (calls.size && line.includes('"tool_result"') && [...calls.keys()].some((id) => line.includes(id))) {
      for (const b of blocks(JSON.parse(line)).filter((b) => b.type === "tool_result" && calls.has(b.tool_use_id!))) {
        const { kind, title } = calls.get(b.tool_use_id!)!, body = text(b);
        if (kind === "mcp") { const id = body.match(new RegExp(`^\\{"id":"(${SHELF_ID})"`))?.[1]; if (id) res.puts.push({ id, title }); }
        if (kind === "cli") res.puts.push(...[...body.matchAll(new RegExp(`^(${SHELF_ID}) http`, "gm"))].map((m) => ({ id: m[1] })));
        // The CLI prints each result as an indented object from a `{` line to a `}` line; other output of the command can look the same.
        if (kind === "add") for (const [obj] of body.matchAll(/^\{\n[\s\S]*?\n\}$/gm)) {
          try { const o = JSON.parse(obj); if (typeof o.added === "number") res.added.push({ repo: o.repo, n: o.added, title: o.title }); } catch {}
        }
      }
    }
  }
  return res;
}

/** The two lists of a record from its scan: each issue with its stage, each shelf item with its title and pending count. Both in the order filed. */
export function found(s: Scan, stageOf: Map<string, string>, items: Map<string, { title: string; pending: number }>): Found {
  const shelf = new Map(s.puts.map((p) => [p.id, { id: p.id, title: items.get(p.id)?.title ?? p.title ?? p.id, pending: items.get(p.id)?.pending ?? 0, url: `http://aleph.home/shelf/i/${p.id}/` }]));
  const issues = new Map(s.added.map((a) => [issueId(a.repo, a.n), { id: shownId(issueId(a.repo, a.n)), title: a.title, stage: stageOf.get(issueId(a.repo, a.n)) ?? "unknown", url: `http://aleph.home/#/issues/${a.repo}/${a.n}` }]));
  return { issues: [...issues.values()], shelf: [...shelf.values()] };
}

/** The stage of each issue added, by `<repo>-<n>`, from the store in-process as `aleph status` reads it, with no fetch of origin or of the store: `readList` fetches, and that took 1.1 s. */
function stagesOf(scans: Scan[]): Map<string, string> {
  const by = Map.groupBy(scans.flatMap((s) => s.added), (a) => a.repo), reg = loadRegistry(), jobs = allJobs(), stages = new Map<string, string>();
  for (const [repo, adds] of by) {
    if (!reg[repo]) continue;
    for (const st of repoStages(reg[repo], { fetch: false, doc: readFetched(reg[repo]), jobs, items: adds.map((a) => a.n) })) stages.set(st.id, st.stage);
  }
  return stages;
}

/** The shelf server's items by id, or none when the server is down. */
async function shelfItems(): Promise<Map<string, { title: string; pending: number }>> {
  try { return new Map((await (await fetch(SHELF, { signal: AbortSignal.timeout(1000) })).json()).map((i: any) => [i.id, i])); } catch { return new Map(); }
}

if (import.meta.main) {
  const terms: Term[] = hc("ls").terminals.filter((t: any) => t.agent === "claude-code").map((t: any) => {
    const got = hc("get", t.address), file = transcript(got);
    return { address: t.address, got, lines: file ? tail(file) : [], scan: file ? scan(file) : { added: [], puts: [] } };
  });
  const scans = terms.map((t) => t.scan);
  const stageOf = scans.some((s) => s.added.length) ? stagesOf(scans) : new Map(), items = scans.some((s) => s.puts.length) ? await shelfItems() : new Map();
  const records = terms.map((t) => record(t.address, t.got, t.lines, found(t.scan, stageOf, items)));
  console.log(process.argv.includes("--json") ? JSON.stringify(records) : records.map((r: Session) => `${r.address} ${r.kind} ${r.text}`).join("\n"));
}
