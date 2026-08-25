import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditCategory,
  AuditOutcome,
  AuditSubjectInput,
  AuditSubjectRole,
} from '../../audit-logging/dto/audit-log.dto';
import { ApprovalPolicyService } from './approval-policy.service';
import {
  ApprovalActorContext,
  ApprovalDecisionEvent,
  ApprovalEvents,
  ApprovalSoDRuleCodes,
  ApprovalStatuses,
  ApprovalStepStatuses,
  isSuperAdminRoleContext,
  splitRoleCsv,
} from './constants/approval.constants';
import {
  ApprovalQueryDto,
  CancelApprovalDto,
  CreateApprovalDto,
  DecisionApprovalDto,
  SubmitApprovalDto,
} from './dto/approval.dto';

type ApprovalWriteClient = any;
type ApprovalCaseRow = {
  [key: string]: any;
  steps: Array<Record<string, any>>;
  evidencePackage: {
    id: string;
    packageNo: string;
    status: string;
  } | null;
};

interface ApprovalRequirementInput {
  actionType: string;
  entityRef: string;
  approvalCaseId?: string | null;
  actor?: ApprovalActorContext;
  traceId?: string | null;
}

@Injectable()
export class ApprovalsService {
  private static readonly DEFAULT_TAKE = 20;
  private static readonly MAX_NO_RETRIES = 10;
  // 与 resolveDecisionRole 里的 SoD 拦截共用同一个常量，避免 approve()/reject()
  // 事后靠字符串匹配识别"这次失败是不是 SoD 引起的"时跟抛出侧的文案走漂。
  private static readonly SOD_SELF_APPROVE_MESSAGE =
    'Maker and checker must be different users';

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
    private readonly approvalPolicyService: ApprovalPolicyService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private getDb(client?: ApprovalWriteClient): ApprovalWriteClient {
    return client ?? this.prisma;
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return ApprovalsService.DEFAULT_TAKE;
    return Math.min(take, 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorNo: actor.userNo || 'UNKNOWN',
      actorDisplayName: actor.userNo || 'UNKNOWN',
      actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
    };
  }

