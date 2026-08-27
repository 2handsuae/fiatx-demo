// material-refresh.service.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { SumsubClient } from '../../sumsub-applicant-client/sumsub.client';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { getRequiredMaterialsForLevel } from './policy/get-required-materials';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';
import { MaterialRequestIssuerService } from '../material-requests/material-request-issuer.service';
import { MaterialRequestsService } from '../material-requests/material-requests.service';
import type { ReviewOutcome } from '../material-requests/material-request-review.service';

/** 材料请求账裁决的三种结局，与 `MaterialRequestReviewService.ReviewOutcome` 同源。 */
type CycleReviewOutcome = ReviewOutcome;

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
  private readonly logger = new Logger(MaterialRefreshService.name);

  /** Property-injected to avoid circular deps — reserved for future use */

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
    private readonly sumsubClient: SumsubClient,
    private readonly policyLoader: MaterialRefreshPolicyLoader,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
    // 2026-08-17 材料请求账：T-30 建行改走统一下发编排入口（issuer），
    // T-0 升档在同一行上补挂限制改走 MaterialRequestsService.attachRestriction。
    private readonly issuer: MaterialRequestIssuerService,
    private readonly materialRequests: MaterialRequestsService,
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
      // T-30 建行**不挂限制** —— 证件还没过期，只是提醒（设计稿 §5.3）。
      // 到 T-0 由升档逻辑在**同一行上**补挂便签，认证链接全程不变。
      const { requestNo } = await this.issuer.issue({
        customerId: holding.customerId,
        materialType: holding.materialType,
        orderDomain: null,
        orderRef: null,
        restrict: false,
        origin: 'SYSTEM_SCHEDULED',
        reason: `${holding.materialType} expires on ${holding.expiresAt?.toISOString().slice(0, 10) ?? 'unknown'}`,
        issuedBy: 'SYSTEM',
        actor: { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
      });
      await this.prisma.materialRefreshCycle.update({
        where: { id: cycle.id },
        data: { materialRequestNo: requestNo },
      });
    } catch (err) {
      this.logger.error(
        `Failed to issue material request for cycle ${cycle.cycleNo}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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

    const cycle = await this.prisma.materialRefreshCycle.update({
      where: { id: holding.activeRefreshCycleId },
      data: { stage: 'BLOCKING', stageBlockingAt: new Date() },
    });

    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    if (materialConfig?.enforceRestriction && cycle.materialRequestNo) {
      // 同一行补挂便签 —— **不重新下发**。客户手里那个认证链接从 T-30 到
      // T-0 必须不变；重新下发会让 Sumsub 侧多一条 action、老的还悬着，
      // 客户还会收到第二个链接（设计稿 §5.3）。caseRef 用 materialRequestNo，
      // 与 MaterialRequestIssuerService 自己开便签时的键保持一致 —— 后面
      // GREEN 自动撕（MaterialRequestReviewService.applyReview）按便签自己的
      // caseRef 撕，两条路径都对。
      //
      // 放在这里（而不是仅 cron 的 BLOCKING 分支）是因为 enterBlockingStage 还
      // 有另外两个调用方——admin 手工模拟（simulate-stage T_0）与
      // handleSumsubDocMonitoringFire（Sumsub 主动上报证件过期）——三条路都要
      // 同一套「补挂到材料账」的行为，放单一入口才不会有路径漏挂。
      const { restrictionNo } = await this.restrictionWorkflowService.openRestriction(
        {
          customerId: holding.customerId,
          cause: 'MATERIAL_EXPIRED',
          reason: `${holding.materialType} expired — trading restricted until refreshed`,
          caseRef: cycle.materialRequestNo,
          openedBy: 'SYSTEM',
        },
        { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
      );
      await this.materialRequests.attachRestriction(cycle.materialRequestNo, restrictionNo);
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

    // INV-1：ACTIVE 的唯一出口是 OFFBOARDED。客户并没有「撤回申请」，是平台单方
    // 终止补料周期 —— 原来把入驻轴写成 WITHDRAWN 是语义错。改为不动 lifecycle，
    // 贴 ADMIN_SUSPENSION 便签（DISCLOSED / OPS_APPROVAL 解除）。真要终止关系走销户。
    await this.restrictionsService.open({
      customerId: cycle.customerId,
      cause: 'ADMIN_SUSPENSION',
      reason: `Material refresh cycle ${cycle.cycleNo} terminated: ${reason}`,
      caseRef: cycle.id,
      openedBy: 'SYSTEM',
    });

    await this.prisma.customerMaterialHolding.updateMany({
      where: { activeRefreshCycleId: cycle.id },
      data: { activeRefreshCycleId: null, status: 'EXPIRED' },
    });
  }

  /**
   * 材料请求账自己的入口（2026-08-18 修）—— `MaterialRefreshReviewListener`
   * 按 `materialRequestNo` 查到属于本域的 cycle 后调这里,传的是已经拿在手上
   * 的 cycle 行,不用再猜 Sumsub 侧 actionId。
   */
  async completeCycleFromMaterialRequest(
    cycleId: string,
    outcome: CycleReviewOutcome,
  ): Promise<void> {
    const cycle = await this.prisma.materialRefreshCycle.findFirst({
      where: { id: cycleId, status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] } },
    });
    if (!cycle) return;
    await this.completeCycleReview(cycle, outcome);
  }

  /**
   * 两个入口（actionId 查 / cycle 直传）共用的收尾本体。
   *
   * - APPROVED（GREEN）：关周期、刷新 holding 到期日、自动撕便签、CRA 级联。
   * - RETRY（RED + 同一 action 重交）：cycle **不**转终态，退回
   *   PENDING_CUSTOMER_EVIDENCE 等下一次；便签原地不动。
   * - REJECTED（RED + FINAL）：这一行审不过就是没解开，cycle 收 REJECTED
   *   终态；便签同样原地不动（撕不撕是材料账自己的规矩，不归本域管）。
   *   同时清掉 holding 上的 `activeRefreshCycleId`——不清的话
   *   `enterNotifiedStage()` 的守卫（`if (holding.activeRefreshCycleId) return`）
   *   会一直以为还有一个"活跃"周期，实际它已经终态死掉，holding 永远开不出
   *   下一个周期，客户被晾在原地（terminateCycle() 已有的同款收尾，这里对齐
   *   同一套规矩）。
   */
  private async completeCycleReview(
    cycle: Record<string, any>,
    outcome: CycleReviewOutcome,
  ): Promise<void> {
    // RETRY: reset status back to PENDING_CUSTOMER_EVIDENCE for retry
    if (outcome === 'RETRY') {
      await this.prisma.materialRefreshCycle.update({
        where: { id: cycle.id },
        data: { status: 'PENDING_CUSTOMER_EVIDENCE', customerSubmittedAt: null },
      });
      return;
    }

    if (outcome === 'REJECTED') {
      // 两次写必须同一事务：进程若崩在两次写之间，cycle 落 REJECTED 终态但
      // holding.activeRefreshCycleId 仍指向它，enterNotifiedStage() 的守卫会把
      // 这个 holding 永久挡在下一轮重检门外（本任务一直在防的卡死故障类型）。
      await this.prisma.$transaction(async (tx: Record<string, any>) => {
        await tx.materialRefreshCycle.update({
          where: { id: cycle.id },
          data: { status: 'REJECTED', rejectedAt: new Date(), resolutionReason: 'sumsub_final_reject' },
        });
        await tx.customerMaterialHolding.updateMany({
          where: { activeRefreshCycleId: cycle.id },
          data: { activeRefreshCycleId: null },
        });
      });
      return;
    }

    // APPROVED (GREEN): close cycle and refresh holding
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

    // 自动撕：cause + caseRef 双键定位，只撕本周期贴的那张 MATERIAL_EXPIRED。
    // 客户身上别的因（SANCTION / ADMIN_SUSPENSION / TIER_UPGRADE_PENDING）一概不动
    // ——「多因不互相解」，这正是旧的单列合规态模型做不到、
    // 也正是整套限制账设计存在的理由。
    // caseRef 用 materialRequestNo，不是 cycle.id —— enterBlockingStage 补挂那张
    // 便签时就是拿 materialRequestNo 当 caseRef 开的（2026-08-17 材料请求账），
    // 这里必须用同一个键才能撕到它。
    await this.restrictionWorkflowService.autoRelease(
      customer.id,
      'MATERIAL_EXPIRED',
      cycle.materialRequestNo,
      'SYSTEM',
    );

    // Note: In the 3-state CRA design, material submission completion is handled by
    // TierUpgradeCaseService.handleLevel2WorkflowComplete (triggered by Sumsub Level 2 webhook)

    // 站6：一期 CRA 已拆除（业主方案2）——刷新清账后自动起风评的钩子随之移除。
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
        // T-30 建行**不挂限制** —— 证件还没过期，只是提醒（设计稿 §5.3）。
        // 到 T-0 由升档逻辑在**同一行上**补挂便签，认证链接全程不变。
        const { requestNo } = await this.issuer.issue({
          customerId,
          materialType,
          orderDomain: null,
          orderRef: null,
          restrict: false,
          origin: 'SYSTEM_SCHEDULED',
          reason: `${materialType} expires on ${newHolding.expiresAt?.toISOString().slice(0, 10) ?? 'unknown'}`,
          issuedBy: 'SYSTEM',
          actor: { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
        });
        await this.prisma.materialRefreshCycle.update({
          where: { id: cycle.id },
          data: { materialRequestNo: requestNo },
        });
      } catch (err) {
        this.logger.error(
          `Failed to issue material request for cycle ${cycle.cycleNo}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
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

  /**
   * 站6：档位模拟的操作留痕（打点位置守则——审计调用只许住 service，
   * admin-material-management.controller 调本方法）。原以一行假风评行当 trail，
   * CRA 表随一期拆除后改写注册词 CUSTOMER_TIER_CHANGE_SIMULATED（操作员通道）。
   */
  async auditTierChangeSimulated(input: {
    customerNo: string;
    previousTier: string;
    targetTier: string;
    targetLevel: number;
    operatorId: string;
  }): Promise<void> {
    await this.auditLogsService.recordByActor(
      {
        action: 'CUSTOMER_TIER_CHANGE_SIMULATED',
        actionDomain: 'CUSTOMER',
        primarySubjectType: 'CUSTOMER',
        primarySubjectNo: input.customerNo,
        ownerCustomerNo: input.customerNo,
        subjects: [
          { subjectType: 'CUSTOMER', subjectNo: input.customerNo, subjectRole: 'PRIMARY' },
        ],
        reason: `Simulated tier change ${input.previousTier} → ${input.targetTier} (level ${input.targetLevel})`,
        requestId: `CUSTOMER_TIER_CHANGE_SIMULATED_${input.customerNo}_${Date.now()}`,
        metadata: { previousTier: input.previousTier, targetTier: input.targetTier, targetLevel: input.targetLevel },
        sourcePlatform: 'ADMIN_API',
      } as any,
      { actorType: 'ADMIN', actorNo: input.operatorId, actorDisplayName: input.operatorId, actorRolesAtTime: ['ADMIN'] } as any,
    );
  }
}
