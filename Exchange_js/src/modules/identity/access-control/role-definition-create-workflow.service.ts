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
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { RBAC_PERMISSION_DEFINITIONS, type PermissionGroup } from './rbac.catalog';

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

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class RoleDefinitionCreateWorkflowService {
  private readonly logger = new Logger(RoleDefinitionCreateWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

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

    const traceId = crypto.randomUUID();

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
          entityRef: role.id,
          traceId,
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
          traceId,
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

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ROLE_DEFINITION_CREATE.CREATE_REQUESTED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: role.id,
        entityNo: roleCode,
        workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          roleName,
          permissionGroupCodes,
          changeReason,
          approvalNo: approvalCase.approvalNo,
        },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
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

  private async executeActivation(approvalId: string, roleId: string, event: any) {
    try {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (!role || role.status !== 'PENDING_APPROVAL') {
        this.logger.warn(`Role ${roleId} not found or not in PENDING_APPROVAL status`);
        return;
      }

      const groupCodes: string[] = JSON.parse(role.proposedPermissionGroups || '[]');

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
        action: AuditGovernanceActions.ROLE_DEFINITION_CREATE.ROLE_ACTIVATED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: role.id,
        entityNo: role.code,
        workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          permissionGroupCodes: groupCodes,
          permissionsWritten: uniqueCodes.length,
        },
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Role ${role.code} activated with ${uniqueCodes.length} permissions`);
    } catch (err: any) {
      this.logger.error(`Failed to activate role ${roleId}: ${err.message}`);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ROLE_DEFINITION_CREATE.ROLE_ACTIVATE_FAILED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: roleId,
        workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(approvalId: string, roleId: string, decision: string, event: any) {
    try {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        this.logger.warn(`Role ${roleId} not found for cancellation`);
        return;
      }

      await this.prisma.role.delete({ where: { id: role.id } });

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ROLE_DEFINITION_CREATE.CREATE_CANCELLED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: role.id,
        entityNo: role.code,
        workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_CREATE,
        traceId: event?.traceId,
        result: AuditResult.SUCCESS,
        metadata: { decision },
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Role ${role.code} creation cancelled (${decision}), row deleted`);
    } catch (err: any) {
      this.logger.error(`Failed to cancel role creation ${roleId}: ${err.message}`);
    }
  }
}
