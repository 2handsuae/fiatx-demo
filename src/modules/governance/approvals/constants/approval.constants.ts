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
  // ─── Asset Suspension (2026-05-14) ────
  ASSET_SUSPENSION: 'ASSET_SUSPENSION',
  ASSET_REACTIVATION: 'ASSET_REACTIVATION',
  // Transaction Limit Change (2026-05-16)（原 Transaction Limit Creation 已随「限额只改
  // 不建不删」创建流整条退役,波一 T10,2026-09-04）
  TRANSACTION_LIMIT_CHANGE: 'TRANSACTION_LIMIT_CHANGE',
  // Withdrawal Fee Level (2026-05-30)
  WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_CREATION',
  WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_CHANGE',
  // Swap Fee Level (2026-05-31)
  SWAP_FEE_LEVEL_CREATION: 'SWAP_FEE_LEVEL_CREATION',
  SWAP_FEE_LEVEL_CHANGE: 'SWAP_FEE_LEVEL_CHANGE',
  // Fee Level Retirement（波一 T11，2026-09-04）——"删" 改走审批终态，CFO 提、运营批
  SWAP_FEE_LEVEL_RETIRE: 'SWAP_FEE_LEVEL_RETIRE',
  WITHDRAWAL_FEE_LEVEL_RETIRE: 'WITHDRAWAL_FEE_LEVEL_RETIRE',
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
  // Swap FROZEN Unfreeze/Sanction-Refund（波五 Task 3，2026-09-14）— 逐字镜像 WITHDRAW_UNFREEZE/WITHDRAW_SANCTION_REFUND
  SWAP_UNFREEZE: 'SWAP_UNFREEZE',
  SWAP_SANCTION_REFUND: 'SWAP_SANCTION_REFUND',
  // Customer Restriction Release (2026-08-15) — 贴不审批撕才审批：解除限制按 cause 的
  // releasePolicy 分流到 MLRO / OPS 两条单步 maker-checker，复刻 WITHDRAW_UNFREEZE 形状。
  CUSTOMER_RESTRICTION_RELEASE_MLRO: 'CUSTOMER_RESTRICTION_RELEASE_MLRO',
  CUSTOMER_RESTRICTION_RELEASE_OPS: 'CUSTOMER_RESTRICTION_RELEASE_OPS',
  // Recon Adjustment Post (Task 4, 2026-08-28) — 平账一期·调账单落账前置审批，单步 CFO（平账 A 批 2026-09-02，原 OPS_OFFICER）。
  RECON_ADJUSTMENT_POST: 'RECON_ADJUSTMENT_POST',
  // 平账 B 批（2026-09-03）：补单三入口，纯资金件 → CFO 单步（合规件才归 MLRO）
  DEPOSIT_SUPPLEMENT: 'DEPOSIT_SUPPLEMENT',
  DEPOSIT_CLAWBACK: 'DEPOSIT_CLAWBACK',
  WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM',
  // 平账二期（2026-09-05）：内部划转单（公司 → 客户补款 / 垫款），纯资金件 → CFO 单步；金库提、CFO 批
  INTERNAL_TRANSFER_APPROVAL: 'INTERNAL_TRANSFER_APPROVAL',
  // 平账三期·事故登记（2026-09-06）：结案审批按性质分链——安全类（未授权转出）两步 MLRO→CFO，资金类单步 CFO
  INCIDENT_CLOSE_SECURITY: 'INCIDENT_CLOSE_SECURITY',
  INCIDENT_CLOSE_FINANCIAL: 'INCIDENT_CLOSE_FINANCIAL',
  // 战役甲波一 Task 8：十类终盘新增两族结案链——技安/数据/运营三族共用 CISO 单步裁决，
  // 财务类（NLA 审慎缺口）单步 SENIOR_MANAGEMENT_OFFICER 裁决。closeActionType 值与本键同名，
  // incident-close-workflow.service.ts 直接查注册表取值，不再按事故类型手写三元。
  INCIDENT_CLOSE_TECHSEC: 'INCIDENT_CLOSE_TECHSEC',
  INCIDENT_CLOSE_PRUDENTIAL: 'INCIDENT_CLOSE_PRUDENTIAL',
  // 战役甲波二（2026-09-26）：报送签发——合规官提、高管单步批（spec §4）
  REG_FILING_SUBMIT: 'REG_FILING_SUBMIT',
  // 客户域波二·准入审批线（2026-09-07）：高风险客户准入核准，运营提、高管批
  CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_ONBOARDING_ACCEPTANCE',
  // 客户域波三·档位升级审批线（2026-09-07）：BASIC→PREMIUM 档位升级核准，运营提、高管批
  CUSTOMER_TIER_UPGRADE: 'CUSTOMER_TIER_UPGRADE',
  // 战役甲波三 T4（2026-09-26）：制裁定性裁决——合规官提（CLEARED/PARTIAL/CONFIRMED
  // 三选一 + 依据摘要），MLRO 单步批。挂在 SANCTION 便签（customerLevel，entityRef=customerNo）。
  SANCTION_DISPOSITION: 'SANCTION_DISPOSITION',
  // 战役甲波四 T5（2026-09-27）：RI 换人——合规官提（新任姓名+生效日+理由+varaRef?），
  // 高管单步批。挂在 ResponsibleIndividual 席位（entityRef=riNo）。
  RI_REPLACEMENT: 'RI_REPLACEMENT',
  // 战役甲波五 T3（2026-09-28）：波五：运营提、合规官批。挂在 Complaint 主体
  // （entityRef=complaintNo）。
  COMPLAINT_RESOLUTION: 'COMPLAINT_RESOLUTION',
  // 战役甲波五 T3（2026-09-28）：客户族结案：运营提、合规官批。挂在 Incident（客户族），
  // closeActionType 值与本键同名（同 INCIDENT_CLOSE_TECHSEC/PRUDENTIAL 先例）。
  INCIDENT_CLOSE_CUSTOMER: 'INCIDENT_CLOSE_CUSTOMER',
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
  // ─── Fee Level Retirement（波一 T11，2026-09-04）────
  [ApprovalActionTypes.SWAP_FEE_LEVEL_RETIRE]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_RETIRE]: {
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
  // ─── Swap FROZEN Unfreeze/Sanction-Refund（波五 Task 3，2026-09-14）────
  [ApprovalActionTypes.SWAP_UNFREEZE]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.SWAP_SANCTION_REFUND]: {
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
  // 自批死锁不存在：CFO 不持 RECON_ADJUSTMENT_WRITE（verify:rbac S5c 守着）。
  [ApprovalActionTypes.RECON_ADJUSTMENT_POST]: {
    steps: [{ stepNo: 1, roles: ['CFO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.DEPOSIT_SUPPLEMENT]: { steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true },
  [ApprovalActionTypes.DEPOSIT_CLAWBACK]: { steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true },
  [ApprovalActionTypes.WITHDRAW_RETURN_CLAIM]: { steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true },
  [ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL]: { steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true },
  // ─── 平账三期·事故登记（2026-09-06）：结案审批按性质分链 ────
  [ApprovalActionTypes.INCIDENT_CLOSE_SECURITY]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true,
  },
  [ApprovalActionTypes.INCIDENT_CLOSE_FINANCIAL]: {
    steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true,
  },
  // ─── 战役甲波一 Task 8：十类终盘新增两族结案链 ───
  [ApprovalActionTypes.INCIDENT_CLOSE_TECHSEC]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }], timeoutHours: 48, allowCancel: true,
  },
  [ApprovalActionTypes.INCIDENT_CLOSE_PRUDENTIAL]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48, allowCancel: true,
  },
  [ApprovalActionTypes.REG_FILING_SUBMIT]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48, allowCancel: true,
  },
  // ─── 高风险客户准入核准（波二 2026-09-07）：审的是「接不接这个客户关系」，
  // 不是重审尽调（MLRO 的活 100% 在 Sumsub）。maker=运营，checker=高管。───
  [ApprovalActionTypes.CUSTOMER_ONBOARDING_ACCEPTANCE]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.CUSTOMER_TIER_UPGRADE]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // 战役甲波三 T4：制裁定性——单步 MLRO 裁决，照 REG_FILING_SUBMIT 形状定
  // timeoutHours/allowCancel（同为高危治理动作，无理由另定档位）。
  [ApprovalActionTypes.SANCTION_DISPOSITION]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // 战役甲波四 T5（spec §4.2）：RI 换人——波四：合规官提、高管单步批。
  [ApprovalActionTypes.RI_REPLACEMENT]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  // 战役甲波五 T3（task-3-brief.md 原文逐字）：波五：运营提、合规官批。
  [ApprovalActionTypes.COMPLAINT_RESOLUTION]: {
    steps: [{ stepNo: 1, roles: ['COMPLIANCE_OFFICER'] }], timeoutHours: 48, allowCancel: true,
  },
  // 战役甲波五 T3（task-3-brief.md 原文逐字）：客户族结案：运营提、合规官批。
  [ApprovalActionTypes.INCIDENT_CLOSE_CUSTOMER]: {
    steps: [{ stepNo: 1, roles: ['COMPLIANCE_OFFICER'] }], timeoutHours: 48, allowCancel: true,
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
  ApprovalActionTypes.ASSET_SUSPENSION,
  ApprovalActionTypes.ASSET_REACTIVATION,
  ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE,
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
  ApprovalActionTypes.SWAP_FEE_LEVEL_CREATION,
  ApprovalActionTypes.SWAP_FEE_LEVEL_CHANGE,
  ApprovalActionTypes.SWAP_FEE_LEVEL_RETIRE,
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_RETIRE,
  ApprovalActionTypes.DEPOSIT_CONFISCATION,
  ApprovalActionTypes.DEPOSIT_RETURN,
  ApprovalActionTypes.DEPOSIT_SEIZE,
  ApprovalActionTypes.DEPOSIT_UNFREEZE,
  ApprovalActionTypes.WITHDRAW_UNFREEZE,
  ApprovalActionTypes.WITHDRAW_SANCTION_REFUND,
  ApprovalActionTypes.SWAP_UNFREEZE,
  ApprovalActionTypes.SWAP_SANCTION_REFUND,
  ApprovalActionTypes.RECON_ADJUSTMENT_POST,
  ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL,
  ApprovalActionTypes.INCIDENT_CLOSE_SECURITY,
  ApprovalActionTypes.INCIDENT_CLOSE_FINANCIAL,
  ApprovalActionTypes.INCIDENT_CLOSE_TECHSEC,
  ApprovalActionTypes.INCIDENT_CLOSE_PRUDENTIAL,
  ApprovalActionTypes.INCIDENT_CLOSE_CUSTOMER,
  ApprovalActionTypes.REG_FILING_SUBMIT,
  // 战役甲波五 T9 自查发现并修（非本任务 Files 清单，但必要配套——见任务报告「疑虑」）：
  // COMPLAINT_RESOLUTION 与同批引入的 INCIDENT_CLOSE_CUSTOMER 结构完全对称（同一 T3
  // 提交，both COMPLIANCE_OFFICER 单步 48h 可撤），后者已在册、前者漏收——原样漏收会让
  // ApprovalPoliciesPage.tsx 新增的 ACTION_TYPE_LABELS.COMPLAINT_RESOLUTION 成为死标签
  // （approval-policy.service.ts list() 按 V1_APPROVAL_ACTION_TYPES 过滤，不在册=页面
  // 永远不渲染这一行）。
  ApprovalActionTypes.COMPLAINT_RESOLUTION,
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
