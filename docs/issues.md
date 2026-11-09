# Issues

Every repo in `~/.aleph/repos.json` has an issue list in the work store, a private git repo cloned at `~/.aleph/issues` (`ALEPH_ISSUES` overrides the path). Use `aleph issue` for every change; `git-guard` denies an Edit or Write on a store file.

## Issues and sub-issues

An **issue** is what someone asks for: Chris, a worker or the correction memory. The request stays as written in the request part of the file. Intake writes a spec on it, or splits a large issue into **sub-issues**, each with its own spec and a `from:` link to it. A sub-issue never has sub-issues.

Each is one file: `<repo>/backlog/tasks/<repo>-<n>.md`, or `<repo>-<n>.<k>.md` for an old part. A file holds a small frontmatter header, free prose, and a list of notes. Status is a field, never a folder: a finished issue stays where it is and keeps its number, because commits, specs and the vault quote that number.

## Use it

```bash
aleph issue add aleph "The Status page shows the wrong weekly usage" --priority high
echo "Reproduce with a usage row dated in the future." | aleph issue add aleph "Ignore future usage rows" --request -
aleph issue list aleph --status open --label ui
aleph issue show aleph 1057
aleph issue note aleph 1057 "Reproduced on main at c26c10f"
aleph issue done aleph 1057 "Landed in 84966d1"
```

An issue added with `--spec -` is ready to build in a repo without `"author": true`. In a repo with it, intake takes the issue in first and keeps or fixes the spec.

## Commands

| Command | Does |
|---|---|
| `add <repo> "<title>" [--request -] [--spec -] [--priority p] [--labels a,b] [--after <id>] [--media <file>]...` | Adds an issue; `-` reads stdin |
| `list [<repo>] [--status open\|done\|dropped] [--label <area>] [--json]` | Lists issues |
| `show <repo> <id> [--json]` | Prints one issue, its spec and its notes |
| `edit <repo> <id> [--title t] [--request -] [--spec -] [--priority p] [--labels a,b] [--source s] [--after <id>]` | Changes fields |
| `note <repo> <id> "<text>"` | Adds one line with a time stamp; it never rewrites a line |
| `attach <repo> <id> <file>...` | Attaches images or PDFs |
| `decide <repo> <id> "<text>"` | Answers an issue that waits for Chris, and clears its Ask |
| `done <repo> <id> ["<summary>"]` | Closes the issue as done |
| `drop <repo> <id> "<reason>"` | Closes the issue as dropped |
| `lint [<repo>] [--fix]` | Checks every file; `--fix` repairs what is mechanical |

Every command that takes an `<id>` also takes an old part, `<n>.<k>`. With no repo, `list` and `lint` cover the recent repos: those with a run or an issue change in the last 7 days, latest first.

## Media

An issue takes images (png, jpg, gif, webp) and PDFs, each at most 20 MB, from `add --media`, `attach`, or the UI: the new-issue form and the Media panel of the Issue page take a picked, pasted or dropped file. A file goes into the same commit as the issue, at `<repo>/backlog/media/<repo>-<id>/<name>`, and its name goes into the issue's `media` field; a name already there gets a number.

Intake gets each file's path in its prompt, with `--add-dir` on the media folder, and reads them before it writes the spec or the sub-issues. A worker's brief lists the same files, and a sub-issue's worker also gets its issue's files. Runs read the files from `origin/main` into `~/.aleph/issues-media` (`<store>-media`), so the state of the store's checkout does not matter.

## How the store works

The store's `origin/main` is the record. A read fetches it and reads it there. A write is one commit on it, made without a working tree, and then the store's checkout fast-forwards. A change to an issue never moves a product repo's `main`. An issue closes in the store after its landing commit is pushed.

Each `<repo>/` folder is a [Backlog.md](https://github.com/MrLesk/Backlog.md) project (1.55.3, pinned in `~/.aleph/tools`). `backlog browser` in `~/.aleph/issues/<repo>` shows that repo's issues as a board. Make changes with `aleph issue`, not with the board.

## Fields

[Data model](data-model.md#work-store-issues) lists each frontmatter field and the file format. The status is a result of the fields: `closed_as` (`done` or `dropped`), else `parked`, else `open`. An Ask is not in the store; it is on the job record.

Notes are append-only. That is the lost update this format prevents: two writers each add a line, and neither erases the other's.

`lint` exits 1 on a missing or malformed key, an unknown status, a duplicate id, or a retired field, and names the file and the field. `--fix` repairs a missing date, a stale `id`, or a bare scalar where a list belongs, and still exits 1 if anything is left.
