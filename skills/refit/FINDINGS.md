# Findings

A refit run keeps its findings as data, so the report and a later `fix <run dir>` read the same record.

## Run directory

`~/.aleph/refits/<repo>/<skill>-<YYYYMMDD-HHMMSS>/`, where `<repo>` is the name of the main checkout's
directory. With `ALEPH_AGENT` set, use `<tmpdir>` from `$TMPDIR`, else `/tmp`, in place of `~/.aleph/refits`. The
directory holds:

- `findings.json`: the record below. The agent writes it, and only the agent changes it.
- `index.html`, `app.css` and other files of the report, by [REPORT.md](REPORT.md).

## `findings.json`

```json
{
  "skill": "refit-code", "repo": "aleph", "mode": "scan", "at": "2026-11-17T14:30:00-08:00",
  "commit": "6f77d1ea", "scope": ["one-way", "slop"], "unit": "module",
  "overview": { "seed": "..." },
  "findings": [
    {
      "id": "f1", "lens": "one-way", "unit": "lib/naming.ts", "title": "Parse issue refs in one place",
      "signal": "twin parsers", "strength": "Disagrees",
      "locations": ["lib/naming.ts:77 (owner)", "ui/issue.ts:32"],
      "fix": "ui/issue.ts calls parseRef from lib/naming.ts.", "figure": true, "guard": "a lint test for the regex outside lib/naming.ts",
      "tier": "ask", "trigger": "changes a CLI flag",
      "status": "open", "reason": null, "commit": null, "rider": null
    }
  ],
  "proposals": []
}
```

- `id`: `f<n>` for a finding, `d<n>` for a candidate that is not a finding. Numbers count from 1 over the run.
- `unit`: the skill's report unit that holds the finding. A finding over many units sits in its owner's unit.
- `strength`: the lens's badge, such as `Disagrees`, a tier `T2` or a rating `4`.
- `figure`: `true` when the fix changes how two or more files relate (merges copies, moves an owner, closes a leak or
  collapses a call path), else `false`. PROVE.md step 2 sets it. The report draws a figure for `true` only, and a
  later `fix <run dir>` reads it to draw the same figures.
- `before`, `after`: with `figure` false, the lines or text before and after the fix, as the code reads. `after` is
  `(gone)` when the fix deletes the lines.
- `tier`: `auto`, `ask`, or `none` in a skill with no fix.
- `trigger`: for an ask finding, the PROVE.md trigger, in one sentence.
- `rider`: the id of the finding whose fix found it, else `null`.
- `overview`: the skill's own Overview facts, such as refit-code's seed or refit-tests' wall time.
- `proposals`: each change to the skill's reference doc that the run asks for: `{"where", "evidence", "text"}`.

## Statuses

| Status | Meaning | Set by |
|---|---|---|
| `open` | A finding with no action yet | prove |
| `dropped` | A candidate under the proof bar; `reason` says why | prove |
| `accepted` | A candidate that `.refit.json` accepts | prove |
| `survivor` | A dead-lens candidate that an escape hatch keeps; `reason` names the hatch | prove |
| `picked` | A finding the user picked | the pick |
| `fixed` | Fixed and committed; `commit` holds the hash | the Act loop |
| `reverted` | The fix turned the baseline red; `reason` holds the failed command | the Act loop |
| `stale` | A picked finding that no longer holds at HEAD | `fix <run dir>` |
