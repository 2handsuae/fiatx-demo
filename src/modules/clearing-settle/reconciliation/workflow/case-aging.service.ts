// src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts
// 平账 A 批（spec §2）：案件账龄——每张打开的案子一只钟。
//   起算 = 案件业务日日终；线 = RECON_AGING_DAYS；到线 = slaBreached 置 true（软破线，状态不动）。
//   复观察不重置（差异从第一次看见就在）；结案后标记随行保留。
// 本文件是案件计时的主体方法（算截止 / 找候选 / 置标记 / ⚡拨钟）；@Cron 只在 sweep 文件里。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';

export interface AgingBreachCandidate {
  id: string; caseNo: string; walletRef: string | null; slaDeadline: Date;
  bucket: string | null; book: string | null; severity: string | null; traceId: string | null;
}

@Injectable()
export class CaseAgingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

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

  /** 软破线：只置标记，不碰 status（三域 SLA 同款，decisions.md 2026-08-21）。 */
  async markBreached(id: string): Promise<void> {
    await this.prisma.reconciliationCase.update({ where: { id }, data: { slaBreached: true } });
  }

  /** 钱包业务键——跨钱包合成案件的 'XREF:' 前缀不是真 Wallet.id，查了必空。 */
  async walletNoOf(walletRef: string | null): Promise<string | null> {
    if (!walletRef || String(walletRef).startsWith('XREF:')) return null;
    const w = await this.prisma.wallet.findUnique({ where: { id: walletRef }, select: { walletNo: true } });
    return w?.walletNo ?? null;
  }

  /**
   * ⚡拨钟（spec §2.4）：把截止拨到过去，下一分钟扫描即超期。端点本身**不置标记**——
   * 「到线」事件只有扫描一处来源。拨钟是 operator 的持久化动作（铁律①），记操作员审计，
   * 镜像充值域 DEPOSIT_SLA_TIMEOUT_SIMULATED。
   */
  async simulateTimeout(caseNo: string, actor: ApprovalActorContext): Promise<{ caseNo: string; slaDeadline: string }> {
    const kase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('已结案的案子没有账龄，拨不了钟');
    const previous: Date | null = kase.slaDeadline ?? null;
    const past = new Date(Date.now() - 1000);
    await this.prisma.reconciliationCase.update({ where: { id: kase.id }, data: { slaDeadline: past } });

    const walletNo = await this.walletNoOf(kase.walletRef);
    const actorDisplay = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(
      {
        action: 'RECON_AGING_TIMEOUT_SIMULATED',
        actionDomain: 'RECON',
        category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.RECONCILIATION_CASE,
        primarySubjectNo: caseNo,
        subjects: [
          { subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: caseNo, subjectRole: AuditSubjectRole.PRIMARY },
          ...(walletNo ? [{ subjectType: AuditEntityTypes.WALLET, subjectNo: walletNo, subjectRole: AuditSubjectRole.RELATED }] : []),
        ],
        traceId: kase.traceId ?? undefined,
        reason: '演示：把案件账龄截止拨到过去，下一分钟扫描即超期',
        requestId: `RECON_AGING_TIMEOUT_SIMULATED_${caseNo}_${randomUUID()}`,
        metadata: { previousSlaDeadline: previous ? previous.toISOString() : null, newSlaDeadline: past.toISOString() },
        sourcePlatform: 'ADMIN',
      } as any,
      { actorType: 'ADMIN', actorNo: actorDisplay, actorDisplayName: actorDisplay, actorRolesAtTime: actor.roleCodes ?? [] },
    );
    return { caseNo, slaDeadline: past.toISOString() };
  }
}
