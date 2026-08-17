import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRequestsService, type IssueMaterialRequestInput } from './material-requests.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';
import type { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import type { RestrictionScope } from '../customers/constants/restriction-cause.constant';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { MaterialRefreshPolicyLoader } from '../material-refresh/policy/material-refresh-policy';
import {
  ISSUABLE_RESTRICTION_CAUSES,
  type IssuableRestrictionCause,
  type MaterialRequestOrderDomain,
  type MaterialRequestOrigin,
} from './constants/material-request.constant';

export interface IssueInput {
  customerId: string;
  materialType: string;
  orderDomain: MaterialRequestOrderDomain | null;
  orderRef: string | null;
  restrict: boolean;
  restrictScopes?: RestrictionScope[];
  restrictCause?: IssuableRestrictionCause;
  origin: MaterialRequestOrigin;
  reason: string;
  issuedBy: string;
  actor: ApprovalActorContext;
}

export type RegisterInput = IssueMaterialRequestInput & {
  restrict: boolean;
  restrictScopes?: RestrictionScope[];
  restrictCause?: IssuableRestrictionCause;
  actor: ApprovalActorContext;
};

/**
 * 下发编排 —— 建行的唯一入口（设计稿 2026-08-17 §4.1）。
 *
 * 两条路径的差别只在这一层：
 *  - issue()    路径 2：我方先生成 externalActionId，再调 Sumsub 建 action
 *  - register() 路径 1：Sumsub 已经建好并把两个 id 推给了我们，只登记
 * 建完之后两条路径出来的行**完全同形**，下游一律不区分来源。
 */
@Injectable()
export class MaterialRequestIssuerService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly restrictionWorkflow: CustomerRestrictionWorkflowService,
    private readonly sumsubClient: SumsubClient,
    private readonly policyLoader: MaterialRefreshPolicyLoader,
  ) {}

  async issue(input: IssueInput): Promise<{ requestNo: string; restrictionNo: string | null }> {
    const cause = this.resolveCause(input.restrict, input.restrictCause);

    const config = this.policyLoader.getMaterialConfig(input.materialType);
    if (!config) {
      throw new BadRequestException({
        code: 'UNKNOWN_MATERIAL_TYPE',
        message: `Unknown material type: ${input.materialType}`,
      });
    }

    const customer = await this.loadCustomer(input.customerId);

    // 我方先生成，再交给 Sumsub —— 顺序不能反：这是铸 token 与认领 webhook 的钥匙
    const externalActionId = `MRQ:${randomUUID()}`;
    const action = await this.sumsubClient.createApplicantAction({
      applicantId: customer.sumsubApplicantId,
      levelName: config.sumsubActionLevelName,
      externalActionId,
    });

    return this.persist(
      {
        customerId: customer.id,
        sumsubApplicantId: customer.sumsubApplicantId,
        materialType: input.materialType,
        levelName: config.sumsubActionLevelName,
        applicantActionId: action.id,
        externalActionId,
        orderDomain: input.orderDomain,
        orderRef: input.orderRef,
        origin: input.origin,
        reason: input.reason,
        issuedBy: input.issuedBy,
      },
      cause,
      input.restrictScopes,
      input.reason,
      input.actor,
    );
  }

  async register(input: RegisterInput): Promise<{ requestNo: string; restrictionNo: string | null }> {
    const cause = this.resolveCause(input.restrict, input.restrictCause);
    const { restrict, restrictScopes, restrictCause, actor, ...row } = input;
    return this.persist(row, cause, restrictScopes, input.reason, actor);
  }

  /** 落行 + 可选开便签，同一个事务。半成品（有行没便签 / 有便签没行）是运营看不懂的脏数据。 */
  private async persist(
    row: IssueMaterialRequestInput,
    cause: IssuableRestrictionCause | null,
    scopes: RestrictionScope[] | undefined,
    reason: string,
    actor: ApprovalActorContext,
  ): Promise<{ requestNo: string; restrictionNo: string | null }> {
    return this.prisma.$transaction(async (tx: Record<string, any>) => {
      const created = await this.requests.create(row, tx);
      if (!cause) return { requestNo: created.requestNo, restrictionNo: null };

      // caseRef 用 requestNo：CustomerRestrictionWorkflowService.autoRelease() 是按
      // (customerId, cause, caseRef) 找便签的，不认 restrictionNo。用 requestNo 当
      // caseRef，Task 4 的自动撕不用改 autoRelease，限制账的幂等键也天然变成
      // 「一次下发一张便签」。
      const { restrictionNo } = await this.restrictionWorkflow.openRestriction(
        {
          customerId: row.customerId,
          cause,
          scopes,
          reason,
          caseRef: created.requestNo,
          openedBy: row.issuedBy,
        },
        actor,
        tx,
      );
      await this.requests.attachRestriction(created.requestNo, restrictionNo, tx);
      return { requestNo: created.requestNo, restrictionNo };
    });
  }

  /** G4 / spec I1：SILENT 类 cause 在这里就被拦死，绝不落地 */
  private resolveCause(
    restrict: boolean,
    requested: IssuableRestrictionCause | undefined,
  ): IssuableRestrictionCause | null {
    if (!restrict) return null;
    const cause = requested ?? 'PENDING_DOCUMENT';
    if (!(ISSUABLE_RESTRICTION_CAUSES as readonly string[]).includes(cause)) {
      throw new BadRequestException({
        code: 'RESTRICTION_CAUSE_NOT_ISSUABLE',
        message:
          `Cause '${cause}' cannot back a material request. ` +
          `Only ${ISSUABLE_RESTRICTION_CAUSES.join(' / ')} are allowed — ` +
          'a SILENT cause would tell the customer they are under investigation.',
      });
    }
    return cause;
  }

  private async loadCustomer(customerId: string) {
    const customer = await this.prisma.customerMain.findFirst({
      where: { id: customerId },
      select: { id: true, customerNo: true, sumsubApplicantId: true },
    });
    if (!customer) throw new NotFoundException(`Customer not found: ${customerId}`);
    if (!customer.sumsubApplicantId) {
      throw new BadRequestException({
        code: 'NO_SUMSUB_APPLICANT',
        message: 'Customer has no Sumsub applicant; cannot create an applicant action',
      });
    }
    return customer as { id: string; customerNo: string; sumsubApplicantId: string };
  }
}
