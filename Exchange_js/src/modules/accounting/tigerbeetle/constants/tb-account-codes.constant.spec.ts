// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts
import * as fs from 'fs';
import * as path from 'path';
import { TB_ACCOUNT_CODES, COA_TO_TB_CODE, TB_CODE_TO_COA } from './tb-account-codes.constant';

describe('TB_ACCOUNT_CODES (real-time 1:1 COA)', () => {
  it('exposes exactly the 9 codes', () => {
    expect(TB_ACCOUNT_CODES).toEqual({
      CLIENT_ASSET: 1,
      FIRM_ASSET: 50,
      CLIENT_PAYABLE: 100,
      DEPOSIT_SUSPENSE: 101,
      FIRM_OPS: 200,
      FIRM_SET: 201,
      FIRM_FEE: 202,
      FIRM_LIQ: 203,
      FIRM_SEIZED: 204,
    });
  });

  it('drops all legacy codes', () => {
    const names = Object.keys(TB_ACCOUNT_CODES);
    for (const dead of ['CLIENT_BANK','CLIENT_CUSTODY','TRADE_CLEARING','FIRM_TREASURY','FX_POSITION','PAID_IN_CAPITAL','RETAINED_EARNINGS','FEE_INCOME','SPREAD_INCOME','FX_UNREALIZED_PNL','FX_REALIZED_PNL']) {
      expect(names).not.toContain(dead);
    }
  });

  it('round-trips COA labels', () => {
    expect(COA_TO_TB_CODE['A.CLIENT_ASSET']).toBe(1);
    expect(COA_TO_TB_CODE['E.FIRM_FEE']).toBe(202);
    expect(TB_CODE_TO_COA[201]).toBe('E.FIRM_SET');
  });
});

/**
 * Regression guard for the A6 e2e bug (FIRM_SEIZED added to TB_ACCOUNT_CODES by A1 but
 * never added to seedAssets()'s system-account registration list — every environment
 * seeded from that gap 100% NotFoundException'd on any deposit seizure). This test
 * doesn't spin up Prisma/TigerBeetle (seedAssets() isn't unit-testable in isolation); it
 * greps the actual registration sources so a future "add a new always-on system TB
 * account code but forget to register it somewhere" repeats this exact incident and
 * fails loudly instead of silently 100%-breaking at runtime.
 */
describe('system TB account codes are registered at every provisioning site (regression guard)', () => {
  // Codes every asset (fiat AND crypto) must get a system TB account for — excludes
  // FIRM_SET (fiat-only, bank settlement) and the two per-customer codes
  // (CLIENT_PAYABLE/DEPOSIT_SUSPENSE, registered per-customer in seedCustomers(), not here).
  const ALWAYS_REGISTERED_SYSTEM_CODES = [
    'CLIENT_ASSET',
    'FIRM_ASSET',
    'FIRM_OPS',
    'FIRM_FEE',
    'FIRM_LIQ',
    'FIRM_SEIZED',
  ] as const;

  const REGISTRATION_SOURCES = [
    '../../../../../prisma/seed.business.ts',
    '../../../asset-treasury/assets/asset-provisioning.service.ts',
    '../../../asset-treasury/assets/asset-activation-workflow.service.ts',
  ];

  for (const rel of REGISTRATION_SOURCES) {
    const file = path.resolve(__dirname, rel);

    it(`${rel.replace(/^(\.\.\/)+/, '')} references every always-on system code`, () => {
      const source = fs.readFileSync(file, 'utf8');
      for (const name of ALWAYS_REGISTERED_SYSTEM_CODES) {
        expect(source).toContain(`TB_ACCOUNT_CODES.${name}`);
      }
    });
  }

  it('sanity: the guard itself would have caught the A6 incident (FIRM_SEIZED specifically)', () => {
    expect(ALWAYS_REGISTERED_SYSTEM_CODES).toContain('FIRM_SEIZED');
    expect(TB_ACCOUNT_CODES.FIRM_SEIZED).toBe(204);
  });
});
