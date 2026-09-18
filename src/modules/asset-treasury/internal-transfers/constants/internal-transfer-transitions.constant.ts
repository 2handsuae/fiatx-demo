import { InternalTransferStatus as S } from '../dto/internal-transfer.dto';

/** 六态六边（spec §3）。终态零出边；执行中不许撤回（钱已在路上）。 */
export const INTERNAL_TRANSFER_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.EXECUTING, S.FAILED, S.REJECTED, S.CANCELLED],
  [S.EXECUTING]: [S.SUCCESS, S.FAILED],
  [S.SUCCESS]: [],
  [S.FAILED]: [],
  [S.REJECTED]: [],
  [S.CANCELLED]: [],
};

/** 「未走完或已成功」——同一来源上再开一张时要查的集合（出生守卫②）。失败 / 拒绝 / 撤回后可重发。 */
export const INTERNAL_TRANSFER_BLOCKING_STATUSES: readonly string[] = [S.PENDING_APPROVAL, S.EXECUTING, S.SUCCESS];
