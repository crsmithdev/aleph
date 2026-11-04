import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeTmp, makeRunFolder, profile } from "./sandbox.ts";

const base = mkdtempSync(join(tmpdir(), "aleph-sandbox-"));
process.env.ALEPH_SANDBOX_DIR = join(base, "runs");
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("profile hides a CI-missing tool under denyRead only with the option", () => {
  const bin = join(base, "fakebin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "tailscale"), "#!/bin/sh\n");
  chmodSync(join(bin, "tailscale"), 0o755);
  const old = process.env.PATH;
  const dir = makeRunFolder("r-hide");
  const deny = (o: object) => JSON.parse(readFileSync(profile(dir, { read: [], write: ["tmp"], ...o }), "utf8")).filesystem.denyRead as string[];
  try {
    process.env.PATH = `${bin}:/nonexistent`;
    const plain = deny({});
    expect(plain).not.toContain(join(bin, "tailscale"));
    const hidden = deny({ hideCiMissing: true });
    expect(hidden).toContain(join(bin, "tailscale"));
    expect(hidden).toContain(realpathSync(join(bin, "tailscale")));
    expect(hidden.slice(0, plain.length)).toEqual(plain);
    process.env.PATH = "/nonexistent";
    expect(deny({ hideCiMissing: true })).toEqual(plain);
  } finally { process.env.PATH = old; }
});

test("makeRunFolder puts no skill in home/", () => {
  expect(existsSync(join(makeRunFolder("r-plain"), "home/.claude/skills"))).toBe(false);
});

test("a profile allows Unix sockets only with `sockets`, and keeps its file and network walls", () => {
  const dir = makeRunFolder("r-sockets");
  const read = (o: object) => JSON.parse(readFileSync(profile(dir, { read: [], write: ["tmp"], ...o }), "utf8"));
  const plain = read({}), open = read({ sockets: true });
  expect(plain.network.allowAllUnixSockets).toBeUndefined();
  expect(open.network.allowAllUnixSockets).toBe(true);
  // The one more write root is Chrome's short temp folder.
  expect(open.filesystem).toEqual({ ...plain.filesystem, allowWrite: [...plain.filesystem.allowWrite, chromeTmp(dir)] });
  expect({ ...open.network, allowAllUnixSockets: undefined }).toEqual({ ...plain.network, allowAllUnixSockets: undefined });
});
