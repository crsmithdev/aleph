/**
 * Append-only JSONL event log + its derived SQLite index.
 *
 * docs/design/phase-1.md §5.5. The JSONL is the ground truth; the `events`
 * table is an index that `os events reindex` can rebuild from it. One write()
 * per line so concurrent appends cannot interleave.
 */
import { openSync, writeSync, fsyncSync, closeSync, statSync, mkdirSync, existsSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../platform/db.ts";
import type { Envelope } from "./envelope.ts";
import type { Clock } from "./clock.ts";

export interface EventLogOptions {
  dir: string;
  db: Db;
  clock: Clock;
  fsyncIntervalMs?: number;
}

export class EventLog {
  private fd: number | null = null;
  private file = "";
  private offset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(private readonly opts: EventLogOptions) {
    mkdirSync(opts.dir, { recursive: true });
    this.roll();
    const interval = opts.fsyncIntervalMs ?? 1000;
    if (interval > 0) {
      this.timer = setInterval(() => this.flush(), interval);
      this.timer.unref?.();
    }
  }

  private dayFile(): string {
    return join(this.opts.dir, `${this.opts.clock.iso().slice(0, 10)}.jsonl`);
  }

  private roll(): void {
    const target = this.dayFile();
    if (target === this.file && this.fd !== null) return;
    if (this.fd !== null) { this.flush(); closeSync(this.fd); }
    this.file = target;
    this.fd = openSync(target, "a");
    this.offset = existsSync(target) ? statSync(target).size : 0;
  }

  /** Returns the byte offset of the appended line. */
  append(envelope: Envelope): { file: string; offset: number } {
    this.roll();
    const line = JSON.stringify(envelope) + "\n";
    const bytes = Buffer.byteLength(line);
    const at = this.offset;
    writeSync(this.fd!, line);
    this.offset += bytes;
    this.dirty = true;
    index(this.opts.db, envelope, this.file, at);
    return { file: this.file, offset: at };
  }

  flush(): void {
    if (this.fd !== null && this.dirty) {
      fsyncSync(this.fd);
      this.dirty = false;
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }

  currentFile(): string { return this.file; }
}

export function index(db: Db, e: Envelope, file: string, offset: number): void {
  db.run(
    `INSERT OR REPLACE INTO events
       (id, ts, kind, origin, session_id, task_id, run_id, trace_id, caused_by, actor, file, offset, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id, e.ts, e.kind, e.ids.origin,
      e.ids.session_id ?? null, e.ids.task_id ?? null, e.ids.run_id ?? null,
      e.ids.trace_id, e.caused_by, e.actor, file, offset, JSON.stringify(e.payload),
    ],
  );
}

/** Rebuild the whole index from the JSONL files. Proves §5.5's claim. */
export function reindex(db: Db, dir: string): { files: number; events: number } {
  db.run("DELETE FROM events");
  let files = 0, events = 0;
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort() : [];
  for (const name of names) {
    const path = join(dir, name);
    const text = readFileSync(path, "utf8");
    let offset = 0;
    db.transaction(() => {
      for (const line of text.split("\n")) {
        if (!line) continue;
        index(db, JSON.parse(line) as Envelope, path, offset);
        offset += Buffer.byteLength(line) + 1;
        events++;
      }
    })();
    files++;
  }
  return { files, events };
}

/** Read one event back from its (file, offset) — the index's O(1) escape hatch. */
export function readEventAt(file: string, offset: number): Envelope {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size - offset;
    const buf = Buffer.alloc(Math.min(size, 1 << 20));
    readSync(fd, buf, 0, buf.length, offset);
    const line = buf.toString("utf8").split("\n")[0]!;
    return JSON.parse(line) as Envelope;
  } finally {
    closeSync(fd);
  }
}
