import { ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CustomerAuthService } from './customer-auth.service';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { AgreementsReadService } from '../agreements/agreements-read.service';

describe('CustomerAuthService', () => {
  const prismaMock: any = {
    customerMain: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const jwtServiceMock: any = {
    sign: jest.fn(),
  };
  const auditLogsServiceMock: any = {
    recordByActor: jest.fn(),
    recordSystem: jest.fn(),
  };

  // 战役丙波三 T6：注册链路新增对协议读服务的依赖。本 describe 内的既有用例都与协议无关，
  // 给一个惰性 stub 即可；"注册落同意"的行为断言见文件末尾独立 describe（真读服务 + 行为化内存库）。
  const agreementsReadStub: any = {
    getCurrentEffective: jest.fn().mockResolvedValue({ versionKey: 'v1' }),
    recordConsent: jest.fn().mockResolvedValue(undefined),
  };

  let service: CustomerAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomerAuthService(prismaMock, jwtServiceMock, auditLogsServiceMock, agreementsReadStub);
  });

  // 2026-08-26（812de117）裁定"客户登录流水归安全日志，本项目不做"，删的是
  // CUSTOMER_REGISTERED/CUSTOMER_REGISTER_FAILED/CUSTOMER_LOGIN_FAILED 三个
  // AUTH 域动作码（已连同常量一并退役，见 audit-actions.constant.ts 现无残留）。
  // CUSTOMER_CREATED 是另一个仍在役的 CUSTOMER 域动作码——customers.service.ts
  // 的管理台建户路径一直在写它，自助注册路径此前直接绕过 CustomersService.create
  // 落库，从未补上同一条，是两条建户路径之间的留痕缺口（波二 Task 5 补齐）。
  // 本条测试断言只收窄到"登录门不写审计"，不再断言"整份文件零审计调用"。
  it('波二 Task 5：register 创建成功后写 CUSTOMER_CREATED 审计（与管理台建户路径同码，补齐自助注册留痕缺口）', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(null);
    prismaMock.customerMain.create.mockResolvedValue({
      id: 'c1', customerNo: 'CU250907001', email: 'new@example.com',
      customerType: 'INDIVIDUAL', passwordHash: 'hashed',
    });

    await service.register({ email: 'new@example.com', password: '123456', customerType: 'INDIVIDUAL' });

    expect(auditLogsServiceMock.recordByActor).toHaveBeenCalledTimes(1);
    expect(auditLogsServiceMock.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.CUSTOMER_CREATED,
        ownerCustomerNo: 'CU250907001',
      }),
      expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CU250907001' }),
    );
  });

  it('登录门（validateCustomer）仍不写任何审计——客户登录流水归安全日志，2026-08-26 裁定未变', async () => {
    prismaMock.customerMain.findFirst.mockResolvedValue(null);

    await service.validateCustomer('nobody@example.com', 'x');

    expect(auditLogsServiceMock.recordByActor).not.toHaveBeenCalled();
    expect(auditLogsServiceMock.recordSystem).not.toHaveBeenCalled();
  });

  // ★ 本轮语义反转（Task 5）：登录门只认关系是否终止。
  // 被制裁的客户【必须能登录】，且登录体验与常人无异 —— 在登录页竖一块
  // 「账号已冻结」的牌子，本身就是把调查告知当事人（tipping-off，多数 AML
  // 法域的刑事犯罪）。受限客户同样要能登录：他们得看到 DISCLOSED 提示、去补材料。
  it('制裁客户（有 OPEN SANCTION 限制）允许登录 —— 本轮语义反转', async () => {
    const passwordHash = await bcrypt.hash('123456', 4);
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash,
      lifecycle: 'ACTIVE',
      failedLoginCount: 0,
    });

    await expect(
      service.validateCustomer('test@example.com', '123456'),
    ).resolves.toMatchObject({ id: 'c1' });
  });

  it('关系已终止（OFFBOARDED）的客户被拒登录，且【不写】任何提示性合规审计', async () => {
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
      lifecycle: 'OFFBOARDED',
      failedLoginCount: 0,
    });

    await expect(
      service.validateCustomer('test@example.com', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.customerMain.update).not.toHaveBeenCalled();
  });

  it('should allow login when restriction is active but hold is not frozen', async () => {
    const passwordHash = await bcrypt.hash('123456', 4);
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash,
      lifecycle: 'ACTIVE',
      failedLoginCount: 1,
      lockedUntil: null,
    });
    prismaMock.customerMain.update.mockResolvedValue({});

    const result = await service.validateCustomer('test@example.com', '123456');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'c1',
        email: 'test@example.com',
      }),
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          failedLoginCount: 0,
          lockedUntil: null,
        }),
      }),
    );
  });
});

