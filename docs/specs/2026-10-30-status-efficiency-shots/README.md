# Shots of the Status efficiency view (aleph-613)

## Setup

```sh
eval "$(bun ui/fixtures/review/build.ts /tmp/fx | sed 's/^/export /')" && bun ui/server.ts --port 3002
```

The build prints `ALEPH_JOBS_DIR`, `ALEPH_REPOS`, `ALEPH_ITEMS` and `ALEPH_VAULT`, which the server must export to read the fixture runs. Cause of aleph-609's empty "No agent run" view: the old setup line started the server without them, so `/api/speed?window=week` had no hours (reproduced 2026-10-30); with them, `landed` and `dropped` report 0.33 h each.
