import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ensureBaseSeeded } from './seed.base';

type SeedBusinessOptions = {
  skipEnsureBase?: boolean;
};

export async function seedBusiness(
  prisma: PrismaClient,
  options: SeedBusinessOptions = {},
): Promise<void> {
  console.log('--- Seeding Business Data (Minimal Profile) ---');

  if (!options.skipEnsureBase) {
    await ensureBaseSeeded(prisma);
  }

  await seedCustomersMinimal(prisma);
  await seedPricingPolicies(prisma);
  console.log('✅ Business data seeded.');
}

async function seedCustomersMinimal(prisma: PrismaClient): Promise<void> {
  const basePassword = await bcrypt.hash('123456', 10);
  const now = new Date();
  const expiredAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const items: Array<{
    customerNo: string;
    email: string;
    phone: string;
    firstName: string;
    publicStatus: string;
    eddRequired: boolean;
    cddDocumentExpiresAt: Date | null;
  }> = [
    {
      customerNo: 'CUST-MIN-0001',
      email: 'minimal_none@example.com',
      phone: '+15551000001',
      firstName: 'MinimalNone',
      publicStatus: 'NONE',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0002',
      email: 'minimal_progress@example.com',
      phone: '+15551000002',
      firstName: 'MinimalProgress',
      publicStatus: 'PENDING_CDD',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0003',
      email: 'minimal_active@example.com',
      phone: '+15551000003',
      firstName: 'MinimalActive',
      publicStatus: 'ACTIVE',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0004',
      email: 'minimal_restricted@example.com',
      phone: '+15551000004',
      firstName: 'MinimalRestricted',
      publicStatus: 'FINAL_APPROVAL',
      eddRequired: true,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0005',
      email: 'minimal_blocked@example.com',
      phone: '+15551000005',
      firstName: 'MinimalBlocked',
      publicStatus: 'REJECTED',
      eddRequired: false,
      cddDocumentExpiresAt: null,
    },
    {
      customerNo: 'CUST-MIN-0006',
      email: 'minimal_expired@example.com',
      phone: '+15551000006',
      firstName: 'MinimalExpired',
      publicStatus: 'PENDING_CDD',
      eddRequired: false,
      cddDocumentExpiresAt: expiredAt,
    },
  ];

  for (const item of items) {
    const legacy = (() => {
      if (item.publicStatus === 'ACTIVE') {
        return {
          cddStatus: 'APPROVED',
          eddStatus: item.eddRequired ? 'APPROVED' : 'NOT_REQUIRED',
          complianceStatus: 'ACTIVE',
          finalApprovalStatus: 'APPROVED',
        };
      }
      if (item.publicStatus === 'FINAL_APPROVAL') {
        return {
          cddStatus: 'APPROVED',
          eddStatus: 'APPROVED',
          complianceStatus: 'IN_PROGRESS',
          finalApprovalStatus: 'PENDING',
        };
      }
      if (item.publicStatus === 'REJECTED') {
        return {
          cddStatus: 'REJECTED',
          eddStatus: item.eddRequired ? 'REJECTED' : 'NOT_REQUIRED',
          complianceStatus: 'BLOCKED',
          finalApprovalStatus: 'REJECTED',
        };
      }
      if (item.publicStatus === 'PENDING_CDD') {
        return {
          cddStatus: item.cddDocumentExpiresAt ? 'EXPIRED' : 'IN_PROGRESS',
          eddStatus: 'NOT_REQUIRED',
          complianceStatus: item.cddDocumentExpiresAt ? 'EXPIRED' : 'IN_PROGRESS',
          finalApprovalStatus: 'NOT_REQUIRED',
        };
      }
      return {
        cddStatus: 'NOT_STARTED',
        eddStatus: 'NOT_REQUIRED',
        complianceStatus: 'NONE',
        finalApprovalStatus: 'NOT_REQUIRED',
      };
    })();

    await prisma.customerMain.upsert({
      where: { email: item.email },
      update: {
        customerNo: item.customerNo,
        phone: item.phone,
        firstName: item.firstName,
        lastName: 'Demo',
        passwordHash: basePassword,
        passwordUpdatedAt: now,
        customerType: 'INDIVIDUAL',
        publicStatus: item.publicStatus,
        cddStatus: legacy.cddStatus,
        amlRiskTier: 'LOW',
        eddRequired: item.eddRequired,
        eddStatus: legacy.eddStatus,
        complianceStatus: legacy.complianceStatus,
        cddDocumentExpiresAt: item.cddDocumentExpiresAt,
        finalApprovalStatus: legacy.finalApprovalStatus,
        finalApprovalReason: null,
        finalApprovalReviewerId: null,
        finalApprovalReviewedAt: null,
      },
      create: {
        customerNo: item.customerNo,
        email: item.email,
        phone: item.phone,
        firstName: item.firstName,
        lastName: 'Demo',
        passwordHash: basePassword,
        passwordUpdatedAt: now,
        customerType: 'INDIVIDUAL',
        publicStatus: item.publicStatus,
        cddStatus: legacy.cddStatus,
        amlRiskTier: 'LOW',
        eddRequired: item.eddRequired,
        eddStatus: legacy.eddStatus,
        complianceStatus: legacy.complianceStatus,
        cddDocumentExpiresAt: item.cddDocumentExpiresAt,
        finalApprovalStatus: legacy.finalApprovalStatus,
      },
    });
  }

  console.log(`Seeded ${items.length} minimal customers.`);
}

