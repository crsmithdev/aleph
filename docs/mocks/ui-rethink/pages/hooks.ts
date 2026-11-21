// The Hooks page: List, Holds and Errors (README, Pages). Not built yet: each view's `draw` is still missing.
import { count } from "../../../../ui/views/lib/format.js";
import { type Page } from "../kit.ts";

export const page: Page = {
  id: "hooks", title: "Hooks", group: "Claude", order: 7, icon: "plug", route: "hooks",
  views: [{ id: "list", label: "List" }, { id: "holds", label: "Holds" }, { id: "errors", label: "Errors" }],
  attention: (d) => {
    const errs = d.hooks.errors, n = errs.reduce((s: number, e: any) => s + e.n, 0);
    const top = [...errs].sort((a: any, b: any) => b.n - a.n)[0];
    return n ? [{ tone: "error" as const, text: `${count(n)} hook errors, ${count(top.n)} from a ${top.cause.toLowerCase()}`, act: { label: "Errors", href: "hooks.html#errors" } }] : [];
  },
};
