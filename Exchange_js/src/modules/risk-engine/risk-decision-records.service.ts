import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  getCanonicalReviewRuleForStage,
  getWorkflowFromSourceType,
  getCanonicalOnboardingRuleForStage,
  ONBOARDING_REVIEW_STAGES,
  ONBOARDING_WORKFLOW,
  PERIODIC_REVIEW_WORKFLOW,
  OnboardingReviewStage,
} from './constants/onboarding-compliance-workflow.constant';
import { normalizeRiskRecommendedActionType } from './constants/risk-recommended-actions.constant';

type DecisionRecordListQuery = {
  status?: string;
  contextType?: string;
  outputDecision?: string;
  ownerId?: string;
  subjectId?: string;
  policyVersion?: string;
  skip?: number;
  take?: number;
};

@Injectable()
export class RiskDecisionRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeTake(take?: number): number {
    if (!take || Number.isNaN(take)) return 20;
    return Math.min(Math.max(Number(take), 1), 200);
  }

  private normalizeSkip(skip?: number): number {
    if (!skip || Number.isNaN(skip)) return 0;
    return Math.max(Number(skip), 0);
  }

  private parseJsonSafely(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private parseJsonArraySafely<T = unknown>(value?: string | null): T[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private getSubjectType(inputPayload?: string | null): string {
    const parsed = this.parseJsonSafely(inputPayload);
    const subjectType = String(parsed.subjectType || '').trim();
    return subjectType || 'UNKNOWN';
  }

  private normalizeRecommendedActions(actions: unknown[]): Record<string, unknown>[] {
    return actions
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => {
        const action = { ...(item as Record<string, unknown>) };
        const normalizedType = normalizeRiskRecommendedActionType(action.type);
        if (normalizedType) {
          action.type = normalizedType;
        }
        return action;
      });
  }

  private getStageFromContextType(contextType?: string | null): OnboardingReviewStage | null {
    const normalized = String(contextType || '').trim().toUpperCase();
    if (normalized === 'ONBOARDING_CDD') return ONBOARDING_REVIEW_STAGES.REVIEW_CDD;
    if (normalized === 'ONBOARDING_EDD') return ONBOARDING_REVIEW_STAGES.REVIEW_EDD;
    if (normalized === 'PERIODIC_REVIEW_CDD') return ONBOARDING_REVIEW_STAGES.REVIEW_CDD;
    if (normalized === 'PERIODIC_REVIEW_EDD') return ONBOARDING_REVIEW_STAGES.REVIEW_EDD;
    return null;
  }

  private getWorkflowFromContextType(contextType?: string | null) {
    const normalized = String(contextType || '').trim().toUpperCase();
    if (normalized === 'PERIODIC_REVIEW_CDD' || normalized === 'PERIODIC_REVIEW_EDD') {
      return PERIODIC_REVIEW_WORKFLOW;
    }
    if (normalized === 'ONBOARDING_CDD' || normalized === 'ONBOARDING_EDD') {
      return ONBOARDING_WORKFLOW;
    }
    return null;
  }

  private getWorkflowSnapshot(input: {
    contextType?: string | null;
    outputs?: Record<string, unknown>;
  }) {
    const orchestration =
      input.outputs &&
      input.outputs.orchestration &&
      typeof input.outputs.orchestration === 'object' &&
      !Array.isArray(input.outputs.orchestration)
        ? (input.outputs.orchestration as Record<string, unknown>)
        : {};

    const stage =
      String(orchestration.stage || '').trim() ||
      this.getStageFromContextType(input.contextType) ||
      null;
    const normalizedStage = stage ? String(stage).trim().toUpperCase() : null;
    const workflow =
      String(orchestration.workflow || '').trim() ||
      this.getWorkflowFromContextType(input.contextType) ||
      getWorkflowFromSourceType(orchestration.sourceType) ||
      (normalizedStage ? ONBOARDING_WORKFLOW : '');
    const rule =
      String(orchestration.rule || '').trim() ||
      getCanonicalReviewRuleForStage(normalizedStage || null, workflow || null) ||
      getCanonicalOnboardingRuleForStage(normalizedStage || null) ||
      null;
    const workflowTransition =
      input.outputs &&
      input.outputs.workflowTransition &&
      typeof input.outputs.workflowTransition === 'object' &&
      !Array.isArray(input.outputs.workflowTransition)
        ? (input.outputs.workflowTransition as Record<string, unknown>)
        : {};

    return {
      workflow: workflow || null,
      stage: normalizedStage || null,
      rule: rule || null,
      orchestration,
      workflowTransition,
    };
  }

  private mapListItem(row: any) {
    const outputs = this.parseJsonSafely(row.outputs);
    const workflowSnapshot = this.getWorkflowSnapshot({
      contextType: row.contextType,
      outputs,
    });
    return {
      id: row.id,
      customerId: row.customerId,
      contextType: row.contextType,
      subjectType: this.getSubjectType(row.inputPayload),
      subjectId: row.subjectId,
      ownerType: 'CUSTOMER',
      ownerId: row.customerId,
      policyVersion: row.policyVersion,
      status: row.status,
      inputHash: row.inputHash,
      outputDecision: row.outputDecision,
      recommendedActions: this.normalizeRecommendedActions(
        this.parseJsonArraySafely(row.recommendedActions),
      ),
      reasonCodes: this.parseJsonArraySafely<string>(row.reasonCodes),
      workflow: workflowSnapshot.workflow,
      stage: workflowSnapshot.stage,
      rule: workflowSnapshot.rule,
      orchestration: workflowSnapshot.orchestration,
      workflowTransition: workflowSnapshot.workflowTransition,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
      customer: row.customer,
    };
  }

  async listDecisionRecords(query: DecisionRecordListQuery) {
    const skip = this.normalizeSkip(query.skip);
    const take = this.normalizeTake(query.take);

    const where: Prisma.WorkflowDecisionRecordWhereInput = {};
    const status = String(query.status || '').trim();
    const contextType = String(query.contextType || '').trim();
    const outputDecision = String(query.outputDecision || '').trim();
    const ownerId = String(query.ownerId || '').trim();
    const subjectId = String(query.subjectId || '').trim();
    const policyVersion = String(query.policyVersion || '').trim();

    if (status) where.status = status;
    if (contextType) where.contextType = contextType;
    if (outputDecision) where.outputDecision = outputDecision;
    if (ownerId) where.customerId = ownerId;
    if (subjectId) where.subjectId = subjectId;
    if (policyVersion) {
      where.policyVersion = { contains: policyVersion };
    }

    const decisionRecordRepo = (this.prisma as any).workflowDecisionRecord;
    const [total, rows] = await Promise.all([
      decisionRecordRepo.count({ where }),
      decisionRecordRepo.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          customerId: true,
          contextType: true,
          subjectId: true,
          policyVersion: true,
          status: true,
          inputHash: true,
          inputPayload: true,
          outputDecision: true,
          recommendedActions: true,
          outputs: true,
          reasonCodes: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              customerNo: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      skip,
      take,
      items: rows.map((row: any) => this.mapListItem(row)),
    };
  }

  async getDecisionRecordDetail(id: string) {
    const decisionRecordRepo = (this.prisma as any).workflowDecisionRecord;
    const row = await decisionRecordRepo.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            customerNo: true,
            email: true,
            firstName: true,
            lastName: true,
            customerType: true,
            companyName: true,
          },
        },
      },
    });

    if (!row) {
      throw new NotFoundException(`Decision record not found: ${id}`);
    }

    const inputPayload = this.parseJsonSafely(row.inputPayload);
    const outputs = this.parseJsonSafely(row.outputs);
    const workflowSnapshot = this.getWorkflowSnapshot({
      contextType: row.contextType,
      outputs,
    });
    return {
      ...this.mapListItem({
        ...row,
        inputPayload: row.inputPayload,
      }),
      inputPayload,
      outputs,
      recommendedActions: this.normalizeRecommendedActions(
        this.parseJsonArraySafely(row.recommendedActions),
      ),
      reasonCodes: this.parseJsonArraySafely<string>(row.reasonCodes),
      workflow: workflowSnapshot.workflow,
      stage: workflowSnapshot.stage,
      rule: workflowSnapshot.rule,
      orchestration: workflowSnapshot.orchestration,
      workflowTransition: workflowSnapshot.workflowTransition,
      customer: row.customer,
    };
  }
}
