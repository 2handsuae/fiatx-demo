import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsClientController } from './notifications.client.controller';
import { NotificationsService } from './notifications.service';

// 战役丙波一 T4：controller 走真实 NotificationsService + 行为化 mock prisma——不满足于
// service 方法被调用过，而是校验 findMany/count/findFirst 收到的 where 真带
// ownerCustomerNo（本仓判例：mock无视where假绿）。
const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'c1', userNo: 'CUS00001' } };
const OTHER_CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'c2', userNo: 'CUS00002' } };
const ADMIN_REQ = { user: { type: 'ADMIN', userId: 'admin-1' } };

const CUSTOMERS = [
  { id: 'c1', customerNo: 'CUS00001' },
  { id: 'c2', customerNo: 'CUS00002' },
];

function makeRows() {
  return [
    {
      id: 'n1', ownerCustomerNo: 'CUS00001', templateCode: 'DEPOSIT_SUCCESS', title: 'T1', body: 'B1',
      channels: '["IN_APP"]', relatedOrderType: 'DEPOSIT', relatedOrderNo: 'DEP1',
      readAt: null, createdAt: new Date('2026-09-01T00:00:00Z'),
    },
    {
      id: 'n2', ownerCustomerNo: 'CUS00001', templateCode: 'WITHDRAW_SUCCESS', title: 'T2', body: 'B2',
      channels: '["IN_APP","EMAIL_SIMULATED"]', relatedOrderType: 'WITHDRAW', relatedOrderNo: 'WDR1',
      readAt: new Date('2026-09-02T00:00:00Z'), createdAt: new Date('2026-09-02T00:00:00Z'),
    },
    {
      id: 'n3', ownerCustomerNo: 'CUS00002', templateCode: 'SWAP_SUCCESS', title: 'T3', body: 'B3',
      channels: '["IN_APP"]', relatedOrderType: 'SWAP', relatedOrderNo: 'SWP1',
      readAt: null, createdAt: new Date('2026-09-03T00:00:00Z'),
    },
  ];
}

function build() {
  const rows = makeRows();

  const prisma: any = {
    customerMain: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) {
          const row = CUSTOMERS.find((c) => c.id === where.id);
          return row ? { customerNo: row.customerNo } : null;
        }
        if (where.customerNo) {
          const row = CUSTOMERS.find((c) => c.customerNo === where.customerNo);
          return row ? { id: row.id } : null;
        }
        return null;
      }),
    },
    customerNotification: {
      findMany: jest.fn(async ({ where, orderBy, skip, take }: any) => {
        let out = rows.filter((r) => r.ownerCustomerNo === where.ownerCustomerNo);
        if (orderBy?.createdAt === 'desc') {
          out = out.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (typeof skip === 'number') out = out.slice(skip);
        if (typeof take === 'number') out = out.slice(0, take);
        return out;
      }),
      count: jest.fn(async ({ where }: any) => {
        let out = rows.filter((r) => r.ownerCustomerNo === where.ownerCustomerNo);
        if ('readAt' in where) out = out.filter((r) => r.readAt === where.readAt);
        return out.length;
      }),
      findFirst: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.id === where.id && r.ownerCustomerNo === where.ownerCustomerNo) || null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  };
  const auditLogs: any = { recordSystem: jest.fn(async () => ({})) };
  const gateway: any = { emitCustomerUpdated: jest.fn() };
  const service = new NotificationsService(prisma, auditLogs, gateway);
  const controller = new NotificationsClientController(service);
  return { controller, service, prisma, auditLogs, gateway, rows };
}

describe('客户端端点鉴权', () => {
  it('非 CUSTOMER 一律 Forbidden', async () => {
    const { controller } = build();
    await expect(controller.list(ADMIN_REQ)).rejects.toThrow(ForbiddenException);
    await expect(controller.unreadCount(ADMIN_REQ)).rejects.toThrow(ForbiddenException);
    await expect(controller.markRead(ADMIN_REQ, 'n1')).rejects.toThrow(ForbiddenException);
  });
});

