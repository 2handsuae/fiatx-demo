import * as path from 'path';
import * as dotenv from 'dotenv';

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS (mirrors withdraw-money-arcs.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateTransferStatus } from 'tigerbeetle-node';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { CustomerDepositWalletService } from '../src/modules/asset-treasury/wallets/customer-deposit-wallet.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';

/**
 * 戊波一 T2 —— 账本不得为负的失效验证（纪律 2：报绿之前先确认这个检查真的会红）。
 *
 * 开户按科目类别写标志位后，TigerBeetle 必须真的拒绝「越过零线」的转账：
 *   - 借方户（现金 1）：贷方发生额超过借方 → `credits_must_not_exceed_debits` → 状态 exceeds_debits
 *   - 贷方户（暂扣 101）：借方发生额超过贷方 → `debits_must_not_exceed_credits` → 状态 exceeds_credits
 *
 * ⚠ TB 的检查顺序：先查**借方户**的 `debits_must_not_exceed_credits`（exceeds_credits），
 *   再查**贷方户**的 `credits_must_not_exceed_debits`（exceeds_debits）。所以要单独验「现金户被超额贷记」，
 *   借方那一边必须选一个自己不会先触发标志的户 —— 这里用同账本的 SYSTEM 开支户 302（借方户，没有借方侧约束）。
 *
 * 本文件**依赖重铺后的库**：现金户由钱包 ACTIVE 时开出，种子/演示钱包接到新户是戊波一 T3 的活，
 * 所以 T2 只写不跑，T3 重铺后运行：`bash scripts/on-stack.sh self test:e2e -- --testPathPattern ledger-flags`。
 *
 * 为什么看 status 数值而不是名字：`executeTransfer` 把 TB 的拒绝原样 JSON.stringify 进错误信息，
 * 状态是枚举数值（exceeds_debits = 55 / exceeds_credits = 54），名字不在字符串里。
 * 期望值取自 tigerbeetle-node 的 CreateTransferStatus 枚举，不手写数字。
 */
describe('Ledger non-negative flags (e2e, 戊波一 T2)', () => {
  jest.setTimeout(60000);

  const ledger = TB_LEDGERS.USDT;
  const run = `${Date.now()}`;

  let app: INestApplication;
  let accounting: AccountingService;
  let customerId: string;
  let walletId: string;

  let cashId: bigint;
  let suspenseId: bigint;
  let expenseOtherId: bigint;

  const evidence = (tag: string, debit: number, credit: number) => ({
    sourceType: 'E2E_LEDGER_FLAGS',
    sourceNo: `E2E-LEDGER-FLAGS-${run}-${tag}`,
    eventCode: 'E2E_LEDGER_FLAGS',
    traceId: `e2e-ledger-flags-${run}-${tag}`,
    debitCode: TB_CODE_TO_COA[debit],
    creditCode: TB_CODE_TO_COA[credit],
    assetCurrency: 'USDT',
    actorType: 'SYSTEM',
    actorId: 'E2E_HARNESS',
    memo: 'e2e: ledger non-negative flag check',
  });

  /** 借 − 贷（借方户可用额）/ 贷 − 借（贷方户可用额） */
  async function debitNet(id: bigint): Promise<bigint> {
    const b = await accounting.lookupBalance(id);
    return b.debitsPosted - b.creditsPosted;
  }
  async function creditNet(id: bigint): Promise<bigint> {
    const b = await accounting.lookupBalance(id);
    return b.creditsPosted - b.debitsPosted;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0);
    await app.init();

    const prisma = app.get(PrismaService);
    accounting = app.get(AccountingService);

    // demo_frank 是演示种子里的人设客户（带 TRON 收款地址）；已有 ACTIVE 地址则 createOrReturn 直接取回。
    const customer = await prisma.customerMain.findUnique({ where: { email: 'demo_frank@example.com' } });
    if (!customer) {
      throw new Error("Fixture customer demo_frank@example.com not found — reseed first (`bash scripts/stack.sh reset self`, `up`, `demo:all`).");
    }
    customerId = customer.id;

    const wallet = await app.get(CustomerDepositWalletService).createOrReturn(customerId, 'TRON');
    walletId = wallet.id;

    // 钱包 ACTIVE ⇒ 现金户已开：这一步找不到会直接抛 NotFoundException（resolveCashAccountId 不回落）。
    cashId = await accounting.resolveCashAccountId(walletId, ledger);
    suspenseId = await accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: customerId,
    });
    expenseOtherId = await accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.EXPENSE_OTHER, ledger, ownerType: 'SYSTEM',
    });

    // 先让现金户有 1,000 的借方余额（借现金 / 贷暂扣）——贷方户暂扣同时得到 1,000 贷方余额。
    await accounting.executeTransfer({
      debitAccountId: cashId,
      creditAccountId: suspenseId,
      amount: 1000n,
      ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: evidence('fund', TB_ACCOUNT_CODES.CLIENT_CASH, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE),
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('客户钱包的现金户存在，且可由 resolveCashAccountId 按钱包 id 取到', async () => {
    expect(cashId).toBeGreaterThan(0n);
    const again = await accounting.resolveCashAccountId(walletId, ledger);
    expect(again).toBe(cashId);
    // 借了 1,000 进去，借方净额至少 1,000
    expect(await debitNet(cashId)).toBeGreaterThanOrEqual(1000n);
  });

  it('借方户（现金 1）：贷记超过借方余额 → TB 拒绝（exceeds_debits），余额不变', async () => {
    const available = await debitNet(cashId); // 首次跑 = 1,000
    const over = available + 500n; // 首次跑 = 1,500；重复跑也必然超
    const before = await accounting.lookupBalance(cashId);

    // 借方放开约束的 SYSTEM 开支户（302），贷方是被检查的现金户：只会命中 exceeds_debits。
    const attempt = accounting.executeTransfer({
      debitAccountId: expenseOtherId,
      creditAccountId: cashId,
      amount: over,
      ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: evidence(`over-credit-${over}`, TB_ACCOUNT_CODES.EXPENSE_OTHER, TB_ACCOUNT_CODES.CLIENT_CASH),
    });
    await expect(attempt).rejects.toThrow(`"status":${CreateTransferStatus.exceeds_debits}`);

    const after = await accounting.lookupBalance(cashId);
    expect(after.creditsPosted).toBe(before.creditsPosted);
    expect(after.debitsPosted).toBe(before.debitsPosted);
  });

  it('贷方户（暂扣 101）：借记超过贷方余额 → TB 拒绝（exceeds_credits），余额不变', async () => {
    const available = await creditNet(suspenseId); // 首次跑 = 1,000
    const over = available + 500n;
    const before = await accounting.lookupBalance(suspenseId);

    // 暂扣在借方位置：TB 先查借方户的 debits_must_not_exceed_credits。贷方对手户 302 无贷方侧约束。
    const attempt = accounting.executeTransfer({
      debitAccountId: suspenseId,
      creditAccountId: expenseOtherId,
      amount: over,
      ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: evidence(`over-debit-${over}`, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, TB_ACCOUNT_CODES.EXPENSE_OTHER),
    });
    await expect(attempt).rejects.toThrow(`"status":${CreateTransferStatus.exceeds_credits}`);

    const after = await accounting.lookupBalance(suspenseId);
    expect(after.creditsPosted).toBe(before.creditsPosted);
    expect(after.debitsPosted).toBe(before.debitsPosted);
  });
});
