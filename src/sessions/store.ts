/** SQLite session store — docs/design/phase-1.md §7.2. */
import type { Db } from "../platform/db.ts";
import type { Clock } from "../core/clock.ts";
import { mint, slugify } from "../core/ids.ts";

export type SessionState = "active" | "idle" | "archived";

export interface SessionRow {
  id: string;
  topic_key: string;
  title: string;
  state: SessionState;
  sdk_session_id: string | null;
  created_at: string;
  last_turn_at: string | null;
  turn_count: number;
  checkpoint_path: string | null;
  model_class: string;
  archived_at: string | null;
}

export interface BindingRow {
  channel: string;
  external_id: string;
  session_id: string;
  chat_id: string | null;
  created_at: string;
}

export class SessionStore {
  constructor(private readonly db: Db, private readonly clock: Clock) {}

  get(id: string): SessionRow | null {
    return this.db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?").get(id) ?? null;
  }

  byTopic(topicKey: string): SessionRow | null {
    return this.db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE topic_key = ?").get(topicKey) ?? null;
  }

  list(includeArchived = false): SessionRow[] {
    return includeArchived
      ? this.db.query<SessionRow, []>("SELECT * FROM sessions ORDER BY COALESCE(last_turn_at, created_at) DESC").all()
      : this.db.query<SessionRow, []>("SELECT * FROM sessions WHERE state != 'archived' ORDER BY COALESCE(last_turn_at, created_at) DESC").all();
  }

  activeTitles(): Array<{ topic_key: string; title: string }> {
    return this.db.query<{ topic_key: string; title: string }, []>(
      "SELECT topic_key, title FROM sessions WHERE state != 'archived' ORDER BY COALESCE(last_turn_at, created_at) DESC",
    ).all();
  }

  create(title: string, opts: { topicKey?: string; modelClass?: string } = {}): SessionRow {
    let key = opts.topicKey ?? slugify(title);
    if (this.byTopic(key)) {
      let n = 2;
      while (this.byTopic(`${key}-${n}`)) n++;
      key = `${key}-${n}`;
    }
    const row: SessionRow = {
      id: mint("ses", this.clock.ms()),
      topic_key: key,
      title,
      state: "active",
      sdk_session_id: null,
      created_at: this.clock.iso(),
      last_turn_at: null,
      turn_count: 0,
      checkpoint_path: `wiki/projects/${key}/session-brief.md`,
      model_class: opts.modelClass ?? "conversation",
      archived_at: null,
    };
    this.db.run(
      `INSERT INTO sessions (id, topic_key, title, state, sdk_session_id, created_at, last_turn_at, turn_count, checkpoint_path, model_class, archived_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [row.id, row.topic_key, row.title, row.state, null, row.created_at, null, 0, row.checkpoint_path, row.model_class, null],
    );
    return row;
  }

  bind(channel: string, externalId: string, sessionId: string, chatId?: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO channel_bindings (channel, external_id, session_id, chat_id, created_at) VALUES (?,?,?,?,?)",
      [channel, externalId, sessionId, chatId ?? null, this.clock.iso()],
    );
  }

  binding(channel: string, externalId: string): BindingRow | null {
    return this.db.query<BindingRow, [string, string]>(
      "SELECT * FROM channel_bindings WHERE channel = ? AND external_id = ?",
    ).get(channel, externalId) ?? null;
  }

  bindingsFor(sessionId: string): BindingRow[] {
    return this.db.query<BindingRow, [string]>("SELECT * FROM channel_bindings WHERE session_id = ?").all(sessionId);
  }

  recordTurn(sessionId: string, sdkSessionId: string | null): void {
    this.db.run(
      "UPDATE sessions SET turn_count = turn_count + 1, last_turn_at = ?, state = 'active', sdk_session_id = COALESCE(?, sdk_session_id) WHERE id = ?",
      [this.clock.iso(), sdkSessionId, sessionId],
    );
  }

  setState(sessionId: string, state: SessionState): void {
    this.db.run("UPDATE sessions SET state = ?, archived_at = ? WHERE id = ?", [
      state, state === "archived" ? this.clock.iso() : null, sessionId,
    ]);
  }

  /** Sessions whose idle time crossed a threshold — driven by the daemon tick. */
  staleSessions(idleHours: number, archiveDays: number): { idle: SessionRow[]; archive: SessionRow[] } {
    const now = this.clock.ms();
    const rows = this.db.query<SessionRow, []>("SELECT * FROM sessions WHERE state != 'archived'").all();
    const idleMs = idleHours * 3600_000;
    const archiveMs = archiveDays * 86_400_000;
    const age = (r: SessionRow) => now - Date.parse(r.last_turn_at ?? r.created_at);
    return {
      idle: rows.filter((r) => r.state === "active" && age(r) >= idleMs && age(r) < archiveMs),
      archive: rows.filter((r) => age(r) >= archiveMs),
    };
  }

  startTurn(input: { session_id: string; trace_id: string; lane: string; model: string; tier: string; resume_mode: string }): string {
    const id = mint("turn", this.clock.ms());
    this.db.run(
      `INSERT INTO turns (id, session_id, trace_id, started_at, status, model, tier, lane, resume_mode)
       VALUES (?,?,?,?,'running',?,?,?,?)`,
      [id, input.session_id, input.trace_id, this.clock.iso(), input.model, input.tier, input.lane, input.resume_mode],
    );
    return id;
  }

  endTurn(turnId: string, status: "ok" | "failed" | "refused", usage?: {
    input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number; cost_usd: number | null;
  }): void {
    this.db.run(
      `UPDATE turns SET ended_at = ?, status = ?, input_tokens = ?, output_tokens = ?,
        cache_read_tokens = ?, cache_creation_tokens = ?, cost_usd = ? WHERE id = ?`,
      [this.clock.iso(), status, usage?.input_tokens ?? null, usage?.output_tokens ?? null,
       usage?.cache_read_tokens ?? null, usage?.cache_creation_tokens ?? null, usage?.cost_usd ?? null, turnId],
    );
  }

  kvGet(key: string): string | null {
    return this.db.query<{ value: string }, [string]>("SELECT value FROM kv WHERE key = ?").get(key)?.value ?? null;
  }
  kvSet(key: string, value: string): void {
    this.db.run("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?,?,?)", [key, value, this.clock.iso()]);
  }
}
