import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { createClient as tbCreateClient } from 'tigerbeetle-node';
import { generateReferenceNo } from '../src/common/utils/no-generator.util';
import { ensureBaseSeeded } from './seed.base';
import { ensureTbAccountRegistry, provisionTbAccounts } from './seed-tb.helper';
import { DEFAULT_ASSETS } from '../src/config/manifests/assets.manifest';
import { assertNetwork } from '../src/config/manifests/networks.manifest';
import { buildDeterministicNo } from '../src/common/utils/no-generator.util';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { systemAccountCodesFor } from '../src/modules/asset-treasury/assets/asset-provisioning.service';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { CustomerLifecycle } from '../src/modules/identity/constants/customer-lifecycle.constant';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
  RestrictionScope,
} from '../src/modules/identity/customers/constants/restriction-cause.constant';
import { deterministicTransferId, bigintToHex } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';
import { platformWalletSlots } from '../src/config/manifests/vaults.manifest';
import { NETWORKS } from '../src/config/manifests/networks.manifest';
import { fakeTronAddress } from '../src/common/utils/tron-address.util';
import { writeSeedAudit } from './seed-audit.helper';
import { FilingStatus, FilingEntryKinds, RegulatoryAuthorities } from '../src/modules/governance/regulatory-filings/regulatory-filing.constants';
import { getFilingTypeConfig } from '../src/modules/governance/regulatory-filings/filing-type-registry';
import { addBusinessDays } from '../src/modules/governance/regulatory-filings/business-days';
import { DUBAI_UTC_OFFSET_MS } from '../src/modules/accounting/tigerbeetle/utils/business-date.util';
import { INCIDENT_REPORT_BASES } from '../src/modules/governance/incidents/incident.constants';
import { ObligationFrequencies, ObligationStatus, VendorStatus } from '../src/modules/governance/compliance-office/compliance-office.constants';

type SeedBusinessOptions = {
  skipEnsureBase?: boolean;
};

export async function seedBusiness(
  prisma: PrismaClient,
  options: SeedBusinessOptions = {},
): Promise<void> {
  console.log('--- Seeding Business Data (Transaction-Ready Demo) ---');

  if (!options.skipEnsureBase) {
    await ensureBaseSeeded(prisma);
  }

  // ① Assets layer
  await seedAssets(prisma);
  // ①b Platform wallet address rows (vault × network)
  await seedPlatformWallets(prisma);
  // ② Config layer
  await seedSwapFeeLevels(prisma);
  await seedWithdrawalFeeLevels(prisma);
  await seedTransactionLimitRules(prisma);
  // ③ Customers layer
  await seedCustomers(prisma);
  // ③b Material requests layer (needs seedCustomers' restriction rows for Ivy)
  await seedMaterialRequest(prisma);
  // ③c Incidents layer (needs seedCustomers' customerNo for the STUCK_TRANSACTION_MAJOR sample)
  await seedIncidents(prisma);
  // ③d Regulatory filings layer (needs seedIncidents' data-breach-crm-export row)
  await seedRegulatoryFilings(prisma);
  // ③e AML reporting family layer（战役甲波三 T10，spec §7）：STR/PNMR/CNMR 三样例，
  // needs seedCustomers' Frank/Leo/Mona rows + Leo/Mona 的限制账 openedAt 锚。
  await seedAmlFilingFamily(prisma);
  // ③f Compliance office layer（战役甲波四 T7，spec §7/§9）：合规日历义务台账三行 +
  // 两本登记册（外包商三行 + RI 席位四行）——各表互不依赖，也不依赖上面任何客户/事件/
  // 报送单种子行（spec §10：两册与义务台账均无横向外键）。
  await seedComplianceObligations(prisma);
  await seedOutsourcingVendors(prisma);
  await seedResponsibleIndividuals(prisma);
  // Final: push all registry rows (system + customer) into TigerBeetle.
  await provisionTbAccounts(prisma);
  // Firm capital bootstrap: DR FIRM_ASSET / CR FIRM_OPS per currency.
  await seedCapitalInjection(prisma);

  console.log('✅ Business data seeded.');
}

// ─────────────────────────────────────────────────────────────
// ① Assets layer — assets + system TB accounts + system wallets
// ─────────────────────────────────────────────────────────────

