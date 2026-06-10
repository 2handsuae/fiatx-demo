import axios from 'axios';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { WITHDRAW_QUOTE_TTL_SECONDS } from '../src/modules/trading/pricing-center/types/pricing.types';

type HttpMethod = 'get' | 'post' | 'patch';

type SessionResponse = {
  access_token: string;
  user: {
    id: string;
    email: string;
    role?: string;
    roles?: string[];
  };
};

type ListResponse<T> = {
  total: number;
  skip?: number;
  take?: number;
  items: T[];
};

type AssetItem = {
  id: string;
  code: string;
  type: string;
  network?: string | null;
  status: string;
};

type WalletItem = {
  id: string;
  walletNo?: string | null;
  ownerType: string;
  ownerId?: string | null;
  type: string;
  direction: string;
  walletRole: string;
  assetId: string;
  address?: string | null;
  iban?: string | null;
  status: string;
};

type PricingQuoteBase = {
  quoteId: string;
  quoteNo: string | null;
  business: 'SWAP' | 'WITHDRAWAL';
  status: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  fees: unknown[];
  totals: Record<string, string>;
  policyRef: Record<string, unknown>;
};

type SwapQuoteResponse = PricingQuoteBase & {
  amountIn: number;
  amountOut: number;
  rateAllIn: number;
};

type WithdrawQuoteResponse = PricingQuoteBase & {
  amount: number;
  matched: {
    assetEntryId: string;
    tierId: string;
    tierName: string;
  };
};

type PricingQuoteListItem = {
  quoteId: string;
  quoteNo: string | null;
  business: 'SWAP' | 'WITHDRAWAL';
  status: string;
  ownerType: string;
  ownerNo: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  cancelledAt: string | null;
  primaryAssetCode: string | null;
  secondaryAssetCode: string | null;
  amountIn: string | null;
  amountOut: string | null;
  amount: string | null;
  rateAllIn: string | null;
  feeTotal: string;
  feeCurrency: string | null;
  linkedBusinessNo: string | null;
};

type PricingQuoteDetail = PricingQuoteBase & {
  swap?: Record<string, unknown>;
  withdrawal?: Record<string, unknown>;
};

type WithdrawTransactionResponse = {
  id: string;
  withdrawNo: string;
  status: string;
  pricingQuoteId?: string | null;
  amount: string | number;
  feeAmount: string | number;
  netAmount: string | number;
};

const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const adminEmail = process.env.ADMIN_EMAIL || 'admin@fiatx.com';
const adminPassword = process.env.ADMIN_PASSWORD || '123456';
const customerEmail = process.env.CUSTOMER_EMAIL || 'minimal_active@example.com';
const customerPassword = process.env.CUSTOMER_PASSWORD || '123456';
const defaultDbUrl = 'file:/tmp/exchange_js_main/dev.db';
const workspaceLocalDbUrl = 'file:/tmp/exchange_js_audit_evidence/dev.db';
const smokeBalanceTarget = new Prisma.Decimal('1.00000000');
const withdrawAmount = 0.05;
const swapAmount = 0.01;

const configuredDbUrl = String(process.env.DATABASE_URL || '').trim();
const resolvedDatabaseUrl =
  !configuredDbUrl || configuredDbUrl === workspaceLocalDbUrl
    ? defaultDbUrl
    : configuredDbUrl;

