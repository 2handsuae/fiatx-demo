-- CreateTable
CREATE TABLE "stored_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "docNo" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerNo" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "stored_documents_docNo_key" ON "stored_documents"("docNo");

-- CreateIndex
CREATE INDEX "stored_documents_ownerType_ownerNo_idx" ON "stored_documents"("ownerType", "ownerNo");

