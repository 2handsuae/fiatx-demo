import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ApprovalActionTypes,
  ApprovalSoDRuleCodes,
  DEFAULT_APPROVAL_POLICIES,
  V1_APPROVAL_ACTION_TYPES,
  splitRoleCsv,
} from './constants/approval.constants';

export interface ResolvedApprovalPolicy {
  actionType: string;
  riskLevel: string;
  checkerRoles: string[];
  timeoutHours: number;
  allowCancel: boolean;
  allowRetry: boolean;
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

    if (policy) {
      return {
        actionType: normalizedActionType,
        riskLevel: policy.riskLevel,
        checkerRoles: splitRoleCsv(policy.checkerRoles),
        timeoutHours: policy.timeoutHours,
        allowCancel: policy.allowCancel,
        allowRetry: policy.allowRetry,
      };
    }

    if (!fallback) {
      return {
        actionType: normalizedActionType,
        riskLevel: 'HIGH',
        checkerRoles: [],
        timeoutHours: 24,
        allowCancel: true,
        allowRetry: true,
      };
    }

    return {
      actionType: normalizedActionType,
      ...fallback,
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
      return {
        actionType,
        riskLevel: dbRow?.riskLevel ?? defaultPolicy.riskLevel,
        checkerRoles: splitRoleCsv(dbRow?.checkerRoles) ?? defaultPolicy.checkerRoles,
        timeoutHours: dbRow?.timeoutHours ?? defaultPolicy.timeoutHours,
        allowCancel: dbRow?.allowCancel ?? defaultPolicy.allowCancel,
        allowRetry: dbRow?.allowRetry ?? defaultPolicy.allowRetry,
        source: hasOverride ? ('CUSTOMIZED' as const) : ('DEFAULT' as const),
        editable: actionType !== ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
      };
    });
  }

  async upsertCheckerRoles(
    actionType: string,
    checkerRoles: string[],
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
    const db = tx || this.prisma;
    await db.approvalActionPolicy.upsert({
      where: { actionType },
      update: { checkerRoles: checkerRoles.join(',') },
      create: {
        actionType,
        riskLevel: defaultPolicy.riskLevel,
        checkerRoles: checkerRoles.join(','),
        timeoutHours: defaultPolicy.timeoutHours,
        allowCancel: defaultPolicy.allowCancel,
        allowRetry: defaultPolicy.allowRetry,
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
