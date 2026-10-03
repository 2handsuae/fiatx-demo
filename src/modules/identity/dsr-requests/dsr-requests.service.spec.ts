// 战役丙波四 T5：DSR 主体服务。
// 全部 mock 走行为化（照波一判例「mock 无视 where 会假绿」）：
//   - dataSubjectRequest.create/findUnique/update/findMany 落进内存表，findMany 真按 where（type/status/
//     customerId/dueAt<lt）过滤，update 真合并 data；
//   - customerMain 夹具带 riskRating/eddRequired/hardLineDispositionedAt 金丝雀值，且 mock 忽略 select
//     整行吐出——摘要白名单必须由服务自己挑字段，不能靠"查询恰好只取了这几列"侥幸成立；
//   - customerAgreementConsent / materialRequest 真按 customerId 过滤，materialRequest 夹具带
//     reason/applicantActionId 等不该入摘要的列。
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DsrRequestsService } from './dsr-requests.service';
import { DSR_SUMMARY_PROFILE_FIELDS } from './dsr.constants';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

const dpo: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-dpo', userNo: 'ADM-DPO', roleCodes: ['DPO'] };
const treasury: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-tr', userNo: 'ADM-TR', roleCodes: ['TREASURY_OFFICER'] };

const CANARY_RISK = 'RISK_CANARY_HIGH';
const CANARY_HARDLINE = '2026-01-01T00:00:00.000Z';

function customerRow(over: Record<string, unknown> = {}) {
  return {
    id: 'cust-uuid-1', customerNo: 'CU0001', email: 'henry@example.com', phone: '+971500000001',
    firstName: 'Henry', lastName: 'Lau', companyName: null,
    dateOfBirth: '1990-05-01', nationality: 'AE', idDocType: 'EMIRATES_ID', idDocNumber: '784-1990-1234567-1',
    residentialAddress: 'Dubai Marina, Dubai',
    tradingTier: 'BASIC', lifecycle: 'ACTIVE', onboardingApprovedAt: new Date('2026-08-01T08:00:00.000Z'),
    // 以下六个是内部合规判断，绝不能进摘要
    riskRating: CANARY_RISK, eddRequired: true, hardLineDispositionedAt: new Date(CANARY_HARDLINE),
    sumsubApplicantId: 'sumsub-secret-applicant', sumsubCurrentLevelName: 'level-secret', riskRatingUpdatedAt: new Date(),
    ...over,
  };
}

function makeHarness(opts: {
  customers?: Array<Record<string, any>>;
  consents?: Array<Record<string, any>>;
  materials?: Array<Record<string, any>>;
  notifyThrows?: boolean;
} = {}) {
  const customers = opts.customers ?? [customerRow()];
  const consents = opts.consents ?? [
    { customerId: 'cust-uuid-1', customerNo: 'CU0001', versionKey: 'v1', action: 'ACCEPTED', actedAt: new Date('2026-08-01T08:00:00.000Z') },
  ];
  const materials = opts.materials ?? [];
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
      findMany: jest.fn(async ({ where }: any = {}) => customers.filter((c) => matches(c, where))),
    },
    customerAgreementConsent: {
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        const out = consents.filter((c) => matches(c, where));
        if (orderBy?.actedAt === 'desc') out.sort((a, b) => b.actedAt.getTime() - a.actedAt.getTime());
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
      findMany: jest.fn(async ({ where }: any) => materials.filter((m) => matches(m, where))),
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
      findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r }))),
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

  const service = new DsrRequestsService(prisma, auditLogs as any, notifications as any);
  const auditCalls = () => auditLogs.recordByActor.mock.calls.map((c) => ({ input: c[0] as any, actor: c[1] as any }));
  const actionsOf = () => auditCalls().map((c) => c.input.action);
  return { service, prisma, rows, auditLogs, notifications, order, auditCalls, actionsOf, consents, materials };
}

async function submitted(h: ReturnType<typeof makeHarness>, type = 'ACCESS') {
  const { requestNo } = await h.service.submit({ id: 'cust-uuid-1' }, { type, detail: 'Please show me what you hold about me' });
  return requestNo;
}
async function inReview(h: ReturnType<typeof makeHarness>, type = 'ACCESS') {
  const requestNo = await submitted(h, type);
  await h.service.startReview(dpo, requestNo);
  return requestNo;
}

