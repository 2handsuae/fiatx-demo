import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MaterialRequestsAdminController } from './material-requests.admin.controller';

const ADMIN_REQ = {
  user: { type: 'ADMIN', userId: 'admin-1', userNo: 'ADM001', role: 'MLRO', roleCodes: ['MLRO'] },
};
const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'c1' } };

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ1', customerId: 'c1', materialType: 'PROOF_OF_ADDRESS',
    levelName: 'wave3-action-poa-refresh', applicantActionId: 'act-1', externalActionId: 'ext-1',
    orderDomain: null, orderRef: null, restrictionNo: null, origin: 'OPERATOR_ISSUED',
    status: 'PENDING_SUBMISSION', reason: 'need PoA', issuedBy: 'ADM001',
    issuedAt: new Date(), submittedAt: null, reviewedAt: null,
    reviewAnswer: null, reviewRejectType: null, cancelledAt: null, cancelReason: null,
    traceId: 't1', ...over,
  };
}

function build() {
  const prisma = {
    customerMain: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
    // 修 2：issue() 绑单时反查该客户名下的非终态订单——默认都能查到一行，
    // 各条用例按需覆写成 null 来模拟"终态单 / 别人的单 / 不存在"。
    depositTransaction: { findFirst: jest.fn().mockResolvedValue({ id: 'dep-1' }) },
    withdrawTransaction: { findFirst: jest.fn().mockResolvedValue({ id: 'wd-1' }) },
    swapTransaction: { findFirst: jest.fn().mockResolvedValue({ id: 'swp-1' }) },
  } as any;
  const requests = {
    listAllByCustomer: jest.fn().mockResolvedValue([row()]),
    listLiveByOrder: jest.fn().mockResolvedValue([row({ orderDomain: 'DEPOSIT', orderRef: 'DP1' })]),
  } as any;
  const issuer = {
    issue: jest.fn().mockResolvedValue({ requestNo: 'MRQ1', restrictionNo: null }),
  } as any;
  const controller = new MaterialRequestsAdminController(prisma, requests, issuer);
  return { controller, prisma, requests, issuer };
}

