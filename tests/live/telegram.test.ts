/**
 * LIVE Telegram. Needs a real bot, a real private forum group and:
 *   ALEPH_LIVE=1 TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... TELEGRAM_OWNER_ID=...
 * Posts into the real group — run it against a scratch group first.
 */
import { test, expect, describe } from "bun:test";
import { TelegramApi } from "../../src/channels/telegram/api.ts";

const LIVE = process.env.ALEPH_LIVE === "1" && Boolean(process.env.TELEGRAM_BOT_TOKEN);
const describeLive = LIVE ? describe : describe.skip;

describeLive("live telegram", () => {
  const api = new TelegramApi({
    token: process.env.TELEGRAM_BOT_TOKEN!,
    apiBase: process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org",
  });

  test("getMe identifies the bot", async () => {
    const me = await api.getMe();
    expect(me.username).toBeTruthy();
  }, 60_000);

  test("the group is a forum and the bot can create and close a topic", async () => {
    const chatId = process.env.TELEGRAM_CHAT_ID!;
    const topic = await api.createForumTopic(chatId, `aleph-live-${Date.now()}`);
    expect(topic.message_thread_id).toBeGreaterThan(0);
    await api.sendMessage(chatId, "aleph-next live test — this topic will close itself", String(topic.message_thread_id));
    await api.closeForumTopic(chatId, String(topic.message_thread_id));
  }, 60_000);
});
