import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';

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
      recordByActor: jest.fn().mockResolvedValue({}),
    };

    workflow = new WithdrawalAddressWorkflowService(
      {} as any, // prisma
      addressService as any,
      auditLogsService as any,
      {} as any, // trAdapter
    );
  });

  it('calls addressService.deactivate and writes ADDRESS_DEACTIVATED audit', async () => {
    const result = await workflow.deactivateAddress('WAD1001', 'cust-1', 'CUST0001', 'Customer requested deactivation');

    expect(addressService.deactivate).toHaveBeenCalledWith('WAD1001', 'cust-1');
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_DEACTIVATED',
        fromStatus: 'ACTIVE',
        toStatus: 'DEACTIVATED',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_DEACTIVATED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CUST0001' }),
    );
    expect(result).toEqual(deactivatedResult);
  });

  it('throws ADDRESS_NOT_FOUND when address does not exist', async () => {
    addressService.findByNo.mockResolvedValue(null);

    await expect(
      workflow.deactivateAddress('WAD9999', 'cust-1', 'CUST0001', 'Customer requested deactivation'),
    ).rejects.toMatchObject({ response: { code: 'ADDRESS_NOT_FOUND' } });

    expect(addressService.deactivate).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('最后一个法币地址停不掉 → 主体层抛 LAST_ACTIVE_FIAT_ADDRESS，workflow 记 DENIED 后原样重抛', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    addressService.deactivate.mockRejectedValue(
      new BadRequestException({ code: 'LAST_ACTIVE_FIAT_ADDRESS', message: '这是最后一个可用法币提现地址' }),
    );

    await expect(workflow.deactivateAddress('WAD1001', 'cust-1', 'CUST0001', 'bye')).rejects.toMatchObject({
      response: { code: 'LAST_ACTIVE_FIAT_ADDRESS' },
    });
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED',
        actionDomain: 'CONFIG',
        outcome: 'DENIED',
        reasonCode: 'LAST_ACTIVE_FIAT_ADDRESS',
        primarySubjectNo: 'WAD1001',
        ownerCustomerNo: 'CUST0001',
      }),
      expect.objectContaining({ actorType: 'CUSTOMER' }),
    );
  });

  it('非五门的错误（ADDRESS_NOT_FOUND 等）不记 DENIED', async () => {
    addressService.findByNo.mockResolvedValue(null);
    await expect(workflow.deactivateAddress('WAD9', 'cust-1', 'CUST0001', 'bye')).rejects.toThrow();
    expect(auditLogsService.recordByActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED' }),
      expect.anything(),
    );
  });

  it('主体层抛非五门的 HttpException（如 NOT_OWNER）→ 原样重抛（同一错误对象），不记 DENIED', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    const err = new ForbiddenException({ code: 'NOT_OWNER', message: 'not yours' });
    addressService.deactivate.mockRejectedValue(err);

    await expect(workflow.deactivateAddress('WAD1001', 'cust-1', 'CUST0001', 'bye')).rejects.toBe(err);

    expect(auditLogsService.recordByActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED' }),
      expect.anything(),
    );
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

  const dto = {
    network: 'TRON',
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
    };
    addressService = {
      hasActiveFiatWithdrawalAddress: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue(createdAddress),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
      recordByActor: jest.fn().mockResolvedValue({}),
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
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED',
        reasonCode: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
      }),
      expect.objectContaining({ actorType: 'CUSTOMER' }),
    );
  });

  it('proceeds when customer has an active fiat withdrawal address', async () => {
    const result = await workflow.registerAddress(dto as any, 'cust-1', 'CUST0001');

    expect(addressService.hasActiveFiatWithdrawalAddress).toHaveBeenCalledWith('cust-1');
    expect(addressService.create).toHaveBeenCalled();
    expect(result).toEqual(createdAddress);
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REGISTERED',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_REGISTERED_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER' }),
    );
  });

  it('rejects a bank-rail network (AED_ZAND) for on-chain registration (NETWORK_NOT_CHAIN)', async () => {
    await expect(
      workflow.registerAddress({ network: 'AED_ZAND', address: 'AE070860000000000000001', label: 'x' } as any, 'cust-1', 'CUST0001'),
    ).rejects.toMatchObject({ response: { code: 'NETWORK_NOT_CHAIN' } });

    expect(addressService.create).not.toHaveBeenCalled();
  });

  it('addressService.create 抛 ADDRESS_LIMIT_REACHED → workflow 记 DENIED（地址还没建出来，无 primarySubjectNo）后原样重抛', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    const err = new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: 'max 3' });
    addressService.create.mockRejectedValue(err);

    await expect(workflow.registerAddress(dto as any, 'cust-1', 'CUST0001')).rejects.toBe(err);

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED',
        reasonCode: 'ADDRESS_LIMIT_REACHED',
        primarySubjectNo: undefined,
        ownerCustomerNo: 'CUST0001',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_REQUEST_DENIED_CUST0001_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER' }),
    );
  });
});

