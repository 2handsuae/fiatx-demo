import { buildPermissionCode } from './permission-code.util';

export interface RbacRoleDefinition {
  code: string;
  name: string;
  description: string;
}

export type PermissionGroup =
  | 'BASE_ACCESS'
  | 'IAM_MEMBER_READ'
  | 'IAM_ROLE_READ'
  | 'IAM_MEMBER_MANAGE'
  | 'IAM_ROLE_ASSIGN'
  | 'IAM_CREDENTIAL_RESET'
  | 'IAM_ROLE_DEFINE'
  | 'CUSTOMER_READ'
  | 'CUSTOMER_WRITE'
  | 'CUSTOMER_TAG_VIEW'
  | 'CUSTOMER_TAG_MANAGE'
  | 'CUSTOMER_RESTRICTION_READ'
  | 'CUSTOMER_RESTRICTION_WRITE'
  | 'CUSTOMER_RESTRICTION_RELEASE'
  | 'CUSTOMER_ONBOARDING_ACCEPT_WRITE'
  | 'CUSTOMER_TIER_UPGRADE_WRITE'
  | 'DEMO_CLOCK_WRITE'
  | 'DEMO_VERDICT_WRITE'
  | 'SUMSUB_EVENT_VIEW'
  | 'TRADING_DEPOSIT_READ'
  | 'TRADING_DEPOSIT_WRITE'
  | 'DEPOSIT_WAIVE_WRITE'
  | 'DEPOSIT_CONFISCATE_WRITE'
  | 'DEPOSIT_RETURN_WRITE'
  | 'DEPOSIT_SEIZE_WRITE'
  | 'DEPOSIT_UNFREEZE_WRITE'
  | 'DEPOSIT_SUPPLEMENT_WRITE'
  | 'DEPOSIT_CLAWBACK_WRITE'
  | 'TRADING_WITHDRAW_READ'
  | 'TRADING_WITHDRAW_WRITE'
  | 'WITHDRAW_BOUNCE_WRITE'
  | 'WITHDRAW_REFUND_WRITE'
  | 'WITHDRAW_UNFREEZE_WRITE'
  | 'WITHDRAW_RETURN_CLAIM_WRITE'
  | 'TRADING_SWAP_READ'
  | 'TRADING_SWAP_WRITE'
  | 'SWAP_UNFREEZE_WRITE'
  | 'SWAP_REFUND_WRITE'
  | 'WALLET_READ'
  | 'FUNDS_ORDER_VIEW'
  | 'FUNDS_ORDER_ACT'
  | 'RECON_RUN_READ'
  | 'RECON_RUN_WRITE'
  | 'RECON_CASE_READ'
  | 'RECON_EXTERNAL_BALANCE_READ'
  | 'RECON_ADJUSTMENT_WRITE'
  | 'RECON_DISPOSITION_WRITE'
  | 'INTERNAL_TRANSFER_READ'
  | 'INTERNAL_TRANSFER_WRITE'
  | 'LEDGER_ACCOUNT_READ'
  | 'LEDGER_EVIDENCE_READ'
  | 'LEDGER_FLOW_READ'
  | 'ASSET_CONFIG_READ'
  | 'ASSET_CONFIG_WRITE'
  | 'AUDIT_READ'
  | 'AUDIT_EXPORT_CREATE'
  | 'AUDIT_EXPORT_READ'
  | 'GOV_APPROVAL_READ'
  | 'GOV_APPROVAL_POLICY_READ'
  | 'GOV_APPROVAL_POLICY_WRITE'
  | 'TRANSACTION_LIMIT_READ'
  | 'TRANSACTION_LIMIT_WRITE'
  | 'WITHDRAWAL_ADDRESS_READ'
  | 'WITHDRAWAL_ADDRESS_WRITE'
  | 'WITHDRAWAL_FEE_LEVEL_READ'
  | 'WITHDRAWAL_FEE_LEVEL_WRITE'
  | 'SWAP_FEE_LEVEL_READ'
  | 'SWAP_FEE_LEVEL_WRITE'
  | 'INCIDENT_READ'
  | 'INCIDENT_WRITE'
  // 甲波一 T5 修1（Ruling-6）：本轮只加这四个组名的类型成员，供五个族独占能力码
  // （下方 cap.incident.* 五行）各自归组用；甲波一 T9 把桶目录/路由五桶 OR/角色绑定
  // 补齐——四组现各挂一个经办桶、12 条 incidents 路由的组数组、且各自被一个职务持有
  // （TECH_OFFICER/DPO/OPS_OFFICER/CFO），不再是类型层占位。
  | 'INCIDENT_TECH_WRITE'
  | 'INCIDENT_DATA_WRITE'
  | 'INCIDENT_OPS_WRITE'
  | 'INCIDENT_FIN_WRITE'
  // 战役甲波二 Task 5：报送台骨架——单经办组（合规官），无族分裂，不需要 cap.* 标记码。
  | 'REG_FILING_READ'
  | 'REG_FILING_WRITE'
  // 战役甲波三 T6：AML 报送族独立经办组——MLRO 亲办 STR/SAR/CNMR/PNMR/HRC/HRCA 六类型
  // （无签发链，DRAFT→SUBMITTED 直达）。路由与 REG_FILING_WRITE 共享 OR（粗门），服务层
  // cap.filing.aml 按族独占才是真把关（照 Ruling-6 / cap.incident.* 先例，见下方
  // cap.filing.* 服务层门标记码）。
  | 'REG_FILING_AML_WRITE';

export interface RbacPermissionDefinition {
  code: string;
  name: string;
  description: string;
  method: string;
  path: string;
  groups: PermissionGroup[];
}

function route(
  method: string,
  path: string,
  name: string,
  groups: PermissionGroup[],
  description?: string,
): RbacPermissionDefinition {
  return {
    code: buildPermissionCode(method, path),
    name,
    description: description || name,
    method: method.toUpperCase(),
    path,
    groups,
  };
}

export const RBAC_ROLE_DEFINITIONS: RbacRoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Emergency full access account, not for routine operations.',
  },
  {
    code: 'SENIOR_MANAGEMENT_OFFICER',
    name: 'Senior Management Officer',
    description: 'Senior management oversight, high-level approvals, and regulatory accountability.',
  },
  {
    code: 'CISO',
    name: 'Chief Information Security Officer',
    description: 'Security governance and IAM control owner. VARA Responsible Individual candidate.',
  },
  {
    code: 'MLRO',
    name: 'Money Laundering Reporting Officer',
    description: 'Own AML oversight, SAR filing, and independent regulatory reporting. VARA Responsible Individual candidate.',
  },
  {
    code: 'DPO',
    name: 'Data Protection Officer',
    description: 'Data protection oversight for sensitive export governance and privacy compliance.',
  },
  {
    code: 'COMPLIANCE_OFFICER',
    name: 'Compliance Officer',
    description: 'Daily compliance operations, audit export governance, and regulatory program management.',
  },
  {
    code: 'TECH_OFFICER',
    name: 'Tech Officer',
    description: 'Platform operations, technical governance workflows, and change management.',
  },
  {
    code: 'OPS_OFFICER',
    name: 'Operations Officer',
    // 2026-08-31：原文写 'Treasury operations, ...'，但金库（钱包/收款账户/提现地址）
    // 已划归 TREASURY_OFFICER 独有，这句话在第一幕职权重划后变成了假话——描述是演示
    // 观众会读到的人话，不能和绑定表打架。
    // 2026-09-10：对账平账两角色定案——业主裁定对账/平账只留金库与 CFO，运营整组清零、
    // 不拆组不双持，"pushes funds orders, runs reconciliation" 这半句再次变成假话，一并重写。
    description:
      'Day-to-day money movement: releases below-minimum holds, raises deposit and withdrawal dispositions. Never unfreezes — that sits with compliance. Reconciliation, funds order actions, incident registration and demo clock fast-forwards all sit with treasury.',
  },
  {
    code: 'INTERNAL_AUDITOR',
    name: 'Internal Auditor',
    description: 'Independent read-only oversight across every domain. Holds no manage or act capability by design.',
  },
  {
    code: 'CFO',
    name: 'Chief Financial Officer',
    description: 'Owns pricing, reads the ledger and reconciliation, signs off on deposit confiscation.',
  },
  {
    code: 'TREASURY_OFFICER',
    name: 'Treasury Officer',
    // 2026-09-10：对账平账两角色定案——对账全线（运行/案件/外部余额/处置/调账/事故）与
    // 资金单推单动作从运营整组并入金库，运营零能力，补一句职责说明。
    description:
      'Owns where the money sits: custodian wallets, customer receiving accounts and withdrawal addresses. Also runs reconciliation and pushes funds orders end to end — cases, adjustments, incidents, and demo clock fast-forwards.',
  },
];

export const PRIMARY_ROLE_PRIORITY = [
  'SUPER_ADMIN',
  'CISO',
  'DPO',
  'MLRO',
  'INTERNAL_AUDITOR',
  'COMPLIANCE_OFFICER',
  'SENIOR_MANAGEMENT_OFFICER',
  'CFO',
  'TECH_OFFICER',
  'TREASURY_OFFICER',
  'OPS_OFFICER',
] as const;

