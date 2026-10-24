import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { LpPayoutAddressService, CreateLpPayoutAddressInput } from './lp-payout-address.service';
import { LpProfileService } from './lp-profile.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { TRAVEL_RULE_ADAPTER } from '../../sumsub-shared/travel-rule/travel-rule-adapter.interface';
import { MockTravelRuleAdapter } from '../../sumsub-shared/travel-rule/mock-travel-rule.adapter';
import { LpPayoutAddressAction as A, LpPayoutAddressStatus as S } from './constants/lp-payout-address-transitions.constant';

const FALCON = { id: 'lp-uuid-falcon', lpNo: 'LPP-FALCON', name: 'Falcon Liquidity FZE', status: 'ACTIVE' };
const USDT = { id: 'asset-uuid-usdt', code: 'USDT_TRC20', type: 'CRYPTO' };
const USDC = { id: 'asset-uuid-usdc', code: 'USDC_TRC20', type: 'CRYPTO' };
const AED = { id: 'asset-uuid-aed', code: 'AED', type: 'FIAT' };
const TREASURY = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TREASURY', role: 'TREASURY_OFFICER', roleCodes: ['TREASURY_OFFICER'] };

/** 行为化内存 mock：where 真按 equals / in / notIn 过滤（本仓「mock 无视 where 直接吐行」假绿判例）。 */
function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(row[k]);
      if ('notIn' in cond) return !cond.notIn.includes(row[k]);
    }
    return row[k] === cond;
  });
}

function makePrisma() {
  const rows = new Map<string, any>();
  let clock = Date.parse('2026-10-24T00:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  return {
    lpPayoutAddress: {
      create: jest.fn(async ({ data }: any) => {
        // 照 Prisma：undefined 的字段不写入，可空列读回为 null
        const given = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
        const row: any = {
          id: randomUUID(),
          network: null, address: null, iban: null, bankName: null, swiftBic: null, declaredHosting: null, addressType: null,
          counterpartyVaspName: null, counterpartyVaspDid: null, screeningAnswer: null, screenedAt: null, label: null, approvalNo: null,
          hostingMismatch: false, suspendedAt: null, cancelledAt: null, deactivatedAt: null, createdAt: tick(), updatedAt: tick(),
          ...given,
        };
        rows.set(row.addressNo, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.addressNo);
        if (!existing) throw new Error(`no such row: ${where.addressNo}`);
        const updated = { ...existing, ...data, updatedAt: tick() };
        rows.set(where.addressNo, updated);
        return updated;
      }),
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.addressNo) ?? null),
      findFirst: jest.fn(async ({ where }: any) => [...rows.values()].find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
        const list = [...rows.values()].filter((r) => matches(r, where));
        if (!orderBy) return list;
        const [field] = Object.keys(orderBy);
        const dir = orderBy[field] === 'asc' ? 1 : -1;
        return list.sort((a, b) => dir * (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0));
      }),
    },
    asset: {
      findMany: jest.fn(async ({ where }: any) => [USDT, USDC, AED].filter((a) => matches(a, where))),
      // 登记按 assetId 查资产定坐标组（spec §3.1）；查无 → null，同 Prisma
      findUnique: jest.fn(async ({ where }: any) => [USDT, USDC, AED].find((a) => a.id === where.id) ?? null),
    },
  };
}

const chainInput = (over: Partial<CreateLpPayoutAddressInput> = {}): CreateLpPayoutAddressInput => ({
  lpNo: FALCON.lpNo,
  assetId: USDT.id,
  network: 'TRON',
  address: 'TXfake0000000000000000000000000000',
  declaredHosting: 'SELF_CUSTODY',
  evidenceRef: 'AGR-2026-LP-001 §4.2 payout schedule',
  ...over,
});

const fiatInput = (over: Partial<CreateLpPayoutAddressInput> = {}): CreateLpPayoutAddressInput => ({
  lpNo: FALCON.lpNo,
  assetId: AED.id,
  iban: 'AE070331234567890123456',
  bankName: 'Emirates NBD',
  swiftBic: 'EBILAEAD',
  evidenceRef: 'AGR-2026-LP-001 §4.3 settlement account',
  ...over,
});

