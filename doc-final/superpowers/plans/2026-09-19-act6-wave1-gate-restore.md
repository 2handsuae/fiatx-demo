# 第六幕清残留 · 波一「闸门复位」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「改错了会报红」这张网装回对账三域——摘掉 180 处类型逃逸、修掉因此暴露的 13 个类型错、把 3 条恒真断言换成能红的断言，**全程零行为变更**。

**Architecture:** 三段：① 先改测试（网格断言换真断言 + 删孤儿 spec），② 再逐文件摘逃逸并修错（9 个无错文件一次过，5 个有错文件各一任务），③ 末尾用**变异实证**证明闸门真的能咬人，并用栈级输出 diff 证明行为零变化。

**Tech Stack:** NestJS + Prisma（SQLite）+ TypeScript + Jest。`PrismaService extends PrismaClient`，模型类型齐全，`(this.prisma as any)` 是纯逃逸而非必需。

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **零行为变更**：不删任何 schema 列 / 不改任何 UI / 不动任何业务分支 / 不新增退役任何状态与边
  - **禁止用新逃逸把错误压回去**：`as any`、`!` 非空断言、`@ts-ignore` 三者本波一律禁用；评审逐条问「这处为什么类型是对的」
  - **禁止为让测试通过而改测试的断言**（CLAUDE.md §2 末条）
  - 只动非 `.spec.ts` 文件里的 `(this.prisma as any)`；spec 里的 mock 造型不在本波范围
  - 不碰 `trading` 等其它域（全仓 360 处，本波只动对账三域的 180 处）
  - 发现业务缺口 → 记 `doc-final/BACKLOG.md`，**本波不顺手改业务**
- 基线：main `30437884`，闸① `npx tsc --noEmit -p tsconfig.json` 绿、对账三域 jest 29 suites / 555 tests 全绿
- 跑 jest 需带库：`DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest <路径>`

---

## 文件结构

**改测试（2 个）**
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts:17-30` — 网格断言换真断言
- Delete: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case-idempotent-fields.spec.ts`（67 行，零 import 的恒真 spec）

**摘逃逸（14 个，共 180 处）**——9 个摘完零错，5 个摘完有错：

| 文件 | 逃逸 | 错 |
|---|---|---|
| `disposition/receipt-lookup.service.ts` | 4 | 0 |
| `disposition/explained-difference.service.ts` | 1 | 0 |
| `simulation/simulated-custodian-statement.service.ts` | 5 | 0 |
| `engine/v2/wallet-flow-matcher.service.ts` | 2 | 0 |
| `engine/v2/wallet-balance-checker.service.ts` | 2 | 0 |
| `domain/reconciliation-query.service.ts` | 28 | 0 |
| `governance/incidents/incident.service.ts` | 25 | 0 |
| `asset-treasury/internal-transfers/internal-transfer.service.ts` | 9 | 0 |
| `asset-treasury/internal-transfers/internal-transfer-workflow.service.ts` | 9 | 0 |
| `workflow/case-aging.service.ts` | 5 | **1** |
| `workflow/wallet-recon-run.service.ts` | 21 | **1** |
| `disposition/disposition.service.ts` | 20 | **3** |
| `disposition/adjustment.service.ts` | 33 | **3** |
| `disposition/supplement-evidence.service.ts` | 16 | **5** |

（对账域文件路径前缀统一为 `src/modules/clearing-settle/reconciliation/`，另两个域已在表中写全。）

**贯穿全波的核心事实（先读，能省一半调试时间）**：`ReconciliationCase.walletRef` 在 schema 里**可空**（跨钱包合成案件用 `XREF:` 前缀，见 `case-aging.service.ts` 的 `walletNoOf` 注释），但 `ReconciliationDisposition.walletRef` 与 `ReconciliationAdjustment.walletRef` **不可空**。13 个错误里有 3 个（disposition :95/:97、adjustment :401）是同一条边界的三个面。

---

### Task 0: 采波前基线物证（**必须最先，过时不候**）

**Files:**
- Create: `doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/` 目录

**Interfaces:**
- Consumes: 无
- Produces: `gate-before.txt`（闸门反证）、`demoall-before.txt` / `break-before.txt`（栈级输出基线）——Task 9 的两条硬判据全靠它们做对照组

**为什么必须最先**：本波四条硬判据里有两条是**对照实验**——「闸门现在咬不动 / 改完能咬动」「行为改前改后一模一样」。对照组只能在动手之前采，**动完就永远补不回来了**。

- [ ] **Step 1: 建物证目录**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
mkdir -p doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence
E=doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence
# 钉死基线 SHA——收尾检查表 E 段的三条 git diff 全靠它，别到时候靠回忆
git rev-parse HEAD > "$E/BASELINE_SHA"
cat "$E/BASELINE_SHA"
```

Expected：打印一个 40 位 SHA，并落盘到 `$E/BASELINE_SHA`。后续所有 `git diff $(cat $E/BASELINE_SHA)..HEAD` 都以它为准。

- [ ] **Step 2: 采「闸门现在咬不动」的反证**

故意把一个 Prisma 列名改错，确认**闸①照样是绿的**（这就是本波要消灭的状态）：

```bash
sed -i '' 's/slaBreached: false, slaDeadline: { lt: now }/slaBreachedTYPO: false, slaDeadline: { lt: now }/' \
  src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts
npx tsc --noEmit -p tsconfig.json > "$E/gate-before.txt" 2>&1; echo "波前 EXIT=$?" | tee -a "$E/gate-before.txt"
git checkout -- src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts
```

Expected：`gate-before.txt` 里 **`波前 EXIT=0`、零错误行** —— 列名写错了闸门却不吭声。**这份文件是本波唯一不可替代的物证**，Task 9 Step 1 会拿同一个改法产出 `gate-after.txt` 与它对照。

- [ ] **Step 3: 确认还原干净**

```bash
git status --short
```

Expected：只有 `?? doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/`，**`src/` 下不得有任何改动**。

- [ ] **Step 4: 采栈级输出基线**

起本工作树自己的栈（worktree 内用 `self`，主工作树用 `main`；**两次采样之间不许换栈**）：

```bash
bash scripts/stack.sh up            # worktree 内 = self；主树用 `bash scripts/stack.sh up main`
bash scripts/on-stack.sh self demo:all         > "$E/demoall-before.txt" 2>&1
bash scripts/on-stack.sh self recon:demo:break > "$E/break-before.txt"   2>&1
tail -5 "$E/demoall-before.txt"; tail -5 "$E/break-before.txt"
```

Expected：两份都跑通（`demo:all` 终态断言通过、`recon:demo:break` 打印 18 场景 / 12 案）。**若这里就红了，停手回主会话**——基线不绿，后面「行为零变更」无从谈起。

- [ ] **Step 5: 提交物证**

```bash
git add doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/
git commit -m "test(波一物证): 采波前基线——闸门反证(改错列名 tsc 仍 EXIT=0)+ demo:all 与 recon:demo:break 栈级输出基线,供收尾对照"
```

---

### Task 1: 网格断言换真断言

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts:17-30`

**Interfaces:**
- Consumes: `computeBucket(input: { delta: bigint; inTransitSigned: bigint; inTransitCount: number; anomalyCount: number }): ReconBucket`（既有，不改）
- Produces: 无（纯测试改动）

- [ ] **Step 1: 先证明现在这条断言是恒真的**

把 `bucket-classifier.ts` 的 `COMPENSATING` 分支故意改成返回 `'MATCHED'`：

```bash
sed -i '' "s/if (input.anomalyCount > 0) return 'COMPENSATING';/if (input.anomalyCount > 0) return 'MATCHED';/" \
  src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.ts
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts
```

Expected：**7 条 `it.each` 里有 1 条红（`compensating: 余额平但流水脏`），但那条「180 组网格」用例是绿的**。这就是本任务要修的东西——把这次输出记下来，收尾报告要贴。

- [ ] **Step 2: 还原被改坏的实现**

```bash
git checkout -- src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.ts
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts
```

Expected：8 passed。

- [ ] **Step 3: 把网格用例改成真断言**

把 `bucket-classifier.spec.ts` 第 17-30 行整块替换为：

```ts
  // 期望值由**独立的**判定函数算出——规则抄自 modules/v8-recon.md §1「差异分桶，命中即止」，
  // 不是从 computeBucket 复制的实现。两边各写一遍，改了任何一边网格就红：这正是本断言的作用。
  // （旧写法 `expect(buckets.has(b)).toBe(true)` 在 TS 下恒真——computeBucket 的返回类型
  //  就是那 4 个字面量的联合、每条分支都返回字面量，它不可能红。）
  const expectedBucket = (i: Parameters<typeof computeBucket>[0]): string => {
    const residual = i.delta - i.inTransitSigned;
    if (residual !== 0n) return 'BREAK';
    if (i.inTransitCount > 0) return 'IN_TRANSIT';
    if (i.anomalyCount > 0) return 'COMPENSATING';
    return 'MATCHED';
  };

  it('180 组确定性网格：逐组落到期望的那一个桶', () => {
    const deltas = [-600n, -100n, 0n, 1n, 500n];
    const transits = [-600n, -100n, 0n, 500n];
    const counts = [0, 1, 2];
    let checked = 0;
    for (const delta of deltas)
      for (const inTransitSigned of transits)
        for (const inTransitCount of counts)
          for (const anomalyCount of counts) {
            const input = { delta, inTransitSigned, inTransitCount, anomalyCount };
            expect(computeBucket(input)).toBe(expectedBucket(input));
            checked += 1;
          }
    expect(checked).toBe(180);
  });
```

- [ ] **Step 4: 变异实证——证明新断言会红**

重复 Step 1 的那次改坏：

```bash
sed -i '' "s/if (input.anomalyCount > 0) return 'COMPENSATING';/if (input.anomalyCount > 0) return 'MATCHED';/" \
  src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.ts
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts
```

Expected：**「180 组确定性网格」这条用例现在也红了**（报 `Expected: "COMPENSATING" Received: "MATCHED"`）。把这次输出记下来——这是本任务的物证。

- [ ] **Step 5: 还原并跑绿**

```bash
git checkout -- src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.ts
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts
```

Expected：8 passed。

- [ ] **Step 6: 提交**

```bash
git add src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts
git commit -m "test(对账分桶): 180 组网格换真断言——旧写法只断言返回值是合法桶名(TS 下恒真不可能红),改为独立期望函数逐组比对;变异实证已验能红"
```

---

### Task 2: 删孤儿 spec

**Files:**
- Delete: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case-idempotent-fields.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: 无

**为什么直接删而不重写**：该文件 67 行、`grep -c "^import"` = **0**，两个用例都是自建假 prisma / 自建数组，再断言 mock 把刚塞进去的值原样回显——零生产代码执行，结构上不可能红。它承诺覆盖的真实不变量（`(walletRef, businessDate)` 幂等 upsert）已被 `wallet-recon-run.service.spec.ts` 三重真断言覆盖（已核实，见 Step 1）。

