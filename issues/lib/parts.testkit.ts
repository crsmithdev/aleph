import { add, type Doc, type Issue, type Source } from "../../lib/issue-file.ts";
import { issueKey } from "../../lib/naming.ts";

/** Add a child of `issue`: an issue with `from: issue.<n>`, `after`, the issue's kind and priority, and a `source`: the issue's when it is not chris, else agent. Only tests call it. */
export function addPart(doc: Doc, issue: Issue, o: { title: string; spec: string; after?: string[]; now?: Date }): Issue {
  const source = issue.fm.source && issue.fm.source !== "user" ? (issue.fm.source as Source) : "agent";
  return add(doc, o.title, { kind: (issue.fm.kind as string) ?? "task", priority: (issue.fm.priority as string) ?? "medium", source, spec: o.spec, from: issueKey(issue.id), after: o.after, now: o.now });
}
