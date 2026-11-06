import { HouseTransferStatus as S } from '../dto/house-transfer.dto';

/** 六态六边（戊波二 spec §4.2，抄划转单原样）。终态零出边；执行中不许撤回（钱已在路上）。
 *  批准即复核 from 余额：不足落 FAILED 零资金单（照划转 / 付款单先例）。 */
export const HOUSE_TRANSFER_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.EXECUTING, S.FAILED, S.REJECTED, S.CANCELLED],
  [S.EXECUTING]: [S.SUCCESS, S.FAILED],
  [S.SUCCESS]: [],
  [S.FAILED]: [],
  [S.REJECTED]: [],
  [S.CANCELLED]: [],
};
