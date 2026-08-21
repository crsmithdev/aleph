# The daemon image. Bun, plus git — `VaultWriter` commits, so git is a runtime
# dependency of the vault write path, not a build-time convenience.
#
# Nothing here installs a shell tool for the agent: the Phase 1 agent has no
# tools and no egress (design §13), and the image should not quietly widen that.
FROM oven/bun:1-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so source edits do not invalidate the install layer.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json bunfig.toml ./
COPY src ./src
COPY scripts ./scripts

# The named data volume inherits the mode of the image path it covers. If
# /app/data does not exist here, Docker creates it root-owned and the daemon —
# which is deliberately not root — cannot open the SQLite file at all. The mode
# is wide because the runtime uid is the host's, chosen at `up` time to match the
# bind-mounted vault; nothing else shares this volume.
RUN mkdir -p /app/data && chmod 0777 /app/data

# uid 1000 in the base image. The Agent SDK refuses bypassPermissions as root,
# and read-only vault mounts mean nothing to a process that can remount them.
USER bun

CMD ["bun", "src/daemon.ts"]
