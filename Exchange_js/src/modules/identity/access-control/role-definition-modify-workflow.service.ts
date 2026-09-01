import { Injectable, BadRequestException, NotFoundException, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { RBAC_PERMISSION_DEFINITIONS, type PermissionGroup } from './rbac.catalog';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { RoleRequestAction, assertRoleRequestTransition } from './constants/role-request-transitions.constant';

const VALID_PERMISSION_GROUPS = new Set<string>(
  RBAC_PERMISSION_DEFINITIONS.flatMap((p) => p.groups),
);

interface ModifyRoleDefinitionDto {
  proposedName: string;
  proposedDescription?: string;
  proposedPermissionGroups: string[];
  changeReason: string;
}

interface RoleDefinitionSnapshot {
  name: string;
  description: string | null;
  permissionGroups: string[];
}

const SECONDARY_EVENT = 'workflow.role-definition-modify.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class RoleDefinitionModifyWorkflowService {
  private readonly logger = new Logger(RoleDefinitionModifyWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * 本流程 PRIMARY 主体是 requestNo（申请单号），被修改的角色本身降级为 RELATED——
   * 同 approvalSubjects 的形状（PRIMARY 已经在主表 primarySubjectType/No 两列上，
   * 这里只补 RELATED 行，不重复传 PRIMARY）。
   */
  private roleRelatedSubject(roleCode: string): AuditSubjectInput[] {
    return [
      { subjectType: AuditEntityTypes.ACCESS_CONTROL, subjectNo: roleCode, subjectRole: AuditSubjectRole.RELATED },
    ];
  }

  /**
   * beforeData/afterData 只存变更项——三个可改字段（name/description/permissionGroups）
   * 里只有值真的不同的那些才进结果，机械字段（status/timestamps/changeReason 等）
   * 从不进来。REQUESTED 与 APPLIED（成功/失败两分支）三处调用同一份逻辑，保证同一次
   * 变更旅程里的 diff 口径完全一致。
   */
  private buildModifyDiff(
    before: RoleDefinitionSnapshot,
    after: RoleDefinitionSnapshot,
  ): { beforeData: Record<string, unknown>; afterData: Record<string, unknown> } {
    const beforeData: Record<string, unknown> = {};
    const afterData: Record<string, unknown> = {};

    if (before.name !== after.name) {
      beforeData.name = before.name;
      afterData.name = after.name;
    }
    if ((before.description ?? null) !== (after.description ?? null)) {
      beforeData.description = before.description ?? null;
      afterData.description = after.description ?? null;
    }
    const sortedBefore = [...before.permissionGroups].sort();
    const sortedAfter = [...after.permissionGroups].sort();
    if (JSON.stringify(sortedBefore) !== JSON.stringify(sortedAfter)) {
      beforeData.permissionGroups = before.permissionGroups;
      afterData.permissionGroups = after.permissionGroups;
    }

    return { beforeData, afterData };
  }

  /**
   * APPLIED（成功/失败两分支共用）与 REQUESTED 复算同一份 diff，来源是持久化在
   * request 行上的 current 前缀 / proposed 前缀列——三处口径天然保持一致，不需要额外传参。
   */
  private buildModifyDiffFromRequest(request: any) {
    return this.buildModifyDiff(
      {
        name: request.currentName,
        description: request.currentDescription,
        permissionGroups: JSON.parse(request.currentPermissionGroups),
      },
      {
        name: request.proposedName,
        description: request.proposedDescription,
        permissionGroups: JSON.parse(request.proposedPermissionGroups),
      },
    );
  }

  /* ── Initiate ── */

  async initiateModify(
    roleId: string,
    dto: ModifyRoleDefinitionDto,
    actor: ApprovalActorContext,
  ) {
    const { proposedName, proposedDescription, proposedPermissionGroups, changeReason } = dto;

    /* Validate inputs */
    if (!proposedName?.trim()) {
      throw new BadRequestException('proposedName is required.');
    }
    if (!proposedPermissionGroups?.length) {
      throw new BadRequestException('proposedPermissionGroups must be non-empty.');
    }
    if (!changeReason?.trim()) {
      throw new BadRequestException('changeReason is required.');
    }
    const invalidGroups = proposedPermissionGroups.filter((g) => !VALID_PERMISSION_GROUPS.has(g));
    if (invalidGroups.length > 0) {
      throw new BadRequestException(`Invalid permission groups: ${invalidGroups.join(', ')}`);
    }

    /* Load role */
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role) {
      throw new NotFoundException(`Role not found: ${roleId}`);
    }
    if (role.status !== 'ACTIVE') {
      throw new BadRequestException(`Role must be ACTIVE to modify. Current status: ${role.status}`);
    }

    /* Check no pending modify request exists */
    const pendingRequest = await this.prisma.roleDefinitionModifyRequest.findFirst({
      where: { roleId, status: 'PENDING_APPROVAL' },
    });
    if (pendingRequest) {
      throw new BadRequestException(
        `Role ${role.code} already has a pending modify request: ${pendingRequest.requestNo}`,
      );
    }

    /* Derive current permission groups from existing RolePermission rows */
    const currentGroupsSet = new Set<string>();
    for (const rp of role.rolePermissions) {
      const def = RBAC_PERMISSION_DEFINITIONS.find((d) => d.code === rp.permission.code);
      if (def) {
        for (const g of def.groups) currentGroupsSet.add(g);
      }
    }
    const currentPermissionGroups = Array.from(currentGroupsSet).sort();

    /* Create request record */
    const requestNo = generateReferenceNo('RDM-');
    const request = await this.prisma.roleDefinitionModifyRequest.create({
      data: {
        requestNo,
        roleId,
        currentName: role.name,
        currentDescription: role.description,
        currentPermissionGroups: JSON.stringify(currentPermissionGroups),
        proposedName: proposedName.trim(),
        proposedDescription: proposedDescription?.trim() || null,
        proposedPermissionGroups: JSON.stringify(proposedPermissionGroups),
        changeReason: changeReason.trim(),
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });

    // START：本次修改旅程的 correlationId。RoleDefinitionModifyRequest 表没有
    // traceId/correlationId 列，同一个值同事务写进 ApprovalCase.traceId（经
    // createAndSubmit 的 traceId 入参）承载，供下游 executeModification/executeCancellation
    // 经 ApprovalDecidedEvent.traceId INHERIT 读回。
    const correlationId = randomUUID();
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ROLE_DEFINITION_MODIFY,
          entityRef: request.id,
          traceId: correlationId,
          objectSnapshot: {
            roleCode: role.code,
            currentName: role.name,
            currentDescription: role.description,
            currentPermissionGroups,
            proposedName: proposedName.trim(),
            proposedDescription: proposedDescription?.trim() || null,
            proposedPermissionGroups,
          },
        },
        { reason: changeReason.trim(), traceId: correlationId },
        actor,
      );
    } catch (err) {
      /* Rollback: delete request record */
      await this.prisma.roleDefinitionModifyRequest.delete({ where: { id: request.id } });
      throw err;
    }

    /* Link approval case back to request */
    await this.prisma.roleDefinitionModifyRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    const { beforeData, afterData } = this.buildModifyDiff(
      { name: role.name, description: role.description, permissionGroups: currentPermissionGroups },
      {
        name: proposedName.trim(),
        description: proposedDescription?.trim() || null,
        permissionGroups: proposedPermissionGroups,
      },
    );

    /* Audit */
    await this.auditLogsService.recordByActor(
      {
        action: 'ROLE_DEFINITION_MODIFY_REQUESTED',
        actionDomain: 'CONFIG',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: requestNo,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason: changeReason.trim(),
        beforeData,
        afterData,
        subjects: this.roleRelatedSubject(role.code),
        metadata: {
          roleCode: role.code,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorNo: actor.userNo || 'UNKNOWN',
        actorDisplayName: actor.userNo || 'UNKNOWN',
        actorRolesAtTime: [actor.role || actor.roleCodes[0] || 'UNKNOWN'],
      },
    );

    return {
      requestNo,
      roleCode: role.code,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  /* ── Approval decided ── */

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    const decision = payload?.decision;
    const approvalId = payload?.approvalId;
    const entityRef = payload?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn(`[onDecided] Missing approvalId or entityRef: ${JSON.stringify(payload)}`);
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeModification(approvalId, entityRef, payload);
    } else {
      await this.executeCancellation(approvalId, entityRef, decision, payload);
    }
  }

  /* ── Execute modification (on APPROVED) ── */

  private async executeModification(approvalId: string, requestId: string, payload: any) {
    // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 initiateModify 铸造的 correlationId
    // 原样传播过来的（经 ApprovalCase.traceId）。读不到就让 assertActionSpec 在写入时报错，
    // 不再用 `rdm-exec-${requestId}` 这类兜底字符串掩盖断链。
    const correlationId = payload?.traceId;

    const request = await this.prisma.roleDefinitionModifyRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`[executeModification] Request ${requestId} not found or not PENDING_APPROVAL`);
      return;
    }

    const role = await this.prisma.role.findUnique({
      where: { id: request.roleId },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role || role.status !== 'ACTIVE') {
      const reason = !role ? 'Role not found' : `Role status is ${role.status}`;
      // role 可能压根不存在（角色被删）——这种情况下没有 roleCode 可用，RELATED 行
      // 随之省略，不编造一个值。
      await this.failRequest(request, approvalId, reason, correlationId, 'EXECUTION_FAILED', role?.code);
      return;
    }

    /* Conflict detection: derive current groups and compare */
    const actualGroupsSet = new Set<string>();
    for (const rp of role.rolePermissions) {
      const def = RBAC_PERMISSION_DEFINITIONS.find((d) => d.code === rp.permission.code);
      if (def) {
        for (const g of def.groups) actualGroupsSet.add(g);
      }
    }
    const actualGroups = Array.from(actualGroupsSet).sort();
    const snapshotGroups: string[] = JSON.parse(request.currentPermissionGroups);
    snapshotGroups.sort();

    if (JSON.stringify(actualGroups) !== JSON.stringify(snapshotGroups)) {
      const reason = `Conflict: role permissions changed since request was submitted. Expected groups: ${JSON.stringify(snapshotGroups)}, actual: ${JSON.stringify(actualGroups)}`;
      await this.failRequest(request, approvalId, reason, correlationId, 'ROLE_CONFLICT', role.code);
      return;
    }

    /* Resolve proposed groups to permission codes */
    const proposedGroups: string[] = JSON.parse(request.proposedPermissionGroups);

    /* Every role must include BASE_ACCESS for /auth/me to work */
    if (!proposedGroups.includes('BASE_ACCESS')) {
      proposedGroups.push('BASE_ACCESS');
    }

    const proposedGroupSet = new Set<string>(proposedGroups);
    const permissionCodes = RBAC_PERMISSION_DEFINITIONS
      .filter((p) => p.groups.some((g) => proposedGroupSet.has(g)))
      .map((p) => p.code);

    /* Look up Permission records by code */
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
    });
    const permissionIdByCode = new Map(permissions.map((p: any) => [p.code, p.id]));

    /* Execute in transaction: delete old RolePermissions, create new, update Role */
    await this.prisma.$transaction(async (tx: any) => {
      /* Delete old RolePermission rows */
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });

      /* Create new RolePermission rows */
      const rpData = permissionCodes
        .filter((code) => permissionIdByCode.has(code))
        .map((code) => ({
          roleId: role.id,
          permissionId: permissionIdByCode.get(code)!,
        }));
      if (rpData.length > 0) {
        await tx.rolePermission.createMany({ data: rpData });
      }

      /* Update Role name/description */
      await tx.role.update({
        where: { id: role.id },
        data: {
          name: request.proposedName,
          description: request.proposedDescription,
        },
      });

      /* Mark request as APPROVED */
      await tx.roleDefinitionModifyRequest.update({
        where: { id: request.id },
        data: {
          status: assertRoleRequestTransition(request.status, RoleRequestAction.APPROVE),
          executedAt: new Date(),
        },
      });
    });

    const { beforeData, afterData } = this.buildModifyDiffFromRequest(request);

    /* Audit */
    await this.auditLogsService.recordSystem({
      action: 'ROLE_DEFINITION_MODIFY_APPLIED',
      actionDomain: 'CONFIG',
      category: AuditCategory.GOVERNANCE,
      primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
      primarySubjectNo: request.requestNo,
      correlationId,
      // 异步驱动：这条记录是被"审批已批准"这个决定触发的。
      causationId: approvalId,
      outcome: AuditOutcome.SUCCESS,
      beforeData,
      afterData,
      subjects: this.roleRelatedSubject(role.code),
      approvalNo: payload?.approvalNo,
      metadata: {
        roleCode: role.code,
        permissionCount: permissionCodes.length,
      },
      requestId: randomUUID(),
      sourcePlatform: 'ADMIN_API',
    });

    this.logger.log(`[executeModification] Role ${role.code} modified via request ${request.requestNo}`);
  }

  /* ── Fail request (conflict or missing role) ── */

  private async failRequest(
    request: any,
    approvalId: string,
    reason: string,
    correlationId: string | undefined,
    reasonCode: string,
    roleCode?: string,
  ) {
    await this.prisma.roleDefinitionModifyRequest.update({
      where: { id: request.id },
      data: {
        status: assertRoleRequestTransition(request.status, RoleRequestAction.FAIL),
        failureReason: reason,
        executedAt: new Date(),
      },
    });

    const { beforeData, afterData } = this.buildModifyDiffFromRequest(request);

    // 退役码 ROLE_MODIFY_FAILED 收编进来——同一动作码 ROLE_DEFINITION_MODIFY_APPLIED，
    // 靠 outcome=FAILED 区分，不另起一个 _FAILED 后缀码（词表未给这一步单独开码，同角色
    // 定义创建工作流"同码不同 outcome"原则）。approvalNo 取 request.approvalCaseNo——
    // 这条记录不是从 ApprovalDecidedEvent 直接派生的分支，request 行上的值与
    // event.approvalNo 恒等（同一张审批单）。
    await this.auditLogsService.recordSystem({
      action: 'ROLE_DEFINITION_MODIFY_APPLIED',
      actionDomain: 'CONFIG',
      category: AuditCategory.GOVERNANCE,
      primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
      primarySubjectNo: request.requestNo,
      correlationId,
      causationId: approvalId,
      outcome: AuditOutcome.FAILED,
      // 合同闸(assertActionSpec)对非成功记录强制要求 reasonCode——两个调用方传入的值
      // 按各自真实成因区分：角色不存在/未激活用通用 EXECUTION_FAILED，权限快照与当前
      // 值不一致（审批在途时角色被改）用更具体的 ROLE_CONFLICT。
      reasonCode,
      reason,
      beforeData,
      afterData,
      subjects: roleCode ? this.roleRelatedSubject(roleCode) : undefined,
      approvalNo: request.approvalCaseNo || undefined,
      metadata: { failureReason: reason },
      requestId: randomUUID(),
      sourcePlatform: 'ADMIN_API',
    });

    this.logger.warn(`[failRequest] Request ${request.requestNo} failed: ${reason}`);
  }

  /* ── Execute cancellation (on REJECTED / CANCELLED / EXPIRED) ── */

  private async executeCancellation(
    approvalId: string,
    requestId: string,
    decision: string,
    payload: any,
  ) {
    const correlationId = payload?.traceId;

    const request = await this.prisma.roleDefinitionModifyRequest.findUnique({
      where: { id: requestId },
      include: { role: { select: { code: true } } },
    });
    if (!request || request.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`[executeCancellation] Request ${requestId} not PENDING_APPROVAL`);
      return;
    }

    // 修边：审批 handler(approval-handler.base.ts)发的驳回信号是 'DECLINED'，
    // 从不是 'REJECTED'——此前这里比对 'REJECTED' 恒假，三种终止原因(驳回/取消/超时)
    // 全落 CANCELLED 一个桶，REJECTED 态从建成起不可达。经迁移表显式映射，非法来源态拒绝。
    const action =
      decision === 'DECLINED' ? RoleRequestAction.REJECT
      : decision === 'EXPIRED' ? RoleRequestAction.EXPIRE
      : RoleRequestAction.CANCEL;
    const newStatus = assertRoleRequestTransition(request.status, action);

    await this.prisma.roleDefinitionModifyRequest.update({
      where: { id: request.id },
      data: { status: newStatus },
    });

    await this.auditLogsService.recordSystem({
      action: 'ROLE_DEFINITION_MODIFY_CANCELLED',
      actionDomain: 'CONFIG',
      category: AuditCategory.GOVERNANCE,
      primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
      primarySubjectNo: request.requestNo,
      correlationId,
      causationId: approvalId,
      outcome: AuditOutcome.SUCCESS,
      subjects: (request as any).role?.code ? this.roleRelatedSubject((request as any).role.code) : undefined,
      reason: payload?.decisionReason || `Role definition modify request ${String(decision).toLowerCase()}`,
      metadata: { decision },
      requestId: randomUUID(),
      sourcePlatform: 'ADMIN_API',
    });

    this.logger.log(`[executeCancellation] Request ${request.requestNo} ${newStatus}`);
  }
}
