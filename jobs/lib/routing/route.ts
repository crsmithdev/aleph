/** Jev picks the model tier for a factory run, from the item's spec. */
import { factoryLog } from "../infra/layout.ts";
import { decide, judgeChoice } from "../../../hooks/lib/jev.ts";
import { readModels } from "./models.ts";

export const TIERS = ["worker-low", "worker-medium", "opus"] as const;
export type Tier = (typeof TIERS)[number];
/** The Claude model a tier's run asks for; unit.ts puts a worker tier set to gpt-oss-20b on that model. */
export const TIER_MODEL = { "worker-low": "haiku", "worker-medium": "sonnet", opus: "opus" } as const;
const CUT = 0.6;

const TIER_QUESTION = {
  type: "choice" as const,
  instructions: "Which model tier fits the change that `goal` asks for?",
  criteria: {
    "worker-low": "A small, mechanical change in one or two files whose done state is stated exactly.",
    "worker-medium": "A typical change across several files, with a clear oracle.",
    opus: "A design-heavy or cross-cutting change, or one whose approach the item leaves open.",
  },
};

/** The tier for a spec, or null (no --model) when Jev is off, errs, or is not sure enough. A disabled tier gives the next enabled tier up. */
export async function route(spec: string): Promise<Tier | null> {
  if (judgeChoice() === "haiku") return null;
  try {
    const d = await decide({ goal: spec }, { tier: TIER_QUESTION });
    const a = d.answers.tier;
    if (a.type !== "choice") return null;
    const p = a.probabilities?.[a.choice] ?? a.confidence ?? 0;
    try { factoryLog(`route cost ${d.cost} model ${d.model} tier ${a.choice} p ${p}`); } catch { /* the cost line is a note; it never changes the tier */ }
    if (!(TIERS as readonly string[]).includes(a.choice) || p < CUT) return null;
    const models = readModels();
    return TIERS.slice(TIERS.indexOf(a.choice as Tier)).find((t) => t === "opus" || models[t].enabled)!;
  } catch {
    return null;
  }
}

