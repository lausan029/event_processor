/**
 * Authentication API client
 */

const API_BASE = '/api';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface RequestCodeResponse {
  message: string;
}

interface VerifyResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  message: string;
}

interface ApiKeyResponse {
  apiKey: string;
  keyId: string;
  message: string;
}

export async function requestCode(email: string): Promise<ApiResponse<RequestCodeResponse>> {
  const response = await fetch(`${API_BASE}/auth/request-code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  return response.json() as Promise<ApiResponse<RequestCodeResponse>>;
}

export async function verifyCode(
  email: string,
  code: string
): Promise<ApiResponse<VerifyResponse>> {
  const response = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, code }),
  });

  return response.json() as Promise<ApiResponse<VerifyResponse>>;
}

export async function generateApiKey(
  token: string,
  name?: string
): Promise<ApiResponse<ApiKeyResponse>> {
  const response = await fetch(`${API_BASE}/auth/api-key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });

  return response.json() as Promise<ApiResponse<ApiKeyResponse>>;
}
