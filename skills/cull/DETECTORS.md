# Detectors

Per-stack tools for step 2 of [cull](SKILL.md). Detect the stack from the manifest, run that row, ignore the rest.

**Run from a throwaway cache, never from the repo's dependencies.** `bunx`/`npx -y`/`uvx` fetch a tool without writing to `package.json` or the lockfile. If a tool is already a dev dependency, use the installed one. If neither works offline, use the grep sweep below and say in the report that the survey was grep-only.

## By stack

| Stack | Manifest | Detectors | What each finds |
|---|---|---|---|
| TS / JS | `package.json` | `knip`, `madge --circular`, `depcheck` | Unused files, exports, types and dependencies; import cycles; deps declared but never imported |
| Python | `pyproject.toml` | `vulture`, `ruff check --select F401,F841`, `deptry` | Unused functions, classes and variables; unused imports and locals; declared-but-unimported packages |
| Rust | `Cargo.toml` | `cargo machete`, `cargo udeps`, `cargo clippy` | Unused dependencies (fast, then thorough); dead code warnings |
| Go | `go.mod` | `staticcheck`, `go mod tidy -diff` | Unused unexported symbols; dependencies the module no longer needs |

`knip` is the strongest of these: it reports unused files, exports and dependencies in one pass, and it understands entry points. Give it the repo's real entry points (bins, hooks, test globs) or it reports every one of them as unused. Prefer configuring it in the run over committing a `knip.json`, unless the user wants the config kept.

## Reading the output

Detector output is a candidate list, not a finding list. Three failure shapes recur:

- **Entry-point blindness, and the cascade behind it.** Anything the framework loads by path looks unused: hooks, CLI bins, job handlers, route files, migrations. This is not a rare miss, and it does not stop at the entry point. Everything the misread file imports goes dark with it, so one unregistered path can carry a dozen live modules and their exports into the report. On the aleph repo, 21 of 23 `knip` candidates traced back to a single manifest the tool had not been pointed at. Find the entry points first and re-run; a report built on the wrong roots is not worth reading, let alone proving.
- **Type-only exports.** A type imported with `import type` and erased at build time reads as unused to some tools. It is not.
- **Name collisions.** Two modules can export the same type name. Grepping the bare name then answers for the wrong one, which turns a real finding into a survivor. Resolve the import, do not count the word.
- **Declared side effects.** A module imported purely for its side effect (a polyfill, a registration call) has no used export and is still load-bearing.

## Grep sweep

The fallback when no detector runs, and a cross-check when one does. Universal, noisy, and cheap:

```sh
# files nothing imports, by basename
git ls-files '*.ts' | while read -r f; do
  n=$(basename "$f" .ts)
  [ "$(git grep -c -- "$n" -- ':!'"$f" | wc -l)" -eq 0 ] && echo "orphan: $f"
done

# commented-out blocks, three or more consecutive comment lines holding code punctuation
git grep -n -E '^\s*//.*[;{}()]' | awk -F: '{print $1}' | uniq -c | awk '$1 >= 3'

# TODO and FIXME with an age, oldest first
git grep -n -E 'TODO|FIXME' | while IFS=: read -r f l _; do
  echo "$(git blame -L "$l,$l" --porcelain -- "$f" | awk '/^author-time/{print $2}') $f:$l"
done | sort -n | head -20
```

Adjust the extension and the comment marker for the stack. The orphan sweep matches on basename, so it over-reports for common names and under-reports for re-exported ones: every hit still goes through the proof table.
