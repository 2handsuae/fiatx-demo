import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
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

    let upgradeCase: any;
    await this.prisma.$transaction(async (tx: any) => {
      upgradeCase = await tx.tierUpgradeCase.create({
        data: {
          caseNo,
          customerId: cra.customerId,
          sourceCraId: cra.id,
          status: 'PENDING_LEVEL2',
          traceId,
        },
      });

      await tx.customerMain.update({
        where: { id: cra.customerId },
        data: {
          complianceStatus: 'FROZEN',
          complianceFreezeReason: 'tier_upgrade_pending_level2',
        },
      });
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
      workflowType: 'TIER_UPGRADE',
      entityType: 'TIER_UPGRADE_CASE',
      entityId: upgradeCase?.id,
      entityNo: upgradeCase?.caseNo,
      traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: cra.customerId,
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
            complianceStatus: 'CLEAR',
            complianceFreezeReason: null,
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

      await this.auditLogsService.recordSystem({
        action: 'TIER_UPGRADE_CASE_COMPLETED',
        workflowType: 'TIER_UPGRADE',
        entityType: 'TIER_UPGRADE_CASE',
        entityId: upgradeCase.id,
        traceId: upgradeCase.traceId,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: upgradeCase.customerId,
        metadata: { approvalCaseId: upgradeCase.phase2ApprovalCaseId },
      });
    } else {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.customerMain.update({
          where: { id: upgradeCase.customerId },
          data: {
            onboardingStatus: 'REJECTED',
            adminStatus: 'INACTIVE',
            complianceStatus: 'CLEAR',
            complianceFreezeReason: null,
          },
        });
        await tx.tierUpgradeCase.update({
          where: { id: upgradeCase.id },
          data: { status: 'REJECTED', rejectedAt: new Date() },
        });
      });

      await this.auditLogsService.recordSystem({
        action: 'TIER_UPGRADE_CASE_REJECTED',
        workflowType: 'TIER_UPGRADE',
        entityType: 'TIER_UPGRADE_CASE',
        entityId: upgradeCase.id,
        traceId: upgradeCase.traceId,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: upgradeCase.customerId,
        metadata: { approvalCaseId: upgradeCase.phase2ApprovalCaseId },
      });
    }
  }
}
