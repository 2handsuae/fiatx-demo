# effectiveDate 平账准备字段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TbTransferEvidence + AccountFlow 双表加 `effectiveDate`（YYYY-MM-DD 业务日），对账引擎按"等价保真复合过滤式"切换消费，存量回填——为平账处置期"补账算回昨天"铺路。

**Architecture:** 唯一写入漏斗（`writeEvidence`）打日期 → 投影器复制 → 引擎 3 处过滤切换为 `OR: [生效日<截止日 全进, 生效日==截止日 按物理时刻卡]`。存量数据上与现行为逐笔等价（证明见 spec §3），零回归。

**Tech Stack:** Prisma + SQLite（DateTime 物理存储 = **整数 epoch 毫秒**，已实测）、NestJS、jest（fake-prisma 单测模式）。

**Spec:** `doc-final/superpowers/specs/2026-07-03-effective-date-prep-design.md`

**执行位置:** 仓库 `Exchange_js/` 目录、`feat/recon-round3-cockpit` 分支（main worktree 直接做，不开新 worktree）。所有命令在 `Exchange_js/` 内执行。

---

## 已核实的关键事实（执行者不用再查）

| 事实 | 证据 |
|---|---|
| SQLite 里 Prisma DateTime = INTEGER epoch 毫秒 | `sqlite3 /tmp/exchange_js_main/dev.db "SELECT createdAt, typeof(createdAt) FROM account_flows LIMIT 1"` → `1782973337141\|integer` |
| 全仓按日期过滤 AccountFlow 只有 3 处 | checker `:100` / matcher `:160` / query-service `:670`，均为 `createdAt: { lte: cutoff }` |
| 唯一 evidence 写入漏斗 | `tb-evidence.service.ts` `writeEvidence()`，`evidenceData` 内显式 `createdAt: new Date()`；两处 update（:117/:165）不碰日期 |
| 单测是 fake-prisma 内存仿真 | checker/matcher spec 各有 `makePrismaMock` 自己实现 where 过滤，**切过滤式必须同步改仿真** |
| `recon:demo` 已指向 main 栈 | package.json:45 `DATABASE_URL=file:/tmp/exchange_js_main/dev.db TB_ADDRESS=127.0.0.1:3003` |
| 手动触发 run 的既有入口 | `POST /admin/reconciliation/runs/wallet`（要 admin token）；本计划另加离线 `recon:rerun` 脚本免登录 |

---

### Task 1: 基线捕获 + Schema 迁移 + 存量回填

**Files:**
- Modify: `prisma/schema.prisma`（TbTransferEvidence ~:1446、AccountFlow ~:1490）
- Create: `prisma/migrations/20260703090000_effective_date_prep/migration.sql`

- [ ] **Step 1: 捕获金闸门基线（必须在任何代码改动之前）**

```bash
npm run recon:demo:reset && npm run recon:demo:break 2>&1 | tee /tmp/recon-effdate-baseline.txt
```

Expected: 九场景注入 + run 完成。基线文件留给 Task 4 diff 判定行（PASS/BREAK 结论行，不比对随机 ref/编号）。

- [ ] **Step 2: schema 加列**

`TbTransferEvidence` 在 `createdAt` 上一行加：

```prisma
  effectiveDate String  @default("") // 业务归属日 YYYY-MM-DD（UTC）；default 仅为 SQLite ALTER 所需，写入方必须显式设置
```

`AccountFlow` 在 `createdAt` 上一行加（同注释）：

```prisma
  effectiveDate        String   @default("")
```

- [ ] **Step 3: 手写迁移（加列 + 回填一体）**

`prisma/migrations/20260703090000_effective_date_prep/migration.sql`：

```sql
-- AlterTable: 平账准备字段（业务归属日）
ALTER TABLE "tb_transfer_evidence" ADD COLUMN "effectiveDate" TEXT NOT NULL DEFAULT '';
ALTER TABLE "account_flows" ADD COLUMN "effectiveDate" TEXT NOT NULL DEFAULT '';

-- Backfill: effectiveDate = createdAt 的 UTC 日期（createdAt 物理存储为 epoch 毫秒整数）
UPDATE "tb_transfer_evidence" SET "effectiveDate" = strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch');
UPDATE "account_flows"        SET "effectiveDate" = strftime('%Y-%m-%d', "createdAt" / 1000, 'unixepoch');
```

