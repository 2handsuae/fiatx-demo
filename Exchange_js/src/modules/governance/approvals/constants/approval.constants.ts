/**
 * WAVE 1 STABLE CONTRACT
 * The following three action types are Wave 1 governed flows.
 * Their state machine, SoD rules, timeout policies, and execution
 * dispatch are stable public API — do not change their behavior
 * without a Wave 1 regression pass.
 *
 *   AUDIT_EVIDENCE_EXPORT_APPROVAL  — audit evidence package export gate
 *   CHANGE_TICKET_APPROVAL          — admin access / RBAC change gate
 *   DELETE_REQUEST_APPROVAL         — soft-delete gate
 *
 * The remaining types belong to future waves and are pre-registered here
 * for schema continuity:
 *   CASE_EVIDENCE_EXPORT_APPROVAL        — Wave 2-3
 *   ONBOARDING_FINAL_APPROVAL            — Wave 2-3
 *   POOL_SETTLEMENT_BATCH_APPROVAL       — Wave 5+
 *   TREASURY_CROSS_POOL_TRANSFER_APPROVAL — Wave 5+
 */
export const ApprovalActionTypes = {
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
  CASE_EVIDENCE_EXPORT_APPROVAL: 'CASE_EVIDENCE_EXPORT_APPROVAL',
  CHANGE_TICKET_APPROVAL: 'CHANGE_TICKET_APPROVAL',
  DELETE_REQUEST_APPROVAL: 'DELETE_REQUEST_APPROVAL',
  ONBOARDING_FINAL_APPROVAL: 'ONBOARDING_FINAL_APPROVAL',
  POOL_SETTLEMENT_BATCH_APPROVAL: 'POOL_SETTLEMENT_BATCH_APPROVAL',
  TREASURY_CROSS_POOL_TRANSFER_APPROVAL: 'TREASURY_CROSS_POOL_TRANSFER_APPROVAL',
} as const;

export const ApprovalStatuses = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export const ApprovalStepStatuses = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export const ApprovalExecutionStatuses = {
  NOT_EXECUTED: 'NOT_EXECUTED',
  EXECUTED: 'EXECUTED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
} as const;

export const ApprovalRiskLevels = {
  HIGH: 'HIGH',
} as const;

export const ApprovalSoDRuleCodes = {
  DENY_SAME_USER_MAKER_CHECKER: 'DENY_SAME_USER_MAKER_CHECKER',
} as const;

export const ApprovalEvents = {
  SUBMITTED: 'governance.approval.submitted',
  APPROVED: 'governance.approval.approved',
  REJECTED: 'governance.approval.rejected',
  CANCELLED: 'governance.approval.cancelled',
  EXPIRED: 'governance.approval.expired',
} as const;

export interface ApprovalActorContext {
  actorType: 'ADMIN';
  userId: string;
  userNo?: string;
  role?: string;
  roleCodes: string[];
}

export interface ApprovalDecisionEvent {
  approvalId: string;
  approvalNo: string;
  actionType: string;
  entityRef: string;
  traceId: string;
  workflowType?: string | null;
  workflowId?: string | null;
  workflowNo?: string | null;
  status: string;
  decisionByUserId?: string | null;
  decisionByUserNo?: string | null;
  decisionByRole?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
}

export const DEFAULT_APPROVAL_POLICIES: Record<
  string,
  {
    riskLevel: string;
    checkerRoles: string[];
    timeoutHours: number;
    allowCancel: boolean;
    allowRetry: boolean;
  }
> = {
  [ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['DPO', 'MLRO'],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['DPO', 'MLRO'],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.CHANGE_TICKET_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['CISO', 'TECH_ADMIN'],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.DELETE_REQUEST_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['DPO', 'TECH_ADMIN'],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['SM'],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['SM', 'TECH_ADMIN'],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.TREASURY_CROSS_POOL_TRANSFER_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['SM', 'TECH_ADMIN'],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
};

export function isSuperAdminRoleContext(roleCodes: string[]): boolean {
  return (roleCodes || []).some((roleCode) => String(roleCode || '').trim().toUpperCase() === 'SUPER_ADMIN');
}

export function splitRoleCsv(value?: string | null): string[] {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function joinRoleCsv(values: string[]): string {
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean))).join(
    ',',
  );
}
