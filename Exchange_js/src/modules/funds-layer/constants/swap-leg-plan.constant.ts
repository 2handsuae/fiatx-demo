import { TB_ACCOUNT_CODES as C } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES as T } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

export type AmountRef = 'from' | 'grossTo' | 'fee';
export type LegSide = 'from' | 'to';
export interface LegAccounting {
  code: number; debitCode: number; creditCode: number; side: LegSide; amountRef: AmountRef; eventCode: string;
}
export interface SwapLegSpec { legSeq: number; fromRole: string; toRole: string; side: LegSide; accounting: LegAccounting[]; }

const CRYPTO_TO_FIAT: SwapLegSpec[] = [
  { legSeq: 1, fromRole: 'C_DEP', toRole: 'F_OPS', side: 'from', accounting: [
    { code: T.SWAP_SELL_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_ASSET, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_CLIENT' },
    { code: T.SWAP_SELL_FIRM,   debitCode: C.FIRM_ASSET,     creditCode: C.FIRM_OPS,     side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_FIRM' },
  ] },
  { legSeq: 2, fromRole: 'F_OPS', toRole: 'F_SET', side: 'to', accounting: [
    { code: T.SWAP_BUY_OPS_TO_SET, debitCode: C.FIRM_OPS, creditCode: C.FIRM_SET, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_OPS_TO_SET' },
  ] },
  { legSeq: 3, fromRole: 'F_SET', toRole: 'C_VIBAN', side: 'to', accounting: [
    { code: T.SWAP_BUY_SET_TO_ASSET, debitCode: C.FIRM_SET,    creditCode: C.FIRM_ASSET,     side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_SET_TO_ASSET' },
    { code: T.SWAP_BUY_CLIENT,       debitCode: C.CLIENT_ASSET, creditCode: C.CLIENT_PAYABLE, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_CLIENT' },
  ] },
  { legSeq: 4, fromRole: 'C_VIBAN', toRole: 'F_FEE', side: 'to', accounting: [
    { code: T.SWAP_FEE_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_ASSET, side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_CLIENT' },
    { code: T.SWAP_FEE_FIRM,   debitCode: C.FIRM_ASSET,     creditCode: C.FIRM_FEE,     side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_FIRM' },
  ] },
];

const FIAT_TO_CRYPTO: SwapLegSpec[] = [
  { legSeq: 1, fromRole: 'C_VIBAN', toRole: 'F_SET', side: 'from', accounting: [
    { code: T.SWAP_SELL_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_ASSET, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_CLIENT' },
    { code: T.SWAP_SELL_FIRM,   debitCode: C.FIRM_ASSET,     creditCode: C.FIRM_SET,     side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_FIRM' },
  ] },
  { legSeq: 2, fromRole: 'F_SET', toRole: 'F_OPS', side: 'from', accounting: [
    { code: T.SWAP_SELL_SET_TO_OPS, debitCode: C.FIRM_SET, creditCode: C.FIRM_OPS, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_SET_TO_OPS' },
  ] },
  { legSeq: 3, fromRole: 'F_OPS', toRole: 'C_DEP', side: 'to', accounting: [
    { code: T.SWAP_BUY_OPS_TO_ASSET, debitCode: C.FIRM_OPS,    creditCode: C.FIRM_ASSET,     side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_OPS_TO_ASSET' },
    { code: T.SWAP_BUY_CLIENT,       debitCode: C.CLIENT_ASSET, creditCode: C.CLIENT_PAYABLE, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_CLIENT' },
  ] },
  { legSeq: 4, fromRole: 'C_DEP', toRole: 'F_FEE', side: 'to', accounting: [
    { code: T.SWAP_FEE_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_ASSET, side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_CLIENT' },
    { code: T.SWAP_FEE_FIRM,   debitCode: C.FIRM_ASSET,     creditCode: C.FIRM_FEE,     side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_FIRM' },
  ] },
];

export function buildSwapLegPlan(p: { fromIsFiat: boolean }): SwapLegSpec[] {
  return p.fromIsFiat ? FIAT_TO_CRYPTO : CRYPTO_TO_FIAT;
}
