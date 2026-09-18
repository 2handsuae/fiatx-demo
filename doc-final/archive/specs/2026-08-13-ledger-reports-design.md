# 账本报表层 + COA v2 落地（本轮账务深化）设计 spec

> **主题**：本轮两条工作流——A=执行 [COA v2 科目表重设计](2026-08-13-coa-v2-design.md)（科目常量/记账点/迁移，设计已定稿零新决策）；B=搭建报表层四张视图（暂扣构成日报/收入分类日报/在途冻结登记簿/VARA 收盘快照），落"控制科目+每日对钩"铁律。含迪拜 COB 切日修正（B4 的前置）。
> **日期**：2026-08-13　**状态**：设计（未实现）　**范围**：admin 只读报表 + 快照持久化 + cron 前置步；**不含**任何导出（业主拍板乙）、QuickBooks 供数、对账处置闭环、V7 财资户、客户端展示。
> **业主拍板（2026-08-13 脑暴）**：本轮目标=更新科目+搭报表层｜报表出口形态=**乙（只页面，无 CSV 导出）**｜快照存储=甲（通用快照表+JSON 明细+对钩立列）｜COB=迪拜 00:00（既定假设，回邮件向财务确认一句）｜快照挂对账 cron 前置步。
> **⚠️ 范围二次收窄（2026-08-13 业主改主意）**：本轮**只执行工作流 A**（COA 更新，plan 见 `../plans/2026-08-13-coa-v2-rollout.md`）；工作流 B 报表层 + §4 COB 修正整体缓做，本 spec 设计仍有效、留班车（已登记 BACKLOG）。

---

## 0. 工作流 A：COA v2 落地（引用，不重复设计）

按 [2026-08-13-coa-v2-design.md](2026-08-13-coa-v2-design.md) §2/§6 原样执行：202 拆 210/211/212、退役 202/203/204、展示名多币种模板、202 历史按类型码精确重分类、三记账点贷方常量、四建户注册点、`verify:coa` 公司侧恒等式改新段、对账余额公式同步。**本 spec 只补一条执行顺序约束**：A 须先于 B2（收入分类日报对钩 210/211/212）落地；B1/B3 不依赖 A。

## 1. 快照存储模型（岔口甲）

新 Prisma 表 `ledger_report_snapshots`：

| 列 | 说明 |
|---|---|
| `reportType` | `SUSPENSE_COMPOSITION` / `INCOME_BREAKDOWN` / `VARA_CLOSE` |
| `businessDate` | 业务日（迪拜日历日，`YYYY-MM-DD`） |
| `currency` | 币种（= ledger 维度） |
| `payload` | JSON 明细行（页面渲染用，结构随报表演进不动 schema） |
| `expectedTotal` / `actualTotal` / `delta` | 对钩三数（分，字符串存 Decimal 语义按项目惯例） |
| `tieOutStatus` | `PASS` / `FAIL` |
| `computedAt` / `recomputedAt` | 首算/重算时间戳 |

- `@@unique([reportType, businessDate, currency])`——重算=幂等 upsert。
- **对钩结果立列不埋 JSON**："查所有 FAIL 的日子"必须一句 SQL。
- **多路对钩的报表**（B2 三个户各一条等式、B4 四个恒等式）：逐路等式结果进 `payload` 明细行，顶层三数列存**聚合**（expected/actual=Σ各路，`tieOutStatus`=**任一路 FAIL 即 FAIL**）。
- B3 登记簿是实时视图**不落快照**（操作登记簿非审计日报，无对钩语义）。

## 2. 模块布局

`src/modules/accounting/reports/`（账本读侧，不放 reconciliation——对账是同数据的邻居消费者，不是报表的爹）：

- `ledger-reports.service.ts` — 四张视图的计算（纯读：Prisma + TB posted 余额）
- `ledger-report-snapshot.service.ts` — 快照 upsert/查询
- `ledger-reports.controller.ts` — admin 端点（见 §5）
- cron 不新建：挂 `reconciliation-sweep.service.ts`（`@Cron('0 30 2 * * *', Asia/Dubai)`）前置步（见 §5）

admin 前端：账本菜单下新增「报表 Reports」页，四 tab：B1/B2/B4 带日期选择（默认 T-1），B3 实时。双语，样式沿账本三表惯例。

## 3. 四张视图算法与对钩等式

### B1 暂扣构成日报（快照）

- **取数**：充值单中"钱已入 101 且未流出终态"者——STEP_1 已 post（`DEPOSIT_ASSET_TO_SUSPENSE`）且无终态流出（入账 STEP_2 / 退回 post / 上缴 post / 没收 leg post）——按场景归组：

| 组 | 状态 |
|---|---|
| 审查中 Under Compliance Review | `COMPLIANCE_PENDING` / `MANUAL_CHECKING` / `ACTION_PENDING` |
| 冻结 Frozen – Sanctions/MLRO Hold | `FROZEN` |
| 待退回 Pending Return | `RETURNING` |
| 低于最低额 Below-Minimum Hold | `OPERATION_PENDING` |
| 处置中 Under Disposition | `SEIZING` / `CONFISCATING` |

- **对钩**：Σ各组金额 ≡ 101 该币种截止日 posted 余额。退回/上缴挂 pending 未 post 时 posted 未动、单子仍在构成——语义自洽。
- **状态归组用白名单**：未列出的状态（现在的或未来新增的）落 `UNCLASSIFIED` 组并使对钩倾向 FAIL——宁可红了去查，不可静默吞新状态（同客户面收敛白名单的设计哲学）。

### B2 收入分类日报（快照，依赖工作流 A）