function normalizeSegment(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function buildSystemPoolIban(vaultCode: string, currency: string): string {
  const hash = createHash('sha256')
    .update(`${vaultCode}|${normalizeSegment(currency)}`)
    .digest('hex');
  // AE IBAN 形制:AE + 2 check digits + 3-digit bank code + 16-digit account (23 chars)。
  // 演示库:数字从 hash 确定性导出,不做真实 mod-97 校验(spec §7 范围外)。
  const digits = BigInt('0x' + hash.slice(0, 24)).toString().padStart(18, '0').slice(0, 18);
  return `AE${digits.slice(0, 2)}086${digits.slice(2, 18)}`;
}

async function seedAssets(prisma: PrismaClient): Promise<void> {
  for (const asset of DEFAULT_ASSETS) {
    assertNetwork(asset.network);
    const currency = asset.currency as keyof typeof TB_LEDGERS;
    const ledger = TB_LEDGERS[currency];

    const record = await prisma.asset.upsert({
      where: { type_currency_network: { type: asset.type, currency: asset.currency, network: asset.network } },
      update: {
        assetNo: asset.assetNo,
        code: asset.code,
        decimals: asset.decimals,
        description: asset.description,
        contractAddress: asset.contractAddress,
        isNative: asset.isNative,
        standard: asset.standard,
        minConfirmations: asset.minConfirmations,
        custodianAssetKey: asset.custodianAssetKey,
        status: 'ACTIVE',
        tbLedgerId: ledger,
      },
      create: {
        assetNo: asset.assetNo,
        type: asset.type,
        currency: asset.currency,
        code: asset.code,
        network: asset.network,
        decimals: asset.decimals,
        description: asset.description,
        contractAddress: asset.contractAddress,
        isNative: asset.isNative,
        standard: asset.standard,
        minConfirmations: asset.minConfirmations,
        custodianAssetKey: asset.custodianAssetKey,
        status: 'ACTIVE',
        tbLedgerId: ledger,
      },
    });

    await writeSeedAudit(prisma, {
      action: 'ASSET_SEEDED', subjectType: 'ASSET', subjectNo: record.assetNo, actorNo: 'RELEASE',
      afterData: { code: record.code, currency: record.currency, network: record.network, contractAddress: record.contractAddress, standard: record.standard, decimals: record.decimals, status: record.status },
    });

    // System TB accounts (ownerType SYSTEM, no ownerUuid).
    const systemAccounts = systemAccountCodesFor(asset.type);
    for (const acct of systemAccounts) {
      await ensureTbAccountRegistry(prisma, {
        code: acct.code,
        ledger,
        ownerType: 'SYSTEM',
        ownerUuid: null,
        ownerNo: null,
        assetCode: asset.code,
        description: `${acct.desc} for ${asset.code}`,
      });
    }

  }

  console.log(
    `Seeded ${DEFAULT_ASSETS.length} assets + system TB accounts.`,
  );
}

// ─────────────────────────────────────────────────────────────
// ①b Platform wallet rows — 4 vault × network slots (7 rows), keyed by network not asset
// ─────────────────────────────────────────────────────────────
async function seedPlatformWallets(prisma: PrismaClient): Promise<void> {
  for (const slot of platformWalletSlots()) {
    const net = NETWORKS[slot.network];
    const walletNo = buildDeterministicNo('WA', slot.vaultCode, slot.network);
    const isChain = net.kind === 'CHAIN';
    const data = {
      ownerType: 'PLATFORM',
      ownerId: null,
      ownerNo: 'PLATFORM',
      vaultCode: slot.vaultCode,
      walletRole: slot.vaultCode,
      network: slot.network,
      address: isChain ? fakeTronAddress(`PLATFORM|${slot.vaultCode}|${slot.network}`) : null,
      iban: isChain ? null : buildSystemPoolIban(slot.vaultCode, 'AED'),
      custodianRef: `${net.custodian.toLowerCase()}-vault-${slot.vaultCode.toLowerCase()}`,
      status: 'ACTIVE',
    };
    const row = await prisma.wallet.upsert({ where: { walletNo }, update: data, create: { walletNo, ...data } });
    await writeSeedAudit(prisma, {
      action: 'CUSTODIAN_WALLET_SEEDED', subjectType: 'WALLET', subjectNo: row.walletNo, actorNo: 'RELEASE',
      afterData: { vaultCode: row.vaultCode, network: row.network, address: row.address, iban: row.iban, custodianRef: row.custodianRef, status: row.status },
    });
  }
  console.log('Seeded 7 platform wallet address rows (vault × network).');
}

// ─────────────────────────────────────────────────────────────
// ② Config layer — swap fee levels, withdrawal fee levels, limits
// ─────────────────────────────────────────────────────────────

async function seedSwapFeeLevels(prisma: PrismaClient): Promise<void> {
  const usdt = await prisma.asset.findFirst({
    where: { type: 'CRYPTO', currency: 'USDT', status: 'ACTIVE' },
    select: { id: true, currency: true },
  });
  const aed = await prisma.asset.findFirst({
    where: { type: 'FIAT', currency: 'AED', status: 'ACTIVE' },
    select: { id: true, currency: true },
  });

  if (!usdt || !aed) {
    console.log('Skip swap fee level seed: USDT/AED assets not found.');
    return;
  }

  // Both directions of the USDT/AED pair.
  const pairs: Array<{
    levelCode: string;
    name: string;
    fromAssetId: string;
    toAssetId: string;
    fromCurrency: string;
    toCurrency: string;
    feeCurrency: string;
  }> = [
    {
      levelCode: 'STD-USDT-AED',
      name: 'Standard USDT → AED',
      fromAssetId: usdt.id,
      toAssetId: aed.id,
      fromCurrency: usdt.currency,
      toCurrency: aed.currency,
      feeCurrency: aed.currency,
    },
    {
      levelCode: 'STD-AED-USDT',
      name: 'Standard AED → USDT',
      fromAssetId: aed.id,
      toAssetId: usdt.id,
      fromCurrency: aed.currency,
      toCurrency: usdt.currency,
      feeCurrency: usdt.currency,
    },
  ];

  // 4-tier amount-based gradient: larger trades get better rate markup AND lower flat fee.
  // Tier boundaries differ per direction to reflect natural transaction-size distribution
  // (USDT side has finer granularity; AED side scales up faster).
  const tiersByDirection: Record<
    string,
    Array<{ amountMin: string; amountMax: string | null; rateMarkupBps: number; flatFee: string }>
  > = {
    'STD-USDT-AED': [
      { amountMin: '0',     amountMax: '500',   rateMarkupBps: 100, flatFee: '30' },
      { amountMin: '500',   amountMax: '2000',  rateMarkupBps: 60,  flatFee: '20' },
      { amountMin: '2000',  amountMax: '10000', rateMarkupBps: 40,  flatFee: '15' },
      { amountMin: '10000', amountMax: null,    rateMarkupBps: 20,  flatFee: '10' },
    ],
    'STD-AED-USDT': [
      { amountMin: '0',     amountMax: '1000',  rateMarkupBps: 100, flatFee: '8' },
      { amountMin: '1000',  amountMax: '5000',  rateMarkupBps: 60,  flatFee: '5' },
      { amountMin: '5000',  amountMax: '30000', rateMarkupBps: 40,  flatFee: '3' },
      { amountMin: '30000', amountMax: null,    rateMarkupBps: 20,  flatFee: '2' },
    ],
  };

  for (const pair of pairs) {
    const tiers = tiersByDirection[pair.levelCode].map((t, i) => {
      const tierIdx = String(i + 1).padStart(3, '0');
      return {
        id: `${pair.levelCode}-TIER-${tierIdx}`,
        name: `Tier ${i + 1} (${t.amountMin}${t.amountMax ? '-' + t.amountMax : '+'})`,
        enabled: true,
        rateMarkupBps: t.rateMarkupBps,
        conditions: { amountMin: t.amountMin, amountMax: t.amountMax },
        feeItems: [
          {
            id: `${pair.levelCode}-TIER-${tierIdx}-FEE-001`,
            itemCode: 'SWAP_SERVICE_FEE',
            calcType: 'FLAT',
            value: t.flatFee,
            min: null,
            max: null,
            roundingMode: 'ROUND',
          },
        ],
      };
    });
    const tiersJson = JSON.stringify({ tiers });
    const configHash = createHash('sha256').update(tiersJson).digest('hex');

    const row = await prisma.swapFeeLevel.upsert({
      where: { levelCode: pair.levelCode },
      update: { tiersJson, configHash, status: 'ACTIVE' },
      create: {
        levelCode: pair.levelCode,
        name: pair.name,
        fromAssetId: pair.fromAssetId,
        toAssetId: pair.toAssetId,
        isDefault: true,
        tiersJson,
        configHash,
        status: 'ACTIVE',
        createdByUserId: 'SYSTEM',
      },
    });
    await writeSeedAudit(prisma, {
      action: 'SWAP_FEE_LEVEL_SEEDED', subjectType: 'SWAP_FEE_LEVEL', subjectNo: row.levelCode, actorNo: 'RELEASE',
      afterData: { name: row.name, fromCurrency: pair.fromCurrency, toCurrency: pair.toCurrency, isDefault: row.isDefault, requiredTags: JSON.parse(row.requiredTagsJson), configHash: row.configHash },
    });
  }

  console.log(`Seeded ${pairs.length} swap fee levels.`);

  // 受众档：VIP 标签命中，各档比 STD 便宜（站 2：Grace 命中它、Alice 命中默认档）
  const vipTiers = [
    { amountMin: '0',     amountMax: '500',   rateMarkupBps: 60, flatFee: '20' },
    { amountMin: '500',   amountMax: '2000',  rateMarkupBps: 40, flatFee: '12' },
    { amountMin: '2000',  amountMax: '10000', rateMarkupBps: 25, flatFee: '8' },
    { amountMin: '10000', amountMax: null,    rateMarkupBps: 10, flatFee: '5' },
  ].map((t, i) => {
    const tierIdx = String(i + 1).padStart(3, '0');
    return {
      id: `VIP-USDT-AED-TIER-${tierIdx}`,
      name: `VIP Tier ${i + 1} (${t.amountMin}${t.amountMax ? '-' + t.amountMax : '+'})`,
      enabled: true,
      rateMarkupBps: t.rateMarkupBps,
      conditions: { amountMin: t.amountMin, amountMax: t.amountMax },
      feeItems: [{ id: `VIP-USDT-AED-TIER-${tierIdx}-FEE-001`, itemCode: 'SWAP_SERVICE_FEE', calcType: 'FLAT', value: t.flatFee, min: null, max: null, roundingMode: 'ROUND' }],
    };
  });
  const vipTiersJson = JSON.stringify({ tiers: vipTiers });
  const vipRow = await prisma.swapFeeLevel.upsert({
    where: { levelCode: 'VIP-USDT-AED' },
    update: { tiersJson: vipTiersJson, configHash: createHash('sha256').update(vipTiersJson).digest('hex'), status: 'ACTIVE' },
    create: {
      levelCode: 'VIP-USDT-AED',
      name: 'VIP USDT → AED',
      fromAssetId: usdt.id,
      toAssetId: aed.id,
      isDefault: false,
      requiredTagsJson: JSON.stringify(['VIP']),
      tiersJson: vipTiersJson,
      configHash: createHash('sha256').update(vipTiersJson).digest('hex'),
      status: 'ACTIVE',
      createdByUserId: 'SYSTEM',
    },
  });
  await writeSeedAudit(prisma, {
    action: 'SWAP_FEE_LEVEL_SEEDED', subjectType: 'SWAP_FEE_LEVEL', subjectNo: vipRow.levelCode, actorNo: 'RELEASE',
    afterData: { name: vipRow.name, fromCurrency: usdt.currency, toCurrency: aed.currency, isDefault: vipRow.isDefault, requiredTags: JSON.parse(vipRow.requiredTagsJson), configHash: vipRow.configHash },
  });
  console.log('Seeded VIP-USDT-AED audience level.');

  // 受众档：NEW_CUSTOMER 标签命中，各档比 STD 便宜、比 VIP 贵（cheapest-wins：新客命中它，VIP 客户仍拿 VIP 档）
  const newCustTiers = [
    { amountMin: '0',     amountMax: '500',   rateMarkupBps: 80, flatFee: '25' },
    { amountMin: '500',   amountMax: '2000',  rateMarkupBps: 50, flatFee: '16' },
    { amountMin: '2000',  amountMax: '10000', rateMarkupBps: 30, flatFee: '11' },
    { amountMin: '10000', amountMax: null,    rateMarkupBps: 15, flatFee: '7' },
  ].map((t, i) => {
    const tierIdx = String(i + 1).padStart(3, '0');
    return {
      id: `NEWCUST-USDT-AED-TIER-${tierIdx}`,
      name: `New Customer Tier ${i + 1} (${t.amountMin}${t.amountMax ? '-' + t.amountMax : '+'})`,
      enabled: true,
      rateMarkupBps: t.rateMarkupBps,
      conditions: { amountMin: t.amountMin, amountMax: t.amountMax },
      feeItems: [{ id: `NEWCUST-USDT-AED-TIER-${tierIdx}-FEE-001`, itemCode: 'SWAP_SERVICE_FEE', calcType: 'FLAT', value: t.flatFee, min: null, max: null, roundingMode: 'ROUND' }],
    };
  });
  const newCustTiersJson = JSON.stringify({ tiers: newCustTiers });
  const newCustRow = await prisma.swapFeeLevel.upsert({
    where: { levelCode: 'NEWCUST-USDT-AED' },
    update: { tiersJson: newCustTiersJson, configHash: createHash('sha256').update(newCustTiersJson).digest('hex'), status: 'ACTIVE' },
    create: {
      levelCode: 'NEWCUST-USDT-AED',
      name: 'New Customer USDT → AED',
      fromAssetId: usdt.id,
      toAssetId: aed.id,
      isDefault: false,
      requiredTagsJson: JSON.stringify(['NEW_CUSTOMER']),
      tiersJson: newCustTiersJson,
      configHash: createHash('sha256').update(newCustTiersJson).digest('hex'),
      status: 'ACTIVE',
      createdByUserId: 'SYSTEM',
    },
  });
  await writeSeedAudit(prisma, {
    action: 'SWAP_FEE_LEVEL_SEEDED', subjectType: 'SWAP_FEE_LEVEL', subjectNo: newCustRow.levelCode, actorNo: 'RELEASE',
    afterData: { name: newCustRow.name, fromCurrency: usdt.currency, toCurrency: aed.currency, isDefault: newCustRow.isDefault, requiredTags: JSON.parse(newCustRow.requiredTagsJson), configHash: newCustRow.configHash },
  });
  console.log('Seeded NEWCUST-USDT-AED audience level.');
}

async function seedWithdrawalFeeLevels(prisma: PrismaClient): Promise<void> {
  const assets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, currency: true, network: true, decimals: true },
    orderBy: [{ currency: 'asc' }, { network: 'asc' }],
  });

  // 4-tier amount-based gradient per asset. Larger withdrawals get higher absolute fee
  // but lower effective percentage. NETWORK_FEE_EST applies only to crypto (on-chain gas).
  const tiersByCurrency: Record<
    string,
    Array<{ amountMin: string; amountMax: string | null; serviceFee: string; networkFee: string }>
  > = {
    AED: [
      { amountMin: '0',      amountMax: '1000',    serviceFee: '30',  networkFee: '0' },
      { amountMin: '1000',   amountMax: '10000',   serviceFee: '50',  networkFee: '0' },
      { amountMin: '10000',  amountMax: '100000',  serviceFee: '100', networkFee: '0' },
      { amountMin: '100000', amountMax: null,      serviceFee: '200', networkFee: '0' },
    ],
    USDT: [
      { amountMin: '0',     amountMax: '100',   serviceFee: '3',  networkFee: '1' },
      { amountMin: '100',   amountMax: '1000',  serviceFee: '5',  networkFee: '1' },
      { amountMin: '1000',  amountMax: '10000', serviceFee: '10', networkFee: '1' },
      { amountMin: '10000', amountMax: null,    serviceFee: '20', networkFee: '1' },
    ],
  };

  // Fallback for any asset not explicitly listed above (single default tier).
  const fallbackTiers = [
    { amountMin: '0', amountMax: null, serviceFee: '5', networkFee: '0' },
  ];

  let count = 0;
  for (const asset of assets) {
    const networkLabel = asset.network || 'FIAT';
    const levelCode = `STD-${asset.currency}-${networkLabel}`;
    const tierData = tiersByCurrency[asset.currency] ?? fallbackTiers;
    const tiers = tierData.map((t, i) => {
      const tierIdx = String(i + 1).padStart(3, '0');
      const tierId = `${levelCode}-TIER-${tierIdx}`;
      return {
        id: tierId,
        name: `Tier ${i + 1} (${t.amountMin}${t.amountMax ? '-' + t.amountMax : '+'})`,
        enabled: true,
        conditions: { amountMin: t.amountMin, amountMax: t.amountMax },
        feeItems: [
          {
            id: `${tierId}-FEE-001`,
            itemCode: 'WITHDRAW_SERVICE_FEE',
            calcType: 'FLAT',
            value: t.serviceFee,
            min: null,
            max: null,
            roundingMode: 'ROUND',
          },
          {
            id: `${tierId}-FEE-002`,
            itemCode: 'NETWORK_FEE_EST',
            calcType: 'FLAT',
            value: t.networkFee,
            min: null,
            max: null,
            roundingMode: 'ROUND',
          },
        ],
      };
    });
    const tiersJson = JSON.stringify({ tiers });
    const configHash = createHash('sha256').update(tiersJson).digest('hex');

    const row = await prisma.withdrawalFeeLevel.upsert({
      where: { levelCode },
      update: { tiersJson, configHash, status: 'ACTIVE' },
      create: {
        levelCode,
        name: `Standard ${asset.currency}`,
        assetId: asset.id,
        isDefault: true,
        tiersJson,
        configHash,
        status: 'ACTIVE',
        createdByUserId: 'SYSTEM',
      },
    });
    await writeSeedAudit(prisma, {
      action: 'WITHDRAWAL_FEE_LEVEL_SEEDED', subjectType: 'WITHDRAWAL_FEE_LEVEL', subjectNo: row.levelCode, actorNo: 'RELEASE',
      afterData: { name: row.name, assetCode: asset.currency, isDefault: row.isDefault, configHash: row.configHash },
    });
    count++;
  }

  console.log(`Seeded ${count} withdrawal fee levels.`);
}

export async function seedTransactionLimitRules(prisma: PrismaClient): Promise<void> {
  // A: 每资产 × WITHDRAWAL/SWAP 单笔 min/max（原生币种）
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, currency: true, type: true } });
  const singleDefaults: Record<string, { min: string; max: string }> = {
    BTC: { min: '0.0001', max: '10' },
    ETH: { min: '0.001', max: '100' },
    USDT: { min: '10', max: '1000000' },
    AED: { min: '10', max: '1000000' },
    USD: { min: '10', max: '1000000' },
  };
  const rules: any[] = [];
  // 确定性业务号：同一条业务规则(gateType+区分段)每次重铺铸出同一个 ruleNo，
  // 身世(TRANSACTION_LIMIT_SEEDED 审计行)才能稳定 join 到同一条活规则。
  // usedNos 只做批内撞号红线——确定性输入撞哈希只能改分段，禁静默重试。
  const usedNos = new Set<string>();
  const no = (...segments: string[]) => {
    const n = buildDeterministicNo('TLR', ...segments);
    if (usedNos.has(n)) {
      throw new Error(`transaction limit ruleNo collision: ${n} (segments=${segments.join('|')})`);
    }
    usedNos.add(n);
    return n;
  };
  for (const a of assets) {
    // 按 currency 而非 code 匹配——code 含网络后缀(如 USDT-TRON),currency 才是 singleDefaults 的键
    const d = singleDefaults[a.currency] || { min: '0.0001', max: '1000000' };
    for (const op of ['WITHDRAWAL', 'SWAP']) {
      rules.push({ ruleNo: no('SINGLE', op, a.currency), gateType: 'SINGLE', operationType: op, assetId: a.id, minAmount: d.min, maxAmount: d.max });
    }
  }
  // DEPOSIT: 只有下限(min=100 原生币种),无上限(maxAmount 空=∞) — 2026-07-16 deposit-min spec
  for (const a of assets) {
    rules.push({ ruleNo: no('SINGLE', 'DEPOSIT', a.currency), gateType: 'SINGLE', operationType: 'DEPOSIT', assetId: a.id, minAmount: '100' });
  }
  // B: tier × 方向 × 周期（AED；默认值）
  const cum = [
    ['BASIC', 'WITHDRAWAL', 'DAILY', '50000'],
    ['BASIC', 'WITHDRAWAL', 'MONTHLY', '500000'],
    ['BASIC', 'SWAP', 'DAILY', '100000'],
    ['BASIC', 'SWAP', 'MONTHLY', '1000000'],
    ['PREMIUM', 'WITHDRAWAL', 'DAILY', '500000'],
    ['PREMIUM', 'WITHDRAWAL', 'MONTHLY', '5000000'],
    ['PREMIUM', 'SWAP', 'DAILY', '1000000'],
    ['PREMIUM', 'SWAP', 'MONTHLY', '10000000'],
  ];
  for (const [tier, op, period, defaultLimit] of cum) {
    rules.push({ ruleNo: no('CUMULATIVE', op, tier, period), gateType: 'CUMULATIVE', operationType: op, tradingTier: tier, period, defaultLimit });
  }
  // D1: 提现大额审批线（承接原 WITHDRAW_APPROVAL_AED_THRESHOLD=200000）
  rules.push({ ruleNo: no('LARGE_APPROVAL', 'WITHDRAWAL'), gateType: 'LARGE_APPROVAL', operationType: 'WITHDRAWAL', threshold: '200000' });

  // afterData 是管理台上屏物(铁律⑥)：assetId(UUID) → assetCode(业务键，经 assets 数组 id→currency 查回)
  const currencyById = new Map(assets.map((a) => [a.id, a.currency]));

  for (const r of rules) {
    // ⚠️ Prisma+SQLite composite-unique WHERE with NULLs is unreliable — use manual upsert:
    const existing = await prisma.transactionLimitRule.findFirst({
      where: {
        gateType: r.gateType, operationType: r.operationType,
        assetId: r.assetId ?? null, tradingTier: r.tradingTier ?? null, period: r.period ?? null,
      },
    });
    let persisted;
    if (existing) {
      await prisma.transactionLimitRule.update({
        where: { id: existing.id },
        data: { minAmount: r.minAmount, maxAmount: r.maxAmount, defaultLimit: r.defaultLimit, threshold: r.threshold },
      });
      persisted = existing;
    } else {
      persisted = await prisma.transactionLimitRule.create({ data: { ...r } });
    }
    await writeSeedAudit(prisma, {
      action: 'TRANSACTION_LIMIT_SEEDED', subjectType: 'TRANSACTION_LIMIT_POLICY', subjectNo: persisted.ruleNo, actorNo: 'RELEASE',
      afterData: { gateType: persisted.gateType, operationType: persisted.operationType, assetCode: persisted.assetId ? currencyById.get(persisted.assetId) ?? null : null, tradingTier: persisted.tradingTier, period: persisted.period, minAmount: persisted.minAmount?.toString() ?? null, maxAmount: persisted.maxAmount?.toString() ?? null, defaultLimit: persisted.defaultLimit?.toString() ?? null, threshold: persisted.threshold?.toString() ?? null },
    });
  }
  console.log(`  ✔ Seeded ${rules.length} transaction limit rules`);
}

