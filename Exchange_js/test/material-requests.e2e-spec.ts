// ── 破坏性护栏（必须在任何读 DATABASE_URL 的 import 之前）──
import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Node 18 polyfill —— @nestjs/schedule 需要 globalThis.crypto，本 harness 不加载
// main.ts，所以在 AppModule（→ ScheduleModule）之前重复一遍。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-material-requests.db');

if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[material-requests e2e] 拒绝运行：本 suite 会清空 fixture 客户及其充值单/便签/材料请求，` +
      `但 DATABASE_URL 当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。\n` +
      `专用库需先 prisma migrate deploy + db:base:sync + db:biz:init；库名必须含 "e2e-"。`,
  );
}

// 本 suite 不打真实 api.sumsub.com；缺这个开关时 SumsubClient 会因无 APP_TOKEN 抛错。
// 不能靠 .env —— stack.sh 每次 up 都重写它且从不写 SUMSUB_*。
process.env.SUMSUB_MOCK_MODE = 'true';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `Refusing to run: DATABASE_URL is ${process.env.DATABASE_URL}, expected a dedicated "e2e-" database ` +
      `(e.g. file:/tmp/exchange_js_wt_material_requests/e2e-material-requests.db).`,
  );
}

import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { MaterialRequestsService } from '../src/modules/identity/material-requests/material-requests.service';
import { MaterialRequestIssuerService } from '../src/modules/identity/material-requests/material-request-issuer.service';
import { MaterialRequestReviewService } from '../src/modules/identity/material-requests/material-request-review.service';
import { CustomerRestrictionsService } from '../src/modules/identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../src/modules/identity/customers/customer-restriction-workflow.service';
import { DepositTransactionsService } from '../src/modules/trading/deposit-transactions/deposit-transactions.service';
import {
  DepositTransactionAction,
  DepositTransactionStatus,
} from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import type { ApprovalActorContext } from '../src/modules/governance/approvals/constants/approval.constants';
import type { MaterialRequestOrderDomain } from '../src/modules/identity/material-requests/constants/material-request.constant';
import { buildDeterministicNo, generateReferenceNo } from '../src/common/utils/no-generator.util';

/**
 * 设计稿 §10 六条 e2e，逐条对应设计稿存在的理由：
 *   ① 多行并存不互相覆盖 —— 直接反证 §1.3① 那个单指针病
 *   ② 挂限制的单终态后解绑：订单页撤下、客户级留着
 *   ③ 不挂限制的单终态后作废：两端都不再显示
 *   ④ 同一行到期升档补挂限制：requestNo / externalActionId 全程不变
 *   ⑤ 只有 GREEN 撕便签，两种 RED 都不撕
 *   ⑥ 客户面响应体搜不到 applicantActionId 字面值（G5 / spec I2）
 *
 * harness：真 AppModule，⑥ 走真 HTTP（supertest），其余走 service 直调 ——
 * 断言的是材料请求账/限制账自己的状态机，不是某条 HTTP 契约。fixture 客户
 * 全部现建现删（前缀 e2e_mrq_），不碰 9 个 demo 客户。
 */
describe('Material request ledger (e2e, Task 15)', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let requests: MaterialRequestsService;
  let issuer: MaterialRequestIssuerService;
  let review: MaterialRequestReviewService;
  let restrictions: CustomerRestrictionsService;
  let restrictionWorkflow: CustomerRestrictionWorkflowService;
  let deposits: DepositTransactionsService;

  let fiatAssetId: string;

  const EMAIL_PREFIX = 'e2e_mrq_';

  const ISSUE_ACTOR: ApprovalActorContext = {
    actorType: 'ADMIN', userId: 'E2E_MRQ_ADMIN', userNo: 'E2E_MRQ_ADMIN',
    role: 'MLRO', roleCodes: ['MLRO'],
  };
  const REVIEW_ACTOR = {
    actorType: 'SYSTEM' as const, actorId: 'E2E_MRQ_REVIEWER', actorNo: 'E2E_MRQ_REVIEWER', actorRole: 'SYSTEM',
  };
  const SYSTEM_ACTOR: ApprovalActorContext = {
    actorType: 'ADMIN', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'],
  };

  type Fixture = { id: string; customerNo: string; email: string; token: string };

  let fixtureSeq = 0;

  /** 现建 fixture 客户：带 sumsubApplicantId（issuer.issue() 硬性要求），别的域不需要。 */
  async function makeCustomer(tag: string): Promise<Fixture> {
    fixtureSeq += 1;
    const email = `${EMAIL_PREFIX}${tag}@example.com`;
    const phone = `+1555901${String(fixtureSeq).padStart(4, '0')}`;
    const row = await prisma.customerMain.create({
      data: {
        email,
        customerNo: buildDeterministicNo('CU', email),
        phone,
        firstName: 'Mat', lastName: 'Sample',
        customerType: 'INDIVIDUAL',
        lifecycle: 'ACTIVE',
        riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
        sumsubApplicantId: `mock-applicant-${buildDeterministicNo('SAP', email)}`,
      },
      select: { id: true, customerNo: true },
    });
    return {
      id: row.id, customerNo: row.customerNo, email,
      token: jwt.sign({
        username: email, sub: row.id, role: 'CUSTOMER', type: 'CUSTOMER', userNo: row.customerNo,
      }),
    };
  }

  /** 在途充值 fixture（COMPLIANCE_PENDING）—— 复刻 customer-restrictions e2e 的 makeDeposit。 */
  async function makeDeposit(c: Fixture, amount: string): Promise<{ id: string; depositNo: string }> {
    const wallet = await prisma.wallet.create({
      data: {
        ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
        type: 'FIAT_BANK', assetId: fiatAssetId, iban: `AE_E2E_MRQ_${c.customerNo}`, status: 'ACTIVE',
      },
    });
    const depositNo = generateReferenceNo('DEP');
    const row = await prisma.depositTransaction.create({
      data: {
        depositNo, traceId: depositNo,
        ownerType: 'CUSTOMER', ownerId: c.id,
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        assetId: fiatAssetId, toWalletId: wallet.id,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(amount),
        feeAmount: new Prisma.Decimal(0),
      },
      select: { id: true, depositNo: true },
    });
    return row;
  }

  /**
   * 驱动充值单到 RETURNED：COMPLIANCE_PENDING --KYT_REJECTED--> MANUAL_CHECKING
   * --RETURN--> RETURNING --RETURNED_DONE--> RETURNED（deposit-transactions.service.ts
   * 的合法边）。直调 DepositTransactionsService.updateStatus，不传 sourcePlatform:
   * 'ADMIN_API' 就不撞 ACCOUNTING_TERMINALS 闸（RETURNED 本不在那个集合里）；
   * updateStatus 本身不出账（真实 RETURN 弧的记账发生在资金单腿确认回调里，
   * 见 deposit-money-arcs.e2e-spec.ts），这里只是把材料请求账的监听目标
   * （DEPOSIT_STATUS_CHANGED → RETURNED）造出来，不是在测 RETURN 弧本身。
   */
  async function driveDepositToReturned(depositId: string): Promise<void> {
    await deposits.updateStatus(depositId, { action: DepositTransactionAction.KYT_REJECTED });
    await deposits.updateStatus(depositId, { action: DepositTransactionAction.RETURN });
    await deposits.updateStatus(depositId, { action: DepositTransactionAction.RETURNED_DONE });
  }

  async function issueRow(input: {
    customerId: string;
    materialType: string;
    orderDomain?: MaterialRequestOrderDomain | null;
    orderRef?: string | null;
    restrict: boolean;
    reason: string;
  }): Promise<{ requestNo: string; restrictionNo: string | null }> {
    return issuer.issue({
      customerId: input.customerId,
      materialType: input.materialType,
      orderDomain: input.orderDomain ?? null,
      orderRef: input.orderRef ?? null,
      restrict: input.restrict,
      origin: 'SYSTEM_SCHEDULED',
      reason: input.reason,
      issuedBy: ISSUE_ACTOR.userNo!,
      actor: ISSUE_ACTOR,
    });
  }

  async function anyApprovalCaseFor(restrictionNo: string) {
    return prisma.approvalCase.findFirst({ where: { entityRef: restrictionNo } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    requests = app.get(MaterialRequestsService);
    issuer = app.get(MaterialRequestIssuerService);
    review = app.get(MaterialRequestReviewService);
    restrictions = app.get(CustomerRestrictionsService);
    restrictionWorkflow = app.get(CustomerRestrictionWorkflowService);
    deposits = app.get(DepositTransactionsService);

    // 清掉上一轮的 fixture（子表先删）。只删本 suite 前缀的客户，9 个 demo 客户不动。
    const stale = await prisma.customerMain.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    const staleIds = stale.map((s) => s.id);
    if (staleIds.length) {
      await prisma.materialRequest.deleteMany({ where: { customerId: { in: staleIds } } });
      await prisma.customerRestriction.deleteMany({ where: { customerId: { in: staleIds } } });
      await prisma.depositTransaction.deleteMany({ where: { ownerId: { in: staleIds } } });
      await prisma.wallet.deleteMany({ where: { ownerId: { in: staleIds } } });
      await prisma.customerMain.deleteMany({ where: { id: { in: staleIds } } });
    }

    const fiat = await prisma.asset.findFirst({ where: { currency: 'AED' } });
    if (!fiat) {
      throw new Error('Fixture asset AED not seeded — run `npm run db:biz:init` on the e2e DB first.');
    }
    fiatAssetId = fiat.id;
  });

  // ── ① 多行并存不互相覆盖 ────────────────────────────────────────────
  it('① 同一客户「不绑单无限制的提醒」与「绑单挂限制的补料」两行并存，互不覆盖', async () => {
    const c = await makeCustomer('multirow');

    const reminder = await issueRow({
      customerId: c.id,
      materialType: 'PROOF_OF_ADDRESS',
      restrict: false,
      reason: 'T-30 reminder — proof of address expiring soon',
    });
    expect(reminder.restrictionNo).toBeNull();

    const dep = await makeDeposit(c, '5000');
    const bound = await issueRow({
      customerId: c.id,
      materialType: 'EMIRATES_ID',
      orderDomain: 'DEPOSIT',
      orderRef: dep.depositNo,
      restrict: true,
      reason: 'KYT flagged this deposit — needs Emirates ID',
    });
    expect(bound.restrictionNo).not.toBeNull();
    expect(bound.requestNo).not.toBe(reminder.requestNo);

    // 旧模型的单指针病：第二次下发会把第一条的字段整个覆盖掉。
    // 这里两行必须都在，且各自字段维持自己下发时的样子。
    const live = await requests.listLiveByCustomer(c.id);
    expect(live).toHaveLength(2);

    const reminderRow = live.find((r) => r.requestNo === reminder.requestNo);
    const boundRow = live.find((r) => r.requestNo === bound.requestNo);
    expect(reminderRow).toBeTruthy();
    expect(boundRow).toBeTruthy();

    expect(reminderRow!.orderDomain).toBeNull();
    expect(reminderRow!.orderRef).toBeNull();
    expect(reminderRow!.restrictionNo).toBeNull();

    expect(boundRow!.orderDomain).toBe('DEPOSIT');
    expect(boundRow!.orderRef).toBe(dep.depositNo);
    expect(boundRow!.restrictionNo).toBe(bound.restrictionNo);
  });

  // ── ② 挂限制的充值单走到 RETURNED ───────────────────────────────────
  it('② 挂限制的充值单走到 RETURNED：订单页查不到、客户级仍在、行未作废且已解绑', async () => {
    const c = await makeCustomer('deposit-bound');
    const dep = await makeDeposit(c, '4000');
    const { requestNo, restrictionNo } = await issueRow({
      customerId: c.id,
      materialType: 'SOURCE_OF_FUNDS',
      orderDomain: 'DEPOSIT',
      orderRef: dep.depositNo,
      restrict: true,
      reason: 'KYT flagged — needs source of funds',
    });
    expect(restrictionNo).not.toBeNull();
    expect((await restrictions.findByNo(restrictionNo!))!.status).toBe('OPEN');

    await driveDepositToReturned(dep.id);

    // MaterialRequestOrderCancelListener 挂在 { async: true } 的 DEPOSIT_STATUS_CHANGED
    // 上，emit 立即返回、handler detached 跑完 —— 轮询，不直接断言。
    await waitUntil('挂限制的行已因订单终态解绑（orderDomain/orderRef 双双置空）', async () => {
      const row = await requests.findByNo(requestNo);
      return row?.orderDomain === null && row?.orderRef === null;
    });

    const row = (await requests.findByNo(requestNo))!;
    expect(row.orderDomain).toBeNull();
    expect(row.orderRef).toBeNull();
    // 挂了限制的行不作废，仍是活行（还欠着这份材料这件事没消失）
    expect(row.status).toBe('PENDING_SUBMISSION');
    expect(row.restrictionNo).toBe(restrictionNo);

    // 订单页查不到
    expect(await requests.listLiveByOrder('DEPOSIT', dep.depositNo)).toHaveLength(0);
    // 客户级仍在（横幅仍红着）
    const atCustomer = await requests.listLiveByCustomer(c.id);
    expect(atCustomer.some((r) => r.requestNo === requestNo)).toBe(true);
    // 便签本身没被这条弧动过
    expect((await restrictions.findByNo(restrictionNo!))!.status).toBe('OPEN');
  });

  // ── ③ 不挂限制的充值单走到 RETURNED ─────────────────────────────────
  it('③ 不挂限制的充值单走到 RETURNED：该行 CANCELLED，两端都查不到', async () => {
    const c = await makeCustomer('deposit-unbound');
    const dep = await makeDeposit(c, '4000');
    const { requestNo, restrictionNo } = await issueRow({
      customerId: c.id,
      materialType: 'SOURCE_OF_FUNDS',
      orderDomain: 'DEPOSIT',
      orderRef: dep.depositNo,
      restrict: false,
      reason: 'KYT flagged — needs source of funds (no restriction)',
    });
    expect(restrictionNo).toBeNull();

    await driveDepositToReturned(dep.id);

    await waitUntil('未挂限制的行已因订单终态作废', async () => {
      const row = await requests.findByNo(requestNo);
      return row?.status === 'CANCELLED';
    });

    const row = (await requests.findByNo(requestNo))!;
    expect(row.status).toBe('CANCELLED');
    expect(await requests.listLiveByOrder('DEPOSIT', dep.depositNo)).toHaveLength(0);
    expect((await requests.listLiveByCustomer(c.id)).some((r) => r.requestNo === requestNo)).toBe(false);
  });

  // ── ④ 到期升档：同一行补挂限制 ──────────────────────────────────────
  // 镜像 MaterialRefreshService.enterBlockingStage() 的两步（openRestriction +
  // attachRestriction）——材料重检域自己的单测已经覆盖那条 cron 触发路径，这里
  // 只在材料账自己的层面反证「补挂不新开行」。
  it('④ 同一行从无限制到补挂限制：requestNo 与 externalActionId 全程逐字不变', async () => {
    const c = await makeCustomer('upgrade');
    const before = await issueRow({
      customerId: c.id,
      materialType: 'PROOF_OF_ADDRESS',
      restrict: false,
      reason: 'T-30 reminder',
    });
    const beforeRow = (await requests.findByNo(before.requestNo))!;
    expect(beforeRow.restrictionNo).toBeNull();

    const { restrictionNo } = await restrictionWorkflow.openRestriction(
      {
        customerId: c.id,
        cause: 'MATERIAL_EXPIRED',
        reason: 'Passport expired — trading restricted until refreshed',
        caseRef: before.requestNo,
        openedBy: SYSTEM_ACTOR.userId,
      },
      SYSTEM_ACTOR,
    );
    await requests.attachRestriction(before.requestNo, restrictionNo);

    const afterRow = (await requests.findByNo(before.requestNo))!;
    expect(afterRow.requestNo).toBe(beforeRow.requestNo);
    expect(afterRow.externalActionId).toBe(beforeRow.externalActionId);
    expect(afterRow.applicantActionId).toBe(beforeRow.applicantActionId);
    expect(afterRow.restrictionNo).toBe(restrictionNo);
  });

  // ── ⑤ Approve 撕便签，两种 Reject 都不撕 ────────────────────────────
  it('⑤ Approve 撕便签（AUTO，无审批案）；Reject·Retry 退回 PENDING_SUBMISSION 且不撕；Reject·Final 置 REJECTED 且不撕', async () => {
    const c = await makeCustomer('review');

    // GREEN
    const green = await issueRow({
      customerId: c.id, materialType: 'PROOF_OF_ADDRESS', restrict: true,
      reason: 'needs proof of address',
    });
    const greenBefore = (await requests.findByNo(green.requestNo))!;
    await requests.markSubmitted(green.requestNo, { actorType: 'CUSTOMER', actorId: c.id, actorRole: 'CUSTOMER' });
    const greenResult = await review.applyReview({
      externalActionId: greenBefore.externalActionId, reviewAnswer: 'GREEN', actor: REVIEW_ACTOR,
    });
    expect(greenResult?.outcome).toBe('APPROVED');
    expect((await requests.findByNo(green.requestNo))!.status).toBe('APPROVED');
    const greenRestriction = (await restrictions.findByNo(green.restrictionNo!))!;
    expect(greenRestriction.status).toBe('RELEASED');
    expect(greenRestriction.releaseMode).toBe('AUTO');
    expect(await anyApprovalCaseFor(green.restrictionNo!)).toBeNull();

    // RED + RETRY
    const retry = await issueRow({
      customerId: c.id, materialType: 'EMIRATES_ID', restrict: true,
      reason: 'needs Emirates ID',
    });
    const retryBefore = (await requests.findByNo(retry.requestNo))!;
    await requests.markSubmitted(retry.requestNo, { actorType: 'CUSTOMER', actorId: c.id, actorRole: 'CUSTOMER' });
    const retryResult = await review.applyReview({
      externalActionId: retryBefore.externalActionId, reviewAnswer: 'RED', reviewRejectType: 'RETRY', actor: REVIEW_ACTOR,
    });
    expect(retryResult?.outcome).toBe('RETRY');
    const retryRow = (await requests.findByNo(retry.requestNo))!;
    expect(retryRow.status).toBe('PENDING_SUBMISSION');
    expect(retryRow.externalActionId).toBe(retryBefore.externalActionId);
    expect((await restrictions.findByNo(retry.restrictionNo!))!.status).toBe('OPEN');

    // RED + FINAL
    const final = await issueRow({
      customerId: c.id, materialType: 'SOURCE_OF_FUNDS', restrict: true,
      reason: 'needs source of funds',
    });
    const finalBefore = (await requests.findByNo(final.requestNo))!;
    await requests.markSubmitted(final.requestNo, { actorType: 'CUSTOMER', actorId: c.id, actorRole: 'CUSTOMER' });
    const finalResult = await review.applyReview({
      externalActionId: finalBefore.externalActionId, reviewAnswer: 'RED', reviewRejectType: 'FINAL', actor: REVIEW_ACTOR,
    });
    expect(finalResult?.outcome).toBe('REJECTED');
    expect((await requests.findByNo(final.requestNo))!.status).toBe('REJECTED');
    expect((await restrictions.findByNo(final.restrictionNo!))!.status).toBe('OPEN');
  });

  // ── ⑥ 客户面响应体里搜不到 applicantActionId 字面值 ────────────────
  it('⑥ GET /client/me/material-requests 与 .../session 的响应体里都搜不到 applicantActionId 字面值', async () => {
    const c = await makeCustomer('no-leak');
    const { requestNo } = await issueRow({
      customerId: c.id, materialType: 'PROOF_OF_ADDRESS', restrict: false,
      reason: 'T-30 reminder',
    });
    const full = (await requests.findByNo(requestNo))!;
    expect(full.applicantActionId).toMatch(/^mock-action-/);

    const server = app.getHttpServer();

    const list = await request(server)
      .get('/client/me/material-requests')
      .set('Authorization', `Bearer ${c.token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((r: any) => r.requestNo === requestNo)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(full.applicantActionId);

    const session = await request(server)
      .get(`/client/me/material-requests/${requestNo}/session`)
      .set('Authorization', `Bearer ${c.token}`);
    expect(session.status).toBe(200);
    // 真铸了 token（PENDING_SUBMISSION 未提交），证明这条路径确实被走过 ——
    // 不是因为「什么都没做」才搜不到。
    expect(session.body.sdkToken).toBeTruthy();
    expect(JSON.stringify(session.body)).not.toContain(full.applicantActionId);
  });

  /**
   * 三个 @OnEvent 都是 { async: true }（裁决回调、订单终态作废、限制撕）——
   * emit 立即返回、handler detached 跑完。直接断言等于跟事件循环赛跑，故轮询。
   */
  async function waitUntil(
    label: string,
    check: () => Promise<boolean>,
    timeoutMs = 8000,
    intervalMs = 25,
  ): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (await check()) return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`waitUntil timed out after ${timeoutMs}ms: ${label}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  afterAll(async () => {
    await app?.close();
  });
});
