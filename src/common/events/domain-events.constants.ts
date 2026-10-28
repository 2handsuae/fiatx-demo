/**
 * Internal Domain Events Registry
 *
 * Rules:
 * - All internal domain events must be declared here before use
 * - Emitters: Domain Services or Ingestion/Adapter layers only
 * - Subscribers: Workflow Services only
 */
export const DOMAIN_EVENTS = {
  // ── Deposit ──
  DEPOSIT_STATUS_CHANGED: {
    name: 'deposit.status.changed',
    emitter: 'DepositTransactionsService',
    subscribers: ['DepositWorkflowService'],
    payload: '{ depositId: string, oldStatus: string, newStatus: string, ownerType: string, ownerId: string, assetId: string, amount: string, payinId?: string }',
  },

  // ── Withdrawal ──
  WITHDRAWAL_CREATED: {
    name: 'withdrawal.created',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['WithdrawWorkflowService'],
    payload: '{ withdrawId: string, withdrawNo: string, status: string, ownerType: string, ownerId: string, assetId: string, amount: string, traceId: string }',
  },
  // 2026-08-17 修：此前这条注册表条目是空文档——事件全仓零 emit 点，下面这份
  // payload 描述从未被满足过。现由 WithdrawTransactionsService#updateStatus 补发，
  // 字段形状对齐 SWAP_STATUS_CHANGED（三域对称），故与旧文档不同。
  WITHDRAWAL_STATUS_CHANGED: {
    name: 'withdrawal.status.changed',
    emitter: 'WithdrawTransactionsService',
    subscribers: ['MaterialRequestOrderCancelListener'],
    payload: '{ withdrawId: string, withdrawNo: string, ownerId: string, previousStatus: string, status: string, traceId: string | null }',
  },
  // ── Funds Order (unified — Round 2) ──
  FUNDS_ORDER_STATUS_CHANGED: {
    name: 'funds_order.status.changed',
    emitter: 'FundsOrderService',
    subscribers: ['DepositWorkflowService', 'WithdrawWorkflowService', 'SwapWorkflowService', 'InternalTransferWorkflowService'],
    payload:
      '{ fundsOrderId, fundsOrderNo, parent: {depositTransactionId?, withdrawTransactionId?, swapTransactionId?, internalTransferId?}, legSeq, attempt, oldStatus, newStatus, traceId? }',
  },

  // ── Customer Restriction (2026-08-16) ──
  // 只在「卡住全部能力」的便签落库时发（scope=ALL：制裁 / 行政暂停）。
  // scope < ALL 的便签（材料过期等）刻意不发 —— 设计稿 §3.5：材料过期不该把
  // 已经在路上的提现拽回来。
  CUSTOMER_RESTRICTION_OPENED: {
    name: 'customer.restriction.opened',
    emitter: 'CustomerRestrictionsService',
    subscribers: ['DepositWorkflowService', 'WithdrawWorkflowService', 'SwapWorkflowService'],
    payload:
      '{ customerId: string, restrictionNo: string, cause: string, blocksAllCapabilities: true, traceId: string }',
  },

  // ── Material Request (2026-08-17) ──
  MATERIAL_REQUEST_REVIEWED: {
    name: 'material-request.reviewed',
    description:
      '一次材料下发拿到了 Sumsub 复核结果。订单域据此推进自己的合规闸门 —— ' +
      '材料账只广播事实，不替订单域做状态决定。',
  },

  // ── Swap (2026-08-17) ──
  SWAP_STATUS_CHANGED: {
    name: 'swap.status.changed',
    description:
      '兑换单状态变更。补于 2026-08-17 —— 此前三域只有充值/提现有单据级状态事件，' +
      '兑换只有资金单粒度的 FUNDS_ORDER_STATUS_CHANGED，材料账的作废监听器接不上。',
  },

  // ── Admin Login Lockout（审计上收 Task 9，2026-08-26）──
  // auth.service.ts#validateUser 在本地判定"连续失败达阈值"后 emit，不直接写审计——
  // 审计要写 actor/旅程/权限依据等编排层才拿得到的信息，实体层不该攒这些参数。
  // 由 MfaBindingWorkflowService 接住写 ADMIN_ACCOUNT_LOCK_APPLIED（Task 7 已实装该码）。
  ADMIN_LOGIN_CONSECUTIVE_FAILURE: {
    name: 'admin.login.consecutive_failure',
    emitter: 'AuthService',
    subscribers: ['MfaBindingWorkflowService'],
    payload: '{ userId: string, userNo: string, failedLoginAttempts: number }',
  },

  // auth.service.ts#validateUser 在本地判定"锁定已到期"后 emit，同 CONSECUTIVE_FAILURE
  // 一样不直接写审计——由 MfaBindingWorkflowService（已经接住同一把锁的 APPLIED 事件）
  // 接住写 ADMIN_ACCOUNT_LOCK_RELEASED（法一附属修缮，2026-09-01）。
  ADMIN_LOGIN_AUTO_UNLOCKED: {
    name: 'admin.login.auto_unlocked',
    emitter: 'AuthService',
    subscribers: ['MfaBindingWorkflowService'],
    payload: '{ userId: string, userNo: string }',
  },

  // ── Sanction Disposition（战役甲波三 T4，2026-09-26）──
  // ApprovalHandlerBase 派生的二级事件（SANCTION_DISPOSITION 审批裁决后）。既有的
  // CUSTOMER_RESTRICTION_RELEASE_*/REGULATORY_FILING 的 decided 事件此前都没登记本表
  // （本表历来只收「域服务/接入层直发」的一手事件）——checklist 复核 2026-09-26 起，
  // 制裁定性这条横跨限制便签+报送两个主体的落地事件先例性地补登，供后续同类审计。
  SANCTION_DISPOSITION_DECIDED: {
    name: 'workflow.sanction-disposition.decided',
    emitter: 'SanctionDispositionApprovalService',
    subscribers: ['SanctionDispositionWorkflowService'],
    payload:
      'ApprovalDecidedEvent — { decision, actionType, entityRef(customerNo), approvalNo, ' +
      'decisionByUserId, decisionByUserNo, decisionByRole, decisionReason, traceId }',
  },

  // ── RI Replacement（战役甲波四 T5，2026-09-27）──
  // ApprovalHandlerBase 派生的二级事件（RI_REPLACEMENT 审批裁决后）——workflowType 复用
  // AuditBusinessWorkflowTypes.RESPONSIBLE_INDIVIDUAL（T4 已登记），派生事件名照
  // buildSecondaryEventName 的 kebab 规则算出 'workflow.responsible-individual.decided'。
  RI_REPLACEMENT_DECIDED: {
    name: 'workflow.responsible-individual.decided',
    emitter: 'RiReplacementApprovalService',
    subscribers: ['RiReplacementWorkflowService'],
    payload:
      'ApprovalDecidedEvent — { decision, actionType, entityRef(riNo), approvalNo, ' +
      'decisionByUserId, decisionByUserNo, decisionByRole, decisionReason, traceId }',
  },

  // ── Complaint Resolution（战役甲波五 T3，2026-09-28）──
  // ApprovalHandlerBase 派生的二级事件（COMPLAINT_RESOLUTION 审批裁决后）——workflowType
  // 复用 AuditBusinessWorkflowTypes.COMPLAINT（T2 已登记），派生事件名照
  // buildSecondaryEventName 的 kebab 规则算出 'workflow.complaint.decided'。登记先于使用
  // （本表规则）：派生该事件的 ApprovalHandlerBase 子类（ComplaintResolutionApprovalService）
  // 尚未创建——T3 只落常量/事件键/workflow 消费端，handler 子类与 complaints.module.ts
  // 挂载留给后续任务（module 尚不存在，创建无处注册的 handler 会是孤儿 provider）。
  COMPLAINT_RESOLUTION_DECIDED: {
    name: 'workflow.complaint.decided',
    emitter: 'ComplaintResolutionApprovalService',
    subscribers: ['ComplaintResolutionWorkflowService'],
    payload:
      'ApprovalDecidedEvent — { decision, actionType, entityRef(complaintNo), approvalNo, ' +
      'decisionByUserId, decisionByUserNo, decisionByRole, decisionReason, traceId }',
  },

  // ── Agreement Publish（战役丙波三 T3，2026-10-03）──
  // ApprovalHandlerBase 派生的二级事件（AGREEMENT_PUBLISH 审批裁决后）——workflowType 复用
  // AuditBusinessWorkflowTypes.CUSTOMER_AGREEMENT（T2 已登记），派生事件名照
  // buildSecondaryEventName 的 kebab 规则算出 'workflow.customer-agreement.decided'。
  AGREEMENT_PUBLISH_DECIDED: {
    name: 'workflow.customer-agreement.decided',
    emitter: 'AgreementPublishApprovalService',
    subscribers: ['AgreementPublishWorkflowService'],
    payload:
      'ApprovalDecidedEvent — { decision, actionType, entityRef(versionKey), approvalNo, ' +
      'decisionByUserId, decisionByUserNo, decisionByRole, decisionReason, decidedAt, traceId }',
  },

  // ── LP Profile / Outsourcing Vendor 准入裁决（甲波六 T1，2026-10-29）──
  // ApprovalHandlerBase 派生的二级事件——workflowType 复用 AuditBusinessWorkflowTypes.LP_PROFILE /
  // OUTSOURCING_VENDOR（均早已登记），派生事件名照 buildSecondaryEventName 的 kebab 规则算出
  // 'workflow.lp-profile.decided' / 'workflow.outsourcing-vendor.decided'。同一 workflowType 下多条
  // 审批策略各挂一个 handler 类（LP：LP_PROFILE_APPROVAL 单步 + LP_PROFILE_HIGH_RISK_APPROVAL 两步；
  // 服务商：VENDOR_APPROVAL + VENDOR_MATERIAL_APPROVAL），handler 以 actionType 区分各自的单，
  // 事件名相同，由 workflow 服务按 payload.actionType 分流。handler 类与 workflow 消费端由 T4 / T6 创建。
  LP_PROFILE_DECIDED: {
    name: 'workflow.lp-profile.decided',
    emitter: 'LpProfileApprovalService / LpProfileHighRiskApprovalService',
    subscribers: ['LpProfileWorkflowService'],
    payload:
      'ApprovalDecidedEvent — { decision, actionType, entityRef(lpNo), approvalNo, ' +
      'decisionByUserId, decisionByUserNo, decisionByRole, decisionReason, decidedAt, traceId }',
  },
  OUTSOURCING_VENDOR_DECIDED: {
    name: 'workflow.outsourcing-vendor.decided',
    emitter: 'OutsourcingVendorApprovalService / OutsourcingVendorMaterialApprovalService',
    subscribers: ['OutsourcingVendorWorkflowService'],
    payload:
      'ApprovalDecidedEvent — { decision, actionType, entityRef(vendorNo), approvalNo, ' +
      'decisionByUserId, decisionByUserNo, decisionByRole, decisionReason, decidedAt, traceId }',
  },

  // ── Regulatory Filing 标记已提交（甲波六 T1，2026-10-29）──
  // 一手域事件（非审批派生）：报送台把一张报送单标记为已提交（SUBMITTED，带监管回执 externalRef）后，
  // 由 RegulatoryFilingService 发出；服务商准入流程里 MATERIAL 的「VARA 事前报备」告知单（T6 自动开出）
  // 靠它回头把服务商 PENDING_FILING 推进到 ACTIVE。跨主体协作只发生在 workflow，故订阅方是
  // OutsourcingVendorWorkflowService，而不是报送台自己调服务商服务。
  REGULATORY_FILING_SUBMITTED: {
    name: 'regulatory-filing.submitted',
    emitter: 'RegulatoryFilingService',
    subscribers: ['OutsourcingVendorWorkflowService'],
    payload: '{ filingNo: string, type: string, externalRef: string }',
  },
} as const;

