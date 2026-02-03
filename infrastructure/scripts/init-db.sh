#!/bin/bash
# Unified Database Initialization Script
# Run this manually if you need to re-initialize databases
# Note: Docker Compose handles this automatically via init services

set -e

echo "========================================"
echo "Event Processor - Database Initialization"
echo "========================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect if running inside container or on host
if [ -f /.dockerenv ]; then
    echo "Running inside Docker container"
    SCRIPTS_PATH="/scripts"
else
    echo "Running on host machine"
    SCRIPTS_PATH="$SCRIPT_DIR"
fi

# Check prerequisites
echo ""
echo "Checking prerequisites..."

if ! command -v mongosh &> /dev/null; then
    echo "⚠ mongosh not found locally. Running via Docker..."
    
    # Run init scripts via Docker
    echo ""
    echo "[MongoDB] Initializing Replica Sets..."
    docker exec -it mongo-configsvr mongosh --port 27019 --eval "
        try {
            rs.status();
            print('configReplSet already initialized');
        } catch(e) {
            rs.initiate({
                _id: 'configReplSet',
                configsvr: true,
                members: [{ _id: 0, host: 'mongo-configsvr:27019' }]
            });
            print('configReplSet initialized');
        }
    "
    
    docker exec -it mongo-shard1 mongosh --port 27018 --eval "
        try {
            rs.status();
            print('shard1ReplSet already initialized');
        } catch(e) {
            rs.initiate({
                _id: 'shard1ReplSet',
                members: [{ _id: 0, host: 'mongo-shard1:27018' }]
            });
            print('shard1ReplSet initialized');
        }
    "
    
    docker exec -it mongo-shard2 mongosh --port 27018 --eval "
        try {
            rs.status();
            print('shard2ReplSet already initialized');
        } catch(e) {
            rs.initiate({
                _id: 'shard2ReplSet',
                members: [{ _id: 0, host: 'mongo-shard2:27018' }]
            });
            print('shard2ReplSet initialized');
        }
    "
    
    echo ""
    echo "[MongoDB] Waiting for replica sets..."
    sleep 10
    
    echo ""
    echo "[MongoDB] Configuring shards..."
    docker exec -it mongos mongosh --eval "
        sh.addShard('shard1ReplSet/mongo-shard1:27018');
        sh.addShard('shard2ReplSet/mongo-shard2:27018');
        sh.enableSharding('event_processor');
        sh.shardCollection('event_processor.events', { 'userId': 'hashed' });
        print('Sharding configured');
    "
else
    echo "✓ mongosh found"
    
    echo ""
    echo "[MongoDB] Running replica set initialization..."
    bash "$SCRIPTS_PATH/init-replica-sets.sh"
    
    echo ""
    echo "[MongoDB] Running sharding configuration..."
    bash "$SCRIPTS_PATH/init-sharding.sh"
fi

echo ""
echo "[PostgreSQL] PostgreSQL is auto-initialized via init scripts"
echo ""

echo "========================================"
echo "All databases initialized successfully!"
echo "========================================"
echo ""
echo "Services:"
echo "  - MongoDB: mongodb://localhost:27017/event_processor"
echo "  - PostgreSQL: postgresql://localhost:5432/event_processor"
echo "  - Redis: redis://localhost:6379"
echo ""
