import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { SumsubClient } from '../../sumsub-applicant-client/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ONBOARDING_LEVELS, ONBOARDING_LEVEL_TEMPLATES } from '../constants/onboarding-level.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { assertTierUpgradeTransition, TierUpgradeStatus } from './tier-upgrade.constant';

const OPEN_STATUSES: TierUpgradeStatus[] = ['IN_REVIEW', 'MATERIALS_CLEARED'];

/** 客户 actor 投影（与 onboarding 客户面同款口径）。 */
const customerActor = (c: { customerNo: string }) => ({
  actorType: 'CUSTOMER' as const,
  actorNo: c.customerNo,
  actorDisplayName: c.customerNo,
  actorRolesAtTime: ['CUSTOMER'],
});

@Injectable()
export class TierUpgradeWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly sumsubClient: SumsubClient,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async loadCustomer(customerId: string) {
    const c = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  private audit(action: string, c: { customerNo: string }, extra: Record<string, unknown>, byCustomer = true) {
    const payload = {
      action,
      actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER,
      primarySubjectNo: c.customerNo,
      ownerCustomerNo: c.customerNo,
      requestId: `${action}_${c.customerNo}_${randomUUID()}`,
      sourcePlatform: byCustomer ? 'CLIENT_API' : 'SYSTEM',
      ...extra,
    } as any;
    return byCustomer
      ? this.auditLogsService.recordByActor(payload, customerActor(c))
      : this.auditLogsService.recordSystem(payload);
  }

  /** 客户发起：建单 + applicant 换 PREMIUM 档（我方主动换档，spec §3）。 */
  async apply(customerId: string): Promise<{ upgradeNo: string }> {
    const c = await this.loadCustomer(customerId);
    if (c.lifecycle !== 'ACTIVE') throw new BadRequestException('Tier upgrade requires an active customer');
    if (c.tradingTier !== 'BASIC') throw new BadRequestException('Only BASIC customers can request an upgrade');
    const open = await this.prisma.tierUpgradeApplication.findFirst({
      where: { customerId, status: { in: OPEN_STATUSES } },
    });
    if (open) throw new BadRequestException(`Upgrade already in progress: ${open.upgradeNo}`);
    let applicantId = c.sumsubApplicantId;
    if (!applicantId) {
      const created = await this.sumsubClient.createApplicant({ externalUserId: c.customerNo, levelName: ONBOARDING_LEVELS.PREMIUM });
      applicantId = created.id;
    }
    await this.sumsubClient.changeLevel(applicantId!, ONBOARDING_LEVELS.PREMIUM);
    const upgradeNo = generateReferenceNo('TUP');
    await this.prisma.$transaction(async (tx) => {
      await tx.tierUpgradeApplication.create({
        data: { upgradeNo, customerId, status: 'IN_REVIEW', fromTier: 'BASIC', toTier: 'PREMIUM' },
      });
      await this.customers.updateOnboardingData(customerId,
        { sumsubApplicantId: applicantId!, sumsubCurrentLevelName: ONBOARDING_LEVELS.PREMIUM }, tx);
    });
    await this.audit(AuditActions.TIER_UPGRADE_APPLIED, c, {
      afterData: { upgradeNo, fromTier: 'BASIC', toTier: 'PREMIUM', levelName: ONBOARDING_LEVELS.PREMIUM },
    });
    return { upgradeNo };
  }

  /** Profile 档位卡片数据（客户面白名单：stage 派生词，内部 status 不出）。 */
  async getOverview(customerId: string) {
    const c = await this.loadCustomer(customerId);
    const app = await this.prisma.tierUpgradeApplication.findFirst({
      where: { customerId }, orderBy: { createdAt: 'desc' },
    });
    const rules = await this.prisma.transactionLimitRule.findMany({
      where: { gateType: 'CUMULATIVE' }, orderBy: [{ operationType: 'asc' }, { period: 'asc' }],
    });
    const byKey = new Map<string, { operationType: string; period: string; basicLimit?: string; premiumLimit?: string }>();
    for (const r of rules) {
      const k = `${r.operationType}|${r.period}`;
      const row = byKey.get(k) ?? { operationType: r.operationType, period: r.period! };
      if (r.tradingTier === 'BASIC') row.basicLimit = r.defaultLimit?.toString();
      if (r.tradingTier === 'PREMIUM') row.premiumLimit = r.defaultLimit?.toString();
      byKey.set(k, row);
    }
    const stage = !app ? null
      : app.status === 'IN_REVIEW' ? (app.materialsSubmittedAt ? 'UNDER_REVIEW' : 'SUBMIT_MATERIALS')
      : app.status === 'MATERIALS_CLEARED' ? 'PENDING_DECISION'
      : app.status; // APPROVED | REJECTED
    return {
      tradingTier: c.tradingTier,
      limits: [...byKey.values()],
      application: app && stage ? { upgradeNo: app.upgradeNo, stage } : null,
      canApply: c.tradingTier === 'BASIC' && (!app || !OPEN_STATUSES.includes(app.status as TierUpgradeStatus)),
    };
  }

