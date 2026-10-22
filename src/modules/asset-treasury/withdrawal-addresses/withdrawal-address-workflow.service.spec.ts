import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';
import { MockTravelRuleAdapter } from './mock-travel-rule.adapter';
import { BANK_RAIL_NETWORK } from './withdrawal-address.service';

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

describe('WithdrawalAddressWorkflowService — registerAddress (crypto)', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let prisma: any;
  let addressService: any;
  let auditLogsService: any;
  // 用真 mock adapter（尾号 1111 归因 VASP / 2222 YELLOW / 3333 RED）——测试地址驱动结局，不手写 adapter 返回值
  let trAdapter: MockTravelRuleAdapter;

  const customer = {
    id: 'cust-1',
    lifecycle: 'ACTIVE',
  };

  /** 自托管默认 GREEN（无特殊尾号） */
  const PLAIN = 'TXplainaddress0000';
  const VASP_ADDR = 'TXvaspaddress1111';
  const YELLOW_ADDR = 'TXyellowaddress2222';
  const RED_ADDR = 'TXredaddress3333';

  const dto = {
    network: 'TRON',
    address: PLAIN,
    label: 'my wallet',
    ownerType: 'SELF',
    declaredHosting: 'SELF_CUSTODY',
  };

  const createdAddress = {
    id: 'addr-1',
    addressNo: 'WAD1001',
    status: 'PENDING_VERIFICATION',
  };

  /** 取 recordByActor / recordSystem 的 action 序列 */
  const actorActions = () => auditLogsService.recordByActor.mock.calls.map((c: any[]) => c[0].action);
  const systemActions = () => auditLogsService.recordSystem.mock.calls.map((c: any[]) => c[0].action);

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
    trAdapter = new MockTravelRuleAdapter();

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

  describe('DTO 新字段透传 + REGISTERED 快照', () => {
    it('ownerType / declaredHosting / beneficiaryRelationship / beneficiaryName 原样透传到 create；addressType 仍是归因结论', async () => {
      await workflow.registerAddress(
        { ...dto, address: VASP_ADDR, ownerType: 'THIRD_PARTY', declaredHosting: 'VASP', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse' } as any,
        'cust-1',
        'CUST0001',
      );

      expect(addressService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          customerNo: 'CUST0001',
          network: 'TRON',
          address: VASP_ADDR,
          addressType: 'VASP',
          ownerType: 'THIRD_PARTY',
          declaredHosting: 'VASP',
          beneficiaryName: 'Li Hua',
          beneficiaryRelationship: 'Spouse',
          counterpartyVaspName: 'Mock VASP Exchange',
          counterpartyVaspDid: 'did:mock:vasp-exchange-001',
          hostingMismatch: false,
          screeningAnswer: 'GREEN',
        }),
      );
    });

    it('REGISTERED 审计 afterData 带 ownerType / declaredHosting / screeningAnswer / hostingMismatch，correlationId = 传给 create 的 traceId', async () => {
      await workflow.registerAddress(dto as any, 'cust-1', 'CUST0001');

      const traceId = addressService.create.mock.calls[0][0].traceId;
      expect(typeof traceId).toBe('string');
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAWAL_ADDRESS_REGISTERED',
          primarySubjectNo: 'WAD1001',
          correlationId: traceId,
          afterData: expect.objectContaining({
            addressType: 'SELF_CUSTODY',
            address: PLAIN,
            network: 'TRON',
            ownerType: 'SELF',
            declaredHosting: 'SELF_CUSTODY',
            screeningAnswer: 'GREEN',
            hostingMismatch: false,
          }),
        }),
        expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CUST0001' }),
      );
    });

    it('本人 × 自托管一致 × GREEN 的普通登记：只有 REGISTERED 一条，recordSystem 不被调', async () => {
      await workflow.registerAddress(dto as any, 'cust-1', 'CUST0001');

      expect(actorActions()).toEqual(['WITHDRAWAL_ADDRESS_REGISTERED']);
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });
  });

  describe('第三方申报 → THIRD_PARTY_DECLARED（客户主体）', () => {
    const thirdPartyDto = { ...dto, address: VASP_ADDR, ownerType: 'THIRD_PARTY', declaredHosting: 'VASP', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse' };

    it('第三方 crypto 登记 → recordByActor 两次（REGISTERED + THIRD_PARTY_DECLARED），actor 都是客户', async () => {
      await workflow.registerAddress(thirdPartyDto as any, 'cust-1', 'CUST0001');

      expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(2);
      expect(actorActions()).toEqual(['WITHDRAWAL_ADDRESS_REGISTERED', 'WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED']);
      for (const call of auditLogsService.recordByActor.mock.calls) {
        expect(call[1]).toEqual(expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CUST0001' }));
      }
    });

    it('THIRD_PARTY_DECLARED 带申报快照 afterData、correlationId = traceId、显式 requestId、ownerCustomerNo', async () => {
      await workflow.registerAddress(thirdPartyDto as any, 'cust-1', 'CUST0001');

      const traceId = addressService.create.mock.calls[0][0].traceId;
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED',
          actionDomain: 'CONFIG',
          primarySubjectNo: 'WAD1001',
          correlationId: traceId,
          outcome: 'SUCCESS',
          afterData: { beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse', addressNo: 'WAD1001' },
          sourcePlatform: 'CLIENT_API',
          ownerCustomerNo: 'CUST0001',
          requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED_WAD1001_/),
        }),
        expect.objectContaining({ actorType: 'CUSTOMER' }),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });
  });

  describe('托管自报 × 归因交叉 → HOSTING_MISMATCH_FLAGGED（红旗留痕不拦截）', () => {
    it('尾号 1111（归因 VASP）+ 自报 SELF_CUSTODY → create 实参 hostingMismatch:true，recordSystem 记 MISMATCH，登记不被拦', async () => {
      const result = await workflow.registerAddress({ ...dto, address: VASP_ADDR, declaredHosting: 'SELF_CUSTODY' } as any, 'cust-1', 'CUST0001');

      expect(result).toEqual(createdAddress);
      expect(addressService.create).toHaveBeenCalledWith(
        expect.objectContaining({ hostingMismatch: true, declaredHosting: 'SELF_CUSTODY', addressType: 'VASP' }),
      );
      const traceId = addressService.create.mock.calls[0][0].traceId;
      expect(auditLogsService.recordSystem).toHaveBeenCalledTimes(1);
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAWAL_ADDRESS_HOSTING_MISMATCH_FLAGGED',
          actionDomain: 'CONFIG',
          primarySubjectNo: 'WAD1001',
          correlationId: traceId,
          outcome: 'SUCCESS',
          afterData: { declaredHosting: 'SELF_CUSTODY', attributedType: 'VASP', counterpartyVaspName: 'Mock VASP Exchange' },
          ownerCustomerNo: 'CUST0001',
          requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_HOSTING_MISMATCH_FLAGGED_WAD1001_/),
        }),
      );
      // REGISTERED 快照里也标 hostingMismatch:true
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WITHDRAWAL_ADDRESS_REGISTERED', afterData: expect.objectContaining({ hostingMismatch: true }) }),
        expect.anything(),
      );
    });

    it('反向：自托管尾号 + 自报 VASP → 同样 mismatch:true，attributedType = SELF_CUSTODY', async () => {
      await workflow.registerAddress({ ...dto, address: PLAIN, declaredHosting: 'VASP' } as any, 'cust-1', 'CUST0001');

      expect(addressService.create).toHaveBeenCalledWith(expect.objectContaining({ hostingMismatch: true, addressType: 'SELF_CUSTODY' }));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAWAL_ADDRESS_HOSTING_MISMATCH_FLAGGED',
          afterData: { declaredHosting: 'VASP', attributedType: 'SELF_CUSTODY', counterpartyVaspName: undefined },
        }),
      );
    });

    it('自报与归因一致（1111 + VASP）→ hostingMismatch:false，不记 MISMATCH', async () => {
      await workflow.registerAddress({ ...dto, address: VASP_ADDR, declaredHosting: 'VASP' } as any, 'cust-1', 'CUST0001');

      expect(addressService.create).toHaveBeenCalledWith(expect.objectContaining({ hostingMismatch: false }));
      expect(systemActions()).not.toContain('WITHDRAWAL_ADDRESS_HOSTING_MISMATCH_FLAGGED');
    });
  });

  describe('登记时筛查（确定性测试地址）', () => {
    it('尾号 2222 → YELLOW 透传到 create 实参与 REGISTERED 快照；放行、无 REJECTED', async () => {
      await workflow.registerAddress({ ...dto, address: YELLOW_ADDR } as any, 'cust-1', 'CUST0001');

      expect(addressService.create).toHaveBeenCalledWith(expect.objectContaining({ screeningAnswer: 'YELLOW' }));
      expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WITHDRAWAL_ADDRESS_REGISTERED', afterData: expect.objectContaining({ screeningAnswer: 'YELLOW' }) }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
    });

    it('尾号 3333 → RED 透传；落点 REJECTED → REGISTERED（客户）+ REJECTED（recordSystem，固定 reason）双审计', async () => {
      addressService.create.mockResolvedValue({ ...createdAddress, status: 'REJECTED' });

      const result = await workflow.registerAddress({ ...dto, address: RED_ADDR } as any, 'cust-1', 'CUST0001');

      expect(result).toEqual({ ...createdAddress, status: 'REJECTED' });
      expect(addressService.create).toHaveBeenCalledWith(expect.objectContaining({ screeningAnswer: 'RED' }));
      const traceId = addressService.create.mock.calls[0][0].traceId;
      expect(actorActions()).toEqual(['WITHDRAWAL_ADDRESS_REGISTERED']);
      expect(auditLogsService.recordSystem).toHaveBeenCalledTimes(1);
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WITHDRAWAL_ADDRESS_REJECTED',
          actionDomain: 'CONFIG',
          primarySubjectNo: 'WAD1001',
          correlationId: traceId,
          outcome: 'SUCCESS',
          reason: 'Screening returned RED at registration',
          toStatus: 'REJECTED',
          ownerCustomerNo: 'CUST0001',
          requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_REJECTED_WAD1001_/),
        }),
      );
    });

    it('RED 登记不挡 THIRD_PARTY_DECLARED：第三方 × 3333 → REGISTERED + THIRD_PARTY_DECLARED（客户）+ REJECTED（系统）', async () => {
      addressService.create.mockResolvedValue({ ...createdAddress, status: 'REJECTED' });

      await workflow.registerAddress(
        { ...dto, address: RED_ADDR, ownerType: 'THIRD_PARTY', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse' } as any,
        'cust-1',
        'CUST0001',
      );

      expect(actorActions()).toEqual(['WITHDRAWAL_ADDRESS_REGISTERED', 'WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED']);
      expect(systemActions()).toContain('WITHDRAWAL_ADDRESS_REJECTED');
    });
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
        // 申报证据冻结后编辑只剩 label：审计前后像里不再带 beneficiaryName
        beforeData: { label: 'old label' },
        afterData: { label: 'new label' },
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
  let trAdapter: MockTravelRuleAdapter;

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
    ownerType: 'SELF',
  };

  const createdAddress = {
    id: 'addr-2',
    addressNo: 'WAD2001',
    status: 'ACTIVE',
  };

  const actorActions = () => auditLogsService.recordByActor.mock.calls.map((c: any[]) => c[0].action);

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
    trAdapter = new MockTravelRuleAdapter();

    workflow = new WithdrawalAddressWorkflowService(
      prisma as any,
      addressService as any,
      auditLogsService as any,
      trAdapter as any,
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

  it('DTO 新字段透传 + 筛查：默认尾号 → GREEN；screenAddress 以清洗后的 IBAN + 银行通道网络调用', async () => {
    const spy = jest.spyOn(trAdapter, 'screenAddress');

    await workflow.registerBankAccount({ ...dto, iban: 'ae07 0331 2345 6789 0123 456' } as any, 'cust-1', 'CUST0001');

    expect(spy).toHaveBeenCalledWith('AE070331234567890123456', BANK_RAIL_NETWORK);
    expect(addressService.createBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'SELF', screeningAnswer: 'GREEN', beneficiaryName: 'John Doe', bankName: 'Test Bank' }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REGISTERED',
        afterData: expect.objectContaining({ addressType: 'BANK', ownerType: 'SELF', screeningAnswer: 'GREEN', skipCooling: true }),
      }),
      expect.anything(),
    );
  });

  it('银行路径无归因：不调 attributeAddress，也不产生 HOSTING_MISMATCH 红旗', async () => {
    const spy = jest.spyOn(trAdapter, 'attributeAddress');

    await workflow.registerBankAccount(dto as any, 'cust-1', 'CUST0001');

    expect(spy).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('IBAN 尾号 2222 → YELLOW 透传；放行，无 REJECTED', async () => {
    await workflow.registerBankAccount({ ...dto, iban: 'AE070331234567890122222' } as any, 'cust-1', 'CUST0001');

    expect(addressService.createBankAccount).toHaveBeenCalledWith(expect.objectContaining({ screeningAnswer: 'YELLOW' }));
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('IBAN 尾号 3333 → RED 透传；落点 REJECTED → REGISTERED（客户）+ REJECTED（recordSystem，固定 reason）', async () => {
    addressService.createBankAccount.mockResolvedValue({ ...createdAddress, status: 'REJECTED' });

    await workflow.registerBankAccount({ ...dto, iban: 'AE070331234567890123333' } as any, 'cust-1', 'CUST0001');

    expect(addressService.createBankAccount).toHaveBeenCalledWith(expect.objectContaining({ screeningAnswer: 'RED' }));
    const traceId = addressService.createBankAccount.mock.calls[0][0].traceId;
    expect(actorActions()).toEqual(['WITHDRAWAL_ADDRESS_REGISTERED']);
    expect(auditLogsService.recordSystem).toHaveBeenCalledTimes(1);
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REJECTED',
        primarySubjectNo: 'WAD2001',
        correlationId: traceId,
        reason: 'Screening returned RED at registration',
        toStatus: 'REJECTED',
        ownerCustomerNo: 'CUST0001',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_REJECTED_WAD2001_/),
      }),
    );
  });

  it('第三方银行账户 → 透传 ownerType / beneficiaryRelationship，加记 THIRD_PARTY_DECLARED（客户主体，afterData 为申报快照）', async () => {
    await workflow.registerBankAccount(
      { ...dto, ownerType: 'THIRD_PARTY', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse' } as any,
      'cust-1',
      'CUST0001',
    );

    expect(addressService.createBankAccount).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'THIRD_PARTY', beneficiaryRelationship: 'Spouse', beneficiaryName: 'Li Hua' }),
    );
    expect(actorActions()).toEqual(['WITHDRAWAL_ADDRESS_REGISTERED', 'WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED']);
    const traceId = addressService.createBankAccount.mock.calls[0][0].traceId;
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED',
        primarySubjectNo: 'WAD2001',
        correlationId: traceId,
        afterData: { beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse', addressNo: 'WAD2001' },
        ownerCustomerNo: 'CUST0001',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED_WAD2001_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CUST0001' }),
    );
  });
});

