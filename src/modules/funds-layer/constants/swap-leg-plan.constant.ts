import { TB_ACCOUNT_CODES as C } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES as T } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

export type AmountRef = 'from' | 'grossTo' | 'fee';
export type LegSide = 'from' | 'to';
export interface LegAccounting {
  code: number; debitCode: number; creditCode: number; side: LegSide; amountRef: AmountRef; eventCode: string;
}
export interface SwapLegSpec { legSeq: number; fromRole: string; toRole: string; side: LegSide; accounting: LegAccounting[]; }
export type EntrySide = 'debit' | 'credit';

/**
 * 现金侧钱包规则(戊波一,附录 B):同一腿内,现金贷方 = 该腿 fromRole 的钱包,现金借方 = toRole 的钱包。
 * 钱从 fromRole 钱包出(现金户记贷)、进 toRole 钱包(现金户记借);客户角色(C_*)落 1 客户现金、
 * 平台角色(F_*)落 50 公司现金(由钱包归属决定,见 cashAccountCodeFor)。
 */
export function cashSideRole(spec: SwapLegSpec, side: EntrySide): string {
  return side === 'credit' ? spec.fromRole : spec.toRole;
}

// 戊波一(附录 B「兑换」):转账码不变,科目换成现金户(1 客户现金 / 50 公司现金,每钱包一户)+ 公司权益 200。
// 法币结算户 F_SET 不再有独立科目(并入 50 类「公司现金·结算」),所以 32/33/37/38 的结算腿改借贷现金与权益。
// 现金侧落哪个钱包不写在表里,由 cashSideRole(同一腿内:现金贷方 = fromRole 钱包、现金借方 = toRole 钱包)推出。
const CRYPTO_TO_FIAT: SwapLegSpec[] = [
  { legSeq: 1, fromRole: 'C_DEP', toRole: 'F_OPS', side: 'from', accounting: [
    { code: T.SWAP_SELL_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_CASH, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_CLIENT' },
    { code: T.SWAP_SELL_FIRM,   debitCode: C.FIRM_CASH,      creditCode: C.FIRM_EQUITY, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_FIRM' },
  ] },
  { legSeq: 2, fromRole: 'F_OPS', toRole: 'F_SET', side: 'to', accounting: [
    { code: T.SWAP_BUY_OPS_TO_SET, debitCode: C.FIRM_CASH, creditCode: C.FIRM_CASH, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_OPS_TO_SET' },
  ] },
  { legSeq: 3, fromRole: 'F_SET', toRole: 'C_VIBAN', side: 'to', accounting: [
    { code: T.SWAP_BUY_SET_TO_ASSET, debitCode: C.FIRM_EQUITY, creditCode: C.FIRM_CASH,      side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_SET_TO_ASSET' },
    { code: T.SWAP_BUY_CLIENT,       debitCode: C.CLIENT_CASH, creditCode: C.CLIENT_PAYABLE, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_CLIENT' },
  ] },
  { legSeq: 4, fromRole: 'C_VIBAN', toRole: 'F_FEE', side: 'to', accounting: [
    { code: T.SWAP_FEE_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_CASH,      side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_CLIENT' },
    { code: T.SWAP_FEE_FIRM,   debitCode: C.FIRM_CASH,      creditCode: C.INCOME_SWAP_FEE, side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_FIRM' },
  ] },
];

const FIAT_TO_CRYPTO: SwapLegSpec[] = [
  { legSeq: 1, fromRole: 'C_VIBAN', toRole: 'F_SET', side: 'from', accounting: [
    { code: T.SWAP_SELL_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_CASH,  side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_CLIENT' },
    { code: T.SWAP_SELL_FIRM,   debitCode: C.FIRM_CASH,      creditCode: C.FIRM_EQUITY, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_FIRM' },
  ] },
  { legSeq: 2, fromRole: 'F_SET', toRole: 'F_OPS', side: 'from', accounting: [
    { code: T.SWAP_SELL_SET_TO_OPS, debitCode: C.FIRM_CASH, creditCode: C.FIRM_CASH, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_SET_TO_OPS' },
  ] },
  { legSeq: 3, fromRole: 'F_OPS', toRole: 'C_DEP', side: 'to', accounting: [
    { code: T.SWAP_BUY_OPS_TO_ASSET, debitCode: C.FIRM_EQUITY, creditCode: C.FIRM_CASH,      side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_OPS_TO_ASSET' },
    { code: T.SWAP_BUY_CLIENT,       debitCode: C.CLIENT_CASH, creditCode: C.CLIENT_PAYABLE, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_CLIENT' },
  ] },
  { legSeq: 4, fromRole: 'C_DEP', toRole: 'F_FEE', side: 'to', accounting: [
    { code: T.SWAP_FEE_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_CASH,      side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_CLIENT' },
    { code: T.SWAP_FEE_FIRM,   debitCode: C.FIRM_CASH,      creditCode: C.INCOME_SWAP_FEE, side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_FIRM' },
  ] },
];

export function buildSwapLegPlan(p: { fromIsFiat: boolean }): SwapLegSpec[] {
  return p.fromIsFiat ? FIAT_TO_CRYPTO : CRYPTO_TO_FIAT;
}
