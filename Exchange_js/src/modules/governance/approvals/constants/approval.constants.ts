import { BadRequestException } from '@nestjs/common';

/**
 * WAVE 1 STABLE CONTRACT
 * The following three action types are Wave 1 governed flows.
 * Their state machine, SoD rules, timeout policies, and execution
 * dispatch are stable public API — do not change their behavior
 * without a Wave 1 regression pass.
 *
 *   AUDIT_EVIDENCE_EXPORT_APPROVAL  — audit evidence package export gate
 *
 * WAVE 2-3 PRE-REGISTERED
 * These types are registered for schema continuity before full feature impl:
 *   CASE_EVIDENCE_EXPORT_APPROVAL        — Wave 2-3
 *   ONBOARDING_FINAL_APPROVAL            — Wave 2 (kept until Phase 5 migration)
 *   POOL_SETTLEMENT_BATCH_APPROVAL       — Wave 5+
 *   TREASURY_CROSS_POOL_TRANSFER_APPROVAL — Wave 5+
 *
 * WAVE 3 (2026-04-09) ADDITIONS
 * Three new action types for firm-driven customer review redesign:
 *   RISK_RATING_MEDIUM_APPROVAL      — medium risk threshold signoff
 *   RISK_RATING_HIGH_APPROVAL        — high risk threshold signoff
 *   PEP_RELATIONSHIP_APPROVAL        — politically exposed person link signoff
 */
export const ApprovalActionTypes = {
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
  CASE_EVIDENCE_EXPORT_APPROVAL: 'CASE_EVIDENCE_EXPORT_APPROVAL',
  ONBOARDING_FINAL_APPROVAL: 'ONBOARDING_FINAL_APPROVAL',
  POOL_SETTLEMENT_BATCH_APPROVAL: 'POOL_SETTLEMENT_BATCH_APPROVAL',
  TREASURY_CROSS_POOL_TRANSFER_APPROVAL: 'TREASURY_CROSS_POOL_TRANSFER_APPROVAL',
  // ─── Wave 3 (2026-04-09) ─────────────────────
  RISK_RATING_MEDIUM_APPROVAL: 'RISK_RATING_MEDIUM_APPROVAL',
  RISK_RATING_HIGH_APPROVAL: 'RISK_RATING_HIGH_APPROVAL',
  RISK_RATING_UPGRADE_PHASE1: 'RISK_RATING_UPGRADE_PHASE1',
  RISK_RATING_MAINTENANCE_APPROVAL: 'RISK_RATING_MAINTENANCE_APPROVAL',
  PEP_RELATIONSHIP_APPROVAL: 'PEP_RELATIONSHIP_APPROVAL',
  // ─── Wave 3 Tier Upgrade (2026-04-13) ────────
  RISK_RATING_MLRO_REVIEW: 'RISK_RATING_MLRO_REVIEW',
  RISK_RATING_TIER_UPGRADE_APPROVAL: 'RISK_RATING_TIER_UPGRADE_APPROVAL',
  // ─── Wave 1 Governance Redesign (2026-04-30) ─
  ADMIN_INVITE_APPROVAL: 'ADMIN_INVITE_APPROVAL',
  ADMIN_ROLE_BINDING_CHANGE_APPROVAL: 'ADMIN_ROLE_BINDING_CHANGE_APPROVAL',
  ADMIN_SUSPENSION_APPROVAL: 'ADMIN_SUSPENSION_APPROVAL',
  ADMIN_REACTIVATION_APPROVAL: 'ADMIN_REACTIVATION_APPROVAL',
  // ─── Approval Policy Governance (2026-05-06) ────
  APPROVAL_POLICY_CHANGE: 'APPROVAL_POLICY_CHANGE',
  // ─── Role Definition Governance (2026-05-08) ────
  ROLE_DEFINITION_CREATE: 'ROLE_DEFINITION_CREATE',
  ROLE_DEFINITION_MODIFY: 'ROLE_DEFINITION_MODIFY',
  // ─── Credential Reset Governance (2026-05-10) ────
  ADMIN_PASSWORD_RESET: 'ADMIN_PASSWORD_RESET',
  ADMIN_MFA_RESET: 'ADMIN_MFA_RESET',
  // ─── Asset Listing (2026-05-11) ────
  ASSET_LISTING: 'ASSET_LISTING',
  // ─── Custodian Wallet Create (2026-05-13) ────
  CUSTODIAN_WALLET_CREATE: 'CUSTODIAN_WALLET_CREATE',
  // ─── Asset Suspension (2026-05-14) ────
  ASSET_SUSPENSION: 'ASSET_SUSPENSION',
  ASSET_REACTIVATION: 'ASSET_REACTIVATION',
  // ─── Asset Activation (2026-05-14) ────
  ASSET_ACTIVATION: 'ASSET_ACTIVATION',
  // Transaction Limit Change (2026-05-16)
  TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_CHANGE',
  // Transaction Limit Creation (2026-05-16)
  TRANSACTION_LIMIT_CREATION: 'TRANSACTION_LIMIT_CREATION',
  // Withdrawal Fee Level (2026-05-30)
  WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_CREATION',
  WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_CHANGE',
  // Swap Fee Level (2026-05-31)
  SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_CREATION',
  SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_CHANGE',
  // Withdraw Large-Value Approval Gate (2026-06-01)
  WITHDRAW_LARGE_VALUE_APPROVAL: 'WITHDRAW_LARGE_VALUE_APPROVAL',
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
  status: string;
  decisionByUserId?: string | null;
  decisionByUserNo?: string | null;
  decisionByRole?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
}

