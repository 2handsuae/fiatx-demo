// src/modules/accounting/tigerbeetle/tigerbeetle.service.spec.ts
import { TigerBeetleService } from './tigerbeetle.service';
import { ConfigService } from '@nestjs/config';

describe('TigerBeetleService', () => {
  let service: TigerBeetleService;

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue('127.0.0.1:3001'),
    } as unknown as ConfigService;
    service = new TigerBeetleService(configService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should expose createAccounts method', () => {
    expect(typeof service.createAccounts).toBe('function');
  });

  it('should expose createTransfers method', () => {
    expect(typeof service.createTransfers).toBe('function');
  });

  it('should expose lookupAccounts method', () => {
    expect(typeof service.lookupAccounts).toBe('function');
  });

  it('should expose lookupTransfers method', () => {
    expect(typeof service.lookupTransfers).toBe('function');
  });
});
