/**
 * Hooks are separate processes. A Pre* event leaves a small file that the
 * matching Post* event picks up, so a span can carry its real start time and
 * its parent. Files live in ~/.aleph/spool (ALEPH_SPOOL overrides, for tests).
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Handshake {
  start: number;
  spanId?: string;
  parentSpanId?: string;
  input?: unknown;
}

function spoolDir(): string {
  return process.env.ALEPH_SPOOL ?? join(homedir(), ".aleph", "spool");
}

function pathFor(key: string): string {
  return join(spoolDir(), `${key.replace(/[^A-Za-z0-9_.:-]/g, "_")}.json`);
}

export function put(key: string, value: Handshake): void {
  mkdirSync(spoolDir(), { recursive: true });
  writeFileSync(pathFor(key), JSON.stringify(value));
}

export function peek(key: string): Handshake | null {
  try { return JSON.parse(readFileSync(pathFor(key), "utf8")) as Handshake; } catch { return null; }
}

export function take(key: string): Handshake | null {
  const value = peek(key);
  if (value) { try { unlinkSync(pathFor(key)); } catch { /* already gone */ } }
  return value;
}
