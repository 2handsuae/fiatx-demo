import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  BootstrapCasesDto,
  CreateCaseSessionDto,
  FinalReviewCustomerDto,
  MockCompleteSessionDto,
  ReinitiateEddDto,
  ReviewCddCaseDto,
  ReviewEddCaseDto,
  UpdateInvestorClassificationDto,
  UpsertEntityDto,
} from './dto/onboarding.dto';

type TradeAction = 'SWAP' | 'WITHDRAW';
type SubjectKind = 'INDIVIDUAL_CUSTOMER' | 'CORPORATE_ENTITY' | 'UBO_PERSON';
type CaseType = 'CDD' | 'EDD';
type CddStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';
type EddStatus =
  | 'NOT_REQUIRED'
  | 'REQUIRED'
  | 'IN_PROGRESS'
  | 'PENDING_MLRO'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';
type ComplianceStatus =
  | 'NONE'
  | 'IN_PROGRESS'
  | 'ACTIVE'
  | 'RESTRICTED'
  | 'BLOCKED'
  | 'EXPIRED';
type FinalApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';

interface SubjectDescriptor {
  subjectKind: SubjectKind;
  subjectRefId: string;
  label: string;
}

interface NextStepPayload {
  step: 'ENTITY_INFO' | 'CDD' | 'WAIT_REVIEW' | 'EDD' | 'REINITIATE' | 'COMPLETED';
  action:
    | 'SAVE_ENTITY'
    | 'START_CDD'
    | 'COMPLETE_CDD'
    | 'COMPLETE_EDD'
    | 'WAIT'
    | 'REINITIATE_CDD'
    | 'REINITIATE_EDD'
    | 'NONE';
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private async writeAudit(input: {
    customerId: string;
    action: string;
    actorId: string;
    actorRole: string;
    fromStage?: string | null;
    toStage?: string | null;
    caseType?: string;
    caseId?: string;
    detail?: string | null;
  }) {
    await (this.prisma as any).onboardingAuditLog.create({
      data: {
        customerId: input.customerId,
        action: input.action,
        actorId: input.actorId,
        actorRole: input.actorRole,
        fromStage: input.fromStage || null,
        toStage: input.toStage || null,
        caseType: input.caseType || null,
        caseId: input.caseId || null,
        detail: input.detail || null,
      },
    });
  }