process.env.DATABASE_URL = resolvedDatabaseUrl;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: resolvedDatabaseUrl,
    },
  },
  log: ['warn', 'error'],
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function toErrorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 'NO_STATUS';
    const body = error.response?.data ? ` ${JSON.stringify(error.response.data)}` : '';
    return `${status}${body}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function waitForServerReady(timeoutMs = 120_000, intervalMs = 1_000) {
  const startedAt = Date.now();
  let lastError = 'not-started';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await axios.post(`${baseUrl}/auth/login`, {
        email: adminEmail,
        password: adminPassword,
      });
      return;
    } catch (error) {
      lastError = toErrorMessage(error);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(`API server not ready after ${timeoutMs}ms: ${lastError}`);
}

async function loginAdmin() {
  const response = await axios.post<SessionResponse>(`${baseUrl}/auth/login`, {
    email: adminEmail,
    password: adminPassword,
  });
  return response.data;
}

async function loginCustomer() {
  const response = await axios.post<SessionResponse>(`${baseUrl}/auth/customer/login`, {
    email: customerEmail,
    password: customerPassword,
  });
  return response.data;
}

async function authed<T>(
  token: string,
  method: HttpMethod,
  path: string,
  data?: unknown,
  params?: Record<string, unknown>,
) {
  const response = await axios.request<T>({
    method,
    url: `${baseUrl}${path}`,
    data,
    params,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data;
}

async function ensureEligibleCustomer(customerId: string) {
  await prisma.customerMain.update({
    where: { id: customerId },
    data: {
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      complianceStatus: 'CLEAR',
      complianceFreezeCaseId: null,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
}

async function ensureCustomerFixture(email: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();

  return prisma.customerMain.upsert({
    where: { email },
    update: {
      customerNo: 'CUST-MIN-0003',
      phone: '+15551000003',
      firstName: 'MinimalActive',
      lastName: 'Demo',
      passwordHash,
      passwordUpdatedAt: now,
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      riskRating: 'LOW',
      complianceStatus: 'CLEAR',
      complianceFreezeCaseId: null,
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      customerNo: 'CUST-MIN-0003',
      email,
      phone: '+15551000003',
      firstName: 'MinimalActive',
      lastName: 'Demo',
      passwordHash,
      passwordUpdatedAt: now,
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      riskRating: 'LOW',
      complianceStatus: 'CLEAR',
    },
  });
}

async function getAssetByCode(adminToken: string, code: string) {
  const response = await authed<ListResponse<AssetItem>>(
    adminToken,
    'get',
    '/assets',
    undefined,
    {
      code,
      status: 'ACTIVE',
      take: 100,
    },
  );
  const asset = response.items.find((item) => item.code === code && item.status === 'ACTIVE');
  assert(asset, `Active asset not found via API: ${code}`);
  return asset;
}

async function getCurrentCustomerCreditBalance(
  customerId: string,
  assetId: string,
): Promise<Prisma.Decimal> {
  const [creditCr, creditDr] = await Promise.all([
    prisma.journalLine.aggregate({
      _sum: { amount: true },
      where: {
        accountCode: 'L.CLIENT_CREDIT',
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        assetId,
        drCr: 'CR',
      },
    }),
    prisma.journalLine.aggregate({
      _sum: { amount: true },
      where: {
        accountCode: 'L.CLIENT_CREDIT',
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        assetId,
        drCr: 'DR',
      },
    }),
  ]);

  return new Prisma.Decimal(creditCr._sum.amount || 0).minus(
    new Prisma.Decimal(creditDr._sum.amount || 0),
  );
}

async function ensureCustomerCreditFixture(customerId: string, assetId: string) {
  const current = await getCurrentCustomerCreditBalance(customerId, assetId);
  if (current.gte(smokeBalanceTarget)) {
    return {
      toppedUp: false,
      currentBalance: current.toString(),
      targetBalance: smokeBalanceTarget.toString(),
      journalNo: null as string | null,
    };
  }

  const delta = smokeBalanceTarget.minus(current);
  const existing = await prisma.journal.findFirst({
    where: {
      sourceType: 'SMOKE',
      sourceId: `wave4-pricing-balance:${customerId}:${assetId}`,
      eventCode: 'SMOKE_BALANCE_FIXTURE',
    },
  });

  const journalNo =
    existing?.journalNo || `SMK-JRN-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  await prisma.$transaction(async (tx) => {
    const journalId = existing?.id || randomUUID();
    if (!existing) {
      await tx.journal.create({
        data: {
          id: journalId,
          journalNo,
          sourceType: 'SMOKE',
          sourceId: `wave4-pricing-balance:${customerId}:${assetId}`,
          sourceNo: `wave4-pricing-balance:${customerId}:${assetId}`,
          eventCode: 'SMOKE_BALANCE_FIXTURE',
          postingStatus: 'POSTED',
          postedAt: new Date(),
          baseAssetId: assetId,
          description: 'Wave 4 pricing quote smoke customer credit fixture',
          totalAmount: delta,
          lines: {
            create: [
              {
                id: randomUUID(),
                lineNo: 1,
                accountCode: 'A.CLIENT_CUSTODY',
                drCr: 'DR',
                amount: delta,
                assetId,
                ownerType: 'CUSTOMER',
                ownerId: customerId,
                dimensions: '{}',
                description: 'Wave 4 smoke fixture debit',
              },
              {
                id: randomUUID(),
                lineNo: 2,
                accountCode: 'L.CLIENT_CREDIT',
                drCr: 'CR',
                amount: delta,
                assetId,
                ownerType: 'CUSTOMER',
                ownerId: customerId,
                dimensions: '{}',
                description: 'Wave 4 smoke fixture credit',
              },
            ],
          },
        },
      });
      return;
    }

    const nextLineNo =
      (await tx.journalLine.count({
        where: { journalId: existing.id },
      })) + 1;

    await tx.journal.update({
      where: { id: existing.id },
      data: {
        totalAmount: new Prisma.Decimal(existing.totalAmount || 0).plus(delta),
        updatedAt: new Date(),
      },
    });

    await tx.journalLine.create({
      data: {
        id: randomUUID(),
        journalId: existing.id,
        lineNo: nextLineNo,
        accountCode: 'A.CLIENT_CUSTODY',
        drCr: 'DR',
        amount: delta,
        assetId,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        dimensions: '{}',
        description: 'Wave 4 smoke fixture debit top-up',
      },
    });
    await tx.journalLine.create({
      data: {
        id: randomUUID(),
        journalId: existing.id,
        lineNo: nextLineNo + 1,
        accountCode: 'L.CLIENT_CREDIT',
        drCr: 'CR',
        amount: delta,
        assetId,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        dimensions: '{}',
        description: 'Wave 4 smoke fixture credit top-up',
      },
    });
  });

  return {
    toppedUp: true,
    currentBalance: current.toString(),
    targetBalance: smokeBalanceTarget.toString(),
    journalNo,
  };
}

