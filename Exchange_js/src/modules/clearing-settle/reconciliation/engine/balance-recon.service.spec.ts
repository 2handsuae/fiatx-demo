import { Prisma } from '@prisma/client';
import { BalanceReconService } from './balance-recon.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('BalanceReconService', () => {
  const svc = new BalanceReconService();
  it('I5 delta = tb - (external + inTransit) ; PASS when 0', () => {
    // tb 1794.15, 外部物理 1550.95, in-transit +243.20 → 期望外部 1794.15 → delta 0
    const r = svc.computeI5('USDT', D('1794.150136'), D('1550.950136'), D('243.20'));
    expect(r.status).toBe('PASS');
    expect(r.delta.toString()).toBe('0');
    expect(r.severity).toBe('ACCOUNT_ACTUAL');
  });
  it('I5 FAIL reports signed delta (tb > external)', () => {
    const r = svc.computeI5('USDT', D('1794.150136'), D('1200.950136'), D('243.20'));
    // 期望外部 = 1200.950136 + 243.20 = 1444.150136；delta = 1794.150136 - 1444.150136 = 350
    expect(r.status).toBe('FAIL');
    // Prisma.Decimal 归一化：整数差无尾随零 → '350'（同 B2 '243.2' 口径）
    expect(r.delta.toString()).toBe('350');
  });
});