- [ ] **Step 1: 先确认覆盖真的在（不确认就不许删）**

```bash
grep -n "same wallet breaks in 3 sequential runs\|case 唯一性跨日\|既有 OPEN 案件被复观察" \
  src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts
```

Expected：三行命中，分别在 `:499` / `:592` / `:765` 附近。**若任何一条没命中，停手，回主会话**——说明覆盖假设不成立，删除方案要重议。

- [ ] **Step 2: 删除**

```bash
git rm src/modules/clearing-settle/reconciliation/domain/reconciliation-case-idempotent-fields.spec.ts
```

- [ ] **Step 3: 跑对账三域 jest，确认不变量覆盖没丢**

```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
```

Expected：**28 suites passed（少 1 个 suite）**，tests 数比基线 555 少 2（那两个恒真用例），其余全绿。

- [ ] **Step 4: 提交**

```bash
git commit -m "test(对账): 删孤儿 spec reconciliation-case-idempotent-fields——67 行零 import,自建 mock 原样回显再断言回显值,零生产代码执行;其承诺的幂等 upsert 不变量已由 wallet-recon-run.service.spec.ts :499/:592/:765 三重真断言覆盖"
```

---

### Task 3: 摘掉 9 个无错文件的逃逸（85 处）

**Files:**（全部 Modify）
- `src/modules/clearing-settle/reconciliation/disposition/receipt-lookup.service.ts`
- `src/modules/clearing-settle/reconciliation/disposition/explained-difference.service.ts`
- `src/modules/clearing-settle/reconciliation/simulation/simulated-custodian-statement.service.ts`
- `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts`
- `src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts`
- `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`
- `src/modules/governance/incidents/incident.service.ts`
- `src/modules/asset-treasury/internal-transfers/internal-transfer.service.ts`
- `src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.ts`

**Interfaces:**
- Consumes: `PrismaService extends PrismaClient`（`src/core/prisma/prisma.service.ts:5`），所有对账域模型均在生成类型里
- Produces: 这 9 个文件此后由 tsc 覆盖；后续任务不再碰它们

- [ ] **Step 1: 批量替换**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
for f in \
  src/modules/clearing-settle/reconciliation/disposition/receipt-lookup.service.ts \
  src/modules/clearing-settle/reconciliation/disposition/explained-difference.service.ts \
  src/modules/clearing-settle/reconciliation/simulation/simulated-custodian-statement.service.ts \
  src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts \
  src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts \
  src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts \
  src/modules/governance/incidents/incident.service.ts \
  src/modules/asset-treasury/internal-transfers/internal-transfer.service.ts \
  src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.ts ; do
  sed -i '' 's/(this\.prisma as any)/this.prisma/g' "$f"
done
```

- [ ] **Step 2: 确认这 9 个文件已归零**

```bash
grep -c "this\.prisma as any" \
  src/modules/clearing-settle/reconciliation/disposition/receipt-lookup.service.ts \
  src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts \
  src/modules/governance/incidents/incident.service.ts
```

Expected：三行都是 `0`。

- [ ] **Step 3: 闸① 必须仍然全绿**

```bash
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
```

Expected：`EXIT=0`，零输出。**若这里报错，说明有文件被误判为「无错」——停手，把错误贴回主会话，不要自行修。**

- [ ] **Step 4: jest 三域全绿**

```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
```

Expected：28 suites passed。

- [ ] **Step 5: 提交**

```bash
git add -u
git commit -m "refactor(对账): 摘 9 个无错文件的类型逃逸共 85 处——(this.prisma as any) 改 this.prisma,零行为变更,闸①仍绿"
```

---

### Task 4: `case-aging.service.ts`（5 处逃逸 + 1 错）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts`（逃逸 5 处；错在 `:28`）

**Interfaces:**
- Consumes: `AgingBreachCandidate`（同文件 `:14-17`，`slaDeadline: Date` 不可空）
- Produces: `findBreachCandidates(now: Date): Promise<AgingBreachCandidate[]>`（签名不变）

- [ ] **Step 1: 摘逃逸**

```bash
sed -i '' 's/(this\.prisma as any)/this.prisma/g' \
  src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep case-aging
```

Expected：1 行错误 —— `case-aging.service.ts(28,5): error TS2322`，说返回对象里 `slaDeadline: Date | null` 等与 `AgingBreachCandidate` 不符。

- [ ] **Step 2: 修——显式窄化，不用 `!`**

把 `findBreachCandidates` 整个方法体替换为：

```ts
  async findBreachCandidates(now: Date): Promise<AgingBreachCandidate[]> {
    const rows = await this.prisma.reconciliationCase.findMany({
      where: { status: 'OPEN', layer: 'WALLET', slaBreached: false, slaDeadline: { lt: now } },
      select: { id: true, caseNo: true, walletRef: true, slaDeadline: true, bucket: true, book: true, severity: true, traceId: true },
    });
    // where 里的 `slaDeadline: { lt: now }` 已把 null 排除在外，但 Prisma 的返回类型照样是
    // `Date | null`（它不做 where→select 的类型推导）。显式窄化，不用 `!`（本波禁非空断言）。
    return rows.filter((r): r is AgingBreachCandidate => r.slaDeadline !== null);
  }
```

- [ ] **Step 3: 闸① 与 jest**

```bash
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle/reconciliation/workflow src/modules/clearing-settle/reconciliation/sweep
```