function assertQuoteBaseContract(quote: PricingQuoteBase, business: 'SWAP' | 'WITHDRAWAL') {
  assert(quote.quoteId, `${business} quoteId missing`);
  assert(quote.business === business, `${business} business mismatch`);
  assert(quote.status, `${business} status missing`);
  assert(quote.createdAt, `${business} createdAt missing`);
  assert(quote.expiresAt, `${business} expiresAt missing`);
  assert(Array.isArray(quote.fees), `${business} fees must be array`);
  assert(quote.totals && typeof quote.totals === 'object', `${business} totals missing`);
  assert(quote.policyRef && typeof quote.policyRef === 'object', `${business} policyRef missing`);
}

async function ensureOutboundBtcWallet(
  customerToken: string,
  customerId: string,
  btcAssetId: string,
) {
  const listed = await authed<ListResponse<WalletItem>>(
    customerToken,
    'get',
    '/wallets',
    undefined,
    {
      assetId: btcAssetId,
      direction: 'OUTBOUND',
      type: 'CRYPTO_ADDRESS',
      take: 100,
    },
  );

  const existing = listed.items.find(
    (item) =>
      item.assetId === btcAssetId &&
      item.direction === 'OUTBOUND' &&
      item.type === 'CRYPTO_ADDRESS' &&
      item.walletRole === 'GENERAL' &&
      item.status === 'ACTIVE',
  );
  if (existing) {
    return existing;
  }

  return authed<WalletItem>(customerToken, 'post', '/wallets', {
    ownerType: 'CUSTOMER',
    ownerId: customerId,
    type: 'CRYPTO_ADDRESS',
    direction: 'OUTBOUND',
    assetId: btcAssetId,
    address: `btc-smoke-outbound-${Date.now()}`,
    beneficiaryName: 'Wave 4 Smoke Destination',
  });
}

