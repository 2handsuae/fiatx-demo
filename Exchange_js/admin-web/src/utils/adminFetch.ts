const SESSION_EXPIRED_MESSAGE = 'Session expired, please sign in again.';
const PERMISSION_DENIED_MESSAGE = 'Permission denied for this action.';

export class AdminSessionError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = 'AdminSessionError';
  }
}

export class AdminPermissionError extends Error {
  constructor(message = PERMISSION_DENIED_MESSAGE) {
    super(message);
    this.name = 'AdminPermissionError';
  }
}

const redirectToLogin = (message: string) => {
  localStorage.removeItem('admin_token');
  localStorage.setItem('admin_login_error', message);
  window.dispatchEvent(new Event('admin-auth-changed'));
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
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    redirectToLogin(SESSION_EXPIRED_MESSAGE);
    throw new AdminSessionError();
  }

  if (response.status === 403) {
    throw new AdminPermissionError(PERMISSION_DENIED_MESSAGE);
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
