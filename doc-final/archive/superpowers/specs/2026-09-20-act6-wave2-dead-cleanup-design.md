# 第六幕清残留 · 波二「清死物」—— 设计稿

> 立于 2026-09-20 ｜ 基线 main `d3e1a585` ｜ 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md`（本文件只写细波二，波次边界以总纲为准，两处边界订正见 §4 并已回写总纲）
> 依据：`superpowers/checkups/2026-09-19-act6-recon-checkup.md` + 波一承接（原骨架 `2026-09-19-act6-wave2-skeleton.md` 已整体吸收进下节，文件随本稿删除）

## 承接上一波（波一「闸门复位」，2026-09-19 收官）

- **实际偏差**：计划 13 个类型错，实际恰好 13 个、位置逐条吻合；jest 全程用 worktree 的 self 栈库（端口隔离铁律优先，结果数字与 plan 判据一致：28 suites / 553 tests）；Task 8 全文件 sed 误伤前人事故注释里的历史引用，主会话当场还原（394b9f59）——**判例：全文件字面替换会咬到注释层，收尾要扫一遍注释**。
- **执行中发现的新事实**：① Task 6/7/8 共补 5 条显式守卫，其中「跨钱包合成案件不能记定性/开调账单」已记 `BACKLOG.md` §G；② 这些新守卫分支均无自动化测试覆盖（评审定级为观察非缺陷，波一窄授权不补）；③ 三域仍残留 26 处非 prisma 的 `as any`（已登记 `TOOLING-DEBT.md`，波一未碰）。
- **波一带来的硬前提**：对账三域 180 处类型逃逸已归零，闸① 对该域数据层有效（变异物证在 `checkups/2026-09-19-act6-wave1-evidence/`）。**但闸① 不咬「省略可选字段」**——红 3 这类缺陷波一防不住，本波必须自建「断言写进去的行长什么样」防线（→ §3）。
- **波二前提变化**：两处（本波脑暴中业主拍板）——红 3 定甲案·写入；External Balances「劫持」经实测证伪、整条划掉。详见 §4，总纲 §3 波二行与 §5 已同步订正。

## 0. 本波做 / 不做

**做**（六件）：

1. 红 3 甲案：在途行落真实外部时间，读端去 epoch 兜底
2. 删 11 根死列（原 12，`externalTimestamp` 因甲案除名）+ 新增迁移
3. 删 3 个彻底死导出；对账三域多余 `export` 摘 export 保函数体
4. 摘 2 个幽灵筛选项（`WAIVED` / `PENDING_RECHECK`）连徽章死分支
5. 运营收回 `INTERNAL_TRANSFER_READ` + `FundsOrderDetail` 关联链接改条件渲染
6. 写行防线测试：断言在途行落库载荷的形状（含 `externalTimestamp`）

**不做**（对照 CLAUDE.md §2 与总纲 §1）：

- 不重构结构（Case 主体服务 / 拆大方法 / 抽 helper）—— 波三；不动前端拆分 —— 波四；不动业务日 —— 波五
- 不加新业务出路（无主入金退回 / 冲正冲销码 / HELD 态 / match tag 结转）—— 下周新功能轮
- **不给事故登记表单补 wallet 输入框**——那是新业务面；`Incident.walletRef` 按恒空管线整链删除（§1.2）
- External Balances 默认日**零代码改动**（§4，已证伪为非缺陷）
- 不做幂等 / 去重 / 防御性校验 / 性能优化 / 向后兼容（§2）

## 1. 关键实测（2026-09-20 落笔当日全部在 HEAD 复现，数字不是估的）

### 1.1 死列名单重立：12 → 删 11

体检计 12 根但只点名 10、其中 6 根是取数员的数。本稿逐模型全列重扫（对账三域 12 个模型全部标量字段 × src 非 spec / admin-web / scripts+test+prisma **三侧** `grep -rw`；扫描脚本一次跑出候选，同名跨模型者再做限定域核验）：

| # | 列 | 判据 |
|---|---|---|
| 1 | `ReconciliationCase.reimbursementObligationId` | 三侧零命中（特性已删） |
| 2-5 | `ReconciliationLineItem.internalTxHash` / `.externalSource` / `.externalTxHash` / `.resolutionMemo` | 三侧零命中。**`externalTxHash` 是体检漏点名的两根之一** |
| 6-7 | `ExternalBalance.statementId` / `.rawRef` | 三侧零命中 |
| 8 | `ExternalStatementLine.statementId` | 三侧零命中。**第二根 `statementId`，体检漏点名的另一根**——两根加回去恰好对上体检的 12 |
| 9-10 | `Incident.customerId` / `.sourceExternalLineId` | 同名字段跨模型假活（`InternalTransfer` 也有 `sourceExternalLineId` 且活着），故做限定域核验：`governance/incidents/**` 域内零命中；事故表域外只有 `findUnique`/`findMany` 读、零写（`adjustment.service.ts:245` / `reconciliation-query.service.ts:486`）；scripts/test 零直写 incident 表 |
| 11 | `Incident.walletRef` | **不是零引用，是恒空管线**：DTO 有字段（`dto/incident.dto.ts:22`）→ 写点活（`incident.service.ts:166`）→ 投影读活（`:79` 译 walletNo）→ 但登记表单没有输入框、程序化登记路径（`incident-registration-workflow.service.ts`）也不传 → 恒 null → `IncidentDetailPage.tsx` 的 Wallet 字段永不出现。**删除范围 = 整条链**（列 + DTO 字段 + 写点 + 投影 + 详情页死字段），屏上零变化 |

- `externalTimestamp`（体检点名的第 12 根）因红 3 定甲案**除名转活**（§2 T1）
- **排除一个假阳性**：`ReconciliationCase.openedByRun` 双侧零命中但它是**关系字段**，FK `openedByRunId` 活着——不是列，不动
- 11 根全部是无 `@relation`、无 `@@index` 的普通可空标量（schema 逐行核过），SQLite 直接 DROP，迁移照常新增、reset 重铺，**不写 backfill**（总纲 §2）

### 1.2 三个彻底死导出坐实

`InternalTransferFailureReason`（`internal-transfer.dto.ts:17`）/ `AdjustmentStatusValue`（`adjustment-transitions.constant.ts:10`）/ `IncidentStatusType`（`incident.constants.ts:22`）——全仓（src + admin-web，含 spec）各只 1 命中且为声明行本身。删声明。

**35 个多余 `export`**：体检取数员的数、无名单存世。本波以重扫为准（方法与判据见 §2 T3），数字对不上 35 不算异常，以物证入收尾记录。

### 1.3 红 3 甲案触点（共 3 处后端，前端零改动）

| 处 | 现场 |
|---|---|
| 携带 | `wallet-flow-matcher.service.ts:301` `take()` 的 `inTransit.push({...})` 加 `externalTimestamp: ext.datetime`，`InTransitMatch` 接口同步加字段 |
| 落库 | `wallet-recon-run.service.ts:902` 附近在途 create 块（`matchStatus: 'IN_TRANSIT'` 那个）落 `externalTimestamp: it.externalTimestamp` |
| 读端 | `reconciliation-query.service.ts:703` `li.externalTimestamp ? li.externalTimestamp.toISOString() : new Date(0).toISOString()` → 改为如实下发 `null`（DTO 类型随之 `string \| null`，涟漪含 admin-web 类型声明） |

前端 `ReconciliationCasesDetailPage.tsx:1390/:1467` 已有 `timestamp ?? null` → `'—'` 分支，null 自然落既有分支，不改。修好后连带 `rowTimestamp()`（`:303-306`）排序不再把在途行恒排最旧。

### 1.4 权限收回的绑定底数

`rbac.catalog.ts` 里 `INTERNAL_TRANSFER_READ` 共 5 个角色持有：SENIOR_MANAGEMENT_OFFICER（:961）/ INTERNAL_AUDITOR（:1008）/ CFO（:1040）/ TREASURY_OFFICER（:1082）/ **OPS_OFFICER（:1127）**。只摘 OPS 一处，**预期终态 = 4 处绑定**，其余四角色明确保留。前端连带：`FundsOrderDetail.tsx:163-168` 的 Internal transfer 关联链接构造无权限判断，改为按 `PERMISSIONS.INTERNAL_TRANSFERS_READ`（`rbac/permissions.ts:83`，即侧栏同款判据 `DashboardLayout.tsx:273`）条件渲染。

### 1.5 幽灵筛选项底数

`WAIVED` / `PENDING_RECHECK` 在 `ReconciliationCasesListPage.tsx` 共 **6 处**（:74 选项、:91 注释、:95/:97 徽章色、:105/:106 文案），后端两态只有 `OPEN`/`RESOLVED`。**预期终态 = 该文件 0 命中**。注意 :95 与 `OPEN` 同行，摘时保 OPEN。`GovernanceUi.tsx:15` 的 `WAIVED` 是治理域自己的状态色表，**非同款，不动**。

## 2. 任务分解

**T1 · 红 3 甲案**：按 §1.3 三处落笔。约 5-8 行。
**T2 · 删 11 死列**：schema 删列 + 新增迁移；`Incident.walletRef` 连整条恒空管线（§1.1 #11 列明的 5 处）。落刀前每根在 HEAD 复跑三侧 grep（≥2 形态：字面 + `['字段名']` 动态访问由 `-w` 词边界一并覆盖，另补一次 select/include 对象字面量搜法），命中数与预期（除声明行外为 0）不符即停。
**T3 · 死导出与多余 export**：3 个死导出删声明。多余 export 的重扫方法：对三域每个 `export` 符号，全仓（src + admin-web，**spec 文件算消费者**）搜引用；域外及 spec 零消费者 → 去 `export` 关键字保函数体；连声明都零消费者 → 删。闸①②③ 就是复核（有消费者被误摘，编译必红）。
**T4 · 幽灵筛选项**：按 §1.5 摘 6 处。
**T5 · 收权限**：`rbac.catalog.ts:1127` OPS_OFFICER 摘 `INTERNAL_TRANSFER_READ`；`FundsOrderDetail.tsx` 关联链接条件渲染。三件套 + 实登核验（§6）。
**T6 · 写行防线测试**：见 §3。

任务间无执行顺序依赖，但 T6 的键集合断言须在 T2 删列**之后**定稿（键集合以删后 schema 为准）。

## 3. 写行防线测试（T6 细则）

**目标**：下一根「声明了但从未接线」的列长出来时，有断言当场红。波一已证闸① 不咬省略可选字段，这道防线只能测试来建。

- **落点**：`wallet-recon-run.service.spec.ts`（既有 mock 式 suite）。夹具给一条带已知 `datetime` 的外部行 + 一张非终态资金单，走真实生产代码（matcher → run service），断言 `reconciliationLineItem.create` 收到的**入参载荷**：
  1. 在途行载荷的 `externalTimestamp` === 夹具外部行的 `datetime`（值断言，跨越 matcher 与 run service 两层）
  2. 在途行载荷的**键集合**逐键等于预期清单（`Object.keys(payload).sort()` 对白名单）——多写一键、少写一键都红
- **这不是 mock 回显**：回显形态断言的是 mock 返回值等于塞进去的值；本断言的是**生产代码算出的写库载荷**与**上游夹具**的关系，mock 只当捕获器。总纲 §2 两种恒真形态（返回类型即断言集合 / mock 回显）均禁用。
- **变异实证**（收尾必做）：把 `:902` create 块的 `externalTimestamp` 字段删掉 → 断言 1 必红；往载荷里塞一个多余键 → 断言 2 必红。各还原复绿，红的输出入物证。

## 4. 划掉项：External Balances 默认日（订正总纲，业主 2026-09-20 拍板）

总纲 §3 波二行原载「External Balances 被划转回单劫持到『今天』」。本波脑暴实测**证伪**：

- `recon-demo.ts:1894` cutoff 默认 = `new Date()`，全脚本只铸一个账单日 = **铺场当天**（`ymd(cutoff)` 单点）
- 同日提划转，`simulated-custodian-statement.service.ts` 的 `bumpClosing` 按（source, 钱包, 同日）查到种子行走**累加**，查不到也只是同日添行——最大日期不动，页面默认逻辑（Task 15：最大账单日）落点不变
- 所谓劫持只在「铺场是几天前的旧环境」出现，而旧环境下账龄 / SLA / 在途 72h 窗口全在漂，演示纪律本就是演前重铺——为旧环境修默认值属 CLAUDE.md §2「只有故障才触发的技术兜底」
- 账龄到期演法与数据日期无关：⚡拨钟（`case-aging.service.ts` `simulateTimeout()`）拨的是**案子的 `slaDeadline`**，不碰账单日——「全数据当天」不妨碍认损剧目
- 残余边角「UTC 切日在迪拜凌晨 4 点」归波五业务日口径，不在本波

**处置**：零代码改动；验收改为走查实证一步（§6 判据 6）。总纲 §3 波二行与 §5 已同日订正。

## 5. 交付清单命中行（对照 `rules/delivery-checklist.md`）

- ✅ **改 schema** → 新增迁移（空库能建起，无 backfill）+ 收尾重铺闸
- ✅ **改了前端** → preview 渲染 + 截图（§6 判据 4、5）
- ✅ **退役业务动作**（运营的划转页入口）→ 前端入口同步处理：侧栏项本就按权限渲染自然消失，关联链接按 T5 补条件——正是防「幽灵按钮」那行
- ✅ **权限改动** → `db:base:sync` + **重启后端** + `verify:rbac`（总纲波二行点名的三件套）
- ✅ **每轮收尾** → CLAUDE.md §9 报一行 + `CHANGELOG` 一行 + 回写总纲状态行
- ✅ **多波中的一波** → 立波三骨架 + 只写承接不展开
- 未触发：动钱（红 3 落的是展示列，不碰账；但总纲波二行要求 `verify:coa`，照跑当回归）、新增权限组、新增端点、新增业务动作

## 6. 闸与验收

**随手闸**：①②③ tsc 全绿；jest 对账三域全绿；改前端处 preview 截图。

**硬判据**（缺一不算过）：

1. **死列归零**：11 根列名对 `prisma/schema.prisma` grep 终态 0；`npx prisma migrate dev` 产出迁移且空库能建
2. **重铺闸**（动了 schema）：`stack.sh reset` 从零建库 → `demo:all` → `recon:demo:break`，对照 `demo/baseline.md` 全绿；`verify:coa`（恒等式 + 负余额）全绿
3. **红 3 生效**：重铺后场景 1 案件页在途行 Time 列显真实时间（**截图**，不再是 `01-01 04:00`），在途行不再恒排最旧；`grep -rn externalTimestamp src --include='*.ts' | grep -v spec` 命中 ≥3 且含 matcher 与 run service 写点
4. **幽灵筛选摘净**：案件列表页截图无 Waived 选项；`grep -c "WAIVED\|PENDING_RECHECK" ReconciliationCasesListPage.tsx` = 0
5. **权限收回**：三件套全绿（`verify:rbac`）；catalog 绑定 5 → 4（§1.4 四角色保留）；`ops_officer@` 实登截图两张——侧栏无 Internal Transfers、场景 16/17/18 任一划转腿资金单详情无关联链接
6. **External Balances 实证**：重铺同日提交一笔内部划转 → 刷新页面 → 默认日仍为当天、钱包行数不少于重铺后初值（走查记录一行，零代码）
7. **防线变异实证**：§3 两个方向各红一次，红的输出入物证；还原复绿
8. **第六幕五页逐页截图**：无 epoch 时间、无恒空字段、无点了必空的筛选项（总纲波二行原判据）

## 7. 风险与开口

- **删列牵动测试夹具**：mock 行对象若带死列字段，类型收紧后闸① 会红——就地清夹具，**不许为过测试改断言**
- **读端 DTO 改 `string | null` 的类型涟漪**：admin-web 对应类型声明同步，闸② 守着
- **多余 export 重扫数字 ≠ 35**：以重扫为准，物证入收尾记录，不回头凑体检的数
- **T2 若发现某根「死列」在第四种形态（模板串 / 反射）下有活引用**：立即停刀、降级为「提出来」，按总纲 §2 删码判据处理
- **波三前提**：本波不动 Case 状态写点、不拆方法、不抽 helper；波三骨架随收尾立
