-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "customer_main" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "phone" TEXT,
    "emailVerifiedAt" DATETIME,
    "phoneVerifiedAt" DATETIME,
    "firstName" TEXT,
    "lastName" TEXT,
    "passwordHash" TEXT,
    "passwordUpdatedAt" DATETIME,
    "authStatus" TEXT NOT NULL DEFAULT 'NONE',
    "authLevel" TEXT NOT NULL DEFAULT 'NONE',
    "kycId" TEXT,
    "eddId" TEXT,
    "authLevelExpiresAt" DATETIME,
    "riskScore" INTEGER,
    "riskLevel" TEXT,
    "riskUpdatedAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLoginIp" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "termsAcceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "customer_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "liquidity_provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "supportedCurrencies" TEXT NOT NULL,
    "supportedNetworks" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currency" TEXT NOT NULL,
    "network" TEXT,
    "type" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "liquidity_provider_email_key" ON "liquidity_provider"("email");

-- CreateIndex
CREATE UNIQUE INDEX "assets_currency_network_key" ON "assets"("currency", "network");
