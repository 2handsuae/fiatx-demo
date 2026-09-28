import { LpExchangeStatus as S } from '../dto/lp-exchange.dto';

/** 八态八边（乙波一 spec §3.2，原样落）。DELIVERED 必经——验收（核数）只能从「已到货」
 *  批准，AWAITING_DELIVERY 不能直接跳 SUCCESS。四个终态零出边。 */
export const LP_EXCHANGE_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.EXECUTING, S.FAILED, S.REJECTED, S.CANCELLED],
  [S.EXECUTING]: [S.AWAITING_DELIVERY, S.FAILED],
  [S.AWAITING_DELIVERY]: [S.DELIVERED],
  [S.DELIVERED]: [S.SUCCESS],
  [S.SUCCESS]: [],
  [S.FAILED]: [],
  [S.REJECTED]: [],
  [S.CANCELLED]: [],
};
