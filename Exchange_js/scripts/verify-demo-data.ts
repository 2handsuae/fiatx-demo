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
// R5（波一 T14 + 第一幕小轮 T2 + 评审修复轮）：配置身世——校验的是「种子装载的配置都留痕」，
//     不是「活着的配置都是种子装的」。
//     资产/托管钱包/限额三块只有种子写入路径，全量必须有 actorNo=RELEASE 的 *_SEEDED 审计行；
//     兑换/提现两族费率等级还有运行时创建路径（operator 经 maker-checker 建的等级留的是
//     SWAP_FEE_LEVEL_CREATION_APPLIED 一类审计，不是 *_SEEDED），这两块只对种子行要求留痕。
//     客户收款地址（钱包表 C_DEP/C_VIBAN）/ 提现地址两块由 demo-lib.ts（BACKLOG:86）写，
//     actorNo=DEMO_SEED（不是 RELEASE ——两者是不同的写手，前五块是 prisma/seed.ts 系）。
//     ⚠️ 这两块必须比前五块多一道"demo 数据在场"门控，否则会打断 stack.sh reset：
//     `db:seed:business` = `prisma/seed.ts --mode=business && npm run verify:demo-data`
//     （reset-stack.sh 等重铺脚本在 set -euo pipefail 下内联调用它）——这一步只跑了业务种子，
//     demo-lib.ts#ensureSetup（建这两块业务行的唯一写点）根本还没执行，此刻活钱包/活地址天生是
//     0 条。前五块的种子行是业务种子自己无条件建的，同一时刻已非空，不受影响；这两块若和前五块
//     一样"空表即违规"，会在这个中间态必红、reset 因此非零退出——不是假设，是实测复现过的（见
//     本次评审修复报告 task-2-report.md）。判据因此对这两块单独放行：`keys.length === 0` 时打印
//     SKIP 说明、不计违规（其余五块仍然"空表即违规"不变）。这个门控读的是"业务行本身是否存在"，
//     不经过、也不依赖会被 BACKLOG:86 删掉的那次 writeSeedAudit 调用——写点被删时业务行仍然照常
//     创建（keys 非空），门控不会连带把真正的孤儿身世 SKIP 掉。
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
  const blocks: Array<{
    action: string; entity: string; keys: string[]; scope?: string; actorNo?: string;
    // true = 这一块的业务行只由 demo-lib.ts#ensureSetup 建（不是业务种子无条件建的），
    // 空表可能只是"ensureSetup 还没跑"（reset 链内的合法中间态），空表本身不算违规——见文件头 R5 注释。
    skipIfEmpty?: boolean;
  }> = [];

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
  // ⚠️ 这个判别式的前提是「运行时路径永远带真实 user id」：两条创建流收的是 ApprovalActorContext，
  // 而该类型允许 userId='SYSTEM'（approvals.service.ts 的 systemActor()）。今天 systemActor() 只用在
  // 一处只读的 mapApproval、够不到创建流，但类型上是通的——将来若出现系统发起的费率创建，它的行会被
  // 悄悄算回种子行，假红重现。没有测试钉住这条性质，故在此写明依赖。
  const swapFeeLevels: any[] = await (prisma as any).swapFeeLevel.findMany({
    where: { createdByUserId: 'SYSTEM' },
    select: { levelCode: true },
  });
  blocks.push({
    action: 'SWAP_FEE_LEVEL_SEEDED',
    entity: 'swapFeeLevel',
    scope: "createdByUserId='SYSTEM'",
    keys: swapFeeLevels.map((l) => l.levelCode),
  });

  const withdrawalFeeLevels: any[] = await (prisma as any).withdrawalFeeLevel.findMany({
    where: { createdByUserId: 'SYSTEM' },
    select: { levelCode: true },
  });
  blocks.push({
    action: 'WITHDRAWAL_FEE_LEVEL_SEEDED',
    entity: 'withdrawalFeeLevel',
    scope: "createdByUserId='SYSTEM'",
    keys: withdrawalFeeLevels.map((l) => l.levelCode),
  });

  // 客户收款地址（wallets 表 ownerType=CUSTOMER，角色只有 C_DEP/C_VIBAN——见
  // system-wallet.util.ts）。生产侧唯一运行时写路径是 customer-deposit-wallet.service.ts
  // #createOrReturn（客户主动申领，写 CUSTOMER_DEPOSIT_ADDRESS_CREATED 审计，不是 *_SEEDED）。
  // ⚠️ 这条路不是只有 demo:all 才会绕开——verify-act1.ts 的 V3 就真的 POST /client/deposit-wallets
  // 替 alice 申领（走同一个 createOrReturn），如果那次调用发生在 demo-lib.ts#ensureSetup 还没
  // 替 alice 建好 C_DEP/C_VIBAN 之前，createOrReturn 会新建一个 ownerType=CUSTOMER 的真钱包
  // （custodianRef 形如 mock-<custodian>-<hex>，不是 demo-lib 的 hextrust-demo-*/zand-demo-*），
  // 这个真钱包没有 *_SEEDED 审计、会被本块误判成孤儿。今天不误伤，靠的是 baseline 的运行顺序——
  // verify:act1 的 V 组每次先 reset 单独跑（不接 demo:all），demo:all 前又会再 reset 一次
  // ——两者从不共享同一份未重置的库；这是操作约定，不是本判据判别式自身的保证。约定被打破
  // （比如有人在同一个库上先跑 verify:act1 再跑 demo:all/verify:demo-data，中间不 reset）
  // 就会在这里假红，需要用户知悉。按 ownerType 限定作用域后，活钱包必须全员留痕（镜像上面
  // CUSTODIAN_WALLET_SEEDED 用 ownerType=PLATFORM 的写法）。
  const customerWallets: any[] = await (prisma as any).wallet.findMany({
    where: { ownerType: 'CUSTOMER' },
    select: { walletNo: true },
  });
  blocks.push({
    action: 'CUSTOMER_DEPOSIT_ADDRESS_SEEDED',
    entity: 'wallet',
    scope: "ownerType='CUSTOMER'",
    actorNo: 'DEMO_SEED',
    skipIfEmpty: true,
    keys: customerWallets.map((w) => w.walletNo),
  });

  // 提现地址（withdrawal_addresses 表）。生产侧唯一运行时写路径是
  // withdrawal-address.service.ts（客户自行登记，ownershipProofType 不是 DEMO_FIXTURE），
  // demo-lib.ts 种的两处（银行账号 + alice/bob 的链上地址）都固定写 DEMO_FIXTURE——按这个判别式
  // 限定作用域，只对种子地址要求留痕，不会误判客户自行登记的真实地址。
  const withdrawalAddresses: any[] = await (prisma as any).withdrawalAddress.findMany({
    where: { ownershipProofType: 'DEMO_FIXTURE' },
    select: { addressNo: true },
  });
  blocks.push({
    action: 'WITHDRAWAL_ADDRESS_SEEDED',
    entity: 'withdrawalAddress',
    scope: "ownershipProofType='DEMO_FIXTURE'",
    actorNo: 'DEMO_SEED',
    skipIfEmpty: true,
    keys: withdrawalAddresses.map((a) => a.addressNo),
  });

  for (const block of blocks) {
    // 七块在 demo:all 跑过一次之后都不可能为空（资产 2 / 平台钱包 7 / 限额 15 / 兑换费率 3 /
    // 提现费率 2 / 客户收款钱包 12 / 提现地址 8——后两块数随花名册人数变而变，此处只是现场实测值）。
    // 空表就跳过 = 「没装载任何配置」也算「装载都留了痕」——正是本判据上一版栽的那种空真绿。
    const actorNo = block.actorNo ?? 'RELEASE';
    if (block.keys.length === 0) {
      if (block.skipIfEmpty) {
        // 光看活体 keys 为空分不清两种情况：① demo-lib.ts#ensureSetup 还没跑过（reset 链内
        // 先跑 prisma/seed.ts --mode=business 就会调用一次本脚本——见文件头 R5 注释）；
        // ② demo:all 跑过了，但这一块的活体行是空的（建行被删 / 判别式漂移）——孤儿方向的
        // 对称半边，之前的代码对它是盲的。
        // 判别器**不能用审计行数**：`stack.sh reset` 清业务表但刻意不清 audit_log_events
        // （writeSeedAudit 幂等去重依赖它），所以"审计在、活体空"在 reset 链内是常态。
        // 用 demo 的活体证据当判别器：充值单表非空 = demo:all 在这个库里真跑过。
        const demoDeposits = await (prisma as any).depositTransaction.count();
        if (demoDeposits === 0) {
          // 业务种子刚铺完、demo 还没跑——SKIP，不计违规（reset 链走这条）。
          console.log(`  [R5] SKIP ${block.action} — no live ${block.entity} rows matching ${block.scope} yet (demo-lib.ts#ensureSetup hasn't run in this DB); not a violation`);
          continue;
        }
        // demo 数据在场（充值单非空）而本块活体行为零——建行被删或判别式漂移，必须报红。
        // ⚠️ 边界：ensureSetup 整段被删（行、审计、连 demo 主流程一起消失）不归本判据管——
        // 那种退化 demo:all 自己的 29/29 花名册断言会先炸（没有客户收款钱包/提现地址，
        // 充值/提现单一张都建不起来），轮不到这里。
        violations.push({
          rule: 'R5',
          entity: block.entity,
          detail: `demo data present (${demoDeposits} deposit rows) but 0 live ${block.entity} rows matching ${block.scope} — rows deleted, or the seed discriminator drifted`,
        });
        continue;
      }
      violations.push({
        rule: 'R5',
        entity: block.entity,
        detail: block.scope
          ? `no live ${block.entity} rows matching ${block.scope} — the table may hold rows, but none are seed-owned; R5 cannot vacuously pass`
          : `no live ${block.entity} rows at all — seeding of this block did not happen; R5 cannot vacuously pass`,
      });
      continue;
    }
    const rows: any[] = await (prisma as any).auditLogEvent.findMany({
      where: { actorNo, action: block.action, primarySubjectNo: { in: block.keys } },
      select: { primarySubjectNo: true },
    });
    const seeded = new Set(rows.map((r) => r.primarySubjectNo));
    for (const key of block.keys) {
      if (!seeded.has(key)) {
        violations.push({
          rule: 'R5',
          entity: key,
          detail: `no ${block.action} audit row (actorNo=${actorNo}, primarySubjectNo=${key}) for live ${block.entity}`,
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
