#!/usr/bin/env bash
# Creates the shared Docker 'proxy' network used by all services
# Run once after Docker is installed, before starting any services

set -euo pipefail

NETWORK_NAME="proxy"

if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "Network '$NETWORK_NAME' already exists"
else
  docker network create "$NETWORK_NAME"
  echo "Created Docker network: $NETWORK_NAME"
fi
