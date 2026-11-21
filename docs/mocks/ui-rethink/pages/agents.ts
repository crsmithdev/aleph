// The Agents page: Roles and Usage (README, Pages). Not built yet: each view's `draw` is still missing.
import { type Page } from "../kit.ts";

export const page: Page = {
  id: "agents", title: "Agents", group: "Factory", order: 2, icon: "robot", route: "factory/agents",
  views: [{ id: "roles", label: "Roles" }, { id: "usage", label: "Usage" }],
  attention: (d) => d.agents.models.down.map((m: string) => ({ tone: "error" as const, text: `Local model down: ${m}` })),
};