describe('LpPayoutAddressService (LP 两步准入 Task 3)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: LpPayoutAddressService;
  let profile: { findByNo: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    profile = { findByNo: jest.fn(async (lpNo: string) => ({ ...FALCON, lpNo })) };
    const mod = await Test.createTestingModule({
      providers: [
        LpPayoutAddressService,
        { provide: PrismaService, useValue: prisma },
        { provide: LpProfileService, useValue: profile },
        { provide: TRAVEL_RULE_ADAPTER, useClass: MockTravelRuleAdapter },
        // Task 4 起主体服务自带审计；本文件测状态与落点语义，审计的行为证据（真 assertActionSpec）在 workflow spec
        { provide: AuditLogsService, useValue: { recordByActor: jest.fn(), recordSystem: jest.fn() } },
      ],
    }).compile();
    service = mod.get(LpPayoutAddressService);
  });

  /** Task 4 起登记要带操作员（留痕）；本文件的断言与 Task 3 一致，只是调用多传一个 actor。 */
  const register = (input: CreateLpPayoutAddressInput) => service.create(input, TREASURY);

  describe('登记落点计算（归因 + 筛查，插入时一次算出——RED 不是边）', () => {
    it('① 链上地址尾号 3333 → 登记即 REJECTED（落点计算），screeningAnswer=RED', async () => {
      const row = await register(chainInput({ address: 'TXfake0000000000000000000000003333' }));
      expect(row.status).toBe(S.REJECTED);
      expect(row.screeningAnswer).toBe('RED');
      expect(row.screenedAt).toBeInstanceOf(Date);
      expect(row.addressNo).toMatch(/^LPA\d{6}\d{6}$/);
      expect(row.lpNo).toBe(FALCON.lpNo);
      expect(row.lpId).toBe(FALCON.id);
    });

    it('② IBAN 尾号 3333 同律即拒（法币组走 BANK_RAIL_NETWORK 筛查）；空格/小写清洗后再筛、再落库', async () => {
      const row = await register(fiatInput({ iban: 'ae07 0331 2345 6789 0123 3333' }));
      expect(row.status).toBe(S.REJECTED);
      expect(row.screeningAnswer).toBe('RED');
      expect(row.iban).toBe('AE0703312345678901233333');
      // 法币组：链上列为空、declaredHosting 恒 null、不归因不比对
      expect(row.network).toBeNull();
      expect(row.address).toBeNull();
      expect(row.declaredHosting).toBeNull();
      expect(row.hostingMismatch).toBe(false);
      expect(row.counterpartyVaspDid).toBeNull();
    });

    it('② 补：干净 IBAN 与 2222 地址 → 进 PENDING_APPROVAL（GREEN / YELLOW 都进审批）', async () => {
      const fiat = await register(fiatInput());
      expect(fiat.status).toBe(S.PENDING_APPROVAL);
      expect(fiat.screeningAnswer).toBe('GREEN');
      expect(fiat.bankName).toBe('Emirates NBD');
      expect(fiat.swiftBic).toBe('EBILAEAD');
      const yellow = await register(chainInput({ address: 'TXfake0000000000000000000000002222' }));
      expect(yellow.status).toBe(S.PENDING_APPROVAL);
      expect(yellow.screeningAnswer).toBe('YELLOW');
    });

    it('③ 尾号 1111 落 addressType=VASP 归因 + VASP 名/DID；自报 SELF_CUSTODY → hostingMismatch=true（红旗不拦截，仍 PENDING_APPROVAL）', async () => {
      const row = await register(chainInput({ address: 'TXfake0000000000000000000000001111', declaredHosting: 'SELF_CUSTODY' }));
      expect(row.addressType).toBe('VASP');
      expect(row.counterpartyVaspName).toBe('Mock VASP Exchange');
      expect(row.counterpartyVaspDid).toBe('did:mock:vasp-exchange-001');
      expect(row.hostingMismatch).toBe(true);
      expect(row.status).toBe(S.PENDING_APPROVAL);
    });

    it('③ 补：自报与归因一致 → hostingMismatch=false；未归因地址落 SELF_CUSTODY', async () => {
      const vasp = await register(chainInput({ address: 'TXfake0000000000000000000000001111', declaredHosting: 'VASP' }));
      expect(vasp.hostingMismatch).toBe(false);
      const self = await register(chainInput({ declaredHosting: 'SELF_CUSTODY' }));
      expect(self.addressType).toBe('SELF_CUSTODY');
      expect(self.hostingMismatch).toBe(false);
      expect(self.counterpartyVaspName).toBeNull();
    });
  });

  describe('登记守卫', () => {
    it('④ 档案 SUSPENDED 登记 → 409，且不落任何行', async () => {
      profile.findByNo.mockResolvedValueOnce({ ...FALCON, status: 'SUSPENDED' });
      await expect(register(chainInput())).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.lpPayoutAddress.create).not.toHaveBeenCalled();
    });

    it('档案 PENDING_APPROVAL / REJECTED 同样拒（只有 ACTIVE 能登记）', async () => {
      for (const status of ['PENDING_APPROVAL', 'REJECTED']) {
        profile.findByNo.mockResolvedValueOnce({ ...FALCON, status });
        await expect(register(chainInput())).rejects.toBeInstanceOf(ConflictException);
      }
      expect(prisma.lpPayoutAddress.create).not.toHaveBeenCalled();
    });

    it('evidenceRef 空白 / 仅空格 → 400（业务必填，trim 后非空）；落库的 evidenceRef 是 trim 后的值', async () => {
      await expect(register(chainInput({ evidenceRef: '   ' }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(register(chainInput({ evidenceRef: '' }))).rejects.toBeInstanceOf(BadRequestException);
      const row = await register(chainInput({ evidenceRef: '  AGR-2026-LP-001 §4.2  ' }));
      expect(row.evidenceRef).toBe('AGR-2026-LP-001 §4.2');
    });

    it('链上缺 declaredHosting → 400；法币不要求 declaredHosting', async () => {
      await expect(register(chainInput({ declaredHosting: undefined }))).rejects.toBeInstanceOf(BadRequestException);
      await expect(register(fiatInput())).resolves.toMatchObject({ declaredHosting: null });
    });

    it('⑤ 同 (lpId, 资产, 坐标) 非终态已存在 → 409 ADDRESS_ALREADY_REGISTERED；REJECTED 后可重登成功（Review Focus 2）', async () => {
      const first = await register(chainInput());
      expect(first.status).toBe(S.PENDING_APPROVAL);
      await expect(register(chainInput())).rejects.toMatchObject({ response: { code: 'ADDRESS_ALREADY_REGISTERED' } });
      await expect(register(chainInput())).rejects.toBeInstanceOf(ConflictException);

      await service.transition(first.addressNo, A.REJECT);
      const second = await register(chainInput());
      expect(second.status).toBe(S.PENDING_APPROVAL);
      expect(second.addressNo).not.toBe(first.addressNo);
    });

    it('⑤ 补：占用判据是「非终态」——ACTIVE / SUSPENDED 仍占坑；CANCELLED / DEACTIVATED 释放坑位', async () => {
      const a = await register(chainInput());
      await service.transition(a.addressNo, A.APPROVE);
      await expect(register(chainInput())).rejects.toBeInstanceOf(ConflictException); // ACTIVE 占
      await service.transition(a.addressNo, A.SUSPEND);
      await expect(register(chainInput())).rejects.toBeInstanceOf(ConflictException); // SUSPENDED 占
      await service.transition(a.addressNo, A.REACTIVATE);
      await service.transition(a.addressNo, A.DEACTIVATE);
      const b = await register(chainInput()); // DEACTIVATED 释放
      await service.transition(b.addressNo, A.CANCEL);
      await expect(register(chainInput())).resolves.toMatchObject({ status: S.PENDING_APPROVAL }); // CANCELLED 释放
    });

    it('坐标组必填（服务对直调方也判）：无 iban 又缺 network / address → 400 COORDINATE_REQUIRED，不查重、不落行；即便 declaredHosting 齐', async () => {
      for (const over of [{ network: undefined, address: undefined }, { address: undefined }, { network: undefined }, { network: '', address: '' }]) {
        await expect(register(chainInput(over))).rejects.toMatchObject({ response: { code: 'COORDINATE_REQUIRED' } });
        await expect(register(chainInput(over))).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(prisma.lpPayoutAddress.findFirst).not.toHaveBeenCalled();
      expect(prisma.lpPayoutAddress.create).not.toHaveBeenCalled();
    });

    it('坐标组由资产类型定（spec §3.1）：CRYPTO 资产 + IBAN 载荷 → 400 COORDINATE_GROUP_MISMATCH；法币资产 + 链上载荷 → 400 COORDINATE_GROUP_MISMATCH；不查重、不落行', async () => {
      // CRYPTO + 只带 IBAN（链上组缺省）→ 错组，不是「缺失」
      await expect(register(chainInput({ network: undefined, address: undefined, iban: 'AE070331234567890123456' })))
        .rejects.toMatchObject({ response: { code: 'COORDINATE_GROUP_MISMATCH' } });
      // CRYPTO + 链上组齐又多带 IBAN → 同样错组（iban 必须缺省）
      await expect(register(chainInput({ iban: 'AE070331234567890123456' })))
        .rejects.toMatchObject({ response: { code: 'COORDINATE_GROUP_MISMATCH' } });
      // 法币资产 + 链上载荷（没有 IBAN）→ 错组
      await expect(register(fiatInput({ iban: undefined, network: 'TRON', address: 'TXfake0000000000000000000000000000' })))
        .rejects.toMatchObject({ response: { code: 'COORDINATE_GROUP_MISMATCH' } });
      // 法币资产 + IBAN 又多带链上组 → 错组（network / address 必须缺省）
      await expect(register(fiatInput({ network: 'TRON' })))
        .rejects.toMatchObject({ response: { code: 'COORDINATE_GROUP_MISMATCH' } });
      await expect(register(fiatInput({ address: 'TXfake0000000000000000000000000000' })))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.lpPayoutAddress.findFirst).not.toHaveBeenCalled();
      expect(prisma.lpPayoutAddress.create).not.toHaveBeenCalled();
    });

    it('本组空缺 = COORDINATE_REQUIRED（与错组分清）：法币资产不带任何坐标 / 纯空白 iban（清洗后为空）→ 400 REQUIRED；CRYPTO 资产空白 iban 视同没给，照走链上组', async () => {
      await expect(register(fiatInput({ iban: undefined }))).rejects.toMatchObject({ response: { code: 'COORDINATE_REQUIRED' } });
      await expect(register(fiatInput({ iban: '' }))).rejects.toMatchObject({ response: { code: 'COORDINATE_REQUIRED' } });
      await expect(register(fiatInput({ iban: '   ' }))).rejects.toMatchObject({ response: { code: 'COORDINATE_REQUIRED' } });
      await expect(register(fiatInput({ iban: '   ' }))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.lpPayoutAddress.findFirst).not.toHaveBeenCalled();
      expect(prisma.lpPayoutAddress.create).not.toHaveBeenCalled();
      // 空白 iban 不是「带了 IBAN」：CRYPTO 资产链上组齐 + iban 为空白串 → 正常登记
      await expect(register(chainInput({ iban: '   ' }))).resolves.toMatchObject({ status: S.PENDING_APPROVAL, iban: null });
    });

    it('未知 assetId → 400 ASSET_NOT_FOUND，不查重、不落行', async () => {
      await expect(register(chainInput({ assetId: 'asset-uuid-nope' }))).rejects.toMatchObject({ response: { code: 'ASSET_NOT_FOUND' } });
      await expect(register(fiatInput({ assetId: 'asset-uuid-nope' }))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.lpPayoutAddress.findFirst).not.toHaveBeenCalled();
      expect(prisma.lpPayoutAddress.create).not.toHaveBeenCalled();
    });

    it('占坑查重 where 只用判定过非空的坐标值构造：链上 = {lpId, assetId, network, address, status}，法币 = {lpId, assetId, iban(清洗后), status}，无任何 undefined 键', async () => {
      await register(chainInput());
      await register(fiatInput({ iban: 'ae07 0331 2345 6789 0123 456' }));
      const [chainWhere, fiatWhere] = prisma.lpPayoutAddress.findFirst.mock.calls.map((c: any[]) => c[0].where);
      expect(Object.keys(chainWhere).sort()).toEqual(['address', 'assetId', 'lpId', 'network', 'status']);
      expect(Object.keys(fiatWhere).sort()).toEqual(['assetId', 'iban', 'lpId', 'status']);
      expect(fiatWhere.iban).toBe('AE070331234567890123456');
      for (const where of [chainWhere, fiatWhere]) {
        for (const [k, v] of Object.entries(where)) expect({ k, defined: v !== undefined }).toEqual({ k, defined: true });
      }
    });

    it('⑤ 补：坐标键边界——同地址换资产 / 换 LP / 另一条 IBAN 都不撞；同 IBAN（含清洗后同值）撞', async () => {
      await register(chainInput());
      await expect(register(chainInput({ assetId: USDC.id }))).resolves.toBeDefined(); // 另一资产
      profile.findByNo.mockResolvedValueOnce({ ...FALCON, id: 'lp-uuid-dune', lpNo: 'LPP-DUNE' });
      await expect(register(chainInput({ lpNo: 'LPP-DUNE' }))).resolves.toBeDefined(); // 另一 LP
      await register(fiatInput());
      await expect(register(fiatInput({ iban: 'AE070331234567890123999' }))).resolves.toBeDefined(); // 另一条 IBAN
      await expect(register(fiatInput({ iban: 'ae07 0331 2345 6789 0123 456' }))).rejects.toMatchObject({ response: { code: 'ADDRESS_ALREADY_REGISTERED' } });
    });
  });

  describe('迁移 / 改标签 / 读', () => {
    it('⑥ transition 沿表走：APPROVE 带 approvalNo；SUSPEND/REACTIVATE 盖/清 suspendedAt；CANCEL/DEACTIVATE 盖时间戳', async () => {
      const a = await register(chainInput());
      const approved = await service.transition(a.addressNo, A.APPROVE, { approvalNo: 'APR260101000001' });
      expect(approved).toMatchObject({ status: S.ACTIVE, approvalNo: 'APR260101000001' });
      const suspended = await service.transition(a.addressNo, A.SUSPEND);
      expect(suspended.status).toBe(S.SUSPENDED);
      expect(suspended.suspendedAt).toBeInstanceOf(Date);
      const reactivated = await service.transition(a.addressNo, A.REACTIVATE);
      expect(reactivated.status).toBe(S.ACTIVE);
      expect(reactivated.suspendedAt).toBeNull();
      const deactivated = await service.transition(a.addressNo, A.DEACTIVATE);
      expect(deactivated.status).toBe(S.DEACTIVATED);
      expect(deactivated.deactivatedAt).toBeInstanceOf(Date);

      const b = await register(chainInput({ address: 'TXfake0000000000000000000000000002' }));
      const cancelled = await service.transition(b.addressNo, A.CANCEL);
      expect(cancelled.status).toBe(S.CANCELLED);
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    });

    it('⑥ 非法跃迁 409：ACTIVE 再 APPROVE（ACTIVE→ACTIVE）、终态任意动作；状态不变', async () => {
      const a = await register(chainInput());
      await service.transition(a.addressNo, A.APPROVE);
      await expect(service.transition(a.addressNo, A.APPROVE)).rejects.toBeInstanceOf(ConflictException);
      await service.transition(a.addressNo, A.DEACTIVATE);
      for (const action of Object.values(A)) {
        await expect(service.transition(a.addressNo, action)).rejects.toBeInstanceOf(ConflictException);
      }
      expect((await service.findByNo(a.addressNo))!.status).toBe(S.DEACTIVATED);
    });

    it('⑥ updateLabel 只收 label：坐标 / 申报 / 状态字段不可能被改（多塞的字段被忽略）', async () => {
      const a = await register(chainInput({ label: 'old' }));
      expect(service.updateLabel.length).toBe(3); // 方法签名只收 (addressNo, label, actor)——actor 仅为留痕，坐标 / 申报 / 状态没有入参
      const updated = await (service as any).updateLabel(a.addressNo, 'treasury main', TREASURY, { address: 'TXevil', evidenceRef: 'x', status: 'ACTIVE' });
      expect(updated.label).toBe('treasury main');
      expect(updated.address).toBe(a.address);
      expect(updated.evidenceRef).toBe(a.evidenceRef);
      expect(updated.status).toBe(S.PENDING_APPROVAL);
    });

    it('findByNo：存在返回行、不存在返回 null；transition/updateLabel 对不存在的单号 404', async () => {
      const a = await register(chainInput());
      expect((await service.findByNo(a.addressNo))!.addressNo).toBe(a.addressNo);
      expect(await service.findByNo('LPA000000000000')).toBeNull();
      await expect(service.transition('LPA000000000000', A.APPROVE)).rejects.toMatchObject({ status: 404 });
      await expect(service.updateLabel('LPA000000000000', 'x', TREASURY)).rejects.toMatchObject({ status: 404 });
    });

    it('listByLp / getView：只列该 LP 的行（按 createdAt 倒序）；投影零 UUID（无 id / lpId / assetId / traceId），带 lpNo + assetCode', async () => {
      const a = await register(chainInput());
      const b = await register(fiatInput());
      profile.findByNo.mockResolvedValueOnce({ ...FALCON, id: 'lp-uuid-dune', lpNo: 'LPP-DUNE' });
      await register(chainInput({ lpNo: 'LPP-DUNE' }));

      const list = await service.listByLp(FALCON.lpNo);
      expect(list.map((v) => v.addressNo)).toEqual([b.addressNo, a.addressNo]);
      for (const v of list) {
        expect(v.lpNo).toBe(FALCON.lpNo);
        for (const k of ['id', 'lpId', 'assetId', 'traceId']) expect(v).not.toHaveProperty(k);
        // 视图里任何值都不是 UUID
        expect(JSON.stringify(v)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      }
      expect(list.find((v) => v.addressNo === a.addressNo)).toMatchObject({ assetCode: 'USDT_TRC20', network: 'TRON', status: S.PENDING_APPROVAL });
      expect(list.find((v) => v.addressNo === b.addressNo)).toMatchObject({ assetCode: 'AED', iban: 'AE070331234567890123456' });
      expect(await service.getView(a.addressNo)).toMatchObject({ addressNo: a.addressNo, assetCode: 'USDT_TRC20' });
    });
  });
});
