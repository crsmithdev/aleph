/** The text of a thrown value: an Error's message, else the value as a string. The one place that narrows a catch. */
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
