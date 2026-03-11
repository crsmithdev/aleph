import { existsSync } from "fs";
import { resolve, dirname } from "path";

const root = resolve(dirname(Bun.main), "../..");
const traceFile = resolve(root, ".trace");

export const tracing = existsSync(traceFile);

export function trace(hook: string, msg: string) {
  if (tracing) console.log(`[trace:${hook}] ${msg}`);
}