  private systemActor(): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: 'SYSTEM',
      userNo: 'SYSTEM',
      role: 'SYSTEM',
      roleCodes: ['SYSTEM'],
    };
  }

  private isSuperAdmin(actor?: ApprovalActorContext | null): boolean {
    return !!actor && isSuperAdminRoleContext(actor.roleCodes);
  }

  /**
   * PRIMARY=审批单、RELATED=被审批的业务对象。五个「非 SUBMITTED」横切码共用这一组
   * subjects；SUBMITTED 额外再挂一个 APPROVAL_POLICY 的 INSTRUMENT（见 recordSubmitted）。
   *
   * RELATED 只能取 actionType/entityRef——ApprovalCase 表没有 entityType/entityNo 的
   * 拆分列，且多数调用方传的 entityRef 本身就是 Prisma id 而非业务键（详见
   * task-5-report.md 冲突记录①）。这是当前 schema 下能拿到的最好近似，不是编造值。
   */
  private approvalSubjects(approval: ApprovalCaseRow): AuditSubjectInput[] {
    return [
      {
        subjectType: AuditEntityTypes.APPROVAL_CASE,
        subjectNo: approval.approvalNo,
        subjectRole: AuditSubjectRole.PRIMARY,
      },
      {
        subjectType: approval.actionType,
        subjectNo: approval.entityRef,
        subjectRole: AuditSubjectRole.RELATED,
      },
    ];
  }

  /**
   * 横切 6 码全部是 correlationMode=INHERIT，必须从 PRIMARY 主体上读 correlationId、
   * 读不到就该报错，不许静默生成新值。
   *
   * ApprovalCase 表目前没有真正的 correlationId 列——业务侧「START」写入要等
   * Task 6-8 才会落地（在业务实体上生成并回填 correlationId）。过渡期借用
   * traceId：这不只是"矮子里拔将军"——旧设计里 approval_cases.traceId 本来就是
   * "建单时生成一次、之后 submit/approve/reject/cancel 全程一致"的长效链路号
   * （assertTraceConsistency 强制校验），行为上正好对应新设计里 correlationId 的
   * 定义（"一个业务流程的一次完整执行"），而不是新设计里 traceId 的定义（"一次
   * 外部触发"）。只是列名还没随语义搬家。
   * TODO(Task 6-8)：业务侧 START 落地、ApprovalCase 补上真正的 correlationId 列后，
   * 这里改读那一列。
   */
  private inheritedCorrelationId(approval: ApprovalCaseRow): string {
    return approval.traceId;
  }

  /**
   * APPROVAL_SUBMITTED 的唯一写入点，供 emitSubmittedSideEffects（submit() 路径）与
   * createAndSubmit（~30 处工作流一步到位路径）共用，避免同一形状抄两遍。
   */
  private async recordSubmitted(
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    reason?: string | null,
  ) {
    const policy = await this.approvalPolicyService.getPolicy(approval.actionType);
    await this.auditLogsService.recordByActor(
      {
        action: 'APPROVAL_SUBMITTED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.APPROVAL_CASE,
        primarySubjectNo: approval.approvalNo,
        correlationId: this.inheritedCorrelationId(approval),
        outcome: AuditOutcome.SUCCESS,
        reason: reason || 'Approval submitted',
        // policyCode = actionType：approval_action_policies 表以 actionType 为主键，
        // 没有独立的 code 列，两者本就是同一个值，不是另编一个。
        policyCode: policy.actionType,
        // policyVersion 占位固定 1：ApprovalActionPolicy 是单行 upsert 覆盖、不留历史
        // （无 version 列，upsertStepsConfig 直接覆盖同一行），此刻系统里只存在过
        // "当前"这一份版本，不是瞎猜的业务值。但这确实达不到设计文档 §4.2 组H
        // "带版本号是刚需——监管问的是按的哪条规则的哪个版本"的初衷：一旦策略被
        // 改过，此刻仍会照样填 1，无法证明历史上提交时到底生效的是哪一版。
        // 已记 BACKLOG「技术债 — V1 审计底座」，见 task-5-report.md 冲突记录②。
        policyVersion: 1,
        subjects: [
          ...this.approvalSubjects(approval),
          {
            subjectType: AuditEntityTypes.APPROVAL_POLICY,
            subjectNo: policy.actionType,
            subjectRole: AuditSubjectRole.INSTRUMENT,
          },
        ],
        metadata: {
          timeoutAt: approval.timeoutAt?.toISOString(),
        },
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  /**
   * APPROVAL_SOD_DENIED 的唯一写入点。只在 approve()/reject() 捕到
   * SOD_SELF_APPROVE_MESSAGE 这个特定 ForbiddenException 时调用，且必须在各自
   * 那个 $transaction(...) 已经 settle（这里必然是 rejected）之后才调用——不能在
   * 事务回调内部就地写，见 resolveDecisionRole 处注释（就地写实测拖慢到 ~5s）。
   * 重新按 id 读一次 approval：事务回调里的那份 approval 局部变量出了回调作用域
   * 就拿不到了，重读的代价（一次 SELECT）远小于在开着的事务里嵌查询的代价。
   */
  private async recordSoDDenied(
    id: string,
    actor: ApprovalActorContext,
    error: unknown,
  ): Promise<void> {
    if (
      !(error instanceof ForbiddenException) ||
      (error as Error).message !== ApprovalsService.SOD_SELF_APPROVE_MESSAGE
    ) {
      return;
    }

    const approval = await this.findCaseOrThrow(id);
    await this.auditLogsService.recordByActor(
      {
        action: 'APPROVAL_SOD_DENIED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.APPROVAL_CASE,
        primarySubjectNo: approval.approvalNo,
        correlationId: this.inheritedCorrelationId(approval),
        // 系统主动挡住、这次决定压根没执行成——outcome=DENIED，六码里唯一一个。
        outcome: AuditOutcome.DENIED,
        reasonCode: 'SELF_APPROVE',
        reason: 'Maker cannot approve own request (SoD)',
        ruleCode: ApprovalSoDRuleCodes.DENY_SAME_USER_MAKER_CHECKER,
        subjects: this.approvalSubjects(approval),
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }

  private buildEventPayload(approval: ApprovalCaseRow): ApprovalDecisionEvent {
    const decidedStep = [...(approval.steps || [])]
      .sort((a: any, b: any) => b.stepNo - a.stepNo)
      .find((s: any) => s.status !== ApprovalStepStatuses.PENDING);

    return {
      approvalId: approval.id,
      approvalNo: approval.approvalNo,
      actionType: approval.actionType,
      entityRef: approval.entityRef,
      traceId: approval.traceId,
      status: approval.status,
      decisionByUserId: decidedStep?.decidedByUserId || null,
      decisionByUserNo: decidedStep?.decidedByUserNo || null,
      decisionByRole: decidedStep?.decidedByRole || null,
      decisionReason: decidedStep?.reason || null,
      decidedAt: decidedStep?.decidedAt ? decidedStep.decidedAt.toISOString() : null,
    };
  }

  private async emitApprovalEvent(eventName: string, payload: ApprovalDecisionEvent) {
    if (typeof this.eventEmitter.emitAsync === 'function') {
      await this.eventEmitter.emitAsync(eventName, payload);
      return;
    }

    this.eventEmitter.emit(eventName, payload);
  }

  private async projectGovernanceApprovalDecision(_approval: ApprovalCaseRow) {
    // No-op: CT removed. Future workflow projections go here.
  }

  private assertTraceConsistency(
    existingTraceId: string,
    incomingTraceId?: string | null,
  ) {
    const normalizedTraceId = this.normalizeOptionalString(incomingTraceId);
    if (normalizedTraceId && normalizedTraceId !== existingTraceId) {
      throw new BadRequestException('traceId does not match the existing approval chain');
    }
  }

  private async findCaseOrThrow(
    id: string,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    const found = await db.approvalCase.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { stepNo: 'asc' },
        },
        evidencePackage: {
          select: {
            id: true,
            packageNo: true,
            status: true,
          },
        },
      },
    });

    if (!found) {
      throw new NotFoundException(`Approval case not found: ${id}`);
    }

    return found as ApprovalCaseRow;
  }

  private isUniqueConflict(error: unknown, field: string): boolean {
    const maybe = error as {
      code?: string;
      meta?: { target?: string[] | string };
    };
    if (maybe?.code !== 'P2002') return false;

    const target = maybe.meta?.target;
    if (Array.isArray(target)) return target.includes(field);
    if (typeof target === 'string') return target.includes(field);
    return false;
  }

  private approvalInclude() {
    return {
      steps: {
        orderBy: { stepNo: 'asc' as const },
      },
      evidencePackage: {
        select: {
          id: true,
          packageNo: true,
          status: true,
        },
      },
    };
  }

  private async createCaseWithUniqueNo(
    data: Record<string, any>,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    for (let i = 0; i < ApprovalsService.MAX_NO_RETRIES; i += 1) {
      try {
        const approvalNo = generateReferenceNo('APR');
        const stepsPayload = data.steps;
        return (await db.approvalCase.create({
          data: {
            ...data,
            approvalNo,
            steps: stepsPayload,
          },
          include: this.approvalInclude(),
        })) as ApprovalCaseRow;
      } catch (error) {
        if (this.isUniqueConflict(error, 'approvalNo')) continue;
        throw error;
      }
    }

    throw new InternalServerErrorException(
      `Failed to generate unique approvalNo after ${ApprovalsService.MAX_NO_RETRIES} attempts`,
    );
  }

  private mapApproval(approval: ApprovalCaseRow, actor?: ApprovalActorContext) {
    const cancellableStatuses = new Set<string>([
      ApprovalStatuses.DRAFT,
      ApprovalStatuses.PENDING,
    ]);
    const pendingStep = (approval.steps || []).find(
      (s: any) => s.status === ApprovalStepStatuses.PENDING,
    );
    const stepRoles = pendingStep
      ? splitRoleCsv(pendingStep.checkerRoleCandidates)
      : [];
    const availableDecisionRoles = actor
      ? this.isSuperAdmin(actor)
        ? stepRoles
        : stepRoles.filter((role) => actor.roleCodes.includes(role))
      : [];
    const makerCheckerConflict = actor
      ? !this.isSuperAdmin(actor) &&
        actor.userId === approval.createdByUserId &&
        availableDecisionRoles.length > 0
      : false;
    const crossStepConflict = actor
      ? this.hasActorApprovedAnyStep(approval.steps || [], actor.userId)
      : false;
    const canDecide =
      approval.status === ApprovalStatuses.PENDING &&
      !!pendingStep &&
      availableDecisionRoles.length > 0 &&
      !makerCheckerConflict &&
      !crossStepConflict;

    return {
      id: approval.id,
      approvalNo: approval.approvalNo,
      actionType: approval.actionType,
      entityRef: approval.entityRef,
      createdByUserId: approval.createdByUserId,
      createdByUserNo: approval.createdByUserNo || null,
      status: approval.status,
      objectSnapshot: approval.objectSnapshot ? JSON.parse(approval.objectSnapshot as string) : null,
      traceId: approval.traceId,
      submittedAt: approval.submittedAt,
      timeoutAt: approval.timeoutAt,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      availableDecisionRoles,
      canApprove: canDecide,
      canReject: canDecide,
      canCancel:
        !!actor &&
        approval.allowCancel &&
        (actor.userId === approval.createdByUserId || this.isSuperAdmin(actor)) &&
        cancellableStatuses.has(approval.status),
    };
  }

  private async mapApprovalsForReadModel(
    approvals: ApprovalCaseRow[],
    actor?: ApprovalActorContext,
  ) {
    return approvals.map((approval) => {
      const allSteps = (approval.steps || [])
        .sort((a: any, b: any) => a.stepNo - b.stepNo)
        .map((s: any) => ({
          id: s.id,
          stepNo: s.stepNo,
          status: s.status,
          checkerRoleCandidates: splitRoleCsv(s.checkerRoleCandidates),
          decidedByUserNo: s.decidedByUserNo || null,
          decidedByRole: s.decidedByRole,
          reason: s.reason,
          decidedAt: s.decidedAt,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }));
      const currentStep = allSteps.find((s: any) => s.status === 'PENDING') || allSteps[0] || null;

      return {
        ...this.mapApproval(approval, actor),
        allowCancel: approval.allowCancel,
        step: currentStep,
        steps: allSteps,
        evidencePackage: approval.evidencePackage,
      };
    });
  }

  private hasActorApprovedAnyStep(steps: any[], userId: string): boolean {
    return steps.some(
      (s) => s.status === ApprovalStepStatuses.APPROVED && s.decidedByUserId === userId,
    );
  }

  private async resolveDecisionRole(
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    requestedRole?: string,
    stepCandidateRoles?: string[],
  ): Promise<string> {
    const normalizedRequestedRole = this.normalizeOptionalString(requestedRole);
    const allowedRoles = stepCandidateRoles || [];
    const actorRoles = Array.from(new Set(actor.roleCodes.map((item) => String(item).trim())));
    const superAdminBypass = this.isSuperAdmin(actor);
    const intersection = superAdminBypass
      ? allowedRoles
      : allowedRoles.filter((role) => actorRoles.includes(role));

    if (!intersection.length) {
      throw new ForbiddenException('Current admin roles are not allowed to decide this approval');
    }

    if (
      !superAdminBypass &&
      actor.userId === approval.createdByUserId &&
      (await this.approvalPolicyService.isSameUserMakerCheckerDenied())
    ) {
      // 不在这里写审计再抛异常：resolveDecisionRole 是从 approve()/reject() 一个
      // 还开着的 $transaction(tx) 回调里调用的。实测过"就地用 this.prisma（非 tx）
      // 写一条再抛异常"这个写法——SQLite 单连接对 tx 还没提交/回滚时的非 tx 查询
      // 会顶牛，一次自审批请求量到 ~5s 才返回（正常路径 <10ms）。改成在这抛一个
      // 纯净异常，audit 记录挪到 approve()/reject() 里事务已经 settle 之后再补写
      // （见 recordSoDDenied），避免任何查询发生在打开的事务里面。
      throw new ForbiddenException(ApprovalsService.SOD_SELF_APPROVE_MESSAGE);
    }

    if (approval.steps && this.hasActorApprovedAnyStep(approval.steps, actor.userId)) {
      throw new ConflictException('Same user cannot approve multiple steps of the same case');
    }

    if (normalizedRequestedRole) {
      if (!intersection.includes(normalizedRequestedRole)) {
        throw new ForbiddenException(
          `checkerRole ${normalizedRequestedRole} is not available for the current admin`,
        );
      }
      return normalizedRequestedRole;
    }

    if (intersection.length === 1) {
      return intersection[0];
    }

    const currentPrimaryRole = this.normalizeOptionalString(actor.role);
    if (currentPrimaryRole && intersection.includes(currentPrimaryRole)) {
      return currentPrimaryRole;
    }

    throw new BadRequestException(
      `Multiple checker roles are available (${intersection.join(', ')}). Provide checkerRole explicitly.`,
    );
  }

  private async createDraftCase(
    dto: CreateApprovalDto,
    actor: ApprovalActorContext,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    const actionType = String(dto.actionType || '').trim().toUpperCase();
    const entityRef = String(dto.entityRef || '').trim();

    if (!actionType) {
      throw new BadRequestException('actionType is required');
    }
    if (!entityRef) {
      throw new BadRequestException('entityRef is required');
    }

    const existingPending = await db.approvalCase.findFirst({
      where: {
        actionType,
        entityRef,
        status: ApprovalStatuses.PENDING,
      },
      include: this.approvalInclude(),
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      this.assertTraceConsistency(existingPending.traceId, dto.traceId);
      return existingPending as ApprovalCaseRow;
    }

    const policy = await this.approvalPolicyService.getPolicy(actionType);
    if (!policy.steps.length) {
      throw new BadRequestException(`No steps configured for actionType ${actionType}`);
    }

    return this.createCaseWithUniqueNo(
      {
        actionType,
        entityRef,
        createdByUserId: actor.userId,
        createdByUserNo: this.normalizeOptionalString(actor.userNo),
        status: ApprovalStatuses.DRAFT,
        allowCancel: policy.allowCancel,
        objectSnapshot: dto.objectSnapshot ? JSON.stringify(dto.objectSnapshot) : null,
        traceId: this.normalizeOptionalString(dto.traceId) || randomUUID(),
        steps: {
          create: policy.steps.map((step) => ({
            stepNo: step.stepNo,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: step.roles.join(','),
          })),
        },
      },
      client,
    );
  }

  private async submitCase(
    id: string,
    dto: SubmitApprovalDto,
    actor: ApprovalActorContext,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    const approval = await this.findCaseOrThrow(id, client);
    if (approval.createdByUserId !== actor.userId) {
      throw new ForbiddenException('Only the maker can submit this approval');
    }
    if (approval.status !== ApprovalStatuses.DRAFT) {
      throw new BadRequestException('Only DRAFT approvals can be submitted');
    }

    this.assertTraceConsistency(approval.traceId, dto.traceId);

    const policy = await this.approvalPolicyService.getPolicy(approval.actionType);
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + policy.timeoutHours * 60 * 60 * 1000);

    // NOTE: stepNo: 1 is intentional — submit always activates the first step.
    // Do not change to dynamic lookup.
    await db.approvalStep.update({
      where: {
        approvalCaseId_stepNo: {
          approvalCaseId: approval.id,
          stepNo: 1,
        },
      },
      data: {
        status: ApprovalStepStatuses.PENDING,
      },
    });

    const next = await db.approvalCase.update({
      where: { id: approval.id },
      data: {
        status: ApprovalStatuses.PENDING,
        submittedAt: now,
        timeoutAt,
      },
      include: this.approvalInclude(),
    });

    return next as ApprovalCaseRow;
  }

  async emitSubmittedSideEffects(
    approvalId: string,
    actor: ApprovalActorContext,
    reason?: string | null,
  ) {
    const approval = await this.findCaseOrThrow(approvalId);
    await this.recordSubmitted(approval, actor, reason);
    await this.emitApprovalEvent(ApprovalEvents.SUBMITTED, this.buildEventPayload(approval));
    return this.mapApproval(approval, actor);
  }

  async createAndSubmit(
    createDto: CreateApprovalDto,
    submitDto: SubmitApprovalDto,
    actor: ApprovalActorContext,
    client?: ApprovalWriteClient,
    options?: { emitSideEffects?: boolean },
  ) {
    const created = await this.createDraftCase(createDto, actor, client);
    const submitted =
      created.status === ApprovalStatuses.PENDING
        ? created
        : await this.submitCase(created.id, submitDto, actor, client);

    if (options?.emitSideEffects !== false && submitted.status === ApprovalStatuses.PENDING) {
      await this.recordSubmitted(submitted, actor, submitDto.reason);
      await this.emitApprovalEvent(ApprovalEvents.SUBMITTED, this.buildEventPayload(submitted));
    }

    return this.mapApproval(submitted, actor);
  }

  async create(dto: CreateApprovalDto, actor: ApprovalActorContext) {
    const created = await this.createDraftCase(dto, actor);
    return this.mapApproval(created as ApprovalCaseRow, actor);
  }

  async submit(id: string, dto: SubmitApprovalDto, actor: ApprovalActorContext) {
    const updated = await this.prisma.$transaction((tx: any) =>
      this.submitCase(id, dto, actor, tx),
    );
    await this.emitSubmittedSideEffects(updated.id, actor, dto.reason);
    return this.mapApproval(updated, actor);
  }

  async approve(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
    let updated: ApprovalCaseRow;
    try {
      updated = await this.prisma.$transaction(async (tx: any) => {
        const approval = await this.findCaseOrThrow(id, tx);
        if (approval.status !== ApprovalStatuses.PENDING) {
          throw new BadRequestException('Only PENDING approvals can be approved');
        }
        this.assertTraceConsistency(approval.traceId, dto.traceId);

        // Find the FIRST pending step (enforce sequential ordering — no step skipping)
        const firstPendingStep = (approval.steps || []).find(
          (s: any) => s.status === ApprovalStepStatuses.PENDING,
        );
        if (!firstPendingStep) {
          throw new ForbiddenException('No pending steps available');
        }
        const canAct =
          splitRoleCsv(firstPendingStep.checkerRoleCandidates).some((candidate: string) =>
            (actor.roleCodes || []).includes(candidate),
          ) || this.isSuperAdmin(actor);
        if (!canAct) {
          throw new ForbiddenException(
            `Actor role ${(actor.roleCodes || []).join(',')} cannot sign the current pending step (step ${firstPendingStep.stepNo})`,
          );
        }
        const currentStep = firstPendingStep;

        const stepCandidateRoles = splitRoleCsv(currentStep.checkerRoleCandidates);
        const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole, stepCandidateRoles);
        const now = new Date();

        await tx.approvalStep.update({
          where: {
            approvalCaseId_stepNo: {
              approvalCaseId: approval.id,
              stepNo: currentStep.stepNo,
            },
          },
          data: {
            status: ApprovalStepStatuses.APPROVED,
            decidedByUserId: actor.userId,
            decidedByUserNo: this.normalizeOptionalString(actor.userNo),
            decidedByRole: decisionRole,
            reason: this.normalizeOptionalString(dto.reason),
            decidedAt: now,
          },
        });

        // Check for any remaining pending steps with higher stepNo
        const hasNextPending = (approval.steps || []).some(
          (s: any) =>
            s.stepNo > currentStep.stepNo &&
            s.status === ApprovalStepStatuses.PENDING,
        );

        if (hasNextPending) {
          // Mid-flow: case stays PENDING, reload to get updated steps
          return tx.approvalCase.findUnique({
            where: { id: approval.id },
            include: this.approvalInclude(),
          }) as Promise<ApprovalCaseRow>;
        }

        // Last step: case APPROVED
        return tx.approvalCase.update({
          where: { id: approval.id },
          data: {
            status: ApprovalStatuses.APPROVED,
          },
          include: this.approvalInclude(),
        }) as Promise<ApprovalCaseRow>;
      });
    } catch (error) {
      // SoD 自审拦截在这里落地补写审计（见 recordSoDDenied 与
      // resolveDecisionRole 处注释：事务已经 settle/rejected，此刻查询/写入
      // 不会再跟这个已经在回滚的 tx 顶牛）。非 SoD 原因的失败原样透传，
      // recordSoDDenied 内部会判断、不是 SoD 就直接 no-op。
      await this.recordSoDDenied(id, actor, error);
      throw error;
    }

    // 末票＝这次表决之后案子已经从 PENDING 推到 APPROVED；中间票＝案子仍 PENDING
    // （还有下一步待签）。中间票的 fromStatus/toStatus 必须留空——那一票发生了，
    // 但没有推动 PRIMARY（审批单）的状态，不能写成 from==to。
    const isFinalVote = updated.status === ApprovalStatuses.APPROVED;
    await this.auditLogsService.recordByActor(
      {
        action: 'APPROVAL_GRANTED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.APPROVAL_CASE,
        primarySubjectNo: updated.approvalNo,
        correlationId: this.inheritedCorrelationId(updated),
        outcome: AuditOutcome.SUCCESS,
        reason: dto.reason || 'Approval approved',
        approvalNo: updated.approvalNo,
        ...(isFinalVote
          ? { fromStatus: ApprovalStatuses.PENDING, toStatus: ApprovalStatuses.APPROVED }
          : {}),
        subjects: this.approvalSubjects(updated),
        sourcePlatform: 'ADMIN_API',
        metadata:
          this.isSuperAdmin(actor) && actor.userId === updated.createdByUserId
            ? { superAdminBypass: true }
            : undefined,
      },
      this.toAuditActor(actor),
    );
    if (isFinalVote) {
      await this.projectGovernanceApprovalDecision(updated);
      await this.emitApprovalEvent(ApprovalEvents.APPROVED, this.buildEventPayload(updated));
    }
    return this.mapApproval(updated, actor);
  }

  async reject(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
    let updated: ApprovalCaseRow;
    try {
      updated = await this.prisma.$transaction(async (tx: any) => {
        const approval = await this.findCaseOrThrow(id, tx);
        if (approval.status !== ApprovalStatuses.PENDING) {
          throw new BadRequestException('Only PENDING approvals can be rejected');
        }
        this.assertTraceConsistency(approval.traceId, dto.traceId);

        // Find the FIRST pending step (enforce sequential ordering)
        const firstPendingStep = (approval.steps || []).find(
          (s: any) => s.status === ApprovalStepStatuses.PENDING,
        );
        if (!firstPendingStep) {
          throw new ForbiddenException('No pending steps available');
        }
        const canAct =
          splitRoleCsv(firstPendingStep.checkerRoleCandidates).some((candidate: string) =>
            (actor.roleCodes || []).includes(candidate),
          ) || this.isSuperAdmin(actor);
        if (!canAct) {
          throw new ForbiddenException(
            `Actor role ${(actor.roleCodes || []).join(',')} cannot reject the current pending step (step ${firstPendingStep.stepNo})`,
          );
        }
        const currentStep = firstPendingStep;

        const stepCandidateRoles = splitRoleCsv(currentStep.checkerRoleCandidates);
        const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole, stepCandidateRoles);
        const now = new Date();

        // Reject the current step
        await tx.approvalStep.update({
          where: {
            approvalCaseId_stepNo: {
              approvalCaseId: approval.id,
              stepNo: currentStep.stepNo,
            },
          },
          data: {
            status: ApprovalStepStatuses.REJECTED,
            decidedByUserId: actor.userId,
            decidedByUserNo: this.normalizeOptionalString(actor.userNo),
            decidedByRole: decisionRole,
            reason: this.normalizeOptionalString(dto.reason),
            decidedAt: now,
          },
        });

        // Cancel any remaining pending steps
        await tx.approvalStep.updateMany({
          where: {
            approvalCaseId: approval.id,
            status: ApprovalStepStatuses.PENDING,
          },
          data: { status: ApprovalStepStatuses.CANCELLED },
        });

        // Case REJECTED immediately
        return tx.approvalCase.update({
          where: { id: approval.id },
          data: {
            status: ApprovalStatuses.REJECTED,
          },
          include: this.approvalInclude(),
        }) as Promise<ApprovalCaseRow>;
      });
    } catch (error) {
      await this.recordSoDDenied(id, actor, error);
      throw error;
    }

    await this.auditLogsService.recordByActor(
      {
        action: 'APPROVAL_DECLINED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.APPROVAL_CASE,
        primarySubjectNo: updated.approvalNo,
        correlationId: this.inheritedCorrelationId(updated),
        // 驳回这个动作本身成功执行了——outcome 答的是「动作执行成没成」，不是
        // 「业务结果好不好」。DENIED 只留给系统主动挡住、动作压根没执行成的场景。
        outcome: AuditOutcome.SUCCESS,
        reason: dto.reason || 'Approval rejected',
        approvalNo: updated.approvalNo,
        // reject 无论在哪一步触发都立即终结整案（cancel 剩余 PENDING 步骤），永远是末票。
        fromStatus: ApprovalStatuses.PENDING,
        toStatus: ApprovalStatuses.REJECTED,
        subjects: this.approvalSubjects(updated),
        sourcePlatform: 'ADMIN_API',
        metadata:
          this.isSuperAdmin(actor) && actor.userId === updated.createdByUserId
            ? { superAdminBypass: true }
            : undefined,
      },
      this.toAuditActor(actor),
    );
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.REJECTED, this.buildEventPayload(updated));
    return this.mapApproval(updated, actor);
  }

  async cancel(id: string, dto: CancelApprovalDto, actor: ApprovalActorContext) {
    let previousStatus: string = ApprovalStatuses.DRAFT;
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.createdByUserId !== actor.userId && !this.isSuperAdmin(actor)) {
        throw new ForbiddenException('Only the maker can cancel this approval');
      }
      if (!approval.allowCancel) {
        throw new ForbiddenException('This approval policy does not allow cancellation');
      }
      if (
        !new Set<string>([ApprovalStatuses.DRAFT, ApprovalStatuses.PENDING]).has(
          approval.status,
        )
      ) {
        throw new BadRequestException('Only DRAFT or PENDING approvals can be cancelled');
      }

      this.assertTraceConsistency(approval.traceId, dto.traceId);
      previousStatus = approval.status;
      const now = new Date();

      // Cancel ALL remaining PENDING steps (preserves already-APPROVED steps)
      await tx.approvalStep.updateMany({
        where: {
          approvalCaseId: approval.id,
          status: ApprovalStepStatuses.PENDING,
        },
        data: {
          status: ApprovalStepStatuses.CANCELLED,
          decidedByUserId: actor.userId,
          decidedByUserNo: this.normalizeOptionalString(actor.userNo),
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.CANCELLED,
        },
        include: this.approvalInclude(),
      });

      return next as ApprovalCaseRow;
    });

    await this.auditLogsService.recordByActor(
      {
        action: 'APPROVAL_CANCELLED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.APPROVAL_CASE,
        primarySubjectNo: updated.approvalNo,
        correlationId: this.inheritedCorrelationId(updated),
        outcome: AuditOutcome.SUCCESS,
        reason: dto.reason || 'Approval cancelled',
        approvalNo: updated.approvalNo,
        fromStatus: previousStatus,
        toStatus: ApprovalStatuses.CANCELLED,
        subjects: this.approvalSubjects(updated),
        sourcePlatform: 'ADMIN_API',
        metadata:
          this.isSuperAdmin(actor) && actor.userId !== updated.createdByUserId
            ? { superAdminBypass: true }
            : undefined,
      },
      this.toAuditActor(actor),
    );
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.CANCELLED, this.buildEventPayload(updated));
    return this.mapApproval(updated, actor);
  }

  async requireApproved(input: ApprovalRequirementInput) {
    const approval = input.approvalCaseId
      ? await this.findCaseOrThrow(input.approvalCaseId)
      : ((await this.prisma.approvalCase.findFirst({
          where: {
            actionType: input.actionType,
            entityRef: input.entityRef,
          },
          include: this.approvalInclude(),
          orderBy: { createdAt: 'desc' },
        })) as ApprovalCaseRow | null);

    if (!approval) {
      if (input.actor) {
        await this.auditLogsService.recordByActor(
          {
            action: AuditActions.APPROVAL_REQUIRED_MISSING,
            primarySubjectType: AuditEntityTypes.APPROVAL_CASE,
            primarySubjectNo: input.entityRef,
            outcome: AuditOutcome.DENIED,
            reason: `Approval is required for ${input.actionType}:${input.entityRef}`,
            requestId: `APPROVAL_REQUIRED_${input.actionType}_${input.entityRef}`,
            sourcePlatform: 'ADMIN_API',
          },
          this.toAuditActor(input.actor),
        );
      }
      throw new ForbiddenException('Approval is required before this action can continue');
    }

    if (approval.actionType !== input.actionType || approval.entityRef !== input.entityRef) {
      throw new BadRequestException('Approval case does not match the requested action/entity');
    }
    if (input.traceId) {
      this.assertTraceConsistency(approval.traceId, input.traceId);
    }
    if (approval.status !== ApprovalStatuses.APPROVED) {
      throw new ForbiddenException(
        `Approval case ${approval.approvalNo} is ${approval.status} and cannot authorize this action`,
      );
    }

    return this.mapApproval(approval, input.actor);
  }

  async getById(id: string, actor?: ApprovalActorContext) {
    const approval = await this.findCaseOrThrow(id);
    const [mapped] = await this.mapApprovalsForReadModel([approval], actor);
    return mapped;
  }

  async list(query: ApprovalQueryDto, actor?: ApprovalActorContext) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);
    const where: Record<string, any> = {};

    if (query.actionType) where.actionType = String(query.actionType).trim().toUpperCase();
    if (query.status) where.status = String(query.status).trim().toUpperCase();
    if (query.approvalNo) where.approvalNo = query.approvalNo.trim();
    if (query.entityRef) where.entityRef = query.entityRef.trim();
    if (query.traceId) where.traceId = query.traceId.trim();
    if (query.keyword) {
      const keyword = query.keyword.trim();
      where.OR = [
        { approvalNo: { contains: keyword } },
        { id: { contains: keyword } },
        { actionType: { contains: keyword } },
        { entityRef: { contains: keyword } },
        { createdByUserNo: { contains: keyword } },
        { createdByUserId: { contains: keyword } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.approvalCase.count({ where }),
      this.prisma.approvalCase.findMany({
        where,
        skip,
        take,
        include: this.approvalInclude(),
        orderBy: [{ createdAt: 'desc' }],
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: await this.mapApprovalsForReadModel(rows as ApprovalCaseRow[], actor),
    };
  }

  async expirePendingApprovalCase(id: string) {
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.status !== ApprovalStatuses.PENDING) {
        return null;
      }

      const decidedAt = new Date();
      // Expire ALL remaining PENDING steps (preserves already-APPROVED steps)
      await tx.approvalStep.updateMany({
        where: {
          approvalCaseId: approval.id,
          status: ApprovalStepStatuses.PENDING,
        },
        data: {
          status: ApprovalStepStatuses.EXPIRED,
          reason: 'Approval expired after timeout',
          decidedAt,
        },
      });

      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.EXPIRED,
        },
        include: this.approvalInclude(),
      });

      return next as ApprovalCaseRow;
    });

    if (!updated) {
      return null;
    }

    await this.auditLogsService.recordSystem({
      action: 'APPROVAL_EXPIRED',
      actionDomain: 'APPROVAL',
      category: AuditCategory.GOVERNANCE,
      primarySubjectType: AuditEntityTypes.APPROVAL_CASE,
      primarySubjectNo: updated.approvalNo,
      correlationId: this.inheritedCorrelationId(updated),
      // 超时被系统记录下来，这个记录动作本身是成功的——不是系统挡住了谁。
      // DENIED 只留给 APPROVAL_SOD_DENIED 那种主动拦截。
      outcome: AuditOutcome.SUCCESS,
      reason: 'Approval expired after timeout',
      approvalNo: updated.approvalNo,
      fromStatus: ApprovalStatuses.PENDING,
      toStatus: ApprovalStatuses.EXPIRED,
      subjects: this.approvalSubjects(updated),
      sourcePlatform: 'CRON',
    });
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.EXPIRED, this.buildEventPayload(updated));
    return this.mapApproval(updated, this.systemActor());
  }

  async expirePendingApprovals() {
    const now = new Date();
    const rows = await this.prisma.approvalCase.findMany({
      where: {
        status: ApprovalStatuses.PENDING,
        timeoutAt: {
          lt: now,
        },
      },
      select: { id: true },
      take: 200,
      orderBy: { timeoutAt: 'asc' },
    });

    const expiredIds: string[] = [];
    for (const row of rows) {
      const updated = await this.expirePendingApprovalCase(row.id);
      if (updated) {
        expiredIds.push(updated.id);
      }
    }

    return {
      expiredCount: expiredIds.length,
      expiredIds,
    };
  }
}
