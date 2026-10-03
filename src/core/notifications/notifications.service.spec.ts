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
      // 战役丙波三 T4：findMany 行为化——尊重 select（只回选中的键），不无视 select 假绿。
      findMany: jest.fn(async ({ select }: any = {}) =>
        CUSTOMERS.map((c) =>
          select
            ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (c as any)[k]]))
            : { ...c },
        ),
      ),
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

  it('19 个模板全量登记（丙波四 T2 新增 STATEMENT_ISSUED / DSR_RESOLVED，判据自点）', () => {
    expect(Object.keys(NOTIFICATION_TEMPLATES)).toHaveLength(19);
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

  // 战役丙波三 T4：协议发布 → 全员 fanout（协议当事人不分 lifecycle，故 findMany 无 where）。
  describe('notifyAgreementPublished', () => {
    // 正午 UTC：-12..+11 的任何机器时区下本地日都是 2026-11-02，硬编码期望串不随机器时区漂。
    const EFFECTIVE_AT = new Date('2026-11-02T12:00:00.000Z');

    it('① 逐客户落一行 AGREEMENT_PUBLISHED（AGREEMENT 深链键 + 邮件模拟）+ 每行 NOTIFICATION_SENT 审计 + 每客户信号一次', async () => {
      const { service, prisma, auditLogs, gateway, notificationRows } = makeService();

      await service.notifyAgreementPublished('v2', EFFECTIVE_AT);

      // 全量客户：findMany 只取 id/customerNo，不带 where（不分 lifecycle）
      expect(prisma.customerMain.findMany).toHaveBeenCalledTimes(1);
      const findInput = prisma.customerMain.findMany.mock.calls[0][0];
      expect(findInput.select).toEqual({ id: true, customerNo: true });
      expect(findInput.where).toBeUndefined();

      // 落库行（断言的是 mock 里累积的实际行，不是 create 的调用次数自说自话）
      expect(notificationRows).toHaveLength(CUSTOMERS.length);
      expect(notificationRows.map((r) => r.ownerCustomerNo)).toEqual(['CUS00001', 'CUS00002']);
      for (const row of notificationRows) {
        expect(row.templateCode).toBe('AGREEMENT_PUBLISHED');
        expect(row.relatedOrderType).toBe('AGREEMENT');
        expect(row.relatedOrderNo).toBe('v2');
        expect(row.title).toBe('Customer agreement update');
        expect(JSON.parse(row.channels)).toEqual(['IN_APP', 'EMAIL_SIMULATED']);
        expect(row.body).toBe(
          'Our customer agreement will be updated on 2026-11-02. Please review version v2 and accept it before it takes effect.',
        );
      }

      // 每行一条审计：既有 send 信封——templateCode/channels 顶层 + metadata 镜像，主体=AGREEMENT_VERSION·versionKey
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(CUSTOMERS.length);
      auditLogs.recordSystem.mock.calls.forEach(([input]: any[], i: number) => {
        expect(input.action).toBe('NOTIFICATION_SENT');
        expect(input.actionDomain).toBe('CUSTOMER');
        expect(input.templateCode).toBe('AGREEMENT_PUBLISHED');
        expect(input.channels).toEqual(['IN_APP', 'EMAIL_SIMULATED']);
        expect(input.metadata).toMatchObject({ templateCode: 'AGREEMENT_PUBLISHED', channels: ['IN_APP', 'EMAIL_SIMULATED'] });
        expect(input.requestId).toBe(notificationRows[i].id);
        expect(input.primarySubjectType).toBe('AGREEMENT_VERSION');
        expect(input.primarySubjectNo).toBe('v2');
        expect(input.ownerCustomerNo).toBe(CUSTOMERS[i].customerNo);
        expect(input.subjects).toEqual([
          { subjectType: 'AGREEMENT_VERSION', subjectNo: 'v2', subjectRole: 'PRIMARY' },
          { subjectType: 'CUSTOMER', subjectNo: CUSTOMERS[i].customerNo, subjectRole: 'OWNER' },
        ]);
      });

      // 每客户信号一次（以内部 id 为 room）
      expect(gateway.emitCustomerUpdated).toHaveBeenCalledTimes(CUSTOMERS.length);
      expect(gateway.emitCustomerUpdated.mock.calls.map((c: any[]) => c[0])).toEqual(['c1', 'c2']);
    });

    // 走查 T11 逮到：管理台选的"11-03"是迪拜本地 00:00（= UTC 11-02 20:00），正文曾写 UTC 日 11-02，
    // 与页面 / 管理台显示的 11-03 对不上。本测试的期望值用 Date 本地 getter 手算（不走 Intl，避免与
    // 实现同调用成恒真）；在 UTC+4 等偏移机器上，UTC 切片实现会在此红（实测见 task-11 修复报告）。
    // jest 沙箱里改 process.env.TZ 不生效，故无法在测试内钉死时区，只能用机器本地时区自洽比对。
    it('①b 生效日写本地日 YYYY-MM-DD，不是 UTC 日（UTC 20:00 = 迪拜次日 00:00 的临界点）', async () => {
      const { service, notificationRows } = makeService();
      const edge = new Date('2026-11-02T20:00:00.000Z');
      const pad = (n: number) => String(n).padStart(2, '0');
      const localDay = `${edge.getFullYear()}-${pad(edge.getMonth() + 1)}-${pad(edge.getDate())}`;

      await service.notifyAgreementPublished('v2', edge);

      expect(notificationRows).toHaveLength(CUSTOMERS.length);
      for (const row of notificationRows) {
        expect(row.body).toContain(`will be updated on ${localDay}.`);
        expect(row.body).toMatch(/updated on \d{4}-\d{2}-\d{2}\./);
      }
    });

    it('② 中途一个客户 create 抛错 → 方法不外抛，其余客户照发，坏的那个无审计无信号', async () => {
      const { service, prisma, auditLogs, gateway, notificationRows } = makeService();
      prisma.customerNotification.create.mockRejectedValueOnce(new Error('db hiccup'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.notifyAgreementPublished('v2', EFFECTIVE_AT)).resolves.toBeUndefined();

      // c1 失败、c2 成功：只落一行（c2），审计与信号也只有 c2 的
      expect(prisma.customerNotification.create).toHaveBeenCalledTimes(2);
      expect(notificationRows.map((r) => r.ownerCustomerNo)).toEqual(['CUS00002']);
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      expect(auditLogs.recordSystem.mock.calls[0][0].ownerCustomerNo).toBe('CUS00002');
      expect(gateway.emitCustomerUpdated.mock.calls.map((c: any[]) => c[0])).toEqual(['c2']);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('③ 模板键 AGREEMENT_PUBLISHED 已登记（simulateEmail=true）；键查无 → 静默零发（不查客户、不落库、不审计、不发信号，不兜底）', async () => {
      expect(NOTIFICATION_TEMPLATES.AGREEMENT_PUBLISHED).toBeDefined();
      expect(NOTIFICATION_TEMPLATES.AGREEMENT_PUBLISHED.simulateEmail).toBe(true);

      const saved = NOTIFICATION_TEMPLATES.AGREEMENT_PUBLISHED;
      delete NOTIFICATION_TEMPLATES.AGREEMENT_PUBLISHED;
      try {
        const { service, prisma, auditLogs, gateway } = makeService();

        await expect(service.notifyAgreementPublished('v2', EFFECTIVE_AT)).resolves.toBeUndefined();

        expect(prisma.customerMain.findMany).not.toHaveBeenCalled();
        expect(prisma.customerNotification.create).not.toHaveBeenCalled();
        expect(auditLogs.recordSystem).not.toHaveBeenCalled();
        expect(gateway.emitCustomerUpdated).not.toHaveBeenCalled();
      } finally {
        NOTIFICATION_TEMPLATES.AGREEMENT_PUBLISHED = saved;
      }
    });

    it('信号抛错（脚本环境无 server）→ 每客户的通知行/审计照常写入，不外抛', async () => {
      const { service, auditLogs, gateway, notificationRows } = makeService();
      gateway.emitCustomerUpdated.mockImplementation(() => {
        throw new TypeError("Cannot read properties of null (reading 'to')");
      });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.notifyAgreementPublished('v2', EFFECTIVE_AT)).resolves.toBeUndefined();

      expect(notificationRows).toHaveLength(CUSTOMERS.length);
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(CUSTOMERS.length);
      consoleErrorSpy.mockRestore();
    });
  });

  // 战役丙波四 T2：月结单发出 / 资料请求办结 → 单客户站内信（模拟邮件）。入参 customerId 是内部 id（'c1'），
  // 经既有 resolveOwner 补出 customerNo；mock 的 findUnique 按 where 语义返回，未知 id 查无即 resolveOwner 抛错。
  describe('notifyStatementIssued', () => {
    it('落库 STATEMENT 类通知（EMAIL_SIMULATED + 深链键 = 月结单号）+ NOTIFICATION_SENT 审计（主体 MONTHLY_STATEMENT）+ 信号', async () => {
      const { service, auditLogs, gateway, notificationRows } = makeService();

      await service.notifyStatementIssued({ customerId: 'c1', statementNo: 'STM-CU1-202609', periodMonth: '2026-09' });

      expect(notificationRows).toHaveLength(1);
      const row = notificationRows[0];
      expect(row.templateCode).toBe('STATEMENT_ISSUED');
      expect(row.ownerCustomerNo).toBe('CUS00001');
      expect(row.relatedOrderType).toBe('STATEMENT');
      expect(row.relatedOrderNo).toBe('STM-CU1-202609');
      expect(JSON.parse(row.channels)).toContain('EMAIL_SIMULATED');
      expect(row.body).toBe(
        'Your account statement for 2026-09 has been issued and is available in Transaction history. Reference STM-CU1-202609.',
      );

      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit.action).toBe('NOTIFICATION_SENT');
      expect(audit.requestId).toBe(row.id);
      expect(audit.primarySubjectType).toBe('MONTHLY_STATEMENT');
      expect(audit.primarySubjectNo).toBe('STM-CU1-202609');
      expect(audit.subjects).toEqual([
        { subjectType: 'MONTHLY_STATEMENT', subjectNo: 'STM-CU1-202609', subjectRole: 'PRIMARY' },
        { subjectType: 'CUSTOMER', subjectNo: 'CUS00001', subjectRole: 'OWNER' },
      ]);

      expect(gateway.emitCustomerUpdated).toHaveBeenCalledTimes(1);
      expect(gateway.emitCustomerUpdated).toHaveBeenCalledWith('c1');
    });

    it('内部抛错（落库挂）→ 方法 resolve 不 throw，无审计无信号', async () => {
      const { service, prisma, auditLogs, gateway } = makeService();
      prisma.customerNotification.create.mockRejectedValueOnce(new Error('db unavailable'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        service.notifyStatementIssued({ customerId: 'c1', statementNo: 'STM-CU1-202609', periodMonth: '2026-09' }),
      ).resolves.toBeUndefined();

      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
      expect(gateway.emitCustomerUpdated).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('信号抛错（脚本环境无 server）→ 通知行/审计照常写入，不外抛', async () => {
      const { service, auditLogs, gateway, notificationRows } = makeService();
      gateway.emitCustomerUpdated.mockImplementation(() => {
        throw new TypeError("Cannot read properties of null (reading 'to')");
      });
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        service.notifyStatementIssued({ customerId: 'c2', statementNo: 'STM-CU2-202609', periodMonth: '2026-09' }),
      ).resolves.toBeUndefined();

      expect(notificationRows).toHaveLength(1);
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('notifyDsrResolved', () => {
    it('落库 DSR 类通知（EMAIL_SIMULATED + 深链键 = 请求单号）+ NOTIFICATION_SENT 审计（主体 DSR_REQUEST）+ 信号', async () => {
      const { service, auditLogs, gateway, notificationRows } = makeService();

      await service.notifyDsrResolved({ customerId: 'c2', requestNo: 'DSR-261003-000001' });

      expect(notificationRows).toHaveLength(1);
      const row = notificationRows[0];
      expect(row.templateCode).toBe('DSR_RESOLVED');
      expect(row.ownerCustomerNo).toBe('CUS00002');
      expect(row.relatedOrderType).toBe('DSR');
      expect(row.relatedOrderNo).toBe('DSR-261003-000001');
      expect(JSON.parse(row.channels)).toContain('EMAIL_SIMULATED');
      expect(row.body).toBe('Your personal data request DSR-261003-000001 has been resolved. Open the request to view the outcome.');

      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      const audit = auditLogs.recordSystem.mock.calls[0][0];
      expect(audit.action).toBe('NOTIFICATION_SENT');
      expect(audit.requestId).toBe(row.id);
      expect(audit.primarySubjectType).toBe('DSR_REQUEST');
      expect(audit.primarySubjectNo).toBe('DSR-261003-000001');
      expect(audit.subjects).toEqual([
        { subjectType: 'DSR_REQUEST', subjectNo: 'DSR-261003-000001', subjectRole: 'PRIMARY' },
        { subjectType: 'CUSTOMER', subjectNo: 'CUS00002', subjectRole: 'OWNER' },
      ]);

      expect(gateway.emitCustomerUpdated).toHaveBeenCalledTimes(1);
      expect(gateway.emitCustomerUpdated).toHaveBeenCalledWith('c2');
    });

    it('内部抛错（客户查无 → resolveOwner 抛）→ 方法 resolve 不 throw，不落库', async () => {
      const { service, prisma, auditLogs } = makeService();
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.notifyDsrResolved({ customerId: 'no-such-id', requestNo: 'DSR-261003-000001' })).resolves.toBeUndefined();

      expect(prisma.customerNotification.create).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
