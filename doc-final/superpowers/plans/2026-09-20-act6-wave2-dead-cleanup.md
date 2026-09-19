# 第六幕清残留 · 波二「清死物」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 红 3 甲案写入在途行真实时间 + 删 11 根死列 + 死导出清理 + 幽灵筛选项摘除 + 运营收权限，并给对账写行装上「断言落库载荷形状」的防线。

**Architecture:** 六件独立清理，无业务重构。写侧走 TDD（matcher 层 + run 层两测即防线本体），读侧 TDD（query 层两测），删列走 schema 迁移 + reset 重铺，权限走三件套。收尾统一在 self 栈上重铺、走查、截图。

**Tech Stack:** NestJS + Prisma(SQLite) / React admin-web / jest(mock 式) / demo-shot.js 截图 / scripts/stack.sh 栈管理

**Spec:** `doc-final/superpowers/specs/2026-09-20-act6-wave2-dead-cleanup-design.md`（总纲：`2026-09-19-act6-recon-cleanup-charter.md`）

## Global Constraints

- **CLAUDE.md §0–§5 要点**：演示系统，不做技术兜底（幂等/去重/重试/并发锁/权限加固/防御性校验/性能优化）；操作必留痕；门不可绕；各管各的；状态只能沿边走；钱动必过账；对外用业务键。数据随时可重铺，**禁止 backfill / 兼容层**。
- **本波授权边界**（spec §0）：只做六件清理；不重构结构（波三）、不动前端拆分（波四）、不动业务日（波五）、不给事故表单补输入框、External Balances 默认日零代码。
- **每行改动追得到来源**：diff 里每行对应 spec §2 六任务之一或其必需配套；别人留下的死码只提不删（本波名单内的除外）。
- **禁新逃逸**：修改处不许新增 `as any` / `!` / `@ts-ignore`（变异探针临时用、当步还原的除外）。
- **测试的绿必须来自行为**：禁扫源码文本断言、禁「返回类型即断言集合」与「mock 原样回显」两种恒真形态。
- **环境**：本机默认 node18，若 `node -v` 非 v20，先 `export PATH="$HOME/.nvm/versions/node/$(ls ~/.nvm/versions/node | grep '^v20' | tail -1)/bin:$PATH"`。zsh 下管道退出码用 `${pipestatus[1]}`，或不走管道。
- **worktree 隔离**：一会话一 worktree（`.claude/worktrees/act6-wave2/`）一分支一 self 栈；jest 一律带本树 self 库 `DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db"`（树名连字符归一下划线）。绝不碰 main 栈端口。
- **派发分层**（CLAUDE.md §6 表）：任务执行与任务级 review → `sonnet`；纯机械批量 → `haiku`；终审不降档（派发省略 model 字段走继承）。本波不动钱不动状态机，无升档点名。
- **闸命令**：① `npx tsc --noEmit -p tsconfig.json` ② `cd admin-web && npx tsc -b --noEmit` ③ `cd client-web && npx tsc -b --noEmit`；jest 三域 = `DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers`。
- **与 spec 的一处顺序偏差（有意）**：spec §2 说「T6 键集合断言须在 T2 删列之后定稿」——实测在途 create 载荷从不含任何死列（载荷 12 键与死列零交集），白名单与 schema 删列无耦合，故防线测试并入 Task 1 做 TDD。收尾记录里说明这条。

---

### Task 0: 开工——worktree、依赖、self 栈、基线 SHA

**Files:**
- Create: `doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence/BASELINE_SHA`

**Interfaces:**
- Consumes: main HEAD（≥ `202c7164`，含 spec 与总纲订正）
- Produces: worktree `.claude/worktrees/act6-wave2/`、分支 `act6-wave2-dead-cleanup`、self 栈库 `/tmp/exchange_js_wt_act6_wave2/dev.db`、物证目录与基线 SHA——后续所有任务在此树内执行

