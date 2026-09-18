# 第七幕波一 · 证据链修复 + 业务键换装 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec：`doc-final/superpowers/specs/2026-09-15-act7-wave1-evidence-chain-business-keys-design.md` ｜ 总纲：`2026-09-15-act7-audit-campaign-charter.md`
> 执行前先起 worktree（superpowers:using-git-worktrees，放 `.claude/worktrees/act7-wave1/`）；子代理 prompt 必须带 CLAUDE.md §0–§5 要点；任务执行与任务级评审派 `sonnet`。

**Goal:** 证据包对真实充值/提现单产出非空证据链；审计域自身零内部 UUID 落屏与落 URL。

**Architecture:** 三域快照 builder 改「业务号直查真实表」+ 幽灵段整段退役（含恒空输出键与链装配助手）；两详情端点/路由换 `eventNo`/`packageNo`（RBAC 权限码连动）；前端四页收 UUID（stripInternalIds 乙案）+ 证据包背书渲染。**对 spec 的一处简化**：deposit/withdraw 无跨表联动，不设独立 resolver 函数、主查询直接按业务号 where（swap 保持两步因 quote 联动）——达成同一目标，少两层仪式。

**Tech Stack:** NestJS + Prisma（后端）｜ React + vite（admin-web）｜ jest（后端单测；admin-web 无组件测试，判例在案）。

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：权限码随路径参数名连动（catalog / 前端权限表 / 合并后 `db:base:sync`+重启）；下载文件保持全量、只滤屏上渲染；不新增快照段
- 演示系统：禁做幂等/并发/重试/防御/性能（CLAUDE.md §2）；铁律①留痕、⑥业务键。

## 收尾过哪几条（plan 写死，执行者不得自行增删）

对 `rules/delivery-checklist.md` 逐行核过（2026-09-15 计划期），本波**命中 6 行**：

| 命中行 | 落在哪 |
|---|---|
| 改了前端 → preview 截图（永不豁免①） | Task 5/6/7 各预览步 + Task 8 四页截图落盘 |
| 新增/变更 admin 端点 → catalog 登记 + `db:base:sync` + 重启 | Task 4 改 route() + Task 8 合并注意 |
| 对外识别 → 业务键、不暴露 UUID | 本波主题（Task 4/5/6） |
| 改了交易三域任一 → 问另外两域 | 三域快照 Task 1/2/3 同改，对称内建 |
| 多波中的一波 → 承接写进下一波 spec 开头 | Task 8 波二骨架 |
| 每轮收尾 → 文档分层收口 + CHANGELOG 一行 + BACKLOG 销账 | Task 8（CHANGELOG 随合并写；收尾报告按 CLAUDE.md §9 报层） |

**判定留痕**：「改页面 → 同步 demo/data.md + script.md」字面触发但不成立——script.md 不引用 URL/字段级细节，data.md 不涉种子；证据包新演示步骤系业主 2026-09-15 拍板**归波三剧本收口**（总纲波三第 7 项），本波只预演不改文。其余各行（新审计码/新状态/动钱+verify:coa/新审批策略/新权限组/新业务动作/客户面/金额/新事件/schema）**未触发**：本波零新码、零新状态边、不动钱、零 schema、零客户面改动。
- 本波**不动 schema / seed**；不动写入面 subjects；不动筛选与深链。
- Node 20：每条命令前置 `PATH="$(ls -d ~/.nvm/versions/node/v20*/bin | tail -1):$PATH"`；jest 必须在 `Exchange_js/` 根下跑（缺 DATABASE_URL 假红判例）。
- 报错/断言禁止管道吞码（zsh 用 `${pipestatus[1]}` 或不走管道）。
- UI 文案一律英文。
- 权限码三处连动铁则：`rbac.catalog.ts` 路由参数名改 → 权限码字符串变 → 前端 `permissions.ts` 同步 → **合并 main 后必须重启后端 + `npm run db:base:sync`**（Task 8 收尾注意）。
- 每任务收尾跑随手闸：`npx tsc --noEmit -p tsconfig.json`；动了 admin-web 加 `cd admin-web && npx tsc -b --noEmit`。

---

