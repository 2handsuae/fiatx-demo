// LP 两步准入 Task 4 · LpPayoutAddressWorkflowService 行为测试。
// 与 lp-profile-workflow.service.spec.ts 的「实体背调」段同法：用真 LpPayoutAddressService + 行为化内存
// prisma + 真 MockTravelRuleAdapter + 生产那道 assertActionSpec（词表四属性、必填、causation、INHERIT 的
// correlationId 都会当场抛，同生产）。审批引擎是唯一的 mock（createAndSubmit / cancel 两个口子）。
// 域内惯例：workflow 零审计写入、审计收在主体服务——这里的审计断言验的是「主体服务在 workflow 驱动下
// 实际写出了什么」，不是读 mock 调用次数。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { LpPayoutAddressWorkflowService } from './lp-payout-address-workflow.service';
import { LpPayoutAddressService } from './lp-payout-address.service';
import { RegisterLpPayoutAddressDto, LpPayoutAddressReasonDto, UpdateLpPayoutAddressLabelDto } from './dto/lp-payout-address.dto';
import { LpPayoutAddressStatus as S } from './constants/lp-payout-address-transitions.constant';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { MockTravelRuleAdapter } from '../../sumsub-shared/travel-rule/mock-travel-rule.adapter';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';

const FALCON = { id: 'lp-uuid-falcon', lpNo: 'LPP-FALCON', name: 'Falcon Liquidity FZE', status: 'ACTIVE' };
const USDT = { id: 'asset-uuid-usdt', code: 'USDT_TRC20' };
const AED = { id: 'asset-uuid-aed', code: 'AED' };

const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-treasury', userNo: 'ADM-TREASURY', role: 'TREASURY_OFFICER', roleCodes: ['TREASURY_OFFICER'] };
const compliance = { actorType: 'ADMIN' as const, userId: 'uuid-compliance', userNo: 'ADM-COMPLIANCE', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

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
    rows,
    lpPayoutAddress: {
      create: jest.fn(async ({ data }: any) => {
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
      findMany: jest.fn(async ({ where }: any = {}) => [...rows.values()].filter((r) => matches(r, where))),
    },
    asset: {
      findMany: jest.fn(async ({ where }: any) => [USDT, AED].filter((a) => matches(a, where))),
    },
  };
}

interface CapturedAudit { via: 'actor' | 'system'; input: any; actor?: any }

function buildDeps() {
  const prisma = makePrisma();
  // 生产那道词表校验亲自跑一遍每条信封（缺必填 / 缺 causation / 域不符 / INHERIT 无 correlationId 都会当场抛）
  const realSpec = new AuditLogsService(null as any);
  const audits: CapturedAudit[] = [];
  const auditLogs = {
    recordByActor: jest.fn(async (input: any, actor: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'actor', input, actor }); }),
    recordSystem: jest.fn(async (input: any) => { (realSpec as any).assertActionSpec(input); audits.push({ via: 'system', input }); }),
  };
  const profiles = { findByNo: jest.fn(async (lpNo: string) => ({ ...FALCON, lpNo })) };
  const addresses = new LpPayoutAddressService(prisma as any, profiles as any, new MockTravelRuleAdapter(), auditLogs as any);
  const approvals = {
    createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR-LPA-1' })),
    cancel: jest.fn(async () => ({})),
  };
  const svc = new LpPayoutAddressWorkflowService(addresses, profiles as any, approvals as any);
  const actions = () => audits.map((a) => a.input.action);
  return { svc, prisma, audits, auditLogs, approvals, actions };
}

const chainDto = (over: Partial<RegisterLpPayoutAddressDto> = {}): RegisterLpPayoutAddressDto => ({
  assetId: USDT.id,
  network: 'TRON',
  address: 'TXfake0000000000000000000000000000',
  declaredHosting: 'SELF_CUSTODY',
  evidenceRef: 'AGR-2026-LP-001 §4.2 payout schedule',
  ...over,
});

const fiatDto = (over: Partial<RegisterLpPayoutAddressDto> = {}): RegisterLpPayoutAddressDto => ({
  assetId: AED.id,
  iban: 'AE070331234567890123456',
  bankName: 'Emirates NBD',
  swiftBic: 'EBILAEAD',
  evidenceRef: 'AGR-2026-LP-001 §4.3 settlement account',
  ...over,
});

function decidedEvent(addressNo: string, over: Partial<ApprovalDecidedEvent> = {}): ApprovalDecidedEvent {
  return {
    decision: 'APPROVED',
    actionType: ApprovalActionTypes.LP_ADDRESS_APPROVAL,
    entityRef: addressNo,
    approvalId: 'causation-id-1',
    approvalNo: 'APR-LPA-1',
    traceId: 'trace-1',
    workflowType: 'LP_ADDRESS',
    decisionByUserId: 'uuid-cfo',
    decisionByUserNo: 'ADM-CFO',
    decisionByRole: 'CFO',
    decisionReason: null,
    decidedAt: new Date().toISOString(),
    metadata: {},
    ...over,
  };
}