Expected：`EXIT=0`；jest 全绿（`case-aging.service.spec.ts` 与 `case-aging-sweep.service.spec.ts` 都在这两个目录里）。

- [ ] **Step 4: 提交**

```bash
git add -u
git commit -m "refactor(账龄): 摘 5 处类型逃逸,findBreachCandidates 用类型谓词显式窄化 slaDeadline(where 已排除 null 但 Prisma 返回类型不知道),不用非空断言"
```

---

### Task 5: `wallet-recon-run.service.ts`（21 处逃逸 + 1 错）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`（逃逸 21 处；错在 `:389`，根因在 `:200` 的声明）

**Interfaces:**
- Consumes: `Prisma` 命名空间（该文件 `:20` 已 `import { Prisma } from '@prisma/client'`，无需新增 import）
- Produces: `run()` 签名与行为不变

- [ ] **Step 1: 摘逃逸**

```bash
sed -i '' 's/(this\.prisma as any)/this.prisma/g' \
  src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep wallet-recon-run
```

Expected：1 行错误 —— `wallet-recon-run.service.ts(389,62)`，说 `Record<string, unknown>[]` 不能赋给 `ReconciliationRunWalletCreateManyInput[]`。

- [ ] **Step 2: 修——给快照载荷补真类型**

把 `:200` 那行声明：

```ts
    const snapshotRows: Array<Record<string, unknown>> = [];
```

改成：

```ts
    // 快照载荷此前是 Record<string, unknown>——等于对这张表的写入完全没类型，写错列名
    // tsc 也不知道。改用 Prisma 生成的入参类型（`Prisma` 已在本文件 :20 导入）。
    const snapshotRows: Prisma.ReconciliationRunWalletCreateManyInput[] = [];
```

- [ ] **Step 3: 闸① ——这一步很可能连带暴露 `:305` / `:366` 两处 push 的字段问题**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep wallet-recon-run; echo "EXIT=$?"
```

Expected 之一：
- 零输出 → 直接进 Step 4
- **报 `:305` 或 `:366` 的 push 对象字段不符** → 这是真发现：说明快照写入有字段名或类型对不上。**逐个按错误提示修字段名/类型，不许改回 `Record<string, unknown>`、不许加 `as any`。** 若发现某个字段在 schema 里根本不存在（即一直在写一个不存在的列），停手记 `BACKLOG` 并回主会话——那是行为问题，超出本波「零行为变更」边界

- [ ] **Step 4: jest**

```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle/reconciliation/workflow
```

Expected：全绿（含 `wallet-recon-run.service.spec.ts` 的 `:647`「每钱包快照落库」用例）。

- [ ] **Step 5: 提交**

```bash
git add -u
git commit -m "refactor(对账编排): 摘 21 处类型逃逸,快照载荷 Record<string,unknown>[] 换 Prisma.ReconciliationRunWalletCreateManyInput[]——此前这张表的写入完全无类型"
```

---

### Task 6: `disposition.service.ts`（20 处逃逸 + 3 错）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts`（逃逸 20 处；错在 `:74` `:95` `:97`）

**Interfaces:**
- Consumes: `ReconciliationCase.walletRef` 可空；`ReconciliationDisposition.walletRef` 不可空
- Produces: `record()` 签名与行为不变

- [ ] **Step 1: 摘逃逸**

```bash
sed -i '' 's/(this\.prisma as any)/this.prisma/g' \
  src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "disposition.service.ts("
```

Expected：3 行错误（`:74` `:95` `:97`）。

- [ ] **Step 2: 修 `:74` —— `.filter(Boolean)` 不做类型窄化**

把 **`:72`** 那行（已核实其内容就是 `    ].filter(Boolean);`，构造 `anchorConditions` 数组的末行）改为：

```ts
    ].filter((c): c is NonNullable<typeof c> => c !== null);
```

（`.filter(Boolean)` 在 TS 里不窄化联合类型，`null` 会留在类型里；用类型谓词才行。）

- [ ] **Step 3: 修 `:95` / `:97` —— walletRef 可空塞进不可空列**

在 **`:83`**（已核实其内容就是 `    const data = {`）**上面**插入显式守卫：

```ts
    // ReconciliationCase.walletRef 可空（跨钱包合成案件用 'XREF:' 前缀，见 case-aging.service.ts
    // 的 walletNoOf 注释），但 ReconciliationDisposition.walletRef 不可空——给这类案子记定性
    // 会在运行期炸成 Prisma 校验错。逃逸盖住的就是这条边界，现在显式拒。
    if (kase.walletRef === null) {
      throw new BadRequestException(`Case ${caseNo} has no wallet reference — findings can only be recorded on wallet-anchored cases`);
    }
```

然后把 `data` 里的 `walletRef: kase.walletRef,` 保持原样（此时已窄化为 `string`）。

- [ ] **Step 4: 闸①**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "disposition.service.ts("; echo "EXIT=$?"
```

Expected：零输出。若 `:95`/`:97` 还报别的字段（不是 walletRef），按同样思路逐个显式窄化；**不许加 `as any`**。

- [ ] **Step 5: jest**

```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle/reconciliation/disposition
```

Expected：全绿。

- [ ] **Step 6: 把这条边界记进 BACKLOG（业务缺口，本波不改行为）**

在 `doc-final/BACKLOG.md` 的 `## G. 第六幕 · 账对` 段末尾追加一行：

