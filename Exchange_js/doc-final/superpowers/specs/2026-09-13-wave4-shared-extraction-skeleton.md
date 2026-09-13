# 波四 · 共享抽离（行为零变化）· Spec

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波四 ｜ 2026-09-13 立（骨架展开，业主脑暴三岔口全闭环）｜ 基线 main `2cf7ea77`（波三合并基线，开工以现场 HEAD 为准）｜ 相似度数字 = 2026-09-13 主会话归一化 diff 实测（域名 token 抹平后量相同行占比，残差偏保守）

## 0. 本任务做 / 不做

**做**：A 充提镜像五件抽公共底座（兑换零接入）｜ B 三份函数收编（甲案信封式）+ 广播冻结审计补 OWNER（同文件同批）｜ C fee-level 双树合一 ｜ D kyt-txn-type.resolver 归位 ｜ E §A 幻影失衡修复 ｜ F 兑换 FAILED/REVERSED 死枚举清除（业主 2026-09-13 拍板并入）｜ 顺手项五条（§9）

**不做**（对照项目总纲 §2 与战役总纲 §3）：幂等/去重/重试/并发锁/防御校验等 §2 全清单 ｜ 三个 workflow 本体（业务分叉真实）｜ SwapLegAccounting↔DispositionService 双胞胎引擎（业主已裁）｜ **兑换接底座**（今日定案 1）｜ **客户可见性常量抽共享**（今日定案 2，骨架"第三份镜像件候选"假设被 diff 证伪）｜ **16 审批薄封装收敛**（今日定案 3，与总纲原文出入，收尾记 decisions.md）｜ 域外债：审计证据包导出 deposit/withdraw 链恒空（业主拍板归第七幕轮，BACKLOG §H 在册）

## 1. 承接上一波（波三业务红项修复收尾时填写，2026-09-13，原文保留）

- 波三合并基线 commit：`2cf7ea77`（ff 合入 main；15 commits；主栈 reset+sync+demo:all+coa 收官全绿，后端日志零审计写失败）
- 总纲预告的抽离前提已就绪：`findNonTerminalByOwner` 三域均已带 `correlationId`（波三 A 族）——「三份逐字函数收编」可按修好后的版本收
- **§A 悬案根因已数据层坐实**（2026-09-13 现场取证，证据 `.superpowers/sdd/coa-evidence-20260913/`）：account_flows 落行 id 十六进制未补零（1/16 每 id）→ 字符串 join 读面随机丢行 → 幻影失衡；TB 与镜像双边齐全。BACKLOG §A 已改述。**波四动 deposit↔withdraw 共享面时 demo:all 判红按此秒诊**；修复本体**业主 2026-09-13 拍板并入波四**（见 §7）
- **留给波四的顺手项**（终审 triage 留档可合并清单，波四动到同文件时顺手清）：
  1. swap-workflow.service.ts 的 CustomerAccessService 双重注入（`customerAccess` :176 / `customerAccessService` :189 同一服务两参数名）——共享抽离动 swap 面时合并成一个
  2. swap-transactions.service.spec 补 `LEG_SETTLEMENT` operator 断言一行（波三 E3 六标签唯一无测试覆盖的）
  3. audit-logs.service.spec mock 行残留 entityType/entityId/entityNo 无效字面量（测试卫生）
  4. deposit-workflow.service.spec 冻结审计断言补 fromStatus/toStatus 两键（恰是 INHERIT 闸 requiredFields）
- **新判例三条**（波三沉淀，写 plan/扫描时用）：
  1. `grep -v` 过滤条件会把双关行滤掉（同行既有目标又有排除词）——普查配方新盲点形态，jest 红灯逮回的
  2. 工具按可见文本点击会命中外层 td 触发行级 onClick——截图器验证格内链接要用无行点击歧义的详情页
  3. 种子人设假设写进 brief 前先查 seed（Frank 的冻结是 demo:all 运行时才有，基础种子 SILENT 持有者是 Carol；Ivy 的 scopes 不含 DEPOSIT）
