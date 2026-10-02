import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgreementsReadService } from './agreements-read.service';
import { AGREEMENT_BODIES } from './agreement-versions.constant';

// 战役丙波三 T2：prisma / audit 全 mock，mock 行为化——where 按语义过滤（等值 / {lte} / {in} /
// {not}），不无视 where 假绿（本仓判例：mock无视where假绿）。内存"库"可被断言直接读回。

type VersionRow = {
  id: string;
  versionKey: string;
  status: string;
  summary: string;
  effectiveAt: Date | null;
  publishedAt: Date | null;
  pendingApprovalNo: string | null;
};
type ConsentRow = {
  id: string;
  customerId: string;
  customerNo: string;
  versionKey: string;
  action: string;
  actedAt: Date;
};

const DAY = 24 * 60 * 60 * 1000;
const PAST = new Date(Date.now() - DAY);
const FUTURE = new Date(Date.now() + 30 * DAY);

function fieldMatches(actual: any, cond: any): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('lte' in cond) return actual != null && actual.getTime() <= cond.lte.getTime();
    if ('in' in cond) return cond.in.includes(actual);
    if ('not' in cond) return actual !== cond.not;
    throw new Error(`mock: unsupported where operator ${JSON.stringify(cond)}`);
  }
  return actual === cond;
}
function rowMatches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]) => fieldMatches(row[k], v));
}
function sortRows<T>(rows: T[], orderBy?: any): T[] {
  if (!orderBy) return rows;
  const [[field, dir]] = Object.entries(orderBy) as [string, 'asc' | 'desc'][];
  return [...rows].sort((a: any, b: any) => {
    const d = typeof a[field] === 'string' ? a[field].localeCompare(b[field]) : a[field].getTime() - b[field].getTime();
    return dir === 'desc' ? -d : d;
  });
}

function version(versionKey: string, status: string, effectiveAt: Date | null = null): VersionRow {
  return {
    id: `id-${versionKey}`,
    versionKey,
    status,
    summary: `summary of ${versionKey}`,
    effectiveAt,
    publishedAt: status === 'PUBLISHED' || status === 'EFFECTIVE' || status === 'SUPERSEDED' ? PAST : null,
    pendingApprovalNo: null,
  };
}