### Task 1: deposit 证据链修通 + 幽灵段退役（测试先红后绿）

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.service.ts`（接口 :71-93、`buildDepositSnapshots` :1342-1597、`buildDepositEvidenceChain` 助手整删）
- Test: `src/modules/audit-logging/audit-logs.service.spec.ts`（deposit describe :584-806）

**Interfaces:**
- Produces: 精简后的 `DepositEvidenceChainItem { depositId; depositNo }`、`DepositEvidenceSnapshots { deposits; depositEvidenceChain }`；spec 文件顶层共享助手 `mockFindManyByWhere(rows)`（Task 2/3 复用）。

- [ ] **Step 1: 写行为化 mock 助手 + 反转 deposit 测试（先证明假绿）**

在 `audit-logs.service.spec.ts` 顶层（describe 之外）加：

```ts
/** 行为化 findMany mock：按 where 的 {field:{in:[...]}}、等值与 {OR:[...]} 真过滤——
 * 杜绝"mock 无视 where 直接吐行"的假绿（波一测试反转，2026-09-15）。 */
const mockFindManyByWhere = (rows: any[]) =>
  jest.fn(async (args: any = {}) => {
    const matches = (row: any, where: any): boolean => {
      if (!where) return true;
      if (Array.isArray(where.OR)) return where.OR.some((w: any) => matches(row, w));
      return Object.entries(where).every(([field, cond]: [string, any]) =>
        cond && typeof cond === 'object' && Array.isArray(cond.in)
          ? cond.in.includes(row[field])
          : row[field] === cond,
      );
    };
    return rows.filter((row) => matches(row, args.where));
  });
```

改写 `'should build full deposit evidence snapshots and chain for export packages'`（:584 起）：
- `prisma.depositTransaction.findMany.mockResolvedValue([...])` 换成 `prisma.depositTransaction.findMany = mockFindManyByWhere([<原 dep-1 行，保留 id:'dep-1' 与 depositNo:'DEP2603240001'>])`
- **删掉**该用例里 `prisma.kytCase/travelRuleCase/workflowDecisionRecord/...` 的所有幽灵 mock 与相应断言
- 新断言：

```ts
const body: any = artifacts.packageBody;
expect(body.snapshots.deposits).toHaveLength(1);
expect(body.snapshots.deposits[0].depositNo).toBe('DEP2603240001');
expect(body.snapshots.depositEvidenceChain).toEqual([
  { depositId: 'dep-1', depositNo: 'DEP2603240001' },
]);
for (const ghost of ['kytCases', 'travelRuleCases', 'riskDecisionRecords', 'alerts', 'cases', 'journals']) {
  expect(body.snapshots).not.toHaveProperty(ghost);
}
```

- [ ] **Step 2: 跑测试，确认因 where 错配而红**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts -t "deposit evidence"
```
Expected: FAIL——`deposits` 为空（旧代码按 `where:{id:{in:['DEP2603240001']}}` 查，行为化 mock 真过滤后无行命中）。这一步就是假绿的死亡证明，红不出来说明 mock 没换对。

- [ ] **Step 3: 重写接口与 builder**

`DepositEvidenceChainItem`（:71-83）与 `DepositEvidenceSnapshots`（:84-93）改为：

```ts
export interface DepositEvidenceChainItem {
  depositId: string;
  depositNo: string | null;
}

export interface DepositEvidenceSnapshots {
  deposits: any[];
  depositEvidenceChain: DepositEvidenceChainItem[];
}
```

`buildDepositSnapshots` 整体替换（原 :1342-1597，含死掉的 `subjectNos` 采集臂、五段幽灵查询、mapped* 变换、`buildDepositEvidenceChain` 调用一并消失；`buildDepositEvidenceChain` 私有助手整删）：

```ts
private async buildDepositSnapshots(records: any[], db: any): Promise<DepositEvidenceSnapshots> {
  const candidateNos = this.toSortedUniqueStrings(
    records
      .filter(
        (item) =>
          item.primarySubjectNo &&
          item.primarySubjectType === AuditEntityTypes.DEPOSIT_TRANSACTION,
      )
      .map((item) => this.normalizeOptionalString(item.primarySubjectNo)) as Array<string | null>,
  );

  if (!candidateNos.length || !db?.depositTransaction?.findMany) {
    return { deposits: [], depositEvidenceChain: [] };
  }

  const deposits = await db.depositTransaction.findMany({
    where: { depositNo: { in: candidateNos } },
    orderBy: { depositNo: 'asc' },
    include: {
      customer: {
        select: { id: true, customerNo: true, firstName: true, lastName: true, email: true },
      },
      asset: {
        select: { id: true, code: true, type: true, network: true, decimals: true },
      },
    },
  });

  const depositEvidenceChain: DepositEvidenceChainItem[] = deposits.map((row: any) => ({
    depositId: String(row.id),
    depositNo: row.depositNo ?? null,
  }));

  return { deposits, depositEvidenceChain };
}
```

