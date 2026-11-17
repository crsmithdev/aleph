# Prove, guard and report

The last steps of a refit `retro`, shared by refit-code, refit-agents, refit-data, refit-design, refit-docs and refit-tests. The skill that runs them
supplies its lens files, its `.refit.json` and its report path.

1. **Prove.** Open every location of every candidate and apply its lens's proof bar. Read
   [EXAMPLES.md](EXAMPLES.md) first to calibrate. A candidate that meets the bar is a finding; one that does not
   is dropped with the reason; one `.refit.json` accepts is marked accepted. Where a lens has no hard proof,
   rate 1-5: 4-5 is a finding, 3 is a finding with the doubt stated, 1-2 is dropped. Done when each candidate
   has a verdict.
2. **Owner, guard, tier and fix.** For each finding, its lens's Fix section names what changes, and its Guard
   section names what keeps it from coming back. Then give it a tier, and name the trigger of each ask finding in
   one sentence. A finding is **ask** when its fix:
   1. changes a stored schema, runs a migration or writes to live user data (`~/.aleph/`, a production DB);
   2. changes a CLI flag, an API route or field, an event, an exit code or an error a caller handles;
   3. changes a limit, a count, a gate or a retry;
   4. adds a dependency on the network, a remote or a service;
   5. deletes an untracked file;
   6. goes against an accepted ADR or a PRINCIPLES.md rule;
   7. needs a new interface ([DEEPEN.md](DEEPEN.md));
   8. pushes, force-pushes or deletes a remote branch.

   Every other finding is **auto**. Then fix each auto finding with no question before any fix, in the skill's Act
   lens order, by refit-code's [Act](SKILL.md#act). A skill with no Act (refit-data) gives no
   tier and runs no fix.

   During the fix, an item in a touched file, or in a file the finding names, that one of the skill's lenses
   covers is a **rider**. An auto rider gets its own commit and shows as "found during fix"; an ask rider joins
   the ask list. An item that none of the skill's lenses covers goes to `aleph issue add`, never into the report.

   Done when every finding has an owner, a guard and a tier, and every auto finding has a commit or "reverted".
3. **Report.** Write the HTML report of [REPORT.md](REPORT.md), a directory with `index.html`.
   Give the user its absolute path. Then let the user pick among the ask findings only, the ones that wait for
   Chris. The auto findings are already fixed and are not asked about:
   - In an interactive run with `ALEPH_AGENT` unset, put the report on the shelf:
     `bun ~/aleph-tools/shelf.ts put <report file or directory> --kind report`. It prints the item id and URL.
     Open the URL in the user's browser with
     `cd /mnt/c && /mnt/c/Windows/System32/cmd.exe /c start "" "<url>"`. Then run
     `bun ~/aleph-tools/shelf.ts wait <id>` with `run_in_background` and end the turn. When `wait` exits 0, its
     output is the user's notes: they pick and steer the ask findings to act on.
   - If `put` fails, or `wait` exits 2, ask which ask findings to act on in an `AskUserQuestion`.
   - In a headless run, `AskUserQuestion` is not available: end the reply with the ask findings as a numbered list.
   - With no ask finding, ask nothing and end the run. A dismissed question leaves the auto fixes in place.

   `scan` mode skips the fix of step 2: it is today's report-only run. Each card shows its tier and no commit, and
   the pick covers every finding. File issues only when the user asks. Done when the report is
   written and the user has a way to pick, or no ask finding waits.
