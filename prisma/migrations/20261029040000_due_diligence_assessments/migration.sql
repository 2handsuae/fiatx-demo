-- CreateTable
CREATE TABLE "due_diligence_assessments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentNo" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetNo" TEXT NOT NULL,
    "riskTier" TEXT,
    "opinion" TEXT,
    "conditions" TEXT,
    "conclusion" TEXT,
    "conclusionReason" TEXT,
    "concludedAt" DATETIME,
    "concludedByUserId" TEXT,
    "infosecSoc2" TEXT,
    "infosecIso27001" TEXT,
    "infosecDataLocationOk" BOOLEAN,
    "infosecDrPlanOk" BOOLEAN,
    "infosecOpinion" TEXT,
    "infosecVerdict" TEXT,
    "infosecByUserId" TEXT,
    "infosecAt" DATETIME,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "screening_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordNo" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "uboSeq" INTEGER,
    "listsChecked" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "screenedAt" DATETIME NOT NULL,
    "evidenceDocNo" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "screening_records_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "due_diligence_assessments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "due_diligence_assessments_assessmentNo_key" ON "due_diligence_assessments"("assessmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "due_diligence_assessments_targetType_targetNo_key" ON "due_diligence_assessments"("targetType", "targetNo");

-- CreateIndex
CREATE UNIQUE INDEX "screening_records_recordNo_key" ON "screening_records"("recordNo");

-- CreateIndex
CREATE INDEX "screening_records_assessmentId_idx" ON "screening_records"("assessmentId");

