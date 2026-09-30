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

  // 评审 Important（控制器裁定）：通知是主流程旁路副作用，内部失败（如落库
  // 抛错）不能拖垮调用方——调用方在通知之后还有落账/审计要做（丙波一 T5
  // 见 deposit-transactions.service.ts updateStatus）。方法整体 try/catch，
  // 失败只 console.error，不再抛，Promise 必须 resolve。
  it('内部抛错（如 prisma.customerNotification.create 挂）→ 方法 resolve 不 throw', async () => {
    const { service, prisma } = makeService();
    prisma.customerNotification.create.mockRejectedValueOnce(new Error('db unavailable'));
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      service.notifyOrderStatusChange({
        domain: 'DEPOSIT',
        orderNo: 'DEP-ERR-1',
        owner: { customerId: 'c1' },
        collapsedFrom: 'PAYIN_PENDING',
        collapsedTo: 'SUCCESS',
        amount: '100',
        assetCode: 'USDT',
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  // T8 走查逮到的 Important（fix round 2）：耐久性次序——demo-lib 脚本环境无
  // `.listen()`，gateway.server 为 null，emit 同步抛错；此前信号排在落库前面，
  // 外层 try/catch 把"本该落库"的这条也吞掉（18 笔 SUCCESS 充值偶然只写成 1 条）。
  // 现在落库+审计先于信号，此处证明：信号抛错不影响已经写完的行/审计，方法仍 resolve。
  it('gateway.emitCustomerUpdated 同步抛错（脚本环境无 server）→ 通知行/审计照常写入，方法 resolve 不 throw', async () => {
    const { service, prisma, auditLogs, gateway } = makeService();
    gateway.emitCustomerUpdated.mockImplementation(() => {
      throw new TypeError("Cannot read properties of null (reading 'to')");
    });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      service.notifyOrderStatusChange({
        domain: 'DEPOSIT',
        orderNo: 'DEP-SIGNAL-ERR-1',
        owner: { customerId: 'c1' },
        collapsedFrom: 'PAYIN_PENDING',
        collapsedTo: 'SUCCESS',
        amount: '100',
        assetCode: 'USDT',
      }),
    ).resolves.toBeUndefined();

    expect(prisma.customerNotification.create).toHaveBeenCalledTimes(1);
    expect(prisma.customerNotification.create.mock.calls[0][0].data.templateCode).toBe('DEPOSIT_SUCCESS');
    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
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
    it('to 命中 RESOLVED → 落库+审计+使用 complaintNo 作为主对象号+发信号', async () => {
      const { service, prisma, auditLogs, gateway } = makeService();

      await service.notifyComplaintStatus({ complaintNo: 'CPL1', owner: { customerId: 'c1' }, to: 'RESOLVED' });

      expect(prisma.customerNotification.create).toHaveBeenCalledTimes(1);
      const createInput = prisma.customerNotification.create.mock.calls[0][0];
      expect(createInput.data.templateCode).toBe('COMPLAINT_RESOLVED');
      expect(createInput.data.relatedOrderType).toBe('COMPLAINT');
      expect(createInput.data.relatedOrderNo).toBe('CPL1');

      const auditInput = auditLogs.recordSystem.mock.calls[0][0];
      expect(auditInput.primarySubjectType).toBe('COMPLAINT');
      expect(auditInput.primarySubjectNo).toBe('CPL1');

      // 评审 Important 修：命中路径（真实落库+审计的通知）必须发信号，铃铛未读数靠它刷新。
      expect(gateway.emitCustomerUpdated).toHaveBeenCalledTimes(1);
      expect(gateway.emitCustomerUpdated).toHaveBeenCalledWith('c1');
    });

    it.each([
      ['ACKNOWLEDGED', 'COMPLAINT_ACKNOWLEDGED'],
      ['INVESTIGATING_EXTENDED', 'COMPLAINT_EXTENDED'],
      ['RESOLVED', 'COMPLAINT_RESOLVED'],
    ])('to=%s 命中 → 以正确 customerId 发信号（%s）', async (to, expectedTemplateCode) => {
      const { service, prisma, gateway } = makeService();

      await service.notifyComplaintStatus({ complaintNo: 'CPL2', owner: { customerId: 'c2' }, to });

      expect(gateway.emitCustomerUpdated).toHaveBeenCalledTimes(1);
      expect(gateway.emitCustomerUpdated).toHaveBeenCalledWith('c2');
      expect(prisma.customerNotification.create.mock.calls[0][0].data.templateCode).toBe(expectedTemplateCode);
    });

    it('to 未命中（如 INVESTIGATING 中间态）→ 静默不动作，不发信号', async () => {
      const { service, prisma, auditLogs, gateway } = makeService();

      await service.notifyComplaintStatus({ complaintNo: 'CPL1', owner: { customerId: 'c1' }, to: 'INVESTIGATING' });

      expect(prisma.customerNotification.create).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
      expect(gateway.emitCustomerUpdated).not.toHaveBeenCalled();
    });

    // fix round 2 同款覆盖（投诉路径）——见订单路径同名用例的注释。
    it('gateway.emitCustomerUpdated 同步抛错（脚本环境无 server）→ 通知行/审计照常写入，方法 resolve 不 throw', async () => {
      const { service, prisma, auditLogs, gateway } = makeService();
      gateway.emitCustomerUpdated.mockImplementation(() => {
        throw new TypeError("Cannot read properties of null (reading 'to')");
      });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        service.notifyComplaintStatus({ complaintNo: 'CPL-SIGNAL-ERR-1', owner: { customerId: 'c1' }, to: 'RESOLVED' }),
      ).resolves.toBeUndefined();

      expect(prisma.customerNotification.create).toHaveBeenCalledTimes(1);
      expect(prisma.customerNotification.create.mock.calls[0][0].data.templateCode).toBe('COMPLAINT_RESOLVED');
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
