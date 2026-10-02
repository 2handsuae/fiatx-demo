import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerSessionError, customerFetch } from './customerFetch';

// 战役丙波三 T8：能力闸的 AGREEMENT_NOT_ACCEPTED 是 403，但它是「请先同意协议」的业务拒绝、不是会话失效。
// customerFetch 对 401/403 一律当会话失效（清 token + 跳登录 + 抛 CustomerSessionError），
// 调用方 catch 里 `instanceof CustomerSessionError → return` 会把它吞掉——客户被踢回登录页，看不到任何引导。
// 故该 code 必须原样放行给调用方；其余 403 / 401 行为不动（本文件第二、三条锁住「不扩大放行范围」）。

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('customerFetch · 协议拦截 403 不当会话失效', () => {
  let store: Map<string, string>;
  let location: { pathname: string; href: string };

  beforeEach(() => {
    store = new Map([['customer_token', 'tkn']]);
    location = { pathname: '/swap', href: 'http://localhost/swap' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal('sessionStorage', { setItem: () => undefined });
    vi.stubGlobal('window', { dispatchEvent: () => true, location });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('403 + AGREEMENT_NOT_ACCEPTED → 原样返回响应（体可读），不清 token、不跳登录、不抛', async () => {
    const message = 'Please review and accept the current customer agreement before continuing.';
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { code: 'AGREEMENT_NOT_ACCEPTED', message })));

    const res = await customerFetch('http://api/swap-transactions/quotes', { method: 'POST', body: '{}' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'AGREEMENT_NOT_ACCEPTED', message });
    expect(store.get('customer_token')).toBe('tkn');
    expect(location.href).toBe('http://localhost/swap');
  });

  it('403 + 其它 code（如 CAPABILITY_RESTRICTED）→ 行为不变：抛 CustomerSessionError 并跳登录', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { code: 'CAPABILITY_RESTRICTED', message: 'x' })));

    await expect(customerFetch('http://api/swap-transactions/quotes')).rejects.toBeInstanceOf(CustomerSessionError);
    expect(store.has('customer_token')).toBe(false);
    expect(location.href).toBe('/login');
  });

  it('401 → 行为不变：抛 CustomerSessionError 并跳登录', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { message: 'Unauthorized' })));

    await expect(customerFetch('http://api/x')).rejects.toBeInstanceOf(CustomerSessionError);
    expect(store.has('customer_token')).toBe(false);
  });
});
