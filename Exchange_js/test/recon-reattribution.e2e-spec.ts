import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (mirrors recon-adjustment-money-arcs.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AdjustmentService } from '../src/modules/clearing-settle/reconciliation/disposition/adjustment.service';
import { DispositionService } from '../src/modules/clearing-settle/reconciliation/disposition/disposition.service';
import { AdjustmentStatus } from '../src/modules/clearing-settle/reconciliation/constants/adjustment-transitions.constant';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';
import { ReconciliationQueryService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TbEvidenceService } from '../src/modules/accounting/tigerbeetle/tb-evidence.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { AuditActions, AuditEntityTypes } from '../src/modules/audit-logging/constants/audit-actions.constant';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';

/**
 * 平账一期半 e2e（Task 12）：**改记一单双案同愈** + **挂起不许让案子变绿**。
 *
 * 全链真跑，零 mock：真 TigerBeetle 转账 → 真审批中心（RECON_ADJUSTMENT_POST，
 * 单步 OPS_OFFICER）→ 真 @OnEvent(APPROVED) handler → AdjustmentService
 * .onApproved → postReattribution → AccountFlowProjectorService 真投影进
 * account_flows → WalletReconRunService.run() 真重对账。夹具搭法（fresh wallet、
 * 铺底两跳、外部对账单、waitUntil 轮询）逐段照抄同目录的
 * recon-adjustment-money-arcs.e2e-spec.ts —— 那份文件已实证过
 * 「真 TB 转账 → 真 recon rerun → 案件自愈」这条链，是本仓库现成的范本。
 *
 * ⚠ 本文件必须与其他 e2e **串行**跑（test/jest-e2e.json 的 `maxWorkers: 1`，
 *   完整原委写在那里）：它与 money-arcs 都调**全局**的
 *   WalletReconRunService.run()，并行时谁先落地谁就把对方的案子先自愈掉。
 *   要动那个开关，先读那段注释。
 *
 * ⚠ 夹具会往库里留真数据：createFixtureDeposit() 每跑一次给错记方客户
 *   （demo_carol）落一张 SUCCESS 充值单，客户端充值列表会逐次堆积这些假单。
 *   范本的 createFixtureWithdraw 是同款先例（不是本文件新引入的债）；嫌脏就
 *   `bash scripts/stack.sh reset <main|self>` 重铺。
 *
 * ── 场景 A 要证的业务事实 ──────────────────────────────────────────────
 * 一笔钱记错了客户：**钱在托管方那里一分没动，只是我方把主人记错了**。
 * 所以分录是两个客户的应付对转：
 *     借 错记方客户应付 CLIENT_PAYABLE (ownerUuid = A)
 *     贷 正主方客户应付 CLIENT_PAYABLE (ownerUuid = B)
 *     客户资产腿 CLIENT_ASSET 绝不出现 —— 托管里的钱没进也没出
 * 这一条**用行为证明**：把两条真实 account_flows 的 tbAccountId 回查
 * tb_account_registry，断言两边的 code 都是 CLIENT_PAYABLE、且 ownerNo 一边是
 * 错记方一边是正主方。不去 grep 源码文本（本仓库为「扫源码文本」型断言的
 * 自证绿灯栽过六次）。
 *
 * 一张改记单同时牵两个案件、各带一个证据锚（错记方内部流水 id + 正主方外部
 * 对账单行 id），落账后**一次重对账两个案子一起自愈**——这一半靠的是
 * ExplainedDifferenceService.indexForWallet 的 `OR: [{walletRef},{toWalletRef}]`：
 * 改记单挂在错记方名下，正主方那一轮必须也查得到它，否则正主方那条
 * 「外有我无」永远算不上已解释，双案同愈就断掉一半。
 *
 * ── 场景 B 要证的业务事实 ──────────────────────────────────────────────
 * 财务查证结论是「查不出（已穷尽调查）」时，系统**不落任何分录**，案子必须
 * **照旧是破口**。夹具刻意把余额差做成 0，让案子唯一的存活理由就是那条
 * 没被解释的差异行——于是「谁改了引擎让挂起把案子关掉」这类回归会当场红。
 */
