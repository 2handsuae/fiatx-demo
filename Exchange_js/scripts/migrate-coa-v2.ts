// scripts/migrate-coa-v2.ts
//
// COA v2 一次性历史迁移：把旧的 202 FIRM_FEE 权益科目上的存量余额，按历史流水的事件类型
// 精确拆分到三个新收入科目 210(INCOME_SWAP_FEE)/211(INCOME_WITHDRAW_FEE)/212(INCOME_OTHER)，
// 然后把 202/203/204(FIRM_FEE/FIRM_LIQ/FIRM_SEIZED) 三个退役科目的 registry 行置为 RETIRED。
//
// 202→210/211/212 的路由已在更早的 COA v2 任务里切换（commit f6b98fe8），此后写入的证据行
// 不再产生 creditCode='E.FIRM_FEE'；因此本脚本要处理的，只是切换前遗留在 202 上的存量。
//
// 精确匹配依据：tb_transfer_evidence 没有 code/ledger 列（只在 TigerBeetle 侧记录数字类型码），
// 落库的判别字段是 eventCode(字符串) + creditCode。三个历史事件与数字类型码的对应关系
// （核对自 tb-transfer-codes.constant.ts 与切换前 commit f6b98fe8 的 diff）：
//   eventCode='SWAP_FEE_FIRM'       (数字类型码 36 SWAP_FEE_FIRM)          → 210 INCOME_SWAP_FEE
//   eventCode='WITHDRAW_FEE_FIRM'   (数字类型码 16 WITHDRAW_FEE_FIRM)      → 211 INCOME_WITHDRAW_FEE
//   eventCode='CONFISCATE_FIRM_FEE' (数字类型码 4  DEPOSIT_CONFISCATE_FIRM_FEE) → 212 INCOME_OTHER
//
// 绝不猜数：三组历史证据之和(减去本脚本此前已搬走的部分)必须精确等于 202 当前 TB 余额，
// 对不上立刻抛错终止 —— 说明存在未知来源的分录，需要人工排查，脚本不代为判断。
//
// 幂等，容忍中途失败重跑：
//   - 202 余额已为 0 → 整条 ledger 跳过重分类。
//   - 每个目标桶单独比较"历史应搬 Σ - 本脚本此前已搬 Σ"，已搬完的桶跳过、只搬未搬完的余量
//     （TigerBeetle 侧的确定性 transferId 本身也会去重，这里额外做金额级别的余量核算，
//     使得"进程在三笔转账中途崩溃后重跑"不会被前两笔已消耗掉的余额误判成"对不上账"）。
//   - registry 行已 RETIRED → updateMany 的 where 已限定 status:'ACTIVE'，重跑不再触碰。
//
// 保对账连续性：三笔重分类的两腿(debitWalletRef/creditWalletRef)都盖同一个 F_FEE 物理钱包的
// ref —— 这笔钱物理上从未挪动过（还在同一个钱包里），只是会计分类变了；两腿同盖同一钱包，
// 该钱包内部收支相抵，对账余额不受影响。