// ─── Multi-Step Policy Configuration ───────────────

export interface PolicyStepConfig {
  stepNo: number;   // 1-based, sequential, no gaps
  roles: string[];  // OR: any of these roles can approve this step
}

/** Derive flat unique roles from steps array */
export function deriveCheckerRoles(steps: PolicyStepConfig[]): string[] {
  return [...new Set(steps.flatMap((s) => s.roles))];
}

/** Parse JSON string into PolicyStepConfig[], validate structure */
export function parseAndValidateStepsConfig(json: string): PolicyStepConfig[] {
  let arr: any[];
  try {
    arr = JSON.parse(json);
  } catch {
    throw new BadRequestException('Invalid stepsConfig JSON');
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new BadRequestException('stepsConfig must be a non-empty array');
  }
  for (let i = 0; i < arr.length; i++) {
    const step = arr[i];
    if (step.stepNo !== i + 1) {
      throw new BadRequestException(
        `stepsConfig[${i}].stepNo must be ${i + 1}, got ${step.stepNo}`,
      );
    }
    if (!Array.isArray(step.roles) || step.roles.length === 0) {
      throw new BadRequestException(
        `stepsConfig[${i}].roles must be a non-empty array`,
      );
    }
    for (const role of step.roles) {
      if (typeof role !== 'string' || !role.trim()) {
        throw new BadRequestException(
          `stepsConfig[${i}].roles contains invalid value: ${role}`,
        );
      }
    }
  }
  return arr as PolicyStepConfig[];
}

/** Convert flat role array to steps (each role = 1 step). Backward compat. */
export function checkerRolesToSteps(roles: string[]): PolicyStepConfig[] {
  return roles.map((role, idx) => ({ stepNo: idx + 1, roles: [role] }));
}

export const DEFAULT_APPROVAL_POLICIES: Record<
  string,
  {
    steps: PolicyStepConfig[];
    timeoutHours: number;
    allowCancel: boolean;
  }