- [ ] **Step 4: 应用迁移 + 重新生成 client**

```bash
bash scripts/apply-local-migrations.sh && npm run prisma:generate
```

Expected: 迁移应用成功，无 drift 报错。

- [ ] **Step 5: 回填验证（三查）**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT count(*) FROM account_flows WHERE effectiveDate = '';"
sqlite3 /tmp/exchange_js_main/dev.db "SELECT count(*) FROM tb_transfer_evidence WHERE effectiveDate = '';"
sqlite3 /tmp/exchange_js_main/dev.db "SELECT count(*) FROM account_flows WHERE effectiveDate != strftime('%Y-%m-%d', createdAt/1000, 'unixepoch');"
```

Expected: 三条全部 `0`。

- [ ] **Step 6: tsc**

```bash
npx tsc --noEmit
```

Expected: 0 错。

- [ ] **Step 7: Commit**

```bash
git add prisma/ && git commit -m "feat(recon): effectiveDate 平账准备字段——双表加列+存量回填迁移（spec §2/§4）"
```

---

### Task 2: 生产侧——业务日工具 + writeEvidence 打日期 + 投影器复制（TDD）

**Files:**
- Create: `src/modules/accounting/tigerbeetle/utils/business-date.util.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（writeEvidence evidenceData）
- Modify: `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts`（EvidenceLike / AccountFlowRow / projectEvidence shared / persist upsert update 块）
- Test: `src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts`、`src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts`

- [ ] **Step 1: 建业务日工具（与 wallet-recon-run.service.ts:940 同口径：UTC ISO 取日）**

`src/modules/accounting/tigerbeetle/utils/business-date.util.ts`：

```ts
// 业务归属日（UTC）：与 recon run 的 businessDate 换算同口径。
export function toBusinessDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: 投影器 spec 写红测**

`account-flow-projector.service.spec.ts`：所有 `EvidenceLike` fixture（约 :38 的 base fixture 与 :215 附近各一处，以 tsc 报错为准找全）加 `effectiveDate: '2026-06-26',`；在 "both rows share transfer-level fields" 用例的逐行断言处加：

```ts
expect(r.effectiveDate).toBe('2026-06-26');
```

- [ ] **Step 3: 跑测确认失败**

```bash
npx jest src/modules/clearing-settle/reconciliation/projector --silent
```

Expected: FAIL（TS 编译错 `effectiveDate` 不在 EvidenceLike，或断言 undefined）。

- [ ] **Step 4: 投影器实现（四处各一行）**

`account-flow-projector.service.ts`：

```ts
// EvidenceLike 接口，createdAt 行后：
  effectiveDate: string;

// AccountFlowRow 接口，createdAt 行后：
  effectiveDate: string;

// projectEvidence() 的 shared 对象，createdAt 行后：
      effectiveDate: evidence.effectiveDate,

// persist() 的 upsert update 块（显式字段列表），assetCode 行后：
          effectiveDate: row.effectiveDate,
```

- [ ] **Step 5: 跑测通过**

```bash
npx jest src/modules/clearing-settle/reconciliation/projector --silent
```

Expected: PASS。

- [ ] **Step 6: tb-evidence spec 写红测**

`tb-evidence.service.spec.ts` 的 `describe('writeEvidence')` 内加：

```ts
    it('stamps effectiveDate = UTC date of the same instant as createdAt', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue(params);

      await service.writeEvidence(params);

      const data = mockPrisma.tbTransferEvidence.create.mock.calls[0][0].data;
      expect(data.effectiveDate).toBe(data.createdAt.toISOString().slice(0, 10));
    });
