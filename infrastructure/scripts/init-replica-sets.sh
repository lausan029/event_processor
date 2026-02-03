#!/bin/bash
# MongoDB Replica Set Initialization Script
# This script MUST run BEFORE mongos can start
# It initializes: configsvr, shard1, shard2

set -e

echo "========================================"
echo "MongoDB Replica Set Initialization"
echo "========================================"

# Function to wait for MongoDB to be ready
wait_for_mongo() {
    local host=$1
    local port=$2
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for $host:$port to be ready..."
    while [ $attempt -le $max_attempts ]; do
        if mongosh --host "$host" --port "$port" --quiet --eval "db.adminCommand('ping').ok" 2>/dev/null; then
            echo "✓ $host:$port is ready"
            return 0
        fi
        echo "  Attempt $attempt/$max_attempts - $host:$port not ready yet..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "✗ Failed to connect to $host:$port after $max_attempts attempts"
    return 1
}

# Function to initialize a replica set
init_replica_set() {
    local host=$1
    local port=$2
    local rs_name=$3
    local is_configsvr=$4
    
    echo ""
    echo "Initializing Replica Set: $rs_name on $host:$port"
    
    # Check if already initialized
    local status
    status=$(mongosh --host "$host" --port "$port" --quiet --eval "
        try {
            var status = rs.status();
            if (status.ok === 1) {
                print('ALREADY_INITIALIZED');
            } else {
                print('NOT_INITIALIZED');
            }
        } catch(e) {
            print('NOT_INITIALIZED');
        }
    " 2>/dev/null)
    
    if [ "$status" = "ALREADY_INITIALIZED" ]; then
        echo "✓ Replica set $rs_name already initialized"
        return 0
    fi
    
    echo "Initializing replica set $rs_name..."
    
    if [ "$is_configsvr" = "true" ]; then
        mongosh --host "$host" --port "$port" --quiet --eval "
            rs.initiate({
                _id: '$rs_name',
                configsvr: true,
                members: [{ _id: 0, host: '$host:$port' }]
            });
        "
    else
        mongosh --host "$host" --port "$port" --quiet --eval "
            rs.initiate({
                _id: '$rs_name',
                members: [{ _id: 0, host: '$host:$port' }]
            });
        "
    fi
    
    # Wait for replica set to be ready
    local max_wait=30
    local waited=0
    echo "Waiting for $rs_name to elect primary..."
    
    while [ $waited -lt $max_wait ]; do
        local rs_ok
        rs_ok=$(mongosh --host "$host" --port "$port" --quiet --eval "
            try {
                var status = rs.status();
                if (status.ok === 1 && status.myState === 1) {
                    print('PRIMARY_READY');
                } else {
                    print('WAITING');
                }
            } catch(e) {
                print('ERROR');
            }
        " 2>/dev/null)
        
        if [ "$rs_ok" = "PRIMARY_READY" ]; then
            echo "✓ Replica set $rs_name is ready with primary"
            return 0
        fi
        
        sleep 1
        waited=$((waited + 1))
    done
    
    echo "⚠ Replica set $rs_name may not be fully ready, but continuing..."
    return 0
}

# Wait for all MongoDB instances
echo ""
echo "[Step 1/4] Waiting for MongoDB instances..."
wait_for_mongo "mongo-configsvr" "27019"
wait_for_mongo "mongo-shard1" "27018"
wait_for_mongo "mongo-shard2" "27018"

# Initialize Config Server Replica Set (MUST be first)
echo ""
echo "[Step 2/4] Initializing Config Server Replica Set..."
init_replica_set "mongo-configsvr" "27019" "configReplSet" "true"

# Initialize Shard 1 Replica Set
echo ""
echo "[Step 3/4] Initializing Shard 1 Replica Set..."
init_replica_set "mongo-shard1" "27018" "shard1ReplSet" "false"

# Initialize Shard 2 Replica Set
echo ""
echo "[Step 4/4] Initializing Shard 2 Replica Set..."
init_replica_set "mongo-shard2" "27018" "shard2ReplSet" "false"

# Final verification
echo ""
echo "========================================"
echo "Verifying all replica sets..."
echo "========================================"

verify_rs() {
    local host=$1
    local port=$2
    local rs_name=$3
    
    local result
    result=$(mongosh --host "$host" --port "$port" --quiet --eval "
        var status = rs.status();
        if (status.ok === 1) {
            print('OK');
        } else {
            print('FAIL');
        }
    " 2>/dev/null)
    
    if [ "$result" = "OK" ]; then
        echo "✓ $rs_name: OK"
        return 0
    else
        echo "✗ $rs_name: FAILED"
        return 1
    fi
}

verify_rs "mongo-configsvr" "27019" "configReplSet"
verify_rs "mongo-shard1" "27018" "shard1ReplSet"
verify_rs "mongo-shard2" "27018" "shard2ReplSet"

echo ""
echo "========================================"
echo "✅ All Replica Sets Initialized!"
echo "========================================"
echo "mongos can now start and connect to configReplSet"
echo ""
