import { LpProfileStatus as S } from '../dto/lp-profile.dto';

/** 六态九边（乙波一 spec §2.2 的四态四边 + 甲波六 spec §4.4 的五条新边）。结算坐标已不在档案上——LP 两步准入起搬进
 *  打款地址簿 LpPayoutAddress（自有六态迁移表）。
 *  先评估后审批：PENDING_ASSESSMENT 由合规官下结论走出三条边（退回 / 不通过 / 送审）；RETURNED 只有金库「重新提交」
 *  一条出路；送审后的 PENDING_APPROVAL 批准 → ACTIVE、驳回（含超时）→ REJECTED、撤单 → 回 PENDING_ASSESSMENT 重新评估。
 *  不再有「登记即拒」的落点计算——实体背调 mock 已退役，REJECTED 只由合规官不通过或审批驳回走边到达。 */
export const LP_PROFILE_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_ASSESSMENT]: [S.RETURNED, S.REJECTED, S.PENDING_APPROVAL],
  [S.RETURNED]: [S.PENDING_ASSESSMENT],
  [S.PENDING_APPROVAL]: [S.ACTIVE, S.REJECTED, S.PENDING_ASSESSMENT],
  [S.ACTIVE]: [S.SUSPENDED],
  [S.SUSPENDED]: [S.ACTIVE],
  [S.REJECTED]: [],
};
