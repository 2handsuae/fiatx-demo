// scripts/verify-demo-data.ts
//
// Baseline scanner for demo data integrity (R1-R4 invariants).
// Reads dev.db (DATABASE_URL) and flags violations; exit 1 if any.
//
// R1: InternalFund.from/toWalletId — SWAP IF must have at least one customer-side
//     wallet wired (both NULL = projection-orphan); WITHDRAW IF must have both.
// R2: account_flows.walletRef ↔ tbAccountId — when registry has an owner, the
//     wallet's (ownerType, ownerNo) must match registry.(ownerType, ownerNo).
//     Aggregate accounts (code 1/50) are owner-free → skip.
// R3: Payout/Payin in CLEARED state must carry referenceNo, and CRYPTO must
//     also carry txHash.
// R4: WithdrawTransaction.fromWalletId must point to a wallet OWNED by the
//     withdraw's owner (ownerType=CUSTOMER, ownerNo matches), with the right
//     role (FIAT→C_VIBAN, CRYPTO→C_DEP).
// R5（波一 T14）：配置身世——校验的是「种子装载的配置都留痕」，不是「活着的配置都是种子装的」。
//     资产/托管钱包/限额三块只有种子写入路径，全量必须有 actorNo=RELEASE 的 *_SEEDED 审计行；
//     兑换/提现两族费率等级还有运行时创建路径（operator 经 maker-checker 建的等级留的是
//     SWAP_FEE_LEVEL_CREATION_APPLIED 一类审计，不是 *_SEEDED），这两块只对种子行要求留痕。
//
// Usage:
//   DATABASE_URL="file:/tmp/exchange_js_main/dev.db" \
//     ts-node -r tsconfig-paths/register scripts/verify-demo-data.ts
//
// Exit codes: 0 = ALL PASS, 1 = violations found, 2 = scanner error.

import { requireStackEnv } from './require-stack-env';
requireStackEnv({ requireTb: false });

import { PrismaClient } from '@prisma/client';

interface Violation {
  rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  entity: string;
  detail: string;
}

const violations: Violation[] = [];

