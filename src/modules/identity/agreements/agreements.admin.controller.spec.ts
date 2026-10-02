import { BadRequestException, ForbiddenException, NotFoundException, RequestMethod, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { RBAC_PERMISSION_DEFINITIONS } from '../access-control/rbac.catalog';
import { REQUIRE_PERMISSIONS_KEY } from '../access-control/require-permissions.decorator';
import { AgreementPublishWorkflowService } from './agreement-publish-workflow.service';
import { AgreementsAdminController, SubmitPublishBodyDto } from './agreements.admin.controller';
import { AgreementsReadService } from './agreements-read.service';
import { AGREEMENT_BODIES } from './agreement-versions.constant';

// 战役丙波三 T9：控制器是薄壳，故这里用【真的】AgreementsReadService + AgreementPublishWorkflowService
// 配行为化的内存 prisma——"生效日不足 30 天 → 400""非 PUBLISHED 不可快进 → 400"都是真服务抛出来的，
// "⚡快进两码分记且次序对"也是真读服务的 tickEffective 真记出来的，而不是 mock 事先编好的结果。
// 响应形状一律 Object.keys 全等（白名单封条：版本行的 id / createdAt 等内部列不许漏出去）。
// 权限登记用反射读控制器元数据，再与 rbac.catalog 的路由登记逐条对账——控制器挂的码、路径、方法
// 与 catalog 里登记的是不是同一条，由行为判，不扫源码文本。

type VersionRow = {
  id: string;
  versionKey: string;
  status: string;
  summary: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  pendingApprovalNo: string | null;
  createdAt: Date;
};

const DAY = 24 * 60 * 60 * 1000;
const PAST = new Date(Date.now() - 90 * DAY);

function fieldMatches(actual: any, cond: any): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('lte' in cond) return actual != null && actual.getTime() <= cond.lte.getTime();
    if ('in' in cond) return cond.in.includes(actual);
    throw new Error(`mock: unsupported where operator ${JSON.stringify(cond)}`);
  }
  return actual === cond;
}
const rowMatches = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => fieldMatches(row[k], v));

const row = (versionKey: string, status: string, effectiveAt: Date | null = null, pendingApprovalNo: string | null = null): VersionRow => ({
  id: `id-${versionKey}`,
  versionKey,
  status,
  summary: `summary of ${versionKey}`,
  effectiveAt,
  publishedAt: ['PUBLISHED', 'EFFECTIVE', 'SUPERSEDED'].includes(status) ? PAST : null,
  pendingApprovalNo,
  createdAt: PAST,
});

const ADMIN_REQ = { user: { type: 'ADMIN', userId: 'admin-uuid', userNo: 'ADM-COMPL', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] } };
const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'cust-uuid-1', userNo: 'CU250907001' } };

function makeHarness(versions: VersionRow[]) {
  const events: string[] = [];
  const prisma: any = {
    customerAgreementVersion: {
      findFirst: jest.fn(async ({ where }: any = {}) => versions.find((r) => rowMatches(r, where)) ?? null),
      findUnique: jest.fn(async ({ where }: any) => versions.find((r) => rowMatches(r, where)) ?? null),
      findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
        const hit = versions.filter((r) => rowMatches(r, where));
        const [[field]] = Object.entries(orderBy ?? { versionKey: 'asc' });
        return [...hit].sort((a: any, b: any) => String(a[field]).localeCompare(String(b[field])));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const target = versions.find((r) => rowMatches(r, where));
        if (!target) throw new Error('mock: update target not found');
        Object.assign(target, data);
        return target;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = versions.filter((r) => rowMatches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
    // 数组形态：各操作在构造时已按序执行，resolve 即"事务提交"。
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const auditLogs: any = {
    recordByActor: jest.fn(async (input: any) => { events.push(`actor:${input.action}`); return {}; }),
    recordSystem: jest.fn(async (input: any) => { events.push(`system:${input.action}`); return {}; }),
  };
  const approvalsService: any = {
    createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR-AGR-1' })),
    list: jest.fn(async () => ({ total: 0, items: [] })),
  };
  const notifications: any = { notifyAgreementPublished: jest.fn(async () => undefined) };
  return { prisma, auditLogs, approvalsService, notifications, events, versions };
}

async function buildController(h: ReturnType<typeof makeHarness>) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [AgreementsAdminController],
    providers: [
      AgreementsReadService,
      AgreementPublishWorkflowService,
      { provide: PrismaService, useValue: h.prisma },
      { provide: AuditLogsService, useValue: h.auditLogs },
      { provide: ApprovalsService, useValue: h.approvalsService },
      { provide: NotificationsService, useValue: h.notifications },
    ],
  }).compile();
  return module.get(AgreementsAdminController);
}

const LIST_ITEM_KEYS = ['effectiveAt', 'pendingApprovalNo', 'publishedAt', 'status', 'summary', 'versionKey'];
const DETAIL_KEYS = [...LIST_ITEM_KEYS, 'sections'].sort();

