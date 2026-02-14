const SESSION_EXPIRED_MESSAGE = 'Session expired, please sign in again.';

export class AdminSessionError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = 'AdminSessionError';
  }
}

const redirectToLogin = (message: string) => {
  localStorage.removeItem('admin_token');
  localStorage.setItem('admin_login_error', message);
  window.location.href = '/admin/login';
};

export const adminFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> => {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    redirectToLogin(SESSION_EXPIRED_MESSAGE);
    throw new AdminSessionError();
  }

  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401 || response.status === 403) {
    redirectToLogin(SESSION_EXPIRED_MESSAGE);
    throw new AdminSessionError();
  }

  return response;
};

export const getApiErrorMessage = async (
  response: Response,
  fallback = 'Request failed.',
): Promise<string> => {
  try {
    const payload = await response.json();
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
  } catch {
    // ignore
  }
  return fallback;
};