  /** 补料会话（照 onboarding getSession 投影语法）。 */
  async getSession(customerId: string) {
    const c = await this.loadCustomer(customerId);
    const app = await this.prisma.tierUpgradeApplication.findFirst({ where: { customerId, status: 'IN_REVIEW' } });
    if (!app || app.materialsSubmittedAt) return { submitted: true, sdkToken: null, template: null };
    const { token } = await this.sumsubClient.createSdkToken({ externalUserId: c.customerNo, levelName: ONBOARDING_LEVELS.PREMIUM });
    return { submitted: false, sdkToken: token, template: ONBOARDING_LEVEL_TEMPLATES[ONBOARDING_LEVELS.PREMIUM] };
  }

  /** 材料提交（零存储：只落 materialsSubmittedAt，spec §3）。 */
  async submitMaterials(customerId: string): Promise<{ ok: true }> {
    const c = await this.loadCustomer(customerId);
    const app = await this.prisma.tierUpgradeApplication.findFirst({ where: { customerId, status: 'IN_REVIEW' } });
    if (!app || app.materialsSubmittedAt) throw new BadRequestException('No upgrade session awaiting submission');
    await this.prisma.tierUpgradeApplication.update({ where: { id: app.id }, data: { materialsSubmittedAt: new Date() } });
    await this.audit(AuditActions.TIER_UPGRADE_SUBMITTED, c, { afterData: { upgradeNo: app.upgradeNo } });
    return { ok: true };
  }

  /** applicantReviewed 落轴（摄取分发器直调）。返回 null = 无在审升级单，调用方落回入驻线。 */
  async applyReviewVerdict(input: { applicantId: string; reviewAnswer: 'GREEN' | 'RED'; reviewRejectType: 'RETRY' | 'FINAL' }) {
    const c = await this.prisma.customerMain.findFirst({ where: { sumsubApplicantId: input.applicantId } });
    if (!c) return null;
    const app = await this.prisma.tierUpgradeApplication.findFirst({ where: { customerId: c.id, status: 'IN_REVIEW' } });
    if (!app) return null;
    if (!app.materialsSubmittedAt) {
      throw new BadRequestException(`Verdict rejected: upgrade ${app.upgradeNo} is not awaiting review`);
    }
    let to: TierUpgradeStatus = 'IN_REVIEW';
    if (input.reviewAnswer === 'GREEN') {
      to = 'MATERIALS_CLEARED';
      assertTierUpgradeTransition('IN_REVIEW', to);
      await this.prisma.tierUpgradeApplication.update({ where: { id: app.id }, data: { status: to } });
    } else if (input.reviewRejectType === 'FINAL') {
      to = 'REJECTED';
      assertTierUpgradeTransition('IN_REVIEW', to);
      await this.prisma.tierUpgradeApplication.update({ where: { id: app.id }, data: { status: to, decidedAt: new Date() } });
    } else {
      // RED-RETRY：不是边——停留 IN_REVIEW，清 submittedAt 重开会话（spec §4）
      await this.prisma.tierUpgradeApplication.update({ where: { id: app.id }, data: { materialsSubmittedAt: null } });
    }
    await this.audit(AuditActions.TIER_UPGRADE_VERDICT_APPLIED, c, {
      afterData: { upgradeNo: app.upgradeNo, reviewAnswer: input.reviewAnswer, reviewRejectType: input.reviewRejectType, fromStatus: 'IN_REVIEW', toStatus: to },
    }, false);
    return { customerNo: c.customerNo, upgradeNo: app.upgradeNo, to };
  }

