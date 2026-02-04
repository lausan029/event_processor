# Event Processor API Documentation

## Base URL

```
Production: https://your-backend.up.railway.app
Local:      http://localhost:3001
```

## Authentication

### API Key Authentication

Most endpoints require an API key in the `x-api-key` header:

```http
x-api-key: evp_your_api_key_here
```

### JWT Authentication

Some endpoints require a JWT token in the `Authorization` header:

```http
Authorization: Bearer your_jwt_token_here
```

## Endpoints

### Event Ingestion

#### POST `/api/v1/events`

Ingest a single event into the system.

**Authentication**: API Key required (`x-api-key` header)

**Request Body**:
```json
{
  "eventType": "user_signup",
  "userId": "user_abc123",
  "sessionId": "session_xyz789",
  "timestamp": "2024-01-30T12:34:56Z",
  "metadata": {
    "source": "web",
    "campaign": "summer_promo"
  },
  "payload": {
    "referrer": "google.com",
    "browser": "Chrome"
  },
  "priority": 1,
  "eventId": "evt_optional_custom_id"
}
```

**Request Schema**:
- `eventType` (string, required): Type of event (e.g., "user_signup", "page_view", "click")
- `userId` (string, required): User identifier (used for MongoDB sharding)
- `sessionId` (string, required): Session identifier
- `timestamp` (string, required): ISO 8601 timestamp
- `metadata` (object, optional): Additional metadata
- `payload` (object, optional): Event payload data
- `priority` (integer, optional): Event priority (1-10, default: 1)
- `eventId` (string, optional): Custom event ID (auto-generated if not provided)

**Response** (202 Accepted - New Event):
```json
{
  "success": true,
  "data": {
    "eventId": "evt_abc123",
    "accepted": true,
    "duplicate": false,
    "message": "Event accepted for processing"
  }
}
```

**Response** (200 OK - Duplicate Event):
```json
{
  "success": true,
  "data": {
    "eventId": "evt_abc123",
    "accepted": false,
    "duplicate": true,
    "message": "Event already processed (duplicate)"
  }
}
```

**Error Responses**:

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid event payload |
| 401 | `MISSING_API_KEY` | API key header missing |
| 401 | `INVALID_API_KEY` | Invalid or expired API key |
| 500 | `INGESTION_ERROR` | Internal server error |

---

#### POST `/api/v1/events/batch`

Ingest multiple events in a single request (up to 1000 events).

**Authentication**: API Key required (`x-api-key` header)

**Request Body**:
```json
{
  "events": [
    {
      "eventType": "page_view",
      "userId": "user_1",
      "sessionId": "session_1",
      "timestamp": "2024-01-30T12:34:56Z"
    },
    {
      "eventType": "click",
      "userId": "user_2",
      "sessionId": "session_2",
      "timestamp": "2024-01-30T12:35:00Z"
    }
  ]
}
```

**Response** (202 Accepted):
```json
{
  "success": true,
  "data": {
    "accepted": 2,
    "duplicates": 0,
    "total": 2,
    "eventIds": ["evt_1", "evt_2"],
    "message": "Batch processed successfully"
  }
}
```

**Error Responses**: Same as single event endpoint

---

#### GET `/api/v1/events/stats`

Get real-time ingestion statistics.

