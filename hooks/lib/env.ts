import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LangfuseConfig {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

/**
 * Hooks inherit the shell, not a dotenv; read ~/.aleph/.env ourselves. process.env wins.
 * Only LANGFUSE_* keys: the file also holds model API keys, and a nested `claude -p`
 * that inherits ANTHROPIC_API_KEY bills the API instead of the subscription.
 */
export function loadDotenv(path = join(homedir(), ".aleph", ".env")): void {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!key.startsWith("LANGFUSE_")) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function langfuseConfig(): LangfuseConfig | null {
  loadDotenv();
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  return { baseUrl: (process.env.LANGFUSE_BASE_URL ?? "http://127.0.0.1:3010").replace(/\/+$/, ""), publicKey, secretKey };
}
