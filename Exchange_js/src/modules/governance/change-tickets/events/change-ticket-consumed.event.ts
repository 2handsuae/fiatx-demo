// src/modules/governance/change-tickets/events/change-ticket-consumed.event.ts

export const CHANGE_TICKET_CONSUMED = 'change-ticket.consumed';

/**
 * Actor context carried with every governed-execution event.
 * Mirrors ApprovalActorContext but only the fields the identity layer needs.
 */
export type GovernedActorContext = {
  actorType?: string;
  userId: string;
  userNo?: string;
  role?: string;
  roleCodes?: string[];
};

/**
 * Binding payload emitted when a READY change ticket is consumed successfully.
 * The `intent` field drives routing in GovernedExecutionListener.
 * The remaining fields are the frozen binding snapshot stored at ticket creation.
 */
export type ChangeTicketConsumedEvent = {
  ticketId: string;
  ticketNo: string;
  traceId: string;
  actor: GovernedActorContext;
  binding: {
    intent?: string;
    [key: string]: unknown;
  };
};
