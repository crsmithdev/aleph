#!/usr/bin/env bun
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";
import { claudePaths } from "./paths.ts";

const traceFile = resolve(claudePaths.construct, ".trace");

if (existsSync(traceFile)) {
  unlinkSync(traceFile);
  console.log("Trace: OFF");
} else {
  writeFileSync(traceFile, "");
  console.log("Trace: ON");
}