describe('WithdrawalAddressWorkflowService — unsuspendAddress', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let addressService: any;
  let auditLogsService: any;

  const existingAddress = {
    id: 'addr-1',
    addressNo: 'WAD1001',
    customerId: 'cust-1',
    customerNo: 'CUST0001',
    traceId: 'trace-1',
    status: 'SUSPENDED',
  };

  const unsuspendedResult = { ...existingAddress, status: 'ACTIVE' };

  beforeEach(() => {
    addressService = {
      findByNo: jest.fn().mockResolvedValue(existingAddress),
      unsuspend: jest.fn().mockResolvedValue(unsuspendedResult),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({}),
    };

    workflow = new WithdrawalAddressWorkflowService(
      {} as any, // prisma
      addressService as any,
      auditLogsService as any,
      {} as any, // trAdapter
    );
  });

  it('calls addressService.unsuspend and writes WITHDRAWAL_ADDRESS_UNSUSPENDED via recordByActor, reason threaded through', async () => {
    const actor = { userId: 'admin-1', userNo: 'ADM001', role: 'OPS' };
    const result = await workflow.unsuspendAddress('WAD1001', actor, 'False positive cleared');

    expect(addressService.unsuspend).toHaveBeenCalledWith('WAD1001');
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_UNSUSPENDED',
        actionDomain: 'CONFIG',
        primarySubjectNo: 'WAD1001',
        reason: 'False positive cleared',
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: 'CUST0001',
      }),
      expect.objectContaining({ actorType: 'ADMIN', actorNo: 'ADM001' }),
    );
    expect(result).toEqual(unsuspendedResult);
  });

  it('throws ADDRESS_NOT_FOUND when address does not exist', async () => {
    addressService.findByNo.mockResolvedValue(null);

    await expect(
      workflow.unsuspendAddress('WAD9999', { userId: 'admin-1', userNo: 'ADM001', role: 'OPS' }, 'reason'),
    ).rejects.toMatchObject({ response: { code: 'ADDRESS_NOT_FOUND' } });

    expect(addressService.unsuspend).not.toHaveBeenCalled();
  });
});

describe('WithdrawalAddressWorkflowService — updateAddress', () => {
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
    label: 'old label',
    beneficiaryName: null,
  };

  const updatedResult = { ...existingAddress, label: 'new label', beneficiaryName: null };

  beforeEach(() => {
    addressService = {
      findByNo: jest.fn().mockResolvedValue(existingAddress),
      updateDetails: jest.fn().mockResolvedValue(updatedResult),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
      recordByActor: jest.fn().mockResolvedValue({}),
    };

    workflow = new WithdrawalAddressWorkflowService(
      {} as any, // prisma
      addressService as any,
      auditLogsService as any,
      {} as any, // trAdapter
    );
  });

  it('calls addressService.updateDetails and writes WITHDRAWAL_ADDRESS_UPDATED with before/after data', async () => {
    const result = await workflow.updateAddress('WAD1001', 'cust-1', 'CUST0001', { label: 'new label' });

    expect(addressService.updateDetails).toHaveBeenCalledWith('WAD1001', 'cust-1', { label: 'new label' });
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_UPDATED',
        actionDomain: 'CONFIG',
        primarySubjectNo: 'WAD1001',
        beforeData: { label: 'old label', beneficiaryName: null },
        afterData: { label: 'new label', beneficiaryName: null },
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: 'CUST0001',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_UPDATED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CUST0001' }),
    );
    expect(result).toEqual(updatedResult);
  });

  it('throws ADDRESS_NOT_FOUND when address does not exist', async () => {
    addressService.findByNo.mockResolvedValue(null);

    await expect(
      workflow.updateAddress('WAD9999', 'cust-1', 'CUST0001', { label: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'ADDRESS_NOT_FOUND' } });

    expect(addressService.updateDetails).not.toHaveBeenCalled();
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
      recordByActor: jest.fn().mockResolvedValue({}),
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
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REGISTERED',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_REGISTERED_/),
        ownerCustomerNo: 'CUST0001',
      }),
      expect.objectContaining({ actorType: 'CUSTOMER' }),
    );
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });
});

