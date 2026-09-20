// src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts
//
// 第六幕波三（主体分层，判据 4 本体）：Case 主体的唯一写点。
// recon-run / case-aging 现有对 reconciliationCase 表的直写，由 Task 2/4 换线到
// 这里——本任务只建服务与测试，不接线，新旧写点短暂并存是预期状态。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditCategory, AuditSubjectRole } from '../../../audit-logging/dto/audit-log.dto';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { ReconBucket } from '../engine/v2/bucket-classifier';
import { CaseStatus, CASE_TRANSITIONS } from '../constants/case-transitions.constant';

export interface OpenCaseInput {
  runId: string; businessDate: string; assetId: string; assetCode: string; layer: string;
  book: string; walletRef: string; coaCode: string | null; ownerNo: string | null;
  tbAmount: Prisma.Decimal; inTransitAmount: Prisma.Decimal; expectedExternal: Prisma.Decimal;
  actualExternal: Prisma.Decimal; deltaAmount: Prisma.Decimal;
  severity: string; bucket: ReconBucket; slaDeadline: Date;
  traceId: string | null;   // run 的 traceId，只喂审计
  delta: bigint;            // 只喂审计 metadata.deltaAmount
}

export interface ReObserveInput {
  caseId: string; runId: string;
  tbAmount: Prisma.Decimal; inTransitAmount: Prisma.Decimal; expectedExternal: Prisma.Decimal;
  actualExternal: Prisma.Decimal; deltaAmount: Prisma.Decimal;
  severity: string; bucket: ReconBucket;
  assetId: string; assetCode: string; book: string; coaCode: string | null; ownerNo: string | null;
}

