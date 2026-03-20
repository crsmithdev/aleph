#!/usr/bin/env bun
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";

const home = Bun.env.HOME ?? "/tmp";
const traceFile = resolve(home, ".claude/construct/.trace");

if (existsSync(traceFile)) {
  unlinkSync(traceFile);
  console.log("Trace: OFF");
} else {
  writeFileSync(traceFile, "");
  console.log("Trace: ON");
}
