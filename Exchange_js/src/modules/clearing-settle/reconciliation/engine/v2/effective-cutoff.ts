// 等价保真复合过滤式（spec §3）：
//   生效日 < 截止日 → 全进（平账回填的账落这段）
//   生效日 = 截止日 → 仍按物理写入时刻卡截止点（保持现行为逐笔等价）
// 证明：存量数据满足 effectiveDate == date(createdAt) 时 ⟺ 旧式 createdAt ≤ cutoff。
import { toBusinessDate } from '../../../../accounting/tigerbeetle/utils/business-date.util';

export function effectiveCutoffFilter(cutoff: Date) {
  const businessDate = toBusinessDate(cutoff);
  return {
    OR: [
      { effectiveDate: { lt: businessDate } },
      { effectiveDate: businessDate, createdAt: { lte: cutoff } },
    ],
  };
}
