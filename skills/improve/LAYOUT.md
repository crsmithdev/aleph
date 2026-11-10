# Layout lens

Can a reader find a thing where they would look for it? This lens works on files and directories, not on the
code inside a file. A good tree has one directory per concept, files sized to one job each, and names that
follow one pattern. In a bad tree, every change needs a search first.

The line with the sweep: the sweep moves a file when the repo's own majority convention says it is in the wrong
place, which is a yes or no check ([SWEEP.md](SWEEP.md)). This lens asks whether the convention and the tree
are right, which is a judgment.

## Signals

Layout is a property of the whole tree, so its hunt runs over the whole repo, not one directory at a time.
Start with three measurements, and write down each number:

- **Imports by directory.** For each file, how many of its imports and importers live in its own directory
  against other directories. A directory's own `lib/` child counts as its own directory.
- **Co-change across directories.** The seed's pairs (`cochange.ts seed`) where the two files are in
  different directories. When the seed has fewer than ten pairs, run it again with `--since 1.year`; with
  still too few, say that the signal has no evidence.
- **File size.** Lines per file against the median of its kind: entry and wiring files (CLIs, routers,
  servers), views, tests and library modules each have their own median.

Then look for:

- **A file in the wrong home.** Most of its importers and imports live in one other directory, or it changes
  with files there and not with its neighbours.
- **Layers that point the wrong way.** A shared directory (`lib/`, `core/`) imports from a feature directory
  (`jobs/`, `ui/`). Usually the imported file is shared code with a feature's address: it moves to the
  shared directory. When the fix is a move, the finding is layout; when the fix is to route the access
  through an interface, it is **seams**.
- **One concept across many directories.** A change to one concept touches three directories every time (the
  cross-directory co-change pairs). The concept has no home.
- **Partly dead files.** Nothing uses most of the file's exports, and the live rest is one helper with one or
  two callers. The dead part is a **dead** finding. The finding here is where the live rest goes: inline it
  into its caller, or move it to the module that uses it, then delete the file.
- **Grab-bags.** A `utils`, `helpers`, `common`, `misc` or `shared` file or directory with unrelated contents.
  Each part has a home next to its callers.
- **A file with several jobs.** A file many times the median whose parts do not call each other: split it by
  concept. Its opposite is many tiny files that each have one caller: merge each one into its caller.
- **Directories that do not match the domain.** A directory name that is not a word in `GLOSSARY.md`,
  `docs/naming.md` or the README, or a concept there that no directory or file is named for. With none of
  these files, skip this signal and say so.
- **Name drift.** Files of one kind named in more than one pattern (`x.test.ts` and `test-x.ts`, kebab and
  camel case), or a directory and the module in it with different names.
- **Shape problems.** A root that holds files with a better home, so a newcomer cannot tell the entry points
  from the support files. Chains of directories with one child each. Tests and fixtures far from their subject
  where the repo puts them next to it, or the opposite. A test that covers several modules goes next to the
  one it tests most; when no one module leads, it is not a finding.

## Proof

No hard proof exists, so rate each candidate 1-5. A finding carries its measurement: the import counts by
directory, the co-change pairs, the export use counts or the size against the median. It also carries the
**look-first test**: name the concept, name where a reader looks first (from the glossary, the README and the
directory names), and name where it is. When the two places are the same, the candidate is dropped.

Each finding names its target: the moves, merges and splits, as a before and after tree.

## Fix

`git mv` each file, so its history follows it, and fix the imports, configs and doc paths that the move breaks
in the same commit. Merge or split by concept. Rename to the repo's pattern for the kind.

Before you act, list the open branches and worktrees that touch the files you move (`git branch`,
`git worktree list`, `git diff --stat main...<branch>`). A move gives each of them a conflict, so report them.
A reshape of more than one top-level directory is reported as a proposed tree, and the user decides. `act`
does not do it.

## Hold

`check` asks where each new file goes. The tool holds are a dependency-cruiser rule on which directories may
import which, and a shrink-only ratchet on file size. Neither is wired yet, so the holds table lists them as
unchecked.

## Check

Does the new file go in the directory where its callers and its kind live? Does it make a grab-bag, or a second
home for a concept that has one? Does its name follow the repo's pattern for its kind?
