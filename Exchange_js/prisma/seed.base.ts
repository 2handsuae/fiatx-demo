import { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ASSETS } from '../src/config/manifests/assets.manifest';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import {
  ACTIVE_RBAC_ROLE_CODES,
  RBAC_PERMISSION_DEFINITIONS,
  RBAC_ROLE_DEFINITIONS,
  buildRolePermissionCodeMap,
} from '../src/modules/identity/access-control/rbac.catalog';
import {
  ApprovalSoDRuleCodes,
  DEFAULT_APPROVAL_POLICIES,
  deriveCheckerRoles,
  joinRoleCsv,
} from '../src/modules/governance/approvals/constants/approval.constants';

const DEFAULT_ADMIN_EMAIL = 'admin@fiatx.com';
const DEFAULT_ADMIN_USER_NO = buildDeterministicNo('ADM', 'SUPER_ADMIN', DEFAULT_ADMIN_EMAIL);
const DEFAULT_ADMIN_PASSWORD = '123456';
const DEFAULT_ROLE_ADMIN_PASSWORD = '123456';
const DEFAULT_BASE_CUSTOMER_EMAIL = 'shawn@fiatx.com';
const DEFAULT_BASE_CUSTOMER_NO = buildDeterministicNo('CU', DEFAULT_BASE_CUSTOMER_EMAIL);
const DEFAULT_BASE_CUSTOMER_PASSWORD = '123456';
const DEFAULT_BASE_CUSTOMER_FIRST_NAME = 'Shawn';
const DEFAULT_BASE_CUSTOMER_LAST_NAME = 'FiatX';

type RoleSeedAccount = {
  roleCode: string;
  email: string;
  userNo: string;
};

const ROLE_SEED_ACCOUNTS: RoleSeedAccount[] = [
  { roleCode: 'SUPER_ADMIN', email: 'admin@fiatx.com' },
  { roleCode: 'SENIOR_MANAGEMENT_OFFICER', email: 'sm@fiatx.com' },
  { roleCode: 'CISO', email: 'ciso@fiatx.com' },
  { roleCode: 'MLRO', email: 'mlro@fiatx.com' },
  { roleCode: 'DPO', email: 'dpo@fiatx.com' },
  { roleCode: 'COMPLIANCE_OFFICER', email: 'compliance_lead@fiatx.com' },
  { roleCode: 'TECH_OFFICER', email: 'tech_admin@fiatx.com' },
  { roleCode: 'OPS_OFFICER', email: 'ops_officer@fiatx.com' },
].map((a) => ({
  ...a,
  userNo: buildDeterministicNo('ADM', a.roleCode, a.email),
}));

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
    walletRole: 'C_MAIN',
  },
  CUST_CRYPTO_PAYOUT: {
    ownerType: 'CUSTOMER',
    ownerNo: 'CUSTOMER_POOL',
    walletRole: 'C_OUT',
  },
  PLATFORM_CRYPTO_LIQ: {
    ownerType: 'PLATFORM',
    ownerNo: 'PLATFORM',
    walletRole: 'F_LIQ',
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
    walletRole: 'C_CMA',
  },
  LIQ_BANK: {
    ownerType: 'PLATFORM',
    ownerNo: 'PLATFORM',
    walletRole: 'F_LIQ',
  },
};

const DEFAULT_CRYPTO_AED_VALUATION_BY_CODE: Record<string, string> = {
  USDT: '3.6725',
};

export async function seedBase(prisma: PrismaClient): Promise<void> {
  console.log('--- Seeding Base Configuration ---');
  await seedAdmin(prisma);
  await seedRbac(prisma);
  await seedGovernanceApprovalBaseline(prisma);
  await seedBaseCustomers(prisma);
  await seedAssets(prisma);
  await seedSystemWallets(prisma);
  await seedWalletBalanceSnapshotBaseline(prisma);
  await seedAssetValuationRates(prisma);
  await seedTbAccountRegistry(prisma);
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
    where: { userNo: DEFAULT_ADMIN_USER_NO },
    update: {
      password,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      firstLoginStatus: 'COMPLETED',
    },
    create: {
      userNo: DEFAULT_ADMIN_USER_NO,
      email: DEFAULT_ADMIN_EMAIL,
      password,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      firstLoginStatus: 'COMPLETED',
    },
  });
}

async function deleteObsoleteRoles(prisma: PrismaClient): Promise<void> {
  await (prisma as any).role.deleteMany({
    where: { code: { notIn: ACTIVE_RBAC_ROLE_CODES } },
  });
}

