/**
 * Telegram forum-group adapter — docs/design/phase-1.md §8.2/§8.3.
 *
 * Long polling only: webhooks would need inbound reachability, which the
 * tailnet-only posture forbids. The update offset is persisted AFTER the job is
 * durably submitted, so a crash re-delivers rather than drops.
 */
import { mint } from "../../core/ids.ts";
import type { Clock } from "../../core/clock.ts";
import type { Channel, ChannelTarget, InboundMessage, OutboundMessage, SentRef, Attachment } from "../channel.ts";
import { TelegramApi, TelegramError, type TelegramMessage, type TelegramUpdate } from "./api.ts";

export const MAX_MESSAGE_CHARS = 4096;
export const MAX_PARTS = 3;

export interface TelegramChannelOptions {
  token: string;
  apiBase: string;
  chatId: string;
  ownerUserId: string;
  pollTimeoutSeconds: number;
  clock: Clock;
  fetchImpl?: typeof fetch;
  /** Persisted offset accessors — the daemon backs these with SQLite `kv`. */
  loadOffset: () => number;
  saveOffset: (offset: number) => void;
  onError?: (where: string, error: Error) => void;
  /** Test seam: sleep between poll cycles. */
  sleep?: (ms: number) => Promise<void>;
}

/** Split on paragraph, then line, then hard boundaries. Never mid-word if avoidable. */
export function splitMessage(text: string, limit = MAX_MESSAGE_CHARS): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(" ", limit);
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export class TelegramChannel implements Channel {
  readonly name = "telegram";
  readonly capabilities = { streamingEdits: false, attachments: true, buttons: true };
  private readonly api: TelegramApi;
  private running = false;
  private controller: AbortController | null = null;
  private loop: Promise<void> | null = null;

  constructor(private readonly opts: TelegramChannelOptions) {
    this.api = new TelegramApi({ token: opts.token, apiBase: opts.apiBase, fetchImpl: opts.fetchImpl });
  }

  async start(sink: (m: InboundMessage) => void | Promise<void>): Promise<void> {
    await this.api.getMe();          // fail loudly at boot, not silently at 3am
    this.running = true;
    this.controller = new AbortController();
    this.loop = this.poll(sink);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    await this.loop?.catch(() => {});
  }

  private async poll(sink: (m: InboundMessage) => void | Promise<void>): Promise<void> {
    const sleep = this.opts.sleep ?? ((ms: number) => Bun.sleep(ms));
    while (this.running) {
      try {
        const offset = this.opts.loadOffset();
        const updates = await this.api.getUpdates(offset, this.opts.pollTimeoutSeconds, this.controller?.signal);
        for (const update of updates) {
          const message = this.normalize(update);
          if (message) await sink(message);
          // Offset advances only after the sink has taken durable ownership.
          this.opts.saveOffset(update.update_id + 1);
        }
      } catch (e) {
        if (!this.running) return;
        const error = e instanceof Error ? e : new Error(String(e));
        this.opts.onError?.("getUpdates", error);
        const backoff = e instanceof TelegramError && e.retryAfter ? e.retryAfter * 1000 : 1000;
        await sleep(backoff);
      }
    }
  }

  private normalize(update: TelegramUpdate): InboundMessage | null {
    const msg = update.message ?? update.edited_message;
    if (!msg) return null;
    if (msg.forum_topic_created) return null;

    const attachments: Attachment[] = [];
    if (msg.voice) attachments.push({ kind: "audio", external_id: msg.voice.file_id, mime: msg.voice.mime_type, bytes: msg.voice.file_size });
    if (msg.document) attachments.push({ kind: "document", external_id: msg.document.file_id, mime: msg.document.mime_type, bytes: msg.document.file_size, file_name: msg.document.file_name });
    if (msg.photo?.length) attachments.push({ kind: "image", external_id: msg.photo[msg.photo.length - 1]!.file_id });

    const inbound: InboundMessage = {
      id: mint("msg", this.opts.clock.ms()),
      channel: this.name,
      external: {
        chat_id: String(msg.chat.id),
        thread_id: msg.message_thread_id !== undefined ? String(msg.message_thread_id) : undefined,
        message_id: String(msg.message_id),
        from: msg.from ? String(msg.from.id) : undefined,
      },
      text: msg.text ?? "",
      attachments: attachments.length ? attachments : undefined,
      received_at: this.opts.clock.iso(),
    };

    // Two checks, not one: the group could gain a member; the bot could be
    // added elsewhere. Either alone is insufficient (§8.3).
    if (String(msg.chat.id) !== this.opts.chatId) inbound.rejected = "wrong_chat";
    else if (!msg.from || String(msg.from.id) !== this.opts.ownerUserId) inbound.rejected = "unauthorized";
    return inbound;
  }

  async send(target: ChannelTarget, out: OutboundMessage): Promise<SentRef> {
    const chatId = target.chat_id ?? this.opts.chatId;
    const parts = splitMessage(out.text);

    if (out.asDocument || parts.length > MAX_PARTS) {
      const fileName = out.asDocument?.file_name ?? `reply-${this.opts.clock.iso().replace(/[:.]/g, "-")}.md`;
      const caption = `${parts[0]!.slice(0, 300)}…\n\n(full reply attached: ${fileName})`;
      const sent = await this.withRetry(() => this.api.sendDocument(chatId, fileName, out.text, caption, target.thread_id));
      return { external_ids: [String(sent.message_id)], parts: 1, bytes: Buffer.byteLength(out.text) };
    }

    const ids: string[] = [];
    for (const [i, part] of parts.entries()) {
      const sent = await this.withRetry(() => this.api.sendMessage(chatId, part, target.thread_id, i === 0 ? target.reply_to : undefined));
      ids.push(String(sent.message_id));
    }
    return { external_ids: ids, parts: parts.length, bytes: Buffer.byteLength(out.text) };
  }

  async createTopic(title: string): Promise<{ external_id: string; chat_id?: string }> {
    const topic = await this.withRetry(() => this.api.createForumTopic(this.opts.chatId, title.slice(0, 128)));
    return { external_id: String(topic.message_thread_id), chat_id: this.opts.chatId };
  }

  async closeTopic(externalId: string): Promise<void> {
    // Close, never delete: deleting would destroy Chris's own history.
    await this.withRetry(() => this.api.closeForumTopic(this.opts.chatId, externalId));
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    const sleep = this.opts.sleep ?? ((ms: number) => Bun.sleep(ms));
    let lastError: Error | undefined;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (e instanceof TelegramError && e.retryAfter !== undefined) {
          await sleep(e.retryAfter * 1000 + Math.floor(Math.random() * 250));
          continue;
        }
        if (e instanceof TelegramError && e.code >= 400 && e.code < 500 && e.code !== 429) throw e;
        await sleep(250 * 2 ** i);
      }
    }
    throw lastError ?? new Error("telegram send failed");
  }
}
