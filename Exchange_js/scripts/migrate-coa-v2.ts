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
// 幂等，容忍"两笔转账之间"的中途失败重跑：
//   - 202 余额已为 0 → 整条 ledger 跳过重分类（210/211/212 账户的存在性检查仍会先跑一遍）。
//   - 每个目标桶单独比较"历史应搬 Σ - 本脚本此前已搬 Σ"，已搬完的桶跳过、只搬未搬完的余量
//     （TigerBeetle 侧的确定性 transferId 本身也会去重，这里额外做金额级别的余量核算，
//     使得"进程在三笔转账中途崩溃后重跑"不会被前两笔已消耗掉的余额误判成"对不上账"）。
//   - registry 行已 RETIRED → updateMany 的 where 已限定 status:'ACTIVE'，重跑不再触碰。
//   注意：executeTransfer 是"TB 先记、evidence 后写"，若进程恰好崩在两者之间（TB 转账已落地
//   但 evidence 行还没写完），重跑时 alreadyMoved 读不到这笔（evidence 缺失）而 202 的 TB 余额
//   已经减过了 → 会触发下面的 mismatch 检查、拒绝继续。这种情况不是自愈的，需要人工核对 TB 侧
//   与 evidence 表后手动补写 evidence 行，不能指望"重跑"本身把账对平。
//
// 保对账连续性：三笔重分类的两腿(debitWalletRef/creditWalletRef)都盖同一个 F_FEE 物理钱包的
// ref —— 这笔钱物理上从未挪动过（还在同一个钱包里），只是会计分类变了；两腿同盖同一钱包，
// 该钱包内部收支相抵，对账余额不受影响。

