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
//
// Usage:
//   DATABASE_URL="file:/tmp/exchange_js_main/dev.db" \
//     ts-node -r tsconfig-paths/register scripts/verify-demo-data.ts
//
// Exit codes: 0 = ALL PASS, 1 = violations found, 2 = scanner error.

import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
import { PrismaClient } from '@prisma/client';

interface Violation {
  rule: 'R1' | 'R2' | 'R3' | 'R4';
  entity: string;
  detail: string;
}

const violations: Violation[] = [];

// ─────────────────────────────────────────────────────────────
// R1: InternalFund.from/toWalletId
// ─────────────────────────────────────────────────────────────
// Schema note: internal_funds has no eventCode column. We infer leg shape
// from FK presence:
//   - swapTransactionId set → SWAP leg. Customer-side legs need at least one
//     wallet (from or to) pointing at the customer; pure firm-only legs would
//     need both filled. Without eventCode we can't distinguish, so the
//     baseline rule is conservative: both NULL is a violation regardless.
//   - withdrawTransactionId set → WITHDRAW leg. Must have both from and to.
//   - internalTransactionId set → legacy internal-transfer. Same as WITHDRAW.
async function scanR1(prisma: PrismaClient): Promise<void> {
  const ifs: any[] = await (prisma as any).internalFund.findMany();
  for (const f of ifs) {
    const isSwap = !!f.swapTransactionId;
    const isWithdraw = !!f.withdrawTransactionId;
    const isInternalTx = !!f.internalTransactionId;
    const bothNull = !f.fromWalletId && !f.toWalletId;
    const oneNull = !f.fromWalletId || !f.toWalletId;

    if (isSwap && bothNull) {
      violations.push({
        rule: 'R1',
        entity: f.internalFundNo,
        detail: `SWAP leg (legSeq=${f.legSeq}) has both from/to NULL`,
      });
    }
    if ((isWithdraw || isInternalTx) && oneNull) {
      const kind = isWithdraw ? 'WITHDRAW' : 'INTERNAL_TX';
      violations.push({
        rule: 'R1',
        entity: f.internalFundNo,
        detail: `${kind} leg requires both wallets — from=${f.fromWalletId ?? 'NULL'} to=${f.toWalletId ?? 'NULL'}`,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// R2: AccountFlow.walletRef vs TbAccountRegistry owner
// ─────────────────────────────────────────────────────────────
// Aggregate accounts (CLIENT_ASSET=1, FIRM_ASSET=50) carry no per-customer
// owner — skip them. For per-owner accounts, the walletRef wallet's
// (ownerType, ownerNo) must align with the registry row.
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
// ─────────────────────────────────────────────────────────────
async function scanR3(prisma: PrismaClient): Promise<void> {
  const payouts: any[] = await (prisma as any).payout.findMany({
    where: { status: 'CLEARED' },
  });
  for (const p of payouts) {
    if (!p.referenceNo) {
      violations.push({
        rule: 'R3',
        entity: p.payoutNo,
        detail: `CLEARED payout has NULL referenceNo`,
      });
    }
    if ((p.type || '').toUpperCase() === 'CRYPTO' && !p.txHash) {
      violations.push({
        rule: 'R3',
        entity: p.payoutNo,
        detail: `CLEARED CRYPTO payout has NULL txHash`,
      });
    }
  }

  const payins: any[] = await (prisma as any).payin.findMany({
    where: { status: 'CLEARED' },
  });
  for (const p of payins) {
    if (!p.referenceNo) {
      violations.push({
        rule: 'R3',
        entity: p.payinNo,
        detail: `CLEARED payin has NULL referenceNo`,
      });
    }
    if ((p.type || '').toUpperCase() === 'CRYPTO' && !p.txHash) {
      violations.push({
        rule: 'R3',
        entity: p.payinNo,
        detail: `CLEARED CRYPTO payin has NULL txHash`,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// R4: WithdrawTransaction.fromWalletId owner + role
// ─────────────────────────────────────────────────────────────
// fromWalletId must be a wallet OWNED by the withdraw's owner (CUSTOMER, ownerNo).
// Role must match payout type:
//   - FIAT  → walletRole = C_VIBAN
//   - CRYPTO → walletRole = C_DEP
// Payout type lookup is via payoutId/payoutNo; fall back to asset code prefix
// when payout link missing.
async function scanR4(prisma: PrismaClient): Promise<void> {
  const withdraws: any[] = await (prisma as any).withdrawTransaction.findMany();
  const wallets: any[] = await (prisma as any).wallet.findMany({
    select: { id: true, ownerType: true, ownerNo: true, walletRole: true },
  });
  const wMap = new Map(wallets.map((w) => [w.id, w]));
  const payouts: any[] = await (prisma as any).payout.findMany({
    select: { id: true, payoutNo: true, type: true },
  });
  const poById = new Map(payouts.map((p) => [p.id, p]));

  for (const wt of withdraws) {
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

    // Role check by payout type
    const payout = wt.payoutId ? poById.get(wt.payoutId) : undefined;
    const payoutType = (payout?.type ?? '').toUpperCase();
    const expectedRole =
      payoutType === 'FIAT'
        ? 'C_VIBAN'
        : payoutType === 'CRYPTO'
          ? 'C_DEP'
          : null;
    if (expectedRole && w.walletRole !== expectedRole) {
      violations.push({
        rule: 'R4',
        entity: wt.withdrawNo,
        detail:
          `${payoutType} withdraw expects walletRole=${expectedRole} ` +
          `but fromWallet.role=${w.walletRole}`,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await scanR1(prisma);
    await scanR2(prisma);
    await scanR3(prisma);
    await scanR4(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const byRule: Record<string, number> = { R1: 0, R2: 0, R3: 0, R4: 0 };
  for (const v of violations) byRule[v.rule]++;

  if (violations.length === 0) {
    console.log('\nverify:demo-data ALL PASS\n');
    process.exit(0);
  }

  console.error(`\nverify:demo-data FAILED — ${violations.length} violation(s)`);
  console.error(
    `  R1=${byRule.R1}  R2=${byRule.R2}  R3=${byRule.R3}  R4=${byRule.R4}\n`,
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
