#!/bin/bash

# Scale Workers Script
# Usage: ./scale-workers.sh [count]
# Default: 5 workers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

COUNT=${1:-5}

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              SCALING EVENT WORKERS                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "→ Target: $COUNT workers"
echo ""

cd "$INFRA_DIR"

# Scale workers
docker-compose up -d --scale worker=$COUNT --no-recreate

sleep 3

# Show status
echo ""
echo "✅ Workers running:"
docker ps --filter "name=infrastructure-worker" --format "  {{.Names}}: {{.Status}}" | head -15

echo ""
echo "✅ Consumer group status:"
docker exec redis redis-cli XINFO GROUPS events_stream 2>/dev/null | grep -E "name|consumers|pending" | head -6

echo ""
echo "Done! $COUNT workers are now running."
echo ""