**Authentication**: API Key required (`x-api-key` header)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "ingestionRate": 1250.5,
    "totalIngested": 150000,
    "timestamp": "2024-01-30T12:34:56Z"
  }
}
```

---

### Analytics

#### GET `/api/v1/analytics/metrics`

Get comprehensive analytics metrics for the dashboard.

**Authentication**: None required

**Query Parameters**:
- `timeRange` (string, optional): Time range for metrics. Options: `15m`, `1h`, `24h`, `7d`. Default: `1h`
- `eventType` (string, optional): Filter by event type
- `userId` (string, optional): Filter by user ID (supports partial match)

**Example Request**:
```http
GET /api/v1/analytics/metrics?timeRange=24h&eventType=click&userId=user_123
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "totalEvents": 15000,
    "timeRange": {
      "start": "2024-01-29T12:00:00Z",
      "end": "2024-01-30T12:00:00Z"
    },
    "eventsByType": [
      {
        "eventType": "page_view",
        "count": 8000,
        "percentage": 53.3
      },
      {
        "eventType": "click",
        "count": 5000,
        "percentage": 33.3
      },
      {
        "eventType": "purchase",
        "count": 2000,
        "percentage": 13.3
      }
    ],
    "topUsers": [
      {
        "userId": "user_abc123",
        "eventCount": 150,
        "lastEventAt": "2024-01-30T11:59:00Z",
        "eventTypes": ["page_view", "click", "purchase"]
      }
    ],
    "eventsOverTime": [
      {
        "timestamp": "2024-01-30T11:00:00Z",
        "count": 1000
      },
      {
        "timestamp": "2024-01-30T11:15:00Z",
        "count": 1500
      }
    ],
    "avgEventsPerUser": 30.5,
    "uniqueUsers": 500,
    "uniqueSessions": 800
  }
}
```

**Error Responses**:

| Status | Code | Description |
|--------|------|-------------|
| 500 | `ANALYTICS_ERROR` | Failed to fetch analytics |

**Caching**: Results are cached in Redis for 10 seconds to reduce MongoDB load.

---

### Authentication

#### POST `/api/auth/request-code`

Request a 6-digit verification code for email authentication.

**Request Body**:
```json
{
  "email": "user@example.com"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "message": "Verification code sent to user@example.com"
  }
}
```

**Error Responses**:

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid email format |

**Note**: In development, the code is logged to the console. In production, it should be sent via email/SMS.

---

#### POST `/api/auth/verify`

Verify the 6-digit code and receive a JWT token.

**Request Body**:
```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "uuid-here",
      "email": "user@example.com",
      "role": "USER"
    }
  }
}
```

**Error Responses**:

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid code format |
| 401 | `INVALID_CODE` | Code mismatch or expired |

---

#### POST `/api/auth/api-key`

Generate a new API key for event ingestion.

**Authentication**: JWT required (`Authorization: Bearer <token>`)

**Request Body**:
```json
{
  "name": "Production API Key"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "apiKey": "evp_lV4gXA78mzlEjhpRIoyRx-trBxKs0g701MeEvPcrvZY",
    "message": "API key generated successfully"
  }
}
```

**Error Responses**:

| Status | Code | Description |
|--------|------|-------------|
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 500 | `API_KEY_GENERATION_ERROR` | Failed to generate API key |

---

#### GET `/api/auth/me`

Get current authenticated user information.

**Authentication**: JWT required (`Authorization: Bearer <token>`)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid-here",
    "email": "user@example.com",
    "role": "USER",
    "createdAt": "2024-01-30T10:00:00Z"
  }
}
```

---

### Health Checks

#### GET `/api/health`

Comprehensive health check for all system components.

**Response** (200 OK):
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "timestamp": "2024-01-30T12:34:56Z",
  "services": {
    "mongodb": { "status": "up" },
    "postgres": { "status": "up" },
    "redis": { "status": "up" }
  }
}
```

**Status Values**:
- `healthy`: All services operational
- `degraded`: Some services have issues but system is functional
- `unhealthy`: Critical services are down

---

#### GET `/api/ready`

Kubernetes readiness probe.

**Response** (200 OK):
```json
{
  "ready": true
}
```

---

#### GET `/api/live`

Kubernetes liveness probe.

**Response** (200 OK):
```json
{
  "live": true
}
```

---

## Error Codes Reference

| HTTP Status | Error Code | Description | Solution |
|-------------|------------|-------------|----------|
| 400 | `VALIDATION_ERROR` | Request payload validation failed | Check request body against schema |
| 401 | `MISSING_API_KEY` | `x-api-key` header is missing | Add `x-api-key` header |
| 401 | `INVALID_API_KEY` | API key is invalid or expired | Generate new API key via `/api/auth/api-key` |
| 401 | `UNAUTHORIZED` | JWT token missing or invalid | Re-authenticate via `/api/auth/verify` |
| 401 | `INVALID_CODE` | Verification code is incorrect | Request new code via `/api/auth/request-code` |
| 403 | `FORBIDDEN` | Insufficient permissions | Check user role |
| 500 | `INGESTION_ERROR` | Failed to ingest event | Retry request or check system logs |
| 500 | `ANALYTICS_ERROR` | Failed to fetch analytics | Retry request or check MongoDB connection |
| 500 | `API_KEY_GENERATION_ERROR` | Failed to generate API key | Check database connection |

## Rate Limiting

- **Auth Endpoints**: 100 requests/minute per IP
- **Event Endpoints**: No rate limit (handled by system capacity)
- **Analytics Endpoints**: No rate limit (cached for 10 seconds)

## Best Practices

### Event Ingestion

1. **Use Batch Endpoint**: For multiple events, use `/events/batch` instead of multiple single requests
2. **Provide Event IDs**: Include `eventId` in requests for better deduplication tracking
3. **Set Appropriate Priority**: Use priority 1-3 for normal events, 4-10 for critical events
4. **Handle Duplicates**: Always check `duplicate: true` in response to avoid reprocessing

### Error Handling

1. **Retry Logic**: Implement exponential backoff for 500 errors
2. **Idempotency**: Use `eventId` to ensure idempotent requests
3. **Monitor Rate Limits**: Track 401/403 responses for authentication issues

### Performance

1. **Batch Size**: Send 100-500 events per batch request for optimal throughput
2. **Connection Pooling**: Reuse HTTP connections for multiple requests
3. **Async Processing**: Don't wait for event processing completion (system is async)

## Interactive API Documentation

Swagger UI is available at:
```
http://localhost:3001/docs
```

This provides an interactive interface to test all endpoints with request/response examples.