// ─────────────────────────────────────────────────────────────
// ③ Customers layer — 9 varied demo customers + customer TB accounts
//
// 一根轴（lifecycle）+ 一张限制账（restrictions）。旧的 onboardingStatus /
// adminStatus / complianceStatus 三轴与 complianceFreeze* 四列已随 Task 1 删除。
// 两个演示位是有意安排的：
//   Carol —— lifecycle=ACTIVE + SANCTION（SILENT）：演示"零痕迹"，客户面与
//            正常客户逐字节相同，后端 blocked 全禁；
//   Ivy   —— lifecycle=ACTIVE + MATERIAL_EXPIRED（DISCLOSED）：演示"明示受限"，
//            客户端出提示条 + 提现/兑换按钮置灰，充值照常。
// ─────────────────────────────────────────────────────────────

type DemoRestriction = {
  cause: RestrictionCause;
  /** 省略即取 RESTRICTION_CAUSE_POLICY[cause].defaultScopes —— 可见性与解除权限
   *  一律由 cause 查表推出，fixture 不许自己填（与运行期同一条铁律）。 */
  scopes?: RestrictionScope[];
  reason: string;
  caseRef?: string;
  /** T10（战役甲波三）：铺场时刻往前推 N 个工作日（迪拜日历）当 openedAt——PNMR/CNMR
   *  钟种子要"还剩约 N 个工作日在跑"的相对时刻效果，不能像其余客户那样统一用铺场
   *  "now"（那样钟从零起算，看不出"已经在跑一段时间"）。省略即取 now（既有行为零漂移）。 */
  openedAtOffsetBusinessDays?: number;
};

type DemoCustomer = {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE';
  lifecycle: CustomerLifecycle;
  riskRating: string;
  tradingTier: string;
  eddRequired: boolean;
  companyName?: string;
  sumsubApplicantId?: string;
  restrictions?: DemoRestriction[];
  // 波二回填：入驻史 + CDD 基础信息
  onboardingApprovedAt?: Date;
  sumsubCurrentLevelName?: string;
  dateOfBirth?: string;
  nationality?: string;
  idDocType?: string;
  idDocNumber?: string;
  residentialAddress?: string;
};

const DEMO_CUSTOMERS: DemoCustomer[] = [
  // 2× happy (ACTIVE, 无便签)
  {
    email: 'demo_alice@example.com', phone: '+15552000001',
    firstName: 'Alice', lastName: 'Happy', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    // Sumsub sandbox applicant (externalUserId = this customer's customerNo CU2601019430),
    // tagged shawn-test. Survives reset because customerNo is derived from the email.
    sumsubApplicantId: '6a5dd88f07d9bbd981a22fc9',
    // 波二回填：入驻史（数月前开户，出新客窗）+ CDD 基础信息（数据齐全轴）
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'basic-cdd-level',
    dateOfBirth: '1992-03-14', nationality: 'AE', idDocType: 'PASSPORT',
    idDocNumber: 'P-AE-1000001', residentialAddress: 'Marina Tower 12F, Dubai',
  },
  {
    email: 'demo_bob@example.com', phone: '+15552000002',
    firstName: 'Bob', lastName: 'Happy', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    // 材料请求账演示位（黄档提醒，见 seedMaterialRequest）需要 sumsubApplicantId
    // 才能落一行——不是真沙盒 applicant，纯确定性 mock id（不打真 Sumsub）。
    sumsubApplicantId: mockSumsubApplicantId('demo_bob@example.com'),
    // 波二回填：入驻史 + CDD 基础信息
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'basic-cdd-level',
    dateOfBirth: '1988-07-22', nationality: 'US', idDocType: 'PASSPORT',
    idDocNumber: 'P-US-2000002', residentialAddress: '221 Baker St, Chicago, IL',
  },
  // 1× 制裁便签（SILENT）—— 演示零痕迹。lifecycle 仍是 ACTIVE：客户关系没变，
  // 变的是"能不能干事"，这正是本次三轴收敛的核心断言。
  {
    email: 'demo_carol@example.com', phone: '+15552000003',
    firstName: 'Carol', lastName: 'Silent', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'MEDIUM', tradingTier: 'BASIC', eddRequired: true,
    // 波二回填：入驻史 + CDD 基础信息（eddRequired=true → EDD 档位）
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubApplicantId: mockSumsubApplicantId('demo_carol@example.com'),
    sumsubCurrentLevelName: 'edd-sof-sow-level',
    dateOfBirth: '1979-11-05', nationality: 'GB', idDocType: 'PASSPORT',
    idDocNumber: 'P-GB-3000003', residentialAddress: '10 Downing Close, London',
    restrictions: [
      {
        cause: 'SANCTION',
        reason: 'Sanctions screening hit pending investigation',
      },
    ],
  },
  // 1× 认证中
  {
    email: 'demo_dave@example.com', phone: '+15552000004',
    firstName: 'Dave', lastName: 'Pending', customerType: 'INDIVIDUAL',
    lifecycle: 'IN_VERIFICATION',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    // 波二回填：还没交表——只补 applicantId + 档位，CDD 五列与 submittedAt 留空
    sumsubApplicantId: mockSumsubApplicantId('demo_dave@example.com'),
    sumsubCurrentLevelName: 'basic-cdd-level',
  },
  // 1× 刚注册未开认证
  {
    email: 'demo_eve@example.com', phone: '+15552000005',
    firstName: 'Eve', lastName: 'New', customerType: 'INDIVIDUAL',
    lifecycle: 'PROSPECT',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
  },
  // 1× HIGH risk —— 也是 demo-roster.ts 花名册的第四人设（FRANK）：花名册故意把他
  // 驱向永久 SANCTION 冻结（#7/#10/#13/#19），需要 sumsubApplicantId 才能被管理台
  // 真实 ⚡ 演示按钮驱动，否则会在 Gate 0 的 submitSumsubTxns 处静默跳过（同下面
  // grace 的缺口一样）——纯确定性 mock id，不打真 Sumsub。
  {
    email: 'demo_frank@example.com', phone: '+15552000006',
    firstName: 'Frank', lastName: 'HighRisk', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'HIGH', tradingTier: 'BASIC', eddRequired: true,
    sumsubApplicantId: mockSumsubApplicantId('demo_frank@example.com'),
    // 波二回填：入驻史 + CDD 基础信息（eddRequired=true → EDD 档位）
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'edd-sof-sow-level',
    dateOfBirth: '1975-01-30', nationality: 'RU', idDocType: 'PASSPORT',
    idDocNumber: 'P-RU-4000004', residentialAddress: 'Tverskaya St 5, Moscow',
  },
  // 1× PREMIUM trading tier —— 缺 sumsubApplicantId 时，管理台真实的 ⚡ 演示按钮
  // 对她会静默失效（Gate 0 warn 后跳过提交，裁决永远匹配不到单据）；补上（纯确定性
  // mock id，不打真 Sumsub，同 bob/ivy 的做法）。
  {
    email: 'demo_grace@example.com', phone: '+15552000007',
    firstName: 'Grace', lastName: 'Premium', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'LOW', tradingTier: 'PREMIUM', eddRequired: false,
    sumsubApplicantId: mockSumsubApplicantId('demo_grace@example.com'),
    // 波二回填：入驻史 + CDD 基础信息
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'basic-cdd-level',
    dateOfBirth: '1990-09-18', nationality: 'SG', idDocType: 'PASSPORT',
    idDocNumber: 'P-SG-5000005', residentialAddress: 'Orchard Rd 88, Singapore',
  },
  // 1× CORPORATE
  {
    email: 'demo_acme@example.com', phone: '+15552000008',
    firstName: 'Henry', lastName: 'Acme', customerType: 'CORPORATE',
    lifecycle: 'ACTIVE',
    riskRating: 'LOW', tradingTier: 'PREMIUM', eddRequired: false,
    companyName: 'Acme Trading LLC',
    // 波二回填：入驻史 + CDD 基础信息（授权代表本人信息）
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubApplicantId: mockSumsubApplicantId('demo_acme@example.com'),
    sumsubCurrentLevelName: 'basic-cdd-level',
    dateOfBirth: '1970-04-02', nationality: 'US', idDocType: 'PASSPORT',
    idDocNumber: 'P-US-6000006', residentialAddress: '500 Fifth Ave, New York',
  },
  // 1× 材料过期便签（DISCLOSED）—— 演示明示受限。新增客户而非改 Dave：
  // Dave 的 IN_VERIFICATION 是另一个演示位，且非 ACTIVE 客户挂交易类便签无意义。
  {
    email: 'demo_ivy@example.com', phone: '+15552000009',
    firstName: 'Ivy', lastName: 'Restricted', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'MEDIUM', tradingTier: 'BASIC', eddRequired: false,
    // 材料请求账演示位（红档，见 seedMaterialRequest）需要 sumsubApplicantId
    // 才能落一行——不是真沙盒 applicant，纯确定性 mock id（不打真 Sumsub）。
    sumsubApplicantId: mockSumsubApplicantId('demo_ivy@example.com'),
    // 波二回填：入驻史 + CDD 基础信息
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'basic-cdd-level',
    dateOfBirth: '1985-12-09', nationality: 'FR', idDocType: 'PASSPORT',
    idDocNumber: 'P-FR-7000007', residentialAddress: 'Rue de Rivoli 24, Paris',
    restrictions: [
      {
        cause: 'MATERIAL_EXPIRED',
        reason: 'Passport expired on 2026-06-30 — please upload a valid document',
        caseRef: 'SEED-MATERIAL-IVY',
      },
    ],
  },
  // 2× 对账素材人设（Jack/Kate）—— 普通活跃客户，没有任何合规特征。
  // 存在的理由：对账破口场景要落在钱包上，而现有 8 个客户钱包不够分
  // （见 specs/2026-08-30-recon-break-scenarios-design.md §4）。
  // 他们同时提供**有流水的干净钱包**——MATCHED 桶必须有实打实的代表，
  // 0 流水 0 余额的钱包匹配上是"平凡地平"，证明不了引擎在干活。
  {
    email: 'demo_jack@example.com', phone: '+15552000010',
    firstName: 'Jack', lastName: 'Trader', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    sumsubApplicantId: mockSumsubApplicantId('demo_jack@example.com'),
    // 波二回填：入驻史 + CDD 基础信息
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'basic-cdd-level',
    dateOfBirth: '1993-06-25', nationality: 'CA', idDocType: 'PASSPORT',
    idDocNumber: 'P-CA-8000008', residentialAddress: '100 Queen St W, Toronto',
  },
  {
    email: 'demo_kate@example.com', phone: '+15552000011',
    firstName: 'Kate', lastName: 'Trader', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    sumsubApplicantId: mockSumsubApplicantId('demo_kate@example.com'),
    // 波二回填：入驻史 + CDD 基础信息
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'basic-cdd-level',
    dateOfBirth: '1991-02-17', nationality: 'AU', idDocType: 'PASSPORT',
    idDocNumber: 'P-AU-9000009', residentialAddress: '1 Martin Place, Sydney',
  },
  // 1× 制裁定性 · 确认命中（DISCLOSED，客户端横幅可演）—— 战役甲波三 T10（spec §7）。
  // 不复用 Carol（她是"命中待裁"零痕迹演示位，翻成确认会破坏第二/三/五幕已建立的
  // 讲法）也不复用 Ivy（她的 MATERIAL_EXPIRED 演示位就是要对照"部分阻断"，SANCTION_
  // CONFIRMED 的 scope=ALL 会把充值也一并挡住，混进她名下会破坏 3.7 站的对照点）。
  // 直铺终态：SANCTION_CONFIRMED 便签 OPEN（customerLevel=true，caseRef 由 seedCustomers
  // 归一成 customerNo）——不再铺一张先被解列的 SILENT SANCTION 便签，同 Ivy/Carol
  // 先例只铺终态、不铺历史。
  {
    email: 'demo_leo@example.com', phone: '+15552000012',
    firstName: 'Leo', lastName: 'Confirmed', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'HIGH', tradingTier: 'BASIC', eddRequired: true,
    sumsubApplicantId: mockSumsubApplicantId('demo_leo@example.com'),
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'edd-sof-sow-level',
    dateOfBirth: '1982-05-19', nationality: 'IR', idDocType: 'PASSPORT',
    idDocNumber: 'P-IR-1000010', residentialAddress: 'Al Wasl Road 44, Dubai',
    restrictions: [
      {
        cause: 'SANCTION_CONFIRMED',
        reason: 'Confirmed match against EOCN sanctions list — MLRO sanction disposition CONFIRMED; SILENT SANCTION restriction delisted and replaced by this DISCLOSED one.',
        openedAtOffsetBusinessDays: 1,
      },
    ],
  },
  // 1× 制裁定性 · 部分命中在途（SILENT，PNMR 挂钟 + 中性补料在途）—— 战役甲波三 T10
  // （spec §7）。维持 SILENT（部分命中不翻牌可见性，官方口径同 Carol）；与 Carol 的
  // "命中待裁"区分——她是定性裁决**之前**，Mona 是定性裁决**已出 PARTIAL 结果之后**
  // （PNMR 已开、补料已发，便签仍 OPEN 等 EOCN 回指令）。
  {
    email: 'demo_mona@example.com', phone: '+15552000013',
    firstName: 'Mona', lastName: 'Partial', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'MEDIUM', tradingTier: 'BASIC', eddRequired: true,
    sumsubApplicantId: mockSumsubApplicantId('demo_mona@example.com'),
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'edd-sof-sow-level',
    dateOfBirth: '1988-08-08', nationality: 'PK', idDocType: 'PASSPORT',
    idDocNumber: 'P-PK-1100011', residentialAddress: 'Jumeirah Beach Road 210, Dubai',
    restrictions: [
      {
        cause: 'SANCTION',
        reason: 'Sanctions screening hit — MLRO sanction disposition PARTIAL (name match inconclusive); PNMR filed to EOCN, Emirates ID re-verification requested, restriction stays SILENT pending EOCN instruction.',
        // PNMR 钟锚在这个 openedAt 上（openForSanction 的 EXTERNAL 锚同款口径）——回拨
        // 3 个工作日，5 工作日钟铺场时还剩约 2-3 个工作日在跑（T10 任务书判据）。实测
        // 验证跨全部 7 个铺场星期几：offset=3 恒得 remaining∈{2,3}；offset=2 在周末铺场
        // 会得 4（backward 从非工作日"now"起算不天然对称于 forward），offset=3 是唯一
        // 在全部铺场日都落在任务书判据区间内的取值——不是拍脑袋，是穷举验证过的。
        openedAtOffsetBusinessDays: 3,
      },
    ],
  },
];

