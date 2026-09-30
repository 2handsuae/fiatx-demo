-- CreateTable
CREATE TABLE "customer_notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerCustomerNo" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channels" TEXT NOT NULL,
    "relatedOrderType" TEXT NOT NULL,
    "relatedOrderNo" TEXT NOT NULL,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "customer_notifications_ownerCustomerNo_createdAt_idx" ON "customer_notifications"("ownerCustomerNo", "createdAt");
