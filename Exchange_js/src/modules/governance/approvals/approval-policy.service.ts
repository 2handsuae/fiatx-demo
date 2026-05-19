import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ApprovalActionTypes,
  ApprovalSoDRuleCodes,
  DEFAULT_APPROVAL_POLICIES,
  V1_APPROVAL_ACTION_TYPES,
  splitRoleCsv,
  PolicyStepConfig,
  deriveCheckerRoles,
  parseAndValidateStepsConfig,
  checkerRolesToSteps,
} from './constants/approval.constants';

export interface ResolvedApprovalPolicy {
  actionType: string;
  steps: PolicyStepConfig[];
  checkerRoles: string[];
  timeoutHours: number;
  allowCancel: boolean;
}

@Injectable()
export class ApprovalPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicy(actionType: string): Promise<ResolvedApprovalPolicy> {
    const normalizedActionType = String(actionType || '').trim().toUpperCase();
    const fallback = DEFAULT_APPROVAL_POLICIES[normalizedActionType];

    const policy = await this.prisma.approvalActionPolicy.findUnique({
      where: { actionType: normalizedActionType },
    });

    let steps: PolicyStepConfig[];

    if (policy?.stepsConfig) {
      steps = parseAndValidateStepsConfig(policy.stepsConfig);
    } else if (policy?.checkerRoles) {
      // Legacy: flat CSV → each role = 1 step
      steps = checkerRolesToSteps(splitRoleCsv(policy.checkerRoles));
    } else if (fallback) {
      steps = fallback.steps;
    } else {
      steps = [];
    }

    return {
      actionType: normalizedActionType,
      steps,
      checkerRoles: deriveCheckerRoles(steps),
      timeoutHours: policy?.timeoutHours ?? fallback?.timeoutHours ?? 24,
      allowCancel: policy?.allowCancel ?? fallback?.allowCancel ?? true,
    };
  }

  async listV1Policies(): Promise<
    (ResolvedApprovalPolicy & { source: 'DEFAULT' | 'CUSTOMIZED'; editable: boolean })[]
  > {
    const dbOverrides = await this.prisma.approvalActionPolicy.findMany({
      where: { actionType: { in: [...V1_APPROVAL_ACTION_TYPES] } },
    });
    const dbMap = new Map(dbOverrides.map((o) => [o.actionType, o]));

    return V1_APPROVAL_ACTION_TYPES.map((actionType) => {
      const dbRow = dbMap.get(actionType);
      const defaultPolicy = DEFAULT_APPROVAL_POLICIES[actionType];
      if (!defaultPolicy) {
        throw new Error(`V1 whitelist references unknown actionType: ${actionType}`);
      }
      const hasOverride = !!dbRow;

      let steps: PolicyStepConfig[];
      if (dbRow?.stepsConfig) {
        steps = parseAndValidateStepsConfig(dbRow.stepsConfig);
      } else if (dbRow?.checkerRoles) {
        steps = checkerRolesToSteps(splitRoleCsv(dbRow.checkerRoles));
      } else {
        steps = defaultPolicy.steps;
      }

      return {
        actionType,
        steps,
        checkerRoles: deriveCheckerRoles(steps),
        timeoutHours: dbRow?.timeoutHours ?? defaultPolicy.timeoutHours,
        allowCancel: dbRow?.allowCancel ?? defaultPolicy.allowCancel,
        source: hasOverride ? ('CUSTOMIZED' as const) : ('DEFAULT' as const),
        editable: actionType !== ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
      };
    });
  }

  async upsertStepsConfig(
    actionType: string,
    steps: PolicyStepConfig[],
    tx?: any,
  ): Promise<void> {
    if (actionType === ApprovalActionTypes.APPROVAL_POLICY_CHANGE) {
      throw new BadRequestException({
        code: 'SELF_POLICY_IMMUTABLE',
        message: 'APPROVAL_POLICY_CHANGE policy cannot be modified through the platform',
      });
    }
    const defaultPolicy = DEFAULT_APPROVAL_POLICIES[actionType];
    if (!defaultPolicy) {
      throw new BadRequestException(`Unknown actionType: ${actionType}`);
    }
    // Validate step structure
    parseAndValidateStepsConfig(JSON.stringify(steps));

    const stepsConfig = JSON.stringify(steps);
    const checkerRoles = deriveCheckerRoles(steps).join(',');

    const db = tx || this.prisma;
    await db.approvalActionPolicy.upsert({
      where: { actionType },
      update: { stepsConfig, checkerRoles },
      create: {
        actionType,
        stepsConfig,
        checkerRoles,
        timeoutHours: defaultPolicy.timeoutHours,
        allowCancel: defaultPolicy.allowCancel,
      },
    });
  }

  async isSameUserMakerCheckerDenied(): Promise<boolean> {
    const rule = await this.prisma.approvalSodRule.findUnique({
      where: { ruleCode: ApprovalSoDRuleCodes.DENY_SAME_USER_MAKER_CHECKER },
    });
    return rule?.enabled ?? true;
  }
}
