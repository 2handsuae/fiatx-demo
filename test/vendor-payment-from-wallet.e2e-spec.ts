import * as path from 'path';
import * as dotenv from 'dotenv';

// Same Node 18 polyfill as src/main.ts (@nestjs/schedule needs globalThis.crypto,
// stable only in Node 19+) — main.ts isn't loaded in this e2e harness, so it has
// to be repeated here before AppModule (and therefore ScheduleModule) is imported.
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// Loaded before any other import so PrismaService / TigerBeetleService see the
// worktree's own DATABASE_URL / TB_ADDRESS regardless of ConfigModule's internal
// load timing (mirrors lp-receivable.e2e-spec.ts).
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, isDebitNormalCode } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { bigintToHex } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
import { ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import { SystemWalletResolver } from '../src/modules/funds-layer/domain/system-wallet-resolver.service';
import { FundsOrderService } from '../src/modules/funds-orders/funds-order.service';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';
import { PrudentialService } from '../src/modules/asset-treasury/prudential/prudential.service';
import { VendorPaymentService } from '../src/modules/asset-treasury/company-funding/vendor-payment.service';
import { VendorPaymentWorkflowService } from '../src/modules/asset-treasury/company-funding/vendor-payment-workflow.service';
import { VendorPaymentStatus } from '../src/modules/asset-treasury/company-funding/dto/vendor-payment.dto';

/**
 * 戊波二 T4 · 付款单 from 可选 e2e（spec §8.5；付款单今天没有 e2e，本文件是第一份）：真 AppModule 零 mock，
 * 收款方用种子里已 ACTIVE 的外包商（HexTrust），走真实服务入口：initiate → ApprovalsService.approve（CFO）→
 * 付款腿 SUBMIT / CONFIRM（⚡ 模拟推进走的同一个 FundsOrderService.advance，事件触发 workflow 落 87）。
 *
 * 金额 1.00 AED：手续费户（F_FEE）里的钱来自种子的手续费收入，量很小（百来块），每跑一次本文件就从里面真付走 1 块，
 * 所以取小额；不够就在 beforeAll 当场红并指路重铺，不用捷径把钱硬塞进手续费户。
 * 断言全部取自 TigerBeetle 账户余额的前后差与凭证行，不读自己写的 mock。NLA 门用 jest.spyOn 挂在 app 里那只真实的
 * PrudentialService 上（默认透传，不替换实现）——戊波三起两种 from（F_OPS / F_FEE）都计入 NLA，开单时门都必须被调一次；
 * 另有一条用 computeStatus 破线 spy 证明 from = F_FEE 时门真能拦（400，不建单）。
 */
describe('Vendor payment — choose the from wallet (戊波二 T4)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;
  let accounting: AccountingService; let approvals: ApprovalsService;
  let wf: VendorPaymentWorkflowService; let payments: VendorPaymentService;
  let fundsOrders: FundsOrderService; let systemWallets: SystemWalletResolver; let prudential: PrudentialService;
  let nlaSpy: jest.SpyInstance;

  const treasury = makeActor('E2E_VPF_TREASURY', 'TREASURY_OFFICER');
  const cfo = makeActor('E2E_VPF_CFO', 'CFO');

  let aed: any; let vendor: any;
  let opsWallet: any; let feeWallet: any; let setWallet: any; let customerWallet: any;
  let opsCashId: bigint; let feeCashId: bigint; let expenseId: bigint; let equityId: bigint;
  let incomeIds: bigint[];

  const AMOUNT = '1'; // 1.00 AED
  const AMOUNT_MINOR = 100n;
  const marker = `E2E-VPF-${randomUUID().slice(0, 8).toUpperCase()}`;

  function makeActor(userNo: string, role: string): ApprovalActorContext {
    return { actorType: 'ADMIN', userId: `uuid-${userNo}`, userNo, role, roleCodes: [role] };
  }

  async function waitUntil(predicate: () => Promise<boolean>, what: string, timeoutMs = 30000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await predicate()) return;
      if (Date.now() - start > timeoutMs) throw new Error(`waitUntil: ${what} not met within ${timeoutMs}ms`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /** posted 净余额，按科目码的借贷性质取正（与注册表列表 / verify:coa 同口径）。 */
  async function posted(accountId: bigint, code: number): Promise<bigint> {
    const b = await accounting.lookupBalance(accountId);
    return isDebitNormalCode(code) ? b.debitsPosted - b.creditsPosted : b.creditsPosted - b.debitsPosted;
  }

  async function snapshot() {
    let income = 0n;
    for (const id of incomeIds) {
      const b = await accounting.lookupBalance(id);
      income += b.creditsPosted - b.debitsPosted;
    }
    return {
      opsCash: await posted(opsCashId, TB_ACCOUNT_CODES.FIRM_CASH),
      feeCash: await posted(feeCashId, TB_ACCOUNT_CODES.FIRM_CASH),
      expense: await posted(expenseId, TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY),
      equity: await posted(equityId, TB_ACCOUNT_CODES.FIRM_EQUITY),
      income, // 210 + 211 + 212（贷方户，净额 = 贷 − 借）
    };
  }

  const initiateInput = (fromWalletId: string, purposeNote: string) => ({
    vendorNo: vendor.vendorNo, payeeAccountRef: `E2E payee IBAN AE00E2E${marker}`, assetId: aed.id, fromWalletId,
    amount: AMOUNT, purposeNote, prudentialPurpose: 'Discharge outsourced custody service fee obligation', reason: 'e2e: choose the from wallet',
  });

  const paymentRowsWithNote = (purposeNote: string) => (prisma as any).vendorPayment.findMany({ where: { purposeNote } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(0);
    await app.init();
    prisma = app.get(PrismaService); accounting = app.get(AccountingService); approvals = app.get(ApprovalsService);
    wf = app.get(VendorPaymentWorkflowService); payments = app.get(VendorPaymentService);
    fundsOrders = app.get(FundsOrderService); systemWallets = app.get(SystemWalletResolver); prudential = app.get(PrudentialService);

    aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    if (!aed?.tbLedgerId) throw new Error('Fixture asset AED not seeded — run `bash scripts/stack.sh reset self` first.');
    vendor = await (prisma as any).outsourcingVendor.findFirst({ where: { status: 'ACTIVE', name: 'HexTrust' } })
      ?? await (prisma as any).outsourcingVendor.findFirst({ where: { status: 'ACTIVE' } });
    if (!vendor) throw new Error('No ACTIVE outsourcing vendor seeded — run `bash scripts/stack.sh reset self` first.');

    [opsWallet, feeWallet, setWallet] = await Promise.all([
      systemWallets.resolve(aed.id, 'F_OPS'), systemWallets.resolve(aed.id, 'F_FEE'), systemWallets.resolve(aed.id, 'F_SET'),
    ]);
    customerWallet = await (prisma as any).wallet.findFirst({ where: { ownerType: 'CUSTOMER', network: aed.network } });
    if (!customerWallet) throw new Error('No customer AED wallet seeded — run `bash scripts/stack.sh reset self` first.');

    const ledger = TB_LEDGERS.AED;
    opsCashId = await accounting.resolveCashAccountId(opsWallet.id, ledger);
    feeCashId = await accounting.resolveCashAccountId(feeWallet.id, ledger);
    expenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.EXPENSE_BANK_CUSTODY, ledger, ownerType: 'SYSTEM' });
    equityId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_EQUITY, ledger, ownerType: 'SYSTEM' });
    incomeIds = [];
    for (const code of [TB_ACCOUNT_CODES.INCOME_SWAP_FEE, TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, TB_ACCOUNT_CODES.INCOME_OTHER]) {
      incomeIds.push(await accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' }));
    }

    const fee = await posted(feeCashId, TB_ACCOUNT_CODES.FIRM_CASH);
    if (fee < AMOUNT_MINOR) {
      throw new Error(`F_FEE (AED) holds ${fee} minor units — less than the ${AMOUNT_MINOR} this e2e pays out. Fee income is seeded by demo:all; run \`bash scripts/stack.sh reset self\` then \`bash scripts/on-stack.sh self demo:all\`.`);
    }
    nlaSpy = jest.spyOn(prudential, 'assertPostOutflowCompliant'); // 透传，不替换实现
  });
  afterAll(async () => { nlaSpy?.mockRestore(); if (app) await app.close(); });
  beforeEach(() => { nlaSpy.mockClear(); });

  it('fixture: the operating wallet and the fee wallet are two different AED company wallets with a funded fee cash account', async () => {
    expect(opsWallet.vaultCode).toBe('F_OPS');
    expect(feeWallet.vaultCode).toBe('F_FEE');
    expect(opsWallet.id).not.toBe(feeWallet.id);
    expect(opsCashId).not.toBe(feeCashId);
    expect(await posted(feeCashId, TB_ACCOUNT_CODES.FIRM_CASH)).toBeGreaterThanOrEqual(AMOUNT_MINOR);
  });

  it('from = F_FEE: opens through the NLA gate (called once), snapshot + view name the fee wallet; CFO approves, the leg pays out — 87 credits the FEE cash account (fee −1.00, 300 +1.00), operating wallet untouched, no fee-income carry-over (no 90), NLA gate called exactly once (at initiate), never at approval / posting', async () => {
    const purposeNote = `${marker} from fee`;
    const before = await snapshot();

    const opened = await wf.initiate(initiateInput(feeWallet.id, purposeNote), treasury);
    expect(nlaSpy).toHaveBeenCalledTimes(1); // 手续费户也计入 NLA，付出去就是离开公司，过门（戊波三裁定 2）
    expect(nlaSpy).toHaveBeenCalledWith(expect.objectContaining({ currency: 'AED', amountMinor: AMOUNT_MINOR, orderKind: 'VENDOR_PAYMENT', counterpartyNo: vendor.vendorNo, assetNo: aed.assetNo }));
    const created = await payments.findByNo(opened.payNo);
    expect(created.fromWalletId).toBe(feeWallet.id);
    const openedView = await payments.getView(opened.payNo);
    expect(openedView.fromWalletNo).toBe(feeWallet.walletNo);
    expect(JSON.stringify(openedView)).not.toContain(feeWallet.id); // 铁律⑥：投影只给 walletNo
    const approval = await (prisma as any).approvalCase.findFirst({ where: { approvalNo: opened.approvalNo } });
    expect(approval.objectSnapshot).toContain(feeWallet.walletNo); // CFO 批的单上看得到钱从哪只钱包出
    expect(approval.objectSnapshot).not.toContain(feeWallet.id);

    // 人选的 from 钱包进审计（铁律①）：REQUESTED 那条的 metadata 里查得到 walletNo
    const requested = await (prisma as any).auditLogEvent.findFirst({
      where: { primarySubjectType: 'VENDOR_PAYMENT', primarySubjectNo: opened.payNo, action: 'VENDOR_PAYMENT_REQUESTED' },
    });
    expect(JSON.parse(requested.metadata).fromWalletNo).toBe(feeWallet.walletNo);

    // 批准之前不记账
    expect(await snapshot()).toEqual(before);

    await approvals.approve(opened.approvalNo, { reason: 'e2e CFO approves the vendor payment' }, cfo);
    await waitUntil(async () => (await payments.findByNo(opened.payNo)).status === VendorPaymentStatus.EXECUTING, 'payment EXECUTING');

    // 付款腿：⚡模拟推进 = FundsOrderService.advance（SUBMIT 写托管回单，CONFIRM 触发 87）
    const [leg] = await fundsOrders.findByParent({ vendorPaymentId: created.id }, { legSeq: 1 });
    expect(leg.fromWalletId).toBe(feeWallet.id); // 腿的 from 钱包跟单上人选的一致
    await fundsOrders.advance(leg.id, FundsOrderAction.SUBMIT, 'E2E_VPF');
    await fundsOrders.advance(leg.id, FundsOrderAction.CONFIRM, 'E2E_VPF');
    await waitUntil(async () => (await payments.findByNo(opened.payNo)).status === VendorPaymentStatus.SUCCESS, 'payment SUCCESS');

    const after = await snapshot();
    expect(after.feeCash - before.feeCash).toBe(-AMOUNT_MINOR); // 手续费户付出 1.00
    expect(after.expense - before.expense).toBe(AMOUNT_MINOR); // 300 银行与托管费用 +1.00
    expect(after.opsCash).toBe(before.opsCash); // 运营户不动
    expect(after.equity).toBe(before.equity); // 无结转：200 不动
    expect(after.income).toBe(before.income); // 无结转：210 / 211 / 212 不动

    // 凭证：这张付款单只落了一笔，就是 87（借 300 / 贷 现金·手续费户）；没有第二笔（扫费结转 90 不存在）
    const evidence = await (prisma as any).tbTransferEvidence.findMany({ where: { sourceNo: opened.payNo } });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      sourceType: 'VENDOR_PAYMENT', eventCode: 'VENDOR_PAYMENT', debitCode: 'X.EXPENSE_BANK_CUSTODY', creditCode: 'A.FIRM_CASH', assetCode: 'AED',
      debitTbAccountId: bigintToHex(expenseId), creditTbAccountId: bigintToHex(feeCashId),
    });
    expect(BigInt(new Prisma.Decimal(evidence[0].amount).toFixed(0))).toBe(AMOUNT_MINOR); // 凭证金额存最小单位
    expect(nlaSpy).toHaveBeenCalledTimes(1); // 全程（含批准、落账）只在开单时调了一次
  });

  it('from = F_OPS: the NLA gate IS called (once, VENDOR_PAYMENT, this vendor, this amount), the row keeps the operating wallet and the view names it', async () => {
    const purposeNote = `${marker} from ops`;
    const opened = await wf.initiate(initiateInput(opsWallet.id, purposeNote), treasury);
    expect(nlaSpy).toHaveBeenCalledTimes(1);
    expect(nlaSpy).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'AED', amountMinor: AMOUNT_MINOR, orderKind: 'VENDOR_PAYMENT', counterpartyNo: vendor.vendorNo, assetNo: aed.assetNo,
    }));
    expect((await payments.findByNo(opened.payNo)).fromWalletId).toBe(opsWallet.id);
    expect((await payments.getView(opened.payNo)).fromWalletNo).toBe(opsWallet.walletNo);
    // 收拾自己的夹具：撤回待批单，不在审批中心留一张无人批的单
    await wf.cancel(opened.payNo, { reason: 'e2e cleanup' }, treasury);
    expect((await payments.findByNo(opened.payNo)).status).toBe(VendorPaymentStatus.CANCELLED);
  });

  it('from = F_FEE under an NLA breach (computeStatus spied: headroom just below the outflow) → 400 blocked by the prudential floor, PRUDENTIAL_GATE_BLOCKED audited, no payment row, no approval', async () => {
    const purposeNote = `${marker} fee breach`;
    const real = await prudential.computeStatus();
    const floor = BigInt(real.floorAedMinor);
    // 动后 NLA = floor − 1 < floor：headroom 比出款额（1.00 AED = 100 分）恰少 1 分
    const nla = floor + AMOUNT_MINOR - 1n;
    const statusSpy = jest.spyOn(prudential, 'computeStatus').mockResolvedValue({
      ...real, nlaAedMinor: nla.toString(), headroomAedMinor: (nla - floor).toString(), breached: false,
    });
    const auditBefore = await (prisma as any).auditLogEvent.count({ where: { action: 'PRUDENTIAL_GATE_BLOCKED' } });
    try {
      const err: any = await wf.initiate(initiateInput(feeWallet.id, purposeNote), treasury).catch((e) => e);
      expect(err.getStatus?.()).toBe(400);
      expect(err.message).toContain('Blocked by prudential floor');
    } finally {
      statusSpy.mockRestore();
    }
    expect(nlaSpy).toHaveBeenCalledTimes(1);
    expect(await (prisma as any).auditLogEvent.count({ where: { action: 'PRUDENTIAL_GATE_BLOCKED' } })).toBe(auditBefore + 1);
    expect(await paymentRowsWithNote(purposeNote)).toHaveLength(0);
  });

  it.each([
    ['the settlement wallet (F_SET)', () => setWallet],
    ['a customer wallet', () => customerWallet],
  ])('from = %s → 400 FROM_WALLET_NOT_ELIGIBLE, no payment row, no approval, NLA gate not reached', async (_label, pick) => {
    const purposeNote = `${marker} ineligible ${randomUUID().slice(0, 6)}`;
    const wallet = pick();
    const err: any = await wf.initiate(initiateInput(wallet.id, purposeNote), treasury).catch((e) => e);
    expect(err.getStatus?.()).toBe(400);
    expect(err.getResponse()).toMatchObject({ code: 'FROM_WALLET_NOT_ELIGIBLE' });
    expect(err.message).toContain(wallet.walletNo); // 话术只用 walletNo
    expect(err.message).not.toContain(wallet.id);
    expect(await paymentRowsWithNote(purposeNote)).toHaveLength(0);
    expect(nlaSpy).not.toHaveBeenCalled();
  });
});
