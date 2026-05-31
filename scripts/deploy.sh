#!/usr/bin/env bash
# Full Cloudflare deployment for drop2.app Worker.
#
# Usage:
#   ./scripts/deploy.sh              # deploy to workers.dev
#   ./scripts/deploy.sh --domain drop2.app   # also attach custom domain
#   ./scripts/deploy.sh --local      # wrangler dev instead of deploy
#   ./scripts/deploy.sh --check      # verify health after deploy
#
# Requires: wrangler (logged in), node, npm, make, curl

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="$ROOT/worker"
WRANGLER="$WORKER/wrangler.jsonc"

D1_NAME="${DROP2_D1_NAME:-drop2-db}"
R2_NAME="${DROP2_R2_NAME:-drop2-stored}"
WORKER_NAME="${DROP2_WORKER_NAME:-drop2-worker}"
DOMAIN=""
MODE="deploy"
CHECK=false

usage() {
  sed -n '3,9p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="dev"; shift ;;
    --domain) DOMAIN="${2:?domain required after --domain}"; shift 2 ;;
    --check) CHECK=true; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 1 ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

need wrangler
need node
need npm
need make
need curl

echo "==> Checking Cloudflare auth"
wrangler whoami >/dev/null

ensure_d1() {
  local id
  id="$(wrangler d1 list --json | node -e "
    const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const row = rows.find((r) => r.name === process.argv[1]);
    if (row) process.stdout.write(row.uuid);
  " "$D1_NAME")"
  if [[ -z "$id" ]]; then
    echo "==> Creating D1 database: $D1_NAME"
    local out
    out="$(wrangler d1 create "$D1_NAME")"
    id="$(echo "$out" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  fi
  [[ -n "$id" ]] || { echo "failed to resolve D1 database id" >&2; exit 1; }
  echo "$id"
}

ensure_r2() {
  if wrangler r2 bucket list 2>/dev/null | grep -q "name: *${R2_NAME}$"; then
    echo "==> R2 bucket exists: $R2_NAME"
  else
    echo "==> Creating R2 bucket: $R2_NAME"
    wrangler r2 bucket create "$R2_NAME"
  fi
}

patch_wrangler() {
  local d1_id="$1"
  node - "$WRANGLER" "$d1_id" "$D1_NAME" "$R2_NAME" "$DOMAIN" <<'NODE'
const fs = require('fs');
const [, , file, d1Id, d1Name, r2Name, domain] = process.argv;
const raw = fs.readFileSync(file, 'utf8');
const cfg = JSON.parse(raw.replace(/^\uFEFF?/, ''));
cfg.d1_databases = [{ binding: 'DB', database_name: d1Name, database_id: d1Id, migrations_dir: 'migrations' }];
cfg.r2_buckets = [{ binding: 'STORED', bucket_name: r2Name }];
if (domain) {
  cfg.routes = [{ pattern: `${domain}/*`, zone_name: domain }];
}
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
NODE
  echo "==> Updated $WRANGLER (D1=$d1_id${DOMAIN:+, domain=$DOMAIN})"
}

build_assets() {
  echo "==> Building receiver assets"
  make -C "$ROOT" receiver
}

install_worker() {
  echo "==> Installing worker dependencies"
  npm install --prefix "$WORKER"
}

apply_migrations() {
  echo "==> Applying D1 migrations (remote)"
  wrangler d1 migrations apply "$D1_NAME" --remote --config "$WRANGLER"
}

deploy_worker() {
  echo "==> Deploying worker: $WORKER_NAME"
  local out
  if ! out="$(npm run deploy --prefix "$WORKER" 2>&1)"; then
    if [[ -n "$DOMAIN" ]]; then
      echo "$out"
      echo "==> Domain route failed; redeploying without custom domain"
      DOMAIN=""
      patch_wrangler "$D1_ID"
      out="$(npm run deploy --prefix "$WORKER" 2>&1)" || {
        echo "$out" >&2
        exit 1
      }
    else
      echo "$out" >&2
      exit 1
    fi
  fi
  echo "$out"
  DEPLOY_URL="$(echo "$out" | grep -Eo 'https://[a-zA-Z0-9._-]+\.workers\.dev' | tail -1 || true)"
}

dev_worker() {
  echo "==> Starting local dev server"
  exec npm run dev --prefix "$WORKER"
}

worker_url() {
  if [[ -n "${DEPLOY_URL:-}" ]]; then
    echo "$DEPLOY_URL"
  else
    echo "https://${WORKER_NAME}.workers.dev"
  fi
}

health_check() {
  local base="$1"
  echo "==> Health check: $base/api/v1/health"
  local body attempt
  for attempt in 1 2 3 4 5; do
    if body="$(curl -fsS "$base/api/v1/health" 2>/dev/null)"; then
      echo "    $body"
      echo "$body" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' || {
        echo "unexpected health response" >&2
        return 1
      }
      return 0
    fi
    echo "    attempt $attempt failed, retrying..."
    sleep 3
  done
  echo "health check failed after retries" >&2
  return 1
}

# --- main ---

D1_ID="$(ensure_d1)"
echo "==> D1 database: $D1_NAME ($D1_ID)"

ensure_r2
patch_wrangler "$D1_ID"
build_assets
install_worker

if [[ "$MODE" == "dev" ]]; then
  dev_worker
fi

apply_migrations
deploy_worker

BASE="$(worker_url)"
echo ""
echo "Deployed: $BASE"

if [[ -n "$DOMAIN" ]]; then
  BASE="https://$DOMAIN"
  echo "Custom domain route: $BASE"
fi

if $CHECK || [[ -n "$DOMAIN" ]] || [[ -n "${DEPLOY_URL:-}" ]]; then
  health_check "$BASE"
fi

echo ""
echo "Next steps:"
echo "  export DROP2_API_URL=$BASE"
echo "  drop2 test.zip"
if [[ -z "$DOMAIN" ]]; then
  echo "  ./scripts/deploy.sh --domain drop2.app   # when DNS is on Cloudflare"
fi
