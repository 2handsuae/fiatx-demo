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
