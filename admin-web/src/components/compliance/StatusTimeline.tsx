import { User } from 'lucide-react';

/** `get*StatusMeta()` 返回值里本组件用到的两个字段。三域各传自己的函数。 */
export interface StatusMetaView {
  badgeClass: string;
  label: string;
}

/**
 * 订单状态历史时间线（充值 / 提现 / 兑换三域共用）。
 *
 * 合并自三份已漂移的本地副本（第五批 §8）。合并规则不是「挑一份留下」：
 *   · 守卫取兑换那份 —— Array.isArray + 不可变排序 + 日期兜底。合并前充值与提现
 *     两份都没有这三样，statusHistory 存进非数组 JSON 会让 sort 抛错、整页白屏。
 *   · 读字段取提现那份的兜底链 —— 后端三域写入形状不同：
 *       充值 {status, timestamp, operatorId, actorType, actorRole, reason, context}
 *             —— deposit-transactions.service.ts 的 updateStatus
 *       提现 {status, timestamp, operator, note}
 *             —— withdraw-transactions.service.ts 的 updateStatus
 *       兑换 {status, timestamp, operator, note}
 *             —— swap-transactions.service.ts 的状态跃迁收口
 *       提现还有**第四种**：{from, to, action, timestamp} —— **没有 status 字段**，
 *             由 withdraw-transactions.service.ts 的 createMockData() 写，经
 *             POST /withdraw-transactions/mock 可达。所以下面读状态用
 *             `item.status || item.to`（`to` 就是这条记录的落点状态，语义等价）。
 *             ⚠️ 2026-08-23 订正：此处原写「三种全覆盖 / 不要以为有第四种」是**错的** ——
 *             漏了这条，命中时 getStatusMeta(undefined) 落 fallback、徽章渲染成空白。
 *   · item.changedAt 是历史字段名，当前后端四条写入路径都不写（grep src/ 零命中），
 *     保留纯属防御。
 *   · 颜色与文案由各域传进来的 getStatusMeta 决定 —— 合并前兑换那份硬编码
 *     bg-adm-green + 显示原始枚举，同一条 FROZEN 事件充值页红、兑换页绿。
 */
export const StatusTimeline = ({
  historyJson,
  getStatusMeta,
}: {
  historyJson: string | null;
  getStatusMeta: (status: string) => StatusMetaView;
}) => {
  if (!historyJson) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
  }

  let history: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(historyJson);
    if (!Array.isArray(parsed)) {
      return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
    }
    history = [...parsed].sort(
      (a, b) =>
        new Date(b.timestamp || b.changedAt || 0).getTime() -
        new Date(a.timestamp || a.changedAt || 0).getTime(),
    );
  } catch {
    return <div className="p-4 text-sm text-adm-red">Error parsing history</div>;
  }

  if (history.length === 0) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No events</div>;
  }

  return (
    <div className="relative my-2 ml-4 space-y-6 border-l-2 border-adm-border">
      {history.map((item, idx) => (
        <div key={`${idx}-${item.timestamp || item.changedAt || ''}`} className="relative ml-8">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
            <div className={`h-3 w-3 rounded-full ${getStatusMeta(item.status || item.to).badgeClass}`} />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${getStatusMeta(item.status || item.to).badgeClass}`}>
                {getStatusMeta(item.status || item.to).label}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">
              {item.note || item.reason || 'No reason provided'}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
              <User size={10} />
              <span className="font-mono">
                {item.operator || item.operatorId || item.actorType || 'SYSTEM'}
              </span>
              <span>·</span>
              <time className="font-mono">
                {new Date(item.timestamp || item.changedAt || 0).toLocaleString()}
              </time>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