  private parseJsonSafely(value?: string | null): Record<string, any> {
    if (!value) return {};
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  private buildSeed(input: string): number {
    let hash = 0;
    const text = input || 'UNKNOWN';
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash || 1;
  }

  private pickFrom<T>(seed: number, values: T[]): T {
    return values[seed % values.length];
  }

  private buildMockDetail(
    caseType: CaseType,
    caseNo: string,
    subjectKind: SubjectKind,
  ): Record<string, any> {
    const seed = this.buildSeed(caseNo);
    const riskBands = ['LOW', 'MEDIUM', 'HIGH'];
    const watchlists = ['SANCTIONS', 'PEP', 'ADVERSE_MEDIA', 'NONE'];
    const countries = ['AE', 'US', 'SG', 'GB', 'HK', 'CA'];
    const occupations = ['Software Engineer', 'Consultant', 'Entrepreneur', 'Investor'];
    const fundingSources = ['Salary', 'Business Income', 'Investment Gains', 'Inheritance'];
    const outcome = this.pickFrom(seed, ['PASS', 'PASS', 'REVIEW_REQUIRED', 'PASS', 'FLAGGED']);
    const pepHit = this.pickFrom(seed + 23, [false, false, true, false]);
    const sanctionsHit = this.pickFrom(seed + 29, [false, false, false, true]);
    const watchlistHit = sanctionsHit ? 'SANCTIONS' : pepHit ? 'PEP' : this.pickFrom(seed + 13, watchlists);

    return {
      provider: 'MOCK',
      generatedFrom: caseNo,
      caseType,
      subjectKind,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      outcome,
      riskBand: this.pickFrom(seed + 7, riskBands),
      screenedCountry: this.pickFrom(seed + 11, countries),
      watchlistHit,
      pepHit,
      sanctionsHit,
      confidenceScore: 0.8 + ((seed % 20) / 100),
      profile: {
        occupation: this.pickFrom(seed + 17, occupations),
        sourceOfFunds: this.pickFrom(seed + 19, fundingSources),
      },
    };
  }

  private extractInvestorClassification(
    inputData: Record<string, any>,
    customerType: 'INDIVIDUAL' | 'CORPORATE',
  ): 'RETAIL' | 'QUALIFIED' | 'INSTITUTIONAL' {
    const raw =
      inputData?.investorClassification ||
      inputData?.profile?.investorClassification ||
      inputData?.classification ||
      null;

    const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (normalized === 'RETAIL') return 'RETAIL';
    if (normalized === 'QUALIFIED') return 'QUALIFIED';
    if (normalized === 'INSTITUTIONAL' && customerType === 'CORPORATE') return 'INSTITUTIONAL';
    return 'RETAIL';
  }

  private normalizeRiskTier(value?: string | null): 'LOW' | 'MEDIUM' | 'HIGH' {
    const text = String(value || '').toUpperCase();
    if (text === 'HIGH') return 'HIGH';
    if (text === 'MEDIUM') return 'MEDIUM';
    return 'LOW';
  }

  private computeNextReviewAt(riskTier: 'LOW' | 'MEDIUM' | 'HIGH'): Date {
    const now = Date.now();
    const days = riskTier === 'HIGH' ? 90 : riskTier === 'MEDIUM' ? 180 : 365;
    return new Date(now + days * 24 * 60 * 60 * 1000);
  }

  private getCustomerType(customer: any): 'INDIVIDUAL' | 'CORPORATE' {
    if (customer?.customerType === 'INDIVIDUAL' || customer?.customerType === 'CORPORATE') {
      return customer.customerType;
    }
    throw new BadRequestException('Please identify customer type first.');
  }

  private buildSubjectDescriptors(customer: any): SubjectDescriptor[] {
    const customerType = this.getCustomerType(customer);
    if (customerType === 'INDIVIDUAL') {
      return [
        {
          subjectKind: 'INDIVIDUAL_CUSTOMER',
          subjectRefId: customer.id,
          label: 'Individual Customer',
        },
      ];
    }

    if (!customer.corporateProfile) {
      throw new BadRequestException('Corporate profile is required for corporate onboarding.');
    }

    const ubos = Array.isArray(customer.uboProfiles) ? customer.uboProfiles : [];
    if (ubos.length === 0) {
      throw new BadRequestException('Corporate onboarding requires at least one UBO.');
    }

    const subjects: SubjectDescriptor[] = [
      {
        subjectKind: 'CORPORATE_ENTITY',
        subjectRefId: customer.id,
        label: customer.corporateProfile.companyName || 'Corporate Entity',
      },
    ];

    ubos.forEach((ubo: any) => {
      subjects.push({
        subjectKind: 'UBO_PERSON',
        subjectRefId: ubo.id,
        label: ubo.fullName || 'UBO',
      });
    });

    return subjects;
  }

  private buildSubjectDescriptorsSafe(customer: any): SubjectDescriptor[] {
    try {
      return this.buildSubjectDescriptors(customer);
    } catch {
      return [];
    }
  }

  private async resolveJourneyId(
    customerId: string,
    preferredJourneyId?: string,
    txClient?: any,
  ): Promise<string> {
    if (preferredJourneyId) return preferredJourneyId;

    const db = txClient || (this.prisma as any);
    const latest = await db.cddCase.findFirst({
      where: {
        customerId,
        status: {
          in: ['PENDING', 'SUBMITTED', 'APPROVED'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (latest?.journeyId) return latest.journeyId;
    return generateReferenceNo('ONB');
  }

  private async getLatestJourneyId(customerId: string, txClient?: any): Promise<string | null> {
    const db = txClient || (this.prisma as any);
    const [latestCdd, latestEdd] = await Promise.all([
      db.cddCase.findFirst({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        select: { journeyId: true, createdAt: true },
      }),
      db.eddCase.findFirst({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        select: { journeyId: true, createdAt: true },
      }),
    ]);

    if (!latestCdd && !latestEdd) return null;
    if (!latestEdd) return latestCdd.journeyId || null;
    if (!latestCdd) return latestEdd.journeyId || null;

    return latestCdd.createdAt >= latestEdd.createdAt ? latestCdd.journeyId : latestEdd.journeyId;
  }

  private async updateUboCaseStatus(
    tx: any,
    subjectKind: SubjectKind,
    subjectRefId: string,
    status:
      | 'PENDING'
      | 'CDD_IN_PROGRESS'
      | 'CDD_APPROVED'
      | 'EDD_IN_PROGRESS'
      | 'EDD_APPROVED'
      | 'REJECTED',
  ) {
    if (subjectKind !== 'UBO_PERSON') return;
    await tx.uboProfile.updateMany({
      where: { id: subjectRefId },
      data: { status },
    });
  }

  private indexLatestCaseBySubject(
    subjects: SubjectDescriptor[],
    cases: Array<any>,
  ): Array<any | null> {
    return subjects.map((subject) => {
      const list = cases
        .filter(
          (item) =>
            item.subjectKind === subject.subjectKind && item.subjectRefId === subject.subjectRefId,
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return list[0] || null;
    });
  }

  private determineCddStatus(subjects: SubjectDescriptor[], cddCases: any[]): CddStatus {
    if (cddCases.length === 0) return 'NOT_STARTED';

    const latestPerSubject =
      subjects.length > 0
        ? this.indexLatestCaseBySubject(subjects, cddCases)
        : [
            cddCases.sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            )[0],
          ];

    if (latestPerSubject.some((item) => !item)) return 'NOT_STARTED';
    if (latestPerSubject.some((item) => item.status === 'REJECTED')) return 'REJECTED';
    if (latestPerSubject.every((item) => item.status === 'APPROVED')) return 'APPROVED';
    if (latestPerSubject.some((item) => item.status === 'SUBMITTED')) return 'PENDING_REVIEW';
    if (latestPerSubject.some((item) => ['PENDING'].includes(item.status))) {
      return 'IN_PROGRESS';
    }

    return 'NOT_STARTED';
  }

  private determineEddStatus(
    subjects: SubjectDescriptor[],
    eddCases: any[],
    eddRequired: boolean,
  ): EddStatus {
    if (!eddRequired) return 'NOT_REQUIRED';
    if (eddCases.length === 0) return 'REQUIRED';

    const latestPerSubject =
      subjects.length > 0
        ? this.indexLatestCaseBySubject(subjects, eddCases)
        : [
            eddCases.sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            )[0],
          ];

    if (latestPerSubject.some((item) => !item)) return 'REQUIRED';
    if (latestPerSubject.some((item) => item.status === 'REJECTED')) return 'REJECTED';
    if (latestPerSubject.every((item) => item.status === 'APPROVED')) return 'APPROVED';

    if (latestPerSubject.some((item) => item.status === 'SUBMITTED')) {
      return 'PENDING_MLRO';
    }

    if (latestPerSubject.some((item) => ['PENDING'].includes(item.status))) {
      return 'IN_PROGRESS';
    }

    return 'REQUIRED';
  }

  private computeComplianceStatus(
    cddStatus: CddStatus,
    eddRequired: boolean,
    eddStatus: EddStatus,
    finalApprovalStatus: FinalApprovalStatus,
    isExpired: boolean,
  ): ComplianceStatus {
    if (isExpired || cddStatus === 'EXPIRED') {
      return 'EXPIRED';
    }

    if (cddStatus === 'REJECTED' || eddStatus === 'REJECTED' || finalApprovalStatus === 'REJECTED') {
      return 'BLOCKED';
    }

    if (cddStatus === 'NOT_STARTED') {
      return 'NONE';
    }

    if (['IN_PROGRESS', 'PENDING_REVIEW'].includes(cddStatus)) {
      return 'IN_PROGRESS';
    }

    if (cddStatus !== 'APPROVED') {
      return 'BLOCKED';
    }

    if (eddRequired && !['APPROVED', 'NOT_REQUIRED'].includes(eddStatus)) {
      return 'RESTRICTED';
    }

    if (eddRequired && finalApprovalStatus !== 'APPROVED') {
      return 'RESTRICTED';
    }

    return 'ACTIVE';
  }

  private pickCurrentCddCaseId(cddCases: any[]): string | null {
    const byPriority = [
      ...cddCases.filter((item) => ['PENDING'].includes(item.status)),
      ...cddCases.filter((item) => item.status === 'SUBMITTED'),
      ...cddCases,
    ];
    const target = byPriority[0] || null;
    return target?.id || null;
  }

  private pickCurrentEddCaseId(eddCases: any[]): string | null {
    const byPriority = [
      ...eddCases.filter((item) => ['PENDING'].includes(item.status)),
      ...eddCases.filter((item) => ['SUBMITTED'].includes(item.status)),
      ...eddCases,
    ];
    const target = byPriority[0] || null;
    return target?.id || null;
  }

  private async extractLatestRejectedReason(customerId: string): Promise<string | null> {
    const [rejectedCdd, rejectedEdd] = await Promise.all([
      (this.prisma as any).cddCase.findFirst({
        where: { customerId, status: 'REJECTED' },
        orderBy: { reviewedAt: 'desc' },
        select: { decisionReason: true, reviewedAt: true },
      }),
      (this.prisma as any).eddCase.findFirst({
        where: { customerId, status: 'REJECTED' },
        orderBy: { mlroReviewedAt: 'desc' },
        select: { decisionReason: true, mlroReviewedAt: true },
      }),
    ]);

    if (!rejectedCdd && !rejectedEdd) return null;
    const cddAt = rejectedCdd?.reviewedAt ? new Date(rejectedCdd.reviewedAt).getTime() : 0;
    const eddAt = rejectedEdd?.mlroReviewedAt ? new Date(rejectedEdd.mlroReviewedAt).getTime() : 0;

    if (eddAt > cddAt) return rejectedEdd?.decisionReason || 'EDD rejected.';
    return rejectedCdd?.decisionReason || 'CDD rejected.';
  }

  private isSameSnapshotValue(prev: any, next: any): boolean {
    if (prev == null && next == null) return true;
    if (prev instanceof Date || next instanceof Date) {
      const prevMs = prev == null ? null : new Date(prev).getTime();
      const nextMs = next == null ? null : new Date(next).getTime();
      return prevMs === nextMs;
    }
    return prev === next;
  }

  private buildSnapshotDiff(current: Record<string, any>, next: Record<string, any>) {
    const diff: Record<string, any> = {};
    Object.entries(next).forEach(([key, value]) => {
      if (!this.isSameSnapshotValue(current[key], value)) {
        diff[key] = value;
      }
    });
    return diff;
  }

  async recomputeComplianceSnapshot(customerId: string, journeyId?: string, txClient?: any) {
    const db = txClient || (this.prisma as any);

    const customer = await db.customerMain.findUnique({
      where: { id: customerId },
      include: {
        corporateProfile: true,
        uboProfiles: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const activeJourneyId = journeyId || (await this.getLatestJourneyId(customerId, db));
    const isDocumentExpired =
      !!customer.cddDocumentExpiresAt &&
      new Date(customer.cddDocumentExpiresAt).getTime() < Date.now();

    if (!activeJourneyId) {
      const data: Record<string, any> = {
        cddStatus: (isDocumentExpired ? 'EXPIRED' : 'NOT_STARTED') as CddStatus,
        amlRiskTier: this.normalizeRiskTier(customer.riskLevel),
        eddRequired: false,
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: (isDocumentExpired ? 'EXPIRED' : 'NONE') as ComplianceStatus,
        finalApprovalStatus: 'NOT_REQUIRED',
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
        nextReviewAt: null,
        currentCddCaseId: null,
        currentEddCaseId: null,
        investorClassification: customer.investorClassification || 'RETAIL',
      };
      const updateData = this.buildSnapshotDiff(customer, data);
      if (Object.keys(updateData).length > 0) {
        await db.customerMain.update({
          where: { id: customerId },
          data: updateData,
        });
      }
      return data;
    }

    const [cddCases, eddCases] = await Promise.all([
      db.cddCase.findMany({
        where: { customerId, journeyId: activeJourneyId },
        orderBy: { createdAt: 'desc' },
      }),
      db.eddCase.findMany({
        where: { customerId, journeyId: activeJourneyId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const subjects = this.buildSubjectDescriptorsSafe(customer);
    let cddStatus = this.determineCddStatus(subjects, cddCases);
    const shouldForceExpired =
      isDocumentExpired && !['IN_PROGRESS', 'PENDING_REVIEW'].includes(cddStatus);
    if (shouldForceExpired) {
      cddStatus = 'EXPIRED';
    }

    const riskTier: 'LOW' | 'MEDIUM' | 'HIGH' =
      cddCases.some((item: any) => this.normalizeRiskTier(item.riskLevel) === 'HIGH')
        ? 'HIGH'
        : cddCases.some((item: any) => this.normalizeRiskTier(item.riskLevel) === 'MEDIUM')
          ? 'MEDIUM'
          : 'LOW';

    const topRiskCase = [...cddCases]
      .filter((item) => typeof item.riskScore === 'number')
      .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))[0];

    const eddRequired = cddCases.some((item: any) => !!item.requiresEdd);
    const eddStatus = this.determineEddStatus(subjects, eddCases, eddRequired);

    let finalApprovalStatus: FinalApprovalStatus = 'NOT_REQUIRED';
    if (cddStatus === 'APPROVED' && eddRequired && eddStatus === 'APPROVED') {
      if (customer.finalApprovalStatus === 'APPROVED' || customer.finalApprovalStatus === 'REJECTED') {
        finalApprovalStatus = customer.finalApprovalStatus;
      } else {
        finalApprovalStatus = 'PENDING';
      }
    }

    const complianceStatus = this.computeComplianceStatus(
      cddStatus,
      eddRequired,
      eddStatus,
      finalApprovalStatus,
      shouldForceExpired,
    );

    const currentCddCaseId = this.pickCurrentCddCaseId(cddCases);
    const currentEddCaseId = this.pickCurrentEddCaseId(eddCases);

    let investorClassification: 'RETAIL' | 'QUALIFIED' | 'INSTITUTIONAL' =
      customer.investorClassification || 'RETAIL';
    let investorClassificationSource = customer.investorClassificationSource || 'CDD';
    let investorClassificationUpdatedAt = customer.investorClassificationUpdatedAt || null;

    if (investorClassificationSource !== 'ADMIN_OVERRIDE') {
      const approvedCdd = [...cddCases]
        .filter((item) => item.status === 'APPROVED')
        .sort((a, b) => {
          const aAt = a.reviewedAt ? new Date(a.reviewedAt).getTime() : 0;
          const bAt = b.reviewedAt ? new Date(b.reviewedAt).getTime() : 0;
          return bAt - aAt;
        })[0];

      if (approvedCdd) {
        const payload = this.parseJsonSafely(approvedCdd.inputData);
        const cddClassification = this.extractInvestorClassification(
          payload,
          this.getCustomerType(customer),
        );
        if (
          cddClassification !== customer.investorClassification ||
          customer.investorClassificationSource !== 'CDD'
        ) {
          investorClassification = cddClassification;
          investorClassificationSource = 'CDD';
          investorClassificationUpdatedAt = new Date();
        }
      }
    }

    const riskScore = topRiskCase?.riskScore ?? customer.riskScore ?? null;
    const riskLevel = topRiskCase?.riskLevel ?? customer.riskLevel ?? riskTier;
    const riskUpdatedAt =
      riskScore !== customer.riskScore || riskLevel !== customer.riskLevel
        ? new Date()
        : customer.riskUpdatedAt || null;

    let nextReviewAt: Date | null = null;
    if (cddStatus === 'APPROVED') {
      const previousRiskTier = this.normalizeRiskTier(customer.amlRiskTier || customer.riskLevel);
      const riskTierChanged = previousRiskTier !== riskTier;
      const justApproved = customer.cddStatus !== 'APPROVED';
      nextReviewAt =
        customer.nextReviewAt && !riskTierChanged && !justApproved
          ? customer.nextReviewAt
          : this.computeNextReviewAt(riskTier);
    }

    const finalApprovalMeta =
      finalApprovalStatus === 'NOT_REQUIRED' || finalApprovalStatus === 'PENDING'
        ? {
            finalApprovalReason: null,
            finalApprovalReviewerId: null,
            finalApprovalReviewedAt: null,
          }
        : {
            finalApprovalReason: customer.finalApprovalReason || null,
            finalApprovalReviewerId: customer.finalApprovalReviewerId || null,
            finalApprovalReviewedAt: customer.finalApprovalReviewedAt || null,
          };

    const data: Record<string, any> = {
      cddStatus,
      amlRiskTier: riskTier,
      eddRequired,
      eddStatus,
      complianceStatus,
      finalApprovalStatus,
      nextReviewAt,
      currentCddCaseId,
      currentEddCaseId,
      riskScore,
      riskLevel,
      riskUpdatedAt,
      investorClassification,
      investorClassificationSource,
      investorClassificationUpdatedAt,
      ...finalApprovalMeta,
    };

    const updateData = this.buildSnapshotDiff(customer, data);
    if (Object.keys(updateData).length > 0) {
      await db.customerMain.update({
        where: { id: customerId },
        data: updateData,
      });
    }

    return data;
  }

  private async enrichCasesWithSession(caseType: CaseType, cases: any[]): Promise<any[]> {
    if (cases.length === 0) return [];

    const ids = cases.map((item) => item.id);
    const sessions = await (this.prisma as any).complianceSession.findMany({
      where: {
        caseType,
        caseId: { in: ids },
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestSessionByCase: Record<string, any> = {};
    sessions.forEach((session: any) => {
      if (!latestSessionByCase[session.caseId]) {
        latestSessionByCase[session.caseId] = session;
      }
    });

    return cases.map((item) => {
      const latest = latestSessionByCase[item.id] || null;
      return {
        ...item,
        latestSession: latest,
      };
    });
  }

  private buildSessionPayload(session: any, caseType: CaseType) {
    return {
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      caseType,
      caseId: session.caseId,
      qrCodeUrl: session.qrCodeUrl,
      expiresAt: session.expiresAt,
      status: session.status,
    };
  }

  private async ensurePendingSessionForCase(
    customerId: string,
    actorId: string,
    caseType: CaseType,
    caseId: string,
  ) {
    const now = Date.now();
    const latestPending = await (this.prisma as any).complianceSession.findFirst({
      where: {
        customerId,
        caseType,
        caseId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    const within30Seconds =
      !!latestPending && now - new Date(latestPending.createdAt).getTime() <= 30 * 1000;
    if (within30Seconds && latestPending) {
      return {
        session: this.buildSessionPayload(latestPending, caseType),
        reused: true,
      };
    }

    const created = await this.createCaseSession(customerId, actorId, caseId, {
      caseType,
      provider: 'MOCK',
    });
    return {
      session: created,
      reused: false,
    };
  }

  async startCddCases(customerId: string, actorId: string, dto?: BootstrapCasesDto) {
    const bootstrapResult = await this.bootstrapCddCases(customerId, actorId, dto);
    await this.recomputeComplianceSnapshot(customerId, bootstrapResult.journeyId);

    const snapshot = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { currentCddCaseId: true },
    });

    const currentCddCaseId = snapshot?.currentCddCaseId || null;
    if (!currentCddCaseId) {
      throw new InternalServerErrorException(
        'CDD case has been created, but no current CDD case is available for QR generation.',
      );
    }

    let sessionPayload: {
      sessionId: string;
      providerSessionId: string;
      caseType: CaseType;
      caseId: string;
      qrCodeUrl: string;
      expiresAt: Date;
      status: string;
    };
    let reused = false;

    try {
      const ensured = await this.ensurePendingSessionForCase(
        customerId,
        actorId,
        'CDD',
        currentCddCaseId,
      );
      sessionPayload = ensured.session;
      reused = ensured.reused;
    } catch {
      throw new BadRequestException(
        'CDD case has been created. Failed to auto-create QR session, please retry generating QR.',
      );
    }

    await this.writeAudit({
      customerId,
      caseType: 'CDD',
      caseId: currentCddCaseId,
      action: 'CDD_SESSION_CREATED_AUTO',
      actorId,
      actorRole: actorId === customerId ? 'CUSTOMER' : 'ADMIN',
      detail: JSON.stringify({
        sessionId: sessionPayload.sessionId,
        providerSessionId: sessionPayload.providerSessionId,
        reused,
      }),
    });

    return {
      journeyId: bootstrapResult.journeyId,
      currentCddCaseId,
      session: sessionPayload,
      items: bootstrapResult.items,
    };
  }

  async startEddCases(customerId: string, actorId: string) {
    await this.recomputeComplianceSnapshot(customerId);
    const snapshot = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        cddStatus: true,
        eddRequired: true,
        eddStatus: true,
        currentEddCaseId: true,
      },
    });
    if (!snapshot) throw new NotFoundException('Customer not found');
    if (snapshot.cddStatus !== 'APPROVED') {
      throw new BadRequestException('CDD must be approved before starting EDD.');
    }
    if (!snapshot.eddRequired || !['REQUIRED', 'IN_PROGRESS'].includes(snapshot.eddStatus)) {
      throw new BadRequestException('EDD is not in startable state.');
    }

    const currentEddCaseId = snapshot.currentEddCaseId || null;
    if (!currentEddCaseId) {
      throw new InternalServerErrorException(
        'EDD case exists, but current EDD case is missing for QR generation.',
      );
    }

    const ensured = await this.ensurePendingSessionForCase(
      customerId,
      actorId,
      'EDD',
      currentEddCaseId,
    );

    await this.writeAudit({
      customerId,
      caseType: 'EDD',
      caseId: currentEddCaseId,
      action: 'EDD_SESSION_CREATED_AUTO',
      actorId,
      actorRole: actorId === customerId ? 'CUSTOMER' : 'ADMIN',
      detail: JSON.stringify({
        sessionId: ensured.session.sessionId,
        providerSessionId: ensured.session.providerSessionId,
        reused: ensured.reused,
      }),
    });

    return {
      currentEddCaseId,
      session: ensured.session,
    };
  }

  async getMyOnboarding(customerId: string) {
    await this.recomputeComplianceSnapshot(customerId);
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      include: {
        corporateProfile: true,
        uboProfiles: true,
        cddCases: { orderBy: { createdAt: 'desc' }, take: 20 },
        eddCases: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async listMyCases(customerId: string) {
    const [cddCases, eddCases] = await Promise.all([
      (this.prisma as any).cddCase.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).eddCase.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const [enrichedCdd, enrichedEdd] = await Promise.all([
      this.enrichCasesWithSession('CDD', cddCases),
      this.enrichCasesWithSession('EDD', eddCases),
    ]);

    return {
      items: [
        ...enrichedCdd.map((item) => ({ ...item, caseType: 'CDD' })),
        ...enrichedEdd.map((item) => ({ ...item, caseType: 'EDD' })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    };
  }

  async getNextStep(customerId: string): Promise<NextStepPayload> {
    await this.recomputeComplianceSnapshot(customerId);
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      include: {
        corporateProfile: true,
        uboProfiles: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.complianceStatus === 'ACTIVE') {
      return {
        step: 'COMPLETED',
        action: 'NONE',
        blockedReason: null,
        activeCaseId: null,
        requiresEdd: !!customer.eddRequired,
      };
    }

    if (customer.cddStatus === 'EXPIRED' || customer.complianceStatus === 'EXPIRED') {
      return {
        step: 'REINITIATE',
        action: 'REINITIATE_CDD',
        blockedReason: 'CDD document expired. Please re-initiate CDD verification.',
        activeCaseId: null,
        requiresEdd: !!customer.eddRequired,
      };
    }

    if (customer.cddStatus === 'REJECTED') {
      return {
        step: 'REINITIATE',
        action: 'REINITIATE_CDD',
        blockedReason:
          (await this.extractLatestRejectedReason(customerId)) || 'CDD rejected by compliance.',
        activeCaseId: null,
        requiresEdd: !!customer.eddRequired,
      };
    }

    if (customer.eddStatus === 'REJECTED' && customer.cddStatus === 'APPROVED') {
      return {
        step: 'REINITIATE',
        action: 'REINITIATE_EDD',
        blockedReason:
          (await this.extractLatestRejectedReason(customerId)) || 'EDD rejected by compliance.',
        activeCaseId: null,
        requiresEdd: !!customer.eddRequired,
      };
    }

    if (customer.customerType === 'UNKNOWN') {
      return {
        step: 'ENTITY_INFO',
        action: 'SAVE_ENTITY',
        blockedReason: 'Please identify account type first.',
        activeCaseId: null,
        requiresEdd: false,
      };
    }

    if (customer.customerType === 'CORPORATE') {
      const hasCorporateProfile = !!customer.corporateProfile;
      const hasUbos = Array.isArray(customer.uboProfiles) && customer.uboProfiles.length > 0;
      if (!hasCorporateProfile || !hasUbos) {
        return {
          step: 'ENTITY_INFO',
          action: 'SAVE_ENTITY',
          blockedReason: 'Corporate profile and UBO list are required.',
          activeCaseId: null,
          requiresEdd: false,
        };
      }
    }

    if (customer.cddStatus === 'NOT_STARTED') {
      return {
        step: 'CDD',
        action: 'START_CDD',
        blockedReason: null,
        activeCaseId: null,
        requiresEdd: false,
      };
    }

    if (customer.cddStatus === 'IN_PROGRESS') {
      return {
        step: 'CDD',
        action: 'COMPLETE_CDD',
        blockedReason: null,
        activeCaseId: customer.currentCddCaseId || null,
        requiresEdd: false,
      };
    }

    if (customer.cddStatus === 'PENDING_REVIEW') {
      return {
        step: 'WAIT_REVIEW',
        action: 'WAIT',
        blockedReason: 'CDD is under compliance review.',
        activeCaseId: customer.currentCddCaseId || null,
        requiresEdd: false,
      };
    }

    if (customer.cddStatus === 'APPROVED') {
      if (!customer.eddRequired || customer.eddStatus === 'NOT_REQUIRED') {
        return {
          step: customer.complianceStatus === 'ACTIVE' ? 'COMPLETED' : 'WAIT_REVIEW',
          action: customer.complianceStatus === 'ACTIVE' ? 'NONE' : 'WAIT',
          blockedReason:
            customer.complianceStatus === 'ACTIVE'
              ? null
              : 'Waiting for compliance status synchronization.',
          activeCaseId: null,
          requiresEdd: false,
        };
      }

      if (['REQUIRED', 'IN_PROGRESS'].includes(customer.eddStatus)) {
        return {
          step: 'EDD',
          action: 'COMPLETE_EDD',
          blockedReason: null,
          activeCaseId: customer.currentEddCaseId || null,
          requiresEdd: true,
        };
      }

      if (['PENDING_MLRO'].includes(customer.eddStatus)) {
        return {
          step: 'WAIT_REVIEW',
          action: 'WAIT',
          blockedReason: 'EDD is under compliance review.',
          activeCaseId: customer.currentEddCaseId || null,
          requiresEdd: true,
        };
      }

      if (customer.eddStatus === 'APPROVED' && customer.finalApprovalStatus === 'PENDING') {
        return {
          step: 'WAIT_REVIEW',
          action: 'WAIT',
          blockedReason: 'EDD approved. Waiting for final management sign-off.',
          activeCaseId: null,
          requiresEdd: true,
        };
      }

      if (customer.eddStatus === 'APPROVED' && customer.finalApprovalStatus === 'APPROVED') {
        return {
          step: 'COMPLETED',
          action: 'NONE',
          blockedReason: null,
          activeCaseId: null,
          requiresEdd: true,
        };
      }

      if (customer.eddStatus === 'APPROVED' && customer.finalApprovalStatus === 'REJECTED') {
        return {
          step: 'REINITIATE',
          action: 'REINITIATE_EDD',
          blockedReason: 'Final approval rejected. Please re-initiate EDD.',
          activeCaseId: null,
          requiresEdd: true,
        };
      }
    }

    return {
      step: 'CDD',
      action: 'START_CDD',
      blockedReason: null,
      activeCaseId: null,
      requiresEdd: !!customer.eddRequired,
    };
  }

  async assertTradingEligibility(customerId: string, action: TradeAction) {
    await this.recomputeComplianceSnapshot(customerId);
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        complianceStatus: true,
        cddStatus: true,
        eddRequired: true,
        eddStatus: true,
        finalApprovalStatus: true,
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (customer.complianceStatus !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'ONBOARDING_REQUIRED',
        complianceStatus: customer.complianceStatus,
        cddStatus: customer.cddStatus,
        eddRequired: customer.eddRequired,
        eddStatus: customer.eddStatus,
        finalApprovalStatus: customer.finalApprovalStatus,
        nextAction: action,
      });
    }
  }

  async upsertEntity(customerId: string, actorId: string, dto: UpsertEntityDto) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        customerType: true,
        companyName: true,
        complianceStatus: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const lockedType =
      customer.customerType === 'UNKNOWN'
        ? dto.customerType
        : (customer.customerType as 'INDIVIDUAL' | 'CORPORATE');

    if (customer.customerType !== 'UNKNOWN' && dto.customerType !== lockedType) {
      throw new BadRequestException('Customer type is locked after registration.');
    }

    if (lockedType === 'INDIVIDUAL') {
      if (dto.corporateProfile || (dto.ubos && dto.ubos.length > 0)) {
        throw new BadRequestException(
          'Individual customer should not submit corporate profile or UBO list.',
        );
      }
    }

    if (lockedType === 'CORPORATE') {
      if (!dto.corporateProfile) {
        throw new BadRequestException('corporateProfile is required for corporate customer.');
      }
      if (!dto.ubos || dto.ubos.length === 0) {
        throw new BadRequestException('ubos is required for corporate customer.');
      }
    }

    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.customerMain.update({
        where: { id: customerId },
        data: {
          customerType: lockedType,
          companyName:
            lockedType === 'CORPORATE'
              ? dto.corporateProfile?.companyName?.trim() || customer.companyName || null
              : null,
        },
      });

      if (lockedType === 'CORPORATE' && dto.corporateProfile) {
        await tx.corporateProfile.upsert({
          where: { customerId },
          create: {
            customerId,
            companyName: dto.corporateProfile.companyName.trim(),
            registrationNo: dto.corporateProfile.registrationNo,
            incorporationCountry: dto.corporateProfile.incorporationCountry,
            registeredAddress: dto.corporateProfile.registeredAddress || null,
            licenseType: dto.corporateProfile.licenseType || null,
            licenseNumber: dto.corporateProfile.licenseNumber || null,
            authorizedSignatoryName: dto.corporateProfile.authorizedSignatoryName || null,
            authorizedSignatoryTitle: dto.corporateProfile.authorizedSignatoryTitle || null,
            documents: dto.corporateProfile.documents
              ? JSON.stringify(dto.corporateProfile.documents)
              : null,
          },
          update: {
            companyName: dto.corporateProfile.companyName.trim(),
            registrationNo: dto.corporateProfile.registrationNo,
            incorporationCountry: dto.corporateProfile.incorporationCountry,
            registeredAddress: dto.corporateProfile.registeredAddress || null,
            licenseType: dto.corporateProfile.licenseType || null,
            licenseNumber: dto.corporateProfile.licenseNumber || null,
            authorizedSignatoryName: dto.corporateProfile.authorizedSignatoryName || null,
            authorizedSignatoryTitle: dto.corporateProfile.authorizedSignatoryTitle || null,
            documents: dto.corporateProfile.documents
              ? JSON.stringify(dto.corporateProfile.documents)
              : null,
          },
        });

        await tx.uboProfile.deleteMany({ where: { customerId } });
        if (dto.ubos && dto.ubos.length > 0) {
          await tx.uboProfile.createMany({
            data: dto.ubos.map((ubo) => ({
              customerId,
              fullName: ubo.fullName,
              ownershipPercent:
                typeof ubo.ownershipPercent === 'number'
                  ? new Prisma.Decimal(ubo.ownershipPercent)
                  : null,
              nationality: ubo.nationality || null,
              idNumber: ubo.idNumber || null,
              pepFlag: !!ubo.pepFlag,
              status: 'PENDING',
              documents: ubo.documents ? JSON.stringify(ubo.documents) : null,
            })),
          });
        }
      }

      if (lockedType === 'INDIVIDUAL') {
        await tx.corporateProfile.deleteMany({ where: { customerId } });
        await tx.uboProfile.deleteMany({ where: { customerId } });
      }

      await this.recomputeComplianceSnapshot(customerId, undefined, tx);
    });

    const updated = await this.prisma.customerMain.findUnique({ where: { id: customerId } });

    await this.writeAudit({
      customerId,
      action: 'ENTITY_UPSERT',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage: customer.complianceStatus,
      toStage: updated?.complianceStatus || customer.complianceStatus,
      detail: JSON.stringify({ customerType: lockedType }),
    });

    return updated;
  }

  async bootstrapCddCases(customerId: string, actorId: string, dto?: BootstrapCasesDto) {
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      include: {
        corporateProfile: true,
        uboProfiles: true,
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');
    this.getCustomerType(customer);

    const fromStatus = customer.complianceStatus;
    const result = await (this.prisma as any).$transaction(async (tx: any) => {
      const journeyId =
        dto?.journeyId ||
        (['REJECTED', 'EXPIRED'].includes(customer.cddStatus)
          ? generateReferenceNo('ONB')
          : await this.resolveJourneyId(customerId, undefined, tx));

      const subjects = this.buildSubjectDescriptors(customer);

      const cases: any[] = [];
      for (const subject of subjects) {
        const existing = await tx.cddCase.findFirst({
          where: {
            customerId,
            journeyId,
            subjectKind: subject.subjectKind,
            subjectRefId: subject.subjectRefId,
            status: {
              in: ['PENDING', 'SUBMITTED', 'APPROVED'],
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existing) {
          cases.push(existing);
          continue;
        }

        const created = await tx.cddCase.create({
          data: {
            customerId,
            caseNo: generateReferenceNo('CDD'),
            customerType: customer.customerType,
            status: 'PENDING',
            subjectKind: subject.subjectKind,
            subjectRefId: subject.subjectRefId,
            journeyId,
          },
        });
        cases.push(created);

        await this.updateUboCaseStatus(tx, subject.subjectKind, subject.subjectRefId, 'CDD_IN_PROGRESS');
      }

      await this.recomputeComplianceSnapshot(customerId, journeyId, tx);
      return { journeyId, cases };
    });

    const updated = await this.prisma.customerMain.findUnique({ where: { id: customerId } });

    await this.writeAudit({
      customerId,
      action: 'CDD_BOOTSTRAP',
      actorId,
      actorRole: actorId === customerId ? 'CUSTOMER' : 'ADMIN',
      fromStage: fromStatus,
      toStage: updated?.complianceStatus || fromStatus,
      detail: JSON.stringify({ journeyId: result.journeyId, count: result.cases.length }),
    });

    return {
      journeyId: result.journeyId,
      items: result.cases,
    };
  }

  async bootstrapEddCases(customerId: string, actorId: string, dto?: BootstrapCasesDto) {
    if (actorId === customerId) {
      throw new BadRequestException('AUTO_ONLY: EDD bootstrap is triggered by compliance decision.');
    }

    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      include: {
        corporateProfile: true,
        uboProfiles: true,
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');
    this.getCustomerType(customer);

    const approvedRequiresEddCase = await (this.prisma as any).cddCase.findFirst({
      where: {
        customerId,
        status: 'APPROVED',
        requiresEdd: true,
      },
      orderBy: { reviewedAt: 'desc' },
    });

    if (!approvedRequiresEddCase) {
      throw new BadRequestException('EDD bootstrap blocked: no approved CDD case requiring EDD.');
    }

    const fromStatus = customer.complianceStatus;
    const result = await (this.prisma as any).$transaction(async (tx: any) => {
      const journeyId =
        dto?.journeyId ||
        approvedRequiresEddCase.journeyId ||
        (await this.resolveJourneyId(customerId, undefined, tx));

      const cddCases = await tx.cddCase.findMany({
        where: {
          customerId,
          journeyId,
        },
      });

      const hasEddTrigger = cddCases.some((item: any) => !!item.requiresEdd);
      if (!hasEddTrigger) {
        throw new BadRequestException('EDD bootstrap blocked: CDD review has not triggered EDD.');
      }

      const subjects = this.buildSubjectDescriptors(customer);
      const allCddApproved = subjects.every((subject) =>
        cddCases.some(
          (item: any) =>
            item.subjectKind === subject.subjectKind &&
            item.subjectRefId === subject.subjectRefId &&
            item.status === 'APPROVED',
        ),
      );

      if (!allCddApproved) {
        throw new BadRequestException('EDD bootstrap blocked: required CDD cases are not fully approved.');
      }

      const cases: any[] = [];

      for (const subject of subjects) {
        const existing = await tx.eddCase.findFirst({
          where: {
            customerId,
            journeyId,
            subjectKind: subject.subjectKind,
            subjectRefId: subject.subjectRefId,
            status: {
              in: ['PENDING', 'SUBMITTED', 'APPROVED'],
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existing) {
          cases.push(existing);
          continue;
        }

        const sourceCddCase = cddCases.find(
          (item: any) =>
            item.subjectKind === subject.subjectKind && item.subjectRefId === subject.subjectRefId,
        );

        const created = await tx.eddCase.create({
          data: {
            caseNo: generateReferenceNo('EDD'),
            customerId,
            cddCaseId: sourceCddCase?.id || null,
            status: 'PENDING',
            subjectKind: subject.subjectKind,
            subjectRefId: subject.subjectRefId,
            journeyId,
          },
        });

        cases.push(created);
        await this.updateUboCaseStatus(tx, subject.subjectKind, subject.subjectRefId, 'EDD_IN_PROGRESS');
      }

      await this.recomputeComplianceSnapshot(customerId, journeyId, tx);
      return { journeyId, cases };
    });

    await this.recomputeComplianceSnapshot(customerId, result.journeyId);
    const updated = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        complianceStatus: true,
        currentEddCaseId: true,
      },
    });
    const currentEddCaseId = updated?.currentEddCaseId || null;
    if (!currentEddCaseId) {
      throw new InternalServerErrorException(
        'EDD cases were created, but current EDD case is missing for QR generation.',
      );
    }

    let autoSession:
      | {
          sessionId: string;
          providerSessionId: string;
          caseType: CaseType;
          caseId: string;
          qrCodeUrl: string;
          expiresAt: Date;
          status: string;
        }
      | null = null;
    let reused = false;
    try {
      const ensured = await this.ensurePendingSessionForCase(
        customerId,
        actorId,
        'EDD',
        currentEddCaseId,
      );
      autoSession = ensured.session;
      reused = ensured.reused;
    } catch {
      throw new BadRequestException(
        'EDD cases have been created. Failed to auto-create QR session, please retry generating QR.',
      );
    }

    await this.writeAudit({
      customerId,
      caseType: 'EDD',
      caseId: currentEddCaseId,
      action: 'EDD_SESSION_CREATED_AUTO',
      actorId,
      actorRole: actorId === customerId ? 'CUSTOMER' : 'ADMIN',
      detail: JSON.stringify({
        sessionId: autoSession.sessionId,
        providerSessionId: autoSession.providerSessionId,
        reused,
      }),
    });

    await this.writeAudit({
      customerId,
      action: 'EDD_BOOTSTRAP',
      actorId,
      actorRole: actorId === customerId ? 'CUSTOMER' : 'ADMIN',
      fromStage: fromStatus,
      toStage: updated?.complianceStatus || fromStatus,
      detail: JSON.stringify({
        journeyId: result.journeyId,
        count: result.cases.length,
        currentEddCaseId,
      }),
    });

    return {
      journeyId: result.journeyId,
      items: result.cases,
      currentEddCaseId,
      session: autoSession,
    };
  }

  async createCaseSession(
    customerId: string,
    actorId: string,
    caseId: string,
    dto: CreateCaseSessionDto,
  ) {
    let caseType = dto.caseType as CaseType | undefined;
    let targetCase: any = null;

    if (!caseType || caseType === 'CDD') {
      const cddCase = await (this.prisma as any).cddCase.findFirst({
        where: { id: caseId, customerId },
      });
      if (cddCase) {
        caseType = 'CDD';
        targetCase = cddCase;
      }
    }

    if ((!caseType || caseType === 'EDD') && !targetCase) {
      const eddCase = await (this.prisma as any).eddCase.findFirst({
        where: { id: caseId, customerId },
      });
      if (eddCase) {
        caseType = 'EDD';
        targetCase = eddCase;
      }
    }

    if (!targetCase || !caseType) {
      throw new NotFoundException('Case not found');
    }

    if (targetCase.status !== 'PENDING') {
      throw new BadRequestException('QR session can only be created for pending cases.');
    }

    const provider = (dto.provider || 'MOCK').toUpperCase();
    if (provider !== 'MOCK') {
      throw new BadRequestException('Only MOCK provider is enabled in current phase.');
    }

    const providerSessionId = generateReferenceNo('SES');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const qrCodeUrl = `mock://compliance/${providerSessionId}`;

    await (this.prisma as any).complianceSession.updateMany({
      where: {
        customerId,
        caseType,
        caseId,
        status: 'PENDING',
      },
      data: {
        status: 'EXPIRED',
        completedAt: new Date(),
      },
    });

    const session = await (this.prisma as any).complianceSession.create({
      data: {
        customerId,
        caseType,
        caseId,
        provider,
        providerSessionId,
        qrCodeUrl,
        status: 'PENDING',
        rawPayload: JSON.stringify({
          provider,
          caseType,
          caseNo: targetCase.caseNo,
          subjectKind: targetCase.subjectKind,
          subjectRefId: targetCase.subjectRefId,
        }),
        expiresAt,
      },
    });

    await this.writeAudit({
      customerId,
      caseType,
      caseId,
      action: `${caseType}_SESSION_CREATED`,
      actorId,
      actorRole: actorId === customerId ? 'CUSTOMER' : 'ADMIN',
      detail: JSON.stringify({ sessionId: session.id, providerSessionId }),
    });

    return {
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      caseType,
      caseId,
      qrCodeUrl: session.qrCodeUrl,
      expiresAt: session.expiresAt,
      status: session.status,
    };
  }

  async mockCompleteSession(
    customerId: string,
    actorId: string,
    sessionId: string,
    dto?: MockCompleteSessionDto,
  ) {
    const session =
      (await (this.prisma as any).complianceSession.findFirst({
        where: { id: sessionId, customerId },
      })) ||
      (await (this.prisma as any).complianceSession.findFirst({
        where: { providerSessionId: sessionId, customerId },
      }));

    if (!session) {
      throw new NotFoundException('Compliance session not found');
    }

    if (session.status !== 'PENDING') {
      throw new BadRequestException('Only pending session can be completed.');
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await (this.prisma as any).complianceSession.update({
        where: { id: session.id },
        data: {
          status: 'EXPIRED',
          completedAt: new Date(),
        },
      });
      throw new BadRequestException('Compliance session expired. Please regenerate QR session.');
    }

    const result = dto?.result || 'PASS';

    await (this.prisma as any).$transaction(async (tx: any) => {
      const completedAt = new Date();
      const sessionStatus = result === 'PASS' ? 'COMPLETED' : 'FAILED';
      const sessionPayload = {
        ...this.parseJsonSafely(session.rawPayload),
        mockResult: result,
        completedAt: completedAt.toISOString(),
      };

      await tx.complianceSession.update({
        where: { id: session.id },
        data: {
          status: sessionStatus,
          completedAt,
          rawPayload: JSON.stringify(sessionPayload),
        },
      });

      if (session.caseType === 'CDD') {
        const cddCase = await tx.cddCase.findFirst({
          where: { id: session.caseId, customerId },
        });
        if (!cddCase) return;
        if (cddCase.status !== 'PENDING') {
          throw new BadRequestException('CDD case is not pending and cannot accept session callback.');
        }

        const normalizedPayload = {
          ...this.buildMockDetail('CDD', cddCase.caseNo, cddCase.subjectKind),
          result,
          caseNo: cddCase.caseNo,
        };

        await tx.cddCaseReport.create({
          data: {
            customerId,
            cddCaseId: cddCase.id,
            provider: session.provider,
            providerSessionId: session.providerSessionId,
            rawPayload: JSON.stringify(sessionPayload),
            normalizedPayload: JSON.stringify(normalizedPayload),
            receivedAt: completedAt,
          },
        });

        await tx.cddCase.update({
          where: { id: cddCase.id },
          data:
            result === 'PASS'
              ? {
                  status: 'SUBMITTED',
                  submittedAt: completedAt,
                }
              : {
                  status: 'REJECTED',
                  reviewedAt: completedAt,
                  reviewerId: actorId,
                  reviewerRole: 'SYSTEM',
                  reviewerDecision: 'REJECT',
                  decisionReason: 'Mock provider returned FAIL result.',
                },
        });

        await this.recomputeComplianceSnapshot(customerId, cddCase.journeyId, tx);
      } else {
        const eddCase = await tx.eddCase.findFirst({
          where: { id: session.caseId, customerId },
        });
        if (!eddCase) return;
        if (eddCase.status !== 'PENDING') {
          throw new BadRequestException('EDD case is not pending and cannot accept session callback.');
        }

        const normalizedPayload = {
          ...this.buildMockDetail('EDD', eddCase.caseNo, eddCase.subjectKind),
          result,
          caseNo: eddCase.caseNo,
        };

        await tx.eddCaseReport.create({
          data: {
            customerId,
            eddCaseId: eddCase.id,
            provider: session.provider,
            providerSessionId: session.providerSessionId,
            rawPayload: JSON.stringify(sessionPayload),
            normalizedPayload: JSON.stringify(normalizedPayload),
            receivedAt: completedAt,
          },
        });

        await tx.eddCase.update({
          where: { id: eddCase.id },
          data:
            result === 'PASS'
              ? {
                  status: 'SUBMITTED',
                  submittedAt: completedAt,
                }
              : {
                  status: 'REJECTED',
                  mlroReviewedAt: completedAt,
                  mlroReviewerId: actorId,
                  mlroDecision: 'REJECT',
                  decisionReason: 'Mock provider returned FAIL result.',
                },
        });

        await this.recomputeComplianceSnapshot(customerId, eddCase.journeyId, tx);
      }
    });

    const updated = await this.prisma.customerMain.findUnique({ where: { id: customerId } });

    await this.writeAudit({
      customerId,
      caseType: session.caseType,
      caseId: session.caseId,
      action: `${session.caseType}_SESSION_${result}`,
      actorId,
      actorRole: 'CUSTOMER',
      toStage: updated?.complianceStatus || null,
      detail: JSON.stringify({ sessionId: session.id }),
    });

    return {
      sessionId: session.id,
      status: result === 'PASS' ? 'COMPLETED' : 'FAILED',
      caseType: session.caseType,
      caseId: session.caseId,
    };
  }

  async listCddCases(params: {
    status?: string;
    customerType?: string;
    customerIds?: string[];
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.customerType) where.customerType = params.customerType;
    if (params.customerIds && params.customerIds.length > 0) {
      where.customerId = { in: params.customerIds };
    }

    const scopedByCustomerIds = !!(params.customerIds && params.customerIds.length > 0);
    const skip = params.skip ?? (scopedByCustomerIds ? undefined : 0);
    const take = params.take ?? (scopedByCustomerIds ? undefined : 20);

    const query: any = {
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: {
            customerNo: true,
            email: true,
            firstName: true,
            lastName: true,
            companyName: true,
            complianceStatus: true,
            customerType: true,
          },
        },
      },
    };
    if (typeof skip === 'number') query.skip = skip;
    if (typeof take === 'number') query.take = take;

    const [items, total] = await Promise.all([
      (this.prisma as any).cddCase.findMany(query),
      (this.prisma as any).cddCase.count({ where }),
    ]);

    const enrichedItems = await this.enrichCasesWithSession('CDD', items);
    return { items: enrichedItems, total };
  }

  async reviewCddCase(
    caseId: string,
    actorId: string,
    actorRole: string,
    dto: ReviewCddCaseDto,
  ) {
    const cddCase = await (this.prisma as any).cddCase.findUnique({
      where: { id: caseId },
      include: {
        customer: {
          include: {
            corporateProfile: true,
            uboProfiles: true,
          },
        },
      },
    });

    if (!cddCase) throw new NotFoundException('CDD case not found');
    if (!['SUBMITTED'].includes(cddCase.status)) {
      throw new BadRequestException('Only submitted CDD case can be reviewed.');
    }

    const decidedRiskScore =
      typeof dto.riskScore === 'number' ? dto.riskScore : cddCase.riskScore || 0;
    const decidedRiskLevel =
      decidedRiskScore >= 70 ? 'HIGH' : decidedRiskScore >= 40 ? 'MEDIUM' : 'LOW';
    const decidedRequiresEdd =
      dto.decision === 'UPGRADE_EDD'
        ? true
        : typeof dto.requiresEdd === 'boolean'
          ? dto.requiresEdd
          : cddCase.requiresEdd || decidedRiskLevel === 'HIGH';

    const customerId = cddCase.customerId;
    let caseStatus = cddCase.status;

    await (this.prisma as any).$transaction(async (tx: any) => {
      if (dto.decision === 'REJECT') {
        caseStatus = 'REJECTED';

        await tx.cddCase.update({
          where: { id: caseId },
          data: {
            status: caseStatus,
            reviewedAt: new Date(),
            reviewerId: actorId,
            reviewerRole: actorRole,
            reviewerDecision: dto.decision,
            decisionReason: dto.reason || null,
          },
        });

        await this.updateUboCaseStatus(tx, cddCase.subjectKind, cddCase.subjectRefId, 'REJECTED');
      } else {
        caseStatus = 'APPROVED';

        await tx.cddCase.update({
          where: { id: caseId },
          data: {
            status: caseStatus,
            reviewedAt: new Date(),
            reviewerId: actorId,
            reviewerRole: actorRole,
            reviewerDecision: dto.decision,
            decisionReason: dto.reason || null,
            riskScore: decidedRiskScore,
            riskLevel: decidedRiskLevel,
            requiresEdd: decidedRequiresEdd,
          },
        });

        await this.updateUboCaseStatus(
          tx,
          cddCase.subjectKind,
          cddCase.subjectRefId,
          'CDD_APPROVED',
        );

        if (cddCase.customer.investorClassificationSource !== 'ADMIN_OVERRIDE') {
          const payload = this.parseJsonSafely(cddCase.inputData);
          const classification = this.extractInvestorClassification(
            payload,
            this.getCustomerType(cddCase.customer),
          );
          await tx.customerMain.update({
            where: { id: customerId },
            data: {
              investorClassification: classification,
              investorClassificationSource: 'CDD',
              investorClassificationUpdatedAt: new Date(),
            },
          });
        }
      }

      await this.recomputeComplianceSnapshot(customerId, cddCase.journeyId, tx);
    });

    const snapshot = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        cddStatus: true,
        eddRequired: true,
        eddStatus: true,
        complianceStatus: true,
      },
    });

    if (
      dto.decision !== 'REJECT' &&
      snapshot?.cddStatus === 'APPROVED' &&
      snapshot.eddRequired &&
      ['REQUIRED', 'IN_PROGRESS'].includes(snapshot.eddStatus)
    ) {
      await this.bootstrapEddCases(customerId, actorId, {
        journeyId: cddCase.journeyId,
      });
    }

    await this.writeAudit({
      customerId,
      caseType: 'CDD',
      caseId,
      action: `CDD_${dto.decision}`,
      actorId,
      actorRole,
      toStage: snapshot?.complianceStatus || null,
      detail: JSON.stringify({
        decision: dto.decision,
        riskScore: decidedRiskScore,
        riskLevel: decidedRiskLevel,
        requiresEdd: decidedRequiresEdd,
        reason: dto.reason || null,
      }),
    });

    return { id: caseId, status: caseStatus, complianceStatus: snapshot?.complianceStatus };
  }

  async listEddCases(params: {
    status?: string;
    customerIds?: string[];
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.customerIds && params.customerIds.length > 0) {
      where.customerId = { in: params.customerIds };
    }

    const scopedByCustomerIds = !!(params.customerIds && params.customerIds.length > 0);
    const skip = params.skip ?? (scopedByCustomerIds ? undefined : 0);
    const take = params.take ?? (scopedByCustomerIds ? undefined : 20);

    const query: any = {
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: {
            customerNo: true,
            email: true,
            firstName: true,
            lastName: true,
            companyName: true,
            complianceStatus: true,
            customerType: true,
          },
        },
        cddCase: {
          select: {
            caseNo: true,
            riskScore: true,
            riskLevel: true,
          },
        },
      },
    };
    if (typeof skip === 'number') query.skip = skip;
    if (typeof take === 'number') query.take = take;

    const [items, total] = await Promise.all([
      (this.prisma as any).eddCase.findMany(query),
      (this.prisma as any).eddCase.count({ where }),
    ]);

    const enrichedItems = await this.enrichCasesWithSession('EDD', items);
    return { items: enrichedItems, total };
  }

  async mlroReviewEddCase(
    caseId: string,
    actorId: string,
    actorRole: string,
    dto: ReviewEddCaseDto,
  ) {
    const eddCase = await (this.prisma as any).eddCase.findUnique({
      where: { id: caseId },
      include: {
        customer: {
          include: {
            corporateProfile: true,
            uboProfiles: true,
          },
        },
      },
    });

    if (!eddCase) throw new NotFoundException('EDD case not found');
    if (!['SUBMITTED'].includes(eddCase.status)) {
      throw new BadRequestException('Only submitted EDD case can be reviewed by MLRO.');
    }

    const customerId = eddCase.customerId;
    let status = eddCase.status;

    await (this.prisma as any).$transaction(async (tx: any) => {
      if (dto.decision === 'APPROVE') {
        status = 'APPROVED';

        await tx.eddCase.update({
          where: { id: caseId },
          data: {
            status,
            mlroReviewedAt: new Date(),
            mlroReviewerId: actorId,
            mlroDecision: dto.decision,
            decisionReason: dto.reason || null,
          },
        });

        await this.updateUboCaseStatus(
          tx,
          eddCase.subjectKind,
          eddCase.subjectRefId,
          'EDD_APPROVED',
        );
      } else if (dto.decision === 'REJECT') {
        status = 'REJECTED';

        await tx.eddCase.update({
          where: { id: caseId },
          data: {
            status,
            mlroReviewedAt: new Date(),
            mlroReviewerId: actorId,
            mlroDecision: dto.decision,
            decisionReason: dto.reason || null,
          },
        });

        await this.updateUboCaseStatus(tx, eddCase.subjectKind, eddCase.subjectRefId, 'REJECTED');
      }

      await this.recomputeComplianceSnapshot(customerId, eddCase.journeyId, tx);
    });

    const snapshot = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { complianceStatus: true },
    });

    await this.writeAudit({
      customerId,
      caseType: 'EDD',
      caseId,
      action: `EDD_MLRO_${dto.decision}`,
      actorId,
      actorRole,
      toStage: snapshot?.complianceStatus || null,
      detail: dto.reason || null,
    });

    return { id: caseId, status, complianceStatus: snapshot?.complianceStatus };
  }

  async getCddCaseDetail(caseId: string) {
    const cddCase = await (this.prisma as any).cddCase.findUnique({
      where: { id: caseId },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            firstName: true,
            lastName: true,
            companyName: true,
            customerType: true,
            cddStatus: true,
            eddRequired: true,
            eddStatus: true,
            complianceStatus: true,
            cddDocumentExpiresAt: true,
            finalApprovalStatus: true,
            finalApprovalReason: true,
            finalApprovalReviewerId: true,
            finalApprovalReviewedAt: true,
            investorClassification: true,
          },
        },
      },
    });

    if (!cddCase) {
      throw new NotFoundException('CDD case not found');
    }

    const [latestSession, latestReport] = await Promise.all([
      (this.prisma as any).complianceSession.findFirst({
        where: {
          caseType: 'CDD',
          caseId: cddCase.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).cddCaseReport.findFirst({
        where: { cddCaseId: cddCase.id },
        orderBy: { receivedAt: 'desc' },
      }),
    ]);

    return {
      ...cddCase,
      inputData: this.parseJsonSafely(cddCase.inputData),
      customerSnapshot: cddCase.customer,
      latestSession,
      latestReport: latestReport
        ? {
            ...latestReport,
            rawPayload: this.parseJsonSafely(latestReport.rawPayload),
            normalizedPayload: this.parseJsonSafely(latestReport.normalizedPayload),
          }
        : null,
      mockDetail: this.buildMockDetail('CDD', cddCase.caseNo, cddCase.subjectKind),
    };
  }

  async getEddCaseDetail(caseId: string) {
    const eddCase = await (this.prisma as any).eddCase.findUnique({
      where: { id: caseId },
      include: {
        cddCase: {
          select: {
            caseNo: true,
            riskScore: true,
            riskLevel: true,
          },
        },
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            firstName: true,
            lastName: true,
            companyName: true,
            customerType: true,
            cddStatus: true,
            eddRequired: true,
            eddStatus: true,
            complianceStatus: true,
            cddDocumentExpiresAt: true,
            finalApprovalStatus: true,
            finalApprovalReason: true,
            finalApprovalReviewerId: true,
            finalApprovalReviewedAt: true,
            investorClassification: true,
          },
        },
      },
    });

    if (!eddCase) {
      throw new NotFoundException('EDD case not found');
    }

    const [latestSession, latestReport] = await Promise.all([
      (this.prisma as any).complianceSession.findFirst({
        where: {
          caseType: 'EDD',
          caseId: eddCase.id,
        },
        orderBy: { createdAt: 'desc' },
      }),
      (this.prisma as any).eddCaseReport.findFirst({
        where: { eddCaseId: eddCase.id },
        orderBy: { receivedAt: 'desc' },
      }),
    ]);

    return {
      ...eddCase,
      inputData: this.parseJsonSafely(eddCase.inputData),
      customerSnapshot: eddCase.customer,
      latestSession,
      latestReport: latestReport
        ? {
            ...latestReport,
            rawPayload: this.parseJsonSafely(latestReport.rawPayload),
            normalizedPayload: this.parseJsonSafely(latestReport.normalizedPayload),
          }
        : null,
      mockDetail: this.buildMockDetail('EDD', eddCase.caseNo, eddCase.subjectKind),
    };
  }

  async reinitiateCddCases(customerId: string, actorId: string) {
    const nextStep = await this.getNextStep(customerId);
    if (nextStep.action !== 'REINITIATE_CDD') {
      throw new BadRequestException('CDD re-initiation is not allowed in current onboarding state.');
    }

    const snapshotBefore = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        cddStatus: true,
        complianceStatus: true,
      },
    });
    const expiredTriggered = !!snapshotBefore &&
      (snapshotBefore.cddStatus === 'EXPIRED' || snapshotBefore.complianceStatus === 'EXPIRED');

    const bootstrapResult = await this.bootstrapCddCases(customerId, actorId, {});

    if (expiredTriggered) {
      await this.prisma.customerMain.update({
        where: { id: customerId },
        data: { cddDocumentExpiresAt: null },
      });
    }

    await this.recomputeComplianceSnapshot(customerId, bootstrapResult.journeyId);
    const snapshot = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        currentCddCaseId: true,
      },
    });

