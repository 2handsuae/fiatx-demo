import { Test, TestingModule } from '@nestjs/testing';
import { TradingReadinessController } from './trading-readiness.controller';
import { WithdrawalAddressService } from '../../asset-treasury/withdrawal-addresses/withdrawal-address.service';
import { WalletQueryService } from '../../asset-treasury/wallets/wallet-query.service';
import { AssetsService } from '../../asset-treasury/assets/assets.service';

describe('TradingReadinessController', () => {
  let controller: TradingReadinessController;
  let withdrawalAddresses: { hasActiveFiatWithdrawalAddress: jest.Mock };
  let walletQuery: { hasReceivingAccount: jest.Mock };
  let assets: { findByCode: jest.Mock };

  beforeEach(async () => {
    withdrawalAddresses = { hasActiveFiatWithdrawalAddress: jest.fn() };
    walletQuery = { hasReceivingAccount: jest.fn() };
    assets = { findByCode: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TradingReadinessController],
      providers: [
        { provide: WithdrawalAddressService, useValue: withdrawalAddresses },
        { provide: WalletQueryService, useValue: walletQuery },
        { provide: AssetsService, useValue: assets },
      ],
    }).compile();

    controller = module.get<TradingReadinessController>(TradingReadinessController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('readiness', () => {
    it('returns tradingReady=true and hasActiveFiatWithdrawalAddress=true when the customer has an active fiat withdrawal address', async () => {
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);

      const result = await controller.readiness({ user: { type: 'CUSTOMER', userId: 'cust-1' } });

      expect(withdrawalAddresses.hasActiveFiatWithdrawalAddress).toHaveBeenCalledWith('cust-1');
      expect(result).toEqual({ tradingReady: true, hasActiveFiatWithdrawalAddress: true });
    });

    it('returns tradingReady=false and hasActiveFiatWithdrawalAddress=false when the customer has none', async () => {
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(false);

      const result = await controller.readiness({ user: { type: 'CUSTOMER', userId: 'cust-2' } });

      expect(result).toEqual({ tradingReady: false, hasActiveFiatWithdrawalAddress: false });
    });
  });

  describe('receiving', () => {
    it('maps each requested asset code to hasReceivingAccount=true when a wallet exists', async () => {
      assets.findByCode.mockResolvedValue({ id: 'asset-usd-id', network: 'AED_ZAND' });
      walletQuery.hasReceivingAccount.mockResolvedValue(true);

      const result = await controller.receiving({ user: { type: 'CUSTOMER', userId: 'cust-1' } }, 'USD');

      expect(assets.findByCode).toHaveBeenCalledWith('USD');
      expect(walletQuery.hasReceivingAccount).toHaveBeenCalledWith('cust-1', 'AED_ZAND');
      expect(result).toEqual({ USD: { hasReceivingAccount: true } });
    });

    it('maps each requested asset code to hasReceivingAccount=false when no wallet exists', async () => {
      assets.findByCode.mockResolvedValue({ id: 'asset-usdt-id', network: 'TRON' });
      walletQuery.hasReceivingAccount.mockResolvedValue(false);

      const result = await controller.receiving({ user: { type: 'CUSTOMER', userId: 'cust-1' } }, 'USDT-TRC20');

      expect(result).toEqual({ 'USDT-TRC20': { hasReceivingAccount: false } });
    });

    it('returns hasReceivingAccount=false for an unknown asset code without calling wallet query', async () => {
      assets.findByCode.mockResolvedValue(null);

      const result = await controller.receiving({ user: { type: 'CUSTOMER', userId: 'cust-1' } }, 'UNKNOWN');

      expect(walletQuery.hasReceivingAccount).not.toHaveBeenCalled();
      expect(result).toEqual({ UNKNOWN: { hasReceivingAccount: false } });
    });

    it('handles multiple comma-separated codes and trims whitespace', async () => {
      assets.findByCode.mockImplementation((code: string) =>
        Promise.resolve(code === 'USD' ? { id: 'asset-usd-id', network: 'AED_ZAND' } : { id: 'asset-usdt-id', network: 'TRON' }),
      );
      walletQuery.hasReceivingAccount.mockImplementation((_customerId: string, network: string) =>
        Promise.resolve(network === 'AED_ZAND'),
      );

      const result = await controller.receiving(
        { user: { type: 'CUSTOMER', userId: 'cust-1' } },
        'USD, USDT-TRC20',
      );

      expect(result).toEqual({
        USD: { hasReceivingAccount: true },
        'USDT-TRC20': { hasReceivingAccount: false },
      });
    });

    it('returns an empty object when assets query param is empty', async () => {
      const result = await controller.receiving({ user: { type: 'CUSTOMER', userId: 'cust-1' } }, '');

      expect(assets.findByCode).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });
  });
});
