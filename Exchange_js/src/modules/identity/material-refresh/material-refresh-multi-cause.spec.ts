import { readFileSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { MaterialRefreshService } from './material-refresh.service';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerAccessService } from '../customers/customer-access.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { MaterialRequestIssuerService } from '../material-requests/material-request-issuer.service';
import { MaterialRequestsService } from '../material-requests/material-requests.service';

/**
 * Task 7 —「多因不互相解」：整套限制账设计存在的首要理由。
 *
 * 客户身上同时挂 SANCTION（制裁，SILENT，scope=ALL）与 MATERIAL_EXPIRED（材料过期，
 * DISCLOSED，卡 WITHDRAW+SWAP）两张便签，客户补齐材料触发材料侧自动撕 ——
 * SANCTION 那张必须纹丝不动，三个能力仍然全封。
 *
 * 旧的单字段模型（CustomerMain.complianceStatus）在这里必然失败：材料解冻会把
 * complianceStatus 无条件写回 CLEAR，制裁摁住当场蒸发、客户能提币走人。
 *
 * 用真 CustomerRestrictionsService + 真 CustomerRestrictionWorkflowService +
 * 真 CustomerAccessService，跑在内存 prisma 上 —— 只有真服务才能证明「撕的定位键
 * 是 cause + caseRef 而不是客户 id」。
 */

// ─── 手搓内存 prisma（够用即可：等值 / in / not / equals 四种 where 形态）───
type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w));
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as any[]).includes(row[k]);
      if ('notIn' in v) return !(v.notIn as any[]).includes(row[k]);
      if ('not' in v) return row[k] !== (v as any).not;
      if ('equals' in v) return row[k] === (v as any).equals;
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(seed: Row[] = []) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  let seq = 0;
  return {
    rows,
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, ...data };
      rows.push(row);
      return row;
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data)
        rows.push({
          id: d.id ?? `row-${++seq}`,
          // 补 schema 里由 @default(now()) 提供的列：内存桩不跑 Prisma 的默认值，
          // 少了它 CustomerAccessService 投影 disclosed 时会在 openedAt 上炸。
          openedAt: new Date(),
          releasedAt: null,
          releasedBy: null,
          releaseApprovalNo: null,
          releaseOrderRef: null,
          releaseMode: null,
          ...d,
        });
      return { count: data.length };
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))[0] ?? null),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error(`no row for ${JSON.stringify(where)}`);
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
}

const CUSTOMER_ID = 'cust-1';
const HOLDING_ID = 'hold-1';
const CYCLE_ID = 'cyc-1';

