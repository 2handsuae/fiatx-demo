import { NotificationsService } from './notifications.service';
import { NOTIFICATION_TEMPLATES } from './notification-templates.constant';

// 战役丙波一 T2：prisma/audit/gateway 全 mock，mock 行为化——customerMain.findUnique 按
// where.id / where.customerNo 语义返回，不无视 where 假绿（本仓判例：mock无视where假绿）。
const CUSTOMERS = [
  { id: 'c1', customerNo: 'CUS00001' },
  { id: 'c2', customerNo: 'CUS00002' },
];

function makeService() {
  const notificationRows: any[] = [];
  let seq = 0;

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
      create: jest.fn(async ({ data }: any) => {
        seq += 1;
        const row = { id: `notif-${seq}`, ...data };
        notificationRows.push(row);
        return row;
      }),
    },
  };
  const auditLogs: any = { recordSystem: jest.fn(async () => ({})) };
  const gateway: any = { emitCustomerUpdated: jest.fn() };

  const service = new NotificationsService(prisma, auditLogs, gateway);
  return { service, prisma, auditLogs, gateway, notificationRows };
}

describe('NotificationsService', () => {
  it('collapse 不变 → 不落库不发信号不审计', async () => {
    const { service, prisma, auditLogs, gateway } = makeService();

    await service.notifyOrderStatusChange({
      domain: 'DEPOSIT',
      orderNo: 'DEP1',
      owner: { customerId: 'c1' },
      collapsedFrom: 'COMPLIANCE_PENDING',
      collapsedTo: 'COMPLIANCE_PENDING',
    });

    expect(prisma.customerNotification.create).not.toHaveBeenCalled();
    expect(gateway.emitCustomerUpdated).not.toHaveBeenCalled();
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('collapse 变化但无模板（→COMPLIANCE_PENDING）→ 只信号不落消息', async () => {
    const { service, prisma, auditLogs, gateway } = makeService();

    await service.notifyOrderStatusChange({
      domain: 'DEPOSIT',
      orderNo: 'DEP1',
      owner: { customerId: 'c1' },
      collapsedFrom: 'PAYIN_PENDING',
      collapsedTo: 'COMPLIANCE_PENDING',
    });

    expect(gateway.emitCustomerUpdated).toHaveBeenCalledWith('c1');
    expect(prisma.customerNotification.create).not.toHaveBeenCalled();
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('DEPOSIT_SUCCESS → 落库+审计(requestId=行id, metadata 带 templateCode+channels)+信号', async () => {
    const { service, prisma, auditLogs, gateway } = makeService();

    await service.notifyOrderStatusChange({
      domain: 'DEPOSIT',
      orderNo: 'DEP1',
      owner: { customerId: 'c1' },
      collapsedFrom: 'PAYIN_PENDING',
      collapsedTo: 'SUCCESS',
      amount: '100',
      assetCode: 'USDT',
    });

    expect(gateway.emitCustomerUpdated).toHaveBeenCalledWith('c1');
    expect(prisma.customerNotification.create).toHaveBeenCalledTimes(1);
    const createInput = prisma.customerNotification.create.mock.calls[0][0];
    expect(createInput.data.templateCode).toBe('DEPOSIT_SUCCESS');
    expect(createInput.data.ownerCustomerNo).toBe('CUS00001');
    expect(createInput.data.relatedOrderType).toBe('DEPOSIT');
    expect(createInput.data.relatedOrderNo).toBe('DEP1');

    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    const auditInput = auditLogs.recordSystem.mock.calls[0][0];
    expect(auditInput.action).toBe('NOTIFICATION_SENT');
    expect(auditInput.actionDomain).toBe('CUSTOMER');
    expect(auditInput.requestId).toBe('notif-1');
    expect(auditInput.primarySubjectType).toBe('DEPOSIT_TRANSACTION');
    expect(auditInput.primarySubjectNo).toBe('DEP1');
    expect(auditInput.metadata).toMatchObject({
      templateCode: 'DEPOSIT_SUCCESS',
      channels: ['IN_APP', 'EMAIL_SIMULATED'],
    });
    expect(auditInput.subjects).toEqual([
      { subjectType: 'DEPOSIT_TRANSACTION', subjectNo: 'DEP1', subjectRole: 'PRIMARY' },
      { subjectType: 'CUSTOMER', subjectNo: 'CUS00001', subjectRole: 'OWNER' },
    ]);
  });

  it('模板文案全集不含执法词', () => {
    const banned = /freez|frozen|sanction|complian|AML|investigat|enforc|seiz|confiscat/i;
    for (const t of Object.values(NOTIFICATION_TEMPLATES)) {
      expect(banned.test(t.title)).toBe(false);
      expect(banned.test(t.body({ orderNo: 'X1', amount: '1', assetCode: 'USDT' }))).toBe(false);
    }
  });

  it('body 渲染定格：改模板常量不影响已落库行（断言 create 传入的是渲染串非函数引用）', async () => {
    const { service, prisma } = makeService();

    await service.notifyOrderStatusChange({
      domain: 'WITHDRAW',
      orderNo: 'WDR1',
      owner: { customerId: 'c2' },
      collapsedFrom: 'PENDING',
      collapsedTo: 'SUCCESS',
      amount: '50',
      assetCode: 'AED',
    });

    const createInput = prisma.customerNotification.create.mock.calls[0][0];
    expect(typeof createInput.data.body).toBe('string');
    expect(createInput.data.body).toBe('Your withdrawal WDR1 of 50 AED has been completed.');
  });

  it('16 个模板全量登记（判据自点，非 spec 的 16 减一算漏）', () => {
    expect(Object.keys(NOTIFICATION_TEMPLATES)).toHaveLength(16);
  });

  it('owner 只给 customerNo 时补齐 customerId（供 gateway room 使用）', async () => {
    const { service, prisma, gateway } = makeService();

    await service.notifyOrderStatusChange({
      domain: 'SWAP',
      orderNo: 'SWP1',
      owner: { customerNo: 'CUS00002' },
      collapsedFrom: 'PENDING',
      collapsedTo: 'SUCCESS',
    });

    expect(gateway.emitCustomerUpdated).toHaveBeenCalledWith('c2');
    expect(prisma.customerNotification.create.mock.calls[0][0].data.ownerCustomerNo).toBe('CUS00002');
  });

  describe('notifyComplaintStatus', () => {
    it('to 命中 RESOLVED → 落库+审计+使用 complaintNo 作为主对象号', async () => {
      const { service, prisma, auditLogs } = makeService();

      await service.notifyComplaintStatus({ complaintNo: 'CPL1', owner: { customerId: 'c1' }, to: 'RESOLVED' });

      expect(prisma.customerNotification.create).toHaveBeenCalledTimes(1);
      const createInput = prisma.customerNotification.create.mock.calls[0][0];
      expect(createInput.data.templateCode).toBe('COMPLAINT_RESOLVED');
      expect(createInput.data.relatedOrderType).toBe('COMPLAINT');
      expect(createInput.data.relatedOrderNo).toBe('CPL1');

      const auditInput = auditLogs.recordSystem.mock.calls[0][0];
      expect(auditInput.primarySubjectType).toBe('COMPLAINT');
      expect(auditInput.primarySubjectNo).toBe('CPL1');
    });

    it('to 未命中（如 INVESTIGATING 中间态）→ 静默不动作', async () => {
      const { service, prisma, auditLogs, gateway } = makeService();

      await service.notifyComplaintStatus({ complaintNo: 'CPL1', owner: { customerId: 'c1' }, to: 'INVESTIGATING' });

      expect(prisma.customerNotification.create).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
      expect(gateway.emitCustomerUpdated).not.toHaveBeenCalled();
    });
  });
});
