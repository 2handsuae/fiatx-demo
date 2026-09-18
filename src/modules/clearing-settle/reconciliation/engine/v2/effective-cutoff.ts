// 「截止到某个时点，内部账上有哪些分录」——对账内部侧的取数口径。
//
//   ① 生效日 < 截止业务日            → 全进（更早的账期，已经定了）
//   ② 生效日 = 截止业务日 且 当时就写进来了（createdAt ≤ 截止时刻）→ 进
//   ③ 生效日 = 截止业务日 且 是**事后回填**（createdAt 晚于该业务日日终）→ 进
//
// ② 保住日内精度：以 6-26 12:00 为截止点对账，6-26 13:00 才发生的一笔不该算进来。
// ③ 是 2026-08-29 补的那一支，也是「生效日」这个字段存在的意义——8-29 才发现
// 8-28 的账记错了，调账单生效日写 8-28，重跑 8-28 的对账就该看见它。
//
// 为什么 ③ 必须单列、不能把 ② 的 createdAt 条件一删了事：删掉等于把日内精度也
// 一起扔了（上面那条 6-26 13:00 的分录会混进 12:00 的对账）。两件事的判别依据
// 不同：**同日当时写的**看物理时刻，**事后回填的**看「写入时刻已经越过那个业务日
// 的日终」——后者按定义就是回填，不可能是当天的正常流水。
//
// ⚠ 此前只有 ①②，注释写明 ② 是为了「保持现行为逐笔等价」的迁移期夹层。它的实际
// 效果是把所有回填挡在外面：调账单落了账、重跑对账内部余额一分没动、差额永远归不
// 了零、案子永远平不掉（2026-08-29 业主走查实证）。
import { toBusinessDate } from '../../../../accounting/tigerbeetle/utils/business-date.util';

export function effectiveCutoffFilter(cutoff: Date) {
  const businessDate = toBusinessDate(cutoff);
  const endOfBusinessDate = new Date(`${businessDate}T23:59:59.999Z`);
  return {
    OR: [
      { effectiveDate: { lt: businessDate } },
      { effectiveDate: businessDate, createdAt: { lte: cutoff } },
      { effectiveDate: businessDate, createdAt: { gt: endOfBusinessDate } },
    ],
  };
}