/** 演示客户的 mock Sumsub applicant id——纯 email 确定性哈希，不是真沙盒 applicant。 */
function mockSumsubApplicantId(email: string): string {
  return createHash('sha256').update(`mock-applicant:${email}`).digest('hex').slice(0, 24);
}

/** T10（战役甲波三）：铺场时刻往前推 N 个工作日（迪拜日历，周六日为周末，与
 *  business-days.ts#addBusinessDays 同一套判周末逻辑，独立小函数反向实现——该文件
 *  只导出正向版本，不为一个种子用途改动生产代码）。days=0 原样返回 from。 */
function businessDaysBefore(from: Date, days: number): Date {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let t = from.getTime();
  let remaining = days;
  while (remaining > 0) {
    t -= DAY_MS;
    const dubaiDay = new Date(t + DUBAI_UTC_OFFSET_MS).getUTCDay(); // 0=Sun ... 6=Sat
    if (dubaiDay !== 0 && dubaiDay !== 6) remaining -= 1;
  }
  return new Date(t);
}

/** T10：AML 报文族种子的 Sumsub 案件引用 / EOCN 名单条目引用样式号——确定性派生
 *  （同一 seedKey 每次重铺逐字不变），不是真号，纯样式演示（STR/SAR 引 Sumsub 案件，
 *  CNMR/PNMR 引 EOCN 名单条目，见 filing-type-registry.ts requiresExternalCaseRef 注释）。 */
function mockExternalCaseRef(style: 'SUMSUB' | 'EOCN', seed: string): string {
  const hex = createHash('sha256').update(`case-ref:${style}:${seed}`).digest('hex');
  if (style === 'SUMSUB') return `SUMSUB-CASE-${hex.slice(0, 8)}`;
  const num = parseInt(hex.slice(0, 6), 16) % 100000;
  return `EOCN-2026-${String(num).padStart(5, '0')}`;
}

/** T10：goAML/EOCN 回执号样式——同上，确定性派生、纯样式，不是真号。 */
function mockReceiptRef(style: 'GOAML' | 'EOCN', seed: string): string {
  const hex = createHash('sha256').update(`receipt-ref:${style}:${seed}`).digest('hex');
  const num = parseInt(hex.slice(0, 6), 16) % 100000;
  return `${style}-ACK-2026-${String(num).padStart(5, '0')}`;
}

/** MLRO 的 seed.base.ts 固定 userNo（mlro@fiatx.com）——AML 报文族种子用真实 userNo
 *  显式演"MLRO 亲办 / MLRO 放行"（T10 任务书判据），不用其余种子通用的 'SEED' 占位
 *  （那是"没有 operator、走查看不出谁办的"的通用族/事故域占位风格；本组种子恰恰要
 *  在管理台上认得出"这是 MLRO 本人办的"，故直取真实 userNo，与 openForSanction() 里
 *  actor.userNo ?? actor.userId 落库口径一致）。 */
const MLRO_USER_NO = 'ADM2501010004';

async function seedCustomers(prisma: PrismaClient): Promise<void> {
  const passwordHash = await bcrypt.hash('123456', 10);
  const now = new Date();

  const assets = await prisma.asset.findMany({
    where: { status: 'ACTIVE' },
    select: { code: true, currency: true },
  });

  let restrictionRowCount = 0;

  for (const c of DEMO_CUSTOMERS) {
    const data = {
      customerNo: buildDeterministicNo('CU', c.email),
      phone: c.phone,
      firstName: c.firstName,
      lastName: c.lastName,
      passwordHash,
      passwordUpdatedAt: now,
      customerType: c.customerType,
      lifecycle: c.lifecycle,
      riskRating: c.riskRating,
      tradingTier: c.tradingTier,
      eddRequired: c.eddRequired,
      companyName: c.companyName ?? null,
      sumsubApplicantId: c.sumsubApplicantId ?? null,
      onboardingApprovedAt: c.onboardingApprovedAt ?? null,
      sumsubCurrentLevelName: c.sumsubCurrentLevelName ?? null,
      dateOfBirth: c.dateOfBirth ?? null,
      nationality: c.nationality ?? null,
      idDocType: c.idDocType ?? null,
      idDocNumber: c.idDocNumber ?? null,
      residentialAddress: c.residentialAddress ?? null,
    };

    const customer = await prisma.customerMain.upsert({
      where: { email: c.email },
      update: data,
      create: { email: c.email, ...data },
      select: { id: true, customerNo: true },
    });

    // 限制账 fixture。种子是"直接铺终态数据"，不走 workflow —— 没有 operator、
    // 没有审批案、不写审计，与 DEMO_CUSTOMERS 其余字段同一性质（运行期贴便签
    // 必须走 CustomerRestrictionWorkflowService，那条路不受此处影响）。
    // 重铺可重复执行：先清该客户名下全部便签行，再按 fixture 重建。
    await prisma.customerRestriction.deleteMany({ where: { customerId: customer.id } });
    for (const r of c.restrictions ?? []) {
      const policy = RESTRICTION_CAUSE_POLICY[r.cause];
      const restrictionNo = generateReferenceNo('RST');
      const scopes = r.scopes ?? policy.defaultScopes;
      for (const scope of scopes) {
        await prisma.customerRestriction.create({
          data: {
            restrictionNo,
            customerId: customer.id,
            scope,
            cause: r.cause,
            visibility: policy.visibility,
            releasePolicy: policy.releasePolicy,
            status: 'OPEN',
            reason: r.reason,
            // 客户级因由（SANCTION）的 caseRef 必须与 openWithin 的归一结果一致，
            // 否则 seed 铺出来的那张便签与运行时贴的那张会各算一张，
            // 破坏「一个客户只有最早的一张」这条不变量。
            // seed 不走 open()，归一管不到这里，只能手工对齐。
            caseRef: policy.customerLevel ? customer.customerNo : (r.caseRef ?? null),
            openedAt: r.openedAtOffsetBusinessDays != null ? businessDaysBefore(now, r.openedAtOffsetBusinessDays) : now,
            openedBy: 'SEED',
            traceId: `seed-${restrictionNo}`,
          },
        });
        restrictionRowCount += 1;
      }
    }

    // VIP 手打标签 fixture（2026-09-06 解绑：VIP 不再由 tradingTier 派生）。
    // 与限制账 fixture 同一性质：直接铺终态，不走 service、不写审计。
    if (c.email === 'demo_grace@example.com') {
      await prisma.customerExplicitTag.upsert({
        where: { customerId_tagCode: { customerId: customer.id, tagCode: 'VIP' } },
        update: {},
        create: { customerId: customer.id, tagCode: 'VIP' },
      });
    }

    // Customer-level TB accounts: CLIENT_PAYABLE + DEPOSIT_SUSPENSE per asset.
    for (const asset of assets) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        await ensureTbAccountRegistry(prisma, {
          code,
          ledger,
          ownerType: 'CUSTOMER',
          ownerUuid: customer.id,
          ownerNo: customer.customerNo,
          assetCode: asset.code,
          description: `${code === TB_ACCOUNT_CODES.CLIENT_PAYABLE ? 'CLIENT_PAYABLE' : 'DEPOSIT_SUSPENSE'} for ${customer.customerNo}/${asset.code}`,
        });
      }
    }
  }

  console.log(
    `Seeded ${DEMO_CUSTOMERS.length} demo customers ` +
      `(+${restrictionRowCount} restriction rows) + customer TB accounts.`,
  );
}

// ─────────────────────────────────────────────────────────────
// ③b Material requests layer — 材料请求账两条演示行(设计稿 §10 用例①的两半)
//
// Ivy 已有 MATERIAL_EXPIRED 便签(见上方 seedCustomers)——这里给她补一条挂在该
// 便签上的 PROOF_OF_ADDRESS 行，演红档：客户被摁住、横幅红着、有材料要交。
// Bob 是无便签的 happy 客户——给他播一条不绑单不挂限制的 EMIRATES_ID 提醒行，
// 演黄档：纯提醒，不影响任何交易能力。两条分属不同客户，直接对应
// material-requests.e2e-spec.ts 用例①反证的「单指针病」——那条用例在同一个
// 客户身上做，这里的种子只负责把两种档位摆上台面给人肉验收看。
//
// 直接铺终态数据，不走 MaterialRequestIssuerService（那条路要真打/真模拟
// Sumsub）——与上面 seedCustomers() 里的便签 fixture 同一性质，没有 operator、
// 没有审批案、不写审计。requestNo / externalActionId 用 buildDeterministicNo
// 派生，reset 重铺后号不变；applicantActionId 写 mock-action-<派生值>。
// ─────────────────────────────────────────────────────────────

