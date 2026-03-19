import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ASSETS } from '../src/config/manifests/assets.manifest';
import { DEFAULT_COA } from '../src/config/manifests/coa.manifest';
import { DEFAULT_ACCT_EVENTS } from '../src/config/manifests/events.manifest';
import { DEFAULT_JOURNAL_TEMPLATES } from '../src/config/manifests/journal-templates.manifest';
import { DEFAULT_CLEARING_TEMPLATES } from '../src/config/manifests/clearing-templates.manifest';
import { buildDeterministicWalletNo } from '../src/common/utils/no-generator.util';
import {
  ACTIVE_RBAC_ROLE_CODES,
  LEGACY_RBAC_ROLE_CODES,
  LEGACY_RBAC_ROLE_CODE_MAPPING,
  RBAC_PERMISSION_DEFINITIONS,
  RBAC_ROLE_DEFINITIONS,
  buildRolePermissionCodeMap,
  getPrimaryRoleCode,
} from '../src/modules/identity/access-control/rbac.catalog';
import {
  ApprovalSoDRuleCodes,
  DEFAULT_APPROVAL_POLICIES,
  joinRoleCsv,
} from '../src/modules/governance/approvals/constants/approval.constants';

const DEFAULT_ADMIN_EMAIL = 'admin@fiatx.com';
const DEFAULT_ADMIN_USER_NO = 'ADMIN-001';
const DEFAULT_ADMIN_PASSWORD = '123456';
const DEFAULT_ROLE_ADMIN_PASSWORD = '123456';
const DEFAULT_BASE_CUSTOMER_EMAIL = 'shawn@fiatx.com';
const DEFAULT_BASE_CUSTOMER_NO = 'CUST-BASE-SHAWN';
const DEFAULT_BASE_CUSTOMER_PASSWORD = '123456';
const DEFAULT_BASE_CUSTOMER_FIRST_NAME = 'Shawn';
const DEFAULT_BASE_CUSTOMER_LAST_NAME = 'FiatX';

type RoleSeedAccount = {
  roleCode: string;
  email: string;
  userNo: string;
};

const ROLE_SEED_ACCOUNTS: RoleSeedAccount[] = [
  { roleCode: 'SUPER_ADMIN', email: 'admin@fiatx.com', userNo: 'ADMIN-001' },
  { roleCode: 'RI', email: 'ri@fiatx.com', userNo: 'ADMIN-RI' },
  { roleCode: 'SM', email: 'sm@fiatx.com', userNo: 'ADMIN-SM' },
  { roleCode: 'TECH_ADMIN', email: 'tech_admin@fiatx.com', userNo: 'ADMIN-TECH' },
  {
    roleCode: 'OPS_TREASURY',
    email: 'ops_treasury@fiatx.com',
    userNo: 'ADMIN-OPS-TR',
  },
  { roleCode: 'FINANCE', email: 'finance@fiatx.com', userNo: 'ADMIN-FIN' },
  {
    roleCode: 'COMPLIANCE_LEAD',
    email: 'compliance_lead@fiatx.com',
    userNo: 'ADMIN-COM-LEAD',
  },
  { roleCode: 'MLRO', email: 'mlro@fiatx.com', userNo: 'ADMIN-MLRO' },
  { roleCode: 'DPO', email: 'dpo@fiatx.com', userNo: 'ADMIN-DPO' },
  { roleCode: 'CISO', email: 'ciso@fiatx.com', userNo: 'ADMIN-CISO' },
];

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
const PLATFORM_LIQ_BANK_AED_OPENING = new Prisma.Decimal('1000000');
const PLATFORM_LIQ_BANK_AED_WALLET_NO = 'WA-LBK-AED-NA';

const DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES = [
  'EVT_DEPOSIT_REJECTED__CRYPTO',
  'EVT_DEPOSIT_REJECTED__FIAT',
] as const;

const LEGACY_INTERNAL_TX_EVENT_CODES = [
  'EVT_INTERNAL_TX_CREATED',
  'EVT_INTERNAL_TX_SUCCESS',
  'EVT_INTERNAL_TX_FAILED',
  'EVT_INTERNAL_TX_CANCELLED',
  'EVT_INTERNAL_TX_REJECTED',
] as const;

const LEGACY_INTERNAL_TX_TEMPLATE_CODES = [
  'TPL_EVT_INTERNAL_TX_CREATED_V1',
  'TPL_EVT_INTERNAL_TX_SUCCESS_V1',
] as const;