- **域外债在册待清**（不属波四范围，防误并）：审计证据包导出 deposit/withdraw 链恒空（5 个不存在的 Prisma 模型 + 业务号匹配 id 列，BACKLOG §H 已登记）——**业主 2026-09-13 拍板归第七幕（审计追溯）轮修**

## 2. 业主定案（2026-09-13 脑暴三岔口闭环，收尾进 decisions.md）

1. **兑换零接入**：公共底座只服务充值↔提现镜像对，兑换五件全部保持独立演进。证据：归一化相似度 充↔提 68–92% vs 兑换↔另两域 22–53%（SLA 仅 22%：无软 SLA 结构整体不同；verdict 45%：applicant-action 方法名完全不同；router 53% 且兑换是三级级联最后一棒、独担孤儿兜底 warn，职责本身不同）；唯一 84% 的 demo 控制器仅 50 行，省约 40 行不值三域耦合。零接入让边界一句话讲清：**充提共底座，兑换独立演进**。
2. **客户可见性常量不抽**：deposit `CUSTOMER_BUCKETS`/`CUSTOMER_STATUS_PASSTHROUGH`/`CUSTOMER_COMPLETED_STATUSES` 与 withdraw `WITHDRAW_CUSTOMER_*` 是**同款设计、不同内容**（桶名单分叉：充值有 RETURNING/CLAWED_BACK、提现有 REJECTED；透传集 8 vs 6；完成态集合不同），且充值侧带成段域内合规注释（CLAWED_BACK 与 tipping-off 关系）。抽共享只得空壳形状类型，一行重复内容省不掉。两域各留各的。
3. **16 审批薄封装不收敛**：实数全仓 **36** 个类继承 `ApprovalHandlerBase`（16 纯薄壳散布身份/金库/交易/治理/审计/清结算），工厂化触面横跨 20+ 模块超出交易域波次边界；只收交易域内会造成同家族两种写法。净省约 160 行买不回全仓审批链的行为零变化验证成本；且类名即 NestJS DI 令牌、可 grep 直达。**记明确不做，防后人重提。**
4. **findNonTerminalByOwner 收编取甲案（信封式）**：plan 前实测推翻"三份逐字"前提——swap 的 select 多 `fromAmount`（站3 出生锁：冻结留痕携退还金额），三域终态排除集、单号字段名本就不同。甲案 = 共享 helper 锁死审计信封必带键（ownerNo/correlationId/traceId），各域传自己的终态集/单号字段/额外列——防的正是本波修的"swap 有、充提漏"漂移病（correlationId、ownerNo 已连漂两回）。
5. **兑换 FAILED/REVERSED 死枚举并入本波清除**：2026-09-13 实扫零写入点（迁移表两行空 `{}`、零入边；复现命令 `grep -rn "REVERSED" src/ admin-web/src client-web/src --include="*.ts" --include="*.tsx" | grep -v spec`，命中全为读侧防御性包含）。"历史行兼容"的保留理由与重铺教义冲突已不成立；且甲案的终态集参数化正好要它先死干净。

## 3. A · 充提镜像五件抽公共底座（兑换零接入）

五件（充↔提相似度）：SLA service（159/157 行，68%+，残差多为缩写 token）｜ webhook router（74%）｜ kyt-verdict handler（86%）｜ demo-scenario（83%）｜ admin-demo-controller（92%）。

- **形态**：照仓内 `ApprovalHandlerBase` 现成先例——**抽象基类装公共逻辑 + 域内薄子类**（注入各自依赖、声明各自常量表/文案）。不引入泛型工厂等新模式。
- **落点**：`src/modules/sumsub-shared/`（kyt-webhook-types、verdict-buttons.shared 已住此）。
- **级联语义不动**：`SumsubIngestionService` 的 deposit→withdraw→swap 三级分流、swap 侧独担孤儿 warn 的分工原样保留；router 基类不得吸走这个差异。
- **兑换五件零改动**（定案 1）；唯一例外是注释更新：swap-webhook.router 头注 "deliberate fork，三域各自演进不共享基类" 的历史口径改为 "充提共底座、兑换独立演进"，防注释说谎。
- demo 两件的切分线：DemoScenarioActor/VERDICT_OF 等逐字部分进基类，剧本内容（各域状态机专属步骤）留域内。

