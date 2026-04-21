export const AUDIT_MASK_VERSION = 'v1';

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'privatekey',
  'authorization',
  'apiKey',
]);

const EMAIL_KEYS = new Set(['email']);
const PHONE_KEYS = new Set(['phone', 'mobile', 'tel']);
const ID_KEYS = new Set(['idNo', 'idNumber', 'passportNo', 'identityNo']);
const ADDRESS_KEYS = new Set(['address', 'walletAddress']);
const BANK_KEYS = new Set(['iban', 'bankAccount', 'accountNumber', 'cardNumber']);
const IP_KEYS = new Set(['ip', 'sourceIp', 'clientIp']);

function normalizeKey(key: string): string {
  return String(key || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function maskEmail(input: string): string {
  const value = String(input || '');
  const idx = value.indexOf('@');
  if (idx <= 0) return '***';
  const local = value.slice(0, idx);
  const domain = value.slice(idx + 1);
  const maskedLocal = `${local.charAt(0)}***`;
  return `${maskedLocal}@${domain}`;
}

function maskTail(input: string, keep = 4): string {
  const value = String(input || '');
  if (value.length <= keep) return '*'.repeat(value.length || 3);
  return `${'*'.repeat(Math.max(0, value.length - keep))}${value.slice(-keep)}`;
}

function maskWallet(input: string): string {
  const value = String(input || '');
  if (value.length <= 10) return maskTail(value, 2);
  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

function maskIp(input: string): string {
  const value = String(input || '').trim();
  if (!value) return value;

  if (value.includes('.')) {
    const parts = value.split('.');
    if (parts.length === 4) {
      parts[3] = '0';
      return parts.join('.');
    }
  }

  if (value.includes(':')) {
    const parts = value.split(':');
    const half = Math.floor(parts.length / 2);
    return parts
      .map((part, index) => (index >= half ? '****' : part))
      .join(':');
  }

  return '***';
}

function maskByKey(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = normalizeKey(key);

  if (SENSITIVE_KEYS.has(normalized)) return '***';
  if (EMAIL_KEYS.has(normalized)) return maskEmail(value);
  if (PHONE_KEYS.has(normalized)) return maskTail(value, 4);
  if (ID_KEYS.has(normalized)) return maskTail(value, 4);
  if (ADDRESS_KEYS.has(normalized)) return maskWallet(value);
  if (BANK_KEYS.has(normalized)) return maskTail(value, 4);
  if (IP_KEYS.has(normalized)) return maskIp(value);

  return value;
}

function deepMask(value: unknown, currentKey?: string): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => deepMask(item));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const maskedByKey = maskByKey(key, item);
      result[key] = deepMask(maskedByKey, key);
    });
    return result;
  }

  if (typeof value === 'string' && currentKey) {
    return maskByKey(currentKey, value);
  }

  return value;
}

export function maskAuditPayload<T>(value: T): T {
  return deepMask(value) as T;
}

export function maskIpAddress(value?: string | null): string | null {
  if (!value) return null;
  return maskIp(value);
}
