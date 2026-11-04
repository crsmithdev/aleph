// The asks of ui/test-now.ts's asksOf once the director escalated each one: its case text is its own fixed problem text,
// so a row reads as before and has its buttons. An Ask with no case text is still with the director and offers none.
import { asksOf } from "../../ui/test-now.ts";
import { held, state } from "../../ui/fixtures/status-state.ts";

export function sentAsks(runs: any[] = [], issues: any[] = [], lessons: any[] = []) {
  const p = new Map(asksOf(runs, issues, lessons).map((a) => [a.key, a.problem]));
  return asksOf(
    runs.map((r) => ({ ...r, ask: { ...r.ask, situation: r.ask?.situation ?? p.get(`run:${r.name}`) } })),
    issues.map((i) => ({ ...i, ask: { kind: i.askKind ?? "input", reason: i.reason ?? "question", question: i.question ?? "", options: [], why: [], ...i.ask, situation: i.ask?.situation ?? p.get(`issue:${i.id}`) } })),
    lessons.map((l) => ({ ...l, situation: l.situation ?? p.get(`proposal:${l.id}`) })),
  );
}

/** The shared Status state with its held run escalated. */
export const sentState: any = { ...state, asks: sentAsks([held]) };
