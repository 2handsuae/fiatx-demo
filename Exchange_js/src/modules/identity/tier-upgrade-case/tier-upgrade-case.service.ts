import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SumsubClient } from '../../sumsub-applicant-client/sumsub.client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

@Injectable()
export class TierUpgradeCaseService {
  private readonly logger = new Logger(TierUpgradeCaseService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly sumsubClient: SumsubClient,
    private readonly auditLogsService: AuditLogsService,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
  ) {}

  /**
   * Called when CRA is SIGNED as HIGH and previousTier was LOW.
   * Creates the upgrade case and restricts the customer.
   */
  async createFromCra(cra: { id: string; customerId: string; traceId: string }): Promise<any> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: cra.customerId },
    });
    if (!customer) return;

    const caseNo = generateReferenceNo('TUC');
    const traceId = `TIER_UPGRADE:${randomUUID()}`;

    const upgradeCase = await this.prisma.tierUpgradeCase.create({
      data: {
        caseNo,
        customerId: cra.customerId,
        sourceCraId: cra.id,
        status: 'PENDING_LEVEL2',
        traceId,
      },
    });

    // 摁住改贴便签：TIER_UPGRADE_PENDING（DISCLOSED，默认卡 WITHDRAW+SWAP，
    // 客户看到 "Additional review in progress"）。caseRef=本升级案 id ——
    // Phase 2 结案时只能凭这个键撕自己这张。原事务壳里只剩这一条写，已无意义，拆掉。
    await this.restrictionsService.open({
      customerId: cra.customerId,
      cause: 'TIER_UPGRADE_PENDING',
      reason: `Tier upgrade ${caseNo} pending Sumsub Level 2 + Phase 2 approval`,
      caseRef: upgradeCase.id,
      openedBy: 'SYSTEM',
    });

    if (customer.sumsubApplicantId) {
      try {
        await this.sumsubClient.moveToLevel(customer.sumsubApplicantId, 'wave3-level-2');
        await this.prisma.customerMain.update({
          where: { id: customer.id },
          data: { sumsubCurrentLevelName: 'wave3-level-2', sumsubExperiencedLevel2: true },
        });
      } catch (err) {
        this.logger.error(`TierUpgradeCase moveToLevel failed for ${cra.customerId}:`, err);
      }
    }

    await this.auditLogsService.recordSystem({
      action: 'TIER_UPGRADE_CASE_CREATED',
      primarySubjectType: 'TIER_UPGRADE_CASE',
      primarySubjectNo: upgradeCase.caseNo,
      traceId,
      metadata: { sourceCraId: cra.id },
    });

    return upgradeCase;
  }

  /**
   * Called when customer completes Sumsub Level 2 workflow.
   * Advances from PENDING_LEVEL2 → PENDING_PHASE2_APPROVAL.
   */
  async handleLevel2WorkflowComplete(customerId: string): Promise<void> {
    const upgradeCase = await this.prisma.tierUpgradeCase.findFirst({
      where: { customerId, status: 'PENDING_LEVEL2' },
      orderBy: { createdAt: 'desc' },
    });
    if (!upgradeCase) return;

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: 'RISK_RATING_TIER_UPGRADE_APPROVAL',
        entityRef: `tier_upgrade_case:${upgradeCase.id}`,
        traceId: upgradeCase.traceId,
        workflowType: 'TIER_UPGRADE',
        metadata: {
          caseId: upgradeCase.id,
          caseNo: upgradeCase.caseNo,
          sourceCraId: upgradeCase.sourceCraId,
          customerId,
        },
      } as any,
      { reason: `Phase 2 MLRO+SMO approval for tier upgrade ${upgradeCase.caseNo}` },
      { actorType: 'ADMIN', userId: 'SYSTEM', roleCodes: ['SUPER_ADMIN'] } as any,
    );

    try {
      await this.prisma.tierUpgradeCase.update({
        where: { id: upgradeCase.id },
        data: {
          status: 'PENDING_PHASE2_APPROVAL',
          phase2ApprovalCaseId: approvalCase.id,
        },
      });
    } catch (err) {
      this.logger.error(
        `TierUpgradeCase update failed after approval creation. caseId=${upgradeCase.id} approvalCaseId=${approvalCase.id}. Manual recovery needed.`,
        err,
      );
    }
  }

  /**
   * Called when Phase 2 approval (MLRO+SMO) is decided.
   * APPROVED → promote tier, clear restriction.
   * REJECTED → offboard customer.
   */
  async handleSignoffComplete(
    caseId: string,
    approvalResult: { status: string },
  ): Promise<void> {
    const upgradeCase = await this.prisma.tierUpgradeCase.findUnique({
      where: { id: caseId },
    });
    if (!upgradeCase) return;

    if (approvalResult.status === 'APPROVED') {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.customerMain.update({
          where: { id: upgradeCase.customerId },
          data: {
            riskRating: 'HIGH',
            riskRatingUpdatedAt: new Date(),
            latestRiskAssessmentId: upgradeCase.sourceCraId,
            latestRiskApprovalId: upgradeCase.phase2ApprovalCaseId,
            latestRiskApprovalStatus: 'APPROVED',
          },
        });
        await tx.tierUpgradeCase.update({
          where: { id: upgradeCase.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      });

      // 只撕自己那张（cause + caseRef 双键），不再无条件把客户清成 CLEAR ——
      // 客户身上若还挂着制裁/材料便签，升级通过不该把它们一起解开。
      await this.restrictionWorkflowService.autoRelease(
        upgradeCase.customerId,
        'TIER_UPGRADE_PENDING',
        upgradeCase.id,
        'SYSTEM',
      );

      await this.auditLogsService.recordSystem({
        action: 'TIER_UPGRADE_CASE_COMPLETED',
        primarySubjectType: 'TIER_UPGRADE_CASE',
        primarySubjectNo: upgradeCase.id,
        traceId: upgradeCase.traceId,
        metadata: { approvalCaseId: upgradeCase.phase2ApprovalCaseId },
      });
    } else {
      await this.prisma.tierUpgradeCase.update({
        where: { id: upgradeCase.id },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });

      // INV-1：升级审批被拒 ≠ 客户被拒户，lifecycle 不动（原来把入驻轴写成
      // REJECTED + 行政轴写成 INACTIVE，是把两件事混成了一件）。
      // 先贴新的 ADMIN_SUSPENSION、再撕旧的 TIER_UPGRADE_PENDING —— 顺序反了
      // 中间会出现一个客户完全不受限的窗口。
      await this.restrictionsService.open({
        customerId: upgradeCase.customerId,
        cause: 'ADMIN_SUSPENSION',
        reason: `Tier upgrade ${upgradeCase.caseNo} rejected at Phase 2 approval`,
        caseRef: upgradeCase.id,
        openedBy: 'SYSTEM',
      });
      await this.restrictionWorkflowService.autoRelease(
        upgradeCase.customerId,
        'TIER_UPGRADE_PENDING',
        upgradeCase.id,
        'SYSTEM',
      );

      await this.auditLogsService.recordSystem({
        action: 'TIER_UPGRADE_CASE_REJECTED',
        primarySubjectType: 'TIER_UPGRADE_CASE',
        primarySubjectNo: upgradeCase.id,
        traceId: upgradeCase.traceId,
        metadata: { approvalCaseId: upgradeCase.phase2ApprovalCaseId },
      });
    }
  }
}
