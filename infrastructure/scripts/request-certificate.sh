#!/bin/bash
# Check and fix Let's Encrypt certificate for a domain
# Usage: ./request-certificate.sh <domain> [container-name]
#
# ROOT CAUSE: Traefik v3's Docker provider filters out unhealthy/starting
# containers entirely. No router is created → no cert is requested.
# The fix is to ensure the container is healthy, then Traefik handles the rest.

set -e

DOMAIN="$1"
CONTAINER="${2:-}"

if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain> [container-name]"
  echo "Example: $0 matrx-dm.dev.codematrx.com matrx-dm"
  exit 1
fi

# Try to infer container name from domain if not provided
if [ -z "$CONTAINER" ]; then
  CONTAINER=$(echo "$DOMAIN" | sed 's/\.dev\.codematrx\.com$//')
fi

echo "🔍 Diagnosing certificate issue for: $DOMAIN (container: $CONTAINER)"
echo ""

# Step 1: Check DNS
echo "1. DNS Resolution:"
IP=$(dig +short "$DOMAIN" | head -1)
SERVER_IP=$(curl -4 -s ifconfig.me 2>/dev/null)
if [ "$IP" = "$SERVER_IP" ]; then
  echo "   ✅ $DOMAIN → $IP (matches server)"
else
  echo "   ❌ $DOMAIN → $IP (server is $SERVER_IP)"
  echo "   DNS must point to this server for Let's Encrypt HTTP-01 challenge"
  exit 1
fi

# Step 2: Check container exists and health
echo ""
echo "2. Container Health:"
CONTAINER_STATE=$(docker inspect "$CONTAINER" --format '{{.State.Status}}' 2>/dev/null || echo "not-found")
if [ "$CONTAINER_STATE" = "not-found" ]; then
  echo "   ❌ Container '$CONTAINER' not found"
  echo "   Available containers:"
  docker ps --format '   - {{.Names}} ({{.Status}})' | grep -v "^   - db-"
  exit 1
fi

HEALTH_STATUS=$(docker inspect "$CONTAINER" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null)

if [ "$HEALTH_STATUS" = "unhealthy" ]; then
  echo "   ❌ Container is UNHEALTHY — this is the problem!"
  echo ""
  echo "   Traefik v3 skips unhealthy containers entirely."
  echo "   No router is created → no certificate is requested."
  echo ""
  echo "   Last health check output:"
  docker inspect "$CONTAINER" --format '{{(index .State.Health.Log (len .State.Health.Log | add -1)).Output}}' 2>/dev/null | sed 's/^/   /'
  echo ""
  echo "   Recent container logs:"
  docker logs "$CONTAINER" --tail 10 2>&1 | sed 's/^/   /'
  echo ""
  echo "   Fix the app so it passes its health check, then the certificate"
  echo "   will be automatically issued by Traefik."
  exit 1
elif [ "$HEALTH_STATUS" = "starting" ]; then
  echo "   ⏳ Container is starting — waiting for health check..."
  for i in $(seq 1 18); do  # Wait up to 90 seconds
    sleep 5
    HEALTH_STATUS=$(docker inspect "$CONTAINER" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null)
    if [ "$HEALTH_STATUS" = "healthy" ]; then
      echo "   ✅ Container became healthy after $((i * 5))s"
      break
    elif [ "$HEALTH_STATUS" = "unhealthy" ]; then
      echo "   ❌ Container became unhealthy after $((i * 5))s"
      echo "   Fix the app health check issue first."
      exit 1
    fi
  done
elif [ "$HEALTH_STATUS" = "healthy" ] || [ "$HEALTH_STATUS" = "none" ]; then
  echo "   ✅ Container is ${HEALTH_STATUS} (state: $CONTAINER_STATE)"
else
  echo "   ⚠ Unknown health status: $HEALTH_STATUS (state: $CONTAINER_STATE)"
fi

# Step 3: Check Traefik labels
echo ""
echo "3. Traefik Labels:"
HAS_CERTRESOLVER=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "traefik.http.routers.'$CONTAINER'.tls.certresolver"}}' 2>/dev/null || echo "")
HAS_ENABLE=$(docker inspect "$CONTAINER" --format '{{index .Config.Labels "traefik.enable"}}' 2>/dev/null || echo "")
if [ "$HAS_ENABLE" = "true" ] && [ "$HAS_CERTRESOLVER" = "letsencrypt" ]; then
  echo "   ✅ Traefik labels are correct (enable=true, certresolver=letsencrypt)"
else
  echo "   ❌ Missing or wrong Traefik labels"
  echo "   traefik.enable=$HAS_ENABLE (expected: true)"
  echo "   certresolver=$HAS_CERTRESOLVER (expected: letsencrypt)"
  exit 1
fi

# Step 4: Check proxy network
echo ""
echo "4. Proxy Network:"
IN_PROXY=$(docker inspect "$CONTAINER" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null | grep -c "proxy" || echo "0")
if [ "$IN_PROXY" -gt 0 ]; then
  echo "   ✅ Container is on the proxy network"
else
  echo "   ❌ Container is NOT on the proxy network"
  echo "   Traefik can only route to containers on the 'proxy' network"
  exit 1
fi

# Step 5: Check current certificate
echo ""
echo "5. Certificate Status:"
ISSUER=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null || echo "")
if echo "$ISSUER" | grep -q "Let's Encrypt"; then
  echo "   ✅ Valid Let's Encrypt certificate"
  echo "   $ISSUER"
  exit 0
elif echo "$ISSUER" | grep -q "TRAEFIK DEFAULT CERT"; then
  echo "   ⏳ Using Traefik default cert — Let's Encrypt cert not yet issued"
  echo "   If the container is healthy, the cert should arrive within 30-60 seconds."
  echo "   Waiting..."
  for i in $(seq 1 6); do
    sleep 10
    ISSUER=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null || echo "")
    if echo "$ISSUER" | grep -q "Let's Encrypt"; then
      echo "   ✅ Let's Encrypt certificate issued after $((i * 10))s!"
      exit 0
    fi
  done
  echo ""
  echo "   ⚠ Certificate still not issued after 60s."
  echo "   Try: docker restart traefik  (forces Traefik to re-evaluate all routers)"
  echo "   Then wait 30-60s and re-run this script."
  exit 1
else
  echo "   ❌ Could not determine certificate status"
  echo "   $ISSUER"
  exit 1
fi
