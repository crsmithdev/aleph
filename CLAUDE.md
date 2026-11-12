# Aleph

Read [PRINCIPLES.md](PRINCIPLES.md) before a design, review or code change. Its rules win over habit.

## Testing

- Reproduce intermittent failures under the original parallel load before claiming a fix, and report the observed pass rate from that run.

## Docs

- Don't land doc changes that reference a CLI flag until the code that adds that flag is on main.

## UI

- Keep UI text terse: `empty()` for no data, notes of one or two words. See `docs/design.md`, Principles 5 and 6.
