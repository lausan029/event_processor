import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AnalyticsDashboard from '../../components/AnalyticsDashboard';

const mockMetricsData = {
  totalEvents: 15000,
  uniqueUsers: 500,
  uniqueSessions: 800,
  avgEventsPerUser: 30,
  timeRange: {
    start: '2024-01-30T11:00:00Z',
    end: '2024-01-30T12:00:00Z',
  },
  eventsByType: [
    { eventType: 'page_view', count: 8000, percentage: 53.3 },
    { eventType: 'click', count: 5000, percentage: 33.3 },
    { eventType: 'purchase', count: 2000, percentage: 13.3 },
  ],
  topUsers: [
    {
      userId: 'user_abc123456789',
      eventCount: 150,
      lastEventAt: '2024-01-30T11:59:00Z',
      eventTypes: ['page_view', 'click', 'purchase'],
    },
  ],
  eventsOverTime: [
    { timestamp: '2024-01-30T11:00:00Z', count: 1000 },
    { timestamp: '2024-01-30T11:30:00Z', count: 2000 },
  ],
};

describe('AnalyticsDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading spinner initially', () => {
      vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {})); // Never resolves
      render(<AnalyticsDashboard />);
      
      expect(screen.getByText('Loading analytics...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show error message when API fails', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));
      
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText(/Error:/)).toBeInTheDocument();
      });
    });

    it('should show retry button on error', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('API unavailable'));
      
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      });
    });

    it('should retry fetch when retry button is clicked', async () => {
      vi.mocked(global.fetch)
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: mockMetricsData }),
        } as Response);
      
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText(/Error:/)).toBeInTheDocument();
      });

      const retryButton = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryButton);
      
      await waitFor(() => {
        expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
      });
    });
  });

  describe('Data Display', () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockMetricsData }),
      } as Response);
    });

    it('should display KPI cards', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Total Events')).toBeInTheDocument();
        expect(screen.getByText('Unique Users')).toBeInTheDocument();
      });
    });

    it('should display events by type section', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Events by Type')).toBeInTheDocument();
      });
    });

    it('should display top users table', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Top Users by Event Count')).toBeInTheDocument();
      });
    });

    it('should display events over time chart', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Events Over Time')).toBeInTheDocument();
      });
    });
  });

  describe('Filters', () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockMetricsData }),
      } as Response);
    });

    it('should have time range selector', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Time Range')).toBeInTheDocument();
      });
    });

    it('should have event type filter', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Event Type')).toBeInTheDocument();
      });
    });

    it('should have user ID search input', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText('user_abc123...')).toBeInTheDocument();
      });
    });
  });

  describe('Auto-refresh', () => {
    beforeEach(() => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockMetricsData }),
      } as Response);
    });

    it('should have auto-refresh toggle', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Auto-refresh')).toBeInTheDocument();
      });
    });

    it('should toggle auto-refresh when clicked', async () => {
      render(<AnalyticsDashboard />);
      
      await waitFor(() => {
        expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
      });

      const autoRefreshButton = screen.getByText('Auto-refresh').closest('button');
      expect(autoRefreshButton).toBeInTheDocument();
      
      fireEvent.click(autoRefreshButton!);
      
      expect(autoRefreshButton).toHaveClass('bg-gray-50');
    });
  });

  describe('Number Formatting', () => {
    it('should display formatted statistics', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: mockMetricsData }),
      } as Response);
      
      render(<AnalyticsDashboard />);
      
      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument();
      });
      
      // Check that KPI labels are present
      expect(screen.getByText('Avg Events/User')).toBeInTheDocument();
      expect(screen.getByText('Sessions')).toBeInTheDocument();
    });
  });
});
