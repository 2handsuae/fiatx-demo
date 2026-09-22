# 第六幕波五「业务日迪拜午夜切 + 演示面清点 + 文档收口」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务执行本计划。步骤用 `- [ ]` 勾选跟踪。
> **Spec:** `doc-final/superpowers/specs/2026-09-21-act6-wave5-cob-closeout-design.md`（本计划从 spec 论证，执行者两份都读）
> **总纲:** `doc-final/superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md`——本波是末波，收尾逐条复验总纲 §0 六条战役级判据

**Goal:** 业务日从 UTC 切换为迪拜午夜切（9 位点 / 8 文件含 1 处前端），收口 §G 五条演示可见项（三甲案已拍板），修完文档数字腐烂并完成战役收官。

**Architecture:** `business-date.util.ts` 做唯一真源（toBusinessDate 重写 + endOf/startOfBusinessDate 新增），全部日终/日始位点改为消费 util；`runs/wallet` 契约收 `businessDate` 让前端不算日终；严重度阈值按币种进 `recon-thresholds.constant.ts` 注册表（fail-fast）；INTERNAL_BREAK 修写入语义 + 前端三态；其余为定点收口。

**Tech Stack:** NestJS + Prisma + SQLite ｜ React (admin-web) ｜ jest ｜ TigerBeetle

## Global Constraints（每个任务隐含遵守）

- **通用交付清单见 `rules/delivery-checklist.md`，全部适用**（各任务末尾的「收尾过检」行列出本任务命中的触发行，由本 plan 写死，执行者不得自行判省）
- 本轮特有：
- **演示系统纪律**（CLAUDE.md §0–§2）：只做演示者带同事走流程时看得到、讲得到的东西；幂等/去重/重试/并发锁/兼容层/防御性校验/性能优化一律不做；数据随时可重铺，禁 backfill/双写。
- **六条铁律**（CLAUDE.md §5）：操作必留痕｜门不可绕｜各管各的｜状态只能沿边走｜钱动必过账｜**对外用业务键**（本波 §2.4 正是它）。
- **Node 20**：本机 shell 默认 node18，**每条 Bash 命令前置** `export PATH="$(ls -d $HOME/.nvm/versions/node/v20* | tail -1)/bin:$PATH" && `；zsh 管道取退出码用 `${pipestatus[1]}` 或不走管道。
- **worktree 隔离**：一律在 `.claude/worktrees/act6_wave5`（分支 `worktree-act6_wave5`）干活；栈命令 worktree 内用 `bash scripts/stack.sh up|reset`（=self），跑 `demo:*`/`recon:*`/`verify:*` 必经 `bash scripts/on-stack.sh self <script>`，绝不裸跑、绝不碰 main 栈端口。
- **测试判据**：绿必须来自行为；禁「扫源码文本」断言；禁两种恒真形态（返回类型即断言集合 / mock 原样回显）；新增关键检查须做一次失效验证（变异让它红）再报绿。
- **jest 基线**：对账三域 29 suites / 567 tests（波前），只增不减。跑法：`DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave5/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers`，在仓库根（worktree 根）下跑。
- **UI 全英文**。
- **闸门**：每任务收尾跑闸①②③（根 tsc / admin tsc -b / client tsc -b）+ 本任务相关 jest；commit 用具名文件 `git add`，不用 `git add -A`。
- **派发分层**：任务执行/走查/文档收口 subagent 用 `model: sonnet`；任务级评审与终审**省略 model 字段**（继承主会话，不降档）。
- 位点行号以 spec 清册为锚，但**定位一律按符号/上下文搜**，不盲跳行号（波四判例：行号会漂）。

---

### Task 0: 开树与波前取证（基线快照 + 严重度取数）

**Files:**
- 无代码改动；产出 `doc-final/superpowers/checkups/2026-09-21-act6-wave5-evidence/`（本任务起建，后续任务持续投喂）

**Interfaces:**
- Produces: `evidence/before/` 截图集与 jest/verify 基线记录；`evidence/severity-distribution.txt`（Task 5 的取数输入）

- [ ] **Step 1: 建 worktree**：用 superpowers:using-git-worktrees 建 `.claude/worktrees/act6_wave5`，分支 `worktree-act6_wave5`，基线 = 当前 main HEAD（记下短哈希）。
- [ ] **Step 2: 起栈重铺**：worktree 内 `rm -f /tmp/exchange_js_wt_act6_wave5/dev.db` → `bash scripts/stack.sh reset` → `bash scripts/stack.sh up` → 等就绪（后端端口见本树 `.stackports`）。
- [ ] **Step 3: 跑波前基线**：三域 jest（预期 29 suites / 567 tests 全绿，原样记录数字）；`bash scripts/on-stack.sh self demo:all`、`bash scripts/on-stack.sh self recon:demo:break` 各一次全绿；`bash scripts/on-stack.sh self verify:coa` 全绿。三条命令 + 退出码 + 关键行存 `evidence/before/gates.txt`。
- [ ] **Step 4: 波前截图**（preview 指向本树 admin 端口，treasury@ 快速登录）：①案件列表页（严重度徽章可见）②任一 BREAK run 详情页（现状红条+五卡）③一张含划转腿在途行的案件详情（场景 16-18 的钱包，**按 seed 打印的钱包/单号锚定选案**，不用 pick 兜底——骨架新事实 2 的教训）④该划转腿的资金单详情页（推单动作区可见）⑤划转单列表页（URL 带 treasury/ 前缀入镜）。存 `evidence/before/`。
- [ ] **Step 5: 严重度取数**：

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave5/dev.db" npx ts-node -r tsconfig-paths/register -e "
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const cases = await p.reconciliationCase.findMany({ select: { caseNo: true, assetCode: true, deltaAmount: true, severity: true } });
  for (const c of cases) console.log([c.assetCode, c.deltaAmount.toString(), c.severity, c.caseNo].join('\t'));
  await p.\$disconnect();
})();"
```

（字段名以 schema 为准，跑不通先查 `prisma/schema.prisma` 的 ReconciliationCase）。输出存 `evidence/severity-distribution.txt`，附一行小结：各币种 |delta| 的量级范围、现状三档分布。
- [ ] **Step 6: Commit**（只 evidence 目录）：`docs(波五T0): 波前基线取证与严重度取数`

**收尾过检**（delivery-checklist）：零代码取证任务，无触发行。

### Task 1: business-date.util 重写（迪拜午夜切唯一真源）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/utils/business-date.util.ts`
- Create: `src/modules/accounting/tigerbeetle/utils/business-date.util.spec.ts`