describe('WithdrawalAddressWorkflowService — cancelAddress', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let addressService: any;
  let auditLogsService: any;

  const existingAddress = {
    id: 'addr-1',
    addressNo: 'WAD1001',
    customerId: 'cust-1',
    customerNo: 'CUST0001',
    traceId: 'trace-1',
    status: 'PENDING_ACTIVATION',
  };

  const cancelledResult = { ...existingAddress, status: 'CANCELLED' };

  beforeEach(() => {
    addressService = {
      findByNo: jest.fn().mockResolvedValue(existingAddress),
      cancel: jest.fn().mockResolvedValue(cancelledResult),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({}),
    };

    workflow = new WithdrawalAddressWorkflowService(
      {} as any, // prisma
      addressService as any,
      auditLogsService as any,
      {} as any, // trAdapter
    );
  });

  it('calls addressService.cancel and writes WITHDRAWAL_ADDRESS_CANCELLED audit', async () => {
    const result = await workflow.cancelAddress('WAD1001', 'cust-1', 'CUST0001', 'Customer changed mind');

    expect(addressService.cancel).toHaveBeenCalledWith('WAD1001', 'cust-1');
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_CANCELLED',
        fromStatus: 'PENDING_ACTIVATION',
        toStatus: 'CANCELLED',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_CANCELLED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CUST0001' }),
    );
    expect(result).toEqual(cancelledResult);
  });
});

describe('WithdrawalAddressWorkflowService — suspendAddress', () => {
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

  const suspendedResult = { ...existingAddress, status: 'SUSPENDED' };

  beforeEach(() => {
    addressService = {
      findByNo: jest.fn().mockResolvedValue(existingAddress),
      suspend: jest.fn().mockResolvedValue(suspendedResult),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({}),
    };

    workflow = new WithdrawalAddressWorkflowService(
      {} as any, // prisma
      addressService as any,
      auditLogsService as any,
      {} as any, // trAdapter
    );
  });

  it('calls addressService.suspend and writes WITHDRAWAL_ADDRESS_SUSPENDED audit', async () => {
    const actor = { userId: 'admin-1', userNo: 'ADM001', role: 'OPS' };
    const result = await workflow.suspendAddress('WAD1001', actor, 'Suspicious activity');

    expect(addressService.suspend).toHaveBeenCalledWith('WAD1001', 'ADM001', 'Suspicious activity');
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_SUSPENDED',
        fromStatus: 'ACTIVE',
        toStatus: 'SUSPENDED',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_SUSPENDED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'ADMIN' }),
    );
    expect(result).toEqual(suspendedResult);
  });
});

describe('WithdrawalAddressWorkflowService — skipCoolingPeriod', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let addressService: any;
  let auditLogsService: any;

  const existingAddress = {
    id: 'addr-1',
    addressNo: 'WAD1001',
    customerId: 'cust-1',
    customerNo: 'CUST0001',
    traceId: 'trace-1',
    status: 'PENDING_ACTIVATION',
  };

  const activatedResult = { ...existingAddress, status: 'ACTIVE' };

  beforeEach(() => {
    addressService = {
      findByNo: jest.fn().mockResolvedValue(existingAddress),
      skipCooling: jest.fn().mockResolvedValue(activatedResult),
    };
    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue({}),
    };

    workflow = new WithdrawalAddressWorkflowService(
      {} as any, // prisma
      addressService as any,
      auditLogsService as any,
      {} as any, // trAdapter
    );
  });

  it('calls addressService.skipCooling and writes WITHDRAWAL_ADDRESS_COOLING_SKIPPED audit', async () => {
    const actor = { userId: 'admin-1', userNo: 'ADM001', role: 'OPS' };
    const result = await workflow.skipCoolingPeriod('WAD1001', actor, 'VIP fast-track');

    expect(addressService.skipCooling).toHaveBeenCalledWith('WAD1001');
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_COOLING_SKIPPED',
        fromStatus: 'PENDING_ACTIVATION',
        toStatus: 'ACTIVE',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_COOLING_SKIPPED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'ADMIN' }),
    );
    expect(result).toEqual(activatedResult);
  });
});
