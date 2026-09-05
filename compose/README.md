# Compose

`langfuse.yml` runs Langfuse v3 on `127.0.0.1:3010`. Brought up and verified
2026-08-21 on `docker-ce 29.7.2` running *inside* WSL2 under systemd, not
Docker Desktop. Desktop works too if its WSL integration is enabled for the
distro, but the native engine needs no Windows GUI to start:

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
project id in trace links is known in advance. Confirm with:

```bash
curl -sS -u "$PK:$SK" http://127.0.0.1:3010/api/public/projects
# {"data":[{"id":"aleph-local","name":"aleph",...}]}
```

Then put the pair where the hooks read it, `~/.aleph/.env`:

```
LANGFUSE_BASE_URL=http://127.0.0.1:3010
LANGFUSE_PUBLIC_KEY=pk-lf-…
LANGFUSE_SECRET_KEY=sk-lf-…
```

and run `ALEPH_LIVE=1 bun test tests/live/langfuse.test.ts` to prove ingestion.

## Defects this file had, found by running it

1. **ClickHouse migrations used `ON CLUSTER`** and the single-node server has no
   ZooKeeper, so `langfuse-web` crash-looped on boot (`code: 139, There is no
   Zookeeper configuration in server config`). Fixed with
   `CLICKHOUSE_CLUSTER_ENABLED: "false"` on web *and* worker.
2. **`LANGFUSE_S3_EVENT_UPLOAD_REGION` was set on the web service but not the
   worker.** The AWS SDK threw `Region is missing`, the `otel-ingestion` job
   died, and the OTLP POST still returned **200**. Traces were accepted and
   never appeared. Anything that trusts the POST status as proof of ingestion
   is measuring the wrong thing; the live test fetches the trace back.
3. **MinIO does not create the bucket.** The directory backing it is now
   pre-created in the container's command.
