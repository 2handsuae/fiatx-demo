import { Prisma } from '@prisma/client';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';

/** System maker context for opening the gate approval (checker = SMO; no SoD collision). */
export const SYSTEM_APPROVAL_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

/**
 * Decide whether a withdrawal needs the large-value approval gate.
 * Fail-closed: missing value / failed rate fetch / missing rule all route to approval.
 */
export function shouldRequireApproval(
  input: { grossAedValue: Prisma.Decimal | null; rateFetchFailed: boolean },
  threshold: Prisma.Decimal | null,
): boolean {
  if (input.rateFetchFailed) return true;
  if (!input.grossAedValue) return true;
  if (!threshold) return true; // 规则被删/未种 → fail-closed 走审批
  return input.grossAedValue.gte(threshold);
}