/** 登记一条非 RED 地址并把它推到想要的态（经 workflow 正门，不直写 prisma）。 */
async function registerPending(d: ReturnType<typeof buildDeps>, dto = chainDto()) {
  const res = await d.svc.registerAddress(FALCON.lpNo, dto, treasury);
  return res.addressNo;
}
async function registerActive(d: ReturnType<typeof buildDeps>, dto = chainDto()) {
  const addressNo = await registerPending(d, dto);
  await d.svc.onDecided(decidedEvent(addressNo));
  return addressNo;
}

describe('LpPayoutAddressWorkflowService.registerAddress', () => {
  it('① GREEN：建行 PENDING_APPROVAL → 开 LP_ADDRESS_APPROVAL（十键快照、零 UUID）→ 回填 approvalNo，按序；审计 REGISTERED(操作员)+SCREENED(系统)', async () => {
    const d = buildDeps();

    const result = await d.svc.registerAddress(FALCON.lpNo, chainDto(), treasury);

    expect(result).toEqual({ addressNo: expect.stringMatching(/^LPA/), approvalNo: 'APR-LPA-1', status: S.PENDING_APPROVAL });
    const row = d.prisma.rows.get(result.addressNo);
    expect(row).toMatchObject({ status: S.PENDING_APPROVAL, approvalNo: 'APR-LPA-1', screeningAnswer: 'GREEN' });

    expect(d.approvals.createAndSubmit).toHaveBeenCalledTimes(1);
    const [createDto, submitDto, actor] = d.approvals.createAndSubmit.mock.calls[0] as any[];
    expect(createDto.actionType).toBe(ApprovalActionTypes.LP_ADDRESS_APPROVAL);
    expect(createDto.entityRef).toBe(result.addressNo);
    expect(createDto.traceId).toBe(row.traceId);
    // 快照键恰为 brief 清单（多一个少一个都红），值是 CFO 看得懂的业务值
    expect(Object.keys(createDto.objectSnapshot).sort()).toEqual(
      ['addressNo', 'lpNo', 'lpName', 'assetCode', 'coordinate', 'declaredHosting', 'addressType', 'screeningAnswer', 'evidenceRef', 'impact'].sort(),
    );
    expect(createDto.objectSnapshot).toMatchObject({
      addressNo: result.addressNo, lpNo: FALCON.lpNo, lpName: 'Falcon Liquidity FZE', assetCode: 'USDT_TRC20',
      declaredHosting: 'SELF_CUSTODY', addressType: 'SELF_CUSTODY', screeningAnswer: 'GREEN',
      evidenceRef: 'AGR-2026-LP-001 §4.2 payout schedule',
    });
    expect(createDto.objectSnapshot.coordinate).toContain('TXfake0000000000000000000000000000');
    expect(typeof createDto.objectSnapshot.impact).toBe('string');
    // 铁律⑥：快照里没有 lpId / assetId，也没有任何 UUID
    const snapshotJson = JSON.stringify(createDto.objectSnapshot);
    expect(snapshotJson).not.toContain(FALCON.id);
    expect(snapshotJson).not.toContain(USDT.id);
    expect(snapshotJson).not.toMatch(UUID_RE);
    expect(submitDto).toEqual({ reason: createDto.objectSnapshot.impact, traceId: row.traceId });
    expect(actor).toBe(treasury);

    // 顺序：先建行 → 再开审批 → 最后回填审批号
    const createOrder = d.prisma.lpPayoutAddress.create.mock.invocationCallOrder[0];
    const submitOrder = d.approvals.createAndSubmit.mock.invocationCallOrder[0];
    const stampOrder = d.prisma.lpPayoutAddress.update.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(submitOrder);
    expect(submitOrder).toBeLessThan(stampOrder);

    expect(d.actions()).toEqual(['LP_ADDRESS_REGISTERED', 'LP_ADDRESS_SCREENED']);
    const [registered, screened] = d.audits;
    expect(registered.via).toBe('actor'); // 登记是金库操作员的手
    expect(registered.actor).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-TREASURY' });
    expect(screened.via).toBe('system'); // 筛查是 Sumsub 侧 mock 能力，系统主体
    expect(screened.input.afterData).toMatchObject({ screeningAnswer: 'GREEN' });
    expect(registered.input.afterData).toMatchObject({ assetCode: 'USDT_TRC20', network: 'TRON', address: 'TXfake0000000000000000000000000000', declaredHosting: 'SELF_CUSTODY', evidenceRef: 'AGR-2026-LP-001 §4.2 payout schedule' });
  });

  it('② RED（尾号 3333）：登记即 REJECTED（落点计算），不开审批单；审计 REGISTERED+SCREENED+REJECTED（系统、固定拒因、无 fromStatus）', async () => {
    const d = buildDeps();

    const result = await d.svc.registerAddress(FALCON.lpNo, chainDto({ address: 'TXfake0000000000000000000000003333' }), treasury);

    expect(result).toEqual({ addressNo: expect.stringMatching(/^LPA/), approvalNo: null, status: S.REJECTED });
    expect(d.approvals.createAndSubmit).not.toHaveBeenCalled();
    expect(d.prisma.rows.get(result.addressNo)).toMatchObject({ status: S.REJECTED, screeningAnswer: 'RED', approvalNo: null });

    expect(d.actions()).toEqual(['LP_ADDRESS_REGISTERED', 'LP_ADDRESS_SCREENED', 'LP_ADDRESS_REJECTED']);
    const rejected = d.audits[2];
    expect(rejected.via).toBe('system');
    expect(rejected.input.reason).toBe('Screening returned RED at registration');
    expect(rejected.input.toStatus).toBe(S.REJECTED);
    expect(rejected.input.fromStatus).toBeUndefined(); // 插入即终态：落点不是边
    expect(d.audits[1].input.afterData).toMatchObject({ screeningAnswer: 'RED' });
  });

  it('② 补：法币 IBAN 尾号 3333 同律即拒；法币快照 coordinate=清洗后的 IBAN、declaredHosting=null、assetCode=AED', async () => {
    const d = buildDeps();
    const red = await d.svc.registerAddress(FALCON.lpNo, fiatDto({ iban: 'ae07 0331 2345 6789 0123 3333' }), treasury);
    expect(red.status).toBe(S.REJECTED);
    expect(d.approvals.createAndSubmit).not.toHaveBeenCalled();

    const ok = await d.svc.registerAddress(FALCON.lpNo, fiatDto(), treasury);
    expect(ok.status).toBe(S.PENDING_APPROVAL);
    const snapshot = (d.approvals.createAndSubmit.mock.calls[0] as any[])[0].objectSnapshot;
    expect(snapshot).toMatchObject({ assetCode: 'AED', declaredHosting: null, addressType: 'BANK', screeningAnswer: 'GREEN' });
    expect(snapshot.coordinate).toContain('AE070331234567890123456');
  });

  it('③ 托管自报与归因不一致（尾号 1111 自报 SELF_CUSTODY）：红旗不拦截，仍开审批；快照 addressType=VASP，impact 文案把不一致讲给 CFO', async () => {
    const d = buildDeps();

    const result = await d.svc.registerAddress(FALCON.lpNo, chainDto({ address: 'TXfake0000000000000000000000001111', declaredHosting: 'SELF_CUSTODY' }), treasury);

    expect(result.status).toBe(S.PENDING_APPROVAL);
    const snapshot = (d.approvals.createAndSubmit.mock.calls[0] as any[])[0].objectSnapshot;
    expect(snapshot).toMatchObject({ declaredHosting: 'SELF_CUSTODY', addressType: 'VASP' });
    expect(snapshot.impact).toMatch(/mismatch/i);
    expect(d.prisma.rows.get(result.addressNo).hostingMismatch).toBe(true);
    expect(d.audits[0].input.afterData).toMatchObject({ hostingMismatch: true, addressType: 'VASP', counterpartyVaspName: 'Mock VASP Exchange' });
  });

  it('③ 补：自报与归因一致时 impact 不提不一致', async () => {
    const d = buildDeps();
    await d.svc.registerAddress(FALCON.lpNo, chainDto({ address: 'TXfake0000000000000000000000001111', declaredHosting: 'VASP' }), treasury);
    const snapshot = (d.approvals.createAndSubmit.mock.calls[0] as any[])[0].objectSnapshot;
    expect(snapshot.impact).not.toMatch(/mismatch/i);
  });
});

