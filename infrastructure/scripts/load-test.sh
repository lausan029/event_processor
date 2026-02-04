#!/bin/bash
# Load Test Script - Event Processor
# Usage: API_KEY=your_key ./load-test.sh [requests] [concurrency]

ENDPOINT="${ENDPOINT:-http://localhost:3001/api/v1/events}"
API_KEY="evp_pWHftO6W3D6jJxpOMCQ1pOfkKGzDG5tv2QDbTOtXWoc"
TOTAL_REQUESTS=5000
CONCURRENCY=100

# Event types
EVENT_TYPES=("page_view" "button_click" "form_submit" "purchase" "signup" "login" "logout" "search" "video_play" "file_download")

# Function to generate random string
random_string() {
    cat /dev/urandom | LC_ALL=C tr -dc 'a-z0-9' | fold -w ${1:-12} | head -n 1
}

# Function to send a request
send_request() {
    local event_type="${EVENT_TYPES[$((RANDOM % ${#EVENT_TYPES[@]}))]}"
    local user_id="user_$(random_string 12)"
    local session_id="session_$(random_string 16)"
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    
    curl -s -X POST "$ENDPOINT" \
        -H "Content-Type: application/json" \
        -H "x-api-key: $API_KEY" \
        -d "{
            \"eventType\": \"$event_type\",
            \"userId\": \"$user_id\",
            \"sessionId\": \"$session_id\",
            \"timestamp\": \"$timestamp\",
            \"metadata\": {
                \"test\": true,
                \"loadTest\": \"bash-script\"
            },
            \"payload\": {
                \"value\": $((RANDOM % 1000))
            }
        }" > /dev/null 2>&1
    
    echo -n "."
}

export -f send_request
export -f random_string
export ENDPOINT API_KEY EVENT_TYPES

echo "════════════════════════════════════════════════════════"
echo "  EVENT PROCESSOR - LOAD TEST"
echo "════════════════════════════════════════════════════════"
echo ""
echo "  Total Requests: $TOTAL_REQUESTS"
echo "  Concurrency:    $CONCURRENCY"
echo "  Endpoint:       $ENDPOINT"
echo ""
echo "Sending requests..."
echo ""

# Send requests in parallel
for i in $(seq 1 $TOTAL_REQUESTS); do
    send_request &
    
    # Control concurrency
    if [ $((i % CONCURRENCY)) -eq 0 ]; then
        wait
        echo " [$i/$TOTAL_REQUESTS]"
    fi
done

# Wait for remaining jobs
wait
echo ""
echo ""
echo "✓ Completed! $TOTAL_REQUESTS requests sent."
echo ""
echo "════════════════════════════════════════════════════════"
