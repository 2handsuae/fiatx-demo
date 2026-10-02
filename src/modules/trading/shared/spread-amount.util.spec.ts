import { Prisma } from '@prisma/client';
import { computeSpreadAmount } from './spread-amount.util';
const d = (v: string) => new Prisma.Decimal(v);
describe('computeSpreadAmount', () => {
  it('= fromAmount×marketRate(按toDecimals四舍五入) − grossOut', () => {
    expect(computeSpreadAmount(d('1000'), d('0.0000153'), d('0.01507'), 8).toString()).toBe('0.00023');
  });
  it('零点差输出 0', () => {
    expect(computeSpreadAmount(d('100'), d('2'), d('200'), 2).toString()).toBe('0');
  });
  it('取整模式为 ROUND_HALF_UP（1.005→1.01，不是截断）', () => {
    expect(computeSpreadAmount(d('1'), d('1.005'), d('1'), 2).toString()).toBe('0.01');
  });
  it('取整残差可为负，原值输出', () => {
    expect(computeSpreadAmount(d('1'), d('1.004'), d('1.01'), 2).toString()).toBe('-0.01');
  });
});