describe('LpPayoutAddressWorkflowService.onDecided（CFO 裁决落地）', () => {
  it('① APPROVED → ACTIVE；审计 LP_ADDRESS_APPROVED 由系统写，带 approvalNo / causationId / 前后态', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d);

    await d.svc.onDecided(decidedEvent(addressNo));

    expect(d.prisma.rows.get(addressNo)).toMatchObject({ status: S.ACTIVE, approvalNo: 'APR-LPA-1' });
    expect(d.actions()).toEqual(['LP_ADDRESS_REGISTERED', 'LP_ADDRESS_SCREENED', 'LP_ADDRESS_APPROVED']);
    const approved = d.audits[2];
    expect(approved.via).toBe('system');
    expect(approved.input).toMatchObject({ approvalNo: 'APR-LPA-1', causationId: 'causation-id-1', fromStatus: S.PENDING_APPROVAL, toStatus: S.ACTIVE });
    expect(approved.input.subjects).toEqual(expect.arrayContaining([expect.objectContaining({ subjectType: 'APPROVAL_CASE', subjectNo: 'APR-LPA-1', subjectRole: 'INSTRUMENT' })]));
  });

  it('② DECLINED → REJECTED，拒因取 CFO 的 decisionReason；无 decisionReason 退到 "Rejected by CFO"', async () => {
    const d = buildDeps();
    const a = await registerPending(d);
    await d.svc.onDecided(decidedEvent(a, { decision: 'DECLINED', decisionReason: 'Beneficiary bank not in the agreement' }));
    expect(d.prisma.rows.get(a).status).toBe(S.REJECTED);
    const rejected = d.audits.find((x) => x.input.action === 'LP_ADDRESS_REJECTED')!;
    expect(rejected.via).toBe('system');
    expect(rejected.input).toMatchObject({ reason: 'Beneficiary bank not in the agreement', approvalNo: 'APR-LPA-1', causationId: 'causation-id-1', fromStatus: S.PENDING_APPROVAL, toStatus: S.REJECTED });

    const d2 = buildDeps();
    const b = await registerPending(d2);
    await d2.svc.onDecided(decidedEvent(b, { decision: 'DECLINED', decisionReason: null }));
    expect(d2.audits.find((x) => x.input.action === 'LP_ADDRESS_REJECTED')!.input.reason).toBe('Rejected by CFO');
  });

  it('② EXPIRED → REJECTED，拒因 "Approval expired"', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d);
    await d.svc.onDecided(decidedEvent(addressNo, { decision: 'EXPIRED', decisionReason: null }));
    expect(d.prisma.rows.get(addressNo).status).toBe(S.REJECTED);
    expect(d.audits.find((x) => x.input.action === 'LP_ADDRESS_REJECTED')!.input.reason).toBe('Approval expired');
  });

  it('CANCELLED → 撤回口自己收口：不动状态、不写审计', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d);
    const before = d.audits.length;
    await d.svc.onDecided(decidedEvent(addressNo, { decision: 'CANCELLED' }));
    expect(d.prisma.rows.get(addressNo).status).toBe(S.PENDING_APPROVAL);
    expect(d.audits.length).toBe(before);
  });

  it('过期裁决不复活终态：⚡喂 RED 已 REJECTED 的地址，在途审批单之后被批 → 地址仍 REJECTED，不抛、不写 APPROVED 审计', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d);
    await d.svc.feedScreening(addressNo, 'RED', 'Sumsub flagged the counterparty wallet', compliance);
    expect(d.prisma.rows.get(addressNo).status).toBe(S.REJECTED);
    const before = d.audits.length;

    await expect(d.svc.onDecided(decidedEvent(addressNo, { decision: 'APPROVED' }))).resolves.toBeUndefined();
    await expect(d.svc.onDecided(decidedEvent(addressNo, { decision: 'DECLINED', decisionReason: 'late' }))).resolves.toBeUndefined();
    await expect(d.svc.onDecided(decidedEvent(addressNo, { decision: 'EXPIRED' }))).resolves.toBeUndefined();

    expect(d.prisma.rows.get(addressNo).status).toBe(S.REJECTED);
    expect(d.audits.length).toBe(before);
  });

  it('过期裁决同样不碰 ACTIVE：已批地址再收到迟到的 DECLINED → 仍 ACTIVE，无新审计', async () => {
    const d = buildDeps();
    const addressNo = await registerActive(d);
    const before = d.audits.length;
    await d.svc.onDecided(decidedEvent(addressNo, { decision: 'DECLINED', decisionReason: 'late' }));
    expect(d.prisma.rows.get(addressNo).status).toBe(S.ACTIVE);
    expect(d.audits.length).toBe(before);
  });

  it('找不到地址的裁决事件 → 静默返回，不抛（事件处理器里没有可回的调用方）', async () => {
    const d = buildDeps();
    await expect(d.svc.onDecided(decidedEvent('LPA000000000000'))).resolves.toBeUndefined();
  });
});

