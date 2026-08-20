/**
 * Bot API client over fetch. No SDK dependency: the surface we need is six
 * methods, and `api_base` must be swappable to the self-hosted telegram-bot-api
 * server (design v1.0 §3.3) without anything else noticing.
 */
export interface TelegramOptions {
  token: string;
  apiBase: string;
  fetchImpl?: typeof fetch;
}

export class TelegramError extends Error {
  constructor(readonly method: string, readonly code: number, readonly description: string, readonly retryAfter?: number) {
    super(`telegram ${method} failed ${code}: ${description}`);
    this.name = "TelegramError";
  }
}

export class TelegramApi {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: TelegramOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private url(method: string): string {
    return `${this.opts.apiBase.replace(/\/+$/, "")}/bot${this.opts.token}/${method}`;
  }

  async call<T>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    const res = await this.fetchImpl(this.url(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json = (await res.json()) as { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    if (!json.ok) {
      throw new TelegramError(method, json.error_code ?? res.status, json.description ?? "unknown", json.parameters?.retry_after);
    }
    return json.result as T;
  }

  getMe() { return this.call<{ id: number; username: string }>("getMe"); }

  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal) {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset, timeout: timeoutSeconds, allowed_updates: ["message", "edited_message", "callback_query"],
    }, signal);
  }

  sendMessage(chatId: string, text: string, threadId?: string, replyTo?: string) {
    return this.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId, text,
      message_thread_id: threadId ? Number(threadId) : undefined,
      reply_to_message_id: replyTo ? Number(replyTo) : undefined,
      link_preview_options: { is_disabled: true },
    });
  }

  sendDocument(chatId: string, fileName: string, content: string, caption: string, threadId?: string) {
    const form = new FormData();
    form.set("chat_id", chatId);
    if (threadId) form.set("message_thread_id", threadId);
    form.set("caption", caption.slice(0, 1024));
    form.set("document", new Blob([content], { type: "text/markdown" }), fileName);
    return this.callForm<{ message_id: number }>("sendDocument", form);
  }

  private async callForm<T>(method: string, form: FormData): Promise<T> {
    const res = await this.fetchImpl(this.url(method), { method: "POST", body: form });
    const json = (await res.json()) as { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    if (!json.ok) throw new TelegramError(method, json.error_code ?? res.status, json.description ?? "unknown", json.parameters?.retry_after);
    return json.result as T;
  }

  createForumTopic(chatId: string, name: string) {
    return this.call<{ message_thread_id: number; name: string }>("createForumTopic", { chat_id: chatId, name });
  }

  closeForumTopic(chatId: string, threadId: string) {
    return this.call<boolean>("closeForumTopic", { chat_id: chatId, message_thread_id: Number(threadId) });
  }
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: { id: number; username?: string; is_bot?: boolean };
  chat: { id: number; type: string; is_forum?: boolean };
  date: number;
  text?: string;
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_size?: number }>;
  forum_topic_created?: { name: string };
}
