# Structure lens

Does each skill load in tiers, so that the agent reads only what its branch needs? The Agent Skills spec
(agentskills.io/specification) names three tiers: metadata (about 100 tokens, loaded for every skill at start),
the `SKILL.md` body (under 5,000 tokens recommended, loaded when the skill fires), and resources (scripts,
references, assets, loaded when a step needs them). **load** owns the first tier. This lens owns the second and
the third, and the shape of the skill directory.

The spec's `scripts/`, `references/` and `assets/` directories are a convention. A skill that keeps its files
beside `SKILL.md` is not a finding.

## Signals

From `load.ts` (`lazy`, `skills`) and a read of each skill:

- **A heavy body.** A `SKILL.md` body over 5,000 tokens (`skill body` in `lazy`), even under agnix's 500-line
  limit (`AS-012`).
- **A branch in the body.** A section that only one mode, lens or input needs, inline in `SKILL.md`. Each other
  branch pays for it.
- **A pointer with no condition.** A link that does not say when to open it ("see REF.md"). The agent opens it
  every time or never. Write "For X, read Y."
- **A chain.** A reference file that sends the agent to a second reference file for the same step. agnix `AS-013`
  checks the depth of links from `SKILL.md`. A chain that starts in a reference file is yours. Claude may preview a
  nested file with `head -100` and miss the rest (Anthropic skill best practices).
- **A long reference with no map.** A reference file over 100 lines with no table of contents at its top.
- **An orphan.** A file in the skill directory that no file of the skill links to or runs. Nothing loads it.
- **Prose a script can run.** A fixed sequence of commands, a parse or a count that the agent does by hand on each
  run. A script does it at no context cost, and the body names the script and its output.
- **A script the agent must read.** A script with no usage in its first lines or in `--help`, or a pointer that
  does not say whether to run the script or read it.
- **Text said twice.** A rule or a procedure that two skills, or a skill and a memory file, both state. One file
  holds it and the other links to it.
- **A restated trigger.** A body that opens with the description again, or a "when to use" section. The body loads
  after the agent decided to use the skill.
- **Bloat.** Background the model knows (what TDD is, what a REST API is), the history of the skill, a paragraph of
  motivation, more than 5 examples, or an example that teaches nothing the others do not. Anthropic's skill best
  practices: "only add context Claude doesn't already have".
- **Two jobs.** A description that joins two unrelated jobs, whose branches share no step. Each job needs its own
  description to fire on its own prompts.

## Proof

Give the body tokens from `load.ts`. For a branch in the body, name the branch and the lines that only it needs.
For an orphan, give the search that finds no link. For text said twice, quote both. For bloat, quote the text and
say what the agent loses without it: nothing. Bloat with no other signal rates 3 at most.

## Fix

Move a branch to its own file, with a pointer that says when to open it. Add a table of contents. Flatten a chain
into one file one link from `SKILL.md`. Link an orphan or delete it. Replace hand-run prose with a script beside
the skill, and name its output in the body. Keep one copy of a repeated text and link the other. Delete bloat.
Split a skill with two jobs. Record the body tokens before and after.

## Hold

agnix `AS-012` and `AS-013` in `.githooks/pre-commit` hold the line limit and the link depth. The 5,000-token body,
orphans and chains are unchecked: only a retro finds them.

## Check

Does each new section load only on the branch that needs it? Does each new file have a pointer that says when to
open it, and does a script do each fixed sequence?
