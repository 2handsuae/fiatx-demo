const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';
const ACCOUNT_FROZEN_CODE = 'CUSTOMER_ACCOUNT_FROZEN';
const ACCOUNT_FROZEN_MESSAGE =
  'Your account is frozen. Please contact WhatsApp support for assistance.';

export class CustomerSessionError extends Error {
  code?: string;
  status?: number;

  constructor(message = SESSION_EXPIRED_MESSAGE, options?: { code?: string; status?: number }) {
    super(message);
    this.name = 'CustomerSessionError';
    this.code = options?.code;
    this.status = options?.status;
  }
}

const readJsonSafely = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const payload = (await response.clone().json()) as Record<string, unknown>;
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
};

const persistLoginNotice = (code: string, message: string) => {
  sessionStorage.setItem(
    'customer_login_notice',
    JSON.stringify({
      code,
      message,
    }),
  );
};

const redirectToLogin = (message: string, code?: string) => {
  localStorage.removeItem('customer_token');

  if (code === ACCOUNT_FROZEN_CODE) {
    persistLoginNotice(code, message || ACCOUNT_FROZEN_MESSAGE);
  }

  window.dispatchEvent(new Event('customer-auth-changed'));

  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
};

export const customerFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    requireAuth?: boolean;
    redirectOnAuthFailure?: boolean;
  } = {},
): Promise<Response> => {
  const { requireAuth = true, redirectOnAuthFailure = true } = options;
  const token = localStorage.getItem('customer_token');

  if (requireAuth && !token) {
    if (redirectOnAuthFailure) {
      redirectToLogin(SESSION_EXPIRED_MESSAGE);
    }
    throw new CustomerSessionError();
  }

  const headers = new Headers(init.headers || {});
  if (requireAuth && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (requireAuth && (response.status === 401 || response.status === 403)) {
    const payload = await readJsonSafely(response);
    const code = String(payload.code || '').trim().toUpperCase();
    const message =
      String(payload.message || '').trim() ||
      (code === ACCOUNT_FROZEN_CODE ? ACCOUNT_FROZEN_MESSAGE : SESSION_EXPIRED_MESSAGE);

    if (redirectOnAuthFailure) {
      redirectToLogin(message, code || undefined);
    }

    throw new CustomerSessionError(message, { code, status: response.status });
  }

  return response;
};

export const getCustomerApiErrorMessage = async (
  response: Response,
  fallback = 'Request failed.',
): Promise<string> => {
  const payload = await readJsonSafely(response);
  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return fallback;
};
