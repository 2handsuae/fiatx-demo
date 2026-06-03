import { Test, TestingModule } from '@nestjs/testing';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { FundTransferWorkflowService } from './fund-transfer-workflow.service';

describe('FundTransferWorkflowService', () => {
  let service: FundTransferWorkflowService;
  let transferWorkflow: any;
  let systemWallets: any;

  beforeEach(async () => {
    transferWorkflow = {
      initiate: jest.fn().mockResolvedValue({ id: 'transfer-1' }),
    };
    systemWallets = {
      resolve: jest.fn((assetId: string, role: string) =>
        Promise.resolve({ id: role === 'C_MAIN' ? 'wallet-main' : 'wallet-out' }),
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        FundTransferWorkflowService,
        { provide: InternalTransferWorkflowService, useValue: transferWorkflow },
        { provide: SystemWalletResolver, useValue: systemWallets },
      ],
    }).compile();

    service = moduleRef.get(FundTransferWorkflowService);
    jest.clearAllMocks();
  });

  it('fundOut resolves C_MAIN+C_OUT and initiates FUND_OUT (Main→Outbound)', async () => {
    await service.fundOut(
      {
        withdrawId: 'wd-1',
        withdrawNo: 'WD0001',
        assetId: 'asset-1',
        netAmount: '100',
      },
      'WITHDRAW_WORKFLOW',
    );

    expect(systemWallets.resolve).toHaveBeenCalledWith('asset-1', 'C_MAIN');
    expect(systemWallets.resolve).toHaveBeenCalledWith('asset-1', 'C_OUT');

    expect(transferWorkflow.initiate).toHaveBeenCalledTimes(1);
    const [input, operatorId] = transferWorkflow.initiate.mock.calls[0];
    expect(input).toEqual(
      expect.objectContaining({
        fromRole: 'C_MAIN',
        toRole: 'C_OUT',
        sourceType: 'WITHDRAW',
        sourceId: 'wd-1',
        sourceNo: 'WD0001',
        ownerType: 'PLATFORM',
        ownerId: 'PLATFORM',
        assetId: 'asset-1',
        amount: '100',
        fromWalletId: 'wallet-main',
        toWalletId: 'wallet-out',
        triggerSource: 'WITHDRAW',
      }),
    );
    expect(operatorId).toBe('WITHDRAW_WORKFLOW');
  });

  it('fundOut defaults operatorId to SYSTEM', async () => {
    await service.fundOut({
      withdrawId: 'wd-1',
      withdrawNo: 'WD0001',
      assetId: 'asset-1',
      netAmount: '100',
    });
    expect(transferWorkflow.initiate.mock.calls[0][1]).toBe('SYSTEM');
  });

  it('fundReturn resolves C_MAIN+C_OUT and initiates FUND_RETURN (Outbound→Main)', async () => {
    await service.fundReturn({
      withdrawId: 'wd-1',
      withdrawNo: 'WD0001',
      assetId: 'asset-1',
      amount: '40',
      reason: 'payout aborted, returning funds',
    });

    expect(systemWallets.resolve).toHaveBeenCalledWith('asset-1', 'C_MAIN');
    expect(systemWallets.resolve).toHaveBeenCalledWith('asset-1', 'C_OUT');

    const [input] = transferWorkflow.initiate.mock.calls[0];
    expect(input).toEqual(
      expect.objectContaining({
        fromRole: 'C_OUT',
        toRole: 'C_MAIN',
        sourceType: 'WITHDRAW_RETURN',
        sourceId: 'wd-1',
        sourceNo: 'WD0001',
        assetId: 'asset-1',
        amount: '40',
        fromWalletId: 'wallet-out',
        toWalletId: 'wallet-main',
        triggerSource: 'WITHDRAW',
        note: 'payout aborted, returning funds',
      }),
    );
  });
});
