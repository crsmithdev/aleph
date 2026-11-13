/** A Claude Code session's requests, read from its transcript jsonl: each request's fill and the parts it holds. */
import { anthropicKey } from "../lib/env.ts";

export interface Part { name: string; rec: string; tokens: number; how: "exact" | "est" }
export interface Request {
  n: number;
  /** input + cache read + cache write: the whole prompt of the request, exact. */
  fill: number;
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number };
  /** The rows of the Context mock's table: the fixed parts of request 1, then the message parts since request 1 or the last compaction. They sum to the fill. */
  parts: Part[];
  /** The request whose fill starts the message parts: 1, or the request after the last compaction. */
  since: number;
}
/** One tool call's result: the request whose fill first held it, and its share of that request's tool results. */
export interface Call { id: string; tool: string; input: string; n: number; tokens: number; how: "exact" | "est" }
/** One tool definition's share of the Tools part, by chars: always est. */
export interface Tool { name: string; tokens: number }
/** One item of a part (a heading, a file, a hook, a kind of record): its share of the part by chars, always est. `n` is 1 for a fixed part, else the request whose fill first held it. */
export interface Item { rec: string; name: string; n: number; tokens: number }
/** A compact summary's text and the request whose fill first held it. */
export interface Summary { n: number; text: string }
export interface Session { requests: Request[]; tools: Tool[]; calls: Call[]; items: Item[]; summaries: Summary[] }

/** The message parts in the mock's order: the record each comes from, and its name. */
const MESSAGES: [string, string][] = [
  ["isCompactSummary", "Compact summary"], ["user", "Your messages"], ["assistant", "Assistant turns"],
  ["tool_result", "Tool results"], ["hook UserPromptSubmit", "Recall offers"], ["attachment", "Attachments"],
];

/**
 * The requests of a transcript, in order. The fixed parts split request 1's fill by chars (chars ÷ 4 scaled to the
 * exact sum), as estimates (`parseExact` counts them instead). A later request adds its fill minus the fill of the request before: the output of that
 * request as an assistant turn, the rest to the records between them. When those records are of more than one kind,
 * the rest splits by chars and those parts are estimates. After a compaction, the compact summary is the fill minus
 * request 1's fill, and the message parts start again.
 */
export function parse(jsonl: string): Session {
  return withFixed(scan(jsonl), null);
}

/** The fixed parts of a transcript: its text (the tools as the array) and the model of its first request. */
interface Scan {
  out: Request[]; fixed: [string, string, string | unknown[]][]; model: string; defs: unknown[]; calls: Call[];
  /** Per fixed part, by its record: its items and their chars. */
  parts: Map<string, Map<string, number>>; items: Item[]; summaries: Summary[];
}

/** Splits `tokens` among the weights by their share; the last takes the rest, so the shares sum to `tokens`. */
function apportion<T>(tokens: number, weights: [T, number][]): [T, number][] {
  const total = weights.reduce((s, [, w]) => s + w, 0) || 1;
  let left = tokens;
  return weights.map(([k, w], i) => {
    const t = i === weights.length - 1 ? left : Math.round(tokens * w / total);
    left -= t;
    return [k, t];
  });
}

