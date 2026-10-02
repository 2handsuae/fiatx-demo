const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';
// Task 5：会话层只认关系是否终止。原先的 CUSTOMER_ACCOUNT_FROZEN 已废除 ——
// 被制裁/受限客户的会话照常放行，前端不再有任何「你被冻结了」的分支可走
// （那正是 tipping-off）。只剩「关系已终止」这一种硬拒。
const ACCOUNT_CLOSED_CODE = 'CUSTOMER_ACCOUNT_CLOSED';
const ACCOUNT_CLOSED_MESSAGE = 'This account has been closed.';
// 战役丙波三 T5/T8：能力闸的「请先同意客户协议」是 403，但它是客户自己的选择、不是会话失效——
// 必须原样交给调用方，页面才能在错误条里附 /agreement 引导；若走下面的会话失效分支，
// 客户会被清 token 踢回登录页，调用方的 catch 还会把 CustomerSessionError 吞掉。
export const AGREEMENT_NOT_ACCEPTED_CODE = 'AGREEMENT_NOT_ACCEPTED';

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

  if (code === ACCOUNT_CLOSED_CODE) {
    persistLoginNotice(code, message || ACCOUNT_CLOSED_MESSAGE);
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
    if (response.status === 403 && code === AGREEMENT_NOT_ACCEPTED_CODE) return response;
    const message =
      String(payload.message || '').trim() ||
      (code === ACCOUNT_CLOSED_CODE ? ACCOUNT_CLOSED_MESSAGE : SESSION_EXPIRED_MESSAGE);

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

/** 读错误体里的机器码（体非 JSON 或无 code → null），与 getCustomerApiErrorMessage 读同一份 body（clone，可重复读）。 */
export const getCustomerApiErrorCode = async (response: Response): Promise<string | null> => {
  const payload = await readJsonSafely(response);
  return typeof payload.code === 'string' && payload.code.trim() ? payload.code : null;
};
