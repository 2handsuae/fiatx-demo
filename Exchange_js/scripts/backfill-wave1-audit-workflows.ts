import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
} from '../src/modules/audit-logging/constants/audit-actions.constant';
import { ApprovalActionTypes } from '../src/modules/governance/approvals/constants/approval.constants';
import {
  ChangeTicketTypes,
} from '../src/modules/governance/change-tickets/constants/change-ticket.constants';
import {
  DeleteRequestTargetTypes,
} from '../src/modules/governance/delete-requests/constants/delete-request.constants';

const prisma = new PrismaClient();
const syntheticProvisioningTraceByUserNo = new Map<string, string>();

const APPROVAL_AUDIT_ACTIONS = [
  AuditActions.APPROVAL_SUBMITTED,
  AuditActions.APPROVAL_APPROVED,
  AuditActions.APPROVAL_REJECTED,
  AuditActions.APPROVAL_CANCELLED,
  AuditActions.APPROVAL_EXPIRED,
  AuditActions.APPROVAL_EXECUTED,
  AuditActions.APPROVAL_EXECUTION_FAILED,
  AuditActions.APPROVAL_REQUIRED_MISSING,
];

const PROVISIONING_AUDIT_ACTIONS = [
  AuditActions.USER_CREATED,
  AuditActions.USER_ROLE_BINDING_UPDATED,
  AuditActions.ADMIN_INVITATION_CREATED,
  AuditActions.ADMIN_INVITATION_RESENT,
  AuditActions.ADMIN_INVITATION_ACCEPTED,
  AuditActions.ADMIN_INVITATION_ACCEPT_FAILED,
];

const LOGIN_AUDIT_ACTIONS = [
  AuditActions.ADMIN_LOGIN_SUCCESS,
  AuditActions.ADMIN_LOGIN_FAILED,
  AuditActions.ACCOUNT_LOCKED,
  AuditActions.ACCOUNT_UNLOCKED,
];

const EVIDENCE_EXPORT_AUDIT_ACTIONS = [
  AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED,
  AuditActions.CASE_EVIDENCE_PACKAGE_EXPORTED,
];

type WorkflowContext = {
  workflowType: string;
  workflowNo: string;
  traceId: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  return {
    apply,
    dryRun: !apply,
  };
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim().length === 0;
}

function normalizeString(value: unknown): string | null {
  if (isBlank(value)) return null;
  return String(value).trim();
}

function mapChangeTypeToWorkflow(changeType: string | null | undefined): string | null {
  const normalized = normalizeString(changeType);
  switch (normalized) {
    case ChangeTicketTypes.ADMIN_ACCESS_CHANGE:
      return AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING;
    case ChangeTicketTypes.RBAC_CATALOG_CHANGE:
      return AuditBusinessWorkflowTypes.ADMIN_ROLE_BINDING_CHANGE;
    default:
      return null;
  }
}

function mapDeleteTargetToWorkflow(targetType: string | null | undefined): string | null {
  const normalized = normalizeString(targetType);
  switch (normalized) {
    case DeleteRequestTargetTypes.CHANGE_TICKET:
      return AuditBusinessWorkflowTypes.CHANGE_TICKET_DELETION;
    case DeleteRequestTargetTypes.ADMIN_USER:
      return AuditBusinessWorkflowTypes.ADMIN_USER_DELETION;
    case DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE:
      return AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_PACKAGE_DELETION;
    default:
      return null;
  }
}

function getSyntheticProvisioningTrace(userNo: string): string {
  const existing = syntheticProvisioningTraceByUserNo.get(userNo);
  if (existing) {
    return existing;
  }
  const created = randomUUID();
  syntheticProvisioningTraceByUserNo.set(userNo, created);
  return created;
}

