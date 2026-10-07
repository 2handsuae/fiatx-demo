// 战役甲波二 · 报送台骨架（spec §8，Task 7）：超时 sweep + 持久软标。
// 模板：swap-sla.service.ts —— @Cron 包装 + sweep(now) 逻辑分离（测试直调不等真钟）、
// 逐笔 try/catch（单笔失败不拖垮批次）、auditLogsService.recordSystem 系统留痕。
//
// 审计信封没有走 RegulatoryFilingService.recordAudit（Task 3 的 private helper，跨 service
// 不可复用）——照 swap-sla.service.ts 先例直调 auditLogsService.recordSystem。
// FILING_OVERDUE_MARKED 声明 requiredFields=['deadlineAt']；assertActionSpec 只查 input
// 顶层字段（audit-logs.service.ts assertActionSpec），故 deadlineAt 在 input 顶层展开；
// 顶层字段建库时不落专列，所以整备波 C 起 deadlineAt 同时镜像进 metadata（R5 判例修法：
// 顶层校验形态保留、审计行本身可查"超的是哪个截止时刻"）。
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { FilingStatus } from './regulatory-filing.constants';

@Injectable()
export class RegulatoryFilingSweepService {
  private readonly logger = new Logger(RegulatoryFilingSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  @Cron('*/30 * * * * *')
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  /**
   * 核心扫描逻辑，与 @Cron 包装分开，测试里直接调用不必等真实时钟。
   * 扫描条件（spec §8 逐字）：deadlineAt < now && overdueMarkedAt == null &&
   * status IN (DRAFT, PENDING_SIGNOFF, SIGNED_OFF)。命中落 overdueMarkedAt=now + 审计一条
   * FILING_OVERDUE_MARKED。按时提交过的单子（SUBMITTED/CLOSED/CANCELLED）不在扫描状态
   * 集合内，永不误标；已标过的单子 overdueMarkedAt 非空，天然不再匹配，标记留着不清。
   * 单笔处理失败（含审计写入失败）不能拖垮整个 sweep：逐笔 try/catch，记录后继续下一单。
   */
  async sweep(now: Date = new Date()): Promise<{ marked: number }> {
    const stale = await this.prisma.regulatoryFiling.findMany({
      where: {
        deadlineAt: { lt: now },
        overdueMarkedAt: null,
        status: { in: [FilingStatus.DRAFT, FilingStatus.PENDING_SIGNOFF, FilingStatus.SIGNED_OFF] },
      },
    });

    let marked = 0;
    for (const row of stale) {
      try {
        await this.prisma.regulatoryFiling.update({
          where: { filingNo: row.filingNo },
          data: { overdueMarkedAt: now },
        });
        await this.auditLogs.recordSystem({
          action: AuditActions.FILING_OVERDUE_MARKED,
          actionDomain: 'GOVERNANCE',
          category: AuditCategory.GOVERNANCE,
          workflowType: AuditBusinessWorkflowTypes.REGULATORY_FILING,
          primarySubjectType: AuditEntityTypes.REGULATORY_FILING,
          primarySubjectNo: row.filingNo,
          subjects: [
            { subjectType: AuditEntityTypes.REGULATORY_FILING, subjectNo: row.filingNo, subjectRole: AuditSubjectRole.PRIMARY },
          ],
          correlationId: row.traceId,
          deadlineAt: row.deadlineAt!.toISOString(),
          reason: `Filing deadline passed without submission (status=${row.status})`,
          metadata: { filingNo: row.filingNo, type: row.type, status: row.status, deadlineAt: row.deadlineAt!.toISOString() },
          requestId: `FILING_OVERDUE_MARKED_${row.filingNo}_${randomUUID()}`,
          sourcePlatform: 'SYSTEM',
        } as any);
        marked += 1;
      } catch (err) {
        this.logger.error(
          `regulatory filing overdue sweep failed for ${row.filingNo}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (marked) {
      this.logger.log(`regulatory filing overdue sweep: marked=${marked}`);
    }
    return { marked };
  }
}