  /** 运营提请档位升级核准（maker）。守卫：存在 MATERIALS_CLEARED 单（非 lifecycle）且无在批审批单。 */
  async submitAcceptance(customerNo: string, reason: string, actor: ApprovalActorContext) {
    const c = await this.prisma.customerMain.findFirst({ where: { customerNo } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerNo}`);
    const app = await this.prisma.tierUpgradeApplication.findFirst({
      where: { customerId: c.id, status: 'MATERIALS_CLEARED' },
    });
    if (!app || app.status !== 'MATERIALS_CLEARED') {
      throw new BadRequestException(`Customer ${customerNo} has no upgrade application awaiting acceptance`);
    }
    const open = await this.prisma.approvalCase.findFirst({
      where: { actionType: ApprovalActionTypes.CUSTOMER_TIER_UPGRADE, entityRef: customerNo, status: { in: ['DRAFT', 'PENDING'] } },
    });
    if (open) throw new BadRequestException(`Acceptance already pending approval: ${open.approvalNo}`);
    const traceId = randomUUID();
    const impact = `Trading tier upgrade acceptance: ${customerNo} / ${app.upgradeNo} — approving raises the trading tier BASIC -> PREMIUM; cumulative limits switch to the PREMIUM schedule immediately.`;
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.CUSTOMER_TIER_UPGRADE, entityRef: customerNo, traceId,
        objectSnapshot: {
          customerNo, upgradeNo: app.upgradeNo, fromTier: app.fromTier, toTier: app.toTier,
          levelName: c.sumsubCurrentLevelName, riskRating: c.riskRating, impact,
        },
      },
      { reason, traceId },
      actor,
    );
    await this.auditLogsService.recordByActor({
      action: AuditActions.TIER_UPGRADE_ACCEPTANCE_SUBMITTED, actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER, primarySubjectNo: customerNo, ownerCustomerNo: customerNo,
      subjects: [
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: 'PRIMARY' },
        { subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalCase.approvalNo, subjectRole: 'INSTRUMENT' },
      ],
      reason, approvalNo: approvalCase.approvalNo,
      requestId: `TIER_UPGRADE_ACCEPTANCE_SUBMITTED_${customerNo}_${randomUUID()}`,
      afterData: { approvalNo: approvalCase.approvalNo },
      sourcePlatform: 'ADMIN_API',
    } as any, { actorType: 'ADMIN', actorNo: actor.userNo ?? actor.userId ?? 'ADMIN', actorDisplayName: actor.userNo ?? actor.userId ?? 'ADMIN', actorRolesAtTime: actor.roleCodes ?? [] });
    return { approvalNo: approvalCase.approvalNo };
  }

  /** 「单子提了没」从关联审批单推导展示（照 onboarding 波二版式）：查最近一条档位升级核准单，查不到 → null。 */
  async getAcceptanceCase(customerNo: string): Promise<{ approvalNo: string; status: string } | null> {
    const approvalCase = await this.prisma.approvalCase.findFirst({
      where: { actionType: ApprovalActionTypes.CUSTOMER_TIER_UPGRADE, entityRef: customerNo },
      orderBy: { createdAt: 'desc' },
    });
    if (!approvalCase) return null;
    return { approvalNo: approvalCase.approvalNo, status: approvalCase.status };
  }

  /** 管理台档位升级全貌：当前档 + 最近一条申请单 + 关联审批单（内部态合法外露给 admin）。 */
  async getAdminView(customerNo: string) {
    const c = await this.prisma.customerMain.findFirst({ where: { customerNo } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerNo}`);
    const app = await this.prisma.tierUpgradeApplication.findFirst({
      where: { customerId: c.id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      tradingTier: c.tradingTier,
      application: app
        ? { upgradeNo: app.upgradeNo, status: app.status, materialsSubmittedAt: app.materialsSubmittedAt, createdAt: app.createdAt, decidedAt: app.decidedAt }
        : null,
      acceptanceCase: await this.getAcceptanceCase(customerNo),
    };
  }

  /** 高管裁决落轴（handler 二级事件）。APPROVED → 申请单 APPROVED + 档位翻转（同事务）；DECLINED → REJECTED。 */
  @OnEvent('workflow.customer-tier-upgrade.decided', { async: true })
  async onAcceptanceDecided(event: ApprovalDecidedEvent) {
    if (event.decision !== 'APPROVED' && event.decision !== 'DECLINED') return;
    const c = await this.prisma.customerMain.findFirst({ where: { customerNo: event.entityRef } });
    if (!c) return;
    const app = await this.prisma.tierUpgradeApplication.findFirst({ where: { customerId: c.id, status: 'MATERIALS_CLEARED' } });
    if (!app) return;
    const to: TierUpgradeStatus = event.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    assertTierUpgradeTransition('MATERIALS_CLEARED', to);
    const result: { tiers: { fromTier: string; toTier: string } | null } = { tiers: null };
    await this.prisma.$transaction(async (tx) => {
      await tx.tierUpgradeApplication.update({ where: { id: app.id }, data: { status: to, decidedAt: new Date() } });
      if (event.decision === 'APPROVED') result.tiers = await this.customers.applyTierUpgrade(c.id, tx);
    });
    await this.auditLogsService.recordByActor({
      action: AuditActions.TIER_UPGRADE_ACCEPTANCE_DECIDED, actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER, primarySubjectNo: c.customerNo, ownerCustomerNo: c.customerNo,
      approvalNo: event.approvalNo,
      requestId: `TIER_UPGRADE_ACCEPTANCE_DECIDED_${c.customerNo}_${randomUUID()}`,
      afterData: {
        decision: event.decision, upgradeNo: app.upgradeNo, fromStatus: 'MATERIALS_CLEARED', toStatus: to,
        beforeTier: result.tiers?.fromTier ?? 'BASIC', afterTier: result.tiers?.toTier ?? 'BASIC',
      },
      sourcePlatform: 'ADMIN_API',
    } as any, { actorType: 'ADMIN', actorNo: event.decisionByUserNo ?? 'ADMIN', actorDisplayName: event.decisionByUserNo ?? 'ADMIN', actorRolesAtTime: [event.decisionByRole ?? 'UNKNOWN'] });
  }
}
