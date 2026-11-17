# Issues

Issues, ideas and projects live in one git repo, the items repo, cloned at `~/.aleph/items` (`ALEPH_ITEMS` overrides the path). A project is a registered repo: `projects/<n>/project.md`. An issue belongs to one project through its `project` field. Use `aleph issue` for every change; `git-guard` denies an Edit or Write on a file of the items repo.

## Issues and sub-issues

An **issue** is what someone asks for: Chris, a worker or the correction memory. The request stays as written in the request part of the file. Intake writes a spec on it, or splits a large issue into **sub-issues**, each with its own spec and a `from:` link to it. A sub-issue never has sub-issues.

Each is one file: `issues/<n>/issue.md`. The path is the key, `issue.<n>`: the file has no `id` field. The number comes from one counter for all projects, so a number never repeats and a failed push can leave a gap. A file holds a small frontmatter header and three parts under the headings `# Request`, `# Spec` and `# Notes`. Status is a field, never a folder: a finished issue stays where it is and keeps its number, because commits, specs and the vault quote that number.

## Use it

```bash
aleph issue add aleph "The Status page shows the wrong weekly usage" --priority high
echo "Reproduce with a usage row dated in the future." | aleph issue add aleph "Ignore future usage rows" --request -
aleph issue list aleph --status open --label ui
aleph issue show aleph 1057
aleph issue note aleph 1057 "Reproduced on main at c26c10f"
aleph issue done aleph 1057 "Landed in 84966d1"
```

`<id>` is the number (`1057`), the key (`issue.1057`) or the shown ID (`a1057`). `aleph` prints an ID in the shown form, with the project `code`.

An issue added with `--spec -` is ready to build in a repo without `"author": true`. In a repo with it, intake takes the issue in first and keeps or fixes the spec.

## Commands

| Command | Does |
|---|---|
| `add <repo> "<title>" [--request -] [--spec -] [--priority p] [--labels a,b] [--after <key>] [--refs <key,…>] [--media <file>]...` | Adds an issue; `-` reads stdin |
| `list [<repo>] [--status open\|done\|dropped] [--label <area>] [--json]` | Lists issues |
| `show <repo> <id> [--json]` | Prints one issue, its spec and its notes |
| `edit <repo> <id> [--title t] [--request -] [--spec -] [--priority p] [--labels a,b] [--source s] [--after <key>] [--refs <key,…>]` | Changes fields |
| `note <repo> <id> "<text>"` | Adds one line with a time stamp; it never rewrites a line |
| `attach <repo> <id> <file>...` | Attaches images or PDFs |
| `decide <repo> <id> "<text>"` | Answers an issue that waits for Chris, and clears its Ask |
| `done <repo> <id> ["<summary>"]` | Closes the issue as done |
| `drop <repo> <id> "<reason>"` | Closes the issue as dropped |
| `lint [<repo>] [--fix]` | Checks every file; `--fix` repairs what is mechanical |

`--after` takes issue keys such as `issue.5`. With no repo, `list` and `lint` cover the recent repos: those with a run or an issue change in the last 7 days, latest first.

## Media

An issue takes images (png, jpg, gif, webp) and PDFs, each at most 20 MB, from `add --media`, `attach`, or the UI: the new-issue form and the Media panel of the Issue page take a picked, pasted or dropped file. A file goes into the same commit as the issue, at `issues/<n>/<name>` beside `issue.md`, and its name goes into the issue's `media` field; a name already there gets a number.

Intake gets each file's path in its prompt, with `--add-dir` on the issue's folder in the items checkout, and reads them before it writes the spec or the sub-issues. A worker's brief lists the same files, and a sub-issue's worker also gets its issue's files.

## How the store works

The store's `origin/main` is the record. A read fetches it and reads it there. A write is one commit on it, made without a working tree, and then the store's checkout fast-forwards. A change to an issue never moves a product repo's `main`. An issue closes in the store after its landing commit is pushed.

A write takes the issue number from the counter in `aleph.db` before the push. If the push is refused, the number stays used. Closing an issue, by `done`, `drop`, a land or the director, logs one `done` or `dropped` event on `issue.<n>` after the push, in one code path, so a close has one event and one reason in `closed_why`. Code writes no note: a note is what a person or an agent said.

## Fields

[Data model](data-model.md#items-repo-items) lists each frontmatter field and the file format. The status is a result of the fields: `closed_as` (`done` or `dropped`), else `parked`, else `open`. An Ask is not in the store; it is on the job record.

Notes are append-only. That is the lost update this format prevents: two writers each add a line, and neither erases the other's.

`lint` exits 1 on a missing or malformed key, a missing `project` or `created`, an unknown status, a malformed `from` or `after`, or a retired field, and names the file and the field. `--fix` drops a stale `id` or `updated`, renames `created_time` to `created` and `closed_time` to `closed_at`, and repairs a bare scalar where a list belongs, and still exits 1 if anything is left.
