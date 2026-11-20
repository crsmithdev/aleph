import { writeFileSync } from "node:fs";
import { serve } from "./server";
import { uiTokensFile } from "../lib/paths.ts";
import { hash } from "./pair.ts";

/** A paired device for the tests: the token's hash is in the token file, and `at` sends it as the cookie. */
export const DEVICE = "test-device-token";
export const deviceCookie = `aleph_device=${DEVICE}`;

type Opts = Parameters<typeof serve>[1];

/** Sets the variables and returns a function that restores them; the ones that were unset are deleted. */
export function withEnv(vars: Record<string, string>): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; }
  return () => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };
}

/** Starts `serve(0, opts)`; `at` fetches a path on its port, `stop` closes it. */
export async function withServer(opts?: Opts) {
  writeFileSync(uiTokensFile(), `${hash(DEVICE)} test 2026-01-01T00:00:00.000Z\n`);
  const server = await serve(0, opts);
  const at = (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("cookie")) headers.set("cookie", deviceCookie);
    return fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers });
  };
  return { server, at, stop: () => { server.stop(true); } };
}

export type TestServer = Awaited<ReturnType<typeof withServer>>["server"];
