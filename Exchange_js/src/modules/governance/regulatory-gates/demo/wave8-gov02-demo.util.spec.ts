import {
  WAVE8_GOV02_DEMO_METADATA_MARKER,
  WAVE8_GOV02_DEMO_LICENSE_RELEASE_PREFIX,
  WAVE8_GOV02_DEMO_SEED,
  WAVE8_GOV02_DEMO_TRACE_PREFIX,
  buildWave8Gov02DemoMetadata,
  buildWave8Gov02DemoTraceId,
  cleanupWave8Gov02DemoData,
} from './wave8-gov02-demo.util';

describe('wave8-gov02-demo util', () => {
  it('builds deterministic demo trace ids and metadata', () => {
    expect(buildWave8Gov02DemoTraceId('CONTROL:GATE')).toBe(
      `${WAVE8_GOV02_DEMO_TRACE_PREFIX}CONTROL:GATE`,
    );
    expect(buildWave8Gov02DemoMetadata('control-change-blocked')).toEqual({
      demo: true,
      seed: WAVE8_GOV02_DEMO_SEED,
      scenario: 'control-change-blocked',
    });
    expect(WAVE8_GOV02_DEMO_METADATA_MARKER).toContain(WAVE8_GOV02_DEMO_SEED);
  });

  it('cleans only demo-tagged gov02 data in dependency-safe order', async () => {
    const prisma: any = {
      regulatoryGateItem: {
        findMany: jest.fn().mockResolvedValue([{ id: 'gate-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      shareholdingRegistryVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: 'shr-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      shareholdingRegistryParticipant: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      appointmentRecord: {
        findMany: jest.fn().mockResolvedValue([{ id: 'apt-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      businessConfigRelease: {
        findMany: jest.fn().mockResolvedValue([{ id: 'rel-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLogEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'aud-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLogSubjectNo: {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };

    const deleted = await cleanupWave8Gov02DemoData(prisma);

    expect(prisma.regulatoryGateItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              traceId: expect.objectContaining({
                startsWith: WAVE8_GOV02_DEMO_TRACE_PREFIX,
              }),
            }),
            expect.objectContaining({
              metadataJson: expect.objectContaining({
                contains: WAVE8_GOV02_DEMO_METADATA_MARKER,
              }),
            }),
          ]),
        }),
      }),
    );
    expect(prisma.auditLogSubjectNo.deleteMany).toHaveBeenCalledWith({
      where: { eventId: { in: ['aud-1'] } },
    });
    expect(prisma.businessConfigRelease.findMany).toHaveBeenCalledWith({
      where: {
        releaseNo: {
          startsWith: WAVE8_GOV02_DEMO_LICENSE_RELEASE_PREFIX,
        },
      },
      select: { id: true },
    });
    expect(prisma.regulatoryGateItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['gate-1'] } },
    });
    expect(prisma.shareholdingRegistryParticipant.deleteMany).toHaveBeenCalledWith({
      where: { versionId: { in: ['shr-1'] } },
    });
    expect(prisma.shareholdingRegistryVersion.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['shr-1'] } },
    });
    expect(prisma.appointmentRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['apt-1'] } },
    });
    expect(prisma.businessConfigRelease.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['rel-1'] } },
    });
    expect(prisma.auditLogEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['aud-1'] } },
    });
    expect(deleted).toEqual({
      regulatory_gate_items: 1,
      shareholding_registry_participants: 2,
      shareholding_registry_versions: 1,
      appointment_records: 1,
      business_config_releases: 1,
      audit_log_subject_nos: 3,
      audit_log_events: 1,
    });
  });
});