/** Type-safe event name accessor */
export const DomainEventNames = {
  // Deposit
  DEPOSIT_STATUS_CHANGED: DOMAIN_EVENTS.DEPOSIT_STATUS_CHANGED.name,
  // Withdrawal
  WITHDRAWAL_CREATED: DOMAIN_EVENTS.WITHDRAWAL_CREATED.name,
  WITHDRAWAL_STATUS_CHANGED: DOMAIN_EVENTS.WITHDRAWAL_STATUS_CHANGED.name,
  // Funds Order (unified — Round 2)
  FUNDS_ORDER_STATUS_CHANGED: DOMAIN_EVENTS.FUNDS_ORDER_STATUS_CHANGED.name,
  // Customer Restriction
  CUSTOMER_RESTRICTION_OPENED: DOMAIN_EVENTS.CUSTOMER_RESTRICTION_OPENED.name,
  // Material Request
  MATERIAL_REQUEST_REVIEWED: DOMAIN_EVENTS.MATERIAL_REQUEST_REVIEWED.name,
  // Swap
  SWAP_STATUS_CHANGED: DOMAIN_EVENTS.SWAP_STATUS_CHANGED.name,
  // Admin Login Lockout
  ADMIN_LOGIN_CONSECUTIVE_FAILURE: DOMAIN_EVENTS.ADMIN_LOGIN_CONSECUTIVE_FAILURE.name,
  ADMIN_LOGIN_AUTO_UNLOCKED: DOMAIN_EVENTS.ADMIN_LOGIN_AUTO_UNLOCKED.name,
  // Sanction Disposition
  SANCTION_DISPOSITION_DECIDED: DOMAIN_EVENTS.SANCTION_DISPOSITION_DECIDED.name,
  // RI Replacement
  RI_REPLACEMENT_DECIDED: DOMAIN_EVENTS.RI_REPLACEMENT_DECIDED.name,
  // Complaint Resolution
  COMPLAINT_RESOLUTION_DECIDED: DOMAIN_EVENTS.COMPLAINT_RESOLUTION_DECIDED.name,
  // Agreement Publish
  AGREEMENT_PUBLISH_DECIDED: DOMAIN_EVENTS.AGREEMENT_PUBLISH_DECIDED.name,
  // LP Profile / Outsourcing Vendor 准入裁决 + 报送单标记已提交
  LP_PROFILE_DECIDED: DOMAIN_EVENTS.LP_PROFILE_DECIDED.name,
  OUTSOURCING_VENDOR_DECIDED: DOMAIN_EVENTS.OUTSOURCING_VENDOR_DECIDED.name,
  REGULATORY_FILING_SUBMITTED: DOMAIN_EVENTS.REGULATORY_FILING_SUBMITTED.name,
} as const;
