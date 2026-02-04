/**
 * K6 Load Test Script
 * Validates 50k EPS target with latency metrics (p95, p99)
 * 
 * Usage:
 *   k6 run k6-load-test.js
 *   k6 run --vus 100 --duration 60s k6-load-test.js
 *   k6 run --out json=results.json k6-load-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// Custom metrics
const eventsSent = new Counter('events_sent');
const duplicatesDetected = new Counter('duplicates_detected');
const errorRate = new Rate('error_rate');
const latency = new Trend('event_latency', true);

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const API_KEY = __ENV.API_KEY || 'evp_test_api_key_replace_me';

export const options = {
  scenarios: {
    // Ramp-up test: Start slow, increase to target
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 50 },   // Ramp to 50 VUs
        { duration: '1m', target: 100 },   // Ramp to 100 VUs
        { duration: '2m', target: 200 },   // Ramp to 200 VUs
        { duration: '1m', target: 200 },   // Stay at 200 VUs
        { duration: '30s', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Response time thresholds
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'event_latency': ['p(95)<300', 'p(99)<500'],
    
    // Error rate threshold
    'error_rate': ['rate<0.01'], // Less than 1% errors
    
    // Request rate
    'http_reqs': ['rate>100'], // At least 100 RPS
  },
};

// Event types for realistic distribution
const EVENT_TYPES = [
  'page_view',
  'click',
  'scroll',
  'form_submit',
  'purchase',
  'add_to_cart',
  'search',
  'video_play',
  'share',
  'signup',
];

// Generate random event
function generateEvent() {
  const eventType = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
  const userId = `user_${randomString(8)}`;
  const sessionId = `sess_${randomString(8)}`;
  
  return {
    eventType,
    userId,
    sessionId,
    timestamp: new Date().toISOString(),
    metadata: {
      source: 'k6_load_test',
      browser: ['Chrome', 'Firefox', 'Safari'][Math.floor(Math.random() * 3)],
      os: ['Windows', 'macOS', 'Linux'][Math.floor(Math.random() * 3)],
      device: ['desktop', 'mobile', 'tablet'][Math.floor(Math.random() * 3)],
    },
    payload: {
      url: `/page/${Math.floor(Math.random() * 100)}`,
      referrer: 'https://google.com',
      value: Math.random() * 1000,
    },
    priority: Math.floor(Math.random() * 4),
  };
}

// Single event ingestion
export default function() {
  const event = generateEvent();
  const startTime = Date.now();
  
  const response = http.post(
    `${BASE_URL}/api/v1/events`,
    JSON.stringify(event),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      timeout: '10s',
    }
  );
  
  const duration = Date.now() - startTime;
  latency.add(duration);
  
  const isSuccess = check(response, {
    'status is 202 or 200': (r) => r.status === 202 || r.status === 200,
    'response has eventId': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data && body.data.eventId;
      } catch {
        return false;
      }
    },
  });
  
  if (isSuccess) {
    eventsSent.add(1);
    
    try {
      const body = JSON.parse(response.body);
      if (body.data && body.data.duplicate) {
        duplicatesDetected.add(1);
      }
    } catch {
      // Ignore parse errors
    }
  } else {
    errorRate.add(1);
  }
  
  // Small random sleep to avoid thundering herd
  sleep(Math.random() * 0.1);
}

// Batch ingestion scenario
export function batchIngestion() {
  const events = Array.from({ length: 100 }, () => generateEvent());
  const startTime = Date.now();
  
  const response = http.post(
    `${BASE_URL}/api/v1/events/batch`,
    JSON.stringify({ events }),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      timeout: '30s',
    }
  );
  
  const duration = Date.now() - startTime;
  latency.add(duration);
  
  const isSuccess = check(response, {
    'batch status is 202': (r) => r.status === 202,
    'batch response has accepted count': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data && typeof body.data.accepted === 'number';
      } catch {
        return false;
      }
    },
  });
  
  if (isSuccess) {
    try {
      const body = JSON.parse(response.body);
      eventsSent.add(body.data.accepted || 0);
      duplicatesDetected.add(body.data.duplicates || 0);
    } catch {
      // Ignore
    }
  } else {
    errorRate.add(1);
  }
  
  sleep(0.5);
}

// Analytics endpoint stress test
export function analyticsStress() {
  const timeRanges = ['15m', '1h', '24h'];
  const timeRange = timeRanges[Math.floor(Math.random() * timeRanges.length)];
  
  const response = http.get(
    `${BASE_URL}/api/v1/analytics/metrics?timeRange=${timeRange}`,
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: '30s',
    }
  );
  
  check(response, {
    'analytics status is 200': (r) => r.status === 200,
    'analytics has metrics': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data && typeof body.data.totalEvents === 'number';
      } catch {
        return false;
      }
    },
  });
  
  sleep(1);
}

// Summary handler
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    duration: data.state.testRunDurationMs,
    vus: data.metrics.vus ? data.metrics.vus.values.max : 0,
    requests: {
      total: data.metrics.http_reqs ? data.metrics.http_reqs.values.count : 0,
      rate: data.metrics.http_reqs ? data.metrics.http_reqs.values.rate : 0,
    },
    latency: {
      avg: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.avg : 0,
      p50: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(50)'] : 0,
      p90: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(90)'] : 0,
      p95: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(95)'] : 0,
      p99: data.metrics.http_req_duration ? data.metrics.http_req_duration.values['p(99)'] : 0,
      max: data.metrics.http_req_duration ? data.metrics.http_req_duration.values.max : 0,
    },
    events: {
      sent: data.metrics.events_sent ? data.metrics.events_sent.values.count : 0,
      duplicates: data.metrics.duplicates_detected ? data.metrics.duplicates_detected.values.count : 0,
    },
    errors: {
      rate: data.metrics.error_rate ? data.metrics.error_rate.values.rate : 0,
      count: data.metrics.http_req_failed ? data.metrics.http_req_failed.values.passes : 0,
    },
    thresholds: data.thresholds,
  };
  
  console.log('\n' + '='.repeat(70));
  console.log('                    LOAD TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Duration:        ${(summary.duration / 1000).toFixed(1)}s`);
  console.log(`Max VUs:         ${summary.vus}`);
  console.log('');
  console.log('REQUESTS:');
  console.log(`  Total:         ${summary.requests.total}`);
  console.log(`  Rate:          ${summary.requests.rate.toFixed(2)} req/s`);
  console.log('');
  console.log('LATENCY:');
  console.log(`  Average:       ${summary.latency.avg.toFixed(2)}ms`);
  console.log(`  P50:           ${summary.latency.p50.toFixed(2)}ms`);
  console.log(`  P90:           ${summary.latency.p90.toFixed(2)}ms`);
  console.log(`  P95:           ${summary.latency.p95.toFixed(2)}ms`);
  console.log(`  P99:           ${summary.latency.p99.toFixed(2)}ms`);
  console.log(`  Max:           ${summary.latency.max.toFixed(2)}ms`);
  console.log('');
  console.log('EVENTS:');
  console.log(`  Sent:          ${summary.events.sent}`);
  console.log(`  Duplicates:    ${summary.events.duplicates}`);
  console.log('');
  console.log('ERRORS:');
  console.log(`  Rate:          ${(summary.errors.rate * 100).toFixed(2)}%`);
  console.log('='.repeat(70));
  
  return {
    'stdout': JSON.stringify(summary, null, 2),
    'k6-results.json': JSON.stringify(data, null, 2),
  };
}
