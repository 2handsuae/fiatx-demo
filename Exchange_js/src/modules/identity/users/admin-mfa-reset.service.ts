import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditEntityTypes,
  AuditGovernanceActions,
  AuditWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { UsersDomainService } from './users.domain.service';

export interface MfaResetActor {
  actorType: 'ADMIN';
  actorId: string;
  actorNo: string;
  actorRole: string;
}

@Injectable()
export class AdminMfaResetService {
  constructor(
    private readonly usersDomainService: UsersDomainService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async executeMfaReset(
    targetUserId: string,
    actor: MfaResetActor,
  ): Promise<{
    message: string;
    userId: string;
    userNo: string;
    newStatus: string;
  }> {
    const traceId = randomUUID();

    // Domain service validates preconditions (ACTIVE + MFA bound) and clears MFA state
    const targetUser = await this.usersDomainService.resetMfa(targetUserId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ADMIN_CREDENTIAL_MGMT.MFA_RESET_EXECUTED,
        entityType: AuditEntityTypes.ADMIN_USER,
        entityId: targetUser.id,
        entityNo: targetUser.userNo,
        workflowType: AuditWorkflowTypes.ADMIN_CREDENTIAL_MGMT,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetEmail: targetUser.email,
          targetRole: targetUser.role,
          selfReset: actor.actorId === targetUser.id,
        },
        sourcePlatform: 'ADMIN_API',
      },
      actor,
    );

    return {
      message: 'MFA reset successful',
      userId: targetUser.id,
      userNo: targetUser.userNo,
      newStatus: 'PENDING_IDENTITY_CONFIRM',
    };
  }
}
