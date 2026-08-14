/**
 * 归一化客户的 capability 级限制集合（parity 2026-08-14）。
 *
 * 运行时 user.restrictions 的元素是后端写入的 {capability, reason} 对象；
 * 类型声明滞后写成 string[]（useCustomerProfile.ts:19），Profile 页曾因直接
 * join 渲染出 "[object Object]"。两种形状都容——AuthGuard / Swap / Withdraw
 * 三处共用本函数，防止各自归一化逻辑分叉。
 */
export function restrictedCapabilities(user: unknown): Set<string> {
  const restrictions = (user as { restrictions?: unknown } | null | undefined)?.restrictions;
  if (!Array.isArray(restrictions)) return new Set();
  return new Set(
    restrictions
      .map((r) =>
        typeof r === 'string' ? r : ((r as { capability?: string })?.capability ?? ''),
      )
      .filter(Boolean),
  );
}

/** 某能力是否被限制（含 ALL 通配）。 */
export function isCapabilityRestricted(user: unknown, capability: string): boolean {
  const caps = restrictedCapabilities(user);
  return caps.has(capability) || caps.has('ALL');
}