async function deriveProvisioningContext(input: {
  userId?: string | null;
  userNo?: string | null;
  workflowNo?: string | null;
  traceId?: string | null;
}): Promise<WorkflowContext | null> {
  const explicitWorkflowNo = normalizeString(input.workflowNo);
  const explicitTraceId = normalizeString(input.traceId);

  if (explicitWorkflowNo) {
    const ticket = await prisma.changeTicket.findFirst({
      where: { ticketNo: explicitWorkflowNo },
      select: { traceId: true },
    });
    const traceId = normalizeString(ticket?.traceId) || explicitTraceId;
    if (traceId) {
      return {
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING,
        workflowNo: explicitWorkflowNo,
        traceId,
      };
    }
  }

  const userId = normalizeString(input.userId);
  const userNo = normalizeString(input.userNo);

  if (userId) {
    const invitation = await (prisma as any).adminUserInvitation.findFirst({
      where: {
        userId,
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING,
        workflowNo: { not: null },
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        workflowNo: true,
        traceId: true,
      },
    });

    const workflowNo = normalizeString(invitation?.workflowNo);
    if (workflowNo) {
      const ticket = await prisma.changeTicket.findFirst({
        where: { ticketNo: workflowNo },
        select: { traceId: true },
      });
      const traceId =
        normalizeString(ticket?.traceId) ||
        normalizeString(invitation?.traceId) ||
        explicitTraceId;
      if (traceId) {
        return {
          workflowType: AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING,
          workflowNo,
          traceId,
        };
      }
    }
  }

  if (userNo) {
    const anchor = await (prisma as any).auditLogEvent.findFirst({
      where: {
        workflowType: AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING,
        workflowNo: { not: null },
        OR: [{ entityNo: userNo }, { actorNo: userNo }],
      },
      orderBy: [{ occurredAt: 'asc' }],
      select: {
        workflowNo: true,
        traceId: true,
      },
    });

    const workflowNo = normalizeString(anchor?.workflowNo);
    if (workflowNo) {
      const ticket = await prisma.changeTicket.findFirst({
        where: { ticketNo: workflowNo },
        select: { traceId: true },
      });
      const traceId =
        normalizeString(ticket?.traceId) ||
        normalizeString(anchor?.traceId) ||
        explicitTraceId;
      if (traceId) {
        return {
          workflowType: AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING,
          workflowNo,
          traceId,
        };
      }
    }
  }

  if (userNo) {
    return {
      workflowType: AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING,
      workflowNo: userNo,
      traceId: getSyntheticProvisioningTrace(userNo),
    };
  }

  return null;
}

async function deriveTargetTraceForDeleteRequest(request: any): Promise<string | null> {
  switch (normalizeString(request.targetType)) {
    case DeleteRequestTargetTypes.CHANGE_TICKET: {
      const ticket = await prisma.changeTicket.findFirst({
        where: { id: request.targetId },
        select: { traceId: true },
      });
      return normalizeString(ticket?.traceId);
    }
    case DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE: {
      const exportAudit = await (prisma as any).auditLogEvent.findFirst({
        where: {
          action: AuditActions.AUDIT_EVIDENCE_PACKAGE_EXPORTED,
          entityNo: request.targetNo,
          traceId: { not: null },
        },
        orderBy: [{ occurredAt: 'desc' }],
        select: { traceId: true },
      });
      return normalizeString(exportAudit?.traceId);
    }
    case DeleteRequestTargetTypes.ADMIN_USER: {
      const context = await deriveProvisioningContext({
        userId: request.targetId,
        userNo: request.targetNo,
      });
      return context?.traceId || null;
    }
    default:
      return null;
  }
}

