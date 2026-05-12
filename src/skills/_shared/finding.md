# Finding Contract — SARIF v2.1.0 + Construct Properties

All audit-flavor leaf skills emit findings in **SARIF v2.1.0** (OASIS standard). The omnibus orchestrator reads SARIF runs from each leaf, merges them, deduplicates, and presents a phased report.

This file is the authoritative contract. Leaf skills reference it directly; do not duplicate the schema elsewhere.

## Why SARIF

- **Industry standard.** OASIS-approved interchange format for static-analysis output, widely supported across SAST tooling.
- **Multi-tool aggregation by design.** A single SARIF log can describe multiple "runs" from different tools — exactly what the omnibus needs.
- **Tool-agnostic consumers.** Findings written this way can be consumed by any SARIF-aware tool, not just the omnibus.

We do not invent a custom JSON shape. We extend SARIF via its `properties` mechanism for the few Construct-specific fields (confidence, severity-tier, fix, tag).

## Minimal SARIF run

Every audit leaf emits one SARIF run per invocation. Minimal shape:

```json
{
  "version": "2.1.0",
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "code-audit",
          "version": "1.0.0",
          "informationUri": "https://github.com/crsmithdev/Construct/blob/main/src/skills/code-audit/SKILL.md"
        }
      },
      "results": [
        {
          "ruleId": "code/RULES.md#A.2-secrets",
          "level": "error",
          "message": { "text": "Hardcoded API key in source." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "src/foo.ts" },
                "region": { "startLine": 42, "endLine": 42 }
              }
            }
          ],
          "properties": {
            "confidence": 92,
            "severity": "blocking",
            "fix": "Load from env via getEnv('KEY').",
            "tag": "secret",
            "scope": "diff"
          }
        }
      ]
    }
  ]
}
```

## Required fields

Every result MUST contain:

| Field | SARIF location | Meaning |
|---|---|---|
| `ruleId` | top-level on `result` | A citation of the form `<domain>/RULES.md#<section>` so the rule is machine-locatable. |
| `level` | top-level on `result` | SARIF severity: `error` / `warning` / `note` / `none`. Map from our 6-tier `severity` (see below). |
| `message.text` | `result.message` | Concise human-readable description (one sentence preferred). |
| `locations[0].physicalLocation` | required for code findings | `artifactLocation.uri` and `region.startLine`/`endLine` at minimum. |
| `properties.confidence` | extension | 0-100 integer. Set by the validation-pass subagent, not the audit leaf. |
| `properties.severity` | extension | One of: `blocking`, `important`, `nit`, `suggestion`, `learning`, `praise`. See below. |

## Recommended fields

| Field | Meaning |
|---|---|
| `properties.fix` | Concrete proposed change. If a short patch fits in a few lines, include it; otherwise describe. |
| `properties.tag` | One-word routing hint for the omnibus: `secret`, `slop`, `drift`, `dead-output`, `peer-drift`, `c7score`, `injection`, `xss`, `auth`, etc. |
| `properties.scope` | `diff` / `module` / `all` — which scope mode produced the finding. |
| `relatedLocations` | Other lines/files relevant to the finding (e.g., the canonical helper a duplicate should consolidate onto). |
| `fixes[]` | SARIF's native fix block — preferred over `properties.fix` when the fix is a precise textual replacement and you want IDE-applicable suggestions. |

## Severity tiers (Construct extension)

The 6-tier severity in `properties.severity` is lifted from `awesome-skills/code-review-skill`:

| Tier | When | SARIF `level` mapping |
|---|---|---|
| `blocking` | Compile/parse failure, certain wrong-result logic, exploitable vulnerability | `error` |
| `important` | Real bug or rule violation that should be fixed before merge | `error` |
| `nit` | Style/cosmetic; ignore unless cleaning a file already being edited | `note` |
| `suggestion` | Alternative worth considering | `note` |
| `learning` | Teaching note; code is fine but pattern worth knowing | `note` |
| `praise` | Code is notably well done; surface it explicitly | `none` |