```markdown
- [ ] **跨钱包合成案件（`walletRef` 为空）不能记定性、不能开调账单**：`ReconciliationCase.walletRef` 可空，但 `ReconciliationDisposition` / `ReconciliationAdjustment` 的同名列不可空——波一摘类型逃逸时暴露（此前由 `(this.prisma as any)` 盖住，真撞上会在运行期炸成 Prisma 校验错）。波一已补显式 400 拒绝，**但"这类案子该怎么处置"业务上没有答案**：现状是开了案子却一个处置都点不了。需业主定：① 这类案子本来就不该开？② 还是该给它一套自己的处置？｜来源: 2026-09-19 清残留波一 Task 6
```

- [ ] **Step 7: 提交**

```bash
git add -u
git commit -m "refactor(定性): 摘 20 处类型逃逸;filter(Boolean) 换类型谓词;walletRef 可空塞不可空列改显式 400——该边界此前被逃逸盖住会运行期炸,业务缺口已记 BACKLOG"
```

---

### Task 7: `adjustment.service.ts`（33 处逃逸 + 3 错）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`（逃逸 33 处；错在 `:176` `:256` `:401`）

**Interfaces:**
- Consumes: 同 Task 6 的 walletRef 边界
- Produces: `createDraft()` / `assertIncidentWriteOffAllowed()` 签名与行为不变

- [ ] **Step 1: 摘逃逸**

```bash
sed -i '' 's/(this\.prisma as any)/this.prisma/g' \
  src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "adjustment.service.ts("
```

Expected：3 行错误（`:176` `:256` `:401`）。

- [ ] **Step 2: 修 `:176` —— 与 Task 6 的 `:74` 同款**

把 **`:172`** 那行（已核实其内容就是 `    ].filter(Boolean);`，构造 `anchors` 的那个）改为：

```ts
    ].filter((c): c is NonNullable<typeof c> => c !== null);
```

- [ ] **Step 3: 修 `:401` —— walletRef 可空**

在 `createDraft` 里构造 `data` 之前插入与 Task 6 同款的守卫（措辞按本方法调整）：

```ts
    if (kase.walletRef === null) {
      throw new BadRequestException(`Case ${dto.caseNo} has no wallet reference — adjustments can only be raised on wallet-anchored cases`);
    }
```

- [ ] **Step 4: 修 `:256` —— `incident.assessedAmount` 可能为 null**

`:256` 现在是 `const assessed = incident.assessedAmount.toFixed(decimals);`。在它**上面**插入显式守卫：

```ts
    // 事故未定损时 assessedAmount 为 null，此处直接 .toFixed() 会抛 TypeError（不是人话 400）。
    // 剧本场景 18 的顺序是「定损 → 回案件页认损」，所以正常路径走不到这儿；但守卫本就该显式拒，
    // 而不是靠调用顺序碰运气。这是把既有语义显式化，不是新增业务规则。
    if (incident.assessedAmount === null) {
      throw new BadRequestException(`Incident ${held.incidentNo} has not been assessed yet — record the assessed loss before raising the write-off`);
    }
```

- [ ] **Step 5: 闸① 与 jest**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "adjustment.service.ts("; echo "EXIT=$?"
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle/reconciliation/disposition
```

Expected：tsc 零输出；jest 全绿。

- [ ] **Step 6: 提交**

```bash
git add -u
git commit -m "refactor(调账单): 摘 33 处类型逃逸;filter(Boolean) 换类型谓词;walletRef 可空与 incident.assessedAmount 可空各补显式 400——后者此前会抛 TypeError 而非人话错误"
```

---

### Task 8: `supplement-evidence.service.ts`（16 处逃逸 + 5 错）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.ts`（逃逸 16 处；错在 `:80` `:99` `:138` `:165` `:167`）

**Interfaces:**
- Consumes: `SupplementKind = 'SUPPLEMENT_DEPOSIT' | 'SUPPLEMENT_BOUNCE' | 'SUPPLEMENT_PAYOUT_RETURN'`（`:8`）；`ClaimableLine`（`:14-22`，其中 `ownerId: string`、`direction: 'IN' | 'OUT'` 均不可空）
- Produces: `listCandidates()` / `loadLine()` 签名与行为不变

**本文件优先读一段注释**：`:143-146` 有一条前人留下的事故记录——「这段原本走 `wallet.asset`，因整份文件用 `(this.prisma as any)` 取数，tsc 照不到，合并后会在运行期才炸成 `PrismaClientValidationError`」。**这就是本波存在的理由的现场物证**，收尾报告值得引。

- [ ] **Step 1: 摘逃逸**

```bash
sed -i '' 's/(this\.prisma as any)/this.prisma/g' \
  src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "supplement-evidence"
```

Expected：5 行错误（`:80` `:99` `:138` `:165` `:167`）。

- [ ] **Step 2: 修 `:99` —— `kase` 可能为 null**

`listCandidates` 里 `:78` 的 `const kase = await this.prisma.reconciliationCase.findUnique({ where: { caseNo } });` 之后、`:79` 之前插入：

```ts
    if (!kase) throw new NotFoundException(`Case not found: ${caseNo}`);
```

（已核实：该文件首行 import 就是 `import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';`——两个异常类都在，**无需动 import**。Task 6 / Task 7 的两个文件同样已导入这两个类。）

- [ ] **Step 3: 修 `:80` —— `d.deferredTarget` 是 `string | null`，要窄到 `SupplementKind | null`**

把 `:80` 那行改为：

