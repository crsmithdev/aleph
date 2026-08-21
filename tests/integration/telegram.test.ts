import { test, expect, describe, afterEach } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeWorkspace, type Workspace } from "../helpers/workspace.ts";
import { startDaemon, type RunningDaemon } from "../helpers/daemon-process.ts";
import { startFakeTelegram, type FakeTelegram } from "../helpers/fake-telegram.ts";
import { splitMessage, MAX_MESSAGE_CHARS } from "../../src/channels/telegram/index.ts";

let ws: Workspace | null = null;
let daemon: RunningDaemon | null = null;
let tg: FakeTelegram | null = null;

afterEach(async () => {
  if (daemon) { await daemon.stop(); daemon = null; }
  if (tg) { tg.stop(); tg = null; }
  if (ws) { ws.cleanup(); ws = null; }
});

function events(w: Workspace): any[] {
  if (!existsSync(w.eventsDir)) return [];
  return readdirSync(w.eventsDir).filter((f) => f.endsWith(".jsonl")).sort()
    .flatMap((f) => readFileSync(join(w.eventsDir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v !== undefined && (!Array.isArray(v) || v.length > 0)) return v;
    await Bun.sleep(100);
  }
  throw new Error("timed out waiting for condition");
}

describe("message splitting", () => {
  test("short messages are one part", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });
  test("long messages split on paragraph boundaries, under the limit", () => {
    const text = Array.from({ length: 400 }, (_, i) => `paragraph ${i} ${"x".repeat(30)}`).join("\n\n");
    const parts = splitMessage(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(parts.join("\n\n").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });
});

describe("forum topics", () => {
  test("a General message creates a topic, binds it, and the reply lands in it", async () => {
    tg = startFakeTelegram();
    ws = makeWorkspace({ telegram_enabled: "true", telegram_api_base: tg.base });
    daemon = await startDaemon(ws.configFile, ws.socket);

    tg.push({ chat_id: -100777, from_id: 42, text: "hello from the general topic" });

    const sent = await waitFor(() => (tg!.sent.length ? tg!.sent : undefined));
    expect(tg.topics.length).toBe(1);
    expect(tg.topics[0]!.name).toContain("hello from the general topic");
    expect(sent[0]!.thread_id).toBe(String(tg.topics[0]!.id));
    expect(sent[0]!.text).toContain("hello from the general topic");

    const created = events(ws).find((e) => e.kind === "channel.topic_created");
    expect(created.payload.external_id).toBe(String(tg.topics[0]!.id));
  }, 60_000);

  test("a message in an existing topic reaches the bound session, not a new one", async () => {
    tg = startFakeTelegram();
    ws = makeWorkspace({ telegram_enabled: "true", telegram_api_base: tg.base });
    daemon = await startDaemon(ws.configFile, ws.socket);

    tg.push({ chat_id: -100777, from_id: 42, text: "first" });
    await waitFor(() => (tg!.topics.length ? tg!.topics : undefined));
    const threadId = tg.topics[0]!.id;
    await waitFor(() => (tg!.sent.length ? tg!.sent : undefined));

    tg.push({ chat_id: -100777, from_id: 42, message_thread_id: threadId, text: "second" });
    await waitFor(() => (tg!.sent.length >= 2 ? tg!.sent : undefined));

    const sessions = await daemon.call("sessions");
    expect(sessions.length).toBe(1);
    expect(sessions[0].turn_count).toBe(2);
    expect(tg.topics.length).toBe(1);
  }, 60_000);
});

describe("inbound authorization", () => {
  test("a stranger in the group and the right user in another chat are both dropped", async () => {
    tg = startFakeTelegram();
    ws = makeWorkspace({ telegram_enabled: "true", telegram_api_base: tg.base });
    daemon = await startDaemon(ws.configFile, ws.socket);

    tg.push({ chat_id: -100777, from_id: 43, text: "I am not Chris" });
    tg.push({ chat_id: -100999, from_id: 42, text: "right user, wrong chat" });
    tg.push({ chat_id: -100777, from_id: 42, text: "the real one" });

    await waitFor(() => (tg!.sent.length ? tg!.sent : undefined));
    await Bun.sleep(500);

    const rejected = events(ws).filter((e) => e.kind === "channel.message_received" && e.payload.rejected);
    expect(rejected.map((e) => e.payload.rejected).sort()).toEqual(["unauthorized", "wrong_chat"]);
    // Only the authorized message produced a session and a reply.
    expect((await daemon.call("sessions")).length).toBe(1);
    expect(tg.sent.length).toBe(1);
    // Dropped messages carry no text into the log.
    for (const e of rejected) expect(e.payload.text).toBe("");
  }, 60_000);
});

describe("rate limits and durability", () => {
  test("a 429 is honoured with its retry_after and the send still succeeds", async () => {
    tg = startFakeTelegram({ failWith429: { sendMessage: 1 }, retryAfter: 1 });
    ws = makeWorkspace({ telegram_enabled: "true", telegram_api_base: tg.base });
    daemon = await startDaemon(ws.configFile, ws.socket);

    const started = Date.now();
    tg.push({ chat_id: -100777, from_id: 42, text: "rate limited please" });
    await waitFor(() => (tg!.sent.length ? tg!.sent : undefined), 30_000);

    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(tg.calls.filter((c) => c.method === "sendMessage").length).toBe(2);
  }, 60_000);

  test("the update offset survives a restart: no loss, no duplicate reply", async () => {
    tg = startFakeTelegram();
    ws = makeWorkspace({ telegram_enabled: "true", telegram_api_base: tg.base });
    daemon = await startDaemon(ws.configFile, ws.socket);

    tg.push({ chat_id: -100777, from_id: 42, text: "before restart" });
    await waitFor(() => (tg!.sent.length ? tg!.sent : undefined));
    expect(tg.sent.length).toBe(1);

    await daemon.stop();
    daemon = await startDaemon(ws.configFile, ws.socket);
    await Bun.sleep(1500);

    // The already-processed update must not be replayed into a second reply.
    expect(tg.sent.length).toBe(1);

    tg.push({ chat_id: -100777, from_id: 42, text: "after restart" });
    await waitFor(() => (tg!.sent.length >= 2 ? tg!.sent : undefined));
    expect(tg.sent[1]!.text).toContain("after restart");
  }, 60_000);
});
