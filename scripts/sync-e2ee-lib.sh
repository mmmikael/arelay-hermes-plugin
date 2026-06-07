#!/usr/bin/env bash
# Copy canonical e2ee.mjs from arelay-skills into this plugin repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_ROOT="${ARELAY_SKILLS_ROOT:-$ROOT/../arelay-skills}"
CANONICAL="$SKILLS_ROOT/skills/agent-relay/scripts/lib/e2ee.mjs"
DEST="$ROOT/lib/e2ee.mjs"

if [[ ! -f "$CANONICAL" ]]; then
	echo "error: canonical lib not found at $CANONICAL" >&2
	echo "clone arelay-skills as a sibling or set ARELAY_SKILLS_ROOT" >&2
	exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$CANONICAL" "$DEST"
echo "Synced $DEST"
