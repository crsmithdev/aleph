# Compose

| File | Status |
|---|---|
| `langfuse.yml` | **Brought up and verified 2026-08-21.** The stack boots, the daemon's spans are ingested, and `tests/live/langfuse.test.ts` passes against it. |
| `daemon.yml` | **Never brought up.** Encodes the Phase 1 mount plan (design §10.3). The daemon has only been run directly via `bun src/daemon.ts`. |

Verified on `docker-ce 29.7.2` running *inside* WSL2 under systemd — not Docker
Desktop. Desktop works too if its WSL integration is enabled for the distro, but
the native engine is what these instructions assume, because it needs no Windows
GUI to start:

```bash
sudo systemctl enable --now docker
```

## Bringing Langfuse up

```bash
cp ../.env.example ../.env    # fill in: LANGFUSE_SALT, LANGFUSE_ENCRYPTION_KEY (64 hex),
                              # NEXTAUTH_SECRET, POSTGRES_PASSWORD, CLICKHOUSE_PASSWORD,
                              # MINIO_ROOT_PASSWORD, REDIS_AUTH, and the LANGFUSE_INIT_* block
docker compose --env-file ../.env -f langfuse.yml up -d
curl -sS http://127.0.0.1:3010/api/public/health          # {"status":"OK","version":"3.225.4"}
```

The `LANGFUSE_INIT_*` variables create the org, the project, the first user and
the API key pair **on boot**, so no clicking through the UI is required and the
project id in `os trace` deep links is known in advance. Confirm with:

```bash
curl -sS -u "$PK:$SK" http://127.0.0.1:3010/api/public/projects
# {"data":[{"id":"aleph-next-local","name":"aleph-next",...}]}
```

Then point `obs.otlp_endpoint` at
`http://127.0.0.1:3010/api/public/otel/v1/traces`, set

```bash
LANGFUSE_OTLP_AUTH="Basic $(printf '%s:%s' "$PK" "$SK" | base64 -w0)"   # quotes matter
LANGFUSE_PROJECT_ID=aleph-next-local
```

and run `ALEPH_LIVE=1 bun test tests/live/langfuse.test.ts` to prove ingestion.

## Defects this file had, found by running it

1. **ClickHouse migrations used `ON CLUSTER`** and the single-node server has no
   ZooKeeper, so `langfuse-web` crash-looped on boot (`code: 139, There is no
   Zookeeper configuration in server config`). Fixed with
   `CLICKHOUSE_CLUSTER_ENABLED: "false"` on web *and* worker.
2. **`LANGFUSE_S3_EVENT_UPLOAD_REGION` was set on the web service but not the
   worker.** The AWS SDK threw `Region is missing`, the `otel-ingestion` job
   died, and — the part that makes this nasty — the OTLP POST still returned
   **200**. Traces were accepted and never appeared. Anything that trusts the
   POST status as proof of ingestion is measuring the wrong thing.
3. **MinIO does not create the bucket.** The directory backing it is now
   pre-created in the container's command.

A fourth defect was in `.env`, not here, and has the same shape as (2): an
unquoted `LANGFUSE_OTLP_AUTH=Basic <b64>` is truncated to `Basic` by `set -a; .
.env`, the exporter sends a header that fails auth, and the only symptom is one
`obs.export_failed` event with `error: "Unauthorized"` while the daemon keeps
serving turns normally. Quote it.
