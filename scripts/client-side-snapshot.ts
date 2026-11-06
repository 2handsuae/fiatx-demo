// scripts/client-side-snapshot.ts
//
// 客户侧对照采样（战役戊波一 Task 0）：把「客户在自己 App 里看得见的一切」拍成一份稳定 JSON，
// 改账本前拍一份、改完再拍一份，diff 为空 = 客户侧零变化（"等价迁移"的证据）。
//
// 只读：不写库、不写账本。直接调客户端 `client/portfolio/*` 控制器的读方法
// （= 客户 App 实际命中的那几个端点，里面再走 CustomerPortfolioService / TbEvidenceService /
// CustomerStatementService / MonthlyStatementService），余额另读 AccountingService.getCustomerAvailableBalance。
// 控制器方法是直接调用——不经 JWT guard，用 { user: { type:'CUSTOMER', userId } } 冒充请求体即可。
//
// 用法（必须经栈包装器，缺 DATABASE_URL / TB_ADDRESS 会当场失败）：
//   bash scripts/on-stack.sh self client:snapshot -- --out <path>
//
// 输出：{ [customerNo]: { balances, statementRows, monthlyStatements, portfolio } }，
//   - 全部 customer_main 里的种子客户（⊇ demo-lib 花名册 + Henry），按 customerNo 升序
//   - 所有 id / uuid / *At 时间戳递归剥除（跨重铺不稳定）；业务单号、金额、币种、方向、标题、业务月保留
//     （唯一例外：generateReferenceNo 格式的单号只遮末 6 位随机数，见 maskRandomOrderNo）
//   - 对账单行 / 月结单行按内容排序（不依赖 createdAt 次序；balanceAfter 链仍可还原先后）
//   - 剥完仍残留 uuid / ISO 时间戳样的字符串值 → 直接抛错，不带进快照

import { requireStackEnv } from './require-stack-env';
requireStackEnv({ requireTb: true });

import * as fs from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { CustomerPortfolioController } from '../src/modules/asset-treasury/treasury/customer-portfolio.controller';
import { DEMO_CUSTOMER_EMAILS, FROZEN_PERSONA_EMAIL } from './demo-lib';

// 花名册下限：demo-lib 的可交易客户 + Frank + Henry（statement-only 种子客户）必须都在快照里。
const REQUIRED_EMAILS = [...DEMO_CUSTOMER_EMAILS, FROZEN_PERSONA_EMAIL, 'demo_acme@example.com'];

// 一页拿全：控制器默认 take=50，demo 数据远小于此，给足上限免得静默截断。
const STATEMENT_TAKE = '100000';

const CURRENCIES = Object.keys(TB_LEDGERS).sort() as Array<keyof typeof TB_LEDGERS>;

function parseOut(argv: string[]): string {
  const i = argv.indexOf('--out');
  const out = i >= 0 ? argv[i + 1] : undefined;
  if (!out) throw new Error('usage: client:snapshot -- --out <path>');
  return path.resolve(process.cwd(), out);
}

// ── 剥 id / uuid / 时间戳（键名口径）──
const STRIP_KEY = /^(id|uuid)$|Id$|Ids$|Uuid$|At$/;

// generateReferenceNo 生成的单号 = 3 位前缀 + yymmdd + 6 位随机数（demo:all 现造的 DEP/SWP/WDR 等）。
// 末 6 位每次重铺都不同；账本重构不碰 sourceNo，故只遮这 6 位（保留前缀 + 日期，仍看得出单型与日期）。
// 种子单号（buildDeterministicNo：前缀 + 260101 + 4 位）与 STM-… 号长度不同，不命中，原样保留。
const RANDOM_ORDER_NO = /\b([A-Z]{3}\d{6})\d{6}\b/g;
const maskRandomOrderNo = (s: string) => s.replace(RANDOM_ORDER_NO, '$1######');

function strip(v: unknown): unknown {
  if (typeof v === 'string') return maskRandomOrderNo(v);
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (STRIP_KEY.test(k)) continue;
      o[k] = strip(val);
    }
    return o;
  }
  return v;
}

// ── 值口径的残留扫描：剥完不许再有 uuid / ISO 时间戳样的字符串 ──
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function assertNoResidue(v: unknown, where: string): void {
  if (typeof v === 'string') {
    if (UUID_RE.test(v) || ISO_TS_RE.test(v)) throw new Error(`snapshot residue (uuid/timestamp-like value) at ${where}: ${v}`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => assertNoResidue(x, `${where}[${i}]`));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) assertNoResidue(x, `${where}.${k}`);
  }
}

