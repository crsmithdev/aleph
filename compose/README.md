# Run Langfuse on Docker in WSL2

`langfuse.yml` runs Langfuse v3 on `127.0.0.1:3010`. It runs on Docker Engine
inside WSL2 under systemd, not Docker Desktop. Desktop works too if its WSL
integration is enabled for the distro, but the native engine needs no Windows
GUI to start:

```bash
sudo systemctl enable --now docker
```

## Bringing Langfuse up

[Langfuse](../docs/langfuse.md#set-it-up) has the steps. Run them from the repo root, so that `-p aleph-langfuse` names one stack.

To check the project that the `LANGFUSE_INIT_*` block creates, call the API with the key pair:

```bash
curl -sS -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" http://127.0.0.1:3010/api/public/projects
# {"data":[{"id":"aleph-local","name":"aleph",...}]}
```

A 200 from the OTLP POST does not prove ingestion, so `tests/live/langfuse.test.ts` fetches the trace back. The comments in `langfuse.yml` give the reason for each setting that running the stack showed it needs.
