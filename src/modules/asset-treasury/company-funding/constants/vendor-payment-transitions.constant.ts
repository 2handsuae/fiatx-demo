import { VendorPaymentStatus as S } from '../dto/vendor-payment.dto';

/** 六态六边（乙波二 spec §3.2）。批准即复核余额：不足落 FAILED 零资金单（照 LP/划转单先例）。 */
export const VENDOR_PAYMENT_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.EXECUTING, S.FAILED, S.REJECTED, S.CANCELLED],
  [S.EXECUTING]: [S.SUCCESS, S.FAILED],
  [S.SUCCESS]: [], [S.FAILED]: [], [S.REJECTED]: [], [S.CANCELLED]: [],
};
