#!/usr/bin/env bash
# publish-cli.sh — put the Ship CLI (cli/**) on OUR file host, where every project's installer reads it.
#
#   https://cdn.matrxserver.com/releases/matrx-ship/cli/install.sh     (curl -sL <url> | bash)
#   https://cdn.matrxserver.com/releases/matrx-ship/cli/migrate.sh
#   https://cdn.matrxserver.com/releases/matrx-ship/cli.json           (sha + time of the last publish)
#
# Why: the installer used to be fetched from raw.githubusercontent.com, which dies the moment ship's source
# becomes private (it moves into the private aidream monorepo, 2026-10-22). Same rule as the desktop
# updater (Arman, 2026-10-21): updates come from our own file host. The bucket is public-read; Cloudflare
# fronts it with a long edge TTL, so each publish purges its URLs (below) and is live within seconds.
#
# Runs from CI on every push to main that touches cli/ (.github/workflows/publish-cli.yml, OIDC role
# matrx-ship-gha-cli-publish), or by hand with AWS credentials that can write the prefix.
# Exit 0 only after the public URL serves exactly the bytes in cli/ (every file is checked).
set -euo pipefail
BUCKET="${MATRX_SHIP_CLI_BUCKET:-cdn.matrxserver.com}"
PREFIX="${MATRX_SHIP_CLI_PREFIX:-releases/matrx-ship}"
PUBLIC="${MATRX_SHIP_CLI_URL:-https://cdn.matrxserver.com/releases/matrx-ship}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="$root/cli"
[[ -f "$cli/install.sh" ]] || { echo "publish-cli: no cli/install.sh under $root" >&2; exit 2; }
sha="${GITHUB_SHA:-$(git -C "$root" rev-parse HEAD 2>/dev/null || echo unknown)}"
cache="public, max-age=60, must-revalidate"

type_of() {
  case "$1" in
    *.sh) echo "text/x-shellscript; charset=utf-8" ;;
    *.ts) echo "text/plain; charset=utf-8" ;;
    *.json|*.json.example) echo "application/json; charset=utf-8" ;;
    *.yml|*.yaml) echo "text/yaml; charset=utf-8" ;;
    *) echo "text/plain; charset=utf-8" ;;
  esac
}

files=()
while IFS= read -r f; do files+=("$f"); done < <(cd "$cli" && find . -type f ! -name '.DS_Store' | sed 's|^\./||' | sort)
for f in "${files[@]}"; do
  aws s3 cp "$cli/$f" "s3://$BUCKET/$PREFIX/cli/$f" --only-show-errors \
    --cache-control "$cache" --content-type "$(type_of "$f")"
done
printf '{"sha":"%s","published_at":"%s","files":%d}\n' "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${#files[@]}" |
  aws s3 cp - "s3://$BUCKET/$PREFIX/cli.json" --only-show-errors --cache-control "$cache" \
    --content-type "application/json; charset=utf-8"

# Cloudflare fronts the bucket with a long edge TTL (it overrides Cache-Control), so every published URL is
# purged. Needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID (zone matrxserver.com; same names as aidream/.env).
urls=("$PUBLIC/cli.json")
for f in "${files[@]}"; do urls+=("$PUBLIC/cli/$f"); done
purged=0
if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ZONE_ID:-}" ]]; then
  body="$(printf '%s\n' "${urls[@]}" | python3 -c 'import json,sys;print(json.dumps({"files":[l.strip() for l in sys.stdin if l.strip()]}))')"
  if curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
       -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" --data "$body" |
       grep -q '"success":true'; then
    purged=1
  else
    echo "publish-cli: Cloudflare purge FAILED: the edge may serve the previous CLI until its cache expires" >&2
  fi
else
  echo "publish-cli: WARNING no CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID: not purged, the edge may serve the previous CLI" >&2
fi

# Proof: the PUBLIC url serves exactly these bytes. After a purge the plain URL (what curl | bash reads) is
# checked, retrying while the purge propagates; without one the query string skips the cached copy.
bad=0
for f in "${files[@]}"; do
  want="$(shasum -a 256 < "$cli/$f" | cut -d' ' -f1)"
  url="$PUBLIC/cli/$f"; [[ $purged == 1 ]] || url="$url?v=$sha"
  got=""
  for _ in 1 2 3 4 5 6; do
    got="$(curl -fsSL "$url" | shasum -a 256 | cut -d' ' -f1)" || got="(fetch failed)"
    [[ "$want" == "$got" ]] && break
    sleep 5
  done
  [[ "$want" == "$got" ]] || { echo "publish-cli: MISMATCH $url ($got != $want)" >&2; bad=1; }
done
[[ $bad == 0 ]] || exit 1
echo "publish-cli: ${#files[@]} files live at $PUBLIC/cli/ (sha $sha, purged=$purged)"
