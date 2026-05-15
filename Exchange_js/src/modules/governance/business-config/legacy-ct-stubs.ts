/**
 * Stub constants retained for the deprecated business-config module.
 * The ChangeTickets module has been removed; this file preserves the
 * constant values so that business-config.service.ts compiles without
 * modification to its business logic.
 *
 * DO NOT import these from new code.
 */

export const ChangeTicketStatuses = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  READY: 'READY',
  DEPLOYED: 'DEPLOYED',
  CLOSED: 'CLOSED',
  CONSUMED: 'CONSUMED',
} as const;

export const ChangeTicketTypes = {
  ADMIN_ACCESS_CHANGE: 'ADMIN_ACCESS_CHANGE',
  RBAC_CATALOG_CHANGE: 'RBAC_CATALOG_CHANGE',
  BUSINESS_CONFIG_CHANGE: 'BUSINESS_CONFIG_CHANGE',
} as const;

export interface LegacyChangeTicketsService {
  createBusinessConfigReleaseTicket(
    input: { releaseNo: string; traceId?: string; subjectType: string },
    actor: { actorType: string; userId: string; userNo: string; role: string; roleCodes: string[] },
  ): Promise<{ id: string; ticketNo: string }>;
}
