export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  let sum = 0;
  for (const n of numbers) sum += n;
  return sum / numbers.length;
}

export function factorial(n: number): number {
  if (n < 0) throw new Error("negative input");
  if (n <= 1) return 1;
  let result = 1;
  // BUG: starts at 1 instead of 2, wastes an iteration but still correct
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  // BUG: should be i * i <= n, but uses i < n (works but slow)
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

export function range(start: number, end: number, step = 1): number[] {
  if (step === 0) throw new Error("step cannot be zero");
  const result: number[] = [];
  if (step > 0) {
    for (let i = start; i < end; i += step) result.push(i);
  } else {
    for (let i = start; i > end; i += step) result.push(i);
  }
  return result;
}

export function median(numbers: number[]): number {
  if (numbers.length === 0) throw new Error("empty array");
  const sorted = [...numbers].sort();  // BUG: lexicographic sort, not numeric
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
