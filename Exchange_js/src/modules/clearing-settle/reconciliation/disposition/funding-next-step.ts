// 平账二期（spec §7.2 / §7.3）：案件行上的「补款 / 垫款」下一步——纯函数，读面喂事实。
export interface FundingTransferRef { transferNo: string; purpose: string; status: string }
export interface FundingFacts {
  book: 'CLIENT' | 'FIRM';
  customerNo: string | null; walletNo: string | null;
  adjustment?: { adjustmentNo: string; status: string; reasonCode: string; amount: string } | null;
  transfer?: FundingTransferRef | null;
  bounce?: { externalLineId: string; lineAmountMinor: bigint; availableMinor: bigint; supplementNo: string | null } | null;
}
export type FundingNextStep =
  | { kind: 'COMPENSATION'; adjustmentNo: string; amount: string; customerNo: string | null; walletNo: string | null }
  | { kind: 'ADVANCE'; amount: string; externalLineId: string; customerNo: string | null; walletNo: string | null; available: string; lineAmount: string };

const TERMINAL_FAIL = new Set(['FAILED', 'REJECTED', 'CANCELLED']);

export function deriveFundingNextStep(f: FundingFacts): { nextStep?: FundingNextStep; transfer?: FundingTransferRef } {
  const out: { nextStep?: FundingNextStep; transfer?: FundingTransferRef } = {};
  if (f.transfer) out.transfer = { transferNo: f.transfer.transferNo, purpose: f.transfer.purpose, status: f.transfer.status };
  const noLiveTransfer = !f.transfer || TERMINAL_FAIL.has(f.transfer.status);
  if (f.book !== 'CLIENT') return out;
  if (f.adjustment && f.adjustment.status === 'POSTED' && f.adjustment.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' && noLiveTransfer) {
    out.nextStep = { kind: 'COMPENSATION', adjustmentNo: f.adjustment.adjustmentNo, amount: f.adjustment.amount, customerNo: f.customerNo, walletNo: f.walletNo };
    return out;
  }
  if (f.bounce && !f.bounce.supplementNo && noLiveTransfer) {
    const shortfall = f.bounce.lineAmountMinor - f.bounce.availableMinor;
    if (shortfall > 0n) {
      out.nextStep = { kind: 'ADVANCE', amount: shortfall.toString(), externalLineId: f.bounce.externalLineId, customerNo: f.customerNo, walletNo: f.walletNo, available: f.bounce.availableMinor.toString(), lineAmount: f.bounce.lineAmountMinor.toString() };
    }
  }
  return out;
}
