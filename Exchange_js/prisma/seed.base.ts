import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ASSETS } from '../src/config/manifests/assets.manifest';
import { DEFAULT_COA } from '../src/config/manifests/coa.manifest';
import { DEFAULT_ACCT_EVENTS } from '../src/config/manifests/events.manifest';
import { DEFAULT_JOURNAL_TEMPLATES } from '../src/config/manifests/journal-templates.manifest';
import { DEFAULT_CLEARING_TEMPLATES } from '../src/config/manifests/clearing-templates.manifest';
import { buildDeterministicWalletNo } from '../src/common/utils/no-generator.util';

const DEFAULT_ADMIN_EMAIL = 'admin@fiatx.com';
const DEFAULT_ADMIN_USER_NO = 'ADMIN-001';
const DEFAULT_ADMIN_PASSWORD = '123456';
const DEFAULT_BASE_CUSTOMER_EMAIL = 'shawn@fiatx.com';
const DEFAULT_BASE_CUSTOMER_NO = 'CUST-BASE-SHAWN';
const DEFAULT_BASE_CUSTOMER_PASSWORD = '123456';
const DEFAULT_BASE_CUSTOMER_FIRST_NAME = 'Shawn';
const DEFAULT_BASE_CUSTOMER_LAST_NAME = 'FiatX';

const CRYPTO_SYSTEM_WALLET_KINDS = [
  'CUST_CRYPTO_MASTER',
  'CUST_CRYPTO_PAYOUT',
  'PLATFORM_CRYPTO_LIQ',
] as const;
type CryptoSystemWalletKind = (typeof CRYPTO_SYSTEM_WALLET_KINDS)[number];

const CRYPTO_SYSTEM_WALLET_KIND_CONFIG: Record<
  CryptoSystemWalletKind,
  { ownerType: 'CUSTOMER' | 'PLATFORM'; ownerNo: string; walletRole: string }
> = {
  CUST_CRYPTO_MASTER: {
    ownerType: 'CUSTOMER',
    ownerNo: 'CUSTOMER_POOL',
    walletRole: 'MASTER',
  },
  CUST_CRYPTO_PAYOUT: {
    ownerType: 'CUSTOMER',
    ownerNo: 'CUSTOMER_POOL',
    walletRole: 'PAYOUT',
  },
  PLATFORM_CRYPTO_LIQ: {
    ownerType: 'PLATFORM',
    ownerNo: 'PLATFORM',
    walletRole: 'LIQ',
  },
};

const FIAT_POOL_WALLET_KINDS = ['CUST_BANK', 'LIQ_BANK'] as const;
type FiatPoolWalletKind = (typeof FIAT_POOL_WALLET_KINDS)[number];

const FIAT_POOL_WALLET_KIND_CONFIG: Record<
  FiatPoolWalletKind,
  { ownerType: 'CUSTOMER' | 'PLATFORM'; ownerNo: string; walletRole: string }
> = {
  CUST_BANK: {
    ownerType: 'CUSTOMER',
    ownerNo: 'CUSTOMER_POOL',
    walletRole: 'CUST_BANK',
  },
  LIQ_BANK: {
    ownerType: 'PLATFORM',
    ownerNo: 'PLATFORM',
    walletRole: 'LIQ_BANK',
  },
};

const DEFAULT_CRYPTO_AED_VALUATION_BY_CODE: Record<string, string> = {
  USDT: '3.6725',
  BTC: '250000',
};
const PLATFORM_LIQUIDITY_OPENING_AED = new Prisma.Decimal('1000000');

const DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES = [
  'EVT_DEPOSIT_REJECTED__CRYPTO',
  'EVT_DEPOSIT_REJECTED__FIAT',
] as const;