> = {
  [ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 24,
    allowCancel: true,
  },
  [ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['DPO'] }, { stepNo: 2, roles: ['MLRO'] }],
    timeoutHours: 24,
    allowCancel: true,
  },
  [ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 240,
    allowCancel: true,
  },
  [ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }, { stepNo: 2, roles: ['TECH_OFFICER'] }],
    timeoutHours: 24,
    allowCancel: true,
  },
  [ApprovalActionTypes.TREASURY_CROSS_POOL_TRANSFER_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }, { stepNo: 2, roles: ['TECH_OFFICER'] }],
    timeoutHours: 24,
    allowCancel: true,
  },
  // ─── Wave 3 (2026-04-09) ─────────────────────
  [ApprovalActionTypes.RISK_RATING_MEDIUM_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['COMPLIANCE_OFFICER'] }],
    timeoutHours: 168,
    allowCancel: true,
  },
  [ApprovalActionTypes.RISK_RATING_HIGH_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 240,
    allowCancel: true,
  },
  [ApprovalActionTypes.RISK_RATING_UPGRADE_PHASE1]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 168,
    allowCancel: true,
  },
  [ApprovalActionTypes.RISK_RATING_MAINTENANCE_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 168,
    allowCancel: true,
  },
  [ApprovalActionTypes.PEP_RELATIONSHIP_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 240,
    allowCancel: true,
  },
  [ApprovalActionTypes.RISK_RATING_MLRO_REVIEW]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 168,
    allowCancel: true,
  },
  [ApprovalActionTypes.RISK_RATING_TIER_UPGRADE_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 240,
    allowCancel: true,
  },
  // ─── Wave 1 Governance Redesign (2026-04-30) ─
  [ApprovalActionTypes.ADMIN_INVITE_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Wave 1 Governance Redesign — C4 (2026-05-05) ─
  [ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Approval Policy Governance (2026-05-06) ────
  [ApprovalActionTypes.APPROVAL_POLICY_CHANGE]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Role Definition Governance (2026-05-08) ────
  [ApprovalActionTypes.ROLE_DEFINITION_CREATE]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.ROLE_DEFINITION_MODIFY]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Credential Reset Governance (2026-05-10) ────
  [ApprovalActionTypes.ADMIN_PASSWORD_RESET]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.ADMIN_MFA_RESET]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Asset Listing (2026-05-11) ────
  [ApprovalActionTypes.ASSET_LISTING]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Custodian Wallet Create (2026-05-13) ────
  [ApprovalActionTypes.CUSTODIAN_WALLET_CREATE]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Asset Suspension (2026-05-14) ────
  [ApprovalActionTypes.ASSET_SUSPENSION]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 12,
    allowCancel: true,
  },
  [ApprovalActionTypes.ASSET_REACTIVATION]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 12,
    allowCancel: true,
  },
  // ─── Asset Activation (2026-05-14) ────
  [ApprovalActionTypes.ASSET_ACTIVATION]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 12,
    allowCancel: true,
  },
  // ─── Transaction Limit Change ────
  [ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Transaction Limit Creation ────
  [ApprovalActionTypes.TRANSACTION_LIMIT_CREATION]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Withdrawal Fee Level ────
  [ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Swap Fee Level ────
  [ApprovalActionTypes.SWAP_FEE_LEVEL_CREATION]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.SWAP_FEE_LEVEL_CHANGE]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Withdraw Large-Value Approval Gate (2026-06-01) ────
  [ApprovalActionTypes.WITHDRAW_LARGE_VALUE_APPROVAL]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
};

/**
 * Only these action types are visible in the Approval Policy Management UI.
 * Non-V1 types remain in code but are filtered out of API responses.
 */
export const V1_APPROVAL_ACTION_TYPES: readonly string[] = [
  ApprovalActionTypes.ADMIN_INVITE_APPROVAL,
  ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL,
  ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL,
  ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
  ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
  ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
  ApprovalActionTypes.ROLE_DEFINITION_CREATE,
  ApprovalActionTypes.ROLE_DEFINITION_MODIFY,
  ApprovalActionTypes.ADMIN_PASSWORD_RESET,
  ApprovalActionTypes.ADMIN_MFA_RESET,
  ApprovalActionTypes.ASSET_ACTIVATION,
  ApprovalActionTypes.CUSTODIAN_WALLET_CREATE,
  ApprovalActionTypes.ASSET_SUSPENSION,
  ApprovalActionTypes.ASSET_REACTIVATION,
  ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
  ApprovalActionTypes.TRANSACTION_LIMIT_CREATION,
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
  ApprovalActionTypes.SWAP_FEE_LEVEL_CREATION,
  ApprovalActionTypes.SWAP_FEE_LEVEL_CHANGE,
] as const;

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
