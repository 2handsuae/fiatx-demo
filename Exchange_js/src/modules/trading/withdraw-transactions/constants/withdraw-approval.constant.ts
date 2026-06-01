import { Prisma } from '@prisma/client';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';

/** Gross-value threshold (AED) at or above which a withdrawal requires SMO approval. */
export const WITHDRAW_APPROVAL_AED_THRESHOLD = new Prisma.Decimal(200000);

/** System maker context for opening the gate approval (checker = SMO; no SoD collision). */
export const SYSTEM_APPROVAL_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

/**
 * Decide whether a withdrawal needs the large-value approval gate.
 * Fail-closed: a missing value or a failed rate fetch routes to approval.
 */
export function shouldRequireApproval(input: {
  grossAedValue: Prisma.Decimal | null;
  rateFetchFailed: boolean;
}): boolean {
  if (input.rateFetchFailed) return true;
  if (!input.grossAedValue) return true;
  return input.grossAedValue.gte(WITHDRAW_APPROVAL_AED_THRESHOLD);
}
