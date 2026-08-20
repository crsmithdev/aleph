/**
 * Channel adapter boundary — docs/design/phase-1.md §8.1.
 *
 * Adapters normalize and hand off. No session resolution, no routing, no vault
 * access lives here; that is what makes "channel-agnostic sessions" true rather
 * than aspirational.
 */
export interface Attachment {
  kind: "audio" | "image" | "document";
  external_id: string;
  mime?: string;
  bytes?: number;
  file_name?: string;
}

export interface InboundMessage {
  id: string;
  channel: string;
  external: { chat_id?: string; thread_id?: string; message_id?: string; from?: string };
  text: string;
  attachments?: Attachment[];
  received_at: string;
  /** Set by the adapter when the message failed authorization; the daemon logs and drops. */
  rejected?: string;
}

export interface OutboundMessage {
  text: string;
  /** Reply is a document when the text is too long for the channel (design v1.0 §3.3). */
  asDocument?: { file_name: string };
}

export interface ChannelTarget {
  chat_id?: string;
  thread_id?: string;
  reply_to?: string;
}

export interface SentRef {
  external_ids: string[];
  parts: number;
  bytes: number;
}

export interface Channel {
  readonly name: string;
  readonly capabilities: { streamingEdits: boolean; attachments: boolean; buttons: boolean };
  start(sink: (m: InboundMessage) => void | Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(target: ChannelTarget, out: OutboundMessage): Promise<SentRef>;
  /** Create the channel-native container for a new topic, if the channel has one. */
  createTopic?(title: string): Promise<{ external_id: string; chat_id?: string }>;
  closeTopic?(externalId: string): Promise<void>;
}
