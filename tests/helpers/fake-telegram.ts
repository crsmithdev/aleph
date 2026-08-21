/**
 * A real HTTP server implementing the slice of the Bot API the adapter uses.
 * Integration tests point `telegram.api_base` at it — the adapter code under
 * test is the same code that talks to Telegram, unmocked.
 */
export interface FakeTelegramOptions {
  /** Number of 429s to return before succeeding, per method. */
  failWith429?: Record<string, number>;
  retryAfter?: number;
}

export interface FakeTelegram {
  base: string;
  port: number;
  calls: Array<{ method: string; body: any }>;
  /** Queue an incoming update, as Telegram would deliver it on getUpdates. */
  push(message: Partial<TgMessage> & { chat_id: number; from_id: number; text: string }): number;
  sent: Array<{ chat_id: string; text: string; thread_id?: string }>;
  topics: Array<{ id: number; name: string; closed: boolean }>;
  stop(): void;
}

interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  from: { id: number; is_bot: boolean };
  chat: { id: number; type: string; is_forum: boolean };
  date: number;
  text: string;
}

export function startFakeTelegram(opts: FakeTelegramOptions = {}): FakeTelegram {
  const updates: Array<{ update_id: number; message: TgMessage }> = [];
  const calls: FakeTelegram["calls"] = [];
  const sent: FakeTelegram["sent"] = [];
  const topics: FakeTelegram["topics"] = [];
  const remaining429 = { ...(opts.failWith429 ?? {}) };
  let nextUpdateId = 1000;
  let nextMessageId = 1;
  let nextTopicId = 50;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const method = url.pathname.split("/").pop()!;
      let body: any = {};
      const contentType = req.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) body = await req.json().catch(() => ({}));
      else if (contentType.includes("multipart/form-data")) {
        const form = await req.formData();
        body = Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `<file:${(v as File).name}>`]));
      }
      calls.push({ method, body });

      if ((remaining429[method] ?? 0) > 0) {
        remaining429[method] = (remaining429[method] ?? 0) - 1;
        return Response.json({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: opts.retryAfter ?? 1 } });
      }

      switch (method) {
        case "getMe":
          return Response.json({ ok: true, result: { id: 999, username: "aleph_test_bot" } });
        case "getUpdates": {
          const offset = Number(body.offset ?? 0);
          const pending = updates.filter((u) => u.update_id >= offset);
          return Response.json({ ok: true, result: pending });
        }
        case "sendMessage": {
          sent.push({ chat_id: String(body.chat_id), text: String(body.text), thread_id: body.message_thread_id ? String(body.message_thread_id) : undefined });
          return Response.json({ ok: true, result: { message_id: ++nextMessageId } });
        }
        case "sendDocument": {
          sent.push({ chat_id: String(body.chat_id), text: `<document ${body.document}>`, thread_id: body.message_thread_id ? String(body.message_thread_id) : undefined });
          return Response.json({ ok: true, result: { message_id: ++nextMessageId } });
        }
        case "createForumTopic": {
          const id = ++nextTopicId;
          topics.push({ id, name: String(body.name), closed: false });
          return Response.json({ ok: true, result: { message_thread_id: id, name: body.name } });
        }
        case "closeForumTopic": {
          const topic = topics.find((t) => t.id === Number(body.message_thread_id));
          if (topic) topic.closed = true;
          return Response.json({ ok: true, result: true });
        }
        default:
          return Response.json({ ok: false, error_code: 404, description: `unknown method ${method}` });
      }
    },
  });

  const port = server.port ?? 0;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    calls, sent, topics,
    push(m) {
      const update_id = ++nextUpdateId;
      updates.push({
        update_id,
        message: {
          message_id: ++nextMessageId,
          message_thread_id: m.message_thread_id,
          from: { id: m.from_id, is_bot: false },
          chat: { id: m.chat_id, type: "supergroup", is_forum: true },
          date: Math.floor(Date.now() / 1000),
          text: m.text,
        },
      });
      return update_id;
    },
    stop() { server.stop(true); },
  };
}
