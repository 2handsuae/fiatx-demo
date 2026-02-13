import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.clearingTemplate.count();
  console.log('ClearingTemplate count:', count);
  const items = await prisma.clearingTemplate.findMany();
  console.log('Items:', JSON.stringify(items, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