export async function seedBase(prisma: PrismaClient): Promise<void> {
  console.log('--- Seeding Base Configuration ---');
  await seedAdmin(prisma);
  await seedBaseCustomers(prisma);
  await seedAssets(prisma);
  await seedSystemWallets(prisma);
  await seedAssetValuationRates(prisma);
  await seedLiquidityOpeningBalances(prisma);
  await seedCoa(prisma);
  await seedAcctEvents(prisma);
  await seedJournalTemplates(prisma);
  await seedClearingTemplates(prisma);
  console.log('✅ Base configuration seeded.');
}

export async function ensureBaseSeeded(prisma: PrismaClient): Promise<void> {
  const complete = await isBaseComplete(prisma);
  if (complete) {
    console.log('Base configuration already complete. Skip base sync.');
    return;
  }

  console.log('Base configuration is incomplete. Running base sync...');
  await seedBase(prisma);
}

async function seedAdmin(prisma: PrismaClient): Promise<void> {
  const password = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: DEFAULT_ADMIN_EMAIL },
    update: {
      password,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      userNo: DEFAULT_ADMIN_USER_NO,
      email: DEFAULT_ADMIN_EMAIL,
      password,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
}

async function seedBaseCustomers(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const passwordHash = await bcrypt.hash(DEFAULT_BASE_CUSTOMER_PASSWORD, 10);

  await prisma.customerMain.upsert({
    where: { email: DEFAULT_BASE_CUSTOMER_EMAIL },
    update: {
      customerNo: DEFAULT_BASE_CUSTOMER_NO,
      firstName: DEFAULT_BASE_CUSTOMER_FIRST_NAME,
      lastName: DEFAULT_BASE_CUSTOMER_LAST_NAME,
      passwordHash,
      passwordUpdatedAt: now,
      customerType: 'INDIVIDUAL',
      cddStatus: 'APPROVED',
      amlRiskTier: 'LOW',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'ACTIVE',
      cddDocumentExpiresAt: null,
      finalApprovalStatus: 'NOT_REQUIRED',
      finalApprovalReason: null,
      finalApprovalReviewerId: null,
      finalApprovalReviewedAt: null,
    },
    create: {
      customerNo: DEFAULT_BASE_CUSTOMER_NO,
      email: DEFAULT_BASE_CUSTOMER_EMAIL,
      firstName: DEFAULT_BASE_CUSTOMER_FIRST_NAME,
      lastName: DEFAULT_BASE_CUSTOMER_LAST_NAME,
      passwordHash,
      passwordUpdatedAt: now,
      customerType: 'INDIVIDUAL',
      cddStatus: 'APPROVED',
      amlRiskTier: 'LOW',
      eddRequired: false,
      eddStatus: 'NOT_REQUIRED',
      complianceStatus: 'ACTIVE',
      cddDocumentExpiresAt: null,
      finalApprovalStatus: 'NOT_REQUIRED',
    },
  });
}

async function seedAssets(prisma: PrismaClient): Promise<void> {
  const keepConditions = DEFAULT_ASSETS.map((asset) => ({
    type: asset.type,
    code: asset.code,
    network: normalizeNetwork(asset.network),
  }));

  for (const asset of DEFAULT_ASSETS) {
    const normalizedNetwork = normalizeNetwork(asset.network);
    await prisma.asset.upsert({
      where: {
        type_code_network: {
          type: asset.type,
          code: asset.code,
          network: normalizedNetwork,
        },
      },
      update: {
        assetNo: asset.assetNo,
        decimals: asset.decimals,
        description: asset.description,
        status: asset.status,
      },
      create: {
        assetNo: asset.assetNo,
        type: asset.type,
        code: asset.code,
        network: normalizedNetwork,
        decimals: asset.decimals,
        description: asset.description,
        status: asset.status,
      },
    });
  }

  await prisma.asset.updateMany({
    where: {
      NOT: {
        OR: keepConditions,
      },
    },
    data: {
      status: 'INACTIVE',
    },
  });
}

