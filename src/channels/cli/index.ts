/**
 * CLI channel over a Unix socket (0600). Same Channel interface as Telegram, so
 * `os send --topic X` continues the conversation Chris was having on his phone.
 * That cross-channel continuity is the cheapest possible proof that sessions are
 * genuinely channel-agnostic (§8.5).
 */
import { unlinkSync, existsSync, chmodSync } from "node:fs";
import { mint } from "../../core/ids.ts";
import type { Clock } from "../../core/clock.ts";
import type { Channel, ChannelTarget, InboundMessage, OutboundMessage, SentRef } from "../channel.ts";

export interface CliRequest {
  op: string;
  topic?: string;
  text?: string;
  args?: Record<string, unknown>;
}

export type CliHandler = (req: CliRequest, message?: InboundMessage) => Promise<unknown>;

export interface CliChannelOptions {
  socketPath: string;
  clock: Clock;
  /** Non-message operations (status, sessions, meter, ...) are handled here. */
  control: CliHandler;
}

export class CliChannel implements Channel {
  readonly name = "cli";
  readonly capabilities = { streamingEdits: false, attachments: false, buttons: false };
  private server: ReturnType<typeof Bun.serve> | null = null;
  private pending = new Map<string, (out: OutboundMessage) => void>();

  constructor(private readonly opts: CliChannelOptions) {}

  async start(sink: (m: InboundMessage) => void | Promise<void>): Promise<void> {
    if (existsSync(this.opts.socketPath)) unlinkSync(this.opts.socketPath);
    this.server = Bun.serve({
      unix: this.opts.socketPath,
      fetch: async (req) => {
        let body: CliRequest;
        try { body = (await req.json()) as CliRequest; }
        catch { return Response.json({ ok: false, error: "invalid json" }, { status: 400 }); }

        if (body.op !== "send") {
          try { return Response.json({ ok: true, result: await this.opts.control(body) }); }
          catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
        }

        const message: InboundMessage = {
          id: mint("msg", this.opts.clock.ms()),
          channel: this.name,
          external: { thread_id: body.topic, message_id: undefined, from: "cli" },
          text: body.text ?? "",
          received_at: this.opts.clock.iso(),
        };
        const reply = new Promise<OutboundMessage>((resolve) => this.pending.set(message.id, resolve));
        await sink(message);
        const out = await Promise.race([
          reply,
          new Promise<OutboundMessage>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for the daemon to reply")), 600_000)),
        ]).catch((e: Error) => ({ text: `error: ${e.message}` }));
        this.pending.delete(message.id);
        return Response.json({ ok: true, result: { text: out.text } });
      },
    });
    chmodSync(this.opts.socketPath, 0o600);
  }

  async stop(): Promise<void> {
    this.server?.stop(true);
    this.server = null;
    if (existsSync(this.opts.socketPath)) { try { unlinkSync(this.opts.socketPath); } catch { /* already gone */ } }
  }

  async send(target: ChannelTarget, out: OutboundMessage): Promise<SentRef> {
    const resolve = target.reply_to ? this.pending.get(target.reply_to) : undefined;
    resolve?.(out);
    return { external_ids: target.reply_to ? [target.reply_to] : [], parts: 1, bytes: Buffer.byteLength(out.text) };
  }
}

/** Client helper used by the `os` CLI. */
export async function cliRequest(socketPath: string, req: CliRequest, timeoutMs = 620_000): Promise<unknown> {
  const res = await fetch("http://localhost/", {
    unix: socketPath,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(timeoutMs),
  } as RequestInit & { unix: string });
  const json = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
  if (!json.ok) throw new Error(json.error ?? "daemon error");
  return json.result;
}