const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
const BLOCKS: Record<string, string> = { tool_use: "Tool calls", text: "Text" };
/** The system prompt by its level-1 and level-2 headings; the text before the first is "Opening". */
const headings = (system: string): [string, number][] =>
  system.split(/^(?=##? )/m).filter(Boolean).map((t) => [/^##? /.test(t) ? t.split("\n")[0].replace(/^##? /, "").trim() : "Opening", t.length]);
/** A recall offer by the titles of its notes, its lines of the form "- Title (path): claim". */
const offer = (text: string) => [...text.matchAll(/^- (.+?) \(/gm)].map((m) => m[1]).join(", ") || "No notes";

/** The size of a record's content in chars, with each image as its tokens × 4 in place of its base64. */
function weigh(v: any): number {
  const images = (x: any): any[] => Array.isArray(x) ? x.flatMap(images) : x?.type === "image" && x.source?.data ? [x] : Array.isArray(x?.content) ? images(x.content) : [];
  return images(v).reduce((n, b) => n + imageTokens(b.source.data) * 4 - b.source.data.length, JSON.stringify(v ?? "").length);
}

const KEYS = ["file_path", "command", "pattern", "url", "query", "description", "skill", "prompt"];
/** The one input field that names a call (a path, a command, a URL), else the input as JSON, cut to 120 chars. */
function brief(input: any): string {
  const k = KEYS.find((k) => typeof input?.[k] === "string");
  const s = k ? input[k] : JSON.stringify(input ?? {});
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}

/** Tokens of a base64 image: width × height ÷ 750 from its header (PNG, JPEG, GIF, WebP), at most 1,600; 1,600 when the header gives no size. */
function imageTokens(base64: string): number {
  const b = Buffer.from(base64, "base64");
  let size: [number, number] | undefined;
  if (b.toString("latin1", 1, 4) === "PNG" && b.length >= 24) size = [b.readUInt32BE(16), b.readUInt32BE(20)];
  else if (b.toString("latin1", 0, 3) === "GIF" && b.length >= 10) size = [b.readUInt16LE(6), b.readUInt16LE(8)];
  else if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" && b.length >= 30) {
    const kind = b.toString("latin1", 12, 16);
    if (kind === "VP8 ") size = [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    else if (kind === "VP8L") { const v = b.readUInt32LE(21); size = [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
    else if (kind === "VP8X") size = [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    // walk the segments to the first start-of-frame marker
    for (let i = 2; i + 9 <= b.length && b[i] === 0xff; i += 2 + b.readUInt16BE(i + 2)) {
      if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(b[i + 1])) { size = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; break; }
    }
  }
  return size?.[0] && size[1] ? Math.min(1600, Math.round(size[0] * size[1] / 750)) : 1600;
}

function scan(jsonl: string): Scan {
  const out: Request[] = [];
  const seen = new Set<string>();
  const uses = new Map<string, { tool: string; input: unknown }>(), calls: Call[] = [];
  let pending: { id: string; w: number }[] = [], since = 1;
  let system = "", model = "", tools: unknown[] = [], instructions: { path: string; content: string }[] = [], memory = "";
  const hooks = new Map<string, number>(), before = new Map<string, number>(), items: Item[] = [], summaries: Summary[] = [];
  /** The chars of the last response's text and tool call blocks, and whether it thought: they split its assistant turn. */
  let reply = new Map<string, number>(), thought = false;
  let gap = new Map<string, { chars: number; count: number; subs: Map<string, number> }>();
  let held = new Map<string, { tokens: number; count: number; est: boolean }>();
  const note = (rec: string, chars: number, count: number, sub?: string) => {
    const g = gap.get(rec) ?? { chars: 0, count: 0, subs: new Map() };
    gap.set(rec, { chars: g.chars + chars, count: g.count + count, subs: sub ? add(g.subs, sub, chars) : g.subs });
  };
  const itemize = (rec: string, tokens: number, subs: Map<string, number>) =>
    apportion(tokens, [...subs]).forEach(([name, t]) => items.push({ rec, name, n: out.length + 1, tokens: t }));
  const hold = (rec: string, tokens: number, count: number, est: boolean) => {
    const h = held.get(rec) ?? { tokens: 0, count: 0, est: false };
    held.set(rec, { tokens: h.tokens + tokens, count: h.count + count, est: h.est || est });
  };
  for (const line of jsonl.split("\n")) {
    if (!line) continue;
    const o = JSON.parse(line);
    const a = o.attachment;
    if (a?.type === "prompt_snapshot") { system = [a.systemPrompt ?? system].flat().join(""); tools = a.tools ?? tools; }
    else if (a?.type === "instructions" && !out.length) instructions.push(...(a.files ?? []).map((f: any) => ({ path: f.path ?? "?", content: f.content })));
    else if (a?.type === "hook_additional_context" && (!out.length || a.hookName === "UserPromptSubmit")) {
      const text = [a.content].flat().join("");
      if (out.length) note("hook UserPromptSubmit", text.length, 1, offer(text));
      else { memory += text; add(hooks, a.hookName ?? "?", text.length); }
    } else if (a) {
      if (out.length) note("attachment", weigh(a), 1, a.type ?? "?");
      else add(before, a.type ?? "?", weigh(a));
    } else if (o.type === "user" && !o.isSidechain) {
      const c = o.message?.content;
      const results = Array.isArray(c) ? c.filter((b: any) => b.type === "tool_result") : [];
      pending.push(...results.map((b: any) => ({ id: b.tool_use_id, w: weigh(b) })));
      const kind = o.isMeta ? "Injected" : "Prompts";
      if (o.isCompactSummary) summaries.push({ n: out.length + 1, text: [c ?? ""].flat().map((b: any) => typeof b === "string" ? b : b.text ?? "").join("") });
      else if (!out.length) add(before, results.length ? "Tool results" : kind, weigh(c ?? ""));
      note(o.isCompactSummary ? "isCompactSummary" : results.length ? "tool_result" : "user", weigh(c ?? ""), results.length || 1, results.length ? undefined : kind);
    } else if (o.type === "assistant" && !o.isSidechain) {
      const blocks = [o.message?.content].flat();
      for (const b of blocks) if (b?.type === "tool_use") uses.set(b.id, { tool: b.name, input: b.input });
      const answer = () => {
        for (const b of blocks) if (BLOCKS[b?.type]) add(reply, BLOCKS[b.type], weigh(b.text ?? b.input ?? ""));
        thought ||= blocks.some((b) => b?.type === "thinking" || b?.type === "redacted_thinking");
      };
      if (!o.message?.usage) { answer(); continue; }
      const id = o.requestId ?? o.message.id;
      model ||= o.message.model ?? "";
      if (seen.has(id)) { answer(); continue; }
      seen.add(id);
      const u = o.message.usage;
      const usage = { input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 };
      const fill = usage.input + usage.cacheRead + usage.cacheWrite;
      const prev = out.at(-1);
      if (prev && gap.has("isCompactSummary")) {
        held = new Map([["isCompactSummary", { tokens: fill - out[0].fill, count: 1, est: false }]]);
        since = out.length + 1;
      }
      else if (prev) {
        const delta = fill - prev.fill, kinds = [...gap];
        const turn = kinds.length ? Math.min(prev.usage.output, delta) : delta;
        hold("assistant", turn, 1, false);
        // The transcript keeps a thinking block's signature, not its text: thinking is the turn less its other blocks at chars ÷ 4.
        const thinking = thought ? Math.max(0, turn - Math.round([...reply.values()].reduce((s, n) => s + n, 0) / 4)) : 0;
        itemize("assistant", turn - thinking, reply);
        if (thinking) items.push({ rec: "assistant", name: "Thinking", n: out.length + 1, tokens: thinking });
        apportion(delta - turn, kinds.map(([rec, g]) => [rec, g.chars] as [string, number])).forEach(([rec, tokens], i) => {
          hold(rec, tokens, kinds[i][1].count, kinds.length > 1);
          if (rec === "tool_result") split(tokens, kinds.length > 1);
          else itemize(rec, tokens, kinds[i][1].subs);
        });
      }
      gap = new Map();
      pending = [];
      reply = new Map();
      thought = false;
      answer();
      const parts: Part[] = MESSAGES.filter(([rec]) => held.has(rec)).map(([rec, name]) => {
        const h = held.get(rec)!;
        return { name: rec === "isCompactSummary" ? name : `${name} · ${h.count}`, rec, tokens: h.tokens, how: h.est ? "est" : "exact" };
      });
      out.push({ n: out.length + 1, fill, usage, parts, since });
    }
  }
  /** Splits the tool result tokens of the gap among its results by weight. */
  function split(tokens: number, mixed: boolean) {
    apportion(tokens, pending.map((p) => [p, p.w] as [typeof p, number])).forEach(([p, t]) => {
      const u = uses.get(p.id);
      calls.push({ id: p.id, tool: u?.tool ?? "?", input: brief(u?.input), n: out.length + 1, tokens: t, how: mixed || pending.length > 1 ? "est" : "exact" });
    });
  }
  return { out, model, defs: tools, calls, items, summaries, fixed: [
    ["System prompt", "prompt_snapshot", system], [`Tools · ${tools.length}`, "prompt_snapshot.tools", tools],
    [`Instructions · ${instructions.length} file${instructions.length === 1 ? "" : "s"}`, "attachment instructions", instructions.map((f) => f.content).join("")], ["Memory start context", "hook_additional_context", memory],
  ], parts: new Map([
    ["prompt_snapshot", new Map(headings(system))], ["attachment instructions", instructions.reduce((m, f) => add(m, f.path, f.content.length), new Map<string, number>())],
    ["hook_additional_context", hooks], ["rest of request 1", before],
  ]) };
}

/** Puts the fixed parts before each request's parts: `counts` (exact) per fixed part, else chars ÷ 4 scaled to request 1's fill (estimates). */
function withFixed({ out, fixed, defs, calls, parts: subs, items, summaries }: Scan, counts: number[] | null): Session {
  let tools: Tool[] = [];
  const fixedItems: Item[] = [];
  if (out.length) {
    const chars = fixed.map(([, , t]) => (typeof t === "string" ? t : JSON.stringify(t)).length);
    const total = Math.max(chars.reduce((s, n) => s + n, 0), 1);
    let left = out[0].fill;
    const parts: Part[] = fixed.map(([name, rec], i) => {
      if (counts) return { name, rec, tokens: counts[i], how: "exact" };
      const tokens = i === fixed.length - 1 ? left : Math.round(out[0].fill * chars[i] / total);
      left -= tokens;
      return { name, rec, tokens, how: "est" };
    });
    // Counted parts miss what request 1 holds besides them (skill and deferred-tool lists, reminders); the rest keeps the sum at the fill.
    if (counts) parts.push({ name: "Other", rec: "rest of request 1", tokens: out[0].fill - counts.reduce((s, n) => s + n, 0), how: "exact" });
    for (const r of out) r.parts = [...parts, ...r.parts];
    tools = apportion(parts[1].tokens, defs.map((d: any) => [d, JSON.stringify(d).length] as [any, number]))
      .map(([d, t]) => ({ name: d.schema?.name ?? d.name ?? "?", tokens: t }));
    for (const p of parts) for (const [name, t] of apportion(p.tokens, [...subs.get(p.rec) ?? []])) fixedItems.push({ rec: p.rec, name, n: 1, tokens: t });
  }
  return { requests: out, tools, calls, items: [...fixedItems, ...items], summaries };
}

/** One call's input and its result as text, with each image as a line that gives its tokens. */
export function call(jsonl: string, id: string): { tool: string; input: unknown; text: string } | null {
  let use: any, res: any;
  for (const line of jsonl.split("\n")) {
    if (!line.includes(id)) continue;
    for (const b of [JSON.parse(line).message?.content].flat()) {
      if (b?.type === "tool_use" && b.id === id) use = b;
      if (b?.type === "tool_result" && b.tool_use_id === id) res = b;
    }
  }
  if (!use && !res) return null;
  const text = [res?.content ?? ""].flat().map((b: any) =>
    typeof b === "string" ? b : b.type === "text" ? b.text : b.type === "image" ? `[image, about ${imageTokens(b.source?.data ?? "")} tokens]` : JSON.stringify(b)).join("\n");
  return { tool: use?.name ?? "?", input: use?.input ?? null, text };
}

const COUNT_URL = "https://api.anthropic.com/v1/messages/count_tokens";

/**
 * `parse`, with each fixed part counted by the Anthropic count_tokens endpoint for the session's model and marked exact.
 * The key comes from the dotenv file. With no key, no model, or any call failing, the fixed parts stay estimates.
 */
export async function parseExact(jsonl: string, fetchFn: typeof fetch = fetch): Promise<Session> {
  const s = scan(jsonl), key = anthropicKey();
  if (!key || !s.model || !s.out.length) return withFixed(s, null);
  const field = ["system", "tools"];
  // The snapshot keeps each tool's wire definition under `schema`.
  const wire = ({ schema: s }: any) => ({ name: s.name, description: s.description, input_schema: s.input_schema });
  try {
    const counts = await Promise.all(s.fixed.map(async ([, , text], i) => {
      if (!text.length) return 0;
      const body = { model: s.model, messages: [{ role: "user", content: i > 1 ? (text as string) : "." }], ...(i < 2 && { [field[i]]: i ? (text as unknown[]).map(wire) : text }) };
      const res = await fetchFn(COUNT_URL, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`count_tokens ${res.status}`);
      return ((await res.json()) as { input_tokens: number }).input_tokens;
    }));
    return withFixed(s, counts);
  } catch { return withFixed(s, null); }
}
