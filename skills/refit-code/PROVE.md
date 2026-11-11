# Prove, hold and report

The last steps of a refit `retro`, shared by refit-code, refit-agents and refit-docs. The skill that runs them
supplies its lens files, its `.refit.json` and its report path.

1. **Prove.** Open every location of every candidate and apply its lens's proof bar. Read
   [EXAMPLES.md](EXAMPLES.md) first to calibrate. A candidate that meets the bar is a finding; one that does not
   is dropped with the reason; one `.refit.json` accepts is marked accepted. Where a lens has no hard proof,
   rate 1-5: 4-5 is a finding, 3 is a finding with the doubt stated, 1-2 is dropped. Done when each candidate
   has a verdict.
2. **Owner and hold.** For each finding, its lens's Fix section names what changes, and its Hold section names
   what keeps it from coming back. Done when every finding has both.
3. **Report.** Write the HTML report of [REPORT.md](REPORT.md), strongest first, then accepted and dropped.
   Give the user its absolute path. Then ask which findings to act on, in an `AskUserQuestion`. In a headless
   run, `AskUserQuestion` is not available: end the reply with the findings as a numbered list instead. File
   issues only when the user asks. Done when the report is written and the question asked.
