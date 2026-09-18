import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

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

import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SUMSUB_TXN_CLIENT } from '../src/modules/sumsub-shared/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/sumsub-shared/sumsub-txn-client.mock';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';

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

    // 专属 fixture 客户，不用 findFirstOrThrow() 抓来的"随便一个"——Task 4 后
    // Wallet 的唯一键是 (vaultCode, network, ownerNo)，抓到的客户若跨轮稳定，
    // 下面按 (CLIENT_DEPOSIT, AED_ZAND, customer.customerNo) 建的钱包在第二轮
    // 重跑（不重置库）时会撞同一把钥匙。customerNo 由 generateReferenceNo 现铸，
    // 每次 beforeAll 都不同。
    const asset = await prisma.asset.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    assetId = asset.id;
    const customerNo = generateReferenceNo('CU');
    const customer = await prisma.customerMain.create({
      data: {
        email: `e2e_kyt_landing_${customerNo}@example.com`.toLowerCase(),
        customerNo,
        phone: `+1${customerNo.replace(/\D/g, '')}`,
        firstName: 'Kyt', lastName: 'Landing',
        customerType: 'INDIVIDUAL',
        lifecycle: 'ACTIVE',
        riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
      },
    });
    customerId = customer.id;

    // DepositTransaction.toWalletId 是必填外键(schema 无 default)——自建一个钱包，
    // 不依赖种子库里现成的钱包布局。FROZEN → IGNORE 分支从不读钱包内容，这里只是
    // 满足外键约束。
    const wallet = await prisma.wallet.create({
      data: {
        walletNo: `WA-E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        ownerNo: customer.customerNo,
        vaultCode: 'CLIENT_DEPOSIT',
        walletRole: 'C_VIBAN',
        network: 'AED_ZAND',
        iban: `AE07086${Date.now().toString().padStart(16, '0').slice(-16)}`,
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
        correlationId: randomUUID(),
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
      where: { primarySubjectNo: dep.depositNo, action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  // 终审 Fix 4（2026-08-20）：这条用例直调 workflow.applyKytVerdict() 三次，绕过了
  // SumsubIngestionService 的 webhook 去重整层。它证明的是「审计层本身不去重」——
  // requestId 拼 randomUUID（业主拍板）关闭了 audit-logs 的去重能力，workflow 层连收
  // 3 次裁决就该老实写 3 行 IGNORED，不多不少。它**不**证明「真实 webhook 链路重复
  // 投递 3 次会送达 3 条」——那条路径先过 ingestion 层的去重（按 eventType+applicantId
  // 找最近一条 PROCESSED 事件比对），真重投在那一层就可能被拦截，是另一层的行为，
  // 不在本用例覆盖范围内。
  it('workflow 层连收 3 次相同的迟到 rejected（绕开 ingestion 去重层）→ 审计恰好写 3 行', async () => {
    const wd = await prisma.withdrawTransaction.create({
      data: {
        withdrawNo: `E2E-WD-${Date.now()}`,
        correlationId: randomUUID(),
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
      where: { primarySubjectNo: wd.withdrawNo, action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED },
    });
    expect(audits).toHaveLength(3);
  });

  it('验收5: REJECTED 兑换收到迟到 rejected → 仍跑处置，不写 IGNORED', async () => {
    const swap = await prisma.swapTransaction.create({
      data: {
        swapNo: `E2E-SWP-R-${Date.now()}`,
        correlationId: randomUUID(),
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
      .applyKytVerdict(swap.id, { verdict: 'rejected' });

    const ignored = await prisma.auditLogEvent.findMany({
      where: { primarySubjectNo: swap.swapNo, action: AuditActions.SWAP_KYT_VERDICT_IGNORED },
    });
    expect(ignored).toHaveLength(0);
  });

  it('验收6: SUCCESS 兑换收到迟到 approved → 写 IGNORED，不动订单', async () => {
    const swap = await prisma.swapTransaction.create({
      data: {
        swapNo: `E2E-SWP-S-${Date.now()}`,
        correlationId: randomUUID(),
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
      where: { primarySubjectNo: swap.swapNo, action: AuditActions.SWAP_KYT_VERDICT_IGNORED },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
