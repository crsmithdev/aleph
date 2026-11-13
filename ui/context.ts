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
}

/** The message parts in the mock's order: the record each comes from, and its name. */
const MESSAGES: [string, string][] = [
  ["isCompactSummary", "Compact summary"], ["user", "Your messages"], ["assistant", "Assistant turns"],
  ["tool_result", "Tool results"], ["hook UserPromptSubmit", "Recall offers"],
];

/**
 * The requests of a transcript, in order. The fixed parts split request 1's fill by chars (chars ÷ 4 scaled to the
 * exact sum), as estimates (`parseExact` counts them instead). A later request adds its fill minus the fill of the request before: the output of that
 * request as an assistant turn, the rest to the records between them. When those records are of more than one kind,
 * the rest splits by chars and those parts are estimates. After a compaction, the compact summary is the fill minus
 * request 1's fill, and the message parts start again.
 */
export function parse(jsonl: string): Request[] {
  return withFixed(scan(jsonl), null);
}

/** The fixed parts of a transcript: its text (the tools as the array) and the model of its first request. */
interface Scan { out: Request[]; fixed: [string, string, string | unknown[]][]; model: string }

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
  let system = "", model = "", tools: unknown[] = [], instructions: string[] = [], memory = "";
  let gap = new Map<string, { chars: number; count: number }>();
  let held = new Map<string, { tokens: number; count: number; est: boolean }>();
  const note = (rec: string, chars: number, count: number) => {
    const g = gap.get(rec) ?? { chars: 0, count: 0 };
    gap.set(rec, { chars: g.chars + chars, count: g.count + count });
  };
  const hold = (rec: string, tokens: number, count: number, est: boolean) => {
    const h = held.get(rec) ?? { tokens: 0, count: 0, est: false };
    held.set(rec, { tokens: h.tokens + tokens, count: h.count + count, est: h.est || est });
  };
  for (const line of jsonl.split("\n")) {
    if (!line) continue;
    const o = JSON.parse(line);
    const a = o.attachment;
    if (a?.type === "prompt_snapshot") { system = [a.systemPrompt ?? system].flat().join(""); tools = a.tools ?? tools; }
    else if (a?.type === "instructions" && !out.length) instructions.push(...(a.files ?? []).map((f: any) => f.content));
    else if (a?.type === "hook_additional_context") {
      const text = [a.content].flat().join("");
      if (!out.length) memory += text;
      else if (a.hookName === "UserPromptSubmit") note("hook UserPromptSubmit", text.length, 1);
    } else if (o.type === "user" && !o.isSidechain) {
      const c = o.message?.content;
      const results = Array.isArray(c) ? c.filter((b: any) => b.type === "tool_result").length : 0;
      // An image in a tool result weighs by its pixels (4 chars per token), not by its base64 text.
      const images = (Array.isArray(c) ? c : []).filter((b: any) => b.type === "tool_result").flatMap((b: any) => [b.content].flat()).filter((b: any) => b?.type === "image" && b.source?.data);
      const chars = images.reduce((n: number, b: any) => n + imageTokens(b.source.data) * 4 - b.source.data.length, JSON.stringify(c ?? "").length);
      note(o.isCompactSummary ? "isCompactSummary" : results ? "tool_result" : "user", chars, results || 1);
    } else if (o.type === "assistant" && !o.isSidechain && o.message?.usage) {
      const id = o.requestId ?? o.message.id;
      model ||= o.message.model ?? "";
      if (seen.has(id)) continue;
      seen.add(id);
      const u = o.message.usage;
      const usage = { input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 };
      const fill = usage.input + usage.cacheRead + usage.cacheWrite;
      const prev = out.at(-1);
      if (prev && gap.has("isCompactSummary")) held = new Map([["isCompactSummary", { tokens: fill - out[0].fill, count: 1, est: false }]]);
      else if (prev) {
        const delta = fill - prev.fill, kinds = [...gap];
        const turn = kinds.length ? Math.min(prev.usage.output, delta) : delta;
        hold("assistant", turn, 1, false);
        const chars = kinds.reduce((s, [, g]) => s + g.chars, 0) || 1;
        let left = delta - turn;
        kinds.forEach(([rec, g], i) => {
          const tokens = i === kinds.length - 1 ? left : Math.round((delta - turn) * g.chars / chars);
          left -= tokens;
          hold(rec, tokens, g.count, kinds.length > 1);
        });
      }
      gap = new Map();
      const parts: Part[] = MESSAGES.filter(([rec]) => held.has(rec)).map(([rec, name]) => {
        const h = held.get(rec)!;
        return { name: rec === "isCompactSummary" ? name : `${name} · ${h.count}`, rec, tokens: h.tokens, how: h.est ? "est" : "exact" };
      });
      out.push({ n: out.length + 1, fill, usage, parts });
    }
  }
  return { out, model, fixed: [
    ["System prompt", "prompt_snapshot", system], [`Tools · ${tools.length}`, "prompt_snapshot.tools", tools],
    [`Instructions · ${instructions.length} files`, "attachment instructions", instructions.join("")], ["Memory start context", "hook_additional_context", memory],
  ] };
}

/** Puts the fixed parts before each request's parts: `counts` (exact) per fixed part, else chars ÷ 4 scaled to request 1's fill (estimates). */
function withFixed({ out, fixed }: Scan, counts: number[] | null): Request[] {
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
  }
  return out;
}

const COUNT_URL = "https://api.anthropic.com/v1/messages/count_tokens";

/**
 * `parse`, with each fixed part counted by the Anthropic count_tokens endpoint for the session's model and marked exact.
 * The key comes from the dotenv file. With no key, no model, or any call failing, the fixed parts stay estimates.
 */
export async function parseExact(jsonl: string, fetchFn: typeof fetch = fetch): Promise<Request[]> {
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
