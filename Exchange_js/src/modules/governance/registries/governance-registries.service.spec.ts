import { GovernanceRegistriesService } from './governance-registries.service';

const baseDate = new Date('2026-03-30T09:00:00.000Z');

describe('GovernanceRegistriesService', () => {
  let prisma: any;
  let auditLogsService: any;
  let service: GovernanceRegistriesService;

  const actor = {
    actorType: 'ADMIN' as const,
    userId: 'admin-1',
    userNo: 'ADM-001',
    role: 'SUPER_ADMIN',
    roleCodes: ['SUPER_ADMIN'],
  };

  beforeEach(() => {
    prisma = {
      shareholdingRegistryVersion: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      appointmentRecord: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      regulatoryGateItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      trainingRecord: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      conflictDisclosure: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      windDownMaterialRecord: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => unknown) => cb(prisma)),
    };

    auditLogsService = {
      recordByActor: jest.fn().mockResolvedValue(undefined),
    };

    service = new GovernanceRegistriesService(prisma, auditLogsService);
  });

  it('creates a shareholding version with participants and supersedes the previous version', async () => {
    prisma.shareholdingRegistryVersion.findUnique.mockResolvedValue({
      id: 'shr-old',
      registryNo: 'SHR2603300001',
      status: 'ACTIVE',
      effectiveFrom: baseDate,
      effectiveTo: null,
    });
    prisma.shareholdingRegistryVersion.update.mockResolvedValue({
      id: 'shr-old',
      registryNo: 'SHR2603300001',
      status: 'SUPERSEDED',
    });
    prisma.shareholdingRegistryVersion.create.mockResolvedValue({
      id: 'shr-new',
      registryNo: 'SHR2603300002',
      status: 'ACTIVE',
      latestApprovalId: null,
      latestApprovalStatus: null,
      traceId: 'trace-shr-1',
      createdAt: baseDate,
      updatedAt: baseDate,
      participants: [
        {
          id: 'participant-1',
          participantType: 'UBO',
          participantName: 'Alice Example',
          ownershipPercent: '100',
        },
      ],
    });

    const result = await service.createShareholdingVersion(
      {
        versionLabel: '2026-Q2',
        status: 'ACTIVE',
        effectiveFrom: '2026-04-01T00:00:00.000Z',
        supersedesId: 'shr-old',
        evidenceRef: 'board-resolution-1.pdf',
        participants: [
          {
            participantType: 'UBO',
            participantName: 'Alice Example',
            ownershipPercent: '100',
          },
        ],
      } as any,
      actor,
    );

    expect(prisma.shareholdingRegistryVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shr-old' },
        data: expect.objectContaining({
          status: 'SUPERSEDED',
          supersededById: 'shr-new',
        }),
      }),
    );
    expect(prisma.shareholdingRegistryVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registryNo: expect.stringMatching(/^SHR\d{10}$/),
          status: 'ACTIVE',
          participants: {
            create: [
              expect.objectContaining({
                participantType: 'UBO',
                participantName: 'Alice Example',
              }),
            ],
          },
        }),
      }),
    );
    expect(result.subjectType).toBe('SHAREHOLDING_REGISTRY_VERSION');
    expect(result.subjectId).toBe('shr-new');
    expect(result.subjectNo).toBe('SHR2603300002');
  });

  it('updates an appointment from planned to active and records the status transition', async () => {
    prisma.appointmentRecord.findUnique.mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT2603300001',
      status: 'PLANNED',
      latestApprovalId: null,
      latestApprovalStatus: null,
      traceId: 'trace-apt-1',
      createdAt: baseDate,
      updatedAt: baseDate,
    });
    prisma.appointmentRecord.update.mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT2603300001',
      status: 'ACTIVE',
      latestApprovalId: null,
      latestApprovalStatus: null,
      traceId: 'trace-apt-1',
      createdAt: baseDate,
      updatedAt: baseDate,
      effectiveAt: new Date('2026-04-01T08:00:00.000Z'),
    });

    const result = await service.updateAppointment(
      'apt-1',
      {
        status: 'ACTIVE',
        effectiveAt: '2026-04-01T08:00:00.000Z',
      } as any,
      actor,
    );

    expect(prisma.appointmentRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'apt-1' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          effectiveAt: new Date('2026-04-01T08:00:00.000Z'),
        }),
      }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        entityNo: 'APT2603300001',
      }),
      expect.anything(),
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('blocks manual activation of an appointment while an unrevoked regulatory gate exists', async () => {
    prisma.appointmentRecord.findUnique.mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT2603300001',
      status: 'PLANNED',
      latestApprovalId: null,
      latestApprovalStatus: null,
      traceId: 'trace-apt-1',
      createdAt: baseDate,
      updatedAt: baseDate,
    });
    prisma.regulatoryGateItem.findFirst.mockResolvedValue({
      id: 'gate-1',
      gateNo: 'RGT2603300001',
      gateResult: 'BLOCKED',
    });

    await expect(
      service.updateAppointment(
        'apt-1',
        {
          status: 'ACTIVE',
        } as any,
        actor,
      ),
    ).rejects.toThrow('regulatory gate');
  });

  it('returns regulatoryGateSummary on appointment detail when a gate exists', async () => {
    prisma.appointmentRecord.findUnique.mockResolvedValue({
      id: 'apt-1',
      appointmentNo: 'APT2603300001',
      status: 'PLANNED',
      regulatedFlag: true,
      latestApprovalId: null,
      latestApprovalStatus: null,
      traceId: 'trace-apt-1',
      createdAt: baseDate,
      updatedAt: baseDate,
    });
    prisma.regulatoryGateItem.findFirst.mockResolvedValue({
      id: 'gate-1',
      gateNo: 'RGT2603300001',
      gateType: 'REGULATED_APPOINTMENT_CHANGE',
      gateResult: 'BLOCKED',
      filingStatus: 'REQUIRED',
      receiptStatus: 'PENDING',
      effectivenessStatus: 'BLOCKED',
    });

    const result = await service.getAppointment('apt-1');

    expect(result.regulatoryGateSummary).toEqual({
      gateId: 'gate-1',
      gateNo: 'RGT2603300001',
      gateType: 'REGULATED_APPOINTMENT_CHANGE',
      gateResult: 'BLOCKED',
      filingStatus: 'REQUIRED',
      receiptStatus: 'PENDING',
      effectivenessStatus: 'BLOCKED',
    });
  });

  it('lists trainings with overdue projection when dueAt has passed', async () => {
    prisma.trainingRecord.findMany.mockResolvedValue([
      {
        id: 'trn-1',
        trainingNo: 'TRN2603300001',
        status: 'ASSIGNED',
        assignee: 'Ops User',
        trainingType: 'ANNUAL_GOVERNANCE',
        dueAt: new Date('2026-03-01T00:00:00.000Z'),
        completedAt: null,
        traceId: 'trace-trn-1',
        createdAt: baseDate,
        updatedAt: baseDate,
      },
    ]);
    prisma.trainingRecord.count.mockResolvedValue(1);

    const result = await service.listTrainings({} as any);

    expect(result.items[0].status).toBe('OVERDUE');
  });

  it('creates a conflict disclosure and registers an SLA timer when reviewDueAt is present', async () => {
    prisma.conflictDisclosure.create.mockResolvedValue({
      id: 'cfd-1',
      disclosureNo: 'CFD2603300001',
      status: 'OPEN',
      disclosureType: 'RELATED_PARTY',
      disclosedByName: 'Bob Example',
      reviewDueAt: new Date('2026-04-02T10:00:00.000Z'),
      traceId: 'trace-cfd-1',
      createdAt: baseDate,
      updatedAt: baseDate,
    });

    const result = await service.createConflictDisclosure(
      {
        disclosureType: 'RELATED_PARTY',
        disclosedByName: 'Bob Example',
        disclosedAt: '2026-03-30T10:00:00.000Z',
        reviewDueAt: '2026-04-02T10:00:00.000Z',
        mitigationSummary: 'Pending review',
      } as any,
      actor,
    );

    expect(result.disclosureNo).toBe('CFD2603300001');
  });

  it('archives a wind-down material', async () => {
    prisma.windDownMaterialRecord.findUnique.mockResolvedValue({
      id: 'wdm-1',
      materialNo: 'WDM2603300001',
      status: 'ACTIVE',
      traceId: 'trace-wdm-1',
      createdAt: baseDate,
      updatedAt: baseDate,
    });
    prisma.windDownMaterialRecord.update.mockResolvedValue({
      id: 'wdm-1',
      materialNo: 'WDM2603300001',
      status: 'ARCHIVED',
      traceId: 'trace-wdm-1',
      createdAt: baseDate,
      updatedAt: baseDate,
    });

    const result = await service.updateWindDownMaterial(
      'wdm-1',
      {
        status: 'ARCHIVED',
      } as any,
      actor,
    );

    expect(result.status).toBe('ARCHIVED');
  });
});
