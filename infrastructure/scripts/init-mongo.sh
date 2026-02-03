#!/bin/bash
# MongoDB Full Initialization Script
# This is a wrapper that runs both replica set and sharding initialization
# Useful for manual execution or debugging

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "MongoDB Full Initialization"
echo "========================================"
echo ""

# Run replica set initialization
echo "Running replica set initialization..."
bash "$SCRIPT_DIR/init-replica-sets.sh"

echo ""
echo "Waiting for mongos to start..."
sleep 5

# Run sharding configuration
echo ""
echo "Running sharding configuration..."
bash "$SCRIPT_DIR/init-sharding.sh"

echo ""
echo "MongoDB initialization complete!"