// 战役丙波三 T6：注册同意落库。用【真的】AgreementsReadService 配行为化内存库——
// "consent 行 + AGREEMENT_ACCEPTED(source=REGISTER) 审计"必须是 T2 真写出来的，不是 stub 事先编好的。
describe('CustomerAuthService.register 落协议同意（波三 T6）', () => {
  const makeWired = (versions: Array<{ versionKey: string; status: string; effectiveAt: Date | null }>) => {
    const consentRows: any[] = [];
    const prisma: any = {
      customerMain: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'c1', customerNo: 'CU250907001', email: 'new@example.com',
          customerType: 'INDIVIDUAL', passwordHash: 'hashed',
        }),
      },
      customerAgreementVersion: {
        // tickEffective 的"到点待翻"查询与 EFFECTIVE / PUBLISHED 查询都经 findFirst，按 status 过滤；
        // 到点判据（effectiveAt<=now）这里按语义实现，免得无视 where 假绿。
        findFirst: jest.fn(async ({ where }: any = {}) =>
          versions.find(
            (v) =>
              v.status === where.status &&
              (where.effectiveAt?.lte === undefined || (v.effectiveAt != null && v.effectiveAt <= where.effectiveAt.lte)),
          ) ?? null,
        ),
      },
      customerAgreementConsent: {
        create: jest.fn(async ({ data }: any) => {
          consentRows.push(data);
          return data;
        }),
      },
    };
    const events: string[] = [];
    const audit: any = {
      recordSystem: jest.fn(),
      recordByActor: jest.fn(async (input: any) => {
        events.push(input.action);
        return {};
      }),
    };
    const agreementsRead = new AgreementsReadService(prisma, audit);
    const service = new CustomerAuthService(prisma, { sign: jest.fn() } as any, audit, agreementsRead);
    return { service, prisma, audit, consentRows, events };
  };

  const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  it('注册后落一行 consent：versionKey=注册时刻的生效版（此处 v2 生效，证明不是写死 v1）、ACCEPTED，customer 取自刚建的客户', async () => {
    const { service, consentRows } = makeWired([
      { versionKey: 'v1', status: 'SUPERSEDED', effectiveAt: new Date('2026-01-01') },
      { versionKey: 'v2', status: 'EFFECTIVE', effectiveAt: new Date('2026-06-01') },
    ]);

    await service.register({ email: 'new@example.com', password: '123456', customerType: 'INDIVIDUAL' });

    expect(consentRows).toEqual([
      { customerId: 'c1', customerNo: 'CU250907001', versionKey: 'v2', action: 'ACCEPTED' },
    ]);
  });

  it('审计顺序：CUSTOMER_CREATED 在前，AGREEMENT_ACCEPTED(source=REGISTER) 在后', async () => {
    const { service, audit, events } = makeWired([{ versionKey: 'v1', status: 'EFFECTIVE', effectiveAt: new Date('2026-01-01') }]);

    await service.register({ email: 'new@example.com', password: '123456', customerType: 'INDIVIDUAL' });

    expect(events).toEqual([AuditActions.CUSTOMER_CREATED, AuditActions.AGREEMENT_ACCEPTED]);
    expect(audit.recordByActor).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: AuditActions.AGREEMENT_ACCEPTED, versionKey: 'v1', source: 'REGISTER', ownerCustomerNo: 'CU250907001' }),
      expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CU250907001' }),
    );
  });

  it('注册时已有在途 v2：照常只同意生效版 v1（不特殊处理，登录后由弹窗引导）', async () => {
    const { service, consentRows } = makeWired([
      { versionKey: 'v1', status: 'EFFECTIVE', effectiveAt: new Date('2026-01-01') },
      { versionKey: 'v2', status: 'PUBLISHED', effectiveAt: FUTURE },
    ]);

    await service.register({ email: 'new@example.com', password: '123456', customerType: 'INDIVIDUAL' });

    expect(consentRows.map((r) => `${r.versionKey}/${r.action}`)).toEqual(['v1/ACCEPTED']);
  });

  it('邮箱已存在 → 抛错且不落 consent（同意绑在建户成功之后）', async () => {
    const { service, prisma, consentRows } = makeWired([{ versionKey: 'v1', status: 'EFFECTIVE', effectiveAt: new Date('2026-01-01') }]);
    prisma.customerMain.findUnique.mockResolvedValue({ id: 'old' });

    await expect(
      service.register({ email: 'new@example.com', password: '123456', customerType: 'INDIVIDUAL' }),
    ).rejects.toThrow('Email already exists');
    expect(consentRows).toHaveLength(0);
  });
});