describe('AgreementsAdminController', () => {
  // ── 登记对账：控制器挂的权限码/路径/方法 ⇄ rbac.catalog 的 route() 登记 ──
  describe('权限登记与路由对账', () => {
    const CASES: Array<{ handler: keyof AgreementsAdminController; method: RequestMethod; httpMethod: string; path: string; groups: string[] }> = [
      { handler: 'list', method: RequestMethod.GET, httpMethod: 'GET', path: '/admin/customer-agreements', groups: ['COMPLIANCE_OFFICE_VIEW'] },
      { handler: 'detail', method: RequestMethod.GET, httpMethod: 'GET', path: '/admin/customer-agreements/:versionKey', groups: ['COMPLIANCE_OFFICE_VIEW'] },
      { handler: 'submitPublish', method: RequestMethod.POST, httpMethod: 'POST', path: '/admin/customer-agreements/:versionKey/submit-publish', groups: ['AGREEMENT_WRITE'] },
      // ⚡快进挂拨钟组（金库），不是提单组 AGREEMENT_WRITE——合规官不是自己的裁决人（spec §3）。
      { handler: 'simulateEffective', method: RequestMethod.POST, httpMethod: 'POST', path: '/admin/customer-agreements/:versionKey/simulate-effective', groups: ['DEMO_CLOCK_WRITE'] },
    ];

    it.each(CASES)('$handler：$httpMethod $path 的方法/路径/权限码与 catalog 登记是同一条，groups = $groups', ({ handler, method, httpMethod, path, groups }) => {
      const proto = AgreementsAdminController.prototype as any;
      const fn = proto[handler];

      expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(method);
      const controllerPath = Reflect.getMetadata(PATH_METADATA, AgreementsAdminController);
      const methodPath = Reflect.getMetadata(PATH_METADATA, fn);
      const composed = `/${[controllerPath, methodPath].filter((p) => p && p !== '/').join('/')}`;
      expect(composed).toBe(path);

      const code = buildPermissionCode(httpMethod, path);
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, fn)).toEqual([code]);

      const registered = RBAC_PERMISSION_DEFINITIONS.filter((d) => d.code === code);
      expect(registered).toHaveLength(1);
      expect(registered[0].method).toBe(httpMethod);
      expect(registered[0].path).toBe(path);
      expect(registered[0].groups).toEqual(groups);
    });

    it('类上挂 AdminPermissionGuard', () => {
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, AgreementsAdminController) ?? [];
      expect(guards).toContain(AdminPermissionGuard);
    });
  });

  describe('GET /admin/customer-agreements（列表）', () => {
    it('全部版本（含 DRAFT / 在途）按 versionKey 升序；每项键恰为六键，不含 sections / id / createdAt', async () => {
      const h = makeHarness([row('v2', 'PENDING_APPROVAL', new Date(Date.now() + 40 * DAY), 'APR-AGR-9'), row('v1', 'EFFECTIVE', PAST)]);
      const controller = await buildController(h);

      const out = await controller.list();

      expect(out.map((i) => i.versionKey)).toEqual(['v1', 'v2']);
      for (const item of out) expect(Object.keys(item).sort()).toEqual(LIST_ITEM_KEYS);
      expect(out[0]).toEqual({ versionKey: 'v1', status: 'EFFECTIVE', summary: 'summary of v1', effectiveAt: PAST, publishedAt: PAST, pendingApprovalNo: null });
      expect(out[1].status).toBe('PENDING_APPROVAL');
      expect(out[1].pendingApprovalNo).toBe('APR-AGR-9');
    });
  });

  describe('GET /admin/customer-agreements/:versionKey（详情）', () => {
    it('键恰为列表六键 + sections，正文取自代码登记处（只读）', async () => {
      const h = makeHarness([row('v1', 'EFFECTIVE', PAST), row('v2', 'DRAFT')]);
      const controller = await buildController(h);

      const out = await controller.detail('v2');

      expect(Object.keys(out).sort()).toEqual(DETAIL_KEYS);
      expect(out.versionKey).toBe('v2');
      expect(out.status).toBe('DRAFT');
      expect(out.sections).toBe(AGREEMENT_BODIES.v2);
    });

    it('查无此版本 → 404（真读服务抛出，控制器不吞）', async () => {
      const controller = await buildController(makeHarness([row('v1', 'EFFECTIVE', PAST)]));

      await expect(controller.detail('v9')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('POST /admin/customer-agreements/:versionKey/submit-publish', () => {
    it('DRAFT + effectiveAt=今天+31d：转调 workflow 开单，返回 {approvalNo}；actor 取自 token（userId/userNo/roleCodes），版本行翻 PENDING_APPROVAL', async () => {
      const h = makeHarness([row('v1', 'EFFECTIVE', PAST), row('v2', 'DRAFT')]);
      const controller = await buildController(h);
      const effectiveAt = new Date(Date.now() + 31 * DAY).toISOString();

      const out = await controller.submitPublish('v2', { effectiveAt }, ADMIN_REQ);

      expect(out).toEqual({ approvalNo: 'APR-AGR-1' });
      expect(h.approvalsService.createAndSubmit).toHaveBeenCalledTimes(1);
      const [createDto, , actor] = h.approvalsService.createAndSubmit.mock.calls[0];
      expect(createDto).toEqual(expect.objectContaining({ actionType: ApprovalActionTypes.AGREEMENT_PUBLISH, entityRef: 'v2' }));
      expect(actor).toEqual(expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-uuid', userNo: 'ADM-COMPL', roleCodes: ['COMPLIANCE_OFFICER'] }));
      expect(h.versions.find((r) => r.versionKey === 'v2')).toEqual(expect.objectContaining({ status: 'PENDING_APPROVAL', pendingApprovalNo: 'APR-AGR-1' }));
    });

    it('透传 400：生效日不足 30 天 → 真 workflow 抛 BadRequest，控制器不吞不改；零开单、版本行不动', async () => {
      const h = makeHarness([row('v1', 'EFFECTIVE', PAST), row('v2', 'DRAFT')]);
      const controller = await buildController(h);

      await expect(controller.submitPublish('v2', { effectiveAt: new Date(Date.now() + 10 * DAY).toISOString() }, ADMIN_REQ)).rejects.toBeInstanceOf(BadRequestException);

      expect(h.approvalsService.createAndSubmit).not.toHaveBeenCalled();
      expect(h.versions.find((r) => r.versionKey === 'v2')).toEqual(expect.objectContaining({ status: 'DRAFT', pendingApprovalNo: null }));
    });

    it('客户 token 打本端点 → 403，且不进 workflow（AdminPermissionGuard 对非 ADMIN 是 fail-open，本端点自己兜）', async () => {
      const h = makeHarness([row('v1', 'EFFECTIVE', PAST), row('v2', 'DRAFT')]);
      const controller = await buildController(h);

      await expect(controller.submitPublish('v2', { effectiveAt: new Date(Date.now() + 31 * DAY).toISOString() }, CUSTOMER_REQ)).rejects.toBeInstanceOf(ForbiddenException);

      expect(h.approvalsService.createAndSubmit).not.toHaveBeenCalled();
      expect(h.prisma.customerAgreementVersion.findUnique).not.toHaveBeenCalled();
    });

    it('body DTO：缺 effectiveAt / 非字符串 → ValidationPipe 400；带上即放行', async () => {
      const pipe = new ValidationPipe({ transform: true, whitelist: true });
      const meta = { type: 'body' as const, metatype: SubmitPublishBodyDto };

      await expect(pipe.transform({}, meta)).rejects.toBeInstanceOf(BadRequestException);
      await expect(pipe.transform({ effectiveAt: 123 }, meta)).rejects.toBeInstanceOf(BadRequestException);
      await expect(pipe.transform({ effectiveAt: '2026-12-01T00:00:00.000Z' }, meta)).resolves.toEqual({ effectiveAt: '2026-12-01T00:00:00.000Z' });
    });
  });

  describe('POST /admin/customer-agreements/:versionKey/simulate-effective（⚡）', () => {
    it('PUBLISHED v2：转调 workflow——v2 当场 EFFECTIVE、v1 退位；返回 {versionKey, effectiveAt}；审计两码分记：先 FASTFORWARDED（操作者）后 EFFECTIVE（system）', async () => {
      const h = makeHarness([row('v1', 'EFFECTIVE', PAST), row('v2', 'PUBLISHED', new Date(Date.now() + 40 * DAY))]);
      const controller = await buildController(h);

      const out = await controller.simulateEffective('v2', ADMIN_REQ);

      expect(Object.keys(out).sort()).toEqual(['effectiveAt', 'versionKey']);
      expect(out.versionKey).toBe('v2');
      expect(h.versions.find((r) => r.versionKey === 'v2')!.status).toBe('EFFECTIVE');
      expect(h.versions.find((r) => r.versionKey === 'v1')!.status).toBe('SUPERSEDED');
      expect(h.events).toEqual(['actor:AGREEMENT_FASTFORWARDED', 'system:AGREEMENT_EFFECTIVE']);
    });

    it.each(['DRAFT', 'PENDING_APPROVAL'])('%s 版不可快进 → 真 workflow 抛 400，行不动、零留痕', async (status) => {
      const h = makeHarness([row('v1', 'EFFECTIVE', PAST), row('v2', status)]);
      const controller = await buildController(h);

      await expect(controller.simulateEffective('v2', ADMIN_REQ)).rejects.toBeInstanceOf(BadRequestException);

      expect(h.versions.find((r) => r.versionKey === 'v2')!.status).toBe(status);
      expect(h.events).toEqual([]);
    });

    it('客户 token 打本端点 → 403，且不改任何版本行', async () => {
      const h = makeHarness([row('v1', 'EFFECTIVE', PAST), row('v2', 'PUBLISHED', new Date(Date.now() + 40 * DAY))]);
      const controller = await buildController(h);

      await expect(controller.simulateEffective('v2', CUSTOMER_REQ)).rejects.toBeInstanceOf(ForbiddenException);

      expect(h.prisma.customerAgreementVersion.updateMany).not.toHaveBeenCalled();
      expect(h.events).toEqual([]);
    });
  });
});