- [ ] **Step 1: 建 worktree 与分支**（用 superpowers:using-git-worktrees 惯例）

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
git worktree add .claude/worktrees/act6-wave2 -b act6-wave2-dead-cleanup main
cd .claude/worktrees/act6-wave2
```

- [ ] **Step 2: 装依赖 + prisma client**（首启撞旧 client 判例）

```bash
npm install
(cd admin-web && npm install)
(cd client-web && npm install)
npx prisma generate
```

- [ ] **Step 3: 起 self 栈并重铺（给 jest 与后续走查一个当前 schema 的库）**

```bash
bash scripts/stack.sh reset self
bash scripts/stack.sh status
cat .stackports
```

Expected: 本树四端口就位，`/tmp/exchange_js_wt_act6_wave2/dev.db` 存在。记下 `.stackports` 里 API 与 admin 两个端口（Task 8 截图用）。

- [ ] **Step 4: 基线全绿确认 + 钉 SHA**

```bash
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
(cd admin-web && npx tsc -b --noEmit); echo "EXIT=$?"
(cd client-web && npx tsc -b --noEmit); echo "EXIT=$?"
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
mkdir -p doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence
git rev-parse HEAD > doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence/BASELINE_SHA
```

Expected: 三闸 EXIT=0；jest 28 suites / 553 tests 全绿（波一收官数）。数字对不上先停，回主会话。

- [ ] **Step 5: Commit**

```bash
git add doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence/BASELINE_SHA
git commit -m "chore(波二开工): 物证目录与基线 SHA"
```

---

### Task 1: 红 3 写侧（TDD）——matcher 携带 + create 落列 + 防线两测

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts`（`InTransitMatch` 接口 :120-128、`take()` push :299-303）
- Modify: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts`（在途 create 块 :895-912 一带，`matchStatus: 'IN_TRANSIT'` 那个）
- Test: `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.spec.ts`（third pass describe，:356 起）
- Test: `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts`

**Interfaces:**
- Consumes: `extLine(direction, amount, externalRef, datetime?)` 夹具（matcher spec :66）；`makeDeps(overrides)` 工厂与「wallet has flow orphan_internal」测试模板（run spec :196-238）
- Produces: `InTransitMatch.externalTimestamp: Date`（Task 2 读端依赖该列有真值；Task 7 变异实证依赖这两条测试）

- [ ] **Step 1: matcher 层失败测试**——加进 `describe('third pass: in-transit matching')`：

```ts
it('third pass: in-transit entry carries the external line timestamp (红3甲·防线上半)', async () => {
  const at = new Date('2026-06-25T16:00:00Z');
  const fundsOrderService = {
    findNonTerminalByWallet: jest.fn().mockResolvedValue([
      {
        id: 'fo-ts', fundsOrderNo: 'FO-TS', status: 'CONFIRMING', direction: 'IN',
        amount: D(100), netAmount: D(100),
        txHash: '0xts', referenceNo: null, providerTxnId: null, createdAt: at,
      },
    ]),
  };
  const matcher = makeMatcherWithFundsOrders(fundsOrderService);
  const res = await matcher.matchFlows({ walletRef: 'W1', externalLines: [extLine('IN', 100, '0xts', at)], cutoff: now, decimals: 0 });
  expect(res.inTransit).toHaveLength(1);
  expect(res.inTransit[0].externalTimestamp).toEqual(at);
});
```

- [ ] **Step 2: 跑它确认失败**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.spec.ts
```

Expected: FAIL——ts-jest 编译期报 `externalTimestamp` 不在 `InTransitMatch` 上（TS2339），或运行期 undefined ≠ Date。两种红都算数。

- [ ] **Step 3: 实现携带**——`wallet-flow-matcher.service.ts` 两处：

接口（:120-128）加一行：

```ts
export interface InTransitMatch {
  externalLineId: string;
  fundsOrderId: string;
  fundsOrderNo: string;
  orderStatus: string;
  amount: string;
  direction: 'IN' | 'OUT';
  externalRef: string | null;
  externalTimestamp: Date;
}
```

`take()`（:299-303）push 对象加 `externalTimestamp: ext.datetime`：

```ts
      const take = (ext: ExternalStatementLineInput, c: (typeof candidates)[number]) => {
        usedOrders.add(c.id); usedExternal.add(ext.id);
        inTransit.push({ externalLineId: ext.id, fundsOrderId: c.id, fundsOrderNo: c.fundsOrderNo,
          orderStatus: c.status, amount: extMinor(ext.amount).toString(),
          direction: ext.direction as 'IN' | 'OUT', externalRef: ext.externalRef,
          externalTimestamp: ext.datetime });
      };
```

- [ ] **Step 4: matcher spec 复绿**（同 Step 2 命令）。既有 third-pass 用例的 inTransit 夹具若因新必填字段编译红，属预期涟漪：那些用例只断言长度与单号，不用补断言，编译红只会出现在**自建 `InTransitMatch` 字面量**处（本 suite 没有——它断言 matcher 输出，不手造该类型）。若 run spec 出现编译红先放着，Step 5 一并处理。

- [ ] **Step 5: run 层失败测试（防线本体）**——加进 `wallet-recon-run.service.spec.ts`，模板照 :196 「orphan_internal」那条：

```ts
it('in-transit line item payload: externalTimestamp 透传 + 键集合逐键相等（红3甲·写行防线）', async () => {
  const deps = makeDeps();
  deps.prisma.reconciliationRun.create.mockResolvedValue({ id: 'run-7', runNo: 'RUN-WALLET-7' });
  deps.prisma.externalBalance.findMany.mockResolvedValue([
    { walletRef: 'w-cust-7', closingBalance: D(100), book: 'CLIENT', currency: 'USDT', accountRef: 'acc-7' },
  ]);
  deps.balanceChecker.checkBalance.mockResolvedValue({
    pass: false, walletRef: 'w-cust-7', walletKind: 'CUSTOMER',
    coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'c-007',
    internal: { total: 0n }, external: 100n, delta: 100n,
  });
  const at = new Date('2026-06-25T16:00:00Z');
  deps.flowMatcher.matchFlows.mockResolvedValue({
    matched: [], orphanInternal: [], orphanExternal: [], mismatch: [],
    inTransit: [{
      externalLineId: 'ext-7', fundsOrderId: 'fo7', fundsOrderNo: 'FO-7',
      orderStatus: 'CONFIRMING', amount: '100', direction: 'IN',
      externalRef: '0xabc', externalTimestamp: at,
    }],
  });

  const svc = new WalletReconRunService(deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any, deps.auditLogs as any, deps.explainedDifferences as any);
  (svc as any).computeInternalIdentity = jest.fn().mockResolvedValue({ balanced: true, breaks: [] });
  (svc as any).resolveAssetId = jest.fn().mockResolvedValue('a-usdt');

  const result = await svc.run({ cutoff });

  expect(result.casesOpened).toBeGreaterThanOrEqual(1);
  const payload = deps.prisma.reconciliationLineItem.create.mock.calls
    .map(([arg]: any[]) => arg.data)
    .find((d: any) => d.matchStatus === 'IN_TRANSIT');
  expect(payload).toBeDefined();
  // 值断言：写库载荷的时间 = 上游外部行时间（不是 mock 回显——mock 只当捕获器，值是生产代码算的）
  expect(payload.externalTimestamp).toEqual(at);
  // 形状断言：多写一键、少写一键都红——这是「省略可选字段」类缺陷的唯一防线（闸①不咬）
  expect(Object.keys(payload).sort()).toEqual([
    'caseId', 'externalAmount', 'externalDirection', 'externalRef', 'externalTimestamp',
    'externalTxId', 'foundByRunId', 'internalSourceId', 'internalSourceNo',
    'internalSourceType', 'lineNo', 'matchStatus', 'walletRef',
  ]);
});
```

