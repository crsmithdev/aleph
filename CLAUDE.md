# Aleph

## Testing

- Reproduce intermittent failures under the original parallel load before claiming a fix, and report the observed pass rate from that run.

## Verification

- Verify the UI-restart claim by listing changed paths (`git show --name-only <sha>` or `git diff --name-only <base> <head>`) before asserting no restart is needed. A diff stat without file names does not show whether `ui/` changed.

## Docs

- Don't land doc changes that reference a CLI flag until the code that adds that flag is on main.