async function seedSystemWallets(prisma: PrismaClient): Promise<void> {
  const cryptoAssets = await prisma.asset.findMany({
    where: { type: 'CRYPTO', status: 'ACTIVE' },
    select: { id: true, code: true, network: true },
    orderBy: [{ code: 'asc' }, { network: 'asc' }],
  });

  for (const asset of cryptoAssets) {
    for (const kind of CRYPTO_SYSTEM_WALLET_KINDS) {
      const config = CRYPTO_SYSTEM_WALLET_KIND_CONFIG[kind];
      const walletNo = buildCryptoSystemWalletNo(
        kind,
        asset.code,
        asset.network,
      );
      const address = buildSystemWalletAddress(kind, asset.code, asset.network);

      await (prisma as any).wallet.upsert({
        where: { walletNo },
        update: {
          ownerType: config.ownerType,
          ownerId: null,
          ownerNo: config.ownerNo,
          type: 'CRYPTO_ADDRESS',
          direction: 'BIDIRECTIONAL',
          walletRole: config.walletRole,
          assetId: asset.id,
          address,
          status: 'ACTIVE',
        },
        create: {
          walletNo,
          ownerType: config.ownerType,
          ownerId: null,
          ownerNo: config.ownerNo,
          type: 'CRYPTO_ADDRESS',
          direction: 'BIDIRECTIONAL',
          walletRole: config.walletRole,
          assetId: asset.id,
          address,
          status: 'ACTIVE',
          balance: 0,
          lockedBalance: 0,
        },
      });
    }
  }

  const fiatAssets = await prisma.asset.findMany({
    where: { type: 'FIAT', status: 'ACTIVE' },
    select: { id: true, code: true },
    orderBy: [{ code: 'asc' }],
  });

  for (const asset of fiatAssets) {
    for (const kind of FIAT_POOL_WALLET_KINDS) {
      const config = FIAT_POOL_WALLET_KIND_CONFIG[kind];
      const walletNo = buildFiatPoolWalletNo(kind, asset.code);
      const iban = buildSystemPoolIban(kind, asset.code);

      await (prisma as any).wallet.upsert({
        where: { walletNo },
        update: {
          ownerType: config.ownerType,
          ownerId: null,
          ownerNo: config.ownerNo,
          type: 'FIAT_BANK',
          direction: 'BIDIRECTIONAL',
          walletRole: config.walletRole,
          assetId: asset.id,
          iban,
          bankName: 'FiatX Internal Bank',
          accountName:
            kind === 'CUST_BANK'
              ? 'Customer Asset Pool'
              : 'Platform Liquidity Pool',
          status: 'ACTIVE',
        },
        create: {
          walletNo,
          ownerType: config.ownerType,
          ownerId: null,
          ownerNo: config.ownerNo,
          type: 'FIAT_BANK',
          direction: 'BIDIRECTIONAL',
          walletRole: config.walletRole,
          assetId: asset.id,
          iban,
          bankName: 'FiatX Internal Bank',
          accountName:
            kind === 'CUST_BANK'
              ? 'Customer Asset Pool'
              : 'Platform Liquidity Pool',
          status: 'ACTIVE',
          balance: 0,
          lockedBalance: 0,
        },
      });
    }
  }
}

async function seedAssetValuationRates(prisma: PrismaClient): Promise<void> {
  const cryptoAssets = await prisma.asset.findMany({
    where: { type: 'CRYPTO', status: 'ACTIVE' },
    select: { id: true, code: true },
  });

  for (const asset of cryptoAssets) {
    const price =
      DEFAULT_CRYPTO_AED_VALUATION_BY_CODE[asset.code] ??
      DEFAULT_CRYPTO_AED_VALUATION_BY_CODE.USDT;

    await (prisma as any).assetValuationRate.upsert({
      where: {
        assetId_quoteAssetCode: {
          assetId: asset.id,
          quoteAssetCode: 'AED',
        },
      },
      update: {
        price,
        status: 'ACTIVE',
      },
      create: {
        assetId: asset.id,
        quoteAssetCode: 'AED',
        price,
        status: 'ACTIVE',
      },
    });
  }
}