**Interfaces:**
- Produces: `toBusinessDate(at: Date): string`（迪拜日）；`endOfBusinessDate(businessDate: string): Date`（= `D T19:59:59.999Z`）；`startOfBusinessDate(businessDate: string): Date`（= `(D-1) T20:00:00.000Z`）；`DUBAI_UTC_OFFSET_MS`。Task 2-6 全部消费这组签名。

- [ ] **Step 1: 写失败测试**（新建 spec 文件）：

```ts
import { toBusinessDate, endOfBusinessDate, startOfBusinessDate } from './business-date.util';

describe('business-date.util（迪拜午夜切）', () => {
  it('UTC 19:59:59.999 仍属当日业务日', () => {
    expect(toBusinessDate(new Date('2026-09-21T19:59:59.999Z'))).toBe('2026-09-21');
  });
  it('UTC 20:00:00.000 已属次日业务日（迪拜零点）', () => {
    expect(toBusinessDate(new Date('2026-09-21T20:00:00.000Z'))).toBe('2026-09-22');
  });
  it('迪拜凌晨归当日——修 UTC 切日把迪拜 1/5 02:00 记成 1/4 的病（BACKLOG:136 原文场景）', () => {
    expect(toBusinessDate(new Date('2026-01-04T22:00:00.000Z'))).toBe('2026-01-05');
  });
  it('endOfBusinessDate = D T19:59:59.999Z', () => {
    expect(endOfBusinessDate('2026-09-21').toISOString()).toBe('2026-09-21T19:59:59.999Z');
  });
  it('startOfBusinessDate = (D-1) T20:00:00.000Z', () => {
    expect(startOfBusinessDate('2026-09-21').toISOString()).toBe('2026-09-20T20:00:00.000Z');
  });
  it('三函数闭环：日始/日终归属 D，日终 +1ms 归属 D+1', () => {
    expect(toBusinessDate(startOfBusinessDate('2026-09-21'))).toBe('2026-09-21');
    expect(toBusinessDate(endOfBusinessDate('2026-09-21'))).toBe('2026-09-21');
    expect(toBusinessDate(new Date(endOfBusinessDate('2026-09-21').getTime() + 1))).toBe('2026-09-22');
  });
});
```

- [ ] **Step 2: 跑测试确认红**：`npx jest src/modules/accounting/tigerbeetle/utils/business-date.util.spec.ts`。预期：前三条中「20:00 → 次日」「迪拜凌晨」两条 FAIL（现实现是 UTC），`endOf/startOf` 报「不存在」。
- [ ] **Step 3: 重写实现**：

```ts
// 业务归属日：迪拜日历日（恒定 UTC+4，无夏令时）。2026-09-21 波五起从 UTC 切换
// （业主拍板见 decisions.md 2026-09-19 / 2026-09-21 两条）：
//   时刻 t 的业务日 = (t + 4h) 的 UTC 日期；业务日 D 的日终 = D T19:59:59.999Z。
// 全仓表达业务日边界只许经本文件，不许手拼 T23:59:59.999Z / T00:00:00Z。
export const DUBAI_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

export function toBusinessDate(at: Date): string {
  return new Date(at.getTime() + DUBAI_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** 业务日 D 的最后一刻（含）：D+1 迪拜零点 − 1ms = D T19:59:59.999Z。 */
export function endOfBusinessDate(businessDate: string): Date {
  return new Date(new Date(`${businessDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000 - DUBAI_UTC_OFFSET_MS - 1);
}

/** 业务日 D 的第一刻：D 迪拜零点 = (D-1) T20:00:00.000Z。 */
export function startOfBusinessDate(businessDate: string): Date {
  return new Date(new Date(`${businessDate}T00:00:00.000Z`).getTime() - DUBAI_UTC_OFFSET_MS);
}
```

- [ ] **Step 4: 跑测试确认绿**；再跑闸①（根 tsc）——此刻**允许**其它文件仍绿（它们还在消费旧 `toBusinessDate` 签名，签名未变）。
- [ ] **Step 5: 变异实证**：临时把 `DUBAI_UTC_OFFSET_MS` 改 `0`，重跑 spec 必红（「20:00 → 次日」「迪拜凌晨」两条挂）；截关键输出行存 `evidence/mutation-business-date.txt`，还原。
- [ ] **Step 6: Commit**：`feat(波五T1): business-date.util 迪拜午夜切——toBusinessDate 重写+endOf/startOfBusinessDate 唯一真源`

**收尾过检**：纯后端 util+测试，无触发行（记账口径变更的 `verify:coa` 由 Task 11 统一过——本任务不落账，只改边界函数）。

### Task 2: 对账域日终位点改造之一（私有重复件删除 + 账龄线 + 回填判定）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`（删私有 `toBusinessDate` :1088 一带，改 import）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.ts`（`computeAgingDeadline`）
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/effective-cutoff.ts`
- Test: 上述各自的 `.spec.ts`（thresholds / effective-cutoff / wallet-recon-run）

