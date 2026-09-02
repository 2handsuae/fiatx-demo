# 平账 A 批：账龄线 + 公司池核销 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每张打开的对账案子一只账龄钟；到线、财务查不出、金额又小的公司池差异，由金库开核销单、CFO 批、系统落一笔分录，案子自愈；顺带把平账所有审批裁决人改成 CFO、公司账簿冲销定码、修跨日切案件页与三处 tooltip。

**Architecture:** 账龄 = 案件表两列（复用 `slaDeadline` + 新 `slaBreached`）+ 每分钟扫描置标记 + ⚡拨钟端点，三域 SLA 同款；核销 = 调账单**第五族** `WRITE_OFF`，复用现有开单 / 审批 / 落账 / 审计管道，只加四道前提守卫与一个读面 `nextStep`；跨日切 = run 记 `cutoffAt`，案件页按它重建差异行。成因注册表仍是单一来源（删尘埃、公司两成因改冲销、新增 `resolveWriteOff`）。

**Tech Stack:** NestJS 10 + Prisma 5 (SQLite) + TigerBeetle ｜ React + Vite (admin-web) ｜ jest（单测）/ jest-e2e（`test/*.e2e-spec.ts`，on-stack self 串行）

**Spec:** `doc-final/superpowers/specs/2026-09-02-recon-aging-writeoff-design.md`（§ 号引用均指它）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用；本轮特有：**不新增权限组、不新增审批策略、不加状态机边、不建资金单、不新增科目**（spec §2.1 / §3.1 / §3.4 / §8）
- 派 subagent 的 prompt 必须带 CLAUDE.md §0–§5 要点：演示系统不是生产系统 ｜ 判断标准两句 ｜ 禁做清单（幂等 / 去重 / 重试 / 补偿 / 并发锁 / 兼容层 / 权限加固 / 防御校验 / 性能 / 边界防御）｜ 允许假设（单人顺序、外部准时回调一次、管理员善意、数据可重铺）｜ 六铁律（留痕 / 门不可绕 / 各管各 / 状态沿边走 / 钱动必过账 / 对外用业务键）
- 三条数字线写死（spec §2.7）：`RECON_AGING_DAYS = 3`；小额线 `AED 10_000n`（100.00）/ `USDT 30_000_000n`（30.000000），按**币种**（`asset.currency`）而非 `asset.code` 索引；未登记币种直接 throw
- 平账一切审批裁决人 = `CFO`（spec §4）；金库 `TREASURY_OFFICER` 开单；运营 `OPS_OFFICER` 定性
- 审计：每次带**显式 `requestId`**；新码先入 `V8_RECON_AUDIT_ACTIONS` 再接写点（封册守则顺序）；`RECON_CASE_AGING_BREACHED` 系统通道、`RECON_AGING_TIMEOUT_SIMULATED` 操作员通道，两码 `correlationMode: N`、`requiredFields: []`
- 金额一律**最小单位整数字符串**，展示按行下发的 `decimals` 换算；管理台不暴露 UUID（tooltip 也算）
- 案件关闭仍走引擎自愈 `AUTO_HEALED`，不另设关闭原因（spec §3.9）；定性 REJECTED 后不解锁（spec §3.7）
- 每条 Bash 命令前置 Node 20：`source scripts/node-env.sh && ensure_node20 && <命令>`（本机 shell 默认 Node 18）
- 一切与库 / 账本相关的命令走包装器：`bash scripts/on-stack.sh self <npm-script> [-- args]`；worktree 内栈 = self
- 随手闸（每个任务收尾）：`npx tsc --noEmit -p tsconfig.json`；改了 admin-web 再 `cd admin-web && npx tsc -b --noEmit && cd ..`；jest 只跑本任务目录；改了前端 → 起 preview 截图
- 提交信息用业务语言、中文、不带署名行；每个任务一个 commit

## 前置：工作树与栈

```bash
# 在主工作树根（Exchange_js 的上一级 = 重做版/）执行
git worktree add -b feat/recon-aging-writeoff .claude/worktrees/recon-aging main
cd .claude/worktrees/recon-aging/Exchange_js
source scripts/node-env.sh && ensure_node20 && npm ci
bash scripts/stack.sh up            # self 栈，端口记在 .stackports
bash scripts/stack.sh status
```
之后所有任务在 `.claude/worktrees/recon-aging/Exchange_js` 下进行。Task 1 改 schema 后必须 `bash scripts/stack.sh reset self` 重铺一次（含 TigerBeetle 清理重建），再 `bash scripts/on-stack.sh self demo:all` 铺演示数据。

## 文件地图

| 责任 | 文件 | 动作 |
|---|---|---|
| 数据模型 | `prisma/schema.prisma`、`prisma/migrations/20260902150000_recon_case_aging_and_run_cutoff/migration.sql` | 案件 `slaBreached`、跑批 `cutoffAt` |
| 三条数字线 | `src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.ts`（新） | 常量 + `isSmallAmount` |
| 审计词表 | `src/modules/audit-logging/constants/audit-actions.constant.ts` | 两码入 `AuditActions` + `V8_RECON_AUDIT_ACTIONS` |
| 成因注册表 | `disposition/cause-registry.ts` | 删尘埃 / 公司两成因改冲销 / `WRITE_OFF` 族 / `resolveWriteOff` |
| 调账规则 | `disposition/adjustment-rules.ts` | 两个新成因码 |
| 账龄主体 | `workflow/case-aging.service.ts`（新） | 算截止 / 找候选 / 置标记 / ⚡拨钟 + 审计 |
| 账龄扫描 | `sweep/case-aging-sweep.service.ts`（新） | `@Cron` 每分钟 + 到线审计 |
| 跑批 | `workflow/wallet-recon-run.service.ts` | 开案设截止、`cutoffAt`、两处 metadata |
| 读面 | `domain/reconciliation-query.service.ts`、`dto/reconciliation.dto.ts` | `nextStep`、按 `cutoffAt` 重建 |
| 核销守卫 | `disposition/adjustment.service.ts`、`disposition/disposition.service.ts` | 四前提 / 联动放行 / 后果原话 |
| 端点 | `controllers/reconciliation-admin.controller.ts`、`identity/access-control/rbac.catalog.ts`、`reconciliation.module.ts` | ⚡拨钟 route |
| 审批人 | `governance/approvals/constants/approval.constants.ts` | `RECON_ADJUSTMENT_POST` → CFO |
| 前端 | `admin-web/src/pages/ReconciliationCasesListPage.tsx`、`ReconciliationCasesDetailPage.tsx`、`ReconciliationRunsDetailPage.tsx`、`ReconciliationAdjustmentDetailPage.tsx`、`components/ReconciliationAdjustmentCreateModal.tsx`、`components/ReconciliationDispositionModal.tsx` | 超期徽标 / ⚡ / 核销通道 / tooltip |
| 演示种子 | `scripts/recon-demo.ts` | 场景 10 文案 |
| 测试 | 各 `*.spec.ts` + `test/recon-aging-write-off.e2e-spec.ts`（新）+ 两份既有 recon e2e | |
| 文档 | `doc-final/decisions.md`、`modules/v8-recon.md`、`reference/recon-cause-handbook.md`、`demo/script.md`、`demo/data.md`、`BACKLOG.md`、`CHANGELOG.md` | 收口 |

---

### Task 1: 数据模型 + 三条数字线常量

**Files:**
- Modify: `prisma/schema.prisma:1490-1573`（`ReconciliationRun` 加 `cutoffAt`；`ReconciliationCase` 加 `slaBreached`）
- Create: `prisma/migrations/20260902150000_recon_case_aging_and_run_cutoff/migration.sql`
- Create: `src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.ts`
- Test: `src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.spec.ts`

**Interfaces:**
- Produces: `RECON_AGING_DAYS: number`、`SMALL_AMOUNT_LINE_MINOR: Record<string, bigint>`、`isSmallAmount(currency: string, minor: bigint): boolean`（未登记币种 throw `Error`）、`computeAgingDeadline(businessDate: string): Date`；Prisma 列 `reconciliationCase.slaBreached: boolean`、`reconciliationRun.cutoffAt: Date | null`

- [ ] **Step 1: 写常量单测（先红）**

```ts
// src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.spec.ts
import {
  RECON_AGING_DAYS, SMALL_AMOUNT_LINE_MINOR, isSmallAmount, computeAgingDeadline,
} from './recon-thresholds.constant';

describe('recon-thresholds —— 三条数字线写死代码（spec §2.7），改动走发版评审', () => {
  it('账龄线 3 天；小额线 AED 100.00 / USDT 30.000000，按币种索引', () => {
    expect(RECON_AGING_DAYS).toBe(3);
    expect(SMALL_AMOUNT_LINE_MINOR.AED).toBe(10_000n);
    expect(SMALL_AMOUNT_LINE_MINOR.USDT).toBe(30_000_000n);
  });
  it('isSmallAmount：等于小额线算小额（≤），超一分即大额', () => {
    expect(isSmallAmount('AED', 7n)).toBe(true);
    expect(isSmallAmount('AED', 10_000n)).toBe(true);
    expect(isSmallAmount('AED', 10_001n)).toBe(false);
    expect(isSmallAmount('USDT', 30_000_000n)).toBe(true);
    expect(isSmallAmount('USDT', 30_000_001n)).toBe(false);
  });
  it('未登记币种直接 throw，不兜底', () => {
    expect(() => isSmallAmount('BTC', 1n)).toThrow(/BTC/);
  });
  it('computeAgingDeadline = 业务日日终（UTC）+ 3 天', () => {
    expect(computeAgingDeadline('2026-09-01').toISOString()).toBe('2026-09-04T23:59:59.999Z');
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.spec.ts`
Expected: FAIL，`Cannot find module './recon-thresholds.constant'`

- [ ] **Step 3: 写常量文件**

```ts
// src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.ts
// 平账 A 批（spec §2.7）：三条数字线写死代码——财务政策数，改动该走发版评审，
// 不做管理台可配（同 TR 阈值先例 decisions.md 2026-07-31）。演示靠 ⚡拨钟。
// 容差本批不做（decisions.md 2026-09-02「一分不差，一分也追」），故这里只有两条线。

/** 账龄线：案件业务日日终起算，到线置「超期」标记（软破线，状态不动）。 */
export const RECON_AGING_DAYS = 3;

/**
 * 小额线（最小单位）：查无果的公司池差异，≤ 线才许核销；> 线只能升级事故（三期）。
 * 按**币种**（asset.currency）索引，不按 asset.code（USDT 的 code 是 'USDT-TRON'）。
 */
export const SMALL_AMOUNT_LINE_MINOR: Record<string, bigint> = {
  AED: 10_000n,        // 100.00 AED（2 位）
  USDT: 30_000_000n,   // 30.000000 USDT（6 位）
};

export function isSmallAmount(currency: string, minor: bigint): boolean {
  const line = SMALL_AMOUNT_LINE_MINOR[currency];
  if (line === undefined) throw new Error(`小额线未登记币种：${currency}——先在 recon-thresholds.constant.ts 加一行，不兜底`);
  const mag = minor < 0n ? -minor : minor;
  return mag <= line;
}

/** 截止时刻 = 业务日日终（UTC，与 effective-cutoff.ts 的日终口径一致）+ 账龄线天数。 */
export function computeAgingDeadline(businessDate: string): Date {
  const endOfDay = new Date(`${businessDate}T23:59:59.999Z`);
  return new Date(endOfDay.getTime() + RECON_AGING_DAYS * 86_400_000);
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: 同 Step 2
Expected: PASS 4/4

- [ ] **Step 5: 改 schema**

`prisma/schema.prisma` 的 `model ReconciliationRun` 在 `demoManifest` 一行之后加：
```prisma
  // 平账 A 批（spec §6.1）：本轮引擎实际用的截止时刻——案件页重建差异行按它取数，
  // 不再用当天 23:59:59（跨日切那条被挪到「截止点后 6 小时」的外部行才不会在页面上落回窗内）。
  cutoffAt        DateTime?
```
`model ReconciliationCase` 在 `slaDeadline               DateTime?` 一行之后加：
```prisma
  // 平账 A 批（spec §2.2）：账龄到线标记。slaDeadline 复用既有列（开案时填 = 业务日日终 + 3 天）；
  // 到线由 case-aging-sweep 置 true，状态不动（软破线）。结案后标记随行保留。
  slaBreached               Boolean  @default(false)
```

- [ ] **Step 6: 写迁移文件**

```sql
-- prisma/migrations/20260902150000_recon_case_aging_and_run_cutoff/migration.sql
-- AlterTable
ALTER TABLE "reconciliation_cases" ADD COLUMN "slaBreached" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reconciliation_runs" ADD COLUMN "cutoffAt" DATETIME;
```

- [ ] **Step 7: 生成 client + 重铺 self 栈 + 铺演示数据**

```bash
source scripts/node-env.sh && ensure_node20 && npx prisma generate
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
bash scripts/stack.sh status
```
Expected: reset 全绿；demo:all 终态全绿（花名册断言 PASS）；status 显示 self 栈四端口 up

- [ ] **Step 8: 随手闸 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
git add prisma/schema.prisma prisma/migrations/20260902150000_recon_case_aging_and_run_cutoff/migration.sql src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.ts src/modules/clearing-settle/reconciliation/disposition/recon-thresholds.constant.spec.ts
git commit -m "feat(recon): 账龄与核销的数据地基——案件超期标记、跑批截止时刻两列 + 三条数字线常量"
```

---

### Task 2: 审计词表两码入册

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts:413-425`（`AuditActions` 平面表）与 `:900-915`（`V8_RECON_AUDIT_ACTIONS`）
- Test: `src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts`（既有，封册）+ `src/modules/audit-logging/constants/audit-actions.constant.spec.ts`（若不存在则新建下面这个文件）

**Interfaces:**
- Produces: `AuditActions.RECON_CASE_AGING_BREACHED`、`AuditActions.RECON_AGING_TIMEOUT_SIMULATED`；`V8_RECON_AUDIT_ACTIONS` 9 码

- [ ] **Step 1: 写四属性单测（先红）**

```ts
// src/modules/audit-logging/constants/recon-aging-audit-codes.spec.ts
import { AuditActions, V8_RECON_AUDIT_ACTIONS } from './audit-actions.constant';

describe('平账 A 批审计两码——出生即冻结四属性（spec §2.8）', () => {
  it('RECON_CASE_AGING_BREACHED：RECON 域、N 模式、无特有必填', () => {
    expect(AuditActions.RECON_CASE_AGING_BREACHED).toBe('RECON_CASE_AGING_BREACHED');
    expect(V8_RECON_AUDIT_ACTIONS.RECON_CASE_AGING_BREACHED).toEqual({
      domain: 'RECON', correlationMode: 'NONE', requiredFields: [], requiresCausation: false,
    });
  });
  it('RECON_AGING_TIMEOUT_SIMULATED：RECON 域、N 模式、无特有必填', () => {
    expect(AuditActions.RECON_AGING_TIMEOUT_SIMULATED).toBe('RECON_AGING_TIMEOUT_SIMULATED');
    expect(V8_RECON_AUDIT_ACTIONS.RECON_AGING_TIMEOUT_SIMULATED).toEqual({
      domain: 'RECON', correlationMode: 'NONE', requiredFields: [], requiresCausation: false,
    });
  });
  it('V8 名册 7 → 9 码', () => {
    expect(Object.keys(V8_RECON_AUDIT_ACTIONS)).toHaveLength(9);
  });
});
```
⚠ `correlationMode` 的字面量：先看文件里 `const N = ...` 的定义（`grep -n "^const N\b\|const N =" audit-actions.constant.ts`）；若它是 `'NONE'` 以外的值，把上面两处 `'NONE'` 改成同一个值。

- [ ] **Step 2: 跑确认红**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/audit-logging/constants/recon-aging-audit-codes.spec.ts`
Expected: FAIL（属性 undefined、长度 7）

- [ ] **Step 3: 入册**