async function seedLiquidityOpeningBalances(
  prisma: PrismaClient,
): Promise<void> {
  const platformLiqWallets = await (prisma as any).wallet.findMany({
    where: {
      ownerType: 'PLATFORM',
      ownerId: null,
      status: 'ACTIVE',
      walletRole: 'LIQ',
    },
    include: {
      asset: {
        select: {
          id: true,
          type: true,
          code: true,
          decimals: true,
        },
      },
    },
  });

  if (!platformLiqWallets.length) {
    return;
  }

  const assetIds = Array.from(
    new Set(
      platformLiqWallets
        .map((wallet: any) => wallet.assetId)
        .filter(
          (assetId: unknown): assetId is string => typeof assetId === 'string',
        ),
    ),
  );
  const valuationRates = await (prisma as any).assetValuationRate.findMany({
    where: {
      assetId: { in: assetIds },
      quoteAssetCode: 'AED',
      status: 'ACTIVE',
    },
    select: {
      assetId: true,
      price: true,
    },
  });
  const valuationByAssetId = new Map<string, Prisma.Decimal>(
    valuationRates.map((item: { assetId: string; price: Prisma.Decimal }) => [
      item.assetId,
      new Prisma.Decimal(item.price),
    ]),
  );

  for (const wallet of platformLiqWallets) {
    if (wallet.asset?.type !== 'CRYPTO') continue;
    const valuation = valuationByAssetId.get(wallet.assetId);
    if (!valuation || valuation.lte(0)) continue;

    const decimals = Number(wallet.asset.decimals ?? 8);
    const openingAmount = PLATFORM_LIQUIDITY_OPENING_AED.div(
      valuation,
    ).toDecimalPlaces(
      Number.isFinite(decimals) ? decimals : 8,
      Prisma.Decimal.ROUND_DOWN,
    );

    const existingSnapshot = await (
      prisma as any
    ).walletBalanceSnapshot.findUnique({
      where: {
        walletId_assetId: {
          walletId: wallet.id,
          assetId: wallet.assetId,
        },
      },
      select: { id: true },
    });
    if (existingSnapshot) continue;

    await (prisma as any).wallet.update({
      where: { id: wallet.id },
      data: {
        balance: openingAmount,
        lockedBalance: new Prisma.Decimal(0),
      },
    });

    await (prisma as any).walletBalanceSnapshot.create({
      data: {
        walletId: wallet.id,
        assetId: wallet.assetId,
        availableBalance: openingAmount,
        restrictedBalance: new Prisma.Decimal(0),
        inTransitBalance: new Prisma.Decimal(0),
        totalBalance: openingAmount,
      },
    });
  }
}

async function seedCoa(prisma: PrismaClient): Promise<void> {
  for (const item of DEFAULT_COA) {
    await prisma.coa.upsert({
      where: { code: item.code },
      update: {
        type: item.type,
        name: item.name,
        status: item.status,
      },
      create: {
        code: item.code,
        type: item.type,
        name: item.name,
        status: item.status,
        requiredTags: '[]',
      },
    });
  }
}

async function seedAcctEvents(prisma: PrismaClient): Promise<void> {
  for (const event of DEFAULT_ACCT_EVENTS) {
    await prisma.acctEvent.upsert({
      where: { eventCode: event.eventCode },
      update: event,
      create: event,
    });
  }

  await cleanupDeprecatedDepositRejectedEvents(prisma);
}

async function cleanupDeprecatedDepositRejectedEvents(
  prisma: PrismaClient,
): Promise<void> {
  try {
    await prisma.journalHeaderTemplate.deleteMany({
      where: {
        eventCode: { in: [...DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES] },
      },
    });
  } catch {
    await prisma.journalHeaderTemplate.updateMany({
      where: {
        eventCode: { in: [...DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES] },
      },
      data: { status: 'INACTIVE' },
    });
  }

  try {
    await prisma.acctEvent.deleteMany({
      where: {
        eventCode: { in: [...DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES] },
      },
    });
  } catch {
    await prisma.acctEvent.updateMany({
      where: {
        eventCode: { in: [...DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES] },
      },
      data: { isActive: false },
    });
  }
}