说明：delta=100n 与在途 +100 若符号相消则桶为 IN_TRANSIT，若同号则残差≠0 桶为 BREAK——**两种桶都开案、都写在途行**（`writeLineItems` 对 `matcherResult.inTransit` 无条件写），断言不依赖符号约定。

- [ ] **Step 6: 跑它确认失败**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts
```

Expected: FAIL——`payload.externalTimestamp` 为 undefined（键集合断言也红，少一键）。

- [ ] **Step 7: 实现落列**——`wallet-recon-run.service.ts` 在途 create 块（现于 :895-912，`for (const it of matcherResult.inTransit)` 内）加一行：

```ts
      await this.prisma.reconciliationLineItem.create({
        data: {
          caseId,
          foundByRunId: runId,
          lineNo,
          matchStatus: 'IN_TRANSIT',
          internalSourceType: 'FUNDS_ORDER',
          internalSourceId: it.fundsOrderId,
          internalSourceNo: it.fundsOrderNo,
          externalTxId: it.externalLineId,
          externalAmount: new Prisma.Decimal(it.amount),
          externalDirection: it.direction,
          externalTimestamp: it.externalTimestamp,
          walletRef,
          externalRef: it.externalRef,
        },
      });
```

- [ ] **Step 8: 两 suite 复绿 + 闸①**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.spec.ts src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
```

Expected: 全 PASS；EXIT=0。

- [ ] **Step 9: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.spec.ts src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts
git commit -m "feat(红3甲·写侧): 匹配器携带外部行真实时间落库 + 写行防线两测(值透传+键集合白名单)"
```

---

### Task 2: 红 3 读端（TDD）——去 epoch 兜底、如实下发 null、类型涟漪

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts:703`
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts:134`（`FlowComparisonExternalSide.timestamp`）
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx:84`（页内 `FlowExternalSide.timestamp` 类型）
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts`（IN_TRANSIT 夹具在 :750-756）

**Interfaces:**
- Consumes: Task 1 落的 `ReconciliationLineItem.externalTimestamp` 真值
- Produces: `FlowComparisonExternalSide.timestamp: string | null`（在途行有真 ISO 串；无值如实 null，前端落既有 `'—'` 分支 :1467）

- [ ] **Step 1: 两条失败测试**——在 :795 那条 IN_TRANSIT 用例附近加：

```ts
it('IN_TRANSIT line item 带 externalTimestamp → 下发真实 ISO 串（红3甲·读端）', async () => {
  const at = new Date('2026-06-25T16:00:00Z');
  const prisma = mkPrismaCase({
    bucket: 'IN_TRANSIT',
    lineItems: [{
      id: 'li-ts', matchStatus: 'IN_TRANSIT', externalDirection: 'IN',
      externalAmount: new Prisma.Decimal(200), internalSourceNo: 'FO-2026-000123',
      foundByRunId: 'run-last', externalTimestamp: at,
    }],
  });
  const svc = mkSvc(prisma);
  const result = await svc.getCase('RC-1');
  const row = result.flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT');
  expect(row.externalLine.timestamp).toBe('2026-06-25T16:00:00.000Z');
});

it('IN_TRANSIT line item 无 externalTimestamp → 下发 null 而非 epoch（红3甲·读端）', async () => {
  const prisma = mkPrismaCase({ bucket: 'IN_TRANSIT' }); // 既有夹具 li-1 不带 externalTimestamp
  const svc = mkSvc(prisma);
  const result = await svc.getCase('RC-1');
  const row = result.flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT');
  expect(row.externalLine.timestamp).toBeNull();
});
```

注意：`mkPrismaCase` / 服务构造照该文件 :795 那条用例现有写法（若辅助函数名不同，以文件内实际为准，测试意图不变——两处断言分别钉「真值透传」与「无值给 null」）。

- [ ] **Step 2: 跑确认两条都红**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
```

Expected: 第一条红（夹具没这个字段前编译可能先红——先写实现里的类型再回来跑也行，顺序不强求，但**必须留下红过的证据输出**）；第二条红在 `null ≠ '1970-01-01T00:00:00.000Z'`。

- [ ] **Step 3: 实现**——三处：

`reconciliation-query.service.ts:703`：

```ts
          timestamp: li.externalTimestamp ? li.externalTimestamp.toISOString() : null,
```

`reconciliation.dto.ts:134`：

```ts
  timestamp: string | null;        // ISO；在途行无外部时间时如实 null（红3甲，2026-09-20）
```

`ReconciliationCasesDetailPage.tsx:84`（只改 `FlowExternalSide`，`FlowInternalSide` 不动）：

```ts
  timestamp: string | null;
```

