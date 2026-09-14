# 波四 · 共享抽离（行为零变化）· Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收编充提镜像复制品（五件底座 + 三函数 + fee-level 双树 + resolver 归位），并入 §A 幻影失衡根修、广播冻结审计补 OWNER、兑换死枚举清除——除三处业主批准的行为变化外，demo:all 前后输出逐字一致，净减行数。

**Architecture:** 底座照仓内 `ApprovalHandlerBase` 先例（抽象基类 + 域内薄子类），落 `sumsub-shared`；函数收编落 `trading/shared`；兑换对底座**零接入**（业主定案 1）。Spec：`doc-final/superpowers/specs/2026-09-13-wave4-shared-extraction-skeleton.md`（§2 五定案是硬边界）。

**Tech Stack:** NestJS + Prisma + jest（后端）；admin-web/client-web 仅 Task 3（死枚举）可动。

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用；本轮命中行已列 spec §11，Task 12 逐条过。
- 本轮特有：**行为零变化**——三处业主批准的例外（§A id 补零、冻结审计 +ownerNo、死枚举清除的筛选项消失）之外，任何 API 响应、审计行、demo:all 输出的变化都是缺陷。
- **总纲铁律**（子代理 prompt 必带项目 CLAUDE.md §0–§5 要点）：操作必留痕｜门不可绕｜各管各的｜状态只能沿边走｜钱动必过账｜对外用业务键。演示系统，禁做：幂等/去重/重试/并发锁/防御性校验/性能优化。
- **五定案是硬边界**（spec §2）：兑换五件不接底座｜客户可见性常量不抽｜16 审批薄壳不工厂化（fee-level 的 6 个 approval 薄壳**不许顺手合并**）｜findNonTerminalByOwner 取甲案信封式｜死枚举本波清。
- **执行环境**：worktree `.claude/worktrees/wave4_shared_extraction/`（树名下划线），分支 `feat/wave4-shared-extraction`。所有命令在 `<worktree>/Exchange_js/` 下执行。
- **Node 20**：每个 Bash 会话先 `export PATH="$(ls -d "$HOME/.nvm/versions/node"/v20* | tail -1)/bin:$PATH"`。
- **jest**：Exchange_js 根下跑；先 `export DATABASE_URL="file:/tmp/exchange_js_wt_wave4_shared_extraction/dev.db"`（缺它=假红）；不接管道尾；首跑前 `npx prisma generate`。
- **随手闸**（每任务收尾必跑全绿才 commit）：`npx tsc --noEmit -p tsconfig.json`；Task 3 另加 admin/client 两处 `tsc -b` + `npm run test:client` + preview 截图。
- **悬案纪律更新**：Task 1 合入后 demo:all 判红**不再**适用 §A 秒诊——那就是新病，正常取证。
- **模型分层**：任务执行与任务级评审 → sonnet；**Task 1 / Task 9 / Task 10 评审升档 opus**（动钱写点 / 1700 行级双树）；终审 → 省略 model 走继承（Fable）。
- 行号为 2026-09-13 实测，执行时以现场为准（函数名/常量名定位优先）。

---

### Task 0: 环境就位

**Files:** 无代码改动。

- [ ] **Step 1**: 用 superpowers:using-git-worktrees 建 worktree `.claude/worktrees/wave4_shared_extraction/`，分支 `feat/wave4-shared-extraction`（基于 main HEAD）。
- [ ] **Step 2**: worktree 的 Exchange_js 下：`npm ci --no-audit --no-fund 2>&1 | tail -3`（node_modules 缺时）；`npx prisma generate`；`bash scripts/stack.sh reset self`。
- [ ] **Step 3**: 闸能绿：`npx tsc --noEmit -p tsconfig.json` 0 错误；`npx jest src/modules/accounting --silent 2>&1 | tail -5` 全绿。

---

