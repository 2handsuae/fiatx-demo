import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

function ensureDefaultDatabaseUrl() {
  const normalized = String(process.env.DATABASE_URL || '').trim();
  if (!normalized) {
    process.env.DATABASE_URL = 'file:/tmp/exchange_js_main/dev.db';
  }
}

function readOption(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function main() {
  const subject = readOption('--subject');
  if (!subject) {
    throw new Error('Missing required option: --subject <SUBJECT>');
  }

  ensureDefaultDatabaseUrl();
  const [{ AppModule }, { BusinessConfigService }] = await Promise.all([
    import('../src/app.module'),
    import('../src/modules/governance/business-config/business-config.service'),
  ]);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const service = app.get(BusinessConfigService);
    const result = await service.stageRelease(subject);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