- [ ] **Step 4: 复绿 + 三闸**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
(cd admin-web && npx tsc -b --noEmit); echo "EXIT=$?"
```

Expected: 全 PASS、两闸 EXIT=0。页面 :304 `?? null` 与 :1467 三元、排序 `rowTimestamp()` 均已 null 安全，闸② 是证明。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts admin-web/src/pages/ReconciliationCasesDetailPage.tsx
git commit -m "feat(红3甲·读端): 在途行时间如实下发(真值ISO/无值null),epoch兜底退役;DTO与页内类型放宽为可空"
```

---

### Task 3: 删 11 根死列 + Incident.walletRef 恒空管线整删 + 迁移

**Files:**
- Modify: `prisma/schema.prisma`（11 行：:1498 / :1544 / :1545 / :1547 / :1559 / :1740 / :1744 / :1774 / Incident 块内 `sourceExternalLineId`·`walletRef`·`customerId` 三行，约 :1647-1650）
- Modify: `src/modules/governance/incidents/dto/incident.dto.ts:22`、`incident.constants.ts:65`、`incident.service.ts:74-79 与 :97 与 :166`
- Modify: `admin-web/src/pages/IncidentDetailPage.tsx:3 / :56 / :271`
- Modify: `src/modules/governance/incidents/incident.service.spec.ts`（:520 / :544 夹具，:563-577 整测删除）
- Create: `prisma/migrations/<时间戳>_act6_wave2_drop_dead_columns/`

**Interfaces:**
- Consumes: spec §1.1 名单（11 根，已三侧重扫钉死）
- Produces: schema 无死列；事故视图不再含 `walletNo` 字段——Task 8 重铺闸与 Task 1 的键集合白名单不受影响（在途载荷从不含死列）

- [ ] **Step 1: 落刀前逐根复核（判死先验尸，两种形态）**

```bash
for f in reimbursementObligationId internalTxHash externalSource externalTxHash resolutionMemo statementId rawRef; do
  echo "== $f =="; grep -rwn "$f" src admin-web/src scripts test --include='*.ts' --include='*.tsx' | grep -v '\.spec\.ts' | wc -l
  grep -rn "select.*$f\|include.*$f" src --include='*.ts' | wc -l
done
grep -rwn "customerId\|walletRef\|sourceExternalLineId" src/modules/governance/incidents --include='*.ts' | grep -v '\.spec\.ts'
```

Expected: 前 7 个名字两种搜法都 0（`statementId`/`rawRef` 若有命中必须逐条看——预期 0）；Incident 域内只剩 `walletRef` 管线那几行（dto:22 / constants:65 / service:77-79,:166）。**任何一根对不上预期 → 停刀，回主会话。**

- [ ] **Step 2: schema 删 11 行**——逐模型删以下字段行（行号会漂，按「模型 + 字段名」定位）：

| 模型 | 删的行 |
|---|---|
| `ReconciliationCase` | `reimbursementObligationId String?` |
| `ReconciliationLineItem` | `internalTxHash String?`、`externalSource String?`、`externalTxHash String?`、`resolutionMemo String?` |
| `ExternalBalance` | `statementId String? @map("statement_id") …`、`rawRef String? @map("raw_ref")` |
| `ExternalStatementLine` | `statementId String? @map("statement_id")` |
| `Incident` | `sourceExternalLineId String? …`、`walletRef String?`、`customerId String?` |

不许动这些模型的其它行（`externalTimestamp` **保留**——它已是活列）。

- [ ] **Step 3: Incident.walletRef 管线五处删**：

`dto/incident.dto.ts:22` 删整行 `@ApiPropertyOptional() @IsOptional() @IsString() walletRef?: string;`

`incident.constants.ts:65` 删整行 `walletRef?: string;`

`incident.service.ts` getView（:74-79）：`Promise.all` 三元变两元，删 wallet 查询与两行注释：

```ts
    const [notes, remediations] = await Promise.all([
      this.prisma.incidentNote.findMany({ where: { incidentId: row.id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.incidentRemediation.findMany({ where: { incidentId: row.id }, orderBy: { createdAt: 'asc' } }),
    ]);
```

`incident.service.ts:97` 视图对象删 `walletNo: wallet?.walletNo ?? null,`

`incident.service.ts:166` 写点删 `walletRef: dto.walletRef ?? null,`

`IncidentDetailPage.tsx`：:56 删 `walletNo: string | null;`，:271 删 `{detail.walletNo && <InfoField label="Wallet" value={detail.walletNo} mono />}`，:3 头注释改为：

```tsx
// 铁律⑥：后端投影全走业务键、零 UUID。（walletRef 恒空管线已于波二退役——表单从无输入框。）
```

- [ ] **Step 4: 清事故 spec**——`incident.service.spec.ts`：:520 与 :544 夹具行删去 `walletRef: null, ` 一个键；:563-577 那条「walletRef → walletNo 翻译」测试整条删除（它测的行为已退役）。再扫尾：

```bash
grep -rn "walletRef\|walletNo" src/modules/governance/incidents admin-web/src/pages/IncidentDetailPage.tsx admin-web/src/pages/IncidentsListPage.tsx 2>/dev/null
```

Expected: 0 命中（或仅剩与事故无关的假命中，逐条确认后放行）。

