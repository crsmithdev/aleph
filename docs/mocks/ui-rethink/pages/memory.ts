// The Memory page: Notes, Health and Log (README, Pages). Not built yet: each view's `draw` is still missing.
import { count } from "../../../../ui/views/lib/format.js";
import { type Page } from "../kit.ts";

/** The share of its budget at which a start context needs Chris, as the memory row of docs/mocks/status-redesign has it. */
const FULL = 0.95;

export const page: Page = {
  id: "memory", title: "Memory", group: "Claude", order: 6, icon: "brain", route: "memory",
  views: [{ id: "notes", label: "Notes" }, { id: "health", label: "Health" }, { id: "log", label: "Log" }],
  attention: (d) => {
    const start = d.memory.start.aleph, lint = d.memory.lint;
    const found = lint.reduce((n: number, l: any) => n + l.n, 0), refused = lint.filter((l: any) => l.refused).reduce((n: number, l: any) => n + l.n, 0);
    return [
      ...(start.bytes >= FULL * start.budget ? [{ tone: "need" as const, text: `Start context ${count(start.bytes)} B of ${count(start.budget)} B` }] : []),
      // A refused note is the error tone, as the live Needs-you strip has it (ui/views/lib/memory-health.js).
      ...(refused ? [{ tone: "error" as const, text: `${count(found)} lint findings, ${count(refused)} refused` }] : []),
    ];
  },
};