type SeedAsset = {
  id: string;
  code: string;
  type: string;
  network: string | null;
  decimals: number;
};

const DEFAULT_ROUTING = {
  strategy: 'PRIMARY_FALLBACK',
  primaryLp: 'LP_A',
  fallbackLp: 'LP_B',
  maxStalenessSec: 30,
  quoteLockSeconds: 30,
  rounding: {
    dp: 8,
    mode: 'ROUND',
  },
};

const DEFAULT_SWAP_FEE_ITEM_CODES = ['SWAP_SERVICE_FEE', 'COMPLIANCE_FEE'];
const DEFAULT_WITHDRAW_FEE_ITEM_CODES = [
  'WITHDRAW_SERVICE_FEE',
  'NETWORK_FEE_EST',
  'BANK_OUT_FEE',
  'COMPLIANCE_FEE',
];

function formatAssetLabel(asset: SeedAsset): string {
  const network = String(asset.network || '').trim();
  return network ? `${asset.code}-${network}` : asset.code;
}

function buildDefaultSwapPolicyConfig(activeAssets: SeedAsset[]) {
  const pairs: any[] = [];
  let pairSeq = 1;

  for (let i = 0; i < activeAssets.length; i += 1) {
    for (let j = i + 1; j < activeAssets.length; j += 1) {
      const left = activeAssets[i];
      const right = activeAssets[j];
      if (left.type === 'FIAT' && right.type === 'FIAT') {
        continue;
      }

      const pairId = `PAIR-${String(pairSeq).padStart(4, '0')}`;
      const tierId = `${pairId}-TIER-001`;
      pairSeq += 1;

      pairs.push({
        id: pairId,
        name: `${formatAssetLabel(left)} ↔ ${formatAssetLabel(right)}`,
        assetAId: left.id,
        assetALabel: formatAssetLabel(left),
        assetBId: right.id,
        assetBLabel: formatAssetLabel(right),
        enabled: true,
        routing: { ...DEFAULT_ROUTING },
        tiers: [
          {
            id: tierId,
            name: 'Default Tier',
            priority: 1,
            enabled: true,
            rateMarkupBps: 0,
            conditions: {
              segment: 'ANY',
              amountMin: null,
              amountMax: null,
            },
            feeItems: DEFAULT_SWAP_FEE_ITEM_CODES.map((code, index) => ({
              id: `${tierId}-FEE-${String(index + 1).padStart(3, '0')}`,
              itemCode: code,
              calcType: 'FLAT',
              value: '0',
              currency: right.code,
              min: null,
              cap: null,
              roundingDp: right.decimals,
              roundingMode: 'ROUND',
              adjustable: true,
            })),
          },
        ],
      });
    }
  }

  return {
    policyId: 'POL-SWAP-ONLINE',
    policyName: 'Swap Pricing',
    business: 'SWAP',
    channel: {
      online: true,
      storeComingSoon: true,
    },
    pairs,
  };
}

