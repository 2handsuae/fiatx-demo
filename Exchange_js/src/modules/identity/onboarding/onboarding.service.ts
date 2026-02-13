import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  BootstrapCasesDto,
  CreateCaseSessionDto,
  MockCompleteSessionDto,
  RejectCustomerDto,
  ReviewCddCaseDto,
  ReviewEddCaseDto,
  SaveCddCaseDto,
  SaveEddCaseDto,
  UpsertEntityDto,
} from './dto/onboarding.dto';

type TradeAction = 'SWAP' | 'WITHDRAW';
type SubjectKind = 'INDIVIDUAL_CUSTOMER' | 'CORPORATE_ENTITY' | 'UBO_PERSON';
type CaseType = 'CDD' | 'EDD';

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
    | 'NONE';
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly highRiskCountrySet = new Set(['IR', 'KP', 'SY', 'AF', 'RU']);

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

    return {
      provider: 'MOCK',
      generatedFrom: caseNo,
      caseType,
      subjectKind,
      referenceId: `MOCK-${seed.toString(16).toUpperCase()}`,
      outcome,
      riskBand: this.pickFrom(seed + 7, riskBands),
      screenedCountry: this.pickFrom(seed + 11, countries),
      watchlistHit: this.pickFrom(seed + 13, watchlists),
      confidenceScore: 0.8 + ((seed % 20) / 100),
      profile: {
        occupation: this.pickFrom(seed + 17, occupations),
        sourceOfFunds: this.pickFrom(seed + 19, fundingSources),
      },
    };
  }

  private extractCddPersonalInfo(
    inputData: Record<string, any>,
  ): { firstName?: string; lastName?: string } {
    const profile = (inputData.personalInfo || inputData.identity || inputData) as Record<string, any>;
    const firstName =
      typeof profile.firstName === 'string' && profile.firstName.trim()
        ? profile.firstName.trim()
        : undefined;
    const lastName =
      typeof profile.lastName === 'string' && profile.lastName.trim()
        ? profile.lastName.trim()
        : undefined;
    return { firstName, lastName };
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
          in: ['DRAFT', 'NEED_INFO', 'SUBMITTED', 'APPROVED'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (latest?.journeyId) return latest.journeyId;
    return generateReferenceNo('ONB');
  }

  private calculateRisk(input: {
    customerType: string;
    inputData: Record<string, any>;
    ubos: Array<{ pepFlag?: boolean; nationality?: string | null }>;
  }) {
    let score = 0;
    const reasons: string[] = [];
    const payload = input.inputData || {};

    if (input.customerType === 'CORPORATE') {
      score += 20;
      reasons.push('Corporate customer baseline +20');
    }

    const hasPep = input.ubos.some((u) => !!u.pepFlag) || !!payload.pepFlag;
    if (hasPep) {
      score += 40;
      reasons.push('PEP hit +40');
    }

    const countries = [
      payload.nationality,
      payload.country,
      payload.incorporationCountry,
      ...input.ubos.map((u) => u.nationality),
    ].filter(Boolean);

    const hasHighRiskCountry = countries.some((c) =>
      this.highRiskCountrySet.has(String(c).toUpperCase()),
    );
    if (hasHighRiskCountry) {
      score += 20;
      reasons.push('High risk country hit +20');
    }

    const expectedMonthlyVolume = Number(payload.expectedMonthlyVolume || 0);
    if (Number.isFinite(expectedMonthlyVolume) && expectedMonthlyVolume >= 100000) {
      score += 15;
      reasons.push('High expected volume +15');
    }

    if (!payload.sourceOfFunds && !payload.sourceOfWealth) {
      score += 10;
      reasons.push('Missing SOF/SOW signal +10');
    }

    if (score > 100) score = 100;

    const riskLevel = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    const requiresEdd = riskLevel === 'HIGH' || hasPep;
    return {
      riskScore: score,
      riskLevel,
      requiresEdd,
      screeningSummary: reasons.join('; ') || 'No high-risk signal.',
    };
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

  private async updateCustomerStageAfterCddSubmission(
    tx: any,
    customerId: string,
    journeyId: string,
  ) {
    const customer = await tx.customerMain.findUnique({
      where: { id: customerId },
      include: { corporateProfile: true, uboProfiles: true },
    });
    if (!customer) return;

    const subjects = this.buildSubjectDescriptors(customer);
    const cases = await tx.cddCase.findMany({ where: { customerId, journeyId } });

    const allSubmittedOrApproved = subjects.every((subject) =>
      cases.some(
        (item: any) =>
          item.subjectKind === subject.subjectKind &&
          item.subjectRefId === subject.subjectRefId &&
          ['SUBMITTED', 'APPROVED'].includes(item.status),
      ),
    );

    await tx.customerMain.update({
      where: { id: customerId },
      data: {
        onboardingStage: allSubmittedOrApproved ? 'CDD_UNDER_REVIEW' : 'CDD_DRAFT',
      },
    });
  }

  private async updateCustomerStageAfterEddSubmission(
    tx: any,
    customerId: string,
    journeyId: string,
  ) {
    const customer = await tx.customerMain.findUnique({
      where: { id: customerId },
      include: { corporateProfile: true, uboProfiles: true },
    });
    if (!customer) return;

    const subjects = this.buildSubjectDescriptors(customer);
    const cases = await tx.eddCase.findMany({ where: { customerId, journeyId } });

    const allSubmittedOrBetter = subjects.every((subject) =>
      cases.some(
        (item: any) =>
          item.subjectKind === subject.subjectKind &&
          item.subjectRefId === subject.subjectRefId &&
          ['SUBMITTED', 'MLRO_APPROVED', 'SENIOR_APPROVED'].includes(item.status),
      ),
    );

    await tx.customerMain.update({
      where: { id: customerId },
      data: {
        onboardingStage: allSubmittedOrBetter ? 'EDD_UNDER_REVIEW' : 'EDD_DRAFT',
      },
    });
  }

  private async enrichCasesWithSession(
    caseType: CaseType,
    cases: any[],
  ): Promise<any[]> {
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
        providerStatus: latest?.status || 'NOT_STARTED',
        latestSession: latest,
      };
    });
  }

  private async ensureMockSessionsForCases(
    customerId: string,
    actorId: string,
    caseType: CaseType,
    cases: Array<{ id: string }>,
  ) {
    for (const item of cases) {
      const latest = await (this.prisma as any).complianceSession.findFirst({
        where: {
          customerId,
          caseType,
          caseId: item.id,
          status: { in: ['PENDING', 'COMPLETED'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (latest) continue;

      await this.createCaseSession(customerId, actorId, item.id, { caseType, provider: 'MOCK' });
    }
  }

  private async ensureFinalApprovalGate(customerId: string) {
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

    const subjects = this.buildSubjectDescriptors(customer);

    const latestCdd = await (this.prisma as any).cddCase.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    if (!latestCdd) {
      throw new BadRequestException('No CDD cases found.');
    }

    const journeyId = latestCdd.journeyId;
    const cddCases = await (this.prisma as any).cddCase.findMany({
      where: { customerId, journeyId },
    });

    const allCddApproved = subjects.every((subject) =>
      cddCases.some(
        (item: any) =>
          item.subjectKind === subject.subjectKind &&
          item.subjectRefId === subject.subjectRefId &&
          item.status === 'APPROVED',
      ),
    );

    if (!allCddApproved) {
      throw new BadRequestException('Final approval blocked: not all required CDD cases are approved.');
    }

    const requiresEdd = cddCases.some((item: any) => !!item.requiresEdd);
    if (!requiresEdd) {
      return;
    }

    const eddCases = await (this.prisma as any).eddCase.findMany({
      where: { customerId, journeyId },
    });

    const allEddApproved = subjects.every((subject) =>
      eddCases.some(
        (item: any) =>
          item.subjectKind === subject.subjectKind &&
          item.subjectRefId === subject.subjectRefId &&
          item.status === 'SENIOR_APPROVED',
      ),
    );

    if (!allEddApproved) {
      throw new BadRequestException('Final approval blocked: required EDD cases are incomplete.');
    }
  }

  async getMyOnboarding(customerId: string) {
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

    if (
      customer.onboardingStage === 'ONBOARDING_APPROVED' ||
      (customer.canTradeSwap && customer.canTradeWithdraw)
    ) {
      return {
        step: 'COMPLETED',
        action: 'NONE',
        blockedReason: null,
        activeCaseId: null,
        requiresEdd: false,
      };
    }

    if (customer.onboardingStage === 'ONBOARDING_REJECTED') {
      return {
        step: 'REINITIATE',
        action: 'REINITIATE_CDD',
        blockedReason: customer.onboardingRejectReason || 'Case rejected by compliance.',
        activeCaseId: null,
        requiresEdd: false,
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

    const latestCdd = await (this.prisma as any).cddCase.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestCdd) {
      return {
        step: 'CDD',
        action: 'START_CDD',
        blockedReason: null,
        activeCaseId: null,
        requiresEdd: false,
      };
    }

    const journeyId = latestCdd.journeyId;
    const [journeyCddCases, journeyEddCases] = await Promise.all([
      (this.prisma as any).cddCase.findMany({
        where: { customerId, journeyId },
      }),
      (this.prisma as any).eddCase.findMany({
        where: { customerId, journeyId },
      }),
    ]);

    const requiresEdd = journeyCddCases.some((item: any) => !!item.requiresEdd);

    if (requiresEdd) {
      const activeEdd = journeyEddCases.find((item: any) => ['DRAFT', 'NEED_INFO'].includes(item.status));
      const underReview = journeyEddCases.some((item: any) =>
        ['SUBMITTED', 'MLRO_APPROVED'].includes(item.status),
      );

      if (activeEdd || customer.onboardingStage === 'EDD_DRAFT') {
        return {
          step: 'EDD',
          action: 'COMPLETE_EDD',
          blockedReason: null,
          activeCaseId: activeEdd?.id || customer.activeEddCaseId || null,
          requiresEdd: true,
        };
      }

      if (underReview || ['EDD_UNDER_REVIEW', 'EDD_MLRO_APPROVED'].includes(customer.onboardingStage)) {
        return {
          step: 'WAIT_REVIEW',
          action: 'WAIT',
          blockedReason: 'EDD is under compliance review.',
          activeCaseId: customer.activeEddCaseId || null,
          requiresEdd: true,
        };
      }
    }

    const activeCdd = journeyCddCases.find((item: any) => ['DRAFT', 'NEED_INFO'].includes(item.status));
    const cddUnderReview = journeyCddCases.some((item: any) => item.status === 'SUBMITTED');

    if (activeCdd || customer.onboardingStage === 'CDD_DRAFT') {
      return {
        step: 'CDD',
        action: 'COMPLETE_CDD',
        blockedReason: null,
        activeCaseId: activeCdd?.id || customer.activeCddCaseId || null,
        requiresEdd: false,
      };
    }

    if (cddUnderReview || customer.onboardingStage === 'CDD_UNDER_REVIEW') {
      return {
        step: 'WAIT_REVIEW',
        action: 'WAIT',
        blockedReason: 'CDD is under compliance review.',
        activeCaseId: customer.activeCddCaseId || null,
        requiresEdd: false,
      };
    }

    return {
      step: 'CDD',
      action: 'START_CDD',
      blockedReason: null,
      activeCaseId: null,
      requiresEdd,
    };
  }

  async assertTradingEligibility(customerId: string, action: TradeAction) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        canTradeSwap: true,
        canTradeWithdraw: true,
        onboardingStage: true,
        onboardingRejectReason: true,
      },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const allowed = action === 'SWAP' ? customer.canTradeSwap : customer.canTradeWithdraw;
    if (!allowed) {
      throw new ForbiddenException({
        code: 'ONBOARDING_REQUIRED',
        stage: customer.onboardingStage,
        nextAction: action,
        reason: customer.onboardingRejectReason || null,
      });
    }
  }

  async upsertEntity(customerId: string, actorId: string, dto: UpsertEntityDto) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, onboardingStage: true, customerType: true, companyName: true },
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

    const fromStage = customer.onboardingStage;
    const nextStage =
      customer.onboardingStage === 'ONBOARDING_APPROVED'
        ? 'ONBOARDING_APPROVED'
        : 'ENTITY_IDENTIFIED';

    const updated = await (this.prisma as any).$transaction(async (tx: any) => {
      const updatedCustomer = await tx.customerMain.update({
        where: { id: customerId },
        data: {
          customerType: lockedType,
          companyName:
            lockedType === 'CORPORATE'
              ? dto.corporateProfile?.companyName?.trim() || customer.companyName || null
              : null,
          onboardingStage: nextStage,
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

      return updatedCustomer;
    });

    await this.writeAudit({
      customerId,
      action: 'ENTITY_UPSERT',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage,
      toStage: updated.onboardingStage,
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

    const fromStage = customer.onboardingStage;
    const result = await (this.prisma as any).$transaction(async (tx: any) => {
      const journeyId =
        dto?.journeyId ||
        (fromStage === 'ONBOARDING_REJECTED'
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
              in: ['DRAFT', 'NEED_INFO', 'SUBMITTED', 'APPROVED'],
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
            status: 'DRAFT',
            subjectKind: subject.subjectKind,
            subjectRefId: subject.subjectRefId,
            journeyId,
          },
        });
        cases.push(created);

        await this.updateUboCaseStatus(tx, subject.subjectKind, subject.subjectRefId, 'CDD_IN_PROGRESS');
      }

      await tx.customerMain.update({
        where: { id: customerId },
        data: {
          activeCddCaseId: cases[0]?.id || null,
          activeEddCaseId: null,
          onboardingStage: 'CDD_DRAFT',
          onboardingApprovedAt: null,
          onboardingRejectedAt: null,
          onboardingRejectReason: null,
          canTradeSwap: false,
          canTradeWithdraw: false,
        },
      });

      return { journeyId, cases };
    });

    await this.writeAudit({
      customerId,
      action: 'CDD_BOOTSTRAP',
      actorId,
      actorRole: actorId === customerId ? 'CUSTOMER' : 'ADMIN',
      fromStage,
      toStage: 'CDD_DRAFT',
      detail: JSON.stringify({ journeyId: result.journeyId, count: result.cases.length }),
    });

    return {
      journeyId: result.journeyId,
      items: result.cases,
    };
  }

  async bootstrapEddCases(customerId: string, actorId: string, dto?: BootstrapCasesDto) {
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

    const fromStage = customer.onboardingStage;
    const result = await (this.prisma as any).$transaction(async (tx: any) => {
      const journeyId =
        dto?.journeyId || approvedRequiresEddCase.journeyId || (await this.resolveJourneyId(customerId, undefined, tx));

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
      const cases: any[] = [];

      for (const subject of subjects) {
        const existing = await tx.eddCase.findFirst({
          where: {
            customerId,
            journeyId,
            subjectKind: subject.subjectKind,
            subjectRefId: subject.subjectRefId,
            status: {
              in: ['DRAFT', 'NEED_INFO', 'SUBMITTED', 'MLRO_APPROVED', 'SENIOR_APPROVED'],
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
            item.subjectKind === subject.subjectKind &&
            item.subjectRefId === subject.subjectRefId,
        );

        const created = await tx.eddCase.create({
          data: {
            caseNo: generateReferenceNo('EDD'),
            customerId,
            cddCaseId: sourceCddCase?.id || null,
            status: 'DRAFT',
            subjectKind: subject.subjectKind,
            subjectRefId: subject.subjectRefId,
            journeyId,
          },
        });

        cases.push(created);
        await this.updateUboCaseStatus(tx, subject.subjectKind, subject.subjectRefId, 'EDD_IN_PROGRESS');
      }

      await tx.customerMain.update({
        where: { id: customerId },
        data: {
          activeEddCaseId: cases[0]?.id || null,
          onboardingStage: 'EDD_DRAFT',
        },
      });

      return { journeyId, cases };
    });

    await this.writeAudit({
      customerId,
      action: 'EDD_BOOTSTRAP',
      actorId,
      actorRole: actorId === customerId ? 'CUSTOMER' : 'ADMIN',
      fromStage,
      toStage: 'EDD_DRAFT',
      detail: JSON.stringify({ journeyId: result.journeyId, count: result.cases.length }),
    });

    return {
      journeyId: result.journeyId,
      items: result.cases,
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

    const provider = (dto.provider || 'MOCK').toUpperCase();
    if (provider !== 'MOCK') {
      throw new BadRequestException('Only MOCK provider is enabled in current phase.');
    }

    const providerSessionId = generateReferenceNo('SES');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const qrCodeUrl = `mock://compliance/${providerSessionId}`;

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

    if (session.status === 'COMPLETED') {
      return {
        sessionId: session.id,
        status: session.status,
      };
    }

    const result = dto?.result || 'PASS';

    await (this.prisma as any).$transaction(async (tx: any) => {
      const sessionStatus = result === 'PASS' ? 'COMPLETED' : 'FAILED';
      await tx.complianceSession.update({
        where: { id: session.id },
        data: {
          status: sessionStatus,
          completedAt: new Date(),
          rawPayload: JSON.stringify({
            ...this.parseJsonSafely(session.rawPayload),
            mockResult: result,
            completedAt: new Date().toISOString(),
          }),
        },
      });

      if (result === 'FAIL') {
        return;
      }

      if (session.caseType === 'CDD') {
        const cddCase = await tx.cddCase.findFirst({
          where: { id: session.caseId, customerId },
        });
        if (!cddCase) return;

        await tx.cddCase.update({
          where: { id: cddCase.id },
          data: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
          },
        });

        await this.updateCustomerStageAfterCddSubmission(tx, customerId, cddCase.journeyId);
      } else {
        const eddCase = await tx.eddCase.findFirst({
          where: { id: session.caseId, customerId },
        });
        if (!eddCase) return;

        await tx.eddCase.update({
          where: { id: eddCase.id },
          data: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
          },
        });

        await this.updateCustomerStageAfterEddSubmission(tx, customerId, eddCase.journeyId);
      }
    });

    await this.writeAudit({
      customerId,
      caseType: session.caseType,
      caseId: session.caseId,
      action: `${session.caseType}_SESSION_${result}`,
      actorId,
      actorRole: 'CUSTOMER',
      detail: JSON.stringify({ sessionId: session.id }),
    });

    return {
      sessionId: session.id,
      status: result === 'PASS' ? 'COMPLETED' : 'FAILED',
      caseType: session.caseType,
      caseId: session.caseId,
    };
  }

  async saveCddDraft(customerId: string, actorId: string, dto: SaveCddCaseDto) {
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      include: {
        uboProfiles: true,
        corporateProfile: true,
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');
    this.getCustomerType(customer);

    let targetCase: any = null;
    if (dto.caseId) {
      targetCase = await (this.prisma as any).cddCase.findFirst({
        where: {
          id: dto.caseId,
          customerId,
        },
      });
    }

    if (!targetCase) {
      const bootstrap = await this.bootstrapCddCases(customerId, actorId);
      targetCase = bootstrap.items[0];
    }

    const risk = this.calculateRisk({
      customerType: customer.customerType,
      inputData: dto.inputData || {},
      ubos: customer.uboProfiles || [],
    });
    const personalInfo = this.extractCddPersonalInfo(dto.inputData || {});

    const updated = await (this.prisma as any).$transaction(async (tx: any) => {
      const cddCase = await tx.cddCase.update({
        where: { id: targetCase.id },
        data: {
          status: 'DRAFT',
          inputData: JSON.stringify(dto.inputData || {}),
          riskScore: risk.riskScore,
          riskLevel: risk.riskLevel,
          requiresEdd: risk.requiresEdd,
          screeningSummary: risk.screeningSummary,
        },
      });

      await tx.customerMain.update({
        where: { id: customerId },
        data: {
          activeCddCaseId: cddCase.id,
          onboardingStage: 'CDD_DRAFT',
          firstName:
            customer.customerType === 'INDIVIDUAL' && cddCase.subjectKind === 'INDIVIDUAL_CUSTOMER'
              ? personalInfo.firstName || customer.firstName || null
              : customer.firstName || null,
          lastName:
            customer.customerType === 'INDIVIDUAL' && cddCase.subjectKind === 'INDIVIDUAL_CUSTOMER'
              ? personalInfo.lastName || customer.lastName || null
              : customer.lastName || null,
        },
      });

      return cddCase;
    });

    await this.writeAudit({
      customerId,
      caseType: 'CDD',
      caseId: updated.id,
      action: 'CDD_DRAFT_SAVED',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage: customer.onboardingStage,
      toStage: 'CDD_DRAFT',
      detail: JSON.stringify({
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        requiresEdd: risk.requiresEdd,
      }),
    });

    return updated;
  }

  async submitCddCase(customerId: string, actorId: string, caseId: string, note?: string) {
    const target = await (this.prisma as any).cddCase.findFirst({
      where: { id: caseId, customerId },
    });
    if (!target) throw new NotFoundException('CDD case not found');
    if (!['DRAFT', 'NEED_INFO'].includes(target.status)) {
      throw new BadRequestException('Only draft or need-info CDD case can be submitted.');
    }

    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      select: { onboardingStage: true },
    });

    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.cddCase.update({
        where: { id: caseId },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });

      await this.updateCustomerStageAfterCddSubmission(tx, customerId, target.journeyId);
    });

    await this.writeAudit({
      customerId,
      caseType: 'CDD',
      caseId,
      action: 'CDD_SUBMITTED',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage: customer?.onboardingStage,
      toStage: 'CDD_UNDER_REVIEW',
      detail: note || null,
    });

    return { id: caseId, status: 'SUBMITTED' };
  }

  async saveEddDraft(customerId: string, actorId: string, dto: SaveEddCaseDto) {
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      include: {
        corporateProfile: true,
        uboProfiles: true,
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');

    let targetCase: any = null;
    if (dto.caseId) {
      targetCase = await (this.prisma as any).eddCase.findFirst({
        where: {
          id: dto.caseId,
          customerId,
        },
      });
    }

    if (!targetCase) {
      const bootstrap = await this.bootstrapEddCases(customerId, actorId);
      targetCase = bootstrap.items[0];
    }

    const updated = await (this.prisma as any).$transaction(async (tx: any) => {
      const eddCase = await tx.eddCase.update({
        where: { id: targetCase.id },
        data: {
          status: 'DRAFT',
          sourceOfFunds: dto.sourceOfFunds || null,
          sourceOfWealth: dto.sourceOfWealth || null,
          inputData: JSON.stringify(dto.inputData || {}),
        },
      });

      await tx.customerMain.update({
        where: { id: customerId },
        data: {
          activeEddCaseId: eddCase.id,
          onboardingStage: 'EDD_DRAFT',
        },
      });

      return eddCase;
    });

    await this.writeAudit({
      customerId,
      caseType: 'EDD',
      caseId: updated.id,
      action: 'EDD_DRAFT_SAVED',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage: customer.onboardingStage,
      toStage: 'EDD_DRAFT',
    });

    return updated;
  }

  async submitEddCase(customerId: string, actorId: string, caseId: string, note?: string) {
    const target = await (this.prisma as any).eddCase.findFirst({
      where: { id: caseId, customerId },
    });

    if (!target) throw new NotFoundException('EDD case not found');
    if (!['DRAFT', 'NEED_INFO'].includes(target.status)) {
      throw new BadRequestException('Only draft or need-info EDD case can be submitted.');
    }

    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: customerId },
      select: { onboardingStage: true },
    });

    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.eddCase.update({
        where: { id: caseId },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });

      await this.updateCustomerStageAfterEddSubmission(tx, customerId, target.journeyId);
    });

    await this.writeAudit({
      customerId,
      caseType: 'EDD',
      caseId,
      action: 'EDD_SUBMITTED',
      actorId,
      actorRole: 'CUSTOMER',
      fromStage: customer?.onboardingStage,
      toStage: 'EDD_UNDER_REVIEW',
      detail: note || null,
    });

    return { id: caseId, status: 'SUBMITTED' };
  }

  async listCddCases(params: {
    status?: string;
    customerType?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.customerType) where.customerType = params.customerType;

    const skip = params.skip || 0;
    const take = params.take || 20;

    const [items, total] = await Promise.all([
      (this.prisma as any).cddCase.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              customerNo: true,
              email: true,
              firstName: true,
              lastName: true,
              companyName: true,
              onboardingStage: true,
              customerType: true,
            },
          },
        },
      }),
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
    if (!['SUBMITTED', 'NEED_INFO'].includes(cddCase.status)) {
      throw new BadRequestException('Only submitted CDD case can be reviewed.');
    }

    const decidedRiskScore =
      typeof dto.riskScore === 'number' ? dto.riskScore : cddCase.riskScore || 0;
    const decidedRiskLevel =
      decidedRiskScore >= 70 ? 'HIGH' : decidedRiskScore >= 40 ? 'MEDIUM' : 'LOW';
    const decidedRequiresEdd =
      typeof dto.requiresEdd === 'boolean'
        ? dto.requiresEdd
        : cddCase.requiresEdd || decidedRiskLevel === 'HIGH';

    const fromStage = cddCase.customer.onboardingStage;
    const customerId = cddCase.customerId;
    let caseStatus = cddCase.status;
    let nextStage = fromStage;
    let shouldBootstrapEdd = false;

    await (this.prisma as any).$transaction(async (tx: any) => {
      if (dto.decision === 'APPROVE') {
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

        const customerWithProfiles = await tx.customerMain.findUnique({
          where: { id: customerId },
          include: {
            corporateProfile: true,
            uboProfiles: true,
          },
        });

        const subjects = this.buildSubjectDescriptors(customerWithProfiles);
        const journeyCases = await tx.cddCase.findMany({
          where: {
            customerId,
            journeyId: cddCase.journeyId,
          },
        });

        const allApproved = subjects.every((subject) =>
          journeyCases.some(
            (item: any) =>
              item.subjectKind === subject.subjectKind &&
              item.subjectRefId === subject.subjectRefId &&
              item.status === 'APPROVED',
          ),
        );

        const requiresEdd = journeyCases.some((item: any) => !!item.requiresEdd);
        nextStage = allApproved
          ? requiresEdd
            ? 'EDD_DRAFT'
            : 'ONBOARDING_APPROVED'
          : 'CDD_UNDER_REVIEW';

        const updateData: any = {
          onboardingStage: nextStage,
          riskScore: decidedRiskScore,
          riskLevel: decidedRiskLevel,
          onboardingRejectReason: null,
        };

        if (allApproved && !requiresEdd) {
          updateData.onboardingApprovedAt = new Date();
          updateData.onboardingRejectedAt = null;
          updateData.canTradeSwap = true;
          updateData.canTradeWithdraw = true;
          updateData.activeEddCaseId = null;
        } else {
          updateData.onboardingApprovedAt = null;
          updateData.canTradeSwap = false;
          updateData.canTradeWithdraw = false;
        }

        await tx.customerMain.update({
          where: { id: customerId },
          data: updateData,
        });

        shouldBootstrapEdd = allApproved && requiresEdd;
      } else if (dto.decision === 'REJECT') {
        caseStatus = 'REJECTED';
        nextStage = 'ONBOARDING_REJECTED';

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

        await tx.customerMain.update({
          where: { id: customerId },
          data: {
            onboardingStage: nextStage,
            onboardingApprovedAt: null,
            onboardingRejectedAt: new Date(),
            onboardingRejectReason: dto.reason || 'CDD rejected',
            canTradeSwap: false,
            canTradeWithdraw: false,
          },
        });
      } else {
        caseStatus = 'NEED_INFO';
        nextStage = 'CDD_DRAFT';

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

        await this.updateUboCaseStatus(
          tx,
          cddCase.subjectKind,
          cddCase.subjectRefId,
          'CDD_IN_PROGRESS',
        );

        await tx.customerMain.update({
          where: { id: customerId },
          data: {
            onboardingStage: nextStage,
            onboardingApprovedAt: null,
            canTradeSwap: false,
            canTradeWithdraw: false,
          },
        });
      }
    });

    if (dto.decision === 'APPROVE' && shouldBootstrapEdd) {
      const bootstrapResult = await this.bootstrapEddCases(customerId, actorId, {
        journeyId: cddCase.journeyId,
      });
      await this.ensureMockSessionsForCases(customerId, actorId, 'EDD', bootstrapResult.items);
    }

    await this.writeAudit({
      customerId,
      caseType: 'CDD',
      caseId,
      action: `CDD_${dto.decision}`,
      actorId,
      actorRole,
      fromStage,
      toStage: nextStage,
      detail: JSON.stringify({
        decision: dto.decision,
        riskScore: decidedRiskScore,
        riskLevel: decidedRiskLevel,
        requiresEdd: decidedRequiresEdd,
        reason: dto.reason || null,
      }),
    });

    return { id: caseId, status: caseStatus, nextStage };
  }

  async listEddCases(params: {
    status?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (params.status) where.status = params.status;

    const skip = params.skip || 0;
    const take = params.take || 20;

    const [items, total] = await Promise.all([
      (this.prisma as any).eddCase.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: {
              customerNo: true,
              email: true,
              firstName: true,
              lastName: true,
              companyName: true,
              onboardingStage: true,
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
      }),
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
    if (!['SUBMITTED', 'NEED_INFO'].includes(eddCase.status)) {
      throw new BadRequestException('Only submitted EDD case can be reviewed by MLRO.');
    }

    const fromStage = eddCase.customer.onboardingStage;
    const customerId = eddCase.customerId;
    let status = eddCase.status;
    let nextStage = fromStage;

    await (this.prisma as any).$transaction(async (tx: any) => {
      if (dto.decision === 'APPROVE') {
        status = 'MLRO_APPROVED';

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

        const customerWithProfiles = await tx.customerMain.findUnique({
          where: { id: customerId },
          include: {
            corporateProfile: true,
            uboProfiles: true,
          },
        });
        const subjects = this.buildSubjectDescriptors(customerWithProfiles);
        const journeyCases = await tx.eddCase.findMany({
          where: {
            customerId,
            journeyId: eddCase.journeyId,
          },
        });

        const allMlroApproved = subjects.every((subject) =>
          journeyCases.some(
            (item: any) =>
              item.subjectKind === subject.subjectKind &&
              item.subjectRefId === subject.subjectRefId &&
              ['MLRO_APPROVED', 'SENIOR_APPROVED'].includes(item.status),
          ),
        );

        nextStage = allMlroApproved ? 'EDD_MLRO_APPROVED' : 'EDD_UNDER_REVIEW';

        await tx.customerMain.update({
          where: { id: customerId },
          data: {
            onboardingStage: nextStage,
            onboardingApprovedAt: null,
            canTradeSwap: false,
            canTradeWithdraw: false,
          },
        });
      } else if (dto.decision === 'REJECT') {
        status = 'REJECTED';
        nextStage = 'ONBOARDING_REJECTED';

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

        await tx.customerMain.update({
          where: { id: customerId },
          data: {
            onboardingStage: nextStage,
            onboardingApprovedAt: null,
            onboardingRejectedAt: new Date(),
            onboardingRejectReason: dto.reason || 'EDD rejected by MLRO',
            canTradeSwap: false,
            canTradeWithdraw: false,
          },
        });
      } else {
        status = 'NEED_INFO';
        nextStage = 'EDD_DRAFT';

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

        await tx.customerMain.update({
          where: { id: customerId },
          data: {
            onboardingStage: nextStage,
            onboardingApprovedAt: null,
            canTradeSwap: false,
            canTradeWithdraw: false,
          },
        });
      }
    });

    await this.writeAudit({
      customerId,
      caseType: 'EDD',
      caseId,
      action: `EDD_MLRO_${dto.decision}`,
      actorId,
      actorRole,
      fromStage,
      toStage: nextStage,
      detail: dto.reason || null,
    });

    return { id: caseId, status, nextStage };
  }

  async seniorReviewEddCase(
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
    if (!['MLRO_APPROVED', 'NEED_INFO'].includes(eddCase.status)) {
      throw new BadRequestException(
        'Only MLRO-approved or need-info EDD case can be reviewed by senior management.',
      );
    }

    const fromStage = eddCase.customer.onboardingStage;
    const customerId = eddCase.customerId;
    let status = eddCase.status;
    let nextStage = fromStage;

    await (this.prisma as any).$transaction(async (tx: any) => {
      if (dto.decision === 'APPROVE') {
        status = 'SENIOR_APPROVED';

        await tx.eddCase.update({
          where: { id: caseId },
          data: {
            status,
            seniorReviewedAt: new Date(),
            seniorReviewerId: actorId,
            seniorDecision: dto.decision,
            decisionReason: dto.reason || null,
          },
        });

        await this.updateUboCaseStatus(
          tx,
          eddCase.subjectKind,
          eddCase.subjectRefId,
          'EDD_APPROVED',
        );

        const customerWithProfiles = await tx.customerMain.findUnique({
          where: { id: customerId },
          include: {
            corporateProfile: true,
            uboProfiles: true,
          },
        });
        const subjects = this.buildSubjectDescriptors(customerWithProfiles);
        const journeyCases = await tx.eddCase.findMany({
          where: {
            customerId,
            journeyId: eddCase.journeyId,
          },
        });

        const allSeniorApproved = subjects.every((subject) =>
          journeyCases.some(
            (item: any) =>
              item.subjectKind === subject.subjectKind &&
              item.subjectRefId === subject.subjectRefId &&
              item.status === 'SENIOR_APPROVED',
          ),
        );

        nextStage = allSeniorApproved ? 'ONBOARDING_APPROVED' : 'EDD_MLRO_APPROVED';

        await tx.customerMain.update({
          where: { id: customerId },
          data: allSeniorApproved
            ? {
                onboardingStage: nextStage,
                onboardingApprovedAt: new Date(),
                onboardingRejectedAt: null,
                onboardingRejectReason: null,
                canTradeSwap: true,
                canTradeWithdraw: true,
              }
            : {
                onboardingStage: nextStage,
                onboardingApprovedAt: null,
                canTradeSwap: false,
                canTradeWithdraw: false,
              },
        });
      } else if (dto.decision === 'REJECT') {
        status = 'REJECTED';
        nextStage = 'ONBOARDING_REJECTED';

        await tx.eddCase.update({
          where: { id: caseId },
          data: {
            status,
            seniorReviewedAt: new Date(),
            seniorReviewerId: actorId,
            seniorDecision: dto.decision,
            decisionReason: dto.reason || null,
          },
        });

        await this.updateUboCaseStatus(tx, eddCase.subjectKind, eddCase.subjectRefId, 'REJECTED');

        await tx.customerMain.update({
          where: { id: customerId },
          data: {
            onboardingStage: nextStage,
            onboardingApprovedAt: null,
            onboardingRejectedAt: new Date(),
            onboardingRejectReason: dto.reason || 'EDD rejected by senior management',
            canTradeSwap: false,
            canTradeWithdraw: false,
          },
        });
      } else {
        status = 'NEED_INFO';
        nextStage = 'EDD_DRAFT';

        await tx.eddCase.update({
          where: { id: caseId },
          data: {
            status,
            seniorReviewedAt: new Date(),
            seniorReviewerId: actorId,
            seniorDecision: dto.decision,
            decisionReason: dto.reason || null,
          },
        });

        await tx.customerMain.update({
          where: { id: customerId },
          data: {
            onboardingStage: nextStage,
            onboardingApprovedAt: null,
            canTradeSwap: false,
            canTradeWithdraw: false,
          },
        });
      }
    });

    await this.writeAudit({
      customerId,
      caseType: 'EDD',
      caseId,
      action: `EDD_SENIOR_${dto.decision}`,
      actorId,
      actorRole,
      fromStage,
      toStage: nextStage,
      detail: dto.reason || null,
    });

    return { id: caseId, status, nextStage };
  }

  async listDecisionQueue(params: {
    status?: string;
    skip?: number;
    take?: number;
  }) {
    const skip = params.skip || 0;
    const take = params.take || 20;

    const where: any = {};
    if (params.status) {
      where.onboardingStage = params.status;
    } else {
      where.onboardingStage = {
        in: [
          'CDD_UNDER_REVIEW',
          'EDD_UNDER_REVIEW',
          'EDD_MLRO_APPROVED',
          'ONBOARDING_APPROVED',
          'ONBOARDING_REJECTED',
        ],
      };
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).customerMain.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          customerNo: true,
          firstName: true,
          lastName: true,
          email: true,
          customerType: true,
          onboardingStage: true,
          onboardingRejectReason: true,
          updatedAt: true,
        },
      }),
      (this.prisma as any).customerMain.count({ where }),
    ]);

    return { items, total };
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
            onboardingStage: true,
            canTradeSwap: true,
            canTradeWithdraw: true,
          },
        },
      },
    });

    if (!cddCase) {
      throw new NotFoundException('CDD case not found');
    }

    const latestSession = await (this.prisma as any).complianceSession.findFirst({
      where: {
        caseType: 'CDD',
        caseId: cddCase.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...cddCase,
      inputData: this.parseJsonSafely(cddCase.inputData),
      customerSnapshot: cddCase.customer,
      latestSession,
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
            onboardingStage: true,
            canTradeSwap: true,
            canTradeWithdraw: true,
          },
        },
      },
    });

    if (!eddCase) {
      throw new NotFoundException('EDD case not found');
    }

    const latestSession = await (this.prisma as any).complianceSession.findFirst({
      where: {
        caseType: 'EDD',
        caseId: eddCase.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...eddCase,
      inputData: this.parseJsonSafely(eddCase.inputData),
      customerSnapshot: eddCase.customer,
      latestSession,
      mockDetail: this.buildMockDetail('EDD', eddCase.caseNo, eddCase.subjectKind),
    };
  }

  async approveCustomer(customerId: string, actorId: string, actorRole: string) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { onboardingStage: true },
    });

    if (!customer) throw new NotFoundException('Customer not found');
    if (!['CDD_APPROVED', 'EDD_APPROVED'].includes(customer.onboardingStage)) {
      throw new BadRequestException(
        'Customer can be approved only after CDD_APPROVED or EDD_APPROVED stage.',
      );
    }

    await this.ensureFinalApprovalGate(customerId);

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        onboardingStage: 'ONBOARDING_APPROVED',
        onboardingApprovedAt: new Date(),
        onboardingRejectedAt: null,
        onboardingRejectReason: null,
        canTradeSwap: true,
        canTradeWithdraw: true,
      },
    });

    await this.writeAudit({
      customerId,
      action: 'ONBOARDING_APPROVED',
      actorId,
      actorRole,
      fromStage: customer.onboardingStage,
      toStage: 'ONBOARDING_APPROVED',
    });

    return updated;
  }

  async rejectCustomer(
    customerId: string,
    actorId: string,
    actorRole: string,
    dto: RejectCustomerDto,
  ) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { onboardingStage: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        onboardingStage: 'ONBOARDING_REJECTED',
        onboardingRejectedAt: new Date(),
        onboardingRejectReason: dto.reason,
        canTradeSwap: false,
        canTradeWithdraw: false,
      },
    });

    await this.writeAudit({
      customerId,
      action: 'ONBOARDING_REJECTED',
      actorId,
      actorRole,
      fromStage: customer.onboardingStage,
      toStage: 'ONBOARDING_REJECTED',
      detail: dto.reason,
    });

    return updated;
  }
}