describe('WithdrawalAddressWorkflowService — verifyOwnershipSignature', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let addressService: any;
  let auditLogsService: any;

  const existingAddress = {
    id: 'addr-1',
    addressNo: 'WAD1001',
    customerId: 'cust-1',
    customerNo: 'CUST0001',
    traceId: 'trace-1',
    status: 'PENDING_VERIFICATION',
  };
  const releasedResult = { ...existingAddress, status: 'PENDING_ACTIVATION' };

  beforeEach(() => {
    addressService = {
      findByNo: jest.fn().mockResolvedValue(existingAddress),
      verifyOwnershipSignature: jest.fn().mockResolvedValue(releasedResult),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
      recordByActor: jest.fn().mockResolvedValue({}),
    };
    workflow = new WithdrawalAddressWorkflowService({} as any, addressService as any, auditLogsService as any, {} as any);
  });

  it('调主体层（addressNo, customerId）→ 记 OWNERSHIP_VERIFIED：客户主体、fromStatus/toStatus、correlationId = 地址 traceId、显式 requestId', async () => {
    const result = await workflow.verifyOwnershipSignature('WAD1001', 'cust-1', 'CUST0001');

    expect(addressService.verifyOwnershipSignature).toHaveBeenCalledWith('WAD1001', 'cust-1');
    expect(result).toEqual(releasedResult);
    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_OWNERSHIP_VERIFIED',
        actionDomain: 'CONFIG',
        primarySubjectNo: 'WAD1001',
        correlationId: 'trace-1',
        outcome: 'SUCCESS',
        fromStatus: 'PENDING_VERIFICATION',
        toStatus: 'PENDING_ACTIVATION',
        sourcePlatform: 'CLIENT_API',
        ownerCustomerNo: 'CUST0001',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_OWNERSHIP_VERIFIED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CUST0001' }),
    );
  });

  it('地址不存在 → ADDRESS_NOT_FOUND，不调主体层、不写审计', async () => {
    addressService.findByNo.mockResolvedValue(null);

    await expect(workflow.verifyOwnershipSignature('WAD9999', 'cust-1', 'CUST0001')).rejects.toMatchObject({ response: { code: 'ADDRESS_NOT_FOUND' } });

    expect(addressService.verifyOwnershipSignature).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
  });

  it('主体层拒绝（非本人 403 / 不适用 409）→ 原样冒泡，不写 OWNERSHIP_VERIFIED', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const err = new ConflictException({ code: 'SIGNATURE_NOT_APPLICABLE', message: 'not awaiting' });
    addressService.verifyOwnershipSignature.mockRejectedValue(err);

    await expect(workflow.verifyOwnershipSignature('WAD1001', 'cust-1', 'CUST0001')).rejects.toBe(err);

    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
  });
});

