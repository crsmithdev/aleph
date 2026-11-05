import { minute, titleProblem, today, touch, type Doc, type Issue, type Source } from "./todo.ts";

/** The next free `k` for a part `<n>.<k>` under issue `n`, above any part of closed work. */
export const nextSub = (doc: Doc, n: number): number => Math.max(doc.items.reduce((m, i) => (i.id === n && i.sub !== undefined ? Math.max(m, i.sub) : m), 0), doc.floor?.parts[String(n)] ?? 0) + 1;

/** Add an old part `<n>.<k>` under issue `issue` (`k` the next free number), with `after`, the issue's priority and a `source`: the issue's when it is not chris, else agent. Only tests call it: they make the parts that old stores hold. */
export function addPart(doc: Doc, issue: Issue, o: { title: string; spec: string; after?: string[]; now?: Date }): Issue {
  const bad = titleProblem(o.title, { part: true });
  if (bad) throw new Error(bad);
  const day = today(o.now);
  const sub = nextSub(doc, issue.id);
  const part: Issue = {
    id: issue.id,
    sub,
    title: o.title,
    fm: { id: `${issue.id}.${sub}`, created: day, created_time: minute(o.now), updated: day, updated_time: minute(o.now), kind: (issue.fm.kind as string) ?? "task", priority: (issue.fm.priority as string) ?? "medium", source: issue.fm.source && issue.fm.source !== "chris" ? (issue.fm.source as Source) : "agent", after: o.after ?? [] },
    request: "",
    spec: o.spec,
    notes: [],
  };
  touch(issue, o.now);
  doc.items.push(part);
  return part;
}
