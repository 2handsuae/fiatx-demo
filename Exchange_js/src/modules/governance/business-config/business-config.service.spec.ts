import { BusinessConfigService } from './business-config.service';
import {
  SWAP_POLICY_CODE,
  WITHDRAWAL_POLICY_CODE,
} from '../../trading/pricing-center/types/pricing.types';
import { ChangeTicketStatuses } from './legacy-ct-stubs';
import {
  AuditActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';

function createBusinessConfigPrismaMock() {
  const prisma: any = {
    businessConfigRevision: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    businessConfigRelease: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    businessConfigReleaseItem: {
      create: jest.fn(),
    },
    regulatoryGateItem: {
      findFirst: jest.fn(),
    },
    changeTicket: {
      findFirst: jest.fn(),
    },
    pricingPolicy: {
      upsert: jest.fn(),
    },
    asset: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) =>
    callback(prisma),
  );

  return prisma;
}

function sortRows(rows: Array<Record<string, any>>, orderBy: Array<Record<string, 'asc' | 'desc'>>) {
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const [field, direction] = Object.entries(order)[0];
      const leftValue = left[field];
      const rightValue = right[field];
      if (leftValue === rightValue) continue;
      if (leftValue == null) return direction === 'asc' ? -1 : 1;
      if (rightValue == null) return direction === 'asc' ? 1 : -1;
      if (leftValue < rightValue) return direction === 'asc' ? -1 : 1;
      if (leftValue > rightValue) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

function attachInMemoryGovernanceStore(
  prisma: any,
  options?: {
    revisions?: Array<Record<string, any>>;
    releases?: Array<Record<string, any>>;
    releaseItems?: Array<Record<string, any>>;
    now?: Date;
  },
) {
  const revisions = options?.revisions ? [...options.revisions] : [];
  const releases = options?.releases ? [...options.releases] : [];
  const releaseItems = options?.releaseItems ? [...options.releaseItems] : [];
  const baseNow = options?.now ?? new Date('2026-03-23T10:00:00.000Z');

  const withTimestamps = <T extends Record<string, any>>(row: T): T & { createdAt: Date; updatedAt: Date } => ({
    createdAt: row.createdAt ?? baseNow,
    updatedAt: row.updatedAt ?? baseNow,
    ...row,
  });

  const listReleaseItems = (releaseId: string) =>
    releaseItems
      .filter((item) => item.releaseId === releaseId)
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return String(left.businessKey).localeCompare(String(right.businessKey));
      });

  prisma.businessConfigRevision.findMany.mockImplementation(async ({ where, orderBy }: any = {}) => {
    let rows = [...revisions];
    if (where?.subjectType) {
      rows = rows.filter((item) => item.subjectType === where.subjectType);
    }
    if (where?.businessKey) {
      rows = rows.filter((item) => item.businessKey === where.businessKey);
    }
    if (orderBy) {
      rows = sortRows(rows, orderBy);
    }
    return rows.map((row) => ({ ...row }));
  });

  prisma.businessConfigRevision.create.mockImplementation(async ({ data }: any) => {
    const row = withTimestamps({
      id: `revision-${revisions.length + 1}`,
      ...data,
    });
    revisions.push(row);
    return { ...row };
  });

  prisma.businessConfigRevision.updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const row of revisions) {
      const inIds = where?.id?.in;
      if (Array.isArray(inIds) && !inIds.includes(row.id)) {
        continue;
      }
      Object.assign(row, data, { updatedAt: baseNow });
      count += 1;
    }
    return { count };
  });

  prisma.businessConfigRevision.count.mockImplementation(async ({ where }: any = {}) => {
    return revisions.filter((row) => {
      if (where?.subjectType && row.subjectType !== where.subjectType) return false;
      if (where?.businessKey && row.businessKey !== where.businessKey) return false;
      return true;
    }).length;
  });

  prisma.businessConfigRevision.findUnique.mockImplementation(async ({ where }: any) => {
    const found = revisions.find((row) => row.id === where.id);
    return found ? { ...found } : null;
  });

  prisma.businessConfigRelease.findFirst.mockImplementation(async ({ where, orderBy }: any = {}) => {
    let rows = [...releases];
    if (where?.subjectType) {
      rows = rows.filter((item) => item.subjectType === where.subjectType);
    }
    if (where?.status) {
      rows = rows.filter((item) => item.status === where.status);
    }
    if (orderBy) {
      rows = sortRows(rows, orderBy);
    }
    const found = rows[0];
    return found ? { ...found } : null;
  });

  prisma.businessConfigRelease.findMany.mockImplementation(async ({ where, select, orderBy }: any = {}) => {
    let rows = [...releases];
    if (where?.subjectType) {
      rows = rows.filter((item) => item.subjectType === where.subjectType);
    }
    if (where?.status) {
      rows = rows.filter((item) => item.status === where.status);
    }
    if (orderBy) {
      rows = sortRows(rows, orderBy);
    }
    if (select?.releaseNo) {
      return rows.map((row) => ({ releaseNo: row.releaseNo }));
    }
    return rows.map((row) => ({ ...row }));
  });

  prisma.businessConfigRelease.create.mockImplementation(async ({ data }: any) => {
    const row = withTimestamps({
      id: `release-${releases.length + 1}`,
      ...data,
    });
    releases.push(row);
    return { ...row };
  });

  prisma.businessConfigRelease.findUnique.mockImplementation(async ({ where, include }: any) => {
    const found = releases.find(
      (row) => row.id === where.id || row.releaseNo === where.releaseNo,
    );
    if (!found) {
      return null;
    }
    if (!include?.items) {
      return { ...found };
    }
    return {
      ...found,
      items: listReleaseItems(found.id).map((item) => ({
        ...item,
        revision: revisions.find((revision) => revision.id === item.revisionId),
      })),
    };
  });

  prisma.businessConfigRelease.update.mockImplementation(async ({ where, data }: any) => {
    const found = releases.find((row) => row.id === where.id || row.releaseNo === where.releaseNo);
    if (!found) {
      throw new Error(`Release not found for update: ${JSON.stringify(where)}`);
    }
    Object.assign(found, data, { updatedAt: baseNow });
    return { ...found };
  });

  prisma.businessConfigRelease.updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const row of releases) {
      if (where?.subjectType && row.subjectType !== where.subjectType) continue;
      if (where?.status && row.status !== where.status) continue;
      if (where?.id?.not && row.id === where.id.not) continue;
      Object.assign(row, data, { updatedAt: baseNow });
      count += 1;
    }
    return { count };
  });

  prisma.businessConfigRelease.count.mockImplementation(async ({ where }: any = {}) => {
    return releases.filter((row) => {
      if (where?.subjectType && row.subjectType !== where.subjectType) return false;
      if (where?.status && row.status !== where.status) return false;
      return true;
    }).length;
  });

  prisma.businessConfigReleaseItem.create.mockImplementation(async ({ data }: any) => {
    const row = withTimestamps({
      id: `release-item-${releaseItems.length + 1}`,
      ...data,
    });
    releaseItems.push(row);
    return { ...row };
  });

  return {
    revisions,
    releases,
    releaseItems,
  };
}

