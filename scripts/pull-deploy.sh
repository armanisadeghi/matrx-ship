#!/usr/bin/env bash
# ── Pull-based deploy for the Matrx Ship stacks on the /srv host ─────────────
#
# WHY: the ci-cd.yml "Deploy to Production" job reaches this host over inbound
# SSH, and GitHub runner IPs (shared Azure ranges) intermittently trip the
# host's fail2ban — the job failed on every push June 2–13 2026 and the
# Manager silently ran a 5-week-old build while the Versions page showed red.
# This script inverts the direction: the host polls GHCR itself (outbound
# HTTPS only) and deploys when an image digest actually changes.
#
# Semantics mirror the ci-cd.yml SSH script, with two upgrades:
#   * acts only on DIGEST CHANGE (safe to run every 2 min from systemd);
#   * the Manager swap is health-gated with automatic rollback — it is the
#     control plane, a bad image must not stay serving.
#
# Runs from /usr/local/bin (installed by scripts/systemd/install.sh), NOT from
# the repo checkout. Unlike matrx-sandbox's deploy, it never touches the git
# checkout — it deploys the images CI built. After editing this file, re-run
# scripts/systemd/install.sh to refresh the installed copy.
set -uo pipefail

REGISTRY="ghcr.io/armanisadeghi"
APPS_DIR="${SHIP_APPS_DIR:-/srv/apps}"
MANAGER_HEALTH_URL="${MANAGER_HEALTH_URL:-https://manager.dev.codematrx.com/health}"
LOCK_FILE="${SHIP_DEPLOY_LOCK_FILE:-/srv/apps/deploy-state/.ship-deploy.lock}"

log()  { echo "[ship-pull-deploy] $*"; }
fail() { echo "[ship-pull-deploy] ERROR: $*" >&2; exit 1; }

mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || true
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another ship deploy is already running — skipping this run"
  exit 0
fi

img_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || echo none; }

# Pull a GHCR image; echo "changed" when the pull moved the tag to a new id.
pull_if_changed() {
  local remote="$1"
  local before after
  before="$(img_id "$remote")"
  if ! docker pull -q "$remote" >/dev/null 2>&1; then
    log "WARNING: pull failed for $remote (GHCR down or rate-limited?) — skipping"
    echo "error"; return
  fi
  after="$(img_id "$remote")"
  [ "$before" != "$after" ] && echo "changed" || echo "same"
}

# ── 1. Check all three images ────────────────────────────────────────────────
SHIP_STATE="$(pull_if_changed "$REGISTRY/matrx-ship:latest")"
DEPLOY_STATE="$(pull_if_changed "$REGISTRY/matrx-ship-deploy:latest")"
MANAGER_STATE="$(pull_if_changed "$REGISTRY/matrx-ship-manager:latest")"

# Self-heal the local alias tags. Compose files reference matrx-ship*:latest
# (the local names); if an alias gets untagged (manual rmi, cleanup), every
# comparison against it breaks (Versions page showed "0/11 apps current" with
# ALL apps actually current, 2026-07-14) even though containers keep running.
# Cheap and idempotent: re-point missing aliases at the GHCR image we track.
for pair in "matrx-ship:latest" "matrx-ship-deploy:latest" "matrx-ship-manager:latest"; do
  if ! docker image inspect "$pair" >/dev/null 2>&1 && docker image inspect "$REGISTRY/$pair" >/dev/null 2>&1; then
    docker tag "$REGISTRY/$pair" "$pair"
    log "self-healed missing local tag $pair (re-pointed at $REGISTRY/$pair)"
  fi
done

if [ "$SHIP_STATE" != "changed" ] && [ "$DEPLOY_STATE" != "changed" ] && [ "$MANAGER_STATE" != "changed" ]; then
  # Quiet no-op — this runs every 2 minutes.
  exit 0
fi
log "image change detected: ship=$SHIP_STATE deploy=$DEPLOY_STATE manager=$MANAGER_STATE"

# ── 2. Retag changed images to the local names the compose files use ─────────
recreate_stacks_using() {
  local tag="$1"
  local d name
  for d in "$APPS_DIR"/*/; do
    name="${d%/}"; name="${name##*/}"
    [ -f "$d/docker-compose.yml" ] || continue
    if grep -q "image: *$tag" "$d/docker-compose.yml"; then
      log "recreating $name (uses $tag)"
      ( cd "$d" && docker compose up -d --force-recreate ) \
        || log "WARNING: recreate failed for $name"
    fi
  done
}

if [ "$SHIP_STATE" = "changed" ]; then
  docker tag matrx-ship:latest matrx-ship:rollback 2>/dev/null || true
  docker tag "$REGISTRY/matrx-ship:latest" matrx-ship:latest
  recreate_stacks_using "matrx-ship:latest"
fi

if [ "$DEPLOY_STATE" = "changed" ]; then
  docker tag matrx-ship-deploy:latest matrx-ship-deploy:rollback 2>/dev/null || true
  docker tag "$REGISTRY/matrx-ship-deploy:latest" matrx-ship-deploy:latest
  recreate_stacks_using "matrx-ship-deploy:latest"
fi

# ── 3. Manager last, health-gated with rollback ─────────────────────────────
if [ "$MANAGER_STATE" = "changed" ]; then
  docker tag matrx-ship-manager:latest matrx-ship-manager:rollback 2>/dev/null || true
  docker tag "$REGISTRY/matrx-ship-manager:latest" matrx-ship-manager:latest
  recreate_stacks_using "matrx-ship-manager:latest"
  log "waiting for Manager /health (up to 90s)…"
  ok=0
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 4 "$MANAGER_HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" != 1 ]; then
    log "MANAGER HEALTH CHECK FAILED — rolling back to the previous image"
    if docker image inspect matrx-ship-manager:rollback >/dev/null 2>&1; then
      docker tag matrx-ship-manager:rollback matrx-ship-manager:latest
      recreate_stacks_using "matrx-ship-manager:latest"
    fi
    fail "manager unhealthy after update — rolled back to last-known-good"
  fi
  log "Manager healthy ✓"
fi

log "ship pull-deploy complete"
