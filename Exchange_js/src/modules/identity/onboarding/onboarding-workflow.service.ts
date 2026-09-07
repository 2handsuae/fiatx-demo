import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerLifecycleService } from '../customers/customer-lifecycle.service';
import { CustomersService } from '../customers/customers.service';
import { SumsubClient } from '../../sumsub-applicant-client/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import {
  ONBOARDING_LEVELS,
  ONBOARDING_LEVEL_TEMPLATES,
  OnboardingLevelName,
} from '../constants/onboarding-level.constant';

const CDD_FIELDS = ['dateOfBirth', 'nationality', 'idDocType', 'idDocNumber', 'residentialAddress'] as const;

/** 客户 actor 投影（与 material 客户面同款口径）。 */
const customerActor = (c: { customerNo: string }) => ({
  actorType: 'CUSTOMER' as const,
  actorNo: c.customerNo,
  actorDisplayName: c.customerNo,
  actorRolesAtTime: ['CUSTOMER'],
});

@Injectable()
export class OnboardingWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: CustomerLifecycleService,
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

  /** 开始认证：建（或续用）Sumsub 申请人，绑 id + CDD 档，PROSPECT → IN_VERIFICATION。 */
  async startVerification(customerId: string): Promise<{ levelName: string }> {
    const c = await this.loadCustomer(customerId);
    let applicantId = c.sumsubApplicantId;
    if (!applicantId) {
      const created = await this.sumsubClient.createApplicant({
        externalUserId: c.customerNo,
        levelName: ONBOARDING_LEVELS.CDD,
      });
      applicantId = created.id;
    }
    await this.prisma.$transaction(async (tx) => {
      await this.customers.updateOnboardingData(
        customerId,
        { sumsubApplicantId: applicantId!, sumsubCurrentLevelName: c.sumsubCurrentLevelName ?? ONBOARDING_LEVELS.CDD },
        tx,
      );
      await this.lifecycle.applyAction(customerId, 'START_VERIFICATION', tx);
    });
    await this.audit(AuditActions.ONBOARDING_VERIFICATION_STARTED, c, {
      afterData: { levelName: c.sumsubCurrentLevelName ?? ONBOARDING_LEVELS.CDD, sumsubApplicantId: applicantId },
    });
    return { levelName: c.sumsubCurrentLevelName ?? ONBOARDING_LEVELS.CDD };
  }

  /** 认证会话（照 material 的 {submitted, sdkToken} 投影语法，另带模板与预填）。 */
  async getSession(customerId: string) {
    const c = await this.loadCustomer(customerId);
    const levelName = (c.sumsubCurrentLevelName ?? null) as OnboardingLevelName | null;
    if (c.lifecycle !== 'IN_VERIFICATION' || c.onboardingSubmittedAt || !levelName) {
      return { submitted: true, sdkToken: null, levelName, template: null, prefill: null };
    }
    const { token } = await this.sumsubClient.createSdkToken({ externalUserId: c.customerNo, levelName });
    return {
      submitted: false,
      sdkToken: token,
      levelName,
      template: ONBOARDING_LEVEL_TEMPLATES[levelName],
      prefill: {
        firstName: c.firstName, lastName: c.lastName, dateOfBirth: c.dateOfBirth,
        nationality: c.nationality, idDocType: c.idDocType, idDocNumber: c.idDocNumber,
        residentialAddress: c.residentialAddress,
      },
    };
  }

  /** 提交：CDD 落五列（业务规则：资料齐了才能交），EDD 零存储；均落 submittedAt。 */
  async submit(customerId: string, dto: Record<string, string | undefined>): Promise<{ ok: true }> {
    const c = await this.loadCustomer(customerId);
    if (c.lifecycle !== 'IN_VERIFICATION' || c.onboardingSubmittedAt) {
      throw new BadRequestException('No verification session awaiting submission');
    }
    let data: Parameters<CustomersService['updateOnboardingData']>[1];
    if (c.sumsubCurrentLevelName === ONBOARDING_LEVELS.CDD) {
      for (const f of CDD_FIELDS) {
        if (!dto[f]) throw new BadRequestException(`Missing required field: ${f}`);
      }
      data = {
        dateOfBirth: dto.dateOfBirth!, nationality: dto.nationality!, idDocType: dto.idDocType!,
        idDocNumber: dto.idDocNumber!, residentialAddress: dto.residentialAddress!,
        ...(dto.firstName ? { firstName: dto.firstName } : {}),
        ...(dto.lastName ? { lastName: dto.lastName } : {}),
        onboardingSubmittedAt: new Date(),
      };
    } else {
      // EDD：SoF/SoW 真身在 Sumsub，我方连名录都不落（decisions 2026-09-07）
      data = { onboardingSubmittedAt: new Date() };
    }
    await this.customers.updateOnboardingData(customerId, data, undefined);
    await this.audit(AuditActions.ONBOARDING_SUBMITTED, c, { afterData: { levelName: c.sumsubCurrentLevelName } });
    return { ok: true };
  }

  /** 撤回申请（IN_VERIFICATION → WITHDRAWN）。 */
  async withdrawApplication(customerId: string): Promise<{ ok: true }> {
    const c = await this.loadCustomer(customerId);
    await this.lifecycle.applyAction(customerId, 'WITHDRAW_APPLICATION');
    await this.audit(AuditActions.ONBOARDING_WITHDRAWN, c, {});
    return { ok: true };
  }

  /** 重新申请（REJECTED/WITHDRAWN → IN_VERIFICATION；终拒守卫在 lifecycle 服务）。 */
  async reapply(customerId: string): Promise<{ ok: true }> {
    const c = await this.loadCustomer(customerId);
    await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.applyAction(customerId, 'REAPPLY', tx);
      await this.customers.updateOnboardingData(customerId, { onboardingSubmittedAt: null }, tx);
    });
    await this.audit(AuditActions.ONBOARDING_REAPPLIED, c, {});
    return { ok: true };
  }

  private async loadByApplicantId(applicantId: string) {
    return this.prisma.customerMain.findFirst({ where: { sumsubApplicantId: applicantId } });
  }

  /** applicantReviewed 落轴（摄取分发器直调；按当前档名分流，spec §4）。 */
  async applyReviewVerdict(input: {
    applicantId: string;
    reviewAnswer: 'GREEN' | 'RED';
    reviewRejectType: 'RETRY' | 'FINAL';
  }): Promise<{ customerNo: string; to: string } | null> {
    const c = await this.loadByApplicantId(input.applicantId);
    if (!c) return null; // 落回 unrouted warn
    if (c.lifecycle !== 'IN_VERIFICATION' || !c.onboardingSubmittedAt) {
      throw new BadRequestException(`Verdict rejected: customer ${c.customerNo} is not awaiting review`);
    }
    const action =
      input.reviewAnswer === 'GREEN'
        ? c.sumsubCurrentLevelName === ONBOARDING_LEVELS.EDD
          ? 'VERIFICATION_PASSED'
          : 'CDD_CLEARED'
        : 'VERIFICATION_REJECTED';
    let to = '';
    await this.prisma.$transaction(async (tx) => {
      const r = await this.lifecycle.applyAction(c.id, action, tx);
      to = r.to;
      if (input.reviewAnswer === 'RED' && input.reviewRejectType === 'FINAL') {
        await this.customers.updateOnboardingData(c.id, { onboardingFinalRejectedAt: new Date() }, tx);
      }
    });
    await this.audit(AuditActions.ONBOARDING_VERDICT_APPLIED, c, {
      afterData: { reviewAnswer: input.reviewAnswer, reviewRejectType: input.reviewRejectType, levelName: c.sumsubCurrentLevelName, to },
    }, false);
    return { customerNo: c.customerNo, to };
  }

  /** applicantLevelChanged：换档到 EDD——尽调深度变了，关系没变，状态轴不动。 */
  async applyLevelChange(input: { applicantId: string }): Promise<{ customerNo: string; levelName: string } | null> {
    const c = await this.loadByApplicantId(input.applicantId);
    if (!c) return null;
    if (c.lifecycle !== 'IN_VERIFICATION' || c.sumsubCurrentLevelName !== ONBOARDING_LEVELS.CDD || !c.onboardingSubmittedAt) {
      throw new BadRequestException(`Level change rejected: customer ${c.customerNo} has no reviewable CDD submission`);
    }
    await this.customers.updateOnboardingData(
      c.id,
      { eddRequired: true, sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD, onboardingSubmittedAt: null },
      undefined,
    );
    await this.audit(AuditActions.ONBOARDING_LEVEL_CHANGED, c, {
      beforeData: { levelName: ONBOARDING_LEVELS.CDD },
      afterData: { levelName: ONBOARDING_LEVELS.EDD, eddRequired: true },
    }, false);
    return { customerNo: c.customerNo, levelName: ONBOARDING_LEVELS.EDD };
  }

  /** 运营提请准入核准（maker）。守卫：客户在 PENDING_APPROVAL 且无在批单。 */
  async submitAcceptance(customerNo: string, reason: string, actor: ApprovalActorContext) {
    const c = await this.prisma.customerMain.findFirst({ where: { customerNo } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerNo}`);
    if (c.lifecycle !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Customer ${customerNo} is not awaiting acceptance`);
    }
    const open = await this.prisma.approvalCase.findFirst({
      where: { actionType: ApprovalActionTypes.CUSTOMER_ONBOARDING_ACCEPTANCE, entityRef: customerNo, status: { in: ['DRAFT', 'PENDING'] } },
    });
    if (open) throw new BadRequestException(`Acceptance already pending approval: ${open.approvalNo}`);
    const traceId = randomUUID();
    const impact = `高风险客户准入核准：${customerNo}（EDD 尽调已在 Sumsub 完成，GREEN）——批准即开户 ACTIVE，限额与费率按默认档生效`;
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.CUSTOMER_ONBOARDING_ACCEPTANCE, entityRef: customerNo, traceId,
        objectSnapshot: {
          customerNo, riskRating: c.riskRating, eddRequired: c.eddRequired,
          levelName: c.sumsubCurrentLevelName, submittedAt: c.onboardingSubmittedAt, impact,
        },
      },
      { reason, traceId },
      actor,
    );
    await this.auditLogsService.recordByActor({
      action: AuditActions.ONBOARDING_ACCEPTANCE_SUBMITTED, actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER, primarySubjectNo: customerNo, ownerCustomerNo: customerNo,
      subjects: [
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: 'PRIMARY' },
        { subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalCase.approvalNo, subjectRole: 'INSTRUMENT' },
      ],
      reason, approvalNo: approvalCase.approvalNo,
      requestId: `ONBOARDING_ACCEPTANCE_SUBMITTED_${customerNo}_${randomUUID()}`,
      afterData: { approvalNo: approvalCase.approvalNo },
      sourcePlatform: 'ADMIN_API',
    } as any, { actorType: 'ADMIN', actorNo: actor.userNo ?? actor.userId ?? 'ADMIN', actorDisplayName: actor.userNo ?? actor.userId ?? 'ADMIN', actorRolesAtTime: actor.roleCodes ?? [] });
    return { approvalNo: approvalCase.approvalNo };
  }

  /** 「单子提了没」从关联审批单推导展示（spec §5）：查最近一条准入核准单，查不到 → null。 */
  async getAcceptanceCase(customerNo: string): Promise<{ approvalNo: string; status: string } | null> {
    const approvalCase = await this.prisma.approvalCase.findFirst({
      where: { actionType: ApprovalActionTypes.CUSTOMER_ONBOARDING_ACCEPTANCE, entityRef: customerNo },
      orderBy: { createdAt: 'desc' },
    });
    if (!approvalCase) return null;
    return { approvalNo: approvalCase.approvalNo, status: approvalCase.status };
  }

  /** 高管裁决落轴（handler 二级事件）。APPROVED → ACTIVE；DECLINED → REJECTED（可重申）。 */
  @OnEvent('workflow.customer-onboarding-acceptance.decided', { async: true })
  async onAcceptanceDecided(event: ApprovalDecidedEvent) {
    if (event.decision !== 'APPROVED' && event.decision !== 'DECLINED') return;
    const c = await this.prisma.customerMain.findFirst({ where: { customerNo: event.entityRef } });
    if (!c) return;
    const action = event.decision === 'APPROVED' ? 'FINAL_APPROVED' : 'FINAL_REJECTED';
    let to = '';
    await this.prisma.$transaction(async (tx) => {
      const r = await this.lifecycle.applyAction(c.id, action, tx);
      to = r.to;
    });
    await this.auditLogsService.recordByActor({
      action: AuditActions.ONBOARDING_ACCEPTANCE_DECIDED, actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER, primarySubjectNo: c.customerNo, ownerCustomerNo: c.customerNo,
      approvalNo: event.approvalNo,
      requestId: `ONBOARDING_ACCEPTANCE_DECIDED_${c.customerNo}_${randomUUID()}`,
      afterData: { decision: event.decision, to },
      sourcePlatform: 'ADMIN_API',
    } as any, { actorType: 'ADMIN', actorNo: event.decisionByUserNo ?? 'ADMIN', actorDisplayName: event.decisionByUserNo ?? 'ADMIN', actorRolesAtTime: [event.decisionByRole ?? 'UNKNOWN'] });
  }
}
