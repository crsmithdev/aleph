import { describe, expect, test } from "bun:test";
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
