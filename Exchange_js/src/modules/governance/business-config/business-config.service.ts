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
import { DEFAULT_COA } from '../../../config/manifests/coa.manifest';
import { DEFAULT_ACCT_EVENTS } from '../../../config/manifests/events.manifest';
import { DEFAULT_JOURNAL_TEMPLATES } from '../../../config/manifests/journal-templates.manifest';
import { DEFAULT_CLEARING_TEMPLATES } from '../../../config/manifests/clearing-templates.manifest';
import {
  buildDefaultPricingPolicyManifest,
  PricingPolicyManifestAsset,
  PricingPolicyManifestItem,
} from '../../../config/manifests/pricing-policies.manifest';
import {
  AssetConfigManifestItem,
  DEFAULT_ASSET_CONFIGS,
} from '../../../config/manifests/asset-config.manifest';
import { PricingCenterService } from '../../trading/pricing-center/pricing-center.service';
import { ChangeTicketStatuses, ChangeTicketTypes } from '../change-tickets/constants/change-ticket.constants';
import { ChangeTicketsService } from '../change-tickets/change-tickets.service';
import {
  RegulatoryGateEffectivenessStatuses,
  RegulatoryGateSubjectTypes,
  RegulatoryGateTypes,
} from '../regulatory-gates/constants/regulatory-gates.constants';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditModules,
} from '../../audit-logging/constants/audit-actions.constant';
import {
  AuditResult,
  AuditTriggerType,
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
  SwapPricingPolicyConfig,
  WITHDRAWAL_POLICY_CODE,
  WithdrawalPricingPolicyConfig,
} from '../../trading/pricing-center/types/pricing.types';

