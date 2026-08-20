/**
 * Model routing: config table, per-class ceilings, ±1 tier flex, failure escalation.
 * docs/design/phase-1.md §9.3.
 */
import type { Config } from "../core/config.ts";
import { emit } from "../core/emit.ts";
import type { IdTuple } from "../core/envelope.ts";

export interface RouteContext {
  flex?: number;                  // caller's requested nudge, clamped to config.routing.flex
  consecutive_failures?: number;
  ids?: IdTuple;
  causedBy?: string;
}

export interface Route {
  class: string;
  tier: string;
  model: string;
  reason: string;
}

const ORDER = ["T0", "T0g", "T1", "T2", "T3"];

function clampTier(tier: string, ceiling: string): string {
  const i = ORDER.indexOf(tier);
  const c = ORDER.indexOf(ceiling);
  if (i === -1) return ceiling;
  return c !== -1 && i > c ? ceiling : tier;
}

function shift(tier: string, by: number): string {
  const i = ORDER.indexOf(tier);
  if (i === -1) return tier;
  return ORDER[Math.min(ORDER.length - 1, Math.max(0, i + by))]!;
}

export class Router {
  constructor(private readonly config: Config) {}

  route(className: string, ctx: RouteContext = {}): Route {
    const classes = this.config.routing.classes;
    const cls = classes[className];
    if (!cls) throw new Error(`unknown routing class: ${className} (configure [routing.classes.${className}])`);

    const reasons: string[] = [`class ${className} default ${cls.tier}`];
    let tier = cls.tier;

    const requested = ctx.flex ?? 0;
    if (requested !== 0) {
      const allowed = Math.sign(requested) * Math.min(Math.abs(requested), this.config.routing.flex);
      const flexed = clampTier(shift(tier, allowed), cls.ceiling);
      if (flexed !== tier) reasons.push(`flex ${allowed > 0 ? "+" : ""}${allowed} -> ${flexed}`);
      tier = flexed;
    }

    const failures = ctx.consecutive_failures ?? 0;
    let escalated = false;
    if (failures >= this.config.routing.escalate_after_failures) {
      const up = clampTier(shift(tier, 1), cls.ceiling);
      if (up !== tier) {
        reasons.push(`escalated after ${failures} failures: ${tier} -> ${up}`);
        escalated = true;
        if (ctx.ids) {
          emit("routing.escalated", ctx.ids, { class: className, from_tier: tier, to_tier: up, failures }, {
            causedBy: ctx.causedBy,
            cause: { kind: "computed", text: `${failures} consecutive failures at ${tier}`, source: "routing/router.ts" },
          });
        }
        tier = up;
      }
    }

    const tierConfig = this.config.routing.tiers[tier];
    if (!tierConfig) throw new Error(`routing class ${className} resolved to tier ${tier}, which has no [routing.tiers.${tier}] entry`);
    if (!tierConfig.enabled) {
      const fallback = clampTier(shift(tier, 1), "T3");
      const fb = this.config.routing.tiers[fallback];
      if (!fb?.enabled) throw new Error(`tier ${tier} disabled and no enabled fallback above it`);
      reasons.push(`tier ${tier} disabled -> ${fallback}`);
      tier = fallback;
    }

    const route: Route = {
      class: className,
      tier,
      model: this.config.routing.tiers[tier]!.model,
      reason: reasons.join("; "),
    };
    void escalated;

    if (ctx.ids) {
      emit("routing.decided", ctx.ids, route as unknown as Record<string, unknown>, {
        causedBy: ctx.causedBy,
        cause: { kind: "computed", text: route.reason, source: "routing/router.ts:route" },
      });
    }
    return route;
  }
}
