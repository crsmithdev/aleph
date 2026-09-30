/**
 * A repo's to-do list lives on origin/<main>. A read fetches and reads it
 * there; a write is one commit on origin/<main> that changes only
 * docs/todo.md, made without a working tree. So no checkout is left with a
 * changed list, and the main checkout only fast-forwards.
 */
import { followMain, git, show, treeWith } from "../../jobs/lib/git.ts";
import { blank, parse, render, type Doc } from "./todo.ts";

export const TODO_PATH = "docs/todo.md";

export interface Place { key: string; path: string; main: string }

const ATTEMPTS = 5;

function fetch(repo: Place): void {
  const r = git(repo.path, "fetch", "-q", "origin", repo.main);
  if (!r.ok) throw new Error(`fetch failed: ${r.out}`);
}

/** The list on origin/<main>, or null when main has none. */
export function readList(repo: Place): Doc | null {
  fetch(repo);
  const text = show(repo.path, `origin/${repo.main}`, TODO_PATH);
  return text === null ? null : parse(text);
}

/**
 * Apply `change` to the list on origin/<main> and push it as one commit. When
 * the push is refused because main moved, fetch and apply `change` again.
 * `change` returns null to write nothing. A list main does not have yet
 * starts blank only when `create` is set.
 */
export function writeList<T>(repo: Place, message: string, change: (doc: Doc) => T | null, create = false): { value: T; commit: string; follow: string | null } | null {
  for (let attempt = 1; ; attempt++) {
    fetch(repo);
    const base = git(repo.path, "rev-parse", `origin/${repo.main}`).out;
    const text = show(repo.path, base, TODO_PATH);
    if (text === null && !create) throw new Error(`origin/${repo.main} has no ${TODO_PATH}`);
    const doc = text === null ? blank(repo.key) : parse(text);
    const value = change(doc);
    if (value === null) return null;
    const tree = treeWith(repo.path, `${base}^{tree}`, TODO_PATH, render(doc));
    const commit = git(repo.path, "commit-tree", tree, "-p", base, "-m", message);
    if (!commit.ok) throw new Error(`commit-tree failed: ${commit.out}`);
    const push = git(repo.path, "push", "-q", "origin", `${commit.out}:refs/heads/${repo.main}`);
    if (push.ok) return { value, commit: commit.out, follow: followMain(repo.path, repo.main) };
    if (attempt === ATTEMPTS) throw new Error(`push refused ${ATTEMPTS} times: ${push.out}`);
  }
}