async function deriveApprovalContext(approval: any): Promise<WorkflowContext | null> {
  const parsedMetadata =
    typeof approval.metadataJson === 'string' && approval.metadataJson.trim().length
      ? JSON.parse(approval.metadataJson)
      : approval.metadataJson || {};

  switch (normalizeString(approval.actionType)) {
    case ApprovalActionTypes.CHANGE_TICKET_APPROVAL: {
      const ticketRef = normalizeString(approval.entityRef);
      const fallbackTicketNo = normalizeString((parsedMetadata as Record<string, unknown>).ticketNo);
      const ticket =
        (ticketRef
          ? await prisma.changeTicket.findFirst({
              where: { id: ticketRef },
              select: {
                ticketNo: true,
                traceId: true,
                changeType: true,
              },
            })
          : null) ||
        (fallbackTicketNo
          ? await prisma.changeTicket.findFirst({
              where: { ticketNo: fallbackTicketNo },
              select: {
                ticketNo: true,
                traceId: true,
                changeType: true,
              },
            })
          : null);
      const workflowType = mapChangeTypeToWorkflow(ticket?.changeType);
      const workflowNo = normalizeString(ticket?.ticketNo) || fallbackTicketNo;
      const traceId = normalizeString(ticket?.traceId) || normalizeString(approval.traceId);
      if (workflowType && workflowNo && traceId) {
        return { workflowType, workflowNo, traceId };
      }
      return null;
    }
    case ApprovalActionTypes.DELETE_REQUEST_APPROVAL: {
      const request = await prisma.deleteRequest.findFirst({
        where: { id: approval.entityRef },
        select: {
          requestNo: true,
          traceId: true,
          targetType: true,
        },
      });
      const workflowType = mapDeleteTargetToWorkflow(request?.targetType);
      const workflowNo = normalizeString(request?.requestNo);
      const traceId = normalizeString(request?.traceId) || normalizeString(approval.traceId);
      if (workflowType && workflowNo && traceId) {
        return { workflowType, workflowNo, traceId };
      }
      return null;
    }
    case ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL: {
      const pkg = await prisma.auditEvidencePackage.findFirst({
        where: { approvalCaseId: approval.id },
        select: { packageNo: true },
      });
      const workflowNo = normalizeString(pkg?.packageNo);
      const traceId = normalizeString(approval.traceId);
      if (workflowNo && traceId) {
        return {
          workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
          workflowNo,
          traceId,
        };
      }
      return null;
    }
    case ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL: {
      const pkg = await prisma.complianceCaseEvidencePackage.findFirst({
        where: { approvalCaseId: approval.id },
        select: { packageNo: true },
      });
      const workflowNo = normalizeString(pkg?.packageNo);
      const traceId = normalizeString(approval.traceId);
      if (workflowNo && traceId) {
        return {
          workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
          workflowNo,
          traceId,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

async function main() {
  const { apply, dryRun } = parseArgs();
  const summary = {
    deleteTraceChainsReset: 0,
    approvalCasesUpdated: 0,
    approvalAuditRowsUpdated: 0,
    provisioningAuditRowsUpdated: 0,
    invitationRowsUpdated: 0,
    loginAuditRowsUpdated: 0,
    evidenceExportAuditRowsUpdated: 0,
  };

  const deleteRequests = await prisma.deleteRequest.findMany({
    select: {
      id: true,
      requestNo: true,
      targetType: true,
      targetId: true,
      targetNo: true,
      traceId: true,
      approvalCaseId: true,
      approvalNo: true,
    },
  });

  for (const request of deleteRequests) {
    const targetTrace = await deriveTargetTraceForDeleteRequest(request);
    if (!targetTrace || normalizeString(request.traceId) !== targetTrace) {
      continue;
    }

    const workflowType = mapDeleteTargetToWorkflow(request.targetType);
    if (!workflowType) {
      continue;
    }

    const newTraceId = randomUUID();
    summary.deleteTraceChainsReset += 1;

    if (!apply) {
      continue;
    }

    await prisma.deleteRequest.update({
      where: { id: request.id },
      data: { traceId: newTraceId },
    });

    if (request.approvalCaseId) {
      await prisma.approvalCase.update({
        where: { id: request.approvalCaseId },
        data: {
          traceId: newTraceId,
          workflowType,
          workflowNo: request.requestNo,
        },
      });
    }

    await (prisma as any).auditLogEvent.updateMany({
      where: {
        OR: [
          { entityId: request.id },
          { entityNo: request.requestNo },
          { workflowNo: request.requestNo },
        ],
        action: {
          in: [
            AuditActions.DELETE_REQUEST_CREATED,
            AuditActions.DELETE_REQUEST_SUBMITTED,
            AuditActions.DELETE_REQUEST_APPROVED,
            AuditActions.DELETE_REQUEST_REJECTED,
            AuditActions.DELETE_REQUEST_CANCELLED,
            AuditActions.DELETE_REQUEST_EXECUTED,
            AuditActions.DELETE_REQUEST_EXECUTION_FAILED,
            AuditActions.DELETE_REQUEST_CONSUMED,
          ],
        },
      },
      data: {
        workflowType,
        workflowNo: request.requestNo,
        traceId: newTraceId,
      },
    });

    if (request.approvalCaseId || request.approvalNo) {
      await (prisma as any).auditLogEvent.updateMany({
        where: {
          action: { in: APPROVAL_AUDIT_ACTIONS },
          OR: [
            request.approvalCaseId ? { entityId: request.approvalCaseId } : undefined,
            request.approvalNo ? { entityNo: request.approvalNo } : undefined,
          ].filter(Boolean),
        },
        data: {
          workflowType,
          workflowNo: request.requestNo,
          traceId: newTraceId,
        },
      });
    }
  }

  const approvalCases = await prisma.approvalCase.findMany({
    where: {
      actionType: {
        in: [
          ApprovalActionTypes.CHANGE_TICKET_APPROVAL,
          ApprovalActionTypes.DELETE_REQUEST_APPROVAL,
          ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
          ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL,
        ],
      },
    },
    select: {
      id: true,
      approvalNo: true,
      actionType: true,
      entityRef: true,
      traceId: true,
      workflowType: true,
      workflowNo: true,
    },
  });

  for (const approval of approvalCases) {
    const context = await deriveApprovalContext(approval);
    if (!context) {
      continue;
    }

    const needsCaseUpdate =
      normalizeString(approval.workflowType) !== context.workflowType ||
      normalizeString(approval.workflowNo) !== context.workflowNo ||
      normalizeString(approval.traceId) !== context.traceId;

    if (needsCaseUpdate) {
      summary.approvalCasesUpdated += 1;
      if (apply) {
        await prisma.approvalCase.update({
          where: { id: approval.id },
          data: {
            workflowType: context.workflowType,
            workflowNo: context.workflowNo,
            traceId: context.traceId,
          },
        });
      }
    }

    const relatedAuditRows = await (prisma as any).auditLogEvent.findMany({
      where: {
        action: { in: APPROVAL_AUDIT_ACTIONS },
        OR: [{ entityId: approval.id }, { entityNo: approval.approvalNo }],
      },
      select: {
        id: true,
        workflowType: true,
        workflowNo: true,
        traceId: true,
      },
    });

    for (const row of relatedAuditRows) {
      if (
        normalizeString(row.workflowType) === context.workflowType &&
        normalizeString(row.workflowNo) === context.workflowNo &&
        normalizeString(row.traceId) === context.traceId
      ) {
        continue;
      }

      summary.approvalAuditRowsUpdated += 1;
      if (apply) {
        await (prisma as any).auditLogEvent.update({
          where: { id: row.id },
          data: {
            workflowType: context.workflowType,
            workflowNo: context.workflowNo,
            traceId: context.traceId,
          },
        });
      }
    }
  }

  const provisioningRows = await (prisma as any).auditLogEvent.findMany({
    where: {
      action: { in: PROVISIONING_AUDIT_ACTIONS },
      OR: [
        { workflowType: null },
        { workflowNo: null },
        { traceId: null },
      ],
    },
    select: {
      id: true,
      auditNo: true,
      action: true,
      entityId: true,
      entityNo: true,
      metadata: true,
      workflowType: true,
      workflowNo: true,
      traceId: true,
    },
    orderBy: [{ occurredAt: 'asc' }],
  });

  for (const row of provisioningRows) {
    const context = await deriveProvisioningContext({
      userId: row.entityId,
      userNo:
        normalizeString(row.entityNo) ||
        normalizeString(
          (() => {
            if (typeof row.metadata !== 'string' || !row.metadata.trim().length) {
              return null;
            }
            try {
              return (JSON.parse(row.metadata) as Record<string, unknown>).userNo;
            } catch {
              return null;
            }
          })(),
        ),
      workflowNo: row.workflowNo,
      traceId: row.traceId,
    });

    const effectiveContext =
      context ||
      (row.action === AuditActions.ADMIN_INVITATION_ACCEPT_FAILED
        ? {
            workflowType: AuditBusinessWorkflowTypes.ADMIN_MEMBER_PROVISIONING,
            workflowNo: `INVITE_FAILURE:${row.auditNo}`,
            traceId: randomUUID(),
          }
        : null);

    if (!effectiveContext) {
      continue;
    }

    if (
      normalizeString(row.workflowType) === effectiveContext.workflowType &&
      normalizeString(row.workflowNo) === effectiveContext.workflowNo &&
      normalizeString(row.traceId) === effectiveContext.traceId
    ) {
      continue;
    }

    summary.provisioningAuditRowsUpdated += 1;
    if (apply) {
      await (prisma as any).auditLogEvent.update({
        where: { id: row.id },
        data: {
          workflowType: effectiveContext.workflowType,
          workflowNo: effectiveContext.workflowNo,
          traceId: effectiveContext.traceId,
        },
      });
    }
  }

  const invitationRows = await (prisma as any).adminUserInvitation.findMany({
    where: {
      OR: [{ workflowType: null }, { workflowNo: null }, { traceId: null }],
    },
    select: {
      id: true,
      userId: true,
      workflowType: true,
      workflowNo: true,
      traceId: true,
    },
  });

  for (const invitation of invitationRows) {
    const user = await prisma.user.findFirst({
      where: { id: invitation.userId },
      select: { userNo: true },
    });
    const context = await deriveProvisioningContext({
      userId: invitation.userId,
      userNo: user?.userNo,
      workflowNo: invitation.workflowNo,
      traceId: invitation.traceId,
    });

    if (!context) {
      continue;
    }

    if (
      normalizeString(invitation.workflowType) === context.workflowType &&
      normalizeString(invitation.workflowNo) === context.workflowNo &&
      normalizeString(invitation.traceId) === context.traceId
    ) {
      continue;
    }

    summary.invitationRowsUpdated += 1;
    if (apply) {
      await (prisma as any).adminUserInvitation.update({
        where: { id: invitation.id },
        data: {
          workflowType: context.workflowType,
          workflowNo: context.workflowNo,
          traceId: context.traceId,
        },
      });
    }
  }

  const loginRows = await (prisma as any).auditLogEvent.findMany({
    where: {
      action: { in: LOGIN_AUDIT_ACTIONS },
      OR: [{ workflowType: null }, { workflowNo: null }, { traceId: null }],
    },
    select: {
      id: true,
      auditNo: true,
      requestId: true,
      entityNo: true,
      actorNo: true,
      workflowType: true,
      workflowNo: true,
      traceId: true,
    },
    orderBy: [{ occurredAt: 'asc' }],
  });

  const loginTraceByGroup = new Map<string, string>();
  for (const row of loginRows) {
    const groupKey = normalizeString(row.requestId) || row.auditNo;
    const traceId = loginTraceByGroup.get(groupKey) || randomUUID();
    loginTraceByGroup.set(groupKey, traceId);
    const workflowNo =
      normalizeString(row.entityNo) ||
      normalizeString(row.actorNo) ||
      (normalizeString(row.requestId)
        ? `REQ:${normalizeString(row.requestId)}`
        : `AUTH:${row.auditNo}`);

    if (
      normalizeString(row.workflowType) === AuditBusinessWorkflowTypes.ADMIN_LOGIN_ACCESS &&
      normalizeString(row.workflowNo) === workflowNo &&
      normalizeString(row.traceId) === traceId
    ) {
      continue;
    }

    summary.loginAuditRowsUpdated += 1;
    if (apply) {
      await (prisma as any).auditLogEvent.update({
        where: { id: row.id },
        data: {
          workflowType: AuditBusinessWorkflowTypes.ADMIN_LOGIN_ACCESS,
          workflowNo,
          traceId,
        },
      });
    }
  }

  const evidenceRows = await (prisma as any).auditLogEvent.findMany({
    where: {
      action: { in: EVIDENCE_EXPORT_AUDIT_ACTIONS },
      OR: [{ workflowType: null }, { workflowNo: null }, { traceId: null }],
    },
    select: {
      id: true,
      action: true,
      entityNo: true,
      traceId: true,
      metadata: true,
    },
  });

  for (const row of evidenceRows) {
    const parsedMetadata =
      typeof row.metadata === 'string' && row.metadata.trim().length
        ? JSON.parse(row.metadata)
        : row.metadata || {};
    const approvalId = normalizeString((parsedMetadata as Record<string, unknown>).approvalId);
    let traceId = normalizeString(row.traceId);

    if (!traceId && approvalId) {
      const approval = await prisma.approvalCase.findFirst({
        where: { id: approvalId },
        select: { traceId: true },
      });
      traceId = normalizeString(approval?.traceId);
    }

    if (!traceId) {
      continue;
    }

    const workflowNo = normalizeString(row.entityNo);
    if (!workflowNo) {
      continue;
    }

    if (
      normalizeString(row.workflowType) === AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT &&
      normalizeString(row.workflowNo) === workflowNo &&
      normalizeString(row.traceId) === traceId
    ) {
      continue;
    }

    summary.evidenceExportAuditRowsUpdated += 1;
    if (apply) {
      await (prisma as any).auditLogEvent.update({
        where: { id: row.id },
        data: {
          workflowType: AuditBusinessWorkflowTypes.AUDIT_EVIDENCE_EXPORT,
          workflowNo,
          traceId,
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? 'dry-run' : 'apply',
        ...summary,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
