import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { FEE_INCOME_CLOSE_SEQUENCE, planFeeIncomeClose } from './house-transfer-fee-close';

const SWAP = TB_ACCOUNT_CODES.INCOME_SWAP_FEE; // 210
const WD = TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE; // 211
const OTHER = TB_ACCOUNT_CODES.INCOME_OTHER; // 212

describe('扫费同额结转规划（码 90，spec 裁定 5 / 13）', () => {
  it('消耗顺序锁死 210 → 211 → 212，eventCode 各异（转账号按 eventCode 哈希，同码会撞）', () => {
    expect(FEE_INCOME_CLOSE_SEQUENCE.map((s) => s.code)).toEqual([210, 211, 212]);
    expect(FEE_INCOME_CLOSE_SEQUENCE.map((s) => s.eventCode)).toEqual(['FEE_INCOME_CLOSE_SWAP', 'FEE_INCOME_CLOSE_WITHDRAW', 'FEE_INCOME_CLOSE_OTHER']);
    expect(new Set(FEE_INCOME_CLOSE_SEQUENCE.map((s) => s.eventCode)).size).toBe(3);
  });

  it('① 整扫、金额恰等于收入总额：三户各结转全额，三笔', () => {
    expect(planFeeIncomeClose(600n, { [SWAP]: 300n, [WD]: 200n, [OTHER]: 100n })).toEqual([
      { code: 210, eventCode: 'FEE_INCOME_CLOSE_SWAP', amountMinor: 300n },
      { code: 211, eventCode: 'FEE_INCOME_CLOSE_WITHDRAW', amountMinor: 200n },
      { code: 212, eventCode: 'FEE_INCOME_CLOSE_OTHER', amountMinor: 100n },
    ]);
  });

  it('② 扫一半：210 全扣、211 只扣到够，212 不碰（两笔）', () => {
    expect(planFeeIncomeClose(450n, { [SWAP]: 300n, [WD]: 200n, [OTHER]: 100n })).toEqual([
      { code: 210, eventCode: 'FEE_INCOME_CLOSE_SWAP', amountMinor: 300n },
      { code: 211, eventCode: 'FEE_INCOME_CLOSE_WITHDRAW', amountMinor: 150n },
    ]);
  });

  it('③ 金额小于 210 余额：只扣 210 的一部分（一笔）', () => {
    expect(planFeeIncomeClose(120n, { [SWAP]: 300n, [WD]: 200n, [OTHER]: 100n })).toEqual([
      { code: 210, eventCode: 'FEE_INCOME_CLOSE_SWAP', amountMinor: 120n },
    ]);
  });

  it('④ 封顶：金额超出收入总额（手续费户里有运营户调来的钱），结转只到 Σ 收入，三户归零、总额 = Σ', () => {
    const steps = planFeeIncomeClose(1_000n, { [SWAP]: 300n, [WD]: 200n, [OTHER]: 100n });
    expect(steps.map((s) => s.amountMinor)).toEqual([300n, 200n, 100n]);
    expect(steps.reduce((a, s) => a + s.amountMinor, 0n)).toBe(600n);
  });

  it('⑤ 余额为 0 的户整笔跳过（不产出 0 额转账）；缺的码按 0', () => {
    expect(planFeeIncomeClose(500n, { [SWAP]: 0n, [OTHER]: 80n })).toEqual([
      { code: 212, eventCode: 'FEE_INCOME_CLOSE_OTHER', amountMinor: 80n },
    ]);
  });

  it('⑥ 没有任何收入余额 / 金额为 0：不结转（空数组）', () => {
    expect(planFeeIncomeClose(500n, {})).toEqual([]);
    expect(planFeeIncomeClose(0n, { [SWAP]: 300n })).toEqual([]);
  });
});