import { webcrypto } from 'node:crypto';
// Node18 polyfill: @nestjs/schedule 在模块注册期调用 crypto.randomUUID()，必须在任何拉起
// AppModule 的 import 之前打好补丁（照抄 scripts/demo-lib.ts 的既有解法）。
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TigerBeetleService } from '../src/modules/accounting/tigerbeetle/tigerbeetle.service';
import { SystemWalletResolver } from '../src/modules/funds-layer/domain/system-wallet-resolver.service';
import { TB_ACCOUNT_CODES, RETIRED_TB_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { hexToBigint } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';

const SPLIT: Array<{ txnCode: number; eventCode: string; toCode: number; toCoa: string }> = [
  { txnCode: TB_TRANSFER_CODES.SWAP_FEE_FIRM, eventCode: 'SWAP_FEE_FIRM', toCode: TB_ACCOUNT_CODES.INCOME_SWAP_FEE, toCoa: 'E.INCOME_SWAP_FEE' },
  { txnCode: TB_TRANSFER_CODES.WITHDRAW_FEE_FIRM, eventCode: 'WITHDRAW_FEE_FIRM', toCode: TB_ACCOUNT_CODES.INCOME_WITHDRAW_FEE, toCoa: 'E.INCOME_WITHDRAW_FEE' },
  { txnCode: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_FIRM_FEE, eventCode: 'CONFISCATE_FIRM_FEE', toCode: TB_ACCOUNT_CODES.INCOME_OTHER, toCoa: 'E.INCOME_OTHER' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma: any = app.get(PrismaService);
  const accounting = app.get(AccountingService);
  const tb = app.get(TigerBeetleService);
  const systemWalletResolver = app.get(SystemWalletResolver);
  try {
    const oldFeeRows = await prisma.tbAccountRegistry.findMany({ where: { code: 202 } });
    if (oldFeeRows.length === 0) {
      console.log('no code=202 registry rows found — nothing to reclassify (fresh COA v2 stack, or no legacy 202 account was ever provisioned)');
    }

    for (const row of oldFeeRows) {
      const ledger: number = row.ledger;
      const debitAccountId = hexToBigint(row.tbAccountId);

      // 1) 202 当前 TB 余额(权益/负债类,贷方计正)
      const [acct] = (await tb.lookupAccounts([debitAccountId])) as any[];
      if (!acct) throw new Error(`ledger ${ledger}: 202 TB account ${row.tbAccountId} not found in TigerBeetle — registry/TB drift, investigate`);
      const bal202: bigint = BigInt(acct.credits_posted) - BigInt(acct.debits_posted);
      if (bal202 < 0n) throw new Error(`ledger ${ledger}: 202 balance negative (${bal202}) — investigate before migrating`);
      if (bal202 === 0n) { console.log(`ledger ${ledger}: 202 already zero, skip reclass`); continue; }

      // 2) 按事件类型码分组的历史贷方和(不可变的切换前证据行,单位与 TB 一致:最小单位整数)
      const historical = new Map<number, bigint>();
      for (const s of SPLIT) {
        const agg = await prisma.tbTransferEvidence.aggregate({
          where: { eventCode: s.eventCode, creditCode: 'E.FIRM_FEE', creditTbAccountId: row.tbAccountId },
          _sum: { amount: true },
        });
        historical.set(s.txnCode, BigInt(agg._sum.amount?.toString() ?? '0'));
      }
      // 2b) 本脚本此前(可能中途失败的)运行已经搬走的部分 — 靠这组数字撑起"中途崩溃后重跑"的幂等
      const alreadyMoved = new Map<number, bigint>();
      for (const s of SPLIT) {
        const agg = await prisma.tbTransferEvidence.aggregate({
          where: { eventCode: 'COA_V2_RECLASS', debitCode: 'E.FIRM_FEE', creditCode: s.toCoa, sourceNo: `COA-V2-${ledger}-${s.txnCode}` },
          _sum: { amount: true },
        });
        alreadyMoved.set(s.txnCode, BigInt(agg._sum.amount?.toString() ?? '0'));
      }

      const historicalTotal = [...historical.values()].reduce((a, b) => a + b, 0n);
      const alreadyMovedTotal = [...alreadyMoved.values()].reduce((a, b) => a + b, 0n);
      const expectedRemaining = historicalTotal - alreadyMovedTotal;
      if (expectedRemaining !== bal202) {
        throw new Error(
          `ledger ${ledger}: evidence split mismatch — historical Σ=${historicalTotal}, already-moved Σ=${alreadyMovedTotal}, ` +
          `expected remaining=${expectedRemaining} != actual 202 balance=${bal202} — refuse to guess, investigate`,
        );
      }

      // 3) 确保 210/211/212 已存在(新栈由 provisioning 造;老栈这里补)
      const targetIds = new Map<number, bigint>();
      for (const s of SPLIT) {
        let creditId: bigint;
        try {
          creditId = await accounting.resolveTbAccountId({ code: s.toCode, ledger, ownerType: 'SYSTEM' });
        } catch {
          await accounting.createAccounts([{
            code: s.toCode, ledger, ownerType: 'SYSTEM', assetCurrency: row.assetCode,
            description: `${s.toCoa} for ${row.assetCode} (COA v2 migration)`,
          }]);
          creditId = await accounting.resolveTbAccountId({ code: s.toCode, ledger, ownerType: 'SYSTEM' });
        }
        targetIds.set(s.toCode, creditId);
      }

      // 4) F_FEE 物理钱包 ref — 两腿同盖同一 ref(钱物理上没动过,只是会计分类变了)
      const asset = await prisma.asset.findUnique({ where: { code: row.assetCode } });
      let feeWalletRef: string | null = null;
      if (asset) {
        try {
          const wallet = await systemWalletResolver.resolve(asset.id, 'F_FEE');
          feeWalletRef = wallet.id;
        } catch (err: any) {
          console.warn(`ledger ${ledger}: F_FEE wallet not found for asset ${row.assetCode} — proceeding without walletRef (${err.message})`);
        }
      }

      // 5) 逐桶重分类:DR 202 / CR 新户,金额=历史应搬-已搬余量
      for (const s of SPLIT) {
        const remaining = historical.get(s.txnCode)! - alreadyMoved.get(s.txnCode)!;
        if (remaining < 0n) throw new Error(`ledger ${ledger}: ${s.toCoa} bucket over-moved (historical=${historical.get(s.txnCode)}, alreadyMoved=${alreadyMoved.get(s.txnCode)}) — investigate`);
        if (remaining === 0n) { console.log(`ledger ${ledger}: ${s.toCoa} bucket already reclassed (or historically zero), skip`); continue; }
        await accounting.executeTransfer({
          debitAccountId,
          creditAccountId: targetIds.get(s.toCode)!,
          amount: remaining,
          ledger,
          code: TB_TRANSFER_CODES.COA_V2_INCOME_RECLASS,
          evidence: {
            sourceType: 'SYSTEM', sourceNo: `COA-V2-${ledger}-${s.txnCode}`, eventCode: 'COA_V2_RECLASS',
            debitCode: 'E.FIRM_FEE', creditCode: s.toCoa, assetCurrency: row.assetCode,
            traceId: `coa-v2-${ledger}-${s.txnCode}`, actorType: 'SYSTEM', actorId: 'COA_V2_MIGRATION',
            memo: `COA v2 reclass: FIRM_FEE → ${s.toCoa} (historical event ${s.eventCode}, txn code ${s.txnCode})`,
            debitWalletRef: feeWalletRef, creditWalletRef: feeWalletRef,
            isExternalCrossing: false,
          },
        });
        console.log(`ledger ${ledger}: reclassed ${remaining} → ${s.toCoa}`);
      }

      // 6) 断言 202 清零
      const [after] = (await tb.lookupAccounts([debitAccountId])) as any[];
      const balAfter: bigint = BigInt(after.credits_posted) - BigInt(after.debits_posted);
      if (balAfter !== 0n) throw new Error(`ledger ${ledger}: 202 not zero after reclass (${balAfter}) — investigate`);
      console.log(`ledger ${ledger}: 202 → 0 ✓`);
    }

    // 7) 退役前安全网:203/204(FIRM_LIQ/FIRM_SEIZED)没有定义重分类目标,直接断言其余额已为零
    //    才允许退役(202 的清零已在上面的循环里断言过,这里再统一复核一遍,双保险)。
    const retiredRows = await prisma.tbAccountRegistry.findMany({ where: { code: { in: RETIRED_TB_CODES } } });
    for (const row of retiredRows) {
      const [acct] = (await tb.lookupAccounts([hexToBigint(row.tbAccountId)])) as any[];
      if (!acct) throw new Error(`code ${row.code} ledger ${row.ledger}: TB account ${row.tbAccountId} not found — registry/TB drift, investigate`);
      const bal: bigint = BigInt(acct.credits_posted) - BigInt(acct.debits_posted);
      if (bal !== 0n) throw new Error(`code ${row.code} ledger ${row.ledger}: non-zero balance (${bal}) — refuse to retire, investigate`);
    }

    // 8) 退役 registry 行(幂等:where 限定 status:'ACTIVE',已 RETIRED 的行不会被重复计数)
    const r = await prisma.tbAccountRegistry.updateMany({ where: { code: { in: RETIRED_TB_CODES }, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
    console.log(`retired ${r.count} registry rows (${RETIRED_TB_CODES.join('/')})`);
    console.log('COA v2 migration DONE');
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