function buildDefaultWithdrawalPolicyConfig(activeAssets: SeedAsset[]) {
  const assets = activeAssets.map((asset, index) => {
    const assetEntryId = `ASSET-${String(index + 1).padStart(4, '0')}`;
    const tierId = `${assetEntryId}-TIER-001`;
    return {
      id: assetEntryId,
      assetId: asset.id,
      assetCode: asset.code,
      network: asset.network || null,
      enabled: true,
      tiers: [
        {
          id: tierId,
          name: 'Default Tier',
          priority: 1,
          enabled: true,
          conditions: {
            segment: 'ANY',
            riskTier: 'ANY',
            amountMin: null,
            amountMax: null,
          },
          feeItems: DEFAULT_WITHDRAW_FEE_ITEM_CODES.map((code, feeIndex) => ({
            id: `${tierId}-FEE-${String(feeIndex + 1).padStart(3, '0')}`,
            itemCode: code,
            calcType: 'FLAT',
            value: '0',
            currency: asset.code,
            min: null,
            cap: null,
            roundingDp: asset.decimals,
            roundingMode: 'ROUND',
            adjustable: true,
          })),
        },
      ],
    };
  });

  return {
    policyId: 'POL-WITHDRAW-ONLINE',
    policyName: 'Withdrawal Pricing',
    business: 'WITHDRAWAL',
    channel: {
      online: true,
      storeComingSoon: true,
    },
    assets,
  };
}

async function seedPricingPolicies(prisma: PrismaClient): Promise<void> {
  const activeAssets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ type: 'asc' }, { code: 'asc' }, { network: 'asc' }],
    select: {
      id: true,
      code: true,
      type: true,
      network: true,
      decimals: true,
    },
  });

  if (activeAssets.length === 0) {
    console.log('Skip pricing policy seed: no active assets found.');
    return;
  }

  const swapConfig = buildDefaultSwapPolicyConfig(activeAssets);
  const withdrawalConfig = buildDefaultWithdrawalPolicyConfig(activeAssets);

  await prisma.pricingPolicy.upsert({
    where: { policyCode: 'SWAP_PRICING' },
    update: {
      policyName: 'Swap Pricing',
      business: 'SWAP',
      channelOnline: true,
      channelStoreSoon: true,
      configJson: JSON.stringify(swapConfig),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    },
    create: {
      policyCode: 'SWAP_PRICING',
      policyName: 'Swap Pricing',
      business: 'SWAP',
      channelOnline: true,
      channelStoreSoon: true,
      configJson: JSON.stringify(swapConfig),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    },
  });

  await prisma.pricingPolicy.upsert({
    where: { policyCode: 'WITHDRAWAL_PRICING' },
    update: {
      policyName: 'Withdrawal Pricing',
      business: 'WITHDRAWAL',
      channelOnline: true,
      channelStoreSoon: true,
      configJson: JSON.stringify(withdrawalConfig),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    },
    create: {
      policyCode: 'WITHDRAWAL_PRICING',
      policyName: 'Withdrawal Pricing',
      business: 'WITHDRAWAL',
      channelOnline: true,
      channelStoreSoon: true,
      configJson: JSON.stringify(withdrawalConfig),
      updatedByUserId: 'SYSTEM',
      updatedByUserNo: 'SYSTEM',
    },
  });

  console.log(
    `Seeded pricing policies (swap pairs: ${swapConfig.pairs.length}, withdrawal assets: ${withdrawalConfig.assets.length}).`,
  );
}
