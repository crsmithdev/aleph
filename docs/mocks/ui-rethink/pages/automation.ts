// The Automation page: Rules, Limits and Log (README, Pages). Not built yet: each view's `draw` is still missing.
import { day, plural } from "../../../../ui/views/lib/format.js";
import { LIVE, now, type Page } from "../kit.ts";

export const page: Page = {
  id: "automation", title: "Automation", group: "Factory", order: 1, icon: "shield-halved", route: "automation",
  views: [{ id: "rules", label: "Rules" }, { id: "limits", label: "Limits" }, { id: "log", label: "Log" }],
  attention: (d) => {
    const { backend, monitor } = d.automation, link = backend?.why.match(/https?:\/\/\S+/)?.[0];
    return [
      // The why is the backend's own error: its first sentence names the fault, the rest is its advice.
      ...(backend ? [{ tone: "error" as const, text: `${backend.via}: ${backend.why.split(". ")[0]}`, ...(link ? { act: { label: "Add credits", href: link } } : {}) }] : []),
      ...(monitor.findings.length ? [{ tone: "need" as const, text: `Monitor, ${day(`${monitor.day}T12:00`, new Date(now(d)))}: ${plural(monitor.findings.length, "finding")}`, act: { label: "Read", href: `${LIVE}#/automation` } }] : []),
    ];
  },
};
