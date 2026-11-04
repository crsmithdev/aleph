# Issues

Every repo in `~/.aleph/repos.json` has an issue list in the work store, a private git repo cloned at `~/.aleph/issues` (`ALEPH_ISSUES` overrides the path). Use `aleph issue` for every change; `git-guard` denies an Edit or Write on a store file.

## Issues and goals

An **issue** is what someone asks for: Chris, a worker or the correction memory. The request stays as written under `## Request`. Triage or the planner makes one or more **goals** from it, numbered under it (`aleph-577.1`). A goal never has parts, and an issue never has build runs.

Each is one file: `<repo>/backlog/tasks/<repo>-<n>.md`, or `<repo>-<n>.<k>.md` for a goal. A file holds a small frontmatter header, free prose, and a list of notes. Status is a field, never a folder: a finished issue stays where it is and keeps its number, because commits, specs and the vault quote that number.

## Use it

```bash
aleph issue add aleph "The Status page shows the wrong weekly usage" --priority high
echo "Reproduce with a usage row dated in the future." | aleph issue add aleph "Ignore future usage rows" --request -
aleph issue list aleph --status open --label ui
aleph issue show aleph 1057
aleph issue note aleph 1057 "Reproduced on main at c26c10f"
aleph issue done aleph 1057 "Landed in 84966d1"
```

An issue added with `--spec -` is ready to build: the factory starts it without a triage run.

## Commands

| Command | Does |
|---|---|
| `add <repo> "<title>" [--request -] [--spec -] [--priority p] [--labels a,b] [--after <id>]` | Adds an issue; `-` reads stdin |
| `list [<repo>] [--status open\|done\|dropped] [--label <area>] [--json]` | Lists issues |
| `show <repo> <id> [--json]` | Prints one issue, its spec and its notes |
| `edit <repo> <id> [--title t] [--request -] [--spec -] [--priority p] [--labels a,b] [--source s] [--after <id>]` | Changes fields |
| `note <repo> <id> "<text>"` | Adds one line with a time stamp; it never rewrites a line |
| `decide <repo> <id> "<text>"` | Answers an issue that waits for Chris, and clears its Ask |
| `done <repo> <id> ["<summary>"]` | Closes the issue as done |
| `drop <repo> <id> "<reason>"` | Closes the issue as dropped |
| `lint [<repo>] [--fix]` | Checks every file; `--fix` repairs what is mechanical |

Every command that takes an `<id>` also takes a goal, `<n>.<k>`. With no repo, `list` and `lint` cover the recent repos: those with a run or an issue change in the last 7 days, latest first.

## How the store works

The store's `origin/main` is the record. A read fetches it and reads it there. A write is one commit on it, made without a working tree, and then the store's checkout fast-forwards. A change to an issue never moves a product repo's `main`. A goal closes in the store after its landing commit is pushed.

Each `<repo>/` folder is a [Backlog.md](https://github.com/MrLesk/Backlog.md) project (1.55.3, pinned in `~/.aleph/tools`). `backlog browser` in `~/.aleph/issues/<repo>` shows that repo's issues and goals as a board. Make changes with `aleph issue`, not with the board.

## Fields

| Field | On | Holds |
|---|---|---|
| `id`, `title`, `status`, `created`, `updated`, `priority`, `repo` | both | The basics |
| `kind` | both | `issue` or `goal` |
| `source` | issue | `chris`, `worker`, `memory` or `agent` (filed from a Claude Code session, which sets `CLAUDECODE`); older issues can hold `deps` |
| `areas` | both | Labels |
| `goals` | issue | Its goals, when it has them |
| `ask` | issue | What it asks Chris, when it waits |
| `issue` | goal | Its issue |
| `after` | goal | The goals it runs after, for order only |

Notes are append-only. That is the lost update this format prevents: two writers each add a line, and neither erases the other's.

`lint` exits 1 on a missing or malformed key, an unknown status, a duplicate id, or a label or field of the old shape, and names the file and the field. `--fix` repairs a missing date, a stale `id`, or a bare scalar where a list belongs, and still exits 1 if anything is left.
