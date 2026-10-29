import { writeSeedAudit } from '../prisma/seed-audit.helper';

// 放在 scripts/ 而不是 prisma/：jest 只在 roots（src / admin-web/src / scripts）里发现测试，见 jest.config.js。

function p2002(field: string) {
  return Object.assign(new Error(`Unique constraint failed on the fields: (\`${field}\`)`), {
    code: 'P2002',
    meta: { modelName: 'AuditLogEvent', target: [field] },
  });
}

function fakePrisma(create: jest.Mock) {
  return { auditLogEvent: { findUnique: jest.fn().mockResolvedValue(null), create } } as any;
}

const input = {
  action: 'TRANSACTION_LIMIT_SEEDED',
  subjectType: 'TRANSACTION_LIMIT_POLICY',
  subjectNo: 'TLR-SPEC',
  actorNo: 'RELEASE' as const,
  afterData: { gateType: 'SINGLE' },
};

describe('writeSeedAudit：审计单号撞车', () => {
  it('撞 eventNo 就换一个号再写，第二次成功即返回', async () => {
    const create = jest.fn().mockRejectedValueOnce(p2002('eventNo')).mockResolvedValueOnce({ id: 'row-2' });
    await expect(writeSeedAudit(fakePrisma(create), input)).resolves.toEqual({ id: 'row-2' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.eventNo).toMatch(/^AUD\d{12}$/);
    expect(create.mock.calls[1][0].data.eventNo).toMatch(/^AUD\d{12}$/);
  });

  it('别的唯一约束冲突照旧抛出，不换号', async () => {
    const create = jest.fn().mockRejectedValueOnce(p2002('idempotencyKey'));
    await expect(writeSeedAudit(fakePrisma(create), input)).rejects.toMatchObject({ code: 'P2002' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('连撞 10 次就放弃并报错', async () => {
    const create = jest.fn().mockRejectedValue(p2002('eventNo'));
    await expect(writeSeedAudit(fakePrisma(create), input)).rejects.toThrow(/10/);
    expect(create).toHaveBeenCalledTimes(10);
  });
});

describe('writeSeedAudit：真人操作员 / 固定时刻 / 多主体（甲波六 T9）', () => {
  it('传 operator 就按 ADMIN 形态写：actor 是 ADM 号 + 角色快照，来源平台 ADMIN；牵连主体与 metadata 落下', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'row-1' });
    const occurredAt = new Date('2026-09-15T08:00:00.000Z');
    await writeSeedAudit(fakePrisma(create), {
      ...input,
      action: 'DD_SCREENING_RECORDED',
      subjectType: 'DUE_DILIGENCE_ASSESSMENT',
      subjectNo: 'DDA-SPEC',
      actorNo: 'DEMO_SEED' as const,
      actionDomain: 'GOVERNANCE',
      category: 'GOVERNANCE',
      operator: { userNo: 'ADM2501010006', roles: ['COMPLIANCE_OFFICER'] },
      occurredAt,
      requestId: 'PDD_DD_SCREENING_RECORDED_DDA-SPEC_1',
      metadata: { recordNo: 'SCR-SPEC', result: 'GREEN' },
      relatedSubjects: [
        { subjectType: 'LIQUIDITY_PROVIDER', subjectNo: 'LPP-SPEC', subjectRole: 'RELATED' },
        { subjectType: 'SCREENING_RECORD', subjectNo: 'SCR-SPEC', subjectRole: 'RELATED' },
      ],
    });
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actorType: 'ADMIN', actorNo: 'ADM2501010006', actorDisplayName: 'ADM2501010006', sourcePlatform: 'ADMIN',
      category: 'GOVERNANCE', actionDomain: 'GOVERNANCE', requestId: 'PDD_DD_SCREENING_RECORDED_DDA-SPEC_1',
      occurredAt, recordedAt: occurredAt,
    });
    expect(JSON.parse(data.actorRolesAtTime)).toEqual(['COMPLIANCE_OFFICER']);
    expect(JSON.parse(data.metadata)).toMatchObject({ recordNo: 'SCR-SPEC', result: 'GREEN' });
    expect(data.retainedUntil.getFullYear()).toBe(2034); // 8 年留存从固定时刻起算，不是从跑种子那天
    expect(data.subjects.create.map((s: any) => [s.subjectType, s.subjectRole])).toEqual([
      ['DUE_DILIGENCE_ASSESSMENT', 'PRIMARY'], ['LIQUIDITY_PROVIDER', 'RELATED'], ['SCREENING_RECORD', 'RELATED'],
    ]);
  });

  it('显式 requestId 让同主体同动作的第二条不被幂等键吞掉；不传则两条同键', async () => {
    const keys: string[] = [];
    const prisma = { auditLogEvent: { findUnique: jest.fn().mockImplementation(({ where }: any) => { keys.push(where.idempotencyKey); return null; }), create: jest.fn().mockResolvedValue({}) } } as any;
    await writeSeedAudit(prisma, { ...input, requestId: 'r1' });
    await writeSeedAudit(prisma, { ...input, requestId: 'r2' });
    await writeSeedAudit(prisma, input);
    await writeSeedAudit(prisma, input);
    expect(new Set(keys.slice(0, 2)).size).toBe(2);
    expect(keys[2]).toBe(keys[3]);
  });

  it('不传新字段时与加之前逐字一致：SYSTEM 写手、SYSTEM 来源、单一 PRIMARY 子主体', async () => {
    const create = jest.fn().mockResolvedValue({});
    await writeSeedAudit(fakePrisma(create), input);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorType: 'SYSTEM', actorNo: 'RELEASE', sourcePlatform: 'SYSTEM', category: 'SYSTEM', requestId: `${input.action}_${input.subjectNo}` });
    expect(JSON.parse(data.actorRolesAtTime)).toEqual(['SYSTEM']);
    expect(data.subjects.create).toHaveLength(1);
  });
});