describe('MaterialRequestsAdminController 鉴权', () => {
  it('三个端点对非 ADMIN 一律 Forbidden', async () => {
    const { controller } = build();
    await expect(controller.listByCustomer(CUSTOMER_REQ, 'CUS-001')).rejects.toThrow(ForbiddenException);
    await expect(controller.listByOrder(CUSTOMER_REQ, 'DEPOSIT', 'DP1')).rejects.toThrow(ForbiddenException);
    await expect(
      controller.issue(CUSTOMER_REQ, 'CUS-001', { materialType: 'PROOF_OF_ADDRESS', restrict: false, reason: 'r' } as any),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('MaterialRequestsAdminController.listByCustomer', () => {
  it('G6：后台要全集，调的是 listAllByCustomer 不是 listLive', async () => {
    const { controller, requests } = build();
    await controller.listByCustomer(ADMIN_REQ, 'CUS-001');
    expect(requests.listAllByCustomer).toHaveBeenCalledWith('c1');
  });

  it('对外合同是 customerNo，内部才换 id', async () => {
    const { controller, prisma } = build();
    await controller.listByCustomer(ADMIN_REQ, 'CUS-001');
    expect(prisma.customerMain.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerNo: 'CUS-001' } }),
    );
  });

  it('客户不存在 → NotFound', async () => {
    const { controller, prisma } = build();
    prisma.customerMain.findFirst.mockResolvedValue(null);
    await expect(controller.listByCustomer(ADMIN_REQ, 'NOPE')).rejects.toThrow(NotFoundException);
  });

  it('回包剥掉 customerId 与 externalActionId，带上 materialLabel', async () => {
    const { controller } = build();
    const out = await controller.listByCustomer(ADMIN_REQ, 'CUS-001');
    expect(out[0]).not.toHaveProperty('customerId');
    expect(out[0]).not.toHaveProperty('externalActionId');
    expect(out[0].materialLabel).toBe('Proof of Address');
    expect(out[0].applicantActionId).toBe('act-1');
  });
});

describe('MaterialRequestsAdminController.issue', () => {
  it('原样透传给 issuer，origin 固定 OPERATOR_ISSUED，issuedBy 用 userNo 不用 UUID', async () => {
    const { controller, issuer } = build();
    await controller.issue(ADMIN_REQ, 'CUS-001', {
      materialType: 'SOURCE_OF_FUNDS', restrict: true, restrictScopes: ['WITHDRAW'], reason: 'edd',
    } as any);
    expect(issuer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'c1', materialType: 'SOURCE_OF_FUNDS',
        restrict: true, restrictScopes: ['WITHDRAW'],
        origin: 'OPERATOR_ISSUED', issuedBy: 'ADM001',
        orderDomain: null, orderRef: null,
      }),
    );
  });

  it('G4：不接受 cause 入参 —— DTO 里根本没有这个字段，cause 固定 PENDING_DOCUMENT', async () => {
    const { controller, issuer } = build();
    await controller.issue(ADMIN_REQ, 'CUS-001', {
      materialType: 'SOURCE_OF_FUNDS', restrict: true, reason: 'edd',
      restrictCause: 'SANCTION',
    } as any);
    // 即便调用方硬塞，控制器也不透传 —— issuer 收到的 input 里没有 restrictCause
    expect(issuer.issue.mock.calls[0][0].restrictCause).toBeUndefined();
  });

  it('绑单时两列一起传下去', async () => {
    const { controller, issuer, prisma } = build();
    await controller.issue(ADMIN_REQ, 'CUS-001', {
      materialType: 'PROOF_OF_ADDRESS', orderDomain: 'DEPOSIT', orderRef: 'DP1',
      restrict: false, reason: 'r',
    } as any);
    expect(issuer.issue.mock.calls[0][0]).toMatchObject({ orderDomain: 'DEPOSIT', orderRef: 'DP1' });
    // 修 2：反查用的是 customerId（内部换过的），不是 customerNo
    expect(prisma.depositTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ depositNo: 'DP1', ownerId: 'c1' }) }),
    );
  });

  // 修 2（终审 Important）：orderRef 是运营手打的自由文本，服务端必须反查
  // 该客户名下的非终态订单——查不到就 400，不落一行客户端零入口的孤儿。
  describe('修 2：绑单时反查该客户名下的非终态订单', () => {
    it('绑到已终态的单 → 400，不落到 issuer', async () => {
      const { controller, issuer, prisma } = build();
      // 反查条件本身就带 status notIn 终态集合，终态单查不到即 null
      prisma.depositTransaction.findFirst.mockResolvedValue(null);

      await expect(
        controller.issue(ADMIN_REQ, 'CUS-001', {
          materialType: 'PROOF_OF_ADDRESS', orderDomain: 'DEPOSIT', orderRef: 'DP-TERMINAL',
          restrict: false, reason: 'r',
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(issuer.issue).not.toHaveBeenCalled();
    });

    it('绑到别人的单（depositNo 存在但 ownerId 不是这个客户）→ 400，不落到 issuer', async () => {
      const { controller, issuer, prisma } = build();
      // findFirst 的 where 里带 ownerId: customerId —— 别人的单在这个条件下查不到，同样回 null
      prisma.depositTransaction.findFirst.mockResolvedValue(null);

      await expect(
        controller.issue(ADMIN_REQ, 'CUS-001', {
          materialType: 'PROOF_OF_ADDRESS', orderDomain: 'DEPOSIT', orderRef: 'DP-OTHER-CUSTOMER',
          restrict: false, reason: 'r',
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(issuer.issue).not.toHaveBeenCalled();
    });

    it('号不存在 → 400，不落到 issuer；WITHDRAW/SWAP 域同样成立', async () => {
      const { controller, issuer, prisma } = build();
      prisma.withdrawTransaction.findFirst.mockResolvedValue(null);

      await expect(
        controller.issue(ADMIN_REQ, 'CUS-001', {
          materialType: 'PROOF_OF_ADDRESS', orderDomain: 'WITHDRAW', orderRef: 'WD-NOPE',
          restrict: false, reason: 'r',
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(issuer.issue).not.toHaveBeenCalled();
      expect(prisma.withdrawTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ withdrawNo: 'WD-NOPE', ownerId: 'c1' }) }),
      );
    });

    it('查得到 → 正常透传给 issuer（SWAP 域反查）', async () => {
      const { controller, issuer, prisma } = build();
      await controller.issue(ADMIN_REQ, 'CUS-001', {
        materialType: 'PROOF_OF_ADDRESS', orderDomain: 'SWAP', orderRef: 'SWP-1',
        restrict: false, reason: 'r',
      } as any);
      expect(prisma.swapTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ swapNo: 'SWP-1', ownerId: 'c1' }) }),
      );
      expect(issuer.issue).toHaveBeenCalled();
    });
  });
});

describe('MaterialRequestsAdminController.listByOrder', () => {
  it('订单维度只查活行', async () => {
    const { controller, requests } = build();
    await controller.listByOrder(ADMIN_REQ, 'DEPOSIT', 'DP1');
    expect(requests.listLiveByOrder).toHaveBeenCalledWith('DEPOSIT', 'DP1');
  });

  it('orderDomain 非法值 → Forbidden/BadRequest，不落到 service', async () => {
    const { controller, requests } = build();
    await expect(controller.listByOrder(ADMIN_REQ, 'NOPE' as any, 'X1')).rejects.toThrow();
    expect(requests.listLiveByOrder).not.toHaveBeenCalled();
  });
});
