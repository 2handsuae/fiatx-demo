import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { DepositTransactionsController } from './deposit-transactions.controller';
import { DepositTransactionsService } from './deposit-transactions.service';
import { InboundTransferSignalsService } from './inbound-transfer-signals.service';
import { DepositWorkflowService } from './deposit-workflow.service';

describe('DepositTransactionsController', () => {
  let controller: DepositTransactionsController;
  let depositService: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    findOneForCustomerByDepositNo: jest.Mock;
    setSlaDeadlineByNo: jest.Mock;
  };
  let inboundSignalsService: {
    findAllForCustomer: jest.Mock;
    createForCustomer: jest.Mock;
    scanForCustomer: jest.Mock;
  };
  let depositWorkflow: {
    approveDeposit: jest.Mock;
    waiveLimitHold: jest.Mock;
    initiateConfiscation: jest.Mock;
    initiateReturn: jest.Mock;
    initiateSeize: jest.Mock;
    initiateUnfreeze: jest.Mock;
    submitOwnershipClaim: jest.Mock;
  };

  beforeEach(async () => {
    depositService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      findOneForCustomerByDepositNo: jest.fn(),
      setSlaDeadlineByNo: jest.fn(),
    };
    inboundSignalsService = {
      findAllForCustomer: jest.fn(),
      createForCustomer: jest.fn(),
      scanForCustomer: jest.fn(),
    };
    depositWorkflow = {
      approveDeposit: jest.fn(),
      waiveLimitHold: jest.fn(),
      initiateConfiscation: jest.fn(),
      initiateReturn: jest.fn(),
      initiateSeize: jest.fn(),
      initiateUnfreeze: jest.fn(),
      submitOwnershipClaim: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepositTransactionsController],
      providers: [
        {
          provide: DepositTransactionsService,
          useValue: depositService,
        },
        {
          provide: InboundTransferSignalsService,
          useValue: inboundSignalsService,
        },
        {
          provide: DepositWorkflowService,
          useValue: depositWorkflow,
        },
      ],
    }).compile();

    controller = module.get<DepositTransactionsController>(
      DepositTransactionsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('waiveLimitHold rejects a CUSTOMER token with ForbiddenException (no self-waive)', () => {
    expect(() =>
      controller.waiveLimitHold('dep-1', { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(depositWorkflow.waiveLimitHold).not.toHaveBeenCalled();
  });

  it('waiveLimitHold forwards to the workflow with the admin actor for an ADMIN token', async () => {
    depositWorkflow.waiveLimitHold.mockResolvedValue({});

    await controller.waiveLimitHold('dep-1', {
      user: { type: 'ADMIN', userId: 'admin-1', role: 'OPERATOR' },
    });

    expect(depositWorkflow.waiveLimitHold).toHaveBeenCalledWith('dep-1', {
      actorId: 'admin-1',
      actorRole: 'OPERATOR',
    });
  });

  it('confiscate rejects a CUSTOMER token with ForbiddenException (assertAdmin-first)', () => {
    expect(() =>
      controller.confiscate('dep-1', { reason: 'x' }, { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(depositWorkflow.initiateConfiscation).not.toHaveBeenCalled();
  });

  it('confiscate forwards to the workflow with an admin approval actor for an ADMIN token', async () => {
    depositWorkflow.initiateConfiscation.mockResolvedValue({ approvalNo: 'APR-1' });

    await controller.confiscate('dep-1', { reason: 'below min' }, {
      user: { type: 'ADMIN', userId: 'admin-1', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] },
    });

    expect(depositWorkflow.initiateConfiscation).toHaveBeenCalledWith(
      'dep-1',
      { reason: 'below min' },
      expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1', roleCodes: ['OPS_OFFICER'] }),
    );
  });

  // C1 修复轮(Important B)：/return 此前是本域唯一一个没有 assertAdmin 成对测试的
  // maker-checker 端点 —— AdminPermissionGuard 对非 ADMIN token 是 NO-OP,
  // assertAdmin 是这个端点唯一的租户闸,必须钉住。
  it('return rejects a CUSTOMER token with ForbiddenException (assertAdmin-first)', () => {
    expect(() =>
      controller.initiateReturn('dep-1', { reason: 'x' }, { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(depositWorkflow.initiateReturn).not.toHaveBeenCalled();
  });

  it('return forwards to the workflow with an admin approval actor for an ADMIN token', async () => {
    depositWorkflow.initiateReturn.mockResolvedValue({ approvalNo: 'APR-R1' });

    await controller.initiateReturn('dep-1', { reason: 'account suspended' }, {
      user: { type: 'ADMIN', userId: 'admin-1', role: 'MLRO', roleCodes: ['MLRO'] },
    });

    expect(depositWorkflow.initiateReturn).toHaveBeenCalledWith(
      'dep-1',
      { reason: 'account suspended' },
      expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1', roleCodes: ['MLRO'] }),
    );
  });

  it('seize rejects a CUSTOMER token with ForbiddenException (assertAdmin-first)', () => {
    expect(() =>
      controller.seize('dep-1', { reason: 'x', orderRef: 'ORD-1' }, { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(depositWorkflow.initiateSeize).not.toHaveBeenCalled();
  });

  it('seize forwards to the workflow with an admin approval actor for an ADMIN token', async () => {
    depositWorkflow.initiateSeize.mockResolvedValue({ approvalNo: 'APR-S1' });

    await controller.seize('dep-1', { reason: 'gov order', orderRef: 'ORD-1' }, {
      user: { type: 'ADMIN', userId: 'admin-1', role: 'SENIOR_MANAGEMENT_OFFICER', roleCodes: ['SENIOR_MANAGEMENT_OFFICER'] },
    });

    expect(depositWorkflow.initiateSeize).toHaveBeenCalledWith(
      'dep-1',
      { reason: 'gov order', orderRef: 'ORD-1' },
      expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1', roleCodes: ['SENIOR_MANAGEMENT_OFFICER'] }),
    );
  });

  it('unfreeze rejects a CUSTOMER token with ForbiddenException (assertAdmin-first)', () => {
    expect(() =>
      controller.unfreeze('dep-1', { reason: 'x', orderRef: 'ORD-1' }, { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(depositWorkflow.initiateUnfreeze).not.toHaveBeenCalled();
  });

  it('unfreeze forwards to the workflow with an admin approval actor for an ADMIN token', async () => {
    depositWorkflow.initiateUnfreeze.mockResolvedValue({ approvalNo: 'APR-U1' });

    await controller.unfreeze('dep-1', { reason: 'delisted', orderRef: 'ORD-U-1' }, {
      user: { type: 'ADMIN', userId: 'admin-1', role: 'MLRO', roleCodes: ['MLRO'] },
    });

    expect(depositWorkflow.initiateUnfreeze).toHaveBeenCalledWith(
      'dep-1',
      { reason: 'delisted', orderRef: 'ORD-U-1' },
      expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1', roleCodes: ['MLRO'] }),
    );
  });

  // updateStatus() HTTP handler (and its workflow-only-actions guard) retired in
  // Task 4 — see deposit-transactions.controller.ts. The tests that pinned that
  // guard's behavior went with it.

  it('should route customer inbound signal listing through inbound signal service', async () => {
    inboundSignalsService.findAllForCustomer.mockResolvedValue({ items: [], total: 0 });

    await controller.findMyInboundSignals(
      { user: { userId: 'cust-1' } },
      { walletId: 'wallet-1' } as any,
    );

    expect(inboundSignalsService.findAllForCustomer).toHaveBeenCalledWith('cust-1', {
      walletId: 'wallet-1',
    });
  });

  // 对手方波二 Task 5：客户认领提交端点（POST my/:depositNo/ownership-claim）。
  describe('submitMyOwnershipClaim', () => {
    const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

    it('把业务键 + 当前客户 id + DTO 原样交给 workflow，再返回客户视图（按业务键 + 本人重取，不回传内部行）', async () => {
      depositWorkflow.submitOwnershipClaim.mockResolvedValue(undefined);
      depositService.findOneForCustomerByDepositNo.mockResolvedValue({ depositNo: 'DEP-1', status: 'ACTION_PENDING' });
      const dto = { claimType: 'THIRD_PARTY_PERSON', name: 'Alice Wong', relationship: 'Friend' } as any;

      const out = await controller.submitMyOwnershipClaim(customerReq, 'DEP-1', dto);

      expect(depositWorkflow.submitOwnershipClaim).toHaveBeenCalledWith('DEP-1', 'cust-1', dto);
      expect(depositService.findOneForCustomerByDepositNo).toHaveBeenCalledWith('DEP-1', 'cust-1');
      expect(out).toEqual({ depositNo: 'DEP-1', status: 'ACTION_PENDING' });
      // 先提交、后取视图（取视图读到的才是提交之后的快照）
      expect(depositWorkflow.submitOwnershipClaim.mock.invocationCallOrder[0])
        .toBeLessThan(depositService.findOneForCustomerByDepositNo.mock.invocationCallOrder[0]);
    });

    it('workflow 拒绝（403/409/400）时原样上抛，不取视图', async () => {
      depositWorkflow.submitOwnershipClaim.mockRejectedValue(new ForbiddenException('nope'));

      await expect(controller.submitMyOwnershipClaim(customerReq, 'DEP-1', { claimType: 'SELF' } as any))
        .rejects.toThrow(ForbiddenException);
      expect(depositService.findOneForCustomerByDepositNo).not.toHaveBeenCalled();
    });
  });

  it('simulateSlaTimeout rejects a CUSTOMER token with ForbiddenException (no self-service SLA reset)', () => {
    expect(() =>
      controller.simulateSlaTimeout('DEP0001', { user: { type: 'CUSTOMER', userId: 'c1' } }),
    ).toThrow(ForbiddenException);
    expect(depositService.setSlaDeadlineByNo).not.toHaveBeenCalled();
  });

  it('simulateSlaTimeout forwards the depositNo + a past Date + the admin actor to the service', async () => {
    depositService.setSlaDeadlineByNo.mockResolvedValue({});
    const mockReq = { user: { type: 'ADMIN', userId: 'admin-1', role: 'OPERATOR' } };

    await controller.simulateSlaTimeout('DEP0001', mockReq);

    expect(depositService.setSlaDeadlineByNo).toHaveBeenCalledWith(
      'DEP0001',
      expect.any(Date),
      expect.objectContaining({ actorId: 'admin-1', actorRole: 'OPERATOR' }),
    );
    const passed = depositService.setSlaDeadlineByNo.mock.calls[0][1];
    expect(passed.getTime()).toBeLessThan(Date.now());
  });
});
