/**
 * Stub constants and no-op service retained for the deprecated business-config module.
 * The ChangeTickets module has been removed; this file preserves the constant values
 * and provides a no-op DI provider so that business-config.service.ts compiles and
 * starts without modification to its business logic.
 *
 * DO NOT import these from new code.
 */
import { Injectable } from '@nestjs/common';

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

/**
 * No-op stub injected in place of the removed ChangeTicketsService.
 * business-config module is deprecated; CT publish-gate is effectively disabled.
 */
@Injectable()
export class LegacyChangeTicketsServiceStub implements LegacyChangeTicketsService {
  async createBusinessConfigReleaseTicket(
    _input: { releaseNo: string; traceId?: string; subjectType: string },
    _actor: { actorType: string; userId: string; userNo: string; role: string; roleCodes: string[] },
  ): Promise<{ id: string; ticketNo: string }> {
    // CT module removed — business-config publish gate is a no-op
    return { id: 'legacy-stub', ticketNo: 'CT-STUB' };
  }
}
