#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/worker"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler not found; install with: npm install -g wrangler" >&2
  exit 1
fi

echo "Building receiver assets..."
make -C "$ROOT" receiver

echo "Installing worker dependencies..."
npm install

if [[ "${1:-}" == "--local" ]]; then
  echo "Starting local dev server..."
  exec npm run dev
fi

echo "Applying D1 migrations (remote)..."
wrangler d1 migrations apply shr-db --remote

echo "Deploying worker..."
npm run deploy

echo "Done. Verify with:"
echo "  curl -s \"\${SHR_API_URL:-https://shr.rip}/api/v1/health\""