@Injectable()
export class ReconciliationCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  assertTransition(from: string, to: string): void {
    const allowed = CASE_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Illegal reconciliation case status transition: ${from} → ${to}`);
    }
  }

  /** = recon-run 现 upsertCaseForWallet 里的探针原样：唯一开口的存在性检查。 */
  async findOpenByWallet(walletRef: string): Promise<{ id: string; caseNo: string } | null> {
    return this.prisma.reconciliationCase.findFirst({
      where: {
        walletRef,
        status: 'OPEN',
      },
      select: { id: true, caseNo: true },
    });
  }

  async openCase(input: OpenCaseInput): Promise<{ caseId: string; caseNo: string }> {
    // Format: REC{YYYYMMDD}-{nnn}. Sequence counts ALL cases for the
    // businessDate — collision-safe. Asset/wallet info is in the detail page.
    const priorToday = await this.prisma.reconciliationCase.count({
      where: { businessDate: input.businessDate },
    });
    const caseNo = `REC${input.businessDate.replace(/-/g, '')}-${String(priorToday + 1).padStart(3, '0')}`;
    const createdRow = await this.prisma.reconciliationCase.create({
      data: {
        caseNo,
        businessDate: input.businessDate,
        assetId: input.assetId,
        assetCode: input.assetCode,
        layer: input.layer,
        book: input.book,
        tbAmount: input.tbAmount,
        inTransitAmount: input.inTransitAmount,
        expectedExternal: input.expectedExternal,
        actualExternal: input.actualExternal,
        deltaAmount: input.deltaAmount,
        status: 'OPEN',
        openedByRunId: input.runId,
        lastObservedRunId: input.runId,
        // T1 fields: pin the first observer + last updater (initially same).
        firstSeenRunId: input.runId,
        lastUpdatedRunId: input.runId,
        severity: input.severity,
        bucket: input.bucket,
        traceId: randomUUID(),
        walletRef: input.walletRef,
        coaCode: input.coaCode,
        ownerNo: input.ownerNo,
        // 平账 A 批（spec §2.1）：账龄起算只在开案这一刻——复观察不重置，
        // 故 slaDeadline 只在这个 create 分支写。
        slaDeadline: input.slaDeadline,
      },
    });
    const caseId = createdRow.id;

    await this.auditCaseOpened({
      traceId: input.traceId,
      walletRef: input.walletRef,
      bucket: input.bucket,
      delta: input.delta,
      caseNo,
      slaDeadline: input.slaDeadline,
    });

    return { caseId, caseNo };
  }

  async reObserve(input: ReObserveInput): Promise<void> {
    await this.prisma.reconciliationCase.update({
      where: { id: input.caseId },
      data: {
        // Snapshot fields → reflect THIS run's measurement, not history.
        tbAmount: input.tbAmount,
        inTransitAmount: input.inTransitAmount,
        expectedExternal: input.expectedExternal,
        actualExternal: input.actualExternal,
        deltaAmount: input.deltaAmount,
        severity: input.severity,
        bucket: input.bucket,
        // Locator fields can drift if a wallet's owner/coa changes
        // mid-stream; keep them current for the cockpit.
        assetId: input.assetId,
        assetCode: input.assetCode,
        book: input.book,
        coaCode: input.coaCode,
        ownerNo: input.ownerNo,
        // Bookkeeping. firstSeenRunId stays as-is (pin the original observer).
        lastUpdatedRunId: input.runId,
        lastObservedRunId: input.runId,
      },
    });
  }

  async resolveAutoHealed(input: { caseId: string; caseNo: string; walletRef: string; runId: string; traceId: string | null; resolvedAt: Date }): Promise<void> {
    const row = await this.prisma.reconciliationCase.findUnique({
      where: { id: input.caseId },
      select: { status: true },
    });
    if (!row) throw new NotFoundException(`对账案件不存在：${input.caseId}`);
    this.assertTransition(row.status, CaseStatus.RESOLVED);

    await this.prisma.reconciliationCase.update({
      where: { id: input.caseId },
      data: {
        status: 'RESOLVED',
        resolutionReason: 'AUTO_HEALED',
        resolvedAt: input.resolvedAt,
        lastUpdatedRunId: input.runId,
        closedByRunId: input.runId,
      },
    });
    await this.auditCaseAutoHealed({ traceId: input.traceId, walletRef: input.walletRef, caseNo: input.caseNo });
  }

  /** 软破线：只置标记，不碰 status（三域 SLA 同款，decisions.md 2026-08-21）。= case-aging markBreached 原样。 */
  async markSlaBreached(id: string): Promise<void> {
    await this.prisma.reconciliationCase.update({ where: { id }, data: { slaBreached: true } });
  }

  // ── Audit (DI — never `new AuditLogsService`) ─────────────────────────────
  private async auditCaseOpened(input: { traceId: string | null; walletRef: string; bucket: ReconBucket; delta: bigint; caseNo: string; slaDeadline: Date }): Promise<void> {
    await this.auditLogs.recordSystem({
      action: 'RECON_CASE_OPENED',
      actionDomain: 'RECON',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.RECONCILIATION_CASE,
      primarySubjectNo: input.caseNo,
      subjects: [
        { subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: input.caseNo, subjectRole: AuditSubjectRole.PRIMARY },
      ],
      traceId: input.traceId ?? undefined,
      requestId: `RECON_CASE_OPENED_${input.caseNo}_${randomUUID()}`,
      metadata: {
        walletRef: input.walletRef,
        bucket: input.bucket,
        deltaAmount: input.delta.toString(),
        caseNo: input.caseNo,
        slaDeadline: input.slaDeadline.toISOString(),
      },
    });
  }

  private async auditCaseAutoHealed(input: { traceId: string | null; walletRef: string; caseNo: string }): Promise<void> {
    await this.auditLogs.recordSystem({
      action: 'RECON_CASE_AUTO_HEALED',
      actionDomain: 'RECON',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.RECONCILIATION_CASE,
      primarySubjectNo: input.caseNo,
      subjects: [
        { subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: input.caseNo, subjectRole: AuditSubjectRole.PRIMARY },
      ],
      traceId: input.traceId ?? undefined,
      requestId: `RECON_CASE_AUTO_HEALED_${input.caseNo}_${randomUUID()}`,
      metadata: { walletRef: input.walletRef, caseNo: input.caseNo },
    });
  }
}
