#!/bin/bash
set -a; source /root/.coolify-token; set +a
U=w8k0wscowgwkc8kwswo48cgw
BASE=https://dev.app.matrxserver.com
deadline=$(( $(date +%s) + 3600 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  st=$(docker exec coolify-db psql -U coolify -d coolify -t -c \
    "SELECT status FROM application_deployment_queues WHERE application_id='5' ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | tr -d ' \n')
  h=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health/ready" 2>/dev/null)
  echo "$(date -u +%H:%M:%S) deploy=$st health=$h"
  if [ "$st" = "finished" ] && [ "$h" = "200" ]; then
    echo "=== dev up; verifying dev-login endpoint ==="
    # endpoint should be MOUNTED (not 404); without the secret header expect 401/422, never 404
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/dev/login-as" \
      -H "Content-Type: application/json" -d '{"user_id":"87a6e699-3622-4869-8843-d0867456c0dd"}')
    echo "login-as WITHOUT secret -> $code (404=not mounted BAD; 401/403/422=mounted good)"
    ok=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/dev/login-as" \
      -H "Content-Type: application/json" -H "X-Dev-Login-Secret: ${DEV_LOGIN_SECRET:?set DEV_LOGIN_SECRET in the environment}" \
      -d '{"user_id":"87a6e699-3622-4869-8843-d0867456c0dd"}')
    echo "login-as WITH secret -> $ok (200=WORKING)"
    exit 0
  fi
  if [ "$st" = "failed" ] || [ "$st" = "error" ]; then echo "=== DEPLOY FAILED ==="; exit 1; fi
  sleep 45
done
echo "=== timed out after 60 min ==="; exit 2