### Task 1: §A 幻影失衡根修（id 补零）【评审升档 opus】

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/utils/tb-id.util.ts:18-21`（bigintToHex 本体）
- Test: `src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts`（若无则新建）

**Interfaces:** `bigintToHex(value: bigint): string` 签名不变，输出恒 32 位补零十六进制。全部调用方（accounting.service 6 处落行、disposition/withdraw-workflow/swap-leg-accounting 的 enrich 键）自动受益，零改动。

**背景**：account_flows 落行 tbAccountId/tbTransferId 走裸 `bigintToHex`，u128 首 nibble 为 0 时只有 31 位（概率 1/16），字符串 join 读面随机丢行 → 幻影失衡（证据 `../.superpowers/sdd/coa-evidence-20260913/findings.md`）。registry 侧同病 2026-09-04 已用 `bigintToRegistryHex` 修过——本任务把根修推到 `bigintToHex` 本体，同类问题连根拔。

- [ ] **Step 1: 写失败测试**：

```ts
import { bigintToHex, bigintToRegistryHex, hexToBigint, deterministicTransferId } from './tb-id.util';

describe('tb-id hex padding (§A 幻影失衡根修)', () => {
  it('bigintToHex pads to 32 hex digits', () => {
    expect(bigintToHex(0x1n)).toBe('0'.repeat(31) + '1');
    expect(bigintToHex(0x1n)).toHaveLength(32);
  });
  it('full-width u128 stays 32 digits', () => {
    const full = (1n << 128n) - 1n;
    expect(bigintToHex(full)).toBe('f'.repeat(32));
  });
  it('roundtrips through hexToBigint', () => {
    const id = deterministicTransferId('DEPOSIT', 'DEP1', 'E1', 0);
    expect(hexToBigint(bigintToHex(id))).toBe(id);
  });
  it('bigintToRegistryHex agrees with bigintToHex now', () => {
    expect(bigintToRegistryHex(0x1n)).toBe(bigintToHex(0x1n));
  });
});
```

- [ ] **Step 2: 确认失败**：`npx jest src/modules/accounting/tigerbeetle/utils --silent`，预期第一条 FAIL（现输出 `'1'` 长度 1）。
- [ ] **Step 3: 实现**（tb-id.util.ts，同时更新注释——`bigintToRegistryHex` 保留为委托别名不动调用方）：

```ts
/**
 * bigint → 32 位补零十六进制（Prisma/SQLite 存储）。
 * §A 根修（2026-09-13）：此前裸 toString(16)，u128 首 nibble 为 0 时只有 31 位
 * （1/16 每 id），account_flows 落行短一位 → 字符串 join 读面随机丢行 → 幻影失衡。
 * registry 侧同病 2026-09-04 已修（bigintToRegistryHex）；本次把补零推到本体，
 * 写侧全线定长。读侧 padTbId 补丁（wallet-flow-matcher / wallet-balance-checker /
 * tb-evidence）保留不动——新库下是无害恒等。
 */