- [ ] **Step 5: 出迁移 + 重生成 client**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx prisma migrate dev --name act6_wave2_drop_dead_columns
npx prisma generate
```

Expected: 新迁移目录生成、self 库应用成功（11 根全是无关系无索引的可空标量，SQLite 直接 DROP）。

- [ ] **Step 6: 三闸 + jest 三域全绿**

```bash
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
(cd admin-web && npx tsc -b --noEmit); echo "EXIT=$?"
(cd client-web && npx tsc -b --noEmit); echo "EXIT=$?"
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
```

Expected: 全绿。若有 mock 夹具因删列类型收紧报红——就地删夹具里的死字段，**不许改断言**。

- [ ] **Step 7: 终态 grep（预期终态数量核对）**

```bash
grep -cw "reimbursementObligationId\|internalTxHash\|externalSource\|externalTxHash\|resolutionMemo\|statementId\|rawRef" prisma/schema.prisma
```

Expected: **0**（11 根在 schema 的声明全部消失；Incident 三根名字太通用，靠 Step 1 的域内 grep 已核）。

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/governance/incidents admin-web/src/pages/IncidentDetailPage.tsx
git commit -m "refactor(波二删死列): 11根死列出清(名单见spec§1.1)+Incident.walletRef恒空管线整删+迁移act6_wave2_drop_dead_columns"
```

---

### Task 4: 死导出 3 删 + 30 去 export（体检数 35，重扫实数 30，以重扫为准）

**Files:**
- Modify: 下表 13 个文件（只动 `export` 关键字与 3 行类型声明，函数体一行不动）

**Interfaces:**
- Consumes: spec §1.2；重扫脚本（下）
- Produces: 域外零消费者的符号不再出现在公共面上；闸①②③ 即复核（有活消费者被误摘，编译必红）

- [ ] **Step 1: 在 HEAD 复跑重扫（清单以此为准，Task 1 已加字段不影响——新测试不 import 这些名字）**

```bash
cat > /tmp/scan-exports-w2.sh <<'EOF'
#!/bin/bash
cd "$(git rev-parse --show-toplevel)"
dirs="src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers"
grep -rhoE "export (const|function|class|interface|type|enum) [A-Za-z0-9_]+" $dirs --include='*.ts' \
  | awk '{print $3}' | sort -u | while read sym; do
  files=$(grep -rlE "export (const|function|class|interface|type|enum) $sym\b" $dirs --include='*.ts')
  refs=$(grep -rlw "$sym" src admin-web/src --include='*.ts' --include='*.tsx' | grep -vxF "$files" | wc -l | tr -d ' ')
  if [ "$refs" -eq 0 ]; then
    selfuse=$(grep -h "$sym" $files 2>/dev/null | grep -vcE "export (const|function|class|interface|type|enum) $sym\b")
    echo "$sym | selfuse=$selfuse | $(echo "$files" | head -1)"
  fi
done
EOF
bash /tmp/scan-exports-w2.sh | tee doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence/export-scan.txt
```

Expected: 33 行 = 3 个 `selfuse=0`（彻底死）+ 30 个 `selfuse≥1`（去 export）。与 2026-09-20 spec 落笔时名单比对，多退少补以本次输出为准，差异记进收尾记录。

- [ ] **Step 2: 删 3 个彻底死声明**（`selfuse=0`）：

- `src/modules/asset-treasury/internal-transfers/dto/internal-transfer.dto.ts:17` 整行 `export type InternalTransferFailureReason = …`
- `src/modules/clearing-settle/reconciliation/constants/adjustment-transitions.constant.ts:10` 整行 `export type AdjustmentStatusValue = …`
- `src/modules/governance/incidents/incident.constants.ts:22` 整行 `export type IncidentStatusType = …`

- [ ] **Step 3: 30 个符号去 `export` 关键字**（声明行行首 `export ` 七个字符删掉，其余不动）。2026-09-20 名单（按文件）：

| 文件 | 符号 |
|---|---|
| `engine/v2/wallet-flow-matcher.service.ts` | `AmountMismatch` `InTransitMatch` `MatchedPair` `MatcherInput` `MatcherResult` `OrphanExternal` `OrphanInternal` |
| `workflow/wallet-recon-run.service.ts` | `CaseSeverity` `WalletReconRunInput` `WalletReconRunResult` |
| `dto/reconciliation.dto.ts` | `FlowComparisonExternalSide` `FlowComparisonInternalSide` `FlowComparisonMatchType` |
| `disposition/cause-registry.ts` | `CauseSpec` `WriteOffFacts` |
| `disposition/funding-next-step.ts` | `FundingFacts` `FundingNextStep` `FundingTransferRef` |
| `projector/account-flow-projector.service.ts` | `EvidenceLike` |
| `disposition/push-order.service.ts` | `ManualPushEvidence` |
| `disposition/receipt-lookup.service.ts` | `ReceiptLookupResult` |
| `disposition/supplement-evidence.service.ts` | `SupplementKind` |
| `engine/v2/wallet-balance-checker.service.ts` | `WalletKind` |
| `simulation/simulated-custodian-statement.service.ts` | `LegMovementInput` |
| `asset-treasury/internal-transfers/dto/internal-transfer.dto.ts` | `INTERNAL_TRANSFER_PURPOSES` `InternalTransferLegView` `InternalTransferPurpose` |
| `governance/incidents/incident.constants.ts` | `IncidentEscalationTarget` `IncidentRemediationKind` `IncidentType` |

- [ ] **Step 4: 三闸 + jest 三域**

```bash
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
(cd admin-web && npx tsc -b --noEmit); echo "EXIT=$?"
(cd client-web && npx tsc -b --noEmit); echo "EXIT=$?"
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
```

Expected: 全绿。任何一处红 = 该符号有消费者，把它加回 export 并从名单剔除、记收尾记录；**不许为过闸删使用方**。

- [ ] **Step 5: Commit**

