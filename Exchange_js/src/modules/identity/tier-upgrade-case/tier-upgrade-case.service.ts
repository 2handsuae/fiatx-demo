import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class TierUpgradeCaseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly sumsubClient: SumsubClient,
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

    await this.prisma.customerMain.update({
      where: { id: cra.customerId },
      data: {
        restrictionStatus: 'RESTRICTED',
        restrictionReason: 'tier_upgrade_pending_level2',
      },
    });

    if (customer.sumsubApplicantId) {
      try {
        await this.sumsubClient.moveToLevel(customer.sumsubApplicantId, 'wave3-level-2');
        await this.prisma.customerMain.update({
          where: { id: customer.id },
          data: { sumsubCurrentLevelName: 'wave3-level-2', sumsubExperiencedLevel2: true },
        });
      } catch (err) {
        console.error(`TierUpgradeCase moveToLevel failed for ${cra.customerId}:`, err);
      }
    }

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
        workflowId: upgradeCase.id,
        workflowNo: upgradeCase.caseNo,
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

    await this.prisma.tierUpgradeCase.update({
      where: { id: upgradeCase.id },
      data: {
        status: 'PENDING_PHASE2_APPROVAL',
        phase2ApprovalCaseId: approvalCase.id,
      },
    });
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
      await this.prisma.customerMain.update({
        where: { id: upgradeCase.customerId },
        data: {
          riskTier: 'HIGH',
          amlRiskTier: 'HIGH',
          riskTierUpdatedAt: new Date(),
          restrictionStatus: 'CLEAR',
          restrictionReason: null,
          latestRiskAssessmentId: upgradeCase.sourceCraId,
          latestRiskApprovalId: upgradeCase.phase2ApprovalCaseId,
          latestRiskApprovalStatus: 'APPROVED',
        },
      });
      await this.prisma.tierUpgradeCase.update({
        where: { id: upgradeCase.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    } else {
      await this.prisma.customerMain.update({
        where: { id: upgradeCase.customerId },
        data: {
          onboardingStatus: 'REJECTED',
          operatingStatus: 'INACTIVE',
          restrictionStatus: 'CLEAR',
          restrictionReason: null,
        },
      });
      await this.prisma.tierUpgradeCase.update({
        where: { id: upgradeCase.id },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });
    }
  }
}
