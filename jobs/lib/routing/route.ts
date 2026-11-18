/** Jev picks the size (small, medium or large) of a factory run, from the item's spec. */
import { logEvent } from "../../../lib/layout.ts";
import { decide, judgeChoice } from "../../../lib/jev.ts";
import { readModels } from "./models.ts";

export const SIZES = ["small", "medium", "large"] as const;
export type Size = (typeof SIZES)[number];
const CUT = 0.6;

const SIZE_QUESTION = {
  type: "choice" as const,
  instructions: "Which size fits the change that `issue` asks for?",
  criteria: {
    small: "A small, mechanical change in one or two files whose done state is stated exactly.",
    medium: "A typical change across several files, with a clear oracle.",
    large: "A design-heavy or cross-cutting change, or one whose approach the item leaves open.",
  },
};

/** The size for a spec, or null (no --model) when Jev is off, errs, or is not sure enough. A disabled size gives the next enabled size up, else the next enabled size down. */
export async function route(spec: string, subject = "route"): Promise<Size | null> {
  if (judgeChoice() === "haiku") return null;
  try {
    const d = await decide({ issue: spec }, { size: SIZE_QUESTION });
    const a = d.answers.size;
    if (a.type !== "choice") return null;
    const p = a.probabilities?.[a.choice] ?? a.confidence ?? 0;
    try { logEvent({ subject: "rule", action: "routed", object: subject, detail: `${a.choice} by classifier ${d.model.split("/").pop()}` }); } catch { /* the cost event is a note; it never changes the size */ }
    if (!(SIZES as readonly string[]).includes(a.choice) || p < CUT) return null;
    const models = readModels();
    const i = SIZES.indexOf(a.choice as Size);
    return [...SIZES.slice(i), ...SIZES.slice(0, i).reverse()].find((s) => models[s].enabled)!;
  } catch {
    return null;
  }
}


/** The next enabled size above `size`, or `size` at the top: the size of a rerun after a failed run. */
export function raise(size: Size, models = readModels()): Size {
  return SIZES.slice(SIZES.indexOf(size) + 1).find((s) => models[s].enabled) ?? size;
}
