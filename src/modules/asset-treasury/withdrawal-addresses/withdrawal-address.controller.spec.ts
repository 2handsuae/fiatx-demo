import { ForbiddenException } from '@nestjs/common';
import { WithdrawalAddressController } from './withdrawal-address.controller';
import { toCustomerView, toCustomerListView } from './withdrawal-address-customer-view';

/** 库里 WithdrawalAddress 的全部列（+ findByNo 展平出的 customerName）——每一格都有值，漏过滤哪个就看哪个 */
const FULL_ROW: Record<string, any> = {
  id: 'uuid-1',
  addressNo: 'WAD1001',
  customerId: 'cust-1',
  customerNo: 'CUST0001',
  network: 'TRON',
  address: 'TXabc3333',
  addressType: 'SELF_CUSTODY',
  label: 'my ledger',
  beneficiaryName: 'Li Hua',
  memo: null,
  iban: null,
  swiftBic: null,
  bankName: null,
  counterpartyVaspName: null,
  counterpartyVaspDid: null,
  ownershipDeclaredAt: new Date('2026-10-22T00:00:00Z'),
  ownershipProofType: 'SIGNATURE',
  ownerType: 'THIRD_PARTY',
  beneficiaryRelationship: 'Spouse',
  declaredHosting: 'SELF_CUSTODY',
  hostingMismatch: true,
  screeningAnswer: 'RED',
  screenedAt: new Date('2026-10-22T00:00:01Z'),
  ownershipVerifiedAt: null,
  status: 'PENDING_VERIFICATION',
  activatesAt: new Date('2026-10-23T00:00:00Z'),
  activatedAt: null,
  suspendedAt: new Date('2026-10-22T01:00:00Z'),
  suspendedBy: 'ADM001',
  suspendReason: 'AML hit on counterparty',
  cancelledAt: null,
  deactivatedAt: null,
  deactivatedBy: null,
  traceId: 'trace-1',
  createdAt: new Date('2026-10-22T00:00:00Z'),
  updatedAt: new Date('2026-10-22T00:00:02Z'),
  customerName: 'Alice Chen',
  someFutureInternalColumn: 'must not leak by default',
};

/** 客户面该有的键——独立字面量（不 import 实现里的常量），实现与此对不上就红 */
const CUSTOMER_VISIBLE_KEYS = [
  'activatedAt', 'activatesAt', 'address', 'addressNo', 'addressType', 'bankName', 'beneficiaryName',
  'beneficiaryRelationship', 'cancelledAt', 'counterpartyVaspName', 'createdAt', 'deactivatedAt', 'declaredHosting',
  'iban', 'label', 'memo', 'network', 'ownerType', 'ownershipDeclaredAt', 'ownershipProofType', 'ownershipVerifiedAt',
  'status', 'suspendedAt', 'swiftBic',
].sort();

/** 绝不能给客户的内部键（tipping-off）；suspendReason / suspendedBy 为存量连带 */
const FORBIDDEN_KEYS = ['screeningAnswer', 'screenedAt', 'hostingMismatch', 'suspendReason', 'suspendedBy'];

describe('toCustomerView（提现地址客户面投影）', () => {
  it('不含五个内部键', () => {
    const view = toCustomerView(FULL_ROW);
    for (const k of FORBIDDEN_KEYS) expect(Object.keys(view)).not.toContain(k);
  });

  it('键集合 = 客户要用的那一组（白名单默认拒绝：id / traceId / 新增列都不漏）', () => {
    expect(Object.keys(toCustomerView(FULL_ROW)).sort()).toEqual(CUSTOMER_VISIBLE_KEYS);
  });

  it('"待签名"按钮依赖的三项（status + ownershipProofType + ownershipVerifiedAt）原值保留', () => {
    const view = toCustomerView(FULL_ROW);
    expect(view.status).toBe('PENDING_VERIFICATION');
    expect(view.ownershipProofType).toBe('SIGNATURE');
    expect(view.ownershipVerifiedAt).toBeNull();
  });

  it('客户自报的申报字段原样保留（ownerType / declaredHosting / beneficiaryName / beneficiaryRelationship）', () => {
    expect(toCustomerView(FULL_ROW)).toMatchObject({
      ownerType: 'THIRD_PARTY',
      declaredHosting: 'SELF_CUSTODY',
      beneficiaryName: 'Li Hua',
      beneficiaryRelationship: 'Spouse',
    });
  });

  it('toCustomerListView：逐条过投影，total 原样', () => {
    const page = toCustomerListView({ items: [FULL_ROW, { ...FULL_ROW, addressNo: 'WAD1002' }], total: 7 });
    expect(page.total).toBe(7);
    expect(page.items.map((i) => i.addressNo)).toEqual(['WAD1001', 'WAD1002']);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(CUSTOMER_VISIBLE_KEYS);
    }
  });
});

