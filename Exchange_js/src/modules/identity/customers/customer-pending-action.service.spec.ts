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

  it('set(customerId, action, true) 额外盖章 hardLineDispositionedAt', async () => {
    const prisma = {
      customerMain: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    await svc.set('c1', null, true);

    expect(prisma.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: {
        pendingActionExternalId: null,
        pendingActionReason: null,
        hardLineDispositionedAt: expect.any(Date),
      },
    });
  });

  it('set(customerId, action) 不传第三参数 —— 不触碰 hardLineDispositionedAt', async () => {
    const prisma = {
      customerMain: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const svc = new CustomerPendingActionService(prisma);

    await svc.set('c1', { externalActionId: 'EA1', reason: 'KYT_REJECTED' });

    const data = (prisma.customerMain.update as jest.Mock).mock.calls[0][0].data;
    expect(data).not.toHaveProperty('hardLineDispositionedAt');
  });
});
