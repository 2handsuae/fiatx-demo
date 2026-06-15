#!/usr/bin/env bash
# Branch-safe reset entry point.
# Three independent gates must all pass before delegating to reset-stack.sh:
#   1. git HEAD branch must be `branch`
#   2. cwd must look like the branch worktree (contains `.wt/branch`)
#   3. .env DATABASE_URL must point to the branch SQLite file
# Together these make it impossible for a misfire (wrong worktree, wrong
# branch, wrong env) to silently reset another stack — `npm run dev:reset`
# already had that cross-stack bug (delegates to reset-main); this wrapper
# is the safe complement for branch.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Gate 1: current git branch
current_branch="$(git -C "${APP_DIR}" symbolic-ref --short HEAD 2>/dev/null || echo "")"
if [[ "${current_branch}" != "branch" ]]; then
  echo "[reset-branch] refuse: git HEAD is '${current_branch}', expected 'branch'." >&2
  exit 2
fi

# Gate 2: worktree path
if [[ "${APP_DIR}" != *".wt/branch"* ]]; then
  echo "[reset-branch] refuse: app dir '${APP_DIR}' is not a branch worktree (no .wt/branch in path)." >&2
  exit 2
fi

# Gate 3: .env DATABASE_URL — branch SQLite file
if ! grep -qE '^DATABASE_URL="?file:/tmp/exchange_js_branch/dev\.db"?' "${APP_DIR}/.env" 2>/dev/null; then
  echo "[reset-branch] refuse: .env DATABASE_URL is not the branch DB (/tmp/exchange_js_branch/dev.db)." >&2
  exit 2
fi

echo "[reset-branch] gates passed — delegating to reset-stack.sh branch"
exec bash "${SCRIPT_DIR}/reset-stack.sh" branch
