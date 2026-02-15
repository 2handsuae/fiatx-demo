CREATE TABLE "customer_swap_rate_configurations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fromAssetId" TEXT NOT NULL,
  "toAssetId" TEXT NOT NULL,
  "spreadPercent" DECIMAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "customer_swap_rate_configurations_fromAssetId_fkey"
    FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_swap_rate_configurations_toAssetId_fkey"
    FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_swap_rate_configurations_fromAssetId_toAssetId_key"
ON "customer_swap_rate_configurations"("fromAssetId", "toAssetId");

CREATE INDEX "customer_swap_rate_configurations_status_idx"
ON "customer_swap_rate_configurations"("status");

WITH ranked AS (
  SELECT
    "fromAssetId",
    "toAssetId",
    COALESCE("spreadPercent", "feePercent", 0) AS "spreadPercent",
    CASE WHEN UPPER("status") = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END AS "status",
    "created_at",
    "updated_at",
    ROW_NUMBER() OVER (
      PARTITION BY "fromAssetId", "toAssetId"
      ORDER BY "updated_at" DESC, "created_at" DESC
    ) AS rn
  FROM "liquidity_configurations"
)
INSERT INTO "customer_swap_rate_configurations" (
  "id",
  "fromAssetId",
  "toAssetId",
  "spreadPercent",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))), 2) || '-' ||
  SUBSTR('89ab', ABS(RANDOM()) % 4 + 1, 1) || SUBSTR(LOWER(HEX(RANDOMBLOB(2))), 2) || '-' || LOWER(HEX(RANDOMBLOB(6))),
  "fromAssetId",
  "toAssetId",
  "spreadPercent",
  "status",
  "created_at",
  "updated_at"
FROM ranked
WHERE rn = 1;
