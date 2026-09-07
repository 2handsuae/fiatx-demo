import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerLifecycleService } from '../customers/customer-lifecycle.service';
import { CustomersService } from '../customers/customers.service';
import { SumsubClient } from '../../sumsub-applicant-client/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
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
}
