import { Prisma } from '@prisma/client';
/** 点差金额 = in 腿市值(按 toAsset.decimals ROUND_HALF_UP) − 报出毛额。报价响应与建单落库共用（spec §4 同源）。 */
export function computeSpreadAmount(
  fromAmount: Prisma.Decimal, marketRate: Prisma.Decimal,
  grossAmountOut: Prisma.Decimal, toDecimals: number,
): Prisma.Decimal {
  return fromAmount.mul(marketRate).toDecimalPlaces(toDecimals, Prisma.Decimal.ROUND_HALF_UP).sub(grossAmountOut);
}
