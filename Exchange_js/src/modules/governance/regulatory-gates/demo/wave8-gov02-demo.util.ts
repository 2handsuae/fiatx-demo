export const WAVE8_GOV02_DEMO_SEED = 'wave8-gov02-demo';
export const WAVE8_GOV02_DEMO_TRACE_PREFIX = 'W8-GOV02-DEMO:';
export const WAVE8_GOV02_DEMO_METADATA_MARKER = `"seed":"${WAVE8_GOV02_DEMO_SEED}"`;

export const WAVE8_GOV02_DEMO_API_PATHS = [
  'GET /admin/governance/regulatory-gates',
  'GET /admin/governance/regulatory-gates/:id',
  'GET /admin/governance/registries/shareholding-versions/:id',
  'GET /admin/governance/registries/appointments/:id',
  'GET /wallets/:id',
] as const;

type DeleteManyCapableDelegate = {
  deleteMany?: (args?: Record<string, unknown>) => Promise<{ count: number }>;
  findMany?: (args?: Record<string, unknown>) => Promise<Array<{ id: string }>>;
};

type Gov02DemoCleanupCapablePrisma = {
  regulatoryGateItem?: DeleteManyCapableDelegate;
  shareholdingRegistryVersion?: DeleteManyCapableDelegate;
  shareholdingRegistryParticipant?: DeleteManyCapableDelegate;
  appointmentRecord?: DeleteManyCapableDelegate;
  auditLogEvent?: DeleteManyCapableDelegate;
  auditLogSubjectNo?: DeleteManyCapableDelegate;
};

export function buildWave8Gov02DemoTraceId(suffix: string) {
  return `${WAVE8_GOV02_DEMO_TRACE_PREFIX}${suffix}`;
}

export function buildWave8Gov02DemoMetadata(scenario: string) {
  return {
    demo: true,
    seed: WAVE8_GOV02_DEMO_SEED,
    scenario,
  };
}

function buildDemoRecordWhere() {
  return {
    OR: [
      {
        traceId: {
          startsWith: WAVE8_GOV02_DEMO_TRACE_PREFIX,
        },
      },
      {
        metadataJson: {
          contains: WAVE8_GOV02_DEMO_METADATA_MARKER,
        },
      },
    ],
  };
}

async function findIds(
  delegate: DeleteManyCapableDelegate | undefined,
  where: Record<string, unknown>,
) {
  if (!delegate?.findMany) return [] as string[];
  const rows = await delegate.findMany({
    where,
    select: { id: true },
  });
  return rows.map((item) => item.id);
}

async function deleteMany(
  delegate: DeleteManyCapableDelegate | undefined,
  where?: Record<string, unknown>,
) {
  if (!delegate?.deleteMany) return 0;
  const result = await delegate.deleteMany(where ? { where } : undefined);
  return result.count ?? 0;
}

export async function cleanupWave8Gov02DemoData(
  prisma: Gov02DemoCleanupCapablePrisma,
) {
  const demoRecordWhere = buildDemoRecordWhere();
  const auditEventWhere = {
    traceId: {
      startsWith: WAVE8_GOV02_DEMO_TRACE_PREFIX,
    },
  };

  const [
    gateIds,
    shareholdingIds,
    appointmentIds,
    auditEventIds,
  ] = await Promise.all([
    findIds(prisma.regulatoryGateItem, demoRecordWhere),
    findIds(prisma.shareholdingRegistryVersion, demoRecordWhere),
    findIds(prisma.appointmentRecord, demoRecordWhere),
    findIds(prisma.auditLogEvent, auditEventWhere),
  ]);

  const deleted = {
    regulatory_gate_items: 0,
    shareholding_registry_participants: 0,
    shareholding_registry_versions: 0,
    appointment_records: 0,
    audit_log_subject_nos: 0,
    audit_log_events: 0,
  };

  if (auditEventIds.length) {
    deleted.audit_log_subject_nos = await deleteMany(prisma.auditLogSubjectNo, {
      eventId: { in: auditEventIds },
    });
  }

  if (gateIds.length) {
    deleted.regulatory_gate_items = await deleteMany(prisma.regulatoryGateItem, {
      id: { in: gateIds },
    });
  }

  if (shareholdingIds.length) {
    deleted.shareholding_registry_participants = await deleteMany(
      prisma.shareholdingRegistryParticipant,
      {
        versionId: { in: shareholdingIds },
      },
    );
    deleted.shareholding_registry_versions = await deleteMany(
      prisma.shareholdingRegistryVersion,
      {
        id: { in: shareholdingIds },
      },
    );
  }

  if (appointmentIds.length) {
    deleted.appointment_records = await deleteMany(prisma.appointmentRecord, {
      id: { in: appointmentIds },
    });
  }

  if (auditEventIds.length) {
    deleted.audit_log_events = await deleteMany(prisma.auditLogEvent, {
      id: { in: auditEventIds },
    });
  }

  return deleted;
}
