import { Injectable, BadRequestException, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import {
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { RBAC_PERMISSION_DEFINITIONS } from './rbac.catalog';

const ROLE_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,48}$/;

const VALID_PERMISSION_GROUPS = new Set<string>(
  RBAC_PERMISSION_DEFINITIONS.flatMap((p) => p.groups),
);

interface CreateRoleDefinitionDto {
  roleCode: string;
  roleName: string;
  description?: string;
  permissionGroupCodes: string[];
  changeReason: string;
}

const SECONDARY_EVENT = 'workflow.role-definition-create.decided';

@Injectable()
export class RoleDefinitionCreateWorkflowService {
  private readonly logger = new Logger(RoleDefinitionCreateWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** 波二 §1.2：镜像主表 PRIMARY 进子表（Related No 检索只查子表，audit-logs.service.ts:1031-1036）
   *  + 审批单凭据行。形状照 approvals.service.ts approvalSubjects 先例。 */
  private roleSubjects(roleCode: string, approvalNo?: string | null): AuditSubjectInput[] {
    const rows: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.ACCESS_CONTROL, subjectNo: roleCode, subjectRole: AuditSubjectRole.PRIMARY },
    ];
    if (approvalNo) {
      rows.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    }
    return rows;
  }

  async initiateCreate(dto: CreateRoleDefinitionDto, actor: ApprovalActorContext) {
    const roleCode = dto.roleCode.trim().toUpperCase();
    const roleName = dto.roleName.trim();
    const description = dto.description?.trim() || null;
    const permissionGroupCodes = dto.permissionGroupCodes;
    const changeReason = dto.changeReason.trim();

    if (!ROLE_CODE_REGEX.test(roleCode)) {
      throw new BadRequestException(
        'roleCode must be uppercase letters, digits, and underscores (2-49 chars), starting with a letter',
      );
    }
    if (!roleName) {
      throw new BadRequestException('roleName is required');
    }
    if (!permissionGroupCodes || permissionGroupCodes.length === 0) {
      throw new BadRequestException('At least one permission group is required');
    }
    if (!changeReason) {
      throw new BadRequestException('changeReason is required');
    }

    const invalidGroups = permissionGroupCodes.filter((g) => !VALID_PERMISSION_GROUPS.has(g));
    if (invalidGroups.length > 0) {
      throw new BadRequestException(`Invalid permission groups: ${invalidGroups.join(', ')}`);
    }

    const existing = await this.prisma.role.findUnique({ where: { code: roleCode } });
    if (existing) {
      throw new BadRequestException(`Role code '${roleCode}' already exists`);
    }

    // START：本次创建旅程的 correlationId。Role 表没有 traceId/correlationId 列，
    // 同一个值同事务写进 ApprovalCase.traceId（经 createAndSubmit 的 traceId 入参）承载，
    // 供下游 executeActivation/executeCancellation 经 ApprovalDecidedEvent.traceId INHERIT 读回
    // ——与 Task 6 角色变更工作流同款模式。
    const correlationId = crypto.randomUUID();

    const role = await this.prisma.role.create({
      data: {
        code: roleCode,
        name: roleName,
        description,
        status: 'PENDING_APPROVAL',
        proposedPermissionGroups: JSON.stringify(permissionGroupCodes),
      },
    });

    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ROLE_DEFINITION_CREATE,
          entityRef: role.code,
          traceId: correlationId,
          objectSnapshot: {
            roleCode,
            roleName,
            description,
            permissionGroupCodes,
            status: 'PENDING_APPROVAL',
          },
        },
        {
          reason: changeReason,
          traceId: correlationId,
        },
        actor,
      );
    } catch (err) {
      await this.prisma.role.delete({ where: { id: role.id } });
      throw err;
    }

    await this.prisma.role.update({
      where: { id: role.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    // afterData：CREATE 没有「前」态，只存提案身份本身——不存 status/id/createdAt 等机械字段。
    const afterData = { roleName, description, permissionGroupCodes };

    await this.auditLogsService.recordByActor(
      {
        action: 'ROLE_DEFINITION_CREATE_REQUESTED',
        actionDomain: 'CONFIG',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: roleCode,
        correlationId,
        outcome: AuditOutcome.SUCCESS,
        reason: changeReason,
        afterData,
        subjects: this.roleSubjects(roleCode, approvalCase.approvalNo),
        metadata: {
          approvalNo: approvalCase.approvalNo,
        },
        requestId: crypto.randomUUID(),
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
      roleCode,
      roleName,
      approvalNo: approvalCase.approvalNo,
      status: 'PENDING_APPROVAL',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any) {
    const decision = payload?.decision;
    const approvalId = payload?.approvalId;
    const entityRef = payload?.entityRef;

    if (!approvalId || !entityRef) {
      this.logger.warn('Role definition create decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeActivation(approvalId, entityRef, payload);
    } else {
      await this.executeCancellation(approvalId, entityRef, decision, payload);
    }
  }

  private async executeActivation(approvalId: string, roleCode: string, event: any) {
    // entityRef 现在存 role.code（铁律⑥），按码回查——role.id 只在下方内部写入
    // （rolePermission/role.update）继续使用。
    const role = await this.prisma.role.findUnique({ where: { code: roleCode } });
    if (!role || role.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`Role ${roleCode} not found or not in PENDING_APPROVAL status`);
      return;
    }

    // 保留未注入 BASE_ACCESS 前的原始提案列表，供 afterData 与 REQUESTED 记录的口径保持一致
    // （BASE_ACCESS 注入是内部实现细节，不是管理员的变更意图）。
    const proposedGroupCodes: string[] = JSON.parse(role.proposedPermissionGroups || '[]');
    const afterData = { permissionGroupCodes: proposedGroupCodes };

    try {
      const groupCodes = [...proposedGroupCodes];

      /* Every role must include BASE_ACCESS for /auth/me to work */
      if (!groupCodes.includes('BASE_ACCESS')) {
        groupCodes.push('BASE_ACCESS');
      }

      const permissionCodes = RBAC_PERMISSION_DEFINITIONS
        .filter((p) => p.groups.some((g) => groupCodes.includes(g)))
        .map((p) => p.code);

      const uniqueCodes = [...new Set(permissionCodes)];

      const permissions = await this.prisma.permission.findMany({
        where: { code: { in: uniqueCodes } },
        select: { id: true, code: true },
      });

      if (permissions.length > 0) {
        await (this.prisma as any).rolePermission.createMany({
          data: permissions.map((p: any) => ({
            roleId: role.id,
            permissionId: p.id,
          })),
        });
      }

      await this.prisma.role.update({
        where: { id: role.id },
        data: {
          status: 'ACTIVE',
          proposedPermissionGroups: null,
        },
      });

      await this.auditLogsService.recordSystem({
        action: 'ROLE_DEFINITION_CREATE_APPLIED',
        actionDomain: 'CONFIG',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: role.code,
        // INHERIT：读 ApprovalDecidedEvent.traceId——它就是 initiateCreate 铸造的
        // correlationId 原样传播过来的（经 ApprovalCase.traceId）。
        correlationId: event?.traceId,
        // 异步驱动：这条记录是被"审批已批准"这个决定触发的。
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        afterData,
        approvalNo: event?.approvalNo,
        subjects: this.roleSubjects(role.code, event?.approvalNo),
        metadata: {
          permissionsWritten: uniqueCodes.length,
        },
        requestId: crypto.randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

      this.logger.log(`Role ${role.code} activated with ${uniqueCodes.length} permissions`);
    } catch (err: any) {
      this.logger.error(`Failed to activate role ${roleCode}: ${err.message}`);

      // 退役码 ROLE_ACTIVATE_FAILED 收编进来——同一动作码 ROLE_DEFINITION_CREATE_APPLIED，
      // 靠 outcome=FAILED 区分，不另起一个 _FAILED 后缀码（词表未给这一步单独开码）。
      await this.auditLogsService.recordSystem({
        action: 'ROLE_DEFINITION_CREATE_APPLIED',
        actionDomain: 'CONFIG',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: role.code,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.FAILED,
        reasonCode: 'EXECUTION_FAILED',
        reason: err.message,
        afterData,
        approvalNo: event?.approvalNo,
        subjects: this.roleSubjects(role.code, event?.approvalNo),
        metadata: { error: err.message },
        requestId: crypto.randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });
    }
  }

  private async executeCancellation(approvalId: string, roleCode: string, decision: string, event: any) {
    try {
      const role = await this.prisma.role.findUnique({ where: { code: roleCode } });
      if (!role) {
        this.logger.warn(`Role ${roleCode} not found for cancellation`);
        return;
      }
      // 取消守卫：裸 delete 此前不查状态——已终态(如另一条路径已把角色激活为 ACTIVE)
      // 的创建申请仍可能被一次迟到/重复的取消事件删掉。只有还在 PENDING_APPROVAL 的
      // 提案才允许被取消删除。
      if (role.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Role ${roleCode} not in PENDING_APPROVAL status (status=${role.status}), skip cancellation`);
        return;
      }

      await this.prisma.role.delete({ where: { id: role.id } });

      await this.auditLogsService.recordSystem({
        action: 'ROLE_DEFINITION_CREATE_CANCELLED',
        actionDomain: 'CONFIG',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: role.code,
        correlationId: event?.traceId,
        causationId: approvalId,
        outcome: AuditOutcome.SUCCESS,
        reason: event?.decisionReason || `Role definition create request ${String(decision).toLowerCase()}`,
        subjects: this.roleSubjects(role.code, event?.approvalNo),
        metadata: { decision },
        requestId: crypto.randomUUID(),
        sourcePlatform: 'ADMIN_API',
      });

      this.logger.log(`Role ${role.code} creation cancelled (${decision}), row deleted`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel role creation ${roleCode}: ${err.message}`);
    }
  }
}
