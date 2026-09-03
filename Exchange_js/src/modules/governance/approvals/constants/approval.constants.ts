import { BadRequestException } from '@nestjs/common';

/**
 * WAVE 1 STABLE CONTRACT
 * The following action type is a Wave 1 governed flow.
 * Its state machine, SoD rules, timeout policies, and execution
 * dispatch are stable public API — do not change its behavior
 * without a Wave 1 regression pass.
 *
 *   AUDIT_EVIDENCE_EXPORT_APPROVAL  — audit evidence package export gate
 */
export const ApprovalActionTypes = {
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
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
  // ─── Custodian Wallet Create (2026-05-13) ────
  CUSTODIAN_WALLET_CREATE: 'CUSTODIAN_WALLET_CREATE',
  // ─── Asset Suspension (2026-05-14) ────
  ASSET_SUSPENSION: 'ASSET_SUSPENSION',
  ASSET_REACTIVATION: 'ASSET_REACTIVATION',
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
  // Deposit Below-Min Confiscation (2026-07-16)
  DEPOSIT_CONFISCATION: 'DEPOSIT_CONFISCATION',
  // Deposit Return/Seize/Unfreeze (A2, 2026-07-28) — 复刻 DEPOSIT_CONFISCATION 的 maker-checker 范式
  DEPOSIT_RETURN: 'DEPOSIT_RETURN',
  DEPOSIT_SEIZE: 'DEPOSIT_SEIZE',
  DEPOSIT_UNFREEZE: 'DEPOSIT_UNFREEZE',
  // Withdraw FROZEN Unfreeze/Sanction-Refund (Task 8, 2026-08-03) — 复刻 DEPOSIT_UNFREEZE 的 maker-checker 范式
  WITHDRAW_UNFREEZE: 'WITHDRAW_UNFREEZE',
  WITHDRAW_SANCTION_REFUND: 'WITHDRAW_SANCTION_REFUND',
  // Customer Restriction Release (2026-08-15) — 贴不审批撕才审批：解除限制按 cause 的
  // releasePolicy 分流到 MLRO / OPS 两条单步 maker-checker，复刻 WITHDRAW_UNFREEZE 形状。
  CUSTOMER_RESTRICTION_RELEASE_MLRO: 'CUSTOMER_RESTRICTION_RELEASE_MLRO',
  CUSTOMER_RESTRICTION_RELEASE_OPS: 'CUSTOMER_RESTRICTION_RELEASE_OPS',
  // Recon Adjustment Post (Task 4, 2026-08-28) — 平账一期·调账单落账前置审批，单步 CFO（平账 A 批 2026-09-02，原 OPS_OFFICER）。
  RECON_ADJUSTMENT_POST: 'RECON_ADJUSTMENT_POST',
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
  // ─── Transaction Limit Change ────
  [ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE]: {
    // 2026-08-30：裁决人 OPS_OFFICER → SENIOR_MANAGEMENT_OFFICER。限额归运营改（业主定），
    // 高管签字：定阈值与放超额单归同一人（大额提现本就是高管批）。
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Transaction Limit Creation ────
  [ApprovalActionTypes.TRANSACTION_LIMIT_CREATION]: {
    // 2026-08-30：裁决人 OPS_OFFICER → SENIOR_MANAGEMENT_OFFICER。限额归运营改（业主定），
    // 高管签字：定阈值与放超额单归同一人（大额提现本就是高管批）。
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
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
  // ─── Deposit Below-Min Confiscation (2026-07-16) ────
  [ApprovalActionTypes.DEPOSIT_CONFISCATION]: {
    // 2026-08-30：裁决人 OPS_OFFICER → CFO。没收 = 客户的钱变公司收入，属财务事项；
    // 且发起人只能是运营（唯一持 DEPOSIT_CONFISCATE_WRITE 者），原配置构成自批死锁。
    steps: [{ stepNo: 1, roles: ['CFO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Deposit Return/Seize/Unfreeze (A2, 2026-07-28) ────
  [ApprovalActionTypes.DEPOSIT_RETURN]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.DEPOSIT_SEIZE]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }, { stepNo: 2, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.DEPOSIT_UNFREEZE]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Withdraw FROZEN Unfreeze/Sanction-Refund (Task 8, 2026-08-03) ────
  [ApprovalActionTypes.WITHDRAW_UNFREEZE]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.WITHDRAW_SANCTION_REFUND]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Customer Restriction Release (2026-08-15) ────
  [ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // ─── Recon Adjustment Post（平账 A 批 2026-09-02：裁决人 OPS_OFFICER → CFO）────
  // 对账引出的账本更正与核销在业内是财务签批；链条 = 运营查证定性 → 金库开单 → CFO 裁决。
  // 自批死锁不存在：CFO 不持 RECON_ADJUSTMENT_WRITE（verify:rbac S5 守着）。
  [ApprovalActionTypes.RECON_ADJUSTMENT_POST]: {
    steps: [{ stepNo: 1, roles: ['CFO'] }],
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
  ApprovalActionTypes.CUSTODIAN_WALLET_CREATE,
  ApprovalActionTypes.ASSET_SUSPENSION,
  ApprovalActionTypes.ASSET_REACTIVATION,
  ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
  ApprovalActionTypes.TRANSACTION_LIMIT_CREATION,
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
  ApprovalActionTypes.SWAP_FEE_LEVEL_CREATION,
  ApprovalActionTypes.SWAP_FEE_LEVEL_CHANGE,
  ApprovalActionTypes.DEPOSIT_CONFISCATION,
  ApprovalActionTypes.DEPOSIT_RETURN,
  ApprovalActionTypes.DEPOSIT_SEIZE,
  ApprovalActionTypes.DEPOSIT_UNFREEZE,
  ApprovalActionTypes.WITHDRAW_UNFREEZE,
  ApprovalActionTypes.WITHDRAW_SANCTION_REFUND,
  ApprovalActionTypes.RECON_ADJUSTMENT_POST,
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
