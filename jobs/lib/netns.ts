/**
 * Bridge a host port into a sandbox step's network namespace. srt runs a worker
 * under bwrap with its own network namespace; Chrome stays in the host
 * namespaces and reaches the worker's server through a host socat listener that
 * relays each connection in with nsenter.
 */
import { dlopen, FFIType } from "bun:ffi";
import { closeSync, openSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { connect } from "node:net";
import { freePort } from "./review-browser.ts";

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

/**
 * An open fd on the user namespace that owns the network namespace of pid. bwrap
 * puts its child in a second user namespace inside that owner, and no process
 * lives in the owner, so `nsenter -U` on pid enters a namespace without the
 * rights to join the network namespace.
 */
function netnsOwner(pid: number): number {
  const libc = dlopen("libc.so.6", { ioctl: { args: [FFIType.i32, FFIType.u64], returns: FFIType.i32 } });
  const net = openSync(`/proc/${pid}/ns/net`, "r");
  try {
    const fd = libc.symbols.ioctl(net, NS_GET_USERNS);
    if (fd < 0) throw new Error(`NS_GET_USERNS failed on the network namespace of ${pid}`);
    return fd;
  } finally { closeSync(net); libc.close(); }
}
const NS_GET_USERNS = 0xb701;
const STDERR_TAIL = 4096;

/** True when process pid itself holds the LISTEN socket on 127.0.0.1:port, so a server of another worker does not pass for it. */
function listens(pid: number, port: number): boolean {
  let inodes: string[];
  try {
    const want = `0100007F:${port.toString(16).toUpperCase().padStart(4, "0")}`;
    inodes = readFileSync("/proc/net/tcp", "utf8").split("\n").map((l) => l.trim().split(/\s+/))
      .filter((f) => f[1] === want && f[3] === "0A").map((f) => `socket:[${f[9]}]`);
    if (!inodes.length) return false;
    return readdirSync(`/proc/${pid}/fd`).some((fd) => { try { return inodes.includes(readlinkSync(`/proc/${pid}/fd/${fd}`)); } catch { return false; } });
  } catch { return false; }
}

/**
 * A host 127.0.0.1 port that relays into 127.0.0.1:port inside the network namespace of pid.
 * Another process can take the probed host port before socat binds it, so a socat that exits
 * or never owns the listener is retried on a new port until the deadline.
 */
export async function bridge(pid: number, port: number, waitMs = 10_000): Promise<{ url: string; stop: () => Promise<void>; stderr: () => string }> {
  const end = Date.now() + waitMs;
  // nsenter opens the owner through this process's fd table, so the fd stays open until stop.
  const owner = netnsOwner(pid);
  let last = "no attempt ran";
  for (let attempt = 1; ; attempt++) {
    const hostPort = await freePort(3002);
    const child = Bun.spawn(["socat", `TCP-LISTEN:${hostPort},bind=127.0.0.1,reuseaddr,fork`,
      `EXEC:"nsenter --user=/proc/${process.pid}/fd/${owner} --net=/proc/${pid}/ns/net --preserve-credentials socat STDIO TCP:127.0.0.1:${port}"`],
      { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
    // The inner nsenter and socat inherit this pipe. Drain it all the time, so a full pipe never blocks them, and keep a bounded tail.
    let tail = "";
    const drained = (async () => {
      const dec = new TextDecoder();
      try {
        for await (const chunk of child.stderr) tail = (tail + dec.decode(chunk, { stream: true })).slice(-STDERR_TAIL);
      } catch { /* the pipe closed */ }
    })();
    const stderr = () => tail.split("\n").map((l) => l.trim()).filter(Boolean).slice(-5).join("\n");
    const kill = async () => {
      if (child.exitCode === null) child.kill("SIGTERM");
      await child.exited;
      await Promise.race([drained, Bun.sleep(500)]);
    };
    while (child.exitCode === null && Date.now() <= end && !(listens(child.pid, hostPort) && await accepts(hostPort))) await Bun.sleep(50);
    if (child.exitCode === null && listens(child.pid, hostPort)) {
      return { url: `http://127.0.0.1:${hostPort}`, stop: async () => { await kill(); closeSync(owner); }, stderr };
    }
    const err = stderr().replace(/\s+/g, " ").slice(-400);
    last = `attempt ${attempt}, host port ${hostPort}: ${child.exitCode !== null ? `socat exited with ${child.exitCode}` : `socat did not listen within ${waitMs} ms`}${err ? `: ${err}` : ""}`;
    await kill();
    if (Date.now() > end) { closeSync(owner); throw new Error(`socat bridge did not come up (${last})`); }
  }
}