**Interfaces:**
- Consumes: Task 1 的三个函数。
- Produces: 无新接口；`wallet-recon-run.service.ts` 内 `this.toBusinessDate(` 调用点清零。

- [ ] **Step 1: wallet-recon-run 删重复件**：按符号搜 `private toBusinessDate`，整个方法删除；文件头补 `import { toBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';`；两处调用（按 `this.toBusinessDate(` 搜，现 :117/:154）改直呼 `toBusinessDate(`。
- [ ] **Step 2: recon-thresholds**：`computeAgingDeadline` 改为：

```ts
import { endOfBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';

/** 截止时刻 = 业务日日终（迪拜午夜，business-date.util 单一口径）+ 账龄线天数。 */
export function computeAgingDeadline(businessDate: string): Date {
  return new Date(endOfBusinessDate(businessDate).getTime() + RECON_AGING_DAYS * 86_400_000);
}
```

- [ ] **Step 3: effective-cutoff**：`const endOfBusinessDate = new Date(\`${businessDate}T23:59:59.999Z\`)` 行改为消费 util（本地变量改名避免撞函数名）：

```ts
import { toBusinessDate, endOfBusinessDate } from '../../../../accounting/tigerbeetle/utils/business-date.util';

export function effectiveCutoffFilter(cutoff: Date) {
  const businessDate = toBusinessDate(cutoff);
  const endOfBiz = endOfBusinessDate(businessDate);
  return {
    OR: [
      { effectiveDate: { lt: businessDate } },
      { effectiveDate: businessDate, createdAt: { lte: cutoff } },
      { effectiveDate: businessDate, createdAt: { gt: endOfBiz } },
    ],
  };
}
```

- [ ] **Step 4: 修三个 spec 到迪拜口径**：先跑（`npx jest <三个 spec 路径>` + `DATABASE_URL` 前缀）看红在哪；把断言里的 UTC 边界字面改迪拜口径——日终 `T19:59:59.999Z`、日始 `T20:00:00.000Z`、跨日用例的时刻字面整体挪 4 小时，**断言语义一条不改**（改的是边界数值不是行为预期）。全绿为止。
- [ ] **Step 5: 变异实证（回填边界）**：临时把 effective-cutoff 第三支的 `gt: endOfBiz` 改回 `gt: new Date(\`${businessDate}T23:59:59.999Z\`)`，effective-cutoff.spec 必红；记录、还原。
- [ ] **Step 6: 闸①②③ + 三域 jest 全绿；Commit**：`feat(波五T2): 私有 toBusinessDate 删除+账龄线/回填判定改走迪拜日终 util`

**收尾过检**：纯后端边界函数改造，无触发行（`verify:coa` 由 Task 11 统一过）。

### Task 3: 对账域日终位点改造之二（查询回落/日窗 + 推单「今天」 + 补单兜底）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`（两位点）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/push-order.service.ts`（`assertValidExternalDate`）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.ts`（:125 兜底）
- Test: 各自 `.spec.ts`

**Interfaces:**
- Consumes: Task 1 的三个函数。

- [ ] **Step 1: query 回落截止**（按 `T23:59:59.999Z` 搜，现 :532）：`lastObservedRun?.cutoffAt ?? endOfBusinessDate(cutoffBusinessDate)`，:528 一带注释里的「23:59:59」措辞同步为「业务日日终（迪拜口径）」；文件头补 import。
- [ ] **Step 2: query 日窗**（现 :1009-1010）：`dayLo = startOfBusinessDate(cutoffDate)`、`dayHi = endOfBusinessDate(cutoffDate)`。
- [ ] **Step 3: push-order「今天」**：

```ts
private assertValidExternalDate(d: string, orderCreatedAt: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('External value date must be in YYYY-MM-DD format');
  const today = toBusinessDate(new Date());
  if (d > today) throw new BadRequestException('External value date cannot be in the future');
  if (d < toBusinessDate(orderCreatedAt)) {
    throw new BadRequestException('External value date cannot be earlier than the order creation date');
  }
}
```

（文件头补 import；该文件后续 Task 7 还要改 `loadPushable`，两任务各自 commit 不并笔。）
- [ ] **Step 4: supplement-evidence 兜底**：`businessDate: li?.case?.businessDate ?? toBusinessDate(line.datetime)` + import。
- [ ] **Step 5: 修四个 spec 到迪拜口径**（方法同 Task 2 Step 4）；全绿。
- [ ] **Step 6: 同款清点复跑**：spec §1.2 的两条复现命令重跑，确认 `src/` 内业务日位点仅剩「判不改」清单（假单号/日志两类）；结果存 `evidence/sweep-after-t3.txt`。
- [ ] **Step 7: 闸①②③ + 三域 jest；Commit**：`feat(波五T3): 查询回落/日窗+推单今天判定+补单兜底改走迪拜口径`

