// material-refresh.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { getRequiredMaterialsForLevel } from './policy/get-required-materials';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Normalize Sumsub level names (e.g. "level2" → "wave3-level-2") to match policy config */
function normalizeLevelName(raw: string): string {
  if (raw.startsWith('wave3-')) return raw;
  if (raw === 'level2' || raw === 'level-2') return 'wave3-level-2';
  if (raw === 'level1' || raw === 'level-1') return 'wave3-level-1';
  return `wave3-${raw}`;
}

@Injectable()
export class MaterialRefreshService {
  /** Property-injected to avoid circular deps — reserved for future use */
  clientRiskAssessmentService?: Record<string, any>;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
    private readonly policyLoader: MaterialRefreshPolicyLoader,
  ) {}

  async enterNotifiedStage(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding || holding.activeRefreshCycleId) return;

    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    if (!materialConfig) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: holding.customerId },
    });
    if (!customer?.sumsubApplicantId) return;

    const cycleNo = generateReferenceNo('MRC');
    const cycle = await this.prisma.materialRefreshCycle.create({
      data: {
        cycleNo,
        customerId: holding.customerId,
        holdingId: holding.id,
        materialType: holding.materialType,
        status: 'PENDING_CUSTOMER_EVIDENCE',
        stage: 'NUDGE_ONLY',
        triggerType: 'SCHEDULED_EXPIRY',
        stageNudgeAt: new Date(),
        graceExpiresAt: addDays(holding.expiresAt || new Date(), 30),
        traceId: `MATERIAL_REFRESH:${randomUUID()}`,
      },
    });

    try {
      const action = await this.sumsubClient.createApplicantAction({
        applicantId: customer.sumsubApplicantId,
        levelName: materialConfig.sumsubActionLevelName,
      });
      await this.prisma.materialRefreshCycle.update({
        where: { id: cycle.id },
        data: {
          sumsubActionId: action.id,
          sumsubActionLevelName: materialConfig.sumsubActionLevelName,
          sumsubActionCreatedAt: new Date(),
        },
      });
    } catch (err) {
      console.error(`Failed to create Sumsub action for cycle ${cycle.id}:`, err);
    }

    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: { activeRefreshCycleId: cycle.id, status: 'REFRESH_IN_PROGRESS' },
    });
  }

  async escalateToUrgent(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding?.activeRefreshCycleId) {
      return this.enterNotifiedStage(holdingId);
    }
    await this.prisma.materialRefreshCycle.update({
      where: { id: holding.activeRefreshCycleId },
      data: { stage: 'URGENT', stageUrgentAt: new Date() },
    });
  }

  async enterBlockingStage(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding) return;
    if (!holding.activeRefreshCycleId) {
      await this.enterNotifiedStage(holdingId);
      return this.enterBlockingStage(holdingId);
    }

    await this.prisma.materialRefreshCycle.update({
      where: { id: holding.activeRefreshCycleId },
      data: { stage: 'BLOCKING', stageBlockingAt: new Date() },
    });

    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    if (materialConfig?.enforceRestriction) {
      await this.prisma.customerMain.update({
        where: { id: holding.customerId },
        data: {
          complianceStatus: 'FROZEN',
          complianceFreezeReason: `material_expired:${holding.materialType}`,
        },
      });
    }

    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: { status: 'EXPIRED' },
    });
  }

  async terminateCycle(cycleId: string, reason: string): Promise<void> {
    const cycle = await this.prisma.materialRefreshCycle.findFirst({
      where: { id: cycleId, status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] } },
    });
    if (!cycle) return;

    await this.prisma.materialRefreshCycle.update({
      where: { id: cycle.id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        resolutionReason: reason,
      },
    });

    await this.prisma.customerMain.update({
      where: { id: cycle.customerId },
      data: {
        onboardingStatus: 'WITHDRAWN',
        adminStatus: 'INACTIVE',
      },
    });

    await this.prisma.customerMaterialHolding.updateMany({
      where: { activeRefreshCycleId: cycle.id },
      data: { activeRefreshCycleId: null, status: 'EXPIRED' },
    });
  }

  async handleSumsubActionResult(event: {
    actionId: string;
    reviewResult: { reviewAnswer: 'GREEN' | 'RED'; reviewRejectType?: string };
  }): Promise<void> {
    const cycle = await this.prisma.materialRefreshCycle.findFirst({
      where: { sumsubActionId: event.actionId, status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] } },
    });
    if (!cycle) return;

    // RED: reset status back to PENDING_CUSTOMER_EVIDENCE for retry
    if (event.reviewResult.reviewAnswer === 'RED') {
      await this.prisma.materialRefreshCycle.update({
        where: { id: cycle.id },
        data: { status: 'PENDING_CUSTOMER_EVIDENCE', customerSubmittedAt: null },
      });
      return;
    }

    // GREEN: close cycle and refresh holding
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: cycle.holdingId },
    });
    if (!holding) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: holding.customerId },
    });
    if (!customer) return;

    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    let newExpiresAt: Date | null = null;

    if (holding.managementMode === 'SUMSUB_MANAGED' && customer.sumsubApplicantId) {
      const snapshot = await this.sumsubClient.getApplicant(customer.sumsubApplicantId);
      const idDoc = (snapshot as any).info?.idDocs?.find(
        (d: any) => this.mapSumsubDocToMaterialType(d) === holding.materialType,
      );
      if (idDoc?.validUntil) newExpiresAt = new Date(idDoc.validUntil);
    }
    // Fallback: use policy windowDays (covers SELF_MANAGED + SUMSUB_MANAGED mock mode with no doc date)
    if (!newExpiresAt && materialConfig?.windowDays) {
      const days = materialConfig.windowDays[customer.riskRating as string];
      if (days) newExpiresAt = addDays(new Date(), days);
    }

    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: {
        verifiedAt: new Date(),
        expiresAt: newExpiresAt,
        status: 'FRESH',
        activeRefreshCycleId: null,
      },
    });

    await this.prisma.materialRefreshCycle.update({
      where: { id: cycle.id },
      data: {
        status: 'CLEARED',
        clearedAt: new Date(),
        resolutionReason: 'customer_refreshed',
      },
    });

    // Release compliance freeze if this cycle caused it
    if (
      customer.complianceStatus === 'FROZEN' &&
      customer.complianceFreezeReason === `material_expired:${holding.materialType}`
    ) {
      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: { complianceStatus: 'CLEAR', complianceFreezeReason: null },
      });
    }

    // Note: In the 3-state CRA design, material submission completion is handled by
    // TierUpgradeCaseService.handleLevel2WorkflowComplete (triggered by Sumsub Level 2 webhook)

    // NEW — periodic refresh fully cleared → kick off fresh CRA
    if (this.clientRiskAssessmentService) {
      const anyPendingExpiryCycle = await this.prisma.materialRefreshCycle.count({
        where: {
          customerId: customer.id,
          triggerType: 'SCHEDULED_EXPIRY',
          status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] },
        },
      });
      if (anyPendingExpiryCycle === 0) {
        try {
          await this.clientRiskAssessmentService.startAssessment({
            customerId: customer.id,
            triggerType: 'SCHEDULED_QUARTERLY',
            triggeredContext: { reason: 'material_refresh_complete' },
          });
        } catch (err) {
          console.error(`material-refresh→CRA trigger failed for ${customer.id}:`, String(err));
        }
      }
    }
  }

  async handleSumsubDocMonitoringFire(event: { applicantId: string }): Promise<void> {
    const customer = await this.prisma.customerMain.findFirst({
      where: { sumsubApplicantId: event.applicantId },
    });
    if (!customer?.sumsubApplicantId) return;

    const snapshot = await this.sumsubClient.getApplicant(customer.sumsubApplicantId);
    const expiredDocs = ((snapshot as any).info?.idDocs || []).filter(
      (d: any) => d.validUntil && new Date(d.validUntil) <= new Date(),
    );

    for (const idDoc of expiredDocs) {
      const materialType = this.mapSumsubDocToMaterialType(idDoc);
      if (!materialType) continue;

      const holding = await this.prisma.customerMaterialHolding.findUnique({
        where: { customerId_materialType: { customerId: customer.id, materialType } },
      });
      if (!holding || holding.activeRefreshCycleId) continue;

      await this.enterBlockingStage(holding.id);
    }
  }

  async recomputeHoldingsForCustomer(
    customerId: string,
    levelName: string,
  ): Promise<any[]> {
    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId },
    });
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];

    const policy = this.policyLoader.getPolicy();
    const createdCycles: any[] = [];

    // Recompute expiresAt for SELF_MANAGED holdings (window size is still per risk tier)
    for (const holding of holdings) {
      if (holding.managementMode !== 'SELF_MANAGED') continue;
      const config = policy.materials[holding.materialType];
      if (!config?.windowDays) continue;
      const newWindow = config.windowDays[customer.riskRating as string];
      if (!newWindow) continue;

      const newExpiresAt = addDays(holding.verifiedAt, newWindow);
      if (!holding.expiresAt || newExpiresAt.getTime() !== holding.expiresAt.getTime()) {
        await this.prisma.customerMaterialHolding.update({
          where: { id: holding.id },
          data: { expiresAt: newExpiresAt },
        });
      }
    }

    // Check for missing required materials
    const required = getRequiredMaterialsForLevel(normalizeLevelName(levelName), policy);
    const existingTypes = new Set(holdings.map((h: any) => h.materialType));
    for (const h of holdings) {
      const cfg = policy.materials[h.materialType];
      if (cfg?.alternativeOf) existingTypes.add(cfg.alternativeOf);
    }

    for (const materialType of required) {
      if (existingTypes.has(materialType)) continue;

      const newHolding = await this.prisma.customerMaterialHolding.create({
        data: {
          holdingNo: generateReferenceNo('CMH'),
          customerId,
          materialType,
          managementMode: policy.materials[materialType].managementMode,
          verifiedAt: new Date(),
          expiresAt: null,
          status: 'MISSING',
        },
      });

      const materialConfig = policy.materials[materialType];
      const gracePeriodDays = 14;

      if (!customer.sumsubApplicantId) continue;

      const cycleNo = generateReferenceNo('MRC');
      const cycle = await this.prisma.materialRefreshCycle.create({
        data: {
          cycleNo,
          customerId,
          holdingId: newHolding.id,
          materialType,
          status: 'PENDING_CUSTOMER_EVIDENCE',
          stage: 'NUDGE_ONLY',
          triggerType: 'INITIAL_COLLECTION',
          stageNudgeAt: new Date(),
          graceExpiresAt: addDays(new Date(), gracePeriodDays),
          traceId: `MATERIAL_REFRESH:${randomUUID()}`,
        },
      });

      try {
        const action = await this.sumsubClient.createApplicantAction({
          applicantId: customer.sumsubApplicantId,
          levelName: materialConfig.sumsubActionLevelName,
        });
        await this.prisma.materialRefreshCycle.update({
          where: { id: cycle.id },
          data: {
            sumsubActionId: action.id,
            sumsubActionLevelName: materialConfig.sumsubActionLevelName,
            sumsubActionCreatedAt: new Date(),
          },
        });
      } catch (err) {
        console.error(`Failed to create initial action for ${cycle.id}:`, err);
      }

      await this.prisma.customerMaterialHolding.update({
        where: { id: newHolding.id },
        data: { activeRefreshCycleId: cycle.id, status: 'REFRESH_IN_PROGRESS' },
      });

      createdCycles.push(cycle);
    }

    return createdCycles;
  }

  /**
   * Seed initial holdings for a freshly onboarded customer.
   * Materials start as FRESH with correct expiresAt — no cycle needed yet.
   */
  async seedInitialHoldings(customerId: string, levelName: string): Promise<void> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return;

    const policy = this.policyLoader.getPolicy();
    const required = getRequiredMaterialsForLevel(normalizeLevelName(levelName), policy);
    const existing = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId },
      select: { materialType: true },
    });
    const existingTypes = new Set(existing.map((h: any) => h.materialType));

    for (const materialType of required) {
      if (existingTypes.has(materialType)) continue;

      const config = policy.materials[materialType];
      if (!config) continue;

      let expiresAt: Date | null = null;
      if (config.windowDays) {
        const days = config.windowDays[customer.riskRating as string];
        if (days) {
          // Demo: randomize between 30% and 90% of window for varied expiry dates
          const randomFraction = 0.3 + Math.random() * 0.6;
          expiresAt = addDays(new Date(), Math.floor(days * randomFraction));
        }
      }

      await this.prisma.customerMaterialHolding.create({
        data: {
          holdingNo: generateReferenceNo('CMH'),
          customerId,
          materialType,
          managementMode: config.managementMode,
          verifiedAt: new Date(),
          expiresAt,
          status: 'FRESH',
        },
      });
    }
  }

  private mapSumsubDocToMaterialType(idDoc: any): string | null {
    if (idDoc.idDocType === 'ID_CARD' && idDoc.country === 'ARE') return 'EMIRATES_ID';
    if (idDoc.idDocType === 'PASSPORT') return 'PASSPORT';
    return null;
  }
}
