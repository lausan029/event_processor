#!/bin/sh
# Backend Startup Script
# Ensures database is synced before starting the server

set -e

echo "========================================"
echo "Event Processor Backend - Startup"
echo "========================================"
echo ""

cd /app/backend

# Wait for PostgreSQL to be ready
echo "[1/3] Waiting for PostgreSQL..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Use prisma db push with --accept-data-loss to avoid interactive prompts
    # Also use --skip-generate since client is already generated
    if npx prisma db push --accept-data-loss --skip-generate 2>&1; then
        echo "✓ PostgreSQL is ready and schema is synced"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "  Attempt $RETRY_COUNT/$MAX_RETRIES - PostgreSQL not ready, waiting..."
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "✗ Failed to connect to PostgreSQL after $MAX_RETRIES attempts"
    exit 1
fi

echo ""
echo "[2/3] Verifying Prisma client..."
# Prisma client should already be generated in the image
echo "✓ Prisma client ready"

echo ""
echo "[3/3] Starting backend server..."
echo ""

# Start the Node.js server
exec node dist/index.js
