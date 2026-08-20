/**
 * The only thing that touches the vault.
 *
 * docs/design/phase-1.md §10.4. Prohibitions are checked here AND enforced at
 * the mount (§10.3) — this layer is defence in depth, not the gate.
 */
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
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

  private resolveSafe(relPath: string): string {
    const clean = normalize(relPath).replace(/^([.][.](\/|\\|$))+/, "");
    const abs = resolve(this.opts.root, clean);
    const rel = relative(this.opts.root, abs);
    if (rel.startsWith("..") || rel.startsWith(sep) || resolve(abs) !== abs) {
      throw new VaultDenied("escapes_vault", relPath);
    }
    return abs;
  }

  check(relPath: string, content?: string): void {
    const clean = normalize(relPath);
    for (const prefix of READ_ONLY_PREFIXES) {
      if (clean === prefix || clean.startsWith(prefix)) throw new VaultDenied("read_only_namespace", relPath);
    }
    if (clean.startsWith("log/")) {
      const today = new Date().toISOString().slice(0, 10);
      if (clean !== `log/${today}.md`) throw new VaultDenied("log_not_today", relPath);
    }
    if (clean === "MEMORY.md" && content !== undefined) {
      const lines = content.split("\n").filter((l, i, a) => !(i === a.length - 1 && l === "")).length;
      if (lines > this.opts.memoryMaxLines) throw new VaultDenied("memory_line_budget", relPath);
    }
  }

  private shouldCommit(relPath: string): boolean {
    return this.opts.commitPerWrite.some((p) => (p.endsWith("/") ? relPath.startsWith(p) : relPath === p));
  }

  /** Rewrite-don't-append is the doctrine; `mode` records which one happened. */
  write(relPath: string, content: string, ids: IdTuple, opts: { causedBy?: string; mode?: "rewrite" | "create" | "append" } = {}): { path: string; sha256: string; commit: string | null } {
    try {
      this.check(relPath, content);
    } catch (e) {
      if (e instanceof VaultDenied) {
        emit("vault.write_denied", ids, { path: relPath, reason: e.reason }, {
          causedBy: opts.causedBy,
          cause: { kind: "computed", text: `write refused: ${e.reason}`, source: "vault/writer.ts:write" },
        });
      }
      throw e;
    }

    const abs = this.resolveSafe(relPath);
    const mode = opts.mode ?? (existsSync(abs) ? "rewrite" : "create");
    mkdirSync(dirname(abs), { recursive: true });
    const body = mode === "append" && existsSync(abs) ? readFileSync(abs, "utf8") + content : content;

    const tmp = join(dirname(abs), `.${Date.now()}.tmp`);
    writeFileSync(tmp, body);
    renameSync(tmp, abs);

    const h = new Bun.CryptoHasher("sha256");
    h.update(body);
    const sha256 = h.digest("hex");

    const writeEvent = emit("vault.written", ids, { path: relPath, bytes: Buffer.byteLength(body), sha256, mode }, {
      causedBy: opts.causedBy,
      cause: { kind: "computed", text: `${mode} ${relPath}`, source: "vault/writer.ts:write" },
    });

    let sha: string | null = null;
    if (this.opts.gitEnabled !== false && this.shouldCommit(relPath)) {
      const message = `vault: ${mode} ${relPath}`;
      sha = commit(this.opts.root, [relPath], message, {
        Session: ids.session_id ?? "",
        Event: writeEvent,
      });
      if (sha) {
        emit("vault.commit", ids, { paths: [relPath], sha, message }, {
          causedBy: writeEvent,
          cause: { kind: "computed", text: `per-write commit policy matched ${relPath}`, source: "vault/writer.ts:write" },
        });
      }
    }
    return { path: abs, sha256, commit: sha };
  }

  /** Append one entry to today's episodic log (the one place append is correct). */
  appendLog(entry: string, ids: IdTuple, causedBy?: string): { path: string } {
    const today = new Date().toISOString().slice(0, 10);
    const rel = `log/${today}.md`;
    const abs = this.resolveSafe(rel);
    const header = existsSync(abs) ? "" : `# ${today}\n`;
    const r = this.write(rel, header + entry, ids, { causedBy, mode: "append" });
    return { path: r.path };
  }

  exists(relPath: string): boolean {
    return existsSync(this.resolveSafe(relPath));
  }
  read(relPath: string): string {
    return readFileSync(this.resolveSafe(relPath), "utf8");
  }
  size(relPath: string): number {
    return statSync(this.resolveSafe(relPath)).size;
  }
}