async function seedJournalTemplates(prisma: PrismaClient): Promise<void> {
  const baseAsset =
    (await prisma.asset.findFirst({
      where: { code: 'AED' },
      orderBy: { createdAt: 'asc' },
    })) ?? (await prisma.asset.findFirst({ orderBy: { createdAt: 'asc' } }));

  if (!baseAsset) {
    throw new Error('No base asset found when seeding journal templates.');
  }

  for (const template of DEFAULT_JOURNAL_TEMPLATES) {
    const header = await prisma.journalHeaderTemplate.upsert({
      where: { templateCode: template.header.templateCode },
      update: {
        ...template.header,
        baseAssetId: baseAsset.id,
      },
      create: {
        ...template.header,
        baseAssetId: baseAsset.id,
      },
    });

    await prisma.journalLineTemplate.deleteMany({
      where: { templateId: header.id },
    });

    for (const line of template.lines) {
      const coa = await prisma.coa.findUnique({
        where: { code: line.accountCode },
        select: { code: true },
      });
      if (!coa) {
        throw new Error(
          `COA ${line.accountCode} is missing while seeding template ${template.header.templateCode}.`,
        );
      }

      await prisma.journalLineTemplate.create({
        data: {
          templateId: header.id,
          lineNo: line.lineNo,
          accountCode: line.accountCode,
          drCr: line.drCr,
          amountSource: line.amountSource,
          assetSource: line.assetSource,
          ownerTypeSource: line.ownerTypeSource ?? null,
          ownerIdSource: line.ownerIdSource ?? null,
          fxRateSource: readOptionalString(line, 'fxRateSource'),
          referenceSource: readOptionalString(line, 'referenceSource'),
          dimensionsRule: line.dimensionsRule ?? '{}',
          conditionExpr: readOptionalString(line, 'conditionExpr'),
          description: line.description ?? null,
        },
      });
    }
  }
}

async function seedClearingTemplates(prisma: PrismaClient): Promise<void> {
  for (const template of DEFAULT_CLEARING_TEMPLATES) {
    const header = await prisma.clearingTemplate.upsert({
      where: { code: template.code },
      update: {
        clearingType: template.clearingType,
        sourceType: template.sourceType,
        isEnabled: template.isEnabled,
        description: template.description,
        feeMethod: template.feeMethod,
        outAssetSource: template.outAssetSource,
        outAmountSource: template.outAmountSource,
        inAssetSource: template.inAssetSource,
        inAmountSource: template.inAmountSource,
        feeAssetSource: template.feeAssetSource,
        feeAmountSource: template.feeAmountSource,
      },
      create: {
        code: template.code,
        clearingType: template.clearingType,
        sourceType: template.sourceType,
        isEnabled: template.isEnabled,
        description: template.description,
        feeMethod: template.feeMethod,
        outAssetSource: template.outAssetSource,
        outAmountSource: template.outAmountSource,
        inAssetSource: template.inAssetSource,
        inAmountSource: template.inAmountSource,
        feeAssetSource: template.feeAssetSource,
        feeAmountSource: template.feeAmountSource,
      },
    });

    await prisma.clearingLineTemplate.deleteMany({
      where: { clearingTemplateId: header.id },
    });

    for (const line of template.lineTemplates) {
      await prisma.clearingLineTemplate.create({
        data: {
          clearingTemplateId: header.id,
          lineNo: line.lineNo,
          lineType: line.lineType,
          partyType: line.partyType,
          partyIdSource: line.partyIdSource ?? null,
          assetSource: line.assetSource,
          amountSource: line.amountSource,
          isEnabled: true,
        },
      });
    }
  }
}

