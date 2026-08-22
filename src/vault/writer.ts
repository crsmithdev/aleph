/**
 * The only thing that touches the vault.
 *
 * docs/design/phase-1.md §10.4. Prohibitions are checked here AND enforced at
 * the mount (§10.3) — this layer is defence in depth, not the gate.
 */
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { emit } from "../core/emit.ts";
import type { IdTuple } from "../core/envelope.ts";
import { VaultDenied } from "../core/errors.ts";
import { commit } from "./git.ts";

/** Paths the agent side may never write. Mirrors VAULT.md's prohibition list. */
export const READ_ONLY_PREFIXES = ["human/", "VAULT.md", ".git/"];

export interface VaultWriterOptions {
  root: string;
  memoryMaxLines: number;
  commitPerWrite: string[];
  gitEnabled?: boolean;
}

export class VaultWriter {
  constructor(private readonly opts: VaultWriterOptions) {}

  /**
   * Resolve a vault-relative path, REFUSING anything that escapes rather than
   * sanitizing it. Silently rewriting `../x` into `x` would turn an attempted
   * escape into a successful write to a different file — the failure mode a
   * path check exists to prevent.
   */
  private safeRelative(relPath: string): { rel: string; abs: string } {
    if (relPath.length === 0) throw new VaultDenied("empty_path", relPath);
    if (isAbsolute(relPath)) throw new VaultDenied("absolute_path", relPath);
    const abs = resolve(this.opts.root, relPath);
    const rel = relative(this.opts.root, abs);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new VaultDenied("escapes_vault", relPath);
    return { rel: rel.split(sep).join("/"), abs };
  }

  check(relPath: string, content?: string): string {
    const { rel } = this.safeRelative(relPath);
    for (const prefix of READ_ONLY_PREFIXES) {
      if (rel === prefix || rel === prefix.replace(/\/$/, "") || rel.startsWith(prefix)) {
        throw new VaultDenied("read_only_namespace", relPath);
      }
    }
    if (rel.startsWith("log/")) {
      const today = new Date().toISOString().slice(0, 10);
      if (rel !== `log/${today}.md`) throw new VaultDenied("log_not_today", relPath);
    }
    if (rel === "MEMORY.md" && content !== undefined) {
      const lines = content.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).length;
      if (lines > this.opts.memoryMaxLines) throw new VaultDenied("memory_line_budget", relPath);
    }
    return rel;
  }

  private shouldCommit(relPath: string): boolean {
    return this.opts.commitPerWrite.some((p) => (p.endsWith("/") ? relPath.startsWith(p) : relPath === p));
  }

  /** Rewrite-don't-append is the doctrine; `mode` records which one happened. */
  write(relPath: string, content: string, ids: IdTuple, opts: { causedBy?: string; mode?: "rewrite" | "create" | "append" } = {}): { path: string; sha256: string; commit: string | null } {
    let rel: string;
    try {
      rel = this.check(relPath, content);
    } catch (e) {
      if (e instanceof VaultDenied) {
        emit("vault.write_denied", ids, { path: relPath, reason: e.reason }, {
          causedBy: opts.causedBy,
          cause: { kind: "computed", text: `write refused: ${e.reason}`, source: "vault/writer.ts:write" },
        });
      }
      throw e;
    }

    const abs = resolve(this.opts.root, rel);
    const mode = opts.mode ?? (existsSync(abs) ? "rewrite" : "create");
    mkdirSync(dirname(abs), { recursive: true });
    const body = mode === "append" && existsSync(abs) ? readFileSync(abs, "utf8") + content : content;

    const tmp = join(dirname(abs), `.${Date.now()}.tmp`);
    writeFileSync(tmp, body);
    renameSync(tmp, abs);

    const h = new Bun.CryptoHasher("sha256");
    h.update(body);
    const sha256 = h.digest("hex");

    const writeEvent = emit("vault.written", ids, { path: rel, bytes: Buffer.byteLength(body), sha256, mode }, {
      causedBy: opts.causedBy,
      cause: { kind: "computed", text: `${mode} ${relPath}`, source: "vault/writer.ts:write" },
    });

    let sha: string | null = null;
    if (this.opts.gitEnabled !== false && this.shouldCommit(rel)) {
      const message = `vault: ${mode} ${rel}`;
      const result = commit(this.opts.root, [rel], message, {
        Session: ids.session_id ?? "",
        Event: writeEvent,
      });
      if (result.status === "committed") {
        sha = result.sha;
        emit("vault.commit", ids, { paths: [rel], sha, message }, {
          causedBy: writeEvent,
          cause: { kind: "computed", text: `per-write commit policy matched ${rel}`, source: "vault/writer.ts:write" },
        });
      } else if (result.status === "failed") {
        // The write itself stands — the bytes are on disk and vault.written is
        // already in the log. What is lost is the history, and losing it
        // silently is the failure mode this event exists to prevent.
        emit("vault.commit_failed", ids, { paths: [rel], step: result.step, error: result.error }, {
          causedBy: writeEvent,
          cause: { kind: "computed", text: `git ${result.step} failed; the write stands, the history does not`, source: "vault/writer.ts:write" },
        });
      }
    }
    return { path: abs, sha256, commit: sha };
  }

  /** Append one entry to today's episodic log (the one place append is correct). */
  appendLog(entry: string, ids: IdTuple, causedBy?: string): { path: string } {
    const today = new Date().toISOString().slice(0, 10);
    const rel = `log/${today}.md`;
    const abs = resolve(this.opts.root, rel);
    const header = existsSync(abs) ? "" : `# ${today}\n`;
    const r = this.write(rel, header + entry, ids, { causedBy, mode: "append" });
    return { path: r.path };
  }

  exists(relPath: string): boolean {
    return existsSync(this.safeRelative(relPath).abs);
  }
  read(relPath: string): string {
    return readFileSync(this.safeRelative(relPath).abs, "utf8");
  }
  size(relPath: string): number {
    return statSync(this.safeRelative(relPath).abs).size;
  }
}