async function runSwapQuoteSmoke(customerToken: string, adminToken: string, btcAssetId: string, aedAssetId: string) {
  const created = await authed<SwapQuoteResponse>(
    customerToken,
    'post',
    '/swap-transactions/quotes',
    {
      fromAssetId: btcAssetId,
      toAssetId: aedAssetId,
      fromAmount: swapAmount,
    },
  );
  assertQuoteBaseContract(created, 'SWAP');
  assert(created.quoteNo, 'SWAP quoteNo missing');

  const list = await authed<{ items: PricingQuoteListItem[]; total: number }>(
    adminToken,
    'get',
    '/admin/pricing/quotes',
    undefined,
    {
      business: 'SWAP',
      quoteNo: created.quoteNo,
      take: 20,
    },
  );
  assert(
    list.items.some((item) => item.quoteId === created.quoteId),
    'Unified admin SWAP quote list missing created quote',
  );

  const unifiedDetail = await authed<PricingQuoteDetail>(
    adminToken,
    'get',
    `/admin/pricing/quotes/SWAP/${created.quoteId}`,
  );
  assert(unifiedDetail.business === 'SWAP', 'Unified SWAP quote detail business mismatch');

  const cancelled = await authed<SwapQuoteResponse>(
    customerToken,
    'post',
    `/swap-transactions/quotes/${created.quoteId}/cancel`,
  );
  assert(cancelled.status === 'CANCELLED', 'SWAP quote should become CANCELLED');

  const legacyDetail = await authed<PricingQuoteDetail>(
    adminToken,
    'get',
    `/admin/swap-transactions/quotes/${created.quoteId}`,
  );
  assert(
    legacyDetail.quoteId === created.quoteId && legacyDetail.business === 'SWAP',
    'Legacy swap admin wrapper failed',
  );

  return {
    created: {
      quoteId: created.quoteId,
      quoteNo: created.quoteNo,
      status: created.status,
    },
    cancelled: {
      quoteId: cancelled.quoteId,
      status: cancelled.status,
    },
  };
}