**收尾过检**：纯后端边界改造，无触发行（`verify:coa` 由 Task 11 统一过）。

### Task 4: runs/wallet 契约收 businessDate（前端不算日终）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts`（`createWalletRun`）
- Modify: `admin-web/src/utils/reconRunTrigger.ts`

**Interfaces:**
- Produces: `POST /admin/reconciliation/runs/wallet` body `{ cutoff?: string; businessDate?: string }` 恰传一个；路由与权限码不变。

- [ ] **Step 1: controller**：

```ts
async createWalletRun(@Body() dto: { cutoff?: string; businessDate?: string }, @Req() req: any) {
  const hasCutoff = !!dto?.cutoff;
  const hasBusinessDate = !!dto?.businessDate;
  if (hasCutoff === hasBusinessDate) {
    throw new BadRequestException('Provide exactly one of cutoff (ISO timestamp) or businessDate (YYYY-MM-DD)');
  }
  let cutoff: Date;
  if (hasBusinessDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.businessDate!)) throw new BadRequestException('businessDate must be YYYY-MM-DD');
    cutoff = endOfBusinessDate(dto.businessDate!);
  } else {
    cutoff = new Date(dto.cutoff!);
    if (Number.isNaN(cutoff.getTime())) throw new BadRequestException('cutoff is not a valid ISO timestamp');
  }
  // …以下沿用原方法体（把原来对 dto.cutoff 的解析删掉，其余不动）
```

（import `endOfBusinessDate`；不新增 controller spec——controllers/ 目录无 spec 先例，行为闸=Task 11 场景 9 实走 + demo:all。）
- [ ] **Step 2: reconRunTrigger.ts**：`body: JSON.stringify({ businessDate })`，头注释补一句「日终换算在后端（迪拜口径，business-date.util）——前端不算业务日边界」。
- [ ] **Step 3: 调用方清点复核**：`grep -rn "runs/wallet" admin-web/src client-web/src scripts src --include="*.ts" --include="*.tsx"`——预期命中仅 reconRunTrigger（已改）、verify-act1（传 cutoff，兼容不动）、rbac.catalog/verify-rbac（路由登记）。结果入 evidence。
- [ ] **Step 4: 行为验证**：worktree 栈上开任一案件详情点「Re-reconcile」，确认 200 且 run 落库 `businessDate` = 迪拜今日（`sqlite3` 查最新 run 行）；admin-web 无 console 报错。
- [ ] **Step 5: 闸①②③；Commit**：`feat(波五T4): runs/wallet 契约收 businessDate——Re-reconcile 日终换算收回后端`

**收尾过检**：非新增端点（路由与权限码不变，RBAC 零动、不触发 sync/重启行）；改了前端但**视觉零变化**——行为实点代截图（Step 4 Re-reconcile 200 + run 落库迪拜业务日）。

### Task 5: 严重度按币种拆线（fail-fast 注册表）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.ts`（新增 `SEVERITY_LINES_MINOR` + `severityLinesFor`）
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`（`computeSeverity` 签名 + 调用侧带 currency）
- Test: `recon-thresholds.constant.spec.ts`、`wallet-recon-run.service.spec.ts`

**Interfaces:**
- Produces: `computeSeverity(currency: string, delta: bigint): 'HIGH'|'MEDIUM'|'LOW'`；`severityLinesFor(currency): { med: bigint; high: bigint }`（缺币种抛错）。

- [ ] **Step 1: 先写失败测试**（thresholds spec 新 describe）：

```ts
import { severityLinesFor } from './recon-thresholds.constant';

describe('severityLinesFor（按币种，fail-fast）', () => {
  it('AED 与 USDT 线已注册且 high > med', () => {
    for (const c of ['AED', 'USDT']) {
      const { med, high } = severityLinesFor(c);
      expect(high > med).toBe(true);
    }
  });
  it('未注册币种当场抛错，不静默兜底', () => {
    expect(() => severityLinesFor('BTC')).toThrow(/Severity lines not registered/);
  });
});
```

跑之，红（函数不存在）。
- [ ] **Step 2: 实现注册表**（与小额线同居、同注释风格）：

```ts
/**
 * 严重度线（最小单位）：按 asset.currency 索引（同小额线——USDT 的 code 是 'USDT-TRON'）。
 * 等值锚沿小额线 100 AED ↔ 30 USDT 惯例；政策数走发版评审，不做管理台可配。
 * 终值若因演示分布整体调档，须保持币种间等值比例，并同步 demo/baseline.md（波五 spec §2.2）。
 */
export const SEVERITY_LINES_MINOR: Record<string, { med: bigint; high: bigint }> = {
  AED: { med: 10_000n /* 100.00 AED */, high: 1_000_000n /* 10,000.00 AED */ },
  USDT: { med: 30_000_000n /* 30 USDT */, high: 3_000_000_000n /* 3,000 USDT */ },
};

export function severityLinesFor(currency: string): { med: bigint; high: bigint } {
  const lines = SEVERITY_LINES_MINOR[currency];
  if (!lines) throw new Error(`Severity lines not registered for currency: ${currency}——add a line in recon-thresholds.constant.ts first; no silent fallback`);
  return lines;
}
```

- [ ] **Step 3: 对照 Task 0 取数定终值**：读 `evidence/severity-distribution.txt`。规则（spec §2.2）：初值先套；若某币种案件全塌 LOW 失去徽章演示密度，把该两档线**按同一系数整体下移**（币种间等值比例不破坏），使种子分布至少出现两档；终值写回上面注册表并在注释记一行「2026-09-21 按种子分布定档，系数 ×N」。**给出改前/改后各档案件数对照表**存 `evidence/severity-lines-decision.txt`。
- [ ] **Step 4: computeSeverity 换签名**：删 `SEVERITY_HIGH_THRESHOLD`/`SEVERITY_MED_THRESHOLD` 与那段「single asset comparable」过期注释，改为：

```ts
import { severityLinesFor } from '../disposition/recon-thresholds.constant';

