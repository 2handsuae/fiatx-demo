import { LpProfileStatus as S } from '../dto/lp-profile.dto';

/** 四态四边（乙波一 spec §2.2）。改结算坐标是动作不是状态，ACTIVE 期间走审批落地。 */
export const LP_PROFILE_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.ACTIVE, S.REJECTED],
  [S.ACTIVE]: [S.SUSPENDED],
  [S.SUSPENDED]: [S.ACTIVE],
  [S.REJECTED]: [],
};