```bash
git add -A src/modules doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence/export-scan.txt
git commit -m "refactor(波二死导出): 3个零消费者类型删声明+30个符号去export保函数体(重扫物证export-scan.txt,体检35实测30)"
```

---

### Task 5: 幽灵筛选项摘除（纯前端 6 处）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesListPage.tsx`（:74 / :91 / :95 / :97 / :105 / :106）

**Interfaces:**
- Consumes: 后端案件两态事实（`OPEN`/`RESOLVED`）
- Produces: 筛选下拉只剩 Open / Resolved / All；截图物证在 Task 8 统一采（栈起来后）

- [ ] **Step 1: 六处编辑**——终态代码：

`STATUS_OPTIONS`（原 :71-76）删 `WAIVED` 行：

```ts
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'ALL', label: 'All' },
];
```

徽章色（原 :89-99，注意 :95 与 `OPEN` 同行、保 OPEN）与文案（原 :101-108）：

```ts
// Status badge palette: amber for OPEN (needs attention), green for RESOLVED
// (clean). Anything else falls back to neutral.
const statusBadgeClass = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'OPEN') return 'bg-amber-100 text-amber-800';
  if (s === 'RESOLVED') return 'bg-green-100 text-green-800';
  return 'bg-gray-100 text-gray-800';
};

const statusLabel = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'OPEN') return 'Open';
  if (s === 'RESOLVED') return 'Resolved';
  return status;
};
```

**不动** `GovernanceUi.tsx:15` 的 `WAIVED`——那是治理域自己的状态色表，非同款（spec §1.5）。

- [ ] **Step 2: 终态 grep + 闸②**

```bash
grep -c "WAIVED\|PENDING_RECHECK" admin-web/src/pages/ReconciliationCasesListPage.tsx
(cd admin-web && npx tsc -b --noEmit); echo "EXIT=$?"
```

Expected: grep 输出 **0**；EXIT=0。

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/ReconciliationCasesListPage.tsx
git commit -m "fix(波二幽灵筛选): 案件列表摘WAIVED与PENDING_RECHECK六处(后端两态从不产生,点了必空)"
```

---

### Task 6: 运营收 `INTERNAL_TRANSFER_READ` + 资金单关联链接条件渲染

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（OPS_OFFICER 块 :1108-1130）
- Modify: `admin-web/src/pages/FundsOrderDetail.tsx`（:353 后加判定；:547-561 与 :610-622 两个渲染点）

**Interfaces:**
- Consumes: `useAdminSession().hasPermission`（该文件 :184 已有）与 `PERMISSIONS.INTERNAL_TRANSFERS_READ`（`rbac/permissions.ts:83`，侧栏同款判据）
- Produces: catalog 里该权限组绑定 5 → 4（SENIOR_MANAGEMENT_OFFICER / INTERNAL_AUDITOR / CFO / TREASURY_OFFICER 保留）；运行时核验在 Task 8（重铺后 catalog 自然新种）

- [ ] **Step 1: catalog 摘一行 + 注释补记**——OPS_OFFICER 块删 `'INTERNAL_TRANSFER_READ',` 行，并把上方注释段的末句改为：

```ts
    // FUNDS_ORDER_VIEW（资金单只读，业主未点名，不动）。2026-09-19 业主补刀：INTERNAL_TRANSFER_READ
    // 同收（「他不需要知道」）——补齐两角色定案的漏网一组，剧本注③「运营只剩 Funds Orders」自此成立。
    'FUNDS_ORDER_VIEW',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
```

- [ ] **Step 2: 同款核对（预期终态数量）**

```bash
grep -c "'INTERNAL_TRANSFER_READ'" src/modules/identity/access-control/rbac.catalog.ts
```

Expected: 角色绑定处剩 **4**（加上 :57 联合类型、:435/:436 两条 route、:795 group 定义等非绑定命中，总数应为波前减 1——先跑波前数再对差值，差值必须恰为 1）。

- [ ] **Step 3: FundsOrderDetail 两渲染点条件化**——:353 后加：

```tsx
  const parent = resolveParent(data);
  // 波二（2026-09-19 业主定）：运营无划转读权——Internal transfer 的关联跳转按权限渲染，
  // 单号照显（业务键本就在资金单读面内），只收「点得到、点了被拒」的幽灵链接。
  const parentLinkAllowed =
    !parent || parent.kind !== 'Internal transfer' || hasPermission(PERMISSIONS.INTERNAL_TRANSFERS_READ);
```

渲染点一（:547-561）`onClick` 条件化——`LinkedRelationCard` 的 `onClick` 可选，不传即不可点：

```tsx
              <LinkedRelationCard
                cap={parent.kind}
                identifier={parent.no}
                statusValue={parent.status || undefined}
                meta={
                  data.legSeq != null && data.swapNo
                    ? `Leg ${data.legSeq}`
                    : undefined
                }
                onClick={parentLinkAllowed ? () => navigate(parent.route) : undefined}
              />
```

渲染点二（侧栏 :610-622）按钮降级为纯文本：

```tsx
            {parent && (
              <SidebarKV
                label={parent.kind}
                value={
                  parentLinkAllowed ? (
                    <button
                      onClick={() => navigate(parent.route)}
                      className="font-mono text-[11px] text-adm-amber underline-offset-2 hover:underline"
                    >
                      {parent.no}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px]">{parent.no}</span>
                  )
                }
              />
            )}
