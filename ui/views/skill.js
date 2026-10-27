// One skill: the detail route of the Skills view (the shell takes one view per module).
import { mountPerDay, renderSkill } from "./skills.js";

export const view = {
  path: "/skills/:name",
  title: "Skill",
  group: "activity",
  api: "/api/skills/:name",
  render: (d) => renderSkill(d),
  mount: (root, d) => mountPerDay(root, d),
};
