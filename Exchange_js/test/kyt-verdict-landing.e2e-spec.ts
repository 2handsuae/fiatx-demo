import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Node 18 polyfill：@nestjs/schedule 需要 globalThis.crypto（Node 19+ 才稳定），
// 本 harness 不加载 src/main.ts，所以要在 AppModule 之前自己补。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// 必须在任何读 DATABASE_URL 的 import 之前执行。
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-kyt-verdict-landing.db');
process.env.SUMSUB_MOCK_MODE = 'true';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── 破坏性护栏（2026-07-31 起，因为真的炸过两次）────────────────────────
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[kyt-verdict-landing e2e] 拒绝运行：本 suite 会写入并清理交易表，但 DATABASE_URL ` +
      `当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。` +
      `先按 Task 5 Step 1 建好 e2e- 专用库。`,
  );
}

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SUMSUB_TXN_CLIENT } from '../src/modules/deposit-sumsub/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/deposit-sumsub/sumsub-txn-client.mock';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';

describe('第一批 · 合规裁决落地 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerId: string;
  let assetId: string;
  let walletId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();
    app = moduleRef.createNestApplication();
    // 见 deposit-sumsub-verdicts.e2e-spec.ts 的同款注释：AppModule 挂了大量共享事件名的
    // @OnEvent handler，超过 EventEmitter2 默认 maxListeners=10 时，这套 Jest/Node 组合下
    // 「possible memory leak」警告会被抛成异常而不是打印警告。app.init() 之前把上限提高。
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);

    const customer = await prisma.customerMain.findFirstOrThrow();
    const asset = await prisma.asset.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    customerId = customer.id;
    assetId = asset.id;

    // DepositTransaction.toWalletId 是必填外键(schema 无 default)——自建一个钱包，
    // 不依赖种子库里现成的钱包布局。FROZEN → IGNORE 分支从不读钱包内容，这里只是
    // 满足外键约束。
    const wallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        ownerNo: customer.customerNo,
        type: 'FIAT_BANK',
        assetId,
        status: 'ACTIVE',
      },
    });
    walletId = wallet.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** 插一笔指定状态的充值单，带完整的既有裁决证据（模拟"已因制裁冻结"）。 */
  async function seedFrozenDeposit(no: string) {
    return prisma.depositTransaction.create({
      data: {
        depositNo: no,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        assetId,
        toWalletId: walletId,
        amount: '5000',
        status: DepositTransactionStatus.FROZEN,
        sumsubVerdict: 'rejected',
        sumsubScore: 100,
        sumsubTxnDetailJson: JSON.stringify({ sanction: 'OFAC-HIT' }),
      },
    });
  }

  it('验收1: FROZEN 制裁充值单收到迟到 onHold → 制裁证据一个字不动 + 留痕', async () => {
    const dep = await seedFrozenDeposit(`E2E-DEP-${Date.now()}`);

    await app
      .get(DepositWorkflowService)
      .applyKytVerdict(dep.id, { verdict: 'onHold', riskScore: 50, detailRaw: { late: true } });

    const after = await prisma.depositTransaction.findUniqueOrThrow({ where: { id: dep.id } });
    expect(after.sumsubVerdict).toBe('rejected');
    expect(after.sumsubScore).toBe(100);
    expect(after.sumsubTxnDetailJson).toBe(JSON.stringify({ sanction: 'OFAC-HIT' }));
    expect(after.status).toBe(DepositTransactionStatus.FROZEN);

    const audits = await prisma.auditLogEvent.findMany({
      where: { entityId: dep.id, action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it('验收3+4: SUCCESS 提现连收 3 条迟到 rejected → 审计恰好 3 行', async () => {
    const wd = await prisma.withdrawTransaction.create({
      data: {
        withdrawNo: `E2E-WD-${Date.now()}`,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        assetId,
        amount: '100',
        netAmount: '100',
        status: WithdrawTransactionStatus.SUCCESS,
      },
    });
    const workflow = app.get(WithdrawWorkflowService);

    for (let i = 0; i < 3; i += 1) {
      await workflow.applyKytVerdict(wd.id, { verdict: 'rejected', riskScore: 98 });
    }

    const audits = await prisma.auditLogEvent.findMany({
      where: { entityId: wd.id, action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED },
    });
    expect(audits).toHaveLength(3);
  });

  it('验收5: REJECTED 兑换收到迟到 rejected → 仍跑处置，不写 IGNORED', async () => {
    const swap = await prisma.swapTransaction.create({
      data: {
        swapNo: `E2E-SWP-R-${Date.now()}`,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        fromAssetId: assetId,
        toAssetId: assetId,
        fromAmount: '100',
        toAmount: '100',
        exchangeRate: '1',
        status: SwapTransactionStatus.REJECTED,
      },
    });

    await app
      .get(SwapWorkflowService)
      .applyKytVerdict(swap.id, { verdict: 'rejected', typedTags: ['SANCTION'] });

    const ignored = await prisma.auditLogEvent.findMany({
      where: { entityId: swap.id, action: AuditActions.SWAP_KYT_VERDICT_IGNORED },
    });
    expect(ignored).toHaveLength(0);
  });

  it('验收6: SUCCESS 兑换收到迟到 approved → 写 IGNORED，不动订单', async () => {
    const swap = await prisma.swapTransaction.create({
      data: {
        swapNo: `E2E-SWP-S-${Date.now()}`,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        fromAssetId: assetId,
        toAssetId: assetId,
        fromAmount: '100',
        toAmount: '100',
        exchangeRate: '1',
        status: SwapTransactionStatus.SUCCESS,
      },
    });

    await app.get(SwapWorkflowService).applyKytVerdict(swap.id, { verdict: 'approved' });

    const after = await prisma.swapTransaction.findUniqueOrThrow({ where: { id: swap.id } });
    expect(after.status).toBe(SwapTransactionStatus.SUCCESS);
    const audits = await prisma.auditLogEvent.findMany({
      where: { entityId: swap.id, action: AuditActions.SWAP_KYT_VERDICT_IGNORED },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
