-- AlterTable: 平账准备字段（业务归属日）
ALTER TABLE "tb_transfer_evidence" ADD COLUMN "effectiveDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "account_flows" ADD COLUMN "effectiveDate" TEXT NOT NULL DEFAULT '';

-- Backfill: effectiveDate = createdAt 的 UTC 日期（createdAt 物理存储为 epoch 毫秒整数）
UPDATE "tb_transfer_evidence" SET "effectiveDate" = strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch');
UPDATE "account_flows"        SET "effectiveDate" = strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch');
