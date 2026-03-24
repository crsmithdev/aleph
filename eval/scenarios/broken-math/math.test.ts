import { describe, expect, test } from "bun:test";
import { clamp, lerp, average, factorial, isPrime, range, median } from "./math";

describe("clamp", () => {
  test("within range", () => expect(clamp(5, 0, 10)).toBe(5));
  test("below min", () => expect(clamp(-1, 0, 10)).toBe(0));
  test("above max", () => expect(clamp(15, 0, 10)).toBe(10));
});

describe("lerp", () => {
  test("t=0", () => expect(lerp(0, 10, 0)).toBe(0));
  test("t=1", () => expect(lerp(0, 10, 1)).toBe(10));
  test("t=0.5", () => expect(lerp(0, 10, 0.5)).toBe(5));
});

describe("average", () => {
  test("basic", () => expect(average([1, 2, 3])).toBe(2));
  test("empty", () => expect(average([])).toBe(0));
  test("single", () => expect(average([7])).toBe(7));
});

describe("factorial", () => {
  test("0", () => expect(factorial(0)).toBe(1));
  test("1", () => expect(factorial(1)).toBe(1));
  test("5", () => expect(factorial(5)).toBe(120));
  test("negative throws", () => expect(() => factorial(-1)).toThrow());
});

describe("isPrime", () => {
  test("2 is prime", () => expect(isPrime(2)).toBe(true));
  test("3 is prime", () => expect(isPrime(3)).toBe(true));
  test("4 is not prime", () => expect(isPrime(4)).toBe(false));
  test("17 is prime", () => expect(isPrime(17)).toBe(true));
  test("1 is not prime", () => expect(isPrime(1)).toBe(false));
});

describe("range", () => {
  test("basic", () => expect(range(0, 5)).toEqual([0, 1, 2, 3, 4]));
  test("with step", () => expect(range(0, 10, 2)).toEqual([0, 2, 4, 6, 8]));
  test("negative step", () => expect(range(5, 0, -1)).toEqual([5, 4, 3, 2, 1]));
  test("zero step throws", () => expect(() => range(0, 5, 0)).toThrow());
});

describe("median", () => {
  test("odd count", () => expect(median([3, 1, 2])).toBe(2));
  test("even count", () => expect(median([4, 1, 3, 2])).toBe(2.5));
  test("single", () => expect(median([5])).toBe(5));
  test("empty throws", () => expect(() => median([])).toThrow());
  // This test exposes the lexicographic sort bug:
  // [1, 2, 10] sorted lexicographically → ["1", "10", "2"] → median is "10" (NaN-ish)
  test("double digits", () => expect(median([1, 2, 10])).toBe(2));
  test("large numbers", () => expect(median([100, 200, 300])).toBe(200));
});