```

- [ ] **Step 7: 跑测确认失败**

```bash
npx jest src/modules/accounting/tigerbeetle/tb-evidence --silent
```

Expected: FAIL（`data.effectiveDate` undefined）。

- [ ] **Step 8: writeEvidence 实现——createdAt 与 effectiveDate 必须取自同一时刻**

`tb-evidence.service.ts` 顶部加 import：

```ts
import { toBusinessDate } from './utils/business-date.util';
```

`writeEvidence()` 内，`const evidenceData = {` 之前加一行、`createdAt` 行改写、其后加一行：

```ts
      const now = new Date();
      const evidenceData = {
        // ……既有字段全部不动……
        createdAt: now,
        effectiveDate: toBusinessDate(now),
      };
```

（即把原 `createdAt: new Date(),` 替换为 `createdAt: now,` + `effectiveDate: toBusinessDate(now),`，`now` 在对象外先取。）

- [ ] **Step 9: 跑测通过 + tsc**

```bash
npx jest src/modules/accounting/tigerbeetle/tb-evidence src/modules/clearing-settle/reconciliation/projector --silent && npx tsc --noEmit
```

Expected: 全 PASS、tsc 0 错。

- [ ] **Step 10: Commit**

```bash
git add src/modules/accounting/tigerbeetle/ src/modules/clearing-settle/reconciliation/projector/
git commit -m "feat(recon): writeEvidence 打 effectiveDate + 投影器复制（唯一写入漏斗，spec §2）"
```

---

### Task 3: 消费侧——等价保真过滤式 + 引擎 3 处切换 + fake 仿真同步（TDD）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/v2/effective-cutoff.ts`
- Create: `src/modules/clearing-settle/reconciliation/engine/v2/effective-cutoff.spec.ts`
- Modify: `engine/v2/wallet-balance-checker.service.ts:100`、`engine/v2/wallet-flow-matcher.service.ts:160`、`domain/reconciliation-query.service.ts:670`
- Test: `engine/v2/wallet-balance-checker.service.spec.ts`、`engine/v2/wallet-flow-matcher.service.spec.ts`

- [ ] **Step 1: 过滤式纯函数 spec 先行（红）**

`src/modules/clearing-settle/reconciliation/engine/v2/effective-cutoff.spec.ts`：

```ts
import { effectiveCutoffFilter } from './effective-cutoff';

describe('effectiveCutoffFilter', () => {
  it('builds the two-branch OR filter: back-valued days all-in, cutoff day gated by physical instant', () => {
    const cutoff = new Date('2026-06-26T12:00:00Z');
    expect(effectiveCutoffFilter(cutoff)).toEqual({
      OR: [
        { effectiveDate: { lt: '2026-06-26' } },
        { effectiveDate: '2026-06-26', createdAt: { lte: cutoff } },
      ],
    });
  });
});
```

Run: `npx jest src/modules/clearing-settle/reconciliation/engine/v2/effective-cutoff --silent` → Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现过滤式**

`src/modules/clearing-settle/reconciliation/engine/v2/effective-cutoff.ts`：

```ts
// 等价保真复合过滤式（spec §3）：
//   生效日 < 截止日 → 全进（平账回填的账落这段）
//   生效日 = 截止日 → 仍按物理写入时刻卡截止点（保持现行为逐笔等价）
// 证明：存量数据满足 effectiveDate == date(createdAt) 时 ⟺ 旧式 createdAt ≤ cutoff。
import { toBusinessDate } from '../../../../accounting/tigerbeetle/utils/business-date.util';

export function effectiveCutoffFilter(cutoff: Date) {
  const businessDate = toBusinessDate(cutoff);
  return {
    OR: [
      { effectiveDate: { lt: businessDate } },
      { effectiveDate: businessDate, createdAt: { lte: cutoff } },
    ],
  };
}
```

Run 同上 → Expected: PASS。

- [ ] **Step 3: checker spec——fake 仿真升级 + 回填吸收红测**

`wallet-balance-checker.service.spec.ts`：

(a) `makePrismaMock` 的 flows 类型加 `effectiveDate?: string;`（可选——存量 fixture 不用动，缺省时按 createdAt 推导）。

(b) 过滤仿真：把 `if (where.createdAt?.lte && f.createdAt > where.createdAt.lte) return false;` 替换为：

```ts
          const eff = (x: any) => x.effectiveDate ?? x.createdAt.toISOString().slice(0, 10);
          if (where.OR) {
            const pass = where.OR.some((cond: any) =>
              cond.effectiveDate?.lt !== undefined
                ? eff(f) < cond.effectiveDate.lt
                : eff(f) === cond.effectiveDate && (!cond.createdAt?.lte || f.createdAt <= cond.createdAt.lte),
            );
            if (!pass) return false;
          }
```

(c) 紧挨既有 `it('cutoff is honored: flows after cutoff are excluded', ...)` 用例后加新红测：

```ts
  it('back-valued flow (effectiveDate < cutoff day) is included even when createdAt is after cutoff', async () => {
    const prisma = makePrismaMock({
      flows: [
        { tbAccountId: 'acct-pay', direction: 'IN', amount: 500, walletRef: 'c-vault-1', createdAt: new Date('2026-06-26T01:00:00Z') },
        // 平账回填：物理写入晚于截止时刻，但生效日在截止日之前 → 必须被吸收
        { tbAccountId: 'acct-pay', direction: 'IN', amount: 300, walletRef: 'c-vault-1', createdAt: new Date('2026-06-27T09:00:00Z'), effectiveDate: '2026-06-25' },
      ],
      registry: REG_CUSTOMER,
    });
    const svc = new WalletBalanceCheckerService(prisma as any);
    const result = await svc.checkBalance({ walletRef: 'c-vault-1', externalClosing: 800n, cutoff });
    expect(result.pass).toBe(true);
    expect(result.internal.payable).toBe(800n);
  });
```

Run: `npx jest src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker --silent` → Expected: 新用例 FAIL（服务还在发旧式 `createdAt lte`，fake 的 OR 分支收不到，回填行进不来）。

- [ ] **Step 4: checker 切换**

`wallet-balance-checker.service.ts` 加 import：

```ts
import { effectiveCutoffFilter } from './effective-cutoff';
```

:96 起的 where 改为：

```ts
      where: {
        walletRef,
        transferType: 'POSTED',
        ...effectiveCutoffFilter(cutoff),
      },
```

Run 同上 → Expected: 全 PASS（含既有 'cutoff is honored'——等价保真的单测实证）。

- [ ] **Step 5: matcher spec——同款仿真升级 + 候选池红测**

`wallet-flow-matcher.service.spec.ts`：

(a) `makePrismaMock` 内把 `if (where.createdAt?.lte && f.createdAt > where.createdAt.lte) return false;` 替换为与 Step 3(b) 完全相同的代码块。

(b) 加新红测（放在既有 orphan_internal 用例之后）：

```ts
  it('back-valued internal flow (effectiveDate < cutoff day) enters the candidate pool', async () => {
    const prisma = makePrismaMock([
      {
        id: 'flow-bv',
        walletRef: 'w-cust',
        direction: 'IN',
        amount: 700,
        externalRef: '0xbv',
        isExternalCrossing: true,
        eventCode: 'DEPOSIT_CONFIRMED',
        createdAt: new Date('2026-06-27T09:00:00Z'), // 物理写入在 cutoff 之后
        effectiveDate: '2026-06-25',                  // 生效日回填到截止日之前 → 必须进池
      },
    ]);
    const svc = new WalletFlowMatcherService(prisma as any, noOrdersFundsOrderService);
    const result = await svc.matchFlows({ walletRef: 'w-cust', externalLines: [], cutoff });
    expect(result.orphanInternal).toHaveLength(1);
  });
```

Run: `npx jest src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher --silent` → Expected: 新用例 FAIL。

- [ ] **Step 6: matcher 切换**

`wallet-flow-matcher.service.ts` 加 import（同 Step 4），:155 起的 where 改为：

```ts
      where: {
        walletRef,
        isExternalCrossing: true,
        transferType: 'POSTED', // PENDING transfers haven't externally crossed yet — same filter as balanceChecker
        ...effectiveCutoffFilter(cutoff),
      },
```

Run 同上 → Expected: 全 PASS。

- [ ] **Step 7: query-service 下钻切换（无独立单测，Task 4 e2e 覆盖）**

`reconciliation-query.service.ts` 加 import：

```ts
import { effectiveCutoffFilter } from '../engine/v2/effective-cutoff';
```

:666 起的 where 改为：

```ts
      where: {
        walletRef: kase.walletRef,
        isExternalCrossing: true,
        ...effectiveCutoffFilter(cutoff),
      },
```

- [ ] **Step 8: 全量回归 + tsc**

```bash
npx jest src/modules/clearing-settle/reconciliation --silent && npx tsc --noEmit
```

Expected: recon 模块全 PASS、tsc 0 错。

- [ ] **Step 9: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/
git commit -m "feat(recon): 引擎 3 处切换 effectiveDate 等价保真过滤式（spec §3）"
```

---

### Task 4: recon:rerun 脚本 + 金闸门 + 回填吸收 e2e + 收口

**Files:**
- Create: `scripts/recon-rerun.ts`
- Modify: `package.json`（scripts 加 `recon:rerun`）
- Modify: `doc-final/reference/roadmap.md`（交付记录）

- [ ] **Step 1: 离线重跑脚本（平账期的常驻工具，不是临时脚本）**

`scripts/recon-rerun.ts`：

```ts
// 离线触发一次 per-wallet 对账 run（不经 HTTP、不用登录）。
// 用途：平账回填后重跑验证；e2e 闭环。
// Run: npm run recon:rerun    （或加 --cutoff=2026-07-03T12:00:00Z）
//
// Node 18 polyfill: @nestjs/schedule calls crypto.randomUUID() at module
// load. Must precede every other import.
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WalletReconRunService } from '../src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service';

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--cutoff='));
  const cutoff = arg ? new Date(arg.slice('--cutoff='.length)) : new Date();
  if (Number.isNaN(cutoff.getTime())) throw new Error(`invalid --cutoff: ${arg}`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const svc = app.get(WalletReconRunService);
    const result = await svc.run({ cutoff });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

`package.json` scripts（紧挨 `recon:demo` 系列）加：

```json
    "recon:rerun": "DATABASE_URL=\"file:/tmp/exchange_js_main/dev.db\" TB_ADDRESS=127.0.0.1:3003 ts-node -r tsconfig-paths/register scripts/recon-rerun.ts",
```

- [ ] **Step 2: 全局硬闸**

```bash
npx tsc --noEmit && npx jest --silent 2>&1 | tail -3
```

Expected: tsc 0 错；jest 基线 = `4 failed, 2 skipped`（asset-treasury/wallets 既有），**净新增失败 0**。

- [ ] **Step 3: 清扫窗口期空值行（T1 迁移后、T2 代码生效前，主栈 dev 后端可能写入过 '' 行）**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "UPDATE tb_transfer_evidence SET effectiveDate = strftime('%Y-%m-%d', createdAt/1000, 'unixepoch') WHERE effectiveDate = '';
UPDATE account_flows SET effectiveDate = strftime('%Y-%m-%d', createdAt/1000, 'unixepoch') WHERE effectiveDate = '';"
sqlite3 /tmp/exchange_js_main/dev.db "SELECT count(*) FROM account_flows WHERE effectiveDate = '';"
```

Expected: 最后一条 `0`。

- [ ] **Step 4: 金闸门——九场景结果与基线逐字一致**

```bash
npm run recon:demo:reset && npm run recon:demo:break 2>&1 | tee /tmp/recon-effdate-after.txt
grep -E "PASS|BREAK|✓|✗|scenario|场景" /tmp/recon-effdate-baseline.txt > /tmp/base-verdicts.txt
grep -E "PASS|BREAK|✓|✗|scenario|场景" /tmp/recon-effdate-after.txt  > /tmp/after-verdicts.txt
diff /tmp/base-verdicts.txt /tmp/after-verdicts.txt && echo "GOLDEN_GATE_OK"
```

Expected: `GOLDEN_GATE_OK`（判定行零差异；runNo/随机 ref 不在比对集）。若 grep 模式与 demo 实际输出格式不符，先看 baseline 文件确定判定行样式再调整两边一致的 grep——两边必须用同一模式。

- [ ] **Step 5: 回填吸收 e2e——把一个 BREAK 钱包用"算回昨天"的补账修平**

(a) 找目标（外部比内部多的 BREAK 钱包）：

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT rw.walletRef, rw.assetCode, rw.deltaAmount FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id = rw.runId WHERE rw.bucket='BREAK' AND CAST(rw.deltaAmount AS REAL) > 0 ORDER BY r.createdAt DESC LIMIT 1;"
```

记下 `<walletRef>` `<assetCode>` `<delta>`。（若九场景只有 delta<0 的 BREAK，改选 delta<0 的钱包，下面 INSERT 的 direction 用 `OUT`、金额取绝对值。）

(b) 找该钱包一个已被引擎计数的账户腿（非聚合科目）：

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT DISTINCT af.tbAccountId FROM account_flows af JOIN tb_account_registry reg ON reg.tbAccountId = af.tbAccountId WHERE af.walletRef='<walletRef>' AND reg.code NOT IN (1, 50) LIMIT 1;"
```

（若表名不对，先 `sqlite3 /tmp/exchange_js_main/dev.db ".tables" | tr ' ' '\n' | grep -i registry` 确认。）

(c) 插入回填流水（effectiveDate=昨天、createdAt=现在——正是复合式第一段要吸收的形态）：

```bash
sqlite3 /tmp/exchange_js_main/dev.db "INSERT INTO account_flows (id, tbTransferId, tbAccountId, walletRef, direction, amount, isExternalCrossing, externalRef, eventCode, sourceType, sourceNo, transferType, assetCode, createdAt, effectiveDate) VALUES ('bv-e2e-1', 'bv-e2e-tx-1', '<tbAccountId>', '<walletRef>', 'IN', '<delta>', 0, NULL, 'MANUAL_BACKVALUE_TEST', 'MANUAL', 'BV-TEST', 'POSTED', '<assetCode>', CAST(strftime('%s','now') AS INTEGER)*1000, date('now','-1 day'));"
```

(d) 重跑 + 断言：

```bash
npm run recon:rerun > /tmp/recon-rerun-out.json
sqlite3 /tmp/exchange_js_main/dev.db "SELECT rw.bucket, rw.deltaAmount FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id = rw.runId WHERE rw.walletRef='<walletRef>' ORDER BY r.createdAt DESC LIMIT 1;"
```

Expected: `deltaAmount = 0` 且 `bucket != 'BREAK'`（余额差被昨天生效的补账全额吸收；若该场景还有流水孤儿则落 SOFT_FLAG，属预期）。

(e) 清数据 + 复原验证：

```bash
sqlite3 /tmp/exchange_js_main/dev.db "DELETE FROM account_flows WHERE id='bv-e2e-1';"
npm run recon:rerun > /dev/null
sqlite3 /tmp/exchange_js_main/dev.db "SELECT rw.bucket FROM reconciliation_run_wallets rw JOIN reconciliation_runs r ON r.id = rw.runId WHERE rw.walletRef='<walletRef>' ORDER BY r.createdAt DESC LIMIT 1;"
```

Expected: 回到 `BREAK`（数据清干净，run 结果随之复原）。

- [ ] **Step 6: 文档收口**

`doc-final/reference/roadmap.md` 的 Round3 交付记录之后追加一条本轮交付记录（effectiveDate 准备字段：双表双写 + 引擎等价保真切换 + recon:rerun 工具；处置回填口子留待平账期）。

- [ ] **Step 7: Commit**

```bash
git add scripts/recon-rerun.ts package.json doc-final/reference/roadmap.md
git commit -m "feat(recon): recon:rerun 离线重跑工具 + effectiveDate 金闸门/回填吸收 e2e 收口（spec §5）"
```

---

## 自审记录

- Spec 覆盖：§2 写入漏斗+投影 → T2；§3 三处切换+等价证明 → T3（既有 'cutoff is honored' 用例即等价实证）；§4 迁移+回填+格式坑 → T1（毫秒整数已实测）；§5 四道闸门 → T1 Step1 基线 / T4 Step2 硬闸 / T4 Step4 金闸门 / T4 Step5 e2e；§6 明确不做 → 无任务越界。
- 占位符扫描：无 TBD/TODO；Step 4(金闸门) 的 grep 模式给了自适应指引但两边同模式的判定标准明确。
- 类型一致性：`effectiveCutoffFilter(cutoff: Date)` 三处调用一致；`toBusinessDate` 两处 import 路径已核（accounting 内 `./utils/business-date.util`，engine/v2 内 `../../../../accounting/tigerbeetle/utils/business-date.util`）。
- 已知边界：demo/e2e 会改写 main 栈 demo 数据（该栈即演示场，reset 可复原）；`wallet-recon-run.service.ts` 私有 `toBusinessDate` 保留不动（外科手术原则，不做顺手重构）。
