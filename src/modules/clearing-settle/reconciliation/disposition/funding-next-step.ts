// 平账二期（spec §7.2 / §7.3）：案件行上的「垫款」下一步 + 划转单回链——纯函数，读面喂事实。
// 戊波二 T7a：「补款（COMPENSATION）」下一步退役——客户池认损改走一张单的认损补缺（nextStep.kind 'SHORTFALL_TOPUP'，
// 由读面按行事实算，见 reconciliation-query.service.ts annotateRow），不再有「认损调账单落账后再补款」那一步。
// 本函数只剩垫款（置灰入口，代码原样留着）；`transfer` 回链保留，认损补缺单的单号 / 状态 / 是否已记短缺也走它。
interface FundingTransferRef { transferNo: string; purpose: string; status: string; recognized: boolean }
interface FundingFacts {
  book: 'CLIENT' | 'FIRM';
  customerNo: string | null; walletNo: string | null;
  transfer?: FundingTransferRef | null;
  bounce?: { externalLineId: string; lineAmountMinor: bigint; availableMinor: bigint; supplementNo: string | null } | null;
}
type FundingNextStep =
  | { kind: 'ADVANCE'; amount: string; externalLineId: string; customerNo: string | null; walletNo: string | null; available: string; lineAmount: string };

const TERMINAL_FAIL = new Set(['FAILED', 'REJECTED', 'CANCELLED']);

export function deriveFundingNextStep(f: FundingFacts): { nextStep?: FundingNextStep; transfer?: FundingTransferRef } {
  const out: { nextStep?: FundingNextStep; transfer?: FundingTransferRef } = {};
  if (f.transfer) out.transfer = { transferNo: f.transfer.transferNo, purpose: f.transfer.purpose, status: f.transfer.status, recognized: f.transfer.recognized };
  const noLiveTransfer = !f.transfer || TERMINAL_FAIL.has(f.transfer.status);
  if (f.book !== 'CLIENT') return out;
  if (f.bounce && !f.bounce.supplementNo && noLiveTransfer) {
    const shortfall = f.bounce.lineAmountMinor - f.bounce.availableMinor;
    if (shortfall > 0n) {
      out.nextStep = { kind: 'ADVANCE', amount: shortfall.toString(), externalLineId: f.bounce.externalLineId, customerNo: f.customerNo, walletNo: f.walletNo, available: f.bounce.availableMinor.toString(), lineAmount: f.bounce.lineAmountMinor.toString() };
    }
  }
  return out;
}
