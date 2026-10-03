// 战役丙波四 终审修 F1：DSR 办结 workflow 的行为测试（编排：assertResolvable → REVERIFY 才 issuer.issue →
// dsr.resolve(materialRequestNo) → notifyDsrResolved）。
// 从 dsr-requests.service.spec.ts 迁入的用例（断言强度不降）：REVERIFY 开单三条（含接真 issuer 的那条）、
// 非 REVERIFY 不碰 issuer、调用序、通知吞错、校验不过时下游全不发生。
// DsrRequestsService 用真类 + 行为化 mock（照主体 spec 的 mock 形态：findUnique/findMany 真按 where 过滤、
// update 真合并 data——mock 无视 where 会假绿）；issuer 替身按 input.customerId 去夹具里找客户、无
// sumsubApplicantId 即抛 400 NO_SUMSUB_APPLICANT，与真 MaterialRequestIssuerService.loadCustomer 同形。
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DsrRequestsService } from './dsr-requests.service';
import { DsrResolutionWorkflowService } from './dsr-resolution-workflow.service';
import { MaterialRequestIssuerService } from '../material-requests/material-request-issuer.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

const dpo: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-dpo', userNo: 'ADM-DPO', roleCodes: ['DPO'] };

function customerRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cust-uuid-1', customerNo: 'CU0001', email: 'henry@example.com',
    sumsubApplicantId: 'sumsub-applicant-1',
    ...over,
  };
}

function makeHarness(opts: {
  customers?: Array<Record<string, any>>;
  consents?: Array<Record<string, any>>;
  notifyThrows?: boolean;
} = {}) {
  const customers = opts.customers ?? [customerRow()];
  const consents = opts.consents ?? [
    { customerId: 'cust-uuid-1', customerNo: 'CU0001', versionKey: 'v1', action: 'ACCEPTED', actedAt: new Date('2026-08-01T08:00:00.000Z') },
  ];
  const rows: any[] = [];
  const order: string[] = [];

  const matches = (r: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(r[k]);
        if ('lt' in v) return r[k] < v.lt;
        if ('not' in v) return r[k] !== v.not;
        throw new Error(`mock: unsupported where operator on ${k}: ${JSON.stringify(v)}`);
      }
      return r[k] === v;
    });

  const prisma: any = {
    customerMain: {
      findUnique: jest.fn(async ({ where }: any) => customers.find((c) => Object.entries(where).every(([k, v]) => c[k] === v)) ?? null),
    },
    customerAgreementConsent: {
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        const out = consents.filter((c) => matches(c, where));
        if (orderBy?.actedAt === 'asc') out.sort((a, b) => a.actedAt.getTime() - b.actedAt.getTime());
        return out;
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const out = consents.filter((c) => matches(c, where));
        if (orderBy?.actedAt === 'desc') out.sort((a, b) => b.actedAt.getTime() - a.actedAt.getTime());
        return out[0] ?? null;
      }),
    },
    materialRequest: {
      findMany: jest.fn(async ({ where }: any) => [].filter((m) => matches(m, where))),
    },
    dataSubjectRequest: {
      create: jest.fn(async ({ data }: any) => {
        order.push('create');
        const row = { id: `dsr-uuid-${rows.length + 1}`, status: 'SUBMITTED', submittedAt: new Date(), reviewStartedAt: null, resolvedAt: null,
          resolutionCode: null, resolutionNote: null, clauseRef: null, summary: null, materialRequestNo: null, ...data };
        rows.push(row);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const r = rows.find((x) => matches(x, where));
        return r ? { ...r } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        order.push('update');
        const r = rows.find((x) => matches(x, where));
        if (!r) throw new Error('mock: update target not found');
        Object.assign(r, data);
        return { ...r };
      }),
    },
  };

  const auditLogs = {
    recordByActor: jest.fn(async (..._args: any[]) => { order.push('audit'); return {}; }),
    recordSystem: jest.fn(async () => ({})),
  };
  const notifications = {
    notifyDsrResolved: jest.fn(async (..._args: any[]) => {
      order.push('notify');
      if (opts.notifyThrows) throw new Error('notify boom');
    }),
  };
  const issuer = {
    issue: jest.fn(async (input: any) => {
      order.push('issue');
      const c = customers.find((x) => x.id === input.customerId);
      if (!c) throw new NotFoundException(`Customer not found: ${input.customerId}`);
      if (!c.sumsubApplicantId) {
        throw new BadRequestException({ code: 'NO_SUMSUB_APPLICANT', message: 'Customer has no Sumsub applicant; cannot create an applicant action' });
      }
      return { requestNo: 'MRQ2610030001', restrictionNo: null };
    }),
  };

  const dsr = new DsrRequestsService(prisma, auditLogs as any);
  const workflow = new DsrResolutionWorkflowService(dsr, issuer as any, notifications as any);
  const auditCalls = () => auditLogs.recordByActor.mock.calls.map((c) => ({ input: c[0] as any, actor: c[1] as any }));
  const actionsOf = () => auditCalls().map((c) => c.input.action);
  return { workflow, dsr, prisma, rows, auditLogs, notifications, issuer, order, auditCalls, actionsOf, customers, consents };
}