```

- [ ] **Step 4: 三闸**

```bash
npx tsc --noEmit -p tsconfig.json; echo "EXIT=$?"
(cd admin-web && npx tsc -b --noEmit); echo "EXIT=$?"
```

Expected: EXIT=0 两处。运行时核验（sync + 重启 + verify:rbac + ops 实登）统一在 Task 8——本任务的库还是旧 catalog，先跑必假红。

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts admin-web/src/pages/FundsOrderDetail.tsx
git commit -m "fix(波二收权限): OPS_OFFICER摘INTERNAL_TRANSFER_READ(业主2026-09-19定,补两角色定案漏网)+资金单划转关联链接按权限渲染防幽灵链接"
```

---

### Task 7: 防线变异实证（三向，红完即还原）

**Files:**
- Create: `doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence/mutation-{a,b,c}.txt`

**Interfaces:**
- Consumes: Task 1 两条防线测试
- Produces: spec §6 判据 7 的物证——三次「破坏被测行为 → 断言必红 → 还原复绿」

- [ ] **Step 1: 变异 A——matcher 不携带**：把 `take()` push 里 `externalTimestamp: ext.datetime` 一项临时删掉，跑 matcher spec：

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.spec.ts 2>&1 | tee doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence/mutation-a.txt; echo "EXIT=${pipestatus[1]}"
```

Expected: **红**（编译红 TS2741 缺必填字段，或断言红——都算）。`git checkout -- src/` 还原，复跑复绿。

- [ ] **Step 2: 变异 B——create 不落列**：把 Task 1 Step 7 加的 `externalTimestamp: it.externalTimestamp,` 一行临时删掉，跑 run spec 存 `mutation-b.txt`（命令同上、路径换 run spec）。Expected: **红**（值断言 undefined + 键集合少一键）。还原复绿。

- [ ] **Step 3: 变异 C——多写一键**：在途 create 的 `data` 里临时塞 `...( { bogusColumn: 1 } as any ),`（探针专用、当步还原，不算新逃逸），跑 run spec 存 `mutation-c.txt`。Expected: **红**（键集合多一键）。还原复绿。

- [ ] **Step 4: 终态确认树干净 + 全量 jest**

```bash
git status --short
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
```

Expected: 只剩 evidence 三个新文件未加；jest 全绿。

- [ ] **Step 5: Commit**

```bash
git add doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence
git commit -m "test(波二物证): 写行防线三向变异实证(不携带/不落列/多一键各红一次,还原复绿)"
```

---

### Task 8: 收尾闸——重铺、走查、五页截图、权限实登、EB 实证

**Files:**
- Create: `doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence/*.png` + `walkthrough.md`

**Interfaces:**
- Consumes: 前七个任务全部合入本分支；`.stackports` 的 API/admin 端口（下文 `$API`/`$ADM`）
- Produces: spec §6 判据 1-6、8 的全部物证

- [ ] **Step 1: 重铺闸（动了 schema 的必选序：reset → 等就绪 → demo:all → break）**

```bash
bash scripts/stack.sh reset self
bash scripts/stack.sh status
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self recon:demo:break
```

Expected: 对照 `doc-final/demo/baseline.md` 全绿（场景数 18、钱包数、案件数三组数字两边相等且 >0、无 BAD 断言）。旧库重跑必红——必须从 reset 起。

- [ ] **Step 2: verify:coa + verify:rbac**

```bash
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:rbac
```

Expected: 恒等式 + 负余额全绿；rbac 75 判据全绿（reset 已重种 catalog，含 Task 6 的摘除）。

- [ ] **Step 3: 五页截图**（先备好 `npm i --no-save puppeteer-core@24`；`$ADM`/`$API` 读自 `.stackports`；`E=doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence`）

```bash
node scripts/demo-shot.js --url http://localhost:$ADM/admin/reconciliation/runs --api http://127.0.0.1:$API --out $E/p1-runs.png
node scripts/demo-shot.js --url http://localhost:$ADM/admin/reconciliation/cases --api http://127.0.0.1:$API --out $E/p2-cases.png
node scripts/demo-shot.js --url http://localhost:$ADM/admin/reconciliation/cases --api http://127.0.0.1:$API --click "IN_TRANSIT" --wait 2500 --out $E/p3-case-detail-scene1.png
node scripts/demo-shot.js --url http://localhost:$ADM/admin/reconciliation/external-balances --api http://127.0.0.1:$API --out $E/p4-external-balances.png
node scripts/demo-shot.js --url http://localhost:$ADM/admin/reconciliation/adjustments --api http://127.0.0.1:$API --out $E/p5-adjustments.png
```

（p3 若 `--click "IN_TRANSIT"` 选不中行，改用列表里场景 1 案件的可见文本或直接走深链 URL——判据不变。）逐张人工核验并写进 `walkthrough.md`：**p3 在途行 Time 列显真实日期时间、非 `01-01 04:00`、在途行不再恒排最旧**；p2 筛选下拉无 Waived；全五页无 epoch、无恒空字段。

- [ ] **Step 4: External Balances 实证（划一笔、默认日不漂）**——按 `demo/script.md` 场景 16 的动作：金库（`treasury@fiatx.com` / 123456）开一张内部划转单 → CFO（`cfo@fiatx.com` / 123456）批准 → 金库提交第一腿（回单即落当日外部账单）。然后：

```bash
node scripts/demo-shot.js --url http://localhost:$ADM/admin/reconciliation/external-balances --api http://127.0.0.1:$API --out $E/p6-eb-after-transfer.png
```

Expected（记入 `walkthrough.md`）: 默认日仍 = 重铺当天；钱包行数 ≥ p4 时的行数。此即总纲订正后的判据——零代码，只实证。

- [ ] **Step 5: ops_officer 实登两张**

```bash
node scripts/demo-shot.js --url http://localhost:$ADM/admin/dashboard --api http://127.0.0.1:$API --as ops_officer@fiatx.com --password 123456 --out $E/p7-ops-sidebar.png
node scripts/demo-shot.js --url http://localhost:$ADM/admin/funds-orders --api http://127.0.0.1:$API --as ops_officer@fiatx.com --password 123456 --click "TRF" --wait 2500 --out $E/p8-ops-fundsorder-detail.png
```

Expected: p7 侧栏 Custody 组**无 Internal Transfers**；p8 打开 Step 4 那笔划转的腿单详情，Internal transfer 区**只有单号纯文本、无可点链接**（`--click "TRF"` 选不中就先在列表按单号定位，换 `--click "<该腿资金单号>"`）。

- [ ] **Step 6: 终局三闸 + jest 三域**（同 Task 4 Step 4 命令）。Expected: 全绿。

- [ ] **Step 7: Commit**

```bash
git add doc-final/superpowers/checkups/2026-09-20-act6-wave2-evidence
git commit -m "test(波二收尾物证): 重铺闸+verify:coa/rbac全绿,五页截图+场景1真实时间+EB划转实证+ops实登两张"
```

---

### Task 9: 文档收口 + 波三骨架 + 合并回 main

**Files:**
- Modify: `doc-final/CHANGELOG.md`、`doc-final/superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md`（状态行）
- Create: `doc-final/superpowers/specs/2026-09-20-act6-wave3-skeleton.md`

**Interfaces:**
- Consumes: Task 0-8 全部收官
- Produces: 波三新会话的承接输入；main 上干净的合并点

- [ ] **Step 1: modules 文档核对**（真相层不许与代码打架）：

```bash
grep -rn "externalTimestamp\|walletRef\|WAIVED\|PENDING_RECHECK\|INTERNAL_TRANSFER_READ" doc-final/modules/v8-recon.md doc-final/modules/ 2>/dev/null | grep -v archive | head -20
```

命中且与新现状矛盾的行就地订正（预期极少；成批的数字腐烂归波五，不展开）。

- [ ] **Step 2: CHANGELOG 一行 + 总纲状态行回写**——CHANGELOG 加一行（体例照上文既有行）：红 3 写入真实时间 / 11 死列出清 / 死导出与幽灵筛选摘净 / 运营收划转读权 / EB 劫持证伪零代码。总纲状态行「波二 spec 已立…」改「波二 **已完成**（2026-09-20，闸与物证一句话 + evidence 目录指针）」。

- [ ] **Step 3: 立波三骨架 + 承接**——新文件 `2026-09-20-act6-wave3-skeleton.md`，体例照被删的波二骨架（总纲链接 / 「承接上一波」只写实际偏差、执行中新事实、波三前提有无变化 / 已定事实 / 待定岔口）。**只写承接，不展开波三 spec**。波三已知输入（照总纲 §3 波三行）：Case 主体服务 + 显式迁移表、拆三大方法、铁律③ 直写一处、`dispositionsFor()` 六格硬边界、两个重复 helper；承接里必须带上：写行防线已就位（键集合白名单在 run spec，波三动 `writeLineItems` 结构时它会咬）、死列已清（波三重构不会再见到它们）、export 面已收窄（波三抽 helper 时新导出要有消费者才 export）。

- [ ] **Step 4: 按 `rules/delivery-checklist.md` 收尾对照**——逐行过一遍触发行（改 schema ✓ 迁移+重铺闸；改前端 ✓ 截图；权限 ✓ 三件套；多波 ✓ 承接），缺项当场补。

- [ ] **Step 5: Commit + 合并**（用 superpowers:finishing-a-development-branch）：

```bash
git add doc-final
git commit -m "docs(波二收尾): CHANGELOG一行+总纲状态行回写+波三骨架与承接"
cd /Users/songshengwei/Documents/Project/fiatx.com
git merge --no-ff act6-wave2-dead-cleanup
```

- [ ] **Step 6: 合并后主栈必做**（§10：动过 schema）：

```bash
bash scripts/stack.sh reset main
bash scripts/stack.sh status
```

Expected: main 栈从零重铺全绿（含新迁移与新 catalog；reset 已覆盖 db:base:sync + 重启的效果）。

- [ ] **Step 7: 清 worktree + 分支**

```bash
git worktree remove .claude/worktrees/act6-wave2
git branch -d act6-wave2-dead-cleanup
bash scripts/stack.sh status
```

Expected: 树与分支清净；self 栈随树退役（若 status 仍列残留端口，`stack.sh down` 对应栈）。

---

## 自审记录（写完当日）

1. **Spec 覆盖**：§2 六任务 → Task 1+2（T1 红3 写读两侧）/ Task 3（T2）/ Task 4（T3）/ Task 5（T4）/ Task 6（T5）/ Task 1 内含（T6 防线，偏差已在 Global Constraints 声明）；§4 划掉项 → Task 8 Step 4 实证；§6 八判据 → 判据 1-2（Task 3/8）、3（Task 1/8）、4（Task 5/8）、5（Task 6/8）、6（Task 8）、7（Task 7）、8（Task 8）。无缺口。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤给了终态代码或精确删改坐标。
3. **类型一致性**：`externalTimestamp: Date`（接口）→ create 载荷 → 读端 `string | null`，三处命名一致；键集合白名单 13 键与 Task 1 Step 7 的 create 块逐键对得上。
