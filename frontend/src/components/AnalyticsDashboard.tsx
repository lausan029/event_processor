import React, { useEffect, useState } from 'react';
import { 
  TrendingUp, Users, Activity, BarChart3, 
  Filter, Search, RefreshCw, Clock 
} from 'lucide-react';
import { getAnalyticsMetrics, type AnalyticsMetrics, type AnalyticsFilters } from '../api/analytics';

const AnalyticsDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [timeRange, setTimeRange] = useState('1h');
  const [eventTypeFilter, setEventTypeFilter] = useState('');
  const [userIdSearch, setUserIdSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const filters: AnalyticsFilters = { timeRange };
      if (eventTypeFilter) filters.eventType = eventTypeFilter;
      if (userIdSearch) filters.userId = userIdSearch;
      
      const data = await getAnalyticsMetrics(filters);
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    
    if (autoRefresh) {
      const interval = setInterval(fetchMetrics, 10000); // Refresh every 10s
      return () => clearInterval(interval);
    }
  }, [timeRange, eventTypeFilter, userIdSearch, autoRefresh]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString();
  };

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center space-x-2">
          <RefreshCw className="animate-spin" />
          <span className="text-gray-600">Loading analytics...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">Error: {error}</p>
        <button
          onClick={fetchMetrics}
          className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!metrics) return null;

  // Get available event types from data
  const availableEventTypes = metrics.eventsByType.map(e => e.eventType);

  return (
    <div className="space-y-6">
      {/* Header with Filters */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="text-blue-600" />
            Analytics Dashboard
          </h2>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
              autoRefresh 
                ? 'bg-green-50 border-green-300 text-green-700' 
                : 'bg-gray-50 border-gray-300 text-gray-700'
            }`}
          >
            <RefreshCw className={autoRefresh ? 'animate-spin' : ''} size={16} />
            Auto-refresh
          </button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Time Range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
              <Clock size={16} />
              Time Range
            </label>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="15m">Last 15 minutes</option>
              <option value="1h">Last 1 hour</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
            </select>
          </div>

          {/* Event Type Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
              <Filter size={16} />
              Event Type
            </label>
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Types</option>
              {availableEventTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          {/* User ID Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
              <Search size={16} />
              Search User ID
            </label>
            <input
              type="text"
              value={userIdSearch}
              onChange={(e) => setUserIdSearch(e.target.value)}
              placeholder="user_abc123..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Events</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {formatNumber(metrics.totalEvents)}
              </p>
            </div>
            <div className="bg-blue-100 p-3 rounded-lg">
              <Activity className="text-blue-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Unique Users</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {formatNumber(metrics.uniqueUsers)}
              </p>
            </div>
            <div className="bg-green-100 p-3 rounded-lg">
              <Users className="text-green-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Events/User</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {metrics.avgEventsPerUser.toFixed(1)}
              </p>
            </div>
            <div className="bg-purple-100 p-3 rounded-lg">
              <TrendingUp className="text-purple-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Sessions</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {formatNumber(metrics.uniqueSessions)}
              </p>
            </div>
            <div className="bg-orange-100 p-3 rounded-lg">
              <BarChart3 className="text-orange-600" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Events by Type - Bar Chart */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Events by Type
        </h3>
        <div className="space-y-3">
          {metrics.eventsByType.slice(0, 10).map((item) => (
            <div key={item.eventType}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-700">
                  {item.eventType}
                </span>
                <span className="text-sm text-gray-600">
                  {formatNumber(item.count)} ({item.percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(item.percentage, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Users Table */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Top Users by Event Count
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rank
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Event Count
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Event Types
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Activity
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {metrics.topUsers.map((user, index) => (
                <tr key={user.userId} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 text-blue-800 font-semibold text-sm">
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <code className="text-sm text-gray-900 font-mono bg-gray-100 px-2 py-1 rounded">
                      {user.userId.substring(0, 20)}...
                    </code>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatNumber(user.eventCount)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {user.eventTypes.slice(0, 3).map((type) => (
                        <span
                          key={type}
                          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                        >
                          {type}
                        </span>
                      ))}
                      {user.eventTypes.length > 3 && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                          +{user.eventTypes.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDateTime(user.lastEventAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Events Over Time Chart - Area Chart */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Events Over Time
        </h3>
        <div className="h-80 relative">
          {/* Y-axis labels */}
          <div className="absolute left-0 top-0 bottom-12 w-12 flex flex-col justify-between text-xs text-gray-600">
            {(() => {
              const maxCount = Math.max(...metrics.eventsOverTime.map(p => p.count), 1);
              const steps = 5;
              return Array.from({ length: steps }, (_, i) => {
                const value = Math.round((maxCount * (steps - 1 - i)) / (steps - 1));
                return (
                  <span key={i} className="text-right pr-2">
                    {formatNumber(value)}
                  </span>
                );
              });
            })()}
          </div>

          {/* Chart area */}
          <div className="absolute left-12 right-0 top-0 bottom-12 pl-4">
            <svg className="w-full h-full" preserveAspectRatio="none">
              {/* Grid lines */}
              <g className="grid-lines">
                {Array.from({ length: 5 }, (_, i) => (
                  <line
                    key={i}
                    x1="0"
                    y1={`${(i * 100) / 4}%`}
                    x2="100%"
                    y2={`${(i * 100) / 4}%`}
                    stroke="#e5e7eb"
                    strokeWidth="1"
                  />
                ))}
              </g>

              {/* Area path */}
              {metrics.eventsOverTime.length > 0 && (() => {
                const maxCount = Math.max(...metrics.eventsOverTime.map(p => p.count), 1);
                const points = metrics.eventsOverTime.map((point, index) => {
                  const x = (index / (metrics.eventsOverTime.length - 1 || 1)) * 100;
                  const y = 100 - ((point.count / maxCount) * 100);
                  return `${x},${y}`;
                });
                
                const pathData = `M 0,100 L ${points.join(' L ')} L 100,100 Z`;
                
                return (
                  <>
                    {/* Filled area */}
                    <path
                      d={pathData}
                      fill="url(#areaGradient)"
                      opacity="0.3"
                    />
                    {/* Line */}
                    <polyline
                      points={points.join(' ')}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Data points */}
                    {metrics.eventsOverTime.map((point, index) => {
                      const x = (index / (metrics.eventsOverTime.length - 1 || 1)) * 100;
                      const y = 100 - ((point.count / maxCount) * 100);
                      return (
                        <g key={index}>
                          <circle
                            cx={`${x}%`}
                            cy={`${y}%`}
                            r="4"
                            fill="#3b82f6"
                            stroke="white"
                            strokeWidth="2"
                            className="hover:r-6 transition-all cursor-pointer"
                          />
                          <title>{`${formatDateTime(point.timestamp)}\n${formatNumber(point.count)} events`}</title>
                        </g>
                      );
                    })}
                  </>
                );
              })()}

              {/* Gradient definition */}
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.1" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          {/* X-axis labels */}
          <div className="absolute left-12 right-0 bottom-0 h-10 pl-4">
            <div className="flex justify-between text-xs text-gray-600">
              {metrics.eventsOverTime.filter((_, i) => 
                i === 0 || 
                i === Math.floor(metrics.eventsOverTime.length / 2) || 
                i === metrics.eventsOverTime.length - 1
              ).map((point, index) => (
                <span key={index}>
                  {formatDateTime(point.timestamp)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 text-center">
        Data updated: {formatDateTime(metrics.timeRange.end)} | 
        Range: {formatDateTime(metrics.timeRange.start)} - {formatDateTime(metrics.timeRange.end)}
        {loading && <span className="ml-2">| Refreshing...</span>}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