describe('LpPayoutAddressWorkflowService.feedScreening（⚡筛查覆写后门）', () => {
  it('③ 待批时喂 RED → REJECTED；审计 LP_ADDRESS_REJECTED 由 ⚡操作员亲手写（actor 通道），带拒因与前后态；screeningAnswer 改 RED', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d);

    const view = await d.svc.feedScreening(addressNo, 'RED', 'Sumsub flagged the counterparty wallet', compliance);

    expect(view).toMatchObject({ addressNo, status: S.REJECTED, screeningAnswer: 'RED' });
    expect(d.prisma.rows.get(addressNo)).toMatchObject({ status: S.REJECTED, screeningAnswer: 'RED' });
    expect(d.actions().slice(2)).toEqual(['LP_ADDRESS_REJECTED']);
    const rejected = d.audits[2];
    expect(rejected.via).toBe('actor');
    expect(rejected.actor).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-COMPLIANCE' });
    expect(rejected.input).toMatchObject({ reason: 'Sumsub flagged the counterparty wallet', fromStatus: S.PENDING_APPROVAL, toStatus: S.REJECTED });
    expect(rejected.input.metadata).toMatchObject({ screeningFedBy: 'ADM-COMPLIANCE', screeningAnswer: 'RED' });
  });

  it('③ 待批时喂 YELLOW：只改结论、状态不动、不关审批；审计 LP_ADDRESS_SCREENED（actor 通道，带 reason / 前后结论）', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d); // 登记筛出 GREEN

    const view = await d.svc.feedScreening(addressNo, 'YELLOW', 'Counterparty under enhanced monitoring', compliance);

    expect(view).toMatchObject({ addressNo, status: S.PENDING_APPROVAL, screeningAnswer: 'YELLOW' });
    expect(d.prisma.rows.get(addressNo)).toMatchObject({ status: S.PENDING_APPROVAL, screeningAnswer: 'YELLOW' });
    expect(d.actions().slice(2)).toEqual(['LP_ADDRESS_SCREENED']);
    const screened = d.audits[2];
    expect(screened.via).toBe('actor');
    expect(screened.input.reason).toBe('Counterparty under enhanced monitoring');
    expect(screened.input.beforeData).toMatchObject({ screeningAnswer: 'GREEN' });
    expect(screened.input.afterData).toMatchObject({ screeningAnswer: 'YELLOW' });
    expect(d.approvals.cancel).not.toHaveBeenCalled();
  });

  it('③ 补：喂 GREEN 可把登记时的 YELLOW（尾号 2222）改判回 GREEN', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d, chainDto({ address: 'TXfake0000000000000000000000002222' }));
    expect(d.prisma.rows.get(addressNo).screeningAnswer).toBe('YELLOW');
    await d.svc.feedScreening(addressNo, 'GREEN', 'Cleared after manual review', compliance);
    expect(d.prisma.rows.get(addressNo)).toMatchObject({ status: S.PENDING_APPROVAL, screeningAnswer: 'GREEN' });
  });

  it('④ 非待批态喂任何结论 → 409，行不变、不写审计（⚡不是绕迁移表的直写通道）', async () => {
    for (const to of ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'CANCELLED', 'REJECTED'] as const) {
      const d = buildDeps();
      let addressNo: string;
      if (to === 'CANCELLED') {
        addressNo = await registerPending(d);
        await d.svc.cancel(addressNo, { reason: 'Registered by mistake' }, treasury);
      } else if (to === 'REJECTED') {
        addressNo = await registerPending(d);
        await d.svc.onDecided(decidedEvent(addressNo, { decision: 'DECLINED', decisionReason: 'no' }));
      } else {
        addressNo = await registerActive(d);
        if (to === 'SUSPENDED') await d.svc.suspend(addressNo, { reason: 'Under review' }, treasury);
        if (to === 'DEACTIVATED') await d.svc.deactivate(addressNo, { reason: 'Replaced' }, treasury);
      }
      const snapshot = { ...d.prisma.rows.get(addressNo) };
      const before = d.audits.length;
      expect(snapshot.status).toBe(to);

      for (const answer of ['GREEN', 'YELLOW', 'RED'] as const) {
        await expect(d.svc.feedScreening(addressNo, answer, 'late override', compliance)).rejects.toBeInstanceOf(ConflictException);
      }
      expect(d.prisma.rows.get(addressNo)).toEqual(snapshot);
      expect(d.audits.length).toBe(before);
    }
  });

  it('reason 空白 → 400，行不变；地址不存在 → 404', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d);
    const before = d.audits.length;
    await expect(d.svc.feedScreening(addressNo, 'RED', '   ', compliance)).rejects.toBeInstanceOf(BadRequestException);
    expect(d.prisma.rows.get(addressNo).status).toBe(S.PENDING_APPROVAL);
    expect(d.audits.length).toBe(before);
    await expect(d.svc.feedScreening('LPA000000000000', 'RED', 'x', compliance)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('LpPayoutAddressWorkflowService.cancel / suspend / reactivate / deactivate（金库收紧放松，留痕不批）', () => {
  it('⑤ suspend：ACTIVE → SUSPENDED，审计 LP_ADDRESS_SUSPENDED（actor 通道、reason、前后态），不开审批', async () => {
    const d = buildDeps();
    const addressNo = await registerActive(d);
    const submits = d.approvals.createAndSubmit.mock.calls.length;

    const res = await d.svc.suspend(addressNo, { reason: 'Bank asked us to hold off' }, treasury);

    expect(res).toEqual({ addressNo, status: S.SUSPENDED });
    expect(d.prisma.rows.get(addressNo)).toMatchObject({ status: S.SUSPENDED });
    expect(d.prisma.rows.get(addressNo).suspendedAt).toBeInstanceOf(Date);
    const last = d.audits[d.audits.length - 1];
    expect(last.input.action).toBe('LP_ADDRESS_SUSPENDED');
    expect(last.via).toBe('actor');
    expect(last.actor).toMatchObject({ actorNo: 'ADM-TREASURY' });
    expect(last.input).toMatchObject({ reason: 'Bank asked us to hold off', fromStatus: S.ACTIVE, toStatus: S.SUSPENDED });
    expect(d.approvals.createAndSubmit.mock.calls.length).toBe(submits);
  });

  it('⑤ reactivate：SUSPENDED → ACTIVE，清 suspendedAt，审计 LP_ADDRESS_REACTIVATED，不开审批', async () => {
    const d = buildDeps();
    const addressNo = await registerActive(d);
    await d.svc.suspend(addressNo, { reason: 'Hold' }, treasury);
    const submits = d.approvals.createAndSubmit.mock.calls.length;

    const res = await d.svc.reactivate(addressNo, { reason: 'Bank confirmed all clear' }, treasury);

    expect(res).toEqual({ addressNo, status: S.ACTIVE });
    expect(d.prisma.rows.get(addressNo).suspendedAt).toBeNull();
    const last = d.audits[d.audits.length - 1];
    expect(last.input.action).toBe('LP_ADDRESS_REACTIVATED');
    expect(last.via).toBe('actor');
    expect(last.input).toMatchObject({ reason: 'Bank confirmed all clear', fromStatus: S.SUSPENDED, toStatus: S.ACTIVE });
    expect(d.approvals.createAndSubmit.mock.calls.length).toBe(submits);
  });

  it('⑤ deactivate：ACTIVE → DEACTIVATED（永久退役），审计 LP_ADDRESS_DEACTIVATED，不开审批；退役后同坐标可重新登记', async () => {
    const d = buildDeps();
    const addressNo = await registerActive(d);
    const submits = d.approvals.createAndSubmit.mock.calls.length;

    const res = await d.svc.deactivate(addressNo, { reason: 'Replaced by new payout account' }, treasury);

    expect(res).toEqual({ addressNo, status: S.DEACTIVATED });
    expect(d.prisma.rows.get(addressNo).deactivatedAt).toBeInstanceOf(Date);
    const last = d.audits[d.audits.length - 1];
    expect(last.input.action).toBe('LP_ADDRESS_DEACTIVATED');
    expect(last.via).toBe('actor');
    expect(last.input).toMatchObject({ reason: 'Replaced by new payout account', fromStatus: S.ACTIVE, toStatus: S.DEACTIVATED });
    expect(d.approvals.createAndSubmit.mock.calls.length).toBe(submits);
    await expect(d.svc.registerAddress(FALCON.lpNo, chainDto(), treasury)).resolves.toMatchObject({ status: S.PENDING_APPROVAL });
  });

  it('⑤ 补：非法跃迁 409 且不写审计（待批不能停 / ACTIVE 不能再放松 / 停用态不能退役）', async () => {
    const d = buildDeps();
    const pending = await registerPending(d);
    const active = await registerActive(d, chainDto({ address: 'TXfake0000000000000000000000000009' }));
    const before = d.audits.length;
    await expect(d.svc.suspend(pending, { reason: 'x' }, treasury)).rejects.toBeInstanceOf(ConflictException);
    await expect(d.svc.deactivate(pending, { reason: 'x' }, treasury)).rejects.toBeInstanceOf(ConflictException);
    await expect(d.svc.reactivate(active, { reason: 'x' }, treasury)).rejects.toBeInstanceOf(ConflictException);
    await d.svc.suspend(active, { reason: 'Hold' }, treasury);
    const mid = d.audits.length;
    await expect(d.svc.deactivate(active, { reason: 'x' }, treasury)).rejects.toBeInstanceOf(ConflictException); // SUSPENDED 无退役边
    expect(d.audits.length).toBe(mid);
    expect(d.audits.length).toBe(before + 1); // 只有那一次合法 suspend 留了痕
    expect(d.prisma.rows.get(pending).status).toBe(S.PENDING_APPROVAL);
  });

  it('cancel：待批 → CANCELLED；先撤审批单（approvals.cancel，带操作员）再翻状态；审计 LP_ADDRESS_CANCELLED（actor 通道）', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d);

    const res = await d.svc.cancel(addressNo, { reason: 'Wrong coordinate typed' }, treasury);

    expect(res).toEqual({ addressNo, status: S.CANCELLED });
    expect(d.approvals.cancel).toHaveBeenCalledWith('APR-LPA-1', { reason: 'Wrong coordinate typed' }, treasury);
    expect(d.prisma.rows.get(addressNo).cancelledAt).toBeInstanceOf(Date);
    const last = d.audits[d.audits.length - 1];
    expect(last.input.action).toBe('LP_ADDRESS_CANCELLED');
    expect(last.via).toBe('actor');
    expect(last.input).toMatchObject({ reason: 'Wrong coordinate typed', fromStatus: S.PENDING_APPROVAL, toStatus: S.CANCELLED });
    // 先撤单后翻态（照 lp-exchange cancel 纪律）：approvals.cancel 在 CANCELLED 审计之前
    expect(d.approvals.cancel.mock.invocationCallOrder[0]).toBeLessThan(d.auditLogs.recordByActor.mock.invocationCallOrder[d.auditLogs.recordByActor.mock.calls.length - 1]);
  });

  it('cancel 已批地址 → 409，且不去碰审批引擎（approvals.cancel 没被调用）', async () => {
    const d = buildDeps();
    const addressNo = await registerActive(d);
    await expect(d.svc.cancel(addressNo, { reason: 'too late' }, treasury)).rejects.toBeInstanceOf(ConflictException);
    expect(d.approvals.cancel).not.toHaveBeenCalled();
    expect(d.prisma.rows.get(addressNo).status).toBe(S.ACTIVE);
  });

  it('不存在的地址号 → 404（四个动作同）', async () => {
    const d = buildDeps();
    for (const act of ['cancel', 'suspend', 'reactivate', 'deactivate'] as const) {
      await expect((d.svc as any)[act]('LPA000000000000', { reason: 'x' }, treasury)).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});

describe('LpPayoutAddressWorkflowService.updateLabel', () => {
  it('改标签：只动 label、坐标不动；审计 LP_ADDRESS_LABEL_UPDATED 带前后值（铁律①：操作员每个持久化动作都留痕）', async () => {
    const d = buildDeps();
    const addressNo = await registerPending(d, chainDto({ label: 'old label' }));

    const view = await d.svc.updateLabel(addressNo, { label: 'Treasury main payout' }, treasury);

    expect(view).toMatchObject({ addressNo, label: 'Treasury main payout', address: 'TXfake0000000000000000000000000000', status: S.PENDING_APPROVAL });
    const last = d.audits[d.audits.length - 1];
    expect(last.input.action).toBe('LP_ADDRESS_LABEL_UPDATED');
    expect(last.via).toBe('actor');
    expect(last.input.beforeData).toEqual({ label: 'old label' });
    expect(last.input.afterData).toEqual({ label: 'Treasury main payout' });
  });
});

describe('审计信封纪律（全生命周期）', () => {
  it('每条信封：显式且互异的 requestId、correlationId=地址 traceId、主体 LP_ADDRESS/addressNo + 关联 LP、域 TREASURY、workflowType LP_ADDRESS；业务载荷零 UUID', async () => {
    const d = buildDeps();
    const a = await registerActive(d);
    await d.svc.updateLabel(a, { label: 'main' }, treasury);
    await d.svc.suspend(a, { reason: 'Hold' }, treasury);
    await d.svc.reactivate(a, { reason: 'Clear' }, treasury);
    await d.svc.deactivate(a, { reason: 'Replace' }, treasury);
    const b = await registerPending(d, chainDto({ address: 'TXfake0000000000000000000000000002' }));
    await d.svc.feedScreening(b, 'YELLOW', 'monitor', compliance);
    await d.svc.cancel(b, { reason: 'oops' }, treasury);
    const c = await registerPending(d, chainDto({ address: 'TXfake0000000000000000000000000003' }));
    await d.svc.feedScreening(c, 'RED', 'dirty', compliance);
    await d.svc.registerAddress(FALCON.lpNo, chainDto({ address: 'TXfake0000000000000000000000003333' }), treasury);

    expect(new Set(d.actions())).toEqual(new Set([
      'LP_ADDRESS_REGISTERED', 'LP_ADDRESS_SCREENED', 'LP_ADDRESS_APPROVED', 'LP_ADDRESS_REJECTED', 'LP_ADDRESS_CANCELLED',
      'LP_ADDRESS_SUSPENDED', 'LP_ADDRESS_REACTIVATED', 'LP_ADDRESS_DEACTIVATED', 'LP_ADDRESS_LABEL_UPDATED',
    ]));
    const requestIds = d.audits.map((x) => x.input.requestId);
    expect(requestIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(requestIds).size).toBe(requestIds.length);
    for (const { input } of d.audits) {
      const row = d.prisma.rows.get(input.primarySubjectNo);
      expect(input.primarySubjectType).toBe('LP_ADDRESS');
      expect(input.actionDomain).toBe('TREASURY');
      expect(input.workflowType).toBe('LP_ADDRESS');
      expect(input.correlationId).toBe(row.traceId);
      expect(input.subjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ subjectType: 'LP_ADDRESS', subjectNo: input.primarySubjectNo, subjectRole: 'PRIMARY' }),
        expect.objectContaining({ subjectType: 'LIQUIDITY_PROVIDER', subjectNo: FALCON.lpNo, subjectRole: 'RELATED' }),
      ]));
      const payload = JSON.stringify({ metadata: input.metadata, beforeData: input.beforeData, afterData: input.afterData, reason: input.reason });
      expect(payload).not.toMatch(UUID_RE);
      expect(payload).not.toContain(FALCON.id);
      expect(payload).not.toContain(USDT.id);
    }
  });
});