- [ ] **Step 4: 跑测试转绿 + 全量该文件**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts
```
Expected: deposit 用例 PASS；其它用例若因幽灵 mock/断言残留而红，属本任务清理范围——同一用例文件里凡引用六个幽灵段键或幽灵模型 mock 的断言一并按新形状修（不许为过而删断言强度：非空断言必须保留）。

- [ ] **Step 5: tsc + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/audit-logging/audit-logs.service.ts src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "fix(审计): 证据包充值链修通——业务号直查真实表,幽灵五段+journal退役,测试反转为行为化mock"
```

---

### Task 2: withdraw 证据链修通 + 幽灵段退役

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.service.ts`（接口 :116-142、`buildWithdrawSnapshots` :1598-1916、`buildWithdrawEvidenceChain` 助手 :1260-1341 整删）
- Test: `audit-logs.service.spec.ts`（withdraw describe :1112-1468）

**Interfaces:**
- Consumes: Task 1 的 `mockFindManyByWhere`。
- Produces: `WithdrawEvidenceChainItem { withdrawId; withdrawNo }`、`WithdrawEvidenceSnapshots { withdrawTransactions; withdrawEvidenceChain }`。

- [ ] **Step 1: 反转 withdraw 测试**

同 Task 1 手法：`prisma.withdrawTransaction.findMany = mockFindManyByWhere([<原行，保留 id:'wd-1' 与 withdrawNo:'WDR...'>])`；删幽灵 mock（kytCase/travelRuleCase/workflowDecisionRecord/complianceAlert/complianceIncident/journal/clearing）；新断言：

```ts
expect(body.snapshots.withdrawTransactions).toHaveLength(1);
expect(body.snapshots.withdrawEvidenceChain[0]).toEqual({ withdrawId: 'wd-1', withdrawNo: expect.any(String) });
for (const ghost of ['payouts', 'preKytCases', 'mainKytCases', 'travelRuleCases', 'riskDecisionRecords', 'alerts', 'cases', 'journals', 'clearings']) {
  expect(body.snapshots).not.toHaveProperty(ghost);
}
```
（注意 `payouts` 是写死 `[]` 的死键、`clearings` 是幽灵——一并进禁键清单。）

- [ ] **Step 2: 跑测试确认红**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts -t "withdraw"
```
Expected: FAIL（withdrawTransactions 为空，where 按 id 匹配业务号）。

- [ ] **Step 3: 重写接口与 builder**

接口改为：

```ts
export interface WithdrawEvidenceChainItem {
  withdrawId: string;
  withdrawNo: string | null;
}

export interface WithdrawEvidenceSnapshots {
  withdrawTransactions: any[];
  withdrawEvidenceChain: WithdrawEvidenceChainItem[];
}
```

`buildWithdrawSnapshots` 整体替换（`subjectNos` 死臂、七段幽灵查询、mapped*、`buildWithdrawEvidenceChain` 全删）：

```ts
private async buildWithdrawSnapshots(records: any[], db: any): Promise<WithdrawEvidenceSnapshots> {
  const candidateNos = this.toSortedUniqueStrings(
    records
      .filter(
        (item) =>
          item.primarySubjectNo &&
          item.primarySubjectType === AuditEntityTypes.WITHDRAW_TRANSACTION,
      )
      .map((item) => this.normalizeOptionalString(item.primarySubjectNo)) as Array<string | null>,
  );

  if (!candidateNos.length || !db?.withdrawTransaction?.findMany) {
    return { withdrawTransactions: [], withdrawEvidenceChain: [] };
  }

  const withdrawTransactions = await db.withdrawTransaction.findMany({
    where: { withdrawNo: { in: candidateNos } },
    orderBy: { withdrawNo: 'asc' },
    include: {
      asset: {
        select: { id: true, code: true, type: true, network: true, decimals: true },
      },
      customer: {
        select: { id: true, customerNo: true, firstName: true, lastName: true, email: true, riskRating: true },
      },
    },
  });

  const withdrawEvidenceChain: WithdrawEvidenceChainItem[] = withdrawTransactions.map((row: any) => ({
    withdrawId: String(row.id),
    withdrawNo: row.withdrawNo ?? null,
  }));

  return { withdrawTransactions, withdrawEvidenceChain };
}
```