```ts
    const SUPPLEMENT_KINDS: readonly SupplementKind[] = ['SUPPLEMENT_DEPOSIT', 'SUPPLEMENT_BOUNCE', 'SUPPLEMENT_PAYOUT_RETURN'];
    const isSupplementKind = (v: unknown): v is SupplementKind =>
      typeof v === 'string' && (SUPPLEMENT_KINDS as readonly string[]).includes(v);
    const kind: SupplementKind | null = d?.outlet === 'SUPPLEMENT' && isSupplementKind(d.deferredTarget)
      ? d.deferredTarget
      : (line.direction === 'OUT' ? 'SUPPLEMENT_BOUNCE' : null);
```

- [ ] **Step 4: 修 `:138` —— `kase.walletRef` 可空塞进 wallet 复合唯一键的 `where`**

在 `:138` 那行 `const wallet = await this.prisma.wallet.findUnique({ where: { id: kase.walletRef } });` **上面**插入：

```ts
    // walletRef 可空（跨钱包合成案件），为 null 时 findUnique 的 where 会在运行期被 Prisma 拒。
    if (kase.walletRef === null) {
      throw new BadRequestException(`Case ${caseNo} has no wallet reference — supplements only apply to wallet-anchored cases`);
    }
```

- [ ] **Step 5: 修 `:165` / `:167` —— 返回对象两个字段类型不符**

`:165` 的 `ownerId: wallet.ownerId`：`ClaimableLine.ownerId` 声明为 `string` 不可空，而 `wallet.ownerId` 是 `string | null`。在 return 之前插入守卫：

```ts
    if (wallet.ownerId === null) {
      throw new BadRequestException(`Wallet ${wallet.walletNo ?? wallet.id} has no owner — supplements only apply to customer wallets`);
    }
```

`:167` 的 `direction: line.direction`：`ClaimableLine.direction` 是 `'IN' | 'OUT'`，而列是 `string`。在同处插入：

```ts
    if (line.direction !== 'IN' && line.direction !== 'OUT') {
      throw new BadRequestException(`Statement line ${externalLineId} has an unexpected direction: ${line.direction}`);
    }
```

（两条守卫都放在 `return {` 之前，插入后 `ownerId` 与 `direction` 已被窄化，return 里两行保持原样。）

- [ ] **Step 6: 闸① 与 jest**

```bash
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
```

Expected：`EXIT=0`（**此时全波 180 处已摘净，闸①应当整体全绿**）；jest 28 suites passed。

- [ ] **Step 7: 逃逸归零验收**

```bash
grep -rn "this\.prisma as any" \
  src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers \
  --include='*.ts' | grep -v '\.spec\.ts' | wc -l
```

Expected：**`0`**。

- [ ] **Step 8: 提交**

```bash
git add -u
git commit -m "refactor(补单证据): 摘 16 处类型逃逸,补 5 条显式守卫(kase/walletRef/ownerId 可空 + deferredTarget 与 direction 松类型窄化);至此对账三域 180 处逃逸归零"
```

---

### Task 9: 闸门变异实证 + 零行为变更验收 + 收尾

**Files:**
- Modify: `doc-final/CHANGELOG.md`（加一行）
- Modify: `doc-final/superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md`（回写状态行）
- Create: `doc-final/superpowers/specs/2026-09-19-act6-wave2-skeleton.md`（波二骨架 + 承接记录）

**Interfaces:**
- Consumes: 前 8 个任务的成果
- Produces: 波二可以开工

- [ ] **Step 1: 变异实证——证明闸门真的会咬人（本波存在的理由）**

故意把一个 Prisma 列名改错：

```bash
E=doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence
sed -i '' 's/slaBreached: false, slaDeadline: { lt: now }/slaBreachedTYPO: false, slaDeadline: { lt: now }/' \
  src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts
npx tsc --noEmit -p tsconfig.json > "$E/gate-after.txt" 2>&1; echo "波后 EXIT=$?" | tee -a "$E/gate-after.txt"
grep case-aging "$E/gate-after.txt"
```

Expected：**报错**，指出 `slaBreachedTYPO` 不存在于 `ReconciliationCaseWhereInput`。**把这次输出原样保存**——它是本波唯一的、不可替代的物证（同样的操作在波前是**绿的**）。

- [ ] **Step 2: 还原并复绿**

```bash
git checkout -- src/modules/clearing-settle/reconciliation/workflow/case-aging.service.ts
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
```

Expected：`EXIT=0`。

- [ ] **Step 3: 三闸全跑**

```bash
npx tsc --noEmit -p tsconfig.json; echo "闸①EXIT=$?"
cd admin-web && npx tsc -b --noEmit; echo "闸②EXIT=$?"; cd ..
cd client-web && npx tsc -b --noEmit; echo "闸③EXIT=$?"; cd ..
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
```

Expected：三个 `EXIT=0`；jest 28 suites passed。（②③ 本波无改动，跑一遍确认没误伤。）

- [ ] **Step 4: 零行为变更实证——栈级输出逐字节 diff**

在本 worktree 的 self 栈上跑，波前波后各一次（波前那次若未留存，用 `git stash` 回到基线再跑一次）：

```bash
E=doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence
bash scripts/stack.sh up            # 必须与 Task 0 Step 4 同一个栈
bash scripts/on-stack.sh self demo:all         > "$E/demoall-after.txt" 2>&1
bash scripts/on-stack.sh self recon:demo:break > "$E/break-after.txt"   2>&1
diff "$E/demoall-before.txt" "$E/demoall-after.txt" | tee "$E/demoall-diff.txt"
diff "$E/break-before.txt"   "$E/break-after.txt"   | tee "$E/break-diff.txt"
```

