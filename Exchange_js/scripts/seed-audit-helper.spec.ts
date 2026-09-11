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