- [ ] **Step 4: 转绿**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts
```
Expected: PASS（全文件）。

- [ ] **Step 5: tsc + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/audit-logging/audit-logs.service.ts src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "fix(审计): 证据包提现链修通——同款业务号直查,七段幽灵+payouts死键退役"
```

---

### Task 3: swap 幽灵段退役 + 链瘦身

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.service.ts`（接口 :95-114、`buildSwapSnapshots` :1917-2223 内幽灵三查询 + `db.journal` + mapped* + `buildSwapEvidenceChain` 助手）
- Test: `audit-logs.service.spec.ts`（swap describe :807-1111）

**Interfaces:**
- Consumes: `mockFindManyByWhere`；既有 `resolveSwapExportSelectionContext`（不动）。
- Produces: `SwapEvidenceChainItem { swapId; swapNo; quoteId; quoteNo }`、`SwapEvidenceSnapshots { swapTransactions; swapQuotes; swapEvidenceChain }`。

- [ ] **Step 1: 反转 swap 测试**

swap 的真实链（业务号→id 解析）本就通——本任务测试只做三件：`swapTransaction`/`swapQuote` mock 换 `mockFindManyByWhere`（把解析步也纳入真过滤，防退化）；删幽灵 mock；断言：

```ts
expect(body.snapshots.swapTransactions).toHaveLength(1);
expect(body.snapshots.swapQuotes.length).toBeGreaterThanOrEqual(0);
expect(body.snapshots.swapEvidenceChain[0]).toEqual({
  swapId: expect.any(String), swapNo: expect.any(String),
  quoteId: expect.anything(), quoteNo: expect.anything(),
});
for (const ghost of ['swapRiskDecisionRecords', 'swapAlerts', 'swapCases', 'swapJournals']) {
  expect(body.snapshots).not.toHaveProperty(ghost);
}
```

- [ ] **Step 2: 跑测试确认红**（禁键断言必红——旧代码仍输出四个恒空键）

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts -t "swap"
```
Expected: FAIL on `not.toHaveProperty('swapRiskDecisionRecords')`。

- [ ] **Step 3: 改码**

接口改为：

```ts
export interface SwapEvidenceChainItem {
  swapId: string;
  swapNo: string | null;
  quoteId: string | null;
  quoteNo: string | null;
}

export interface SwapEvidenceSnapshots {
  swapTransactions: any[];
  swapQuotes: any[];
  swapEvidenceChain: SwapEvidenceChainItem[];
}
```

`buildSwapSnapshots`：删 `workflowDecisionRecord`/`complianceAlert`/`complianceIncident`/`journal` 四段查询与 mapped* 变换、删 `buildSwapEvidenceChain` 助手，链改内联（数据源用既有 `selectionContext.swapTransactions` 的 linkage 行）：

```ts
const swapEvidenceChain: SwapEvidenceChainItem[] = selectionContext.swapTransactions.map((row) => ({
  swapId: String(row.id),
  swapNo: row.swapNo ?? null,
  quoteId: row.quoteId ?? row.quoteSnapshotRef ?? null,
  quoteNo: row.quoteNo ?? null,
}));

return { swapTransactions, swapQuotes, swapEvidenceChain };
```

- [ ] **Step 4: 转绿 + 幽灵残留全仓清点**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts
grep -n "kytCase\|travelRuleCase\|workflowDecisionRecord\|complianceAlert\|complianceIncident\|db\.journal\|db\.clearing\|db\.payout" src/modules/audit-logging/audit-logs.service.ts
```
Expected: 测试全绿；grep **零命中**（附命令进任务报告——否定性结论要可复现）。

- [ ] **Step 5: tsc + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/audit-logging/audit-logs.service.ts src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "refactor(审计): 证据包swap链幽灵四段退役+链瘦身为真实linkage,幽灵模型全文件清零"
```

---

