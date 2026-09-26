// 战役甲波四 T5（spec §2）：闹钟墙——只读聚合两张表（regulatory_filings /
// compliance_obligations），不建新表、不写任何表（铁律③「横向读客户主数据放行」——本服务
// 是纯聚合读点，两个主体各自的写路径原样在各自服务里，本文件零 Prisma 写调用）。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FILING_CLOCK_WALL_STATUSES } from '../regulatory-filings/regulatory-filing.constants';
import { ObligationStatus } from './compliance-office.constants';

export interface ClockWallRow {
  kind: 'FILING' | 'OBLIGATION';
  refNo: string;
  title: string;
  authority: string;
  deadlineAt: string;
  overdue: boolean;
  status: string;
  linkKey: string;
}

@Injectable()
export class ComplianceClockWallService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * spec §2 行集判据（与既有 sweep 口径逐字对齐，不另起判定）：
   * - FILING 行：`deadlineAt != null && status ∈ {DRAFT, PENDING_SIGNOFF, SIGNED_OFF}`——
   *   按时提交/办结/作废即离开这三态、随之下墙；已被既有 sweep 标过 `overdueMarkedAt` 的
   *   单仍停在这三态之一（sweep 只标记不改状态），单条 where 天然覆盖它，红着留墙直到
   *   状态离开这三态才消——不必另加 overdueMarkedAt 过滤条件。
   * - OBLIGATION 行：`status = 'ACTIVE'`。DISABLED 不上墙；义务行只有绿/黄两色（阈值判定
   *   留给前端展示层，见 spec §2 颜色三档——阈值数字不入验收判据），红色由生成的工单行
   *   承担，故本行 overdue 恒 false。
   */
  async getWall(): Promise<ClockWallRow[]> {
    const [filings, obligations] = await Promise.all([
      this.prisma.regulatoryFiling.findMany({
        where: { deadlineAt: { not: null }, status: { in: FILING_CLOCK_WALL_STATUSES as string[] } },
        orderBy: { deadlineAt: 'asc' },
      }),
      this.prisma.complianceObligation.findMany({
        where: { status: ObligationStatus.ACTIVE },
        orderBy: { nextDueAt: 'asc' },
      }),
    ]);

    const filingRows: ClockWallRow[] = filings.map((f) => ({
      kind: 'FILING',
      refNo: f.filingNo,
      title: f.title,
      authority: f.authority,
      deadlineAt: (f.deadlineAt as Date).toISOString(),
      overdue: f.overdueMarkedAt != null,
      status: f.status,
      // 单号本身即点跳详情的 key（spec §6「单号/义务号点跳详情」）——不另编一套路由串,
      // 由消费该聚合端点的前端页面按 kind 决定跳到哪个既有详情路由。
      linkKey: f.filingNo,
    }));

    const obligationRows: ClockWallRow[] = obligations.map((o) => ({
      kind: 'OBLIGATION',
      refNo: o.obligationNo,
      title: o.name,
      authority: o.authority,
      deadlineAt: o.nextDueAt.toISOString(),
      overdue: false,
      status: o.status,
      linkKey: o.obligationNo,
    }));

    return [...filingRows, ...obligationRows];
  }
}
