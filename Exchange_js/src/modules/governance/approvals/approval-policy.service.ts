import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ApprovalSoDRuleCodes,
  DEFAULT_APPROVAL_POLICIES,
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

  async isSameUserMakerCheckerDenied(): Promise<boolean> {
    const rule = await this.prisma.approvalSodRule.findUnique({
      where: { ruleCode: ApprovalSoDRuleCodes.DENY_SAME_USER_MAKER_CHECKER },
    });
    return rule?.enabled ?? true;
  }
}