async function isBaseComplete(prisma: PrismaClient): Promise<boolean> {
  const adminExists =
    (await prisma.user.count({ where: { email: DEFAULT_ADMIN_EMAIL } })) > 0;
  if (!adminExists) {
    return false;
  }

  const baseCustomerExists =
    (await prisma.customerMain.count({
      where: {
        email: DEFAULT_BASE_CUSTOMER_EMAIL,
        passwordHash: { not: null },
        cddStatus: 'APPROVED',
        complianceStatus: 'ACTIVE',
      },
    })) > 0;
  if (!baseCustomerExists) {
    return false;
  }

  const existingAssets = await prisma.asset.findMany({
    select: { id: true, type: true, code: true, network: true, status: true },
  });
  const activeAssets = existingAssets.filter(
    (asset) => asset.status === 'ACTIVE',
  );
  const assetKeys = new Set(
    activeAssets.map(
      (asset) =>
        `${asset.type}:${asset.code}:${normalizeNetwork(asset.network)}`,
    ),
  );
  const allAssetsExist = DEFAULT_ASSETS.every((asset) =>
    assetKeys.has(
      `${asset.type}:${asset.code}:${normalizeNetwork(asset.network)}`,
    ),
  );
  if (!allAssetsExist) {
    return false;
  }

  if (activeAssets.length !== DEFAULT_ASSETS.length) {
    return false;
  }

  const cryptoAssets = activeAssets.filter((asset) => asset.type === 'CRYPTO');
  const fiatAssets = activeAssets.filter((asset) => asset.type === 'FIAT');
  const expectedWallets = new Map<
    string,
    { assetId: string; ownerType: 'CUSTOMER' | 'PLATFORM'; walletRole: string }
  >();
  for (const asset of cryptoAssets) {
    for (const kind of CRYPTO_SYSTEM_WALLET_KINDS) {
      const walletNo = buildCryptoSystemWalletNo(
        kind,
        asset.code,
        asset.network,
      );
      expectedWallets.set(walletNo, {
        assetId: asset.id,
        ownerType: CRYPTO_SYSTEM_WALLET_KIND_CONFIG[kind].ownerType,
        walletRole: CRYPTO_SYSTEM_WALLET_KIND_CONFIG[kind].walletRole,
      });
    }
  }
  for (const asset of fiatAssets) {
    for (const kind of FIAT_POOL_WALLET_KINDS) {
      const walletNo = buildFiatPoolWalletNo(kind, asset.code);
      expectedWallets.set(walletNo, {
        assetId: asset.id,
        ownerType: FIAT_POOL_WALLET_KIND_CONFIG[kind].ownerType,
        walletRole: FIAT_POOL_WALLET_KIND_CONFIG[kind].walletRole,
      });
    }
  }

  const expectedWalletNos = Array.from(expectedWallets.keys());
  if (expectedWalletNos.length > 0) {
    const existingWallets = await (prisma as any).wallet.findMany({
      where: {
        walletNo: { in: expectedWalletNos },
      },
      select: {
        id: true,
        walletNo: true,
        assetId: true,
        ownerType: true,
        ownerId: true,
        status: true,
        walletRole: true,
      },
    });

    if (existingWallets.length < expectedWalletNos.length) {
      return false;
    }

    for (const wallet of existingWallets) {
      const expected = expectedWallets.get(wallet.walletNo);
      if (!expected) {
        return false;
      }
      if (
        wallet.assetId !== expected.assetId ||
        wallet.ownerType !== expected.ownerType ||
        wallet.walletRole !== expected.walletRole ||
        wallet.ownerId !== null ||
        wallet.status !== 'ACTIVE'
      ) {
        return false;
      }
    }
  }

  const coaCount = await prisma.coa.count({
    where: { code: { in: DEFAULT_COA.map((item) => item.code) } },
  });
  if (coaCount < DEFAULT_COA.length) {
    return false;
  }

  const eventCount = await prisma.acctEvent.count({
    where: {
      eventCode: { in: DEFAULT_ACCT_EVENTS.map((item) => item.eventCode) },
    },
  });
  if (eventCount < DEFAULT_ACCT_EVENTS.length) {
    return false;
  }

  const journalTemplateCount = await prisma.journalHeaderTemplate.count({
    where: {
      templateCode: {
        in: DEFAULT_JOURNAL_TEMPLATES.map((item) => item.header.templateCode),
      },
    },
  });
  if (journalTemplateCount < DEFAULT_JOURNAL_TEMPLATES.length) {
    return false;
  }

  const clearingTemplateCount = await prisma.clearingTemplate.count({
    where: {
      code: { in: DEFAULT_CLEARING_TEMPLATES.map((item) => item.code) },
    },
  });
  if (clearingTemplateCount < DEFAULT_CLEARING_TEMPLATES.length) {
    return false;
  }

  if (cryptoAssets.length > 0) {
    const valuationCount = await (prisma as any).assetValuationRate.count({
      where: {
        assetId: { in: cryptoAssets.map((asset) => asset.id) },
        quoteAssetCode: 'AED',
        status: 'ACTIVE',
      },
    });
    if (valuationCount < cryptoAssets.length) {
      return false;
    }
  }

  const platformLiqWalletIds = (
    await (prisma as any).wallet.findMany({
      where: {
        ownerType: 'PLATFORM',
        ownerId: null,
        status: 'ACTIVE',
        walletRole: 'LIQ',
      },
      select: { id: true },
    })
  ).map((wallet: { id: string }) => wallet.id);

  if (platformLiqWalletIds.length > 0) {
    const openingSnapshotCount = await (
      prisma as any
    ).walletBalanceSnapshot.count({
      where: {
        walletId: { in: platformLiqWalletIds },
      },
    });
    if (openingSnapshotCount < platformLiqWalletIds.length) {
      return false;
    }
  }

  return true;
}

