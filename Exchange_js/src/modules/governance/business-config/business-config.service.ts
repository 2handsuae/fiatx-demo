import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessConfigRelease,
  BusinessConfigReleaseItem,
  BusinessConfigRevision,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { createHash, randomUUID } from 'crypto';
import {
  buildDefaultPricingPolicyManifest,
  PricingPolicyManifestAsset,
  PricingPolicyManifestItem,
} from '../../../config/manifests/pricing-policies.manifest';
import {
  AssetConfigManifestItem,
  DEFAULT_ASSET_CONFIGS,
} from '../../../config/manifests/asset-config.manifest';
import { ChangeTicketStatuses, LegacyChangeTicketsServiceStub } from './legacy-ct-stubs';
import {
  RegulatoryGateEffectivenessStatuses,
  RegulatoryGateSubjectTypes,
  RegulatoryGateTypes,
} from '../regulatory-gates/constants/regulatory-gates.constants';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditResult,
} from '../../audit-logging/dto/audit-log.dto';
import {
  BusinessConfigDiffItem,
  BusinessConfigReleaseStatus,
  BusinessConfigRevisionStatus,
  BusinessConfigSubjectType,
  BusinessConfigValidationSummary,
  BUSINESS_CONFIG_RELEASE_STATUSES,
  BUSINESS_CONFIG_REVISION_STATUSES,
} from './business-config.types';
import {
  SWAP_POLICY_CODE,
  WITHDRAWAL_POLICY_CODE,
} from '../../trading/pricing-center/types/pricing.types';

type GovernanceClient = PrismaService | Prisma.TransactionClient;
type PricingPolicyManifestPayload = PricingPolicyManifestItem;
type AssetConfigManifestPayload = AssetConfigManifestItem;
type ManifestPayload =
  | PricingPolicyManifestPayload
  | AssetConfigManifestPayload;
type ManifestEntry = {
  businessKey: string;
  payload: ManifestPayload;
};

type ParsedReleaseItem<TPayload extends Record<string, unknown>> = {
  businessKey: string;
  revisionId: string;
  payload: TPayload;
};
type BusinessConfigRevisionRow = BusinessConfigRevision;
type BusinessConfigReleaseItemRow = BusinessConfigReleaseItem & {
  revision: BusinessConfigRevisionRow;
};
type BusinessConfigReleaseRow = BusinessConfigRelease & {
  items?: BusinessConfigReleaseItemRow[];
};