### Task 4: 详情端点换业务键 + RBAC 权限码连动（后端）

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.controller.ts:93-98` ｜ `audit-evidence-package.controller.ts:63-77` ｜ `audit-logs.service.ts`（`findOne` :1114、`findEvidencePackage` :2271、`downloadEvidencePackage` :2302 参数语义） ｜ `audit-evidence-export-workflow.service.ts:148`（download 首参） ｜ `src/modules/identity/access-control/rbac.catalog.ts:473,480,483` ｜ `admin-web/src/rbac/permissions.ts:99-104`
- Test: `audit-logs.service.spec.ts` + `audit-evidence-export-workflow.service.spec.ts`

**Interfaces:**
- Produces: `findOne(eventNo: string)`、`findEvidencePackage(packageNo: string)`、`downloadEvidencePackage(packageNo, actor, sourceIp?)`；新权限码 `api.get.admin_audit_logs_eventno`、`api.get.admin_audit_evidence_packages_packageno`、`api.get.admin_audit_evidence_packages_packageno_download`（Task 5 前端消费路由，Task 8 db:base:sync）。

- [ ] **Step 1: 写失败测试**

`audit-logs.service.spec.ts` 加两例：

```ts
it('finds audit log detail by eventNo (business key, 铁律⑥)', async () => {
  prisma.auditLogEvent.findUnique.mockResolvedValue(null);
  await service.findOne('AUD2603240001').catch(() => undefined);
  expect(prisma.auditLogEvent.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { eventNo: 'AUD2603240001' } }),
  );
});

it('finds evidence package by packageNo (business key, 铁律⑥)', async () => {
  prisma.auditEvidencePackage.findUnique.mockResolvedValue(null);
  await service.findEvidencePackage('PKG2603240001');
  expect(prisma.auditEvidencePackage.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { packageNo: 'PKG2603240001' } }),
  );
});
```

- [ ] **Step 2: 跑测试确认红**（当前 where 是 `{ id }`）

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts -t "business key"
```
Expected: FAIL。

- [ ] **Step 3: 改后端**

`audit-logs.controller.ts:93-98`：

```ts
@Get(':eventNo')
@ApiOperation({ summary: 'Get audit log detail by event no' })
findOne(@Req() req: any, @Param('eventNo') eventNo: string) {
  this.ensureAdmin(req);
  return this.auditLogsService.findOne(eventNo);
}
```

`audit-logs.service.ts` `findOne`：参数改 `eventNo`，`findUnique({ where: { eventNo }, include: {...原样} })`。
`findEvidencePackage`：参数改 `packageNo`，`findUnique({ where: { packageNo }, ...原 include/deletedAt 逻辑 })`；`downloadEvidencePackage(:2302)` 与 workflow `downloadEvidencePackage(:148)` 首参改 `packageNo`（内部本就转调 `findEvidencePackage`，NotFound 文案随参数自然换）。
`audit-evidence-package.controller.ts`：两个 `@Get(':id')` 改 `@Get(':packageNo')` + `@Param('packageNo')`。
`rbac.catalog.ts`：`:id` → `:eventNo`（:473）/ `:packageNo`（:480、:483）——权限码由 `buildPermissionCode` 自动跟着变。
`admin-web/src/rbac/permissions.ts`：`AUDIT_EVIDENCE_EXPORT_DOWNLOAD` 值改 `'api.get.admin_audit_evidence_packages_packageno_download'`；**删除**零引用死常量 `AUDIT_EVIDENCE_EXPORT_DETAIL_READ`（:102，连带清理——BACKLOG §H 小账①随波一销）。

- [ ] **Step 4: 转绿 + 旧码零残留**

```bash
npx jest src/modules/audit-logging
grep -rn "admin_audit_logs_id\|admin_audit_evidence_packages_id" src admin-web/src scripts
```
Expected: 两 spec 全绿（workflow spec 若按 `'pkg-1'` 传参断言 `findEvidencePackage` 调用，改成 packageNo 语义）；grep 零命中（附报告）。