- **取数**：`account_flows`/evidence 按转账类型码分组 × 币种 × 业务日：36→兑换手续费、16→提现手续费、4→其他（没收）。
- **对钩**：**累计** Σ（起始至截止日）≡ 210/211/212 各户截止日 posted 余额。逐日行入 payload，页面可聚合区间。
- **点差行**：兑换单 `spreadAmount`（`swap-workflow.service.ts:275` 落库，`marketValueOut − toAmount`）按日 × 币对汇总，标「管理口径，非账面 Management view – not ledger」，**不参与对钩**。
- ⚠️ 兑换单存在**恒空死列 `tbSpreadTransferId`**（`swap-workflow.service.ts:288` 恒 `null`，历史钩子）——**勿接线**；点差不记账是 COA v2 已定稿决策（[coa-v2-design §3](2026-08-13-coa-v2-design.md)）。

### B3 在途/冻结登记簿（实时，无快照）

两栏：

- **在途 In Transit**：所有未 post/void 的 pending 转账（evidence 状态过滤），挂单据号（充值退回/上缴、提现净额/费腿、兑换腿），显示锁定金额+挂起时长。
- **冻结 Frozen**：充值 `FROZEN`（钱 **posted 在 101**，纯状态扣）+ 提现 `FROZEN`（钱**锁在 pending**，`trading/withdraw-transactions/`）。两种冻结形态不同，各标各的（`Held in suspense` vs `Locked in transit`）。
- 补的盲区：冻结中的钱在 posted 余额里隐形（`balanceAfter` 不含 pending），此页是唯一显性化入口。

### B4 VARA 收盘快照（快照，依赖 COB 修正）

- **取数**：T-1 迪拜日截止时，每科目 × 币种收盘 posted 余额——`account_flows` 按 `effectiveDate ≤ T-1` 取各账户最后一行 `balanceAfter`（复用 recon 的 effectiveCutoffFilter 语义）。
- **对钩**：verify:coa 四式在截止日的成立性——客户资产恒等式（`Σ CLIENT_ASSET == Σ CLIENT_PAYABLE + DEPOSIT_SUSPENSE`）等在收盘位成立即 PASS。
- 这张表即"每日 VARA 对账对前一日收盘位"的底稿（财务邮件原始诉求）。

## 4. 迪拜 COB 切日修正

- `business-date.util.ts → toBusinessDate`：UTC 切日改**迪拜日历日**（UTC+4 固定无夏令时，实现=+4h 偏移后取 ISO 日期，常量 `DUBAI_UTC_OFFSET_HOURS = 4` 注明）。
- **COB=迪拜 00:00** 为既定假设（24/7 平台无天然下班时刻，午夜切最无歧义；财务要求"固定+对前一日"，一致性即满足）——回邮件时向财务确认一句。
- 存量 `effectiveDate` 不重刷；切换后重跑 `verify:coa` + recon 全量校验一遍确认无破。
- 影响面：`toBusinessDate` 全部调用方（evidence 盖章、recon cutoff、receipt-lookup、wallet-recon-run）——plan 阶段逐一核对。

## 5. 触发、端点、权限、审计

- **cron**：`reconciliation-sweep.service.ts` 02:30 迪拜跑 T-1——**前置步**先算 B1/B2/B4 三张快照再跑对账；快照失败不阻断对账（独立 try/catch，各自审计打点）。
- **端点**（admin，只读+一个重算）：
  - `GET /admin/ledger-reports/:type?businessDate=&currency=` — 快照读（B1/B2/B4）
  - `GET /admin/ledger-reports/registry` — B3 实时
  - `POST /admin/ledger-reports/recompute` — `{type, businessDate}` 幂等 upsert 重算
- **权限**：新 `LEDGER_REPORT_READ`（读）/ `LEDGER_REPORT_WRITE`（重算），`rbac.catalog.ts` 登记 + `db:base:sync` + **重启后端**（RBAC 内存注册老坑）。
- **审计**（铁律 1）：cron 快照计算（system actor）、operator 重算、对钩 FAIL 三类均落 `AuditLogsService`（DI 注入）。
- **对钩 FAIL 呈现**：快照行标红 + admin 页徽章；**不**开对账 Case（处置闭环出圈）。

## 6. 范围外（防蔓延）

CSV/任何导出（业主拍板乙）｜ QuickBooks 供数管道 ｜ 对账处置闭环/Case 联动 ｜ V7 财资户与付出费用科目 ｜ 客户端任何展示 ｜ 点差记账（永久否决项）。

## 7. 验收口径

1. `verify:coa` 全绿（新恒等式段）；`npm run` 硬闸照旧（tsc 0 / jest 净新 0 / demo:all / recon:demo PASS）。
2. 202 重分类后：202/203/204 余额为 0 且 `verify:coa` 断言恒零；210/211/212 余额之和 == 迁移前 202 余额（按币种）。
3. 造一笔各类型数据后：B1 对钩 PASS 且冻结/退回单出现在正确组；B2 累计对钩 PASS 且点差行有数；B3 能看到挂起中的 pending 与两种冻结；B4 对 T-1 出快照且四式 PASS。
4. 对钩 FAIL 可触发可看见：人为制造一笔不平（测试环境直写一笔绕过流水的转账），快照行 FAIL + 徽章 + 审计可查。
5. COB 修正后：迪拜 00:00–03:59 间产生的分录 `effectiveDate` 落迪拜当日（不再落前一日）；recon 重跑无新 BREAK。
6. admin 报表页四 tab 渲染截图验收（UI 一致性靠渲染截图，curl 不算数）。

## 8. 执行顺序

COB 修正（①）→ 工作流 A 科目落地+迁移（②）→ B1/B3（③，可与②并行）→ B2（④，依赖②）→ B4（⑤，依赖①）→ cron 挂接+admin 页（⑥）→ 全量验收（⑦）。
