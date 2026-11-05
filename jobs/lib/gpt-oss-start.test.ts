import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseNCpuMoe, parseFreeMiB, serverArgs } from "./gpt-oss-start.ts";

describe("chooseNCpuMoe", () => {
  test("0 MiB free gives 24, far above the model size gives 0", () => {
    expect(chooseNCpuMoe(0)).toBe(24);
    expect(chooseNCpuMoe(100_000)).toBe(0);
  });

  test("never rises as free VRAM grows, and stays an integer from 0 to 24", () => {
    let prev = 24;
    for (let free = 0; free <= 20_000; free += 37) {
      const n = chooseNCpuMoe(free);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(prev);
      prev = n;
    }
  });

  test("the measured value 11 comes from the free VRAM of the tune", () => {
    expect(chooseNCpuMoe(10_600)).toBe(11);
    expect(chooseNCpuMoe(10_599 - 400)).toBe(12);
  });
});

describe("serverArgs", () => {
  const flag = (a: string[], f: string) => a[a.indexOf(f) + 1];

  test("a failed read gives 12", () => {
    expect(flag(serverArgs("/h", null), "--n-cpu-moe")).toBe("12");
    expect(flag(serverArgs("/h", parseFreeMiB("garbage")), "--n-cpu-moe")).toBe("12");
  });

  test("carries the chosen value and the unit's other flags", () => {
    const a = serverArgs("/h", 10_600);
    expect(flag(a, "--n-cpu-moe")).toBe("11");
    expect(flag(a, "--port")).toBe("8012");
    expect(flag(a, "--ctx-size")).toBe("40960");
    expect(flag(a, "--n-gpu-layers")).toBe("99");
    expect(flag(a, "--reasoning-budget")).toBe("0");
    expect(flag(a, "--model")).toBe("/h/.local/share/gpt-oss-20b.gguf");
  });
});

describe("stop", () => {
  test("a llama-server that ignores the stop signal is killed, and both processes exit in under 10 s (the test timeout)", async () => {
    const home = mkdtempSync(join(tmpdir(), "gpt-oss-home-"));
    const bin = `${home}/.local/src/llama.cpp/build/bin`;
    mkdirSync(bin, { recursive: true });
    // As the journal shows: after the stop signal it logs "cleaning up before exit..." and never exits.
    writeFileSync(`${bin}/llama-server`, `#!/usr/bin/env bun
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => console.log("cleaning up before exit..."));
Bun.serve({ port: 0, fetch: () => new Response() });
console.log(process.pid, "ready");
`);
    chmodSync(`${bin}/llama-server`, 0o755);
    const start = Bun.spawn(["bun", join(import.meta.dir, "gpt-oss-start.ts")], { env: { ...process.env, HOME: home }, stdout: "pipe" });
    const decoder = new TextDecoder();
    let out = "";
    for await (const chunk of start.stdout) {
      out += decoder.decode(chunk);
      if (out.includes("ready")) break;
    }
    const serverPid = Number(out.match(/(\d+) ready/)![1]);
    // KillMode=control-group sends SIGTERM once to every process of the unit.
    process.kill(serverPid, "SIGTERM");
    start.kill("SIGTERM");
    await start.exited;
    expect(() => process.kill(serverPid, 0)).toThrow();
    rmSync(home, { recursive: true, force: true });
  }, 10_000); // the test timeout is the 10 s limit
});
