/**
 * Array utilities
 */

/** Returns the first element of an array, or undefined if empty. */
export function first<T>(arr: T[]): T | undefined {
  return arr[0];
}

/** Returns the last element of an array, or undefined if empty. */
export function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

/** Returns true if the array is empty. */
export function isEmpty<T>(arr: T[]): boolean {
  return arr.length === 0;
}