export function computeSeverity(currency: string, delta: bigint): CaseSeverity {
  const { med, high } = severityLinesFor(currency);
  const mag = delta < 0n ? -delta : delta;
  if (mag >= high) return 'HIGH';
  if (mag >= med) return 'MEDIUM';
  return 'LOW';
}
```

- [ ] **Step 5: 调用侧带真币种**（陷阱：run 循环变量 `bal.currency` 实存 **asset.code**，`:172` 注释明说）：decimals 批量查 `asset.findMany` 的 select 补 `currency: true`，建 `assetCurrencyByCode` Map；`openCase` 入参加 `currency: string`，调用处传 `assetCurrencyByCode.get(bal.currency)`——取不到就地 `throw new Error(\`Asset currency not found for code: ${bal.currency}\`)`（fail-fast，不吞）；`computeSeverity(input.currency, input.delta)`。全仓 `computeSeverity(` 调用点 grep 清点，预期 = 服务内 1 处 + spec 若干，全部换签名。
- [ ] **Step 6: wallet-recon-run.service.spec 的 computeSeverity 用例改双参**并按新线改预期（如 `computeSeverity('AED', 10_000n)` 现= `MEDIUM`）；补一条跨币种可比性用例：同为「等值 100 AED 量级」的 AED/USDT delta 同档。
- [ ] **Step 7: 变异实证**：临时把 AED 的 `high` 改成 `1n`，跨币种用例/档位用例必红；记录还原。
- [ ] **Step 8: 闸①②③ + 三域 jest；Commit**：`feat(波五T5): 严重度按币种拆线——SEVERITY_LINES_MINOR 注册表+fail-fast（销 BACKLOG:194 代码侧）`

**收尾过检**：「涉及金额→最小单位存」✓（注册表 minor 单位）；前端零改（徽章由后端值驱动），徽章变化截图在 Task 11 after 集统一过。

### Task 6: INTERNAL_BREAK 不再装干净（写入语义 + 三态呈现）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`（finalize 处 `invariantStatus` 写入，现 :593）
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx`（三态 + 藏空表）
- Modify: `admin-web/src/pages/ReconciliationRunsListPage.tsx`（若消费 invariantStatus，连动核）
- Test: `wallet-recon-run.service.spec.ts`

**Interfaces:**
- Consumes: run DTO 现有字段（`invariantStatus`/`walletCount`/`matchedCount` 等），零后端读面变更。

- [ ] **Step 1: 写入语义失败测试**：在 wallet-recon-run.service.spec 加（沿该文件既有 mock prisma 写法，断言写入载荷——写行防线先例，非回显恒真）：`finalize` 走 `status:'BREAK'` 时 update 载荷 `invariantStatus==='PASS'`；走 `'INTERNAL_BREAK'` 时 `==='FAIL'`。跑之，BREAK 一条红（现实现写 FAIL）。
- [ ] **Step 2: 改写入**：`invariantStatus: data.status === 'INTERNAL_BREAK' ? 'FAIL' : 'PASS'`。测试转绿。
- [ ] **Step 3: 消费方连动清点**：`grep -rn "invariantStatus" src admin-web/src --include="*.ts" --include="*.tsx"`，逐处判读：Runs 列表页若渲染恒等徽章，普通 BREAK run 从 FAIL→PASS 是**预期修正**，evidence 里记一行；其它消费方如有语义冲突当场报主会话。
- [ ] **Step 4: 详情页三态**：summary 条改为——`invariantStatus==='FAIL'` 渲染红横幅 `INTERNAL BREAK — internal ledger identity failed; per-wallet reconciliation did not run`；否则 `summary.matchedCount === summary.walletCount` 绿 `PASS — …`、不等红 `BREAK — …`（沿用现有两段文案与样式类）。Health Check 五卡与钱包表包进 `{run.invariantStatus !== 'FAIL' && (…)}`；FAIL 时原位渲染说明块：

```tsx
<DetailCard title="Wallet Comparison" columns={1}>
  <div className="rounded-md border border-adm-border bg-adm-bg px-4 py-3 font-mono text-[13px] text-adm-t2">
    Wallet comparison was skipped: the internal ledger identity pre-gate failed for this run.
    Fix the ledger imbalance and trigger a fresh run — per-wallet results would be meaningless here.
  </div>
</DetailCard>
```

- [ ] **Step 5: 实拍取证**：`cat .stackports` 找 TB 端口 → `kill $(lsof -ti:<TB口>)` → 案件页点 Re-reconcile（或 curl 触发 run）→ Runs 详情出 INTERNAL_BREAK 横幅，截图 `evidence/after/run-internal-break.png` → `bash scripts/stack.sh up` 复活栈 → 再触发正常 run，截 BREAK/PASS 对照图。preview console 零报错。
- [ ] **Step 6: 闸①②③ + 三域 jest；Commit**：`feat(波五T6): INTERNAL_BREAK 写入语义修正+run 详情三态呈现（销 BACKLOG:192 空表危险）`

**收尾过检**：「改了前端→preview + 截图」✓（Step 5 实拍 INTERNAL_BREAK 横幅 + 正常对照）。

### Task 7: 划转腿推单显式拒（后端 + 前端两处连动）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/push-order.service.ts`（`loadPushable`）
- Modify: `admin-web/src/components/reconciliation/CaseFlowTable.tsx`（在途分支）
- Modify: `admin-web/src/pages/FundsOrderDetail.tsx`（推单动作块）
- Test: `push-order.service.spec.ts`

- [ ] **Step 1: 失败测试**：照该 spec 里 swap 拒斥用例镜像一条——`internalTransferId` 非空的单调 `loadPushable` 所在公开方法，断言抛 `BadRequestException` 且 message 含 `transfer workflow`。红。
- [ ] **Step 2: 后端拒**：`loadPushable` 在 swap 判断后加：

```ts
if (order.internalTransferId) {
  throw new BadRequestException(
    'Internal-transfer-leg funds orders are advanced by the transfer workflow — push order is not supported for them; open the internal transfer detail page instead',
  );
}
```

测试绿。`toView` 上方注释「swap 已在 loadPushable 拒绝」补「transfer 腿同」。
- [ ] **Step 3: CaseFlowTable 在途分支**：`row.transfer` 优先于 `row.fundsOrderNo`：

```tsx
) : row.matchType === 'IN_TRANSIT' ? (
  row.transfer ? (
    <Link
      to={`/admin/custody/internal-transfers/${encodeURIComponent(row.transfer.transferNo)}`}
      className="whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline"
    >
      Transfer leg →
    </Link>
  ) : row.fundsOrderNo ? (
    /* 原 Push order → 链接原样 */
  ) : (
    <span className="text-[10px] text-adm-t3">In-transit · no funds order</span>
  )
) : (
```

（`custody/` 前缀依赖 Task 9 之前也可先写 `custody/`——Task 9 改路由定义在 App.tsx，本链接按终态写，Task 9 收尾统一 grep 校验。）
- [ ] **Step 4: FundsOrderDetail**：推单动作区（Sync push / Manual confirm 所在块）渲染条件补 `&& !data.internalTransferId`；`internalTransferId` 非空时原位渲染一行说明 `Internal-transfer leg — advanced by the transfer workflow; see the linked transfer.`（与 swap 不同：swap 腿有本页替代端点故留动作，划转腿无、故藏——注释一句说明差异）。
- [ ] **Step 5: 渲染取证**：场景 16-18 的划转腿案件详情（Task 0 锚定的同一案）——在途行现显「Transfer leg →」，点进划转详情页 200；该腿资金单详情——推单块消失、说明行 + 既有关联链接在。截图 before/after 对照入 evidence。
- [ ] **Step 6: 闸①②③ + 三域 jest；Commit**：`feat(波五T7): 划转腿推单显式拒（甲案）——后端照 swap 先例+前端双入口连动（销 BACKLOG:128）`

**收尾过检**：「退役业务动作→前端入口同步删」✓（Step 3/4 双入口）；「改了前端→截图」✓（Step 5）；三域对称之问已答——照 swap 腿既有拒斥先例对齐，充值/提现腿保持可推是设计本意。

### Task 8: 开案/自愈审计留痕换业务键（walletRef UUID → walletNo）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts`（`auditCaseOpened` / `auditCaseAutoHealed`）
- Test: `reconciliation-case.service.spec.ts`

- [ ] **Step 1: 失败测试**：spec 里两条审计的 metadata 断言改为期望 `walletNo: <业务号>` 且无 `walletRef` 键（mock prisma 的 wallet 查询须行为化返回 `{ walletNo: 'WA…' }`，不许回显式恒真）。红。
- [ ] **Step 2: 实现**：两方法体内 `const walletNo = await resolveWalletNo(this.prisma, input.walletRef);`，metadata 改 `{ walletNo, bucket, deltaAmount, caseNo, slaDeadline }` / `{ walletNo, caseNo }`（键名一并换）。绿。
- [ ] **Step 3: 影响面复核**（spec §2.4 已核，执行时复跑）：`grep -n "walletRef" scripts/export-audit-vocab.ts`（预期零命中）；`grep -rn "metadata.*walletRef\|walletRef.*metadata" admin-web/src`（预期零特判）。
- [ ] **Step 4: 落库实证**：worktree 栈 `rm -f /tmp/exchange_js_wt_act6_wave5/dev.db` → `bash scripts/stack.sh reset` → `bash scripts/on-stack.sh self demo:all` → sqlite 查 `RECON_CASE_OPENED`/`RECON_CASE_AUTO_HEALED` 各≥1 条，metadata 里 `grep -E '[0-9a-f]{8}-[0-9a-f]{4}'` 零命中（**审计表判据必须全新库**——reset 不清 audit 表的判例）。命令+关键行入 evidence。
- [ ] **Step 5: 闸①②③ + 三域 jest；Commit**：`feat(波五T8): 开案/自愈审计 metadata 换 walletNo 业务键（铁律⑥，销 BACKLOG:198）`

**收尾过检**：「对外识别用业务键」✓（本任务主旨）；「持久状态变化写审计」——改的就是既有审计本身，`requestId` 原样保留不动。

### Task 9: 划转路由前缀统一 custody/（15 处一次收）

**Files:**
- Modify: `admin-web/src/App.tsx:227,228`（两条 Route path）＋ 13 处 `/admin/treasury/internal-transfers` 字面：`DashboardLayout.tsx:270`、`components/reconciliation/caseDetailBits.tsx:39`、`components/reconciliation/CaseFlowTable.tsx:90`、`pages/auditEntityRoutes.ts:19`、`pages/InternalTransferList.tsx:137`、`pages/FundsOrderDetail.tsx:168`、`pages/approvalEntityRoutes.ts:50`、`pages/IncidentDetailPage.tsx:88,267`、`pages/InternalTransferDetail.tsx:73,128`

- [ ] **Step 1: 改前清点**：`grep -rn "treasury/internal-transfers" admin-web/src client-web/src --include="*.ts" --include="*.tsx" | wc -l`——预期 15（含 Task 7 若已把 CaseFlowTable 新链接写成 custody/ 则相应少 1，以实扫为准记录）。
- [ ] **Step 2: 逐处替换** `treasury/internal-transfers` → `custody/internal-transfers`（App.tsx 是 `path="…"` 相对段，其余是绝对字面）。
- [ ] **Step 3: 终态校验**：`grep -rn "treasury/" admin-web/src client-web/src --include="*.ts" --include="*.tsx"` 路由义命中 = **0**（`CaseFlowTable.tsx:104` 「initiated by treasury」是文案，留）；`grep -n "treasury/internal-transfers" src/modules/identity/access-control/rbac.catalog.ts` = 0（佐证前端路径非权限载体，RBAC 零改动）。
- [ ] **Step 4: 五路走查**（worktree 栈 preview）：侧栏 Custody→Internal Transfers｜案件页划转链接｜审批详情回链｜审计页深链｜事故页回链——各点一次到划转页 200，URL 均 `custody/` 前缀；截图列表页 URL 入镜对照 Task 0 before。
- [ ] **Step 5: 闸②（admin tsc）+ 闸①③；Commit**：`feat(波五T9): 划转路由前缀统一 custody/（甲案，15 处一次收，销 BACKLOG:180）`

**收尾过检**：「改了前端→preview + 截图」✓（Step 4 五路走查 + URL 入镜截图）。

### Task 10: 文档收口（数字腐烂 + 附录重排 + 台账三册）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/bucket-classifier.ts:1`（注释源头）、`scripts/recon-demo.ts:133`
- Modify: `doc-final/modules/v8-recon.md`、`doc-final/reference/recon-cause-handbook.md`、`doc-final/CHANGELOG.md`、`doc-final/demo/script.md`、`doc-final/demo/baseline.md`、`doc-final/BACKLOG.md`

按 spec §3 表逐行执行，另注意：

- [ ] **Step 1: 代码内两处**：`bucket-classifier.ts:1` 注释「五桶」→「四桶（MATCHED/IN_TRANSIT/COMPENSATING/BREAK；INTERNAL_BREAK 是 run 状态不是桶）」；`recon-demo.ts:133` `15-scenario` → `18-scenario`（改后跑一次 `bash scripts/on-stack.sh self demo:all` 确认零波及）。
- [ ] **Step 2: v8-recon.md**：:16/:36/:38/:110 五桶→四桶、:113 成因码 21→20+OTHER；业务日口径段写明迪拜午夜切（引 decisions 2026-09-21）；然后**全文逐数复核**——桶数/成因码数/场景数/处置件数/状态与边数/端点数逐个跟代码对，复核清单（数字、代码依据文件:行、判定）存 `evidence/v8-recon-number-audit.md`。
- [ ] **Step 3: 手册附录重排**：`recon-cause-handbook.md:306-332` §四附录按现行 `demo/script.md` 18 场景 12 案重排，索引号与剧本一致（照 :328 一带的场景引用逐号核）。
- [ ] **Step 4: CHANGELOG 去重**：`sed -n '41p;43p' doc-final/CHANGELOG.md | md5` 确认仍同值后删其一。
- [ ] **Step 5: script.md:193**：种子时限改「**迪拜 18:00（UTC 14:00）前铺**；否则场景 9 外部行（截止点+6h）落到迪拜次日，日终重跑收不回来——照实讲」。
- [ ] **Step 6: baseline.md**：按 Task 5 终值更新严重度分布预期；`grep -n "invariantStatus\|Invariant" doc-final/demo/baseline.md` 如有相关判据按 Task 6 新语义修订。
- [ ] **Step 7: BACKLOG**：销 `:128`/`:136`/`:180`/`:194`/`:198`（`[x]` + 一句收口注）；`:192` 改写为余项「恒等破裂明细呈现（按币种 资产/负债/差额）——空表危险已除（波五横幅），明细待 run 持久化 breaks[] 另议」；新登一行「调账弹窗残存 side 锚推导（`ReconciliationAdjustmentCreateModal.tsx` `prefill.explainedFlowId ? 'FROM' : 'TO'`）是否收编后端——波四/波五两波均判不收，留档」。
- [ ] **Step 8: decisions.md 复核**：三条 2026-09-21 拍板（切点/划转腿/前缀）已随 spec 落档 commit 入册——确认在，不重复添。
- [ ] **Step 9: data.md 同步核**：`grep -n -i "severity\|严重度\|businessDate\|业务日" doc-final/demo/data.md`——2026-09-21 预扫零命中（"Frank HighRisk" 是客户名，无关）；复跑确认仍零命中即免改，如有命中按新口径同步手写区（生成区由 `demo:all` 自己写，不手改）。
- [ ] **Step 10: Commit**：`docs(波五T10): 文档收口——五处数字腐烂+附录 18 场景 12 案+CHANGELOG 去重+台账销登`

**收尾过检**：「改页面或种子→同步 `demo/data.md` + `demo/script.md`」✓（Step 5 script.md:193、Step 9 data.md 零命中核）；「每轮收尾」的 CHANGELOG/BACKLOG 行在本任务 Step 4/7 与 Task 11 Step 8 分担。

### Task 11: 收尾闸 + 场景 9 实走 + 战役收官复验

- [ ] **Step 1: 全量闸**：闸①②③ + 三域 jest（≥ 29/567，实数记录）。
- [ ] **Step 2: 重铺闸**：`rm -f /tmp/exchange_js_wt_act6_wave5/dev.db` → `bash scripts/stack.sh reset` → `bash scripts/stack.sh up` → 等就绪 → `bash scripts/on-stack.sh self demo:all` → `bash scripts/on-stack.sh self recon:demo:break` → 对照**修订后** baseline.md 逐条全绿 → `bash scripts/on-stack.sh self verify:coa` 全绿。命令+退出码+关键行入 `evidence/gates-final.txt`。
- [ ] **Step 3: 场景 9 剧本实走**：按 `demo/script.md` 步骤 9——treasury@ 进 Grace USDT 案 → Hold · Next period 定性（案仍红，截图）→ Re-reconcile → 外部行被迪拜日终截止收回、案子自愈 Resolved（截图）。若铺场时刻已过迪拜 18:00 导致当日收不回，照 script.md:193 新文案如实记录并改日重验，不粉饰。
- [ ] **Step 4: after 截图集**：Task 0 的五张对位重拍（案件列表严重度徽章 / run 详情 / 划转腿案件详情 / 划转腿资金单 / 划转列表 custody URL），加 INTERNAL_BREAK 横幅图（Task 6 已拍）；逐张与 before 对照写差异说明——**本波差异是预期行为变更**，每处差异须能指回 spec 章节。顺带客户端看一眼：任一充值详情页 `Value date` 字段仍正常直显（`DepositDetail.tsx:91` 纯字符串展示，业务日切换只改边界时刻的归属值、不该改渲染）。
- [ ] **Step 5: 战役级六判据复验表**（总纲 §0，末波义务；存 `evidence/campaign-final-audit.md`）：①对账域 `(this.prisma as any)` 归零——复跑波一复现命令 ②三恒真断言已换——指波一物证 + 本波未回退（grep 三处断言现状）③五页截图无假数据——本波 after 集 ④Case 主体/迁移表——指波三物证 + `status` 写点复扫仍收敛 ⑤COB 七处改完+重铺闸+coa——本波 Step 1-3 ⑥文档逐数——Task 10 复核清单。每条给复跑命令或物证指针。
- [ ] **Step 6: WRAPUP**：`evidence/WRAPUP.md`——承诺逐条对代码（spec §1-§3 每项指 commit/文件）、偏差如实记录；对照 `rules/delivery-checklist.md` 逐触发条件核。
- [ ] **Step 7: 终审**（主会话模型不降档）：逐条问「spec 每条承诺的代码在哪」+ 抽查否定性结论复现命令。
- [ ] **Step 8: 合并**：superpowers:finishing-a-development-branch——并进 main 快进；**合并后必做**：主栈重启后端 + `npm run db:base:sync`（惯例保险，本波权限零改动）+ `bash scripts/stack.sh reset main`（行为变更波，主栈重铺）+ 主栈 `on-stack main demo:all` 复绿；CHANGELOG 一行；总纲状态行写波五收官 + 战役收官注；spec/plan 移入 `doc-final/archive/superpowers/`（总纲随末波一并归档与否听业主）；清 worktree + 分支。
- [ ] **Step 9: Thread 完成行**：`Documentation updated: modules§0-4 / demo / decisions / BACKLOG / CHANGELOG — 波五业务日迪拜午夜切+§G 五条+文档收口，第六幕清残留战役收官`

**收尾过检**：「动了钱→`verify:coa`」✓（Step 2，永不豁免②；负余额断言单独看，不因恒等式绿放行）；「改了前端→截图」✓（Step 4，永不豁免①）；「每轮收尾→文档分层报告 + CHANGELOG + BACKLOG」✓（Step 8/9）；「多波中的一波」——末波无下一波 spec，对应物 = 总纲状态行收官注 + spec/plan 归档（Step 8）。

---

## Self-review 记录（写毕自查）

- spec §1.2 九位点 → Task 1(#1)/Task 2(#2#3#4)/Task 3(#5#6#7#8)/Task 4(#9) 全覆盖；§1.3 契约=Task 4；§1.4 判不改清单=Task 3 Step 6 复扫兜底；§1.5 连带文档=Task 10。
- spec §2.1-§2.5 → Task 6/5/7/8/9 一一对应；§2.2 取数前置在 Task 0 Step 5。
- spec §3 表逐行 → Task 10 Step 1-8；§4 验收 1-8 → Task 11 Step 1-8。
- 类型一致性：`endOfBusinessDate(businessDate: string): Date` 在 Task 1 定义、Task 2/3/4 消费同名同签名；`computeSeverity(currency, delta)` Task 5 定义与 spec §2.2 一致；`severityLinesFor` 返回 `{ med, high }` 两处一致。
- 无 TBD/占位；文档编辑步骤均带具体数字与判据来源。