    const currentCddCaseId = snapshot?.currentCddCaseId || null;
    if (!currentCddCaseId) {
      await this.writeAudit({
        customerId,
        caseType: 'CDD',
        action: 'CDD_REINITIATE_ERROR',
        actorId,
        actorRole: 'CUSTOMER',
        detail: 'New CDD case created but currentCddCaseId is empty.',
      });
      throw new InternalServerErrorException(
        'New CDD case created, but no active CDD case was selected. Please retry.',
      );
    }

    let ensuredSession:
      | {
          session: {
            sessionId: string;
            providerSessionId: string;
            caseType: CaseType;
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
          };
          reused: boolean;
        }
      | null = null;

    try {
      ensuredSession = await this.ensurePendingSessionForCase(
        customerId,
        actorId,
        'CDD',
        currentCddCaseId,
      );
    } catch {
      throw new BadRequestException(
        'New CDD case has been created. Failed to auto-create QR session, please retry creating QR.',
      );
    }

    await this.recomputeComplianceSnapshot(customerId, bootstrapResult.journeyId);

    await this.writeAudit({
      customerId,
      caseType: 'CDD',
      caseId: currentCddCaseId,
      action: 'CDD_REINITIATED',
      actorId,
      actorRole: 'CUSTOMER',
      detail: JSON.stringify({
        journeyId: bootstrapResult.journeyId,
        autoSessionCaseId: currentCddCaseId,
        expiredFieldCleared: expiredTriggered,
      }),
    });

