import { CapitalInjectionStatus as S } from '../dto/capital-injection.dto';
/** 六态五边（乙波二 spec §2.2）。RECEIVED 必经——确认入账（核数）只能从「已到款」走，
 *  AWAITING_FUNDS 不能直接跳 SUCCESS。无 FAILED 态：进项 ⚡到款在演示里不会失败，审批过期归 REJECTED。 */
export const CAPITAL_INJECTION_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.AWAITING_FUNDS, S.REJECTED, S.CANCELLED],
  [S.AWAITING_FUNDS]: [S.RECEIVED],
  [S.RECEIVED]: [S.SUCCESS],
  [S.SUCCESS]: [], [S.REJECTED]: [], [S.CANCELLED]: [],
};