async function seedRbac(prisma: PrismaClient): Promise<void> {
  const rolePermissionCodeMap = buildRolePermissionCodeMap();

  await deleteObsoleteRoles(prisma);

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

  await seedRoleAdminAccounts(prisma, roleIdByCode);
}

async function seedGovernanceApprovalBaseline(prisma: PrismaClient): Promise<void> {
  for (const [actionType, policy] of Object.entries(DEFAULT_APPROVAL_POLICIES)) {
    await prisma.approvalActionPolicy.upsert({
      where: { actionType },
      update: {
        riskLevel: policy.riskLevel,
        checkerRoles: joinRoleCsv(deriveCheckerRoles(policy.steps)),
        timeoutHours: policy.timeoutHours,
        allowCancel: policy.allowCancel,
        allowRetry: policy.allowRetry,
      },
      create: {
        actionType,
        riskLevel: policy.riskLevel,
        checkerRoles: joinRoleCsv(deriveCheckerRoles(policy.steps)),
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
      where: { userNo: account.userNo },
      update: {
        email: account.email,
        password,
        role: account.roleCode,
        status: 'ACTIVE',
        firstLoginStatus: 'COMPLETED',
      },
      create: {
        userNo: account.userNo,
        email: account.email,
        password,
        role: account.roleCode,
        status: 'ACTIVE',
        firstLoginStatus: 'COMPLETED',
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

const TEST_CUSTOMERS = [
  {
    email: DEFAULT_BASE_CUSTOMER_EMAIL,
    firstName: DEFAULT_BASE_CUSTOMER_FIRST_NAME,
    lastName: DEFAULT_BASE_CUSTOMER_LAST_NAME,
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'APPROVED',
    adminStatus: 'ACTIVE',
    complianceStatus: 'CLEAR',
    riskRating: 'LOW',
    eddRequired: false,
  },
  {
    email: 'alice@test.com',
    firstName: 'Alice',
    lastName: 'Approved-Active',
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'APPROVED',
    adminStatus: 'ACTIVE',
    complianceStatus: 'CLEAR',
    riskRating: 'MEDIUM',
    eddRequired: false,
  },
  {
    email: 'bob@test.com',
    firstName: 'Bob',
    lastName: 'Approved-Frozen',
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'APPROVED',
    adminStatus: 'ACTIVE',
    complianceStatus: 'FROZEN',
    riskRating: 'HIGH',
    eddRequired: true,
    complianceFreezeReason: 'Adverse media alert triggered',
  },
  {
    email: 'charlie@test.com',
    firstName: 'Charlie',
    lastName: 'Approved-Suspended',
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'APPROVED',
    adminStatus: 'SUSPENDED',
    complianceStatus: 'CLEAR',
    riskRating: 'LOW',
    eddRequired: false,
  },
  {
    email: 'diana@test.com',
    firstName: 'Diana',
    lastName: 'Pending-Verification',
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'PENDING_VERIFICATION',
    adminStatus: 'INACTIVE',
    complianceStatus: 'CLEAR',
    riskRating: null,
    eddRequired: false,
  },
  {
    email: 'edward@test.com',
    firstName: 'Edward',
    lastName: 'Onboarding-None',
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'NONE',
    adminStatus: 'INACTIVE',
    complianceStatus: 'CLEAR',
    riskRating: null,
    eddRequired: false,
  },
  {
    email: 'fiona@test.com',
    firstName: 'Fiona',
    lastName: 'Rejected',
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'REJECTED',
    adminStatus: 'INACTIVE',
    complianceStatus: 'CLEAR',
    riskRating: null,
    eddRequired: false,
  },
  {
    email: 'george@test.com',
    firstName: 'George',
    lastName: 'Corporate-Active',
    customerType: 'CORPORATE' as const,
    onboardingStatus: 'APPROVED',
    adminStatus: 'ACTIVE',
    complianceStatus: 'CLEAR',
    riskRating: 'LOW',
    eddRequired: false,
    companyName: 'Acme Trading LLC',
  },
  {
    email: 'helen@test.com',
    firstName: 'Helen',
    lastName: 'High-Risk-Active',
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'APPROVED',
    adminStatus: 'ACTIVE',
    complianceStatus: 'CLEAR',
    riskRating: 'HIGH',
    eddRequired: true,
  },
  {
    email: 'ivan@test.com',
    firstName: 'Ivan',
    lastName: 'Withdrawn',
    customerType: 'INDIVIDUAL' as const,
    onboardingStatus: 'WITHDRAWN',
    adminStatus: 'INACTIVE',
    complianceStatus: 'CLEAR',
    riskRating: null,
    eddRequired: false,
  },
].map((c) => ({
  ...c,
  customerNo: c.email === DEFAULT_BASE_CUSTOMER_EMAIL
    ? DEFAULT_BASE_CUSTOMER_NO
    : buildDeterministicNo('CU', c.email),
}));

async function seedBaseCustomers(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const passwordHash = await bcrypt.hash(DEFAULT_BASE_CUSTOMER_PASSWORD, 10);

  for (const c of TEST_CUSTOMERS) {
    await prisma.customerMain.upsert({
      where: { email: c.email },
      update: {
        customerNo: c.customerNo,
        firstName: c.firstName,
        lastName: c.lastName,
        passwordHash,
        passwordUpdatedAt: now,
        customerType: c.customerType,
        onboardingStatus: c.onboardingStatus,
        adminStatus: c.adminStatus,
        complianceStatus: c.complianceStatus,
        riskRating: c.riskRating ?? undefined,
        eddRequired: c.eddRequired,
        complianceFreezeReason: (c as any).complianceFreezeReason ?? null,
        complianceFreezeAt: c.complianceStatus === 'FROZEN' ? now : null,
        companyName: (c as any).companyName ?? null,
        cddDocumentExpiresAt: null,
      },
      create: {
        customerNo: c.customerNo,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        passwordHash,
        passwordUpdatedAt: now,
        customerType: c.customerType,
        onboardingStatus: c.onboardingStatus,
        adminStatus: c.adminStatus,
        complianceStatus: c.complianceStatus,
        riskRating: c.riskRating ?? undefined,
        eddRequired: c.eddRequired,
        complianceFreezeReason: (c as any).complianceFreezeReason ?? null,
        complianceFreezeAt: c.complianceStatus === 'FROZEN' ? now : null,
        companyName: (c as any).companyName ?? null,
        cddDocumentExpiresAt: null,
      },
    });
  }
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

async function seedWalletBalanceSnapshotBaseline(
  prisma: PrismaClient,
): Promise<void> {
  const canonicalPoolWallets = await (prisma as any).wallet.findMany({
    where: {
      status: 'ACTIVE',
      walletRole: {
        in: ['MASTER', 'PAYOUT', 'LIQ', 'CUST_BANK', 'LIQ_BANK'],
      },
    },
    select: {
      id: true,
      assetId: true,
    },
  });

  if (!canonicalPoolWallets.length) {
    return;
  }

  for (const wallet of canonicalPoolWallets) {
    await (prisma as any).walletBalanceSnapshot.upsert({
      where: {
        walletId_assetId: {
          walletId: wallet.id,
          assetId: wallet.assetId,
        },
      },
      update: {},
      create: {
        walletId: wallet.id,
        assetId: wallet.assetId,
        availableBalance: new Prisma.Decimal(0),
        restrictedBalance: new Prisma.Decimal(0),
        inTransitBalance: new Prisma.Decimal(0),
        totalBalance: new Prisma.Decimal(0),
      },
    });
  }
}

async function seedTbAccountRegistry(prisma: PrismaClient): Promise<void> {
  const activeAssets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, type: true, code: true },
    orderBy: [{ code: 'asc' }],
  });

  let nextLedgerId = 1;
  const maxResult = await prisma.asset.aggregate({ _max: { tbLedgerId: true } });
  if (maxResult._max.tbLedgerId) {
    nextLedgerId = maxResult._max.tbLedgerId + 1;
  }

  for (const asset of activeAssets) {
    let tbLedgerId: number;
    const existing = await prisma.asset.findUnique({
      where: { id: asset.id },
      select: { tbLedgerId: true },
    });

    if (existing?.tbLedgerId) {
      tbLedgerId = existing.tbLedgerId;
    } else {
      tbLedgerId = nextLedgerId++;
      await prisma.asset.update({
        where: { id: asset.id },
        data: { tbLedgerId, status: 'ACTIVE' },
      });
    }

    const custodyCode = asset.type === 'FIAT'
      ? TB_ACCOUNT_CODES.BANK
      : TB_ACCOUNT_CODES.CUSTODY;

    const systemAccounts = [
      { code: custodyCode, desc: asset.type === 'FIAT' ? 'BANK' : 'CUSTODY' },
      { code: TB_ACCOUNT_CODES.TRADE_CLEARING, desc: 'TRADE_CLEARING' },
      { code: TB_ACCOUNT_CODES.FEE_RECEIVABLE, desc: 'FEE_RECEIVABLE', flags: 0x04 },
    ];

    for (const acct of systemAccounts) {
      const existingAccount = await (prisma as any).tbAccountRegistry.findFirst({
        where: {
          code: acct.code,
          ledger: tbLedgerId,
          ownerType: 'SYSTEM',
          ownerUuid: null,
        },
      });

      if (!existingAccount) {
        const tbAccountId = createHash('sha256')
          .update(`SEED|${acct.code}|${tbLedgerId}|SYSTEM`)
          .digest('hex')
          .slice(0, 32);

        await (prisma as any).tbAccountRegistry.create({
          data: {
            tbAccountId,
            code: acct.code,
            ledger: tbLedgerId,
            ownerType: 'SYSTEM',
            ownerUuid: null,
            ownerNo: null,
            assetCode: asset.code,
            description: `${acct.desc} for ${asset.code}`,
            flags: acct.flags ?? 0,
          },
        });
      }
    }
  }
}

async function isBaseComplete(prisma: PrismaClient): Promise<boolean> {
  const adminExists =
    (await prisma.user.count({ where: { email: DEFAULT_ADMIN_EMAIL } })) > 0;
  if (!adminExists) {
    return false;
  }

  const activeRoleCount = await (prisma as any).role.count({
    where: {
      status: 'ACTIVE',
      code: { in: ACTIVE_RBAC_ROLE_CODES },
    },
  });

  if (activeRoleCount !== ACTIVE_RBAC_ROLE_CODES.length) {
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
      existing.checkerRoles !== joinRoleCsv(deriveCheckerRoles(policy.steps)) ||
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
        adminStatus: 'ACTIVE',
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
    {
      assetId: string;
      ownerType: 'CUSTOMER' | 'PLATFORM';
      ownerNo: string;
      walletRole: string;
      type: 'CRYPTO_ADDRESS' | 'FIAT_BANK';
      direction: 'BIDIRECTIONAL';
    }
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
        ownerNo: CRYPTO_SYSTEM_WALLET_KIND_CONFIG[kind].ownerNo,
        walletRole: CRYPTO_SYSTEM_WALLET_KIND_CONFIG[kind].walletRole,
        type: 'CRYPTO_ADDRESS',
        direction: 'BIDIRECTIONAL',
      });
    }
  }
  for (const asset of fiatAssets) {
    for (const kind of FIAT_POOL_WALLET_KINDS) {
      const walletNo = buildFiatPoolWalletNo(kind, asset.code);
      expectedWallets.set(walletNo, {
        assetId: asset.id,
        ownerType: FIAT_POOL_WALLET_KIND_CONFIG[kind].ownerType,
        ownerNo: FIAT_POOL_WALLET_KIND_CONFIG[kind].ownerNo,
        walletRole: FIAT_POOL_WALLET_KIND_CONFIG[kind].walletRole,
        type: 'FIAT_BANK',
        direction: 'BIDIRECTIONAL',
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
        ownerNo: true,
        type: true,
        direction: true,
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
        wallet.ownerNo !== expected.ownerNo ||
        wallet.type !== expected.type ||
        wallet.direction !== expected.direction ||
        wallet.walletRole !== expected.walletRole ||
        wallet.ownerId !== null ||
        wallet.status !== 'ACTIVE'
      ) {
        return false;
      }
    }
  }

  const tbRegistryCount = await (prisma as any).tbAccountRegistry.count({
    where: { ownerType: 'SYSTEM', status: 'ACTIVE' },
  });
  if (tbRegistryCount < activeAssets.length * 3) {
    return false;
  }

  const assetsWithLedger = await prisma.asset.count({
    where: { status: 'ACTIVE', tbLedgerId: { not: null } },
  });
  if (assetsWithLedger < activeAssets.length) {
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

  const canonicalPoolWalletIds = (
    await (prisma as any).wallet.findMany({
      where: {
        status: 'ACTIVE',
        walletRole: {
          in: ['MASTER', 'PAYOUT', 'LIQ', 'CUST_BANK', 'LIQ_BANK'],
        },
      },
      select: { id: true },
    })
  ).map((wallet: { id: string }) => wallet.id);

  if (canonicalPoolWalletIds.length > 0) {
    const snapshotCount = await (
      prisma as any
    ).walletBalanceSnapshot.count({
      where: {
        walletId: { in: canonicalPoolWalletIds },
      },
    });
    if (snapshotCount < canonicalPoolWalletIds.length) {
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
  return buildDeterministicNo('WA', role, assetCode, network || '');
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
  return buildDeterministicNo('WA', role, assetCode, '');
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

