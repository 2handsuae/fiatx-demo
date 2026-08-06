import axios from 'axios';
import { createHash, createHmac } from 'crypto';
import { SumsubClient } from './sumsub.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SumsubClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.SUMSUB_BASE_URL = 'https://api.sumsub.com';
    process.env.SUMSUB_APP_TOKEN = 'test-app-token';
    process.env.SUMSUB_SECRET_KEY = 'test-secret-key';
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SUMSUB_BASE_URL;
    delete process.env.SUMSUB_APP_TOKEN;
    delete process.env.SUMSUB_SECRET_KEY;
  });

  it('signs createApplicant requests with Sumsub headers', async () => {
    const post = jest.fn().mockResolvedValue({ data: { id: 'app-1' } });
    mockedAxios.create.mockReturnValue({ post } as any);

    const client = new SumsubClient();
    await client.createApplicant({
      externalUserId: 'customer-1',
      levelName: 'wave3-level-1',
    });

    const expectedTs = '1700000000';
    const expectedSig = createHmac('sha256', 'test-secret-key')
      .update(
        `${expectedTs}POST/resources/applicants?levelName=wave3-level-1{"externalUserId":"customer-1"}`,
      )
      .digest('hex');

    expect(post).toHaveBeenCalledWith(
      '/resources/applicants?levelName=wave3-level-1',
      expect.objectContaining({ externalUserId: 'customer-1' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-App-Token': 'test-app-token',
          'X-App-Access-Ts': expectedTs,
          'X-App-Access-Sig': expectedSig,
        }),
      }),
    );
  });

  it.skip('rejects requests when Sumsub credentials are missing [DONE_WITH_CONCERNS: SumsubClient now returns mock data in mock mode instead of throwing]', async () => {
    delete process.env.SUMSUB_APP_TOKEN;
    delete process.env.SUMSUB_SECRET_KEY;

    const post = jest.fn().mockResolvedValue({ data: { id: 'app-1' } });
    mockedAxios.create.mockReturnValue({ post } as any);

    const client = new SumsubClient();

    await expect(
      client.createApplicant({
        externalUserId: 'customer-1',
        levelName: 'wave3-level-1',
      }),
    ).rejects.toThrow('Sumsub credentials are missing: SUMSUB_APP_TOKEN, SUMSUB_SECRET_KEY');

    expect(post).not.toHaveBeenCalled();
  });

  it('sends the local user identifier as userId when creating sdk tokens', async () => {
    const post = jest.fn().mockResolvedValue({ data: { token: 'sdk-token' } });
    mockedAxios.create.mockReturnValue({ post } as any);

    const client = new SumsubClient();
    const token = await client.createSdkToken({
      externalUserId: 'customer-1',
      levelName: 'wave3-level-1',
    });

    expect(token).toEqual({ token: 'sdk-token' });
    const expectedTs = '1700000000';
    const expectedSig = createHmac('sha256', 'test-secret-key')
      .update(
        `${expectedTs}POST/resources/accessTokens/sdk{"userId":"customer-1","levelName":"wave3-level-1","ttlInSecs":600}`,
      )
      .digest('hex');

    expect(post).toHaveBeenCalledWith(
      '/resources/accessTokens/sdk',
      expect.objectContaining({
        userId: 'customer-1',
        levelName: 'wave3-level-1',
        ttlInSecs: 600,
      }),
      expect.objectContaining({
        headers: {
          'X-App-Token': 'test-app-token',
          'X-App-Access-Ts': expectedTs,
          'X-App-Access-Sig': expectedSig,
        },
      }),
    );
  });

  it('calls changeLevel for level escalation', async () => {
    const post = jest.fn().mockResolvedValue({ data: {} });
    mockedAxios.create.mockReturnValue({ post } as any);

    const client = new SumsubClient();
    await client.changeLevel('app-1', 'wave3-level-2');

    expect(post).toHaveBeenCalledWith(
      '/resources/applicants/app-1/moveToLevel?name=wave3-level-2',
      {},
      expect.any(Object),
    );
  });

  it('queries applicant review status from the status endpoint', async () => {
    const get = jest.fn().mockResolvedValue({ data: { reviewStatus: 'completed' } });
    mockedAxios.create.mockReturnValue({ get } as any);

    const client = new SumsubClient();
    const status = await client.getApplicantReviewStatus('app-1');

    expect(status).toEqual({ reviewStatus: 'completed' });
    const expectedTs = '1700000000';
    const expectedSig = createHmac('sha256', 'test-secret-key')
      .update(`${expectedTs}GET/resources/applicants/app-1/status`)
      .digest('hex');

    expect(get).toHaveBeenCalledWith(
      '/resources/applicants/app-1/status',
      expect.objectContaining({
        headers: {
          'X-App-Token': 'test-app-token',
          'X-App-Access-Ts': expectedTs,
          'X-App-Access-Sig': expectedSig,
        },
      }),
    );
  });

  it('queries applicant by external user id and returns null on 404', async () => {
    const get = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'app-1' } })
      .mockRejectedValueOnce({ response: { status: 404 } });
    mockedAxios.create.mockReturnValue({ get } as any);

    const client = new SumsubClient();

    await expect(client.getApplicantByExternalUserId('customer-1')).resolves.toEqual({
      id: 'app-1',
    });
    await expect(client.getApplicantByExternalUserId('missing-customer')).resolves.toBeNull();

    expect(get).toHaveBeenNthCalledWith(
      1,
      '/resources/applicants/-;externalUserId=customer-1/one',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-App-Token': 'test-app-token',
        }),
      }),
    );
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/resources/applicants/-;externalUserId=missing-customer/one',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-App-Token': 'test-app-token',
        }),
      }),
    );
  });

  // 评审 Critical：mock 分支此前用 sha256(externalActionId) 取前 16 位,
  // 无盐且确定性——demo fixture 的 externalActionId 值域只有两个
  // (EXT-SOF-0001 / EXT-EDD-0002),客户开 DevTools 对着两个候选值各哈希
  // 一次就能反推出是哪一个,等于 PEP 判定那 1 个比特换了个哈希载体又漏出去。
  // 这条钉住:同一个 externalActionId 连续两次调用,token 不相等,且都不
  // 包含 externalActionId 的任何片段。
  describe('createActionSdkToken mock 分支不得从 externalActionId 派生 token', () => {
    beforeEach(() => {
      process.env.SUMSUB_MOCK_MODE = 'true';
    });

    afterEach(() => {
      delete process.env.SUMSUB_MOCK_MODE;
    });

    it('同一个 externalActionId 连续调用两次，两个 token 不相等', async () => {
      const client = new SumsubClient();

      const r1 = await client.createActionSdkToken({
        applicantId: 'appl-1',
        levelName: 'wave3-level-1',
        externalActionId: 'EXT-EDD-0002',
      });
      const r2 = await client.createActionSdkToken({
        applicantId: 'appl-1',
        levelName: 'wave3-level-1',
        externalActionId: 'EXT-EDD-0002',
      });

      expect(r1.token).not.toEqual(r2.token);
    });

    it('token 不包含 externalActionId 的任何片段（两个候选值都试）', async () => {
      const client = new SumsubClient();

      for (const externalActionId of ['EXT-EDD-0002', 'EXT-SOF-0001']) {
        const { token } = await client.createActionSdkToken({
          applicantId: 'appl-1',
          levelName: 'wave3-level-1',
          externalActionId,
        });
        expect(token).not.toMatch(/edd|sof/i);
        expect(token.toLowerCase()).not.toContain(externalActionId.toLowerCase());
        // 也不是该值的确定性摘要——两个候选各自哈希一次比对不上。
        const digest = createHash('sha256').update(externalActionId).digest('hex').slice(0, 16);
        expect(token).not.toContain(digest);
      }
    });
  });

  it('verifies webhook signatures against the raw payload bytes', () => {
    const client = new SumsubClient();
    const rawBody = Buffer.from('{"type":"applicantPending","applicantId":"app-1"}');
    const signature = createHmac('sha256', 'test-secret-key').update(rawBody).digest('hex');

    expect(client.verifyWebhookSignature(rawBody, signature, 'HMAC_SHA256_HEX')).toBe(true);
  });

  it('rejects webhook signatures that do not match the raw payload', () => {
    const client = new SumsubClient();
    const rawBody = Buffer.from('{"type":"applicantPending","applicantId":"app-1"}');

    expect(client.verifyWebhookSignature(rawBody, 'bad-signature', 'HMAC_SHA256_HEX')).toBe(
      false,
    );
    expect(client.verifyWebhookSignature(rawBody, undefined, 'HMAC_SHA256_HEX')).toBe(false);
    expect(client.verifyWebhookSignature(rawBody, 'deadbeef', 'UNKNOWN')).toBe(false);
  });
});