## 4. B · 三份函数收编（甲案）+ 广播冻结审计补 OWNER

**前提勘误**（2026-09-13 实测，修正总纲与体检的"三份逐字"提法）：三份中只有 asset 投影块真字节级相同；`resolveSlaFields` 仅差各域时长表常量；`findNonTerminalByOwner` **非逐字**——swap select 多 `fromAmount`，三域终态排除集、单号字段名不同。

**先补后收，同文件同批：**

1. **补 OWNER**（业主拍板并入，BACKLOG 在册条）：deposit/withdraw 两域 `findNonTerminalByOwner` 的取数面补客户号，使广播冻结审计按客户号可查；连带核对两域 `onCustomerRestrictionOpened` 广播路径的审计调用把客户号真传进信封（select 有、审计不传=白补）。
   **执行期勘误（2026-09-13 栈级检查逮回）**："select 补 ownerNo 对齐 swap"的原提法在 schema 层不成立——DepositTransaction **没有 ownerNo 列**（withdraw/swap 有且全填充）。终态实现：信封必选参数 `ownerNoSource: 'column' | 'customerRelation'`，deposit 走 `customer.customerNo` 关系取数（depositAudit 现成读法天然兼容），withdraw/swap 走原生列；业主意图（按客户号可查）不变。
2. **asset 投影块** → 共享纯函数 `toCustomerAssetView(asset)`（`{currency, code, network, decimals} | null` 8 行），三域调用（swap 双资产调两次）。
3. **resolveSlaFields** → 共享泛型 `resolveSlaFields(minutesByStatus, nextStatus)`，域内保留原签名薄壳委托（deposit 的是公开方法有外部调用方，签名不动）。
4. **findNonTerminalByOwner** → 甲案（定案 4）：共享 helper 锁死信封（where 形状 + select 必带键 id/单号/ownerType/ownerId/**ownerNo**/status/traceId/**correlationId**），各域参数传：Prisma delegate、单号字段名、终态排除集、额外列（仅 swap `fromAmount`）。各域业务注释（终态排除的两段为什么）留在域侧调用点。
5. 落点：`src/modules/trading/shared/`（新建或沿用现有共享层，plan 时按现场定）。

**专项验收**：demo:all 后按 Frank 客户号在审计页查到广播冻结行。**销账**：BACKLOG 广播冻结审计条。

## 4-bis. F · 兑换 FAILED/REVERSED 死枚举清除（业主拍板并入，定案 5）

- 删 `SwapTransactionStatus.FAILED/REVERSED` 两枚举成员 + 全部 8 处读面引用：后端 4（swap-transactions 终态集与迁移表空行、swap-workflow 终态集、transaction-limit-gate `SWAP_COUNTED_EXCLUDE`）｜ admin-web 2（`swapStatusMap.ts` 映射条目 + Exception 筛选组两项）｜ client-web 1（`Swap.tsx` 终态集）；相关"死枚举"注释同步清。
- 甲案的 swap 终态集参数在清除**之后**定稿（不把死枚举抄进共享参数）。
- **可见变化**：管理台兑换筛选 Exception 组少两个永远筛不到的选项——触发⑤截图闸（本波唯一前端改动）。
- **销账**：BACKLOG「V6 兑换 FAILED/REVERSED 死枚举」条。

## 5. C · fee-level 双树合一

withdrawal-fee-level 1673 行 / swap-fee-level 1844 行：24 同名同序方法、`moveLevel` 仅 model 名不同、3 对 approval 归一化 diff=0、三对 workflow diff 仅 16–45 行。

- **性质界定**：这对是真镜像（照抄出身），不属"兑换工作流分叉"——与定案 1 不冲突（定案 1 管的是 sumsub 侧五件套）。
- **形态**：同 §3 基类模式；Prisma model 差异（withdrawalFeeLevel vs swapFeeLevel 表）经域侧薄层收口；**controller/路由/权限码零变动**。
- **⚠️ 6 个审批薄壳不动**：3 对 approval 文件虽 diff=0，但各自 actionType/workflowType 不同（WITHDRAWAL_FEE_LEVEL_* vs SWAP_FEE_LEVEL_*），合并它们=工厂化=定案 3 已否。执行时不得"顺手合并"这 6 个类。

## 6. D · kyt-txn-type.resolver 归位

从 `deposit-sumsub` 迁 `sumsub-shared`，消掉唯一跨域 import（withdraw 跨域引用 deposit 模块文件）；import 路径全量更新，行为零变化。

## 7. E · §A 幻影失衡修复（业主 2026-09-13 拍板并入）

- **根因**（已坐实，证据 `.superpowers/sdd/coa-evidence-20260913/`）：account_flows 落行 id 十六进制未补零（1/16 每 id）→ 字符串比对读面随机丢行 → 幻影失衡；TB 与镜像双边实际齐全。
- **修法**：落行处 id 拼写补零归一（`padStart(32,'0')` 方向）；连带排查 `tbTransferId` 同病 + 所有按字符串比对 id 的读面（`buildCoaBalanceMap` / `WalletBalanceCheckerService` / 对账引擎）。
- 历史库不管（重铺解决存量）；无 schema 迁移、无 backfill。
- **专项验收**：demo:all 连跑零幻影失衡（次数 plan 定，下限 10——历史失衡率 1/13，10 连绿才有判别力）+ 封存副本的复现命令在新库上零孤儿行。**销账**：BACKLOG §A 🔴 条。

## 8. 顺手项（动到同文件时清，五条）

swap-workflow 双重注入合并 ｜ swap spec 补 LEG_SETTLEMENT operator 断言 ｜ audit-logs.service.spec mock 残留清理 ｜ deposit-workflow.service.spec 冻结审计断言补 fromStatus/toStatus（前四条见 §1 承接原文）｜ withdraw dto 头注"20 边"改 23（2026-09-13 实扫逮到的文档锈：迁移表实为 23 边，注释停在 task-1 定稿时点）。

## 9. 验收口径

- 随手闸：三处 tsc + **jest 全量**（本波触面广，不做目录级豁免）。
- **行为零变化主判据**：demo:all 重构前后输出一致——volatile 字段（时间戳/单号/uuid）归一化后 diff；**净减行数**为唯一正向指标。
- 收尾闸：⑥ `on-stack demo:all` 断言终态 ｜ ⑦ `verify:coa`（§A 动了钱的读写面，永不豁免②）｜ ⑧ **重铺闸**：§A 改落行格式虽非 schema，其验收本身要求从零建库连跑——按重铺闸走（`stack.sh reset` + demo:all，判据对照 `demo/baseline.md` 全绿）。
- 前端改动仅限 F 死枚举清除两文件（admin `swapStatusMap.ts`、client `Swap.tsx`）——⑤截图闸对兑换列表筛选面各截一张；其余任务不得动前端文件。
- 测试的绿必须来自行为；禁止「扫源码文本」型断言。

## 10. 收尾交付（delivery-checklist 命中行，plan 写死）

- **「多波中的一波」**：立**波五骨架**（总纲链接/空承接节/已定事实/待定岔口）+ 承接记录写进波五骨架开头（实际偏差/新事实/波五前提变化——波五前提之一"号规已在波二定妥"仍真，需确认共享抽离未动路由）；不代写波五 spec。
- **「每轮收尾」**：CHANGELOG 一行 ｜ BACKLOG 销账（§A 🔴 幻影失衡条、广播冻结审计 OWNER 条、V6 死枚举条）｜ decisions.md 记 §2 五定案 ｜ modules 文档同步（v4/v5/v6 及 overview 涉共享层结构处；v6 状态机数字随 F 更新：7 枚举→5 态）｜ §9 报告行。
- worktree 隔离执行，合并后清 worktree+分支；合并进 main 后重启后端 + `db:base:sync`（例行）。
