// src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service.ts
// 账龄扫描（spec §2.3）——withdraw-sla.service.ts 的同款形状：@Cron 每分钟（迪拜时区），
// 扫描逻辑与包装分开，测试直接调用；逐案 try/catch，单案失败不拖垮整轮。
// 到线动作只有两件：置标记 + 一条系统审计。状态不动、不推任何边（软破线）。
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../../audit-logging/dto/audit-log.dto';
import { AgingBreachCandidate, CaseAgingService } from '../workflow/case-aging.service';
import { resolveWalletNo } from '../domain/wallet-no.util';
import { ReconciliationCaseService } from '../domain/reconciliation-case.service';

@Injectable()
export class CaseAgingSweepService {
  private readonly logger = new Logger(CaseAgingSweepService.name);

  constructor(
    private readonly caseAging: CaseAgingService,
    private readonly caseService: ReconciliationCaseService,
    private readonly auditLogs: AuditLogsService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.checkAgingBreaches(new Date());
  }

  /** 返回本轮置了标记的案件数。 */
  async checkAgingBreaches(now: Date): Promise<number> {
    const candidates = await this.caseAging.findBreachCandidates(now);
    let breached = 0;
    for (const c of candidates) {
      try {
        await this.caseService.markSlaBreached(c.id);
        await this.auditBreached(c, now);
        breached += 1;
      } catch (err) {
        this.logger.error(`case aging sweep failed for ${c.caseNo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return breached;
  }

  private async auditBreached(c: AgingBreachCandidate, now: Date): Promise<void> {
    const walletNo = await resolveWalletNo(this.prisma, c.walletRef);
    const ageDays = Math.max(1, Math.floor((now.getTime() - c.slaDeadline.getTime()) / 86_400_000));
    await this.auditLogs.recordSystem({
      action: 'RECON_CASE_AGING_BREACHED',
      actionDomain: 'RECON',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.RECONCILIATION_CASE,
      primarySubjectNo: c.caseNo,
      subjects: [
        { subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: c.caseNo, subjectRole: AuditSubjectRole.PRIMARY },
        ...(walletNo ? [{ subjectType: AuditEntityTypes.WALLET, subjectNo: walletNo, subjectRole: AuditSubjectRole.RELATED }] : []),
      ],
      traceId: c.traceId ?? undefined,
      reason: `案件账龄到线（超期 ${ageDays} 天）——软破线，状态不动，等财务处置`,
      requestId: `RECON_CASE_AGING_BREACHED_${c.caseNo}_${randomUUID()}`,
      metadata: {
        slaDeadline: c.slaDeadline.toISOString(), ageDays, bucket: c.bucket, book: c.book, severity: c.severity, caseNo: c.caseNo,
      },
    } as any);
  }
}
