# Compose

| File | Status |
|---|---|
| `langfuse.yml` | **Never brought up.** Authored against Langfuse's documented self-host requirements; not verified — the machine it was written on has no Docker daemon. |
| `daemon.yml` | **Never brought up.** Encodes the Phase 1 mount plan (design §10.3). The daemon has only been run directly via `bun src/daemon.ts`. |

What *has* been verified about observability is the daemon's OTLP export, against
a real local sink:

```bash
bun scripts/otlp-sink.ts 4318 /tmp/spans.jsonl    # in one terminal
ALEPH_CONFIG=... bun src/daemon.ts                # in another, obs.otlp_endpoint -> :4318
```

See `docs/RUNBOOK-phase1-slice.md` for the recorded output.

## Bringing Langfuse up (first run, unverified)

```bash
cp ../.env.example ../.env    # fill in: LANGFUSE_SALT, LANGFUSE_ENCRYPTION_KEY (64 hex),
                              # NEXTAUTH_SECRET, POSTGRES_PASSWORD, CLICKHOUSE_PASSWORD,
                              # MINIO_ROOT_PASSWORD, REDIS_AUTH
docker compose --env-file ../.env -f langfuse.yml up -d
# create a project in the UI at http://127.0.0.1:3010, then an API key pair, then:
#   LANGFUSE_OTLP_AUTH="Basic $(printf '%s:%s' "$PUBLIC_KEY" "$SECRET_KEY" | base64 -w0)"
#   LANGFUSE_PROJECT_ID=<project id from the URL>
```

Then point `obs.otlp_endpoint` at
`http://127.0.0.1:3010/api/public/otel/v1/traces` and run
`ALEPH_LIVE=1 bun test tests/live` to prove ingestion end to end.