`AuditActions` 平面表，在 `RECON_DISPOSITION_RECORDED: 'RECON_DISPOSITION_RECORDED',` 之后加：
```ts
  // ── 平账 A 批：账龄（spec §2.8）──
  RECON_CASE_AGING_BREACHED: 'RECON_CASE_AGING_BREACHED',
  RECON_AGING_TIMEOUT_SIMULATED: 'RECON_AGING_TIMEOUT_SIMULATED',
```
`V8_RECON_AUDIT_ACTIONS`，在 `RECON_DISPOSITION_RECORDED` 一行之后加：
```ts
  // 平账 A 批（spec §2.8）——账龄到线（系统通道，actor AGING_TIMER；主对象 caseNo，
  // slaDeadline / ageDays / bucket / book / severity 落 metadata）。软破线：状态不动。
  RECON_CASE_AGING_BREACHED: { domain: 'RECON', correlationMode: N, requiredFields: [], requiresCausation: false },
  // ⚡拨钟（操作员通道）——演示者把账龄截止拨到过去；镜像 DEPOSIT_SLA_TIMEOUT_SIMULATED。
  // 拨钟一条、到线一条，两条审计各说各的事。
  RECON_AGING_TIMEOUT_SIMULATED: { domain: 'RECON', correlationMode: N, requiredFields: [], requiresCausation: false },
```

- [ ] **Step 4: 跑新测 + 封册守则**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/audit-logging/constants`
Expected: 新测 3/3 PASS；`audit-vocabulary-closure.spec.ts` 四条全 PASS（写点闭合此时没有引用，天然绿）

- [ ] **Step 5: 提交**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/audit-logging/constants/recon-aging-audit-codes.spec.ts
git commit -m "feat(audit): 平账 A 批两码入册——案件账龄到线（系统）+ ⚡拨钟（操作员）"
```

---

### Task 3: 成因注册表与调账规则

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts`（全文件）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts:9-45`
- Test: `disposition/cause-registry.spec.ts`、`disposition/adjustment-rules.spec.ts`

**Interfaces:**
- Produces: `AdjustFamily` 加 `'WRITE_OFF'`；`FAMILY_LABEL.WRITE_OFF = '核销'`；`CauseCode` 删 `PRECISION_DUST`；`DeferredTarget` 删 `'WAIVER' | 'FIRM_REVERSAL'`；`ReasonCode` 加 `'FIRM_ENTRY_REVERSAL' | 'UNEXPLAINED_WRITE_OFF'`；新纯函数
  ```ts
  export interface WriteOffFacts extends RowFacts { internalAmount?: string; externalAmount?: string; deltaAmount?: string }
  export function resolveWriteOff(facts: WriteOffFacts): { reasonCode: 'UNEXPLAINED_WRITE_OFF'; family: 'WRITE_OFF'; direction: 'REDUCE' | 'INCREASE'; amountMinor: string }
  ```

- [ ] **Step 1: 改注册表单测（先红）**

`cause-registry.spec.ts` 前六个格的期望改成（删尘埃）：
```ts
  it('金额不对 × 客户', () => {
    expect(codes('AMOUNT_MISMATCH', 'CLIENT')).toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'UNEXPLAINED']);
  });
  it('金额不对 × 公司', () => {
    expect(codes('AMOUNT_MISMATCH', 'FIRM')).toEqual(['FIRM_AMT_UNDERBOOKED', 'FIRM_AMT_OVERBOOKED', 'UNEXPLAINED']);
  });
```
其余四格不变。文件末尾追加：
```ts
describe('平账 A 批：公司账簿冲销定码 + 核销判定（spec §3.3 / §5）', () => {
  it('精度尘埃差已删（豁免不做，decisions 2026-09-02）', () => {
    expect((CAUSE_REGISTRY as any).PRECISION_DUST).toBeUndefined();
  });
  it('公司收支记多：金额不对 × 公司 → 冲销，方向按差额符号（记多 = 外部 − 内部为负 → 减）', () => {
    const r = resolveOutlet('FIRM_AMT_OVERBOOKED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN' });
    expect(r).toEqual({ outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family: 'REVERSE', reasonCode: 'FIRM_ENTRY_REVERSAL', direction: 'REDUCE' });
  });
  it('公司收支记多·出账流水翻符号：内部 OUT 记 100、银行实扣 90 → 原始差 −10 → 翻成 +10 → 加', () => {
    const r = resolveOutlet('FIRM_AMT_OVERBOOKED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'OUT' });
    expect(r.direction).toBe('INCREASE');
  });
  it('公司收支误记：我有外无 × 公司 → 冲销，方向 = 内部方向取反', () => {
    expect(resolveOutlet('FIRM_MISBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN' }).direction).toBe('REDUCE');
    expect(resolveOutlet('FIRM_MISBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'OUT' }).direction).toBe('INCREASE');
  });
  it('族词表含核销', () => {
    expect(FAMILY_LABEL.WRITE_OFF).toBe('核销');
  });
  describe('resolveWriteOff：一句原则「让内部等于外部」', () => {
    it('金额不对：外部 < 内部（入账）→ 减，金额 = |差额|', () => {
      expect(resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-7' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '7' });
    });
    it('金额不对：出账流水翻符号——内部 OUT 记 90、外部扣 100，原始差 +10 → 减', () => {
      expect(resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: 1, internalDirection: 'OUT', deltaAmount: '10' }).direction).toBe('REDUCE');
    });
    it('我有外无：内部 IN → 减、OUT → 加，金额 = 内部行金额', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', internalAmount: '500' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '500' });
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'OUT', internalAmount: '500' }).direction).toBe('INCREASE');
    });
    it('外有我无：外部 IN → 加、OUT → 减，金额 = 外部行金额', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN', externalAmount: '300' }))
        .toEqual({ reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction: 'INCREASE', amountMinor: '300' });
      expect(resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'OUT', externalAmount: '300' }).direction).toBe('REDUCE');
    });
  });
});
```
在文件顶部 import 里加 `FAMILY_LABEL, resolveWriteOff`。

`adjustment-rules.spec.ts` 末尾追加：
```ts
describe('平账 A 批：两个新成因码（spec §3.1 / §5）', () => {
  it('FIRM_ENTRY_REVERSAL：公司账簿、两向、冲销族', () => {
    expect(REASON_SPECS.FIRM_ENTRY_REVERSAL).toEqual({
      book: 'FIRM', directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: '公司账簿冲销', family: 'REVERSE',
    });
    expect(() => assertReasonAllowed('FIRM_ENTRY_REVERSAL', 'FIRM', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('FIRM_ENTRY_REVERSAL', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
  });
  it('UNEXPLAINED_WRITE_OFF：公司账簿、两向、核销族；客户账簿恒拒', () => {
    expect(REASON_SPECS.UNEXPLAINED_WRITE_OFF).toEqual({
      book: 'FIRM', directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: '查无果核销', family: 'WRITE_OFF',
    });
    expect(() => assertReasonAllowed('UNEXPLAINED_WRITE_OFF', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });
  it('核销分录腿与补记同一对：少了 借运营/贷公司资产，多了 借公司资产/贷其他收入', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE')).toEqual({ debitCode: TB_ACCOUNT_CODES.FIRM_OPS, creditCode: TB_ACCOUNT_CODES.FIRM_ASSET });
    expect(resolvePostingLegs('FIRM', 'INCREASE')).toEqual({ debitCode: TB_ACCOUNT_CODES.FIRM_ASSET, creditCode: TB_ACCOUNT_CODES.INCOME_OTHER });
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts`
Expected: FAIL（菜单仍含 PRECISION_DUST、`resolveWriteOff` 不存在、REASON_SPECS 缺码）

- [ ] **Step 3: 改 `cause-registry.ts`**

类型段改成：
```ts
export type AdjustFamily = 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE' | 'WRITE_OFF';
export type DeferredTarget =
  | 'SUPPLEMENT_DEPOSIT'   // 补单 → 充值域补录（后半批）
  | 'SUPPLEMENT_BOUNCE'    // 补单 → 退汇认领（后半批）
  | 'INTERNAL_TRANSFER'    // 二期内部划转
  | 'INCIDENT'             // 三期事故升级
  | 'NO_REASON_CODE';      // 冲正类成因遇 SWAP 流水，无对应 reason 码（spec §11-6）

export type CauseCode =
  | 'AMT_MISBOOKED' | 'AMT_FEE_NETTED' | 'AMT_ROUNDING'
  | 'FIRM_AMT_UNDERBOOKED' | 'FIRM_AMT_OVERBOOKED'
  | 'DUP_BOOKING' | 'PHANTOM_BOOKING' | 'PAYOUT_NOT_EXECUTED' | 'MISATTRIBUTED_FROM' | 'CUTOFF_STRADDLE'
  | 'FIRM_MISBOOKED' | 'FIRM_TRANSFER_UNTRACKED'
  | 'MISSED_DEPOSIT' | 'BOUNCED_FUNDS' | 'MISATTRIBUTED_TO' | 'UNAUTHORIZED_OUTFLOW'
  | 'BANK_INTEREST_UNBOOKED' | 'BANK_CHARGE_UNBOOKED' | 'UNCLAIMED_INFLOW'
  | 'UNEXPLAINED';
```
注册表：删除两处 `PRECISION_DUST` 条目及其上方「跨格」注释；两条公司成因改成：
```ts
  FIRM_AMT_OVERBOOKED:  { cells: [C('AMOUNT_MISMATCH', 'FIRM')], label: '公司收支记多', clue: '银行回单 vs 我方记账', kind: 'ADJUST', family: 'REVERSE' },
  // ...
  FIRM_MISBOOKED:          { cells: [C('ORPHAN_INTERNAL', 'FIRM')], label: '公司收支误记/重复记', clue: '银行单查无', kind: 'ADJUST', family: 'REVERSE' },
```
在文件头注释「公理」段下补一行：`// 平账 A 批（2026-09-02）：删「精度尘埃差」（豁免不做，本系统精度与服务商一致）；公司两成因定码冲销；核销不是成因、是账龄的后续（resolveWriteOff）。`

`FAMILY_LABEL` 改成：
```ts
export const FAMILY_LABEL: Record<AdjustFamily, string> = {
  CORRECT: '冲正', REVERSE: '冲销', RECORD: '补记', REATTRIBUTE: '改记', WRITE_OFF: '核销',
};
```
`resolveOutlet` 的 REVERSE 分支整段替换为：
```ts
  if (family === 'REVERSE') {
    // 公司账簿两成因（A 批定码）：金额不对按差额符号（出账翻符号，同冲正）；孤儿按内部方向取反。
    if (code === 'FIRM_AMT_OVERBOOKED' || code === 'FIRM_MISBOOKED') {
      const direction: 'REDUCE' | 'INCREASE' = facts.matchType === 'AMOUNT_MISMATCH'
        ? (signedDeltaSign(facts) === -1 ? 'REDUCE' : 'INCREASE')
        : (facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE');
      return { outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family, reasonCode: 'FIRM_ENTRY_REVERSAL', direction };
    }
    const direction: 'REDUCE' | 'INCREASE' = facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE';
    const reasonCode = code === 'DUP_BOOKING' ? 'DEPOSIT_DUPLICATE_REVERSAL'
      : code === 'PHANTOM_BOOKING' ? 'DEPOSIT_SIGNAL_VOID' : 'WITHDRAW_VOID_REFUND';
    return { outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family, reasonCode, direction };
  }
```
文件末尾追加：
```ts
export interface WriteOffFacts extends RowFacts {
  internalAmount?: string;   // ORPHAN_INTERNAL：内部行金额（最小单位）
  externalAmount?: string;   // ORPHAN_EXTERNAL：外部行金额（最小单位）
  deltaAmount?: string;      // AMOUNT_MISMATCH：外部 − 内部（最小单位，带符号）
}

/**
 * 核销判定（spec §3.3）——不是成因出口，是账龄到线后「挂起·调查中」行的后续处置。
 * 一句原则：让内部等于外部。金额不对按差额符号（出账翻符号，同冲正）；我有外无
 * 取内部方向的反向（同冲销）；外有我无照外部方向（同补记孤儿）。
 */
export function resolveWriteOff(facts: WriteOffFacts): {
  reasonCode: 'UNEXPLAINED_WRITE_OFF'; family: 'WRITE_OFF'; direction: 'REDUCE' | 'INCREASE'; amountMinor: string;
} {
  const abs = (s: string | undefined) => (s ?? '0').replace(/^-/, '');
  if (facts.matchType === 'AMOUNT_MISMATCH') {
    const direction: 'REDUCE' | 'INCREASE' = signedDeltaSign(facts) === -1 ? 'REDUCE' : 'INCREASE';
    return { reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction, amountMinor: abs(facts.deltaAmount) };
  }
  if (facts.matchType === 'ORPHAN_INTERNAL') {
    const direction: 'REDUCE' | 'INCREASE' = facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE';
    return { reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction, amountMinor: abs(facts.internalAmount) };
  }
  const direction: 'REDUCE' | 'INCREASE' = facts.externalDirection === 'IN' ? 'INCREASE' : 'REDUCE';
  return { reasonCode: 'UNEXPLAINED_WRITE_OFF', family: 'WRITE_OFF', direction, amountMinor: abs(facts.externalAmount) };
}
```

- [ ] **Step 4: 改 `adjustment-rules.ts`**

`ReasonCode` 联合加两行；`REASON_SPECS` 在 `CUSTOMER_REATTRIBUTION` 之后加：
```ts
  // 平账 A 批（spec §5）：公司账簿冲销定码——一期半留档的「公司收支记多 / 误记」有了码。
  FIRM_ENTRY_REVERSAL:        { book: 'FIRM',   directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: '公司账簿冲销', family: 'REVERSE' },
  // 平账 A 批（spec §3）：第五族核销——查无果 + 账龄到线 + 小额，公司认下来。
  // 不是成因表里的成因：触发它的是账龄，开单守卫在 adjustment.service.assertWriteOffAllowed。
  UNEXPLAINED_WRITE_OFF:      { book: 'FIRM',   directions: ['REDUCE', 'INCREASE'], customerLabel: null, internalLabel: '查无果核销', family: 'WRITE_OFF' },
```

- [ ] **Step 5: 跑测试确认绿 + 全对账目录单测**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation`
Expected: 全绿。若 `reconciliation-query.service.spec.ts` 里有断言菜单含 `PRECISION_DUST` 的用例，按新菜单改期望（只改期望值，不改断言形状）

- [ ] **Step 6: tsc + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
git add src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts
git commit -m "feat(recon): 成因表收口——删精度尘埃差、公司账簿冲销定码、核销第五族与 resolveWriteOff"
```

---

### Task 4: 账龄主体 + 每分钟扫描 + 开案设截止

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service.ts`
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts:112-118`（run 起手）、`:274-290`（开案调用）、`:700-810`（upsert）、`:963-983`（auditCaseOpened）
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`
- Test: `workflow/case-aging.service.spec.ts`（新）、`sweep/case-aging-sweep.service.spec.ts`（新）、`workflow/wallet-recon-run.service.spec.ts`（补一条）

**Interfaces:**
- Produces:
  ```ts
  export class CaseAgingService {
    findBreachCandidates(now: Date): Promise<Array<{ id: string; caseNo: string; walletRef: string | null; slaDeadline: Date; bucket: string | null; book: string | null; severity: string | null; traceId: string | null }>>;
    markBreached(id: string): Promise<void>;
    simulateTimeout(caseNo: string, actor: ApprovalActorContext): Promise<{ caseNo: string; slaDeadline: string }>;
  }
  export class CaseAgingSweepService { checkAgingBreaches(now: Date): Promise<number> }
  ```
- Consumes: Task 1 `computeAgingDeadline`；Task 2 两个审计码

- [ ] **Step 1: 写主体服务单测（先红）**

```ts
// src/modules/clearing-settle/reconciliation/workflow/case-aging.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CaseAgingService } from './case-aging.service';

const ACTOR = { actorType: 'ADMIN', userId: 'uuid-1', userNo: 'ADM010', roleCodes: ['OPS_OFFICER'] } as any;

function build(kase: any) {
  const prisma: any = {
    reconciliationCase: {
      findUnique: jest.fn().mockResolvedValue(kase),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...kase, ...data })),
    },
    wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA2601017168' }) },
  };
  const audit: any = { recordByActor: jest.fn().mockResolvedValue(undefined) };
  return { svc: new CaseAgingService(prisma, audit), prisma, audit };
}