describe('GET /client/me/notifications', () => {
  it('只回本客户行（where 真带 ownerCustomerNo），别的客户的行不泄露', async () => {
    const { controller, prisma } = build();
    const out = await controller.list(CUSTOMER_REQ);

    expect(prisma.customerNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerCustomerNo: 'CUS00001' } }),
    );
    expect(out.total).toBe(2);
    expect(out.items.map((i: any) => i.id).sort()).toEqual(['n1', 'n2']);
    expect(out.items.some((i: any) => i.id === 'n3')).toBe(false);
  });

  it('按 createdAt 倒序，channels 出口是数组（JSON.parse 落库串）', async () => {
    const { controller } = build();
    const out = await controller.list(CUSTOMER_REQ);

    expect(out.items[0].id).toBe('n2');
    expect(out.items[1].id).toBe('n1');
    expect(out.items[0].channels).toEqual(['IN_APP', 'EMAIL_SIMULATED']);
    expect(out.items[1].channels).toEqual(['IN_APP']);
  });

  it('skip/take 透传给 prisma 分页', async () => {
    const { controller, prisma } = build();
    await controller.list(CUSTOMER_REQ, '1', '1');

    expect(prisma.customerNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 1, take: 1 }),
    );
  });
});

describe('GET /client/me/notifications/unread-count', () => {
  it('只数 readAt: null 的行', async () => {
    const { controller, prisma } = build();
    const out = await controller.unreadCount(CUSTOMER_REQ);

    expect(prisma.customerNotification.count).toHaveBeenCalledWith({
      where: { ownerCustomerNo: 'CUS00001', readAt: null },
    });
    expect(out).toEqual({ count: 1 });
  });

  it('别的客户的未读数互不影响', async () => {
    const { controller } = build();
    const out = await controller.unreadCount(OTHER_CUSTOMER_REQ);
    expect(out).toEqual({ count: 1 });
  });
});

describe('POST /client/me/notifications/:id/read', () => {
  it('本人行：写 readAt，回 {ok:true}', async () => {
    const { controller, rows } = build();
    const before = rows.find((r) => r.id === 'n1');
    expect(before!.readAt).toBeNull();

    const out = await controller.markRead(CUSTOMER_REQ, 'n1');

    expect(out).toEqual({ ok: true });
    expect(rows.find((r) => r.id === 'n1')!.readAt).toBeInstanceOf(Date);
  });

  it('跨客户行 → 404，不落笔', async () => {
    const { controller, rows } = build();
    await expect(controller.markRead(CUSTOMER_REQ, 'n3')).rejects.toThrow(NotFoundException);
    expect(rows.find((r) => r.id === 'n3')!.readAt).toBeNull();
  });

  it('不存在的 id → 404', async () => {
    const { controller } = build();
    await expect(controller.markRead(CUSTOMER_REQ, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('标已读不写审计（控制器裁定：客户纯读位标记不属 operator 持久化动作）', async () => {
    const { controller, auditLogs } = build();
    await controller.markRead(CUSTOMER_REQ, 'n1');
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  // T8 评审 Important 修：markReadForCustomer 落库成功后要复用 emitSignal 通知
  // 前端铃铛重拉未读数——此前只写 readAt、零信号，Bell 靠整页刷新才纠正。
  it('标已读成功 → emitCustomerUpdated 被调用（本人 customerId，供铃铛重拉未读数）', async () => {
    const { controller, gateway } = build();
    await controller.markRead(CUSTOMER_REQ, 'n1');
    expect(gateway.emitCustomerUpdated).toHaveBeenCalledWith('c1');
  });

  it('跨客户 404 路径不发信号（404 在落库前 throw，走不到 emitSignal）', async () => {
    const { controller, gateway } = build();
    await expect(controller.markRead(CUSTOMER_REQ, 'n3')).rejects.toThrow(NotFoundException);
    expect(gateway.emitCustomerUpdated).not.toHaveBeenCalled();
  });

  it('不存在的 id 的 404 路径同样不发信号', async () => {
    const { controller, gateway } = build();
    await expect(controller.markRead(CUSTOMER_REQ, 'nope')).rejects.toThrow(NotFoundException);
    expect(gateway.emitCustomerUpdated).not.toHaveBeenCalled();
  });
});
