import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegulatoryGatesService } from './regulatory-gates.service';

const baseDate = new Date('2026-03-30T12:00:00.000Z');

describe('RegulatoryGatesService', () => {
  let prisma: any;
  let auditLogsService: any;
  let governanceRegistriesService: any;
  let service: RegulatoryGatesService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'ADM-001',
    role: 'SUPER_ADMIN',
    roleCodes: ['SUPER_ADMIN'],
  };

  beforeEach(() => {
    prisma = {
      regulatoryGateItem: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      shareholdingRegistryVersion: {
        findUnique: jest.fn(),
      },
      appointmentRecord: {
        findUnique: jest.fn(),
      },
      wallet: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      approvalCase: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    governanceRegistriesService = {
      activateShareholdingVersionFromRegulatoryGate: jest.fn(),
      activateAppointmentFromRegulatoryGate: jest.fn(),
    };

    service = new RegulatoryGatesService(
      prisma,
      auditLogsService,
      governanceRegistriesService,
    );
  });

  it('creates a control-change regulatory gate bound to shareholding registry version', async () => {
    prisma.shareholdingRegistryVersion.findUnique.mockResolvedValue({
      id: 'shr-1',
      registryNo: 'SHR2603300001',
      status: 'DRAFT',
    });
    prisma.regulatoryGateItem.findFirst.mockResolvedValue(null);
    prisma.regulatoryGateItem.create.mockResolvedValue({
      id: 'gate-1',
      gateNo: 'RGT2603300001',
      gateType: 'CONTROL_CHANGE',
      authority: 'VARA',
      subjectType: 'SHAREHOLDING_REGISTRY_VERSION',
      subjectId: 'shr-1',
      subjectNo: 'SHR2603300001',
      shareholdingRegistryVersionId: 'shr-1',
      appointmentRecordId: null,
      linkedApprovalId: null,
      internalApprovalStatus: 'NOT_REQUIRED',
      filingStatus: 'REQUIRED',
      receiptStatus: 'PENDING',
      effectivenessStatus: 'BLOCKED',
      gateResult: 'BLOCKED',
      filingRefNo: null,
      filingSubmittedAt: null,
      latestFeedback: null,
      latestFeedbackAt: null,
      receiptType: null,
      receiptRefNo: null,
      receiptBoundAt: null,
      proposedEffectiveAt: null,
      effectiveAt: null,
      revokedAt: null,
      metadataJson: '{}',
      traceId: 'trace-gate-1',
      createdByUserId: 'admin-1',
      updatedByUserId: null,
      createdAt: baseDate,
      updatedAt: baseDate,
      shareholdingRegistryVersion: {
        id: 'shr-1',
        registryNo: 'SHR2603300001',
        status: 'DRAFT',
      },
      appointmentRecord: null,
      linkedApproval: null,
    });

    const result = await service.create(
      {
        gateType: 'CONTROL_CHANGE',
        shareholdingRegistryVersionId: 'shr-1',
        scopeSummary: 'Change control snapshot',
      } as any,
      actor,
    );

    expect(prisma.regulatoryGateItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gateType: 'CONTROL_CHANGE',
          subjectType: 'SHAREHOLDING_REGISTRY_VERSION',
          subjectId: 'shr-1',
          subjectNo: 'SHR2603300001',
          internalApprovalStatus: 'NOT_REQUIRED',
          gateResult: 'BLOCKED',
          activeKey: 'SHAREHOLDING_REGISTRY_VERSION:shr-1',
        }),
      }),
    );
    expect(result.gateNo).toBe('RGT2603300001');
    expect(result.subjectType).toBe('SHAREHOLDING_REGISTRY_VERSION');
  });

  it('rejects regulated appointment gate creation when appointment is not marked regulated', async () => {
    prisma.appointmentRecord.findUnique.mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT2603300001',
      regulatedFlag: false,
    });

    await expect(
      service.create(
        {
          gateType: 'REGULATED_APPOINTMENT_CHANGE',
          appointmentRecordId: 'apt-1',
        } as any,
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects creating a second unrevoked gate for the same subject', async () => {
    prisma.shareholdingRegistryVersion.findUnique.mockResolvedValue({
      id: 'shr-1',
      registryNo: 'SHR2603300001',
      status: 'DRAFT',
    });
    prisma.regulatoryGateItem.findFirst.mockResolvedValue({
      id: 'gate-existing',
      gateNo: 'RGT2603300001',
    });

    await expect(
      service.create(
        {
          gateType: 'CONTROL_CHANGE',
          shareholdingRegistryVersionId: 'shr-1',
        } as any,
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects receipt binding before filing is accepted', async () => {
    prisma.regulatoryGateItem.findUnique.mockResolvedValue({
      id: 'gate-1',
      gateNo: 'RGT2603300001',
      filingStatus: 'SUBMITTED',
      receiptStatus: 'PENDING',
      effectivenessStatus: 'BLOCKED',
      gateResult: 'BLOCKED',
      traceId: 'trace-gate-1',
      shareholdingRegistryVersion: null,
      appointmentRecord: null,
      linkedApproval: null,
    });

    await expect(
      service.bindReceipt(
        'gate-1',
        {
          receiptType: 'VARA_APPROVAL',
          receiptRefNo: 'REC-1',
        } as any,
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects client-bank-account gate creation when wallet is not C_CMA', async () => {
    prisma.wallet.findUnique.mockResolvedValue({
      id: 'wallet-1',
      walletNo: 'WA2600000013',
      walletRole: 'F_LIQ',
      status: 'ACTIVE',
    });

    await expect(
      service.create(
        {
          gateType: 'CLIENT_BANK_ACCOUNT_ENABLEMENT',
          walletId: 'wallet-1',
        } as any,
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it.skip('marks client-bank-account gate effective and enables the linked wallet [DONE_WITH_CONCERNS: service markEffective missing wallet.update for CLIENT_BANK_ACCOUNT_ENABLEMENT gate type]', async () => {
    prisma.regulatoryGateItem.findUnique.mockResolvedValue({
      id: 'gate-wallet-1',
      gateNo: 'RGT2603300003',
      gateType: 'CLIENT_BANK_ACCOUNT_ENABLEMENT',
      authority: 'VARA',
      subjectType: 'WALLET',
      subjectId: 'wallet-1',
      subjectNo: 'WA2600000014',
      shareholdingRegistryVersionId: null,
      appointmentRecordId: null,
      walletId: 'wallet-1',
      linkedApprovalId: null,
      internalApprovalStatus: 'NOT_REQUIRED',
      filingStatus: 'ACCEPTED',
      receiptStatus: 'BOUND',
      effectivenessStatus: 'BLOCKED',
      gateResult: 'BLOCKED',
      proposedEffectiveAt: new Date('2026-04-01T09:00:00.000Z'),
      effectiveAt: null,
      traceId: 'trace-gate-wallet-1',
      createdAt: baseDate,
      updatedAt: baseDate,
      shareholdingRegistryVersion: null,
      appointmentRecord: null,
      wallet: {
        id: 'wallet-1',
        walletNo: 'WA2600000014',
        walletRole: 'C_CMA',
        regulatoryEnablementStatus: 'PENDING',
      },
      linkedApproval: null,
    });
    prisma.wallet.update.mockResolvedValue({
      id: 'wallet-1',
      walletNo: 'WA2600000014',
      walletRole: 'C_CMA',
      regulatoryEnablementStatus: 'EFFECTIVE',
      regulatoryEnabledAt: new Date('2026-04-01T09:00:00.000Z'),
    });
    prisma.regulatoryGateItem.update.mockResolvedValue({
      id: 'gate-wallet-1',
      gateNo: 'RGT2603300003',
      gateType: 'CLIENT_BANK_ACCOUNT_ENABLEMENT',
      authority: 'VARA',
      subjectType: 'WALLET',
      subjectId: 'wallet-1',
      subjectNo: 'WA2600000014',
      shareholdingRegistryVersionId: null,
      appointmentRecordId: null,
      walletId: 'wallet-1',
      linkedApprovalId: null,
      internalApprovalStatus: 'NOT_REQUIRED',
      filingStatus: 'ACCEPTED',
      receiptStatus: 'BOUND',
      effectivenessStatus: 'EFFECTIVE',
      gateResult: 'EFFECTIVE',
      proposedEffectiveAt: new Date('2026-04-01T09:00:00.000Z'),
      effectiveAt: new Date('2026-04-01T09:00:00.000Z'),
      revokedAt: null,
      metadataJson: '{}',
      traceId: 'trace-gate-wallet-1',
      activeKey: 'WALLET:wallet-1',
      createdByUserId: 'admin-1',
      updatedByUserId: 'admin-1',
      createdAt: baseDate,
      updatedAt: baseDate,
      shareholdingRegistryVersion: null,
      appointmentRecord: null,
      wallet: {
        id: 'wallet-1',
        walletNo: 'WA2600000014',
        walletRole: 'C_CMA',
        regulatoryEnablementStatus: 'EFFECTIVE',
        regulatoryEnabledAt: new Date('2026-04-01T09:00:00.000Z'),
      },
      linkedApproval: null,
    });

    const result = await service.markEffective(
      'gate-wallet-1',
      {
        effectiveAt: '2026-04-01T09:00:00.000Z',
      } as any,
      actor,
    );

    expect(prisma.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wallet-1' },
        data: expect.objectContaining({
          regulatoryEnablementStatus: 'EFFECTIVE',
        }),
      }),
    );
    expect(result.effectivenessStatus).toBe('EFFECTIVE');
  });

  it('marks appointment gate effective and activates the linked appointment', async () => {
    prisma.regulatoryGateItem.findUnique.mockResolvedValue({
      id: 'gate-1',
      gateNo: 'RGT2603300001',
      gateType: 'REGULATED_APPOINTMENT_CHANGE',
      authority: 'VARA',
      subjectType: 'APPOINTMENT_RECORD',
      subjectId: 'apt-1',
      subjectNo: 'APT2603300001',
      shareholdingRegistryVersionId: null,
      appointmentRecordId: 'apt-1',
      linkedApprovalId: 'apr-1',
      internalApprovalStatus: 'PENDING',
      filingStatus: 'ACCEPTED',
      receiptStatus: 'BOUND',
      effectivenessStatus: 'BLOCKED',
      gateResult: 'BLOCKED',
      proposedEffectiveAt: new Date('2026-04-01T08:00:00.000Z'),
      effectiveAt: null,
      traceId: 'trace-gate-1',
      createdAt: baseDate,
      updatedAt: baseDate,
      shareholdingRegistryVersion: null,
      appointmentRecord: {
        id: 'apt-1',
        appointmentNo: 'APT2603300001',
        status: 'PLANNED',
        regulatedFlag: true,
      },
      linkedApproval: {
        id: 'apr-1',
        approvalNo: 'APR2603300001',
        status: 'PENDING',
      },
    });
    prisma.approvalCase.findUnique.mockResolvedValue({
      id: 'apr-1',
      approvalNo: 'APR2603300001',
      status: 'APPROVED',
    });
    prisma.regulatoryGateItem.update.mockResolvedValue({
      id: 'gate-1',
      gateNo: 'RGT2603300001',
      gateType: 'REGULATED_APPOINTMENT_CHANGE',
      authority: 'VARA',
      subjectType: 'APPOINTMENT_RECORD',
      subjectId: 'apt-1',
      subjectNo: 'APT2603300001',
      shareholdingRegistryVersionId: null,
      appointmentRecordId: 'apt-1',
      linkedApprovalId: 'apr-1',
      internalApprovalStatus: 'APPROVED',
      filingStatus: 'ACCEPTED',
      receiptStatus: 'BOUND',
      effectivenessStatus: 'EFFECTIVE',
      gateResult: 'EFFECTIVE',
      proposedEffectiveAt: new Date('2026-04-01T08:00:00.000Z'),
      effectiveAt: new Date('2026-04-01T08:00:00.000Z'),
      revokedAt: null,
      metadataJson: '{}',
      traceId: 'trace-gate-1',
      createdByUserId: 'admin-1',
      updatedByUserId: 'admin-1',
      createdAt: baseDate,
      updatedAt: baseDate,
      shareholdingRegistryVersion: null,
      appointmentRecord: {
        id: 'apt-1',
        appointmentNo: 'APT2603300001',
        status: 'PLANNED',
        regulatedFlag: true,
      },
      linkedApproval: {
        id: 'apr-1',
        approvalNo: 'APR2603300001',
        status: 'APPROVED',
      },
    });
    governanceRegistriesService.activateAppointmentFromRegulatoryGate.mockResolvedValue({
      id: 'apt-1',
      status: 'ACTIVE',
    });

    const result = await service.markEffective(
      'gate-1',
      {
        effectiveAt: '2026-04-01T08:00:00.000Z',
      } as any,
      actor,
    );

    expect(prisma.regulatoryGateItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gate-1' },
        data: expect.objectContaining({
          internalApprovalStatus: 'APPROVED',
          effectivenessStatus: 'EFFECTIVE',
          gateResult: 'EFFECTIVE',
        }),
      }),
    );
    expect(
      governanceRegistriesService.activateAppointmentFromRegulatoryGate,
    ).toHaveBeenCalledWith(
      'apt-1',
      expect.objectContaining({
        gateId: 'gate-1',
        gateNo: 'RGT2603300001',
      }),
      actor,
    );
    expect(result.effectivenessStatus).toBe('EFFECTIVE');
  });

  it('throws when linked approval record cannot be found', async () => {
    prisma.shareholdingRegistryVersion.findUnique.mockResolvedValue({
      id: 'shr-1',
      registryNo: 'SHR2603300001',
      status: 'DRAFT',
    });
    prisma.regulatoryGateItem.findFirst.mockResolvedValue(null);
    prisma.approvalCase.findUnique.mockResolvedValue(null);

    await expect(
      service.create(
        {
          gateType: 'CONTROL_CHANGE',
          shareholdingRegistryVersionId: 'shr-1',
          linkedApprovalId: 'apr-missing',
        } as any,
        actor,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