describe('CaseAgingService（spec §2.3 / §2.4）', () => {
  it('findBreachCandidates 只扫 OPEN + WALLET + 未标记 + 已过线', async () => {
    const { svc, prisma } = build(null);
    const now = new Date('2026-09-05T00:00:00Z');
    await svc.findBreachCandidates(now);
    expect(prisma.reconciliationCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'OPEN', layer: 'WALLET', slaBreached: false, slaDeadline: { lt: now } },
    }));
  });
  it('markBreached 只置标记，不碰 status', async () => {
    const { svc, prisma } = build({ id: 'c1', status: 'OPEN' });
    await svc.markBreached('c1');
    expect(prisma.reconciliationCase.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { slaBreached: true } });
  });
  it('⚡拨钟：截止拨到过去 + 操作员审计（显式 requestId、主对象 caseNo、钱包用业务键）', async () => {
    const before = new Date('2026-09-09T23:59:59.999Z');
    const { svc, prisma, audit } = build({ id: 'c1', caseNo: 'REC20260902-007', status: 'OPEN', walletRef: 'w-uuid', slaDeadline: before, traceId: null });
    const r = await svc.simulateTimeout('REC20260902-007', ACTOR);
    const written = prisma.reconciliationCase.update.mock.calls[0][0].data.slaDeadline as Date;
    expect(written.getTime()).toBeLessThan(Date.now());
    expect(r.caseNo).toBe('REC20260902-007');
    const env = audit.recordByActor.mock.calls[0][0];
    expect(env.action).toBe('RECON_AGING_TIMEOUT_SIMULATED');
    expect(env.actionDomain).toBe('RECON');
    expect(env.primarySubjectNo).toBe('REC20260902-007');
    expect(env.requestId).toMatch(/^RECON_AGING_TIMEOUT_SIMULATED_REC20260902-007_/);
    expect(env.subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectType: 'WALLET', subjectNo: 'WA2601017168' }),
    ]));
    expect(JSON.stringify(env)).not.toContain('w-uuid');
    expect(env.metadata.previousSlaDeadline).toBe(before.toISOString());
  });
  it('⚡拨钟：已结案拒 400；不存在 404', async () => {
    const closed = build({ id: 'c2', caseNo: 'REC-X', status: 'RESOLVED', slaDeadline: new Date() });
    await expect(closed.svc.simulateTimeout('REC-X', ACTOR)).rejects.toThrow(BadRequestException);
    const missing = build(null);
    await expect(missing.svc.simulateTimeout('REC-NOPE', ACTOR)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: 写扫描单测（先红）**

```ts
// src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service.spec.ts
import { CaseAgingSweepService } from './case-aging-sweep.service';

function build(candidates: any[]) {
  const caseAging: any = {
    findBreachCandidates: jest.fn().mockResolvedValue(candidates),
    markBreached: jest.fn().mockResolvedValue(undefined),
    walletNoOf: jest.fn().mockResolvedValue('WA2601017168'),
  };
  const audit: any = { recordSystem: jest.fn().mockResolvedValue(undefined) };
  return { svc: new CaseAgingSweepService(caseAging, audit), caseAging, audit };
}

const CAND = {
  id: 'c1', caseNo: 'REC20260902-007', walletRef: 'w-uuid', bucket: 'BREAK', book: 'FIRM', severity: 'LOW',
  traceId: 'trace-1', slaDeadline: new Date('2026-09-04T23:59:59.999Z'),
};

describe('CaseAgingSweepService（spec §2.1 / §2.8）', () => {
  it('到线：置标记 + 一条系统审计（显式 requestId、ageDays、业务键）', async () => {
    const { svc, caseAging, audit } = build([CAND]);
    const n = await svc.checkAgingBreaches(new Date('2026-09-07T10:00:00Z'));
    expect(n).toBe(1);
    expect(caseAging.markBreached).toHaveBeenCalledWith('c1');
    const env = audit.recordSystem.mock.calls[0][0];
    expect(env.action).toBe('RECON_CASE_AGING_BREACHED');
    expect(env.actionDomain).toBe('RECON');
    expect(env.primarySubjectType).toBe('RECONCILIATION_CASE');
    expect(env.primarySubjectNo).toBe('REC20260902-007');
    expect(env.requestId).toMatch(/^RECON_CASE_AGING_BREACHED_REC20260902-007_/);
    expect(env.metadata).toEqual(expect.objectContaining({ ageDays: 2, bucket: 'BREAK', book: 'FIRM', severity: 'LOW', slaDeadline: '2026-09-04T23:59:59.999Z' }));
    expect(JSON.stringify(env)).not.toContain('w-uuid');
  });
  it('没到线的案子什么都不发生', async () => {
    const { svc, caseAging, audit } = build([]);
    expect(await svc.checkAgingBreaches(new Date())).toBe(0);
    expect(caseAging.markBreached).not.toHaveBeenCalled();
    expect(audit.recordSystem).not.toHaveBeenCalled();
  });
  it('逐案失败不拖垮整轮：第一案抛错，第二案照常处理', async () => {
    const { svc, caseAging } = build([CAND, { ...CAND, id: 'c2', caseNo: 'REC-2' }]);
    caseAging.markBreached.mockRejectedValueOnce(new Error('boom'));
    expect(await svc.checkAgingBreaches(new Date('2026-09-07T10:00:00Z'))).toBe(1);
    expect(caseAging.markBreached).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: 跑确认红**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/workflow/case-aging.service.spec.ts src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service.spec.ts`
Expected: FAIL，模块不存在

- [ ] **Step 4: 写主体服务**

```ts
// src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts
// 平账 A 批（spec §2）：案件账龄——每张打开的案子一只钟。
//   起算 = 案件业务日日终；线 = RECON_AGING_DAYS；到线 = slaBreached 置 true（软破线，状态不动）。
//   复观察不重置（差异从第一次看见就在）；结案后标记随行保留。
// 本文件是案件计时的主体方法（算截止 / 找候选 / 置标记 / ⚡拨钟）；@Cron 只在 sweep 文件里。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';

export interface AgingBreachCandidate {
  id: string; caseNo: string; walletRef: string | null; slaDeadline: Date;
  bucket: string | null; book: string | null; severity: string | null; traceId: string | null;
}

@Injectable()
export class CaseAgingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** 只扫 OPEN + 钱包引擎 + 未标记 + 已过线——置过标记的不再扫（一次性）。 */
  async findBreachCandidates(now: Date): Promise<AgingBreachCandidate[]> {
    return (this.prisma as any).reconciliationCase.findMany({
      where: { status: 'OPEN', layer: 'WALLET', slaBreached: false, slaDeadline: { lt: now } },
      select: { id: true, caseNo: true, walletRef: true, slaDeadline: true, bucket: true, book: true, severity: true, traceId: true },
    });
  }

  /** 软破线：只置标记，不碰 status（三域 SLA 同款，decisions.md 2026-08-21）。 */
  async markBreached(id: string): Promise<void> {
    await (this.prisma as any).reconciliationCase.update({ where: { id }, data: { slaBreached: true } });
  }

  /** 钱包业务键——跨钱包合成案件的 'XREF:' 前缀不是真 Wallet.id，查了必空。 */
  async walletNoOf(walletRef: string | null): Promise<string | null> {
    if (!walletRef || String(walletRef).startsWith('XREF:')) return null;
    const w = await (this.prisma as any).wallet.findUnique({ where: { id: walletRef }, select: { walletNo: true } });
    return w?.walletNo ?? null;
  }

  /**
   * ⚡拨钟（spec §2.4）：把截止拨到过去，下一分钟扫描即超期。端点本身**不置标记**——
   * 「到线」事件只有扫描一处来源。拨钟是 operator 的持久化动作（铁律①），记操作员审计，
   * 镜像充值域 DEPOSIT_SLA_TIMEOUT_SIMULATED。
   */
  async simulateTimeout(caseNo: string, actor: ApprovalActorContext): Promise<{ caseNo: string; slaDeadline: string }> {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('已结案的案子没有账龄，拨不了钟');
    const previous: Date | null = kase.slaDeadline ?? null;
    const past = new Date(Date.now() - 1000);
    await (this.prisma as any).reconciliationCase.update({ where: { id: kase.id }, data: { slaDeadline: past } });

    const walletNo = await this.walletNoOf(kase.walletRef);
    const actorDisplay = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(
      {
        action: 'RECON_AGING_TIMEOUT_SIMULATED',
        actionDomain: 'RECON',
        category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.RECONCILIATION_CASE,
        primarySubjectNo: caseNo,
        subjects: [
          { subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: caseNo, subjectRole: AuditSubjectRole.PRIMARY },
          ...(walletNo ? [{ subjectType: AuditEntityTypes.WALLET, subjectNo: walletNo, subjectRole: AuditSubjectRole.RELATED }] : []),
        ],
        traceId: kase.traceId ?? undefined,
        reason: '演示：把案件账龄截止拨到过去，下一分钟扫描即超期',
        requestId: `RECON_AGING_TIMEOUT_SIMULATED_${caseNo}_${randomUUID()}`,
        metadata: { previousSlaDeadline: previous ? previous.toISOString() : null, newSlaDeadline: past.toISOString() },
        sourcePlatform: 'ADMIN',
      } as any,
      { actorType: 'ADMIN', actorNo: actorDisplay, actorDisplayName: actorDisplay, actorRolesAtTime: actor.roleCodes ?? [] },
    );
    return { caseNo, slaDeadline: past.toISOString() };
  }
}
```
⚠ `AuditSubjectRole.RELATED` 若枚举里叫别的名（`grep -n "RELATED" src/modules/audit-logging/dto/audit-log.dto.ts`），用同一个值；既有代码直接写字符串 `'RELATED'` 也可。

- [ ] **Step 5: 写扫描服务**

```ts
// src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service.ts
// 账龄扫描（spec §2.3）——withdraw-sla.service.ts 的同款形状：@Cron 每分钟（迪拜时区），
// 扫描逻辑与包装分开，测试直接调用；逐案 try/catch，单案失败不拖垮整轮。
// 到线动作只有两件：置标记 + 一条系统审计。状态不动、不推任何边（软破线）。
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditSubjectRole } from '../../../audit-logging/dto/audit-log.dto';
import { AgingBreachCandidate, CaseAgingService } from '../workflow/case-aging.service';

@Injectable()
export class CaseAgingSweepService {
  private readonly logger = new Logger(CaseAgingSweepService.name);

  constructor(
    private readonly caseAging: CaseAgingService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  @Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.checkAgingBreaches(new Date());
  }

  /** 返回本轮置了标记的案件数。 */
  async checkAgingBreaches(now: Date): Promise<number> {
    const candidates = await this.caseAging.findBreachCandidates(now);
    let breached = 0;
    for (const c of candidates) {
      try {
        await this.caseAging.markBreached(c.id);
        await this.auditBreached(c, now);
        breached += 1;
      } catch (err) {
        this.logger.error(`case aging sweep failed for ${c.caseNo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return breached;
  }

  private async auditBreached(c: AgingBreachCandidate, now: Date): Promise<void> {
    const walletNo = await this.caseAging.walletNoOf(c.walletRef);
    const ageDays = Math.max(1, Math.floor((now.getTime() - c.slaDeadline.getTime()) / 86_400_000));
    await this.auditLogs.recordSystem({
      action: 'RECON_CASE_AGING_BREACHED',
      actionDomain: 'RECON',
      category: AuditCategory.BUSINESS,
      primarySubjectType: AuditEntityTypes.RECONCILIATION_CASE,
      primarySubjectNo: c.caseNo,
      subjects: [
        { subjectType: AuditEntityTypes.RECONCILIATION_CASE, subjectNo: c.caseNo, subjectRole: AuditSubjectRole.PRIMARY },
        ...(walletNo ? [{ subjectType: AuditEntityTypes.WALLET, subjectNo: walletNo, subjectRole: AuditSubjectRole.RELATED }] : []),
      ],
      traceId: c.traceId ?? undefined,
      reason: `案件账龄到线（超期 ${ageDays} 天）——软破线，状态不动，等财务处置`,
      requestId: `RECON_CASE_AGING_BREACHED_${c.caseNo}_${randomUUID()}`,
      metadata: {
        slaDeadline: c.slaDeadline.toISOString(), ageDays, bucket: c.bucket, book: c.book, severity: c.severity, caseNo: c.caseNo,
      },
    } as any);
  }
}
```
注意 `ageDays` 的口径：从**截止时刻**起算的超期天数（≥1），与前端 hero 的「超期 N 天」同一算法。上面扫描单测里 `2026-09-04T23:59:59.999Z` → `2026-09-07T10:00Z` 差 2 天多 → `ageDays: 2`。

- [ ] **Step 6: 跑两份单测确认绿**

Run: 同 Step 3
Expected: PASS（4 + 3）

- [ ] **Step 7: 跑批开案设截止 + 开案审计 metadata（先补单测再改）**

`wallet-recon-run.service.spec.ts` 末尾追加：
```ts
describe('平账 A 批：开案设账龄截止（spec §2.1）', () => {
  it('新开案件 slaDeadline = 业务日日终 + 3 天；开案审计 metadata 带 slaDeadline', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-a', runNo: 'RUN20260901-1', traceId: 't' });
    deps.prisma.externalBalance.findMany.mockResolvedValue([
      { walletRef: 'w-1', closingBalance: new Prisma.Decimal(500), book: 'CLIENT', currency: 'AED', accountRef: 'acc-1' },
    ]);
    deps.prisma.asset.findFirst.mockResolvedValue({ id: 'asset-aed' });
    deps.balanceChecker.checkBalance.mockResolvedValue({
      pass: false, walletRef: 'w-1', walletKind: 'CUSTOMER', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU1',
      internal: { payable: 0n, suspense: 0n, total: 0n }, external: 500n, delta: 500n,
    });
    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any, deps.auditLogs as any, deps.explainedDifferences as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    (svc as any).fetchExternalLinesForWallet = jest.fn().mockResolvedValue([]);

    await svc.run({ cutoff: new Date('2026-09-01T10:00:00Z') });

    const created = deps.prisma.reconciliationCase.create.mock.calls[0][0].data;
    expect(created.slaDeadline.toISOString()).toBe('2026-09-04T23:59:59.999Z');
    const opened = deps.auditLogs.recordSystem.mock.calls.find((c: any[]) => c[0].action === 'RECON_CASE_OPENED')![0];
    expect(opened.metadata.slaDeadline).toBe('2026-09-04T23:59:59.999Z');
  });
});
```
⚠ `makeDeps` 里 `auditLogs` / `explainedDifferences` / `tigerBeetle` 的名字以该 spec 现有 `makeDeps` 返回值为准（`grep -n "auditLogs\|explainedDifferences\|tigerBeetle" wallet-recon-run.service.spec.ts | head`），照抄。

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts -t "账龄截止"`
Expected: FAIL（`slaDeadline` undefined）

然后改 `wallet-recon-run.service.ts`：
1. import：`import { computeAgingDeadline } from '../disposition/recon-thresholds.constant';`
2. `run()` 里 `const businessDate = this.toBusinessDate(cutoff);` 之后加：
   ```ts
   // 平账 A 批（spec §2.1）：本轮新开的案子一律以本轮业务日起算账龄——同一轮同一只钟。
   const slaDeadline = computeAgingDeadline(businessDate);
   ```
3. 两处 `upsertCaseForWallet({ ... })` 调用（钱包循环与未归属循环）各加一项 `slaDeadline,`；两处 `auditCaseOpened({ ... })` 各加 `slaDeadline`。
4. `upsertCaseForWallet` 的 input 类型加 `slaDeadline: Date;`；**只在 create 分支**的 `data` 里加 `slaDeadline: input.slaDeadline,`（update 分支不碰——复观察不重置）。
5. `auditCaseOpened` 签名加 `slaDeadline: Date`，metadata 加 `slaDeadline: input.slaDeadline.toISOString()`。

Run: 同上
Expected: PASS；再跑整份 `wallet-recon-run.service.spec.ts` 全绿

- [ ] **Step 8: 模块登记**

`reconciliation.module.ts`：
```ts
// 平账 A 批：案件账龄主体（算截止 / 找候选 / 置标记 / ⚡拨钟）+ 每分钟扫描。
import { CaseAgingService } from './workflow/case-aging.service';
import { CaseAgingSweepService } from './sweep/case-aging-sweep.service';
```
`providers` 数组加 `CaseAgingService, CaseAgingSweepService,`；`exports` 加 `CaseAgingService`（Task 12 e2e 与 Task 5 控制器要取）。

- [ ] **Step 9: tsc + 对账目录单测 + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation
git add src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts src/modules/clearing-settle/reconciliation/workflow/case-aging.service.spec.ts src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service.ts src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service.spec.ts src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts src/modules/clearing-settle/reconciliation/reconciliation.module.ts
git commit -m "feat(recon): 案件账龄线——开案设截止、每分钟扫描置超期并留痕、⚡拨钟主体方法"
```

---

### Task 5: ⚡拨钟端点 + RBAC 登记

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:392-393`（对账 route 段末尾加一条）
- Test: `scripts/verify-rbac.ts`（既有闸）

**Interfaces:**
- Produces: `POST /admin/reconciliation/cases/:caseNo/simulate-aging-timeout` → `{ caseNo, slaDeadline }`；权限组 `DEMO_CLOCK_WRITE`
- Consumes: Task 4 `CaseAgingService.simulateTimeout`

- [ ] **Step 1: 加 route 登记**

`rbac.catalog.ts` 在 `route('GET', '/admin/reconciliation/cases/:caseNo/reattribution-candidates', ...)` 之后加：
```ts
  // 平账 A 批：⚡拨钟——把案件账龄截止拨到过去（演示件，挂现有拨钟组，桶 demo.act_clock 已涵盖 SLA timers）
  route('POST', '/admin/reconciliation/cases/:caseNo/simulate-aging-timeout', 'Fast-forward a reconciliation case past its aging line (demo only)', ['DEMO_CLOCK_WRITE']),
```

- [ ] **Step 2: 加控制器端点**

`reconciliation-admin.controller.ts`：import 加
```ts
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
import { CaseAgingService } from '../workflow/case-aging.service';
```
构造器加 `private readonly caseAging: CaseAgingService,`；类内加：
```ts
  @Post('cases/:caseNo/simulate-aging-timeout')
  @ApiOperation({ summary: '演示用：把该案件的账龄截止拨到过去，下一分钟扫描即超期' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/cases/:caseNo/simulate-aging-timeout'))
  simulateAgingTimeout(@Param('caseNo') caseNo: string, @Req() req: any) {
    const user = req.user;
    const actor: ApprovalActorContext = {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
    return this.caseAging.simulateTimeout(caseNo, actor);
  }
```

- [ ] **Step 3: tsc + 同步权限 + 重启后端 + verify:rbac**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
bash scripts/on-stack.sh self db:base:sync
bash scripts/stack.sh down && bash scripts/stack.sh up      # 重启：VALID_PERMISSION_GROUPS 进程启动时读进内存
bash scripts/on-stack.sh self verify:rbac
```
Expected: verify:rbac 全绿（无自批死锁、无表外策略、新 route 归 DEMO_CLOCK_WRITE）

- [ ] **Step 4: 手工探针（行为验证）**

```bash
PORT=$(sed -n 's/^BACKEND_PORT=//p' .stackports | head -1)
TOKEN=$(curl -s -X POST http://localhost:$PORT/auth/login -H 'Content-Type: application/json' -d '{"email":"ops_officer@fiatx.com","password":"123456"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
CASE=$(curl -s http://localhost:$PORT/admin/reconciliation/cases -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"caseNo":"\([^"]*\)".*/\1/p' | head -1)
curl -s -X POST http://localhost:$PORT/admin/reconciliation/cases/$CASE/simulate-aging-timeout -H "Authorization: Bearer $TOKEN"
```
Expected: 200 `{ "caseNo": "...", "slaDeadline": "<过去时刻>" }`；一分钟后 `GET /admin/reconciliation/cases/$CASE` 返回 `slaBreached: true`。⚠ `.stackports` 的键名以文件实际内容为准（`cat .stackports`）；ops 账号持 `DEMO_CLOCK_WRITE`（overview §4 运营持 ⚡拨钟）。

- [ ] **Step 5: 提交**

```bash
git add src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(recon): ⚡拨钟端点——把案件账龄截止拨到过去，挂现有拨钟权限组"
```

---

### Task 6: 跑批记截止时刻 + 案件页按它重建（跨日切修复）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts:118`（createRun 调用）、`:448-467`（createRun）、`:1000-1030`（auditRunCompleted）
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts:406-447`（getCase）、`:773-790`（buildFlowComparison 签名与截止）
- Test: `workflow/wallet-recon-run.service.spec.ts`、`domain/reconciliation-query.service.spec.ts`

**Interfaces:**
- Produces: `reconciliationRun.cutoffAt` 每轮写入；`getCase` 重建差异行的截止 = `lastObservedRun.cutoffAt ?? 当天日终`
- Consumes: Task 1 列

- [ ] **Step 1: 补跑批单测（先红）**

`wallet-recon-run.service.spec.ts` 已有用例 `internal balanced + no wallets to check → run.status=PASS` 里的断言改为：
```ts
    expect(deps.prisma.reconciliationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ layer: 'WALLET', cutoffAt: cutoff }),
      }),
    );
