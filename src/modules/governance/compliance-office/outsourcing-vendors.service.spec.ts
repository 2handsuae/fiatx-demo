// 战役甲波四 T4 / 甲波六 T6 · OutsourcingVendorsService 行为测试。
// 服务是真的（真迁移表 + 真 ACTION_BY_EDGE + 真 assertActionSpec 词表校验），Prisma 是按 where 读写的内存行 mock。
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { OutsourcingVendorsService } from './outsourcing-vendors.service';
import { VENDOR_ACTION_BY_EDGE, VENDOR_TRANSITIONS, VendorStatus } from './compliance-office.constants';
import { ApplyVendorBodyDto } from './dto/compliance-office.dto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';

const ops: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['OPS_OFFICER'] };
const compliance: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-compliance', userNo: 'ADM-COMPLIANCE', roleCodes: ['COMPLIANCE_OFFICER'] };

const baseDto = (overrides: Partial<ApplyVendorBodyDto> = {}): ApplyVendorBodyDto => ({
  name: 'Nimbus Cloud Hosting LLC',
  registeredIn: 'United Arab Emirates (Dubai)',
  registrationNo: 'DED-778812',
  deliveryLocations: ['AE', 'IE'],
  contactName: 'Sara Khan',
  contactEmail: 'sara@nimbus.example',
  beneficialOwners: [{ seq: 1, name: 'Omar Nasser', nationality: 'AE' }, { seq: 2, name: 'Li Wei' }],
  serviceDescription: 'Managed cloud hosting for back-office systems',
  regulatedFunction: false,
  contractStart: '2026-11-01',
  involvesPersonalData: true,
  involvesConfidentialInfo: false,
  applicationReason: 'Move back-office hosting off the legacy datacentre',
  impactLicence: false,
  impactLegal: false,
  impactFinancial: false,
  impactContinuity: false,
  replaceability: 'EASY',
  ...overrides,
});

/** 行为化内存行 mock（照 lp-profile.service.spec.ts 的 makePrisma 先例：真按 where 子句读写）。
 *  rows 一并导出：状态机用例直接把一行摆成任一出发态，不必走完整条弧。 */