describe('多因不互相解 — 材料自动撕不许碰制裁便签（Task 7）', () => {
  let prisma: any;
  let restrictionsService: CustomerRestrictionsService;
  let accessService: CustomerAccessService;
  let materialRefreshService: MaterialRefreshService;

  beforeEach(async () => {
    prisma = {
      customerMain: makeTable([
        { id: CUSTOMER_ID, customerNo: 'C0001', lifecycle: 'ACTIVE', riskRating: 'LOW', sumsubApplicantId: 'sub-1' },
      ]),
      customerRestriction: makeTable(),
      customerMaterialHolding: makeTable([
        {
          id: HOLDING_ID, customerId: CUSTOMER_ID, materialType: 'PROOF_OF_ADDRESS',
          managementMode: 'SELF_MANAGED', status: 'REFRESH_IN_PROGRESS',
          activeRefreshCycleId: CYCLE_ID, expiresAt: new Date('2026-01-01'),
        },
      ]),
      materialRefreshCycle: makeTable([
        {
          id: CYCLE_ID, cycleNo: 'MRC-001', customerId: CUSTOMER_ID, holdingId: HOLDING_ID,
          materialType: 'PROOF_OF_ADDRESS', status: 'PENDING_SUMSUB_REVIEW', stage: 'URGENT',
          triggerType: 'SCHEDULED_EXPIRY',
          // Task 11：T-0 补挂便签的 caseRef 键，也是 completeCycleFromMaterialRequest
          // 自动撕时用的同一个键 —— 这条测试锁的是「多因不互相解」，不是材料账
          // 本身，用一个轻量 jest mock（见下方 MaterialRequestsService provider）即可。
          materialRequestNo: 'MRQ-001',
        },
      ]),
    };
    prisma.$transaction = async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg);

    const module = await Test.createTestingModule({
      providers: [
        CustomerRestrictionsService,
        CustomerAccessService,
        CustomerRestrictionWorkflowService,
        MaterialRefreshService,
        { provide: PrismaService, useValue: prisma },
        // Task 9：open() 在 scope=ALL 时广播 customer.restriction.opened
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AuditLogsService, useValue: { recordSystem: jest.fn().mockResolvedValue({}), recordByActor: jest.fn().mockResolvedValue({}) } },
        { provide: ApprovalsService, useValue: { createAndSubmit: jest.fn().mockResolvedValue({ id: 'ap-1', approvalNo: 'APR-1' }) } },
        { provide: SumsubClient, useValue: { createApplicantAction: jest.fn().mockResolvedValue({ id: 'act-1' }), getApplicant: jest.fn().mockResolvedValue({ info: { idDocs: [] } }) } },
        // CustomerAccessService.assertOffboardable 依赖这两个（本用例不走销户路径，
        // 给最小 stub 即可）。
        { provide: AccountingService, useValue: { getCustomerAvailableBalance: jest.fn().mockResolvedValue(0n) } },
        { provide: FundsOrderService, useValue: { countNonTerminalByCustomer: jest.fn().mockResolvedValue(0) } },
        { provide: MaterialRefreshPolicyLoader, useValue: { getMaterialConfig: jest.fn().mockReturnValue({ sumsubActionLevelName: 'wave3-poa', enforceRestriction: true, windowDays: { LOW: 365 } }) } },
        // Task 11：T-30 建行 / T-0 补挂便签改走材料账。本测试锁的是「多因不互相
        // 解」（限制账内部），不是材料账下发本身，给最小 stub 即可 ——
        // enterNotifiedStage 不在本文件任何用例的调用链上，issue() 不会被真调用。
        { provide: MaterialRequestIssuerService, useValue: { issue: jest.fn() } },
        { provide: MaterialRequestsService, useValue: { attachRestriction: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    restrictionsService = module.get(CustomerRestrictionsService);
    accessService = module.get(CustomerAccessService);
    materialRefreshService = module.get(MaterialRefreshService);
  });

  it('SANCTION + MATERIAL_EXPIRED 并存，材料自动撕后 SANCTION 仍 OPEN 且三能力全封', async () => {
    // 1. CRA 制裁路径贴的那张（SILENT / scope=ALL / caseRef=CRA id）
    const sanction = await restrictionsService.open({
      customerId: CUSTOMER_ID,
      cause: 'SANCTION',
      reason: 'Sanctions labels on CRA-001: SANCTIONS_LIST',
      caseRef: 'cra-1',
      openedBy: 'SYSTEM',
    });
    // 2. 材料到期 cron 贴的那张（DISCLOSED / WITHDRAW+SWAP / caseRef=周期 id）
    await materialRefreshService.enterBlockingStage(HOLDING_ID);

    const before = await accessService.resolve(CUSTOMER_ID);
    expect([...before.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    expect(before.openCount).toBeGreaterThanOrEqual(2);

    // 3. 客户补齐材料 → Sumsub GREEN → 材料侧自动撕
    await materialRefreshService.completeCycleFromMaterialRequest(CYCLE_ID, 'APPROVED');

    const rows = await restrictionsService.listAll(CUSTOMER_ID);
    const sanctionRows = rows.filter((r) => r.cause === 'SANCTION');
    const materialRows = rows.filter((r) => r.cause === 'MATERIAL_EXPIRED');

    // 制裁那张纹丝不动
    expect(sanctionRows).toHaveLength(1);
    expect(sanctionRows[0].restrictionNo).toBe(sanction.restrictionNo);
    expect(sanctionRows[0].status).toBe('OPEN');
    expect(sanctionRows[0].releasedAt).toBeNull();
    expect(sanctionRows[0].releaseMode).toBeNull();

    // 材料那张（及其全部 scope 行）撕干净，且标记为自动撕
    expect(materialRows.length).toBeGreaterThan(0);
    expect(materialRows.every((r) => r.status === 'RELEASED')).toBe(true);
    expect(materialRows.every((r) => r.releaseMode === 'AUTO')).toBe(true);

    // 执法读侧：SANCTION 的 scope=ALL 展开后三能力仍全封
    const after = await accessService.resolve(CUSTOMER_ID);
    expect([...after.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    // 零痕迹：SANCTION 是 SILENT，客户面什么都看不到
    expect(after.disclosed).toHaveLength(0);
    expect(after.disclosedBlocked.size).toBe(0);
  });

  it('对照组：只挂 MATERIAL_EXPIRED 时，自动撕后能力全部恢复（防止用例被空实现骗过）', async () => {
    await materialRefreshService.enterBlockingStage(HOLDING_ID);

    let access = await accessService.resolve(CUSTOMER_ID);
    expect([...access.blocked].sort()).toEqual(['SWAP', 'WITHDRAW']);
    expect(access.disclosed).toHaveLength(1);
    expect(access.disclosed[0].label).toBe('Document expired');

    await materialRefreshService.completeCycleFromMaterialRequest(CYCLE_ID, 'APPROVED');

    access = await accessService.resolve(CUSTOMER_ID);
    expect(access.blocked.size).toBe(0);
    expect(access.disclosed).toHaveLength(0);
  });

  it('INV-1 守则扫描：四个自动写入点不得再给 lifecycle 赋任何字面值', () => {
    const files = [
      'material-refresh.service.ts',
      '../tier-upgrade-case/tier-upgrade-case.service.ts',
      '../client-risk-assessment/client-risk-assessment.service.ts',
      '../../sumsub-ingestion/sumsub-ingestion.service.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      expect({ file: rel, hits: src.match(/lifecycle:\s*'/g) ?? [] }).toEqual({ file: rel, hits: [] });
    }
  });
});
