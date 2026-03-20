# Construct: docs-review

## Scope

| Document | Truth source |
|----------|-------------|
| README.md | Actual directory layout, hook registrations, slash commands |
| INSTALL.md | Actual installer behavior, preserved files, prerequisites |
| Module README.md | Actual module contents and hook behavior |
| Module INSTALL.md | Actual verification results (run the checks) |
| SPEC.md | Actual hooks, commands, skills, behavior |
| CLAUDE.md | Actual behavior (are rules followed? do referenced files exist?) |
| Skill SKILL.md | Actual skill-rules.json keywords, skill directory contents |

## Additional checks

### Spec completeness
1. Every hook registered in `settings.json` is documented in the Hook Registration table
2. Every slash subcommand in `construct.md` is documented
3. Every skill in `skill-rules.json` is documented
4. Every module detection file listed matches reality
5. Flag any behavior described in SPEC.md that has no corresponding implementation
