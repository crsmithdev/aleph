/**
 * Bridge a host port into a sandbox step's network namespace. srt runs a worker
 * under bwrap with its own network namespace; Chrome stays in the host
 * namespaces and reaches the worker's server through a host socat listener that
 * relays each connection in with nsenter.
 */
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { connect } from "node:net";
import { freePort } from "./review2-browser.ts";

function childrenOf(): Map<number, number[]> {
  const kids = new Map<number, number[]>();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    let stat: string;
    try { stat = readFileSync(`/proc/${name}/stat`, "utf8"); } catch { continue; }
    // "pid (comm) state ppid ...": comm may hold spaces and parens, so cut at the last ")".
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    const list = kids.get(ppid) ?? [];
    list.push(Number(name));
    kids.set(ppid, list);
  }
  return kids;
}

/** The first descendant of rootPid whose network namespace differs from ours; null when none does. */
export function sandboxNetnsPid(rootPid: number): number | null {
  const mine = readlinkSync("/proc/self/ns/net");
  const kids = childrenOf();
  const queue = [...(kids.get(rootPid) ?? [])];
  while (queue.length) {
    const pid = queue.shift()!;
    try {
      if (readlinkSync(`/proc/${pid}/ns/net`) !== mine) return pid;
    } catch { /* gone or unreadable */ }
    queue.push(...(kids.get(pid) ?? []));
  }
  return null;
}

function accepts(port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); done(true); });
    s.once("error", () => done(false));
  });
}

/** A host 127.0.0.1 port that relays into 127.0.0.1:port inside the network namespace of pid. */
export async function bridge(pid: number, port: number, waitMs = 10_000): Promise<{ url: string; stop: () => Promise<void> }> {
  const hostPort = await freePort(3002);
  const child = Bun.spawn(["socat", `TCP-LISTEN:${hostPort},bind=127.0.0.1,reuseaddr,fork`,
    `EXEC:"nsenter -t ${pid} -U -n --preserve-credentials socat STDIO TCP:127.0.0.1:${port}"`],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const stop = async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await child.exited;
  };
  const end = Date.now() + waitMs;
  while (!(await accepts(hostPort))) {
    if (child.exitCode !== null || Date.now() > end) {
      await stop();
      throw new Error(`socat bridge on ${hostPort} did not come up`);
    }
    await Bun.sleep(50);
  }
  return { url: `http://127.0.0.1:${hostPort}`, stop };
}
