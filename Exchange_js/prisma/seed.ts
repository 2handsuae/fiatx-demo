import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ACCT_EVENTS } from '../src/config/manifests/events.manifest';
import { DEFAULT_JOURNAL_TEMPLATES } from '../src/config/manifests/journal-templates.manifest';

const prisma = new PrismaClient({
  log: ['info', 'warn', 'error'],
});

async function main() {
  console.log('🚀 Start seeding...');

  await seedAdmin();
  await seedCustomers();
  await seedAssets();
  await seedCOA();
  await seedAcctConfig();
  await seedClearing();

  console.log('✅ Seeding finished successfully.');
}

// 1. Seed Admin User
async function seedAdmin() {
  console.log('--- Seeding Admin ---');
  const password = await bcrypt.hash('123456', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@fiatx.com' },
    update: {
      password: password,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    create: {
      userNo: 'ADMIN-001',
      email: 'admin@fiatx.com',
      password: password,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`Admin user created: ${admin.email}`);
}

// 2. Seed Fake Customers
async function seedCustomers() {
  console.log('--- Seeding Customers ---');
  const statuses = [
    'NONE', 'STANDARD_VERIFYING', 'STANDARD_UNDER_REVIEW', 'STANDARD_REJECTED', 
    'STANDARD_APPROVED', 'ENHANCED_VERIFYING', 'ENHANCED_UNDER_REVIEW', 
    'ENHANCED_REJECTED', 'ENHANCED_APPROVED', 'EXPIRED'
  ];

  for (let i = 1; i <= 10; i++) {
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const email = `customer${i}@example.com`;
    await prisma.customerMain.upsert({
      where: { email },
      update: {},
      create: {
        customerNo: `CUST-${i.toString().padStart(4, '0')}`,
        email,
        phone: `+155500000${i.toString().padStart(2, '0')}`,
        firstName: `Customer${i}`,
        lastName: `Test`,
        authStatus: status,
        authLevel: status.includes('ENHANCED_APPROVED') ? 'ENHANCED' : (status.includes('STANDARD_APPROVED') ? 'STANDARD' : 'NONE'),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    });
  }
  console.log('Seeded 10 fake customers');
}

// 3. Seed Assets
async function seedAssets() {
  console.log('--- Seeding Assets ---');
  const assets = [
    { type: 'FIAT', code: 'AED', decimals: 2, description: 'UAE Dirham', status: 'ACTIVE' },
    { type: 'FIAT', code: 'USD', decimals: 2, description: 'US Dollar', status: 'ACTIVE' },
    { type: 'CRYPTO', code: 'USDT', decimals: 6, network: 'TRON', description: 'Tether USD (TRC20)', status: 'ACTIVE' },
    { type: 'CRYPTO', code: 'USDT', decimals: 6, network: 'ETHEREUM', description: 'Tether USD (ERC20)', status: 'ACTIVE' },
    { type: 'CRYPTO', code: 'BTC', decimals: 8, network: 'BITCOIN', description: 'Bitcoin', status: 'ACTIVE' }
  ];

  for (const asset of assets) {
    await (prisma as any).asset.upsert({
      where: { 
        // Note: Using composite check because code alone is not unique across networks
        id: (await (prisma as any).asset.findFirst({ where: { code: asset.code, network: asset.network } }))?.id || '00000000-0000-0000-0000-000000000000'
      },
      update: asset,
      create: asset,
    });
    console.log(`Synced Asset: ${asset.code} (${asset.network || 'NONE'})`);
  }
}

// 4. Seed Chart of Accounts (COA)
async function seedCOA() {
  console.log('--- Seeding COA ---');
  const coaData = [
    { code: 'A.BANK', type: 'ASSET', name: '银行账户资产', tags: ['assetid', 'walletid'] },
    { code: 'A.BANK_IN_TRANSIT', type: 'ASSET', name: '银行账户在途资产', tags: ['assetid', 'walletid'] },
    { code: 'A.BANK_SUSPENSE', type: 'ASSET', name: '银行账户悬挂资产', tags: ['assetid', 'walletid'] },
    { code: 'A.BANK_RESTRICTED', type: 'ASSET', name: '银行账户受限资产', tags: ['assetid', 'walletid'] },
    { code: 'A.CUSTODY', type: 'ASSET', name: '托管持有的虚拟资产', tags: ['assetid', 'walletid'] },
    { code: 'A.CUSTODY_IN_TRANSIT', type: 'ASSET', name: '托管在途虚拟资产', tags: ['assetid', 'walletid'] },
    { code: 'A.CUSTODY_SUSPENSE', type: 'ASSET', name: '托管悬挂虚拟资产', tags: ['assetid', 'walletid'] },
    { code: 'A.CUSTODY_RESTRICTED', type: 'ASSET', name: '托管受限虚拟资产', tags: ['assetid', 'walletid'] },
    { code: 'A.OTC_RECEIVABLE', type: 'ASSET', name: 'OTC 应收资产', tags: ['assetid', 'lp_id'] },
    { code: 'L.MERCHANT_PAYABLE', type: 'LIABILITY', name: '商户应付资产', tags: ['merchant_id', 'assetid'] },
    { code: 'L.MERCHANT_HELD', type: 'LIABILITY', name: '商户冻结资产', tags: ['merchant_id', 'assetid'] },
    { code: 'L.CLIENT_CREDIT', type: 'LIABILITY', name: '客户应付负债', tags: ['client_id', 'assetid'] },
    { code: 'L.CLIENT_HELD', type: 'LIABILITY', name: '客户冻结负债', tags: ['client_id', 'assetid'] },
    { code: 'L.CLIENT_AUDIT', type: 'LIABILITY', name: '客户审计负债', tags: ['client_id', 'assetid'] },
    { code: 'L.TAX_PAYABLE', type: 'LIABILITY', name: '应付税费', tags: ['owner_id', 'assetid'] },
    { code: 'L.PLATFORM_PAYABLE', type: 'LIABILITY', name: '应付平台服务费', tags: ['owner_id', 'assetid'] },
    { code: 'E.BANK_FEE', type: 'EXPENSE', name: '银行手续费', tags: ['walletid', 'assetid'] },
    { code: 'E.OTC_FEE', type: 'EXPENSE', name: 'OTC服务费', tags: ['assetid', 'lp_id'] },
    { code: 'E.NETWORK_FEE', type: 'EXPENSE', name: '链上交易的网络费', tags: ['assetid', 'walletid'] },
  ];

  for (const item of coaData) {
    await (prisma as any).coa.upsert({
      where: { code: item.code },
      update: {
        name: item.name,
        type: item.type,
        requiredTags: JSON.stringify(item.tags),
        status: 'ACTIVE'
      },
      create: {
        code: item.code,
        name: item.name,
        type: item.type,
        requiredTags: JSON.stringify(item.tags),
        status: 'ACTIVE'
      },
    });
  }
  console.log(`Synced ${coaData.length} COA entries`);
}

// 5. Seed Accounting Config (Events & Templates)
async function seedAcctConfig() {
  console.log('--- Seeding Accounting Config ---');
  
  // 1. Sync AcctEvents
  for (const event of DEFAULT_ACCT_EVENTS) {
    await (prisma as any).acctEvent.upsert({
      where: { eventCode: event.eventCode },
      update: event,
      create: event,
    });
  }
  console.log(`Synced ${DEFAULT_ACCT_EVENTS.length} accounting events.`);

  // 2. Sync Journal Templates
  const baseAsset = await (prisma as any).asset.findFirst({ where: { code: 'AED' } }) 
                 || await (prisma as any).asset.findFirst();
  
  if (!baseAsset) {
    console.warn('No assets found. Skipping journal template synchronization.');
    return;
  }

  for (const tpl of DEFAULT_JOURNAL_TEMPLATES) {
    const headerData = {
      ...tpl.header,
      baseAssetId: baseAsset.id,
      status: 'ACTIVE',
    };

    const header = await (prisma as any).journalHeaderTemplate.upsert({
      where: { templateCode: tpl.header.templateCode },
      update: headerData,
      create: headerData,
    });

    await (prisma as any).journalLineTemplate.deleteMany({
      where: { templateId: header.id },
    });

    for (const line of tpl.lines) {
      await (prisma as any).journalLineTemplate.create({
        data: {
          ...line,
          templateId: header.id,
        },
      });
    }
  }
  console.log(`Synced ${DEFAULT_JOURNAL_TEMPLATES.length} journal templates.`);
  console.log('Accounting templates synced');
}

// 6. Seed Clearing Template
async function seedClearing() {
  console.log('--- Seeding Clearing Template ---');
  const templateCode = 'WITHDRAWAL_STANDARD_V1';
  await (prisma as any).clearingTemplate.upsert({
    where: { code: templateCode },
    update: {
      description: '标准提现清分模板 (0.1% 手续费)',
      inAmountSource: 'source.amount * 0.999',
      feeAmountSource: 'source.amount * 0.001',
    },
    create: {
      code: templateCode,
      clearingType: 'WITHDRAWAL',
      sourceType: 'WITHDRAWAL',
      isEnabled: true,
      description: '标准提现清分模板 (0.1% 手续费)',
      feeMethod: 'CONFIGURED_FEE',
      outAssetSource: 'source.assetId',
      outAmountSource: 'source.amount',
      inAssetSource: 'source.assetId',
      inAmountSource: 'source.amount * 0.999',
      feeAssetSource: 'source.assetId',
      feeAmountSource: 'source.amount * 0.001',
      memoTemplate: '提现清分 - ${sourceId}',
      lineTemplates: {
        create: [
          { lineNo: 1, lineType: 'OUTGOING', partyType: 'CUSTOMER', partyIdSource: 'source.ownerId', assetSource: 'source.assetId', amountSource: 'source.amount', memoTemplate: '提现总额扣减' },
          { lineNo: 2, lineType: 'INCOMING', partyType: 'PLATFORM_OPERATIONAL', assetSource: 'source.assetId', amountSource: 'source.amount * 0.999', memoTemplate: '提现净额结算' },
          { lineNo: 3, lineType: 'FEE', partyType: 'PLATFORM_REVENUE', assetSource: 'source.assetId', amountSource: 'source.amount * 0.001', memoTemplate: '提现手续费收入' }
        ]
      }
    }
  });
  console.log('Clearing template synced');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
