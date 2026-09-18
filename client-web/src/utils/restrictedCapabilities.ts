/**
 * 客户端能力限制读取器 —— 唯一数据源是后端算好的 user.disclosedBlocked。
 *
 * 前端【永远拿不到】blocked：CustomerAccess 有 blocked（服务端执法用，含 SILENT）
 * 和 disclosedBlocked（客户面用，仅 DISCLOSED）两个字段，客户面 DTO 只允许序列化
 * 后者。因此 SILENT 限制（SANCTION / KYT_REJECTED_HARD）在这里天然不可见，被制裁
 * 客户的 disclosedBlocked 是空数组，Swap/Withdraw 按钮照常可点、不置灰 ——
 * 这是设计而非遗漏：置灰本身就是"你被查了"的信号，属 tipping off，在多数反洗钱
 * 法域是刑事犯罪。真正的拦截由后端 L1 能力门（CAPABILITY_RESTRICTED）执行，客户
 * 看到的是与网络失败逐字相同的中性文案。
 *
 * 不要在本文件里补任何"更全"的数据源，也不要按 lifecycle / 交易状态兜底推导。
 */
export function restrictedCapabilities(user: unknown): Set<string> {
  const disclosedBlocked = (user as { disclosedBlocked?: unknown } | null | undefined)
    ?.disclosedBlocked;
  if (!Array.isArray(disclosedBlocked)) return new Set();
  return new Set(
    disclosedBlocked.filter((c): c is string => typeof c === 'string' && c.length > 0),
  );
}

/** 某能力是否被限制（含 ALL 通配）。 */
export function isCapabilityRestricted(user: unknown, capability: string): boolean {
  const caps = restrictedCapabilities(user);
  return caps.has(capability) || caps.has('ALL');
}
