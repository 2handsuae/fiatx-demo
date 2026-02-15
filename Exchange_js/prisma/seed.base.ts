import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ASSETS } from '../src/config/manifests/assets.manifest';
import { DEFAULT_COA } from '../src/config/manifests/coa.manifest';
import { DEFAULT_ACCT_EVENTS } from '../src/config/manifests/events.manifest';
import { DEFAULT_JOURNAL_TEMPLATES } from '../src/config/manifests/journal-templates.manifest';
import { DEFAULT_CLEARING_TEMPLATES } from '../src/config/manifests/clearing-templates.manifest';

const DEFAULT_ADMIN_EMAIL = 'admin@fiatx.com';
const DEFAULT_ADMIN_USER_NO = 'ADMIN-001';
const DEFAULT_ADMIN_PASSWORD = '123456';

const DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES = [
  'EVT_DEPOSIT_REJECTED__CRYPTO',
  'EVT_DEPOSIT_REJECTED__FIAT',
] as const;

export async function seedBase(prisma: PrismaClient): Promise<void> {
  console.log('--- Seeding Base Configuration ---');
  await seedAdmin(prisma);
  await seedAssets(prisma);
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

async function seedAssets(prisma: PrismaClient): Promise<void> {
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

async function cleanupDeprecatedDepositRejectedEvents(prisma: PrismaClient): Promise<void> {
  try {
    await prisma.journalHeaderTemplate.deleteMany({
      where: { eventCode: { in: [...DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES] } },
    });
  } catch {
    await prisma.journalHeaderTemplate.updateMany({
      where: { eventCode: { in: [...DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES] } },
      data: { status: 'INACTIVE' },
    });
  }

  try {
    await prisma.acctEvent.deleteMany({
      where: { eventCode: { in: [...DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES] } },
    });
  } catch {
    await prisma.acctEvent.updateMany({
      where: { eventCode: { in: [...DEPRECATED_DEPOSIT_REJECTED_EVENT_CODES] } },
      data: { isActive: false },
    });
  }
}

async function seedJournalTemplates(prisma: PrismaClient): Promise<void> {
  const baseAsset =
    (await prisma.asset.findFirst({ where: { code: 'AED' }, orderBy: { createdAt: 'asc' } })) ??
    (await prisma.asset.findFirst({ orderBy: { createdAt: 'asc' } }));

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
  const adminExists = (await prisma.user.count({ where: { email: DEFAULT_ADMIN_EMAIL } })) > 0;
  if (!adminExists) {
    return false;
  }

  const existingAssets = await prisma.asset.findMany({
    select: { type: true, code: true, network: true },
  });
  const assetKeys = new Set(
    existingAssets.map((asset) => `${asset.type}:${asset.code}:${normalizeNetwork(asset.network)}`),
  );
  const allAssetsExist = DEFAULT_ASSETS.every((asset) =>
    assetKeys.has(`${asset.type}:${asset.code}:${normalizeNetwork(asset.network)}`),
  );
  if (!allAssetsExist) {
    return false;
  }

  const coaCount = await prisma.coa.count({
    where: { code: { in: DEFAULT_COA.map((item) => item.code) } },
  });
  if (coaCount < DEFAULT_COA.length) {
    return false;
  }

  const eventCount = await prisma.acctEvent.count({
    where: { eventCode: { in: DEFAULT_ACCT_EVENTS.map((item) => item.eventCode) } },
  });
  if (eventCount < DEFAULT_ACCT_EVENTS.length) {
    return false;
  }

  const journalTemplateCount = await prisma.journalHeaderTemplate.count({
    where: { templateCode: { in: DEFAULT_JOURNAL_TEMPLATES.map((item) => item.header.templateCode) } },
  });
  if (journalTemplateCount < DEFAULT_JOURNAL_TEMPLATES.length) {
    return false;
  }

  const clearingTemplateCount = await prisma.clearingTemplate.count({
    where: { code: { in: DEFAULT_CLEARING_TEMPLATES.map((item) => item.code) } },
  });
  if (clearingTemplateCount < DEFAULT_CLEARING_TEMPLATES.length) {
    return false;
  }

  return true;
}

function normalizeNetwork(network: string | null | undefined): string {
  return network ?? '';
}

function readOptionalString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null || !(key in source)) {
    return null;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
