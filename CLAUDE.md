# Aleph

Read [PRINCIPLES.md](PRINCIPLES.md) before a design, review or code change. Its rules win over habit.

## Testing

- Reproduce intermittent failures under the original parallel load before claiming a fix, and report the observed pass rate from that run.

## Docs

- Don't land doc changes that reference a CLI flag until the code that adds that flag is on main.

## UI

- Be terse. An empty state is `empty()`, which shows `No data`. A note or caption is one or two words. Do not fill a space because it is there, and do not explain what a title or a tooltip already says. See `docs/design.md`, Principles 5 and 6.
