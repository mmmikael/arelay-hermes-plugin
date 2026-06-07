#!/usr/bin/env bash
# Fail if vendored e2ee.mjs drifted from arelay-skills canonical copy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_ROOT="${ARELAY_SKILLS_ROOT:-$ROOT/../arelay-skills}"
CANONICAL="$SKILLS_ROOT/skills/agent-relay/scripts/lib/e2ee.mjs"
VENDORED="$ROOT/lib/e2ee.mjs"

if [[ ! -f "$CANONICAL" ]]; then
	echo "error: canonical lib not found at $CANONICAL" >&2
	echo "clone arelay-skills as a sibling or set ARELAY_SKILLS_ROOT" >&2
	exit 1
fi

if ! diff -q "$CANONICAL" "$VENDORED" >/dev/null; then
	echo "error: lib/e2ee.mjs is out of sync with arelay-skills" >&2
	echo "run: ./scripts/sync-e2ee-lib.sh" >&2
	exit 1
fi

echo "e2ee.mjs copy matches"