function normalizeNetwork(network: string | null | undefined): string {
  return network ?? '';
}

function normalizeSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function buildCryptoSystemWalletNo(
  kind: CryptoSystemWalletKind,
  assetCode: string,
  network: string | null | undefined,
): string {
  const role = CRYPTO_SYSTEM_WALLET_KIND_CONFIG[kind].walletRole;
  return buildDeterministicWalletNo(
    role,
    normalizeSegment(assetCode),
    normalizeSegment(network || 'NA'),
  );
}

function buildSystemWalletAddress(
  kind: CryptoSystemWalletKind,
  assetCode: string,
  network: string | null | undefined,
): string {
  const normalizedNetwork = normalizeSegment(network || 'NA');
  const normalizedCode = normalizeSegment(assetCode);
  const hash = createHash('sha256')
    .update(`${kind}|${normalizedCode}|${normalizedNetwork}`)
    .digest('hex');

  if (normalizedNetwork === 'BITCOIN') {
    return `bc1q${hash.slice(0, 38)}`;
  }

  if (normalizedNetwork === 'TRON') {
    return `T${hash.slice(0, 33)}`;
  }

  if (normalizedNetwork === 'ETHEREUM') {
    return `0x${hash.slice(0, 40)}`;
  }

  return `sys_${kind.toLowerCase()}_${normalizedCode.toLowerCase()}_${normalizedNetwork.toLowerCase()}_${hash.slice(0, 12)}`;
}

function buildFiatPoolWalletNo(
  kind: FiatPoolWalletKind,
  assetCode: string,
): string {
  const role = FIAT_POOL_WALLET_KIND_CONFIG[kind].walletRole;
  return buildDeterministicWalletNo(role, normalizeSegment(assetCode), 'NA');
}

function buildSystemPoolIban(
  kind: FiatPoolWalletKind,
  assetCode: string,
): string {
  const hash = createHash('sha256')
    .update(`${kind}|${normalizeSegment(assetCode)}`)
    .digest('hex')
    .toUpperCase();
  return `AE00FIATX${hash.slice(0, 16)}`;
}

function readOptionalString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null || !(key in source)) {
    return null;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