Expected：**两个 diff 都为空**（时间戳 / 单号这类天然变动的行可用 `sed` 归一后再比，归一规则写进收尾记录）。这是本波「零行为变更」的硬证据——`as any` 与 mock 逃逸之下，栈级输出 diff 是唯一咬得住的闸（判例 2026-09-13 波四）。

- [ ] **Step 5: 写波二骨架 + 承接记录**

创建 `doc-final/superpowers/specs/2026-09-19-act6-wave2-skeleton.md`：

```markdown
# 第六幕清残留 · 波二「清死物」—— 骨架

> 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` §3 波二行
> 本文件是骨架，**不是 spec**。波二 spec 的展开是下一个新会话读总纲 + 本承接后跟业主脑暴的活。

## 承接上一波（波一，2026-09-19 收官）

- **实际偏差**：<填：计划 13 个错误，实际几个；有没有 Step 3 那类连带暴露>
- **执行中发现的新事实**：<填。已知必填两条——① `wallet-recon-run.service.ts` 快照载荷补真类型后是否连带暴露 `:305`/`:366` 的字段问题；② Task 6/7/8 补的三条 walletRef 守卫，业务缺口已记 BACKLOG>
- **波二前提有无变化**：<填。默认不变：红 3 `externalTimestamp`、12 根死列、两个幽灵筛选项、运营收权限、External Balances 被劫持，边界按总纲原样>

## 已定事实（波一带过来的）

- 对账三域 180 处类型逃逸已归零；闸① 现在对该域数据层**有效**（变异实证在案）
- **但闸① 不咬「省略可选字段」**——红 3（`externalTimestamp` 零写入）这类缺陷**波一防不住**，波二必须自建「断言写进去的行长什么样」这道防线，否则删完死列还会再长一根

## 待定岔口