describe('Recon reattribution + disposition behaviour (e2e, Task 12)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let adjustments: AdjustmentService;
  let dispositions: DispositionService;
  let walletRecon: WalletReconRunService;
  let reconQuery: ReconciliationQueryService;
  let accounting: AccountingService;
  let tbEvidence: TbEvidenceService;
  let approvalsService: ApprovalsService;

  let aedAssetId: string;
  let aedCode: string; // 'AED' — 法币 code == currency，避开 code≠currency 那个坑（那条已由 money-arcs 场景 8 锁住）

  let carolId: string;
  let carolNo: string;
  let daveId: string;
  let daveNo: string;

  // 截止点钉在 wall-clock now 之后几天：本文件所有夹具写入的 effectiveDate 都是
  // 默认的「今天」，于是 effectiveCutoffFilter 的 `effectiveDate < businessDate`
  // 这一支无条件成立，取数不依赖 createdAt 与 cutoff 的毫秒先后（同范本）。
  // 也顺带把本文件的对账 run 与库里既有的演示案件（业务日在过去）隔开：
  // external_balances 按 cutoffDate 精确取，别的业务日的钱包本轮压根不在场。
  let CUTOFF: Date;
  let TODAY: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    adjustments = app.get(AdjustmentService);
    dispositions = app.get(DispositionService);
    walletRecon = app.get(WalletReconRunService);
    reconQuery = app.get(ReconciliationQueryService);
    accounting = app.get(AccountingService);
    tbEvidence = app.get(TbEvidenceService);
    approvalsService = app.get(ApprovalsService);

    CUTOFF = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    TODAY = new Date().toISOString().slice(0, 10);

    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    if (!aed || !aed.tbLedgerId) {
      throw new Error('Fixture asset AED not seeded (or missing tbLedgerId) — run `npm run db:biz:init` first.');
    }
    aedAssetId = aed.id;
    aedCode = aed.code;

    const carol = await (prisma as any).customerMain.findUnique({ where: { email: 'demo_carol@example.com' } });
    const dave = await (prisma as any).customerMain.findUnique({ where: { email: 'demo_dave@example.com' } });
    if (!carol || !dave) {
      throw new Error(
        "Fixture customers demo_carol@example.com / demo_dave@example.com not found — this worktree's " +
          'self-stack DB needs business seed data first: `DATABASE_URL=... TB_ADDRESS=... npm run db:biz:init`.',
      );
    }
    carolId = carol.id;
    carolNo = carol.customerNo;
    daveId = dave.id;
    daveNo = dave.customerNo;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── helpers（照抄 recon-adjustment-money-arcs.e2e-spec.ts）────────────────

  // userId 必须 ≠ userNo：两者塌缩成同一个字符串时，「审批/审计到底取的是
  // userId 还是 userNo」这类取错字段的回归测不出差别（范本里写明的同一个理由）。
  function makeActor(userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId: `uuid-${userNo}`, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 8000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /** 全新客户钱包——绝不复用种子钱包：本仓 e2e 没有 maxWorkers 钉死，
   *  别的 spec 文件的并发 worker 会往同一个物理钱包上落真实流水（范本头注释
   *  论证过同一件事），共用等于让本文件的余额断言随机翻车。 */
  async function createCustomerWallet(opts: {
    ownerId: string; ownerNo: string; assetId: string; walletRole: 'C_VIBAN' | 'C_DEP'; type: string; iban?: string;
  }): Promise<{ id: string }> {
    return (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-REATTR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'CUSTOMER', ownerId: opts.ownerId, ownerNo: opts.ownerNo,
        type: opts.type, walletRole: opts.walletRole, assetId: opts.assetId,
        iban: opts.iban ?? null, status: 'ACTIVE',
      },
      select: { id: true },
    });
  }

  /** 全新公司钱包——同样不碰种子的 F_FEE（那是共享聚合户，提现/兑换套件会往上
   *  真的落手续费收入）。ownerType:'PLATFORM' 与种子惯例一致，R2 校验按
   *  FIRM_SIDE={PLATFORM,SYSTEM} 放行。 */
  async function createFirmWallet(opts: { assetId: string; walletRole: string; type: string }): Promise<{ id: string }> {
    return (prisma as any).wallet.create({
      data: {
        walletNo: `WA-E2E-REATTR-FIRM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerType: 'PLATFORM', ownerId: null, ownerNo: 'PLATFORM',
        type: opts.type, walletRole: opts.walletRole, assetId: opts.assetId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
  }

  /**
   * 客户钱包铺底：与 deposit-workflow.service.ts 生产里的两跳完全同形
   * （Step 1 CLIENT_ASSET→DEPOSIT_SUSPENSE 真实外部穿越，Step 2
   * DEPOSIT_SUSPENSE→CLIENT_PAYABLE 纯账面重分类），两腿都盖 walletRef。
   * 对这个钱包 (PAYABLE+SUSPENSE) 的净效果 = +amount。
   *
   * Step 1 传 isExternalCrossing:true + externalRef —— 本文件要的正是「一条真实
   * 的、外部对账单上本该有的入账」：外部对账单上没有它，它就是那条
   * 「我有外无」的差异行（ORPHAN_INTERNAL），也就是改记单要锚住的证据。
   */
  async function fundCustomerWallet(opts: {
    walletId: string; ownerId: string; ledger: number; currency: string; amount: bigint; tag: string; externalRef: string;
  }): Promise<string> {
    // 随机后缀（不能只用 Date.now()）：TB 的 transfer id 是
    // (sourceType, sourceNo, eventCode) 的确定性哈希且跨 jest 调用长存于本
    // worktree 的 TB 文件里；撞上等于 executeTransfer 认作「已存在」直接静默跳过
    // 本轮的证据/流水写入，钱包内部余额停在 0 而且哪儿都不报错。
    const sourceNo = `E2E-REATTR-FUND-${opts.tag}-${randomUUID().slice(0, 8)}`;

    const clientAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: opts.ledger, ownerType: 'SYSTEM' });
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: opts.ledger, ownerType: 'CUSTOMER', ownerUuid: opts.ownerId });

    await accounting.executeTransfer({
      debitAccountId: clientAssetId,
      creditAccountId: suspenseId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: 记在错记方名下的那笔真实入账（Step 1，真实外部穿越）',
        debitWalletRef: opts.walletId,
        creditWalletRef: opts.walletId,
        externalRef: opts.externalRef,
        isExternalCrossing: true,
      },
    });

    await accounting.executeTransfer({
      debitAccountId: suspenseId,
      creditAccountId: payableId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: 记在错记方名下的那笔真实入账（Step 2，纯账面重分类）',
        debitWalletRef: opts.walletId,
        creditWalletRef: opts.walletId,
        // 生产同款：Step 2 不是外部穿越，外部对账单上不会有它。
        isExternalCrossing: false,
      },
    });

    return sourceNo;
  }

  /**
   * 公司钱包铺底（场景 B 用）：DR FIRM_ASSET / CR INCOME_OTHER。
   * WalletBalanceChecker 对公司钱包只认 200/201/210/211/212，聚合腿 FIRM_ASSET(50)
   * 被丢掉，所以这个钱包的内部余额 = +amount。
   * 这里刻意传 isExternalCrossing:true + externalRef —— 场景 B 要的是一条
   * **能与外部对账单行按单号配上、但金额对不上**的真实流水（AMOUNT_MISMATCH）。
   */
  async function fundFirmWallet(opts: {
    walletId: string; ledger: number; currency: string; amount: bigint; tag: string; externalRef: string;
  }): Promise<void> {
    const sourceNo = `E2E-REATTR-FIRMFUND-${opts.tag}-${randomUUID().slice(0, 8)}`;
    const firmAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger: opts.ledger, ownerType: 'SYSTEM' });
    const incomeOtherId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.INCOME_OTHER, ledger: opts.ledger, ownerType: 'SYSTEM' });

    await accounting.executeTransfer({
      debitAccountId: firmAssetId,
      creditAccountId: incomeOtherId,
      amount: opts.amount,
      ledger: opts.ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        sourceType: 'DEPOSIT',
        sourceNo,
        eventCode: 'E2E_FIRM_FIXTURE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_OTHER],
        assetCurrency: opts.currency,
        traceId: sourceNo,
        actorType: 'SYSTEM',
        actorId: 'E2E_HARNESS',
        memo: 'e2e fixture: 公司钱包一笔银行入账（金额与银行单对不上）',
        debitWalletRef: opts.walletId,
        creditWalletRef: opts.walletId,
        externalRef: opts.externalRef,
        isExternalCrossing: true,
      },
    });
  }

  async function upsertExternalBalance(opts: {
    walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; closingBalance: bigint;
  }): Promise<void> {
    const cutoffDate = CUTOFF.toISOString().slice(0, 10);
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source: 'ZAND', accountRef: opts.walletId, cutoffDate } },
      create: {
        source: 'ZAND', accountRef: opts.walletId, currency: opts.currency, book: opts.book,
        cutoffDate, closingBalance: opts.closingBalance.toString(), walletRef: opts.walletId,
      },
      update: { closingBalance: opts.closingBalance.toString() },
    });
  }

  /** 外部对账单行——subAccount 盖成钱包 id（ZAND 把 VirtualAccount / 托管子账户
   *  号填在这一列），run 的 fetchExternalLinesForWallet 就按它圈定本钱包的行。
   *  datetime 用 now：远早于 CUTOFF，两处 `datetime <= cutoff` 过滤都进得来。 */
  async function createExternalLine(opts: {
    walletId: string; currency: string; book: 'CLIENT' | 'FIRM';
    direction: 'IN' | 'OUT'; amount: bigint; externalRef: string; description?: string;
  }): Promise<{ id: string }> {
    return (prisma as any).externalStatementLine.create({
      data: {
        source: 'ZAND',
        accountRef: opts.walletId,
        subAccount: opts.walletId,
        book: opts.book,
        currency: opts.currency,
        direction: opts.direction,
        amount: opts.amount.toString(),
        externalRef: opts.externalRef,
        datetime: new Date(),
        description: opts.description ?? 'Incoming',
        dedupKey: `E2E-REATTR-${randomUUID()}`,
      },
      select: { id: true },
    });
  }

  async function openCaseFor(walletId: string) {
    return (prisma as any).reconciliationCase.findFirst({
      where: { walletRef: walletId, status: 'OPEN' },
    });
  }

  async function latestApprovalCase(actionType: string, entityRef: string) {
    return (prisma as any).approvalCase.findFirst({
      where: { actionType, entityRef },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function adjustmentRow(adjustmentNo: string) {
    return (prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
  }

  async function flowsFor(adjustmentNo: string) {
    return (prisma as any).accountFlow.findMany({ where: { sourceType: 'RECON_ADJUSTMENT', sourceNo: adjustmentNo } });
  }

  /** tb_account_registry 存的是 32 位补零形式，account_flows.tbAccountId 可能是
   *  31 位未补零——两侧都补齐再 join（同 WalletFlowMatcherService 的 padTbId，
   *  少了这一步会查不到注册行、断言变成「查不到所以没红」的假绿）。 */
  const padTbId = (id: string) => (id.length < 32 ? id.padStart(32, '0') : id);

  async function registryOf(tbAccountId: string): Promise<{ code: number; ownerType: string; ownerNo: string | null }> {
    const reg = await (prisma as any).tbAccountRegistry.findUnique({
      where: { tbAccountId: padTbId(tbAccountId) },
      select: { code: true, ownerType: true, ownerNo: true },
    });
    if (!reg) throw new Error(`tb_account_registry 查无此账户：${tbAccountId}（补零后 ${padTbId(tbAccountId)}）`);
    return reg;
  }

  /** 真实充值单 fixture——改记的边界线守卫（createReattributionDraft）会真的按
   *  relatedOrderNo 去三张单表查存在性，编一个字符串过不了。业务叙事上它就是
   *  「记在错记方名下的那笔真实充值」：收款钱包 = 错记方钱包，户主 = 错记方。 */
  async function createFixtureDeposit(opts: {
    ownerId: string; assetId: string; toWalletId: string; amount: string;
  }): Promise<{ depositNo: string }> {
    const depositNo = generateReferenceNo('DEP');
    await (prisma as any).depositTransaction.create({
      data: {
        depositNo,
        ownerType: 'CUSTOMER', ownerId: opts.ownerId,
        status: 'SUCCESS',
        assetId: opts.assetId,
        toWalletId: opts.toWalletId,
        amount: opts.amount,
        netAmount: opts.amount,
      },
    });
    return { depositNo };
  }

  // ── 场景 A · 改记一单双案同愈 ────────────────────────────────────────────

  it('A. 改记一单双案同愈：两案 OPEN → 定性 MISATTRIBUTED_FROM → 对端候选命中 → 一张改记单（应付对转，资产腿不动）→ 真批真落账 → 一次重对账两案齐愈', async () => {
    const ledger = 1; // AED
    const X = 87500n; // AED 875.00 —— 被记错主人的那一笔

    // 错记方（carol）：钱真进了我们的账，记在她名下；银行对账单上根本没有这一笔
    // （因为这笔钱在银行那边是打给 dave 的）。
    const fromWallet = await createCustomerWallet({
      ownerId: carolId, ownerNo: carolNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK',
      iban: `AE_E2E_REATTR_FROM_${Date.now()}`,
    });
    const crossingRef = `ZANDREF-E2E-REATTR-FROM-${randomUUID().slice(0, 8)}`;
    await fundCustomerWallet({
      walletId: fromWallet.id, ownerId: carolId, ledger, currency: aedCode, amount: X,
      tag: 'FROM', externalRef: crossingRef,
    });
    // 外部对账单：这个钱包上一分钱都没有 → 差额 = 0 − X = −X。
    await upsertExternalBalance({ walletId: fromWallet.id, currency: aedCode, book: 'CLIENT', closingBalance: 0n });

    // 正主方（dave）：银行那边真收到了这笔钱，我方内部一分没记。
    const toWallet = await createCustomerWallet({
      ownerId: daveId, ownerNo: daveNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_BANK',
      iban: `AE_E2E_REATTR_TO_${Date.now()}`,
    });
    const toExternalRef = `ZANDREF-E2E-REATTR-TO-${randomUUID().slice(0, 8)}`;
    const toLine = await createExternalLine({
      walletId: toWallet.id, currency: aedCode, book: 'CLIENT', direction: 'IN', amount: X,
      externalRef: toExternalRef, description: 'Incoming (真正的收款人)',
    });
    await upsertExternalBalance({ walletId: toWallet.id, currency: aedCode, book: 'CLIENT', closingBalance: X });

    // ── ① 第一次对账：两个案子各自 OPEN ────────────────────────────────
    const run1 = await walletRecon.run({ cutoff: CUTOFF });
    expect(run1.status).toBe('BREAK');

    const fromCase = await openCaseFor(fromWallet.id);
    const toCase = await openCaseFor(toWallet.id);
    expect(fromCase).toBeTruthy();
    expect(toCase).toBeTruthy();
    expect(fromCase.book).toBe('CUSTOMER');
    expect(toCase.book).toBe('CUSTOMER');
    expect(fromCase.ownerNo).toBe(carolNo);
    expect(toCase.ownerNo).toBe(daveNo);
    expect(String(fromCase.deltaAmount)).toBe(`-${X}`); // 外部 0 − 内部 X
    expect(String(toCase.deltaAmount)).toBe(String(X));  // 外部 X − 内部 0
    // 改记开单要求两案同业务日（跨日改记本轮不做）——同一次 run 天然同日。
    expect(fromCase.businessDate).toBe(toCase.businessDate);

    // 差异行：错记方一条「我有外无」，正主方一条「外有我无」。
    const fromItems = await (prisma as any).reconciliationLineItem.findMany({ where: { caseId: fromCase.id } });
    const fromOrphan = fromItems.find((l: any) => l.matchStatus === 'ORPHAN_INTERNAL');
    expect(fromOrphan).toBeTruthy();
    expect(fromOrphan.status).toBe('OPEN');
    expect(String(fromOrphan.internalAmount)).toBe(String(X));

    const toItems = await (prisma as any).reconciliationLineItem.findMany({ where: { caseId: toCase.id } });
    const toOrphan = toItems.find((l: any) => l.matchStatus === 'ORPHAN_EXTERNAL');
    expect(toOrphan).toBeTruthy();
    expect(toOrphan.status).toBe('OPEN');
    expect(toOrphan.externalTxId).toBe(toLine.id);

    // ── ② 定性：错记方这一行是「记错客户——这笔钱是别人的」 ──────────────
    const disposition = await dispositions.record(
      fromCase.caseNo,
      {
        matchType: 'ORPHAN_INTERNAL',
        explainedFlowId: fromOrphan.internalSourceId,      // 锚在真实内部流水上
        causeCode: 'MISATTRIBUTED_FROM',
        findingNote: 'e2e：对端钱包同日同额「外有我无」成对，银行回单收款人是另一位客户',
        internalDirection: fromOrphan.internalDirection as 'IN' | 'OUT',
      } as any,
      makeActor('E2E_OPS_CREATOR_A', 'OPS_OFFICER'),
    );
    // 出口由注册表机器判定，不是人手挑的：改记族 → ADJUST_REATTRIBUTE。
    expect(disposition.outlet).toBe('ADJUST_REATTRIBUTE');
    expect(disposition.family).toBe('REATTRIBUTE');
    expect(disposition.reasonCode).toBe('CUSTOMER_REATTRIBUTION');

    // ── ③ 对端候选：同业务日 · 同资产 · 同金额 · 反向孤儿的开放案件 ────────
    const candidates = await dispositions.listReattributionCandidates(fromCase.caseNo, 'FROM', String(X));
    // 用 find 不用 length===1：库里可能有别的同日同额开放案件（并发 spec / 演示
    // 数据），本条要证的是「正主方那一案确实被找出来了、锚指对了」，不是候选集大小。
    const hit = candidates.find((c) => c.caseNo === toCase.caseNo);
    expect(hit).toBeTruthy();
    expect(hit!.ownerNo).toBe(daveNo);
    expect(hit!.amount).toBe(String(X));
    // 锚必须是外部对账单行 id（跨轮稳定的真实证据），不是每轮重建的差异行 id。
    expect(hit!.anchorId).toBe(toLine.id);
    expect(hit!.externalRef).toBe(toExternalRef);

    // ── ④ 开改记单 → 提交 → 真审批 → 等 handler 真落账 ────────────────────
    // 边界线守卫：改记必须指向一张真实存在的原单（KYT 对这笔钱跑过才放行）。
    // 叙事上就是那笔被记错主人的充值——收款钱包 = 错记方钱包。
    const originalDeposit = await createFixtureDeposit({
      ownerId: carolId, assetId: aedAssetId, toWalletId: fromWallet.id, amount: String(X),
    });

    const { adjustmentNo } = await adjustments.createDraft(
      {
        caseNo: fromCase.caseNo,                          // 错记方案件
        toCaseNo: toCase.caseNo,                          // 正主方案件
        reasonCode: 'CUSTOMER_REATTRIBUTION',
        direction: 'REDUCE',                              // 改记不吃 book×direction 语义，落库会被改写成 REATTRIBUTE
        amount: String(X),
        effectiveDate: TODAY,
        explainedFlowId: fromOrphan.internalSourceId,     // 锚一：错记方内部流水
        explainedExternalLineId: hit!.anchorId,           // 锚二：正主方外部对账单行
        relatedOrderNo: originalDeposit.depositNo,
        dispositionNo: disposition.dispositionNo,         // 定性联动：开单成功即回填并锁死该定性
        reasonInternal: 'e2e：这笔钱是 dave 的，被记到了 carol 名下',
        reasonCustomer: '账户更正划转',
      } as any,
      makeActor('E2E_OPS_CREATOR_A', 'OPS_OFFICER'),
    );
    expect(adjustmentNo).toMatch(/^ADJ/);

    const draft = await adjustmentRow(adjustmentNo);
    expect(draft.status).toBe(AdjustmentStatus.DRAFT);
    // direction 落 'REATTRIBUTE'（不是入参的 REDUCE）——分录由族定，不走 book×direction。
    expect(draft.direction).toBe('REATTRIBUTE');
    expect(draft.book).toBe('CLIENT');
    expect(draft.ownerNo).toBe(carolNo);
    expect(draft.toOwnerNo).toBe(daveNo);

    // 定性联动真的回填了（linkAdjustment 的行为证明）。
    const linkedDisposition = await (prisma as any).reconciliationDisposition.findUnique({
      where: { dispositionNo: disposition.dispositionNo },
    });
    expect(linkedDisposition.adjustmentNo).toBe(adjustmentNo);

    await adjustments.submit(adjustmentNo, makeActor('E2E_OPS_CREATOR_A', 'OPS_OFFICER'));
    expect((await adjustmentRow(adjustmentNo)).status).toBe(AdjustmentStatus.PENDING_APPROVAL);

    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    expect(approvalCase).toBeTruthy();
    expect(approvalCase.status).toBe('PENDING');
    // 审批页要看得见钱去了谁名下——只看到「错记方少了一笔」的审批就是橡皮图章。
    expect(JSON.parse(approvalCase.objectSnapshot).toOwnerNo).toBe(daveNo);

    await approvalsService.approve(
      approvalCase.id, { reason: 'e2e approve reattribution' }, makeActor('E2E_OPS_APPROVER_A', 'OPS_OFFICER'),
    );

    // ⚠ 落账在 @OnEvent(APPROVED) handler 里异步跑，handler 抛的异常本仓库现状
    // 不外传（PRODUCTION-NOTES 2026-08-28）——这里超时就是落账真的抛错了，
    // 不是轮询写短了。
    await waitUntil(async () => (await adjustmentRow(adjustmentNo)).status === AdjustmentStatus.POSTED);

    // ── ⑤ 账本：应付对转，客户资产腿绝不出现 ───────────────────────────────
    const flows = await flowsFor(adjustmentNo);
    expect(flows).toHaveLength(2); // 只有两条腿——没有第三条资产腿

    const outLeg = flows.find((f: any) => f.direction === 'OUT');
    const inLeg = flows.find((f: any) => f.direction === 'IN');
    expect(outLeg).toBeTruthy();
    expect(inLeg).toBeTruthy();
    // 两腿各落各的钱包：错记方降、正主方升——两案的差额才各自归零。
    expect(outLeg.walletRef).toBe(fromWallet.id);
    expect(inLeg.walletRef).toBe(toWallet.id);
    expect(String(outLeg.amount)).toBe(String(X));
    expect(String(inLeg.amount)).toBe(String(X));
    for (const f of flows) {
      expect(f.sourceNo).toBe(adjustmentNo);
      // 纯账面重分类，不出现在任何外部账单上——置 true 会被匹配器当成新的孤儿行。
      expect(f.isExternalCrossing).toBe(false);
      expect(f.assetCode).toBe(aedCode);
      expect(f.effectiveDate).toBe(TODAY);
    }

    // ★ 资产腿不动的**行为证明**：把两条流水的 tbAccountId 回查注册表，
    //   科目对必须是 CLIENT_PAYABLE ↔ CLIENT_PAYABLE，且一边挂错记方、一边挂正主方。
    //   （断言的是 TB 真的动了哪两个账户，不是源码里写了什么。）
    const outReg = await registryOf(outLeg.tbAccountId);
    const inReg = await registryOf(inLeg.tbAccountId);
    expect(outReg.code).toBe(TB_ACCOUNT_CODES.CLIENT_PAYABLE);
    expect(inReg.code).toBe(TB_ACCOUNT_CODES.CLIENT_PAYABLE);
    expect(outReg.code).not.toBe(TB_ACCOUNT_CODES.CLIENT_ASSET); // 托管里的钱没进也没出
    expect(inReg.code).not.toBe(TB_ACCOUNT_CODES.CLIENT_ASSET);
    expect(outReg.ownerType).toBe('CUSTOMER');
    expect(inReg.ownerType).toBe('CUSTOMER');
    expect(outReg.ownerNo).toBe(carolNo); // 借：从错记方名下拿走
    expect(inReg.ownerNo).toBe(daveNo);   // 贷：记到正主方名下
    expect(outReg.ownerNo).not.toBe(inReg.ownerNo); // 两腿必须是**不同**客户的应付户

    // 凭证侧同一结论（写的人说的）与上面注册表侧（TB 真做的）互为交叉验证。
    const evidence = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    expect(evidence[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    expect(evidence[0].debitCode).not.toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect(evidence[0].creditCode).not.toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect(evidence[0].actorId).toBe('E2E_OPS_APPROVER_A');

    // 铁律①：正主方 B 的余额真的变了，按 B 也必须查得到这条审计（本仓第一个双 OWNER 事件）。
    const auditEvent = await (prisma as any).auditLogEvent.findFirst({
      where: {
        primarySubjectType: AuditEntityTypes.RECON_ADJUSTMENT,
        primarySubjectNo: adjustmentNo,
        action: AuditActions.RECON_ADJUSTMENT_POSTED,
      },
    });
    expect(auditEvent).toBeTruthy();
    expect(auditEvent.actorNo).toBe('E2E_OPS_APPROVER_A');
    const auditSubjects = await (prisma as any).auditLogSubject.findMany({ where: { eventId: auditEvent.id } });
    const owners = auditSubjects.filter((s: any) => s.subjectType === 'CUSTOMER' && s.subjectRole === 'OWNER').map((s: any) => s.subjectNo);
    expect(owners).toContain(carolNo);
    expect(owners).toContain(daveNo);

    // ── ⑦ 挂单锁：定性已挂调账单，同锚再定性一次必须被拒 ────────────────────
    // ⚠ 必须**趁案子还 OPEN** 做这一步：案子一旦被重对账关掉，record() 会先撞上
    //   「只能对打开中的案件定性」那道闸，抛的是同一个 BadRequestException——
    //   拒绝理由被换掉，挂单锁即使被删也照样绿（本批已栽过同形的遮蔽）。
    //   所以下面断言的是**具体的拒绝理由**，不是「抛了 BadRequest 就算过」。
    expect((await (prisma as any).reconciliationCase.findUnique({ where: { id: fromCase.id } })).status).toBe('OPEN');
    const overwriteAttempt = dispositions.record(
      fromCase.caseNo,
      {
        matchType: 'ORPHAN_INTERNAL',
        explainedFlowId: fromOrphan.internalSourceId, // 同一个锚
        causeCode: 'PHANTOM_BOOKING',                 // 换个结论想覆盖
        findingNote: 'e2e：单已开出后想改口，必须被拒',
        internalDirection: fromOrphan.internalDirection as 'IN' | 'OUT',
      } as any,
      makeActor('E2E_OPS_CREATOR_A2', 'OPS_OFFICER'),
    );
    await expect(overwriteAttempt).rejects.toThrow(BadRequestException);
    // 拒绝理由必须点名那张单——只断言异常类型的话，案子状态闸、成因闸、锚缺失闸
    // 抛的是同一个 BadRequestException，挂单锁被删了照样绿。
    await expect(overwriteAttempt).rejects.toThrow(new RegExp(`该行定性已挂调账单 ${adjustmentNo}`));

    // 定性没有被改掉：库里仍是当初那条结论，仍挂着那张单。
    const afterLock = await (prisma as any).reconciliationDisposition.findUnique({
      where: { dispositionNo: disposition.dispositionNo },
    });
    expect(afterLock.causeCode).toBe('MISATTRIBUTED_FROM');
    expect(afterLock.adjustmentNo).toBe(adjustmentNo);

    // ── ⑥ 一次重对账，两个案子一起自愈 ────────────────────────────────────
    const run2 = await walletRecon.run({ cutoff: CUTOFF });

    // 本轮这两个钱包的真实读数在 run 快照上——案件行只在「仍是破口」时才被刷新，
    // 桶回 MATCHED 后引擎压根不碰它，所以不能拿 case.deltaAmount 当本轮结论。
    const fromSnap = await (prisma as any).reconciliationRunWallet.findFirst({
      where: { runId: run2.runId, walletRef: fromWallet.id },
    });
    const toSnap = await (prisma as any).reconciliationRunWallet.findFirst({
      where: { runId: run2.runId, walletRef: toWallet.id },
    });
    expect(fromSnap).toBeTruthy();
    expect(toSnap).toBeTruthy();

    // 错记方：内部余额被改记单扣回到 0，与外部真值（0）一致。
    expect(String(fromSnap.internalTotal)).toBe('0');
    expect(String(fromSnap.deltaAmount)).toBe('0');
    // 正主方：内部余额从 0 长到 X，与银行给的收盘（X）一致。
    expect(String(toSnap.internalTotal)).toBe(String(X));
    expect(String(toSnap.deltaAmount)).toBe('0');
    // 两条差异行都还在（是证据，要给人看），但都已被这张单解释 → 不算异常 → 桶回 MATCHED。
    expect(fromSnap.orphanInternal).toBe(1);
    expect(toSnap.orphanExternal).toBe(1);
    expect(fromSnap.bucket).toBe('MATCHED');
    expect(toSnap.bucket).toBe('MATCHED');

    // 业主要的那句话：**两个案子都关掉了，而且是同一次重对账关的。**
    const fromHealed = await (prisma as any).reconciliationCase.findUnique({ where: { id: fromCase.id } });
    const toHealed = await (prisma as any).reconciliationCase.findUnique({ where: { id: toCase.id } });
    expect(fromHealed.status).toBe('RESOLVED');
    expect(toHealed.status).toBe('RESOLVED');
    expect(fromHealed.resolutionReason).toBe('AUTO_HEALED');
    expect(toHealed.resolutionReason).toBe('AUTO_HEALED');
    expect(fromHealed.closedByRunId).toBe(run2.runId);
    expect(toHealed.closedByRunId).toBe(run2.runId);

    // 案件页上两边各自的那一行都写着「已被 ADJxxx 解释」——操作员唯一看得到的地方。
    // 正主方能看到这张挂在错记方名下的单，靠的是 indexForWallet 的
    // `OR: [{walletRef},{toWalletRef}]`；少了 toWalletRef 这一半，双案同愈就断掉一半。
    const fromView: any = await reconQuery.getCase(fromCase.caseNo);
    const fromRow = fromView.flowComparison.find((r: any) => r.matchType === 'ORPHAN_INTERNAL');
    expect(fromRow).toBeTruthy();
    expect(fromRow.explainedByAdjustmentNo).toBe(adjustmentNo);
    // 行上也回贴着当初的定性结论（成因 + 出口 + 已挂的单号）。
    expect(fromRow.disposition).toBeTruthy();
    expect(fromRow.disposition.causeCode).toBe('MISATTRIBUTED_FROM');
    expect(fromRow.disposition.outlet).toBe('ADJUST_REATTRIBUTE');
    expect(fromRow.disposition.adjustmentNo).toBe(adjustmentNo);

    const toView: any = await reconQuery.getCase(toCase.caseNo);
    const toRow = toView.flowComparison.find((r: any) => r.matchType === 'ORPHAN_EXTERNAL');
    expect(toRow).toBeTruthy();
    expect(toRow.externalLine.id).toBe(toLine.id);
    expect(toRow.explainedByAdjustmentNo).toBe(adjustmentNo);
  });

  // ── 场景 B · 挂起不许让案子变绿 ──────────────────────────────────────────

  it('B. 挂起不许绿：定性「查不出」→ 出口 HOLD_INVESTIGATING → 零分录 → 重跑对账案子仍是 OPEN，行上带得到成因注解', async () => {
    const ledger = 1; // AED
    const BOOKED = 5000n;   // 我方记的：AED 50.00
    const ON_STATEMENT = 4900n; // 银行单上同一笔：AED 49.00 —— 差 1 块钱，查不出为什么

    // 公司池：ownerNo 为空，不牵连任何客户（也天然不会跟场景 A 的客户案件串成
    // 改记候选——候选按 book 过滤）。
    const wallet = await createFirmWallet({ assetId: aedAssetId, walletRole: 'F_FEE', type: 'FIAT_BANK' });
    const ref = `ZANDREF-E2E-REATTR-B-${randomUUID().slice(0, 8)}`;
    await fundFirmWallet({ walletId: wallet.id, ledger, currency: aedCode, amount: BOOKED, tag: 'B', externalRef: ref });
    const line = await createExternalLine({
      walletId: wallet.id, currency: aedCode, book: 'FIRM', direction: 'IN', amount: ON_STATEMENT,
      externalRef: ref, description: 'Incoming (金额与我方所记不符)',
    });
    // ⚠ 收盘余额刻意与内部一致 → 余额差 = 0。于是这个案子**唯一**的存活理由就是
    //   那条没被解释的差异行（桶 = SOFT_FLAG）。这一点是本条用例的锋利之处：
    //   哪天谁让「挂起」也算解释、把异常数抹掉，桶就会滑到 MATCHED、案子被自愈关掉，
    //   这条测试当场红。余额差不为零的写法测不出那种回归。
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'FIRM', closingBalance: BOOKED });

    const run1 = await walletRecon.run({ cutoff: CUTOFF });
    expect(run1.status).toBe('BREAK');

    const kase = await openCaseFor(wallet.id);
    expect(kase).toBeTruthy();
    expect(kase.book).toBe('FIRM');
    expect(kase.ownerNo).toBeNull();
    expect(String(kase.deltaAmount)).toBe('0');  // 余额平
    expect(kase.bucket).toBe('SOFT_FLAG');       // 但流水配不上 → 假匹配，案子照开

    const items = await (prisma as any).reconciliationLineItem.findMany({ where: { caseId: kase.id } });
    const mismatchRow = items.find((l: any) => l.matchStatus === 'AMOUNT_MISMATCH');
    expect(mismatchRow).toBeTruthy();
    expect(String(mismatchRow.internalAmount)).toBe(String(BOOKED));
    expect(String(mismatchRow.externalAmount)).toBe(String(ON_STATEMENT));
    expect(mismatchRow.status).toBe('OPEN');

    // ── 财务查证结论：查不出（已穷尽调查）→ 挂起·调查中 ─────────────────────
    const disposition = await dispositions.record(
      kase.caseNo,
      {
        matchType: 'AMOUNT_MISMATCH',
        explainedFlowId: mismatchRow.internalSourceId,
        explainedExternalLineId: mismatchRow.externalTxId,
        causeCode: 'UNEXPLAINED',
        findingNote: 'e2e：查过银行回单原件、通道费率表、同日同通道其他笔，都对不上；已穷尽调查',
        deltaSign: -1,
      } as any,
      makeActor('E2E_OPS_CREATOR_B', 'OPS_OFFICER'),
    );
    expect(disposition.outlet).toBe('HOLD_INVESTIGATING');
    expect(disposition.outletLabel).toBe('挂起·调查中');
    expect((disposition as any).reasonCode).toBeUndefined(); // 挂起不派调账 reason —— 它压根不开单
    expect((disposition as any).family).toBeUndefined();

    // ── 零账务的行为证明：没有单、没有分录 ──────────────────────────────────
    const draftsOnCase = await (prisma as any).reconciliationAdjustment.findMany({ where: { caseNo: kase.caseNo } });
    expect(draftsOnCase).toHaveLength(0);
    const dispositionRow = await (prisma as any).reconciliationDisposition.findUnique({
      where: { dispositionNo: disposition.dispositionNo },
    });
    expect(dispositionRow.adjustmentNo).toBeNull();
    // 这个钱包上的流水仍然只有铺底那两条（FIRM_ASSET 腿 + INCOME_OTHER 腿），
    // 定性一条分录都没添。
    const walletFlows = await (prisma as any).accountFlow.findMany({ where: { walletRef: wallet.id } });
    expect(walletFlows).toHaveLength(2);
    expect(walletFlows.filter((f: any) => f.sourceType === 'RECON_ADJUSTMENT')).toHaveLength(0);

    // ── 再跑一次对账：案子必须**仍然是 OPEN** ───────────────────────────────
    const run2 = await walletRecon.run({ cutoff: CUTOFF });

    // ★ 头号判据先断：挂起不许让案子变绿。放在快照断言之前，是为了让「谁让挂起
    //   把案子关掉了」这类回归**红在这一行**——红在别处（比如桶不对）虽然也能拦住，
    //   但读失败信息的人得多绕一圈才知道被破坏的是哪条业务规则。
    const still = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(still.status).toBe('OPEN');
    expect(still.resolutionReason).toBeNull();
    expect(still.closedByRunId).toBeNull();

    // 为什么它还开着：本轮读数在 run 快照上——余额依然是平的，撑着这个案子的
    // 自始至终只有那条没被解释的差异行。
    const snap = await (prisma as any).reconciliationRunWallet.findFirst({
      where: { runId: run2.runId, walletRef: wallet.id },
    });
    expect(snap).toBeTruthy();
    expect(String(snap.deltaAmount)).toBe('0');   // 余额依然平 —— 案子不是靠余额差撑着的
    expect(snap.mismatchCount).toBe(1);           // 那条差异行还在，且仍未被解释
    expect(snap.bucket).toBe('SOFT_FLAG');        // 桶没有滑到 MATCHED

    // 案件页上这一行带得到定性注解：查证结论看得见，出口写着「挂起·调查中」，
    // 而且没有任何调账单解释它。
    const view: any = await reconQuery.getCase(kase.caseNo);
    const viewRow = view.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH');
    expect(viewRow).toBeTruthy();
    expect(viewRow.disposition).toBeTruthy();
    expect(viewRow.disposition.causeCode).toBe('UNEXPLAINED');
    expect(viewRow.disposition.outlet).toBe('HOLD_INVESTIGATING');
    expect(viewRow.disposition.outletLabel).toBe('挂起·调查中');
    expect(viewRow.disposition.adjustmentNo).toBeNull();
    expect(viewRow.explainedByAdjustmentNo).toBeNull();
  });
});
