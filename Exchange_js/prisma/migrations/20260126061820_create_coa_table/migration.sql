-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requiredTags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_code_key" ON "chart_of_accounts"("code");

-- CreateIndex
CREATE INDEX "chart_of_accounts_code_idx" ON "chart_of_accounts"("code");

-- CreateIndex
CREATE INDEX "chart_of_accounts_status_idx" ON "chart_of_accounts"("status");