```
再在文件末尾追加：
```ts
describe('平账 A 批：跑批完成审计带截止时刻（spec §6.1 / §2.8）', () => {
  it('RECON_RUN_COMPLETED metadata.cutoffAt = 本轮截止', async () => {
    const deps = makeDeps();
    deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-c', runNo: 'RUN20260901-2', traceId: 't' });
    deps.prisma.externalBalance.findMany.mockResolvedValue([]);
    const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any, deps.auditLogs as any, deps.explainedDifferences as any);
    (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
    const cutoff = new Date('2026-09-01T10:00:00Z');
    await svc.run({ cutoff });
    const done = deps.auditLogs.recordSystem.mock.calls.find((c: any[]) => c[0].action === 'RECON_RUN_COMPLETED')![0];
    expect(done.metadata.cutoffAt).toBe('2026-09-01T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts`
Expected: 两条 FAIL

- [ ] **Step 3: 改跑批**

- `run()`：`const run = await this.createRun(businessDate, input.manifest, actor ? 'MANUAL' : 'SCHEDULED', cutoff);`
- `createRun(businessDate, manifest, triggerType, cutoff: Date)`，`data` 加 `cutoffAt: cutoff,`
- `auditRunCompleted` 入参加 `cutoffAt: Date`，metadata 加 `cutoffAt: input.cutoffAt.toISOString()`；`run()` 里调用处传 `cutoffAt: cutoff`

Run: 同 Step 2 → PASS 全绿

- [ ] **Step 4: 补读面单测（先红）**

`reconciliation-query.service.spec.ts` 末尾追加（`mkSvc` 是该文件既有 helper）：
```ts
describe('平账 A 批：案件页按跑批截止时刻重建差异行（spec §6.1）', () => {
  function prismaForCase(cutoffAt: Date | null) {
    const kase = {
      id: 'c1', caseNo: 'REC20260902-007', businessDate: '2026-09-02', assetCode: 'USDT-TRON', walletRef: 'w-1', status: 'OPEN',
      book: 'CLIENT', lastObservedRunId: 'run-x', firstSeenRunId: 'run-x', closedByRunId: null, openedByRunId: 'run-x',
      tbAmount: new Prisma.Decimal(0), actualExternal: new Prisma.Decimal(0), deltaAmount: new Prisma.Decimal(0),
      createdAt: new Date(), lineItems: [],
    };
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN20260902-1', businessDate: '2026-09-02', cutoffAt, startedAt: new Date(), completedAt: new Date() }) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue([]) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: 6, currency: 'USDT' }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA1' }) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }
  it('run 记了 cutoffAt → 外部行与内部流水都按它截止', async () => {
    const cutoffAt = new Date('2026-09-02T10:00:00Z');
    const prisma: any = prismaForCase(cutoffAt);
    const flowMatcher = { matchFlows: jest.fn().mockResolvedValue({ matched: [], orphanInternal: [], orphanExternal: [], mismatch: [] }) };
    await mkSvc(prisma, { flowMatcher }).getCase('REC20260902-007');
    expect(prisma.externalStatementLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ datetime: { lte: cutoffAt } }),
    }));
    expect(flowMatcher.matchFlows).toHaveBeenCalledWith(expect.objectContaining({ cutoff: cutoffAt }));
  });
  it('历史 run 没记 cutoffAt → 回落当天日终', async () => {
    const prisma: any = prismaForCase(null);
    await mkSvc(prisma).getCase('REC20260902-007');
    expect(prisma.externalStatementLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ datetime: { lte: new Date('2026-09-02T23:59:59.999Z') } }),
    }));
  });
});
```

- [ ] **Step 5: 跑确认红**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts -t "截止时刻"`
Expected: FAIL（第一条：截止仍是日终）

- [ ] **Step 6: 改读面**

`getCase`：`lastObservedRun` 的 `select` 加 `cutoffAt: true`；重建段改为：
```ts
    if (kase.walletRef && !kase.walletRef.startsWith('XREF:')) {
      // 平账 A 批（spec §6.1）：截止 = 最近一次观察它的那轮跑批**实际用的截止时刻**，
      // 不再是当天 23:59:59——跑批用精确时刻（演示传的 cutoff / 手动触发的 ISO），
      // 页面按日终重建会把「截止点后 6 小时」的跨日切外部行落回窗内，孤儿消失、无行可处置。
      // 历史 run 没记 cutoffAt 时回落日终（改动前的行为）。
      const cutoffBusinessDate = lastObservedRun?.businessDate ?? kase.businessDate;
      const cutoff: Date = lastObservedRun?.cutoffAt ?? new Date(`${cutoffBusinessDate}T23:59:59.999Z`);
      const built = await this.buildFlowComparison({ walletRef: kase.walletRef, cutoff, businessDate: cutoffBusinessDate, assetCode: kase.assetCode });
      flowComparison = built.rows;
      flowSummary = built.summary;
    }
```
`buildFlowComparison` 签名改为 `kase: { walletRef: string; cutoff: Date; businessDate: string; assetCode: string }`，函数体第一行 `const cutoff = new Date(...)` 改为 `const cutoff = kase.cutoff;`，其余不变（`externalBalance` 仍按 `cutoffDate: kase.businessDate` 取）。删掉签名上方那段「T6: cutoff comes from kase.businessDate」注释，换成一句：`// cutoff 由 getCase 决定（run.cutoffAt 优先，历史行回落日终），本函数不再自算。`

Run: 同 Step 5 → PASS；再跑整份 query spec 全绿

- [ ] **Step 7: 在 self 栈上实证场景 9**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self recon:demo:break
```
记下脚本打印的场景 9 案件号（`[#9 CUTOFF_STRADDLE] wallet=...` 对应 Grace USDT 的案子），然后：
```bash
PORT=$(sed -n 's/^BACKEND_PORT=//p' .stackports | head -1)
TOKEN=$(curl -s -X POST http://localhost:$PORT/auth/login -H 'Content-Type: application/json' -d '{"email":"ops_officer@fiatx.com","password":"123456"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
curl -s http://localhost:$PORT/admin/reconciliation/cases/<场景9案件号> -H "Authorization: Bearer $TOKEN" | grep -o '"orphanInternal":[0-9]*'
```
Expected: `"orphanInternal":1`（修前为 0）

- [ ] **Step 8: tsc + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
git add src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
git commit -m "fix(recon): 跑批记录自己的截止时刻，案件页按它重建差异行——跨日切那条外部行不再落回窗内"
```

---

### Task 7: 核销四前提守卫 + 定性联动放行 + 审批后果原话

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts:42-70`（describeImpact）、`:96-130`（createDraft 分流）、`:243-247`（afterDraftCreated 联动）、`:250-300`（submit 的 impact）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts:120-131`（linkAdjustment）
- Test: `disposition/adjustment.service.spec.ts`、`disposition/disposition.service.spec.ts`

**Interfaces:**
- Produces: `createDraft` 对 `reasonCode='UNEXPLAINED_WRITE_OFF'` 的四道 400；`describeImpact(row, decimals, extra?: { walletNo?: string | null; agedDays?: number | null; findingNote?: string | null })`；`DispositionService.linkAdjustment(dispositionNo, adjustmentNo, opts?: { family?: AdjustFamily })`
- Consumes: Task 1 `isSmallAmount`；Task 3 `REASON_SPECS` 两码、`staticOutletLabel`

- [ ] **Step 1: 写守卫单测（先红）**

`adjustment.service.spec.ts` 末尾追加：
```ts
describe('平账 A 批：核销四前提（spec §3.2）——少一道就是抹差异的后门', () => {
  const firmCase = {
    caseNo: 'CASE_WO', status: 'OPEN', book: 'FIRM', walletRef: 'W_FIRM', assetCode: 'AED', ownerNo: null, traceId: null,
    businessDate: '2026-09-02', slaBreached: true,
  };
  const heldDisposition = { dispositionNo: 'RCD001', outlet: 'HOLD_INVESTIGATING', causeCode: 'UNEXPLAINED', adjustmentNo: null };
  const OP = { actorType: 'ADMIN' as const, userId: 'U_TR', userNo: 'U_TR', roleCodes: ['TREASURY_OFFICER'] };
  const dto = {
    caseNo: 'CASE_WO', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: '2026-09-02',
    explainedFlowId: 'flow-1', explainedExternalLineId: 'ext-1',
    reasonInternal: '查无果核销', reasonCustomer: '（公司侧，客户不可见）',
  };
  const makeSvc = (kase: any, disposition: any) => {
    const create = jest.fn().mockResolvedValue({ adjustmentNo: 'ADJ_WO', reasonCode: 'UNEXPLAINED_WRITE_OFF', caseNo: 'CASE_WO', amount: '7', direction: 'REDUCE', book: 'FIRM' });
    const prisma: any = {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      reconciliationDisposition: { findFirst: jest.fn().mockResolvedValue(disposition) },
      asset: { findUnique: jest.fn().mockResolvedValue({ currency: 'AED', decimals: 2 }) },
      customerMain: { findUnique: jest.fn().mockResolvedValue(null) },
      reconciliationAdjustment: { create },
      depositTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
      withdrawTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
      swapTransaction: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const dispositions = { linkAdjustment: jest.fn().mockResolvedValue(undefined) };
    const svc = new AdjustmentService(prisma, null as any, null as any, { recordByActor: jest.fn() } as any, dispositions as any);
    return { svc, prisma, create, dispositions };
  };

  it('前提 1：案子未超期 → 400，文案说清"到线再谈核销"', async () => {
    const { svc } = makeSvc({ ...firmCase, slaBreached: false }, heldDisposition);
    await expect(svc.createDraft(dto as any, OP)).rejects.toThrow(/账龄线/);
  });
  it('前提 2：锚的那行没定性、或结论不是「挂起·调查中」→ 400', async () => {
    await expect(makeSvc(firmCase, null).svc.createDraft(dto as any, OP)).rejects.toThrow(/挂起·调查中/);
    await expect(makeSvc(firmCase, { ...heldDisposition, outlet: 'HOLD_NEXT_PERIOD', causeCode: 'CUTOFF_STRADDLE' }).svc.createDraft(dto as any, OP))
      .rejects.toThrow(/挂起·等下期/);
  });
  it('前提 2b：定性已挂单 → 400', async () => {
    await expect(makeSvc(firmCase, { ...heldDisposition, adjustmentNo: 'ADJ_OLD' }).svc.createDraft(dto as any, OP)).rejects.toThrow(/ADJ_OLD/);
  });
  it('前提 3：客户池 → 400，文案指向二期划转', async () => {
    const { svc } = makeSvc({ ...firmCase, book: 'CLIENT', ownerNo: 'C0042' }, heldDisposition);
    await expect(svc.createDraft(dto as any, OP)).rejects.toThrow(/二期/);
  });
  it('前提 4：金额超小额线 → 400，文案指向事故登记', async () => {
    const { svc } = makeSvc(firmCase, heldDisposition);
    await expect(svc.createDraft({ ...dto, amount: '10001' } as any, OP)).rejects.toThrow(/小额线/);
  });
  it('四前提齐 → 落 DRAFT，定性挂上单号（联动带族 WRITE_OFF）', async () => {
    const { svc, create, dispositions } = makeSvc(firmCase, heldDisposition);
    const r = await svc.createDraft(dto as any, OP);
    expect(r.adjustmentNo).toBe('ADJ_WO');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reasonCode: 'UNEXPLAINED_WRITE_OFF', book: 'FIRM', direction: 'REDUCE', amount: '7' }) }));
    expect(dispositions.linkAdjustment).toHaveBeenCalledWith('RCD001', 'ADJ_WO', { family: 'WRITE_OFF' });
  });
});

describe('平账 A 批：审批页后果原话——核销一族（spec §3.7）', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any, null as any);
  it('说清池子、钱包、差额去向、超期天数、查证结论', () => {
    const text = svc.describeImpact({
      book: 'FIRM', ownerNo: null, amount: '7', assetCode: 'AED', direction: 'REDUCE',
      reasonCode: 'UNEXPLAINED_WRITE_OFF', reasonInternal: '查无果核销', caseNo: 'REC20260902-010',
    } as any, 2, { walletNo: 'WA2601017168', agedDays: 3, findingNote: '对了三天回单，差额无规律' });
    expect(text).toContain('公司池查无果核销');
    expect(text).toContain('WA2601017168');
    expect(text).toContain('0.07');
    expect(text).toContain('认损进运营资金');
    expect(text).toContain('超期 3 天');
    expect(text).toContain('对了三天回单');
  });
  it('多了的方向写"计入其他收入"', () => {
    const text = svc.describeImpact({
      book: 'FIRM', ownerNo: null, amount: '7', assetCode: 'AED', direction: 'INCREASE',
      reasonCode: 'UNEXPLAINED_WRITE_OFF', reasonInternal: 'x', caseNo: 'REC-1',
    } as any, 2, { walletNo: 'WA1', agedDays: 4, findingNote: 'y' });
    expect(text).toContain('计入其他收入');
  });
});
```
`disposition.service.spec.ts` 末尾追加：
```ts
describe('平账 A 批：定性联动放行组合（spec §3.6）', () => {
  const held = { dispositionNo: 'RCD001', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null };
  const buildLink = (row: any) => {
    const prisma: any = {
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({ ...row, adjustmentNo: 'ADJ_WO' }),
      },
    };
    return { svc: new DispositionService(prisma, { recordByActor: jest.fn() } as any), prisma };
  };
  it('挂起·调查中 + 核销族 → 放行挂单', async () => {
    const { svc, prisma } = buildLink(held);
    await svc.linkAdjustment('RCD001', 'ADJ_WO', { family: 'WRITE_OFF' });
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({ where: { dispositionNo: 'RCD001' }, data: { adjustmentNo: 'ADJ_WO' } });
  });
  it('挂起·调查中 + 其他族 → 仍拒（"不落调账单"）', async () => {
    const { svc } = buildLink(held);
    await expect(svc.linkAdjustment('RCD001', 'ADJ_X', { family: 'CORRECT' })).rejects.toThrow(BadRequestException);
    await expect(svc.linkAdjustment('RCD001', 'ADJ_X')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts src/modules/clearing-settle/reconciliation/disposition/disposition.service.spec.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 改 `disposition.service.ts` 的 `linkAdjustment`**

```ts
  /**
   * Task 5 联动：调账单开出后回填，之后该定性锁死不可覆盖。
   * 平账 A 批（spec §3.6）：放行一种组合——出口是「挂起·调查中」且调账单族是核销。
   * 「查不出」仍是查证结论的真相，核销是它在账龄到线后的后续处置，不改写 outlet。
   */
  async linkAdjustment(dispositionNo: string, adjustmentNo: string, opts?: { family?: AdjustFamily }): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`定性记录不存在：${dispositionNo}`);
    const writeOffOnHeld = row.outlet === 'HOLD_INVESTIGATING' && opts?.family === 'WRITE_OFF';
    if (!String(row.outlet).startsWith('ADJUST') && !writeOffOnHeld) {
      throw new BadRequestException(`定性 ${dispositionNo} 的出口是 ${row.outlet}，不落调账单`);
    }
    if (row.adjustmentNo) throw new BadRequestException(`定性 ${dispositionNo} 已挂调账单 ${row.adjustmentNo}`);
    await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo }, data: { adjustmentNo } });
  }
```
import 行改为 `import { AdjustFamily, CAUSE_REGISTRY, CauseBook, resolveOutlet } from './cause-registry';`

- [ ] **Step 4: 改 `adjustment.service.ts`**

imports 加：
```ts
import { AdjustFamily, CauseCode, staticOutletLabel } from './cause-registry';
import { isSmallAmount, SMALL_AMOUNT_LINE_MINOR } from './recon-thresholds.constant';
```
`describeImpact` 签名加第三参 `extra?: { walletNo?: string | null; agedDays?: number | null; findingNote?: string | null }`，在 `REATTRIBUTE` 分支之后、`const dir = ...` 之前加：
```ts
    // 第五族核销（spec §3.7）：审批人要读到的是「哪个池子、哪个钱包、差额往哪去、悬了多久、查过什么」。
    if (row.reasonCode === 'UNEXPLAINED_WRITE_OFF') {
      const majorAmount = bigintToDecimal(BigInt(row.amount), decimals).toFixed(decimals);
      const outlet = row.direction === 'REDUCE' ? '认损进运营资金' : '计入其他收入';
      return `公司池查无果核销：钱包 ${extra?.walletNo ?? '(未知)'} ${row.assetCode} 差额 ${majorAmount} ${outlet}；`
           + `案件 ${row.caseNo ?? '(未知)'} 已超期 ${extra?.agedDays ?? '?'} 天；查证结论：${extra?.findingNote ?? row.reasonInternal}`;
    }
```
`createDraft`：在 `if (dto.reasonCode === 'CUSTOMER_REATTRIBUTION') {...}` 之后、`assertReasonAllowed` 之前加：
```ts
    // 第五族核销（spec §3.2）：四道前提，少一道就是抹差异的后门。守卫顺序 = spec 表序。
    let heldDispositionNo: string | null = null;
    if (dto.reasonCode === 'UNEXPLAINED_WRITE_OFF') {
      heldDispositionNo = (await this.assertWriteOffAllowed(dto, kase, book)).dispositionNo;
    }
```
在 `await this.afterDraftCreated(row, dto, actor);` 前改为：
```ts
    await this.afterDraftCreated(row, { ...dto, dispositionNo: dto.dispositionNo ?? heldDispositionNo ?? undefined }, actor);
```
新增私有方法（放在 `relatedOrderExists` 之后）：
```ts
  /**
   * 核销四前提（spec §3.2）——全部 400、人话文案：
   *   ① 案子已超期  ② 锚的那行已定性且出口 = 挂起·调查中、未挂单
   *   ③ 案件账簿 = 公司  ④ 金额 ≤ 该币种小额线
   * 返回命中的定性行（afterDraftCreated 据此挂单号锁定）。
   */
  private async assertWriteOffAllowed(dto: CreateAdjustmentDto, kase: any, book: Book): Promise<{ dispositionNo: string }> {
    if (!kase.slaBreached) {
      throw new BadRequestException('案子还没到账龄线，查无果的差异先挂着，到线再谈核销');
    }
    const anchors = [
      dto.explainedFlowId ? { explainedFlowId: dto.explainedFlowId } : null,
      dto.explainedExternalLineId ? { explainedExternalLineId: dto.explainedExternalLineId } : null,
    ].filter(Boolean);
    if (anchors.length === 0) {
      throw new BadRequestException('核销必须锚在一条已定性为「挂起·调查中」的差异行上');
    }
    const held = await (this.prisma as any).reconciliationDisposition.findFirst({ where: { caseNo: dto.caseNo, OR: anchors } });
    if (!held || held.outlet !== 'HOLD_INVESTIGATING') {
      const conclusion = held ? staticOutletLabel(held.causeCode as CauseCode) : '尚未定性';
      throw new BadRequestException(`核销只对已定性为「挂起·调查中」的差异行；这行的结论是 ${conclusion}`);
    }
    if (held.adjustmentNo) {
      throw new BadRequestException(`该行定性已挂调账单 ${held.adjustmentNo}，不可再开核销单`);
    }
    if (book !== 'FIRM') {
      throw new BadRequestException('客户池的查无果差异不能一笔核销：托管里真少了钱，要先认损再由公司补款（二期划转）');
    }
    const asset = await (this.prisma as any).asset.findUnique({ where: { code: kase.assetCode }, select: { currency: true, decimals: true } });
    const currency: string = asset?.currency ?? kase.assetCode;
    if (!isSmallAmount(currency, BigInt(dto.amount))) {
      const line = bigintToDecimal(SMALL_AMOUNT_LINE_MINOR[currency], asset?.decimals ?? 0).toFixed(asset?.decimals ?? 0);
      const amt = bigintToDecimal(BigInt(dto.amount), asset?.decimals ?? 0).toFixed(asset?.decimals ?? 0);
      throw new BadRequestException(`差额 ${amt} ${currency} 超过小额线 ${line} ${currency}，查无果的大额差异不许核销，走事故登记（三期）`);
    }
    return { dispositionNo: held.dispositionNo };
  }
```
`afterDraftCreated` 最后一行改为：
```ts
    if (dto.dispositionNo) {
      const family = REASON_SPECS[row.reasonCode as ReasonCode]?.family as AdjustFamily | undefined;
      await this.dispositions.linkAdjustment(dto.dispositionNo, row.adjustmentNo, { family });
    }
```
⚠ 上面单测断言 `linkAdjustment('RCD001', 'ADJ_WO', { family: 'WRITE_OFF' })`——四族既有调用也会带 `{ family: 'CORRECT' }` 之类，`linkAdjustment` 对 ADJUST 出口不看 family，行为不变；若既有单测断言的是两参调用，把期望改成 `expect.objectContaining` 三参形式。

`submit()`：`const impact = this.describeImpact(row, assetRow?.decimals ?? 0);` 改为：
```ts
    // 第五族核销：后果原话要带钱包号 / 超期天数 / 查证结论（spec §3.7），三样都不在单上，现查。
    let extra: { walletNo?: string | null; agedDays?: number | null; findingNote?: string | null } | undefined;
    if (row.reasonCode === 'UNEXPLAINED_WRITE_OFF') {
      const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo: row.caseNo }, select: { slaDeadline: true } });
      const wallet = row.walletRef && !String(row.walletRef).startsWith('XREF:')
        ? await (this.prisma as any).wallet.findUnique({ where: { id: row.walletRef }, select: { walletNo: true } })
        : null;
      const held = await (this.prisma as any).reconciliationDisposition.findFirst({ where: { adjustmentNo }, select: { findingNote: true } });
      const agedDays = kase?.slaDeadline ? Math.max(1, Math.floor((Date.now() - new Date(kase.slaDeadline).getTime()) / 86_400_000)) : null;
      extra = { walletNo: wallet?.walletNo ?? null, agedDays, findingNote: held?.findingNote ?? null };
    }
    const impact = this.describeImpact(row, assetRow?.decimals ?? 0, extra);
```

- [ ] **Step 5: 跑确认绿**

Run: 同 Step 2；再 `bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation`
Expected: 全绿

- [ ] **Step 6: tsc + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
git add src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts src/modules/clearing-settle/reconciliation/disposition/disposition.service.spec.ts
git commit -m "feat(recon): 核销四前提守卫（超期/调查中/公司池/小额线）+ 定性联动放行 + 审批页后果原话"
```

---

### Task 8: 读面 `nextStep`（超期后的下一步由服务端判）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts:148-178`（`FlowComparisonRow`）
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts:466-495`（行注解段）、`:569-575`（assetRow 取 currency）
- Test: `domain/reconciliation-query.service.spec.ts`

**Interfaces:**
- Produces: `FlowComparisonRow.nextStep?: { kind: 'WRITE_OFF' | 'INCIDENT_DEFERRED' | 'TRANSFER_DEFERRED'; reasonCode?: 'UNEXPLAINED_WRITE_OFF'; direction?: 'REDUCE' | 'INCREASE'; amount?: string; effectiveDate?: string }`；`disposition.family` 联合加 `'WRITE_OFF'`（仅类型放宽）
- Consumes: Task 3 `resolveWriteOff`；Task 1 `isSmallAmount`

- [ ] **Step 1: 写单测（先红）**

`reconciliation-query.service.spec.ts` 末尾追加：
```ts
describe('平账 A 批：超期后的下一步 nextStep（spec §2.6）', () => {
  const flowId = 'flow-1'; const extId = 'ext-1';
  function prismaFor(opts: { book: 'CLIENT' | 'FIRM'; slaBreached: boolean; disposition: any | null; currency?: string; decimals?: number }) {
    const kase = {
      id: 'c1', caseNo: 'REC-A', businessDate: '2026-09-02', assetCode: opts.currency === 'USDT' ? 'USDT-TRON' : 'AED', walletRef: 'w-1', status: 'OPEN',
      book: opts.book, slaBreached: opts.slaBreached, lastObservedRunId: 'run-x', firstSeenRunId: 'run-x', closedByRunId: null, openedByRunId: 'run-x',
      tbAmount: new Prisma.Decimal(0), actualExternal: new Prisma.Decimal(0), deltaAmount: new Prisma.Decimal(-7), createdAt: new Date(), lineItems: [],
    };
    return {
      reconciliationCase: { findUnique: jest.fn().mockResolvedValue(kase) },
      reconciliationRun: { findUnique: jest.fn().mockResolvedValue({ runNo: 'RUN-1', businessDate: '2026-09-02', cutoffAt: new Date('2026-09-02T10:00:00Z'), startedAt: new Date(), completedAt: new Date() }) },
      reconciliationDisposition: { findMany: jest.fn().mockResolvedValue(opts.disposition ? [opts.disposition] : []) },
      reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      externalBalance: { findMany: jest.fn().mockResolvedValue([]) },
      externalStatementLine: { findMany: jest.fn().mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(4993), externalRef: 'R1', datetime: new Date('2026-09-02T09:00:00Z'), description: null }]) },
      accountFlow: { findMany: jest.fn().mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(5000), externalRef: 'R1', eventCode: 'E2E', sourceType: 'DEPOSIT', sourceNo: 'S1', createdAt: new Date('2026-09-02T09:00:00Z') }]) },
      asset: { findUnique: jest.fn().mockResolvedValue({ decimals: opts.decimals ?? 2, currency: opts.currency ?? 'AED' }) },
      wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA1' }) },
      fundsOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }
  const mismatchMatcher = { matchFlows: jest.fn().mockResolvedValue({ matched: [], orphanInternal: [], orphanExternal: [], mismatch: [{ internalFlowId: flowId, externalLineId: extId }] }) };
  const held = { dispositionNo: 'RCD1', explainedFlowId: flowId, explainedExternalLineId: extId, matchType: 'AMOUNT_MISMATCH', book: 'FIRM', causeCode: 'UNEXPLAINED', outlet: 'HOLD_INVESTIGATING', findingNote: 'n', adjustmentNo: null, createdByUserId: 'ADM', createdAt: new Date(), updatedAt: new Date() };

  it('公司池 + 超期 + 调查中 + 小额 → WRITE_OFF，四项预填齐（金额最小单位、生效日 = 案件业务日）', async () => {
    const res = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: true, disposition: held }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    const row = res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    expect(row.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: '2026-09-02' });
  });
  it('公司池 + 超期 + 调查中 + 大额 → INCIDENT_DEFERRED', async () => {
    const prisma = prismaFor({ book: 'FIRM', slaBreached: true, disposition: held });
    prisma.externalStatementLine.findMany.mockResolvedValue([{ id: extId, direction: 'IN', amount: new Prisma.Decimal(0), externalRef: 'R1', datetime: new Date(), description: null }]);
    prisma.accountFlow.findMany.mockResolvedValue([{ id: flowId, direction: 'IN', amount: new Prisma.Decimal(20_000), externalRef: 'R1', eventCode: 'E', sourceType: 'DEPOSIT', sourceNo: 'S', createdAt: new Date() }]);
    const res = await mkSvc(prisma, { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toEqual({ kind: 'INCIDENT_DEFERRED' });
  });
  it('客户池 + 超期 + 调查中 → TRANSFER_DEFERRED', async () => {
    const res = await mkSvc(prismaFor({ book: 'CLIENT', slaBreached: true, disposition: { ...held, book: 'CLIENT' } }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(res.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toEqual({ kind: 'TRANSFER_DEFERRED' });
  });
  it('未超期 / 未定性 / 结论不是调查中 / 已挂单 → 没有 nextStep', async () => {
    const notBreached = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: false, disposition: held }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(notBreached.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
    const noDisp = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: true, disposition: null }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(noDisp.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
    const linked = await mkSvc(prismaFor({ book: 'FIRM', slaBreached: true, disposition: { ...held, adjustmentNo: 'ADJ1' } }), { flowMatcher: mismatchMatcher }).getCase('REC-A');
    expect(linked.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts -t "nextStep"`
Expected: FAIL

- [ ] **Step 3: 改 DTO**

`FlowComparisonRow` 的 `disposition.family` 联合加 `'WRITE_OFF'`；在 `menu?:` 之后加：
```ts
  // 平账 A 批（spec §2.6）：超期后的下一步——只在「案件超期 + 该行已定性为挂起·调查中 + 未挂单」时出现。
  // 服务端算（前端不自己拼真相）：WRITE_OFF 带开单预填四项；另外两种只是只读标签。
  nextStep?: {
    kind: 'WRITE_OFF' | 'INCIDENT_DEFERRED' | 'TRANSFER_DEFERRED';
    reasonCode?: 'UNEXPLAINED_WRITE_OFF'; direction?: 'REDUCE' | 'INCREASE';
    amount?: string;          // 最小单位整数字符串
    effectiveDate?: string;   // = 案件业务日
  };
```

- [ ] **Step 4: 改读面**

`reconciliation-query.service.ts`：import 加 `resolveWriteOff` 与 `isSmallAmount`：
```ts
import { CAUSE_REGISTRY, CauseCode, menuFor, resolveOutlet, resolveWriteOff, staticOutletLabel } from '../disposition/cause-registry';
import { isSmallAmount } from '../disposition/recon-thresholds.constant';
```
（以该文件现有 import 名单为准，只补缺的两个。）`getCase` 行注解 `for` 循环开始前加一次资产币种查询（把下文既有的 `assetRow` 查询**提前**到这里并补 `currency`，下文那处改用同一个变量，不查两次）：
```ts
    const assetRow = (await (this.prisma as any).asset.findUnique({
      where: { code: kase.assetCode }, select: { decimals: true, currency: true },
    })) as { decimals: number; currency: string } | null;
    const caseCurrency = assetRow?.currency ?? kase.assetCode;
```
循环体内 `r.menu = menuFor(...)` 之后加：
```ts
      // 平账 A 批（spec §2.6）：超期解锁——判据全在服务端。
      if (kase.status === 'OPEN' && kase.slaBreached && d && d.outlet === 'HOLD_INVESTIGATING' && !d.adjustmentNo) {
        if (caseBook !== 'FIRM') {
          r.nextStep = { kind: 'TRANSFER_DEFERRED' };
        } else {
          const wo = resolveWriteOff({
            matchType: r.matchType as any, book: 'FIRM',
            deltaSign: r.deltaAmount != null ? ((r.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1) : undefined,
            internalDirection: r.internalFlow?.direction, externalDirection: r.externalLine?.direction,
            internalAmount: r.internalFlow?.amount, externalAmount: r.externalLine?.amount, deltaAmount: r.deltaAmount,
          });
          r.nextStep = isSmallAmount(caseCurrency, BigInt(wo.amountMinor))
            ? { kind: 'WRITE_OFF', reasonCode: wo.reasonCode, direction: wo.direction, amount: wo.amountMinor, effectiveDate: kase.businessDate }
            : { kind: 'INCIDENT_DEFERRED' };
        }
      }
```
下文原来的 `const assetRow = ... select: { decimals: true }` 那段删除（已提前）。

- [ ] **Step 5: 跑确认绿 + 全目录**

Run: 同 Step 2；再 `bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation`
Expected: 全绿

- [ ] **Step 6: tsc + 提交**

```bash
source scripts/node-env.sh && ensure_node20 && npx tsc --noEmit -p tsconfig.json
git add src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
git commit -m "feat(recon): 案件读面下发超期后的下一步——公司池小额可核销、大额待事故、客户池待二期"
```

---

### Task 9: 审批裁决人改 CFO + 既有 e2e 角色同步

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts:432-436`
- Modify: `test/recon-adjustment-money-arcs.e2e-spec.ts`（审批人角色、审计角色断言、SoD 用例、文件头注释）
- Modify: `test/recon-reattribution.e2e-spec.ts`（审批人角色、文件头注释）
- Test: `scripts/verify-rbac.ts`；两份 e2e

**Interfaces:**
- Produces: `DEFAULT_APPROVAL_POLICIES.RECON_ADJUSTMENT_POST.steps[0].roles = ['CFO']`

- [ ] **Step 1: 改策略**

```ts
  // ─── Recon Adjustment Post（平账 A 批 2026-09-02：裁决人 OPS_OFFICER → CFO）────
  // 对账引出的账本更正与核销在业内是财务签批；链条 = 运营查证定性 → 金库开单 → CFO 裁决。
  // 自批死锁不存在：CFO 不持 RECON_ADJUSTMENT_WRITE（verify:rbac S5 守着）。
  [ApprovalActionTypes.RECON_ADJUSTMENT_POST]: {
    steps: [{ stepNo: 1, roles: ['CFO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
```

- [ ] **Step 2: 同步两份 e2e 的审批人**

```bash
sed -i '' "s/\(makeActor('E2E_OPS_APPROVER_[A-Z0-9]*', \)'OPS_OFFICER')/\1'CFO')/g" test/recon-adjustment-money-arcs.e2e-spec.ts test/recon-reattribution.e2e-spec.ts
grep -n "APPROVER" test/recon-adjustment-money-arcs.e2e-spec.ts test/recon-reattribution.e2e-spec.ts | grep -v "'CFO'"
```
Expected: 第二条 grep 只剩非 makeActor 的行（注释 / 断言）。然后手改三处：
- `test/recon-adjustment-money-arcs.e2e-spec.ts:541` `expect(JSON.parse(auditRows[0].actorRolesAtTime)).toEqual(['OPS_OFFICER']);` → `['CFO']`，上一行注释「是单步 OPS_OFFICER 策略」→「是单步 CFO 策略（平账 A 批）」
- `:906` soloActor：`role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'],` → `role: 'CFO', roleCodes: ['CFO'],`（自审拦截要在**能批的角色**上验证，否则会因角色不符而拒、测不到 SoD 那一层）
- 两份文件头注释里的「单步 OPS_OFFICER」→「单步 CFO」

- [ ] **Step 3: 同步策略行 + 闸门 + 跑两份 e2e**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self db:base:sync
bash scripts/stack.sh down && bash scripts/stack.sh up
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-'
```
Expected: verify:rbac 全绿（S5：RECON_ADJUSTMENT_POST maker TREASURY_OFFICER / checker CFO 无重叠）；两份 e2e 全绿

- [ ] **Step 4: 提交**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts test/recon-adjustment-money-arcs.e2e-spec.ts test/recon-reattribution.e2e-spec.ts
git commit -m "feat(approvals): 平账一切审批裁决人改 CFO——运营定性、金库开单、CFO 裁决三人分立"
```

---

### Task 10: 前端 · 超期徽标 + ⚡拨钟 + 三处 tooltip

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesListPage.tsx:30-47`（类型）、`:295-300`（Aging 列）、`:316`、`:328`（删 title）
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx:590-594`（删 title）
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx:174-190`（类型）、`:395-420`（state）、`:560-590`（hero）、`:1035-1050`（ACTIONS）
- Test: preview 截图

**Interfaces:**
- Consumes: 后端 `slaBreached`（列表 / 详情随行下发）、Task 5 端点

- [ ] **Step 1: 列表页**

类型 `ReconCaseRow` 加 `slaBreached: boolean;   // 平账 A 批：账龄到线标记`。Aging 单元格改为：
```tsx
                    {/* Aging — tier-coloured days since first seen；到线加「超期」红标（平账 A 批） */}
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-mono text-[11px] ${agingClass(kase.aging)}`}>
                        {kase.aging}d
                      </span>
                      {kase.slaBreached && (
                        <span className="ml-1 rounded border border-adm-red/30 bg-adm-red/10 px-1 py-0.5 font-mono text-[9px] font-semibold text-adm-red">
                          超期
                        </span>
                      )}
                    </td>
```
删两处 tooltip：`<span title={kase.firstSeenRunId ?? undefined}>` → `<span>`；`<span className="text-adm-t2" title={kase.lastUpdatedRunId ?? undefined}>` → `<span className="text-adm-t2">`。

- [ ] **Step 2: 跑批详情页**

`ReconciliationRunsDetailPage.tsx:590-594` 的 `<div className="font-mono text-[10px] text-adm-t3" title={row.walletRef}>` 改为 `<div className="font-mono text-[10px] text-adm-t3">`（可见文本 `displayWallet` 已是业务键）。

- [ ] **Step 3: 案件详情页——类型、⚡状态、hero、ACTIONS**

类型 `ReconCaseDetail` 在 `slaDeadline` 之后加 `slaBreached: boolean;`。import 加：
```tsx
import { useSimulationMode } from '../utils/simulationMode';
```
组件内 state 段加：
```tsx
  // 平账 A 批（spec §2.4）：⚡拨钟——只在模拟模式下出现；已超期 / 已结案就不再需要它。
  const { enabled: simEnabled } = useSimulationMode();
  const [agingSubmitting, setAgingSubmitting] = useState(false);
  const [agingNotice, setAgingNotice] = useState('');
```
`handleReReconcile` 之后加：
```tsx
  const handleSimulateAging = async () => {
    if (!kase) return;
    setAgingSubmitting(true);
    setAgingNotice('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/reconciliation/cases/${encodeURIComponent(kase.caseNo)}/simulate-aging-timeout`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setAgingNotice(await getApiErrorMessage(res, 'Failed to fast-forward aging.'));
        return;
      }
      setAgingNotice('截止已拨到过去，下一分钟扫描即超期 / Deadline moved to the past — next scan will breach it');
      await fetchCase();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setAgingNotice('Failed to fast-forward aging.');
    } finally {
      setAgingSubmitting(false);
    }
  };
```
hero 里 `<StatusPill value={kase.status} size="md" />` 之前加：
```tsx
              {kase.slaBreached && kase.slaDeadline && (
                <span className="inline-flex items-center gap-1 rounded border border-adm-red/30 bg-adm-red/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-red">
                  <AlertTriangle size={10} />
                  超期 {Math.max(1, Math.floor((Date.now() - new Date(kase.slaDeadline).getTime()) / 86_400_000))} 天
                </span>
              )}
```
ACTIONS 块在「重新对账」按钮之后加：
```tsx
            {simEnabled && kase.status === 'OPEN' && kase.slaDeadline && !kase.slaBreached && (
              <button
                type="button"
                disabled={agingSubmitting}
                onClick={() => void handleSimulateAging()}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-amber-300 px-3 py-2 font-mono text-[12px] text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ⚡ 拨到超期 / Fast-forward aging
              </button>
            )}
            {agingNotice && <p className="mt-2 font-mono text-[10px] text-adm-t3">{agingNotice}</p>}
```

- [ ] **Step 4: tsc + preview 截图**

```bash
cd admin-web && source ../scripts/node-env.sh && ensure_node20 && npx tsc -b --noEmit && cd ..
```
起 preview（`.claude/launch.json` 里 admin-web 的配置；管理台端口见 `.stackports`），登录 `ops_officer@fiatx.com / 123456`，开启右上角 ⚡ 模拟模式：
1. 打开 `/admin/reconciliation/cases/<场景 10 案件号>`，点「⚡ 拨到超期」，等 60 秒刷新 → hero 出现「超期 1 天」→ 截图 `doc-final/superpowers/plans/artifacts/2026-09-02-A-case-detail-breached.png`
2. 列表页 `/admin/reconciliation/cases` → 该行 Aging 列出现红「超期」→ 截图 `...-cases-list-breached.png`
3. 跑批详情页与列表页悬停钱包 / run 单元格无 UUID tooltip（用 read_page 核 `title` 属性不存在）

- [ ] **Step 5: 提交**

```bash
git add admin-web/src/pages/ReconciliationCasesListPage.tsx admin-web/src/pages/ReconciliationRunsDetailPage.tsx admin-web/src/pages/ReconciliationCasesDetailPage.tsx doc-final/superpowers/plans/artifacts/2026-09-02-A-case-detail-breached.png doc-final/superpowers/plans/artifacts/2026-09-02-A-cases-list-breached.png
git commit -m "feat(admin-recon): 超期徽标（列表 + 详情）+ ⚡拨到超期按钮 + 删三处 UUID tooltip"
```

---

### Task 11: 前端 · 核销通道 + 公司冲销文案 + 处置弹层文案

**Files:**
- Modify: `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx:38-75`（表 / 族词 / 标题 / 锁定态类型）、`:180-215`（初始化）、`:265-290`（提交禁用）、`:290-360`（提交体）、`:400-470`（成因 / 方向 / 金额 / 生效日渲染）
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx:100-120`（行类型）、`:460-500`（新 handler）、`:855-905`（动作列）、`:960-975`（本案调账单成因列）
- Modify: `admin-web/src/pages/ReconciliationAdjustmentDetailPage.tsx:18,148,183`
- Modify: `admin-web/src/components/ReconciliationDispositionModal.tsx:24,35,191`
- Test: preview 截图

**Interfaces:**
- Produces: `REASON_LABEL: Record<string, string>`（展示用超集，含 `CUSTOMER_REATTRIBUTION` / `FIRM_ENTRY_REVERSAL` / `UNEXPLAINED_WRITE_OFF`）；`AdjustmentLocked.writeOff?: { findingNote: string }`
- Consumes: Task 8 `nextStep`

- [ ] **Step 1: 调账弹层——表与锁定视图**

`REASON_META` 加一行（进下拉：公司账簿"运营自己选成因"的老通道也许它）：
```ts
  FIRM_ENTRY_REVERSAL: { book: 'FIRM', directions: ['REDUCE', 'INCREASE'], label: '公司账簿冲销' },
```
其后加展示超集（**核销刻意不进 `REASON_META`**——它由账龄解锁，不许在下拉里手选，与改记同一条理由）：
```ts
// 展示用成因词表（超集）：详情页 / 本案调账单列表 / 锁定视图回显用。
// 改记与核销刻意不在 REASON_META（下拉数据源）里：前者只走「先定性再开单」，后者只由账龄解锁。
export const REASON_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(REASON_META).map(([code, meta]) => [code, meta.label])),
  CUSTOMER_REATTRIBUTION: '记错客户更正（改记）',
  UNEXPLAINED_WRITE_OFF: '查无果核销',
};
```
`FAMILY_WORD` 加 `WRITE_OFF: '核销'`；`LOCKED_TITLE` 加 `WRITE_OFF: '核销 · 查不出，公司认下来'`。`AdjustmentLocked` 加：
```ts
  /** 平账 A 批：核销锁定视图——金额 / 生效日只读，说明预填查证结论。 */
  writeOff?: { findingNote: string };
```
组件内 `const isReattribute = ...` 之后加 `const isWriteOff = locked?.family === 'WRITE_OFF';`。初始化 `useEffect([open])` 里 `setReasonInternal('')` / `setReasonCustomer('')` 改为：
```ts
    setReasonInternal(locked?.writeOff ? `查无果核销：${locked.writeOff.findingNote}` : '');
    setReasonCustomer(locked?.writeOff ? '（公司侧核销，客户不可见）' : '');
```
成因回显那行 `REASON_META[locked.reasonCode ?? '']?.label ?? '记错客户更正'` 改为 `REASON_LABEL[locked.reasonCode ?? ''] ?? locked.reasonCode`。金额渲染条件 `{isReattribute ? (只读) : (输入)}` 改为 `{(isReattribute || isWriteOff) ? (只读) : (输入)}`；生效日输入加 `disabled={submitting || isWriteOff}`，并在其下（isWriteOff 时）加一行说明：
```tsx
          {isWriteOff && <p className="-mt-3 mb-4 font-mono text-[9px] text-adm-t3">核销修的是案件那一天的账，生效日 = 案件业务日，不可改。</p>}
```
提交体 `amount: isReattribute ? prefill.amountMinor : amountMinor` 改为 `amount: (isReattribute || isWriteOff) ? prefill.amountMinor : amountMinor`。

- [ ] **Step 2: 案件页——动作列与开单**

行类型 `FlowComparisonRow.disposition.family` 联合加 `'WRITE_OFF'`；加字段：
```ts
  // 平账 A 批（spec §2.6）：超期后的下一步（服务端判）
  nextStep?: {
    kind: 'WRITE_OFF' | 'INCIDENT_DEFERRED' | 'TRANSFER_DEFERRED';
    reasonCode?: 'UNEXPLAINED_WRITE_OFF'; direction?: 'REDUCE' | 'INCREASE'; amount?: string; effectiveDate?: string;
  };
```
`handleAdjustHandoff` 之后加：
```tsx
  // 平账 A 批：核销——用读面算好的 nextStep 四项预填，锁定视图（成因固定、方向 / 金额 / 生效日只读）。
  const openWriteOff = (row: FlowComparisonRow) => {
    if (!kase || !row.disposition || row.nextStep?.kind !== 'WRITE_OFF') return;
    const ns = row.nextStep;
    setCreatePrefill({
      amountMinor: ns.amount ?? '0', direction: ns.direction ?? '', relatedOrderNo: '',
      explainedFlowId: row.internalFlow?.id, explainedExternalLineId: row.externalLine?.id,
    });
    setAdjustLocked({
      dispositionNo: row.disposition.dispositionNo,
      family: 'WRITE_OFF', reasonCode: ns.reasonCode, direction: ns.direction,
      directionNote: `方向 = 让内部等于外部：${directionNoteFor(row.matchType)}`,
      writeOff: { findingNote: row.disposition.findingNote },
    });
  };
```
动作列 ④ 分支：在「开单」按钮那段之后（同一个 `<div className="flex flex-col gap-1">` 内）加：
```tsx
                                {row.nextStep?.kind === 'WRITE_OFF' && kase.status === 'OPEN' && (
                                  canCreateAdjustment ? (
                                    <button
                                      type="button"
                                      onClick={() => openWriteOff(row)}
                                      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-red hover:underline"
                                    >
                                      <Plus size={10} />
                                      核销
                                    </button>
                                  ) : (
                                    <span className="whitespace-nowrap font-mono text-[10px] text-adm-red">超期 · 可核销</span>
                                  )
                                )}
                                {row.nextStep?.kind === 'INCIDENT_DEFERRED' && (
                                  <span className="whitespace-nowrap font-mono text-[10px] text-adm-red">超期 · 待升级事故（三期）</span>
                                )}
                                {row.nextStep?.kind === 'TRANSFER_DEFERRED' && (
                                  <span className="whitespace-nowrap font-mono text-[10px] text-adm-amber">超期 · 待二期划转</span>
                                )}
```
本案调账单列表成因列 `REASON_META[adj.reasonCode]?.label ?? adj.reasonCode` 改为 `REASON_LABEL[adj.reasonCode] ?? adj.reasonCode`，import 里把 `REASON_META` 换成 `REASON_LABEL`。

- [ ] **Step 3: 调账详情页 + 处置弹层文案**

`ReconciliationAdjustmentDetailPage.tsx`：import 改 `REASON_LABEL`；`const reasonMeta = REASON_META[detail.reasonCode];` → `const reasonLabel = REASON_LABEL[detail.reasonCode];`；成因字段 `value={reasonLabel ? `${reasonLabel} · ${detail.reasonCode}` : detail.reasonCode}`。

`ReconciliationDispositionModal.tsx`：`AdjustHandoff.family` 与 `DispositionResult.family` 联合各加 `'WRITE_OFF'`；确认屏 HOLD_INVESTIGATING 文案改为：
```tsx
              {result.outlet === 'HOLD_INVESTIGATING' && '不落任何分录。案子保持破口，标注「已定性 · 调查中」——查证记录已留档。账龄到线（3 天）后：公司池小额可核销、大额升级事故（三期）、客户池待二期划转。'}
```

- [ ] **Step 3b: 退役文案随删（spec §7）**

```bash
grep -rn "WAIVER\|FIRM_REVERSAL\|PRECISION_DUST" admin-web/src
```
Expected: 零命中。若有命中（硬编码文案 / 色调映射），删掉那一行分支，不留幽灵分支。

- [ ] **Step 4: tsc + 走查截图**

```bash
cd admin-web && source ../scripts/node-env.sh && ensure_node20 && npx tsc -b --noEmit && cd ..
```
preview 走完整链路（场景 10 案件；若 Task 10 已拨钟则直接从第 3 步起）：
1. 运营账号：那行「处置」→「查不出（已穷尽调查）」→ 写说明 → 下一步 → 徽标「已定性 · 调查中」
2. ⚡ 拨到超期 → 一分钟后刷新 → hero「超期 1 天」
3. 登出，金库 `treasury@fiatx.com / 123456` 登录 → 同一行出现「核销」→ 点开锁定视图（成因「【核销】查无果核销」、方向只读、金额只读、生效日只读）→ 截图 `...-writeoff-locked-view.png` → 开单并提审
4. 登出，CFO `cfo@fiatx.com / 123456` 登录 → 审批中心该单 → 后果原话「公司池查无果核销：钱包 … 差额 0.07 认损进运营资金；案件 … 已超期 1 天；查证结论：…」→ 截图 `...-approval-impact.png` → 批准
5. 回案件页点「重新对账」→ 案子 RESOLVED，那行「已解释 · ADJ…」→ 截图 `...-case-resolved.png`
6. 场景 9 案件页：那条「我有外无」可点「处置」→ 跨账期 → 挂起·等下期 → 截图 `...-scenario9-clickable.png`

- [ ] **Step 5: 提交**

```bash
git add admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx admin-web/src/pages/ReconciliationCasesDetailPage.tsx admin-web/src/pages/ReconciliationAdjustmentDetailPage.tsx admin-web/src/components/ReconciliationDispositionModal.tsx doc-final/superpowers/plans/artifacts/2026-09-02-A-writeoff-locked-view.png doc-final/superpowers/plans/artifacts/2026-09-02-A-approval-impact.png doc-final/superpowers/plans/artifacts/2026-09-02-A-case-resolved.png doc-final/superpowers/plans/artifacts/2026-09-02-A-scenario9-clickable.png
git commit -m "feat(admin-recon): 核销通道——超期解锁按钮、锁定视图、公司冲销与核销成因文案、处置确认屏改口"
```

---

### Task 12: e2e · 账龄 → 核销全链路 + 三条反例 + 跨日切断言

**Files:**
- Create: `test/recon-aging-write-off.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 4 `CaseAgingService` / `CaseAgingSweepService`；Task 7 守卫；Task 8 `nextStep`；Task 9 CFO

- [ ] **Step 1: 写 e2e**

照 `test/recon-adjustment-money-arcs.e2e-spec.ts` 的头（polyfill / dotenv / AppModule / helper 函数 `makeActor` `waitUntil` `createFirmWallet` `createCustomerWallet` `fundCustomerWallet` `upsertExternalBalance` `openCaseFor` `latestApprovalCase` `adjustmentRow` `createFixtureRun` `createFixtureCase`）**原样复制**到新文件，然后：

- `fundFirmWallet` 复制过来并加两个可选参数 `externalRef?: string; crossing?: boolean`，evidence 里 `externalRef: opts.externalRef ?? null, isExternalCrossing: opts.crossing ?? false`
- 加 `createExternalLine`（照 `test/recon-reattribution.e2e-spec.ts:339` 那份，`dedupKey` 前缀改 `E2E-AGING-`，并加可选 `datetime?: Date`）
- 额外 import 并在 `beforeAll` 里取：
  ```ts
  import { CaseAgingService } from '../src/modules/clearing-settle/reconciliation/workflow/case-aging.service';
  import { CaseAgingSweepService } from '../src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service';
  import { DispositionService } from '../src/modules/clearing-settle/reconciliation/disposition/disposition.service';
  // beforeAll：
  caseAging = app.get(CaseAgingService);
  agingSweep = app.get(CaseAgingSweepService);
  dispositions = app.get(DispositionService);
  ```
  （`let caseAging: CaseAgingService; let agingSweep: CaseAgingSweepService; let dispositions: DispositionService;` 与既有 `let` 段并列）

用例：
```ts
  it('主链路：查无果 → 拨钟 → 扫描超期（留痕）→ 金库开核销单 → CFO 批 → 落账（借运营/贷公司资产 7）→ 重对账 RESOLVED', async () => {
    const ledger = 1; // AED
    const wallet = await createFirmWallet({ assetId: aedAssetId, walletRole: 'F_FEE', type: 'FIAT_BANK' });
    const REF = `E2E-WO-${randomUUID().slice(0, 8)}`;
    await fundFirmWallet({ walletId: wallet.id, ledger, currency: aedCode, amount: 5000n, tag: 'WO', externalRef: REF, crossing: true });
    await createExternalLine({ walletId: wallet.id, currency: aedCode, book: 'FIRM', direction: 'IN', amount: 4993n, externalRef: REF });
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'FIRM', closingBalance: 4993n });

    expect((await walletRecon.run({ cutoff: CUTOFF })).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    expect(kase.book).toBe('FIRM');
    expect(kase.slaBreached).toBe(false);
    expect(new Date(kase.slaDeadline).toISOString()).toBe(new Date(new Date(`${CUTOFF.toISOString().slice(0, 10)}T23:59:59.999Z`).getTime() + 3 * 86_400_000).toISOString());

    // 运营定性：查不出（锚 = 读面那行的两个真实证据 id）
    const detail0 = await reconQuery.getCase(kase.caseNo);
    const row0 = detail0.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    const ops = makeActor('E2E_OPS_DISPOSER', 'OPS_OFFICER');
    const disp = await dispositions.record(kase.caseNo, {
      matchType: 'AMOUNT_MISMATCH', explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      causeCode: 'UNEXPLAINED', findingNote: 'e2e：对了回单，差额 7 分无规律，已穷尽调查',
      deltaSign: -1, internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ops);
    expect(disp.outlet).toBe('HOLD_INVESTIGATING');

    // 反例①：未超期开核销单 → 400
    const treasury = makeActor('E2E_TREASURY_WO', 'TREASURY_OFFICER');
    const woDto = {
      caseNo: kase.caseNo, reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: kase.businessDate,
      explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      reasonInternal: 'e2e 核销', reasonCustomer: '（公司侧，客户不可见）', dispositionNo: disp.dispositionNo,
    };
    await expect(adjustments.createDraft(woDto as any, treasury)).rejects.toThrow(BadRequestException);
    expect((await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!.nextStep).toBeUndefined();

    // ⚡拨钟 + 扫描 → 超期 + 两条审计
    await caseAging.simulateTimeout(kase.caseNo, ops);
    expect(await agingSweep.checkAgingBreaches(new Date())).toBeGreaterThanOrEqual(1);
    const breached = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(breached.slaBreached).toBe(true);
    expect(breached.status).toBe('OPEN');
    const agingAudits = await (prisma as any).auditLogEvent.findMany({ where: { primarySubjectNo: kase.caseNo, action: { in: ['RECON_AGING_TIMEOUT_SIMULATED', 'RECON_CASE_AGING_BREACHED'] } } });
    expect(agingAudits.map((a: any) => a.action).sort()).toEqual(['RECON_AGING_TIMEOUT_SIMULATED', 'RECON_CASE_AGING_BREACHED']);

    // 读面解锁：nextStep = WRITE_OFF 四项
    const detail1 = await reconQuery.getCase(kase.caseNo);
    const row1 = detail1.flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    expect(row1.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: kase.businessDate });

    // 反例②：超线 → 400
    await expect(adjustments.createDraft({ ...woDto, amount: '10001' } as any, treasury)).rejects.toThrow(/小额线/);

    // 正路径
    const { adjustmentNo } = await adjustments.createDraft(woDto as any, treasury);
    const drafted = await (prisma as any).auditLogEvent.findFirst({ where: { action: 'RECON_ADJUSTMENT_DRAFTED', primarySubjectNo: adjustmentNo } });
    expect(drafted.reasonCode).toBe('UNEXPLAINED_WRITE_OFF');
    expect((await (prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo: disp.dispositionNo } })).adjustmentNo).toBe(adjustmentNo);

    await adjustments.submit(adjustmentNo, treasury);
    const approvalCase = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    expect(approvalCase.reason).toContain('公司池查无果核销');
    await approvalsService.approve(approvalCase.id, { reason: 'e2e CFO approve write-off' }, makeActor('E2E_CFO_APPROVER', 'CFO'));
    await waitUntil(async () => (await adjustmentRow(adjustmentNo)).status === AdjustmentStatus.POSTED);

    const evidence = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_OPS]);
    expect(evidence[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET]);
    const posted = await (prisma as any).auditLogEvent.findFirst({ where: { action: 'RECON_ADJUSTMENT_POSTED', primarySubjectNo: adjustmentNo } });
    expect(posted.reasonCode).toBe('UNEXPLAINED_WRITE_OFF');
    expect(JSON.parse(posted.actorRolesAtTime)).toEqual(['CFO']);

    await walletRecon.run({ cutoff: CUTOFF });
    const healed = await (prisma as any).reconciliationCase.findUnique({ where: { id: kase.id } });
    expect(healed.status).toBe('RESOLVED');
    expect(healed.resolutionReason).toBe('AUTO_HEALED');
  });

  it('反例③：客户池超期 + 调查中 → 核销 400，读面给「待二期划转」', async () => {
    const wallet = await createCustomerWallet({ ownerId: carolId, ownerNo: carolNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_VIBAN', iban: `AE-E2E-${randomUUID().slice(0, 8)}` });
    const kase = await createFixtureCase({ walletRef: wallet.id, book: 'CLIENT', ownerNo: carolNo });
    await (prisma as any).reconciliationCase.update({ where: { id: kase.id }, data: { slaBreached: true, slaDeadline: new Date(Date.now() - 1000) } });
    const flowId = `flow-fixture-${randomUUID()}`;
    await (prisma as any).reconciliationDisposition.create({
      data: {
        dispositionNo: generateReferenceNo('RCD'), caseNo: kase.caseNo, walletRef: wallet.id, businessDate: TODAY,
        explainedFlowId: flowId, matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', causeCode: 'UNEXPLAINED', outlet: 'HOLD_INVESTIGATING',
        findingNote: 'e2e fixture', createdByUserId: 'E2E',
      },
    });
    await expect(adjustments.createDraft({
      caseNo: kase.caseNo, reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '7', effectiveDate: TODAY,
      explainedFlowId: flowId, reasonInternal: 'x', reasonCustomer: 'x',
    } as any, makeActor('E2E_TREASURY_C', 'TREASURY_OFFICER'))).rejects.toThrow(/二期/);
  });

  it('跨日切：跑批截止点后 6 小时的外部行，案件页仍显示那条「我有外无」（spec §6.1）', async () => {
    const day = new Date(CUTOFF.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const runCutoff = new Date(`${day}T10:00:00.000Z`);
    const wallet = await createCustomerWallet({ ownerId: daveId, ownerNo: daveNo, assetId: aedAssetId, walletRole: 'C_VIBAN', type: 'FIAT_VIBAN', iban: `AE-E2E-${randomUUID().slice(0, 8)}` });
    const REF = `E2E-STRADDLE-${randomUUID().slice(0, 8)}`;
    await fundCustomerWallet({ walletId: wallet.id, ownerId: daveId, assetId: aedAssetId, ledger: 1, currency: aedCode, amount: 800n, tag: 'S9', crossing: true, externalRef: REF } as any);
    await createExternalLine({ walletId: wallet.id, currency: aedCode, book: 'CLIENT', direction: 'IN', amount: 800n, externalRef: REF, datetime: new Date(`${day}T16:00:00.000Z`) });
    await upsertExternalBalance({ walletId: wallet.id, currency: aedCode, book: 'CLIENT', closingBalance: 800n, cutoffDate: day });

    await walletRecon.run({ cutoff: runCutoff });
    const kase = await openCaseFor(wallet.id);
    expect(kase.bucket).toBe('SOFT_FLAG');
    const detail = await reconQuery.getCase(kase.caseNo);
    expect(detail.flowSummary.orphanInternal).toBe(1);   // 修前为 0：页面按日终重建，16:00 的行落回窗内
  });
```
⚠ `fundCustomerWallet` 复制时给 Step 1 的 evidence 加 `externalRef: opts.externalRef ?? null`（签名加 `externalRef?: string`）；`createFixtureCase` 里给 `slaDeadline` 留默认 null 即可（反例③自己 update）。`aedAssetId / carolId / daveId` 等在 `beforeAll` 里照原文件取。

- [ ] **Step 2: 跑 e2e（串行、on-stack self）**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-'
```
Expected: 三份 recon e2e 全绿（新文件 3/3）

- [ ] **Step 3: 动了钱 → verify:coa；审计可查 → verify:audit**

```bash
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:audit
```
Expected: 两恒等式 + 负余额断言全绿；verify:audit 全绿

- [ ] **Step 4: 提交**

```bash
git add test/recon-aging-write-off.e2e-spec.ts
git commit -m "test(recon): 账龄→核销全链路 e2e（拨钟/扫描留痕/四前提反例/CFO 批/落账/自愈）+ 跨日切案件页断言"
```

---

### Task 13: 演示种子文案 + 重铺闸 + 全套闸门

**Files:**
- Modify: `scripts/recon-demo.ts:1254-1257`（场景 10 `bucketRationale`）
- Test: 重铺闸 ⑧、⑥、⑦、verify:rbac、封册

- [ ] **Step 1: 改文案**

场景 10 的 `bucketRationale` 改为：
```ts
      bucketRationale: '一条外部行金额 −7 分并压低同额收盘 → 残差 = −7 ≠ 0 → BREAK。成因查无果，处置 = 挂起·调查中 → 账龄到线（⚡拨钟）→ 公司池小额核销（金库开单、CFO 批）→ 重对账自愈。',
```
答案键、钱包、金额、`dedupKey` 一律不动。

- [ ] **Step 2: 重铺闸**

```bash
source scripts/node-env.sh && ensure_node20 && bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self recon:demo:break
```
Expected: demo:all 终态全绿（对照 `doc-final/demo/baseline.md`）；`recon:demo:break` 打印 **14/14 DETECTED、11/11 钱包桶**；脚本收尾的答案键把场景 10 打成上面新文案

- [ ] **Step 3: 全套闸门**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
bash scripts/on-stack.sh self test -- src/modules/clearing-settle/reconciliation src/modules/audit-logging/constants src/modules/governance/approvals
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-'
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:audit
```
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "chore(demo): 场景 10 文案随核销开放改口——挂起·调查中 → 超期 → 核销"
```

---

### Task 14: 文档收口

**Files:**
- Modify: `doc-final/decisions.md`（追加两条，§12 原文）
- Modify: `doc-final/modules/v8-recon.md`（§1 §2 §3 §4 §5 §6）
- Modify: `doc-final/reference/recon-cause-handbook.md`（§一 三条补充、§二 四处、§三 总述 / 8 / 9 / 新增「0. 账龄」、§四）
- Modify: `doc-final/demo/script.md`（第六幕）
- Modify: `doc-final/demo/data.md:36`
- Modify: `doc-final/BACKLOG.md:149-153, 157, 161, 191-195`（+ 新增一条）
- Modify: `doc-final/CHANGELOG.md`

- [ ] **Step 1: decisions.md**

文件末尾追加 spec §12 两条原文（逐字）。

- [ ] **Step 2: modules/v8-recon.md**

- 头部 `Last Verified：2026-09-02（平账 A 批：账龄线 + 公司池核销 + 审批人 CFO，重铺闸实跑）`
- §1 末尾（「单位契约」段之前）加一段：
  > **悬着多久，悬太久怎么办（2026-09-02 立）。** 每张打开的案子一只钟：业务日日终起算，3 天到线标「超期」、记一条审计、列表醒目，状态不动。到线后按案子在等什么解锁下一步：等钱到账的去推单；等下期的重查；**查不出的**，公司池小额由金库开核销单、CFO 批、一笔分录进损益（少了认损进运营资金，多了计入其他收入）、重对账自愈；大额只能升级事故（三期）；客户池要等二期划转（托管里真少了钱，先认损再由公司补款）。核销是唯一没有故事的出口，所以门最重：账龄 / 小额线 / CFO 三道锁少一道就是抹差异的后门。**豁免与容差不做**：本系统与服务商精度一致，尘埃差不存在，立场是一分不差、一分也追。
- §2 表加一行：`| **案件计时**（2026-09-02 新增）| `slaDeadline` 开案时 = 业务日日终 + 3 天，复观察不重置；到线 `slaBreached=true`（软破线，状态不动）；⚡拨钟只拨截止、标记只由扫描置 |`
- §3 表：「开调账单」「改记」两行裁决人改 **CFO**（`RECON_ADJUSTMENT_POST` 单步 CFO）；加一行：`| **核销（公司池查无果）** | 金库（超期后那行出现「核销」）| **CFO** | 四前提：超期 / 该行定性 = 挂起·调查中 / 公司账簿 / ≤ 小额线（AED 100 / USDT 30）；分录与补记同腿；定性挂单号锁定 |`；「人工核实 / 销案 / SLA 升级」行改为「人工核实 / 销案 — 未做；账龄到线标记已做，升级通知不做（无通知中心）」
- §4：场景表 10 处置改「挂起·调查中 → 超期 → **核销**」；步骤 4 加第四条闭环「**核销**（场景 10）：定性查不出 → ⚡拨到超期 → 一分钟后「超期」→ 金库那行「核销」→ 锁定视图 → 送审 → CFO 批 → 重对账 → RESOLVED」；步骤 5 挂起与留档改为「场景 9/13/14」；「已知口径」改 **14 条里平 11 条，长红 3 条（9/13/14）**；步骤 4 冲正闭环里「审批中心批（单步 OPS_OFFICER…）」→ CFO
- §5 加节点：`- 账龄（A 批）：workflow/case-aging.service.ts（算截止 / 找候选 / 置标记 / ⚡拨钟 + 审计）｜ sweep/case-aging-sweep.service.ts（@Cron 每分钟迪拜时区，到线审计 RECON_CASE_AGING_BREACHED）｜ 常量 disposition/recon-thresholds.constant.ts（3 天 / 小额线两币种）｜ 读面 getCase 行注解 nextStep（WRITE_OFF / INCIDENT_DEFERRED / TRANSFER_DEFERRED）｜ 核销 = 调账单第五族 WRITE_OFF（reason UNEXPLAINED_WRITE_OFF，守卫 adjustment.service.assertWriteOffAllowed）｜ 跑批 cutoffAt → 案件页按它重建 ｜ 审计 9 码（+AGING_BREACHED 系统 / +AGING_TIMEOUT_SIMULATED 操作员）`
- §6：删「补单两入口未建」之外与核销 / 公司冲销 / 跨日切相关的三条（「核销 / 豁免 / 容差 / aging 同批下一轮」「公司账簿冲销无码」「人工核实 / 销案 / SLA 升级 deferred」）；改写为：「**豁免 / 容差不做**（精度一致，decisions 2026-09-02）」「**客户池核销待二期划转**」「**大额超期只留档，事故三期**」「**超期不发通知**（无通知中心）」「**严重度分级跨资产不可比**（BACKLOG）」；其余条目保留

- [ ] **Step 3: recon-cause-handbook.md**

- §一「三条补充」整段替换为：
  > **1. 账龄已经上线，是核销的开关。** 每张打开的案子从业务日日终起算，3 天到线，系统标「超期」并记一条审计，状态不动。到线后：等钱到账的去推单；定性为「等下期」的说明当初判错了，要重查；定性为「查不出」的，进入下一步——公司池小额核销、大额升级事故（三期）、客户池待二期划转。演示时用 ⚡拨钟把截止拨到过去，一分钟内即超期。
  > **2. 核销在两个池子里做法不一样。**（保留原两条）… 本轮开放的是公司池；客户池待二期。
  > **3. 豁免与容差本系统不建。** 两者是同一件事在流程两端的版本（"这笔差异不打算再追了"）。本系统与服务商精度一致（AED 两边 2 位、USDT 两边 6 位），尘埃差不存在；容差放过的一分钱会攒成需要豁免的差。立场：**一分不差，一分也追**——差 1 分也开案、也冲正，账本永远等于外部。行业里豁免存在的四类根源见第三部分「9. 豁免」。
- §二：删两处「精度不可表示的尘埃差」条目；`FIRM_AMT_OVERBOOKED` 出口改「冲销」，查证怎么做末句改「查明后走冲销（成因码 FIRM_ENTRY_REVERSAL），金库开单、CFO 批」；`FIRM_MISBOOKED` 同样改「冲销」
- §三总述改为「本轮实际能操作的有七种：推单、冲正、冲销、补记、挂起、改记、**核销**；补单、事故升级未建入口；豁免不建」，并把「审批通过后系统自动记账」前加「CFO 审批」；在十种处置前新增一节：
  > ### 0. 账龄（不是处置，是处置的开关）
  > - **规则**：开案业务日日终起算，3 天到线；到线标「超期」+ 审计，状态不动，复观察不重置。
  > - **到线后看得见什么**：列表 Aging 列红标「超期」，案件页「超期 N 天」。
  > - **到线解锁**：只对已定性为「挂起·调查中」的行——公司池且金额 ≤ 小额线（AED 100 元 / USDT 30）显示「核销」；公司池超线显示「超期 · 待升级事故（三期）」；客户池显示「超期 · 待二期划转」。
  > - **演示**：案件页「⚡ 拨到超期」（模拟模式），下一分钟扫描即超期。
- 「8. 核销」改为：
  > - **定义**：查不出原因、挂满账龄、金额又小的公司池差异，不再追查，把差额记进损益，案子结掉。公司把这笔差异扛到自己身上。
  > - **账上发生什么**：与补记同一对分录腿——少了：借运营资金 / 贷公司资产（认损）；多了：借公司资产 / 贷其他收入。不增科目、不建资金单。
  > - **四个前提**（少一道就是后门）：案子已超期；该行已定性为「挂起·调查中」且未挂单；案件是公司账簿；差额 ≤ 小额线。
  > - **在哪操作**：金库在案件页那行点「核销」→ 锁定视图（成因固定「查无果核销」、方向 / 金额 / 生效日只读、说明预填查证结论）→ 开单并提审 → CFO 在审批中心看到后果原话 → 批准 → 系统落账 → 运营点「重对账」→ 案子关闭。
  > - **客户池**：不能一笔核销——托管里真少了钱，要先认损再由公司补款（二期内部划转）。本轮界面只显示「待二期划转」。
  > - **本轮状态**：公司池已开放。
- 「9. 豁免」改为「不建入口」+ 四类根源（两边量法不同 / 修正证据已失 / 规则禁止更正分录 / 钱是别人的暂不能动）+ 「条件出现时回来」清单（BTC 8 位、ETH 18 位等超出账本最小单位的资产；带转账扣费或自动变余额机制的代币；真实迁移期初差；VARA 客户资金规则限制调账）
- §四：场景 10 一行改「`UNEXPLAINED` ｜ 挂起·调查中 → 超期 → 核销 ｜ 能（拨钟后金库开单、CFO 批、重对账）」；末段改「14 个场景里 11 个本轮能平，3 个（9/13/14）要等下期或后半批」；文末来源行加本批 spec 路径

- [ ] **Step 4: demo/script.md 第六幕**

- 开场公理加第三句：「**第三句**：查的人、开单的人、批的人是三个人——运营定性、金库开单、CFO 裁决。」
- 步骤表 5 续：「审批中心批准（单步 `CFO`，审批页显示的是后果原话）」
- 步骤 9 改为可点：「Grace USDT 案那行「处置」→ 选「跨账期——下期自平」→ 徽标「已定性 · 挂起·等下期」；案子仍红。可顺带点「重新对账」：日终截止把那条外部行收进来 → 案子自愈，这就是"下期自然平"」；删表后 ⚠️ 段
- 步骤 10 扩为：「公司池那张案子（钱包号看脚本打印）→「处置」→「查不出（已穷尽调查）」→ 说明写清查过什么 → 徽标「已定性 · 调查中」，案子仍红 → 侧栏 **⚡ 拨到超期**（模拟模式）→ 一分钟后刷新，hero「超期 1 天」、列表红标「超期」→ 切金库账号，同一行出现「**核销**」→ 锁定视图（成因固定、方向 / 金额 / 生效日只读）→ 开单并提审 → 切 CFO，审批页读后果原话「公司池查无果核销：钱包 … 差额 0.07 认损进运营资金；案件 … 已超期 1 天；查证结论：…」→ 批准 → 回案件页「重新对账」→ RESOLVED，那行「已解释 · ADJxxx」。**讲三道锁**：账龄 / 小额线 / CFO，少一道就是抹差异的后门」
- 「已知缺口」改：「本轮做到**七件处置**（+核销）；补单后半批，事故三期；豁免 / 容差不做（精度一致）。14 条里能平 **11** 条，场景 9/13/14 长红——不许粉饰」
- 「期望」第③点末尾加「；查完悬着的也不会永远悬着，账龄到线后系统逼出一个结论」

- [ ] **Step 5: demo/data.md**

第 36 行对账那格加：「账龄线 3 天（⚡拨钟）；小额线 AED 100 / USDT 30；场景 10 处置 = 挂起·调查中 → 超期 → 核销（金库开单、CFO 批）」。

- [ ] **Step 6: BACKLOG.md**

- `:149-153`「十件处置已交付六件」→ 「**十件处置已交付七件，余三件按轮排**（2026-09-02 平账 A 批后更新）」；已交付加「**核销**（公司池；四前提 + CFO）」；「下一轮」改为「**后半批**：补单两入口」；「核销 / 豁免 / 容差 / aging」从下一轮删除，另起一句「豁免 / 容差 **不做**（decisions 2026-09-02，精度一致）；aging 已做（3 天，标记 + 审计 + 解锁）」
- `:157` 跨日切 → `[x] ~~…~~ —— 已解（2026-09-02 平账 A 批 Task 6）：run 记 cutoffAt，案件页按它重建`
- `:161` aging+SLA → `[x] ~~…~~ —— 已解（2026-09-02 平账 A 批 Task 4/5/8）：账龄 3 天、到线标记 + 审计、⚡拨钟、按状态解锁；**升级 MLRO/CFO 通知不做**（无通知中心，业主定）；in-transit 死结由超期标记兜住`
- `:191-195` 三处 tooltip → `[x] ~~…~~ —— 已解（2026-09-02 平账 A 批 Task 10）：三处 title 一并删`
- §G 新增一条：`- [ ] **严重度分级跨资产不可比**（2026-09-02 平账 A 批发现）：`wallet-recon-run.service.ts` `computeSeverity` 用「最小单位 1 万」一个数——AED 是 100 元、USDT 是 0.01 元。本批「金额小」另立小额线（`recon-thresholds.constant.ts` 按币种），未借用严重度；修法：severity 阈值按币种进同一张常量表 ｜来源: 2026-09-02 平账 A 批 spec §0-12`

- [ ] **Step 6b: modules/overview.md §4 十一个职务表（裁决人位随策略改）**

- CFO 行「独有动作」末尾加：「；**平账一切审批的裁决人**（调账单四族 + 核销，2026-09-02 起，原运营）」
- OPS_OFFICER 行末尾加：「；不再是平账审批的裁决人（改 CFO），仍持定性写权、⚡拨钟」
- 矩阵头条末尾加一句：「平账审批只在 CFO（运营定性 / 金库开单 / CFO 裁决三人分立）」
- 头部 `Last Verified` 改 2026-09-02

- [ ] **Step 7: CHANGELOG.md**

顶部加一行：
`- [2026-09-02] **平账 A 批：案子悬多久有了钟，悬太久有了出口** —— 观众能感知的变化是：每张打开的案子 3 天到线标「超期」，公司池查不出的小额差异由金库开核销单、**CFO** 批、一笔分录进损益、案子自愈；平账所有审批裁决人从运营改成 CFO（运营定性 / 金库开单 / CFO 裁决三人分立）；公司账簿"记多 / 误记"有了冲销码；跨日切那条差异行回到案件页可点；豁免与容差明确不做（精度一致，一分也追）。14 条破口能平 11 条。`

- [ ] **Step 8: 提交 + 收尾报告**

```bash
git add doc-final/decisions.md doc-final/modules/v8-recon.md doc-final/modules/overview.md doc-final/reference/recon-cause-handbook.md doc-final/demo/script.md doc-final/demo/data.md doc-final/BACKLOG.md doc-final/CHANGELOG.md
git commit -m "docs: 平账 A 批收口——decisions 两条 / 模块篇 / overview 职务表 / 查证手册 / 第六幕剧本 / data / BACKLOG 销四条 / CHANGELOG"
```
收尾一行：`Documentation updated: modules§0-4 / modules§5 / demo / decisions — 平账 A 批：账龄线 + 公司池核销 + 审批人 CFO + 跨日切修复`

---

## 收尾（合并前）

- 对照 spec §10 八条逐条勾：随手闸 ｜ 重铺闸 14/14 + 11/11 ｜ verify:coa ｜ verify:rbac + verify:audit + 封册 ｜ e2e 三份 ｜ 单测七处 ｜ 四张截图 ｜ 文档八处
- 走 `superpowers:finishing-a-development-branch`：合 main 前查主工作树未提交改动（别的会话常在主树干活，只 add 具名文件）；合并后清 worktree + 分支 + `/tmp/exchange_js_wt_recon-aging/`；main 栈 `bash scripts/stack.sh reset main` 重铺 + `demo:all` + `recon:demo:break` 复核
- spec / plan 移入 `doc-final/archive/{specs,plans}/`
