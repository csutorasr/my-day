#!/usr/bin/env bash
# Link the my-day skills into ~/.claude/skills and install the dashboard's optional web-push dependency.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
target="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
# Backups live outside the skills dir so old copies are not loaded as skills.
backup="$(dirname "$target")/my-day-backup-$(date +%Y%m%d%H%M%S)"
mkdir -p "$target"
for dir in "$here"/skills/*/; do
  name="$(basename "$dir")"
  dest="$target/$name"
  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -e "$dest" ]; then
    mkdir -p "$backup"
    mv "$dest" "$backup/"
    echo "backed up existing $name → $backup/$name"
  fi
  ln -s "${dir%/}" "$dest"
  echo "linked $name"
done
if command -v npm >/dev/null; then
  (cd "$here/skills/my-day-loop/server" && npm install --no-audit --no-fund --silent) && echo "installed web-push"
else
  echo "npm not found: dashboard works without web push"
fi
