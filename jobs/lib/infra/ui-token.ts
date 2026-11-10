/**
 * The factory's own session token for the UI password gate. The smoke test and the doctor
 * send it as the `aleph_session` cookie. The token is in `<ALEPH_FACTORY_DIR>/ui-sessions.json`,
 * and it comes back there when Chris deletes that file to log out every device.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonOr, writeJson } from "./json.ts";
import { layout } from "../../../lib/layout.ts";

export const sessionsPath = () => join(layout().factory, "ui-sessions.json");

export const readSessions = (): string[] => readJsonOr(sessionsPath(), []);

export const writeSessions = (tokens: string[]): void => writeJson(sessionsPath(), tokens);

/** The Cookie header value of the factory's token, which this adds to the sessions file when it is missing. */
export function factoryCookie(): string {
  const file = join(layout().factory, "ui-factory-token");
  let token = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  if (!token) {
    token = randomBytes(32).toString("hex");
    mkdirSync(layout().factory, { recursive: true });
    writeFileSync(file, token);
  }
  const sessions = readSessions();
  if (!sessions.includes(token)) writeSessions([...sessions, token]);
  return `aleph_session=${token}`;
}
