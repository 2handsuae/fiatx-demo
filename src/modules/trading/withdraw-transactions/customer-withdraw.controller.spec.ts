// 波五 T4 评审 Critical：workflow.createWithdrawal() 返回整行（l1Snapshot/needsReview/
// sumsub* 等执法态字段——fold 客户的响应里会明文带 CUSTOMER_RESTRICTION FAIL 详情，
// tipping-off 泄露）。证据链：withdraw-workflow.service.ts insertRecord 裸 create 无
// select → controller 原样吐。修法：控制器收口，建单后过与 GET 详情端点同一条客户
// 白名单路径（WithdrawTransactionsService#findOneForCustomer）重取一次，不收窄
// service 返回值本身（demo-lib.ts/demo-fixtures.ts 与多份 e2e 直接消费那个整行）。
//
// 本测试用真实 WithdrawTransactionsService（只 mock 它的 prisma 依赖）而不是桩出
// findOneForCustomer，这样才是真的在测"响应键集合"，不是只测"控制器调了某个函数"。
import { CustomerWithdrawController } from './customer-withdraw.controller';
import { WithdrawTransactionsService } from './withdraw-transactions.service';

const CUSTOMER_WHITELIST_KEYS = [
  'id',
  'withdrawNo',
  'status',
  'amount',
  'feeAmount',
  'netAmount',
  'createdAt',
  'completedAt',
  'txHash',
  'referenceNo',
  'toAddress',
  'toIban',
  'asset',
  // Task 3（详情增强）：timeline 进 toCustomerWithdrawView（建单响应也走这条
  // 路径复用）；quote/addressLabel 是 findOneForCustomer 详情专属富化。
  'timeline',
  'quote',
  'addressLabel',
].sort();

// 建单事务落库的原始行（withdraw-workflow.service.ts#createWithdrawal 的真实返回
// 形状）——刻意带齐执法态字段，逐条证明它们不会漏进客户响应。
const RAW_ROW_FIELDS = {
  ownerId: 'cust-1',
  ownerType: 'CUSTOMER',
  ownerNo: 'CU0001',
  assetId: 'a-usdt',
  amount: '20',
  feeAmount: '2',
  netAmount: '18',
  createdAt: new Date('2026-09-14T00:00:00.000Z'),
  completedAt: null,
  txHash: null,
  referenceNo: null,
  toAddress: 'T123456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  toIban: null,
  asset: { currency: 'USDT', code: 'USDT-TRON', network: 'TRON', decimals: 6 },
  // 执法态字段——白名单外，绝不能漏出客户响应
  l1Snapshot: JSON.stringify({
    evaluatedAt: '2026-09-14T00:00:00.000Z',
    domain: 'WITHDRAW',
    verdict: 'BLOCK',
    checks: [{ code: 'CUSTOMER_RESTRICTION', outcome: 'FAIL', detail: 'Customer restriction holds down WITHDRAW capability (3 capability item(s) restricted in total)' }],
  }),
  needsReview: false,
  sumsubTxnId: 'txn-1',
  sumsubTxnType: 'finance',
  sumsubVerdict: 'approved',
  sumsubScore: 10,
  sumsubTxnDetailJson: '{}',
  statusHistory: '[]',
  traceId: 'trace-1',
  correlationId: 'corr-1',
  tbPendingNetId: 'hex1',
  tbPendingFeeId: 'hex2',
  manualReason: null,
  slaDeadline: null,
  slaBreached: false,
  approvalCaseId: null,
  approvalNo: null,
  grossAedValue: '73.45',
  aedRate: '3.6725',
  rateFetchedAt: null,
  rateFetchFailed: false,
  counterpartyIsVasp: false,
  fromWalletId: null,
  toWalletId: null,
  pricingQuoteId: 'quote-1',
  feeSettleAttempts: 0,
};

function buildController(rawRow: any) {
  const prisma: any = {
    withdrawTransaction: {
      findUnique: jest.fn(() => Promise.resolve(rawRow)),
    },
    // findOneForCustomer 详情富化（Task 3）反查地址标签；本测试关心的是白名单
    // 键集合本身，地址查不到即可（addressLabel: null，不影响本用例断言）。
    withdrawalAddress: {
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
  };
  const service = new WithdrawTransactionsService(
    prisma,
    {} as any, // eventEmitter — not touched by findOneForCustomer
    {} as any, // auditLogsService — not touched
    {} as any, // approvalsService — not touched
    {} as any, // notificationsService — not touched by findOneForCustomer
  );
  const workflow = { createWithdrawal: jest.fn(() => Promise.resolve(rawRow)) };
  const customerAccess = { assertTradingIntake: jest.fn(() => Promise.resolve({ fold: rawRow.status === 'FROZEN' })) };
  const controller = new CustomerWithdrawController(service as any, workflow as any, customerAccess as any);
  return { controller, service, workflow, customerAccess };
}

const req = { user: { type: 'CUSTOMER', userId: 'cust-1' } };
const dto = { assetId: 'a-usdt', amount: 20, toAddress: 'T123456789ABCDEFGHJKLMNPQRSTUVWXYZ', quoteId: 'q-1' } as any;

describe('CustomerWithdrawController.create — 波五 T4 评审 Critical：建单响应过客户白名单', () => {
  it('① 折叠客户（服务端真实状态 FROZEN）：响应键集合=客户白名单，status 收敛为 COMPLIANCE_PENDING，不含 l1Snapshot/needsReview/sumsub* 等执法态字段', async () => {
    const frozenRow = { id: 'wd-1', withdrawNo: 'WDR0001', status: 'FROZEN', ...RAW_ROW_FIELDS };
    const { controller, workflow, customerAccess } = buildController(frozenRow);

    const result = await controller.create(req, dto);

    expect(customerAccess.assertTradingIntake).toHaveBeenCalledWith('cust-1', 'WITHDRAW');
    expect(workflow.createWithdrawal).toHaveBeenCalledWith(dto, 'cust-1');
    expect(Object.keys(result).sort()).toEqual(CUSTOMER_WHITELIST_KEYS);
    // 收敛值——不是数据库里真实的 FROZEN（tipping-off 的核心：客户面看不出被冻）
    expect(result.status).toBe('COMPLIANCE_PENDING');
    // 逐字符串扫描兜底：响应体里不能出现任何执法态词汇的痕迹
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/l1Snapshot|CUSTOMER_RESTRICTION|needsReview|sumsub|statusHistory|traceId|manualReason/i);
  });

  it('② 普通客户（COMPLIANCE_PENDING）：响应键集合同样=客户白名单，status 原样透传', async () => {
    const normalRow = { id: 'wd-2', withdrawNo: 'WDR0002', status: 'COMPLIANCE_PENDING', ...RAW_ROW_FIELDS, l1Snapshot: null, needsReview: false };
    const { controller } = buildController(normalRow);

    const result = await controller.create(req, dto);

    expect(Object.keys(result).sort()).toEqual(CUSTOMER_WHITELIST_KEYS);
    expect(result.status).toBe('COMPLIANCE_PENDING');
  });
});
