import { CustomerPendingActionService } from './customer-pending-action.service';

describe('CustomerPendingActionService', () => {
  it('get 返回 null —— 两个字段任一为空即视为无待办事项', async () => {
    const prisma = {
      customerMain: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            pendingActionExternalId: null,
            pendingActionReason: null,
          })
          .mockResolvedValueOnce({
            pendingActionExternalId: 'EA1',
            pendingActionReason: null,
          })
          .mockResolvedValueOnce({
            pendingActionExternalId: null,
            pendingActionReason: 'KYT_REJECTED',
          }),
      },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    expect(await svc.get('c1')).toBeNull();
    expect(await svc.get('c1')).toBeNull();
    expect(await svc.get('c1')).toBeNull();
  });

  it('get 返回存量对象 —— 原样拼接两个字段，不做任何条件判断', async () => {
    const prisma = {
      customerMain: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            pendingActionExternalId: 'EA1',
            pendingActionReason: 'KYT_REJECTED',
          }),
      },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    expect(await svc.get('c1')).toEqual({
      externalActionId: 'EA1',
      reason: 'KYT_REJECTED',
    });
  });

  it('set 写入 action 对象 —— 落库两个字段', async () => {
    const prisma = {
      customerMain: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    await svc.set('c1', { externalActionId: 'EA1', reason: 'KYT_REJECTED' });

    expect(prisma.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        pendingActionExternalId: 'EA1',
        pendingActionReason: 'KYT_REJECTED',
      },
    });
  });

  it('set(customerId, null) 清空两个字段 —— 硬线裁决 / 覆盖旧的软线待办', async () => {
    const prisma = {
      customerMain: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    await svc.set('c1', null);

    expect(prisma.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { pendingActionExternalId: null, pendingActionReason: null },
    });
  });

  // ── Review Fix 2: sticky 硬线标记 ────────────────────────────────────────

  it('hasHardLineDisposition 返回 false —— 从未被硬线过', async () => {
    const prisma = {
      customerMain: {
        findUnique: jest.fn().mockResolvedValue({ hardLineDispositionedAt: null }),
      },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    expect(await svc.hasHardLineDisposition('c1')).toBe(false);
  });

  it('hasHardLineDisposition 返回 true —— 曾经被硬线处置过', async () => {
    const prisma = {
      customerMain: {
        findUnique: jest.fn().mockResolvedValue({ hardLineDispositionedAt: new Date() }),
      },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    expect(await svc.hasHardLineDisposition('c1')).toBe(true);
  });

  it('set(customerId, action, true) 首次盖章 hardLineDispositionedAt —— 现状未设置时才写入', async () => {
    const prisma = {
      customerMain: {
        findUnique: jest.fn().mockResolvedValue({ hardLineDispositionedAt: null }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    await svc.set('c1', null, true);

    expect(prisma.customerMain.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: { hardLineDispositionedAt: true },
    });
    expect(prisma.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        pendingActionExternalId: null,
        pendingActionReason: null,
        hardLineDispositionedAt: expect.any(Date),
      },
    });
  });

  // ── Finding 4（Minor，终审）：write-once ──────────────────────────────────
  it('set(customerId, action, true) 二次调用不推移时间戳 —— 已经盖过章就跳过，不覆盖', async () => {
    const firstStamp = new Date('2026-01-01T00:00:00.000Z');
    const prisma = {
      customerMain: {
        findUnique: jest.fn().mockResolvedValue({ hardLineDispositionedAt: firstStamp }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    // 同一客户第二次硬线（webhook 重投 / 另一笔 swap 的独立制裁命中）。
    await svc.set('c1', null, true);

    expect(prisma.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        pendingActionExternalId: null,
        pendingActionReason: null,
        // 不带 hardLineDispositionedAt —— 保留库里第一次盖的旧时间，不重写。
      },
    });
    const data = (prisma.customerMain.update as jest.Mock).mock.calls[0][0].data;
    expect(data).not.toHaveProperty('hardLineDispositionedAt');
  });

  // ── Task 13: applicantActionReviewed 反查入口 ──────────────────────────────

  it('findByExternalActionId 命中 —— 按 pendingActionExternalId 反查客户', async () => {
    const customer = { id: 'c1', customerNo: 'C-001', pendingActionExternalId: 'EA1' };
    const prisma = {
      customerMain: { findFirst: jest.fn().mockResolvedValue(customer) },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    expect(await svc.findByExternalActionId('EA1')).toEqual(customer);
    expect(prisma.customerMain.findFirst).toHaveBeenCalledWith({
      where: { pendingActionExternalId: 'EA1' },
    });
  });

  it('findByExternalActionId 查不到 —— 返回 null（调用方据此判断这个 action 属于别的域）', async () => {
    const prisma = {
      customerMain: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    expect(await svc.findByExternalActionId('ZZZ')).toBeNull();
  });

  it('set(customerId, action) 不传第三参数 —— 不触碰 hardLineDispositionedAt，也不查现状', async () => {
    const prisma = {
      customerMain: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    await svc.set('c1', { externalActionId: 'EA1', reason: 'KYT_REJECTED' });

    expect(prisma.customerMain.findUnique).not.toHaveBeenCalled();
    const data = (prisma.customerMain.update as jest.Mock).mock.calls[0][0].data;
    expect(data).not.toHaveProperty('hardLineDispositionedAt');
  });
});