@Injectable()
export class BusinessConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly changeTicketsService: LegacyChangeTicketsServiceStub,
  ) {}

  private normalizeSubjectType(input: string): BusinessConfigSubjectType {
    const normalized = String(input || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    switch (normalized) {
      case 'PRICING_POLICY':
      case 'PRICINGPOLICY':
      case 'PRICING':
        return 'PRICING_POLICY';
      case 'ASSET_CONFIG':
      case 'ASSETCONFIG':
        return 'ASSET_CONFIG';
      default:
        throw new BadRequestException(`Unsupported business config subjectType: ${input}`);
    }
  }

  private normalizeTake(take?: number): number {
    if (!take || take < 1) return 20;
    return Math.min(take, 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || skip < 0) return 0;
    return skip;
  }

  private stableSortObject(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.stableSortObject(item));
    }
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = this.stableSortObject((value as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return value;
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.stableSortObject(value));
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(this.stableStringify(payload)).digest('hex');
  }

  private parseJson<T>(value: string, label: string): T {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      throw new BadRequestException(`Failed to parse ${label}: ${String(error)}`);
    }
  }

  private sourceCommitSha(): string | null {
    const candidates = [
      process.env.SOURCE_COMMIT_SHA,
      process.env.GIT_COMMIT,
      process.env.GITHUB_SHA,
    ];
    for (const candidate of candidates) {
      const normalized = String(candidate || '').trim();
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  private async getPricingManifestEntries(): Promise<ManifestEntry[]> {
    const activeAssets = (await this.prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ type: 'asc' }, { code: 'asc' }, { network: 'asc' }],
      select: {
        id: true,
        code: true,
        type: true,
        network: true,
        decimals: true,
      },
    })) as PricingPolicyManifestAsset[];

    return buildDefaultPricingPolicyManifest(activeAssets)
      .map((item) => ({
        businessKey: item.policyCode,
        payload: item,
      }))
      .sort((left, right) => left.businessKey.localeCompare(right.businessKey));
  }

  private async getManifestEntries(subjectType: BusinessConfigSubjectType): Promise<ManifestEntry[]> {
    if (subjectType === 'PRICING_POLICY') {
      return this.getPricingManifestEntries();
    }

    if (subjectType === 'ASSET_CONFIG') {
      return DEFAULT_ASSET_CONFIGS.map((item) => ({
        businessKey: item.assetNo,
        payload: item,
      })).sort((left, right) => left.businessKey.localeCompare(right.businessKey));
    }

    throw new BadRequestException(`Unsupported subjectType: ${subjectType}`);
  }

  private async getLatestRevisionMap(
    subjectType: BusinessConfigSubjectType,
  ): Promise<Map<string, BusinessConfigRevisionRow>> {
    const rows = await this.prisma.businessConfigRevision.findMany({
      where: { subjectType },
      orderBy: [{ businessKey: 'asc' }, { revisionNo: 'desc' }],
    });

    const latest = new Map<string, BusinessConfigRevisionRow>();
    for (const row of rows) {
      if (!latest.has(row.businessKey)) {
        latest.set(row.businessKey, row);
      }
    }
    return latest;
  }

  private async getActiveRelease(
    subjectType: BusinessConfigSubjectType,
  ): Promise<BusinessConfigRelease | null> {
    return this.prisma.businessConfigRelease.findFirst({
      where: {
        subjectType,
        status: BUSINESS_CONFIG_RELEASE_STATUSES.ACTIVE,
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async nextReleaseNo(subjectType: BusinessConfigSubjectType): Promise<string> {
    const rows = await this.prisma.businessConfigRelease.findMany({
      where: { subjectType },
      select: { releaseNo: true },
    });

    let maxNo = 0;
    for (const row of rows) {
      const match = String(row.releaseNo || '').match(/REL-(\d+)$/);
      if (!match) continue;
      maxNo = Math.max(maxNo, Number(match[1]));
    }
    return `${subjectType}-REL-${String(maxNo + 1).padStart(3, '0')}`;
  }

  private async findReleaseOrThrow(
    releaseNo: string,
  ): Promise<BusinessConfigReleaseRow> {
    const found = await this.prisma.businessConfigRelease.findUnique({
      where: { releaseNo },
      include: {
        items: {
          include: {
            revision: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { businessKey: 'asc' }],
        },
      },
    });

    if (!found) {
      throw new NotFoundException(`Business config release not found: ${releaseNo}`);
    }

    return found;
  }

  private mapRevision(row: BusinessConfigRevisionRow) {
    return {
      id: row.id,
      subjectType: row.subjectType,
      businessKey: row.businessKey,
      revisionNo: row.revisionNo,
      contentHash: row.contentHash,
      changeSummary: row.changeSummary,
      status: row.status,
      sourceCommitSha: row.sourceCommitSha,
      payload: this.parseJson<Record<string, unknown>>(row.payloadJson, 'revision payload'),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapRelease(row: BusinessConfigReleaseRow) {
    return {
      id: row.id,
      subjectType: row.subjectType,
      releaseNo: row.releaseNo,
      status: row.status,
      basedOnReleaseNo: row.basedOnReleaseNo,
      changeTicketId: row.changeTicketId,
      approvalCaseId: row.approvalCaseId,
      traceId: row.traceId,
      effectiveFrom: row.effectiveFrom,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy,
      validationSummary: this.parseJson<Record<string, unknown>>(
        row.validationSummaryJson || '{}',
        'release validation summary',
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      itemCount: Array.isArray(row.items) ? row.items.length : undefined,
      items: Array.isArray(row.items)
        ? row.items.map((item) => ({
            id: item.id,
            businessKey: item.businessKey,
            sortOrder: item.sortOrder,
            revisionId: item.revisionId,
            revisionNo: item.revision.revisionNo,
            revisionStatus: item.revision.status,
            payload: this.parseJson<Record<string, unknown>>(
              item.revision.payloadJson,
              `release item ${item.businessKey} payload`,
            ),
          }))
        : undefined,
    };
  }

  private async findRegulatoryGateSummaryForRelease(releaseId: string) {
    const gate = await this.prisma.regulatoryGateItem.findFirst({
      where: {
        subjectType: RegulatoryGateSubjectTypes.BUSINESS_CONFIG_RELEASE,
        subjectId: releaseId,
        revokedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        gateNo: true,
        gateType: true,
        gateResult: true,
        filingStatus: true,
        receiptStatus: true,
        effectivenessStatus: true,
      },
    });

    if (!gate) {
      return null;
    }

    return {
      gateId: gate.id,
      gateNo: gate.gateNo,
      gateType: gate.gateType,
      gateResult: gate.gateResult,
      filingStatus: gate.filingStatus,
      receiptStatus: gate.receiptStatus,
      effectivenessStatus: gate.effectivenessStatus,
    };
  }

  private buildReleaseAuditData(
    release: Pick<
      BusinessConfigRelease,
      | 'id'
      | 'subjectType'
      | 'releaseNo'
      | 'status'
      | 'changeTicketId'
      | 'approvalCaseId'
    >,
    extras?: {
      ticketNo?: string | null;
      changeTicketRef?: string | null;
      approvalNo?: string | null;
      validationSummary?: BusinessConfigValidationSummary;
    },
  ) {
    return {
      subjectType: release.subjectType,
      releaseNo: release.releaseNo,
      status: release.status,
      changeTicketId: release.changeTicketId,
      approvalCaseId: release.approvalCaseId,
      ticketNo: extras?.ticketNo ?? null,
      changeTicketRef: extras?.changeTicketRef ?? null,
      approvalNo: extras?.approvalNo ?? null,
      validationSummary: extras?.validationSummary,
    };
  }

  private async recordReleaseAudit(
    release: Pick<
      BusinessConfigRelease,
      | 'id'
      | 'subjectType'
      | 'releaseNo'
      | 'status'
      | 'changeTicketId'
      | 'approvalCaseId'
    >,
    input: {
      action: string;
      result?: AuditResult;
      reason: string;
      traceId?: string;
      ticketNo?: string | null;
      changeTicketRef?: string | null;
      approvalNo?: string | null;
      validationSummary?: BusinessConfigValidationSummary;
      client?: Prisma.TransactionClient;
    },
  ) {
    return this.auditLogsService.recordSystem(
      {
        action: input.action,
        entityType: AuditEntityTypes.CONFIG,
        entityId: release.id,
        entityNo: release.releaseNo,
        result: input.result ?? AuditResult.SUCCESS,
        reason: input.reason,
        traceId: input.traceId,
        workflowType: AuditBusinessWorkflowTypes.BUSINESS_CONFIG_CHANGE,
        metadata: this.buildReleaseAuditData(release, {
          ticketNo: input.ticketNo,
          changeTicketRef: input.changeTicketRef,
          approvalNo: input.approvalNo,
          validationSummary: input.validationSummary,
        }),
        idempotencyKey: `business-config:${release.releaseNo}:${input.action}`,
        sourcePlatform: 'SYSTEM',
      },
      input.client,
    );
  }

  private async validatePricingPolicyRelease(
    items: Array<ParsedReleaseItem<PricingPolicyManifestPayload>>,
  ): Promise<string[]> {
    const issues: string[] = [];
    const keys = new Set(items.map((item) => item.businessKey));
    if (!keys.has(SWAP_POLICY_CODE) || !keys.has(WITHDRAWAL_POLICY_CODE)) {
      issues.push(
        `PricingPolicy release must include both ${SWAP_POLICY_CODE} and ${WITHDRAWAL_POLICY_CODE}`,
      );
    }

    return issues;
  }

  private async validateAssetConfigRelease(
    items: Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
  ): Promise<string[]> {
    const issues: string[] = [];
    const VALID_TYPES = new Set(['FIAT', 'CRYPTO']);
    const VALID_STATUSES = new Set(['ACTIVE', 'DISABLED']);

    for (const item of items) {
      const payload = item.payload;

      // Required fields
      if (!payload.assetNo || !payload.code || !payload.type || payload.depositMinAmount == null || payload.withdrawMinAmount == null) {
        issues.push(`AssetConfig ${item.businessKey} requires assetNo, code, type, depositMinAmount, and withdrawMinAmount`);
        continue;
      }

      // type must be FIAT or CRYPTO
      if (!VALID_TYPES.has(String(payload.type))) {
        issues.push(`AssetConfig ${item.businessKey} type must be FIAT or CRYPTO, got: ${payload.type}`);
      }

      // status must be ACTIVE or DISABLED
      if (!VALID_STATUSES.has(String(payload.status))) {
        issues.push(`AssetConfig ${item.businessKey} status must be ACTIVE or DISABLED, got: ${payload.status}`);
      }

      // decimals must be a non-negative integer
      const decimals = Number(payload.decimals);
      if (!Number.isInteger(decimals) || decimals < 0) {
        issues.push(`AssetConfig ${item.businessKey} decimals must be a non-negative integer`);
      }

      // depositMinAmount
      const minDeposit = Number(payload.depositMinAmount);
      if (isNaN(minDeposit) || minDeposit < 0) {
        issues.push(`AssetConfig ${item.businessKey} depositMinAmount must be a non-negative number`);
      }

      // withdrawMinAmount
      const minWithdraw = Number(payload.withdrawMinAmount);
      if (isNaN(minWithdraw) || minWithdraw < 0) {
        issues.push(`AssetConfig ${item.businessKey} withdrawMinAmount must be a non-negative number`);
      }

      // minConfirmations: null for FIAT, positive integer for CRYPTO
      if (payload.type === 'FIAT') {
        if (payload.minConfirmations != null) {
          issues.push(`AssetConfig ${item.businessKey} (FIAT) minConfirmations must be null`);
        }
      } else if (payload.type === 'CRYPTO') {
        if (payload.minConfirmations == null) {
          issues.push(`AssetConfig ${item.businessKey} (CRYPTO) minConfirmations is required`);
        } else {
          const confs = Number(payload.minConfirmations);
          if (!Number.isInteger(confs) || confs < 1) {
            issues.push(`AssetConfig ${item.businessKey} minConfirmations must be a positive integer`);
          }
        }
      }
    }
    return issues;
  }

  private async validateReleaseItems(
    subjectType: BusinessConfigSubjectType,
    items: Array<ParsedReleaseItem<Record<string, unknown>>>,
  ): Promise<BusinessConfigValidationSummary> {
    const issues: string[] = [];
    const warnings: string[] = [];

    if (!items.length) {
      issues.push(`Release snapshot is empty for ${subjectType}`);
    }

    const seenKeys = new Set<string>();
    for (const item of items) {
      if (seenKeys.has(item.businessKey)) {
        issues.push(`Duplicate businessKey in release: ${item.businessKey}`);
      }
      seenKeys.add(item.businessKey);
    }

    if (subjectType === 'PRICING_POLICY') {
      issues.push(
        ...(await this.validatePricingPolicyRelease(
          items as Array<ParsedReleaseItem<PricingPolicyManifestPayload>>,
        )),
      );
    } else if (subjectType === 'ASSET_CONFIG') {
      issues.push(
        ...(await this.validateAssetConfigRelease(
          items as Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
        )),
      );
    }

    return {
      ok: issues.length === 0,
      issues,
      warnings,
      validatedAt: new Date().toISOString(),
    };
  }

  private async projectAssetConfig(
    tx: GovernanceClient,
    items: Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
  ): Promise<void> {
    const activeAssetNos = items.map((item) => String(item.payload.assetNo));

    for (const item of items) {
      const payload = item.payload;
      const network = payload.network ? String(payload.network) : null;
      const assetRecord = {
        assetNo: String(payload.assetNo),
        type: String(payload.type),
        currency: String(payload.code),
        code: network ? `${String(payload.code)}-${network}` : String(payload.code),
        network,
        decimals: Number(payload.decimals),
        description: payload.description ? String(payload.description) : null,
        status: String(payload.status),
      };
      await tx.asset.upsert({
        where: { assetNo: String(payload.assetNo) },
        update: assetRecord,
        create: assetRecord,
      });
    }

    // Disable any assets not present in the new release
    await tx.asset.updateMany({
      where: {
        assetNo: { notIn: activeAssetNos },
        status: { not: 'DISABLED' },
      },
      data: { status: 'DISABLED' },
    });
  }

  private async projectPricingPolicies(
    tx: GovernanceClient,
    items: Array<ParsedReleaseItem<PricingPolicyManifestPayload>>,
  ) {
    const requiredKeys = new Set([SWAP_POLICY_CODE, WITHDRAWAL_POLICY_CODE]);
    const seenKeys = new Set(items.map((item) => item.businessKey));
    for (const key of requiredKeys) {
      if (!seenKeys.has(key)) {
        throw new BadRequestException(`Pricing policy publish missing required policy: ${key}`);
      }
    }

    for (const item of items) {
      const payload = item.payload;
      await tx.pricingPolicy.upsert({
        where: { policyCode: payload.policyCode },
        update: {
          policyName: payload.policyName,
          business: payload.business,
          channelOnline: payload.channelOnline,
          channelStoreSoon: payload.channelStoreSoon,
          configJson: JSON.stringify(payload.config),
          updatedByUserId: 'SYSTEM',
          updatedByUserNo: 'SYSTEM',
        },
        create: {
          policyCode: payload.policyCode,
          policyName: payload.policyName,
          business: payload.business,
          channelOnline: payload.channelOnline,
          channelStoreSoon: payload.channelStoreSoon,
          configJson: JSON.stringify(payload.config),
          updatedByUserId: 'SYSTEM',
          updatedByUserNo: 'SYSTEM',
        },
      });
    }
  }

  async stageRelease(subjectInput: string) {
    const subjectType = this.normalizeSubjectType(subjectInput);
    const manifestEntries = await this.getManifestEntries(subjectType);
    const latestRevisionMap = await this.getLatestRevisionMap(subjectType);
    const activeRelease = await this.getActiveRelease(subjectType);
    const releaseNo = await this.nextReleaseNo(subjectType);
    const sourceCommitSha = this.sourceCommitSha();
    const createdAt = new Date();
    const traceId = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const release = await tx.businessConfigRelease.create({
        data: {
          subjectType,
          releaseNo,
          status: BUSINESS_CONFIG_RELEASE_STATUSES.DRAFT,
          basedOnReleaseNo: activeRelease?.releaseNo || null,
          traceId,
          validationSummaryJson: JSON.stringify({
            ok: false,
            issues: [],
            warnings: ['Release staged but not yet validated'],
            validatedAt: createdAt.toISOString(),
          }),
        },
      });

      let sortOrder = 1;
      for (const entry of manifestEntries) {
        const contentHash = this.hashPayload(entry.payload);
        const latest = latestRevisionMap.get(entry.businessKey);
        let revisionId = latest?.id as string | undefined;

        if (!latest || latest.contentHash !== contentHash) {
          const created = await tx.businessConfigRevision.create({
            data: {
              subjectType,
              businessKey: entry.businessKey,
              revisionNo: (latest?.revisionNo || 0) + 1,
              payloadJson: this.stableStringify(entry.payload),
              contentHash,
              changeSummary: `Manifest stage for ${subjectType}:${entry.businessKey}`,
              status: BUSINESS_CONFIG_REVISION_STATUSES.STAGED,
              sourceCommitSha,
            },
          });
          revisionId = created.id;
        }

        if (!revisionId) {
          throw new BadRequestException(
            `Failed to resolve revision for ${subjectType}:${entry.businessKey}`,
          );
        }

        await tx.businessConfigReleaseItem.create({
          data: {
            releaseId: release.id,
            revisionId,
            subjectType,
            businessKey: entry.businessKey,
            sortOrder,
          },
        });
        sortOrder += 1;
      }

      const staged = await tx.businessConfigRelease.findUnique({
        where: { id: release.id },
        include: {
          items: {
            include: { revision: true },
            orderBy: [{ sortOrder: 'asc' }, { businessKey: 'asc' }],
          },
        },
      });

      if (!staged) {
        throw new NotFoundException(`Staged release not found after create: ${release.releaseNo}`);
      }

      await this.recordReleaseAudit(
        {
          id: staged.id,
          subjectType: staged.subjectType,
          releaseNo: staged.releaseNo,
          status: staged.status,
          changeTicketId: staged.changeTicketId,
          approvalCaseId: staged.approvalCaseId,
        },
        {
          action: AuditActions.BUSINESS_CONFIG_RELEASE_STAGED,
          reason: `Business config release staged for ${subjectType}`,
          traceId: staged.traceId ?? undefined,
          client: tx,
        },
      );

      return this.mapRelease(staged);
    });
  }

  async validateRelease(releaseNo: string) {
    const release = await this.findReleaseOrThrow(releaseNo);
    const subjectType = this.normalizeSubjectType(release.subjectType);
    const items: Array<ParsedReleaseItem<Record<string, unknown>>> = (
      release.items || []
    ).map((item) => ({
      businessKey: item.businessKey,
      revisionId: item.revisionId,
      payload: this.parseJson<Record<string, unknown>>(
        item.revision.payloadJson,
        `release item ${item.businessKey}`,
      ),
    }));

    const summary = await this.validateReleaseItems(subjectType, items);
    const nextStatus = summary.ok
      ? BUSINESS_CONFIG_RELEASE_STATUSES.VALIDATED
      : BUSINESS_CONFIG_RELEASE_STATUSES.DRAFT;

    await this.prisma.$transaction(async (tx) => {
      await tx.businessConfigRelease.update({
        where: { id: release.id },
        data: {
          status: nextStatus,
          validationSummaryJson: JSON.stringify(summary),
        },
      });

      await this.recordReleaseAudit(
        {
          id: release.id,
          subjectType,
          releaseNo: release.releaseNo,
          status: nextStatus,
          changeTicketId: release.changeTicketId,
          approvalCaseId: release.approvalCaseId,
        },
        {
          action: summary.ok
            ? AuditActions.BUSINESS_CONFIG_RELEASE_VALIDATED
            : AuditActions.BUSINESS_CONFIG_RELEASE_VALIDATION_FAILED,
          result: summary.ok ? AuditResult.SUCCESS : AuditResult.FAILED,
          reason: summary.ok
            ? `Business config release validated: ${release.releaseNo}`
            : `Business config release validation failed: ${release.releaseNo}`,
          traceId: release.traceId ?? undefined,
          validationSummary: summary,
          client: tx,
        },
      );
    });

    if (!summary.ok) {
      throw new BadRequestException(summary.issues.join(' | '));
    }

    // Auto-create the governance CT for this release (idempotent: skip if already linked)
    if (summary.ok && !release.changeTicketId) {
      const systemActor = {
        actorType: 'ADMIN' as const,
        userId: 'SYSTEM',
        userNo: 'SYSTEM',
        role: 'SYSTEM',
        roleCodes: ['SYSTEM'] as string[],
      };

      const ct = await this.changeTicketsService.createBusinessConfigReleaseTicket(
        {
          releaseNo: release.releaseNo,
          traceId: release.traceId ?? undefined,
          subjectType,
        },
        systemActor,
      );

      await this.prisma.businessConfigRelease.update({
        where: { id: release.id },
        data: { changeTicketId: ct.id },
      });
    }

    return summary;
  }

  /**
   * Called by GovernedExecutionListener after a BUSINESS_CONFIG_CHANGE CT is consumed.
   * Bypasses the CT READY status check — by the time the governance event fires the CT
   * is already DONE (the consume() method transitions it before emitting the event).
   */
  async publishReleaseFromGovernance(releaseNo: string, ticketNo: string): Promise<void> {
    const release = await this.findReleaseOrThrow(releaseNo);
    const subjectType = this.normalizeSubjectType(release.subjectType);

    if (release.status !== BUSINESS_CONFIG_RELEASE_STATUSES.VALIDATED) {
      await this.recordReleaseAudit(
        {
          id: release.id,
          subjectType,
          releaseNo: release.releaseNo,
          status: release.status,
          changeTicketId: release.changeTicketId,
          approvalCaseId: release.approvalCaseId,
        },
        {
          action: AuditActions.BUSINESS_CONFIG_RELEASE_PUBLISH_BLOCKED,
          result: AuditResult.REJECTED,
          reason: `Governance-triggered publish blocked: release ${releaseNo} is not VALIDATED (status=${release.status})`,
          traceId: release.traceId ?? undefined,
          ticketNo,
        },
      );
      return;
    }

    await this.publishRelease(releaseNo, ticketNo);
  }

  async publishRelease(releaseNo: string, changeTicketRef: string) {
    const release = await this.findReleaseOrThrow(releaseNo);
    const subjectType = this.normalizeSubjectType(release.subjectType);
    if (release.status !== BUSINESS_CONFIG_RELEASE_STATUSES.VALIDATED) {
      throw new BadRequestException('Only VALIDATED releases can be published');
    }

    const changeTicket = await (this.prisma as any).changeTicket?.findFirst({
      where: {
        deletedAt: null,
        OR: [{ id: changeTicketRef }, { ticketNo: changeTicketRef }],
      },
      select: {
        id: true,
        ticketNo: true,
        status: true,
        approvalCaseId: true,
        approvalNo: true,
      },
    });

    if (!changeTicket) {
      await this.recordReleaseAudit(
        {
          id: release.id,
          subjectType,
          releaseNo: release.releaseNo,
          status: release.status,
          changeTicketId: release.changeTicketId,
          approvalCaseId: release.approvalCaseId,
        },
        {
          action: AuditActions.BUSINESS_CONFIG_RELEASE_PUBLISH_BLOCKED,
          result: AuditResult.REJECTED,
          reason: `Business config publish blocked: change ticket not found (${changeTicketRef})`,
          traceId: release.traceId ?? undefined,
          changeTicketRef,
        },
      );
      throw new NotFoundException(`Change ticket not found: ${changeTicketRef}`);
    }
    if (changeTicket.status !== ChangeTicketStatuses.READY) {
      await this.recordReleaseAudit(
        {
          id: release.id,
          subjectType,
          releaseNo: release.releaseNo,
          status: release.status,
          changeTicketId: changeTicket.id,
          approvalCaseId: changeTicket.approvalCaseId,
        },
        {
          action: AuditActions.BUSINESS_CONFIG_RELEASE_PUBLISH_BLOCKED,
          result: AuditResult.REJECTED,
          reason: `Business config publish blocked: change ticket ${changeTicket.ticketNo} is not READY`,
          traceId: release.traceId ?? undefined,
          ticketNo: changeTicket.ticketNo,
          changeTicketRef,
          approvalNo: changeTicket.approvalNo,
        },
      );
      throw new BadRequestException(
        `Change ticket ${changeTicket.ticketNo} must be READY before publish`,
      );
    }

    const regulatoryGate = await this.prisma.regulatoryGateItem.findFirst({
      where: {
        gateType: RegulatoryGateTypes.LICENSE_SCOPE_CHANGE,
        subjectType: RegulatoryGateSubjectTypes.BUSINESS_CONFIG_RELEASE,
        subjectId: release.id,
        revokedAt: null,
        effectivenessStatus: {
          not: RegulatoryGateEffectivenessStatuses.EFFECTIVE,
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        gateNo: true,
        gateResult: true,
        effectivenessStatus: true,
      },
    });
    if (regulatoryGate) {
      await this.recordReleaseAudit(
        {
          id: release.id,
          subjectType,
          releaseNo: release.releaseNo,
          status: release.status,
          changeTicketId: changeTicket.id,
          approvalCaseId: changeTicket.approvalCaseId,
        },
        {
          action: AuditActions.BUSINESS_CONFIG_RELEASE_PUBLISH_BLOCKED,
          result: AuditResult.REJECTED,
          reason: `Business config publish blocked: regulatory gate ${regulatoryGate.gateNo} is not effective`,
          traceId: release.traceId ?? undefined,
          ticketNo: changeTicket.ticketNo,
          changeTicketRef,
          approvalNo: changeTicket.approvalNo,
        },
      );
      throw new BadRequestException(
        `Business config release ${release.releaseNo} is blocked by regulatory gate ${regulatoryGate.gateNo}`,
      );
    }

    const items: Array<ParsedReleaseItem<Record<string, unknown>>> = (
      release.items || []
    ).map((item) => ({
      businessKey: item.businessKey,
      revisionId: item.revisionId,
      payload: this.parseJson<Record<string, unknown>>(
        item.revision.payloadJson,
        `release item ${item.businessKey}`,
      ),
    }));
    const publishedAt = new Date();
    const publishedBy = 'SYSTEM';

    await this.prisma.$transaction(async (tx) => {
      if (subjectType === 'PRICING_POLICY') {
        await this.projectPricingPolicies(
          tx,
          items as Array<ParsedReleaseItem<PricingPolicyManifestPayload>>,
        );
      } else if (subjectType === 'ASSET_CONFIG') {
        await this.projectAssetConfig(
          tx,
          items as Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
        );
      }

      await tx.businessConfigRelease.updateMany({
        where: {
          subjectType,
          status: BUSINESS_CONFIG_RELEASE_STATUSES.ACTIVE,
          id: { not: release.id },
        },
        data: {
          status: BUSINESS_CONFIG_RELEASE_STATUSES.SUPERSEDED,
        },
      });

      await tx.businessConfigRelease.update({
        where: { id: release.id },
        data: {
          status: BUSINESS_CONFIG_RELEASE_STATUSES.ACTIVE,
          changeTicketId: changeTicket.id,
          approvalCaseId: changeTicket.approvalCaseId,
          effectiveFrom: publishedAt,
          publishedAt,
          publishedBy,
        },
      });

      await tx.businessConfigRevision.updateMany({
        where: {
          id: {
            in: items.map((item) => item.revisionId),
          },
        },
        data: {
          status: BUSINESS_CONFIG_REVISION_STATUSES.PUBLISHED,
        },
      });

      await this.recordReleaseAudit(
        {
          id: release.id,
          subjectType,
          releaseNo: release.releaseNo,
          status: BUSINESS_CONFIG_RELEASE_STATUSES.ACTIVE,
          changeTicketId: changeTicket.id,
          approvalCaseId: changeTicket.approvalCaseId,
        },
        {
          action: AuditActions.BUSINESS_CONFIG_RELEASE_PUBLISHED,
          reason: `Business config release published: ${release.releaseNo}`,
          traceId: release.traceId ?? undefined,
          ticketNo: changeTicket.ticketNo,
          changeTicketRef,
          approvalNo: changeTicket.approvalNo,
          client: tx,
        },
      );
    });

    return this.getReleaseByNo(releaseNo);
  }

  async listReleases(query: {
    subjectType?: string;
    status?: string;
    skip?: number;
    take?: number;
  }) {
    const where: Prisma.BusinessConfigReleaseWhereInput = {};
    if (query.subjectType) {
      where.subjectType = this.normalizeSubjectType(query.subjectType);
    }
    if (query.status) {
      where.status = query.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.businessConfigRelease.findMany({
        where,
        skip: this.normalizeSkip(query.skip),
        take: this.normalizeTake(query.take),
        include: {
          items: {
            select: { id: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.businessConfigRelease.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...this.mapRelease({ ...item, items: undefined }),
        itemCount: Array.isArray(item.items) ? item.items.length : 0,
      })),
      total,
    };
  }

  async getReleaseByNo(releaseNo: string) {
    const release = await this.findReleaseOrThrow(releaseNo);
    return {
      ...this.mapRelease(release),
      regulatoryGateSummary: await this.findRegulatoryGateSummaryForRelease(
        release.id,
      ),
    };
  }

  async getReleaseDiff(releaseNo: string): Promise<{
    releaseNo: string;
    subjectType: string;
    basedOnReleaseNo: string | null;
    items: BusinessConfigDiffItem[];
  }> {
    const release = await this.findReleaseOrThrow(releaseNo);
    const currentMap = new Map<string, number>(
      (release.items || []).map((item) => [item.businessKey, item.revision.revisionNo]),
    );

    const baseRelease =
      release.basedOnReleaseNo && String(release.basedOnReleaseNo).trim()
        ? await this.prisma.businessConfigRelease.findUnique({
            where: { releaseNo: release.basedOnReleaseNo },
            include: {
              items: {
                include: { revision: true },
              },
            },
          })
        : null;

    const baseMap = new Map<string, number>(
      ((baseRelease?.items || []) as BusinessConfigReleaseItemRow[]).map((item) => [
        item.businessKey,
        item.revision.revisionNo,
      ]),
    );

    const allKeys = Array.from(
      new Set([...currentMap.keys(), ...baseMap.keys()]),
    ).sort((left, right) => left.localeCompare(right));

    const items = allKeys.map<BusinessConfigDiffItem>((businessKey) => {
      const fromRevisionNo = baseMap.get(businessKey) ?? null;
      const toRevisionNo = currentMap.get(businessKey) ?? null;
      let action: BusinessConfigDiffItem['action'] = 'UNCHANGED';
      if (fromRevisionNo === null && toRevisionNo !== null) {
        action = 'ADDED';
      } else if (fromRevisionNo !== null && toRevisionNo === null) {
        action = 'REMOVED';
      } else if (fromRevisionNo !== toRevisionNo) {
        action = 'CHANGED';
      }
      return {
        businessKey,
        action,
        fromRevisionNo,
        toRevisionNo,
      };
    });

    return {
      releaseNo: release.releaseNo,
      subjectType: release.subjectType,
      basedOnReleaseNo: release.basedOnReleaseNo || null,
      items,
    };
  }

  async listRevisions(query: {
    subjectType: string;
    businessKey: string;
    skip?: number;
    take?: number;
  }) {
    const subjectType = this.normalizeSubjectType(query.subjectType);
    const [items, total] = await Promise.all([
      this.prisma.businessConfigRevision.findMany({
        where: {
          subjectType,
          businessKey: query.businessKey,
        },
        skip: this.normalizeSkip(query.skip),
        take: this.normalizeTake(query.take),
        orderBy: [{ revisionNo: 'desc' }],
      }),
      this.prisma.businessConfigRevision.count({
        where: {
          subjectType,
          businessKey: query.businessKey,
        },
      }),
    ]);

    return {
      items: items.map((item) => this.mapRevision(item)),
      total,
    };
  }

  async getRevisionById(id: string) {
    const found = await this.prisma.businessConfigRevision.findUnique({
      where: { id },
    });

    if (!found) {
      throw new NotFoundException(`Business config revision not found: ${id}`);
    }

    return this.mapRevision(found);
  }
}