// ── 稳定排序 ──
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// 稳定字段在前、（已遮罩的）单号垫后：随机尾号不再参与排序，行序跨重铺一致。
function rowKey(r: any): string {
  const refs = (r.refs ?? []).map((x: any) => `${x.sourceType}:${x.sourceNo}`).join('|');
  return [r.kind, r.title, r.amount, r.feeAmount ?? '', r.balanceAfter, r.subtitle ?? '', refs].join('\u0001');
}

function sortRows(rows: any[]): any[] {
  return [...rows].sort((a, b) => cmp(rowKey(a), rowKey(b)) || cmp(JSON.stringify(a), JSON.stringify(b)));
}

async function main() {
  const out = parseOut(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  // 只读脚本不该顺手跑后台 sweep（@Cron 每 30s 一轮会出具月结单 / 发通知——那是写）。
  // 立刻停掉本进程内的全部 cron；栈上常驻的后端进程不受影响。
  for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();

  try {
    const prisma: any = app.get(PrismaService);
    const accounting = app.get(AccountingService);
    const portfolio = app.get(CustomerPortfolioController);

    const customers: Array<{ id: string; customerNo: string; email: string }> = await prisma.customerMain.findMany({
      select: { id: true, customerNo: true, email: true },
      orderBy: { customerNo: 'asc' },
    });
    const missing = REQUIRED_EMAILS.filter((e) => !customers.some((c) => c.email === e));
    if (missing.length) throw new Error(`roster customers missing (run business seed): ${missing.join(', ')}`);

    const result: Record<string, unknown> = {};
    for (const c of customers) {
      const req = { user: { type: 'CUSTOMER', userId: c.id } };

      // 余额：客户钱包 = CLIENT_PAYABLE。ledger = 已入账净额(total)，held = 在途锁定，available = ledger - held。
      // 没开过 TB 户的币种 → 稳定标记，不让一个客户拖垮整份快照。
      const balances: Record<string, unknown> = {};
      for (const cur of CURRENCIES) {
        try {
          const b = await accounting.getCustomerAvailableBalance(c.id, cur);
          balances[cur] = { ledger: b.total.toString(), held: b.held.toString(), available: b.available.toString() };
        } catch (err: any) {
          balances[cur] = { error: err?.response?.code ?? err?.name ?? 'ERROR' };
        }
      }

      // 对账单：客户 App「某币种流水」端点原样（items 已是 tipping-off 白名单后的客户面行）。
      const statementRows: Record<string, unknown> = {};
      for (const cur of CURRENCIES) {
        const s: any = await portfolio.getStatement(req, cur, undefined, undefined, '0', STATEMENT_TAKE);
        statementRows[cur] = {
          total: s.total,
          currentBalance: String(s.currentBalance),
          decimals: s.decimals,
          rows: sortRows(strip(s.items) as any[]),
        };
      }

      // 月结单：列表 + 逐张详情（冻结快照）。issuedAt / postedAt 被剥；statementNo / periodMonth 是业务键。
      const list: any = await portfolio.listMonthlyStatements(req);
      const monthlyStatements: unknown[] = [];
      for (const it of [...list.items].sort((a: any, b: any) => cmp(a.statementNo, b.statementNo))) {
        const d: any = await portfolio.getMonthlyStatement(req, it.statementNo);
        monthlyStatements.push(
          strip({
            statementNo: d.statementNo,
            periodMonth: d.periodMonth,
            sections: [...d.sections]
              .sort((a: any, b: any) => cmp(a.assetCode, b.assetCode))
              .map((s: any) => ({ ...s, rows: sortRows(strip(s.rows) as any[]) })),
          }),
        );
      }

      // 资产组合：客户 App 首页「各币种可用 / 锁定」。assetId 被剥；按币种排序。
      const pf: any[] = await portfolio.getBalances(req);
      const portfolioItems = (strip(pf) as any[]).sort((a, b) => cmp(a.currency, b.currency));

      result[c.customerNo] = { balances, statementRows, monthlyStatements, portfolio: portfolioItems };
    }

    assertNoResidue(result, '$');

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log(`client snapshot: ${customers.length} customers -> ${out}`);
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('FATAL', e);
    process.exit(1);
  },
);