type DemoMaterialRequest = {
  email: string;
  materialType: string;
  levelName: string;
  /** 若给了，查该客户名下这个 cause 的 OPEN 便签，挂到这一行上（restrictionNo 后补） */
  restrictionCause?: RestrictionCause;
  reason: string;
  /** T10（战役甲波三）：省略即 'SYSTEM_SCHEDULED'（既有两行行为零漂移）。Mona 的
   *  一行是制裁定性 PARTIAL 出口自动发的补料（spec §2：landPartial() 走
   *  MaterialRequestIssuerService.issue({origin:'OPERATOR_ISSUED', restrict:false})），
   *  origin/issuedBy 照真实落地口径铺，不是 cron 到期提醒。 */
  origin?: 'SUMSUB_PUSHED' | 'OPERATOR_ISSUED' | 'SYSTEM_SCHEDULED';
  issuedBy?: string;
};

const DEMO_MATERIAL_REQUESTS: DemoMaterialRequest[] = [
  {
    email: 'demo_ivy@example.com',
    materialType: 'PROOF_OF_ADDRESS',
    levelName: 'wave3-action-poa-refresh',
    restrictionCause: 'MATERIAL_EXPIRED',
    reason: 'Passport expired on 2026-06-30 — please upload a valid proof of address',
  },
  {
    email: 'demo_bob@example.com',
    materialType: 'EMIRATES_ID',
    levelName: 'wave3-action-id-refresh',
    reason: 'Emirates ID renewal due within 30 days — please resubmit ahead of expiry',
  },
  // T10（战役甲波三）：PARTIAL 在途客户（Mona）的中性补料——不挂 restrictionCause（不
  // 新开便签：她已有的 SILENT SANCTION 便签 scope=ALL 早已卡住全部能力，补料只是发
  // 一份中性话术，见 sanction-disposition-workflow.service.ts#landPartial 头注释）；
  // blocking:false 即此处 restrictionNo 始终 null——T10 任务书判据。
  {
    email: 'demo_mona@example.com',
    materialType: 'EMIRATES_ID',
    levelName: 'wave3-sanction-partial-id-recheck',
    reason: 'Additional identity verification is required to complete an ongoing account review.',
    origin: 'OPERATOR_ISSUED',
    issuedBy: MLRO_USER_NO,
  },
];

/** requestNo / externalActionId / applicantActionId 三个 id 同法派生 —— 都过 buildDeterministicNo，只是前缀不同，reset 重铺后逐字不变。 */
function deriveMaterialRequestIds(email: string, materialType: string) {
  const seed = `${email}:${materialType}`;
  return {
    requestNo: buildDeterministicNo('MRQ', seed),
    externalActionId: `MRQ:${buildDeterministicNo('EXT', seed)}`,
    applicantActionId: `mock-action-${buildDeterministicNo('ACT', seed)}`,
  };
}

