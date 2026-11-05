// One skill: the detail route of the Skills view (the shell takes one view per module).
import { mountPerDay, renderSkill } from "./skills.js";

export const view = {
  path: "/skills/:name",
  title: "Skill",
  group: "claude",
  api: "/api/skills/:name",
  render: (d) => renderSkill(d),
  mount: (root, d) => {
    const limits = {};
    mountPerDay(root, d);
    root.onclick = (e) => {
      const more = e.target.closest?.("[data-t] button[data-more]");
      if (!more) return;
      const name = more.closest("[data-t]").dataset.t;
      limits[name] = (limits[name] ?? 50) + Number(more.dataset.more);
      root.innerHTML = renderSkill(d, limits);
      mountPerDay(root, d);
    };
  },
};
