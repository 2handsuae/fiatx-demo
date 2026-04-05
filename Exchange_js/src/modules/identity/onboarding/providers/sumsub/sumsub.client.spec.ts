import axios from 'axios';
import { createHmac } from 'crypto';
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

  it('sends the local user identifier as userId when creating sdk tokens', async () => {
    const post = jest.fn().mockResolvedValue({ data: { token: 'sdk-token' } });
    mockedAxios.create.mockReturnValue({ post } as any);

    const client = new SumsubClient();
    const token = await client.createSdkToken({
      externalUserId: 'customer-1',
      levelName: 'wave3-level-1',
    });

    expect(token).toEqual({ token: 'sdk-token' });
    expect(post).toHaveBeenCalledWith(
      '/resources/accessTokens/sdk',
      expect.objectContaining({
        userId: 'customer-1',
        levelName: 'wave3-level-1',
        ttlInSecs: 600,
      }),
      expect.any(Object),
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
    const get = jest.fn().mockResolvedValue({ data: { reviewStatus: 'COMPLETED' } });
    mockedAxios.create.mockReturnValue({ get } as any);

    const client = new SumsubClient();
    const status = await client.getApplicantReviewStatus('app-1');

    expect(status).toEqual({ reviewStatus: 'COMPLETED' });
    expect(get).toHaveBeenCalledWith(
      '/resources/applicants/app-1/status',
      expect.any(Object),
    );
  });
});
