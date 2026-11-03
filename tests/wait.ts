/**
 * Waits for `condition` to hold: it is checked at once, then every `every` ms, for at most `timeout` ms.
 * Returns whether it held, so the caller's own `expect` shows the values when it did not. The deadline is on
 * the monotonic clock, so a test that fakes `Date` with setSystemTime can use it.
 */
export async function waitFor(condition: () => boolean | Promise<boolean>, { timeout = 20_000, every = 20 } = {}): Promise<boolean> {
  const end = performance.now() + timeout;
  for (;;) {
    if (await condition()) return true;
    if (performance.now() >= end) return false;
    await Bun.sleep(every);
  }
}
