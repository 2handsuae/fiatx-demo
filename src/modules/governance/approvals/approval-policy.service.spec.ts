import { ApprovalPolicyService } from './approval-policy.service';
import {
  DEFAULT_APPROVAL_POLICIES,
  V1_APPROVAL_ACTION_TYPES,
  deriveCheckerRoles,
  joinRoleCsv,
} from './constants/approval.constants';

describe('ApprovalPolicyService', () => {
  let prisma: any;
  let service: ApprovalPolicyService;

  // 镜像 prisma/seed.base.ts → seedGovernanceApprovalBaseline()：reset 时每条策略都会
  // 建一行 DB 记录（checkerRoles CSV，无 stepsConfig），哪怕内容跟代码默认值一模一样。
  const seededRow = (actionType: string) => {
    const policy = DEFAULT_APPROVAL_POLICIES[actionType];
    return {
      actionType,
      stepsConfig: null as string | null,
      checkerRoles: joinRoleCsv(deriveCheckerRoles(policy.steps)),
      timeoutHours: policy.timeoutHours,
      allowCancel: policy.allowCancel,
    };
  };

  beforeEach(() => {
    prisma = { approvalActionPolicy: { findMany: jest.fn() } };
    service = new ApprovalPolicyService(prisma);
  });

  describe('Task 27 · source 真 diff（内容比对取代"有 DB 行就算 CUSTOMIZED"）', () => {
    it('重铺态：seed 给全部 V1 策略各建一行但内容与默认值一致，listV1Policies 全部应显 DEFAULT', async () => {
      prisma.approvalActionPolicy.findMany.mockResolvedValue(
        V1_APPROVAL_ACTION_TYPES.map((actionType) => seededRow(actionType)),
      );

      const result = await service.listV1Policies();

      expect(result).toHaveLength(V1_APPROVAL_ACTION_TYPES.length);
      expect(result.every((p) => p.source === 'DEFAULT')).toBe(true);
    });

    it('改一条：ROLE_DEFINITION_CREATE 的 stepsConfig 加一个角色后，只有它翻 CUSTOMIZED，其余仍 DEFAULT', async () => {
      const changedActionType = 'ROLE_DEFINITION_CREATE';
      const customizedSteps = [{ stepNo: 1, roles: ['CISO', 'COMPLIANCE_OFFICER'] }];

      prisma.approvalActionPolicy.findMany.mockResolvedValue(
        V1_APPROVAL_ACTION_TYPES.map((actionType) =>
          actionType === changedActionType
            ? {
                ...seededRow(actionType),
                stepsConfig: JSON.stringify(customizedSteps),
                checkerRoles: joinRoleCsv(deriveCheckerRoles(customizedSteps)),
              }
            : seededRow(actionType),
        ),
      );

      const result = await service.listV1Policies();
      const changed = result.find((p) => p.actionType === changedActionType);
      const untouched = result.filter((p) => p.actionType !== changedActionType);

      expect(changed?.source).toBe('CUSTOMIZED');
      expect(untouched.every((p) => p.source === 'DEFAULT')).toBe(true);
    });
  });
});