export function getPrimaryRoleCode(roleCodes: string[]): string | null {
  const normalized = Array.from(
    new Set(
      (roleCodes || [])
        .map((item) => String(item || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  );

  for (const roleCode of PRIMARY_ROLE_PRIORITY) {
    if (normalized.includes(roleCode)) {
      return roleCode;
    }
  }

  return normalized[0] || null;
}

export const HARD_MUTEX_ROLE_PAIRS: Array<[string, string]> = [
  ['CISO', 'MLRO'],
  ['MLRO', 'OPS_OFFICER'],
  ['CISO', 'OPS_OFFICER'],
];

export const RBAC_PERMISSION_DEFINITIONS: RbacPermissionDefinition[] = [
  // Session / IAM
  route('GET', '/auth/me', 'Get current admin session', ['BASE_ACCESS']),
  route('GET', '/users', 'List users', ['IAM_MEMBER_READ']),
  route('POST', '/users', 'Create admin user', ['IAM_MEMBER_MANAGE']),
  route('POST', '/users/:userNo/invitations/resend', 'Resend admin invitation', ['IAM_MEMBER_MANAGE']),
  route('POST', '/users/:userNo/suspend', 'Suspend admin user (C4)', ['IAM_MEMBER_MANAGE']),
  route('POST', '/users/:userNo/reactivate', 'Reactivate admin user (C4b)', ['IAM_MEMBER_MANAGE']),
  route('GET', '/admin/iam/roles', 'List role catalog', ['IAM_ROLE_READ']),
  route('GET', '/admin/iam/permissions', 'List permission catalog', ['IAM_ROLE_READ']),
  route('GET', '/admin/iam/users/:id/roles', 'Get user roles', ['IAM_MEMBER_READ']),
  route('POST', '/admin/iam/role-change-requests', 'Create role binding change request', ['IAM_ROLE_ASSIGN']),
  route('GET', '/admin/iam/role-change-requests', 'List role binding change requests', ['IAM_ROLE_READ']),
  route('GET', '/admin/iam/role-change-requests/:requestNo', 'Get role binding change request', ['IAM_ROLE_READ']),
  route('POST', '/admin/iam/users/:userNo/reset-mfa', 'Reset admin MFA binding', ['IAM_CREDENTIAL_RESET']),
  route('POST', '/users/:userNo/reset-password', 'Reset admin password (C5)', ['IAM_CREDENTIAL_RESET']),
  route('POST', '/admin/iam/role-definitions', 'Create role definition request', ['IAM_ROLE_DEFINE']),
  route('GET', '/admin/iam/role-definitions/permission-groups', 'List available permission groups', ['IAM_ROLE_DEFINE']),
  route('POST', '/admin/iam/role-definitions/:roleId/modify', 'Submit role definition modify request', ['IAM_ROLE_DEFINE']),
  route('GET', '/admin/iam/role-definition-modify-requests', 'List role definition modify requests', ['IAM_ROLE_READ']),
  route('GET', '/admin/iam/role-definition-modify-requests/:requestNo', 'Get role definition modify request detail', ['IAM_ROLE_READ']),
  route('GET', '/admin/iam/action-buckets', 'List action bucket catalog', ['IAM_ROLE_READ']),

  // Customer domain
  route('GET', '/customers', 'List customers', ['CUSTOMER_READ']),
  route('GET', '/customers/:customerNo', 'Get customer detail', ['CUSTOMER_READ']),

  // Customer tags
  route('GET', '/admin/customer-tags/catalog', 'List customer tag registry', ['CUSTOMER_TAG_VIEW']),
  route('GET', '/admin/customers/:customerNo/effective-tags', 'Get customer effective tags', ['CUSTOMER_TAG_VIEW']),
  route('POST', '/admin/customers/:customerNo/tags', 'Assign customer tag', ['CUSTOMER_TAG_MANAGE']),
  route('DELETE', '/admin/customers/:customerNo/tags/:tagCode', 'Revoke customer tag', ['CUSTOMER_TAG_MANAGE']),

  // Customer restrictions
  route('GET', '/admin/customers/:customerNo/restrictions', 'List customer restrictions', ['CUSTOMER_RESTRICTION_READ']),
  route('POST', '/admin/customers/:customerNo/restrictions', 'Open customer restriction', ['CUSTOMER_RESTRICTION_WRITE']),
  route(
    'POST',
    '/admin/customers/:customerNo/restrictions/:restrictionNo/release',
    'Request restriction release',
    ['CUSTOMER_RESTRICTION_RELEASE'],
  ),
  // 战役甲波三 T4：制裁定性提单——复用「解限制」提单组（合规官已持有 CUSTOMER_RESTRICTION_RELEASE，
  // MLRO 也持有同组作为唯一裁决人，maker/checker 天然不相交，见 verify-rbac.ts
  // MAKER_GROUP_BY_POLICY 的 SANCTION_DISPOSITION 行），不新增组。
  route(
    'POST',
    '/admin/customers/:customerNo/sanction-disposition',
    'Submit a sanction disposition (CLEARED/PARTIAL/CONFIRMED) for MLRO approval',
    ['CUSTOMER_RESTRICTION_RELEASE'],
  ),

  // Onboarding acceptance（客户域波二·准入审批线，2026-09-07）
  route(
    'POST',
    '/admin/customers/:customerNo/onboarding-acceptance',
    'Open a senior-management acceptance approval for a high-risk onboarding customer',
    ['CUSTOMER_ONBOARDING_ACCEPT_WRITE'],
  ),
  // 终审补齐（2026-09-07）：查关联准入核准单状态，挂既有 CUSTOMER_READ 组
  route(
    'GET',
    '/admin/customers/:customerNo/onboarding-acceptance',
    'Get the latest onboarding acceptance approval case for a customer',
    ['CUSTOMER_READ'],
  ),

  // Tier upgrade acceptance（交易档位升级波三，2026-09-08）
  route(
    'POST',
    '/admin/customers/:customerNo/tier-upgrade-acceptance',
    'Open a senior-management acceptance approval for a customer trading tier upgrade',
    ['CUSTOMER_TIER_UPGRADE_WRITE'],
  ),
  // 管理台档位升级全貌（当前档 + 申请单 + 关联审批单），挂既有 CUSTOMER_READ 组
  route(
    'GET',
    '/admin/customers/:customerNo/tier-upgrade',
    'Get the trading tier upgrade admin view for a customer',
    ['CUSTOMER_READ'],
  ),

  // Material requests
  route('GET', '/admin/customers/:customerNo/material-requests', 'List customer material requests', ['CUSTOMER_RESTRICTION_READ']),
  route('POST', '/admin/customers/:customerNo/material-requests', 'Issue material request', ['CUSTOMER_RESTRICTION_WRITE']),
  route('GET', '/admin/material-requests/by-order/:orderDomain/:orderRef', 'List order material requests', ['CUSTOMER_RESTRICTION_READ']),

  // Pricing center
  route('POST', '/withdraw-transactions/quotes', 'Create withdrawal pricing quote', ['TRADING_WITHDRAW_WRITE']),

  // Sumsub events
  route('GET', '/admin/sumsub-events', 'List Sumsub webhook events', ['SUMSUB_EVENT_VIEW']),

  // ── Sumsub 入站模拟（2026-09-01 收编：此前只查 type==='ADMIN'）──
  route('POST', '/admin/sumsub/simulate/applicant-action-result', 'Feed a simulated Sumsub applicant-action webhook (demo only)', ['DEMO_VERDICT_WRITE']),
  route('POST', '/admin/sumsub/simulate/onboarding-review-result', 'Feed a simulated Sumsub applicant-review verdict for onboarding (demo only)', ['DEMO_VERDICT_WRITE']),
  route('POST', '/admin/sumsub/simulate/onboarding-level-change', 'Escalate a simulated onboarding applicant to the EDD level (demo only)', ['DEMO_VERDICT_WRITE']),
  route('POST', '/admin/sumsub/simulate/tier-upgrade-review-result', 'Feed a simulated Sumsub applicant-review verdict for tier upgrade (demo only)', ['DEMO_VERDICT_WRITE']),

  // Risk assessments

  // Deposit
  route('GET', '/deposit-transactions', 'List deposit transactions', ['TRADING_DEPOSIT_READ']),
  route('GET', '/deposit-transactions/:depositNo', 'Get deposit transaction detail', ['TRADING_DEPOSIT_READ']),
  route(
    'GET',
    '/deposit-transactions/my/inbound-signals',
    'List customer inbound transfer signals',
    ['TRADING_DEPOSIT_READ'],
  ),
  // 客户端信号入口（非管理端能力）——Task 7 充值动作域拆分不含这两条，继续挂
  // TRADING_DEPOSIT_WRITE；不进桶目录、不进角色 bindings，勿被后人误清或误并入下方新组
  route(
    'POST',
    '/deposit-transactions/my/inbound-signals',
    'Create customer inbound transfer signal',
    ['TRADING_DEPOSIT_WRITE'],
  ),
  route(
    'POST',
    '/deposit-transactions/my/inbound-signals/scan',
    'Scan customer inbound transfer signals',
    ['TRADING_DEPOSIT_WRITE'],
  ),
  route('POST', '/deposit-transactions/:id/waive-limit', 'Waive deposit below-minimum amount hold', ['DEPOSIT_WAIVE_WRITE']),
  route('POST', '/deposit-transactions/:id/confiscate', 'Confiscate deposit below-minimum amount as fee', ['DEPOSIT_CONFISCATE_WRITE']),
  route('POST', '/deposit-transactions/:id/return', 'Open a return-to-sender approval for a deposit', ['DEPOSIT_RETURN_WRITE']),
  route('POST', '/deposit-transactions/:id/seize', 'Seize a frozen deposit under government order', ['DEPOSIT_SEIZE_WRITE']),
  route('POST', '/deposit-transactions/:id/unfreeze', 'Unfreeze a frozen deposit', ['DEPOSIT_UNFREEZE_WRITE']),
  route('POST', '/deposit-transactions/supplement', 'Open a supplement approval: replay a missed inbound (from a reconciliation statement line)', ['DEPOSIT_SUPPLEMENT_WRITE']),
  route('POST', '/deposit-transactions/:depositNo/clawback', 'Open a clawback approval: a credited deposit was reversed by the bank', ['DEPOSIT_CLAWBACK_WRITE']),
  // Task 6 (SLA 批次)：管理台「模拟超时」按钮 —— 演示用,把 slaDeadline 拨到过去
  route('POST', '/deposit-transactions/:depositNo/simulate-sla-timeout', 'Simulate SLA timeout for a deposit (demo only)', ['DEMO_CLOCK_WRITE']),
  // Demo verdict runner (Task 6 计划1·甲方案 起步, Task 4 计划「充值仿真裁决按钮」改单步) —
  // controller only registered when SUMSUB_MOCK_MODE=true
  route(
    'POST',
    '/admin/deposit-sumsub/demo/run-verdict',
    'Feed one Sumsub KYT verdict webhook into a deposit (demo only)',
    ['DEMO_VERDICT_WRITE'],
  ),
  // Task A7: 按钮清单出端点 — 前端 ⚡ 面板据此渲染，不再手抄
  route(
    'GET',
    '/admin/deposit-sumsub/demo/verdict-buttons',
    'List available verdict buttons for the deposit demo panel (demo only)',
    ['TRADING_DEPOSIT_READ'],
  ),

  // Withdraw
  route('GET', '/withdraw-transactions', 'List withdraw transactions', ['TRADING_WITHDRAW_READ']),
  route('GET', '/withdraw-transactions/:withdrawNo', 'Get withdraw transaction detail', ['TRADING_WITHDRAW_READ']),
  route('POST', '/withdraw-transactions/:id/bounce', 'Bounce (return) withdraw transaction payout', ['WITHDRAW_BOUNCE_WRITE']),
  route('POST', '/withdraw-transactions/:id/unfreeze', 'Unfreeze a FROZEN withdraw transaction', ['WITHDRAW_UNFREEZE_WRITE']),
  route('POST', '/withdraw-transactions/:id/refund', 'Sanction-refund a FROZEN withdraw transaction', ['WITHDRAW_REFUND_WRITE']),
  route('POST', '/withdraw-transactions/:withdrawNo/return-claim', 'Open a return-claim approval: a completed payout bounced back', ['WITHDRAW_RETURN_CLAIM_WRITE']),
  // Task 6 (SLA 批次)：管理台「模拟超时」按钮 —— 演示用,把 slaDeadline 拨到过去
  route('POST', '/withdraw-transactions/:withdrawNo/simulate-sla-timeout', 'Simulate SLA timeout for a withdraw transaction (demo only)', ['DEMO_CLOCK_WRITE']),
  // Demo verdict runner (Task 10, mirror of deposit's demo twin) — controller
  // only registered when SUMSUB_MOCK_MODE=true
  route(
    'POST',
    '/admin/withdraw-sumsub/demo/run-verdict',
    'Feed one Sumsub KYT verdict webhook into a withdrawal (demo only)',
    ['DEMO_VERDICT_WRITE'],
  ),
  // Task A7: 按钮清单出端点 — 前端 ⚡ 面板据此渲染，不再手抄
  route(
    'GET',
    '/admin/withdraw-sumsub/demo/verdict-buttons',
    'List available verdict buttons for the withdraw demo panel (demo only)',
    ['TRADING_WITHDRAW_READ'],
  ),

  // Swap admin
  route('POST', '/admin/swap-transactions', 'Create admin swap transaction', ['TRADING_SWAP_WRITE']),
  route('GET', '/admin/swap-transactions', 'List swap transactions', ['TRADING_SWAP_READ']),
  route('GET', '/admin/swap-transactions/quotes', 'List swap quotes', ['TRADING_SWAP_READ']),
  route('GET', '/admin/swap-transactions/quotes/:quoteNo', 'Get swap quote detail', ['TRADING_SWAP_READ']),
  route('GET', '/admin/swap-transactions/:swapNo', 'Get swap transaction detail', ['TRADING_SWAP_READ']),
  // 波五 Task 3：FROZEN 解冻/拒退审批全链——逐字镜像 withdraw-transactions 的 :id/unfreeze、:id/refund
  route('POST', '/admin/swap-transactions/:id/unfreeze', 'Unfreeze a FROZEN swap transaction', ['SWAP_UNFREEZE_WRITE']),
  route('POST', '/admin/swap-transactions/:id/refund', 'Sanction-refund a FROZEN swap transaction', ['SWAP_REFUND_WRITE']),
  route('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/advance', 'Advance swap settlement leg', ['TRADING_SWAP_WRITE']),
  route('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/resume', 'Resume a stuck swap leg', ['TRADING_SWAP_WRITE']),
  // Task 6 (SLA 批次)：管理台「模拟超时」按钮 —— 演示用,把 slaDeadline 拨到过去
  route('POST', '/admin/swap-transactions/:swapNo/simulate-sla-timeout', 'Simulate SLA timeout for a swap transaction (demo only)', ['DEMO_CLOCK_WRITE']),
  // Demo verdict runner (Task 9, mirror of deposit/withdraw's demo twins) —
  // controller only registered when SUMSUB_MOCK_MODE=true
  route(
    'POST',
    '/admin/swap-sumsub/demo/run-verdict',
    'Feed one Sumsub KYT verdict webhook into a swap (demo only)',
    ['DEMO_VERDICT_WRITE'],
  ),
  // Task A7: 按钮清单出端点 — 前端 ⚡ 面板据此渲染，不再手抄
  route(
    'GET',
    '/admin/swap-sumsub/demo/verdict-buttons',
    'List available verdict buttons for the swap demo panel (demo only)',
    ['TRADING_SWAP_READ'],
  ),

  // Payins / Payouts routes removed in Round 2 (C3) — the payin/payout
  // services were deleted and their admin surface folded into the unified
  // funds-orders read surface (see "Funds Orders" below).

  // Wallet / treasury
  route('GET', '/wallets', 'List wallet address rows (vault × network)', ['WALLET_READ']),
  route('GET', '/wallets/:walletNo', 'Get wallet detail', ['WALLET_READ']),

  // Reconciliation
  route('GET', '/admin/reconciliation/runs', 'View Recon Runs', ['RECON_RUN_READ']),
  route('GET', '/admin/reconciliation/runs/:runNo', 'View Recon Run Detail', ['RECON_RUN_READ']),
  route('POST', '/admin/reconciliation/runs/wallet', 'Trigger per-wallet reconciliation run', ['RECON_RUN_WRITE']),
  route('GET', '/admin/reconciliation/cases', 'View Recon Cases', ['RECON_CASE_READ']),
  route('GET', '/admin/reconciliation/cases/:caseNo', 'View Recon Case Detail', ['RECON_CASE_READ']),
  route('GET', '/admin/reconciliation/external-balances', 'View External Balances', ['RECON_EXTERNAL_BALANCE_READ']),
  route('GET', '/admin/reconciliation/external-balances/:walletNo', 'View External Balance Detail', ['RECON_EXTERNAL_BALANCE_READ']),
  // Recon disposition: 调账单（Task 6）
  route('POST', '/admin/reconciliation/adjustments', 'Create Recon Adjustment (Draft)', ['RECON_ADJUSTMENT_WRITE']),
  route('POST', '/admin/reconciliation/adjustments/:adjustmentNo/submit', 'Submit Recon Adjustment for Approval', ['RECON_ADJUSTMENT_WRITE']),
  // Task 4：列表放在 :adjustmentNo 详情之前——静态段先登记，惯例同上面 cases/runs 各自的 List 在 Detail 之前。
  route('GET', '/admin/reconciliation/adjustments', 'List Recon Adjustments', ['RECON_CASE_READ']),
  route('GET', '/admin/reconciliation/adjustments/:adjustmentNo', 'View Recon Adjustment Detail', ['RECON_CASE_READ']),
  route('POST', '/admin/reconciliation/cases/:caseNo/dispositions', 'Record disposition conclusion on a reconciliation diff row', ['RECON_DISPOSITION_WRITE']),
  route('GET', '/admin/reconciliation/cases/:caseNo/reattribution-candidates', 'List counterpart candidates for a reattribution', ['RECON_CASE_READ']),
  route('GET', '/admin/reconciliation/cases/:caseNo/supplement-candidates', 'Statement-line facts + candidate original orders for a supplement', ['RECON_CASE_READ']),
  // ─── 平账二期 · 内部划转单（2026-09-05）：公司 → 客户的补款 / 垫款，入口在案子上 ───
  route('POST', '/admin/internal-transfers/compensation', 'Initiate a client compensation transfer from a posted client-loss write-off', ['INTERNAL_TRANSFER_WRITE']),
  route('POST', '/admin/internal-transfers/advance', 'Initiate a client advance transfer to cover a clawback shortfall', ['INTERNAL_TRANSFER_WRITE']),
  route('POST', '/admin/internal-transfers/:transferNo/cancel', 'Cancel a pending internal transfer (maker only)', ['INTERNAL_TRANSFER_WRITE']),
  route('GET', '/admin/internal-transfers', 'List internal transfers', ['INTERNAL_TRANSFER_READ']),
  route('GET', '/admin/internal-transfers/:transferNo', 'Get internal transfer detail', ['INTERNAL_TRANSFER_READ']),
  // 平账 A 批：⚡拨钟——把案件账龄截止拨到过去（演示件，挂现有拨钟组，桶 demo.act_clock 已涵盖 SLA timers）
  route('POST', '/admin/reconciliation/cases/:caseNo/simulate-aging-timeout', 'Fast-forward a reconciliation case past its aging line (demo only)', ['DEMO_CLOCK_WRITE']),

  // Incident Register（平账三期）：controller 在 Task 8 落地。战役甲波一 Task 9：粗门放行、
  // 服务层细分——路由的组数组从单一 INCIDENT_WRITE 扩为五桶 OR（INCIDENT_WRITE 仍是
  // FUNDS 族经办组），真正把关的是 IncidentService.assertOperator 按 cfg.operatorMarkerCode
  // 精确判定持有人所在族（见下方 cap.incident.* 五行标记码），不是这里的路由级粗门。
  // 甲波二 T6：regulator-report 两条随 saveReportDraft/markReported 端点退役一并摘除
  // （12 → 10，两码只经本组集引用，摘 route 行即摘净）。
  route('POST', '/admin/incidents', 'Register an incident (from a recon case or manually)', ['INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('GET', '/admin/incidents', 'List incidents', ['INCIDENT_READ', 'INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('GET', '/admin/incidents/:incidentNo', 'View incident detail', ['INCIDENT_READ', 'INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('POST', '/admin/incidents/:incidentNo/investigation', 'Start investigation', ['INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('POST', '/admin/incidents/:incidentNo/notes', 'Add investigation note', ['INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('POST', '/admin/incidents/:incidentNo/escalate', 'Record an escalation (MLRO / CFO / senior management)', ['INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('POST', '/admin/incidents/:incidentNo/assess', 'Record loss assessment and reporting decision', ['INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('POST', '/admin/incidents/:incidentNo/remediations', 'Link a remediation order', ['INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('POST', '/admin/incidents/:incidentNo/close', 'Request incident closure (opens approval)', ['INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),
  route('POST', '/admin/incidents/:incidentNo/withdraw', 'Withdraw a mis-registered incident', ['INCIDENT_WRITE', 'INCIDENT_TECH_WRITE', 'INCIDENT_DATA_WRITE', 'INCIDENT_OPS_WRITE', 'INCIDENT_FIN_WRITE']),

  // Regulatory Filings（战役甲波二 Task 5 骨架；战役甲波三 T6 起报送台两经办组共享
  // 路由）：写路由与两条 GET 路由挂合规官/MLRO 两组 OR——路由 OR 是粗门，真正把关的是
  // 服务层 RegulatoryFilingService.assertFamily 按被操作那条单的 filing type family
  // 独占判定（cap.filing.general 合规官 / cap.filing.aml MLRO，见下方 cap.filing.* 服务层
  // 门标记码，照 Ruling-6 / cap.incident.* 先例）——本域不再是「路由门即精确门」的单组
  // 格局，见 ACTION_BUCKET_CATALOG 域块头注释同步订正。
  route('POST', '/admin/regulatory-filings', 'Open a filing (manual)', ['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  route('GET', '/admin/regulatory-filings', 'List regulatory filings', ['REG_FILING_READ', 'REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  route('GET', '/admin/regulatory-filings/:filingNo', 'View regulatory filing detail', ['REG_FILING_READ', 'REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  route('POST', '/admin/regulatory-filings/:filingNo/draft', 'Save filing draft body', ['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  route('POST', '/admin/regulatory-filings/:filingNo/signoff', 'Request sign-off (opens approval)', ['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  route('POST', '/admin/regulatory-filings/:filingNo/mark-submitted', 'Mark filing as submitted to the regulator', ['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  route('POST', '/admin/regulatory-filings/:filingNo/entries', 'Log a correspondence entry', ['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  route('POST', '/admin/regulatory-filings/:filingNo/close', 'Close a submitted filing', ['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  route('POST', '/admin/regulatory-filings/:filingNo/cancel', 'Cancel a draft filing', ['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),
  // AML 族「决定不报」出口（DRAFT→CLOSED + noFilingReason 必填闸，仅 allowNoFilingClose=true
  // 的类型可走，见 regulatory-filing.service.ts closeNoFiling）。T3 controller 已落地，
  // S7_PENDING_DEAD_ROWS 里原先的「暂未出生」白名单项已按约删除（ce06185）。
  route('POST', '/admin/regulatory-filings/:filingNo/close-no-filing', 'Close an AML filing with a no-filing decision', ['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']),

  // 战役甲波三 T6：cap.filing.* 服务层门标记码——不是路由，是 RegulatoryFilingService.
  // assertFamily 的服务层门标记（照 cap.incident.* 先例，Ruling-6；码本身由 T1 在
  // regulatory-filing.constants.ts 的 FILING_FAMILY_CAPABILITY_CODE 先行占位，登记与
  // 分组绑定随本任务落地，见该常量文件头注释）。写路由现在是合规官/MLRO 两组 OR 的粗门，
  // 真正的 family 独占判定发生在服务层：assertFamily 按被操作那条单的 type family
  // （GENERAL/AML，filing-type-registry.ts）取对应标记码，
  // hasPermission(actor.userId, code) 精确判定操作者是否真在那一个组——不走「组共享
  // 路由码」的反查。method/path 是占位描述字段（不产生真实路由），S7 已把这两码列入
  // S7_PENDING_DEAD_ROWS 白名单（同 cap.incident.* 先例，非腐烂死行）。
  { code: 'cap.filing.general', name: 'Regulatory filing operator capability: GENERAL family', description: 'Filing family operator capability (service-layer gate marker, not a route)', method: 'MARKER', path: '/internal/filing-capability/general', groups: ['REG_FILING_WRITE'] },
  { code: 'cap.filing.aml', name: 'Regulatory filing operator capability: AML family', description: 'Filing family operator capability (service-layer gate marker, not a route)', method: 'MARKER', path: '/internal/filing-capability/aml', groups: ['REG_FILING_AML_WRITE'] },

  // 甲波一 T5 修1（Ruling-6，C1 修复）：五个族独占能力码——不是路由，是
  // IncidentService.assertOperator 的服务层门标记。裁决背景：反查"权限码属于哪些组"在码
  // 被多组共享时会把持有人一并抬进所有共享组（GET /admin/incidents 码同属 INCIDENT_READ/
  // INCIDENT_WRITE 两组；T9 后 12 条路由码同属五桶），门就失效了。这五码分别只挂一个组，
  // hasPermission(userId, code) 精确判定"持有人是否真在这一个组"，不走反查。
  // method/path 是占位描述字段（不产生真实路由，S7 catalog-dead-row 检查会因此把这五行
  // 判成"无对应 controller 端点"——这是设计如此。甲波一 T9 起这五码已进
  // scripts/verify-rbac.ts 的 S7_PENDING_DEAD_ROWS 白名单（Ruling-6：服务层门标记码，
  // 非路由），不许放宽 S7 本身的判定逻辑。
  { code: 'cap.incident.funds', name: 'Incident operator capability: FUNDS family', description: 'Incident family operator capability (service-layer gate marker, not a route)', method: 'MARKER', path: '/internal/incident-capability/funds', groups: ['INCIDENT_WRITE'] },
  { code: 'cap.incident.tech', name: 'Incident operator capability: TECH_SECURITY family', description: 'Incident family operator capability (service-layer gate marker, not a route)', method: 'MARKER', path: '/internal/incident-capability/tech', groups: ['INCIDENT_TECH_WRITE'] },
  { code: 'cap.incident.data', name: 'Incident operator capability: DATA family', description: 'Incident family operator capability (service-layer gate marker, not a route)', method: 'MARKER', path: '/internal/incident-capability/data', groups: ['INCIDENT_DATA_WRITE'] },
  { code: 'cap.incident.ops', name: 'Incident operator capability: OPERATIONS family', description: 'Incident family operator capability (service-layer gate marker, not a route)', method: 'MARKER', path: '/internal/incident-capability/ops', groups: ['INCIDENT_OPS_WRITE'] },
  { code: 'cap.incident.fin', name: 'Incident operator capability: FINANCIAL family', description: 'Incident family operator capability (service-layer gate marker, not a route)', method: 'MARKER', path: '/internal/incident-capability/fin', groups: ['INCIDENT_FIN_WRITE'] },

  // TB Ledger
  route('GET', '/admin/tb/accounts', 'List TB account registry', ['LEDGER_ACCOUNT_READ']),
  route('GET', '/admin/tb/accounts/:tbAccountId', 'Get TB account detail', ['LEDGER_ACCOUNT_READ']),
  route('GET', '/admin/tb/transfers', 'List TB transfer evidence', ['LEDGER_EVIDENCE_READ']),
  route('GET', '/admin/tb/transfers/:tbTransferId', 'Get TB transfer evidence detail', ['LEDGER_EVIDENCE_READ']),
  route('GET', '/admin/tb/account-flows', 'List account flows', ['LEDGER_FLOW_READ']),
  route('GET', '/admin/tb/wallets', 'List distinct wallets from account flows', ['LEDGER_FLOW_READ']),

  // Assets
  route('GET', '/assets', 'List assets', ['ASSET_CONFIG_READ']),
  route('GET', '/assets/:assetNo', 'Get asset detail', ['ASSET_CONFIG_READ']),
  route('POST', '/admin/assets/:assetNo/suspend', 'Suspend asset', ['ASSET_CONFIG_WRITE']),
  route('POST', '/admin/assets/:assetNo/reactivate', 'Reactivate asset', ['ASSET_CONFIG_WRITE']),

  // Audit logs
  route('GET', '/admin/audit-logs', 'List audit logs', ['AUDIT_READ']),
  route('GET', '/admin/audit-logs/:eventNo', 'Get audit log detail', ['AUDIT_READ']),
  route('POST', '/admin/audit/evidence-packages', 'Export audit evidence package', [
    'AUDIT_EXPORT_CREATE',
  ]),
  route('GET', '/admin/audit/evidence-packages', 'List evidence package exports', [
    'AUDIT_EXPORT_READ',
  ]),
  route('GET', '/admin/audit/evidence-packages/:packageNo', 'Get evidence package detail', [
    'AUDIT_EXPORT_READ',
  ]),
  route('GET', '/admin/audit/evidence-packages/:packageNo/download', 'Download evidence package content', [
    'AUDIT_EXPORT_READ',
  ]),

  // Governance approvals
  // create/submit retired with GOV_APPROVAL_WRITE (D7) — zero HTTP callers (no admin-web
  // consumer builds a bare create or :id/submit request; every internal workflow module
  // opens cases via ApprovalsService.createAndSubmit(), not through this HTTP surface).
  // approve/reject/cancel stay: decision authority now lives in the approval policy's
  // checkerRole mechanism (service layer), so the RBAC group only needs to gate "can see
  // approvals" — downgraded from GOV_APPROVAL_DECIDE/WRITE to GOV_APPROVAL_READ.
  // cancel specifically was found to have a live consumer (ApprovalDetailPage.tsx's Cancel
  // button, same submitDecision() flow as approve/reject) — see task-4-report.md.
  route('POST', '/admin/control-gates/approvals/:approvalNo/approve', 'Approve approval case', ['GOV_APPROVAL_READ']),
  route('POST', '/admin/control-gates/approvals/:approvalNo/reject', 'Reject approval case', ['GOV_APPROVAL_READ']),
  route('POST', '/admin/control-gates/approvals/:approvalNo/cancel', 'Cancel approval case', ['GOV_APPROVAL_READ']),
  route('POST', '/admin/control-gates/approvals/:approvalNo/simulate-timeout', 'Fast-forward approval timeout (demo only)', ['DEMO_CLOCK_WRITE']),
  route('GET', '/admin/control-gates/approvals/:approvalNo', 'Get approval case detail', ['GOV_APPROVAL_READ']),
  route('GET', '/admin/control-gates/approvals', 'List approval cases', ['GOV_APPROVAL_READ']),

  // Approval Policy Management
  route('GET', '/admin/governance/approval-policies', 'List approval policies', [
    'GOV_APPROVAL_POLICY_READ',
  ]),
  route('POST', '/admin/governance/approval-policies/:actionType/change-requests', 'Create approval policy change request', [
    'GOV_APPROVAL_POLICY_WRITE',
  ]),
  route('GET', '/admin/governance/approval-policies/change-requests', 'List approval policy change requests', [
    'GOV_APPROVAL_POLICY_READ',
  ]),
  route('GET', '/admin/governance/approval-policies/change-requests/:id', 'Get approval policy change request detail', [
    'GOV_APPROVAL_POLICY_READ',
  ]),

  // Transaction Limit Rules
  route('GET', '/admin/transaction-limit-rules', 'List transaction limit rules', ['TRANSACTION_LIMIT_READ']),
  route('GET', '/admin/transaction-limit-rules/:ruleNo', 'Get transaction limit rule detail', ['TRANSACTION_LIMIT_READ']),
  route('POST', '/admin/transaction-limit-rules/:ruleNo/change', 'Submit transaction limit rule change', ['TRANSACTION_LIMIT_WRITE']),

  // Withdrawal Addresses
  route('GET', '/admin/withdrawal-addresses', 'List withdrawal addresses', [
    'WITHDRAWAL_ADDRESS_READ',
  ]),
  route('GET', '/admin/withdrawal-addresses/:addressNo', 'Get withdrawal address detail', [
    'WITHDRAWAL_ADDRESS_READ',
  ]),
  route('POST', '/admin/withdrawal-addresses/:addressNo/suspend', 'Suspend withdrawal address', [
    'WITHDRAWAL_ADDRESS_WRITE',
  ]),
  route('POST', '/admin/withdrawal-addresses/:addressNo/skip-cooling', 'Skip withdrawal address cooling period', [
    'WITHDRAWAL_ADDRESS_WRITE',
  ]),
  route('POST', '/admin/withdrawal-addresses/:addressNo/unsuspend', 'Lift withdrawal address suspension', [
    'WITHDRAWAL_ADDRESS_WRITE',
  ]),

  // Withdrawal Fee Levels
  route('GET', '/admin/withdrawal-fee-levels', 'List withdrawal fee levels', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),
  route('GET', '/admin/withdrawal-fee-levels/:levelCode', 'Get withdrawal fee level detail', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),
  route('POST', '/admin/withdrawal-fee-levels', 'Create withdrawal fee level', [
    'WITHDRAWAL_FEE_LEVEL_WRITE',
  ]),
  route('POST', '/admin/withdrawal-fee-levels/:levelCode/change', 'Submit withdrawal fee level change request', [
    'WITHDRAWAL_FEE_LEVEL_WRITE',
  ]),
  route('POST', '/admin/withdrawal-fee-levels/:levelCode/retire', 'Submit withdrawal fee level retirement request', [
    'WITHDRAWAL_FEE_LEVEL_WRITE',
  ]),

  // Swap Fee Levels
  route('GET', '/admin/swap-fee-levels', 'List swap fee levels', [
    'SWAP_FEE_LEVEL_READ',
  ]),
  route('GET', '/admin/swap-fee-levels/:levelCode', 'Get swap fee level detail', [
    'SWAP_FEE_LEVEL_READ',
  ]),
  route('POST', '/admin/swap-fee-levels', 'Create swap fee level', [
    'SWAP_FEE_LEVEL_WRITE',
  ]),
  route('POST', '/admin/swap-fee-levels/:levelCode/change', 'Submit swap fee level change request', [
    'SWAP_FEE_LEVEL_WRITE',
  ]),
  route('POST', '/admin/swap-fee-levels/:levelCode/retire', 'Submit swap fee level retirement request', [
    'SWAP_FEE_LEVEL_WRITE',
  ]),

  // Withdrawal Quote Admin
  route('GET', '/admin/withdrawal-fee-levels/quotes', 'List withdrawal quotes', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),
  route('GET', '/admin/withdrawal-fee-levels/quotes/:quoteNo', 'Get withdrawal quote detail', [
    'WITHDRAWAL_FEE_LEVEL_READ',
  ]),

  // Settlement + legacy funds-layer/funds routes removed in Round 2 (C5/C6):
  // the delayed-settlement machinery was dropped and the funds read surface
  // moved to the unified /admin/funds-orders controller below.

  // Funds Orders (Round 2 — unified deposit/withdraw/swap funds read surface)
  // Task 7 (B3)：看/推拆开 — list/detail 挂 FUNDS_ORDER_VIEW，advance/push 挂 FUNDS_ORDER_ACT
  route('GET', '/admin/funds-orders', 'List funds orders', ['FUNDS_ORDER_VIEW']),
  route('GET', '/admin/funds-orders/:fundsOrderNo', 'Get funds order detail', ['FUNDS_ORDER_VIEW']),
  route('POST', '/admin/funds-orders/:fundsOrderNo/advance', 'Advance funds order (sim/ops)', ['FUNDS_ORDER_ACT']),
  // Recon disposition (平账·推单) — sync from external receipt / manual confirm with evidence.
  route('POST', '/admin/funds-orders/:fundsOrderNo/push/sync', 'Push order — sync from external receipt (recon disposition)', ['FUNDS_ORDER_ACT']),
  route('POST', '/admin/funds-orders/:fundsOrderNo/push/manual', 'Push order — manual confirm with evidence (recon disposition)', ['FUNDS_ORDER_ACT']),

];

/* ═══════════════════════════════════════════════════════════════
   Action Bucket Catalog
   User-facing capability abstraction. Each "bucket" represents
   a functional capability users can understand (e.g. "View members & roles")
   mapped to one or more PermissionGroups.
   ═══════════════════════════════════════════════════════════════ */

export interface ActionBucket {
  key: string;
  label: string;
  description: string;
  groups: PermissionGroup[];
  forcedOn?: boolean;
  restricted?: boolean;
}

export interface ActionDomain {
  id: string;
  label: string;
  icon: string;
  buckets: ActionBucket[];
}

export const ACTION_BUCKET_CATALOG: ActionDomain[] = [
  // ─── Domain 0: Auth (forced on, non-toggleable) ─────
  {
    id: 'auth',
    label: 'Auth',
    icon: '🔑',
    buckets: [
      {
        key: 'auth.base_access',
        label: 'Base Access',
        description: 'Basic session access — required for all admin users to log in and use the platform',
        groups: ['BASE_ACCESS'],
        forcedOn: true,
      },
    ],
  },
  // ─── Domain 1: Identity & Access ─────────────────────
  {
    id: 'iam',
    label: 'Identity & Access',
    icon: '🔐',
    buckets: [
      {
        key: 'iam.view_members',
        label: 'View members',
        description: 'Browse member list, view member detail and role bindings',
        groups: ['IAM_MEMBER_READ'],
      },
      {
        key: 'iam.view_roles',
        label: 'View roles & catalog',
        description: 'Browse role catalog, permissions, action buckets, role change requests',
        groups: ['IAM_ROLE_READ'],
      },
      {
        key: 'iam.manage_members',
        label: 'Manage members',
        description: 'Invite members, resend invitations, suspend and reactivate accounts',
        groups: ['IAM_MEMBER_MANAGE'],
      },
      {
        key: 'iam.assign_roles',
        label: 'Assign roles',
        description: 'Change user role bindings, create role change requests',
        groups: ['IAM_ROLE_ASSIGN'],
      },
      {
        key: 'iam.manage_credentials',
        label: 'Manage credentials',
        description: 'Reset password, reset MFA',
        groups: ['IAM_CREDENTIAL_RESET'],
      },
      {
        key: 'iam.define_roles',
        label: 'Manage role definitions',
        description: 'Propose new role definitions or modify existing ones for approval',
        groups: ['IAM_ROLE_DEFINE'],
      },
    ],
  },
  // ─── Domain 2: Approval Center ───────────────────────
  {
    id: 'gov_approvals',
    label: 'Approval Center',
    icon: '🚦',
    buckets: [
      {
        key: 'gov_approvals.view',
        label: 'View approvals',
        description: 'Browse approval list, view approval detail and history',
        groups: ['GOV_APPROVAL_READ'],
      },
      {
        key: 'gov_approval_policies.view',
        label: 'View approval policies',
        description: 'Browse approval policy configurations',
        groups: ['GOV_APPROVAL_POLICY_READ'],
      },
      {
        key: 'gov_approval_policies.manage',
        label: 'Manage approval policies',
        description: 'Submit approval policy change requests — held by senior management and the CISO; SM proposes, CISO decides',
        groups: ['GOV_APPROVAL_POLICY_WRITE'],
        restricted: true,
      },
    ],
  },
  // ─── Domain 3: Audit Center ──────────────────────────
  {
    id: 'audit',
    label: 'Audit Center',
    icon: '📁',
    buckets: [
      {
        key: 'audit.view',
        label: 'View audit logs',
        description: 'Browse audit log events, filter, view detail',
        groups: ['AUDIT_READ'],
      },
      {
        key: 'audit.view_exports',
        label: 'View evidence packages',
        description: 'Browse and download audit evidence packages',
        groups: ['AUDIT_EXPORT_READ'],
      },
      {
        key: 'audit.create_exports',
        label: 'Create evidence packages',
        description: 'Create new audit evidence export packages',
        groups: ['AUDIT_EXPORT_CREATE'],
      },
    ],
  },
  // 2026-08-31：本目录**不再有占位域**——每个域都至少一个桶（原「Placeholder
  // Domains (no buckets yet)」注释随第一幕职权重划作废）。空域是致命的：前端
  // RoleDetailPage 只渲染有桶的域，空壳域在自定义角色界面上根本不出现，
  // 等于「有权限但没入口」。两条机器判据看着这件事：
  //   ① 有绑定无桶为空  ② 有桶无组为空（防反向的「有入口没权限」）
  {
    id: 'accounting',
    label: 'Accounting',
    icon: '📒',
    buckets: [
      { key: 'ledger.view_accounts', label: 'View ledger accounts', description: 'Browse TB account registry', groups: ['LEDGER_ACCOUNT_READ'] },
      { key: 'ledger.view_evidence', label: 'View transfer evidence', description: 'Browse TB transfer evidence', groups: ['LEDGER_EVIDENCE_READ'] },
      { key: 'ledger.view_flows', label: 'View account flows', description: 'Browse per-account flow rows', groups: ['LEDGER_FLOW_READ'] },
    ],
  },
  {
    id: 'treasury',
    label: 'Treasury',
    icon: '📦',
    buckets: [
      {
        key: 'treasury.view_assets',
        label: 'View assets',
        description: 'Browse asset list and asset detail',
        groups: ['ASSET_CONFIG_READ'],
      },
      {
        key: 'treasury.manage_assets',
        label: 'Suspend / reactivate assets',
        description: 'Submit asset suspension and reactivation requests — CISO signs them off',
        groups: ['ASSET_CONFIG_WRITE'],
      },
      {
        key: 'treasury.view_wallets',
        label: 'View wallets',
        description: 'Browse wallet address rows (vault × network) and detail; balances live in the ledger',
        groups: ['WALLET_READ'],
      },
      {
        key: 'treasury.view_addresses',
        label: 'View withdrawal addresses',
        description: 'Browse withdrawal address list and detail',
        groups: ['WITHDRAWAL_ADDRESS_READ'],
      },
      {
        key: 'treasury.manage_addresses',
        label: 'Manage withdrawal addresses',
        description: 'Suspend / unsuspend withdrawal addresses, skip cooling period (simulation)',
        groups: ['WITHDRAWAL_ADDRESS_WRITE'],
      },
      {
        key: 'treasury.view_limits',
        label: 'View transaction limits',
        description: 'Browse transaction limit policy list and detail',
        groups: ['TRANSACTION_LIMIT_READ'],
      },
      {
        key: 'treasury.manage_limits',
        label: 'Manage transaction limits',
        description: 'Submit transaction limit change requests — senior management signs them off',
        groups: ['TRANSACTION_LIMIT_WRITE'],
      },
      {
        key: 'treasury.view_transfers',
        label: 'View internal transfers',
        description: 'Browse company → client compensation / advance transfers and their funds-order legs',
        groups: ['INTERNAL_TRANSFER_READ'],
      },
      {
        key: 'treasury.act_client_funding',
        label: 'Fund a client (compensation / advance)',
        description: 'Initiate or cancel a company → client transfer from a reconciliation case — CFO signs it off',
        groups: ['INTERNAL_TRANSFER_WRITE'],
      },
    ],
  },
  // ─── Domain: Customer ────────────────────────────────
  {
    id: 'customer',
    label: 'Customer Management',
    icon: '👥',
    buckets: [
      {
        key: 'customer.view',
        label: 'View customers',
        description: 'Browse customer list, detail, tags and restrictions',
        groups: ['CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW'],
      },
      {
        key: 'customer.manage_profile',
        label: 'Manage profile & tags',
        description: 'Edit customer profile fields, attach and detach tags',
        groups: ['CUSTOMER_WRITE', 'CUSTOMER_TAG_MANAGE'],
      },
      {
        key: 'customer.act_restrict',
        label: 'Open restrictions',
        description: 'Place a restriction on a customer (sanction, administrative)',
        groups: ['CUSTOMER_RESTRICTION_WRITE'],
      },
      {
        key: 'customer.act_release',
        label: 'Release restrictions',
        description: 'Request release of an existing restriction — deliberately split from opening one',
        groups: ['CUSTOMER_RESTRICTION_RELEASE'],
      },
      {
        key: 'customer.act_onboarding_acceptance',
        label: 'Request onboarding acceptance',
        description: 'Open a senior-management approval to accept a high-risk onboarding customer',
        groups: ['CUSTOMER_ONBOARDING_ACCEPT_WRITE'],
      },
      {
        key: 'customer.act_tier_upgrade_acceptance',
        label: 'Request trading tier upgrade acceptance',
        description: 'Open a senior-management approval to raise a customer trading tier BASIC -> PREMIUM',
        groups: ['CUSTOMER_TIER_UPGRADE_WRITE'],
      },
    ],
  },
  // ─── Domain: Trading (split per concrete action) ──────
  // 拆到具体动作，不用笼统的「处置」：提上缴和提没收不是同一件事，
  // 解冻更不该和放行同属一个包（业主 2026-08-30 定）。
  {
    id: 'trading',
    label: 'Trading',
    icon: '📊',
    buckets: [
      { key: 'trading.view_deposit', label: 'View deposits', description: 'Browse deposit orders and detail', groups: ['TRADING_DEPOSIT_READ'] },
      { key: 'trading.view_withdraw', label: 'View withdrawals', description: 'Browse withdrawal orders and detail', groups: ['TRADING_WITHDRAW_READ'] },
      { key: 'trading.view_swap', label: 'View swaps', description: 'Browse swap orders, quotes and detail', groups: ['TRADING_SWAP_READ'] },
      { key: 'trading.view_sumsub_events', label: 'View Sumsub callbacks', description: 'Browse the inbound Sumsub webhook event log and where each was dispatched', groups: ['SUMSUB_EVENT_VIEW'] },
      { key: 'trading.act_deposit_waive', label: 'Release below-minimum holds', description: 'Waive a below-minimum deposit hold — executes immediately, no approval', groups: ['DEPOSIT_WAIVE_WRITE'] },
      { key: 'trading.act_deposit_confiscate', label: 'Request deposit confiscation', description: 'Open a confiscation approval — the money becomes firm revenue', groups: ['DEPOSIT_CONFISCATE_WRITE'] },
      { key: 'trading.act_deposit_return', label: 'Request return to sender', description: 'Open a return-to-sender approval', groups: ['DEPOSIT_RETURN_WRITE'] },
      { key: 'trading.act_deposit_seize', label: 'Request seizure', description: 'Open a seizure approval under government order', groups: ['DEPOSIT_SEIZE_WRITE'] },
      { key: 'trading.act_deposit_unfreeze', label: 'Request deposit unfreeze', description: 'Open an unfreeze approval — compliance line only, never operations', groups: ['DEPOSIT_UNFREEZE_WRITE'] },
      { key: 'trading.act_deposit_supplement', label: 'Request missed-deposit replay', description: 'Open a CFO approval to replay a missed inbound from a reconciliation statement line', groups: ['DEPOSIT_SUPPLEMENT_WRITE'] },
      { key: 'trading.act_deposit_clawback', label: 'Request deposit clawback', description: 'Open a CFO approval to book a bank reversal of a credited deposit', groups: ['DEPOSIT_CLAWBACK_WRITE'] },
      { key: 'trading.act_withdraw_create', label: 'Create withdrawals & quotes', description: 'Raise withdrawal orders and pricing quotes', groups: ['TRADING_WITHDRAW_WRITE'] },
      { key: 'trading.act_withdraw_bounce', label: 'Bounce payouts', description: 'Mark a payout as returned by the bank — executes immediately', groups: ['WITHDRAW_BOUNCE_WRITE'] },
      { key: 'trading.act_withdraw_refund', label: 'Request sanction refund', description: 'Open a sanction-refund approval on a frozen withdrawal', groups: ['WITHDRAW_REFUND_WRITE'] },
      { key: 'trading.act_withdraw_unfreeze', label: 'Request withdrawal unfreeze', description: 'Open an unfreeze approval — compliance line only, never operations', groups: ['WITHDRAW_UNFREEZE_WRITE'] },
      { key: 'trading.act_withdraw_return_claim', label: 'Request payout-return claim', description: 'Open a CFO approval to re-credit a completed payout that bounced back', groups: ['WITHDRAW_RETURN_CLAIM_WRITE'] },
      { key: 'trading.act_swap', label: 'Handle swaps', description: 'Raise and progress swap orders', groups: ['TRADING_SWAP_WRITE'] },
      { key: 'trading.act_swap_refund', label: 'Request swap sanction refund', description: 'Open a sanction-refund approval on a frozen swap', groups: ['SWAP_REFUND_WRITE'] },
      { key: 'trading.act_swap_unfreeze', label: 'Request swap unfreeze', description: 'Open an unfreeze approval — compliance line only, never operations', groups: ['SWAP_UNFREEZE_WRITE'] },
    ],
  },
  // ─── Domain: Funds Orders ────────────────────────────
  // 看得到资金单 != 推得动资金单 —— 这条 SoD 靠 VIEW/ACT 分家才成立。
  {
    id: 'funds',
    label: 'Funds Orders',
    icon: '🚚',
    buckets: [
      { key: 'funds.view', label: 'View funds orders', description: 'Browse the physical transfer mirror of every order', groups: ['FUNDS_ORDER_VIEW'] },
      { key: 'funds.act_push', label: 'Push funds orders', description: 'Advance or push a funds order leg — seeing one is not moving one', groups: ['FUNDS_ORDER_ACT'] },
    ],
  },
  // ─── Domain: Reconciliation ──────────────────────────
  {
    id: 'recon',
    label: 'Reconciliation',
    icon: '🔍',
    buckets: [
      { key: 'recon.view', label: 'View runs, cases & balances', description: 'Browse reconciliation runs, cases and external balances', groups: ['RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ'] },
      { key: 'recon.act_run', label: 'Trigger reconciliation runs', description: 'Kick off a per-wallet reconciliation run', groups: ['RECON_RUN_WRITE'] },
      { key: 'recon.act_adjust', label: 'Open ledger adjustments', description: 'Open and submit a ledger-correction adjustment against a reconciliation break', groups: ['RECON_ADJUSTMENT_WRITE'] },
      { key: 'recon.act_dispose', label: 'Record disposition conclusions', description: 'Record the investigated cause and outlet on a reconciliation diff row (hold / route / precede an adjustment)', groups: ['RECON_DISPOSITION_WRITE'] },
    ],
  },
  // ─── Domain: Incident Register ───────────────────────
  // 战役甲波一 T9：十类终盘按族拆经办桶——FUNDS 族仍是 incidents.manage（存量键名不动，
  // T5/T8 已在跑的策略/引用不必跟着改名），另四族各开一个新桶，见 incident-type-registry.ts
  // 的 family → operatorGroup 映射。
  // 甲波一 T9 修2（评审 Ruling-13）：incidents.view 桶原带 ['INCIDENT_READ','INCIDENT_WRITE']
  // 两个组——Modify 提交按"选中桶展开全部组"（RoleDetailPage.tsx 的 proposedPermissionGroups
  // 计算），任何只读展示这个桶（子集完备推导下，持有五个经办组任一个的角色都会看到它勾选，
  // 见 heldGroups.ts 头注释）的角色，善意提交一次（哪怕只改描述）就会把 INCIDENT_WRITE（连
  // 带 cap.incident.funds）一并塞进请求——CISO/MLRO/SM/INTERNAL_AUDITOR 这类只该读不该写的
  // 角色因此会被授出整个 FUNDS 族登记/结案能力，是 C1 子集完备修复之后仍未堵上的最后一条
  // 越权尾巴。改为只挂 ['INCIDENT_READ']：桶的"是否显示为已持有"不受影响（写组持有人的
  // 持码集合天然包含 INCIDENT_READ 名下的两个 GET 码，子集判据照样判定为持有），但提交时
  // 这个桶只贡献 INCIDENT_READ——对写组持有人这是无害冗余（授的码他们本就有，见
  // scratchpad/submit.ts 模拟：修复后 gainedCodes 归零)，对纯读角色更是直接消掉了越权面。
  {
    id: 'incidents',
    label: 'Incident Register',
    icon: '🚨',
    buckets: [
      { key: 'incidents.view', label: 'View incidents', description: 'Browse the incident register and reporting trail', groups: ['INCIDENT_READ'] },
      { key: 'incidents.manage', label: 'Register & manage funds-family incidents', description: 'Register, investigate, assess, link remediations, request closure — FUNDS family (unauthorized outflow, large unexplained discrepancy, client shortfall)', groups: ['INCIDENT_WRITE'] },
      { key: 'incidents.manage-tech', label: 'Register & manage tech/security incidents', description: 'Register, investigate, assess, request closure — TECH_SECURITY family (cyber/BCDR, outsourcing failure)', groups: ['INCIDENT_TECH_WRITE'] },
      { key: 'incidents.manage-data', label: 'Register & manage data-breach incidents', description: 'Register, investigate, assess, log customer notice, request closure — DATA family (personal data breach)', groups: ['INCIDENT_DATA_WRITE'] },
      { key: 'incidents.manage-ops', label: 'Register & manage operations incidents', description: 'Register, investigate, assess, link asset suspension, request closure — OPERATIONS family (asset non-compliance, major stuck transaction)', groups: ['INCIDENT_OPS_WRITE'] },
      { key: 'incidents.manage-fin', label: 'Register & manage financial incidents', description: 'Register, investigate, assess, request closure — FINANCIAL family (prudential/NLA breach)', groups: ['INCIDENT_FIN_WRITE'] },
    ],
  },
  // ─── Domain: Regulatory Filings ──────────────────────
  // 战役甲波二：报送台骨架——单经办组（合规官），view 桶照 Ruling-13 只挂单组。
  // 战役甲波三 T6 起报送台两经办组共享路由（合规官 GENERAL 族 / MLRO AML 族）：路由 OR
  // 是粗门，服务层 cap.filing.general/cap.filing.aml 按族独占才是真把关（照 Ruling-6 /
  // cap.incident.* 先例，见上方 route() 段 cap.filing.* 服务层门标记码）。
  {
    id: 'filings', label: 'Regulatory Filings', icon: '📨',
    buckets: [
      { key: 'filings.view', label: 'View regulatory filings', description: 'Browse the regulatory filing desk and correspondence trail', groups: ['REG_FILING_READ'] },
      { key: 'filings.desk', label: 'Operate the regulatory filing desk', description: 'Open filings, draft, submit for sign-off, mark submitted, log correspondence, close — the compliance desk', groups: ['REG_FILING_WRITE'] },
      { key: 'filings.aml-desk', label: 'Operate AML reporting desk', description: 'STR/SAR/CNMR/PNMR/HRC/HRCA — MLRO personally handles the AML reporting family, DRAFT→SUBMITTED direct (no sign-off chain)', groups: ['REG_FILING_AML_WRITE'] },
    ],
  },
  // ─── Domain: Pricing ─────────────────────────────────
  {
    id: 'pricing',
    label: 'Pricing',
    icon: '💰',
    buckets: [
      { key: 'pricing.view', label: 'View fee levels', description: 'Browse withdrawal and swap fee levels', groups: ['WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ'] },
      { key: 'pricing.manage', label: 'Manage fee levels', description: 'Raise fee level creation, change and retirement requests — operations signs them off', groups: ['WITHDRAWAL_FEE_LEVEL_WRITE', 'SWAP_FEE_LEVEL_WRITE'] },
    ],
  },
  // ─── Domain: Demo Instruments ────────────────────────
  // ⚡ 面板模拟的是 Sumsub 那一侧，不是我方后台的职务能力 —— 单列成域，
  // 才能让「谁能按 ⚡」和「谁能处置单据」在矩阵上是两行。
  {
    id: 'demo',
    label: 'Demo Instruments',
    icon: '⚡',
    buckets: [
      { key: 'demo.act_verdict', label: 'Feed compliance verdicts', description: 'Stand in for the Sumsub console — the only way a compliance officer moves an order', groups: ['DEMO_VERDICT_WRITE'] },
      { key: 'demo.act_clock', label: 'Fast-forward clocks', description: 'Trip SLA timers and material expiry for demonstration', groups: ['DEMO_CLOCK_WRITE'] },
    ],
  },
];

/**
 * Build a map from permission code → PermissionGroup[].
 * Used by the frontend to derive which groups a role holds
 * from its list of individual permission codes.
 */
export function buildPermCodeToGroups(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const perm of RBAC_PERMISSION_DEFINITIONS) {
    map[perm.code] = [...perm.groups];
  }
  return map;
}

export const RBAC_ROLE_GROUP_BINDINGS: Record<string, PermissionGroup[]> = {
  SUPER_ADMIN: [],

  SENIOR_MANAGEMENT_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ', 'GOV_APPROVAL_POLICY_WRITE',
    'AUDIT_READ', 'AUDIT_EXPORT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ', 'TRANSACTION_LIMIT_READ',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'FUNDS_ORDER_VIEW',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ', 'INTERNAL_TRANSFER_READ',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
    'INCIDENT_READ',
    // 战役甲波二 Task 5：签发唯高管——高管是 REG_FILING_SUBMIT 的唯一裁决人，需要读得到
    // 报送台详情页（同 CISO 批事故拿 INCIDENT_READ 先例）。
    'REG_FILING_READ',
  ],

  CISO: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ', 'IAM_MEMBER_MANAGE', 'IAM_ROLE_ASSIGN',
    'IAM_ROLE_DEFINE', 'IAM_CREDENTIAL_RESET',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ', 'GOV_APPROVAL_POLICY_WRITE',
    'AUDIT_READ', 'AUDIT_EXPORT_READ',
    'ASSET_CONFIG_READ', 'TRANSACTION_LIMIT_READ',
    // 战役甲波一 T9：CISO 是 INCIDENT_CLOSE_TECHSEC 的唯一裁决人（技安/数据/运营三族结案，
    // T8 已入审批常量）——不带任何 *_WRITE 经办组（裁决人不是经办人），只带 INCIDENT_READ
    // 让审批详情页的 entityRef 回链能点开事故详情（S9 守着这条，此前是红）。
    'INCIDENT_READ',
  ],

  MLRO: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'CUSTOMER_RESTRICTION_WRITE', 'CUSTOMER_RESTRICTION_RELEASE',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'FUNDS_ORDER_VIEW',
    'TRANSACTION_LIMIT_READ',
    'INCIDENT_READ',
    // 战役甲波三 T6：MLRO 亲办 AML 报送族（STR/SAR/CNMR/PNMR/HRC/HRCA），需要读得到
    // 报送台列表/详情页（同 CISO 批事故拿 INCIDENT_READ 先例）——此前只有合规官/高管/
    // 内审持 REG_FILING_READ，MLRO 漏了，裁决人/亲办人要看得见列表详情，这里补齐。
    'REG_FILING_READ',
    'REG_FILING_AML_WRITE',
  ],

  DPO: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ', 'AUDIT_EXPORT_CREATE',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'INCIDENT_READ',
    // 战役甲波一 T9：DATA 族事故经办组——唯一持有人，DATA_BREACH（PDPL Art.9）登记/调查/
    // 定损/结案请求全靠这个组。
    'INCIDENT_DATA_WRITE',
  ],

  // 全域只读 + 建证据包；一个 manage / act 包都不给 —— 这是本职务的全部意义
  INTERNAL_AUDITOR: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ', 'AUDIT_EXPORT_CREATE',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ', 'TRANSACTION_LIMIT_READ',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'FUNDS_ORDER_VIEW',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ', 'INTERNAL_TRANSFER_READ',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
    'INCIDENT_READ',
    // 战役甲波二 Task 5：内审要看得见报送台（照 CISO 批事故拿 INCIDENT_READ 先例）。
    'REG_FILING_READ',
  ],

  // 拦的手：开/解限制、贴撕标签、提解冻；管理台里推不动任何交易单据（D-不翻案）
  COMPLIANCE_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ', 'AUDIT_EXPORT_CREATE',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'CUSTOMER_WRITE', 'CUSTOMER_TAG_MANAGE',
    'CUSTOMER_RESTRICTION_WRITE', 'CUSTOMER_RESTRICTION_RELEASE',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'DEPOSIT_UNFREEZE_WRITE', 'WITHDRAW_UNFREEZE_WRITE', 'SWAP_UNFREEZE_WRITE',
    'DEMO_VERDICT_WRITE',
    'ASSET_CONFIG_READ', 'WITHDRAWAL_ADDRESS_READ', 'TRANSACTION_LIMIT_READ',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ',
    // 战役甲波二 Task 5：报送台经办唯合规官——开单/草稿/送签/标已提交/往来记录/办结/作废。
    'REG_FILING_WRITE',
    // 起草事故通报要读得到事故（spec §6；合规官现况不持 INCIDENT_READ，起草报送前必须
    // 能看事故详情与留痕，照「裁决人要看得见」同款理由）。
    'INCIDENT_READ',
  ],

  // 定价的主人：费率两族的写权限全仓仅此一处（提由他提，运营复核）。
  // 其余全是读——账本、对账、资金单、三域单据，够他看清钱的来龙去脉。
  CFO: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ',
    'AUDIT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'WALLET_READ', 'TRANSACTION_LIMIT_READ',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ',
    'FUNDS_ORDER_VIEW',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ', 'INTERNAL_TRANSFER_READ',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
    'WITHDRAWAL_FEE_LEVEL_WRITE', 'SWAP_FEE_LEVEL_WRITE',
    // CUSTOMER_TAG_VIEW 补于波一 T13——此前 CFO 持两族 *_FEE_LEVEL_WRITE 却没这个组，唯一
    // 能建费率等级的角色打开费率等级创建/变更弹窗的受众标签选择器（GET
    // /admin/customer-tags/catalog）只看得到 everyone，VIP 等受众标签选不到；这个组同时也
    // 挂在 GET /admin/customers/:customerNo/effective-tags 上（非本次新增用途，原本就在）。
    // 不带 CUSTOMER_READ——CFO 不查客户资料。
    'CUSTOMER_TAG_VIEW',
    'INCIDENT_READ',
    // 战役甲波一 T9：FINANCIAL 族事故经办组——唯一持有人，PRUDENTIAL_BREACH（NLA 审慎缺口）
    // 登记/调查/定损/结案请求全靠这个组；结案裁决人是 SENIOR_MANAGEMENT_OFFICER（T8），
    // CFO 不是自己的裁决人，无自批死锁。
    'INCIDENT_FIN_WRITE',
  ],

  // 提现地址的写权限全仓仅此一处；钱包地址行只从种子来，管理台只读。
  // 暂停 / 恢复资产归运营，不归他——他管钱装在哪个容器里，不管资产状态。
  TREASURY_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ',
    'AUDIT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ',
    'WALLET_READ',
    'WITHDRAWAL_ADDRESS_READ', 'WITHDRAWAL_ADDRESS_WRITE',
    // 对账平账两角色定案（2026-09-10）：业主裁定对账/平账只留金库与 CFO，运营整组清零、
    // 不拆组不双持——FUNDS_ORDER_ACT（推单）随本组从 OPS_OFFICER 整体迁入。
    'FUNDS_ORDER_VIEW', 'FUNDS_ORDER_ACT',
    // 调账单裁决人是 CFO（平账 A 批起，原 OPS_OFFICER）；开单权 RECON_ADJUSTMENT_WRITE
    // 归金库——maker（金库）≠ checker（CFO），verify:rbac S5c 守着这条。RECON_CASE_READ 是
    // 走到入口的必需品：侧栏 Cases 与调账单详情路由都要它。
    // 对账平账两角色定案（2026-09-10）：RECON_RUN_READ、RECON_EXTERNAL_BALANCE_READ 随本组
    // 一并整体迁入——此前金库只读 Cases，Runs 记分牌 / External Balances 两页对金库是 403，
    // 是个隐藏缺口，本次一并补上（对账侧栏三页全开）。
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ', 'RECON_ADJUSTMENT_WRITE',
    // 平账处置改版第 6 任务(2026-09-08)：案件页处置全线金库开单、CFO 复核，运营退出案件页——
    // 推单/重对账（RECON_RUN_WRITE）、处置结论（RECON_DISPOSITION_WRITE）、以及处置牵出的三种
    // CFO 复核出口（补单/追回/追偿）一并从 OPS_OFFICER 迁入；maker（金库）≠ checker（CFO）。
    'RECON_RUN_WRITE', 'RECON_DISPOSITION_WRITE',
    'DEPOSIT_SUPPLEMENT_WRITE', 'DEPOSIT_CLAWBACK_WRITE', 'WITHDRAW_RETURN_CLAIM_WRITE',
    // 评审 Imp-1（Task6 2026-09-08）：补单 maker 得点开自己发起的充值/提现单——CFO 批完补单，
    // 案件页出现单号链接，金库没有这两个读权点进去就 403，是全仓唯一看不到自己所开订单的职务。
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ',
    // 平账二期：补款 / 垫款开单归金库——maker（金库）≠ checker（CFO），verify:rbac S5 守着；READ 走到列表 / 详情入口。
    'INTERNAL_TRANSFER_READ', 'INTERNAL_TRANSFER_WRITE',
    'INCIDENT_WRITE',
    // 对账平账两角色定案（2026-09-10）：DEMO_CLOCK_WRITE 随本组整体迁入——案件页 ⚡Fast-forward
    // aging 按钮，以及充值/提现/兑换 SLA 超时与审批超时的演示拨钟，运营不再持有。
    'DEMO_CLOCK_WRITE',
    // 评审逮回：业主裁定拨钟整组归金库,兑换 SLA 钟的入口页读权连带,否则唯一持有者进不去页面——
    // 金库拿到 DEMO_CLOCK_WRITE 却没有 TRADING_SWAP_READ，Swap Transactions 列表/详情本身先 403。
    'TRADING_SWAP_READ',
  ],

  TECH_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ', 'IAM_MEMBER_MANAGE', 'IAM_ROLE_ASSIGN',
    'IAM_ROLE_DEFINE', 'IAM_CREDENTIAL_RESET',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ',
    'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ', 'TRANSACTION_LIMIT_READ',
    'SUMSUB_EVENT_VIEW',
    'FUNDS_ORDER_VIEW',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
    // 战役甲波一 T9：TECH_SECURITY 族事故经办组——唯一持有人，CYBER_BCDR/OUTSOURCING_FAILURE
    // 登记/调查/定损/结案请求全靠这个组；结案裁决人是 CISO（T8），TECH_OFFICER 不是自己
    // 的裁决人，无自批死锁。
    'INCIDENT_TECH_WRITE',
  ],

  // 动钱的手 —— 唯独没有任何 *_UNFREEZE_WRITE（业主 2026-08-30 定）
  OPS_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ',
    'AUDIT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'ASSET_CONFIG_WRITE', 'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ',
    'TRANSACTION_LIMIT_READ', 'TRANSACTION_LIMIT_WRITE',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW', 'CUSTOMER_ONBOARDING_ACCEPT_WRITE', 'CUSTOMER_TIER_UPGRADE_WRITE',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'DEPOSIT_WAIVE_WRITE', 'DEPOSIT_CONFISCATE_WRITE', 'DEPOSIT_RETURN_WRITE', 'DEPOSIT_SEIZE_WRITE',
    'TRADING_WITHDRAW_WRITE', 'WITHDRAW_BOUNCE_WRITE', 'WITHDRAW_REFUND_WRITE',
    'TRADING_SWAP_WRITE', 'SWAP_REFUND_WRITE',
    // 对账平账两角色定案（2026-09-10）：业主裁定对账/平账只留金库与 CFO，运营整组清零、不
    // 拆组不双持——FUNDS_ORDER_ACT（推单）、RECON_RUN_READ / RECON_CASE_READ /
    // RECON_EXTERNAL_BALANCE_READ（对账三页只读）、INCIDENT_WRITE（事故登记）、
    // DEMO_CLOCK_WRITE（拨钟）六组整体迁往 TREASURY_OFFICER，详见该角色行内注释。本行只留
    // FUNDS_ORDER_VIEW（资金单只读，业主未点名，不动）。2026-09-19 业主补刀：INTERNAL_TRANSFER_READ
    // 同收（「他不需要知道」）——补齐两角色定案的漏网一组，剧本注③「运营只剩 Funds Orders」自此成立。
    'FUNDS_ORDER_VIEW',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
    // 战役甲波一 T9：OPERATIONS 族事故经办组——唯一持有人，ASSET_NONCOMPLIANCE/
    // STUCK_TRANSACTION_MAJOR 登记/调查/定损/结案请求全靠这个组；结案裁决人按 closeActionType
    // 分流到 CISO（TECHSEC）或 CFO（FINANCIAL），OPS_OFFICER 都不是自己的裁决人，无自批死锁。
    'INCIDENT_OPS_WRITE',
  ],
};

export const RBAC_PERMISSION_CODE_SET = new Set(
  RBAC_PERMISSION_DEFINITIONS.map((item) => item.code),
);

export function buildRolePermissionCodeMap(): Record<string, string[]> {
  const allPermissionCodes = RBAC_PERMISSION_DEFINITIONS.map((item) => item.code);

  const result: Record<string, string[]> = {};
  for (const role of RBAC_ROLE_DEFINITIONS) {
    if (role.code === 'SUPER_ADMIN') {
      result[role.code] = [...allPermissionCodes];
      continue;
    }

    const groups = RBAC_ROLE_GROUP_BINDINGS[role.code] || [];
    const codes = RBAC_PERMISSION_DEFINITIONS.filter((item) =>
      item.groups.some((group) => groups.includes(group)),
    ).map((item) => item.code);

    result[role.code] = Array.from(new Set(codes)).sort();
  }

  return result;
}

export const ACTIVE_RBAC_ROLE_CODES = RBAC_ROLE_DEFINITIONS.map((item) => item.code);
