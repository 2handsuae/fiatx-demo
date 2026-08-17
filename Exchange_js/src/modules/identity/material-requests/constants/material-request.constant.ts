import { BadRequestException } from '@nestjs/common';

/**
 * 材料请求账的状态机 —— 一行 = 一次下发。
 *
 * 设计稿：doc-final/superpowers/specs/2026-08-17-material-request-ledger-design.md §2.2
 *
 * 关键的一条：RED 分 RETRY 和 FINAL 两种，这是 Sumsub 的真实语义。
 * RETRY = 交的东西不合格，用**同一个 action** 重交 —— 所以它回到 PENDING_SUBMISSION，
 * applicantActionId / externalActionId / 认证链接全部不变，不是新开一行。
 * 树上三条旧路对此互不一致（swap 与 material-refresh 把任何 RED 都当 RETRY，
 * 运营无法关单；只有 onboarding.service.ts:236 分了），本表以 onboarding 为准。
 */
export type MaterialRequestStatus =
  | 'PENDING_SUBMISSION' // 已下发，等客户交
  | 'SUBMITTED' // 客户交了，等裁决
  | 'APPROVED' // 审过了（终态）
  | 'REJECTED' // RED + FINAL（终态）
  | 'CANCELLED'; // 绑的单进终态且没挂限制（终态）

export type MaterialRequestAction =
  | 'SUBMIT'
  | 'REVIEW_GREEN'
  | 'REVIEW_RED_RETRY'
  | 'REVIEW_RED_FINAL'
  | 'CANCEL';

export type MaterialRequestOrigin =
  | 'SUMSUB_PUSHED' // Sumsub 先建 action，webhook 推来
  | 'OPERATOR_ISSUED' // 运营在后台手工下发
  | 'SYSTEM_SCHEDULED'; // 到期 cron + 进件首次收集

export type MaterialRequestOrderDomain = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

export const MATERIAL_REQUEST_TRANSITIONS: Record<
  MaterialRequestStatus,
  Partial<Record<MaterialRequestAction, MaterialRequestStatus>>
> = {
  PENDING_SUBMISSION: {
    SUBMIT: 'SUBMITTED',
    CANCEL: 'CANCELLED',
  },
  SUBMITTED: {
    REVIEW_GREEN: 'APPROVED',
    // 同一个 action 重交 —— 回起点，不是新状态、更不是新行
    REVIEW_RED_RETRY: 'PENDING_SUBMISSION',
    REVIEW_RED_FINAL: 'REJECTED',
    CANCEL: 'CANCELLED',
  },
  APPROVED: {},
  REJECTED: {},
  CANCELLED: {},
};

/** 活行 = 客户还欠着这份材料。展示规则（spec §3）一律以这个集合过滤。 */
export const MATERIAL_REQUEST_LIVE_STATUSES = [
  'PENDING_SUBMISSION',
  'SUBMITTED',
] as const satisfies readonly MaterialRequestStatus[];

export const MATERIAL_REQUEST_TERMINAL: ReadonlySet<MaterialRequestStatus> =
  new Set<MaterialRequestStatus>(['APPROVED', 'REJECTED', 'CANCELLED']);

/**
 * G4 / spec I1：下发时只允许挂这两个 cause。
 * SANCTION / KYT_REJECTED_HARD 是 SILENT —— 给客户一个能点进去的认证入口，
 * 等于告诉他「你因为某个我们不能说的原因被卡住了」，那是 tipping-off。
 */
export const ISSUABLE_RESTRICTION_CAUSES = [
  'PENDING_DOCUMENT',
  'MATERIAL_EXPIRED',
  // 兑换域软线拒用的就是这个 cause（swap-workflow.service.ts:846），它是 DISCLOSED，
  // 挂材料请求安全。漏了它，Task 10 的兑换迁移会被自己的守卫拦死。
  'KYT_REJECTED_SOFT',
] as const;

export type IssuableRestrictionCause = (typeof ISSUABLE_RESTRICTION_CAUSES)[number];

/** 转移表的唯一执行入口。非法边一律抛，不返回 null、不静默留在原态。 */
export function nextMaterialRequestStatus(
  from: MaterialRequestStatus,
  action: MaterialRequestAction,
): MaterialRequestStatus {
  const to = MATERIAL_REQUEST_TRANSITIONS[from][action];
  if (!to) {
    throw new BadRequestException(
      `Invalid material request action ${action} from ${from}`,
    );
  }
  return to;
}