async function expectInvalidTransition(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toThrow(BadRequestException);
  await p.catch((e: BadRequestException) => {
    expect(e.getResponse()).toMatchObject({ code: 'INVALID_TRANSITION' });
  });
}

describe('DsrRequestsService (丙波四 T5)', () => {
  describe('submit', () => {
    it('opens SUBMITTED with dueAt = submittedAt + 30 natural days, DSR- business key, and a DSR_SUBMITTED audit by the customer', async () => {
      const h = makeHarness();
      const { requestNo } = await h.service.submit({ id: 'cust-uuid-1' }, { type: 'RECTIFICATION', detail: 'My ID number is wrong' });
      expect(requestNo).toMatch(/^DSR\d{12}$/);

      const row = h.rows[0];
      expect(row.requestNo).toBe(requestNo);
      expect(row.customerId).toBe('cust-uuid-1');
      expect(row.status).toBe('SUBMITTED');
      expect(row.type).toBe('RECTIFICATION');
      expect(row.detail).toBe('My ID number is wrong');
      expect(row.dueAt.getTime()).toBe(row.submittedAt.getTime() + 30 * 86400000);

      expect(h.actionsOf()).toEqual(['DSR_SUBMITTED']);
      const { input, actor } = h.auditCalls()[0];
      expect(input).toMatchObject({
        actionDomain: 'GOVERNANCE', primarySubjectType: 'DSR_REQUEST', primarySubjectNo: requestNo,
        requestNo, type: 'RECTIFICATION', ownerCustomerNo: 'CU0001',
      });
      expect(input.requestId).toEqual(expect.stringContaining(requestNo));
      expect(input.subjects).toEqual([
        { subjectType: 'DSR_REQUEST', subjectNo: requestNo, subjectRole: 'PRIMARY' },
        { subjectType: 'CUSTOMER', subjectNo: 'CU0001', subjectRole: 'OWNER' },
      ]);
      expect(actor).toMatchObject({ actorType: 'CUSTOMER', actorNo: 'CU0001' });
    });

    it('does not notify on submit (the customer\'s own action)', async () => {
      const h = makeHarness();
      await submitted(h);
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });
  });

  describe('startReview', () => {
    it('moves SUBMITTED→IN_REVIEW, stamps reviewStartedAt, audits DSR_REVIEW_STARTED by the DPO with from/to status', async () => {
      const h = makeHarness();
      const requestNo = await submitted(h);
      const r = await h.service.startReview(dpo, requestNo);
      expect(r).toEqual({ requestNo });

      expect(h.rows[0].status).toBe('IN_REVIEW');
      expect(h.rows[0].reviewStartedAt).toBeInstanceOf(Date);
      const call = h.auditCalls().find((c) => c.input.action === 'DSR_REVIEW_STARTED')!;
      expect(call.input).toMatchObject({ requestNo, fromStatus: 'SUBMITTED', toStatus: 'IN_REVIEW', primarySubjectNo: requestNo });
      expect(call.actor).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-DPO', actorRolesAtTime: ['DPO'] });
    });

    it('rejects starting review twice (IN_REVIEW→IN_REVIEW is not an edge)', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h);
      await expectInvalidTransition(h.service.startReview(dpo, requestNo));
    });

    it('404s on an unknown requestNo', async () => {
      const h = makeHarness();
      await expect(h.service.startReview(dpo, 'DSR000000000000')).rejects.toThrow(NotFoundException);
    });
  });

  describe('state machine', () => {
    it('rejects SUBMITTED→RESOLVED direct jump with 400 code INVALID_TRANSITION; nothing persisted, audited or notified', async () => {
      const h = makeHarness();
      const requestNo = await submitted(h);
      const before = h.actionsOf().length;
      await expectInvalidTransition(h.service.resolve(dpo, requestNo, {
        resolutionCode: 'ACCESS_SUMMARY_PROVIDED', resolutionNote: 'Here is your data',
      }));
      expect(h.rows[0].status).toBe('SUBMITTED');
      expect(h.rows[0].resolvedAt).toBeNull();
      expect(h.actionsOf()).toHaveLength(before);
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });

    it('every write action is rejected 400 once RESOLVED (resolve again / start-review / generate-summary / ⚡)', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'RECTIFICATION');
      await h.service.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_SELF_SERVICE', resolutionNote: 'Use Profile > phone' });
      expect(h.rows[0].status).toBe('RESOLVED');
      const resolvedAt = h.rows[0].resolvedAt;
      const dueAt = h.rows[0].dueAt;
      const auditCount = h.actionsOf().length;

      await expectInvalidTransition(h.service.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_REVERIFY', resolutionNote: 'again' }));
      await expectInvalidTransition(h.service.startReview(dpo, requestNo));
      await expect(h.service.generateSummary(dpo, requestNo)).rejects.toThrow(BadRequestException);
      await expect(h.service.simulateTimeout(treasury, requestNo)).rejects.toThrow(BadRequestException);

      expect(h.rows[0].resolvedAt).toBe(resolvedAt);
      expect(h.rows[0].dueAt).toBe(dueAt);
      expect(h.rows[0].resolutionCode).toBe('RECTIFICATION_SELF_SERVICE');
      expect(h.actionsOf()).toHaveLength(auditCount);
    });
  });

  describe('resolve · resolutionCode × type', () => {
    it.each([
      ['ACCESS', 'RECTIFICATION_REVERIFY'],
      ['ACCESS', 'ERASURE_REFUSED_RETENTION'],
      ['RECTIFICATION', 'ACCESS_SUMMARY_PROVIDED'],
      ['RECTIFICATION', 'ERASURE_REFUSED_RETENTION'],
      ['ERASURE', 'ACCESS_SUMMARY_PROVIDED'],
      ['ERASURE', 'RECTIFICATION_SELF_SERVICE'],
    ])('rejects %s resolved with %s (400), row stays IN_REVIEW', async (type, code) => {
      const h = makeHarness();
      const requestNo = await inReview(h, type);
      await expect(h.service.resolve(dpo, requestNo, { resolutionCode: code, resolutionNote: 'x' })).rejects.toThrow(BadRequestException);
      expect(h.rows[0].status).toBe('IN_REVIEW');
      expect(h.rows[0].resolutionCode).toBeNull();
      expect(h.notifications.notifyDsrResolved).not.toHaveBeenCalled();
    });

    it('accepts both RECTIFICATION outcomes; REVERIFY leaves materialRequestNo empty (T8 fills it) and still resolves', async () => {
      for (const code of ['RECTIFICATION_REVERIFY', 'RECTIFICATION_SELF_SERVICE']) {
        const h = makeHarness();
        const requestNo = await inReview(h, 'RECTIFICATION');
        await h.service.resolve(dpo, requestNo, { resolutionCode: code, resolutionNote: 'ok' });
        expect(h.rows[0]).toMatchObject({ status: 'RESOLVED', resolutionCode: code, resolutionNote: 'ok', materialRequestNo: null });
        expect(h.rows[0].resolvedAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('generateSummary', () => {
    it('writes only whitelisted profile fields — riskRating/eddRequired/hardLine/sumsub canaries never appear (reverse assertion)', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h);
      await h.service.generateSummary(dpo, requestNo);

      const raw: string = h.rows[0].summary;
      const summary = JSON.parse(raw);
      expect(Object.keys(summary.profile).sort()).toEqual([...DSR_SUMMARY_PROFILE_FIELDS].sort());
      expect(summary.profile).toMatchObject({
        customerNo: 'CU0001', firstName: 'Henry', lastName: 'Lau', companyName: null, email: 'henry@example.com',
        phone: '+971500000001', dateOfBirth: '1990-05-01', nationality: 'AE', idDocType: 'EMIRATES_ID',
        idDocNumber: '784-1990-1234567-1', residentialAddress: 'Dubai Marina, Dubai',
        tradingTier: 'BASIC', lifecycle: 'ACTIVE', onboardingApprovedAt: '2026-08-01T08:00:00.000Z',
      });

      for (const banned of ['riskRating', 'eddRequired', 'hardLine', 'hardLineDispositionedAt', 'sumsub', 'riskRatingUpdatedAt',
        CANARY_RISK, CANARY_HARDLINE, 'sumsub-secret-applicant', 'level-secret', 'restriction', 'tag']) {
        expect(raw).not.toContain(banned);
      }
    });

    it('also freezes the full consent history (ACCEPTED and DECLINED) and the KYC material list as {materialType,status,issuedAt} only', async () => {
      const h = makeHarness({
        consents: [
          { customerId: 'cust-uuid-1', customerNo: 'CU0001', versionKey: 'v1', action: 'ACCEPTED', actedAt: new Date('2026-08-01T08:00:00.000Z') },
          { customerId: 'cust-uuid-1', customerNo: 'CU0001', versionKey: 'v2', action: 'DECLINED', actedAt: new Date('2026-09-01T08:00:00.000Z') },
          { customerId: 'cust-uuid-OTHER', customerNo: 'CU9999', versionKey: 'v1', action: 'ACCEPTED', actedAt: new Date('2026-08-02T08:00:00.000Z') },
        ],
        materials: [
          { customerId: 'cust-uuid-1', materialType: 'EMIRATES_ID', status: 'PENDING_SUBMISSION', issuedAt: new Date('2026-09-02T08:00:00.000Z'),
            reason: 'internal-reason-text', applicantActionId: 'secret-action-id', externalActionId: 'secret-ext', restrictionNo: 'RST-1' },
          { customerId: 'cust-uuid-OTHER', materialType: 'PROOF_OF_ADDRESS', status: 'GREEN', issuedAt: new Date('2026-09-03T08:00:00.000Z') },
        ],
      });
      const requestNo = await inReview(h);
      await h.service.generateSummary(dpo, requestNo);

      const raw: string = h.rows[0].summary;
      const summary = JSON.parse(raw);
      expect(summary.agreementConsents).toEqual([
        { versionKey: 'v1', actedAt: '2026-08-01T08:00:00.000Z', decision: 'ACCEPTED' },
        { versionKey: 'v2', actedAt: '2026-09-01T08:00:00.000Z', decision: 'DECLINED' },
      ]);
      expect(summary.kycMaterials).toEqual([
        { materialType: 'EMIRATES_ID', status: 'PENDING_SUBMISSION', issuedAt: '2026-09-02T08:00:00.000Z' },
      ]);
      for (const banned of ['internal-reason-text', 'secret-action-id', 'secret-ext', 'RST-1', 'CU9999', 'PROOF_OF_ADDRESS']) {
        expect(raw).not.toContain(banned);
      }
      expect(typeof summary.generatedAt).toBe('string');
    });

    it('audits DSR_SUMMARY_GENERATED by the DPO', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h);
      await h.service.generateSummary(dpo, requestNo);
      const call = h.auditCalls().find((c) => c.input.action === 'DSR_SUMMARY_GENERATED')!;
      expect(call.input).toMatchObject({ requestNo, primarySubjectNo: requestNo, ownerCustomerNo: 'CU0001' });
      expect(call.actor).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-DPO' });
    });

    it('is ACCESS-only, IN_REVIEW-only and write-once (400s, snapshot never rewritten)', async () => {
      const h = makeHarness();
      const rect = await inReview(h, 'RECTIFICATION');
      await expect(h.service.generateSummary(dpo, rect)).rejects.toThrow(/ACCESS/);

      const fresh = await submitted(h, 'ACCESS');
      await expect(h.service.generateSummary(dpo, fresh)).rejects.toThrow(BadRequestException);
      expect(h.rows.find((r) => r.requestNo === fresh)!.summary).toBeNull();

      const access = await inReview(h, 'ACCESS');
      await h.service.generateSummary(dpo, access);
      const first = h.rows.find((r) => r.requestNo === access)!.summary;
      h.consents.push({ customerId: 'cust-uuid-1', customerNo: 'CU0001', versionKey: 'v2', action: 'ACCEPTED', actedAt: new Date() });
      await expect(h.service.generateSummary(dpo, access)).rejects.toThrow(BadRequestException);
      expect(h.rows.find((r) => r.requestNo === access)!.summary).toBe(first);
      expect(h.actionsOf().filter((a) => a === 'DSR_SUMMARY_GENERATED')).toHaveLength(1);
    });
  });

  describe('resolve · ACCESS', () => {
    it('requires the summary to have been generated first (400), then resolves once it exists', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'ACCESS');
      await expect(h.service.resolve(dpo, requestNo, { resolutionCode: 'ACCESS_SUMMARY_PROVIDED', resolutionNote: 'See attached' }))
        .rejects.toThrow(/summary/i);
      expect(h.rows[0].status).toBe('IN_REVIEW');

      await h.service.generateSummary(dpo, requestNo);
      await h.service.resolve(dpo, requestNo, { resolutionCode: 'ACCESS_SUMMARY_PROVIDED', resolutionNote: 'See attached' });
      expect(h.rows[0]).toMatchObject({ status: 'RESOLVED', resolutionCode: 'ACCESS_SUMMARY_PROVIDED', clauseRef: null });
    });
  });

  describe('resolve · ERASURE_REFUSED_RETENTION', () => {
    it('fills clauseRef from the customer\'s latest ACCEPTED agreement version + section VI (a later DECLINED row is not a consent)', async () => {
      const h = makeHarness({
        consents: [
          { customerId: 'cust-uuid-1', customerNo: 'CU0001', versionKey: 'v1', action: 'ACCEPTED', actedAt: new Date('2026-08-01T08:00:00.000Z') },
          { customerId: 'cust-uuid-1', customerNo: 'CU0001', versionKey: 'v2', action: 'ACCEPTED', actedAt: new Date('2026-09-01T08:00:00.000Z') },
          { customerId: 'cust-uuid-1', customerNo: 'CU0001', versionKey: 'v3', action: 'DECLINED', actedAt: new Date('2026-09-20T08:00:00.000Z') },
          { customerId: 'cust-uuid-OTHER', customerNo: 'CU9999', versionKey: 'v9', action: 'ACCEPTED', actedAt: new Date('2026-09-25T08:00:00.000Z') },
        ],
      });
      const requestNo = await inReview(h, 'ERASURE');
      await h.service.resolve(dpo, requestNo, { resolutionCode: 'ERASURE_REFUSED_RETENTION', resolutionNote: 'Records must be retained' });
      expect(JSON.parse(h.rows[0].clauseRef)).toEqual({ versionKey: 'v2', section: 'VI' });
      expect(h.rows[0].status).toBe('RESOLVED');
    });

    it('400s (and stays IN_REVIEW) when the customer has no accepted agreement version to cite', async () => {
      const h = makeHarness({ consents: [] });
      const requestNo = await inReview(h, 'ERASURE');
      await expect(h.service.resolve(dpo, requestNo, { resolutionCode: 'ERASURE_REFUSED_RETENTION', resolutionNote: 'x' }))
        .rejects.toThrow(BadRequestException);
      expect(h.rows[0].status).toBe('IN_REVIEW');
    });
  });

  describe('resolve · persistence, audit, notification', () => {
    it('persists first, audits DSR_RESOLVED (requestId = requestNo, resolutionCode on the envelope), and only then notifies the customer', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'RECTIFICATION');
      h.order.length = 0;
      await h.service.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_SELF_SERVICE', resolutionNote: 'Edit your phone in Profile' });

      expect(h.order).toEqual(['update', 'audit', 'notify']);
      const call = h.auditCalls().find((c) => c.input.action === 'DSR_RESOLVED')!;
      expect(call.input).toMatchObject({
        requestNo, resolutionCode: 'RECTIFICATION_SELF_SERVICE', requestId: requestNo,
        fromStatus: 'IN_REVIEW', toStatus: 'RESOLVED', ownerCustomerNo: 'CU0001',
      });
      expect(call.actor).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-DPO' });
      expect(h.notifications.notifyDsrResolved).toHaveBeenCalledWith({ customerId: 'cust-uuid-1', requestNo });
    });

    it('a throwing notification does not undo or fail the resolve (swallowed)', async () => {
      const h = makeHarness({ notifyThrows: true });
      const requestNo = await inReview(h, 'RECTIFICATION');
      await expect(h.service.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_SELF_SERVICE', resolutionNote: 'ok' }))
        .resolves.toEqual({ requestNo });
      expect(h.rows[0].status).toBe('RESOLVED');
      expect(h.actionsOf()).toContain('DSR_RESOLVED');
      expect(h.notifications.notifyDsrResolved).toHaveBeenCalledTimes(1);
    });
  });

  describe('simulateTimeout (⚡)', () => {
    it('rewinds dueAt to now−1h on a live request and audits DSR_DEADLINE_FASTFORWARDED by the operator', async () => {
      const h = makeHarness();
      const requestNo = await submitted(h);
      const before = Date.now();
      await h.service.simulateTimeout(treasury, requestNo);
      const after = Date.now();

      const dueAt: Date = h.rows[0].dueAt;
      expect(dueAt.getTime()).toBeGreaterThanOrEqual(before - 3600 * 1000);
      expect(dueAt.getTime()).toBeLessThanOrEqual(after - 3600 * 1000);
      expect(h.rows[0].status).toBe('SUBMITTED');

      const call = h.auditCalls().find((c) => c.input.action === 'DSR_DEADLINE_FASTFORWARDED')!;
      expect(call.input).toMatchObject({ requestNo, primarySubjectNo: requestNo, ownerCustomerNo: 'CU0001' });
      expect(call.actor).toMatchObject({ actorType: 'ADMIN', actorNo: 'ADM-TR' });
    });

    it('works on IN_REVIEW too, and each ⚡ gets its own audit requestId (a repeat is not swallowed by the idempotency key)', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h);
      await h.service.simulateTimeout(treasury, requestNo);
      await h.service.simulateTimeout(treasury, requestNo);
      const ids = h.auditCalls().filter((c) => c.input.action === 'DSR_DEADLINE_FASTFORWARDED').map((c) => c.input.requestId);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      ids.forEach((id) => expect(id).toEqual(expect.stringContaining(requestNo)));
    });

    it('400s on a RESOLVED request (terminal) and leaves dueAt alone', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'RECTIFICATION');
      await h.service.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_SELF_SERVICE', resolutionNote: 'ok' });
      const dueAt = h.rows[0].dueAt;
      await expect(h.service.simulateTimeout(treasury, requestNo)).rejects.toThrow(BadRequestException);
      expect(h.rows[0].dueAt).toBe(dueAt);
    });
  });

  describe('reads', () => {
    async function seedMany(h: ReturnType<typeof makeHarness>) {
      const a = await submitted(h, 'ACCESS');           // SUBMITTED, 将被拨逾期
      const b = await inReview(h, 'RECTIFICATION');     // IN_REVIEW
      const c = await inReview(h, 'ERASURE');
      await h.service.resolve(dpo, c, { resolutionCode: 'ERASURE_REFUSED_RETENTION', resolutionNote: 'Retention applies' });
      await h.service.simulateTimeout(treasury, a);
      return { a, b, c };
    }

    it('listAdmin filters by type / status / overdue against real rows, and projects business keys only (customerNo, never ids)', async () => {
      const h = makeHarness();
      const { a, b, c } = await seedMany(h);

      const all = await h.service.listAdmin({});
      expect(all.map((r) => r.requestNo).sort()).toEqual([a, b, c].sort());
      all.forEach((r) => {
        expect(r.customerNo).toBe('CU0001');
        expect(r).not.toHaveProperty('id');
        expect(r).not.toHaveProperty('customerId');
      });
      expect((await h.service.listAdmin({ type: 'ERASURE' })).map((r) => r.requestNo)).toEqual([c]);
      expect((await h.service.listAdmin({ status: 'IN_REVIEW' })).map((r) => r.requestNo)).toEqual([b]);
      expect((await h.service.listAdmin({ overdue: true })).map((r) => r.requestNo)).toEqual([a]);
      expect(await h.service.listAdmin({ type: 'ACCESS', status: 'RESOLVED' })).toEqual([]);
    });

    it('a RESOLVED request is never overdue even if its dueAt lies in the past', async () => {
      const h = makeHarness();
      const requestNo = await inReview(h, 'RECTIFICATION');
      h.rows[0].dueAt = new Date(Date.now() - 86400000);
      await h.service.resolve(dpo, requestNo, { resolutionCode: 'RECTIFICATION_SELF_SERVICE', resolutionNote: 'ok' });
      expect(await h.service.listAdmin({ overdue: true })).toEqual([]);
    });

    it('detailAdmin returns parsed summary / clauseRef plus customerNo, no ids; 404 on unknown', async () => {
      const h = makeHarness();
      const acc = await inReview(h, 'ACCESS');
      await h.service.generateSummary(dpo, acc);
      const d = await h.service.detailAdmin(acc);
      expect(d).toMatchObject({ requestNo: acc, customerNo: 'CU0001', type: 'ACCESS', status: 'IN_REVIEW' });
      expect((d.summary as any).profile.customerNo).toBe('CU0001');
      expect(d).not.toHaveProperty('id');
      expect(d).not.toHaveProperty('customerId');

      const era = await inReview(h, 'ERASURE');
      await h.service.resolve(dpo, era, { resolutionCode: 'ERASURE_REFUSED_RETENTION', resolutionNote: 'Retention applies' });
      expect((await h.service.detailAdmin(era)).clauseRef).toEqual({ versionKey: 'v1', section: 'VI' });

      await expect(h.service.detailAdmin('DSR000000000000')).rejects.toThrow(NotFoundException);
    });

    it('listForCustomer returns only the caller\'s own requests in the client projection: no dueAt / materialRequestNo / ids, summary & clauseRef parsed', async () => {
      const h = makeHarness({ customers: [customerRow(), customerRow({ id: 'cust-uuid-2', customerNo: 'CU0002', email: 'x@example.com', phone: '+971500000002' })] });
      const mine = await inReview(h, 'ERASURE');
      await h.service.resolve(dpo, mine, { resolutionCode: 'ERASURE_REFUSED_RETENTION', resolutionNote: 'Retention applies' });
      await h.service.submit({ id: 'cust-uuid-2' }, { type: 'ACCESS', detail: 'someone else' });

      const list = await h.service.listForCustomer('cust-uuid-1');
      expect(list).toHaveLength(1);
      const row = list[0] as any;
      expect(row).toMatchObject({
        requestNo: mine, type: 'ERASURE', status: 'RESOLVED', resolutionCode: 'ERASURE_REFUSED_RETENTION',
        resolutionNote: 'Retention applies', clauseRef: { versionKey: 'v1', section: 'VI' }, summary: null,
      });
      for (const banned of ['dueAt', 'materialRequestNo', 'id', 'customerId', 'customerNo']) {
        expect(row).not.toHaveProperty(banned);
      }
    });

    it('getForCustomer returns my own request in the same client projection (summary parsed, no dueAt / ids); someone else\'s number and an unknown number get the identical 404', async () => {
      const h = makeHarness({ customers: [customerRow(), customerRow({ id: 'cust-uuid-2', customerNo: 'CU0002', email: 'x@example.com', phone: '+971500000002' })] });
      const mine = await inReview(h, 'ACCESS');
      await h.service.generateSummary(dpo, mine);
      const theirs = (await h.service.submit({ id: 'cust-uuid-2' }, { type: 'ACCESS', detail: 'someone else' })).requestNo;

      const row = (await h.service.getForCustomer('cust-uuid-1', mine)) as any;
      expect(row).toMatchObject({ requestNo: mine, type: 'ACCESS', status: 'IN_REVIEW', detail: 'Please show me what you hold about me' });
      expect(row.summary.profile.customerNo).toBe('CU0001');
      for (const banned of ['dueAt', 'materialRequestNo', 'id', 'customerId', 'customerNo']) {
        expect(row).not.toHaveProperty(banned);
      }

      const other = await h.service.getForCustomer('cust-uuid-1', theirs).catch((e) => e);
      const unknown = await h.service.getForCustomer('cust-uuid-1', 'DSR000000000000').catch((e) => e);
      expect(other).toBeInstanceOf(NotFoundException);
      expect(unknown).toBeInstanceOf(NotFoundException);
      expect(other.message).toBe(unknown.message);
      expect(other.message).not.toContain(theirs);
    });
  });
});
