// The live Claude sessions of the Herdr terminals as data for the Deck mod's queue: what each one waits on, from its
// `hc` status and the tail of its transcript. `--json` prints one array, one record per `claude-code` terminal.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Opt = { label: string; key?: string; send?: string };
export type Kind = "dialog" | "working" | "choice" | "asks" | "plain";
export type Session = { address: string; session: string | null; at: number | null; kind: Kind; text: string; opts: Opt[] };
type Block = { type: string; text?: string; name?: string; id?: string; tool_use_id?: string; input?: any };
type Line = { type: string; timestamp?: string; message?: { content: string | Block[] } };

const TAIL = 256 * 1024; // bytes of a transcript to read
const TEXT_MAX = 200; // chars of a record's text
const ESC: Opt = { label: "esc", key: "esc" };

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

/** How an answer ends, by its last paragraph: a question, a numbered list or neither. */
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
  return { kind: "plain", text: bare(rows[end] ?? ""), opts: [] };
}

/** The record of one terminal from its `hc get` and the tail of its transcript. */
export function record(address: string, got: any, lines: Line[]): Session {
  const { state, msg = "" } = got.status ?? {}, session = got.labels?.["claude-resume.session"] ?? null;
  const at = lines.findLast((l) => l.type === "assistant")?.timestamp;
  const base = { address, session, at: at ? Date.parse(at) : null };
  if (state === "blocked") {
    const ask = pending(lines) ?? { text: bare(msg), opts: [{ label: "yes", key: "1" }] };
    return { ...base, kind: "dialog", ...ask, opts: [...ask.opts, ESC] };
  }
  if (state === "working") return { ...base, kind: "working", text: working(lines) || bare(msg), opts: [] };
  return lines.length ? { ...base, ...sort(answer(lines)) } : { ...base, kind: "plain", text: bare(msg), opts: [] };
}

/** The transcript of a terminal from its labels, or no lines when the labels or the file are missing. */
function transcript(got: any): Line[] {
  const { "claude-resume.session": id, "claude-resume.cwd": cwd } = got.labels ?? {};
  const file = id && cwd && join(homedir(), ".claude/projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`);
  return file && Bun.file(file).size ? tail(file) : [];
}

if (import.meta.main) {
  const records = hc("ls").terminals.filter((t: any) => t.agent === "claude-code").map((t: any) => {
    const got = hc("get", t.address);
    return record(t.address, got, transcript(got));
  });
  console.log(process.argv.includes("--json") ? JSON.stringify(records) : records.map((r: Session) => `${r.address} ${r.kind} ${r.text}`).join("\n"));
}
