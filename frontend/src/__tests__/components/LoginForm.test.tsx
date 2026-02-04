import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginForm } from '../../components/LoginForm';

// Mock useAuth hook
const mockLogin = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
  }),
}));

describe('LoginForm', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset();
    mockLogin.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Email Step', () => {
    it('should render email input initially', () => {
      render(<LoginForm />);
      
      expect(screen.getByText('Sign in to access your dashboard')).toBeInTheDocument();
      expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    });

    it('should have continue button', () => {
      render(<LoginForm />);
      
      expect(screen.getByRole('button', { name: /continue with email/i })).toBeInTheDocument();
    });

    it('should disable button when email is empty', () => {
      render(<LoginForm />);
      
      const button = screen.getByRole('button', { name: /continue with email/i });
      expect(button).toBeDisabled();
    });

    it('should enable button when email is entered', () => {
      render(<LoginForm />);
      
      const emailInput = screen.getByLabelText('Email address');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      
      const button = screen.getByRole('button', { name: /continue with email/i });
      expect(button).not.toBeDisabled();
    });

    it('should show error when request fails', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ 
          success: false, 
          error: { message: 'Invalid email' } 
        }),
      } as Response);
      
      render(<LoginForm />);
      
      const emailInput = screen.getByLabelText('Email address');
      fireEvent.change(emailInput, { target: { value: 'invalid@example.com' } });
      
      const button = screen.getByRole('button', { name: /continue with email/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(screen.getByText(/Invalid email|Failed to send code/)).toBeInTheDocument();
      });
    });

    it('should transition to code step on success', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ 
          success: true, 
          data: { message: 'Code sent' } 
        }),
      } as Response);
      
      render(<LoginForm />);
      
      const emailInput = screen.getByLabelText('Email address');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      
      const button = screen.getByRole('button', { name: /continue with email/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Enter the verification code')).toBeInTheDocument();
      });
    });
  });

  describe('Code Step', () => {
    async function goToCodeStep() {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ 
          success: true, 
          data: { message: 'Code sent' } 
        }),
      } as Response);
      
      render(<LoginForm />);
      
      const emailInput = screen.getByLabelText('Email address');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      
      const button = screen.getByRole('button', { name: /continue with email/i });
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(screen.getByText('Enter the verification code')).toBeInTheDocument();
      });
    }

    it('should display 6 code input fields', async () => {
      await goToCodeStep();
      
      const inputs = screen.getAllByRole('textbox');
      expect(inputs).toHaveLength(6);
    });

    it('should show success message', async () => {
      await goToCodeStep();
      
      expect(screen.getByText(/Verification code sent/)).toBeInTheDocument();
    });

    it('should have verify button', async () => {
      await goToCodeStep();
      
      expect(screen.getByRole('button', { name: /verify code/i })).toBeInTheDocument();
    });

    it('should allow going back to email step', async () => {
      await goToCodeStep();
      
      const backButton = screen.getByText(/Use a different email/);
      fireEvent.click(backButton);
      
      expect(screen.getByText('Sign in to access your dashboard')).toBeInTheDocument();
    });

    it('should call login on successful verification', async () => {
      await goToCodeStep();
      
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            token: 'jwt-token-123',
            user: { id: '1', email: 'test@example.com', role: 'USER' },
          },
        }),
      } as Response);
      
      const inputs = screen.getAllByRole('textbox');
      
      // Type code digits
      for (let i = 0; i < 6; i++) {
        const input = inputs[i];
        if (input) {
          fireEvent.change(input, { target: { value: String(i + 1) } });
        }
      }
      
      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalledWith('jwt-token-123', expect.any(Object));
      });
    });
  });
});