import { webcrypto } from 'node:crypto';
// Node18 polyfill: @nestjs/schedule 在模块注册期调用 crypto.randomUUID()，必须在任何拉起
// AppModule 的 import 之前打好补丁（照抄 scripts/demo-lib.ts 的既有解法）。
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
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

      // 1) 确保 210/211/212 已存在(新栈由 provisioning 造;老栈这里补)。必须放在零余额
      //    跳过判断之前、无条件对每条 202 registry 行执行 —— 某资产可能从未产生过费
      //    (202 registry 行在但余额恒为 0),若把这步挂在"bal202 !== 0"分支下,该资产的
      //    210/211/212 就永远不会被建,合并后该资产第一笔兑换费/提现费/没收会在
      //    resolveTbAccountId 直接抛 NotFoundException。
      const targetIds = new Map<number, bigint>();
      for (const s of SPLIT) {
        let creditId: bigint;
        try {
          creditId = await accounting.resolveTbAccountId({ code: s.toCode, ledger, ownerType: 'SYSTEM' });
        } catch (err: any) {
          if (err instanceof NotFoundException) {
            // Account does not exist, create it
            await accounting.createAccounts([{
              code: s.toCode, ledger, ownerType: 'SYSTEM', assetCurrency: row.assetCode,
              description: `${s.toCoa} for ${row.assetCode} (COA v2 migration)`,
            }]);
            creditId = await accounting.resolveTbAccountId({ code: s.toCode, ledger, ownerType: 'SYSTEM' });
          } else {
            // Non-registry error: re-throw with context
            throw new Error(`ledger ${ledger}: failed to resolve/create code ${s.toCode} (${s.toCoa}): ${err.message}`);
          }
        }
        targetIds.set(s.toCode, creditId);
      }

      // 2) 前置检查:202 上是否还有未结清的在途 PENDING 证据行。TigerBeetle 的 pending
      //    转账只记在 credits_pending,不进 credits_posted,所以下面第 3 步算出的 bal202
      //    看不见它们;但它们迟早会被 post,一旦 post 就会把钱打进已经退役的 202 账户,
      //    破坏 verify:coa 的"退役户恒零"断言。这是"合法的在途分录",跟"未知来源分录"
      //    (mismatch,第 4 步)是两类问题,必须分开报错,不能让运维误诊成数据对不上账。
      const stuckPending = await prisma.tbTransferEvidence.findFirst({
        where: { creditCode: 'E.FIRM_FEE', creditTbAccountId: row.tbAccountId, transferType: 'PENDING' },
      });
      if (stuckPending) {
        throw new Error(
          `ledger ${ledger}: 202 has an in-flight PENDING evidence row (sourceNo=${stuckPending.sourceNo}, ` +
          `eventCode=${stuckPending.eventCode}) that has not been posted or voided yet — resolve it first ` +
          `(let the order post or void), then re-run the migration. This is NOT an unknown-source mismatch: ` +
          `it is a legitimate pending leg that would land in the retired 202 account after migration.`,
        );
      }

      // 3) 202 当前 TB 余额(权益/负债类,贷方计正)
      const [acct] = (await tb.lookupAccounts([debitAccountId])) as any[];
      if (!acct) throw new Error(`ledger ${ledger}: 202 TB account ${row.tbAccountId} not found in TigerBeetle — registry/TB drift, investigate`);
      const bal202: bigint = BigInt(acct.credits_posted) - BigInt(acct.debits_posted);
      if (bal202 < 0n) throw new Error(`ledger ${ledger}: 202 balance negative (${bal202}) — investigate before migrating`);
      if (bal202 === 0n) { console.log(`ledger ${ledger}: 202 already zero, skip reclass`); continue; }

      // 4) 按事件类型码分组的历史贷方和(不可变的切换前证据行,单位与 TB 一致:最小单位整数)。
      //    只计 transferType='POSTED' 的行 —— 凭证模型是"一 TB 转账一行,post 把该行原地
      //    翻成 POSTED、void 翻成 VOIDED"(见 accounting.service.ts 的 postPendingTransfer /
      //    voidPendingTransfer)。swap 费腿 / 提现费腿 / 没收费腿都走 pending→post 两阶段,
      //    腿失败重试会在同一行留下 VOIDED——这些钱从未真正 post 进 202,若不过滤会被计入
      //    historicalΣ,导致 Σ > 实际余额,触发下面的"evidence split mismatch"且永远修不好
      //    (这是合法历史,没有任何运营动作能消除它)。
      const historical = new Map<number, bigint>();
      for (const s of SPLIT) {
        const agg = await prisma.tbTransferEvidence.aggregate({
          where: { eventCode: s.eventCode, creditCode: 'E.FIRM_FEE', creditTbAccountId: row.tbAccountId, transferType: 'POSTED' },
          _sum: { amount: true },
        });
        historical.set(s.txnCode, BigInt(agg._sum.amount?.toString() ?? '0'));
      }
      // 4b) 本脚本此前(可能中途失败的)运行已经搬走的部分 — 靠这组数字撑起"中途崩溃后重跑"的幂等。
      //     executeTransfer 是一次性直接落 POSTED(不经过 pending 阶段),理论上不会产生非
      //     POSTED 的 COA_V2_RECLASS 行;这里仍显式同口径过滤,防御性一致。
      const alreadyMoved = new Map<number, bigint>();
      for (const s of SPLIT) {
        const agg = await prisma.tbTransferEvidence.aggregate({
          where: { eventCode: 'COA_V2_RECLASS', debitCode: 'E.FIRM_FEE', creditCode: s.toCoa, sourceNo: `COA-V2-${ledger}-${s.txnCode}`, transferType: 'POSTED' },
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

      // 5) F_FEE 物理钱包 ref — 两腿同盖同一 ref(钱物理上没动过,只是会计分类变了)
      const asset = await prisma.asset.findUnique({ where: { code: row.assetCode } });
      let feeWalletRef: string | null = null;
      if (asset) {
        try {
          const wallet = await systemWalletResolver.resolve(asset.id, 'F_FEE');
          feeWalletRef = wallet.id;
        } catch (err: any) {
          console.warn(`ledger ${ledger}: F_FEE wallet not found for asset ${row.assetCode} — proceeding without walletRef (${err.message})`);
        }
      } else {
        console.warn(`ledger ${ledger}: asset ${row.assetCode} not found — reclassified entries will lack walletRef (metadata only, amounts unaffected)`);
      }

      // 6) 逐桶重分类:DR 202 / CR 新户,金额=历史应搬-已搬余量
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

      // 7) 断言 202 清零
      const [after] = (await tb.lookupAccounts([debitAccountId])) as any[];
      const balAfter: bigint = BigInt(after.credits_posted) - BigInt(after.debits_posted);
      if (balAfter !== 0n) throw new Error(`ledger ${ledger}: 202 not zero after reclass (${balAfter}) — investigate`);
      console.log(`ledger ${ledger}: 202 → 0 ✓`);
    }

    // 8) 退役前安全网:203/204(FIRM_LIQ/FIRM_SEIZED)没有定义重分类目标,直接断言其余额已为零
    //    才允许退役(202 的清零已在上面的循环里断言过,这里再统一复核一遍,双保险)。
    const retiredRows = await prisma.tbAccountRegistry.findMany({ where: { code: { in: RETIRED_TB_CODES } } });
    for (const row of retiredRows) {
      const [acct] = (await tb.lookupAccounts([hexToBigint(row.tbAccountId)])) as any[];
      if (!acct) throw new Error(`code ${row.code} ledger ${row.ledger}: TB account ${row.tbAccountId} not found — registry/TB drift, investigate`);
      const bal: bigint = BigInt(acct.credits_posted) - BigInt(acct.debits_posted);
      if (bal !== 0n) throw new Error(`code ${row.code} ledger ${row.ledger}: non-zero balance (${bal}) — refuse to retire, investigate`);
    }

    // 9) 退役 registry 行(幂等:where 限定 status:'ACTIVE',已 RETIRED 的行不会被重复计数)
    const r = await prisma.tbAccountRegistry.updateMany({ where: { code: { in: RETIRED_TB_CODES }, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
    console.log(`retired ${r.count} registry rows (${RETIRED_TB_CODES.join('/')})`);
    console.log('COA v2 migration DONE');
  } finally {
    await app.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
