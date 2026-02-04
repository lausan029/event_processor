import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test('should display login form', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('text=Event Processor')).toBeVisible();
    await expect(page.locator('text=Sign in to access your dashboard')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button:has-text("Continue with Email")')).toBeVisible();
  });

  test('should validate email input', async ({ page }) => {
    await page.goto('/');
    
    const submitButton = page.locator('button:has-text("Continue with Email")');
    await expect(submitButton).toBeDisabled();
    
    await page.fill('input[type="email"]', 'test@example.com');
    await expect(submitButton).not.toBeDisabled();
  });

  test('should transition to code verification step', async ({ page }) => {
    await page.goto('/');
    
    // Mock the API response
    await page.route('**/auth/request-code', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'Code sent' } }),
      });
    });
    
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Continue with Email")');
    
    await expect(page.locator('text=Enter the verification code')).toBeVisible();
    await expect(page.locator('text=We sent a code to')).toBeVisible();
  });

  test('should allow going back to email step', async ({ page }) => {
    await page.goto('/');
    
    await page.route('**/auth/request-code', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'Code sent' } }),
      });
    });
    
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Continue with Email")');
    
    await page.click('text=Use a different email');
    await expect(page.locator('text=Sign in to access your dashboard')).toBeVisible();
  });

  test('should complete login with valid code', async ({ page }) => {
    await page.goto('/');
    
    // Mock request code
    await page.route('**/auth/request-code', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'Code sent' } }),
      });
    });
    
    // Mock verify code
    await page.route('**/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            token: 'test-jwt-token',
            user: { id: '1', email: 'test@example.com', role: 'USER' },
            message: 'Login successful',
          },
        }),
      });
    });
    
    // Mock analytics for dashboard
    await page.route('**/analytics/metrics*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            totalEvents: 1000,
            uniqueUsers: 50,
            uniqueSessions: 100,
            avgEventsPerUser: 20,
            eventsByType: [{ eventType: 'click', count: 500, percentage: 50 }],
            topUsers: [],
            eventsOverTime: [],
            timeRange: { start: new Date().toISOString(), end: new Date().toISOString() },
          },
        }),
      });
    });
    
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Continue with Email")');
    
    await expect(page.locator('text=Enter the verification code')).toBeVisible();
    
    // Fill code inputs
    const codeInputs = page.locator('input[type="text"][maxlength="1"]');
    for (let i = 0; i < 6; i++) {
      await codeInputs.nth(i).fill(String(i + 1));
    }
    
    // Should redirect to dashboard
    await expect(page.locator('text=Analytics Dashboard')).toBeVisible({ timeout: 10000 });
  });

  test('should show error for invalid code', async ({ page }) => {
    await page.goto('/');
    
    await page.route('**/auth/request-code', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'Code sent' } }),
      });
    });
    
    await page.route('**/auth/verify', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'INVALID_CODE', message: 'Invalid verification code' },
        }),
      });
    });
    
    await page.fill('input[type="email"]', 'test@example.com');
    await page.click('button:has-text("Continue with Email")');
    
    const codeInputs = page.locator('input[type="text"][maxlength="1"]');
    for (let i = 0; i < 6; i++) {
      await codeInputs.nth(i).fill('0');
    }
    
    await expect(page.locator('text=Invalid verification code')).toBeVisible();
  });
});

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Set up authenticated state
    await page.addInitScript(() => {
      localStorage.setItem('token', 'test-jwt-token');
      localStorage.setItem('user', JSON.stringify({ id: '1', email: 'test@example.com', role: 'USER' }));
    });
    
    // Mock analytics endpoint
    await page.route('**/analytics/metrics*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            totalEvents: 15000,
            uniqueUsers: 500,
            uniqueSessions: 800,
            avgEventsPerUser: 30,
            eventsByType: [
              { eventType: 'page_view', count: 8000, percentage: 53.3 },
              { eventType: 'click', count: 5000, percentage: 33.3 },
              { eventType: 'purchase', count: 2000, percentage: 13.3 },
            ],
            topUsers: [
              {
                userId: 'user_abc123',
                eventCount: 150,
                lastEventAt: new Date().toISOString(),
                eventTypes: ['page_view', 'click'],
              },
            ],
            eventsOverTime: [
              { timestamp: new Date(Date.now() - 3600000).toISOString(), count: 1000 },
              { timestamp: new Date().toISOString(), count: 1500 },
            ],
            timeRange: {
              start: new Date(Date.now() - 3600000).toISOString(),
              end: new Date().toISOString(),
            },
          },
        }),
      });
    });
  });

  test('should display dashboard with metrics', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('text=Analytics Dashboard')).toBeVisible();
    await expect(page.locator('text=Total Events')).toBeVisible();
    await expect(page.locator('text=Unique Users')).toBeVisible();
    await expect(page.locator('text=Events by Type')).toBeVisible();
  });

  test('should update metrics when time range changes', async ({ page }) => {
    let callCount = 0;
    
    await page.route('**/analytics/metrics*', async (route) => {
      callCount++;
      const url = route.request().url();
      const timeRange = url.includes('24h') ? '24h' : '1h';
      
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            totalEvents: timeRange === '24h' ? 50000 : 15000,
            uniqueUsers: 500,
            uniqueSessions: 800,
            avgEventsPerUser: 30,
            eventsByType: [],
            topUsers: [],
            eventsOverTime: [],
            timeRange: { start: '', end: '' },
          },
        }),
      });
    });
    
    await page.goto('/');
    await expect(page.locator('text=Analytics Dashboard')).toBeVisible();
    
    // Change time range
    await page.selectOption('select', '24h');
    
    // Wait for new data
    await expect(page.locator('text=50K')).toBeVisible({ timeout: 5000 });
    expect(callCount).toBeGreaterThan(1);
  });

  test('should toggle auto-refresh', async ({ page }) => {
    await page.goto('/');
    
    const autoRefreshButton = page.locator('button:has-text("Auto-refresh")');
    await expect(autoRefreshButton).toBeVisible();
    
    // Check initial state (enabled)
    await expect(autoRefreshButton).toHaveClass(/bg-green-50/);
    
    // Toggle off
    await autoRefreshButton.click();
    await expect(autoRefreshButton).toHaveClass(/bg-gray-50/);
    
    // Toggle back on
    await autoRefreshButton.click();
    await expect(autoRefreshButton).toHaveClass(/bg-green-50/);
  });
});
