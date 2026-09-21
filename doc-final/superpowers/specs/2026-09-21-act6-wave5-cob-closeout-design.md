# 第六幕清残留 · 波五「业务日迪拜午夜切 + 演示面清点 + 文档收口」设计稿

> 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` §3 波五行 ｜ 立于 2026-09-21，骨架（`2026-09-21-act6-wave5-skeleton.md`）已吸收删除
> 业主拍板（2026-09-21 波五脑暴，三岔口全甲案）：① 切账点=**迪拜午夜**（自然日历日，不取银行 17/18 点 COB 变体）② 划转腿推单=**显式拒**（沿 swap 先例）③ 路由前缀=**统一 `custody/`**
> 本波是全战役唯一改行为的波，也是**末波**——收尾要逐条复验总纲 §0 的六条战役级判据。

## 0. 本波做 / 不做

**做**：业务日迪拜午夜切（9 位点 / 8 文件，§1）｜ §G 剩余演示可见 5 条（§2）｜ 文档收口（§3）。
**不做**（总纲 §1 + 本波追加）：倒计时 / 时限数字 ｜ 历史存量口径评估（§3 重铺教义）｜ 调账弹窗残存的 `side: 'FROM'|'TO'` 锚推导收编（骨架新事实 1——那是「提交体锚字段」概念，非展示业务判断，登 BACKLOG 不收）｜ INTERNAL_BREAK 恒等破裂**明细呈现**（见 §2.1 裁定）｜ 无主入金退回出口 ｜ CLAUDE.md §2 全清单。

## 1. 业务日迪拜午夜切

### 1.1 口径（业主 2026-09-21 钉死）

- **业务日 = 迪拜日历日**。迪拜恒定 UTC+4、无夏令时：时刻 t 的业务日 = `(t + 4h)` 的 UTC 日期。
- **业务日 D 的日终** = 迪拜次日 00:00 前一刻 = `D T19:59:59.999Z`；**日始** = `(D-1) T20:00:00.000Z`。
- 唯一真源：`src/modules/accounting/tigerbeetle/utils/business-date.util.ts`——重写 `toBusinessDate`，新增 `endOfBusinessDate(businessDate: string): Date` 与 `startOfBusinessDate(businessDate: string): Date`，`DUBAI_UTC_OFFSET_MS` 具名常数。**全仓不许再手拼 `T23:59:59.999Z` / `T00:00:00Z` 表达业务日边界**。

### 1.2 位点清册（订正总纲：7 处 → **9 位点 / 8 文件**）

复现命令（清册来源，收尾复跑核对终态）：

```bash
grep -rn "toISOString().slice(0, *10)" src/ --include="*.ts" | grep -v ".spec.ts"
grep -rn "23:59:59" src/ admin-web/src --include="*.ts" --include="*.tsx" | grep -v spec
```

| # | 位点 | 现状 | 改法 |
|---|---|---|---|
| 1 | `business-date.util.ts:2` | `toISOString().slice(0,10)`（UTC） | 重写为迪拜日 + 新增日终/日始函数 |
| 2 | `wallet-recon-run.service.ts:1088` | 私有重复件（总纲记 :1055，已漂） | **整个删除**，改 import 共享 util |
| 3 | `recon-thresholds.constant.ts:26` | 账龄起算硬拼 `T23:59:59.999Z` | 改用 `endOfBusinessDate` |
| 4 | `effective-cutoff.ts:23` | 回填判定硬拼 `T23:59:59.999Z` | 改用 `endOfBusinessDate` |
| 5 | `reconciliation-query.service.ts:532` | 回落截止硬拼 `T23:59:59.999Z` | 改用 `endOfBusinessDate` |
| 6 | `reconciliation-query.service.ts:1009-1010` | 日窗 `T00:00:00Z`/`T23:59:59.999Z` | 改用 `startOfBusinessDate`/`endOfBusinessDate` |
| 7 | `push-order.service.ts:204,206` | 「今天」「创建日」按 UTC | 两处改走 `toBusinessDate` |
| 8 | `supplement-evidence.service.ts:125` | 兜底业务日 `toISOString().slice(0,10)` | 改走 `toBusinessDate`（**本次同款清点新发现**） |
| 9 | `admin-web/src/utils/reconRunTrigger.ts:34` | **前端**硬拼 `${businessDate}T23:59:59.999Z` | 契约改造，见 §1.3（**本次新发现，总纲 7 处全在后端、漏了它**） |

订正说明：总纲 `reconciliation-query.service.ts:923` 一处经波三/波四重构后实为两位点（#5/#6）；#8/#9 为本次「改一处先找齐同款」全仓重扫新增。**#9 是要害**——「Re-reconcile 按日终重跑」的日终硬写在前端，只改后端则重对账仍按 UTC 截止（`D T23:59:59.999Z` 在新口径下已属 D+1 业务日），场景 9 验收必挂。

**同款清点已见、判不改**（各附理由，收尾复扫时对号）：`fake-external-refs.util.ts:23`（假外部单号里的日期串，展示性字面）｜ `reconciliation-sweep.service.ts:32,36`（日志文案）｜ `ReconciliationAdjustmentListPage.tsx:55` 与 client-web `TransactionHistory.tsx:54`（查询过滤「含选中整天」的 +1 天取整，是过滤边界语义、非记账归属日）。

### 1.3 `runs/wallet` 契约改造（日终换算收回后端）

- DTO 从 `{ cutoff: string }` 改为 `{ cutoff?: string; businessDate?: string }`，**恰好传一个**：`cutoff` 为 ISO 时刻原样用（`scripts/verify-act1.ts:424` 传真实时刻，不受影响）；`businessDate` 为 `YYYY-MM-DD`，后端 `endOfBusinessDate()` 换算截止时刻。
- `reconRunTrigger.ts` 改传 `{ businessDate }`，前端不再算日终——与波四「前端只读不算」同向。
- 调用方全量清点（复现：`grep -rn "runs/wallet" admin-web/src client-web/src scripts src`）：业务调用方唯 `reconRunTrigger.ts` 一处；`verify-act1.ts` 传 cutoff 不动；`rbac.catalog.ts` / `verify-rbac.ts` 是路由登记与探针，路由不变、零改动。

### 1.4 测试与变异

- 新增 `business-date.util.spec.ts`：`19:59:59.999Z` → 当日、`20:00:00.000Z` → 次日；`endOfBusinessDate('D')` = `D T19:59:59.999Z`；`startOfBusinessDate` 对偶。
- 既有 spec 随位点更新：`effective-cutoff.spec`（回填边界随日终移动）、`recon-thresholds.constant.spec`、`push-order.service.spec`、`supplement-evidence.service.spec`、`reconciliation-query.service.spec`、`wallet-recon-run.service.spec`（私有件删除后走共享 util）。
- 变异实证（纪律：报绿前先证明会红）：把 util 里的偏移常数临时改 0（退回 UTC），`business-date.util.spec` 与 `effective-cutoff.spec` 必须红，截图/摘录入物证后还原。

### 1.5 连带文档（本波内完成，不留尾）

`demo/script.md:193` 种子时限从「当天 UTC 18:00（迪拜 22:00）前铺」改为「**迪拜 18:00（UTC 14:00）前铺**」（场景 9 外部行挪截止点 +6h，须留在迪拜当日内）｜ `modules/v8-recon.md` 业务日口径段 ｜ `BACKLOG.md:136` 销账 ｜ `decisions.md` 补 2026-09-21 钉切点条目（含 7→9 订正）。

## 2. §G 演示可见五条

### 2.1 `INTERNAL_BREAK` run 详情不再装干净

**根因两层**：① 写入语义错——`wallet-recon-run.service.ts:593` `invariantStatus = status==='PASS' ? 'PASS' : 'FAIL'`，普通 BREAK（钱包差异、恒等完好）也被记成恒等 FAIL；② 呈现缺态——`ReconciliationRunsDetailPage.tsx` 只有 PASS/BREAK 两条文案，预门破时 `walletCount=0` 渲染成「BREAK — 0 wallets checked」+ 全零卡片 + 空表，看着像干净。

**改法**：
- 写入修正：`invariantStatus = status==='INTERNAL_BREAK' ? 'FAIL' : 'PASS'`（恒等门只在 INTERNAL_BREAK 才是破的）。
- 详情页三态：`invariantStatus==='FAIL'` → 红色专用横幅（文案语义=「INTERNAL BREAK — internal ledger identity failed; per-wallet reconciliation did not run」），**隐藏** Health Check 五卡与钱包空表，换成说明块；否则 `matchedCount===walletCount` → 现绿文案；否则 → 现红 BREAK 文案。
- 连动检查：`invariantStatus` 的其余消费方（Runs 列表页徽章、query 投影）全量 grep，普通 BREAK run 的恒等徽章从 FAIL 转 PASS 属**本修正的预期行为变化**，物证里说明。
- **裁定（业主 spec 评审时可翻）**：`BACKLOG:192` 里「按币种呈现 资产合计/负债合计/差额 明细」**本波不做**——run 行未持久化 `breaks[]`，做明细要加列；恒等破只在故障时可见、非 18 场景演示内容，危险点是「假干净」，横幅即除。BACKLOG:192 改写为余项（明细呈现）。
- 取证法：worktree 自有栈上**停 TigerBeetle 后触发一次 run**（`:637` TB_UNREACHABLE 路径必产 INTERNAL_BREAK），截横幅图，再重启 TB。

### 2.2 严重度按币种拆线

- `computeSeverity(currency: string, delta: bigint)`；阈值表 `SEVERITY_LINES_MINOR: Record<string, { high: bigint; med: bigint }>` 落 `recon-thresholds.constant.ts` 与小额线同居，按 **`asset.currency`** 索引（USDT 的 code 是 `USDT-TRON`，先例注释已明说），缺币种 fail-fast 抛错、不做静默兜底。
- **初值锚定小额线的既有等值惯例**（100 AED ↔ 30 USDT）：AED `{ med: 10_000n /*100 AED*/, high: 1_000_000n /*10,000 AED*/ }`、USDT `{ med: 30_000_000n /*30 USDT*/, high: 3_000_000_000n /*3,000 USDT*/ }`。执行首任务先取数（重铺后 dump 各案 `currency × |delta|` 分布）：若分布塌成单档失去演示密度，允许把两档线**按同一系数整体下移**（保持币种间等值比例），终值以政策数口径写进代码注释并同步 `demo/baseline.md`。
- 调用侧陷阱：run 循环变量 `bal.currency` 实存 **`asset.code`**（`:172` 注释明说 keyed by currency=asset.code）；决议 code→`asset.currency` 用既有的 decimals 批量查（`:176` `asset.findMany`）**顺手多 select `currency` 一列**，零新增查询，`openCase` 入参补 `currency` 传入。
- 徽章变化属预期行为变更：波前/波后案件页截图对照 + `demo/baseline.md` 严重度预期修订。销 `BACKLOG:194`。

### 2.3 划转腿推单显式拒（甲案）

- 后端：`push-order.service.ts` `loadPushable()` 在 swap 拒斥后同款加 `if (order.internalTransferId) throw new BadRequestException('Internal-transfer-leg funds orders are advanced by the transfer workflow — push order is not supported for them; open the internal transfer detail page instead')`。
- 前端连动（只拒不藏=波二判例的幽灵入口，两处同波改）：
  - `CaseFlowTable.tsx` 在途分支：`row.transfer` 非空的行不再渲染「Push order →」，改渲染指向 `/admin/custody/internal-transfers/:transferNo` 的「Transfer leg →」链接（前缀用 §2.5 统一后的）。
  - `FundsOrderDetail.tsx`：`internalTransferId` 非空的单隐藏 Sync/Manual 推单动作块，原位给一行说明（划转腿由划转工作流推进）；与 swap 不同——swap 腿有本页替代端点（`:248` isSwap 分支）故留动作，划转腿无、故藏。
- 测试：`push-order.service.spec` 补划转腿拒斥用例（照 swap 拒斥用例）。销 `BACKLOG:128`。

### 2.4 开案/自愈审计留痕换业务键

- `reconciliation-case.service.ts` `auditCaseOpened`（`:215`）与 `auditCaseAutoHealed`（`:236`）两处 metadata 的 `walletRef: <UUID>` 改为 `walletNo: <业务号>`（键名一并换，`resolveWalletNo` 现成 `:177`；账龄两条审计 2026-09-03 起已用 `walletNo`，本条对齐）。
- 影响面已核：`export-audit-vocab.ts` 不扫 metadata 键，词表零影响；admin 审计页对 metadata 是通用键值渲染，零特判。`reconciliation-case.service.spec` 断言随改。销 `BACKLOG:198`。
- 判据：改后审计表新事件 metadata 零 UUID（重铺后查 `RECON_CASE_OPENED`/`RECON_CASE_AUTO_HEALED` 各≥1 条实证；**审计表判据须 rm dev.db 全新库**，reset 不清 audit 表）。

### 2.5 划转路由前缀统一 `custody/`（甲案）

- 改 13 处：`App.tsx:227,228` 两条 `path="treasury/internal-transfers*"` → `custody/`；其余 11 处 `/admin/treasury/internal-transfers` 字面（`DashboardLayout.tsx:270`、`caseDetailBits.tsx:39`、`CaseFlowTable.tsx:90`、`auditEntityRoutes.ts:19`、`InternalTransferList.tsx:137`、`FundsOrderDetail.tsx:168`、`approvalEntityRoutes.ts:50`、`IncidentDetailPage.tsx:88,267`、`InternalTransferDetail.tsx:73,128`）→ `custody/`。
- 终态判据（复现命令）：`grep -rn "treasury/" admin-web/src client-web/src --include="*.ts" --include="*.tsx"` 路由义命中 **= 0**（`CaseFlowTable.tsx:104` 「initiated by treasury」是文案不是路由，留）。RBAC 零改动（权限码挂后端 API 路由，前端路径非权限载体——plan 里以 `rbac.catalog.ts` 零 `treasury/internal-transfers` 前端路径佐证）。
- 走查：案件页划转链接、审批回链、审计深链、事故回链、资金单回链五路各点一次到页。销 `BACKLOG:180`。

## 3. 文档收口

| 处 | 改什么 |
|---|---|
| `bucket-classifier.ts:1` 注释 | 「五桶」→ 4 桶（**错误源头**，先改它） |
| `modules/v8-recon.md` :16/:36/:38/:110 | 「五桶」→ 4 桶；INTERNAL_BREAK 明确为 run 状态非桶 |
| `modules/v8-recon.md:113` | 成因码 21 → **20 + OTHER**（消文件内自相矛盾） |
| `scripts/recon-demo.ts:133` | `15-scenario model` → 18 |
| `reference/recon-cause-handbook.md` §四附录 :306-332 | 重排为 **18 场景 12 案**，索引号与现行剧本对齐 |
| `CHANGELOG.md` :41/:43 | 字节级重复删一行 |
| `modules/v8-recon.md` 全文 | **逐数复核**（桶数/码数/场景数/状态数/端点数——不止点名处），与代码对上；业务日口径段同步迪拜午夜切 |
| `demo/script.md` | `:193` 种子时限改迪拜口径（§1.5）；若严重度徽章在剧本文案中出现随 §2.2 同步 |
| `demo/baseline.md` | 严重度分布预期、`invariantStatus` 相关字样（如有）按新行为修订 |
| `BACKLOG.md` | 销 `:128`/`:136`/`:180`/`:194`/`:198`；`:192` 改写为余项（明细呈现）；新登「调账弹窗 side 锚推导收编后端」一行 |
| `decisions.md` | 2026-09-21 三条拍板入册（切点/划转腿/前缀） |
| `CHANGELOG.md` | 本波一行（合并时） |

## 4. 验收（总纲 §3 波五行 + 末波收官）

1. 闸①②③全绿；对账三域 jest **只增不减**（波前基线 29 suites / 567 tests）。
2. **重铺闸**：`rm dev.db` 后 `stack.sh reset` 从零建库 → `demo:all` → `recon:demo:break`，对照**修订后的** `demo/baseline.md` 全绿（严重度/恒等徽章差异须先落 baseline 再跑闸，不许拿旧 baseline 硬对）。
3. `verify:coa` 全绿（恒等式 + 负余额）。
4. **场景 9 剧本实走**：按 `demo/script.md` 步骤 9 实操，确认「下期自然平」由迪拜日终触发（Re-reconcile 收回外部行 → 案子自愈），截图入物证。
5. 前端四处改动（run 详情三态 / 划转腿链接与动作 / 前缀 / 严重度徽章）preview 渲染 + 截图；INTERNAL_BREAK 横幅按 §2.1 取证法实拍。
6. `modules/v8-recon.md` 与代码逐数复核清单入物证。
7. **战役级判据逐条复验**（总纲 §0 六条，末波义务）：①对账域 `(this.prisma as any)` 归零复现命令重跑 ②三恒真断言已换（指波一物证）③第六幕五页截图无假数据 ④Case 主体与迁移表（指波三物证）⑤本波 COB 判据 = 上面 2-4 ⑥文档逐数 = 上面 6。每条给「复跑命令或物证指针」，不许口头绿。
8. 收尾对照 `rules/delivery-checklist.md`；物证目录 `checkups/2026-09-21-act6-wave5-evidence/`；末波无下一波骨架，改为总纲状态行收官 + spec/plan 合并后归档。