describe('BusinessConfigService', () => {
  let prisma: any;
  let auditLogsService: any;
  let service: BusinessConfigService;

  beforeEach(() => {
    prisma = createBusinessConfigPrismaMock();
    auditLogsService = {
      recordSystem: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };
    service = new BusinessConfigService(
      prisma,
      auditLogsService,
      {} as any,
    );
  });

  it('validateRelease should fail pricing releases missing required policies', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    prisma.businessConfigRelease.findUnique.mockResolvedValue({
      id: 'release-pricing-1',
      subjectType: 'PRICING_POLICY',
      releaseNo: 'PRICING_POLICY-REL-001',
      status: 'DRAFT',
      basedOnReleaseNo: null,
      validationSummaryJson: '{}',
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: 'release-item-1',
          businessKey: SWAP_POLICY_CODE,
          revisionId: 'revision-1',
          sortOrder: 1,
          revision: {
            id: 'revision-1',
            businessKey: SWAP_POLICY_CODE,
            revisionNo: 1,
            status: 'STAGED',
            payloadJson: JSON.stringify({
              policyCode: SWAP_POLICY_CODE,
              config: { pairs: [] },
            }),
          },
        },
      ],
    });
    prisma.businessConfigRelease.update.mockResolvedValue({});

    await expect(service.validateRelease('PRICING_POLICY-REL-001')).rejects.toThrow(
      `PricingPolicy release must include both ${SWAP_POLICY_CODE} and ${WITHDRAWAL_POLICY_CODE}`,
    );

    expect(prisma.businessConfigRelease.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'release-pricing-1' },
        data: expect.objectContaining({
          status: 'DRAFT',
        }),
      }),
    );
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.BUSINESS_CONFIG_RELEASE_VALIDATION_FAILED,
        result: AuditResult.FAILED,
        entityNo: 'PRICING_POLICY-REL-001',
      }),
      prisma,
    );
  });

  it('publishRelease should reject change tickets that are not READY', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    prisma.businessConfigRelease.findUnique.mockResolvedValue({
      id: 'release-coa-1',
      subjectType: 'COA',
      releaseNo: 'COA-REL-001',
      status: 'VALIDATED',
      basedOnReleaseNo: null,
      validationSummaryJson: '{}',
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: 'release-item-1',
          businessKey: 'ASSET_CUSTOMER',
          revisionId: 'revision-1',
          sortOrder: 1,
          revision: {
            id: 'revision-1',
            businessKey: 'ASSET_CUSTOMER',
            revisionNo: 1,
            status: 'STAGED',
            payloadJson: JSON.stringify({
              code: 'ASSET_CUSTOMER',
              type: 'ASSET',
              name: 'Customer Asset',
              status: 'ACTIVE',
              requiredTags: [],
            }),
          },
        },
      ],
    });
    prisma.changeTicket.findFirst.mockResolvedValue({
      id: 'ticket-1',
      ticketNo: 'CT-001',
      status: ChangeTicketStatuses.DRAFT,
      approvalCaseId: 'approval-1',
      approvalNo: 'APR-001',
    });

    await expect(service.publishRelease('COA-REL-001', 'CT-001')).rejects.toThrow(
      'Change ticket CT-001 must be READY before publish',
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.BUSINESS_CONFIG_RELEASE_PUBLISH_BLOCKED,
        result: AuditResult.REJECTED,
        entityNo: 'COA-REL-001',
      }),
      undefined,
    );
  });

  it('publishRelease should reject validated release when blocked by license-scope regulatory gate', async () => {
    const now = new Date('2026-03-23T10:00:00.000Z');
    prisma.businessConfigRelease.findUnique.mockResolvedValue({
      id: 'release-coa-1',
      subjectType: 'COA',
      releaseNo: 'COA-REL-001',
      status: 'VALIDATED',
      basedOnReleaseNo: null,
      validationSummaryJson: '{}',
      createdAt: now,
      updatedAt: now,
      items: [],
    });
    prisma.changeTicket.findFirst.mockResolvedValue({
      id: 'ticket-1',
      ticketNo: 'CT-001',
      status: ChangeTicketStatuses.READY,
      approvalCaseId: 'approval-1',
      approvalNo: 'APR-001',
    });
    prisma.regulatoryGateItem.findFirst.mockResolvedValue({
      id: 'gate-1',
      gateNo: 'RGT2603300001',
      gateType: 'LICENSE_SCOPE_CHANGE',
      gateResult: 'BLOCKED',
      effectivenessStatus: 'BLOCKED',
    });

    await expect(service.publishRelease('COA-REL-001', 'CT-001')).rejects.toThrow(
      'Business config release COA-REL-001 is blocked by regulatory gate RGT2603300001',
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should expose release diff and revision history read models', async () => {
    attachInMemoryGovernanceStore(prisma, {
      revisions: [
        {
          id: 'revision-asset-r1',
          subjectType: 'COA',
          businessKey: 'A.CLIENT_CUSTODY',
          revisionNo: 1,
          payloadJson: JSON.stringify({ code: 'A.CLIENT_CUSTODY', name: 'Custody v1' }),
          contentHash: 'hash-r1',
          changeSummary: 'v1',
          status: 'PUBLISHED',
        },
        {
          id: 'revision-asset-r2',
          subjectType: 'COA',
          businessKey: 'A.CLIENT_CUSTODY',
          revisionNo: 2,
          payloadJson: JSON.stringify({ code: 'A.CLIENT_CUSTODY', name: 'Custody v2' }),
          contentHash: 'hash-r2',
          changeSummary: 'v2',
          status: 'PUBLISHED',
        },
        {
          id: 'revision-liab-r1',
          subjectType: 'COA',
          businessKey: 'L.CLIENT',
          revisionNo: 1,
          payloadJson: JSON.stringify({ code: 'L.CLIENT', name: 'Client Liability' }),
          contentHash: 'hash-liab',
          changeSummary: 'v1',
          status: 'PUBLISHED',
        },
      ],
      releases: [
        {
          id: 'release-coa-1',
          subjectType: 'COA',
          releaseNo: 'COA-REL-001',
          status: 'SUPERSEDED',
          basedOnReleaseNo: null,
          validationSummaryJson: '{}',
        },
        {
          id: 'release-coa-2',
          subjectType: 'COA',
          releaseNo: 'COA-REL-002',
          status: 'ACTIVE',
          basedOnReleaseNo: 'COA-REL-001',
          validationSummaryJson: '{}',
        },
      ],
      releaseItems: [
        {
          id: 'release-item-1',
          releaseId: 'release-coa-1',
          revisionId: 'revision-asset-r1',
          subjectType: 'COA',
          businessKey: 'A.CLIENT_CUSTODY',
          sortOrder: 1,
        },
        {
          id: 'release-item-2',
          releaseId: 'release-coa-2',
          revisionId: 'revision-asset-r2',
          subjectType: 'COA',
          businessKey: 'A.CLIENT_CUSTODY',
          sortOrder: 1,
        },
        {
          id: 'release-item-3',
          releaseId: 'release-coa-2',
          revisionId: 'revision-liab-r1',
          subjectType: 'COA',
          businessKey: 'L.CLIENT',
          sortOrder: 2,
        },
      ],
    });

    const diff = await service.getReleaseDiff('COA-REL-002');
    const revisions = await service.listRevisions({
      subjectType: 'COA',
      businessKey: 'A.CLIENT_CUSTODY',
    });

    expect(diff.items).toEqual([
      {
        businessKey: 'A.CLIENT_CUSTODY',
        action: 'CHANGED',
        fromRevisionNo: 1,
        toRevisionNo: 2,
      },
      {
        businessKey: 'L.CLIENT',
        action: 'ADDED',
        fromRevisionNo: null,
        toRevisionNo: 1,
      },
    ]);
    expect(revisions.total).toBe(2);
    expect(revisions.items.map((item: any) => item.revisionNo)).toEqual([2, 1]);
    expect(revisions.items[0].payload).toEqual(
      expect.objectContaining({
        code: 'A.CLIENT_CUSTODY',
        name: 'Custody v2',
      }),
    );
  });
});
