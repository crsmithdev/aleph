# Docker Spec

What running Construct entirely in Docker would look like.

## Scope

Claude Code itself runs on the host (it's a CLI requiring interactive TTY and host filesystem access). Everything else is containerizable:

| Service | Current | Containerized |
|---|---|---|
| API (Fastify/Bun) | host process, port 3002 | `api` container |
| UI (Vite dev / Nginx prod) | host process, port 5174 | `ui` container |
| Ollama | already Docker, port 11435 | `ollama` container (unchanged) |
| MCP server (`goal-tracker`) | stdio subprocess of Claude Code | host-side, unchanged |
| SQLite databases | `~/.construct/*.db` | named volume |
| Sessions / signals / memory | `~/.construct/` | named volume |

The MCP server communicates over stdio as a Claude Code subprocess. It cannot move into a container without switching from stdio to a TCP/HTTP transport — that's a separate project.

---

## Compose layout

```
construct/
├── docker-compose.yml          # dev: all services + hot reload
├── docker-compose.prod.yml     # prod: built UI, no hot reload
├── docker/
│   ├── api/
│   │   └── Dockerfile
│   └── ui/
│       ├── Dockerfile.dev      # Vite dev server
│       └── Dockerfile.prod     # Nginx + built assets
```

---

## Services

### `api`

- **Base image**: `oven/bun:1-alpine`
- **Port**: 3002
- **Workdir**: `/app`
- **Mount**: `construct-data:/data` → maps to `CONSTRUCT_DATA_ROOT=/data`
- **Source mount** (dev only): `./src:/app/src:ro` for live reload via `bun --watch`
- **Env**:
  - `DATABASE_URL=/data/construct.db`
  - `CONSTRUCT_DATA_ROOT=/data`
  - `PORT=3002`
  - `ANTHROPIC_API_KEY` (from host env or `.env`)
  - `OLLAMA_BASE_URL=http://ollama:11435`
  - `OLLAMA_MODEL`
- **Health check**: `GET /api/health` (add this endpoint if missing)
- **Depends on**: `ollama` (optional)

```dockerfile
# docker/api/Dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY src/package.json src/bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ ./
CMD ["bun", "run", "server.ts"]
```

### `ui`

**Dev** (`Dockerfile.dev`):
- **Base image**: `node:22-alpine`
- **Port**: 5174
- **Source mount**: `./src/ui:/app:delegated`
- **Command**: `npm run dev -- --host 0.0.0.0`
- **Env**: `VITE_API_URL=http://api:3002` (or `http://localhost:3002` for browser access)

**Prod** (`Dockerfile.prod`):
- Multi-stage: `node:22-alpine` build → `nginx:alpine` serve
- `npm run build` at image build time
- Nginx serves `/dist` at port 80, proxies `/api` to `api:3002`

**The Vite proxy problem**: In dev, Vite proxies `/api` to `localhost:3002`. In Docker the browser talks to `localhost:5174` but the API is at `api:3002` (Docker internal hostname). Two options:
1. Use host networking for dev (`network_mode: host`) — simplest, matches current behavior
2. Expose API on `localhost:3002` via port mapping and keep Vite proxy config unchanged — also simple, preferred

Option 2 is cleaner. Map `api` container port 3002 to host port 3002. Vite proxy config (`vite.config.ts`) needs no changes.

### `ollama`

Unchanged from `src/research/docker-compose.yml`:

```yaml
ollama:
  image: ollama/ollama:latest
  ports:
    - "11435:11434"
  volumes:
    - ollama-models:/root/.ollama
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

---

## Volumes

```yaml
volumes:
  construct-data:
    # Persists ~/.construct/ equivalent:
    # construct.db, sqlite_vec.db, db-backups/, sessions/, signals/, memory/
  ollama-models:
    external: true  # already exists: tagger_ollama-models
```

**Migration concern**: existing data lives in `~/.construct/`. First-run init script needed to copy existing DB files into the `construct-data` volume before starting. Without this, the container starts with an empty database.

```bash
# one-time migration (run before first `docker compose up`)
docker run --rm \
  -v ~/.construct:/src:ro \
  -v construct-data:/data \
  alpine sh -c "cp -r /src/. /data/"
```

---

## dev compose

```yaml
# docker-compose.yml
services:
  api:
    build: { context: ., dockerfile: docker/api/Dockerfile }
    ports: ["3002:3002"]
    volumes:
      - construct-data:/data
      - ./src:/app/src:ro        # live reload
    env_file: .env
    environment:
      DATABASE_URL: /data/construct.db
      CONSTRUCT_DATA_ROOT: /data
      OLLAMA_BASE_URL: http://ollama:11435

  ui:
    build: { context: ./src/ui, dockerfile: ../../docker/ui/Dockerfile.dev }
    ports: ["5174:5174"]
    volumes:
      - ./src/ui:/app:delegated  # hot module reload
    depends_on: [api]

  ollama:
    image: ollama/ollama:latest
    ports: ["11435:11434"]
    volumes:
      - ollama-models:/root/.ollama

volumes:
  construct-data:
  ollama-models:
    external: true
```

---

## prod compose

```yaml
# docker-compose.prod.yml
services:
  api:
    build: { context: ., dockerfile: docker/api/Dockerfile }
    ports: ["3002:3002"]
    volumes:
      - construct-data:/data
    env_file: .env
    environment:
      DATABASE_URL: /data/construct.db
      CONSTRUCT_DATA_ROOT: /data
      NODE_ENV: production
    restart: unless-stopped

  ui:
    build:
      context: ./src/ui
      dockerfile: ../../docker/ui/Dockerfile.prod
    ports: ["80:80", "443:443"]   # Nginx
    depends_on: [api]
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    ports: ["11435:11434"]
    volumes:
      - ollama-models:/root/.ollama
    restart: unless-stopped

volumes:
  construct-data:
  ollama-models:
    external: true
```

---

## Claude Code integration

Claude Code runs on the host and continues to work unchanged. The only adjustment is pointing MCP server config and hook scripts at `localhost:3002` (same as today — the port mapping makes this transparent).

The `goal-tracker` MCP server (`src/goals/mcp/src/index.ts`) runs as a Claude Code subprocess on the host. It reads `DATABASE_URL` from env. Two options:

1. **Shared DB file** (simplest): Mount `construct-data` volume to host via `docker cp` or bind mount, point `DATABASE_URL` to the host path. Fragile.
2. **HTTP transport** (correct): Expose a thin REST or MCP-over-HTTP endpoint from the `api` container. The host-side MCP server becomes a thin HTTP proxy. This is a real protocol change.

For now, option 1 with a host bind mount at `~/.construct/` works for the initial Docker migration. The `api` container writes to `/data/construct.db`, the MCP server reads from `~/.construct/construct.db`, and they're the same file via bind mount:

```yaml
api:
  volumes:
    - ~/.construct:/data   # bind mount instead of named volume
```

This preserves existing Claude Code behavior with zero MCP changes.

---

## Open issues

| Issue | Severity | Notes |
|---|---|---|
| MCP server stays on host, shares DB via bind mount | Medium | Works but defeats isolation; long-term fix is HTTP transport |
| First-run data migration | Medium | Need one-shot copy script or documented manual step |
| `bun --watch` inside container file events | Low | inotify works on Linux; may need polling on macOS Docker |
| Vite HMR WebSocket through Docker | Low | `--host 0.0.0.0` fixes it; verify `server.hmr.host` in vite.config |
| SQLite WAL mode + Docker volume | Low | WAL files (`-wal`, `-shm`) need to stay on same filesystem as DB — volume mount handles this |
| GPU passthrough for Ollama | Low | Already handled in existing compose; NVIDIA runtime required |
| Secrets management | Low | `.env` file works for local; use Docker secrets for any remote deployment |
