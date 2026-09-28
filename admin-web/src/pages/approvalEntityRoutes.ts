/* ── Entity Ref回链 ──────────────────────────────────────────────
   按 actionType 把 entityRef（业务号，Task 19-21 后全域已切换）映射到对应
   详情/列表路由。逐条核对现状路由参数得出（App.tsx + 各消费端 controller/
   service 实证，非直接照抄 brief 草案）：
   - 资产/限额/费率创建：详情路由已按业务号收参（assetNo/ruleNo/levelCode）。
   - 交易域（deposit/withdraw/swap）详情路由已换业务号（波五 Task 9）：7 条
     deposit/withdraw entityRef 逐类型核对写入方（deposit-workflow.service.ts /
     withdraw-workflow.service.ts 的 entityRef: deposit.depositNo / w.withdrawNo）
     确认存的就是业务单号，全部直达详情页。
   - 治理域仍有 2 类（审批策略变更/证据包导出）entityRef 虽已是业务号
     （requestNo/packageNo），但其唯一详情端点仍按内部 UUID 查询
     （ParseUUIDPipe 或 where:{id}），映射会 404——不硬造，留纯文本。角色
     绑定变更详情端点已在 Task 25 改按 requestNo 查询，角色定义修改详情端点
     已在 Task 26 同样改按 requestNo 查询，映射均已补（见下）。
   - 费率变更（*_FEE_LEVEL_CHANGE）entityRef 是变更请求 requestNo 而非
     levelCode，无可寻址详情页——同样留纯文本。
   映射缺席 = Field 保持纯文本展示（原状）。 */
export const ENTITY_ROUTE_BY_ACTION: Record<string, (ref: string) => string | null> = {
  // 交易域——详情路由已换业务号（波五 Task 9），直达详情页
  WITHDRAW_LARGE_VALUE_APPROVAL: (r) => `/admin/trading/withdrawals/${r}`,
  WITHDRAW_UNFREEZE: (r) => `/admin/trading/withdrawals/${r}`,
  WITHDRAW_SANCTION_REFUND: (r) => `/admin/trading/withdrawals/${r}`,
  DEPOSIT_CONFISCATION: (r) => `/admin/trading/deposits/${r}`,
  DEPOSIT_RETURN: (r) => `/admin/trading/deposits/${r}`,
  DEPOSIT_SEIZE: (r) => `/admin/trading/deposits/${r}`,
  DEPOSIT_UNFREEZE: (r) => `/admin/trading/deposits/${r}`,
  SWAP_UNFREEZE: (r) => `/admin/trading/swaps/${r}`,
  SWAP_SANCTION_REFUND: (r) => `/admin/trading/swaps/${r}`,
  // 资产域（entityRef = assetNo / ruleNo）
  ASSET_SUSPENSION: (r) => `/admin/assets/${r}`,
  ASSET_REACTIVATION: (r) => `/admin/assets/${r}`,
  TRANSACTION_LIMIT_CHANGE: (r) => `/admin/assets/transaction-limits/${r}`,
  // 定价域——创建流、退役流 entityRef 是 levelCode；变更流是变更请求 requestNo，不映射
  SWAP_FEE_LEVEL_CREATION: (r) => `/admin/pricing/swap-fee-levels/${r}`,
  WITHDRAWAL_FEE_LEVEL_CREATION: (r) => `/admin/pricing/withdrawal-fee-levels/${r}`,
  SWAP_FEE_LEVEL_RETIRE: (r) => `/admin/pricing/swap-fee-levels/${r}`,
  WITHDRAWAL_FEE_LEVEL_RETIRE: (r) => `/admin/pricing/withdrawal-fee-levels/${r}`,
  // 治理域（entityRef = userNo / role.code，Task 19-21 后新增业务号）
  ADMIN_INVITE_APPROVAL: (r) => `/admin/iam/members/${r}`,
  ADMIN_SUSPENSION_APPROVAL: (r) => `/admin/iam/members/${r}`,
  ADMIN_REACTIVATION_APPROVAL: (r) => `/admin/iam/members/${r}`,
  ADMIN_PASSWORD_RESET: (r) => `/admin/iam/members/${r}`,
  ADMIN_MFA_RESET: (r) => `/admin/iam/members/${r}`,
  ROLE_DEFINITION_CREATE: (r) => `/admin/iam/roles/${r}`,
  ADMIN_ROLE_BINDING_CHANGE_APPROVAL: (r) => `/admin/iam/role-change-requests/${r}`,
  ROLE_DEFINITION_MODIFY: (r) => `/admin/iam/role-definition-modify-requests/${r}`,
  // 对账域（entityRef = adjustmentNo）
  RECON_ADJUSTMENT_POST: (r) => `/admin/reconciliation/adjustments/${r}`,
  // 平账二期（entityRef = transferNo）
  INTERNAL_TRANSFER_APPROVAL: (r) => `/admin/custody/internal-transfers/${r}`,
  // 平账三期（entityRef = incidentNo）：结案拆两个动作类型，都指向同一事故详情路由
  INCIDENT_CLOSE_SECURITY: (r) => `/admin/governance/incidents/${r}`,
  INCIDENT_CLOSE_FINANCIAL: (r) => `/admin/governance/incidents/${r}`,
  // 战役甲波一 Task 8（结案四链）：新两条动作类型同样指向事故详情路由
  INCIDENT_CLOSE_TECHSEC: (r) => `/admin/governance/incidents/${r}`,
  INCIDENT_CLOSE_PRUDENTIAL: (r) => `/admin/governance/incidents/${r}`,
  // 客户域（entityRef = customerNo）
  CUSTOMER_ONBOARDING_ACCEPTANCE: (r) => `/admin/customers/${r}`,
  CUSTOMER_TIER_UPGRADE: (r) => `/admin/customers/${r}`,
  // 战役甲波三 T4修（评审黄4）：制裁定性提单——entityRef = customerNo，裁决人（MLRO）
  // 批完从审批详情页回链到客户详情页看限制区/定性历史。
  SANCTION_DISPOSITION: (r) => `/admin/customers/${r}`,
  // 战役甲波二（entityRef = filingNo）：报送签发，详情路由 Task 9 落地。
  REG_FILING_SUBMIT: (r) => `/admin/governance/regulatory-filings/${r}`,
  // 战役甲波五 Task 9（承接项E，T6 评审裁定并入）：投诉裁决（entityRef = complaintNo，
  // complaint-resolution-workflow.service.ts propose() 逐字确认）指向投诉详情页；客户族
  // 结案（entityRef = incidentNo，同既有四条 INCIDENT_CLOSE_* 惯例）指向既有事故详情路由。
  COMPLAINT_RESOLUTION: (r) => `/admin/governance/complaints/${r}`,
  INCIDENT_CLOSE_CUSTOMER: (r) => `/admin/governance/incidents/${r}`,
};
