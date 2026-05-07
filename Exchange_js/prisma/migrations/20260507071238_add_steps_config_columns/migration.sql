-- AlterTable
ALTER TABLE "approval_action_policies" ADD COLUMN "stepsConfig" TEXT;

-- AlterTable
ALTER TABLE "approval_policy_change_requests" ADD COLUMN "currentStepsConfig" TEXT;
ALTER TABLE "approval_policy_change_requests" ADD COLUMN "proposedStepsConfig" TEXT;
