/* ── Entity Ref回链 ──────────────────────────────────────────────
   按 actionType 把 entityRef（业务号，Task 19-21 后全域已切换）映射到对应
   详情/列表路由。逐条核对现状路由参数得出（App.tsx + 各消费端 controller/
   service 实证，非直接照抄 brief 草案）：
   - 资产/限额/费率创建：详情路由已按业务号收参（assetNo/ruleNo/levelCode）。
   - 交易域（deposit/withdraw）详情路由仍是内部 id，用列表页 + keyword 定位；
     当前 3 张列表页尚未消费该 query 参数（未读 location.search），故此链接
     落地到正确页面但不会自动预填筛选框——超出本任务声明的文件范围，未跟着改。
   - 治理域仍有 2 类（审批策略变更/证据包导出）entityRef 虽已是业务号
     （requestNo/packageNo），但其唯一详情端点仍按内部 UUID 查询
     （ParseUUIDPipe 或 where:{id}），映射会 404——不硬造，留纯文本。角色
     绑定变更详情端点已在 Task 25 改按 requestNo 查询，角色定义修改详情端点
     已在 Task 26 同样改按 requestNo 查询，映射均已补（见下）。
   - 费率变更（*_FEE_LEVEL_CHANGE）entityRef 是变更请求 requestNo 而非
     levelCode，无可寻址详情页——同样留纯文本。
   映射缺席 = Field 保持纯文本展示（原状）。 */
export const ENTITY_ROUTE_BY_ACTION: Record<string, (ref: string) => string | null> = {
  // 交易域——详情路由参数以现状为准（内部 id），列表页 + keyword 定位已足够演示
  WITHDRAW_LARGE_VALUE_APPROVAL: (r) => `/admin/trading/withdrawals?keyword=${r}`,
  WITHDRAW_UNFREEZE: (r) => `/admin/trading/withdrawals?keyword=${r}`,
  WITHDRAW_SANCTION_REFUND: (r) => `/admin/trading/withdrawals?keyword=${r}`,
  DEPOSIT_CONFISCATION: (r) => `/admin/trading/deposits?keyword=${r}`,
  DEPOSIT_RETURN: (r) => `/admin/trading/deposits?keyword=${r}`,
  DEPOSIT_SEIZE: (r) => `/admin/trading/deposits?keyword=${r}`,
  DEPOSIT_UNFREEZE: (r) => `/admin/trading/deposits?keyword=${r}`,
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
  INTERNAL_TRANSFER_APPROVAL: (r) => `/admin/treasury/internal-transfers/${r}`,
  // 平账三期（entityRef = incidentNo）：结案拆两个动作类型，都指向同一事故详情路由
  INCIDENT_CLOSE_SECURITY: (r) => `/admin/governance/incidents/${r}`,
  INCIDENT_CLOSE_FINANCIAL: (r) => `/admin/governance/incidents/${r}`,
  // 客户域（entityRef = customerNo）
  CUSTOMER_ONBOARDING_ACCEPTANCE: (r) => `/admin/customers/${r}`,
};