function makePrisma() {
  const rows = new Map<string, any>();
  let clock = Date.parse('2026-10-29T00:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  const matches = (row: any, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => row[k] === v);
  const outsourcingVendor = {
    create: jest.fn(async ({ data }: any) => {
      const row = { id: randomUUID(), approvalNo: null, notificationFilingNo: null, criticalityReason: null, notes: null, createdAt: tick(), updatedAt: tick(), ...data };
      rows.set(row.vendorNo, row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const existing = rows.get(where.vendorNo);
      if (!existing) throw new Error(`no such row: ${where.vendorNo}`);
      const updated = { ...existing, ...data, updatedAt: tick() };
      rows.set(where.vendorNo, updated);
      return updated;
    }),
    findUnique: jest.fn(async ({ where }: any) => rows.get(where.vendorNo) ?? null),
    findFirst: jest.fn(async ({ where }: any) => [...rows.values()].find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async (args: any = {}) => {
      const list = [...rows.values()].filter((r) => matches(r, args.where ?? {}));
      const orderBy = args.orderBy;
      if (!orderBy) return list;
      const [field] = Object.keys(orderBy);
      const dir = orderBy[field] === 'asc' ? 1 : -1;
      return list.sort((a, b) => dir * (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0));
    }),
  };
  return { outsourcingVendor, rows };
}

describe('OutsourcingVendorsService (甲波四 T4 / 甲波六 T6)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: OutsourcingVendorsService;
  let audits: Array<{ via: 'actor' | 'system'; input: any }>;

  beforeEach(async () => {
    prisma = makePrisma();
    audits = [];
    // 生产那道词表校验亲自跑一遍每条信封（缺必填 / 缺 causation / 域不符都会当场抛，同生产）
    const realSpec = new AuditLogsService(null as any);
    const auditLogs = {
      recordByActor: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'actor', input }); }),
      recordSystem: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'system', input }); }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        OutsourcingVendorsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(OutsourcingVendorsService);
  });

  const actionsOf = () => audits.map((a) => a.input.action as string);

  /** 申请一家，再把它摆到指定状态 / 重大性（审计清零，让断言只看被测那一步）。 */
  async function seedVendor(status: string = VendorStatus.PENDING_ASSESSMENT, criticality: 'MATERIAL' | 'NON_MATERIAL' = 'NON_MATERIAL'): Promise<string> {
    const impact = criticality === 'MATERIAL' ? { impactContinuity: true } : {};
    const { vendorNo } = await service.apply(ops, baseDto(impact));
    prisma.rows.set(vendorNo, { ...prisma.rows.get(vendorNo), status });
    audits.length = 0;
    return vendorNo;
  }

  // ── apply ──────────────────────────────────────────────────────────
  describe('apply', () => {
    it('落 VEN 号的一行，出生即 PENDING_ASSESSMENT；申请表字段原样入库（多值字段：交付地 CSV、实控人 JSON），创建人记 userNo', async () => {
      const { vendorNo } = await service.apply(ops, baseDto({ annualFee: '120000', feeCurrency: 'AED', subcontracts: true, subcontractorNames: 'Azure ME' }));
      expect(vendorNo).toMatch(/^VEN\d{12}$/);
      const row = await service.findByNo(vendorNo);
      expect(row).toMatchObject({
        status: 'PENDING_ASSESSMENT', createdByUserId: 'ADM-OPS',
        name: 'Nimbus Cloud Hosting LLC', registeredIn: 'United Arab Emirates (Dubai)', registrationNo: 'DED-778812',
        deliveryLocations: 'AE,IE', contactName: 'Sara Khan', contactEmail: 'sara@nimbus.example',
        regulatedFunction: false, involvesPersonalData: true, involvesConfidentialInfo: false,
        subcontracts: true, subcontractorNames: 'Azure ME', annualFee: '120000', feeCurrency: 'AED',
        replaceability: 'EASY', approvalNo: null, notificationFilingNo: null,
      });
      expect(JSON.parse(row.beneficialOwners)).toEqual([{ seq: 1, name: 'Omar Nasser', nationality: 'AE' }, { seq: 2, name: 'Li Wei' }]);
      expect(row.contractStart.toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(row.contractEnd).toBeNull();
      expect(row.traceId).toEqual(expect.any(String));
    });

    it('重大性由系统判：四问任一「会」→ MATERIAL；全「不会」→ NON_MATERIAL；运营改不了（DTO 里没有 criticality 这一项）', async () => {
      const a = await service.apply(ops, baseDto());
      const b = await service.apply(ops, baseDto({ impactLegal: true }));
      expect((await service.findByNo(a.vendorNo)).criticality).toBe('NON_MATERIAL');
      expect((await service.findByNo(b.vendorNo)).criticality).toBe('MATERIAL');
      expect('criticality' in baseDto()).toBe(false);
    });

    it('留痕只有 VENDOR_APPLIED（操作员写）一条，顶层 criticality、metadata 镜像判定结果与四问', async () => {
      await service.apply(ops, baseDto({ impactFinancial: true }));
      expect(actionsOf()).toEqual(['VENDOR_APPLIED']);
      const { via, input } = audits[0];
      expect(via).toBe('actor');
      expect(input).toMatchObject({ actionDomain: 'GOVERNANCE', primarySubjectType: 'OUTSOURCING_VENDOR', criticality: 'MATERIAL' });
      expect(input.metadata).toMatchObject({ criticality: 'MATERIAL', name: 'Nimbus Cloud Hosting LLC', impactFinancial: true, impactLicence: false });
      expect(input.requestId).toEqual(expect.any(String));
    });

    it('「受监管职能」答是：发牌机构与牌照号必填，缺任一 → 400 且什么都没写', async () => {
      await expect(service.apply(ops, baseDto({ regulatedFunction: true }))).rejects.toThrow(BadRequestException);
      await expect(service.apply(ops, baseDto({ regulatedFunction: true, licensingAuthority: 'VARA' }))).rejects.toThrow(/licen[cs]e/i);
      await expect(service.apply(ops, baseDto({ regulatedFunction: true, licensingAuthority: '  ', licenceNo: 'VL/1' }))).rejects.toThrow(BadRequestException);
      expect(prisma.outsourcingVendor.create).not.toHaveBeenCalled();
      expect(audits).toEqual([]);
    });

    it('「受监管职能」答是且两项都填 → 通过；答否则两项都可以空', async () => {
      await expect(service.apply(ops, baseDto({ regulatedFunction: true, licensingAuthority: 'VARA', licenceNo: 'VL/24/001' }))).resolves.toBeDefined();
      await expect(service.apply(ops, baseDto({ regulatedFunction: false }))).resolves.toBeDefined();
    });
  });

  // ── resubmit ───────────────────────────────────────────────────────
  describe('resubmit', () => {
    it('RETURNED → 整行覆盖并回 PENDING_ASSESSMENT；VENDOR_RESUBMITTED 带 from/to 与新表单', async () => {
      const vendorNo = await seedVendor(VendorStatus.RETURNED);
      const updated = await service.resubmit(vendorNo, ops, baseDto({ registrationNo: 'DED-999', deliveryLocations: ['AE'] }));

      expect(updated.status).toBe('PENDING_ASSESSMENT');
      expect(prisma.rows.get(vendorNo)).toMatchObject({ registrationNo: 'DED-999', deliveryLocations: 'AE', status: 'PENDING_ASSESSMENT' });
      expect(actionsOf()).toEqual(['VENDOR_RESUBMITTED']);
      expect(audits[0].input).toMatchObject({ fromStatus: 'RETURNED', toStatus: 'PENDING_ASSESSMENT' });
      expect(audits[0].input.afterData).toMatchObject({ registrationNo: 'DED-999' });
      expect(audits[0].via).toBe('actor');
    });

    it.each([
      VendorStatus.PENDING_ASSESSMENT, VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_NOTIFICATION, VendorStatus.ACTIVE,
      VendorStatus.REJECTED, VendorStatus.TERMINATED,
    ])('只收 RETURNED：%s 态 → 400，行不变，零审计（PENDING_APPROVAL → PENDING_ASSESSMENT 是撤单边，不能借「重提」走）', async (status) => {
      const vendorNo = await seedVendor(status);
      const before = { ...prisma.rows.get(vendorNo) };
      await expect(service.resubmit(vendorNo, ops, baseDto({ name: 'Hijacked' }))).rejects.toThrow(BadRequestException);
      expect(prisma.rows.get(vendorNo)).toEqual(before);
      expect(audits).toEqual([]);
    });

    it('不得降档：原 MATERIAL（自判或合规升档）改答全「不会」仍是 MATERIAL；升档理由原样保留', async () => {
      const vendorNo = await seedVendor(VendorStatus.RETURNED, 'MATERIAL');
      prisma.rows.set(vendorNo, { ...prisma.rows.get(vendorNo), criticalityReason: 'Hosts the ledger replica' });
      await service.resubmit(vendorNo, ops, baseDto({ impactContinuity: false }));
      expect(prisma.rows.get(vendorNo)).toMatchObject({ criticality: 'MATERIAL', criticalityReason: 'Hosts the ledger replica' });
    });

    it('原 NON_MATERIAL 重提时改答「会」→ 升为 MATERIAL（判定随表单重算）', async () => {
      const vendorNo = await seedVendor(VendorStatus.RETURNED, 'NON_MATERIAL');
      await service.resubmit(vendorNo, ops, baseDto({ impactLicence: true }));
      expect(prisma.rows.get(vendorNo).criticality).toBe('MATERIAL');
    });

    it('重提同样要过「受监管职能必填牌照」规则，拒了不动行、不留痕', async () => {
      const vendorNo = await seedVendor(VendorStatus.RETURNED);
      await expect(service.resubmit(vendorNo, ops, baseDto({ regulatedFunction: true }))).rejects.toThrow(BadRequestException);
      expect(prisma.rows.get(vendorNo).status).toBe('RETURNED');
      expect(audits).toEqual([]);
    });
  });

  // ── upgradeMateriality ─────────────────────────────────────────────
  describe('upgradeMateriality', () => {
    it('NON_MATERIAL → MATERIAL 记理由；状态不动；VENDOR_MATERIALITY_UPGRADED（操作员写）顶层带 reason', async () => {
      const vendorNo = await seedVendor(VendorStatus.PENDING_ASSESSMENT, 'NON_MATERIAL');
      await service.upgradeMateriality(vendorNo, compliance, 'Hosts customer PII for the ledger replica');

      expect(prisma.rows.get(vendorNo)).toMatchObject({
        criticality: 'MATERIAL', criticalityReason: 'Hosts customer PII for the ledger replica', status: 'PENDING_ASSESSMENT',
      });
      expect(actionsOf()).toEqual(['VENDOR_MATERIALITY_UPGRADED']);
      expect(audits[0].via).toBe('actor');
      expect(audits[0].input).toMatchObject({ reason: 'Hosts customer PII for the ledger replica' });
      expect(audits[0].input.metadata).toMatchObject({ fromCriticality: 'NON_MATERIAL', toCriticality: 'MATERIAL' });
    });

    it('已是 MATERIAL → 400（只升不降），行不变、零审计', async () => {
      const vendorNo = await seedVendor(VendorStatus.PENDING_ASSESSMENT, 'MATERIAL');
      await expect(service.upgradeMateriality(vendorNo, compliance, 'again')).rejects.toThrow(BadRequestException);
      expect(prisma.rows.get(vendorNo).criticalityReason).toBeNull();
      expect(audits).toEqual([]);
    });

    it('理由必填：空白 → 400，行不变、零审计', async () => {
      const vendorNo = await seedVendor();
      await expect(service.upgradeMateriality(vendorNo, compliance, '   ')).rejects.toThrow(BadRequestException);
      expect(prisma.rows.get(vendorNo).criticality).toBe('NON_MATERIAL');
      expect(audits).toEqual([]);
    });

    it('未知 vendorNo → 404', async () => {
      await expect(service.upgradeMateriality('VEN000000000000', compliance, 'x')).rejects.toThrow(NotFoundException);
    });
  });

  // ── transition：十条边 ────────────────────────────────────────────
  describe('transition (VENDOR_TRANSITIONS × VENDOR_ACTION_BY_EDGE)', () => {
    const EDGES = Object.entries(VENDOR_TRANSITIONS).flatMap(([from, targets]) => targets.map((to) => [from, to] as const));

    it('迁移表共十条边', () => {
      expect(EDGES).toHaveLength(10);
    });

    it.each(EDGES)('%s → %s：状态落库，写该边登记的审计码并带 fromStatus / toStatus', async (from, to) => {
      const vendorNo = await seedVendor(from);
      const updated = await service.transition(vendorNo, to as any, {}, { actor: compliance, reason: 'because' });
      expect(updated.status).toBe(to);
      expect(prisma.rows.get(vendorNo).status).toBe(to);
      expect(actionsOf()).toEqual([VENDOR_ACTION_BY_EDGE[`${from}->${to}`]]);
      expect(audits[0].input).toMatchObject({ fromStatus: from, toStatus: to, reason: 'because' });
    });

    it('审批相关的边带 approvalNo / causationId，并把审批单挂成 INSTRUMENT 子主体；无 actor 则系统写', async () => {
      const vendorNo = await seedVendor(VendorStatus.PENDING_APPROVAL);
      await service.transition(vendorNo, VendorStatus.ACTIVE, {}, { approvalNo: 'APR261029000001', causationId: 'approval-uuid-1' });
      expect(audits[0].via).toBe('system');
      expect(audits[0].input).toMatchObject({ approvalNo: 'APR261029000001', causationId: 'approval-uuid-1', sourcePlatform: 'SYSTEM' });
      expect(audits[0].input.subjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectType: 'APPROVAL_CASE', subjectNo: 'APR261029000001', subjectRole: 'INSTRUMENT' }),
      ]));
    });

    it('非法边显式拒：ACTIVE → PENDING_ASSESSMENT 抛 Illegal vendor status transition；行不变、零审计', async () => {
      const vendorNo = await seedVendor(VendorStatus.ACTIVE);
      await expect(service.transition(vendorNo, VendorStatus.PENDING_ASSESSMENT as any)).rejects.toThrow('Illegal vendor status transition');
      expect(prisma.rows.get(vendorNo).status).toBe('ACTIVE');
      expect(audits).toEqual([]);
    });

    it.each([
      [VendorStatus.PENDING_ASSESSMENT, VendorStatus.ACTIVE],
      [VendorStatus.PENDING_ASSESSMENT, VendorStatus.PENDING_NOTIFICATION],
      [VendorStatus.RETURNED, VendorStatus.PENDING_APPROVAL],
      [VendorStatus.REJECTED, VendorStatus.PENDING_ASSESSMENT],
      [VendorStatus.TERMINATED, VendorStatus.ACTIVE],
      [VendorStatus.PENDING_NOTIFICATION, VendorStatus.TERMINATED],
    ])('门不可绕：%s → %s 没有这条边，被拒', async (from, to) => {
      const vendorNo = await seedVendor(from);
      await expect(service.transition(vendorNo, to as any)).rejects.toThrow(/Illegal vendor status transition/);
      expect(prisma.rows.get(vendorNo).status).toBe(from);
      expect(audits).toEqual([]);
    });

    it('完整性闸：边在迁移表里却没登记审计码 → 500，且在写库之前炸（不留「状态已变、无审计」）', async () => {
      const vendorNo = await seedVendor(VendorStatus.PENDING_ASSESSMENT);
      const saved = VENDOR_ACTION_BY_EDGE['PENDING_ASSESSMENT->RETURNED'];
      delete VENDOR_ACTION_BY_EDGE['PENDING_ASSESSMENT->RETURNED'];
      try {
        await expect(service.transition(vendorNo, VendorStatus.RETURNED as any)).rejects.toThrow(InternalServerErrorException);
      } finally {
        VENDOR_ACTION_BY_EDGE['PENDING_ASSESSMENT->RETURNED'] = saved;
      }
      expect(prisma.rows.get(vendorNo).status).toBe('PENDING_ASSESSMENT');
      expect(audits).toEqual([]);
    });

    it('patch 随状态一起落库', async () => {
      const vendorNo = await seedVendor(VendorStatus.ACTIVE);
      await service.transition(vendorNo, VendorStatus.TERMINATED as any, { notes: 'contract ended' }, { actor: compliance });
      expect(prisma.rows.get(vendorNo)).toMatchObject({ status: 'TERMINATED', notes: 'contract ended' });
    });

    it('未知 vendorNo → 404', async () => {
      await expect(service.transition('VEN000000000000', VendorStatus.RETURNED as any)).rejects.toThrow(NotFoundException);
    });
  });

  // ── terminate ──────────────────────────────────────────────────────
  describe('terminate（ACTIVE → TERMINATED 唯一边，走 transition）', () => {
    it('ACTIVE → TERMINATED，VENDOR_TERMINATED 带 from/to，备注入库', async () => {
      const vendorNo = await seedVendor(VendorStatus.ACTIVE);
      const r = await service.terminate(vendorNo, compliance, { notes: 'contract ended' });
      expect(r.vendorNo).toBe(vendorNo);
      expect(prisma.rows.get(vendorNo)).toMatchObject({ status: 'TERMINATED', notes: 'contract ended' });
      expect(audits[0].input).toMatchObject({ action: 'VENDOR_TERMINATED', fromStatus: 'ACTIVE', toStatus: 'TERMINATED' });
    });

    it('终态零出边：再 terminate 一次 → 400 Illegal vendor status transition', async () => {
      const vendorNo = await seedVendor(VendorStatus.ACTIVE);
      await service.terminate(vendorNo, compliance, {});
      await expect(service.terminate(vendorNo, compliance, {})).rejects.toThrow(BadRequestException);
      await expect(service.terminate(vendorNo, compliance, {})).rejects.toThrow(/Illegal vendor status transition/);
    });

    it.each([
      VendorStatus.PENDING_ASSESSMENT, VendorStatus.RETURNED, VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_NOTIFICATION, VendorStatus.REJECTED,
    ])('只收 ACTIVE：%s 态 → 400，行不变，零审计（审批中 / 待报备的服务商不能被「终止」绕开）', async (status) => {
      const vendorNo = await seedVendor(status);
      await expect(service.terminate(vendorNo, compliance, { notes: 'x' })).rejects.toThrow(/Illegal vendor status transition/);
      expect(prisma.rows.get(vendorNo)).toMatchObject({ status, notes: null });
      expect(audits).toEqual([]);
    });

    it('没有硬删方法——离开 ACTIVE 的唯一路径是显式迁移表', () => {
      expect((OutsourcingVendorsService.prototype as any).delete).toBeUndefined();
      expect((OutsourcingVendorsService.prototype as any).remove).toBeUndefined();
    });

    it('旧的合规官直登 / 直改入口已退役：服务上不再有 register / update', () => {
      expect((OutsourcingVendorsService.prototype as any).register).toBeUndefined();
      expect((OutsourcingVendorsService.prototype as any).update).toBeUndefined();
    });
  });

  // ── 盖章 / 反查 ────────────────────────────────────────────────────
  describe('stampApprovalNo / stampNotificationFilingNo / findByNotificationFilingNo', () => {
    it('stampApprovalNo 回填审批单号（服务商自己的表自己写）', async () => {
      const vendorNo = await seedVendor();
      await service.stampApprovalNo(vendorNo, 'APR261029000009');
      expect(prisma.rows.get(vendorNo).approvalNo).toBe('APR261029000009');
    });

    it('stampNotificationFilingNo 回填告知单号，并系统写 VENDOR_NOTIFICATION_OPENED（顶层 filingNo）', async () => {
      const vendorNo = await seedVendor(VendorStatus.PENDING_NOTIFICATION, 'MATERIAL');
      await service.stampNotificationFilingNo(vendorNo, 'FIL261029000007');
      expect(prisma.rows.get(vendorNo).notificationFilingNo).toBe('FIL261029000007');
      expect(actionsOf()).toEqual(['VENDOR_NOTIFICATION_OPENED']);
      expect(audits[0].via).toBe('system');
      expect(audits[0].input).toMatchObject({ filingNo: 'FIL261029000007' });
      expect(audits[0].input.metadata).toMatchObject({ filingNo: 'FIL261029000007' });
    });

    it('findByNotificationFilingNo 按告知单号反查，认不出的单号 → null（报送台的别家单不会被误认领）', async () => {
      const a = await seedVendor(VendorStatus.PENDING_NOTIFICATION, 'MATERIAL');
      const b = await seedVendor(VendorStatus.PENDING_NOTIFICATION, 'MATERIAL');
      await service.stampNotificationFilingNo(a, 'FIL261029000001');
      await service.stampNotificationFilingNo(b, 'FIL261029000002');

      expect((await service.findByNotificationFilingNo('FIL261029000002'))!.vendorNo).toBe(b);
      expect((await service.findByNotificationFilingNo('FIL261029000001'))!.vendorNo).toBe(a);
      expect(await service.findByNotificationFilingNo('FIL000000000000')).toBeNull();
    });
  });

  // ── 读 ─────────────────────────────────────────────────────────────
  describe('findByNo / list / getView', () => {
    it('findByNo 未知单号 → 404', async () => {
      await expect(service.findByNo('VEN_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });

    it('getView：申请表全字段 + 判定 + 状态 + 审批单号 / 告知单号；无 id；实控人是数组；交付地是数组；用户是 userNo', async () => {
      const { vendorNo } = await service.apply(ops, baseDto({ annualFee: '120000', feeCurrency: 'AED', contractEnd: '2027-10-31', impactLicence: true }));
      await service.stampApprovalNo(vendorNo, 'APR261029000001');
      const view = await service.getView(vendorNo);

      expect(view).not.toHaveProperty('id');
      expect(view).toEqual({
        vendorNo, name: 'Nimbus Cloud Hosting LLC', registeredIn: 'United Arab Emirates (Dubai)', registrationNo: 'DED-778812',
        deliveryLocations: ['AE', 'IE'], contactName: 'Sara Khan', contactEmail: 'sara@nimbus.example',
        beneficialOwners: [{ seq: 1, name: 'Omar Nasser', nationality: 'AE' }, { seq: 2, name: 'Li Wei' }],
        licensingAuthority: null, licenceNo: null,
        serviceDescription: 'Managed cloud hosting for back-office systems',
        regulatedFunction: false, involvesPersonalData: true, involvesConfidentialInfo: false,
        contractStart: '2026-11-01T00:00:00.000Z', contractEnd: '2027-10-31T00:00:00.000Z',
        annualFee: '120000', feeCurrency: 'AED', subcontracts: false, subcontractorNames: null,
        applicationReason: 'Move back-office hosting off the legacy datacentre',
        impactLicence: true, impactLegal: false, impactFinancial: false, impactContinuity: false, replaceability: 'EASY',
        criticality: 'MATERIAL', criticalityReason: null,
        status: 'PENDING_ASSESSMENT', approvalNo: 'APR261029000001', notificationFilingNo: null, notes: null,
        createdBy: 'ADM-OPS', createdAt: expect.any(String),
      });
    });

    it('list 是同一投影的数组（新的在前），不含 id', async () => {
      const first = await service.apply(ops, baseDto({ name: 'First Vendor' }));
      const second = await service.apply(ops, baseDto({ name: 'Second Vendor' }));
      const rows = await service.list();
      expect(rows.map((r) => r.vendorNo)).toEqual([second.vendorNo, first.vendorNo]);
      for (const r of rows) expect(r).not.toHaveProperty('id');
    });
  });

  // ── assertActiveByNo（付款单开单守卫）──────────────────────────────
  describe('assertActiveByNo', () => {
    it('ACTIVE 通过', async () => {
      const vendorNo = await seedVendor(VendorStatus.ACTIVE);
      await expect(service.assertActiveByNo(vendorNo)).resolves.toBeUndefined();
    });

    it.each([
      VendorStatus.PENDING_ASSESSMENT, VendorStatus.RETURNED, VendorStatus.PENDING_APPROVAL, VendorStatus.PENDING_NOTIFICATION,
      VendorStatus.REJECTED, VendorStatus.TERMINATED,
    ])('%s 态 → 400 not ACTIVE（付款门；PENDING_NOTIFICATION 付不了款正是报备门的演示点）', async (status) => {
      const vendorNo = await seedVendor(status);
      await expect(service.assertActiveByNo(vendorNo)).rejects.toThrow(BadRequestException);
      await expect(service.assertActiveByNo(vendorNo)).rejects.toThrow(/not ACTIVE/);
    });

    it('未知单号 → 404', async () => {
      await expect(service.assertActiveByNo('VEN_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ── 审计信封真实过闸（真 AuditLogsService + 内存 mock Prisma，不碰真库）：上面的 audits 只验词表规则，
  // 这里让真 recordByActor / recordSystem 把信封落进内存审计表，验同一条旅程（correlationId）串起整条弧。
  describe('audit envelope walks the whole arc through the real AuditLogsService', () => {
    it('apply → 送审 → 批准 → 终止：全部落库，同一个 correlationId（VENDOR_APPLIED 铸的旅程）', async () => {
      const events: any[] = [];
      const byKey = new Map<string, any>();
      const realPrisma = {
        ...prisma,
        auditLogEvent: {
          findUnique: jest.fn(async ({ where }: any) => (where?.idempotencyKey ? byKey.get(where.idempotencyKey) ?? null : null)),
          create: jest.fn(async ({ data }: any) => {
            const row = { id: randomUUID(), seq: events.length + 1, ...data };
            events.push(row);
            if (row.idempotencyKey) byKey.set(row.idempotencyKey, row);
            return row;
          }),
        },
        auditLogSubject: { createMany: jest.fn(async () => ({ count: 0 })) },
      };
      const mod = await Test.createTestingModule({
        providers: [OutsourcingVendorsService, { provide: PrismaService, useValue: realPrisma }, AuditLogsService],
      }).compile();
      const real = mod.get(OutsourcingVendorsService);

      const { vendorNo } = await real.apply(ops, baseDto());
      await real.transition(vendorNo, VendorStatus.PENDING_APPROVAL as any, {}, { actor: compliance });
      await real.transition(vendorNo, VendorStatus.ACTIVE as any, {}, { approvalNo: 'APR261029000002', causationId: 'cause-1' });
      await real.terminate(vendorNo, compliance, {});

      expect(events.map((e) => e.action)).toEqual(['VENDOR_APPLIED', 'VENDOR_SENT_FOR_APPROVAL', 'VENDOR_APPROVED', 'VENDOR_TERMINATED']);
      expect(new Set(events.map((e) => e.correlationId)).size).toBe(1);
    });
  });
});
