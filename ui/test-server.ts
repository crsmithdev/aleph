import { serve } from "./server";

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
  const server = await serve(0, opts);
  const at = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${path}`, init);
  return { server, at, stop: () => { server.stop(true); } };
}

export type TestServer = Awaited<ReturnType<typeof withServer>>["server"];
