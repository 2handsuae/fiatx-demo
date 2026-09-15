/**
 * 客户可见时间线构建器（tipping-off 红线件，spec §3）。
 * raw statusHistory 只在服务端内存里过一道：每条 toStatus 过该域收敛函数，
 * 收敛后与上一条同态整条丢弃——冻结/执法骚动被去重规则吞没，冻结单时间线
 * 与普通单不可区分（不变式见 spec 同节，测试有变异式断言）。
 */
export function buildCustomerTimeline(
  rawStatusHistory: string | null,
  birthStatus: string,
  createdAt: Date | string,
  collapse: (status: string) => string,
): Array<{ status: string; at: string }> {
  const bornAt = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
  const out: Array<{ status: string; at: string }> = [
    { status: collapse(birthStatus), at: bornAt },
  ];
  let entries: any[] = [];
  try {
    entries = rawStatusHistory ? JSON.parse(rawStatusHistory) : [];
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  for (const e of entries) {
    const status = typeof e?.status === 'string' ? e.status : null;
    const at = typeof e?.timestamp === 'string' ? e.timestamp : null;
    if (!status || !at) continue;
    const collapsed = collapse(status);
    if (collapsed === out[out.length - 1].status) continue;
    out.push({ status: collapsed, at });
  }
  return out;
}