The `praise` tier is intentional. Positive reinforcement is the most-skipped review behavior in AI workflows. Each audit run should aim for at least one `praise` finding when warranted.

## Confidence (Construct extension)

`properties.confidence` is an integer 0-100. Set by the **validation-pass subagent** that runs between the audit leaf and the omnibus merge step — not by the audit leaf itself.

| Score | Read |
|---|---|
| 0 | Not confident; likely false positive |
| 25 | Somewhat confident; might be real |
| 50 | Moderately confident; real but minor |
| 75 | Highly confident; real and important |
| 100 | Absolutely certain |

The omnibus filters findings below the threshold (default 80, configurable via `omnibus.yml` or `--threshold`).

## Negative-filter list (uniform across all audit leaves)

Lifted from Anthropic's official `code-review` plugin. Leaves MUST NOT emit findings for:

- Code style or quality concerns (unless explicitly required by `RULES.md`)
- Potential issues depending on inputs/state outside the audit scope
- Subjective suggestions presented as bugs (use `severity: suggestion` if proposing alternatives)
- Pre-existing issues outside the audit window (record separately in a "Pre-existing Issues" SARIF run if relevant)
- Pedantic nitpicks
- Issues a linter would catch (cite agnix / eslint / etc. in `ruleId` and mark `severity: nit` if including at all)
- Issues silenced by lint-ignore comments

These exclusions exist to keep signal-to-noise high. The validation pass enforces them with a second look; leaves should self-enforce as the first line.

## ruleId conventions

Format: `<domain>/RULES.md#<section-anchor>` — for example:

- `code/RULES.md#A.2-secrets`
- `design/RULES.md#L-state-coverage`
- `docs/RULES.md#E-drift`
- `security/RULES.md#injection-sql`

The section anchor is the markdown heading slug from the corresponding `RULES.md`. Tooling can deep-link from finding → rule.

For findings sourced from agnix or other external linters, prefix with the tool name: `agnix/CC-SK-12`, `eslint/no-explicit-any`. These are passthrough citations; the omnibus may suppress them per the negative-filter list above.

## relatedLocations

Use `relatedLocations` for cross-file context. Critical for the consolidation / drift / dead-output finding classes:

```json
{
  "ruleId": "code/RULES.md#C-duplication",
  "message": { "text": "Inline `name.slice(5).split('__')` — duplicate of canonical helper." },
  "locations": [
    {
      "physicalLocation": {
        "artifactLocation": { "uri": "src/research/engine/runner.ts" },
        "region": { "startLine": 128, "endLine": 128 }
      }
    }
  ],
  "relatedLocations": [
    {
      "physicalLocation": {
        "artifactLocation": { "uri": "src/ui/web/src/utils/format.ts" },
        "region": { "startLine": 14, "endLine": 22 }
      },
      "message": { "text": "Canonical helper to consolidate onto." }
    }
  ],
  "properties": {
    "confidence": 91,
    "severity": "important",
    "fix": "Replace inline parse with `import { fmtToolName } from '~/ui/web/src/utils/format'`; call it.",
    "tag": "drift"
  }
}
```

## How the omnibus consumes this

1. Each leaf writes its SARIF run to a per-leaf temp file (or returns it inline).
2. Omnibus combines all runs into one SARIF log (multi-run is native to SARIF).
3. Validation pass reads each result, assigns `properties.confidence`.
4. Dedupe on `(artifactLocation.uri, region.startLine, ruleId)`.
5. Filter by `properties.confidence >= threshold`.
6. Group by `properties.severity` for the phased report.

## Versioning

This contract is at version 1. When fields change incompatibly, bump `version: 1` in `omnibus.yml` and migrate consumers.

## References

- [SARIF v2.1.0 specification (OASIS)](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
- Anthropic `code-review` plugin design (confidence scoring, negative-filter list): `https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md`
- `awesome-skills/code-review-skill` (6-tier severity): `https://github.com/awesome-skills/code-review-skill`
