// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts
import * as fs from 'fs';
import * as path from 'path';
import {
  TB_ACCOUNT_CODES,
  TB_ACCOUNT_NAMES,
  COA_TO_TB_CODE,
  TB_CODE_TO_COA,
  DEBIT_NORMAL_TB_CODES,
  CASH_TB_CODES,
  isDebitNormalCode,
  isCashCode,
  accountFlagsFor,
  cashAccountCodeFor,
  cashAccountName,
  accountDisplayName,
} from './tb-account-codes.constant';
import { ledgerForNetwork } from './tb-ledgers.constant';
import { systemAccountCodesFor } from '../../../asset-treasury/assets/asset-provisioning.service';

describe('TB_ACCOUNT_CODES (real-time 1:1 COA)', () => {
  // 戊波一：11 码（201 / 203 已退役删除）。码 2 / 51 / 150 不进本波码表。
  it('exposes exactly the 11 codes', () => {
    expect(TB_ACCOUNT_CODES).toEqual({
      CLIENT_CASH: 1,
      FIRM_CASH: 50,
      CLIENT_PAYABLE: 100,
      DEPOSIT_SUSPENSE: 101,
      FIRM_EQUITY: 200,
      INCOME_SWAP_FEE: 210,
      INCOME_WITHDRAW_FEE: 211,
      INCOME_OTHER: 212,
      EXPENSE_BANK_CUSTODY: 300,
      EXPENSE_RECON_LOSS: 301,
      EXPENSE_OTHER: 302,
    });
  });

  it('drops all legacy codes', () => {
    const names = Object.keys(TB_ACCOUNT_CODES);
    for (const dead of ['CLIENT_BANK','CLIENT_CUSTODY','TRADE_CLEARING','FIRM_TREASURY','FX_POSITION','PAID_IN_CAPITAL','RETAINED_EARNINGS','FEE_INCOME','SPREAD_INCOME','FX_UNREALIZED_PNL','FX_REALIZED_PNL','FIRM_FEE','FIRM_SEIZED','FIRM_SET','FIRM_LIQ']) {
      expect(names).not.toContain(dead);
    }
  });

  it('round-trips COA labels', () => {
    expect(COA_TO_TB_CODE['A.CLIENT_CASH']).toBe(1);
    expect(COA_TO_TB_CODE['E.INCOME_SWAP_FEE']).toBe(210);
    expect(COA_TO_TB_CODE['X.EXPENSE_RECON_LOSS']).toBe(301);
    expect(COA_TO_TB_CODE['X.EXPENSE_BANK_CUSTODY']).toBe(300);
    expect(COA_TO_TB_CODE['X.EXPENSE_OTHER']).toBe(302);
    expect(COA_TO_TB_CODE['A.FIRM_CASH']).toBe(50);
    expect(COA_TO_TB_CODE['E.FIRM_EQUITY']).toBe(200);
    expect(TB_CODE_TO_COA[1]).toBe('A.CLIENT_CASH');
    expect(TB_CODE_TO_COA[212]).toBe('E.INCOME_OTHER');
  });

  it('退役码 201 / 203 不在码表、名称表、助记码映射里', () => {
    expect(Object.values(TB_ACCOUNT_CODES)).not.toContain(201);
    expect(Object.values(TB_ACCOUNT_CODES)).not.toContain(203);
    expect(TB_ACCOUNT_NAMES[201]).toBeUndefined();
    expect(TB_ACCOUNT_NAMES[203]).toBeUndefined();
    expect(TB_CODE_TO_COA[201]).toBeUndefined();
    expect(TB_CODE_TO_COA[203]).toBeUndefined();
    expect(COA_TO_TB_CODE['E.FIRM_SET']).toBeUndefined();
    expect(COA_TO_TB_CODE['E.FIRM_LIQ']).toBeUndefined();
    expect(Object.keys(TB_ACCOUNT_NAMES).map(Number).sort((a, b) => a - b)).toEqual(
      [1, 50, 100, 101, 200, 210, 211, 212, 300, 301, 302],
    );
  });

  it('names: 现金类与开支类的英文名（一码一名）', () => {
    expect(TB_ACCOUNT_NAMES[1]).toBe('Client Cash');
    expect(TB_ACCOUNT_NAMES[50]).toBe('Company Cash');
    expect(TB_ACCOUNT_NAMES[200]).toBe('Company Equity');
    expect(TB_ACCOUNT_NAMES[300]).toBe('Bank & Custody Charges');
    expect(TB_ACCOUNT_NAMES[301]).toBe('Reconciliation Write-off Loss');
    expect(TB_ACCOUNT_NAMES[302]).toBe('Other Expenses');
  });

  it('借方户 = {1, 50, 300, 301, 302}，其余贷方户', () => {
    expect([...DEBIT_NORMAL_TB_CODES].sort((a, b) => a - b)).toEqual([1, 50, 300, 301, 302]);
    expect(isDebitNormalCode(300)).toBe(true);
    expect(isDebitNormalCode(1)).toBe(true);
    expect(isDebitNormalCode(50)).toBe(true);
    expect(isDebitNormalCode(200)).toBe(false);
    expect(isDebitNormalCode(100)).toBe(false);
    expect(isDebitNormalCode(210)).toBe(false);
  });

  it('现金类 = {1, 50}', () => {
    expect([...CASH_TB_CODES].sort((a, b) => a - b)).toEqual([1, 50]);
    expect(isCashCode(1)).toBe(true);
    expect(isCashCode(50)).toBe(true);
    expect(isCashCode(300)).toBe(false);
    expect(isCashCode(200)).toBe(false);
  });

  it('accountFlagsFor: 借方户禁贷超 = 4，贷方户禁借超 = 2（账本不得为负）', () => {
    expect(accountFlagsFor(1)).toBe(4);
    expect(accountFlagsFor(50)).toBe(4);
    expect(accountFlagsFor(300)).toBe(4);
    expect(accountFlagsFor(100)).toBe(2);
    expect(accountFlagsFor(200)).toBe(2);
    expect(accountFlagsFor(212)).toBe(2);
  });

  it('cashAccountCodeFor: CUSTOMER → 1，PLATFORM → 50，未知归属抛错（不回落到任何一类）', () => {
    expect(cashAccountCodeFor('CUSTOMER')).toBe(1);
    expect(cashAccountCodeFor('PLATFORM')).toBe(50);
    expect(() => cashAccountCodeFor('LP')).toThrow(/No cash account code for wallet ownerType LP/);
    expect(() => cashAccountCodeFor('')).toThrow();
  });

  it('ledgerForNetwork: TRON → USDT 账本 2，AED_ZAND → AED 账本 1', () => {
    expect(ledgerForNetwork('TRON')).toBe(2);
    expect(ledgerForNetwork('AED_ZAND')).toBe(1);
  });

  it('cashAccountName: 平台钱包 = 公司现金 · vault 标签 · 网络；客户钱包 = 客户现金 · 客户号 · 角色', () => {
    expect(
      cashAccountName(50, { vaultCode: 'F_OPS', walletRole: 'F_OPS', network: 'AED_ZAND', ownerNo: 'PLATFORM' }),
    ).toBe('Company Cash · Company Operations · AED_ZAND');
    expect(
      cashAccountName(1, { vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_VIBAN', network: 'AED_ZAND', ownerNo: 'CU2601012635' }),
    ).toBe('Client Cash · CU2601012635 · vIBAN');
    expect(
      cashAccountName(1, { vaultCode: 'CLIENT_DEPOSIT', walletRole: 'C_DEP', network: 'TRON', ownerNo: 'CU2601012635' }),
    ).toBe('Client Cash · CU2601012635 · Deposit address');
  });

  it('accountDisplayName: 现金户(WALLET)显示注册表户名 description；其余户照一码一名；WALLET 缺 description 回落类名', () => {
    expect(
      accountDisplayName({ code: 50, ownerType: 'WALLET', description: 'Company Cash · Company Operations · AED_ZAND' }),
    ).toBe('Company Cash · Company Operations · AED_ZAND');
    expect(
      accountDisplayName({ code: 1, ownerType: 'WALLET', description: 'Client Cash · CU2601012635 · vIBAN' }),
    ).toBe('Client Cash · CU2601012635 · vIBAN');
    // 非 WALLET 行即便带 description 也不用它（SYSTEM / CUSTOMER 户名 = 类名）
    expect(accountDisplayName({ code: 200, ownerType: 'SYSTEM', description: 'whatever' })).toBe('Company Equity');
    expect(accountDisplayName({ code: 100, ownerType: 'CUSTOMER', description: null })).toBe(
      'Payable to Clients – Available Balance',
    );
    expect(accountDisplayName({ code: 50, ownerType: 'WALLET', description: null })).toBe('Company Cash');
    expect(accountDisplayName(undefined)).toBeNull();
  });

  it('systemAccountCodesFor 不再分法币：FIAT 与 CRYPTO 返回同一份 7 码（现金户不在上币时开，201/203 不再开）', () => {
    const fiatCodes = systemAccountCodesFor('FIAT').map((a) => a.code);
    const cryptoCodes = systemAccountCodesFor('CRYPTO').map((a) => a.code);
    expect(fiatCodes).toEqual([200, 210, 211, 212, 300, 301, 302]);
    expect(cryptoCodes).toEqual(fiatCodes);
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
  // 现金类 1 / 50（每钱包一户，钱包 ACTIVE 时开）与两个每客户码
  // (CLIENT_PAYABLE/DEPOSIT_SUSPENSE, registered per-customer in seedCustomers(), not here).
  const ALWAYS_REGISTERED_SYSTEM_CODES = [
    'FIRM_EQUITY',
    'INCOME_SWAP_FEE',
    'INCOME_WITHDRAW_FEE',
    'INCOME_OTHER',
    'EXPENSE_BANK_CUSTODY',
    'EXPENSE_RECON_LOSS',
    'EXPENSE_OTHER',
  ] as const;

  // 波一(2026-09-04)T2 前，这里另有两条：prisma/seed.business.ts（自己内联一份同款数组）
  // 与 asset-activation-workflow.service.ts（checkReadiness 前也内联一份，做就绪校验）。
  // T2 把种子那份收口成调用 asset-provisioning.service.ts#systemAccountCodesFor()（seed
  // 不再内联字面量）；activation 整条路随上架/激活退役被删（BACKLOG「新资产上线整条流程」）。
  // 现在全仓只剩这一处内联，唯一注册点。
  const REGISTRATION_SOURCES = [
    '../../../asset-treasury/assets/asset-provisioning.service.ts',
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

  it('sanity: the guard itself would have caught the A6 incident (same pattern, now on a live income code)', () => {
    // FIRM_SEIZED (204) — the code the A6 incident was originally about — retired
    // 2026-08-13 COA v2; TB_ACCOUNT_CODES.FIRM_SEIZED no longer exists. INCOME_OTHER
    // is its closest live descendant in this guard (also 2026-08-13, also a
    // must-register-everywhere system code), so it carries the regression check forward.
    expect(ALWAYS_REGISTERED_SYSTEM_CODES).toContain('INCOME_OTHER');
    expect(TB_ACCOUNT_CODES.INCOME_OTHER).toBe(212);
  });
});
