// src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts
// 平账 A 批（spec §2）：案件账龄——每张打开的案子一只钟。
//   起算 = 案件业务日日终；线 = RECON_AGING_DAYS；到线 = slaBreached 置 true（软破线，状态不动）。
//   复观察不重置（差异从第一次看见就在）；结案后标记随行保留。
// 第六幕波三（判据 4）：markBreached / walletNoOf / simulateTimeout 已搬进
// ReconciliationCaseService（Case 表写点全仓唯一文件）。本文件只剩候选扫描。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';

export interface AgingBreachCandidate {
  id: string; caseNo: string; walletRef: string | null; slaDeadline: Date;
  bucket: string | null; book: string | null; severity: string | null; traceId: string | null;
}

@Injectable()
export class CaseAgingService {
  constructor(private readonly prisma: PrismaService) {}

  /** 只扫 OPEN + 钱包引擎 + 未标记 + 已过线——置过标记的不再扫（一次性）。 */
  async findBreachCandidates(now: Date): Promise<AgingBreachCandidate[]> {
    const rows = await this.prisma.reconciliationCase.findMany({
      where: { status: 'OPEN', layer: 'WALLET', slaBreached: false, slaDeadline: { lt: now } },
      select: { id: true, caseNo: true, walletRef: true, slaDeadline: true, bucket: true, book: true, severity: true, traceId: true },
    });
    // where 里的 `slaDeadline: { lt: now }` 已把 null 排除在外，但 Prisma 的返回类型照样是
    // `Date | null`（它不做 where→select 的类型推导）。显式窄化，不用 `!`（本波禁非空断言）。
    return rows.filter((r): r is AgingBreachCandidate => r.slaDeadline !== null);
  }
}