async function runWithdrawQuoteSmoke(
  customerToken: string,
  adminToken: string,
  btcAssetId: string,
  destinationWalletId: string,
) {
  const cancelledCandidate = await authed<WithdrawQuoteResponse>(
    customerToken,
    'post',
    '/withdraw-transactions/quotes',
    {
      assetId: btcAssetId,
      amount: withdrawAmount,
    },
  );
  assertQuoteBaseContract(cancelledCandidate, 'WITHDRAWAL');
  const createdAtMs = new Date(cancelledCandidate.createdAt).getTime();
  const expiresAtMs = new Date(cancelledCandidate.expiresAt).getTime();
  assert(
    expiresAtMs > createdAtMs,
    'Withdrawal quote expiresAt must be later than createdAt',
  );
  assert(
    expiresAtMs - createdAtMs <= (WITHDRAW_QUOTE_TTL_SECONDS + 5) * 1000,
    'Withdrawal quote expiresAt must respect real TTL window',
  );
  assert(
    new Date(cancelledCandidate.expiresAt).getUTCFullYear() < 2099,
    'Withdrawal quote expiresAt must not be far-expiry 2099',
  );

  const list = await authed<{ items: PricingQuoteListItem[]; total: number }>(
    adminToken,
    'get',
    '/admin/pricing/quotes',
    undefined,
    {
      business: 'WITHDRAWAL',
      quoteNo: cancelledCandidate.quoteNo,
      take: 20,
    },
  );
  assert(
    list.items.some((item) => item.quoteId === cancelledCandidate.quoteId),
    'Unified admin WITHDRAWAL quote list missing created quote',
  );

  const detail = await authed<PricingQuoteDetail>(
    adminToken,
    'get',
    `/admin/pricing/quotes/WITHDRAWAL/${cancelledCandidate.quoteId}`,
  );
  assert(
    detail.business === 'WITHDRAWAL',
    'Unified WITHDRAWAL quote detail business mismatch',
  );

  const cancelled = await authed<WithdrawQuoteResponse>(
    customerToken,
    'post',
    `/withdraw-transactions/quotes/${cancelledCandidate.quoteId}/cancel`,
  );
  assert(cancelled.status === 'CANCELLED', 'Withdrawal quote should become CANCELLED');

  const usedCandidate = await authed<WithdrawQuoteResponse>(
    customerToken,
    'post',
    '/withdraw-transactions/quotes',
    {
      assetId: btcAssetId,
      amount: withdrawAmount,
    },
  );
  assertQuoteBaseContract(usedCandidate, 'WITHDRAWAL');

  const withdrawal = await authed<WithdrawTransactionResponse>(
    customerToken,
    'post',
    '/withdraw-transactions',
    {
      assetId: btcAssetId,
      amount: withdrawAmount,
      quoteId: usedCandidate.quoteId,
      toWalletId: destinationWalletId,
    },
  );
  assert(withdrawal.pricingQuoteId === usedCandidate.quoteId, 'Withdrawal must bind pricing quote');

  const usedDetail = await authed<PricingQuoteDetail>(
    adminToken,
    'get',
    `/admin/pricing/quotes/WITHDRAWAL/${usedCandidate.quoteId}`,
  );
  assert(usedDetail.status === 'USED', 'Withdrawal quote must become USED after transaction create');

  return {
    cancelled: {
      quoteId: cancelled.quoteId,
      quoteNo: cancelled.quoteNo,
      status: cancelled.status,
    },
    used: {
      quoteId: usedCandidate.quoteId,
      quoteNo: usedCandidate.quoteNo,
      status: usedDetail.status,
      withdrawNo: withdrawal.withdrawNo,
    },
  };
}

async function main() {
  await waitForServerReady();

  const [adminSession, customerRecord] = await Promise.all([
    loginAdmin(),
    ensureCustomerFixture(customerEmail, customerPassword),
  ]);

  await ensureEligibleCustomer(customerRecord.id);

  const customerSession = await loginCustomer();
  const customerId = customerSession.user.id;

  const [btcAsset, aedAsset] = await Promise.all([
    getAssetByCode(adminSession.access_token, 'BTC'),
    getAssetByCode(adminSession.access_token, 'AED'),
  ]);

  const outboundWallet = await ensureOutboundBtcWallet(
    customerSession.access_token,
    customerId,
    btcAsset.id,
  );

  const balanceFixture = await ensureCustomerCreditFixture(customerId, btcAsset.id);

  const swap = await runSwapQuoteSmoke(
    customerSession.access_token,
    adminSession.access_token,
    btcAsset.id,
    aedAsset.id,
  );

  const withdraw = await runWithdrawQuoteSmoke(
    customerSession.access_token,
    adminSession.access_token,
    btcAsset.id,
    outboundWallet.id,
  );

  const evidence = {
    scope: 'implemented-scope',
    executedAt: new Date().toISOString(),
    apiBaseUrl: baseUrl,
    databaseUrl: resolvedDatabaseUrl,
    accounts: {
      admin: adminEmail,
      customer: customerEmail,
    },
    assets: {
      btc: { id: btcAsset.id, code: btcAsset.code, network: btcAsset.network },
      aed: { id: aedAsset.id, code: aedAsset.code, network: aedAsset.network },
    },
    customer: {
      id: customerId,
      customerNo: customerRecord.customerNo,
    },
    outboundWallet: {
      id: outboundWallet.id,
      walletNo: outboundWallet.walletNo || null,
      address: outboundWallet.address || null,
    },
    balanceFixture,
    swap,
    withdraw,
  };

  console.log('Wave 4 pricing quote smoke completed successfully.');
  console.log(JSON.stringify(evidence, null, 2));
}

main()
  .catch((error) => {
    console.error('Wave 4 pricing quote smoke failed:', toErrorMessage(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
