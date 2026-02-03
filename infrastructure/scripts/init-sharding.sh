#!/bin/bash
# MongoDB Sharding Configuration Script
# This script runs AFTER mongos is healthy
# It adds shards and configures the events collection

set -e

echo "========================================"
echo "MongoDB Sharding Configuration"
echo "========================================"

# Function to wait for mongos
wait_for_mongos() {
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for mongos to be ready..."
    while [ $attempt -le $max_attempts ]; do
        if mongosh --host mongos --port 27017 --quiet --eval "db.adminCommand('ping').ok" 2>/dev/null; then
            echo "✓ mongos is ready"
            return 0
        fi
        echo "  Attempt $attempt/$max_attempts - mongos not ready yet..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "✗ Failed to connect to mongos after $max_attempts attempts"
    return 1
}

# Function to add a shard with retry
add_shard() {
    local shard_name=$1
    local shard_conn=$2
    local max_attempts=5
    local attempt=1
    
    echo "Adding shard: $shard_name ($shard_conn)..."
    
    while [ $attempt -le $max_attempts ]; do
        local result
        result=$(mongosh --host mongos --port 27017 --quiet --eval "
            try {
                var existing = db.adminCommand({listShards: 1});
                var found = false;
                if (existing.shards) {
                    existing.shards.forEach(function(s) {
                        if (s._id === '$shard_name') found = true;
                    });
                }
                if (found) {
                    print('ALREADY_EXISTS');
                } else {
                    var result = sh.addShard('$shard_conn');
                    if (result.ok === 1) {
                        print('ADDED');
                    } else {
                        print('FAILED');
                    }
                }
            } catch(e) {
                print('ERROR: ' + e.message);
            }
        " 2>/dev/null)
        
        if [ "$result" = "ALREADY_EXISTS" ]; then
            echo "✓ Shard $shard_name already exists"
            return 0
        elif [ "$result" = "ADDED" ]; then
            echo "✓ Shard $shard_name added successfully"
            return 0
        fi
        
        echo "  Attempt $attempt/$max_attempts failed: $result"
        sleep 3
        attempt=$((attempt + 1))
    done
    
    echo "✗ Failed to add shard $shard_name after $max_attempts attempts"
    return 1
}

# Wait for mongos to be ready
echo ""
echo "[Step 1/4] Waiting for mongos..."
wait_for_mongos

# Add shards
echo ""
echo "[Step 2/4] Adding Shards to Cluster..."
add_shard "shard1ReplSet" "shard1ReplSet/mongo-shard1:27018"
add_shard "shard2ReplSet" "shard2ReplSet/mongo-shard2:27018"

# Verify shards
echo ""
echo "[Step 3/4] Verifying shard configuration..."
mongosh --host mongos --port 27017 --quiet --eval "
    var shards = db.adminCommand({listShards: 1});
    print('Active shards: ' + shards.shards.length);
    shards.shards.forEach(function(s) {
        print('  - ' + s._id + ': ' + s.host);
    });
"

# Configure database and collections
echo ""
echo "[Step 4/4] Configuring Database and Collection Sharding..."
mongosh --host mongos --port 27017 --quiet --eval "
    // Enable sharding on the database
    var dbResult = sh.enableSharding('event_processor');
    if (dbResult.ok === 1 || dbResult.codeName === 'AlreadyInitialized') {
        print('✓ Database event_processor: sharding enabled');
    }
    
    // Switch to the database
    db = db.getSiblingDB('event_processor');
    
    // Check if events collection already exists and is sharded
    var collInfo = db.getCollectionInfos({name: 'events'});
    
    if (collInfo.length === 0) {
        // Create the collection
        db.createCollection('events');
        print('✓ Collection events: created');
    } else {
        print('✓ Collection events: already exists');
    }
    
    // Shard the collection using hashed userId
    try {
        sh.shardCollection('event_processor.events', { 'userId': 'hashed' });
        print('✓ Collection events: sharded by hashed userId');
    } catch(e) {
        if (e.message.includes('already')) {
            print('✓ Collection events: already sharded');
        } else {
            print('⚠ Sharding warning: ' + e.message);
        }
    }
    
    // ============================================================
    // PERFORMANCE-OPTIMIZED INDEXES FOR 50K EPS
    // ============================================================
    print('Creating performance-optimized indexes...');
    print('');
    
    // 1. Unique index for deduplication
    try {
        db.events.createIndex({ 'eventId': 1 }, { 
            unique: true, 
            background: true,
            name: 'idx_eventId_unique'
        });
        print('  ✓ idx_eventId_unique');
    } catch(e) {
        print('  - idx_eventId_unique: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    // 2. Simple indexes for isolated field filtering
    try {
        db.events.createIndex({ 'userId': 1 }, { 
            background: true,
            name: 'idx_userId'
        });
        print('  ✓ idx_userId');
    } catch(e) {
        print('  - idx_userId: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    try {
        db.events.createIndex({ 'eventType': 1 }, { 
            background: true,
            name: 'idx_eventType'
        });
        print('  ✓ idx_eventType');
    } catch(e) {
        print('  - idx_eventType: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    try {
        db.events.createIndex({ 'timestamp': -1 }, { 
            background: true,
            name: 'idx_timestamp'
        });
        print('  ✓ idx_timestamp');
    } catch(e) {
        print('  - idx_timestamp: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    try {
        db.events.createIndex({ 'createdAt': -1 }, { 
            background: true,
            name: 'idx_createdAt'
        });
        print('  ✓ idx_createdAt');
    } catch(e) {
        print('  - idx_createdAt: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    // 3. Compound indexes for analytics queries
    try {
        db.events.createIndex({ 'timestamp': -1, 'eventType': 1 }, { 
            background: true,
            name: 'idx_timestamp_eventType'
        });
        print('  ✓ idx_timestamp_eventType (compound)');
    } catch(e) {
        print('  - idx_timestamp_eventType: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    try {
        db.events.createIndex({ 'userId': 1, 'timestamp': -1 }, { 
            background: true,
            name: 'idx_userId_timestamp'
        });
        print('  ✓ idx_userId_timestamp (compound)');
    } catch(e) {
        print('  - idx_userId_timestamp: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    try {
        db.events.createIndex({ 'createdAt': -1, 'eventType': 1 }, { 
            background: true,
            name: 'idx_createdAt_eventType'
        });
        print('  ✓ idx_createdAt_eventType (compound)');
    } catch(e) {
        print('  - idx_createdAt_eventType: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    try {
        db.events.createIndex({ 'userId': 1, 'eventType': 1, 'timestamp': -1 }, { 
            background: true,
            name: 'idx_userId_eventType_timestamp'
        });
        print('  ✓ idx_userId_eventType_timestamp (compound)');
    } catch(e) {
        print('  - idx_userId_eventType_timestamp: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    // 4. Index for worker processing
    try {
        db.events.createIndex({ 'status': 1, 'createdAt': 1 }, { 
            background: true,
            name: 'idx_status_createdAt'
        });
        print('  ✓ idx_status_createdAt');
    } catch(e) {
        print('  - idx_status_createdAt: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    print('');
    print('✓ All indexes created/verified');
    
    // Create Dead Letter Queue collection
    var dlqInfo = db.getCollectionInfos({name: 'events_dlq'});
    if (dlqInfo.length === 0) {
        db.createCollection('events_dlq');
        print('✓ Collection events_dlq: created');
    } else {
        print('✓ Collection events_dlq: already exists');
    }
    
    try {
        db.events_dlq.createIndex({ 'originalEventId': 1 }, { unique: true, background: true });
        print('  ✓ Index: originalEventId (unique)');
    } catch(e) {
        print('  - Index originalEventId: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
    
    try {
        db.events_dlq.createIndex({ 'failedAt': 1 }, { background: true });
        print('  ✓ Index: failedAt');
    } catch(e) {
        print('  - Index failedAt: ' + (e.message.includes('already') ? 'exists' : e.message));
    }
"

# Print final status
echo ""
echo "========================================"
echo "✅ MongoDB Sharded Cluster Ready!"
echo "========================================"
echo ""
echo "Connection: mongodb://mongos:27017/event_processor"
echo "Database:   event_processor"
echo "Sharding:   hashed(userId)"
echo ""
echo "Collections:"
echo "  - events (sharded)"
echo "  - events_dlq"
echo ""
