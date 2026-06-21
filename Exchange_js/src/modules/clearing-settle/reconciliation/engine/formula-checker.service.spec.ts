import { Prisma } from '@prisma/client';
import {
  FormulaCheckerService,
  FormulaResult,
  ExternalSide,
} from './formula-checker.service';

const D = (n: number | string) => new Prisma.Decimal(n);
const byCode = (rs: FormulaResult[]) =>
  Object.fromEntries(rs.map((r) => [r.formula, r])) as Record<string, FormulaResult>;

describe('FormulaCheckerService', () => {
  const svc = new FormulaCheckerService();

  /**
   * Worked scenario (clean integers, AED view of a 2-swap day):
   *   - Swap X: USDT→AED, BOTH legs SETTLED (fiat settled same-day). Out of 式2/式3 (cleared+swept).
   *   - Swap Y: AED→USDT, AED `from` leg SETTLED, USDT `to` leg still OPEN (crypto next-day EOD pending).
   *
   * AED-side state we feed as credit-net (cn) + subledger inputs, engineered to all-PASS:
   *   客户块(AED) = CLIENT_BANK(-?) + CLIENT_PAYABLE(?) + DEPOSIT_SUSPENSE(?) = -100
   *       └ equals OPEN Outstanding net: Y's AED `from` leg is SETTLED, but its mirror payable still owed
   *         to the client → net IN−OUT over OPEN legs = -100.
   *   桥块(AED) = TRADE_CLEARING = +100
   *       └ equals unswept-swap bridge contribution: Y is not both-legs-SETTLED → AED `from` leg +100.
   *   公司块(AED) = -(客户块+桥块) = 0  → 式1 holds.
   * 账外:
   *   客户池(AED) = -cn(CLIENT_BANK) = 900 ; external CLIENT closing 850 + in-transit 50 = 900 → 式4 PASS.
   *   公司库(AED) = -cn(FIRM_TREASURY) = 200 ; external FIRM closing 200 + 0 = 200 → 式5 PASS.
   */
  const cnAed: Record<string, Prisma.Decimal> = {
    'A.CLIENT_BANK': D(-900), // asset, credit-net negative; pool holding = +900
    'L.CLIENT_PAYABLE': D(700),
    'L.DEPOSIT_SUSPENSE': D(100),
    // 客户块 = -900 + 700 + 100 = -100  ✓
    'L.TRADE_CLEARING': D(100), // 桥块 = +100 ✓
    'A.FIRM_TREASURY': D(-200), // pool holding = +200
    'R.FEE_INCOME': D(150),
    'R.SPREAD_INCOME': D(50),
    // 公司块 = -200 + 150 + 50 = 0  ✓  (PAID_IN/RETAINED/FX_* absent → 0)
  };

  const openOutstandingNetAed = D(-100); // ΣIN − ΣOUT over OPEN legs
  const unsweptSwapBridgeAed = D(100); // Y AED `from` leg +100
  const clientExtAed: ExternalSide = { externalSum: D(850), inTransitAdj: D(50) };
  const firmExtAed: ExternalSide = { externalSum: D(200), inTransitAdj: D(0) };

  it('all 5 formulas PASS at the cutoff in the worked 2-swap scenario (AED)', () => {
    const rs = svc.checkAll(
      'AED', cnAed, openOutstandingNetAed, D(0), unsweptSwapBridgeAed, clientExtAed, firmExtAed,
    );
    const m = byCode(rs);
    expect(rs).toHaveLength(5);
    for (const f of ['式1', '式2', '式3', '式4', '式5']) {
      expect(m[f].status).toBe('PASS');
      expect(m[f].delta.abs().lessThan('0.000001')).toBe(true);
    }
  });

  it('式1 总账恒等: 客户块 + 桥块 + 公司块 = 0', () => {
    const r = svc.formula1('AED', cnAed);
    expect(r.lhs.toString()).toBe('0');
    expect(r.rhs.toString()).toBe('0');
    expect(r.status).toBe('PASS');
  });

  it('式1 FAILS when blocks do not net to zero (inject imbalance)', () => {
    const broken = { ...cnAed, 'R.FEE_INCOME': D(151) }; // 公司块 → +1
    const r = svc.formula1('AED', broken);
    expect(r.lhs.toString()).toBe('1');
    expect(r.status).toBe('FAIL');
    expect(r.delta.toString()).toBe('1');
  });

  it('式2 客户勾稽: 客户块cn = OPEN Outstanding net (only OPEN legs, no withdraw-fee in-transit)', () => {
    const r = svc.formula2('AED', cnAed, openOutstandingNetAed, D(0));
    expect(r.lhs.toString()).toBe('-100'); // 客户块
    expect(r.rhs.toString()).toBe('-100'); // ΣIN − ΣOUT (OPEN) − 0
    expect(r.status).toBe('PASS');
  });

  it('式2 FAILS if a SETTLED leg is wrongly left in the Outstanding RHS', () => {
    // RHS still carries the already-settled -100 leg twice (-200) while 客户块 moved to -100.
    const r = svc.formula2('AED', cnAed, D(-200), D(0));
    expect(r.delta.toString()).toBe('100');
    expect(r.status).toBe('FAIL');
  });

  it('式2 with unsettledWithdrawFee: 客户块 = openOutstandingNet − unsettledWithdrawFee (crypto pending day)', () => {
    // Scenario: USDT, crypto-pending day, 2 withdraw fees of 2 USDT each (not yet swept to F_FEE).
    //   clientBlock      = -1672.21443  (client claim minus the 4 USDT fee already debited)
    //   openOutstandingNet = -1668.21443  (net OPEN Outstanding, fee not yet netted here)
    //   unsettledWithdrawFee = 4          (2 × 2 USDT, status ≠ SETTLED)
    //   rhs = -1668.21443 − 4 = -1672.21443 → Δ = 0 → PASS
    const cn = { 'L.CLIENT_PAYABLE': D('-1672.21443') };
    const r = svc.formula2('USDT', cn, D('-1668.21443'), D(4));
    expect(r.lhs.toString()).toBe('-1672.21443');
    expect(r.rhs.toString()).toBe('-1672.21443');
    expect(r.delta.toString()).toBe('0');
    expect(r.status).toBe('PASS');
  });

  it('式2 FAILS without the unsettledWithdrawFee correction (the bug this fix addresses)', () => {
    // Same scenario but passing 0 for unsettledWithdrawFee (old behavior pre-fix).
    // rhs = -1668.21443 − 0 = -1668.21443 ; lhs = -1672.21443 ; Δ = -4 → FAIL
    const cn = { 'L.CLIENT_PAYABLE': D('-1672.21443') };
    const r = svc.formula2('USDT', cn, D('-1668.21443'), D(0));
    expect(r.lhs.toString()).toBe('-1672.21443');
    expect(r.rhs.toString()).toBe('-1668.21443');
    expect(r.delta.toString()).toBe('-4');
    expect(r.status).toBe('FAIL');
  });

  it('式3 桥勾稽: 桥块cn = unswept-swap bridge contribution (only un-swept swaps)', () => {
    const r = svc.formula3('AED', cnAed, unsweptSwapBridgeAed);
    expect(r.lhs.toString()).toBe('100'); // TRADE_CLEARING
    expect(r.rhs.toString()).toBe('100'); // Y from-leg +100
    expect(r.status).toBe('PASS');
  });

  it('式3 FAILS if a fully-swept swap is wrongly counted in RHS', () => {
    // Swept swap X (USDT→AED, -mid on AED to-leg, say -100) wrongly added → RHS = 0.
    const r = svc.formula3('AED', cnAed, D(0));
    expect(r.delta.toString()).toBe('100');
    expect(r.status).toBe('FAIL');
  });

  it('式4 客户账外: 客户池 = Σexternal(CLIENT) ± 在途', () => {
    const r = svc.formula4('AED', cnAed, clientExtAed);
    expect(r.lhs.toString()).toBe('900'); // -cn(CLIENT_BANK) = pool holding
    expect(r.rhs.toString()).toBe('900'); // 850 + 50 in-transit
    expect(r.status).toBe('PASS');
  });

  it('式4 FAILS on external/in-transit mismatch (reports signed delta)', () => {
    const r = svc.formula4('AED', cnAed, { externalSum: D(850), inTransitAdj: D(0) });
    expect(r.delta.toString()).toBe('50'); // pool 900 − external 850
    expect(r.status).toBe('FAIL');
  });

  it('式5 公司账外: FIRM_TREASURY = Σexternal(FIRM) ± 在途', () => {
    const r = svc.formula5('AED', cnAed, firmExtAed);
    expect(r.lhs.toString()).toBe('200');
    expect(r.rhs.toString()).toBe('200');
    expect(r.status).toBe('PASS');
  });

  it('block sums treat missing COA codes as 0', () => {
    const sparse = { 'A.CLIENT_BANK': D(-5) };
    expect(svc.clientBlock(sparse).toString()).toBe('-5');
    expect(svc.bridgeBlock(sparse).toString()).toBe('0');
    expect(svc.firmBlock(sparse).toString()).toBe('0');
  });

  it('USDT view of the same scenario: pending crypto to-leg keeps 式2/式3 nonzero but balanced', () => {
    // Swap Y `to` leg (USDT IN, still OPEN). mid on USDT = 100. Bridge to-leg = -100.
    const cnUsdt: Record<string, Prisma.Decimal> = {
      'A.CLIENT_CUSTODY': D(0), // crypto not yet physically settled → pool unchanged
      'L.CLIENT_PAYABLE': D(100), // net credited to client (net of fee) — simplified to 100
      'L.TRADE_CLEARING': D(-100), // 桥块 = -100 (to-leg -mid)
      'A.FIRM_TREASURY': D(0),
      // 客户块 = 0 + 100 = 100 ; 桥块 = -100 ; 公司块 = 0 → 式1 = 0 ✓
    };
    const rs = svc.checkAll(
      'USDT',
      cnUsdt,
      D(100),  // OPEN Outstanding net: USDT IN leg +100
      D(0),    // unsettledWithdrawFee: none in this scenario
      D(-100), // unswept bridge: to-leg -mid = -100
      { externalSum: D(0), inTransitAdj: D(0) }, // client crypto pool 0 = external 0
      { externalSum: D(0), inTransitAdj: D(0) },
    );
    const m = byCode(rs);
    for (const f of ['式1', '式2', '式3', '式4', '式5']) {
      expect(m[f].status).toBe('PASS');
    }
  });
});
