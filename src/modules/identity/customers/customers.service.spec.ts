import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { CustomersService } from './customers.service';

const mockPrismaService = {
  customerMain: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAuditLogs = { recordByActor: jest.fn() };

describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findOne queries the plain row without relation includes', async () => {
    // 2026-09-03 客户域业务号化：latestRiskApproval include 随死 UI 段退役摘除，
    // 详情就是主档一行。
    mockPrismaService.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
    });

    const customer = await service.findOne('c1');

    expect(mockPrismaService.customerMain.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
    });
    expect((customer as any)?.id).toBe('c1');
  });

  it('findByCustomerNo resolves by the business key (铁律⑥ controller 换号入口)', async () => {
    mockPrismaService.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CUS-0001',
    });

    const customer = await service.findByCustomerNo('CUS-0001');

    expect(mockPrismaService.customerMain.findUnique).toHaveBeenCalledWith({
      where: { customerNo: 'CUS-0001' },
    });
    expect((customer as any)?.id).toBe('c1');
  });

  describe('updateOnboardingData', () => {
    it('writes onboarding fields to customerMain by id, passing data through untouched', async () => {
      const data = { firstName: 'A', sumsubCurrentLevelName: 'basic-cdd-level' };
      mockPrismaService.customerMain.update.mockResolvedValue({ id: 'c1', ...data });

      const updated = await service.updateOnboardingData('c1', data);

      expect(mockPrismaService.customerMain.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data,
      });
      expect((updated as any)?.id).toBe('c1');
    });

    it('writes through the tx client when one is supplied, not the injected prisma', async () => {
      const data = { eddRequired: true };
      const txCustomerMainUpdate = jest.fn().mockResolvedValue({ id: 'c1', ...data });
      const tx = { customerMain: { update: txCustomerMainUpdate } } as any;

      await service.updateOnboardingData('c1', data, tx);

      expect(txCustomerMainUpdate).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data,
      });
      expect(mockPrismaService.customerMain.update).not.toHaveBeenCalled();
    });
  });

  describe('applyTierUpgrade', () => {
    it('applyTierUpgrade: BASIC→PREMIUM 唯一写口；非 BASIC 显式拒', async () => {
      mockPrismaService.customerMain.findUnique.mockResolvedValueOnce({ tradingTier: 'BASIC' });
      mockPrismaService.customerMain.update.mockResolvedValueOnce({ id: 'c1', tradingTier: 'PREMIUM' });

      const r = await service.applyTierUpgrade('c1');

      expect(r).toEqual({ fromTier: 'BASIC', toTier: 'PREMIUM' });
      expect(mockPrismaService.customerMain.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { tradingTier: 'PREMIUM' },
      });

      mockPrismaService.customerMain.findUnique.mockResolvedValueOnce({ tradingTier: 'PREMIUM' });
      await expect(service.applyTierUpgrade('c1')).rejects.toThrow(BadRequestException);
    });
  });

  // 丙波四 T8：改档案通道（CUSTOMER_WRITE 孤儿桶的第一条真路由）——CDD 七字段白名单，逐字段 diff 进审计。
  describe('updateProfileFields', () => {
    const compliance: ApprovalActorContext = {
      actorType: 'ADMIN', userId: 'uuid-co', userNo: 'ADM-CO', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'],
    };
    const baseRow = {
      id: 'c1', customerNo: 'CU0001', email: 'henry@example.com', phone: '+971500000001',
      firstName: 'Henry', lastName: 'Lau', dateOfBirth: '1990-05-01', nationality: 'AE',
      idDocType: 'EMIRATES_ID', idDocNumber: '784-1990-1234567-1', residentialAddress: 'Dubai Marina, Dubai',
      riskRating: 'LOW', lifecycle: 'ACTIVE',
    };
    let row: Record<string, any>;
    let order: string[];

    beforeEach(() => {
      row = { ...baseRow };
      order = [];
      // 行为化 mock：findUnique 真按 customerNo 找、update 真合并 data——diff 算对不对要看真读到的旧值。
      mockPrismaService.customerMain.findUnique.mockImplementation(async ({ where }: any) =>
        where.customerNo === row.customerNo ? { ...row } : null);
      mockPrismaService.customerMain.update.mockImplementation(async ({ where, data }: any) => {
        order.push('update');
        if (where.id !== row.id) throw new Error('mock: update target not found');
        Object.assign(row, data);
        return { ...row };
      });
      mockAuditLogs.recordByActor.mockImplementation(async () => { order.push('audit'); return {}; });
    });

    it.each(['email', 'phone', 'riskRating', 'lifecycle', 'tradingTier', 'customerNo', 'sumsubApplicantId'])(
      'rejects a key outside the CDD whitelist (%s) with 400 PROFILE_FIELD_NOT_EDITABLE — even next to a valid key, nothing is written or audited',
      async (key) => {
        const err = await service
          .updateProfileFields(compliance, 'CU0001', { firstName: 'Harry', [key]: 'x' } as any)
          .catch((e) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.getResponse()).toMatchObject({ code: 'PROFILE_FIELD_NOT_EDITABLE' });
        expect(err.getResponse().message).toContain(key);
        expect(mockPrismaService.customerMain.update).not.toHaveBeenCalled();
        expect(mockAuditLogs.recordByActor).not.toHaveBeenCalled();
        expect(row.firstName).toBe('Henry');
      },
    );

    it('404s on an unknown customerNo (nothing written or audited)', async () => {
      await expect(service.updateProfileFields(compliance, 'CU9999', { firstName: 'Harry' })).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.customerMain.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.recordByActor).not.toHaveBeenCalled();
    });

    it('writes only the fields that actually changed, then audits CUSTOMER_PROFILE_UPDATED (persist first) with changedFields and a per-field before/after diff in metadata', async () => {
      await service.updateProfileFields(compliance, 'CU0001', {
        firstName: 'Henry', // 与现值相同——不算改动
        lastName: 'Liu', nationality: 'GB',
      });

      expect(mockPrismaService.customerMain.update).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.customerMain.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { lastName: 'Liu', nationality: 'GB' } });
      expect(row).toMatchObject({ firstName: 'Henry', lastName: 'Liu', nationality: 'GB', riskRating: 'LOW' });
      expect(order).toEqual(['update', 'audit']);

      expect(mockAuditLogs.recordByActor).toHaveBeenCalledTimes(1);
      const [input, actor] = mockAuditLogs.recordByActor.mock.calls[0];
      expect(input).toMatchObject({
        action: 'CUSTOMER_PROFILE_UPDATED', actionDomain: 'CUSTOMER',
        primarySubjectType: 'CUSTOMER', primarySubjectNo: 'CU0001', ownerCustomerNo: 'CU0001',
        customerNo: 'CU0001', changedFields: ['lastName', 'nationality'],
        metadata: {
          customerNo: 'CU0001', changedFields: ['lastName', 'nationality'],
          before: { lastName: 'Lau', nationality: 'AE' }, after: { lastName: 'Liu', nationality: 'GB' },
        },
        sourcePlatform: 'ADMIN_API',
      });
      expect(input.requestId).toEqual(expect.any(String));
      expect(input.requestId.length).toBeGreaterThan(0);
      expect(actor).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-CO', actorDisplayName: 'ADM-CO', actorRolesAtTime: ['COMPLIANCE_OFFICER'] });
    });

    it('two edits of the same customer carry different requestIds (the audit idempotency key would otherwise swallow the second)', async () => {
      await service.updateProfileFields(compliance, 'CU0001', { lastName: 'Liu' });
      await service.updateProfileFields(compliance, 'CU0001', { lastName: 'Lau' });
      const ids = mockAuditLogs.recordByActor.mock.calls.map((c) => c[0].requestId);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    });

    it('masks the ID number and the residential address in the audit diff (existing audit-mask rules); names and nationality stay readable', async () => {
      await service.updateProfileFields(compliance, 'CU0001', {
        idDocNumber: '784-1991-7654321-9', residentialAddress: 'Palm Jumeirah, Villa 12, Dubai', nationality: 'GB',
      });
      const [input] = mockAuditLogs.recordByActor.mock.calls[0];
      const serialized = JSON.stringify(input);
      for (const raw of ['784-1990-1234567-1', '784-1991-7654321-9', 'Dubai Marina, Dubai', 'Palm Jumeirah, Villa 12, Dubai']) {
        expect(serialized).not.toContain(raw);
      }
      expect(input.metadata.before.idDocNumber).toMatch(/^\*+67-1$/);
      expect(input.metadata.after.idDocNumber).toMatch(/^\*+21-9$/);
      expect(input.metadata.after.residentialAddress).not.toBe('Palm Jumeirah, Villa 12, Dubai');
      expect(input.metadata.before.nationality).toBe('AE');
      expect(input.metadata.after.nationality).toBe('GB');
      // 掩码只动审计副本，库里写的是真值。
      expect(row.idDocNumber).toBe('784-1991-7654321-9');
    });

    it('a patch that changes nothing writes nothing and audits nothing (no persisted action, no trail)', async () => {
      await service.updateProfileFields(compliance, 'CU0001', { firstName: 'Henry', nationality: 'AE' });
      expect(mockPrismaService.customerMain.update).not.toHaveBeenCalled();
      expect(mockAuditLogs.recordByActor).not.toHaveBeenCalled();
    });
  });
});
