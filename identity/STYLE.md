# Style

Code is minimal and good to look at. These rules apply to every repo. A
repo's own style guide, glossary or principles win over them, and an edit
matches the style of the file it changes. When the repo runs a formatter,
the formatter has the last word on whitespace.

## Names

1. **Short names.** The length of a name grows with its scope. A local
   name can have two characters (`lo`, `hi`). A module-level name is one
   word if it can be.
   > Length is not a virtue in a name; clarity of expression is.
   > (Rob Pike, *Notes on Programming in C*)

   | Scope | Good | Too long |
   |---|---|---|
   | loop, comprehension, lambda | `w`, `r`, `lo, hi` | `wordIndex` |
   | function | `key`, `runs`, `edges`, `flags` | `separatorValues` |
   | module | `SYNC`, `TAPS`, `PERIOD`, `unmask` | `LFSR_TAP_MASK` |

2. **The glossary's words.** A thing that the repo's glossary names keeps
   that name, whole, at every scope. Do not shorten it and do not invent a
   second word for it. A short name is for a thing the glossary does not
   name.
3. **No noise in a name.** No type (`payloadArr`), no `data`, `info`,
   `value`, `num` or `List`. A plural is a collection: `runs`, `states`.
4. **Two characters or more.** A one-letter name lives only in a loop, a
   comprehension or a one-line lambda.
5. **A legend for abbreviations.** When a module uses an abbreviation in
   many places, its top comment lists it once, as Norvig's `sudoku.py`
   does. A glossary term is never abbreviated (rule 2).

   ```python
   ## Throughout this program we have:
   ##   r is a row,    e.g. 'A'
   ##   c is a column, e.g. '3'
   ```

## Shape

6. **Whole collections, not loops.** An array expression, a `map`, a
   comprehension or a query shows the shape of the operation. A loop is
   for a step that depends on the step before it.
7. **Short functions.** A function does one job in a few lines. Its doc
   comment is one line that says what it returns: `"Most probable
   spelling correction for word."` (Norvig, `spell.py`).
8. **Flat.** Return early. No `else` after `return`. No more than two
   levels of indent inside a function.
9. **Parallel things look parallel.** Code that does the same job for
   different cases has the same shape, line for line, as the operators in
   micrograd's `Value`. Put related lines in the same order each time.
10. **No defence the inputs do not need.** Check input once, at the
    boundary. CPython's `wave._read_fmt_chunk` wraps each read in its own
    `try` because it reads any file; code with known inputs does not.
11. **Tables stay tables.** Formatters remove the spaces that align
    columns. A table of data can keep its alignment behind the
    formatter's off switch (`# fmt: off`, `// prettier-ignore`). Do this
    only for data, never for logic.

## Comments

12. **A comment gives what the code cannot:** a field meaning, a reason, a
    source. It never says what the next line does.

    ```python
    # bad (minbpe/basic.py)
    # save the merge
    merges[pair] = idx

    # good
    if self.tail == 4:  # a final word with no separator after it
    ```

13. **Give the shape or the unit** of a value where the code makes it, as
    nanoGPT does with `# (B, nh, T, hs)`.

## Example

One helper replaces two loops (btcx-tools, `btcx/container.py`).

Before:

```python
def base60_regions(self, lanes=(0, 1), min_words=32):
    """Word ranges where the given payload lanes hold only values 0-59."""
    ok = np.all(self.payload[:, list(lanes)] < 60, axis=1)
    regions, start = [], None
    for i, flag in enumerate(np.append(ok, False)):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            if i - start >= min_words:
                regions.append((start, i))
            start = None
    return regions
```

After:

```python
def base60_regions(self) -> list[tuple[int, int]]:
    """Inclusive word ranges of 32 or more words where lanes 0 and 1 hold only 0-59."""
    flags = np.all(self.payload[:, :2] < BASE, axis=1)
    return [(start, stop - 1) for start, stop in _runs(flags) if stop - start >= BASE60_MIN_WORDS]


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Half-open index ranges of consecutive True values."""
    edges = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    return list(zip(np.flatnonzero(edges == 1).tolist(), np.flatnonzero(edges == -1).tolist(), strict=True))
```

## Read these

| Code | What to take |
|---|---|
| [Norvig, `spell.py`](https://github.com/norvig/pytudes/blob/main/py/spell.py) | One-line docstrings, functions of one to three lines, names from the domain. |
| [Norvig, `sudoku.py`](https://github.com/norvig/pytudes/blob/main/py/sudoku.py) | A legend of short names at the top (rule 5). |
| [Norvig, `lis.py`](https://github.com/norvig/pytudes/blob/main/py/lis.py) | A whole interpreter in 130 lines. |
| [Karpathy, micrograd `engine.py`](https://github.com/karpathy/micrograd/blob/master/micrograd/engine.py) | One shape repeated for each operator; a small surface. |
| [Karpathy, nanoGPT `model.py`](https://github.com/karpathy/nanoGPT/blob/master/model.py) | Array shapes in comments (rule 13). |
| [Rhodes, contingent `graphlib.py`](https://github.com/aosabook/500lines/blob/master/contingent/code/contingent/graphlib.py) | Most methods are one to three lines over two dicts. The names are longer than rule 1 permits. |

## Avoid these

| Code | What goes wrong |
|---|---|
| [Karpathy, minbpe `basic.py`](https://github.com/karpathy/minbpe/blob/master/minbpe/basic.py) | Most comments repeat the code (rule 12). |
| [Batchelder, templite `CodeBuilder.get_globals`](https://github.com/aosabook/500lines/blob/master/template-engine/code/templite.py) | A comment above each line says what the line does (rule 12). |
| [CPython `wave._read_fmt_chunk`](https://github.com/python/cpython/blob/main/Lib/wave.py) | A `try` around each read (rule 10). |