    await this.writeAudit({
      customerId,
      caseType: 'CDD',
      caseId: currentCddCaseId,
      action: 'CDD_SESSION_CREATED_AUTO',
      actorId,
      actorRole: 'CUSTOMER',
      detail: JSON.stringify({
        sessionId: ensuredSession?.session.sessionId || null,
        providerSessionId: ensuredSession?.session.providerSessionId || null,
        reused: ensuredSession?.reused || false,
      }),
    });

    return {
      journeyId: bootstrapResult.journeyId,
      currentCddCaseId,
      session: ensuredSession?.session || null,
      items: bootstrapResult.items,
    };
  }

  async reinitiateEddCases(customerId: string, actorId: string, dto?: ReinitiateEddDto) {
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      include: {
        corporateProfile: true,
        uboProfiles: true,
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');
    if (customer.cddStatus !== 'APPROVED') {
      throw new BadRequestException('EDD re-initiation requires approved CDD status.');
    }
    if (!(customer.eddStatus === 'REJECTED' || customer.finalApprovalStatus === 'REJECTED')) {
      throw new BadRequestException(
        'EDD re-initiation is allowed only after EDD or final-approval rejection.',
      );
    }

    const fromStatus = customer.complianceStatus;
    const result = await (this.prisma as any).$transaction(async (tx: any) => {
      const journeyId =
        dto?.journeyId || (await this.getLatestJourneyId(customerId, tx)) || generateReferenceNo('ONB');
      const subjects = this.buildSubjectDescriptors(customer);

      const cddCases = await tx.cddCase.findMany({
        where: {
          customerId,
          journeyId,
          status: 'APPROVED',
        },
      });

      if (cddCases.length === 0) {
        throw new BadRequestException('No approved CDD cases found for the selected journey.');
      }

      const cases: any[] = [];
      for (const subject of subjects) {
        const sourceCddCase = cddCases.find(
          (item: any) =>
            item.subjectKind === subject.subjectKind && item.subjectRefId === subject.subjectRefId,
        );
        if (!sourceCddCase) {
          throw new BadRequestException('Missing approved CDD case for one or more required subjects.');
        }

        const created = await tx.eddCase.create({
          data: {
            caseNo: generateReferenceNo('EDD'),
            customerId,
            cddCaseId: sourceCddCase.id,
            status: 'PENDING',
            subjectKind: subject.subjectKind,
            subjectRefId: subject.subjectRefId,
            journeyId,
          },
        });
        cases.push(created);
        await this.updateUboCaseStatus(tx, subject.subjectKind, subject.subjectRefId, 'EDD_IN_PROGRESS');
      }

      await this.recomputeComplianceSnapshot(customerId, journeyId, tx);
      return { journeyId, cases };
    });

    await this.recomputeComplianceSnapshot(customerId, result.journeyId);
    const updated = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        complianceStatus: true,
        currentEddCaseId: true,
      },
    });
    const currentEddCaseId = updated?.currentEddCaseId || null;
    if (!currentEddCaseId) {
      throw new InternalServerErrorException(
        'EDD cases were reinitiated, but current EDD case is missing for QR generation.',
      );
    }

    let ensuredSession:
      | {
          session: {
            sessionId: string;
            providerSessionId: string;
            caseType: CaseType;
            caseId: string;
            qrCodeUrl: string;
            expiresAt: Date;
            status: string;
          };
          reused: boolean;
        }
      | null = null;
    try {
      ensuredSession = await this.ensurePendingSessionForCase(
        customerId,
        actorId,
        'EDD',
        currentEddCaseId,
      );
    } catch {
      throw new BadRequestException(
        'EDD case has been created. Failed to auto-create QR session, please retry generating QR.',
      );
    }

    await this.writeAudit({
      customerId,
      caseType: 'EDD',
      caseId: currentEddCaseId,
      action: 'EDD_SESSION_CREATED_AUTO',
      actorId,
      actorRole: 'CUSTOMER',
      detail: JSON.stringify({
        sessionId: ensuredSession?.session.sessionId || null,
        providerSessionId: ensuredSession?.session.providerSessionId || null,
        reused: ensuredSession?.reused || false,
      }),
    });

    await this.writeAudit({
      customerId,
      action: 'EDD_REINITIATED',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage: fromStatus,
      toStage: updated?.complianceStatus || fromStatus,
      detail: JSON.stringify({
        journeyId: result.journeyId,
        count: result.cases.length,
        currentEddCaseId,
      }),
    });

    return {
      journeyId: result.journeyId,
      items: result.cases,
      currentEddCaseId,
      session: ensuredSession?.session || null,
    };
  }

  async reviewCustomerFinalDecision(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto: FinalReviewCustomerDto,
  ) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        cddStatus: true,
        eddRequired: true,
        eddStatus: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    if (!(customer.cddStatus === 'APPROVED' && customer.eddRequired && customer.eddStatus === 'APPROVED')) {
      throw new BadRequestException('Final review is only available after CDD/EDD are fully approved.');
    }

    const reviewedAt = new Date();
    const finalApprovalStatus: FinalApprovalStatus = dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.customerMain.update({
        where: { id: customerId },
        data: {
          finalApprovalStatus,
          finalApprovalReason: dto.reason || null,
          finalApprovalReviewerId: actorId,
          finalApprovalReviewedAt: reviewedAt,
        },
      });

      await this.recomputeComplianceSnapshot(customerId, undefined, tx);
    });

    const updated = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        complianceStatus: true,
        finalApprovalStatus: true,
      },
    });

    await this.writeAudit({
      customerId,
      action: `CUSTOMER_FINAL_${dto.decision}`,
      actorId,
      actorRole,
      toStage: updated?.complianceStatus || null,
      detail: dto.reason || null,
    });

    return updated;
  }

  async simulateCustomerExpired(customerId: string, actorId: string, actorRole: string) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        cddDocumentExpiresAt: true,
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const expiryDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.customerMain.update({
        where: { id: customerId },
        data: {
          cddDocumentExpiresAt: expiryDate,
        },
      });
      await this.recomputeComplianceSnapshot(customerId, undefined, tx);
    });

    const updated = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        cddStatus: true,
        complianceStatus: true,
        cddDocumentExpiresAt: true,
      },
    });

    await this.writeAudit({
      customerId,
      action: 'CUSTOMER_SIMULATE_EXPIRED',
      actorId,
      actorRole,
      toStage: updated?.complianceStatus || null,
      detail: JSON.stringify({
        cddDocumentExpiresAt: updated?.cddDocumentExpiresAt || null,
      }),
    });

    return updated;
  }

  async updateInvestorClassification(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto: UpdateInvestorClassificationDto,
  ) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        investorClassification: true,
        investorClassificationSource: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        investorClassification: dto.classification,
        investorClassificationSource: 'ADMIN_OVERRIDE',
        investorClassificationUpdatedAt: new Date(),
      },
      select: {
        id: true,
        investorClassification: true,
        investorClassificationSource: true,
        investorClassificationUpdatedAt: true,
      },
    });

    await this.writeAudit({
      customerId,
      action: 'INVESTOR_CLASSIFICATION_UPDATED',
      actorId,
      actorRole,
      detail: JSON.stringify({
        from: customer.investorClassification,
        to: dto.classification,
        reason: dto.reason,
      }),
    });

    return updated;
  }
}
