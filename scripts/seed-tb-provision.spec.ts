import { provisionTbAccounts, TB_CREATE_ACCOUNTS_BATCH_SIZE } from '../prisma/seed-tb.helper';

// 放在 scripts/ 而不是 prisma/：jest 只在 roots（src / admin-web/src / scripts）里发现测试，见 jest.config.js。
//
// provisionTbAccounts 把整张 tb_account_registry 灌进 TigerBeetle。TigerBeetle 单批 createAccounts 有条数上限
// （自栈实测 250 条过、254 条起报 "Too much data was sent or requested in this batch"），而注册表随钱包增长
// （每个钱包一个现金户）。这里用假 TB 客户端钉住：任何一批都不超过分批常量、且注册表里每个账户都被送出去一次。

const mockCreateAccounts = jest.fn();
const mockDestroy = jest.fn();
jest.mock('tigerbeetle-node', () => ({
  createClient: jest.fn(() => ({ createAccounts: mockCreateAccounts, destroy: mockDestroy })),
  CreateAccountStatus: {},
}));

const TB_ACCOUNT_EXISTS = 21;

function registryRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    tbAccountId: (i + 1).toString(16).padStart(32, '0'),
    ownerUuid: null,
    ownerType: 'SYSTEM',
    ledger: 1,
    code: 200,
    flags: 0,
  }));
}
const fakePrisma = (rows: any[]) => ({ tbAccountRegistry: { findMany: jest.fn().mockResolvedValue(rows) } }) as any;

describe('provisionTbAccounts：分批提交', () => {
  const oldAddr = process.env.TB_ADDRESS;
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    process.env.TB_ADDRESS = '127.0.0.1:0';
    mockCreateAccounts.mockReset().mockResolvedValue([]);
    mockDestroy.mockReset();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    if (oldAddr === undefined) delete process.env.TB_ADDRESS; else process.env.TB_ADDRESS = oldAddr;
  });

  const sentIds = () => mockCreateAccounts.mock.calls.flatMap(([batch]) => batch.map((a: any) => a.id));

  it('注册表比一批大：每批都不超过分批常量，全部账户都送出去、不重不漏、顺序不变', async () => {
    const n = TB_CREATE_ACCOUNTS_BATCH_SIZE * 2 + 50; // 250 行：越过 TB 单批上限（254）之前就已分批，且不是整倍数
    await provisionTbAccounts(fakePrisma(registryRows(n)));

    expect(mockCreateAccounts).toHaveBeenCalledTimes(3);
    for (const [batch] of mockCreateAccounts.mock.calls) {
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(TB_CREATE_ACCOUNTS_BATCH_SIZE);
    }
    expect(sentIds()).toEqual(Array.from({ length: n }, (_, i) => BigInt(i + 1)));
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('边界：恰好一批 → 调一次；多一条 → 调两次', async () => {
    await provisionTbAccounts(fakePrisma(registryRows(TB_CREATE_ACCOUNTS_BATCH_SIZE)));
    expect(mockCreateAccounts).toHaveBeenCalledTimes(1);

    mockCreateAccounts.mockClear();
    await provisionTbAccounts(fakePrisma(registryRows(TB_CREATE_ACCOUNTS_BATCH_SIZE + 1)));
    expect(mockCreateAccounts.mock.calls.map(([b]) => b.length)).toEqual([TB_CREATE_ACCOUNTS_BATCH_SIZE, 1]);
  });

  it('注册表为空 → 不调 createAccounts', async () => {
    await provisionTbAccounts(fakePrisma([]));
    expect(mockCreateAccounts).not.toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('汇总日志跨批累加：exists 与真错误都按全部批次合计（真错误仍单独打印）', async () => {
    const n = TB_CREATE_ACCOUNTS_BATCH_SIZE * 2 + 50;
    mockCreateAccounts
      .mockResolvedValueOnce([{ index: 0, status: TB_ACCOUNT_EXISTS }, { index: 1, status: TB_ACCOUNT_EXISTS }])
      .mockResolvedValueOnce([{ index: 0, status: TB_ACCOUNT_EXISTS }, { index: 5, status: 99 }]) // 99 = 既不是 exists 也不是开发模式 created
      .mockResolvedValueOnce([{ index: 0, status: 4294967295 }]); // 开发模式的 created 状态：不算 exists、也不算错误
    await provisionTbAccounts(fakePrisma(registryRows(n)));

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain(`  ✔ TB accounts provisioned: ${n - 3} created, 3 already existed, 1 errors`);
    expect(lines.some((l) => l.includes('TB account provisioning had 1 errors') && l.includes('"status":99'))).toBe(true);
  });

  it('某一批抛错（如 TB 拒绝）→ 异常照常外抛，客户端仍被销毁', async () => {
    mockCreateAccounts.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('boom'));
    await expect(provisionTbAccounts(fakePrisma(registryRows(TB_CREATE_ACCOUNTS_BATCH_SIZE * 2)))).rejects.toThrow('boom');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