// ─────────────────────────────────────────────────────────────
// R1: InternalFund.from/toWalletId
async function scanR2(prisma: PrismaClient): Promise<void> {
  const flows: any[] = await (prisma as any).accountFlow.findMany({
    select: { id: true, walletRef: true, tbAccountId: true },
  });
  const wallets: any[] = await (prisma as any).wallet.findMany({
    select: { id: true, ownerType: true, ownerNo: true },
  });
  const regs: any[] = await (prisma as any).tbAccountRegistry.findMany({
    select: { tbAccountId: true, code: true, ownerType: true, ownerNo: true },
  });
  const wMap = new Map(wallets.map((w) => [w.id, w]));
  const rMap = new Map(regs.map((r) => [r.tbAccountId, r]));

  for (const f of flows) {
    if (!f.walletRef) continue; // null walletRef is handled by other invariants
    const w = wMap.get(f.walletRef);
    if (!w) {
      violations.push({
        rule: 'R2',
        entity: f.id,
        detail: `walletRef=${f.walletRef} not in wallets table`,
      });
      continue;
    }
    const reg = rMap.get(f.tbAccountId);
    if (!reg) continue; // tbAccountId not in registry — aggregate or phantom, skip
    if (reg.code === 1 || reg.code === 50) continue; // aggregate, owner-free

    // Firm-side owner 口径不统一：wallets 表 firm wallet = 'PLATFORM'，
    // tb_account_registry firm-side 账户 = 'SYSTEM'。两个都是 firm 内部账户，
    // 业务上同一概念。projector 已统一对待，scanner 同步以保持一致。
    const FIRM_SIDE = new Set(['PLATFORM', 'SYSTEM']);
    if (FIRM_SIDE.has(w.ownerType ?? '') && FIRM_SIDE.has(reg.ownerType ?? '')) continue;

    // Per-owner account — owner must match.
    if (w.ownerType !== reg.ownerType || (w.ownerNo ?? null) !== (reg.ownerNo ?? null)) {
      violations.push({
        rule: 'R2',
        entity: f.id,
        detail:
          `wallet owner=${w.ownerType}/${w.ownerNo ?? 'NULL'} ` +
          `!= tb owner=${reg.ownerType}/${reg.ownerNo ?? 'NULL'}`,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// R3: Payout/Payin CLEARED must have referenceNo (+ txHash for CRYPTO)
async function scanR4(prisma: PrismaClient): Promise<void> {
  const withdraws: any[] = await (prisma as any).withdrawTransaction.findMany();
  const wallets: any[] = await (prisma as any).wallet.findMany({
    select: { id: true, ownerType: true, ownerNo: true, walletRole: true },
  });
  const wMap = new Map(wallets.map((w) => [w.id, w]));

  /* 2026-08-30：R4 只查**已进放款阶段**的提现。
     `fromWalletId` 由 withdraw-workflow 在 initiatePayoutPhase 里绑定
     （见该文件 918-919 行的注释："binding here makes the workflow the single
     owner and guarantees fromWalletId is populated"）——走不到放款的单，这一列
     本来就该是 NULL，不是脏数据。

     此前 R4 无条件扫全表，是因为旧 demo 数据里每笔提现都跑到 SUCCESS。
     演示装备一期的花名册故意造了三种停在放款之前的提现（#17 等补料 /
     #18 大额待审批 / #19 MLRO 冻结），规则的旧前提就此不成立。 */
  const PRE_PAYOUT_STATUSES = new Set([
    'PENDING_APPROVAL', 'COMPLIANCE_PENDING', 'ACTION_PENDING',
    'MANUAL_CHECKING', 'FROZEN', 'REJECTED',
  ]);

  for (const wt of withdraws) {
    if (PRE_PAYOUT_STATUSES.has(wt.status)) continue;
    if (!wt.fromWalletId) {
      violations.push({
        rule: 'R4',
        entity: wt.withdrawNo,
        detail: `fromWalletId NULL`,
      });
      continue;
    }
    const w = wMap.get(wt.fromWalletId);
    if (!w) {
      violations.push({
        rule: 'R4',
        entity: wt.withdrawNo,
        detail: `fromWalletId=${wt.fromWalletId} not in wallets table`,
      });
      continue;
    }
    if (w.ownerType !== 'CUSTOMER' || w.ownerNo !== wt.ownerNo) {
      violations.push({
        rule: 'R4',
        entity: wt.withdrawNo,
        detail:
          `fromWalletId owner=${w.ownerType}/${w.ownerNo ?? 'NULL'} ` +
          `!= withdraw owner=CUSTOMER/${wt.ownerNo}`,
      });
      // owner is wrong — role check below would be noise, skip
      continue;
    }

  }
}

// ─────────────────────────────────────────────────────────────
// R5（波一 T14 修复轮）：配置身世——按业务键 join，不按计数比较。
//   计数版本对 reset 遗留的孤儿审计行免疫：TransactionLimitRule.ruleNo 随机铸造
//   （seed.business.ts:433-435），每次重铺业务表被清但 audit_log_events 不清，
//   净增的孤儿只会把计数推得更高，永远摸不到 count < expected 的红线（详见
//   BACKLOG「限额审计孤儿」条）。这里改成对每一块活着的业务行，按其业务号
//   在审计表里精确找一条同码 *_SEEDED 行（actorNo=RELEASE）；找不到就是这一
//   行没留痕，报违规并指名是哪一行——孤儿行不参与比对，也不会被这条规则动。
async function scanR5(prisma: PrismaClient): Promise<void> {
  const blocks: Array<{ action: string; entity: string; keys: string[] }> = [];

  const assets: any[] = await (prisma as any).asset.findMany({ select: { assetNo: true } });
  blocks.push({ action: 'ASSET_SEEDED', entity: 'asset', keys: assets.map((a) => a.assetNo) });

  const custodianWallets: any[] = await (prisma as any).wallet.findMany({
    where: { ownerType: 'PLATFORM' },
    select: { walletNo: true },
  });
  blocks.push({
    action: 'CUSTODIAN_WALLET_SEEDED',
    entity: 'wallet',
    keys: custodianWallets.map((w) => w.walletNo),
  });

  const limitRules: any[] = await (prisma as any).transactionLimitRule.findMany({ select: { ruleNo: true } });
  blocks.push({
    action: 'TRANSACTION_LIMIT_SEEDED',
    entity: 'transactionLimitRule',
    keys: limitRules.map((r) => r.ruleNo),
  });

  // 费率等级不是只种子——两条运行时创建路径存在（swap-fee-level-creation-workflow.service.ts
  // → swap-fee-level.service.ts createLevel；withdrawal-fee-level.service.ts createLevel 同款），
  // operator 经 maker-checker 建的等级留的是 SWAP_FEE_LEVEL_CREATION_APPLIED 一类审计，本来就
  // 没有 *_SEEDED 行。种子写 createdByUserId='SYSTEM'（seed.business.ts），运行时写 actor 的
  // 真实 user id——按这个判别式只挑种子行，否则每条 operator 建的等级都会被错判成没留痕。
  const swapFeeLevels: any[] = await (prisma as any).swapFeeLevel.findMany({
    where: { createdByUserId: 'SYSTEM' },
    select: { levelCode: true },
  });
  blocks.push({
    action: 'SWAP_FEE_LEVEL_SEEDED',
    entity: 'swapFeeLevel',
    keys: swapFeeLevels.map((l) => l.levelCode),
  });

  const withdrawalFeeLevels: any[] = await (prisma as any).withdrawalFeeLevel.findMany({
    where: { createdByUserId: 'SYSTEM' },
    select: { levelCode: true },
  });
  blocks.push({
    action: 'WITHDRAWAL_FEE_LEVEL_SEEDED',
    entity: 'withdrawalFeeLevel',
    keys: withdrawalFeeLevels.map((l) => l.levelCode),
  });

  for (const block of blocks) {
    // 五块在任何正确铺好的库上都不可能为空（资产 2 / 平台钱包 7 / 限额 15 / 兑换费率 3 / 提现费率 2）。
    // 空表就跳过 = 「没装载任何配置」也算「装载都留了痕」——正是本判据上一版栽的那种空真绿。
    if (block.keys.length === 0) {
      violations.push({
        rule: 'R5',
        entity: block.entity,
        detail: `no live ${block.entity} rows at all — seeding of this block did not happen; R5 cannot vacuously pass`,
      });
      continue;
    }
    const rows: any[] = await (prisma as any).auditLogEvent.findMany({
      where: { actorNo: 'RELEASE', action: block.action, primarySubjectNo: { in: block.keys } },
      select: { primarySubjectNo: true },
    });
    const seeded = new Set(rows.map((r) => r.primarySubjectNo));
    for (const key of block.keys) {
      if (!seeded.has(key)) {
        violations.push({
          rule: 'R5',
          entity: key,
          detail: `no ${block.action} audit row (actorNo=RELEASE, primarySubjectNo=${key}) for live ${block.entity}`,
        });
      }
    }
  }
}

/* 2026-08-24：删掉 scanR1 / scanR3 与 scanR4 的尾段 —— 它们读的
   `internalFund` / `payin` / `payout` 三张表在 funds_orders 三合一那批就被 DROP 了
   （schema 里只剩 InternalFundAuditLog），Prisma client 上这三个 delegate 是
   undefined → `undefined.findMany()` 直接抛，把整个 verify:demo-data 打挂，
   连带让 `stack.sh reset-main`（set -euo pipefail）在重启栈之前中止。
   scanR4 保留的是活的那半：提现的 fromWalletId 非空 / 存在 / 归属客户正确；
   砍掉的是按 payout.type 反查钱包角色那段（payoutId 列也已随表消失）。
   本项目 demo 约定不留兼容层，所以是删而不是加 `?.` 守卫。 */
// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await scanR2(prisma);
    await scanR4(prisma);
    await scanR5(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const byRule: Record<string, number> = { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0 };
  for (const v of violations) byRule[v.rule]++;

  if (violations.length === 0) {
    console.log('\nverify:demo-data ALL PASS\n');
    process.exit(0);
  }

  console.error(`\nverify:demo-data FAILED — ${violations.length} violation(s)`);
  console.error(
    `  R1=${byRule.R1}  R2=${byRule.R2}  R3=${byRule.R3}  R4=${byRule.R4}  R5=${byRule.R5}\n`,
  );
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.entity}: ${v.detail}`);
  }
  process.exit(1);
}

main().catch((e) => {
  console.error('verify:demo-data ERROR:', e);
  process.exit(2);
});
