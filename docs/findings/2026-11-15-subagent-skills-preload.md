# Agent skills preload reaches subagents

One headless run on Claude Code 2.1.325. A subagent whose frontmatter names a skill under `skills:` is handed that skill's SKILL.md body at the start of its context, as text, before its first turn. It needs no tool and takes no action to get it.

## Fixture

`/tmp/aleph-2890-skills-probe`, a plain directory, not a git repo.

`.claude/skills/marker-probe/SKILL.md`:

```markdown
---
name: marker-probe
description: Holds the probe marker line used to check whether skill text reaches a subagent.
---

# Marker probe

The probe marker line is exactly: PROBE-MARKER-7F3A9C2E
```

`.claude/agents/marker-prober.md`:

```markdown
---
name: marker-prober
description: Quotes the probe marker line. Use it whenever a probe marker is asked for.
skills:
  - marker-probe
tools: []
---

You are the marker prober. Reply with the probe marker line, exactly as it appears in the skill text you were given.
```

The marker string `PROBE-MARKER-7F3A9C2E` appears nowhere but the SKILL.md body. The main thread runs with `--tools "Task"`, so its only tool is the Agent tool: asked to read the SKILL.md itself, it answered "the Read tool isn't available in this session". The subagent's `tools: []` leaves it with none at all — the API requests in its transcript carry no `tools` key. So the marker can only arrive as injected skill text.

## Command

```
cd /tmp/aleph-2890-skills-probe && claude -p --setting-sources project --tools "Task" --output-format json 'Use the Task tool to launch the marker-prober subagent. Tell it to quote its probe marker line. Then print the subagent answer verbatim on its own line.'
```

`--setting-sources project` keeps the user settings out, so no hooks run.

## Result

Result: loads

The final text was `PROBE-MARKER-7F3A9C2E` on its own line, and `subagent_stats` reported `"spawned":1` with `"by_type":{"marker-prober":1}`.

## How it arrived

The subagent's transcript opens with the SKILL.md body as a user message, before any assistant turn:

```
<command-message>marker-probe</command-message>
<command-name>marker-probe</command-name>
<skill-format>true</skill-format>

Base directory for this skill: /tmp/aleph-2890-skills-probe/.claude/skills/marker-probe

# Marker probe

The probe marker line is exactly: PROBE-MARKER-7F3A9C2E
```

The subagent then answered in a single turn with no tool call, so nothing was fetched at its request.

## Control

The same command against `marker-prober-noskill`, an agent with the same body, description and `tools: []` but no `skills:` field, answered:

> I don't have a probe marker line. No skill text was provided to me in this conversation — my context contains only the task instruction asking me to quote one, with no accompanying skill text or marker line to quote. I won't invent one.

So the `skills:` list is what delivers the text. Sharing the directory the skill lives in is not enough.

## Not measured

- Whether a `skills:` entry that names a missing skill fails loudly or is skipped.
- Whether the preloaded body is truncated for a long SKILL.md, and how much of it survives.
- Whether a subagent's preloaded skills also appear in its own `/skill-name` resolution, or only as injected text.