const LEGACY_WITHDRAW_FAILED_EVENT_CODES = [
  'EVT_WITHDRAWAL_FAILED__CRYPTO',
  'EVT_WITHDRAWAL_FAILED__FIAT',
] as const;

export async function seedBase(prisma: PrismaClient): Promise<void> {
  console.log('--- Seeding Base Configuration ---');
  await seedAdmin(prisma);
  await seedRbac(prisma);
  await seedGovernanceApprovalBaseline(prisma);
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
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
    create: {
      userNo: DEFAULT_ADMIN_USER_NO,
      email: DEFAULT_ADMIN_EMAIL,
      password,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });
}

async function deactivateLegacyRoles(prisma: PrismaClient): Promise<void> {
  if (!LEGACY_RBAC_ROLE_CODES.length) {
    return;
  }

  await (prisma as any).role.updateMany({
    where: {
      code: { in: LEGACY_RBAC_ROLE_CODES },
    },
    data: {
      status: 'INACTIVE',
    },
  });
}

async function migrateLegacyUserRoles(
  prisma: PrismaClient,
  roleIdByCode: Map<string, string>,
): Promise<void> {
  const userRoles = await (prisma as any).userRole.findMany({
    include: {
      role: {
        select: {
          code: true,
          status: true,
        },
      },
    },
    orderBy: [{ userId: 'asc' }, { role: { code: 'asc' } }],
  });

  const desiredCodesByUserId = new Map<string, string[]>();
  for (const userRole of userRoles) {
    const roleCode = String(userRole.role?.code || '').trim().toUpperCase();
    if (!roleCode) {
      continue;
    }

    const mappedRoleCode =
      LEGACY_RBAC_ROLE_CODE_MAPPING[roleCode] ||
      (ACTIVE_RBAC_ROLE_CODES.includes(roleCode) ? roleCode : null);
    if (!mappedRoleCode) {
      continue;
    }

    const current = desiredCodesByUserId.get(userRole.userId) || [];
    if (!current.includes(mappedRoleCode)) {
      current.push(mappedRoleCode);
      desiredCodesByUserId.set(userRole.userId, current);
    }
  }

  for (const [userId, desiredRoleCodes] of desiredCodesByUserId.entries()) {
    const filteredRoleCodes = desiredRoleCodes.filter((code) => roleIdByCode.has(code));
    if (!filteredRoleCodes.length) {
      continue;
    }

    const roleIds = filteredRoleCodes
      .map((code) => roleIdByCode.get(code))
      .filter(Boolean) as string[];
    const primaryRoleCode = getPrimaryRoleCode(filteredRoleCodes) || filteredRoleCodes[0];

    await (prisma as any).$transaction(async (tx: any) => {
      await tx.userRole.deleteMany({
        where: { userId },
      });

      await tx.userRole.createMany({
        data: roleIds.map((roleId) => ({
          userId,
          roleId,
        })),
      });

      await tx.user.update({
        where: { id: userId },
        data: { role: primaryRoleCode },
      });
    });
  }
}