- [ ] **Step 5: tsc ×2 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd ..
git add src/modules/audit-logging admin-web/src/rbac/permissions.ts src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(审计): 两详情端点换eventNo/packageNo(铁律⑥)——RBAC三码连动,死常量DETAIL_READ连带删除"
```

---

### Task 5: 前端路由与跳转换业务键

**Files:**
- Modify: `admin-web/src/App.tsx:268-271` ｜ `AuditLogsPage.tsx:481` ｜ `AuditLogDetailPage.tsx:173,180,183,194` ｜ `EvidenceExportsPage.tsx:274`（+「View package」导航若按 id） ｜ `EvidenceExportDetailPage.tsx:193,218,222,237,258`

**Interfaces:**
- Consumes: Task 4 的新端点路径。

- [ ] **Step 1: 改码**

- `App.tsx`：`audit/logs/:id` → `audit/logs/:eventNo`；`audit/evidence-packages/:id` → `:packageNo`
- `AuditLogsPage.tsx:481`：`navigate(\`/admin/audit/logs/${item.eventNo}\`)`
- `AuditLogDetailPage.tsx`：`useParams<{ eventNo: string }>`，fetch 与空校验、`useEffect` 依赖全部换 `eventNo`（错误文案改 "Audit event no is required."）
- `EvidenceExportsPage.tsx:274`：`navigate(\`/admin/audit/evidence-packages/${item.packageNo}\`)`；搜 `lastExportId` 的「View package」导航，若按 id 拼 URL 改用响应里的 `packageNo`（`EvidencePackageExportResponse.packageNo` 现成）
- `EvidenceExportDetailPage.tsx`：`useParams<{ packageNo: string }>`，两处 fetch URL、依赖、空校验换 `packageNo`

- [ ] **Step 2: tsc + 预览走查**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
起 preview（worktree self 栈）：审计列表点行 → URL 显 `/admin/audit/logs/AUD…`；证据包列表点行 → `/admin/audit/evidence-packages/PKG…`；详情正常渲染、刷新直达不 404。
Expected: 两条 URL 全业务号，tsc 零错。

- [ ] **Step 3: 提交**

```bash
git add admin-web/src/App.tsx admin-web/src/pages/AuditLogsPage.tsx admin-web/src/pages/AuditLogDetailPage.tsx admin-web/src/pages/EvidenceExportsPage.tsx admin-web/src/pages/EvidenceExportDetailPage.tsx
git commit -m "feat(审计前端): 路由/行点击/详情fetch全换eventNo/packageNo"
```

---

### Task 6: UUID 卫生——stripInternalIds 乙案 + 三处落屏清理

**Files:**
- Create: `admin-web/src/utils/stripInternalIds.ts`
- Modify: `AuditLogDetailPage.tsx`（:138-168 RawRecordBlock、:236 hasOwner、:313 actor、:358-363 Owner 区、接口 :15-50） ｜ `AuditLogsPage.tsx`（:551 actor 列、接口 :15-30） ｜ `EvidenceExportDetailPage.tsx`（RawRecordBlock :158-188、JsonBlock 三处 :437-483、Selected Events :441-457、派生条件 :343-344）

**Interfaces:**
- Produces: `stripInternalIds<T>(value: T): T`（Task 7 之后如有新 JSON 落屏一律过它）。

- [ ] **Step 1: 写工具**

```ts
/** 铁律⑥展示层过滤（岔口①乙案，2026-09-15 业主拍板）：递归剔除内部 id 形键，
 * 放行旅程/链路标识（页面本就展示的检索键）。只作用于屏上渲染与 Copy——
 * 下载文件保持全量，取证完整性不受影响。 */
const PASSTHROUGH_ID_KEYS = new Set(['traceId', 'correlationId', 'causationId', 'requestId', 'sessionId']);
const INTERNAL_ID_KEY = /^id$|Id$|Ids$/;
const EXTRA_STRIP_KEYS = new Set(['selectedEventIdsSnapshot']);

export function stripInternalIds<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripInternalIds(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (EXTRA_STRIP_KEYS.has(key)) continue;
      if (INTERNAL_ID_KEY.test(key) && !PASSTHROUGH_ID_KEYS.has(key)) continue;
      out[key] = stripInternalIds(val);
    }
    return out as unknown as T;
  }
  return value;
}
```

- [ ] **Step 2: 接入两页**

- 两页 `RawRecordBlock`：`const json = JSON.stringify(stripInternalIds(detail), null, 2);`（渲染与 Copy 同源，天然同过滤）
- `EvidenceExportDetailPage` 三个 JsonBlock 的 value 包一层：`stripInternalIds(detail.filterSnapshot)` / `stripInternalIds(detail.manifest)` / `stripInternalIds(detail.packageBody)`——manifest 的 `recordDigests[].id`、criteria 的 `selectedEventIds`、packageBody 的 records 内部 id 全部消失，`eventNo`/`digest` 保留
- Selected Events 改业务号：

```tsx
const recordDigests: Array<{ eventNo?: string }> =
  ((detail.manifest as any)?.recordDigests as Array<{ eventNo?: string }>) ?? [];
const selectedEventNos = recordDigests
  .map((r) => r.eventNo)
  .filter((v): v is string => !!v);
```
chips 遍历 `selectedEventNos`，标题 `Selected Events ({selectedEventNos.length})`；`hasSelectionCriteria` 改 `detail.filterSnapshot != null || selectedEventNos.length > 0`；接口删 `selectedEventIdsSnapshot` 字段
- `AuditLogDetailPage`：删 `<Field label="Owner ID" …/>`（:362）与接口 `entityOwnerId`，`hasOwner` 改 `!!(detail.entityOwnerType || detail.entityOwnerNo)`；:313 改 `{detail.actorNo ?? '—'}`，接口删 `actorId`
- `AuditLogsPage`：:551 改 `{item.actorNo ?? <span className="text-adm-t3">—</span>}`，接口删 `actorId`

- [ ] **Step 3: tsc + 预览截图核**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
预览打开审计详情与证据包详情：Raw Record / Manifest / Package Body 里 `grep 不到任何 UUID 形键`（肉眼核 + 截图落盘）；Selected Events 全 `AUD…` 业务号；Actor 列无截断 UUID。
Expected: 三块 JSON 区零 `"id":`／`"actorId":` 键；业务号与 traceId/correlationId 键保留。

- [ ] **Step 4: 提交**

```bash
git add admin-web/src/utils/stripInternalIds.ts admin-web/src/pages/AuditLogDetailPage.tsx admin-web/src/pages/AuditLogsPage.tsx admin-web/src/pages/EvidenceExportDetailPage.tsx
git commit -m "feat(审计前端): stripInternalIds乙案过滤三处JSON落屏,OwnerID/actorId兜底清,SelectedEvents改业务号"
```

---

### Task 7: 证据包详情渲染审批背书

**Files:**
- Modify: `admin-web/src/pages/EvidenceExportDetailPage.tsx`（Package Details 与 Exporter 之间插 Approval 区；导入 `AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE`、`useNavigate` 已有）

**Interfaces:**
- Consumes: 详情响应既有 `approvalCase { approvalNo, status, decisionByRole, decidedAt }` 与 `approvalCaseNo`（接口 :24-46，零后端改动）；`auditEntityRoutes.ts` 的 `APPROVAL_CASE` 映射（`/admin/governance/approvals/:no`）。

- [ ] **Step 1: 插 Approval 区**

```tsx
{(detail.approvalCase || detail.approvalCaseNo) && (
  <section className="px-6 py-5">
    <Cap>Approval</Cap>
    <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
      MLRO endorsement — download is gated on this approval
    </p>
    <div className="mt-3">
      <FieldGrid>
        <div>
          <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Approval No</p>
          {(detail.approvalCase?.approvalNo ?? detail.approvalCaseNo) ? (
            <span
              className="cursor-pointer font-mono text-[11px] font-semibold text-adm-blue hover:underline"
              onClick={() =>
                navigate(
                  AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE.APPROVAL_CASE!(
                    (detail.approvalCase?.approvalNo ?? detail.approvalCaseNo)!,
                  ),
                )
              }
            >
              {detail.approvalCase?.approvalNo ?? detail.approvalCaseNo}
            </span>
          ) : (
            <p className="font-mono text-[11px] text-adm-t2">—</p>
          )}
        </div>
        <div>
          <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Approval Status</p>
          {detail.approvalCase
            ? <AdminBadge value={detail.approvalCase.status} />
            : <p className="font-mono text-[11px] text-adm-t2">—</p>}
        </div>
        <Field label="Decided By Role" value={detail.approvalCase?.decisionByRole} />
        <Field label="Decided At" value={detail.approvalCase?.decidedAt ? fmt(detail.approvalCase.decidedAt) : undefined} mono />
      </FieldGrid>
    </div>
  </section>
)}
```

- [ ] **Step 2: tsc + 预览核**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
预览：READY 包详情出现 Approval 区四件；点 Approval No 跳审批详情。截图。

- [ ] **Step 3: 提交**

```bash
git add admin-web/src/pages/EvidenceExportDetailPage.tsx
git commit -m "feat(审计前端): 证据包详情渲染MLRO背书四件,ApprovalNo可点跳审批中心"
```

---

### Task 8: 收尾闸 + 剧本预演 + 记账（主会话执行，不派子代理）

**Files:**
- Modify: `doc-final/BACKLOG.md`（销 4 条+小账①划去）｜ `doc-final/superpowers/specs/2026-09-15-act7-audit-campaign-charter.md`（状态行）
- Create: `doc-final/superpowers/specs/2026-09-15-act7-wave2-audit-attribution-skeleton.md`（波二骨架）

- [ ] **Step 1: 全量闸**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd .. && cd client-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/audit-logging
bash scripts/stack.sh up && bash scripts/on-stack.sh self demo:all
```
Expected: 全绿；demo:all 花名册全 PASS。

- [ ] **Step 2: 剧本预演（spec §5 五步）+ 截图**

`auditor@` 审计页 Advanced·Entity No 定位第三幕冻结→处置充值单事件 → 建包 → `mlro@` 批准 → `auditor@` 详情（READY + Approval 四件 + Selected Events 业务号）→ Download → 打开 JSON 验 `snapshots.deposits` 非空、幽灵键不存在、URL 是 packageNo；提现单同法抽一张。审计列表/详情、证据包列表/详情四页截图落盘（物证写明路径进任务报告）。

- [ ] **Step 3: 记账与骨架**

- BACKLOG §H 销：幽灵模型条、UUID 路由条、UUID 落屏三处条、证据包背书条（各附「已修·波一」+ commit 号）；小账条①（死常量）划去并注明随 Task 4 连带删除
- 总纲状态行：波一 → 已完成（日期 + 分支/commit）
- 立波二骨架：总纲链接 + 空「承接上一波」节 + 已定事实（subjects 样板位置、~29 码清单、岔口②删 CRUD、verify:audit 升级方向）+ 待定岔口（无）
- 对照本计划「收尾过哪几条」节逐条勾验（该节已把 delivery-checklist 的判定写死，执行者不再自行判）
- 收尾报告按 CLAUDE.md §9 报文档层：本波预期 `Documentation updated: none`（modules/demo 均归波三收口，BACKLOG/总纲/骨架属台账动作）

- [ ] **Step 4: 收官提交 + 合并注意**

```bash
git add doc-final/BACKLOG.md doc-final/superpowers/specs/2026-09-15-act7-audit-campaign-charter.md doc-final/superpowers/specs/2026-09-15-act7-wave2-audit-attribution-skeleton.md
git commit -m "docs(第七幕波一): 收尾记账——BACKLOG销4+小账①,总纲状态回写,波二骨架立"
```
合并进 main 后必做（**权限码变了**）：重启后端 + `npm run db:base:sync`；再 `bash scripts/on-stack.sh main demo:all` 复验；**`doc-final/CHANGELOG.md` 追加一行**（一合并一行，写清波一交付物）。合并走 superpowers:finishing-a-development-branch。

---

## Self-Review 记录

- Spec 覆盖：spec §1→Task 1/2/3；§2→Task 4/5；§3→Task 6；§4→Task 7；§5→Task 8 ✓。spec 的「独立 resolver」在 deposit/withdraw 简化为主查询直查（本文件 Architecture 已声明偏差与理由，终审按此口径）。
- 占位符：无 TBD/略；所有改码步骤带完整代码 ✓。
- 类型一致性：`DepositEvidenceChainItem`/`WithdrawEvidenceChainItem`/`SwapEvidenceChainItem` 三处瘦身形状与 Task 1/2/3 断言逐字段对得上；`findOne(eventNo)`/`findEvidencePackage(packageNo)` 签名 Task 4 定义、Task 5 前端按路径消费 ✓。
- 已核事实：verify-rbac.ts 对两条路由零探针（grep -c = 0，无连动）；权限码含参数名（`customerno` 先例）；`manifest.recordDigests[].eventNo` 现成（service :785-789）。
