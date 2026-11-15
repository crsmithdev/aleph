/** Jev picks the model tier for a factory run, from the item's spec. */
import { logEvent } from "../../../lib/layout.ts";
import { decide, judgeChoice } from "../../../lib/jev.ts";
import { readModels } from "./models.ts";

export const TIERS = ["small", "medium", "large"] as const;
export type Tier = (typeof TIERS)[number];
/** The Claude model a tier's run asks for; unit.ts runs a size set to a model Claude does not serve on that model. */
export const TIER_MODEL = { small: "haiku", medium: "sonnet", large: "opus" } as const;
const CUT = 0.6;

const TIER_QUESTION = {
  type: "choice" as const,
  instructions: "Which model tier fits the change that `goal` asks for?",
  criteria: {
    small: "A small, mechanical change in one or two files whose done state is stated exactly.",
    medium: "A typical change across several files, with a clear oracle.",
    large: "A design-heavy or cross-cutting change, or one whose approach the item leaves open.",
  },
};

/** The tier for a spec, or null (no --model) when Jev is off, errs, or is not sure enough. A disabled tier gives the next enabled tier up. */
export async function route(spec: string, subject = "route"): Promise<Tier | null> {
  if (judgeChoice() === "haiku") return null;
  try {
    const d = await decide({ goal: spec }, { tier: TIER_QUESTION });
    const a = d.answers.tier;
    if (a.type !== "choice") return null;
    const p = a.probabilities?.[a.choice] ?? a.confidence ?? 0;
    try { logEvent({ subject: "rule", action: "routed", object: subject, detail: `${a.choice} by classifier ${d.model.split("/").pop()}` }); } catch { /* the cost event is a note; it never changes the tier */ }
    if (!(TIERS as readonly string[]).includes(a.choice) || p < CUT) return null;
    const models = readModels();
    return TIERS.slice(TIERS.indexOf(a.choice as Tier)).find((t) => models[t].enabled)!;
  } catch {
    return null;
  }
}


/** The next enabled tier above `tier`, or `tier` at the top: the tier of a rerun after a failed run. */
export function raise(tier: Tier, models = readModels()): Tier {
  return TIERS.slice(TIERS.indexOf(tier) + 1).find((t) => models[t].enabled) ?? tier;
}