async function seedMaterialRequest(prisma: PrismaClient): Promise<void> {
  let count = 0;
  for (const r of DEMO_MATERIAL_REQUESTS) {
    const customer = await prisma.customerMain.findUnique({
      where: { email: r.email },
      select: { id: true, sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      console.log(
        `  ⚠ Skipping material request seed for ${r.email} — customer or sumsubApplicantId missing`,
      );
      continue;
    }

    let restrictionNo: string | null = null;
    if (r.restrictionCause) {
      const restriction = await prisma.customerRestriction.findFirst({
        where: { customerId: customer.id, cause: r.restrictionCause, status: 'OPEN' },
        select: { restrictionNo: true },
      });
      restrictionNo = restriction?.restrictionNo ?? null;
    }

    const { requestNo, externalActionId, applicantActionId } = deriveMaterialRequestIds(
      r.email,
      r.materialType,
    );

    // 幂等重铺：requestNo 是确定性派生的，同一条 fixture 键必只对应一行。
    await prisma.materialRequest.deleteMany({ where: { requestNo } });
    await prisma.materialRequest.create({
      data: {
        requestNo,
        customerId: customer.id,
        sumsubApplicantId: customer.sumsubApplicantId,
        materialType: r.materialType,
        levelName: r.levelName,
        applicantActionId,
        externalActionId,
        orderDomain: null,
        orderRef: null,
        restrictionNo,
        origin: r.origin ?? 'SYSTEM_SCHEDULED',
        status: 'PENDING_SUBMISSION',
        reason: r.reason,
        issuedBy: r.issuedBy ?? 'SEED',
        traceId: `seed-${requestNo}`,
      },
    });
    count += 1;
  }
  console.log(`Seeded ${count} material request rows.`);
}

// ─────────────────────────────────────────────────────────────
// ③c Incidents layer — 战役甲波一 Task 11（终审补 PRUDENTIAL_BREACH）：五条非初始态样例
// （十类终盘的五个族各挑一个，覆盖 IMPACT/MONETARY/SHORTFALL 三档口径与
// REGISTERED/INVESTIGATING/ASSESSED/RESOLVING 四个状态）。
// 与上方限制账 / 材料请求 fixture 同一性质：种子直接铺终态数据，不走
// IncidentService/IncidentRegistrationWorkflowService（没有 operator、没有审批案、不写
// 审计）——CYBER_BCDR 那一类故意不进种子，留给演示脚本现场走一遍完整登记流程，演
// "登记会留痕"这件事（brief 明文）。incidentNo 用 buildDeterministicNo 派生，reset 重铺后
// 逐字不变，幂等重铺手法同 seedMaterialRequest（先 deleteMany 该号再 create）。
// ─────────────────────────────────────────────────────────────

type DemoIncidentSample = {
  seedKey: string; // buildDeterministicNo 的派生种子，同时用作日志标识
  type: string;
  status: string;
  title: string;
  description: string;
  customerEmail?: string; // 需要落 customerNo 顶层列时给
  assetCode?: string;
  amount?: string;
  subjectRefs?: Record<string, string | number | boolean>;
  assessmentBasis?: string;
  impactSummary?: string;
  impactCount?: number;
  reportRequired?: boolean;
  reportBasisCodes?: string[];
  remediation?: { kind: string; referenceNoSeed: string };
};

const DEMO_INCIDENTS: DemoIncidentSample[] = [
  // DATA 族·IMPACT 口径·ASSESSED：双通报依据码已勾（PDPL_ART_9+TIR_II_C_24H）——两张
  // filing 归位在 seedRegulatoryFilings（战役甲波二 T10，见下方 ③d）：PDPL 单已 SUBMITTED
  // （无钟）、TIR 链单 SIGNED_OFF 待提交（24h 钟在跑，还剩约 4h）。Request Close 仍灰态——
  // 现在按 incident-close-workflow.service.ts 的真实守卫判断（甲波二 T6 改判报送单口径）：
  // 该事故名下非作废 filing 未全部 submittedAt，TIR 那张还没提交，缺一张就不放行。
  {
    seedKey: 'data-breach-crm-export',
    type: 'DATA_BREACH', status: 'ASSESSED',
    title: 'CRM export exposed customer contact fields to an unauthorized third-party analytics endpoint',
    description: 'Weekly CRM segmentation export job was misconfigured to POST a customer contact-fields extract to a decommissioned analytics vendor endpoint for three consecutive runs before being caught by an egress alert.',
    subjectRefs: { affectedCustomerCount: 46, dataCategories: 'CONTACT,ID_DOCUMENT' },
    assessmentBasis: 'DATA_IMPACT',
    impactSummary: '46 customer records (name, phone, partial ID document metadata) sent to a decommissioned third-party analytics endpoint across 3 export runs; vendor has confirmed non-retention but no independent verification yet.',
    impactCount: 46,
    reportRequired: true,
    reportBasisCodes: ['PDPL_ART_9', 'TIR_II_C_24H'],
  },
  // TECH_SECURITY 族·IMPACT 口径·INVESTIGATING：还没到定损，只有登记时就必填的两个锚。
  {
    seedKey: 'outsourcing-kyc-relay-degraded',
    type: 'OUTSOURCING_FAILURE', status: 'INVESTIGATING',
    title: 'Outsourced KYC webhook relay degraded — applicant status updates delayed',
    description: 'The third-party webhook relay that forwards Sumsub applicant status callbacks into our KYC pipeline began queueing instead of delivering in real time; onboarding team noticed a backlog of stale PENDING applicants.',
    subjectRefs: { vendor: 'SUMSUB', serviceImpact: 'Sumsub applicant status webhooks delayed 30-90 minutes; no callbacks lost, all recovered from the vendor replay queue after escalation' },
  },
  // OPERATIONS 族·IMPACT 口径·RESOLVING：已定损、已挂一条 ASSET_SUSPENSION_REF 善后单，
  // 结案前还差结案审批这一步（走查/剧本可以从这里直接演「提结案」）。
  {
    seedKey: 'asset-noncompliance-usdt-tron',
    type: 'ASSET_NONCOMPLIANCE', status: 'RESOLVING',
    title: 'USDT-TRON flagged non-compliant after counterparty travel-rule list update',
    description: 'A routine counterparty VASP list refresh flagged the TRON network route for USDT as no longer meeting our travel-rule counterparty screening bar — duty is immediate suspension, not a reporting obligation.',
    assetCode: 'USDT-TRON', // 唯一 requiredAnchor 且命中 TOP_LEVEL_ANCHOR_KEYS——只落顶层列，
    // 不重复塞进 subjectRefs（Ruling-8：顶层锚分流，同一个键不许两处都写）。
    assessmentBasis: 'SERVICE_IMPACT',
    impactSummary: 'USDT-TRON deposits/withdrawals suspended pending counterparty re-screening; no customer funds at risk, in-flight orders drained before suspension took effect.',
    remediation: { kind: 'ASSET_SUSPENSION_REF', referenceNoSeed: 'asset-suspension-usdt-tron' },
  },
  // OPERATIONS 族·MONETARY 口径·REGISTERED：顶层锚（customerNo/amount）+ subjectRefs.orderNo
  // 动态锚，刚登记、还没开始调查——覆盖四态里最早的一态。
  {
    seedKey: 'stuck-withdraw-alice',
    type: 'STUCK_TRANSACTION_MAJOR', status: 'REGISTERED',
    title: 'Withdrawal payout leg stuck in CONFIRMING for 6+ hours, no chain confirmation',
    description: 'A customer AED withdrawal payout leg has been sitting in CONFIRMING since this morning with no bank confirmation callback — past the point where a stuck-order determination is warranted per TIR K.1/I.H.1/CRM I.E.4.',
    customerEmail: 'demo_alice@example.com',
    amount: '15000.00',
    // orderNo（唯一非顶层锚）在函数体内用确定性号回填，这里不占位。
  },
  // FINANCIAL 族·SHORTFALL 口径·INVESTIGATING（终审补场景）：NLA（net liquid assets）跌破
  // VARA 监管线，CFO 经办——十类终盘里唯一挂 cap.incident.fin 独占能力码的族，closeActionType
  // 是唯一单步走 SENIOR_MANAGEMENT_OFFICER 核准的 INCIDENT_CLOSE_PRUDENTIAL（其余族结案链
  // 要么两步 MLRO→CFO，要么单步 CFO/CISO），演示位见 demo/data.md。
  {
    seedKey: 'nla-shortfall-q3',
    type: 'PRUDENTIAL_BREACH', status: 'INVESTIGATING',
    title: 'Net liquid assets fell below the VARA prudential floor after a same-day FX settlement shortfall',
    description: 'CFO flagged during the Wednesday liquidity review that net liquid assets (NLA) dropped below the regulatory floor after an FX settlement leg failed to net down same-day; still quantifying the shortfall before it can be assessed.',
    subjectRefs: { metric: 'NLA', shortfallAmount: '250000' },
  },
];

async function seedIncidents(prisma: PrismaClient): Promise<void> {
  let count = 0;
  for (const sample of DEMO_INCIDENTS) {
    const incidentNo = buildDeterministicNo('INC', sample.seedKey);

    let customerNo: string | null = null;
    if (sample.customerEmail) {
      const customer = await prisma.customerMain.findUnique({
        where: { email: sample.customerEmail }, select: { customerNo: true },
      });
      if (!customer) {
        console.log(`  ⚠ Skipping incident seed ${sample.seedKey} — customer ${sample.customerEmail} missing`);
        continue;
      }
      customerNo = customer.customerNo;
    }

    // STUCK_TRANSACTION_MAJOR 样例的 subjectRefs.orderNo 是动态锚（不落顶层列），用同一
    // 前缀（WDR，见 withdraw-workflow.service.ts）派生一个确定性单号，只作留痕引用，不校验存在。
    const subjectRefs = sample.type === 'STUCK_TRANSACTION_MAJOR'
      ? { ...sample.subjectRefs, orderNo: buildDeterministicNo('WDR', `seed-${sample.seedKey}`) }
      : sample.subjectRefs;

    await prisma.incident.deleteMany({ where: { incidentNo } });
    const incident = await prisma.incident.create({
      data: {
        incidentNo,
        type: sample.type,
        status: sample.status,
        title: sample.title,
        description: sample.description,
        customerNo,
        assetCode: sample.assetCode ?? null,
        amount: sample.amount != null ? new Prisma.Decimal(sample.amount) : null,
        subjectRefs: subjectRefs ? JSON.stringify(subjectRefs) : null,
        assessmentBasis: sample.assessmentBasis ?? null,
        impactSummary: sample.impactSummary ?? null,
        impactCount: sample.impactCount ?? null,
        reportRequired: sample.reportRequired ?? false,
        reportBasisCodes: sample.reportBasisCodes?.length ? sample.reportBasisCodes.join(',') : null,
        registeredByUserId: 'SEED',
        traceId: `seed-${incidentNo}`,
      },
    });

    if (sample.remediation) {
      await prisma.incidentRemediation.create({
        data: {
          incidentId: incident.id,
          kind: sample.remediation.kind,
          referenceNo: buildDeterministicNo('APR', `seed-${sample.remediation.referenceNoSeed}`),
          linkedByUserId: 'SEED',
        },
      });
    }
    count += 1;
  }
  console.log(`Seeded ${count} incident sample rows (non-initial states; CYBER_BCDR left for the live demo script).`);
}

// ─────────────────────────────────────────────────────────────
// ③d Regulatory filings layer — 战役甲波二 Task 10（评审黄5 改判，spec §10）：
// 甲案后 data-breach-crm-export 是「零单」不可达态（DATA_BREACH ASSESSED 已勾两个
// 通报依据码却没有一张 filing）——补两张单归位，演双钟链；另加一条入站来函样例。
// 与 seedIncidents 同一性质：种子直铺快照数据，不走 RegulatoryFilingService/
// RegulatoryFilingWorkflowService（没有 operator、没有审批案、不写审计——「登记会
// 留痕」由 e2e 证，同 seedIncidents 头注释先例）。filingNo 用 buildDeterministicNo
// 派生，reset 重铺后逐字不变；幂等重铺先删 entries 再删 filing（RegulatoryFilingEntry
// FK → RegulatoryFiling 无 cascade，子先删，同 incidentNote/incidentRemediation 先例）。
// authority/label/deadline 算法照抄 regulatory-filing.service.ts 的真实逻辑（见该文件
// computeDeadline/markSubmitted 注释），不重新杜撰一套。
// ─────────────────────────────────────────────────────────────

async function seedRegulatoryFilings(prisma: PrismaClient): Promise<void> {
  const incidentNo = buildDeterministicNo('INC', 'data-breach-crm-export');
  const incident = await prisma.incident.findUnique({ where: { incidentNo }, select: { id: true } });
  if (!incident) {
    console.log('  ⚠ Skipping regulatory filing seed — incident data-breach-crm-export missing');
    return;
  }

  async function upsertFiling(filingNo: string, data: Prisma.RegulatoryFilingCreateInput) {
    const existing = await prisma.regulatoryFiling.findUnique({ where: { filingNo }, select: { id: true } });
    if (existing) {
      await prisma.regulatoryFilingEntry.deleteMany({ where: { filingId: existing.id } });
      await prisma.regulatoryFiling.delete({ where: { filingNo } });
    }
    return prisma.regulatoryFiling.create({ data });
  }

  const incidentReportCfg = getFilingTypeConfig('INCIDENT_REPORT'); // direction OUTBOUND
  const now = Date.now();

  // 样例一 · PDPL_ART_9（SUBMITTED）——statute 无钟（hours=null，见 INCIDENT_REPORT_BASES），
  // deadlineAt 照真实 computeDeadline 结果留 null。
  const pdplBase = INCIDENT_REPORT_BASES.PDPL_ART_9;
  const pdplFilingNo = buildDeterministicNo('FIL', 'data-breach-crm-export-pdpl');
  const pdplSubmittedAt = new Date(now - 20 * 3600 * 1000);
  const pdplFiling = await upsertFiling(pdplFilingNo, {
    filingNo: pdplFilingNo,
    direction: incidentReportCfg.direction,
    type: 'INCIDENT_REPORT',
    authority: pdplBase.authority,
    basisCode: 'PDPL_ART_9',
    incidentNo,
    title: `${incidentReportCfg.label} — ${incidentNo}`,
    body: 'Notification under PDPL Article 9: a weekly CRM segmentation export job was misconfigured and sent contact-field extracts for 46 customer records (name, phone, partial ID document metadata) to a decommissioned third-party analytics vendor endpoint across three consecutive export runs before an egress alert caught it. The vendor has confirmed non-retention of the data; independent verification of deletion is still pending.',
    deadlineAt: null,
    externalRef: 'DATAOFFICE-ACK-2026-0001',
    submittedAt: pdplSubmittedAt,
    submittedByUserId: 'SEED',
    status: FilingStatus.SUBMITTED,
    createdByUserId: 'SEED',
    traceId: `seed-${pdplFilingNo}`,
  });
  await prisma.regulatoryFilingEntry.create({
    data: {
      filingId: pdplFiling.id,
      kind: FilingEntryKinds.RECEIPT_ACK,
      body: 'UAE Data Office acknowledged receipt of the Art.9 personal data breach notification.',
      externalRef: 'DATAOFFICE-ACK-2026-0001',
      recordedByUserId: 'SEED',
    },
  });

  // 样例一 · TIR_II_C_24H（SIGNED_OFF 链单，演示效果：已签发待提交、钟在跑——比 DRAFT
  // 更能演出"批完了、还剩不到 4 小时"的紧迫感）——deadline = PDPL submittedAt + 24h，
  // 照真实 markSubmitted 落定兄弟单 deadline 的算法（chainStart='NOTICE'，钟起点是
  // 通知发出时刻，不是登记/定损时刻）；now-20h+24h ≈ now+4h，还剩约 4 小时在跑。
  const tirBase = INCIDENT_REPORT_BASES.TIR_II_C_24H;
  const tirFilingNo = buildDeterministicNo('FIL', 'data-breach-crm-export-tir');
  const tirDeadlineAt = new Date(pdplSubmittedAt.getTime() + (tirBase.hours as number) * 3600 * 1000);
  await upsertFiling(tirFilingNo, {
    filingNo: tirFilingNo,
    direction: incidentReportCfg.direction,
    type: 'INCIDENT_REPORT',
    authority: tirBase.authority,
    basisCode: 'TIR_II_C_24H',
    incidentNo,
    title: `${incidentReportCfg.label} — ${incidentNo}`,
    body: 'Technology incident report under TIR II.C: a misconfigured weekly CRM segmentation export job sent contact-field extracts for 46 customer records (name, phone, partial ID document metadata) to a decommissioned third-party analytics vendor endpoint over three consecutive export runs before detection via an egress alert. The export job has since been fixed; a full root-cause review is underway.',
    deadlineAt: tirDeadlineAt,
    status: FilingStatus.SIGNED_OFF,
    createdByUserId: 'SEED',
    traceId: `seed-${tirFilingNo}`,
  });

  // 样例二 · 入站来函：VARA 信息请求响应，DRAFT，48h 钟在跑（receivedAt=now-6h）。
  const infoCfg = getFilingTypeConfig('REG_INFO_REQUEST_RESPONSE'); // direction INBOUND, defaultHours 48
  const infoFilingNo = buildDeterministicNo('FIL', 'vara-info-request-q3');
  const infoReceivedAt = new Date(now - 6 * 3600 * 1000);
  const infoDeadlineAt = new Date(infoReceivedAt.getTime() + (infoCfg.defaultHours as number) * 3600 * 1000);
  await upsertFiling(infoFilingNo, {
    filingNo: infoFilingNo,
    direction: infoCfg.direction,
    type: 'REG_INFO_REQUEST_RESPONSE',
    authority: RegulatoryAuthorities.VARA,
    title: 'VARA information request — Q3 liquidity reporting follow-up',
    receivedAt: infoReceivedAt,
    deadlineAt: infoDeadlineAt,
    status: FilingStatus.DRAFT,
    createdByUserId: 'SEED',
    traceId: `seed-${infoFilingNo}`,
  });

  console.log('Seeded 3 regulatory filing sample rows (2 chained to data-breach-crm-export + 1 inbound VARA info request).');
}

// ─────────────────────────────────────────────────────────────
// ③e AML reporting family layer — 战役甲波三 Task 10（spec §7）：STR 已提交样例
// （Frank HighRisk，MLRO 亲办）｜ PNMR 在途样例（Mona，5 工作日钟在跑 + EOCN 指令
// 待决）｜ CNMR 已提交样例（Leo，SANCTION_CONFIRMED，客户端横幅可演）。SAR/HRC/HRCA
// 不铺种子，现场手工开单讲解（spec §7、照波二三类先例）。
//
// 与 seedRegulatoryFilings 同一性质：直铺快照数据，不走 RegulatoryFilingService/
// SanctionDispositionWorkflowService（没有 operator、没有审批案、不写审计——「留痕」
// 由 e2e 证，同上方头注释先例）。filingNo 用 buildDeterministicNo(seedKey) 派生，
// reset 重铺后逐字不变；deadline/anchor 算法照抄 openForSanction() 的真实逻辑
// （EXTERNAL 锚 = anchorAt + 5 个工作日，anchorAt = 制裁便签 openedAt，spec §1②口径）。
//
// createdByUserId/submittedByUserId/recordedByUserId 三处不用其余种子通用的 'SEED'
// 占位，改用 MLRO 的真实 seed.base.ts userNo（见 MLRO_USER_NO 头注释）——T10 任务书
// 判据「MLRO 亲办 / MLRO 放行」要在管理台报送台页面上认得出办的人是谁，'SEED' 做不到。
// ─────────────────────────────────────────────────────────────

async function seedAmlFilingFamily(prisma: PrismaClient): Promise<void> {
  async function upsertAmlFiling(filingNo: string, data: Prisma.RegulatoryFilingCreateInput) {
    const existing = await prisma.regulatoryFiling.findUnique({ where: { filingNo }, select: { id: true } });
    if (existing) {
      await prisma.regulatoryFilingEntry.deleteMany({ where: { filingId: existing.id } });
      await prisma.regulatoryFiling.delete({ where: { filingNo } });
    }
    return prisma.regulatoryFiling.create({ data });
  }

  const now = Date.now();
  let seeded = 0;

  // ── STR 已提交样例（Frank HighRisk）──────────────────────────────────
  const frank = await prisma.customerMain.findUnique({
    where: { email: 'demo_frank@example.com' },
    select: { customerNo: true, sumsubApplicantId: true },
  });
  if (!frank) {
    console.log('  ⚠ Skipping STR filing seed — customer demo_frank@example.com missing');
  } else {
    const strCfg = getFilingTypeConfig('STR');
    const strSeedKey = 'str-frank-structuring';
    const strFilingNo = buildDeterministicNo('FIL', strSeedKey);
    // 叙事锚：MLRO 复筛 Sumsub 案件证据时发现的可疑模式，锚一笔样式提现单号（纯叙事，
    // 不对应任何真实建单——同 seedIncidents STUCK_TRANSACTION_MAJOR 样例的 orderNo 手法）。
    const strOrderRef = buildDeterministicNo('WDR', `seed-${strSeedKey}`);
    const strExternalCaseRef = mockExternalCaseRef('SUMSUB', strSeedKey);
    const strExternalRef = mockReceiptRef('GOAML', strSeedKey);
    const strSubmittedAt = new Date(now - 30 * 3600 * 1000);
    const strFiling = await upsertAmlFiling(strFilingNo, {
      filingNo: strFilingNo,
      direction: strCfg.direction,
      type: 'STR',
      authority: strCfg.defaultAuthority as string,
      externalCaseRef: strExternalCaseRef,
      title: `${strCfg.label} — ${strOrderRef} (${frank.customerNo}, suspected structuring)`,
      body: `MLRO reviewed Sumsub case evidence on ${frank.customerNo} after a pattern of withdrawals structured just under the transaction-review threshold across a short window. Formed suspicion under FDL 20/2018 — filing without delay, no statutory deadline (established by statute, not a service-computed clock).`,
      deadlineAt: null,
      submittedAt: strSubmittedAt,
      submittedByUserId: MLRO_USER_NO,
      externalRef: strExternalRef,
      status: FilingStatus.SUBMITTED,
      createdByUserId: MLRO_USER_NO,
      traceId: `seed-${strFilingNo}`,
    });
    await prisma.regulatoryFilingEntry.create({
      data: {
        filingId: strFiling.id,
        kind: FilingEntryKinds.CUSTOMER_COMM,
        body: 'Customer called asking why a recent withdrawal took longer than usual. Explained this was a routine compliance review with no fixed timeline — no reference made to any report, investigation, or law-enforcement interest (FDL 20/2018 tipping-off).',
        commDraftedBy: 'MLRO desk note (pre-cleared script, tipping-off-safe wording)',
        recordedByUserId: MLRO_USER_NO,
      },
    });
    await prisma.regulatoryFilingEntry.create({
      data: {
        filingId: strFiling.id,
        kind: FilingEntryKinds.RECEIPT_ACK,
        body: 'UAE FIU goAML portal acknowledged receipt of the STR filing.',
        externalRef: strExternalRef,
        recordedByUserId: MLRO_USER_NO,
      },
    });
    seeded += 1;
  }

  // ── PNMR 在途样例（Mona，SILENT SANCTION 便签 openedAt 锚）─────────────
  const mona = await prisma.customerMain.findUnique({
    where: { email: 'demo_mona@example.com' },
    select: { id: true, customerNo: true },
  });
  if (!mona) {
    console.log('  ⚠ Skipping PNMR filing seed — customer demo_mona@example.com missing');
  } else {
    const monaRestriction = await prisma.customerRestriction.findFirst({
      where: { customerId: mona.id, cause: 'SANCTION', status: 'OPEN' },
      select: { openedAt: true },
    });
    if (!monaRestriction) {
      console.log('  ⚠ Skipping PNMR filing seed — demo_mona@example.com has no OPEN SANCTION restriction');
    } else {
      const pnmrCfg = getFilingTypeConfig('PNMR');
      const pnmrSeedKey = 'pnmr-mona-partial';
      const pnmrFilingNo = buildDeterministicNo('FIL', pnmrSeedKey);
      const pnmrExternalCaseRef = mockExternalCaseRef('EOCN', pnmrSeedKey);
      const pnmrDeadlineAt = addBusinessDays(monaRestriction.openedAt, pnmrCfg.deadlineBusinessDays as number);
      const pnmrFiling = await upsertAmlFiling(pnmrFilingNo, {
        filingNo: pnmrFilingNo,
        direction: pnmrCfg.direction,
        type: 'PNMR',
        authority: pnmrCfg.defaultAuthority as string,
        externalCaseRef: pnmrExternalCaseRef,
        title: `${pnmrCfg.label} — ${mona.customerNo}`,
        body: `Partial name match against the EOCN sanctions list on account opening/KYC details — insufficient to confirm identity. Account suspended pending evidence (Emirates ID re-verification requested); PNMR filed to EOCN within 5 business days of suspension per EOCN TFS Guidelines 2025 (anchor = SANCTION restriction opened ${monaRestriction.openedAt.toISOString()}). 10-business-day evidence window runs in parallel, not a filing deadline.`,
        deadlineAt: pnmrDeadlineAt,
        status: FilingStatus.DRAFT,
        createdByUserId: MLRO_USER_NO,
        traceId: `seed-${pnmrFilingNo}`,
      });
      await prisma.regulatoryFilingEntry.create({
        data: {
          filingId: pnmrFiling.id,
          kind: FilingEntryKinds.AUTHORITY_INSTRUCTION,
          body: "EOCN acknowledged the PNMR submission and requested confirmation of the customer's full legal name and date of birth against the list entry before advising a final match outcome. Awaiting response before re-disposition (CLEARED or CONFIRMED).",
          externalRef: mockReceiptRef('EOCN', `${pnmrSeedKey}-instruction`),
          recordedByUserId: MLRO_USER_NO,
        },
      });
      seeded += 1;
    }
  }

  // ── CNMR 已提交样例（Leo，SANCTION_CONFIRMED 便签 openedAt 锚，客户端横幅可演）──
  const leo = await prisma.customerMain.findUnique({
    where: { email: 'demo_leo@example.com' },
    select: { id: true, customerNo: true },
  });
  if (!leo) {
    console.log('  ⚠ Skipping CNMR filing seed — customer demo_leo@example.com missing');
  } else {
    const leoRestriction = await prisma.customerRestriction.findFirst({
      where: { customerId: leo.id, cause: 'SANCTION_CONFIRMED', status: 'OPEN' },
      select: { openedAt: true },
    });
    if (!leoRestriction) {
      console.log('  ⚠ Skipping CNMR filing seed — demo_leo@example.com has no OPEN SANCTION_CONFIRMED restriction');
    } else {
      const cnmrCfg = getFilingTypeConfig('CNMR');
      const cnmrSeedKey = 'cnmr-leo-confirmed';
      const cnmrFilingNo = buildDeterministicNo('FIL', cnmrSeedKey);
      const cnmrExternalCaseRef = mockExternalCaseRef('EOCN', cnmrSeedKey);
      const cnmrExternalRef = mockReceiptRef('EOCN', cnmrSeedKey);
      const cnmrDeadlineAt = addBusinessDays(leoRestriction.openedAt, cnmrCfg.deadlineBusinessDays as number);
      // 提交时刻：冻结（openedAt）后数小时内上报，早于铺场当下——"已提交"要看得出
      // 已经过去一段时间，不是刚刚才提交。
      const cnmrSubmittedAt = new Date(leoRestriction.openedAt.getTime() + 3 * 3600 * 1000);
      const cnmrFiling = await upsertAmlFiling(cnmrFilingNo, {
        filingNo: cnmrFilingNo,
        direction: cnmrCfg.direction,
        type: 'CNMR',
        authority: cnmrCfg.defaultAuthority as string,
        externalCaseRef: cnmrExternalCaseRef,
        title: `${cnmrCfg.label} — ${leo.customerNo}`,
        body: `Confirmed name match against the EOCN sanctions list — full account freeze in effect (SANCTION_CONFIRMED restriction opened ${leoRestriction.openedAt.toISOString()}). CNMR filed to EOCN within 5 business days of freeze per EOCN TFS Guidelines 2025.`,
        deadlineAt: cnmrDeadlineAt,
        submittedAt: cnmrSubmittedAt,
        submittedByUserId: MLRO_USER_NO,
        externalRef: cnmrExternalRef,
        status: FilingStatus.SUBMITTED,
        createdByUserId: MLRO_USER_NO,
        traceId: `seed-${cnmrFilingNo}`,
      });
      await prisma.regulatoryFilingEntry.create({
        data: {
          filingId: cnmrFiling.id,
          kind: FilingEntryKinds.RECEIPT_ACK,
          body: 'EOCN acknowledged receipt of the Confirmed Name Match Report.',
          externalRef: cnmrExternalRef,
          recordedByUserId: MLRO_USER_NO,
        },
      });
      seeded += 1;
    }
  }

  console.log(`Seeded ${seeded} AML reporting family filing sample rows (STR submitted / PNMR in-flight / CNMR submitted).`);
}

// ─────────────────────────────────────────────────────────────
// ③f-1 Compliance calendar layer — 战役甲波四 Task 7（spec §7/§9）：合规日历义务台账
// 三行，全部对外申报（VARA 月/季/年三层监管报送，spec §9 核对表 #1）。MLRO 季报 /
// EWRA / 牌照年费三条经二手多源交叉调研后判组织件不建（裁定 10，收件方非监管），
// 不铺种子——总纲 §4 已随 spec 订正。
//
// 与 seedRegulatoryFilings 同一性质：直铺快照数据，不走 ComplianceObligationsService
// （没有 operator、不写审计——「留痕」由 e2e 证，同报送单种子区头注释先例）。
// obligationNo 用 buildDeterministicNo(seedKey) 派生，reset 重铺后逐字不变；用 upsert
// 保幂等（本表无子表，不需要 upsertFiling 那种先删子表再删主表的手法）。
//
// nextDueAt 相对「当前时钟」取下一自然期末，不锚死某个具体日期——义务台账的钟面是
// 活的（每次 reset 都保证落在未来），这是它与报送单快照最大的不同：报送单快照的
// submittedAt/deadlineAt 是固定叙事时刻，义务的 nextDueAt 必须随铺场当下滚动，否则
// 长期不 reset 的环境会让闹钟墙的义务行集体显示成"早已超期"，与「墙开箱绿/黄可见」
// 的验收口径矛盾。basisNote 只写 spec §9 查实的条款号，不补想象中的宽限天数
// （截止天数一手条文未规定——铁律「不杜撰」）。
// ─────────────────────────────────────────────────────────────

/** 月/季/年三种频率的「下一自然期末」：月度=每个自然月末；季度=3/6/9/12 月末；
 *  年度=12 月末——用 `months`（1/3/12）统一表达三种频率的期末月对齐步长。与
 *  `advanceDueDate`（compliance-office.constants.ts）形似但职责不同：那个函数消费
 *  一个已知起点向后翻一期，这里没有起点、只有「现在」，求的是最近的下一个期末，
 *  故不复用、各自成一个纯函数。 */
function nextPeriodEnd(now: Date, months: 1 | 3 | 12): Date {
  const y = now.getUTCFullYear();
  let periodEndMonth = Math.ceil((now.getUTCMonth() + 1) / months) * months; // 1-based 月份
  let periodEndYear = y;
  if (periodEndMonth > 12) { periodEndMonth -= 12; periodEndYear += 1; }
  // Date.UTC(year, M, 0) = 第 M 个月（1-based）的最后一天，见 advanceDueDate 同款手法。
  let candidate = new Date(Date.UTC(periodEndYear, periodEndMonth, 0, 23, 59, 59));
  if (candidate.getTime() <= now.getTime()) {
    periodEndMonth += months;
    if (periodEndMonth > 12) { periodEndMonth -= 12; periodEndYear += 1; }
    candidate = new Date(Date.UTC(periodEndYear, periodEndMonth, 0, 23, 59, 59));
  }
  return candidate;
}

const COMPLIANCE_OBLIGATION_SEEDS: Array<{
  seedKey: string; name: string; frequency: keyof typeof ObligationFrequencies; months: 1 | 3 | 12;
  basisNote: string;
}> = [
  {
    seedKey: 'vara-monthly-return',
    name: 'VARA Monthly Regulatory Return',
    frequency: 'MONTHLY', months: 1,
    basisNote: 'CRM Rulebook Part I, Rule I.H.1',
  },
  {
    seedKey: 'vara-quarterly-report',
    name: 'VARA Quarterly Report',
    frequency: 'QUARTERLY', months: 3,
    basisNote: 'CRM Rulebook Part I, Rule I.H.2',
  },
  {
    seedKey: 'vara-annual-report',
    name: 'VARA Annual Report incl. audited financials',
    frequency: 'ANNUAL', months: 12,
    basisNote: 'CRM Rulebook Part I, Rule I.H.3 + I.G.1',
  },
];

async function seedComplianceObligations(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  let seeded = 0;
  for (const sample of COMPLIANCE_OBLIGATION_SEEDS) {
    const obligationNo = buildDeterministicNo('OBL', sample.seedKey);
    await prisma.complianceObligation.upsert({
      where: { obligationNo },
      update: {
        name: sample.name,
        frequency: ObligationFrequencies[sample.frequency],
        authority: RegulatoryAuthorities.VARA,
        basisNote: sample.basisNote,
        leadBusinessDays: 5,
        nextDueAt: nextPeriodEnd(now, sample.months),
        status: ObligationStatus.ACTIVE,
      },
      create: {
        obligationNo,
        name: sample.name,
        frequency: ObligationFrequencies[sample.frequency],
        authority: RegulatoryAuthorities.VARA,
        basisNote: sample.basisNote,
        leadBusinessDays: 5,
        nextDueAt: nextPeriodEnd(now, sample.months),
        status: ObligationStatus.ACTIVE,
        createdByUserId: 'SEED',
        traceId: `seed-${obligationNo}`,
      },
    });
    seeded += 1;
  }
  console.log(`Seeded ${seeded} compliance obligation rows (VARA monthly/quarterly/annual returns, all ACTIVE, nextDueAt = next natural period end from current clock).`);
}

// ─────────────────────────────────────────────────────────────
// ③f-2 Outsourcing vendor register — 战役甲波四 Task 7（spec §4.1/§7）：三行，呼应
// 波一「外包商断供」事件（`outsourcing-kyc-relay-degraded`，subjectRefs.vendor=SUMSUB）
// ——呼应是纯叙事，不建外键（spec §4.1：两主体各管各的，YAGNI）。Sumsub / HexTrust 判
// MATERIAL（分别是 KYC/AML 筛查与客户资产托管的关键职能外包）；一家 office-IT 供应商
// 判 NON_MATERIAL 对照（非核心行政 IT 支持）。
//
// 与 seedComplianceObligations 同一性质：直铺快照数据，不走 OutsourcingVendorsService
// （没有 operator、不写审计）。vendorNo 用 buildDeterministicNo(seedKey) 派生，upsert
// 保幂等。
// ─────────────────────────────────────────────────────────────

const OUTSOURCING_VENDOR_SEEDS: Array<{
  seedKey: string; name: string; serviceDescription: string;
  criticality: 'MATERIAL' | 'NON_MATERIAL'; contractStart: string; notes: string;
}> = [
  {
    seedKey: 'vendor-sumsub',
    name: 'Sumsub',
    serviceDescription: 'KYC/AML identity verification and applicant screening (onboarding + periodic re-screening)',
    criticality: 'MATERIAL',
    contractStart: '2025-01-01',
    notes: 'Material Outsourcing assessment: core AML/KYC screening function — loss of service directly impairs onboarding and sanctions screening.',
  },
  {
    seedKey: 'vendor-hextrust',
    name: 'HexTrust',
    serviceDescription: 'Digital asset custody (TRON network wallet infrastructure)',
    criticality: 'MATERIAL',
    contractStart: '2025-01-01',
    notes: 'Material Outsourcing assessment: custodial control of client digital assets — loss of service directly impairs deposit/withdrawal availability.',
  },
  {
    seedKey: 'vendor-office-it',
    name: 'Gulf Office Systems',
    serviceDescription: 'Office IT support (workstation provisioning, network helpdesk)',
    criticality: 'NON_MATERIAL',
    contractStart: '2025-06-01',
    notes: 'Material Outsourcing assessment: non-critical corporate IT support, no client-facing or regulatory-critical function.',
  },
];

async function seedOutsourcingVendors(prisma: PrismaClient): Promise<void> {
  let seeded = 0;
  for (const sample of OUTSOURCING_VENDOR_SEEDS) {
    const vendorNo = buildDeterministicNo('VEN', sample.seedKey);
    await prisma.outsourcingVendor.upsert({
      where: { vendorNo },
      update: {
        name: sample.name,
        serviceDescription: sample.serviceDescription,
        criticality: sample.criticality,
        contractStart: new Date(sample.contractStart),
        notes: sample.notes,
        status: VendorStatus.ACTIVE,
      },
      create: {
        vendorNo,
        name: sample.name,
        serviceDescription: sample.serviceDescription,
        criticality: sample.criticality,
        contractStart: new Date(sample.contractStart),
        notes: sample.notes,
        status: VendorStatus.ACTIVE,
        createdByUserId: 'SEED',
        traceId: `seed-${vendorNo}`,
      },
    });
    seeded += 1;
  }
  console.log(`Seeded ${seeded} outsourcing vendor rows (Sumsub + HexTrust MATERIAL, Gulf Office Systems NON_MATERIAL, all ACTIVE).`);
}

// ─────────────────────────────────────────────────────────────
// ③f-3 Responsible individual register — 战役甲波四 Task 7（spec §4.2/§7）：四席位
// （MLRO / Compliance Officer / CFO / CISO），演示合理集、非法定名录（spec §4.2 钉死）。
// incumbentName 是自然人姓名，与 IAM 账号无外键、无联动（骨架岔口④）——种子里的现任
// 人名与本仓既有的角色管理员账号人设（`seed.base.ts` ROLE_SEED_ACCOUNTS 同角色代码）
// 对齐，不与既有客户演示人名（Alice…Mona）或迪拜团队真实超管人名（Roger…Rhea）撞。
// varaRef 用演示格式 `VARA-RI-0xx`。四席全 ACTIVE、零在途换人（`pendingApprovalNo`
// 留空——换人全弧由 e2e 现场演，spec 场景 22）。
//
// 与前两个 ③f 区块同一性质：直铺快照数据，不走 ResponsibleIndividualsService（没有
// operator、不写审计）。riNo 用 buildDeterministicNo(seedKey) 派生，upsert 保幂等。
// ─────────────────────────────────────────────────────────────

const RESPONSIBLE_INDIVIDUAL_SEEDS: Array<{
  seedKey: string; position: string; incumbentName: string; varaRef: string; effectiveFrom: string;
}> = [
  { seedKey: 'ri-mlro', position: 'MLRO', incumbentName: 'Farah Al Mansoori', varaRef: 'VARA-RI-001', effectiveFrom: '2025-01-01' },
  { seedKey: 'ri-compliance-officer', position: 'Compliance Officer', incumbentName: 'Youssef Haddad', varaRef: 'VARA-RI-002', effectiveFrom: '2025-01-01' },
  { seedKey: 'ri-cfo', position: 'CFO', incumbentName: 'Elena Novak', varaRef: 'VARA-RI-003', effectiveFrom: '2025-01-01' },
  { seedKey: 'ri-ciso', position: 'CISO', incumbentName: 'Marcus Tan', varaRef: 'VARA-RI-004', effectiveFrom: '2025-01-01' },
];

async function seedResponsibleIndividuals(prisma: PrismaClient): Promise<void> {
  let seeded = 0;
  for (const sample of RESPONSIBLE_INDIVIDUAL_SEEDS) {
    const riNo = buildDeterministicNo('RI', sample.seedKey);
    await prisma.responsibleIndividual.upsert({
      where: { riNo },
      update: {
        position: sample.position,
        incumbentName: sample.incumbentName,
        varaRef: sample.varaRef,
        effectiveFrom: new Date(sample.effectiveFrom),
        status: 'ACTIVE',
        pendingApprovalNo: null,
      },
      create: {
        riNo,
        position: sample.position,
        incumbentName: sample.incumbentName,
        varaRef: sample.varaRef,
        effectiveFrom: new Date(sample.effectiveFrom),
        status: 'ACTIVE',
        pendingApprovalNo: null,
        createdByUserId: 'SEED',
        traceId: `seed-${riNo}`,
      },
    });
    seeded += 1;
  }
  console.log(`Seeded ${seeded} responsible individual seat rows (MLRO/Compliance Officer/CFO/CISO, all ACTIVE, zero pending replacement).`);
}

// ─────────────────────────────────────────────────────────────
// Capital injection — DR FIRM_ASSET / CR FIRM_OPS per currency
// ─────────────────────────────────────────────────────────────

const SEED_FIRM_CAPITAL: Record<string, string> = {
  AED: '1000000',
  USDT: '100000',
};

async function seedCapitalInjection(prisma: PrismaClient): Promise<void> {
  const tbAddress = process.env.TB_ADDRESS;
  if (!tbAddress) {
    // 同 provisionTbAccounts：不 graceful skip。少了这笔注资，公司户从 0 起步，
    // 付完款即为负——而四条 COA 恒等式对「差额」依然成立，所以只有负余额断言会红，
    // 且红在很远的下游。2026-08-31 的假红事故就是这么来的。
    throw new Error(
      'TB_ADDRESS 未设置，无法做资本注入。seed 不做 graceful skip——' +
        '缺这笔注资会让公司户从 0 起步、后续 verify:coa 负余额断言在很远处才报错。' +
        '修法：确认调用方显式传 TB_ADDRESS（见 scripts/reset-stack.sh），或先 `stack.sh up` 让 .env 落地。',
    );
  }

  let client: ReturnType<typeof tbCreateClient>;
  try {
    client = tbCreateClient({ cluster_id: 0n, replica_addresses: [tbAddress] });
  } catch (err: any) {
    console.log(`  ⚠ Cannot connect to TigerBeetle for capital injection: ${err.message}`);
    return;
  }

  try {
    const assets = await prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      select: { currency: true, decimals: true, code: true, network: true },
    });

    const transfers: any[] = [];
    const evidenceRows: Array<{ asset: { currency: string; network: string }; transferId: bigint; amount: bigint; firmAssetId: string; firmOpsId: string }> = [];
    for (const asset of assets) {
      const rawAmount = SEED_FIRM_CAPITAL[asset.currency];
      if (!rawAmount) continue;

      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      const scale = BigInt(10 ** asset.decimals);
      const amount = BigInt(rawAmount) * scale;

      // Resolve FIRM_ASSET and FIRM_OPS account ids from registry
      const firmAssetReg = await (prisma as any).tbAccountRegistry.findFirst({
        where: { code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger, ownerType: 'SYSTEM' },
        select: { tbAccountId: true },
      });
      const firmOpsReg = await (prisma as any).tbAccountRegistry.findFirst({
        where: { code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' },
        select: { tbAccountId: true },
      });

      if (!firmAssetReg || !firmOpsReg) {
        console.log(`  ⚠ Missing registry entries for capital injection (${asset.currency}), skipping`);
        continue;
      }

      const transferId = deterministicTransferId('SEED_CAPITAL', asset.currency, 'CAPITAL_INJECTION', 0);

      transfers.push({
        id: transferId,
        debit_account_id: BigInt('0x' + firmAssetReg.tbAccountId),  // DR FIRM_ASSET
        credit_account_id: BigInt('0x' + firmOpsReg.tbAccountId),   // CR FIRM_OPS
        amount,
        pending_id: 0n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        timeout: 0,
        ledger,
        code: TB_TRANSFER_CODES.CAPITAL_INJECTION,
        flags: 0,
        timestamp: 0n,
      });

      evidenceRows.push({ asset, transferId, amount, firmAssetId: firmAssetReg.tbAccountId, firmOpsId: firmOpsReg.tbAccountId });
    }

    if (transfers.length === 0) {
      console.log('  ⚠ No capital injection transfers to create');
      return;
    }

    const TB_TRANSFER_EXISTS = 46; // CreateTransferStatus.exists
    const TB_DEV_OK = 4294967295;  // CreateTransferStatus.created (dev-mode echo)
    const errors = await client.createTransfers(transfers);
    const realErrors = errors.filter(
      (e: any) => e.status !== TB_TRANSFER_EXISTS && e.status !== TB_DEV_OK,
    );
    if (realErrors.length > 0) {
      console.log(`  ⚠ Capital injection had ${realErrors.length} errors: ${JSON.stringify(realErrors, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`);
    }

    const existed = errors.filter((e: any) => e.status === TB_TRANSFER_EXISTS).length;
    console.log(`  ✔ Capital injection: ${transfers.length - existed} transfer(s) created, ${existed} already existed`);

    // 平账二期搭车②(BACKLOG「资本注入少一行流水凭证」)：注资写进凭证与流水投影，
    // 对账页上运营户从此显示真实起点(此前只有 TB 转账、流水里查不到，外部余额页显示负数)。
    // 种子路径直写两表(与账户注册表同款、不经 Nest)；upsert 幂等；FIRM_ASSET 是聚合科目，
    // 引擎读侧本就丢弃聚合腿，walletRef 挂运营户行只为可追溯。
    for (const r of evidenceRows) {
      const opsWallet = await (prisma as any).wallet.findFirst({ where: { vaultCode: 'F_OPS', network: r.asset.network, ownerType: 'PLATFORM' }, select: { id: true } });
      if (!opsWallet) throw new Error(`注资凭证：找不到 ${r.asset.network} 上的运营户地址行——seedPlatformWallets 是否先跑？`);
      const tbTransferId = bigintToHex(r.transferId);
      const now = new Date();
      const shared = {
        sourceType: 'SEED_CAPITAL', sourceNo: r.asset.currency, eventCode: 'CAPITAL_INJECTION',
        amount: new Prisma.Decimal(r.amount.toString()), assetCode: r.asset.currency, transferType: 'POSTED',
        isExternalCrossing: true, externalRef: `SEED-CAPITAL-${r.asset.currency}`, effectiveDate: now.toISOString().slice(0, 10),
      };
      await (prisma as any).tbTransferEvidence.upsert({
        where: { tbTransferId }, update: {},
        create: {
          tbTransferId, ...shared, debitCode: 'A.FIRM_ASSET', creditCode: 'E.FIRM_OPS',
          debitTbAccountId: r.firmAssetId, creditTbAccountId: r.firmOpsId,
          traceId: `SEED_CAPITAL_${r.asset.currency}`, actorType: 'SYSTEM', actorId: 'RELEASE', memo: '公司注资(随版本装载)',
          debitWalletRef: opsWallet.id, creditWalletRef: opsWallet.id, createdAt: now,
        },
      });
      for (const [tbAccountId, direction] of [[r.firmAssetId, 'OUT'], [r.firmOpsId, 'IN']] as const) {
        await (prisma as any).accountFlow.upsert({
          where: { tbTransferId_tbAccountId: { tbTransferId, tbAccountId } }, update: {},
          create: { tbTransferId, tbAccountId, walletRef: opsWallet.id, direction, ...shared, createdAt: now },
        });
      }
    }
    console.log(`  ✔ Capital injection evidence: ${evidenceRows.length} evidence row(s) + ${evidenceRows.length * 2} flow row(s)`);
  } finally {
    client.destroy();
  }
}