describe('WithdrawalAddressController（client）— 每个返回体都走客户面投影', () => {
  let controller: WithdrawalAddressController;
  let workflow: any;
  let addressService: any;

  const req = { user: { type: 'CUSTOMER', userId: 'cust-1', userNo: 'CUST0001' } };

  /** 控制器的返回体只许是客户面键集合的子集，且一个禁用键都不能有 */
  const expectCustomerSafe = (body: Record<string, any>) => {
    const keys = Object.keys(body);
    for (const k of FORBIDDEN_KEYS) expect(keys).not.toContain(k);
    for (const k of keys) expect(CUSTOMER_VISIBLE_KEYS).toContain(k);
    expect(keys).toContain('addressNo'); // 投影不是清空
  };

  beforeEach(() => {
    workflow = {
      registerAddress: jest.fn().mockResolvedValue({ ...FULL_ROW }),
      registerBankAccount: jest.fn().mockResolvedValue({ ...FULL_ROW }),
      updateAddress: jest.fn().mockResolvedValue({ ...FULL_ROW }),
      cancelAddress: jest.fn().mockResolvedValue({ ...FULL_ROW }),
      deactivateAddress: jest.fn().mockResolvedValue({ ...FULL_ROW }),
      verifyOwnershipSignature: jest.fn().mockResolvedValue({ ...FULL_ROW }),
      batchActivateExpired: jest.fn().mockResolvedValue(undefined),
    };
    addressService = {
      listByCustomer: jest.fn().mockResolvedValue({ items: [{ ...FULL_ROW }, { ...FULL_ROW, addressNo: 'WAD1002' }], total: 2 }),
      findByNo: jest.fn().mockResolvedValue({ ...FULL_ROW }),
    };
    controller = new WithdrawalAddressController(workflow, addressService);
  });

  it('POST 登记 crypto', async () => {
    const dto = { network: 'TRON', address: 'TXabc3333' } as any;
    expectCustomerSafe(await controller.create(req, dto));
    expect(workflow.registerAddress).toHaveBeenCalledWith(dto, 'cust-1', 'CUST0001');
  });

  it('POST 登记 bank', async () => {
    const dto = { iban: 'AE07' } as any;
    expectCustomerSafe(await controller.createBankAccount(req, dto));
    expect(workflow.registerBankAccount).toHaveBeenCalledWith(dto, 'cust-1', 'CUST0001');
  });

  it('GET 列表：逐条投影、total 原样', async () => {
    const page = await controller.list(req, { network: 'TRON' } as any);
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    page.items.forEach(expectCustomerSafe);
    expect(workflow.batchActivateExpired).toHaveBeenCalledWith('cust-1', 'TRON');
  });

  it('GET 详情', async () => {
    expectCustomerSafe(await controller.findOne(req, 'WAD1001'));
  });

  it('GET 详情：别人的地址 → 403（既有行为不变）', async () => {
    addressService.findByNo.mockResolvedValue({ ...FULL_ROW, customerId: 'someone-else' });
    await expect(controller.findOne(req, 'WAD1001')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('PATCH 编辑', async () => {
    expectCustomerSafe(await controller.update(req, 'WAD1001', { label: 'x' } as any));
    expect(workflow.updateAddress).toHaveBeenCalledWith('WAD1001', 'cust-1', 'CUST0001', { label: 'x' });
  });

  it('DELETE 取消', async () => {
    expectCustomerSafe(await controller.cancel(req, 'WAD1001', { reason: 'r' }));
    expect(workflow.cancelAddress).toHaveBeenCalledWith('WAD1001', 'cust-1', 'CUST0001', 'r');
  });

  it('POST 停用', async () => {
    expectCustomerSafe(await controller.deactivate(req, 'WAD1001', { reason: 'r' }));
    expect(workflow.deactivateAddress).toHaveBeenCalledWith('WAD1001', 'cust-1', 'CUST0001', 'r');
  });

  it('POST 签名验证：用 JWT 里的客户身份调 workflow，返回体投影', async () => {
    expectCustomerSafe(await controller.verifySignature(req, 'WAD1001'));
    expect(workflow.verifyOwnershipSignature).toHaveBeenCalledWith('WAD1001', 'cust-1', 'CUST0001');
  });

  it('非客户 token → 403，不碰 workflow', async () => {
    await expect(controller.verifySignature({ user: { type: 'ADMIN', userId: 'a' } }, 'WAD1001')).rejects.toBeInstanceOf(ForbiddenException);
    expect(workflow.verifyOwnershipSignature).not.toHaveBeenCalled();
  });
});
