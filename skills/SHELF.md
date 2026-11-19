# Shelf

The rule for a skill whose output is large: put it on Chris's shelf, and reply short. A skill that links here gives
the file, the kind and whether it waits. What the skill finds and writes stays the same. Repo files stay in the repo,
and the shelf gets a copy.

## When

Both must hold:

- The run is interactive: `ALEPH_AGENT` is unset, and it is not a headless run (`claude -p`). A run is headless when
  the `AskUserQuestion` tool is not available to you.
- `command -v shelf` finds the command.

In every other case, output as the skill says without this file, and run no `shelf` command.

## Steps

1. Write the output to a file. HTML stays HTML. Text is Markdown.
2. Run `shelf put <file> --title "<skill>: <subject>" --kind <kind>`. It prints the item id and URL.
3. Open the URL in Chris's browser: `cd /mnt/c && /mnt/c/Windows/System32/cmd.exe /c start "" "<url>"`.
4. Reply with the verdict or the top line in at most 5 lines, then the URL.
5. Only where the skill wants notes: run `shelf wait <id>` with `run_in_background`, then end the turn. When `wait`
   exits 0, its output is Chris's notes. If `put` fails or `wait` exits 2, reply with the full output as the skill says.
   A skill that does not want notes runs no `wait`.
