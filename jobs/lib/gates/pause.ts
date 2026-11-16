/** The factory's pause: the one predicate that asks it, and the command that sets it. */
import { logSetting } from "../../../lib/layout.ts";
import { detailOf } from "../../../lib/naming.ts";
import { pausedAt, setPausedAt } from "../infra/settings.ts";

export const paused = () => pausedAt() !== null;

/** Pauses the factory (the `paused` setting holds the time) or, with `on` false, resumes it; a pause that stays logs nothing. */
export function setPaused(on: boolean): void {
  const was = paused();
  setPausedAt(on ? new Date().toISOString() : null);
  if (was !== on) logSetting(detailOf("changed", "pause", on ? "on" : "off"));
}