- 红 3 的两条路（写它 / 退役它）二选一，需在波二 spec 里定
- 运营收权限那条，连带 `FundsOrderDetail.tsx:163-168` 的无条件链接同改（总纲 §5 已定，此处只是提醒别漏）
```

- [ ] **Step 6: 回写总纲状态行**

把总纲 `2026-09-19-act6-recon-cleanup-charter.md` 的状态行改为：

```markdown
**状态**：波一 **已完成**（2026-09-19，<填 commit 范围>，9 任务，闸①②③ + jest 全绿，变异实证闸①能红、栈级输出 diff 为空）｜ 波二 待开 ｜ 波三 待开 ｜ 波四 待开 ｜ 波五 待开
```

- [ ] **Step 7: `CHANGELOG` 一行**

在 `doc-final/CHANGELOG.md` 顶部追加（照既有文风，业务视角一句话开头）：

```markdown
- [2026-09-19] **对账这块代码的"报错开关"修好了** —— 观众感知不到（零行为变更），但从此改错了会当场被拦住：对账 / 事故 / 划转三域 180 处「让检查工具别管」的写法全部摘掉，连带修好 13 个被它盖住的类型问题（其中 1 处可空值塞进数据库查询键，真撞上会在运行期炸）；域里 3 条**永远不会失败**的假测试换成真断言（一条是"断言返回值是合法桶名"而返回类型就是那几个桶名，另两条是自建 mock 原样回显再断言回显值）。物证：故意改错一个数据库列名，检查工具当场报红——同样的操作在这一波之前是绿的。**下一波**：清死字段与幽灵入口，并补上闸门咬不住的那道防线（断言写进去的行长什么样）
```

- [ ] **Step 8: 提交并报告**

```bash
git add -u doc-final/
git add doc-final/superpowers/specs/2026-09-19-act6-wave2-skeleton.md
git commit -m "docs(波一收尾): CHANGELOG 一行 + 总纲状态回写 + 波二骨架与承接记录"
```

按 `CLAUDE.md §9` 报一行：`Documentation updated: modules§5 / demo / decisions / none — <一句话>`（本波未改业务，预期是 `none` 或仅 CHANGELOG/总纲层）。

---

## 自检：spec 覆盖对照

| spec 章节 | 落在哪个任务 |
|---|---|
| §0 做/不做 | Global Constraints + 各任务「不许加 `as any`」约束 |
| §1 范围 180 处 / 14 文件 | Task 3（9 个无错）+ Task 4-8（5 个有错） |
| §1 的 13 个错误逐条 | Task 4（#12）/ Task 5（#13）/ Task 6（#8-11 之 3 条）/ Task 7（#6 #7 #8）/ Task 8（#1-#5） |
| §1 订正「波一防不住下一个 externalTimestamp」 | Task 9 Step 5 波二骨架「已定事实」第 2 条 |
| §2 摘逃逸做法与三类修法 | Task 4-8 各 Step 2-5 |
| §2「#3 单独盯」（运行期会抛那条） | Task 8 Step 4 |
| §3 三条恒真断言 | Task 1（网格）+ Task 2（孤儿 spec 两条） |
| §4 交付清单命中两行 | Task 9 Step 5-7 |
| §5 四条硬判据 | ①Task 8 Step 7 ②Task 9 Step 1 ③Task 1 Step 4 ④Task 9 Step 4 |
| §6 风险「用新逃逸压回去」 | Global Constraints + Task 4-8 每个 Step 的 Expected 里点名 |
| §6 风险「#6 牵出业务问题」 | Task 6 Step 6（记 BACKLOG，不改业务） |

---

## 波一收尾检查表（合并前逐条打勾，一页收齐）

> 这张表存在的理由：判据散在三处（步骤在本文件各任务、硬判据在 spec §5、交付清单映射在 spec §4、禁令在本文件 Global Constraints）。**子代理模式下每个子代理只看得到自己那一个任务**，看不到全局判据——没有这张表，等 Task 9 才发现前面某步物证没留，就得回头重跑。
> 用法：合并前从上到下逐条打勾，**任何一条打不上就不许合**。

### A. 物证清单（四份，缺一不可）

| 物证 | 谁产出 | 落盘路径 | 判据 |
|---|---|---|---|
| `gate-before.txt` | **Task 0 Step 2** | `doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/` | 改错 Prisma 列名，闸① **仍 `EXIT=0`、零错误行**（这是本波要消灭的状态） |
| `gate-after.txt` | Task 9 Step 1 | 同上 | 同一个改法，闸① **报错**，指出 `slaBreachedTYPO` 不存在 |
| `demoall-diff.txt` / `break-diff.txt` | Task 9 Step 4 | 同上 | **两份 diff 均为空**（时间戳 / 单号类天然变动若需归一，归一规则写进收尾记录） |
| 网格断言变异前后输出 | Task 1 Step 1 与 Step 4 | 同上，建议命名 `grid-mutation-before.txt` / `-after.txt` | 改坏 `COMPENSATING` 分支：**改断言前那条网格用例是绿的，改后是红的** |

⚠️ **前两类的「before」只能在动手之前采**（Task 0、Task 1 Step 1），动完永远补不回来。

### B. 四条硬判据（spec §5，缺一不算过）

- [ ] **① 逃逸归零**
  `grep -rn "this\.prisma as any" src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers --include='*.ts' | grep -v '\.spec\.ts' | wc -l` → **`0`**
- [ ] **② 闸门能咬人** —— `gate-before.txt` 绿 vs `gate-after.txt` 红，两份都在物证目录
- [ ] **③ 网格断言能咬人** —— 变异前后两份输出都在物证目录，且「180 组确定性网格」那条用例由绿转红
- [ ] **④ 行为零变更** —— 两份 diff 为空

### C. 闸门（CLAUDE.md §7 随手闸；收尾闸本波按条件**全未触发**）

- [ ] ① `npx tsc --noEmit -p tsconfig.json` → `EXIT=0`
- [ ] ② `cd admin-web && npx tsc -b --noEmit` → `EXIT=0`（本波无前端改动，跑一遍确认没误伤）
- [ ] ③ `cd client-web && npx tsc -b --noEmit` → `EXIT=0`（同上）
- [ ] ④ `DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers` → **28 suites passed**（基线 29，Task 2 删掉 1 个孤儿 suite；tests 数比基线 555 少 2）
- [ ] ⑤ 起 preview 截图 → **未触发**（零前端改动）
- [ ] ⑥ `demo:all` 走通 → 已由判据④ 的两次实跑覆盖
- [ ] ⑦ `verify:coa` → **未触发**（未动钱）
- [ ] ⑧ 重铺闸 → **未触发**（未动 schema / seed / 迁移）

### D. 交付清单命中项（`rules/delivery-checklist.md`，20 行里命中 2 行）

- [ ] **本任务是多波中的一波** → 承接记录写进 `2026-09-19-act6-wave2-skeleton.md` 开头（Task 9 Step 5），**只写承接、不展开波二 spec**
- [ ] **每轮收尾** → `CHANGELOG` 一行（Task 9 Step 7）+ 回写总纲状态行（Task 9 Step 6）+ 按 `CLAUDE.md §9` 报一行文档层

> 其余 18 行**全未触发**，逐条确认过：持久状态变化 / 新审计码 / 新状态或结局 / 动了钱 / maker-checker / 新审批策略 / 新权限组 / 新 admin 端点 / 新业务动作 / 退役业务动作 / 改交易三域 / 新字段到客户面 / 涉及金额 / 对外识别 / 新事件 / 改 schema / 改页面或种子 / 改了前端。**未触发 ≠ 跳过**，是根本没碰到。

### E. 禁令复查（Global Constraints，评审逐条问）

- [ ] 全波 diff 里**零新增** `as any`：`git diff $(cat doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/BASELINE_SHA)..HEAD -- src/ | grep '^+' | grep -c 'as any'` → **`0`**
- [ ] 全波 diff 里**零新增**非空断言与 ts-ignore：`git diff $(cat doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/BASELINE_SHA)..HEAD -- src/ | grep '^+' | grep -cE '@ts-ignore|@ts-expect-error'` → **`0`**；`!` 断言人工扫一遍（无法用 grep 可靠区分逻辑非）
- [ ] **没有为了让测试通过而改测试断言**：`git diff $(cat doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/BASELINE_SHA)..HEAD -- '*.spec.ts'` 只应出现 Task 1（网格换真断言）与 Task 2（删文件）两处改动，**其余 spec 文件零改动**；若 Task 4-8 改过任何 mock 造型，须逐处说明「改的是造型不是断言」
- [ ] **零行为变更**自述：全波 diff 里没有删 schema 列、没有改 UI、没有动业务分支、没有新增/退役状态与边

### F. 新发现的去处（本波预期会产出，别漏登记）

- [ ] Task 6 Step 6 那行 BACKLOG（跨钱包合成案件 `walletRef` 为空时不能记定性/开单）已写入 `doc-final/BACKLOG.md` §G
- [ ] Task 5 Step 3 若连带暴露快照字段问题 → 已按「停手记 BACKLOG 回主会话」处理，**没有顺手改业务**
- [ ] 其余执行中发现的新事实 → 已进波二骨架的「承接上一波」节
