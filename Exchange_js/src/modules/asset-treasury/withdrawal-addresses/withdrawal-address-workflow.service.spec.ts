import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';
import { AuditGovernanceActions } from '../../audit-logging/constants/audit-actions.constant';

describe('WithdrawalAddressWorkflowService — deactivateAddress', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let addressService: any;
  let auditLogsService: any;

  const existingAddress = {
    id: 'addr-1',
    addressNo: 'WAD1001',
    customerId: 'cust-1',
    customerNo: 'CUST0001',
    traceId: 'trace-1',
    status: 'ACTIVE',
  };

  const deactivatedResult = {
    ...existingAddress,
    status: 'DEACTIVATED',
  };

  beforeEach(() => {
    addressService = {
      findByNo: jest.fn().mockResolvedValue(existingAddress),
      deactivate: jest.fn().mockResolvedValue(deactivatedResult),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
    };

    workflow = new WithdrawalAddressWorkflowService(
      {} as any, // prisma
      addressService as any,
      auditLogsService as any,
      {} as any, // trAdapter
    );
  });

  it('calls addressService.deactivate and writes ADDRESS_DEACTIVATED audit', async () => {
    const result = await workflow.deactivateAddress('WAD1001', 'cust-1', 'CUST0001');

    expect(addressService.deactivate).toHaveBeenCalledWith('WAD1001', 'cust-1');
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_DEACTIVATED,
        entityId: existingAddress.id,
        entityNo: 'WAD1001',
        sourcePlatform: 'CLIENT_API',
        entityOwnerId: 'cust-1',
        entityOwnerNo: 'CUST0001',
      }),
    );
    expect(result).toEqual(deactivatedResult);
  });

  it('throws ADDRESS_NOT_FOUND when address does not exist', async () => {
    addressService.findByNo.mockResolvedValue(null);

    await expect(
      workflow.deactivateAddress('WAD9999', 'cust-1', 'CUST0001'),
    ).rejects.toMatchObject({ response: { code: 'ADDRESS_NOT_FOUND' } });

    expect(addressService.deactivate).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });
});

describe('WithdrawalAddressWorkflowService — registerAddress (crypto) fiat-address gate', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let prisma: any;
  let addressService: any;
  let auditLogsService: any;
  let trAdapter: any;

  const customer = {
    id: 'cust-1',
    lifecycle: 'ACTIVE',
  };

  const cryptoAsset = {
    id: 'asset-1',
    status: 'ACTIVE',
    type: 'CRYPTO',
    network: 'TRC20',
    currency: 'USDT',
  };

  const dto = {
    assetId: 'asset-1',
    address: 'TXsomeaddress',
    label: 'my wallet',
  };

  const createdAddress = {
    id: 'addr-1',
    addressNo: 'WAD1001',
  };

  beforeEach(() => {
    prisma = {
      customerMain: { findUnique: jest.fn().mockResolvedValue(customer) },
      asset: { findUnique: jest.fn().mockResolvedValue(cryptoAsset) },
    };
    addressService = {
      hasActiveFiatWithdrawalAddress: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue(createdAddress),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
    };
    trAdapter = {
      attributeAddress: jest.fn().mockResolvedValue({ attributed: false }),
    };

    workflow = new WithdrawalAddressWorkflowService(
      prisma as any,
      addressService as any,
      auditLogsService as any,
      trAdapter as any,
    );
  });

  it('rejects with NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS when customer has no active fiat address', async () => {
    addressService.hasActiveFiatWithdrawalAddress.mockResolvedValue(false);

    await expect(
      workflow.registerAddress(dto as any, 'cust-1', 'CUST0001'),
    ).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' } });

    expect(addressService.hasActiveFiatWithdrawalAddress).toHaveBeenCalledWith('cust-1');
    expect(addressService.create).not.toHaveBeenCalled();
  });

  it('proceeds when customer has an active fiat withdrawal address', async () => {
    const result = await workflow.registerAddress(dto as any, 'cust-1', 'CUST0001');

    expect(addressService.hasActiveFiatWithdrawalAddress).toHaveBeenCalledWith('cust-1');
    expect(addressService.create).toHaveBeenCalled();
    expect(result).toEqual(createdAddress);
  });
});

describe('WithdrawalAddressWorkflowService — registerBankAccount (fiat) not gated', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let prisma: any;
  let addressService: any;
  let auditLogsService: any;

  const customer = {
    id: 'cust-1',
    lifecycle: 'ACTIVE',
  };

  const fiatAsset = {
    id: 'asset-2',
    status: 'ACTIVE',
    type: 'FIAT',
    currency: 'AED',
  };

  const dto = {
    assetId: 'asset-2',
    iban: 'AE070331234567890123456',
    swiftBic: 'TESTBIC',
    bankName: 'Test Bank',
    beneficiaryName: 'John Doe',
    label: 'my bank',
  };

  const createdAddress = {
    id: 'addr-2',
    addressNo: 'WAD2001',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    prisma = {
      customerMain: { findUnique: jest.fn().mockResolvedValue(customer) },
      asset: { findUnique: jest.fn().mockResolvedValue(fiatAsset) },
    };
    addressService = {
      hasActiveFiatWithdrawalAddress: jest.fn().mockResolvedValue(false),
      createBankAccount: jest.fn().mockResolvedValue(createdAddress),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
    };

    workflow = new WithdrawalAddressWorkflowService(
      prisma as any,
      addressService as any,
      auditLogsService as any,
      {} as any, // trAdapter
    );
  });

  it('does not call hasActiveFiatWithdrawalAddress and proceeds regardless (bootstrap path)', async () => {
    const result = await workflow.registerBankAccount(dto as any, 'cust-1', 'CUST0001');

    expect(addressService.hasActiveFiatWithdrawalAddress).not.toHaveBeenCalled();
    expect(addressService.createBankAccount).toHaveBeenCalled();
    expect(result).toEqual(createdAddress);
  });
});