type GovernanceClient = PrismaService | Prisma.TransactionClient;
type CoaManifestPayload = Record<string, unknown> & {
  code: string;
  type: string;
  name: string;
  status: string;
  requiredTags: string[];
};
type AcctEventManifestPayload = Record<string, unknown> & {
  eventCode: string;
  postingReversalOfEventCode?: string | null;
  clearingReversalOfEventCode?: string | null;
  clearingTemplateCode?: string | null;
};
type JournalTemplateLinePayload = Record<string, unknown> & {
  lineNo: number;
  accountCode: string;
  drCr: string;
  amountSource: string;
  assetSource: string;
  ownerTypeSource?: string | null;
  ownerIdSource?: string | null;
  fxRateSource?: string | null;
  referenceSource?: string | null;
  dimensionsRule?: string | null;
  conditionExpr?: string | null;
  description?: string | null;
};
type JournalTemplateManifestPayload = Record<string, unknown> & {
  header: Record<string, unknown> & {
    templateCode: string;
    eventCode: string;
  };
  lines: JournalTemplateLinePayload[];
};
type ClearingTemplateLinePayload = Record<string, unknown> & {
  lineNo: number;
  lineType: string;
  partyType: string;
  partyIdSource?: string | null;
  assetSource: string;
  amountSource: string;
  refTypeConst?: string | null;
  refIdSource?: string | null;
  memoTemplate?: string | null;
  isEnabled?: boolean | null;
};
type ClearingTemplateManifestPayload = Record<string, unknown> & {
  code: string;
  clearingType: string;
  sourceType: string;
  isEnabled: boolean;
  description?: string | null;
  feeMethod?: string | null;
  outAssetSource: string;
  outAmountSource: string;
  inAssetSource: string;
  inAmountSource: string;
  feeAssetSource: string;
  feeAmountSource: string;
  outPayoutIdSource?: string | null;
  inPayinIdSource?: string | null;
  memoTemplate?: string | null;
  lineTemplates: ClearingTemplateLinePayload[];
};
type PricingPolicyManifestPayload = PricingPolicyManifestItem;
type AssetConfigManifestPayload = AssetConfigManifestItem;
type ManifestPayload =
  | CoaManifestPayload
  | AcctEventManifestPayload
  | JournalTemplateManifestPayload
  | ClearingTemplateManifestPayload
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
    private readonly pricingCenterService: PricingCenterService,
    private readonly changeTicketsService: ChangeTicketsService,
  ) {}

  private normalizeSubjectType(input: string): BusinessConfigSubjectType {
    const normalized = String(input || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');

    switch (normalized) {
      case 'COA':
        return 'COA';
      case 'ACCT_EVENT':
      case 'ACCTEVENT':
      case 'EVENT':
      case 'EVENTS':
        return 'ACCT_EVENT';
      case 'JOURNAL_TEMPLATE':
      case 'JOURNALTEMPLATE':
      case 'JOURNAL':
        return 'JOURNAL_TEMPLATE';
      case 'CLEARING_TEMPLATE':
      case 'CLEARINGTEMPLATE':
      case 'CLEARING':
        return 'CLEARING_TEMPLATE';
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
    if (subjectType === 'COA') {
      return DEFAULT_COA.map((item) => ({
        businessKey: item.code,
        payload: {
          ...item,
          requiredTags: [],
        },
      })).sort((left, right) => left.businessKey.localeCompare(right.businessKey));
    }

    if (subjectType === 'ACCT_EVENT') {
      return DEFAULT_ACCT_EVENTS.map((item) => ({
        businessKey: item.eventCode,
        payload: item,
      })).sort((left, right) => left.businessKey.localeCompare(right.businessKey));
    }

    if (subjectType === 'JOURNAL_TEMPLATE') {
      return DEFAULT_JOURNAL_TEMPLATES.map((item) => ({
        businessKey: item.header.templateCode,
        payload: item,
      })).sort((left, right) => left.businessKey.localeCompare(right.businessKey));
    }

    if (subjectType === 'CLEARING_TEMPLATE') {
      return DEFAULT_CLEARING_TEMPLATES.map((item) => ({
        businessKey: item.code,
        payload: item,
      })).sort((left, right) => left.businessKey.localeCompare(right.businessKey));
    }

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
        triggerType: AuditTriggerType.CONFIG_CHANGE,
        action: input.action,
        module: AuditModules.BUSINESS_CONFIG,
        entityType: AuditEntityTypes.CONFIG,
        entityId: release.id,
        entityNo: release.releaseNo,
        result: input.result ?? AuditResult.SUCCESS,
        reason: input.reason,
        traceId: input.traceId,
        workflowType: 'CHANGE_TICKET',
        afterData: this.buildReleaseAuditData(release, {
          ticketNo: input.ticketNo,
          changeTicketRef: input.changeTicketRef,
          approvalNo: input.approvalNo,
          validationSummary: input.validationSummary,
        }),
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

  private async validateCoaRelease(
    items: Array<ParsedReleaseItem<CoaManifestPayload>>,
  ): Promise<string[]> {
    const issues: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.businessKey)) {
        issues.push(`Duplicate COA code in release: ${item.businessKey}`);
      }
      seen.add(item.businessKey);
      if (!item.payload?.name || !item.payload?.type) {
        issues.push(`COA ${item.businessKey} requires name and type`);
      }
    }
    return issues;
  }

  private async validateAcctEventRelease(
    items: Array<ParsedReleaseItem<AcctEventManifestPayload>>,
  ): Promise<string[]> {
    const issues: string[] = [];
    const eventCodes = new Set(items.map((item) => item.businessKey));
    const activeClearingTemplates = await this.prisma.clearingTemplate.findMany({
      where: { isEnabled: true },
      select: { code: true },
    });
    const activeClearingCodes = new Set(activeClearingTemplates.map((item) => item.code));

    for (const item of items) {
      const payload = item.payload;
      if (
        payload.postingReversalOfEventCode &&
        !eventCodes.has(String(payload.postingReversalOfEventCode))
      ) {
        issues.push(
          `AcctEvent ${item.businessKey} postingReversalOfEventCode not found in release: ${payload.postingReversalOfEventCode}`,
        );
      }
      if (
        payload.clearingReversalOfEventCode &&
        !eventCodes.has(String(payload.clearingReversalOfEventCode))
      ) {
        issues.push(
          `AcctEvent ${item.businessKey} clearingReversalOfEventCode not found in release: ${payload.clearingReversalOfEventCode}`,
        );
      }
      if (
        payload.clearingTemplateCode &&
        !activeClearingCodes.has(String(payload.clearingTemplateCode))
      ) {
        issues.push(
          `AcctEvent ${item.businessKey} clearingTemplateCode is not active: ${payload.clearingTemplateCode}`,
        );
      }
    }

    return issues;
  }

  private async validateJournalTemplateRelease(
    items: Array<ParsedReleaseItem<JournalTemplateManifestPayload>>,
  ): Promise<string[]> {
    const issues: string[] = [];
    const coaRows = await this.prisma.coa.findMany({
      where: { status: 'ACTIVE' },
      select: { code: true },
    });
    const eventRows = await this.prisma.acctEvent.findMany({
      where: { isActive: true },
      select: { eventCode: true },
    });
    const activeCoaCodes = new Set(coaRows.map((item) => item.code));
    const activeEventCodes = new Set(eventRows.map((item) => item.eventCode));

    for (const item of items) {
      const payload = item.payload;
      const header = payload.header;
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      if (!header.templateCode || !header.eventCode) {
        issues.push(`JournalTemplate ${item.businessKey} requires header.templateCode and header.eventCode`);
      }
      if (!activeEventCodes.has(String(header.eventCode || ''))) {
        issues.push(`JournalTemplate ${item.businessKey} eventCode is not active: ${header.eventCode}`);
      }
      if (!lines.length) {
        issues.push(`JournalTemplate ${item.businessKey} must contain at least one line`);
        continue;
      }

      const balanceMap = new Map<string, { dr: number; cr: number }>();
      for (const line of lines) {
        if (!activeCoaCodes.has(String(line.accountCode || ''))) {
          issues.push(`JournalTemplate ${item.businessKey} references inactive COA: ${line.accountCode}`);
        }
        const bucketKey = `${line.amountSource || ''}|${line.assetSource || ''}`;
        const bucket = balanceMap.get(bucketKey) || { dr: 0, cr: 0 };
        if (String(line.drCr || '').toUpperCase() === 'DR') {
          bucket.dr += 1;
        } else if (String(line.drCr || '').toUpperCase() === 'CR') {
          bucket.cr += 1;
        } else {
          issues.push(`JournalTemplate ${item.businessKey} line ${line.lineNo} has invalid drCr`);
        }
        balanceMap.set(bucketKey, bucket);
      }
      for (const [bucketKey, bucket] of balanceMap.entries()) {
        if (bucket.dr !== bucket.cr) {
          issues.push(
            `JournalTemplate ${item.businessKey} is not balanced for source bucket ${bucketKey} (DR=${bucket.dr}, CR=${bucket.cr})`,
          );
        }
      }
    }

    return issues;
  }

  private async validateClearingTemplateRelease(
    items: Array<ParsedReleaseItem<ClearingTemplateManifestPayload>>,
  ): Promise<string[]> {
    const issues: string[] = [];
    for (const item of items) {
      const payload = item.payload;
      const lines = Array.isArray(payload.lineTemplates) ? payload.lineTemplates : [];
      if (!payload.code || !payload.clearingType || !payload.sourceType) {
        issues.push(`ClearingTemplate ${item.businessKey} requires code, clearingType, and sourceType`);
      }
      if (!lines.length) {
        issues.push(`ClearingTemplate ${item.businessKey} must contain at least one line`);
      }
      const lineNos = new Set<number>();
      for (const line of lines) {
        if (lineNos.has(Number(line.lineNo))) {
          issues.push(`ClearingTemplate ${item.businessKey} has duplicate lineNo ${line.lineNo}`);
        }
        lineNos.add(Number(line.lineNo));
        if (!line.lineType || !line.partyType || !line.amountSource || !line.assetSource) {
          issues.push(`ClearingTemplate ${item.businessKey} line ${line.lineNo} is incomplete`);
        }
      }
    }
    return issues;
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

    for (const item of items) {
      try {
        if (item.businessKey === SWAP_POLICY_CODE) {
          await this.pricingCenterService.assertSwapPolicyConfig(
            item.payload.config as SwapPricingPolicyConfig,
          );
        } else if (item.businessKey === WITHDRAWAL_POLICY_CODE) {
          await this.pricingCenterService.assertWithdrawalPolicyConfig(
            item.payload.config as WithdrawalPricingPolicyConfig,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(`PricingPolicy ${item.businessKey} invalid: ${message}`);
      }
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

    if (subjectType === 'COA') {
      issues.push(
        ...(await this.validateCoaRelease(
          items as Array<ParsedReleaseItem<CoaManifestPayload>>,
        )),
      );
    } else if (subjectType === 'ACCT_EVENT') {
      issues.push(
        ...(await this.validateAcctEventRelease(
          items as Array<ParsedReleaseItem<AcctEventManifestPayload>>,
        )),
      );
    } else if (subjectType === 'JOURNAL_TEMPLATE') {
      issues.push(
        ...(await this.validateJournalTemplateRelease(
          items as Array<ParsedReleaseItem<JournalTemplateManifestPayload>>,
        )),
      );
    } else if (subjectType === 'CLEARING_TEMPLATE') {
      issues.push(
        ...(await this.validateClearingTemplateRelease(
          items as Array<ParsedReleaseItem<ClearingTemplateManifestPayload>>,
        )),
      );
    } else if (subjectType === 'PRICING_POLICY') {
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

  private async currentBaseAssetId(): Promise<string> {
    const baseAsset =
      (await this.prisma.asset.findFirst({
        where: { code: 'AED', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })) ??
      (await this.prisma.asset.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }));

    if (!baseAsset?.id) {
      throw new BadRequestException('No base asset found for journal template projection');
    }

    return baseAsset.id;
  }

  private async projectCoa(
    tx: GovernanceClient,
    items: Array<ParsedReleaseItem<CoaManifestPayload>>,
  ) {
    const activeCodes = items.map((item) => String(item.payload.code));
    for (const item of items) {
      const payload = item.payload;
      await tx.coa.upsert({
        where: { code: payload.code },
        update: {
          type: payload.type,
          name: payload.name,
          status: payload.status,
          requiredTags: JSON.stringify(payload.requiredTags || []),
        },
        create: {
          code: payload.code,
          type: payload.type,
          name: payload.name,
          status: payload.status,
          requiredTags: JSON.stringify(payload.requiredTags || []),
        },
      });
    }

    await tx.coa.updateMany({
      where: {
        code: { notIn: activeCodes },
        status: { not: 'INACTIVE' },
      },
      data: { status: 'INACTIVE' },
    });
  }

  private async projectAcctEvents(
    tx: GovernanceClient,
    items: Array<ParsedReleaseItem<AcctEventManifestPayload>>,
  ) {
    const activeCodes = items.map((item) => String(item.payload.eventCode));
    for (const item of items) {
      const payload = item.payload;
      const eventRecord: Prisma.AcctEventUncheckedCreateInput = {
        eventCode: payload.eventCode,
        entityType: String(payload.entityType ?? ''),
        ownerScope: String(payload.ownerScope ?? ''),
        assetType: String(payload.assetType ?? ''),
        triggerType: String(payload.triggerType ?? ''),
        triggerKey:
          typeof payload.triggerKey === 'string' ? payload.triggerKey : null,
        fromStatus:
          typeof payload.fromStatus === 'string' ? payload.fromStatus : null,
        toStatus: typeof payload.toStatus === 'string' ? payload.toStatus : null,
        postingMode: String(payload.postingMode ?? ''),
        clearingMode: String(payload.clearingMode ?? ''),
        postingReversalOfEventCode:
          typeof payload.postingReversalOfEventCode === 'string'
            ? payload.postingReversalOfEventCode
            : null,
        clearingReversalOfEventCode:
          typeof payload.clearingReversalOfEventCode === 'string'
            ? payload.clearingReversalOfEventCode
            : null,
        clearingTemplateCode:
          typeof payload.clearingTemplateCode === 'string'
            ? payload.clearingTemplateCode
            : null,
        isActive: payload.isActive !== false,
        description:
          typeof payload.description === 'string' ? payload.description : null,
      };
      await tx.acctEvent.upsert({
        where: { eventCode: payload.eventCode },
        update: eventRecord,
        create: eventRecord,
      });
    }

    await tx.acctEvent.updateMany({
      where: {
        eventCode: { notIn: activeCodes },
        isActive: true,
      },
      data: { isActive: false },
    });
  }

  private async projectJournalTemplates(
    tx: GovernanceClient,
    items: Array<ParsedReleaseItem<JournalTemplateManifestPayload>>,
  ) {
    const activeCodes = items.map((item) => String(item.payload.header.templateCode));
    const baseAssetId = await this.currentBaseAssetId();

    for (const item of items) {
      const payload = item.payload;
      const header = await tx.journalHeaderTemplate.upsert({
        where: { templateCode: payload.header.templateCode },
        update: {
          ...payload.header,
          baseAssetId,
        },
        create: {
          ...payload.header,
          baseAssetId,
        },
      });

      await tx.journalLineTemplate.deleteMany({
        where: { templateId: header.id },
      });

      for (const line of payload.lines || []) {
        await tx.journalLineTemplate.create({
          data: {
            templateId: header.id,
            lineNo: line.lineNo,
            accountCode: line.accountCode,
            drCr: line.drCr,
            amountSource: line.amountSource,
            assetSource: line.assetSource,
            ownerTypeSource: line.ownerTypeSource ?? null,
            ownerIdSource: line.ownerIdSource ?? null,
            fxRateSource: line.fxRateSource ?? null,
            referenceSource: line.referenceSource ?? null,
            dimensionsRule: line.dimensionsRule ?? '{}',
            conditionExpr: line.conditionExpr ?? null,
            description: line.description ?? null,
          },
        });
      }
    }

    await tx.journalHeaderTemplate.updateMany({
      where: {
        templateCode: { notIn: activeCodes },
        status: { not: 'INACTIVE' },
      },
      data: { status: 'INACTIVE' },
    });
  }

  private async projectClearingTemplates(
    tx: GovernanceClient,
    items: Array<ParsedReleaseItem<ClearingTemplateManifestPayload>>,
  ) {
    const activeCodes = items.map((item) => String(item.payload.code));
    for (const item of items) {
      const payload = item.payload;
      const clearingTemplateRecord = {
        code: payload.code,
        clearingType: payload.clearingType,
        sourceType: payload.sourceType,
        isEnabled: payload.isEnabled,
        description: payload.description ?? '',
        feeMethod: payload.feeMethod ?? 'CONFIGURED_FEE',
        outAssetSource: payload.outAssetSource,
        outAmountSource: payload.outAmountSource,
        inAssetSource: payload.inAssetSource,
        inAmountSource: payload.inAmountSource,
        feeAssetSource: payload.feeAssetSource,
        feeAmountSource: payload.feeAmountSource,
        outPayoutIdSource: payload.outPayoutIdSource ?? null,
        inPayinIdSource: payload.inPayinIdSource ?? null,
        memoTemplate: payload.memoTemplate ?? null,
      };
      const header = await tx.clearingTemplate.upsert({
        where: { code: payload.code },
        update: clearingTemplateRecord,
        create: clearingTemplateRecord,
      });

      await tx.clearingLineTemplate.deleteMany({
        where: { clearingTemplateId: header.id },
      });

      for (const line of payload.lineTemplates || []) {
        await tx.clearingLineTemplate.create({
          data: {
            clearingTemplateId: header.id,
            lineNo: line.lineNo,
            lineType: line.lineType,
            partyType: line.partyType,
            partyIdSource: line.partyIdSource ?? null,
            assetSource: line.assetSource,
            amountSource: line.amountSource,
            refTypeConst: line.refTypeConst ?? null,
            refIdSource: line.refIdSource ?? null,
            memoTemplate: line.memoTemplate ?? null,
            isEnabled: line.isEnabled ?? true,
          },
        });
      }
    }

    await tx.clearingTemplate.updateMany({
      where: {
        code: { notIn: activeCodes },
        isEnabled: true,
      },
      data: { isEnabled: false },
    });
  }

  private async projectAssetConfig(
    tx: GovernanceClient,
    items: Array<ParsedReleaseItem<AssetConfigManifestPayload>>,
  ): Promise<void> {
    const activeAssetNos = items.map((item) => String(item.payload.assetNo));

    for (const item of items) {
      const payload = item.payload;
      const assetRecord = {
        assetNo: String(payload.assetNo),
        type: String(payload.type),
        code: String(payload.code),
        network: payload.network ? String(payload.network) : null,
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

    const changeTicket = await this.prisma.changeTicket.findFirst({
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
      if (subjectType === 'COA') {
        await this.projectCoa(
          tx,
          items as Array<ParsedReleaseItem<CoaManifestPayload>>,
        );
      } else if (subjectType === 'ACCT_EVENT') {
        await this.projectAcctEvents(
          tx,
          items as Array<ParsedReleaseItem<AcctEventManifestPayload>>,
        );
      } else if (subjectType === 'JOURNAL_TEMPLATE') {
        await this.projectJournalTemplates(
          tx,
          items as Array<ParsedReleaseItem<JournalTemplateManifestPayload>>,
        );
      } else if (subjectType === 'CLEARING_TEMPLATE') {
        await this.projectClearingTemplates(
          tx,
          items as Array<ParsedReleaseItem<ClearingTemplateManifestPayload>>,
        );
      } else if (subjectType === 'PRICING_POLICY') {
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
