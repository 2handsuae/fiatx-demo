import { LpProfileStatus as S } from '../dto/lp-profile.dto';

/** 四态四边（乙波一 spec §2.2）。结算坐标已不在档案上——LP 两步准入起搬进打款地址簿 LpPayoutAddress（自有六态迁移表）。
 *  建档背调 RED 的 REJECTED 是建档时的落点计算，不是本表的边。 */
export const LP_PROFILE_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.ACTIVE, S.REJECTED],
  [S.ACTIVE]: [S.SUSPENDED],
  [S.SUSPENDED]: [S.ACTIVE],
  [S.REJECTED]: [],
};
