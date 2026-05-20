import { Injectable, BadRequestException, NotFoundException, Inject, Logger } from '@nestjs/common';
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
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

const VALID_PERMISSION_GROUPS = new Set<string>(
  RBAC_PERMISSION_DEFINITIONS.flatMap((p) => p.groups),
);

interface ModifyRoleDefinitionDto {
  proposedName: string;
  proposedDescription?: string;
  proposedPermissionGroups: string[];
  changeReason: string;
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

    /* Create and submit approval case */
    const traceId = `rdm-${request.id}`;
    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.ROLE_DEFINITION_MODIFY,
          entityRef: request.id,
          traceId,
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
        { reason: changeReason.trim(), traceId },
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

    /* Audit */
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ROLE_DEFINITION_MODIFY.MODIFY_REQUESTED,
        entityType: AuditEntityTypes.ACCESS_CONTROL,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          roleCode: role.code,
          proposedName: proposedName.trim(),
          proposedPermissionGroups,
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
    const traceId = payload?.traceId || `rdm-exec-${requestId}`;

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
      await this.failRequest(request, approvalId, reason, traceId);
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
      await this.failRequest(request, approvalId, reason, traceId);
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
          status: 'APPROVED',
          executedAt: new Date(),
        },
      });
    });

    /* Audit */
    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ROLE_DEFINITION_MODIFY.ROLE_MODIFIED,
      entityType: AuditEntityTypes.ACCESS_CONTROL,
      entityId: request.id,
      entityNo: request.requestNo,
      workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
      traceId,
      result: AuditResult.SUCCESS,
      metadata: {
        roleCode: role.code,
        proposedName: request.proposedName,
        proposedPermissionGroups: JSON.parse(request.proposedPermissionGroups),
        permissionCount: permissionCodes.length,
      },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`[executeModification] Role ${role.code} modified via request ${request.requestNo}`);
  }

  /* ── Fail request (conflict or missing role) ── */

  private async failRequest(request: any, approvalId: string, reason: string, traceId: string) {
    await this.prisma.roleDefinitionModifyRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', failureReason: reason, executedAt: new Date() },
    });

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ROLE_DEFINITION_MODIFY.ROLE_MODIFY_FAILED,
      entityType: AuditEntityTypes.ACCESS_CONTROL,
      entityId: request.id,
      entityNo: request.requestNo,
      workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
      traceId,
      result: AuditResult.FAILED,
      metadata: { failureReason: reason },
      sourcePlatform: 'SYSTEM',
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
    const traceId = payload?.traceId || `rdm-cancel-${requestId}`;

    const request = await this.prisma.roleDefinitionModifyRequest.findUnique({
      where: { id: requestId },
    });
    if (!request || request.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`[executeCancellation] Request ${requestId} not PENDING_APPROVAL`);
      return;
    }

    const newStatus = decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED';

    await this.prisma.roleDefinitionModifyRequest.update({
      where: { id: request.id },
      data: { status: newStatus },
    });

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ROLE_DEFINITION_MODIFY.MODIFY_CANCELLED,
      entityType: AuditEntityTypes.ACCESS_CONTROL,
      entityId: request.id,
      entityNo: request.requestNo,
      workflowType: AuditBusinessWorkflowTypes.ROLE_DEFINITION_MODIFY,
      traceId,
      result: AuditResult.SUCCESS,
      metadata: { decision },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`[executeCancellation] Request ${request.requestNo} ${newStatus}`);
  }
}