describe('WithdrawalAddressWorkflowService — feedScreening（⚡筛查喂）', () => {
  let workflow: WithdrawalAddressWorkflowService;
  let addressService: any;
  let auditLogsService: any;

  const actor = { userId: 'admin-1', userNo: 'ADM001', role: 'COMPLIANCE_OFFICER' };
  const existingAddress = {
    id: 'addr-1',
    addressNo: 'WAD1001',
    customerId: 'cust-1',
    customerNo: 'CUST0001',
    traceId: 'trace-1',
    status: 'PENDING_VERIFICATION',
  };

  beforeEach(() => {
    addressService = {
      findByNo: jest.fn().mockResolvedValue(existingAddress),
      recordScreening: jest.fn().mockResolvedValue({ ...existingAddress, screeningAnswer: 'GREEN' }),
      rejectByScreening: jest.fn().mockResolvedValue({ ...existingAddress, status: 'REJECTED' }),
    };
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({}),
      recordByActor: jest.fn().mockResolvedValue({}),
    };
    workflow = new WithdrawalAddressWorkflowService({} as any, addressService as any, auditLogsService as any, {} as any);
  });

  it.each(['GREEN', 'YELLOW'] as const)('%s → recordScreening(addressNo, answer) + SCREENED 审计（operator，afterData={answer}）；不走 REJECT 边', async (answer) => {
    await workflow.feedScreening('WAD1001', actor, answer, 'Override after manual review');

    expect(addressService.recordScreening).toHaveBeenCalledWith('WAD1001', answer);
    expect(addressService.rejectByScreening).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_SCREENED',
        actionDomain: 'CONFIG',
        primarySubjectNo: 'WAD1001',
        correlationId: 'trace-1',
        outcome: 'SUCCESS',
        afterData: { answer },
        reason: 'Override after manual review',
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: 'CUST0001',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_SCREENED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'ADMIN', actorNo: 'ADM001' }),
    );
  });

  it('RED → rejectByScreening(addressNo) + REJECTED 审计（operator，reason、fromStatus/toStatus）；不走 recordScreening', async () => {
    const result = await workflow.feedScreening('WAD1001', actor, 'RED', 'Sanctions exposure found');

    expect(addressService.rejectByScreening).toHaveBeenCalledWith('WAD1001');
    expect(addressService.recordScreening).not.toHaveBeenCalled();
    expect(result).toEqual({ ...existingAddress, status: 'REJECTED' });
    expect(auditLogsService.recordByActor).toHaveBeenCalledTimes(1);
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REJECTED',
        actionDomain: 'CONFIG',
        primarySubjectNo: 'WAD1001',
        correlationId: 'trace-1',
        outcome: 'SUCCESS',
        reason: 'Sanctions exposure found',
        fromStatus: 'PENDING_VERIFICATION',
        toStatus: 'REJECTED',
        sourcePlatform: 'ADMIN_API',
        ownerCustomerNo: 'CUST0001',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_REJECTED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'ADMIN', actorNo: 'ADM001' }),
    );
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])('reason 必填（%p）→ 400，主体层与审计都不动', async (reason) => {
    await expect(workflow.feedScreening('WAD1001', actor, 'RED', reason as any)).rejects.toThrow('reason is required');

    expect(addressService.rejectByScreening).not.toHaveBeenCalled();
    expect(addressService.recordScreening).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
  });

  it('地址不存在 → ADDRESS_NOT_FOUND', async () => {
    addressService.findByNo.mockResolvedValue(null);

    await expect(workflow.feedScreening('WAD9999', actor, 'GREEN', 'x')).rejects.toMatchObject({ response: { code: 'ADDRESS_NOT_FOUND' } });

    expect(addressService.recordScreening).not.toHaveBeenCalled();
    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
  });

  it('迁移守卫（Review Focus 4）：RED 打在 ACTIVE 行 → 迁移表 409 原样冒泡，REJECTED 审计不写', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const err = new ConflictException('Invalid transition: withdrawal address in ACTIVE cannot REJECT');
    addressService.findByNo.mockResolvedValue({ ...existingAddress, status: 'ACTIVE' });
    addressService.rejectByScreening.mockRejectedValue(err);

    await expect(workflow.feedScreening('WAD1001', actor, 'RED', 'try to kill an active address')).rejects.toBe(err);

    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).not.toHaveBeenCalled();
  });

  it('非 pending 态喂 GREEN/YELLOW → ADDRESS_NOT_PENDING 409 原样冒泡，SCREENED 审计不写', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const err = new ConflictException({ code: 'ADDRESS_NOT_PENDING', message: 'not pending' });
    addressService.findByNo.mockResolvedValue({ ...existingAddress, status: 'ACTIVE' });
    addressService.recordScreening.mockRejectedValue(err);

    await expect(workflow.feedScreening('WAD1001', actor, 'GREEN', 'late override')).rejects.toBe(err);

    expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
  });
});

describe('MockTravelRuleAdapter — screenAddress 确定性尾号规则', () => {
  const adapter = new MockTravelRuleAdapter();

  it.each([
    ['TXabc2222', 'YELLOW'],
    ['TXabc3333', 'RED'],
    ['TXabc1111', 'GREEN'],
    ['TXabc0000', 'GREEN'],
    ['AE070331234567890122222', 'YELLOW'],
    ['AE070331234567890123333', 'RED'],
    ['AE070331234567890123456', 'GREEN'],
  ])('%s → %s', async (address, expected) => {
    await expect(adapter.screenAddress(address, 'TRON')).resolves.toBe(expected);
  });

  it('归因规则不变：仅尾号 1111 → Mock VASP；2222 / 3333 → 自托管', async () => {
    await expect(adapter.attributeAddress('TXabc1111', 'TRON')).resolves.toMatchObject({ attributed: true, vaspName: 'Mock VASP Exchange' });
    await expect(adapter.attributeAddress('TXabc2222', 'TRON')).resolves.toEqual({ attributed: false });
    await expect(adapter.attributeAddress('TXabc3333', 'TRON')).resolves.toEqual({ attributed: false });
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