async function seedRbac(prisma: PrismaClient): Promise<void> {
  const rolePermissionCodeMap = buildRolePermissionCodeMap();

  for (const role of RBAC_ROLE_DEFINITIONS) {
    await (prisma as any).role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        status: 'ACTIVE',
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        status: 'ACTIVE',
      },
    });
  }

  for (const permission of RBAC_PERMISSION_DEFINITIONS) {
    await (prisma as any).permission.upsert({
      where: { code: permission.code },
      update: {
        name: permission.name,
        description: permission.description,
        method: permission.method,
        path: permission.path,
      },
      create: {
        code: permission.code,
        name: permission.name,
        description: permission.description,
        method: permission.method,
        path: permission.path,
      },
    });
  }

  const [roles, permissions] = await Promise.all([
    (prisma as any).role.findMany({
      where: {
        code: { in: RBAC_ROLE_DEFINITIONS.map((item) => item.code) },
      },
      select: { id: true, code: true },
    }),
    (prisma as any).permission.findMany({
      where: {
        code: { in: RBAC_PERMISSION_DEFINITIONS.map((item) => item.code) },
      },
      select: { id: true, code: true },
    }),
  ]);

  const roleIdByCode = new Map<string, string>();
  const permissionIdByCode = new Map<string, string>();
  roles.forEach((item: any) => roleIdByCode.set(item.code, item.id));
  permissions.forEach((item: any) => permissionIdByCode.set(item.code, item.id));

  const desiredPairs: Array<{ roleId: string; permissionId: string }> = [];
  for (const role of RBAC_ROLE_DEFINITIONS) {
    const roleId = roleIdByCode.get(role.code);
    if (!roleId) continue;

    for (const permissionCode of rolePermissionCodeMap[role.code] || []) {
      const permissionId = permissionIdByCode.get(permissionCode);
      if (!permissionId) continue;
      desiredPairs.push({ roleId, permissionId });
    }
  }

  for (const pair of desiredPairs) {
    await (prisma as any).rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: pair.roleId,
          permissionId: pair.permissionId,
        },
      },
      update: {},
      create: pair,
    });
  }

  const desiredPairKey = new Set(
    desiredPairs.map((item) => `${item.roleId}:${item.permissionId}`),
  );

  const existingPairs = await (prisma as any).rolePermission.findMany({
    where: {
      roleId: { in: roles.map((item: any) => item.id) },
    },
    select: { id: true, roleId: true, permissionId: true },
  });

  const stalePairIds = existingPairs
    .filter((item: any) => !desiredPairKey.has(`${item.roleId}:${item.permissionId}`))
    .map((item: any) => item.id);

  if (stalePairIds.length > 0) {
    await (prisma as any).rolePermission.deleteMany({
      where: { id: { in: stalePairIds } },
    });
  }

  await migrateLegacyUserRoles(prisma, roleIdByCode);
  await deactivateLegacyRoles(prisma);
  await seedRoleAdminAccounts(prisma, roleIdByCode);
}

async function seedGovernanceApprovalBaseline(prisma: PrismaClient): Promise<void> {
  for (const [actionType, policy] of Object.entries(DEFAULT_APPROVAL_POLICIES)) {
    await prisma.approvalActionPolicy.upsert({
      where: { actionType },
      update: {
        riskLevel: policy.riskLevel,
        checkerRoles: joinRoleCsv(policy.checkerRoles),
        timeoutHours: policy.timeoutHours,
        allowCancel: policy.allowCancel,
        allowRetry: policy.allowRetry,
      },
      create: {
        actionType,
        riskLevel: policy.riskLevel,
        checkerRoles: joinRoleCsv(policy.checkerRoles),
        timeoutHours: policy.timeoutHours,
        allowCancel: policy.allowCancel,
        allowRetry: policy.allowRetry,
      },
    });
  }

  await prisma.approvalSodRule.upsert({
    where: { ruleCode: ApprovalSoDRuleCodes.DENY_SAME_USER_MAKER_CHECKER },
    update: {
      enabled: true,
      description: 'Maker and checker must be different users unless SUPER_ADMIN bypass applies.',
    },
    create: {
      ruleCode: ApprovalSoDRuleCodes.DENY_SAME_USER_MAKER_CHECKER,
      enabled: true,
      description: 'Maker and checker must be different users unless SUPER_ADMIN bypass applies.',
    },
  });
}

async function seedRoleAdminAccounts(
  prisma: PrismaClient,
  roleIdByCode: Map<string, string>,
): Promise<void> {
  const password = await bcrypt.hash(DEFAULT_ROLE_ADMIN_PASSWORD, 10);

  for (const account of ROLE_SEED_ACCOUNTS) {
    const roleId = roleIdByCode.get(account.roleCode);
    if (!roleId) {
      throw new Error(`Role not found for seed account: ${account.roleCode}`);
    }

    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        userNo: account.userNo,
        password,
        role: account.roleCode,
        status: 'ACTIVE',
      },
      create: {
        userNo: account.userNo,
        email: account.email,
        password,
        role: account.roleCode,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    await (prisma as any).userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId,
      },
    });

    await (prisma as any).userRole.deleteMany({
      where: {
        userId: user.id,
        roleId: { not: roleId },
      },
    });
  }

}

