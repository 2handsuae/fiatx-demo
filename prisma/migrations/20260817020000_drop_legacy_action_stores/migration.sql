-- 材料请求账 Task 12：统一删旧结构（G3 兑现）。
-- 删 2 表（deposit_applicant_actions / withdraw_applicant_actions）+ 6 列
-- （customer_main 的 pendingAction* 三列、material_refresh_cycles 的
-- sumsubAction* 三列）。SQLite 删列走表重建模式：建 new_xxx → 拷数据 →
-- drop 旧表 → rename。表重建会一并丢失索引，故重建后手动补回全部原有索引。

PRAGMA foreign_keys=OFF;

-- ═══ 两张子表整表删除：已被 material_requests 取代，本仓零写入方 ═══

DROP TABLE "deposit_applicant_actions";
DROP TABLE "withdraw_applicant_actions";

-- ═══ customer_main：删 pendingActionExternalId / pendingActionReason /
-- pendingActionSubmittedAt 三列，保留 hardLineDispositionedAt ═══

CREATE TABLE "new_customer_main" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "email" TEXT,
    "phone" TEXT,
    "emailVerifiedAt" DATETIME,
    "phoneVerifiedAt" DATETIME,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "passwordHash" TEXT,
    "passwordUpdatedAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLoginIp" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "termsAcceptedAt" DATETIME,
    "lifecycle" TEXT NOT NULL DEFAULT 'PROSPECT',
    "onboardingTraceId" TEXT,
    "onboardingApprovedAt" DATETIME,
    "hard_line_dispositioned_at" DATETIME,
    "investorTier" TEXT NOT NULL DEFAULT 'STANDARD',
    "investorTierSource" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "investorTierUpdatedAt" DATETIME,
    "tradingTier" TEXT NOT NULL DEFAULT 'BASIC',
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "sumsubVerificationLevel" INTEGER NOT NULL DEFAULT 1,
    "riskRating" TEXT NOT NULL DEFAULT 'LOW',
    "riskRatingUpdatedAt" DATETIME,
    "eddRequired" BOOLEAN NOT NULL DEFAULT false,
    "pepStatus" TEXT NOT NULL DEFAULT 'NONE',
    "pepConfirmedAt" DATETIME,
    "cddDocumentExpiresAt" DATETIME,
    "sumsubApplicantId" TEXT,
    "sumsubCurrentLevelName" TEXT,
    "sumsubLatestReviewId" TEXT,
    "sumsubLatestAttemptId" TEXT,
    "sumsubExperiencedLevel2" BOOLEAN NOT NULL DEFAULT false,
    "verificationProvider" TEXT,
    "verificationSubstatus" TEXT,
    "verificationCustomerActionRequired" BOOLEAN NOT NULL DEFAULT false,
    "verificationCanContinue" BOOLEAN NOT NULL DEFAULT false,
    "verificationLatestEventType" TEXT,
    "verificationLatestEventAt" DATETIME,
    "latestRiskApprovalId" TEXT,
    "latestRiskApprovalStatus" TEXT,
    "latestRiskAssessmentId" TEXT,
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_main_latestRiskApprovalId_fkey" FOREIGN KEY ("latestRiskApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_customer_main" ("id","customerNo","customerType","email","phone","emailVerifiedAt","phoneVerifiedAt","firstName","lastName","companyName","passwordHash","passwordUpdatedAt","failedLoginCount","lockedUntil","lastLoginAt","lastLoginIp","locale","timezone","termsAcceptedAt","lifecycle","onboardingTraceId","onboardingApprovedAt","hard_line_dispositioned_at","investorTier","investorTierSource","investorTierUpdatedAt","tradingTier","riskLevel","sumsubVerificationLevel","riskRating","riskRatingUpdatedAt","eddRequired","pepStatus","pepConfirmedAt","cddDocumentExpiresAt","sumsubApplicantId","sumsubCurrentLevelName","sumsubLatestReviewId","sumsubLatestAttemptId","sumsubExperiencedLevel2","verificationProvider","verificationSubstatus","verificationCustomerActionRequired","verificationCanContinue","verificationLatestEventType","verificationLatestEventAt","latestRiskApprovalId","latestRiskApprovalStatus","latestRiskAssessmentId","nextReviewAt","createdAt","updatedAt")
  SELECT "id","customerNo","customerType","email","phone","emailVerifiedAt","phoneVerifiedAt","firstName","lastName","companyName","passwordHash","passwordUpdatedAt","failedLoginCount","lockedUntil","lastLoginAt","lastLoginIp","locale","timezone","termsAcceptedAt","lifecycle","onboardingTraceId","onboardingApprovedAt","hard_line_dispositioned_at","investorTier","investorTierSource","investorTierUpdatedAt","tradingTier","riskLevel","sumsubVerificationLevel","riskRating","riskRatingUpdatedAt","eddRequired","pepStatus","pepConfirmedAt","cddDocumentExpiresAt","sumsubApplicantId","sumsubCurrentLevelName","sumsubLatestReviewId","sumsubLatestAttemptId","sumsubExperiencedLevel2","verificationProvider","verificationSubstatus","verificationCustomerActionRequired","verificationCanContinue","verificationLatestEventType","verificationLatestEventAt","latestRiskApprovalId","latestRiskApprovalStatus","latestRiskAssessmentId","nextReviewAt","createdAt","updatedAt"
  FROM "customer_main";

DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";

-- ═══ material_refresh_cycles：删 sumsubActionId / sumsubActionLevelName /
-- sumsubActionCreatedAt 三列，保留表本身与 materialRequestNo ═══
-- （customer_main 已在上面完成 drop+rename，此处的 customerId 外键可以正常
-- 指向新表；holdingId/triggeredByAssessmentId 外键指向的表本轮未改动）

CREATE TABLE "new_material_refresh_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CUSTOMER_EVIDENCE',
    "stage" TEXT NOT NULL DEFAULT 'NUDGE_ONLY',
    "triggerType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageNudgeAt" DATETIME,
    "stageUrgentAt" DATETIME,
    "stageBlockingAt" DATETIME,
    "clearedAt" DATETIME,
    "rejectedAt" DATETIME,
    "customerSubmittedAt" DATETIME,
    "graceExpiresAt" DATETIME,
    "resolutionReason" TEXT,
    "materialRequestNo" TEXT,
    "triggeredByAssessmentId" TEXT,
    "traceId" TEXT NOT NULL,
    CONSTRAINT "material_refresh_cycles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "material_refresh_cycles_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "customer_material_holdings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "material_refresh_cycles_triggeredByAssessmentId_fkey" FOREIGN KEY ("triggeredByAssessmentId") REFERENCES "client_risk_assessments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_material_refresh_cycles" ("id","cycleNo","customerId","holdingId","materialType","status","stage","triggerType","createdAt","stageNudgeAt","stageUrgentAt","stageBlockingAt","clearedAt","rejectedAt","customerSubmittedAt","graceExpiresAt","resolutionReason","materialRequestNo","triggeredByAssessmentId","traceId")
  SELECT "id","cycleNo","customerId","holdingId","materialType","status","stage","triggerType","createdAt","stageNudgeAt","stageUrgentAt","stageBlockingAt","clearedAt","rejectedAt","customerSubmittedAt","graceExpiresAt","resolutionReason","materialRequestNo","triggeredByAssessmentId","traceId"
  FROM "material_refresh_cycles";

DROP TABLE "material_refresh_cycles";
ALTER TABLE "new_material_refresh_cycles" RENAME TO "material_refresh_cycles";

-- ═══ 重建两张表原有的全部索引（表重建会把它们一起丢掉）═══

-- customer_main：6 个（5 unique + 1 plain），删掉的只有
-- customer_main_pending_action_external_id_idx 这一条
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");
CREATE UNIQUE INDEX "customer_main_latestRiskApprovalId_key" ON "customer_main"("latestRiskApprovalId");
CREATE INDEX "customer_main_riskRating_idx" ON "customer_main"("riskRating");

-- material_refresh_cycles：4 个（2 unique + 2 plain），删掉的只有
-- material_refresh_cycles_sumsubActionId_idx 这一条
CREATE UNIQUE INDEX "material_refresh_cycles_cycleNo_key" ON "material_refresh_cycles"("cycleNo");
CREATE UNIQUE INDEX "material_refresh_cycles_traceId_key" ON "material_refresh_cycles"("traceId");
CREATE INDEX "material_refresh_cycles_customerId_status_idx" ON "material_refresh_cycles"("customerId", "status");
CREATE INDEX "material_refresh_cycles_status_graceExpiresAt_idx" ON "material_refresh_cycles"("status", "graceExpiresAt");

PRAGMA foreign_keys=ON;
