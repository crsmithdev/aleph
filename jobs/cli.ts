#!/usr/bin/env bun
/** `aleph`, the command line: the commands are jobs/commands.ts. */
import { writeSync } from "node:fs";
import { run } from "./commands.ts";

// Writes are synchronous, so an exit does not cut off what is still buffered for a pipe.
// A reader that closes early (`aleph help | head -1`) is not an error: stop quietly.
const out = (fd: number) => (s: string) => {
  try { writeSync(fd, s); } catch (e) { if ((e as { code?: string }).code === "EPIPE") process.exit(0); throw e; }
};
const r = await run(process.argv.slice(2), { stdout: out(1), stderr: out(2) });
// A refusal or a failed check exits at once, as it always did; a pass ends when the work it left is done.
if (r.code) process.exit(r.code);
