import axios from 'axios';
import { SumsubClient } from './sumsub.client';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SumsubClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
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

    expect(post).toHaveBeenCalledWith(
      '/resources/applicants?levelName=wave3-level-1',
      expect.objectContaining({ externalUserId: 'customer-1' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-App-Token': expect.any(String),
          'X-App-Access-Ts': expect.any(String),
          'X-App-Access-Sig': expect.any(String),
        }),
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
});
