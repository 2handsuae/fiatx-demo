
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ClearingsService } from '../src/modules/clearing-settle/clearing/clearings.service';
import { PrismaService } from '../src/core/prisma/prisma.service';

async function debugLines() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const clearingsService = app.get(ClearingsService);

  console.log('--- Debugging Clearing Lines ---');
  
  // 1. Direct DB Count
  const count = await prisma.clearingLine.count();
  console.log(`Total ClearingLines in DB: ${count}`);

  if (count > 0) {
      const sample = await prisma.clearingLine.findFirst();
      console.log('Sample Line:', sample);
  }

  // 2. Service Call (simulate controller)
  console.log('Calling service.findAllLines({})...');
  try {
      const result = await clearingsService.findAllLines({ skip: 0, take: 5 });
      console.log(`Service returned ${result.items.length} items (Total: ${result.total})`);
      if (result.items.length > 0) {
          console.log('First Item:', result.items[0]);
      }
  } catch (e) {
      console.error('Service call failed:', e);
  }

  await app.close();
}

debugLines().catch(console.error);
