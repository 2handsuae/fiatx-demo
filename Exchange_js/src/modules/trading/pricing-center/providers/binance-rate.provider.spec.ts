import { Prisma } from '@prisma/client';
import axios from 'axios';
import { BinanceRateProvider } from './binance-rate.provider';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BinanceRateProvider', () => {
  let provider: BinanceRateProvider;

  beforeEach(() => {
    jest.resetAllMocks();
    provider = new BinanceRateProvider();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses direct symbol bid price when direct book exists', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { bidPrice: '100', askPrice: '101' },
    } as any);

    const result = await provider.fetchRate('BTC', 'USDT');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.sideUsed).toBe('BID');
    expect(result.bid).toBe('100');
    expect(result.ask).toBe('101');
    expect(result.rate.toString()).toBe('100');
    expect(result.aedPegApplied).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT',
      { timeout: 6000 },
    );
  });

  it('uses inverse symbol ask price when direct book is unavailable', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error('symbol not found'))
      .mockResolvedValueOnce({
        data: { bidPrice: '99', askPrice: '100' },
      } as any);

    const result = await provider.fetchRate('USDT', 'BTC');

    expect(result.symbol).toBe('BTCUSDT');
    expect(result.sideUsed).toBe('INVERSE_ASK');
    expect(result.rate.toString()).toBe('0.01');
    expect(result.formula).toContain('1 / ask(BTCUSDT)');
  });

  it('applies AED conversion in both directions', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: { bidPrice: '200', askPrice: '201' },
      } as any)
      .mockRejectedValueOnce(new Error('USDTBTC not found'))
      .mockResolvedValueOnce({
        data: { bidPrice: '200', askPrice: '201' },
      } as any);

    const toAed = await provider.fetchRate('BTC', 'AED');
    expect(toAed.aedPegApplied).toBe(true);
    expect(toAed.rate.toString()).toBe(new Prisma.Decimal('200').mul('3.6725').toString());
    expect(toAed.formula).toContain('* 3.6725');

    const fromAed = await provider.fetchRate('AED', 'BTC');
    const expected = new Prisma.Decimal(1).div('201').div('3.6725');
    expect(fromAed.aedPegApplied).toBe(true);
    expect(fromAed.rate.toString()).toBe(expected.toString());
    expect(fromAed.formula).toContain('/ 3.6725');
  });

  it('throws when inverse ask is zero', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(new Error('USDTBTC not found'))
      .mockResolvedValueOnce({
        data: { bidPrice: '1', askPrice: '0' },
      } as any);

    await expect(provider.fetchRate('USDT', 'BTC')).rejects.toThrow(
      'Binance rate unavailable for USDT/BTC',
    );
  });

  it('caches bookTicker with TTL and refreshes after expiry', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    mockedAxios.get.mockResolvedValueOnce({
      data: { bidPrice: '100', askPrice: '101' },
    } as any);

    const first = await provider.fetchRate('BTC', 'USDT');
    expect(first.rate.toString()).toBe('100');

    jest.setSystemTime(new Date('2026-02-24T00:00:02.000Z'));
    const second = await provider.fetchRate('BTC', 'USDT');
    expect(second.rate.toString()).toBe('100');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    mockedAxios.get.mockResolvedValueOnce({
      data: { bidPrice: '110', askPrice: '111' },
    } as any);
    jest.setSystemTime(new Date('2026-02-24T00:00:04.000Z'));
    const third = await provider.fetchRate('BTC', 'USDT');
    expect(third.rate.toString()).toBe('110');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);

  });
});
