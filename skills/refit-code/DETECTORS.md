# Detectors

Per-stack tools for the [dead lens](DEAD.md). Detect the stack from the manifest, run that row, ignore the rest.

**Run from a throwaway cache, never from the repo's dependencies.** `bunx`/`npx -y`/`uvx` fetch a tool without writing to `package.json` or the lockfile. If a tool is already a dev dependency, use the installed one. If neither works offline, use the grep sweep below and say in the report that the survey was grep-only.

## By stack

| Stack | Manifest | Detectors | What each finds |
|---|---|---|---|
| TS / JS | `package.json` | `knip`, `madge --circular`, `depcheck` | Unused files, exports, types and dependencies; import cycles; deps declared but never imported |
| Python | `pyproject.toml` | `vulture`, `ruff check --select F401,F841`, `deptry` | Unused functions, classes and variables; unused imports and locals; declared-but-unimported packages |
| Rust | `Cargo.toml` | `cargo machete`, `cargo udeps`, `cargo clippy` | Unused dependencies (fast, then thorough); dead code warnings |
| Go | `go.mod` | `staticcheck`, `go mod tidy -diff` | Unused unexported symbols; dependencies the module no longer needs |

`knip` is the strongest of these: it reports unused files, exports and dependencies in one pass, and it understands entry points, so point it at the repo's real ones (see "Entry-point blindness"). Prefer configuring it in the run over committing a `knip.json`, unless the user wants the config kept.

## Reading the output

Detector output is a candidate list, not a finding list. Four failure shapes recur:

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

## Stores nothing reads

A file, table or env name that code writes on a schedule and no other code reads. The dead lens owns the finding; this sweep lists the candidates as `file:line`, run at the repo root. A mention in docs, a UI file or a script counts as a reader here, so the sweep leaves those out of its list and the proof table in [DEAD.md](DEAD.md) rules on the rest.

```sh
# write-only stores: a file, table or env name that code writes and no non-test line reads
{
  # a file write names its store by the last string literal of its path, else by its path function
  git grep --untracked -n -P '\b(?:writeFileSync|appendFileSync|writeFile|appendFile|Bun\.write)\(' -- '*.ts' ':!*.test.*' ':!*fixture*' |
    perl -ne 'my ($f, $l, $t) = /^([^:]+):(\d+):(.*)$/ or next;
      while ($t =~ /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|Bun\.write)\(((?:[^(),]++|(?<p>\((?:[^()]++|(?&p))*\)))*)/g) {
        my $a = $1; my @s = $a =~ /["\x27\x60]([^"\x27\x60\$]+)["\x27\x60]/g;
        my ($k) = @s ? $s[-1] : grep { !/^(?:join|resolve|dirname)$/ } $a =~ /([A-Za-z_]\w*)\(/g;
        print "$f:$l:$k\n" if defined $k }'
  git grep --untracked -n -o -P -i '(?:INSERT (?:OR \w+ )?INTO|CREATE TABLE (?:IF NOT EXISTS )?)\s*\K\w+' -- '*.ts' ':!*.test.*' ':!*fixture*'
  git grep --untracked -n -o -P 'process\.env\.\K\w+(?=\s*=[^=])' -- '*.ts' ':!*.test.*' ':!*fixture*'
} | while IFS=: read -r f l k; do
  git grep --untracked -h -w -F -e "$k" -- . ':!*.test.*' ':!*fixture*' |
    grep -v -E 'writeFile|appendFile|Bun\.write|rmSync|unlink|mkdir|INSERT|CREATE TABLE|process\.env\.\w+ *=[^=]|^\s*import |(const|let|var|function) +'"$k"'\b' |
    grep -q . || echo "$f:$l"
done | sort -u
exit 0 # stops `bash -c "$(awk ...)"` before it reads the closing fence
```

Each hit is a store with a writer and no reader anywhere outside tests: a read in the writer's own file counts. The sweep names a file by the last literal in its path (`"suite-history.jsonl"`) or, when the path has none, by its path function (`historyFile`), so it skips a write to a bare variable such as `out`; follow that variable by hand. A reader in another process, a string lookup that builds the name, or a person who reads it by hand also keep a store alive: those are the hatches in DEAD.md.
