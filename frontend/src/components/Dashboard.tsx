/**
 * Dashboard Component
 * Main view after authentication with real-time metrics
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { generateApiKey } from '../api/auth';
import AnalyticsDashboard from './AnalyticsDashboard';

interface Metrics {
  ingestion: {
    rate: number;
    totalIngested: number;
  };
  processing: {
    totalEvents: number;
    eventsPerSecond: number;
    totalBatches: number;
    lastBatchSize: number;
    lastProcessedTimestamp: string;
  };
  errors: {
    failedEvents: number;
    dlqEvents: number;
  };
  queue: {
    streamLength: number;
    consumerGroups: number;
    pendingMessages: number;
  };
  eventsByType: Record<string, number>;
}

interface HealthStatus {
  status: string;
  version: string;
  uptime: number;
  services?: {
    mongodb?: { status: string };
    postgres?: { status: string };
    redis?: { status: string };
  };
}

export function Dashboard() {
  const { user, token, logout } = useAuth();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch health status
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch('/api/health');
        const data = (await response.json()) as HealthStatus;
        setHealth(data);
      } catch {
        setHealth({ status: 'unavailable', version: 'unknown', uptime: 0 });
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch real-time metrics
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch('/api/metrics');
        const result = (await response.json()) as { success: boolean; data: Metrics };
        if (result.success) {
          setMetrics(result.data);
        }
      } catch {
        // Metrics fetch failed - silent fail
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000); // Update every 2 seconds
    return () => clearInterval(interval);
  }, []);

  const handleGenerateApiKey = async () => {
    if (!token) return;

    setApiKeyLoading(true);
    setApiKeyError(null);

    try {
      const result = await generateApiKey(token, 'Load Test Key');

      if (result.success && result.data) {
        setApiKey(result.data.apiKey);
      } else {
        setApiKeyError(result.error?.message ?? 'Failed to generate API key');
      }
    } catch {
      setApiKeyError('Network error');
    } finally {
      setApiKeyLoading(false);
    }
  };

  const handleCopyApiKey = async () => {
    if (apiKey) {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'up':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      default:
        return 'bg-red-500';
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-foreground">Event Processor</h1>
              <p className="text-xs text-muted-foreground">Real-time Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <button
              onClick={logout}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {/* Key Metrics Row */}
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <div className="rounded-xl border border-border bg-gradient-to-br from-blue-500/10 to-blue-600/5 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              <span className="text-sm font-medium">Ingestion Rate</span>
            </div>
            <p className="text-3xl font-bold text-foreground">
              {formatNumber(metrics?.ingestion.rate ?? 0)}
              <span className="text-lg font-normal text-muted-foreground">/s</span>
            </p>
          </div>

          <div className="rounded-xl border border-border bg-gradient-to-br from-green-500/10 to-green-600/5 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">Processing Rate</span>
            </div>
            <p className="text-3xl font-bold text-foreground">
              {formatNumber(metrics?.processing.eventsPerSecond ?? 0)}
              <span className="text-lg font-normal text-muted-foreground">/s</span>
            </p>
          </div>

          <div className="rounded-xl border border-border bg-gradient-to-br from-purple-500/10 to-purple-600/5 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="text-sm font-medium">Queue Depth</span>
            </div>
            <p className="text-3xl font-bold text-foreground">
              {formatNumber(metrics?.queue.streamLength ?? 0)}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-gradient-to-br from-red-500/10 to-red-600/5 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm font-medium">DLQ Events</span>
            </div>
            <p className="text-3xl font-bold text-foreground">
              {formatNumber(metrics?.errors.dlqEvents ?? 0)}
            </p>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* System Status Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">System Status</h2>
              <span className={`w-3 h-3 rounded-full ${getStatusColor(health?.status ?? 'unknown')}`} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">API Status</span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  health?.status === 'healthy'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {health?.status ?? 'checking...'}
                </span>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Total Ingested</span>
                <span className="text-sm font-mono text-foreground">
                  {formatNumber(metrics?.ingestion.totalIngested ?? 0)}
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Total Processed</span>
                <span className="text-sm font-mono text-foreground">
                  {formatNumber(metrics?.processing.totalEvents ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Services Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground mb-4">Services</h2>

            <div className="space-y-3">
              {[
                { name: 'MongoDB Sharded', key: 'mongodb' },
                { name: 'PostgreSQL', key: 'postgres' },
                { name: 'Redis Streams', key: 'redis' },
              ].map((service) => (
                <div
                  key={service.key}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <span className="text-sm text-muted-foreground">{service.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${getStatusColor(
                      health?.services?.[service.key as keyof typeof health.services]?.status ?? 'unknown'
                    )}`} />
                    <span className="text-xs text-foreground">
                      {health?.services?.[service.key as keyof typeof health.services]?.status ?? 'checking'}
                    </span>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Consumer Groups</span>
                <span className="text-xs text-foreground">
                  {metrics?.queue.consumerGroups ?? 0} active
                </span>
              </div>

              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Pending Messages</span>
                <span className="text-xs text-foreground">
                  {formatNumber(metrics?.queue.pendingMessages ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* API Key Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground mb-4">API Key</h2>

            <p className="text-sm text-muted-foreground mb-4">
              Generate an API key for high-throughput event ingestion (50k EPS).
            </p>

            {apiKeyError && (
              <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {apiKeyError}
              </div>
            )}

            {apiKey ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">
                  {apiKey}
                </div>
                <button
                  onClick={handleCopyApiKey}
                  className="w-full px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {copied ? (
                    <>
                      <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy to clipboard
                    </>
                  )}
                </button>
                <p className="text-xs text-muted-foreground text-center">
                  ⚠️ Store this key securely. It won't be shown again.
                </p>
              </div>
            ) : (
              <button
                onClick={handleGenerateApiKey}
                disabled={apiKeyLoading}
                className="w-full px-4 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {apiKeyLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating...
                  </span>
                ) : (
                  'Generate API Key'
                )}
              </button>
            )}
          </div>
        </div>

        {/* Events by Type */}
        {metrics?.eventsByType && Object.keys(metrics.eventsByType).length > 0 && (
          <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground mb-4">Events by Type</h2>
            <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-6">
              {Object.entries(metrics.eventsByType)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 12)
                .map(([type, count]) => (
                  <div key={type} className="p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground truncate">{type}</p>
                    <p className="text-lg font-bold text-foreground">{formatNumber(count)}</p>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Usage Example */}
        <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4">Quick Start</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Use your API key to ingest events via the REST API:
          </p>
          <pre className="p-4 rounded-lg bg-muted text-xs overflow-x-auto">
{`curl -X POST http://localhost:3001/api/v1/events \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{
    "eventType": "page_view",
    "userId": "user-123",
    "sessionId": "sess-456",
    "timestamp": "${new Date().toISOString()}",
    "payload": { "page": "/home" }
  }'`}
          </pre>
        </div>

        {/* Analytics Dashboard Section */}
        <div className="mt-8">
          <AnalyticsDashboard />
        </div>
      </main>
    </div>
  );
}
