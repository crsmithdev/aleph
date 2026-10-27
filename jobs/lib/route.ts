/** Jev picks the model tier for a factory run, from the item's spec. */
import { decide, judgeChoice } from "../../hooks/lib/jev.ts";

export const TIERS = ["haiku", "sonnet", "opus"] as const;
export type Tier = (typeof TIERS)[number];
const CUT = 0.6;

const TIER_QUESTION = {
  type: "choice" as const,
  instructions: "Which model tier fits the change that `goal` asks for?",
  criteria: {
    haiku: "A small, mechanical change in one or two files whose done state is stated exactly.",
    sonnet: "A typical change across several files, with a clear oracle.",
    opus: "A design-heavy or cross-cutting change, or one whose approach the item leaves open.",
  },
};

/** The tier for a spec, or null (no --model) when Jev is off, errs, or is not sure enough. */
export async function route(spec: string): Promise<Tier | null> {
  if (judgeChoice() === "haiku") return null;
  try {
    const a = (await decide({ goal: spec }, { tier: TIER_QUESTION })).answers.tier;
    if (a.type !== "choice") return null;
    const p = a.probabilities?.[a.choice] ?? a.confidence ?? 0;
    return (TIERS as readonly string[]).includes(a.choice) && p >= CUT ? (a.choice as Tier) : null;
  } catch {
    return null;
  }
}

/** The argv for `aleph job` for a goal item, with --model only when routed. */
export function jobArgv(exec: string, cli: string, key: string, name: string, id: number, model: Tier | null): string[] {
  return [exec, cli, "job", key, name, "--spec", "-", "--todo", String(id), "--land", ...(model ? ["--model", model] : [])];
}