export function bigintToHex(value: bigint): string {
  return value.toString(16).padStart(32, '0');
}
```

`bigintToRegistryHex` 本体改为 `return bigintToHex(value);`（原 padStart 逻辑并入本体后等价），其注释追加一行"2026-09-13 起与 bigintToHex 等价，保留名字只为不动调用方"。

- [ ] **Step 4: 排查同病读写面**（负结论要带命令）：`grep -rn "toString(16)" src/ --include="*.ts" | grep -v spec`——除 tb-id.util 本体外，三处 demo-scenario 的 `tsHex`（自截 8 位时间戳，非 TB id）与 deposit-transactions:1386 的随机 ref（非 TB id）**不动**；确认无其他 TB id 裸转点。
- [ ] **Step 5: 跑测试与相关套件**：Step 1 测试 PASS；`npx jest src/modules/accounting src/modules/clearing-settle --silent` 全绿。
- [ ] **Step 6: 行为验证（证据包复现命令在新库归零）**：`bash scripts/stack.sh reset self` + `bash scripts/on-stack.sh self demo:all`，然后对 worktree 自己的 DB 跑 findings.md 的两条 SQL：

```bash
sqlite3 /tmp/exchange_js_wt_wave4_shared_extraction/dev.db "SELECT length(tbAccountId), length(tbTransferId), count(*) FROM account_flows GROUP BY 1,2;"
```

预期：只有 `32|32|N` 一行（修前会出现 31 长度桶）。孤儿行查询（findings.md 第二条 LEFT JOIN）预期 0 行。

- [ ] **Step 7: 10 连跑闸**（历史失衡率 1/13，10 连绿才有判别力）：

```bash
for i in $(seq 1 10); do bash scripts/stack.sh reset self >/dev/null 2>&1 && bash scripts/on-stack.sh self demo:all 2>&1 | tail -3; done
```

预期：10 轮全 PASS、零失衡报告。随后 `bash scripts/on-stack.sh self verify:coa` 全绿（恒等式 + 负余额都看，判例：负余额断言是"起点缺一笔"唯一探针）。

- [ ] **Step 8: Commit**：`git add src/modules/accounting/tigerbeetle/utils/ && git commit -m "fix(§A): bigintToHex 补零到32位根修幻影失衡——写侧定长，读侧padTbId降为恒等"`

---

### Task 2: 行为基线捕获（在 §A 之后、一切抽离之前）

**Files:** 产物落 `../.superpowers/sdd/wave4-baseline/`（不入库）。

- [ ] **Step 1**: 全量 jest 基线：`npx jest --silent 2>&1 | tail -5` 必须全绿（红了先停——那不是本波的债，回主会话）。
- [ ] **Step 2**: demo:all 基线：fresh reset（Task 1 Step 7 已做）后，捕获两件——

```bash
mkdir -p ../.superpowers/sdd/wave4-baseline
bash scripts/stack.sh reset self >/dev/null 2>&1
bash scripts/on-stack.sh self demo:all > ../.superpowers/sdd/wave4-baseline/demo-all-stdout.raw 2>&1
cp doc-final/demo/data.md ../.superpowers/sdd/wave4-baseline/data.md.baseline
```

- [ ] **Step 3**: 归一化脚本（volatile 字段抹平后才可比）：

```bash
normalize() { sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z?/<TS>/g; s/[0-9a-f]{32}/<HEX32>/g; s/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<UUID>/g; s/[0-9]+ms/<MS>/g' "$1"; }
normalize ../.superpowers/sdd/wave4-baseline/demo-all-stdout.raw > ../.superpowers/sdd/wave4-baseline/demo-all-stdout.norm
```

- [ ] **Step 4**: 行数基线：`git diff --stat main | tail -1` 记零点；`find src/modules/{deposit-sumsub,withdraw-sumsub,swap-sumsub,sumsub-shared} src/modules/trading/{deposit,withdraw,swap}*-* -name "*.ts" | xargs wc -l | tail -1` 存 `wave4-baseline/loc.txt`。

---

### Task 3: F · 兑换死枚举清除 + 提现 dto 文档锈（业主批准的行为变化 ③）

**Files:**
- Modify: `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts:22-25`（删 FAILED/REVERSED 两成员及死枚举注释）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts:94-95,402-403,419-420,963`（终态集两成员、迁移表两空行、两处注释）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:610-611`
- Modify: `src/modules/asset-treasury/transaction-limits/transaction-limit-gate.service.ts:13`（`SWAP_COUNTED_EXCLUDE` 删两串）
- Modify: `admin-web/src/utils/swapStatusMap.ts:41-44,60-70,84`（映射两条目、注释、Exception 组两串）
- Modify: `client-web/src/pages/Swap.tsx:34-35,888`（终态集两串、注释）
- Modify: `src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto.ts:4`（头注"20 边"→"23 边"，顺手项⑤）
- Test: `src/modules/trading/swap-transactions/*.spec.ts`（守则单测若断言 7 枚举/含 FAILED、随本次**批准变更**同步到 5 态——先跑红看清断言再改，不许为过测试放宽断言语义）

**Interfaces:** `SwapTransactionStatus` 收为 5 成员（COMPLIANCE_PENDING/PROCESSING/SUCCESS/REJECTED/FROZEN）。后续任务（Task 6 甲案的 swap 终态集参数）以清除后的枚举为准。

- [ ] **Step 1**: 全仓引用清点（复现命令，执行前后各跑一次）：`grep -rn "REVERSED\|SwapTransactionStatus.FAILED" src/ admin-web/src client-web/src --include="*.ts" --include="*.tsx" | grep -v spec`——修前 8 处命中，修后 **0 处**。
- [ ] **Step 2**: 逐处删除（枚举成员、终态集串、迁移表空行、限额闸排除串、admin 映射与筛选组、client 终态集），相关"死枚举/不可达"注释一并清；提现 dto 头注 20→23。
- [ ] **Step 3**: 三处 tsc：后端 + `cd admin-web && npx tsc -b --noEmit && cd ..` + `cd client-web && npx tsc -b --noEmit && cd ..`，全 0 错误（编译器就是引用清点的第二道闸）。
- [ ] **Step 4**: jest：`npx jest src/modules/trading/swap-transactions src/modules/asset-treasury/transaction-limits --silent`；`npm run test:client`。守则单测若因枚举计数红，按批准变更改断言数字（5 态），commit message 里注明。
- [ ] **Step 5**: ⑤截图闸：起 preview，管理台兑换列表筛选面截图一张（Exception 组只剩 REJECTED）、客户端 Swap 历史页截图一张——渲染无异常。
- [ ] **Step 6**: Commit：`git add -A && git commit -m "chore(F): 清除兑换 FAILED/REVERSED 死枚举——零写入点8处读面连坐删；withdraw dto 头注20→23边"`

---

### Task 4: B · 补 OWNER + 三函数收编（甲案）+ 顺手项①②③④

**Files:**
- Create: `src/modules/trading/shared/customer-view.util.ts`（asset 投影）
- Create: `src/modules/trading/shared/sla-fields.util.ts`（resolveSlaFields 泛型）
- Create: `src/modules/trading/shared/freeze-scan.util.ts`（甲案信封）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（:412 视图 asset 块、:745 resolveSlaFields、:1402 findNonTerminalByOwner）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（:435、resolveSlaFields 同名处、:1112 一带）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（:670 视图两处 asset、:427 resolveSlaFields、:965）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` 与 withdraw 同名文件（onCustomerRestrictionOpened 审计调用核对 ownerNo 真入信封）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:176,189`（顺手项①双重注入合并）
- Test: 三域 *.spec.ts（顺手项②③④在此批：swap spec 补 LEG_SETTLEMENT operator 断言；audit-logs.service.spec 清 mock 残留字面量；deposit-workflow.service.spec 冻结审计断言补 fromStatus/toStatus 两键）

**Interfaces（后续任务与评审对表）：**

```ts
// customer-view.util.ts
export function toCustomerAssetView(asset: { currency: string; code: string; network: string | null; decimals: number } | null | undefined):
  { currency: string; code: string; network: string | null; decimals: number } | null;

// sla-fields.util.ts —— slaBreached 一律归 false 的语义注释随函数走（唯一真相点）
export function resolveSlaFields<S extends string>(minutesByStatus: Partial<Record<S, number>>, nextStatus: S):
  { slaDeadline: Date | null; slaBreached: false };

// freeze-scan.util.ts —— 甲案：信封必带键锁死在这一处
export function freezeScanQueryArgs(opts: {
  ownerId: string;
  noField: 'depositNo' | 'withdrawNo' | 'swapNo';
  terminalStatuses: readonly string[];
  extraSelect?: Record<string, true>;   // 仅 swap 传 { fromAmount: true }
}): { where: object; select: Record<string, true> };
// select 恒含：id/ownerType/ownerId/ownerNo/status/traceId/correlationId + noField
```

- [ ] **Step 1: 写失败测试（信封键锁死 + ownerNo 行为）**：新建 `src/modules/trading/shared/freeze-scan.util.spec.ts`——

```ts
import { freezeScanQueryArgs } from './freeze-scan.util';

it('envelope always carries the audit-required keys', () => {
  const { select } = freezeScanQueryArgs({ ownerId: 'o1', noField: 'depositNo', terminalStatuses: ['SUCCESS'] });
  for (const k of ['id', 'depositNo', 'ownerType', 'ownerId', 'ownerNo', 'status', 'traceId', 'correlationId'])
    expect(select[k]).toBe(true);
});
it('extraSelect merges without displacing envelope keys', () => {
  const { select } = freezeScanQueryArgs({ ownerId: 'o1', noField: 'swapNo', terminalStatuses: [], extraSelect: { fromAmount: true } });
  expect(select.fromAmount).toBe(true);
  expect(select.correlationId).toBe(true);
});
```

同时在 deposit-workflow.service.spec 的广播冻结用例上补断言：审计信封含 `ownerNo`（Frank 类客户号可查的行为面）与 `fromStatus`/`toStatus`（顺手项④，恰是 INHERIT 闸 requiredFields）。

- [ ] **Step 2: 确认失败**：`npx jest src/modules/trading/shared src/modules/trading/deposit-transactions --silent`，新断言 FAIL。
- [ ] **Step 3: 实现三个 util** 并改九个调用点：三域视图函数的 asset 块换 `toCustomerAssetView(item.asset)`（swap 的 from/to 两资产各调一次）；三域 resolveSlaFields 本体换一行委托（**保留原方法与签名**——deposit 的是公开方法有 reissue 路径调用方）；三域 findNonTerminalByOwner 改为 `this.prisma.<delegate>.findMany(freezeScanQueryArgs({...}))`，deposit/withdraw 由此获得 ownerNo（补 OWNER 落地点），终态排除的两段业务注释留在各域调用点。核对 deposit/withdraw 两域 onCustomerRestrictionOpened 的审计调用把 ownerNo 传进信封（对齐 swap 写法；select 有、审计不传=白补）。
- [ ] **Step 4: 顺手项①②③**：swap-workflow 双重注入并一（保 `customerAccessService` 名，改引用点）；swap-transactions spec 补 LEG_SETTLEMENT operator 断言一行；audit-logs.service.spec 删 mock 残留 entityType/entityId/entityNo 无效字面量。
- [ ] **Step 5: 跑闸**：`npx tsc --noEmit -p tsconfig.json`；`npx jest src/modules/trading src/modules/audit-logging --silent` 全绿。
- [ ] **Step 6: 行为验证（专项验收）**：`bash scripts/stack.sh reset self` + `on-stack self demo:all`，然后在审计页数据层验证：

```bash
sqlite3 /tmp/exchange_js_wt_wave4_shared_extraction/dev.db "SELECT action, entityOwnerNo FROM audit_log_events WHERE action IN ('DEPOSIT_FROZEN','WITHDRAW_FROZEN') AND entityOwnerNo IS NOT NULL LIMIT 5;"
```

预期：广播冻结行带客户号（Frank 的 demo:all 运行时冻结正好触发此路径；表/列名以 audit-logging 的 Prisma schema 现场为准，语义=按客户业务键可查到冻结行）。
- [ ] **Step 7: Commit**：`git add -A && git commit -m "refactor(B): 三函数收编入 trading/shared（甲案信封锁审计必带键）+ 充提广播冻结审计补 ownerNo + 顺手项①②③④"`

---

### Task 5: D · kyt-txn-type.resolver 归位

**Files:**
- Move: `src/modules/deposit-sumsub/kyt-txn-type.resolver.ts`（57 行）→ `src/modules/sumsub-shared/kyt-txn-type.resolver.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:36`、`src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:70`（import 路径）

**Interfaces:** `resolveKytTxnType` 导出名与签名不变；纯函数无 NestJS 注册面。

- [ ] **Step 1**: `git mv src/modules/deposit-sumsub/kyt-txn-type.resolver.ts src/modules/sumsub-shared/kyt-txn-type.resolver.ts`；两处 import 改 `'../../sumsub-shared/kyt-txn-type.resolver'`；若有同名 spec 一并 mv。
- [ ] **Step 2**: 残引清点：`grep -rn "deposit-sumsub/kyt-txn-type" src/ --include="*.ts"` 预期 0 命中。
- [ ] **Step 3**: `npx tsc --noEmit -p tsconfig.json` 0 错误；`npx jest src/modules/trading --silent` 全绿。
- [ ] **Step 4**: Commit：`git commit -am "refactor(D): kyt-txn-type.resolver 归位 sumsub-shared——消唯一跨域 import"`

---

### Task 6: A1 · SLA 底座（充提两件 → 基类 + 薄子类）

**Files:**
- Create: `src/modules/sumsub-shared/sla-sweep.base.ts`
- Modify: `src/modules/deposit-sumsub/deposit-sla.service.ts`（159 行 → 薄子类）
- Modify: `src/modules/withdraw-sumsub/withdraw-sla.service.ts`（157 行 → 薄子类）
- Test: 两域现有 sla spec 原样必须全绿（行为面不许改）

**Interfaces（基类合同，执行时以现场 diff 定稿公共体——先跑归一化 diff 看清 68% 公共块）：**

```ts
export abstract class SlaSweepBase {
  protected abstract readonly domainLabel: string;              // 'deposit' | 'withdrawal'（日志文案）
  protected abstract readonly softStatuses: ReadonlySet<string>; // dep: MANUAL_CHECKING+OPERATION_PENDING / wit: MANUAL_CHECKING+PENDING_APPROVAL
  protected abstract findCandidates(now: Date): Promise<any[]>;
  protected abstract markSlaBreached(id: string): Promise<void>;
  protected abstract hardBreach(row: any): Promise<void>;       // 两域硬破线动作与审计各不同——留子类
  protected abstract auditSoftBreach(row: any): Promise<void>;
  async sweep(now: Date): Promise<void>;                        // 公共：遍历 + 软/硬分流 + 错误隔离（单行失败不炸整轮）
}
```

- [ ] **Step 1**: 先量公共块（执行者自己跑，别信本 plan 的旧数）：`diff <(sed 's/[Dd]eposit/XX/g;s/DEPOSIT/XX/g' src/modules/deposit-sumsub/deposit-sla.service.ts) <(sed 's/[Ww]ithdraw/XX/g;s/WITHDRAW/XX/g' src/modules/withdraw-sumsub/withdraw-sla.service.ts)`——残差只允许是：注释措辞、变量名、日志文案、软状态集、硬破线域内动作。若发现**逻辑性**残差（分支/顺序/条件不同），停下回报主会话，不许自行裁决塞进基类。
- [ ] **Step 2**: 两域现有 spec 先跑绿（基线）：`npx jest src/modules/deposit-sumsub src/modules/withdraw-sumsub --silent`。
- [ ] **Step 3**: 抽基类（公共 sweep/分流/错误隔离进基类，域差留抽象成员），两子类瘦身；**swap-sla.service.ts 一行不碰**（定案 1）。
- [ ] **Step 4**: 同一批 spec 原样全绿（测试文件不动是"行为零变化"的最硬证词；若 mock 面被迫变，只许改注入布线、不许改断言）。
- [ ] **Step 5**: `npx tsc --noEmit -p tsconfig.json`；Commit：`git commit -am "refactor(A1): 充提 SLA 扫描抽 SlaSweepBase——公共分流进基类，软状态集/硬动作留域"`

---

### Task 7: A2 · webhook 路由 + KYT 裁决底座

**Files:**
- Create: `src/modules/sumsub-shared/kyt-verdict-handler.base.ts`
- Modify: `src/modules/deposit-sumsub/deposit-webhook.router.ts`、`deposit-kyt-verdict.handler.ts`
- Modify: `src/modules/withdraw-sumsub/withdraw-webhook.router.ts`、`withdraw-kyt-verdict.handler.ts`
- Modify: `src/modules/swap-sumsub/swap-webhook.router.ts`（**仅头注**：把"三域各自演进、不共享基类"的历史口径改为"充提共底座、兑换独立演进（业主 2026-09-13 定案）"——防注释说谎；逻辑零改动）
- Test: 两域现有 handler/router spec 原样全绿

**Interfaces:** router 只有 ~10 行实码（构造注入 + type 分派 + 孤儿 warn），**先量后裁**：若归一化后公共实码 <10 行，基类只收 verdict handler（86% 同、113 行），router 保持两份并在头注互指——把这个现场判断写进任务回执。级联分流语义（SumsubIngestionService 三级 + swap 侧独担孤儿 warn）**不许动**。

- [ ] **Step 1**: 归一化 diff 两对文件（router 对、verdict 对），量公共实码。
- [ ] **Step 2**: 现有 spec 基线绿 → 抽 verdict 基类（同名裁决映射表逐字部分进基类，applicant-action 域内方法名差留子类）→ router 按 Step 1 现场判断处理。
- [ ] **Step 3**: spec 原样全绿 + tsc 0 错误；swap 头注更新。
- [ ] **Step 4**: Commit：`git commit -am "refactor(A2): 充提 KYT 裁决抽基类；swap router 头注更新为新口径（deliberate fork→充提共底/兑换独立）"`

---

### Task 8: A3 · demo 两件底座 + 中点行为检查

**Files:**
- Create: `src/modules/sumsub-shared/demo-scenario.base.ts`
- Modify: `src/modules/deposit-sumsub/demo-scenario.service.ts`（212 行）、`admin-deposit-demo.controller.ts`（50 行）
- Modify: `src/modules/withdraw-sumsub/demo-scenario.service.ts`（201 行）、`admin-withdraw-demo.controller.ts`
- Test: 两域 demo 相关 spec（若有）+ 中点 demo:all

**Interfaces:** DemoScenarioActor / VERDICT_OF 等逐字块进基类；剧本步骤（各域状态机专属）留域内。controller 路由与权限码**零变动**（清单行：无新端点即无 rbac 动作）。swap demo 两件一行不碰。

- [ ] **Step 1**: 归一化 diff 两对 → 抽基类 → spec 绿 + tsc 0 错误。
- [ ] **Step 2**: **中点行为检查**（底座三连做完，早红早知道）：`bash scripts/stack.sh reset self` + `on-stack self demo:all` 捕获 stdout，用 Task 2 的 normalize 对比基线：`diff <(normalize 新捕获) ../.superpowers/sdd/wave4-baseline/demo-all-stdout.norm`——预期**零 diff**；`git diff ../.superpowers/sdd/wave4-baseline/data.md.baseline doc-final/demo/data.md` 同预期（生成区 volatile 字段外零变化）。红了当场修复再前进，不带病进 Task 9。
- [ ] **Step 3**: Commit：`git commit -am "refactor(A3): 充提 demo 两件抽底座——Actor/裁决映射进基类，剧本留域；中点 demo:all 零 diff 通过"`

---

### Task 9: C1 · fee-level 双服务合一【评审升档 opus】

**Files:**
- Create: `src/modules/trading/shared/fee-level.base.ts`
- Modify: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.service.ts`
- Modify: `src/modules/trading/swap-fee-level/swap-fee-level.service.ts`
- Test: `withdrawal-fee-level.service.spec.ts`、`swap-fee-level.service.spec.ts` 原样全绿

**Interfaces（基类合同）：** 24 个同名同序方法（findAll/findById/findByLevelCode/findActiveByAsset/computeHash/validateTiersJson/validateAudienceFields/createLevel/linkApprovalCase/activateLevel/declineLevel/cancelLevel/retireLevel/moveLevel/clearApprovalCase/assertNotLastActiveDefault/deleteById/createChangeRequest/linkApprovalCaseToRequest/executeChange/rejectChangeRequest/cancelChangeRequest/expireChangeRequest/moveChangeRequest/findChangeRequestById 等，执行时以两文件现场清单为准）进基类，域差经抽象 delegate 收口：

```ts
export abstract class FeeLevelServiceBase {
  protected abstract get levelDelegate(): any;          // prisma.withdrawalFeeLevel | prisma.swapFeeLevel
  protected abstract get changeRequestDelegate(): any;  // 对应 change-request 表
  // moveLevel 仅 model 名不同（体检实测）→ 走 delegate 后基类通吃
}
```

**硬边界**：controller / dto / 路由 / 权限码零变动；`*-fee-level-*-approval.service.ts` 六个薄壳**一个字不碰**（定案 3）；quote 两服务（withdraw-quote/swap-quote）不在收编面（波二产物，非镜像）。

- [ ] **Step 1**: 先量：`diff <(sed 's/[Ww]ithdrawal\?/XX/g;s/WITHDRAWAL/XX/g' .../withdrawal-fee-level.service.ts) <(sed 's/[Ss]wap/XX/g;s/SWAP/XX/g' .../swap-fee-level.service.ts)`，逐方法核对"仅 model/常量名差"；逻辑性残差→停下回报。
- [ ] **Step 2**: 两 spec 基线绿 → 抽基类（方法体进基类、delegate 与域常量留子类）→ 两 spec 原样全绿。
- [ ] **Step 3**: tsc 0 错误；`npx jest src/modules/trading/withdrawal-fee-level src/modules/trading/swap-fee-level --silent` 全绿。
- [ ] **Step 4**: Commit：`git commit -am "refactor(C1): fee-level 双服务抽 FeeLevelServiceBase——24 方法进基类，delegate 留域；审批薄壳与 quote 零触碰"`

---

### Task 10: C2 · fee-level 三对 workflow 合一【评审升档 opus】

**Files:**
- Create: `src/modules/trading/shared/fee-level-workflow.base.ts`（或按现场判并入 fee-level.base.ts 同文件——三对 diff 仅 16–45 行）
- Modify: `withdrawal-fee-level-{creation,change,retire}-workflow.service.ts` × `swap-fee-level-{creation,change,retire}-workflow.service.ts` 六文件
- Test: `*-retire-workflow.service.spec.ts` 两份 + 相关 spec 原样全绿

**Interfaces:** 与 Task 9 同款 delegate 模式；审批接线（ApprovalsService 正门、maker-checker 语义）与审计动作码**逐字保留**——workflow 是"门"，清单行"门不可绕"直接适用。

- [ ] **Step 1**: 三对逐对归一化 diff（16–45 行残差逐行定性：域常量/文案=可抽，逻辑=停下回报）。
- [ ] **Step 2**: spec 基线绿 → 抽 → spec 原样全绿 + tsc 0 错误。
- [ ] **Step 3**: `npx jest src/modules/trading --silent` 全绿（面大，跑整个 trading）。
- [ ] **Step 4**: Commit：`git commit -am "refactor(C2): fee-level 三对 workflow 合一——审批接线与审计码逐字保留"`

---

### Task 11: 终验收（收尾闸全套）

**Files:** 无新改动；产物落 `../.superpowers/sdd/wave4-baseline/`。

- [ ] **Step 1**: jest 全量：`npx jest --silent 2>&1 | tail -5` 全绿；三处 tsc 全 0 错误。
- [ ] **Step 2**: **零 diff 主判据**：`bash scripts/stack.sh reset self` + `on-stack self demo:all` 捕获，normalize 后与基线 diff——预期零 diff；`doc-final/demo/data.md` 生成区同判。若有 diff，逐行归因：只允许落在三处批准变化（§A id 长度、冻结审计 ownerNo 列、死枚举筛选项）的解释半径内，其余=缺陷回修。
- [ ] **Step 3**: ⑦ `bash scripts/on-stack.sh self verify:coa`（恒等式 + 负余额）全绿。
- [ ] **Step 4**: ⑧ 重铺闸：`bash scripts/stack.sh reset self` 从零建库再跑 ⑥，判据对照 `doc-final/demo/baseline.md` 全绿。
- [ ] **Step 5**: 净减行数：Task 2 的 loc.txt 对比 + `git diff --stat main | tail -1`，净减为负值（预期数百行级）写进回执。
- [ ] **Step 6**: 变异测试抽查（防"闸跑了但不辨"）：任取一处基类公共逻辑（如 freezeScanQueryArgs 信封漏掉 correlationId）故意改坏 → 对应 spec/闸必须红 → 还原。

---

### Task 12: 文档收口 + 波五骨架

**Files:**
- Modify: `doc-final/modules/`（v4/v5/v6 涉共享层结构处 + overview；v6 状态机数字 7 枚举→5 态）
- Modify: `doc-final/decisions.md`（spec §2 五定案各一条）
- Modify: `doc-final/BACKLOG.md`（销账三条：§A 🔴 幻影失衡、广播冻结审计 OWNER、V6 死枚举）
- Modify: `doc-final/CHANGELOG.md`（一行）
- Create: `doc-final/superpowers/specs/<执行当日日期>-wave5-order-visibility-skeleton.md`（波五骨架：总纲链接/空承接节/已定事实/待定岔口——承接记录写进骨架开头；**不展开波五 spec**）

- [ ] **Step 1**: 按上列逐文件收口；波五承接记录必含：本波实际偏差、执行中新事实（判例候选）、波五前提核对（"号规已在波二定妥"仍真 + 共享抽离未动路由的确认 + F 死枚举清除对波五"三域详情路由改业务号"面的影响=无）。
- [ ] **Step 2**: 全文扫计数（判例：文档同步要全文扫）：`grep -rn "REVERSED" doc-final/modules/ doc-final/demo/` 清残留提法；三域审计码数、状态机数字与代码对表。
- [ ] **Step 3**: Commit：`git commit -am "docs(波四收口): modules四篇+decisions五定案+BACKLOG销账三条+CHANGELOG+波五骨架立档"`

---

### Task 13: 合并与主栈收尾

- [ ] **Step 1**: 用 superpowers:finishing-a-development-branch 收束；终审（Fable，继承模型）按 `review-rubric.md` 三件事 + 逐条问"每条 spec 承诺的代码在哪"（判例：承诺没代码不产生 diff）。
- [ ] **Step 2**: 合并进 main（先并进分支再主树快进，判例）；主树 `npm run db:base:sync` + 重启后端；动过 seed 语义无、但 §A 改落行格式 → `bash scripts/stack.sh reset main` 重铺 + `on-stack main demo:all` + `on-stack main verify:coa` 全绿（判例：走查后复跑 coa）。
- [ ] **Step 3**: 清 worktree + 分支；specs/plans 移 `doc-final/archive/`（总纲存活到波五收官，不归档）；报告行 `Documentation updated: modules§0-4 / decisions / none —— <一句话>`。
