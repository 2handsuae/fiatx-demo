// admin-web/src/utils/houseTransferStatusMap.ts
// 戊波二 T6：公司调拨单的状态 / 用途 / 失败原因 → 员工可见文案。唯一真相在后端
// src/modules/asset-treasury/company-funding/dto/house-transfer.dto.ts（HouseTransferStatus 六态、
// HOUSE_TRANSFER_PURPOSES、failureReasonCode 三值），这里只是展示词；色板与 StatusPill 的 Tailwind 100/800 同源。
//
// 「卡住」不是第七个状态：落账（码 89 / 90）被账本拒时，单停在 EXECUTING、不迁状态，只在行上盖
// failureReasonCode = POSTING_FAILED（T5：不重试、不补偿）。员工要看到的是「卡住了」而不是「还在执行」，
// 所以展示层用 (status, failureReasonCode) 两个值判，不能只看 status。

export interface HouseTransferStatusMeta {
  label: string;
  badgeClass: string;
}

export const HOUSE_TRANSFER_STATUS_META: Record<string, HouseTransferStatusMeta> = {
  PENDING_APPROVAL: { label: 'Pending CFO review', badgeClass: 'bg-amber-100 text-amber-800' },
  EXECUTING: { label: 'Executing · funds in transit', badgeClass: 'bg-blue-100 text-blue-800' },
  SUCCESS: { label: 'Completed', badgeClass: 'bg-green-100 text-green-800' },
  FAILED: { label: 'Failed', badgeClass: 'bg-orange-100 text-orange-800' },
  REJECTED: { label: 'Rejected', badgeClass: 'bg-red-100 text-red-800' },
  CANCELLED: { label: 'Cancelled', badgeClass: 'bg-gray-200 text-gray-800' },
};

/** 落账失败的展示态：停在 EXECUTING，且行上盖了 POSTING_FAILED。 */
export const isHouseTransferStuck = (
  status: string | null | undefined,
  failureReasonCode: string | null | undefined,
): boolean => status === 'EXECUTING' && failureReasonCode === 'POSTING_FAILED';

export const houseTransferStatusMeta = (
  status: string | null | undefined,
  failureReasonCode?: string | null,
): HouseTransferStatusMeta => {
  if (!status) return { label: '—', badgeClass: 'bg-gray-100 text-gray-800' };
  if (isHouseTransferStuck(status, failureReasonCode)) {
    return { label: 'Stuck — posting failed', badgeClass: 'bg-red-100 text-red-800' };
  }
  return HOUSE_TRANSFER_STATUS_META[status] ?? { label: status, badgeClass: 'bg-gray-100 text-gray-800' };
};

export const HOUSE_TRANSFER_PURPOSE_LABEL: Record<string, string> = {
  FEE_SWEEP: 'Fee sweep',
};

export const HOUSE_TRANSFER_FAILURE_LABEL: Record<string, string> = {
  INSUFFICIENT_FIRM_BALANCE: 'Insufficient balance at approval',
  LEG_FAILED: 'Transfer leg failed',
  POSTING_FAILED: 'Ledger posting failed',
};

/** 扫费路线：手续费户 → 运营户。只有这条路在挪钱（码 89）之后还要把已扫走的手续费收入结转进公司权益（码 90）。 */
export const isFeeSweepRoute = (fromVaultCode: string | null | undefined, toVaultCode: string | null | undefined): boolean =>
  fromVaultCode === 'F_FEE' && toVaultCode === 'F_OPS';