async function areRoleSeedAccountsComplete(prisma: PrismaClient): Promise<boolean> {
  const users = await prisma.user.findMany({
    where: {
      email: {
        in: ROLE_SEED_ACCOUNTS.map((item) => item.email),
      },
    },
    select: {
      id: true,
      userNo: true,
      email: true,
      role: true,
      status: true,
      userRoles: {
        include: {
          role: {
            select: {
              code: true,
            },
          },
        },
      },
    },
  });

  if (users.length !== ROLE_SEED_ACCOUNTS.length) {
    return false;
  }

  const userByEmail = new Map(users.map((item) => [item.email, item]));

  for (const expected of ROLE_SEED_ACCOUNTS) {
    const user = userByEmail.get(expected.email);
    if (!user) {
      return false;
    }

    if (user.userNo !== expected.userNo) {
      return false;
    }

    if (user.status !== 'ACTIVE') {
      return false;
    }

    if (user.role !== expected.roleCode) {
      return false;
    }

    const boundRoleCodes = user.userRoles.map((item) => item.role.code).sort();
    if (boundRoleCodes.length !== 1 || boundRoleCodes[0] !== expected.roleCode) {
      return false;
    }
  }

  return true;
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
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
      amlRiskTier: 'LOW',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    create: {
      customerNo: DEFAULT_BASE_CUSTOMER_NO,
      email: DEFAULT_BASE_CUSTOMER_EMAIL,
      firstName: DEFAULT_BASE_CUSTOMER_FIRST_NAME,
      lastName: DEFAULT_BASE_CUSTOMER_LAST_NAME,
      passwordHash,
      passwordUpdatedAt: now,
      customerType: 'INDIVIDUAL',
      onboardingStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      restrictionStatus: 'CLEAR',
      amlRiskTier: 'LOW',
      eddRequired: false,
      cddDocumentExpiresAt: null,
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

  const fiatLiqBankWallet = await (prisma as any).wallet.findFirst({
    where: {
      walletNo: PLATFORM_LIQ_BANK_AED_WALLET_NO,
      ownerType: 'PLATFORM',
      ownerId: null,
      status: 'ACTIVE',
      walletRole: 'LIQ_BANK',
    },
    include: {
      asset: {
        select: {
          id: true,
          type: true,
          code: true,
        },
      },
    },
  });

  if (
    !fiatLiqBankWallet ||
    fiatLiqBankWallet.asset?.type !== 'FIAT' ||
    fiatLiqBankWallet.asset?.code !== 'AED'
  ) {
    return;
  }

  const existingFiatSnapshot = await (
    prisma as any
  ).walletBalanceSnapshot.findUnique({
    where: {
      walletId_assetId: {
        walletId: fiatLiqBankWallet.id,
        assetId: fiatLiqBankWallet.assetId,
      },
    },
    select: { id: true },
  });
  if (existingFiatSnapshot) return;

  await (prisma as any).wallet.update({
    where: { id: fiatLiqBankWallet.id },
    data: {
      balance: PLATFORM_LIQ_BANK_AED_OPENING,
      lockedBalance: new Prisma.Decimal(0),
    },
  });

  await (prisma as any).walletBalanceSnapshot.create({
    data: {
      walletId: fiatLiqBankWallet.id,
      assetId: fiatLiqBankWallet.assetId,
      availableBalance: PLATFORM_LIQ_BANK_AED_OPENING,
      restrictedBalance: new Prisma.Decimal(0),
      inTransitBalance: new Prisma.Decimal(0),
      totalBalance: PLATFORM_LIQ_BANK_AED_OPENING,
    },
  });
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
  await cleanupLegacyInternalTxAndWithdrawFailedContracts(prisma);
  await cleanupInactiveNonDefaultAccountingContracts(prisma);
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

async function cleanupLegacyInternalTxAndWithdrawFailedContracts(
  prisma: PrismaClient,
): Promise<void> {
  try {
    await prisma.journalHeaderTemplate.deleteMany({
      where: {
        OR: [
          {
            templateCode: {
              in: [...LEGACY_INTERNAL_TX_TEMPLATE_CODES],
            },
          },
          {
            eventCode: {
              in: [...LEGACY_INTERNAL_TX_EVENT_CODES],
            },
          },
        ],
      },
    });
  } catch {
    await prisma.journalHeaderTemplate.updateMany({
      where: {
        OR: [
          {
            templateCode: {
              in: [...LEGACY_INTERNAL_TX_TEMPLATE_CODES],
            },
          },
          {
            eventCode: {
              in: [...LEGACY_INTERNAL_TX_EVENT_CODES],
            },
          },
        ],
      },
      data: { status: 'INACTIVE' },
    });
  }

  try {
    await prisma.acctEvent.deleteMany({
      where: {
        eventCode: {
          in: [
            ...LEGACY_INTERNAL_TX_EVENT_CODES,
            ...LEGACY_WITHDRAW_FAILED_EVENT_CODES,
          ],
        },
      },
    });
  } catch {
    await prisma.acctEvent.updateMany({
      where: {
        eventCode: {
          in: [
            ...LEGACY_INTERNAL_TX_EVENT_CODES,
            ...LEGACY_WITHDRAW_FAILED_EVENT_CODES,
          ],
        },
      },
      data: { isActive: false },
    });
  }
}

async function cleanupInactiveNonDefaultAccountingContracts(
  prisma: PrismaClient,
): Promise<void> {
  const defaultEventCodes = DEFAULT_ACCT_EVENTS.map((item) => item.eventCode);
  const defaultTemplateCodes = DEFAULT_JOURNAL_TEMPLATES.map(
    (item) => item.header.templateCode,
  );

  await prisma.journalHeaderTemplate.deleteMany({
    where: {
      status: 'INACTIVE',
      templateCode: { notIn: defaultTemplateCodes },
    },
  });

  await prisma.acctEvent.deleteMany({
    where: {
      isActive: false,
      eventCode: { notIn: defaultEventCodes },
    },
  });
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

  const [activeRoleCount, legacyActiveCount] = await Promise.all([
    (prisma as any).role.count({
      where: {
        status: 'ACTIVE',
        code: { in: ACTIVE_RBAC_ROLE_CODES },
      },
    }),
    LEGACY_RBAC_ROLE_CODES.length
      ? (prisma as any).role.count({
          where: {
            status: 'ACTIVE',
            code: { in: LEGACY_RBAC_ROLE_CODES },
          },
        })
      : Promise.resolve(0),
  ]);

  if (activeRoleCount !== ACTIVE_RBAC_ROLE_CODES.length || legacyActiveCount !== 0) {
    return false;
  }

  const roleSeedAccountsComplete = await areRoleSeedAccountsComplete(prisma);
  if (!roleSeedAccountsComplete) {
    return false;
  }

  const approvalPolicies = await prisma.approvalActionPolicy.findMany({
    where: {
      actionType: { in: Object.keys(DEFAULT_APPROVAL_POLICIES) },
    },
    select: {
      actionType: true,
      riskLevel: true,
      checkerRoles: true,
      timeoutHours: true,
      allowCancel: true,
      allowRetry: true,
    },
  });
  if (approvalPolicies.length !== Object.keys(DEFAULT_APPROVAL_POLICIES).length) {
    return false;
  }
  for (const [actionType, policy] of Object.entries(DEFAULT_APPROVAL_POLICIES)) {
    const existing = approvalPolicies.find((item) => item.actionType === actionType);
    if (!existing) {
      return false;
    }
    if (
      existing.riskLevel !== policy.riskLevel ||
      existing.checkerRoles !== joinRoleCsv(policy.checkerRoles) ||
      existing.timeoutHours !== policy.timeoutHours ||
      existing.allowCancel !== policy.allowCancel ||
      existing.allowRetry !== policy.allowRetry
    ) {
      return false;
    }
  }

  const baseCustomerExists =
    (await prisma.customerMain.count({
      where: {
        email: DEFAULT_BASE_CUSTOMER_EMAIL,
        passwordHash: { not: null },
        onboardingStatus: 'APPROVED',
        operatingStatus: 'ACTIVE',
        restrictionStatus: 'CLEAR',
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

  const platformLiqBankAedWallet = await (prisma as any).wallet.findFirst({
    where: {
      walletNo: PLATFORM_LIQ_BANK_AED_WALLET_NO,
      ownerType: 'PLATFORM',
      ownerId: null,
      status: 'ACTIVE',
      walletRole: 'LIQ_BANK',
    },
    include: {
      asset: {
        select: {
          type: true,
          code: true,
        },
      },
    },
  });

  if (
    platformLiqBankAedWallet &&
    platformLiqBankAedWallet.asset?.type === 'FIAT' &&
    platformLiqBankAedWallet.asset?.code === 'AED'
  ) {
    const fiatOpeningSnapshot = await (
      prisma as any
    ).walletBalanceSnapshot.findUnique({
      where: {
        walletId_assetId: {
          walletId: platformLiqBankAedWallet.id,
          assetId: platformLiqBankAedWallet.assetId,
        },
      },
      select: { id: true },
    });
    if (!fiatOpeningSnapshot) {
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