describe('DTO（ValidationPipe whitelist）', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  it('登记 DTO：assetId / evidenceRef 必填；多塞字段被剥掉（坐标冻结靠服务签名，这里只验 whitelist 生效）', async () => {
    const meta = { type: 'body' as const, metatype: RegisterLpPayoutAddressDto };
    await expect(pipe.transform({ ...chainDto(), assetId: undefined }, meta)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ ...chainDto(), evidenceRef: '' }, meta)).rejects.toThrow(BadRequestException);
    const ok = await pipe.transform({ ...chainDto(), status: 'ACTIVE', approvalNo: 'x' }, meta);
    expect(ok).not.toHaveProperty('status');
    expect(ok).not.toHaveProperty('approvalNo');
    expect(ok.address).toBe('TXfake0000000000000000000000000000');
  });

  it('坐标二选一组必填：既无 iban 也无 network / address → 400；链上组缺 network 或 address 或给空串 → 400；带 iban 则 network / address 让位', async () => {
    const meta = { type: 'body' as const, metatype: RegisterLpPayoutAddressDto };
    const base = { assetId: USDT.id, evidenceRef: 'AGR-2026-LP-001 §4.2' };
    // 无坐标载荷（走真 ValidationPipe）
    await expect(pipe.transform({ ...base }, meta)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ ...base, declaredHosting: 'SELF_CUSTODY' }, meta)).rejects.toThrow(BadRequestException);
    // 链上组缺一半 / 空串
    await expect(pipe.transform({ ...base, network: 'TRON', declaredHosting: 'SELF_CUSTODY' }, meta)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ ...base, address: 'TXabc', declaredHosting: 'SELF_CUSTODY' }, meta)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ ...base, network: '', address: 'TXabc', declaredHosting: 'SELF_CUSTODY' }, meta)).rejects.toThrow(BadRequestException);
    // 空串 iban 等于没给 iban，同样要链上组
    await expect(pipe.transform({ ...base, iban: '' }, meta)).rejects.toThrow(BadRequestException);
    // 链上组齐 / 法币组（只给 iban）→ 过
    await expect(pipe.transform({ ...base, network: 'TRON', address: 'TXabc', declaredHosting: 'SELF_CUSTODY' }, meta)).resolves.toBeDefined();
    const fiat = await pipe.transform({ ...base, assetId: AED.id, iban: 'AE070331234567890123456', bankName: 'Emirates NBD' }, meta);
    expect(fiat.iban).toBe('AE070331234567890123456');
    expect(fiat.network).toBeUndefined();
    expect(fiat.address).toBeUndefined();
  });

  it('启停撤 DTO：reason 必填且 trim；改标签 DTO：label 必填且 trim（与 reason 同口径）', async () => {
    const reasonMeta = { type: 'body' as const, metatype: LpPayoutAddressReasonDto };
    await expect(pipe.transform({}, reasonMeta)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ reason: '   ' }, reasonMeta)).rejects.toThrow(BadRequestException);
    expect((await pipe.transform({ reason: '  Replaced  ' }, reasonMeta)).reason).toBe('Replaced');
    const labelMeta = { type: 'body' as const, metatype: UpdateLpPayoutAddressLabelDto };
    await expect(pipe.transform({}, labelMeta)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ label: '   ' }, labelMeta)).rejects.toThrow(BadRequestException);
    expect((await pipe.transform({ label: '  Treasury main  ' }, labelMeta)).label).toBe('Treasury main');
  });
});
