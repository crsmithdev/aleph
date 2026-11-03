// Archived goal tests from ui/usage.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchUsage, pollOnce, readSnapshots, summary } from "../../ui/usage.ts";
// @ts-ignore plain JS, shared with the page
import { costHtml, wkText } from "../../ui/lib.js";
// @ts-ignore plain JS view

let dir: string, server: ReturnType<typeof Bun.serve>;
/** What the test server answers; a test swaps it to make the endpoint fail. */
let reply: (req: Request) => Response;
/** A reset in the future of the real clock: a poll takes the time of the real clock, and a past reset drops its snapshot. */
const nextWeek = () => new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
const OK = (req: Request) => {
  if (req.headers.get("authorization") !== `Bearer ${TOKEN}` || req.headers.get("anthropic-beta") !== "oauth-2025-04-20") return new Response("no", { status: 401 });
  return Response.json({ five_hour: { utilization: 0, resets_at: "2026-10-28T20:00:00Z" }, seven_day: { utilization: 25, resets_at: nextWeek() } });
};
const TOKEN = "sk-ant-oat-example-token";
/** The lines written to console.error while `fn` runs. */
async function errors(fn: () => Promise<unknown>): Promise<string[]> {
  const orig = console.error, lines: string[] = [];
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.error = orig; }
  return lines;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-"));
  process.env.ALEPH_USAGE_FILE = join(dir, "usage.jsonl");
  process.env.ALEPH_CLAUDE_CREDENTIALS = join(dir, "cred.json");
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN } }));
  reply = OK;
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => reply(req) });
  process.env.ALEPH_USAGE_URL = `http://127.0.0.1:${server.port}/`;
});
afterEach(() => { server.stop(true); rmSync(dir, { recursive: true }); delete process.env.ALEPH_USAGE_URL; });

test("a poll appends the snapshot and the token is nowhere in it", async () => {
  const s = await pollOnce();
  expect(s?.seven_day).toBe(25);
  const text = readFileSync(process.env.ALEPH_USAGE_FILE!, "utf8");
  expect(text).not.toContain(TOKEN);
  expect(readSnapshots()).toHaveLength(1);
  expect(summary().now?.seven_day).toBe(25);
  expect(JSON.stringify(summary())).not.toContain(TOKEN);
});

test("a bad token records nothing; the last snapshot stays, marked stale", async () => {
  await pollOnce();
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS!, JSON.stringify({ claudeAiOauth: { accessToken: "bad" } }));
  expect(await pollOnce()).toBeNull();
  expect(readFileSync(process.env.ALEPH_USAGE_FILE!, "utf8").trim().split("\n")).toHaveLength(1);
  expect(summary().now?.seven_day).toBe(25);
  expect(summary().stale).toBe(true);
});

test("an old snapshot is stale but kept; after its reset it is dropped; none is unknown", async () => {
  await pollOnce();
  const last = readSnapshots().at(-1)!;
  const at = Date.parse(last.at);
  const s = summary(at + 40 * 60_000);
  expect(s.now).not.toBeNull();
  expect(s.stale).toBe(true);
  expect(summary(at + 60_000).stale).toBe(false);
  const r = Date.parse(last.seven_day_resets_at ?? "");
  if (!Number.isNaN(r)) expect(summary(r + 1).now).toBeNull();
  rmSync(process.env.ALEPH_USAGE_FILE!);
  expect(summary().now).toBeNull();
});

test("no credentials file records nothing", async () => {
  rmSync(process.env.ALEPH_CLAUDE_CREDENTIALS!);
  expect(await pollOnce()).toBeNull();
  expect(existsSync(process.env.ALEPH_USAGE_FILE!)).toBe(false);
});

test("the share is shown first, with a tooltip, and the dollars stay", () => {
  const html = costHtml(2.3, { pct: 1.44, pooled: true });
  expect(html.indexOf("≈1.4% wk")).toBeLessThan(html.indexOf("$2.30"));
  expect(html).toContain("estimate");
  expect(html).toContain("claude.ai");
  expect(html).toContain("pooled");
  expect(costHtml(2.3)).toBe("$2.30");
  expect(wkText({ pct: 0.01, pooled: false })).toBe("≈<0.1% wk");
});

test("a 429 logs one line with the status and the Retry-After value, and the poll returns null", async () => {
  reply = () => new Response("slow down", { status: 429, headers: { "retry-after": "540" } });
  let result: unknown;
  const lines = await errors(async () => { result = await pollOnce(); });
  expect(result).toBeNull();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("429");
  expect(lines[0]).toContain("540");
  expect(lines[0]).not.toContain(TOKEN);
});

test("a 401 logs one line with the status", async () => {
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS!, JSON.stringify({ claudeAiOauth: { accessToken: "bad" } }));
  const lines = await errors(() => pollOnce());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("401");
});

test("a missing credentials file logs one line that names the credentials file", async () => {
  rmSync(process.env.ALEPH_CLAUDE_CREDENTIALS!);
  const lines = await errors(() => pollOnce());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("credentials file");
});

test("a credentials file that is invalid JSON logs one line without the token", async () => {
  writeFileSync(process.env.ALEPH_CLAUDE_CREDENTIALS!, `{"claudeAiOauth": {"accessToken": "${TOKEN}"`);
  const lines = await errors(() => pollOnce());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("credentials file");
  expect(lines[0]).not.toContain(TOKEN);
});

test("a successful poll writes no line", async () => {
  const lines = await errors(async () => { expect((await fetchUsage())?.seven_day).toBe(25); });
  expect(lines).toHaveLength(0);
});