async function inReview(h: ReturnType<typeof makeHarness>, type: string) {
  const { requestNo } = await h.dsr.submit({ id: 'cust-uuid-1' }, { type, detail: 'Please help with my data' });
  await h.dsr.startReview(dpo, requestNo);
  return requestNo;
}

describe('DsrResolutionWorkflowService (丙波四终审修 F1)', () => {
  describe('RECTIFICATION_REVERIFY opens an Emirates ID material request', () => {
    it('calls issuer.issue exactly once (neutral reason citing the DSR number, no restriction) and writes materialRequestNo back; issue runs before the resolve write, notify last', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'RECTIFICATION');
      h.order.length = 0;
      await h.workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_REVERIFY', resolutionNote: 'Please re-verify your ID' });

      expect(h.issuer.issue).toHaveBeenCalledTimes(1);
      const arg = h.issuer.issue.mock.calls[0][0] as any;
      expect(arg).toMatchObject({
        customerId: 'cust-uuid-1', materialType: 'EMIRATES_ID', orderDomain: null, orderRef: null,
        restrict: false, origin: 'OPERATOR_ISSUED', issuedBy: 'ADM-DPO', actor: dpo,
      });
      expect(arg.reason).toContain(requestNo);
      expect(h.rows[0]).toMatchObject({ status: 'RESOLVED', resolutionCode: 'RECTIFICATION_REVERIFY', materialRequestNo: 'MRQ2610030001' });
      expect(h.order).toEqual(['issue', 'update', 'audit', 'notify']);
      // 跨主体协作在留痕里查得到：DSR_RESOLVED 的 metadata 带上开出的材料请求号。
      const call = h.auditCalls().find((c) => c.input.action === 'DSR_RESOLVED')!;
      expect(call.input.metadata).toMatchObject({ resolutionCode: 'RECTIFICATION_REVERIFY', materialRequestNo: 'MRQ2610030001' });
      expect(h.notifications.notifyDsrResolved).toHaveBeenCalledWith({ customerId: 'cust-uuid-1', requestNo });
    });

    it('400s and leaves the request IN_REVIEW (nothing resolved, audited or notified) when the customer has no Sumsub applicant', async () => {
      const h = makeHarness({ customers: [customerRow({ sumsubApplicantId: null })] });
      const requestNo = await inReview(h, 'RECTIFICATION');
      h.auditLogs.recordByActor.mockClear();
      const updatesBefore = h.prisma.dataSubjectRequest.update.mock.calls.length;
      const err = await h.workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_REVERIFY', resolutionNote: 'x' }).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'NO_SUMSUB_APPLICANT' });
      expect(h.issuer.issue).toHaveBeenCalledTimes(1);
      expect(h.rows[0]).toMatchObject({ status: 'IN_REVIEW', resolutionCode: null, resolvedAt: null, materialRequestNo: null });
      expect(h.prisma.dataSubjectRequest.update.mock.calls).toHaveLength(updatesBefore);
      expect(h.auditLogs.recordByActor).not.toHaveBeenCalled();
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });

    it('with the REAL issuer wired in, a customer without a Sumsub applicant still 400s before anything is persisted (the 400 comes from real code, not from the stand-in)', async () => {
      const h = makeHarness({ customers: [customerRow({ sumsubApplicantId: null })] });
      const sumsub = { createApplicantAction: jest.fn() };
      const requests = { create: jest.fn() };
      const realIssuer = new MaterialRequestIssuerService(
        { customerMain: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'cust-uuid-1' ? customerRow({ sumsubApplicantId: null }) : null)) } } as any,
        requests as any, {} as any, sumsub as any,
        { getMaterialConfig: jest.fn(() => ({ sumsubActionLevelName: 'wave3-action-id-refresh' })) } as any,
      );
      const workflow = new DsrResolutionWorkflowService(h.dsr, realIssuer, h.notifications as any);
      const requestNo = await inReview(h, 'RECTIFICATION');

      const err = await workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_REVERIFY', resolutionNote: 'x' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'NO_SUMSUB_APPLICANT' });
      expect(sumsub.createApplicantAction).not.toHaveBeenCalled();
      expect(requests.create).not.toHaveBeenCalled();
      expect(h.rows[0]).toMatchObject({ status: 'IN_REVIEW', materialRequestNo: null });
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });

    it.each([['ACCESS', 'ACCESS_SUMMARY_PROVIDED'], ['ERASURE', 'ERASURE_REFUSED_RETENTION'], ['RECTIFICATION', 'RECTIFICATION_SELF_SERVICE']])(
      'a %s resolution (%s) never touches the issuer and leaves materialRequestNo empty', async (type, code) => {
        const h = makeHarness();
        const requestNo = await inReview(h, type);
        if (type === 'ACCESS') await h.dsr.generateSummary(dpo, requestNo);
        await h.workflow.resolve(dpo, requestNo, { resolutionCode: code, resolutionNote: 'ok' });
        expect(h.issuer.issue).not.toHaveBeenCalled();
        expect(h.rows[0]).toMatchObject({ status: 'RESOLVED', resolutionCode: code, materialRequestNo: null });
      },
    );
  });

  // 次序是控制器裁定：校验在开单之前。校验不过 → 不开单（否则留一张悬空材料单）、不落、不审、不通知。
  describe('validation runs before the issuer (no dangling material request when the resolve itself cannot go through)', () => {
    it('ACCESS resolved with REVERIFY (code×type mismatch) 400s without calling the issuer', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'ACCESS');
      await expect(h.workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_REVERIFY', resolutionNote: 'x' })).rejects.toThrow(BadRequestException);
      expect(h.issuer.issue).not.toHaveBeenCalled();
      expect(h.rows[0]).toMatchObject({ status: 'IN_REVIEW', resolutionCode: null, materialRequestNo: null });
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });

    it('an already RESOLVED request cannot be resolved with REVERIFY again: INVALID_TRANSITION, issuer untouched, nothing new audited or notified', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'RECTIFICATION');
      await h.workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_SELF_SERVICE', resolutionNote: 'ok' });
      const auditCount = h.actionsOf().length;
      h.notifications.notifyDsrResolved.mockClear();

      const err = await h.workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_REVERIFY', resolutionNote: 'again' }).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'INVALID_TRANSITION' });
      expect(h.issuer.issue).not.toHaveBeenCalled();
      expect(h.rows[0].resolutionCode).toBe('RECTIFICATION_SELF_SERVICE');
      expect(h.actionsOf()).toHaveLength(auditCount);
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });

    it('SUBMITTED→RESOLVED direct jump 400s with INVALID_TRANSITION: nothing persisted, audited, issued or notified', async () => {
      const h = makeHarness();
      const { requestNo } = await h.dsr.submit({ id: 'cust-uuid-1' }, { type: 'RECTIFICATION', detail: 'd' });
      const before = h.actionsOf().length;
      const err = await h.workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_REVERIFY', resolutionNote: 'x' }).catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'INVALID_TRANSITION' });
      expect(h.rows[0]).toMatchObject({ status: 'SUBMITTED', resolvedAt: null });
      expect(h.actionsOf()).toHaveLength(before);
      expect(h.issuer.issue).not.toHaveBeenCalled();
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });

    it('ACCESS without a generated summary and ERASURE with no accepted agreement 400 (subject-side gates run through the workflow) with no downstream effect', async () => {
      const h = makeHarness({ consents: [] });
      const acc = await inReview(h, 'ACCESS');
      await expect(h.workflow.resolve(dpo, acc, { resolutionCode: 'ACCESS_SUMMARY_PROVIDED', resolutionNote: 'x' })).rejects.toThrow(/summary/i);
      const era = await inReview(h, 'ERASURE');
      await expect(h.workflow.resolve(dpo, era, { resolutionCode: 'ERASURE_REFUSED_RETENTION', resolutionNote: 'x' })).rejects.toThrow(BadRequestException);
      expect(h.rows.map((r) => r.status)).toEqual(['IN_REVIEW', 'IN_REVIEW']);
      expect(h.issuer.issue).not.toHaveBeenCalled();
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });
  });

  describe('persistence, audit, notification', () => {
    it('persists first, audits DSR_RESOLVED, and only then notifies the customer', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'RECTIFICATION');
      h.order.length = 0;
      const r = await h.workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_SELF_SERVICE', resolutionNote: 'Edit your phone in Profile' });

      expect(r).toEqual({ requestNo });
      expect(h.order).toEqual(['update', 'audit', 'notify']);
      const call = h.auditCalls().find((c) => c.input.action === 'DSR_RESOLVED')!;
      expect(call.input).toMatchObject({ requestNo, requestId: requestNo, fromStatus: 'IN_REVIEW', toStatus: 'RESOLVED' });
      expect(h.notifications.notifyDsrResolved).toHaveBeenCalledWith({ customerId: 'cust-uuid-1', requestNo });
    });

    it('a throwing notification does not undo or fail the resolve (swallowed)', async () => {
      const h = makeHarness({ notifyThrows: true });
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const requestNo = await inReview(h, 'RECTIFICATION');
        await expect(h.workflow.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_SELF_SERVICE', resolutionNote: 'ok' }))
          .resolves.toEqual({ requestNo });
        expect(h.rows[0].status).toBe('RESOLVED');
        expect(h.actionsOf()).toContain('DSR_RESOLVED');
        expect(h.notifications.notifyDsrResolved).toHaveBeenCalledTimes(1);
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
    });
  });
});
