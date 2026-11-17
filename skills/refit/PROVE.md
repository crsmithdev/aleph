# Prove, tier and pick

Step 3 of [PROCESS.md](PROCESS.md), and the pick of its step 6. The skill supplies its lens files and
`.refit.json`.

1. **Prove.** Open every location of every candidate and apply its lens's proof bar. When the skill has an
   `EXAMPLES.md`, read it first to calibrate. A candidate that meets the bar is a finding (`open`). One that does
   not is `dropped`, with the reason. One that `.refit.json` accepts is `accepted`. Where a lens has no hard
   proof, rate the candidate 1-5: 4-5 is a finding, 3 is a finding with the doubt stated, 1-2 is dropped. Done
   when each candidate has a status.
2. **Owner, guard and tier.** For each finding, its lens's Fix section names what changes, and its Guard section
   names what keeps it from coming back. Then give it a tier. A finding is **ask** when its fix:
   1. changes a stored schema, runs a migration or writes to live user data (`~/.aleph/`, a production DB);
   2. changes a CLI flag, an API route or field, an event, an exit code or an error a caller handles;
   3. changes a limit, a count, a gate or a retry;
   4. adds a dependency on the network, a remote or a service;
   5. deletes an untracked file;
   6. goes against an accepted ADR or a PRINCIPLES.md rule;
   7. needs a new interface (refit-code's [DEEPEN.md](../refit-code/DEEPEN.md));
   8. pushes, force-pushes or deletes a remote branch.

   Name the trigger of each ask finding in one sentence. Every other finding is **auto**. A skill with no fix
   (refit-data) gives the tier `none`. Done when every finding has an owner, a guard and a tier.

## Pick

Give Chris the report's absolute path, then the pick. The pick covers the findings that are still `open`:
after `fix`, the ask findings, and after `scan`, every finding.

- In an interactive run with `ALEPH_AGENT` unset, put the report on the shelf:
  `bun ~/aleph-tools/shelf.ts put <run dir> --kind report`. It prints the item id and URL. Open the URL in
  Chris's browser with `cd /mnt/c && /mnt/c/Windows/System32/cmd.exe /c start "" "<url>"`. Then run
  `bun ~/aleph-tools/shelf.ts wait <id>` with `run_in_background` and end the turn. When `wait` exits 0, its output
  is Chris's notes: they pick and steer the findings.
- If `put` fails, or `wait` exits 2, ask which findings to fix in an `AskUserQuestion`.
- In a headless run, `AskUserQuestion` is not available: end the reply with the open findings as a numbered
  list and the run directory.
- With no open finding, ask nothing and end the run.

Set each picked finding to `picked` in `findings.json`, then run the Act loop of PROCESS.md on them in this run.
In a skill with no fix, file each picked finding with `aleph issue add` instead. A dismissed question leaves the
findings `open`, and a later `fix <run dir>` asks again.
