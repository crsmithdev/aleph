---
name: to-spec
description: >
  Turn the current conversation into a development spec: no interview, just
  synthesis of what has already been decided, typically right after
  /aleph:grill-me. Writes a markdown file. Use when the user says "write the
  spec", "turn this into a spec", "/to-spec". NOT for: gathering
  requirements (use /aleph:grill-me first) or breaking work into tickets.
---

Take the current conversation context and codebase understanding and produce a spec. Do NOT interview the user; synthesize what you already know. If a decision the spec needs was never made, list it under Open Questions rather than inventing an answer.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's own vocabulary throughout the spec, and respect any ADRs or design docs in the area you're touching.

2. Sketch the seams at which the feature will be tested. Prefer existing seams to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better; the ideal number is one.

   Check with the user that these seams match their expectations. This is the one question this skill asks.

3. Write the spec using the template below to `docs/specs/<YYYY-MM-DD>-<slug>.md` in the target repo, or wherever the user named. Print the path.

4. Self-review before handing over: no placeholders ("TBD", "handle edge cases", "add validation"), no contradictions between decisions, every acceptance criterion checkable by a command or an observation rather than by the implementer's say-so.

<spec-template>

# <Feature name>

## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution, from the user's perspective.

## User Stories

A LONG, numbered list. Each in the form:

1. As an <actor>, I want <feature>, so that <benefit>

Extremely extensive; cover every aspect of the feature.

## Acceptance Criteria

One or more per user story, numbered to match. Each must be falsifiable: a concrete trigger, a concrete observable result. Prefer the EARS forms:

- WHEN <trigger> THE system SHALL <response>
- IF <condition> THEN THE system SHALL <response>
- WHILE <state> THE system SHALL <response>

"Handles errors properly" is not a criterion. "WHEN the token is expired THE API SHALL return 401 with body `{error: "expired"}`" is.

## Implementation Decisions

Decisions made during discussion:

- Modules to be built or modified, and their interfaces
- Architectural decisions and the alternatives rejected
- Schema changes
- API contracts
- Specific interactions

Do NOT include file paths or code snippets; they go stale. Exception: a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape). Trim to the decision-rich part.

## Testing Decisions

- What makes a good test here (external behaviour only, not implementation details)
- Which seams are tested
- Prior art: similar tests already in the codebase

## Out of Scope

Explicitly excluded work, so nobody re-opens it mid-implementation.

## Open Questions

Decisions deferred during the interview, with a note on what unblocks each.

## Further Notes

</spec-template>

Adapted from Matt Pocock's `to-spec` skill (github.com/mattpocock/skills), with the issue-tracker publishing removed and falsifiable acceptance criteria added.