function makeService(opts: { versions: VersionRow[]; consents?: ConsentRow[] }) {
  const versions = opts.versions;
  const consents: ConsentRow[] = [...(opts.consents ?? [])];
  const events: string[] = [];
  let seq = 0;

  const prisma: any = {
    customerAgreementVersion: {
      findFirst: jest.fn(async ({ where, orderBy }: any = {}) => sortRows(versions.filter((r) => rowMatches(r, where)), orderBy)[0] ?? null),
      findUnique: jest.fn(async ({ where }: any) => versions.find((r) => rowMatches(r, where)) ?? null),
      findMany: jest.fn(async ({ where, orderBy }: any = {}) => sortRows(versions.filter((r) => rowMatches(r, where)), orderBy)),
      update: jest.fn(async ({ where, data }: any) => {
        const row = versions.find((r) => rowMatches(r, where));
        if (!row) throw new Error('mock: update target not found');
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = versions.filter((r) => rowMatches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
    customerAgreementConsent: {
      findFirst: jest.fn(async ({ where, orderBy }: any = {}) => sortRows(consents.filter((r) => rowMatches(r, where)), orderBy)[0] ?? null),
      findMany: jest.fn(async ({ where, orderBy }: any = {}) => sortRows(consents.filter((r) => rowMatches(r, where)), orderBy)),
      create: jest.fn(async ({ data }: any) => {
        seq += 1;
        const row: ConsentRow = { id: `consent-${seq}`, actedAt: new Date(), ...data };
        consents.push(row);
        events.push('consent.create');
        return row;
      }),
    },
    // 数组形态：各操作在数组构造时已按序执行（mock 同步改内存），resolve 即"事务提交"。
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => {
      const out = await Promise.all(ops);
      events.push('tx.resolved');
      return out;
    }),
  };
  const auditLogs: any = {
    recordSystem: jest.fn(async () => {
      events.push('audit.system');
      return {};
    }),
    recordByActor: jest.fn(async () => {
      events.push('audit.actor');
      return {};
    }),
  };

  const service = new AgreementsReadService(prisma, auditLogs);
  return { service, prisma, auditLogs, versions, consents, events };
}

const C1 = { customerId: 'cust-1', customerNo: 'CUS00001' };

function consent(c: { customerId: string; customerNo: string }, versionKey: string, action: string, actedAt: Date, n = 1): ConsentRow {
  return { id: `seed-${c.customerNo}-${versionKey}-${action}-${n}`, ...c, versionKey, action, actedAt };
}

describe('AGREEMENT_BODIES 登记处', () => {
  it('v1 第 IV / VII 节通知期已订正为 30 天，全文不含 "14 days"', () => {
    const v1 = AGREEMENT_BODIES.v1;
    expect(v1).toHaveLength(7);
    const iv = v1.find((s) => s.no === 'IV')!.body.join(' ');
    const vii = v1.find((s) => s.no === 'VII')!.body.join(' ');
    expect(iv).toContain("30 days' written notice");
    expect(vii).toContain('at least thirty (30) calendar days before the change takes effect');
    expect(JSON.stringify(v1)).not.toContain('14 days');
  });

  it('v2 = v1 深拷贝 + 仅第 V 节末尾多一段投诉时限；改 v2 不回写 v1', () => {
    const { v1, v2 } = AGREEMENT_BODIES;
    expect(v2).toHaveLength(v1.length);
    v1.forEach((s, i) => {
      expect(v2[i]).not.toBe(s);
      expect(v2[i].body).not.toBe(s.body);
      if (s.no === 'V') {
        expect(v2[i].body).toHaveLength(s.body.length + 1);
        expect(v2[i].body.slice(0, s.body.length)).toEqual(s.body);
        expect(v2[i].body[s.body.length]).toContain('acknowledged within seven (7) days and resolved within twenty-eight (28) days');
      } else {
        expect(v2[i]).toEqual(s);
      }
    });
  });
});

describe('AgreementsReadService 懒翻生效', () => {
  it('① getCurrentEffective：库里 v1 EFFECTIVE → 返回 v1 视图，sections 取自登记处', async () => {
    const { service, auditLogs } = makeService({ versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'DRAFT')] });

    const view = await service.getCurrentEffective();

    expect(view).toEqual({
      versionKey: 'v1',
      status: 'EFFECTIVE',
      summary: 'summary of v1',
      effectiveAt: PAST,
      publishedAt: PAST,
      pendingApprovalNo: null,
      sections: AGREEMENT_BODIES.v1,
    });
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('② v2 PUBLISHED 且 effectiveAt 已过 → getCurrentEffective 返回 v2；事务内 v2→EFFECTIVE、v1→SUPERSEDED；AGREEMENT_EFFECTIVE 审计恰一次且在事务之后', async () => {
    const { service, prisma, auditLogs, versions, events } = makeService({
      versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', PAST)],
    });

    const view = await service.getCurrentEffective();

    expect(view.versionKey).toBe('v2');
    expect(view.status).toBe('EFFECTIVE');
    expect(view.sections).toEqual(AGREEMENT_BODIES.v2);
    expect(versions.find((r) => r.versionKey === 'v2')!.status).toBe('EFFECTIVE');
    expect(versions.find((r) => r.versionKey === 'v1')!.status).toBe('SUPERSEDED');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
    const input = auditLogs.recordSystem.mock.calls[0][0];
    expect(input).toMatchObject({
      action: 'AGREEMENT_EFFECTIVE',
      actionDomain: 'GOVERNANCE',
      versionKey: 'v2', // requiredFields 顶层展开
      primarySubjectType: 'AGREEMENT_VERSION',
      primarySubjectNo: 'v2',
      metadata: { versionKey: 'v2', supersededVersionKey: 'v1' },
      sourcePlatform: 'SYSTEM',
    });
    expect(input.requestId).toMatch(/^AGREEMENT_EFFECTIVE_v2_/); // 显式 requestId（reset 不清审计表，带随机后缀）
    // 约束④：审计在事务 resolve 之后
    expect(events).toEqual(['tx.resolved', 'audit.system']);

    // 翻完再读不会二次翻转、不会二次审计
    await service.getCurrentEffective();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
  });

  it('③ 负面：v2 PUBLISHED 但 effectiveAt 在未来 → 不翻、零审计，当前仍是 v1，在途是 v2', async () => {
    const { service, prisma, auditLogs, versions } = makeService({
      versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', FUTURE)],
    });

    const current = await service.getCurrentEffective();
    const pending = await service.getPendingPublished();

    expect(current.versionKey).toBe('v1');
    expect(pending).toMatchObject({ versionKey: 'v2', status: 'PUBLISHED', effectiveAt: FUTURE, sections: AGREEMENT_BODIES.v2 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
    expect(versions.map((r) => r.status)).toEqual(['EFFECTIVE', 'PUBLISHED']);
  });

  it('③b 负面：只有 PUBLISHED 才翻——PENDING_APPROVAL / DRAFT 即便 effectiveAt 已过也不翻', async () => {
    const { service, prisma, auditLogs } = makeService({
      versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PENDING_APPROVAL', PAST), version('v3', 'DRAFT', PAST)],
    });

    expect((await service.getCurrentEffective()).versionKey).toBe('v1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('getPendingPublished 也先懒翻：到点的 v2 已变成生效版，在途为 null', async () => {
    const { service, auditLogs } = makeService({
      versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', PAST)],
    });

    expect(await service.getPendingPublished()).toBeNull();
    expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
  });

  it('tickEffective 是公开方法（⚡快进直调）：到点版本翻转，未到点不动', async () => {
    const due = makeService({ versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', PAST)] });
    await due.service.tickEffective();
    expect(due.versions.map((r) => r.status)).toEqual(['SUPERSEDED', 'EFFECTIVE']);
    expect(due.auditLogs.recordSystem).toHaveBeenCalledTimes(1);

    const notDue = makeService({ versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', FUTURE)] });
    await notDue.service.tickEffective();
    expect(notDue.versions.map((r) => r.status)).toEqual(['EFFECTIVE', 'PUBLISHED']);
    expect(notDue.auditLogs.recordSystem).not.toHaveBeenCalled();
  });

  it('getVersionView：按 versionKey 取视图（含懒翻），查无即 404', async () => {
    const { service } = makeService({ versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', PAST)] });

    const v2 = await service.getVersionView('v2');
    expect(v2).toMatchObject({ versionKey: 'v2', status: 'EFFECTIVE', sections: AGREEMENT_BODIES.v2 });
    const v1 = await service.getVersionView('v1');
    expect(v1).toMatchObject({ versionKey: 'v1', status: 'SUPERSEDED', sections: AGREEMENT_BODIES.v1 });
    await expect(service.getVersionView('v9')).rejects.toBeInstanceOf(NotFoundException);
  });

  // 战役丙波三 T9：管理台详情要把在途审批单号链到审批页，视图须带 pendingApprovalNo。
  it('getVersionView 带出在途审批单号：PENDING_APPROVAL 版有值，其余为 null', async () => {
    const pending = { ...version('v2', 'PENDING_APPROVAL', FUTURE), pendingApprovalNo: 'APR-AGR-7' };
    const { service } = makeService({ versions: [version('v1', 'EFFECTIVE', PAST), pending] });

    expect((await service.getVersionView('v2')).pendingApprovalNo).toBe('APR-AGR-7');
    expect((await service.getVersionView('v1')).pendingApprovalNo).toBeNull();
  });
});

// 修复波（T11 走查 Concerns 2）：生效后旧版仍可读——阅读页两版对照不能随 ⚡/到点生效而消失。
describe('AgreementsReadService.getPreviousSuperseded', () => {
  it('v1 SUPERSEDED + v2 EFFECTIVE → 返回 v1 视图（带登记处 sections）', async () => {
    const { service } = makeService({ versions: [version('v1', 'SUPERSEDED', PAST), version('v2', 'EFFECTIVE', PAST)] });

    const prev = await service.getPreviousSuperseded();

    expect(prev).toMatchObject({ versionKey: 'v1', status: 'SUPERSEDED', sections: AGREEMENT_BODIES.v1 });
  });

  it('没有 SUPERSEDED 版（只有 EFFECTIVE / PUBLISHED / DRAFT）→ null', async () => {
    const { service } = makeService({
      versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', FUTURE), version('v3', 'DRAFT')],
    });

    expect(await service.getPreviousSuperseded()).toBeNull();
  });

  it('多个 SUPERSEDED：取 effectiveAt 最近的那版（库内故意把旧版排在后面，排序真由 orderBy 产生）', async () => {
    const older = new Date(PAST.getTime() - 400 * DAY);
    const { service, prisma } = makeService({
      versions: [version('v2', 'SUPERSEDED', PAST), version('v1', 'SUPERSEDED', older), version('v3', 'EFFECTIVE', PAST)],
    });

    const prev = await service.getPreviousSuperseded();

    expect(prev?.versionKey).toBe('v2');
    expect(prisma.customerAgreementVersion.findFirst).toHaveBeenCalledWith({
      where: { status: 'SUPERSEDED' },
      orderBy: { effectiveAt: 'desc' },
    });
  });
});

// 战役丙波三 T9：管理台列表——全部版本（含 DRAFT / 在途），按 versionKey 升序；读口惯例先懒翻。
describe('AgreementsReadService.listVersions', () => {
  it('返回全部版本视图（含 DRAFT），按 versionKey 升序，每项带 pendingApprovalNo 与登记处正文', async () => {
    const pending = { ...version('v2', 'PENDING_APPROVAL', FUTURE), pendingApprovalNo: 'APR-AGR-7' };
    // 库内故意倒序存放，断言排序真由 listVersions 的 orderBy 产生。
    const { service, prisma } = makeService({ versions: [pending, version('v1', 'EFFECTIVE', PAST)] });

    const list = await service.listVersions();

    expect(prisma.customerAgreementVersion.findMany).toHaveBeenCalledWith({ orderBy: { versionKey: 'asc' } });
    expect(list.map((v) => [v.versionKey, v.status, v.pendingApprovalNo])).toEqual([
      ['v1', 'EFFECTIVE', null],
      ['v2', 'PENDING_APPROVAL', 'APR-AGR-7'],
    ]);
    expect(list[1].sections).toEqual(AGREEMENT_BODIES.v2);
  });

  it('列表前先懒翻：到点的 v2（PUBLISHED）以 EFFECTIVE 现身、旧 v1 以 SUPERSEDED 现身', async () => {
    const { service } = makeService({ versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', PAST)] });

    const list = await service.listVersions();

    expect(list.map((v) => [v.versionKey, v.status])).toEqual([
      ['v1', 'SUPERSEDED'],
      ['v2', 'EFFECTIVE'],
    ]);
  });
});

describe('AgreementsReadService.hasAcceptedCurrent', () => {
  const T = new Date('2026-10-01T00:00:00Z');
  const base = () => [version('v1', 'EFFECTIVE', PAST), version('v2', 'DRAFT')];

  it('④ ACCEPTED 当前生效版行在 → true', async () => {
    const { service } = makeService({ versions: base(), consents: [consent(C1, 'v1', 'ACCEPTED', T)] });
    expect(await service.hasAcceptedCurrent(C1.customerId)).toBe(true);
  });

  it('④ 无行 → false', async () => {
    const { service } = makeService({ versions: base() });
    expect(await service.hasAcceptedCurrent(C1.customerId)).toBe(false);
  });

  it('④ 只有 DECLINED 行 → false', async () => {
    const { service } = makeService({ versions: base(), consents: [consent(C1, 'v1', 'DECLINED', T)] });
    expect(await service.hasAcceptedCurrent(C1.customerId)).toBe(false);
  });

  it('④ 先 DECLINED 后 ACCEPTED → true', async () => {
    const { service } = makeService({
      versions: base(),
      consents: [consent(C1, 'v1', 'DECLINED', T), consent(C1, 'v1', 'ACCEPTED', new Date(T.getTime() + 1000))],
    });
    expect(await service.hasAcceptedCurrent(C1.customerId)).toBe(true);
  });

  it('④ 别的客户的 ACCEPTED、本人对别的版本的 ACCEPTED 都不算', async () => {
    const other = { customerId: 'cust-2', customerNo: 'CUS00002' };
    const { service } = makeService({
      versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', FUTURE)],
      consents: [consent(other, 'v1', 'ACCEPTED', T), consent(C1, 'v2', 'ACCEPTED', T)],
    });
    expect(await service.hasAcceptedCurrent(C1.customerId)).toBe(false);
  });

  it('④ 懒翻后判定对象跟着换：v2 到点生效，仅同意过 v1 的客户立刻变为未同意', async () => {
    const { service } = makeService({
      versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', PAST)],
      consents: [consent(C1, 'v1', 'ACCEPTED', T)],
    });
    expect(await service.hasAcceptedCurrent(C1.customerId)).toBe(false);
  });
});

describe('AgreementsReadService.recordConsent', () => {
  it('⑤ ACCEPTED+MODAL：consent.create 恰一次 + recordByActor(CUSTOMER) AGREEMENT_ACCEPTED，顶层 versionKey/source、显式 requestId，审计在落行之后', async () => {
    const { service, prisma, auditLogs, consents, events } = makeService({ versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'DRAFT')] });

    await service.recordConsent(C1, 'v1', 'ACCEPTED', 'MODAL');

    expect(prisma.customerAgreementConsent.create).toHaveBeenCalledTimes(1);
    expect(prisma.customerAgreementConsent.create.mock.calls[0][0].data).toEqual({
      customerId: 'cust-1',
      customerNo: 'CUS00001',
      versionKey: 'v1',
      action: 'ACCEPTED',
    });
    expect(consents).toHaveLength(1);

    expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);
    const [input, actor] = auditLogs.recordByActor.mock.calls[0];
    expect(input).toMatchObject({
      action: 'AGREEMENT_ACCEPTED',
      actionDomain: 'CUSTOMER',
      versionKey: 'v1',
      source: 'MODAL',
      primarySubjectType: 'AGREEMENT_VERSION',
      primarySubjectNo: 'v1',
      ownerCustomerNo: 'CUS00001',
      metadata: { versionKey: 'v1', source: 'MODAL' },
      sourcePlatform: 'CLIENT_API',
    });
    expect(input.requestId).toMatch(/^AGREEMENT_ACCEPTED_CUS00001_v1_/);
    expect(actor).toMatchObject({ actorType: 'CUSTOMER', actorNo: 'CUS00001' });
    expect(events).toEqual(['consent.create', 'audit.actor']);
  });

  it('⑤ DECLINED+PAGE 同理记 AGREEMENT_DECLINED；同客户同版本同动作重复表态 requestId 互不相同（防审计静默去重）', async () => {
    const { service, prisma, auditLogs } = makeService({ versions: [version('v1', 'EFFECTIVE', PAST)] });

    await service.recordConsent(C1, 'v1', 'DECLINED', 'PAGE');
    await service.recordConsent(C1, 'v1', 'ACCEPTED', 'PAGE');
    await service.recordConsent(C1, 'v1', 'ACCEPTED', 'MODAL');

    expect(prisma.customerAgreementConsent.create).toHaveBeenCalledTimes(3);
    const [declined, accepted1, accepted2] = auditLogs.recordByActor.mock.calls.map((c: any[]) => c[0]);
    expect(declined).toMatchObject({ action: 'AGREEMENT_DECLINED', actionDomain: 'CUSTOMER', versionKey: 'v1', source: 'PAGE' });
    expect(declined.requestId).toMatch(/^AGREEMENT_DECLINED_CUS00001_v1_/);
    expect(accepted1).toMatchObject({ action: 'AGREEMENT_ACCEPTED', versionKey: 'v1', source: 'PAGE' });
    expect(accepted2).toMatchObject({ action: 'AGREEMENT_ACCEPTED', versionKey: 'v1', source: 'MODAL' });
    expect(accepted1.requestId).not.toBe(accepted2.requestId);
  });

  it('⑤ 注册口 REGISTER 与在途版 ACCEPTED（通知期提前同意）均可落', async () => {
    const { service, consents, auditLogs } = makeService({
      versions: [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', FUTURE)],
    });

    await service.recordConsent(C1, 'v1', 'ACCEPTED', 'REGISTER');
    await service.recordConsent(C1, 'v2', 'ACCEPTED', 'MODAL');

    expect(consents.map((r) => [r.versionKey, r.action])).toEqual([['v1', 'ACCEPTED'], ['v2', 'ACCEPTED']]);
    expect(auditLogs.recordByActor.mock.calls.map((c: any[]) => [c[0].primarySubjectNo, c[0].source])).toEqual([
      ['v1', 'REGISTER'],
      ['v2', 'MODAL'],
    ]);
  });

  describe('⑥ 校验：versionKey 须属 {当前生效版, 在途 PUBLISHED 版}；在途版不收 DECLINED', () => {
    const rejectsWithNoSideEffect = async (
      versions: VersionRow[],
      versionKey: string,
      action: 'ACCEPTED' | 'DECLINED',
    ) => {
      const { service, prisma, auditLogs, consents } = makeService({ versions });
      await expect(service.recordConsent(C1, versionKey, action, 'MODAL')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.customerAgreementConsent.create).not.toHaveBeenCalled();
      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
      expect(consents).toHaveLength(0);
    };

    it('不存在的版本 → BadRequest', () =>
      rejectsWithNoSideEffect([version('v1', 'EFFECTIVE', PAST)], 'v9', 'ACCEPTED'));

    it('DRAFT / PENDING_APPROVAL 版本（未公告）→ BadRequest', async () => {
      await rejectsWithNoSideEffect([version('v1', 'EFFECTIVE', PAST), version('v2', 'DRAFT')], 'v2', 'ACCEPTED');
      await rejectsWithNoSideEffect([version('v1', 'EFFECTIVE', PAST), version('v2', 'PENDING_APPROVAL', FUTURE)], 'v2', 'ACCEPTED');
    });

    it('对在途 PUBLISHED 版 DECLINED → BadRequest（通知期没有拒绝语义）', () =>
      rejectsWithNoSideEffect([version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', FUTURE)], 'v2', 'DECLINED'));

    it('已退位的 SUPERSEDED 版（v2 到点后的 v1）→ BadRequest', () =>
      rejectsWithNoSideEffect([version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', PAST)], 'v1', 'ACCEPTED'));
  });
});

describe('AgreementsReadService.consentStateFor', () => {
  const t = (n: number) => new Date(Date.UTC(2026, 9, n)); // 2026-10-0n
  const withPending = () => [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', FUTURE)];
  const afterFlip = () => [version('v1', 'EFFECTIVE', PAST), version('v2', 'PUBLISHED', PAST)]; // 读时懒翻，v2 成为生效版

  it('无任何表态行 → 五键全空/false', async () => {
    const { service } = makeService({ versions: withPending() });
    expect(await service.consentStateFor(C1.customerId)).toEqual({
      acceptedVersionKey: null,
      acceptedAt: null,
      acceptedCurrent: false,
      acceptedPending: false,
      declinedCurrentAt: null,
    });
  });

  it('只同意 v1、v2 在途 → acceptedCurrent=true、acceptedPending=false', async () => {
    const { service } = makeService({ versions: withPending(), consents: [consent(C1, 'v1', 'ACCEPTED', t(1))] });
    expect(await service.consentStateFor(C1.customerId)).toEqual({
      acceptedVersionKey: 'v1',
      acceptedAt: t(1),
      acceptedCurrent: true,
      acceptedPending: false,
      declinedCurrentAt: null,
    });
  });

  it('v1 与在途 v2 都同意 → 最近一次同意是 v2，两个 accepted 都 true', async () => {
    const { service } = makeService({
      versions: withPending(),
      consents: [consent(C1, 'v1', 'ACCEPTED', t(1)), consent(C1, 'v2', 'ACCEPTED', t(2))],
    });
    expect(await service.consentStateFor(C1.customerId)).toEqual({
      acceptedVersionKey: 'v2',
      acceptedAt: t(2),
      acceptedCurrent: true,
      acceptedPending: true,
      declinedCurrentAt: null,
    });
  });

  it('v2 到点生效、客户只同意过 v1 → acceptedCurrent=false、declinedCurrentAt=null（强制弹窗态），最近同意仍显示 v1', async () => {
    const { service } = makeService({ versions: afterFlip(), consents: [consent(C1, 'v1', 'ACCEPTED', t(1))] });
    expect(await service.consentStateFor(C1.customerId)).toEqual({
      acceptedVersionKey: 'v1',
      acceptedAt: t(1),
      acceptedCurrent: false,
      acceptedPending: false,
      declinedCurrentAt: null,
    });
  });

  it('生效后对 v2 暂不同意 → declinedCurrentAt 取最近一次拒绝时刻（横幅态）', async () => {
    const { service } = makeService({
      versions: afterFlip(),
      consents: [
        consent(C1, 'v1', 'ACCEPTED', t(1)),
        consent(C1, 'v2', 'DECLINED', t(3), 1),
        consent(C1, 'v2', 'DECLINED', t(4), 2),
      ],
    });
    expect(await service.consentStateFor(C1.customerId)).toEqual({
      acceptedVersionKey: 'v1',
      acceptedAt: t(1),
      acceptedCurrent: false,
      acceptedPending: false,
      declinedCurrentAt: t(4),
    });
  });

  it('先拒后同意 v2 → acceptedCurrent=true，拒绝已被后来的同意覆盖（declinedCurrentAt=null）', async () => {
    const { service } = makeService({
      versions: afterFlip(),
      consents: [consent(C1, 'v1', 'ACCEPTED', t(1)), consent(C1, 'v2', 'DECLINED', t(3)), consent(C1, 'v2', 'ACCEPTED', t(5))],
    });
    expect(await service.consentStateFor(C1.customerId)).toEqual({
      acceptedVersionKey: 'v2',
      acceptedAt: t(5),
      acceptedCurrent: true,
      acceptedPending: false,
      declinedCurrentAt: null,
    });
  });

  it('别的客户的表态行不串味', async () => {
    const other = { customerId: 'cust-2', customerNo: 'CUS00002' };
    const { service } = makeService({
      versions: withPending(),
      consents: [consent(other, 'v1', 'ACCEPTED', t(1)), consent(other, 'v2', 'ACCEPTED', t(2))],
    });
    expect(await service.consentStateFor(C1.customerId)).toEqual({
      acceptedVersionKey: null,
      acceptedAt: null,
      acceptedCurrent: false,
      acceptedPending: false,
      declinedCurrentAt: null,
    });
  });
});
