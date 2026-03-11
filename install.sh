#!/usr/bin/env bash
set -euo pipefail

# Construct installer — deploys from repo to ~/.claude
# Preserves: ALL CAPS files in identity/ and memory/, plus MEMORY.md
# Overwrites: hooks, skills, meta, dev, commands, settings, CLAUDE.md

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${REPO_DIR}/.claude"
DST="$HOME/.claude"

# Temp dir for backups (outside rsync target so --delete can't touch them)
BACKUP_DIR=$(mktemp -d)
trap 'rm -rf "$BACKUP_DIR"' EXIT

# Static preserved paths (relative to construct/)
PRESERVE=(
  memory/signals/ratings.jsonl
  memory/sessions
  memory/snapshots
)

# Discover ALL CAPS .md data files in a directory (e.g. SOUL.md, LEARNED.md, custom user files)
# Matches filenames where the stem (minus .md) is entirely [A-Z_]+
# Excludes infrastructure files: README.md, INSTALL.md
INFRA_FILES="README.md INSTALL.md"
discover_allcaps_md() {
  local dir="$1"
  [[ -d "$dir" ]] || return
  find "$dir" -maxdepth 1 -name '[A-Z]*.md' -exec basename {} \; 2>/dev/null | while read -r f; do
    local name="${f%.md}"
    [[ "$name" =~ ^[A-Z_]+$ ]] || continue
    [[ " $INFRA_FILES " == *" $f "* ]] && continue
    echo "$f"
  done
}

echo "=== Construct Installer ==="
echo "src: ${SRC}"
echo "dst: ${DST}"
echo ""

# 1. Back up preserved files to temp dir
echo "backing up preserved files..."

for rel in "${PRESERVE[@]}"; do
  if [[ -e "${DST}/construct/${rel}" ]]; then
    mkdir -p "${BACKUP_DIR}/$(dirname "$rel")"
    cp -a "${DST}/construct/${rel}" "${BACKUP_DIR}/${rel}"
  fi
done

if [[ -f "${DST}/MEMORY.md" ]]; then
  cp -a "${DST}/MEMORY.md" "${BACKUP_DIR}/MEMORY.md"
fi

# Back up ALL CAPS .md files from identity/ and memory/
mkdir -p "${BACKUP_DIR}/core/identity" "${BACKUP_DIR}/memory"
for f in $(discover_allcaps_md "${DST}/construct/core/identity"); do
  cp -a "${DST}/construct/core/identity/${f}" "${BACKUP_DIR}/core/identity/${f}"
  echo "  preserved: core/identity/${f}"
done
for f in $(discover_allcaps_md "${DST}/construct/memory"); do
  cp -a "${DST}/construct/memory/${f}" "${BACKUP_DIR}/memory/${f}"
  echo "  preserved: memory/${f}"
done

# 2. Sync construct/ tree (delete stale files, overwrite everything)
echo "syncing construct/..."
mkdir -p "${DST}/construct"
rsync -a --delete "${SRC}/construct/" "${DST}/construct/"

# 3. Restore preserved files from temp dir
echo "restoring preserved files..."

for rel in "${PRESERVE[@]}"; do
  if [[ -e "${BACKUP_DIR}/${rel}" ]]; then
    mkdir -p "${DST}/construct/$(dirname "$rel")"
    cp -a "${BACKUP_DIR}/${rel}" "${DST}/construct/${rel}"
  fi
done

if [[ -f "${BACKUP_DIR}/MEMORY.md" ]]; then
  cp -a "${BACKUP_DIR}/MEMORY.md" "${DST}/MEMORY.md"
fi

# Restore ALL CAPS .md files
for f in "${BACKUP_DIR}/core/identity/"*.md; do
  [[ -f "$f" ]] || continue
  cp -a "$f" "${DST}/construct/core/identity/$(basename "$f")"
done
for f in "${BACKUP_DIR}/memory/"*.md; do
  [[ -f "$f" ]] || continue
  cp -a "$f" "${DST}/construct/memory/$(basename "$f")"
done

# 4. Sync commands (additive — don't delete user commands outside Construct)
echo "syncing commands..."
mkdir -p "${DST}/commands"
# track which commands come from Construct
repo_commands=()
for f in "${SRC}/commands/"*.md; do
  [[ -f "$f" ]] || continue
  name="$(basename "$f")"
  repo_commands+=("$name")
  cp "$f" "${DST}/commands/${name}"
done
echo "  installed: ${repo_commands[*]:-none}"

# 5. Merge settings.json — replace hooks + statusLine, preserve everything else
echo "merging settings.json..."
if command -v jq &>/dev/null; then
  # read hooks and statusLine from repo (with $HOME path fixup)
  repo_settings=$(cat "${SRC}/settings.json" \
    | sed "s|bun .claude/|bun \$HOME/.claude/|g" \
    | sed "s|bun construct/|bun \$HOME/.claude/construct/|g" \
    | sed "s|bash .claude/|bash \$HOME/.claude/|g" \
    | sed "s|bash construct/|bash \$HOME/.claude/construct/|g")

  if [[ -f "${DST}/settings.json" ]]; then
    # merge: take existing, override hooks + statusLine from repo
    jq -s '
      .[0] as $existing |
      .[1] as $repo |
      $existing * {hooks: $repo.hooks, statusLine: $repo.statusLine}
    ' "${DST}/settings.json" <(echo "$repo_settings") > "${DST}/settings.json.tmp"
    mv "${DST}/settings.json.tmp" "${DST}/settings.json"
  else
    echo "$repo_settings" | jq '.' > "${DST}/settings.json"
  fi
else
  echo "  WARN: jq not found, skipping settings.json merge"
  echo "  install jq or manually update ~/.claude/settings.json"
fi

# 6. Update CLAUDE.md — replace # Construct section, preserve user sections
echo "updating CLAUDE.md..."
construct_section="$(cat "${SRC}/CLAUDE.md")"

if [[ -f "${DST}/CLAUDE.md" ]]; then
  # check if there's already a # Construct section
  if grep -qn '^# Construct' "${DST}/CLAUDE.md"; then
    # find the line number of "# Construct"
    start=$(grep -n '^# Construct' "${DST}/CLAUDE.md" | head -1 | cut -d: -f1)
    # everything before # Construct is user content
    head -n $((start - 1)) "${DST}/CLAUDE.md" > "${DST}/CLAUDE.md.tmp"
    # append new Construct section
    echo "$construct_section" >> "${DST}/CLAUDE.md.tmp"
    mv "${DST}/CLAUDE.md.tmp" "${DST}/CLAUDE.md"
  else
    # no existing Construct section — append
    printf '\n' >> "${DST}/CLAUDE.md"
    echo "$construct_section" >> "${DST}/CLAUDE.md"
  fi
else
  echo "$construct_section" > "${DST}/CLAUDE.md"
fi

echo ""
echo "done. run /verify to check installation."
