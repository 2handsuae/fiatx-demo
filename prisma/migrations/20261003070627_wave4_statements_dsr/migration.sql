-- CreateTable
CREATE TABLE "customer_monthly_statements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statementNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewStartedAt" DATETIME,
    "resolvedAt" DATETIME,
    "dueAt" DATETIME NOT NULL,
    "resolutionCode" TEXT,
    "resolutionNote" TEXT,
    "clauseRef" TEXT,
    "summary" TEXT,
    "materialRequestNo" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_monthly_statements_statementNo_key" ON "customer_monthly_statements"("statementNo");

-- CreateIndex
CREATE UNIQUE INDEX "customer_monthly_statements_customerId_periodMonth_key" ON "customer_monthly_statements"("customerId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_requests_requestNo_key" ON "data_subject_requests"("requestNo");

-- CreateIndex
CREATE INDEX "data_subject_requests_status_idx" ON "data_subject_requests"("status");
