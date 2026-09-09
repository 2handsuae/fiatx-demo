# 三四五幕（充值/兑换/提现）查缺补漏战役 · 总纲

> 2026-09-09 立 ｜ 依据：`checkups/2026-09-09-acts345-trading-domains.md`（体检）+ 业主两轮追加裁定 ｜ **本文件活到最后一波**，各波 spec 逐波归档时本文件不动；每波收尾按 `rules/delivery-checklist.md` 往下一波 spec 骨架写承接记录。

## 0. 战役目标（业主原话五轴）

业务逻辑清晰合理 ｜ 没有冗余代码 ｜ 没有老旧文档和注释 ｜ 三个交易工作流共享的模块抽离干净 ｜ 前端页面合理且无中文（UI 中文已核为零，剩铁律⑥尾巴）

## 1. 业主裁定台账（总纲级，各波 spec 引用不重抄）

1. **中文注释可以留**——清的是失真注释不是中文（decisions.md 2026-09-09）
2. **充值页补受限横幅**——口径：兑换/提现事前可拦、充值本质不可拦（decisions.md 2026-09-09；BACKLOG §D）
3. **v4:85「三弧误标客户流水」判已过时**——波一删该行，病根只剩管理台 D6
4. **零消费端点**实为 3 条；其中报价取消端点的去留归波二报价单整治定夺
5. **订单域两条第二幕旧账纳入本战役**：制裁客户订单级折叠（F2）、L1/挂起「具体没过原因」说明（D10 管理台侧做、客户面保持藏）
6. **报价单是硬伤，提前做**（2026-09-09 业主原话）
7. **交易域单号统一为「三字母前缀 + 日期序号」**：违规三处 = 提现单 `WD`、资金单 `FO`、提现报价 `WQ-时间戳-随机`；域外 `CU`/`WA`/`AS` 两字母**不动**（客户号刚换装完，动则另立专项）

## 2. 拆波（五波，风险递增、每波独立验收、每波新会话立 spec）

### 波一 · 清地基（纯减法 + 对账本）
- 删死码：18 零调用导出、23 死审计码（15 全零 + 8 仅 spec 逐个判）、12 死表列、5 前端死 util、孤儿 spec `withdraw-fee-income.service.spec.ts`、2 条零消费端点（`GET deposit-transactions/export`、`GET client/withdraw-transactions/:id`）、`/wallet` 孤儿页（现场判删或接入口）
- 修失真注释：抽查已逮 4 条 + 按同模式全量过 402 条带日期/任务号注释（中文不动）
- 文档同步：审计码数 4 处（→47/30/22）、PATCH 描述、3 处函数归属、删 v4:85
- BACKLOG 对账：销 D7、I7①；订正 D11③、F3 行文
- **边界**：不新增任何行为；报价取消端点不动（留波二）
- **验收**：三闸 tsc + 相关 jest 全绿；动 schema 过重铺闸（reset + demo:all 全绿）；净减行数报数

### 波二 · 报价单收口 + 交易域单号统一（业主定硬伤，提前）
- **单号统一**：`WD`→`WDR`、`FO`→`FDO`、提现报价改走 `generateReferenceNo('WQT')`、兑换报价 `QUO`→`SQT`（与 WQT 对称，照 SFC/WFC 先例；前缀名波内 spec 终定，业主可改）；swap `quoteNo` 列改必填；换号判例：**全量 grep 入站链接与前缀假设**（已知硬编码分流 2 处 `reconciliation-query.service.ts:791,795`；scripts/docs 例子全扫），数据重铺零兼容层
- **报价单六问题**：② UUID 清出屏幕与链接（admin `SwapTransactionDetail:442` "Quote ID"、client `Swap.tsx:1049`/`Withdraw.tsx:841`；两个报价列表 navigate 改业务号，报价详情路由随之换键）③ 订单↔报价互链（提现订单详情补报价区块、兑换订单详情报价号改成链接）④ 提现报价补审计三码（对齐兑换 SQT 侧）⑤ 死路由清理（`swap-quotes/:business/:id` 恒 'SWAP' 的死参数）⑥ 取消动作对齐或删（提现页从不取消 vs 兑换页会取消——波内定，倾向对齐）
- **验收**：demo:all 全绿 + 审计按新号可查（第七幕手法抽查报价三码）+ 前端 preview 截图 + 重铺闸（号规变了必重铺）

### 波三 · 业务红项修复（体检两族红 + 小真账）
- 充值冻结留痕五连缺（correlationId select ×2 + evaluateL1 FREEZE 分支补审计 + 验证 .catch 链路真落库）——验收含第七幕按单号实拉冻结链
- 提现 tipping-off 三处快修（status 白名单 / findAllForCustomer 收窄 / client 筛选改 bucket 补集，照充值域抄）
- D6 三弧 kind 分弧（2→CONFISCATION / 3→RETURN / 4→SEIZE）+ 前端文案
- 小真账：E1 冻人 vs 卡单分旗 ｜ E3 operator 真实化 ｜ E5 resubmit 推 deadline ｜ D8 审批深链补 id ｜ I2 keyword 死参数接通 ｜ 充值受限横幅（裁定 2）
- **纪律**：动 swap workflow 期间 demo:all 判红**先取证再 reset**（BACKLOG §A 姿势——1/13 记账失衡悬案的头号嫌疑就在这条路上）
- **验收**：demo:all + verify:coa + 第七幕拉链实证 + 走查截图

### 波四 · 共享抽离（行为零变化）
- deposit↔withdraw 镜像四件套抽公共底座（SLA / webhook router / kyt-verdict handler / demo 两件）；swap 按结构分叉程度决定接入面
- fee-level 双树合一（24 同名方法、3 对 approval 逐字）；16 个审批薄封装收敛
- 三份逐字函数收编（resolveSlaFields / toCustomerView asset 块 / findNonTerminalByOwner——此时已带波三修好的 correlationId）
- `kyt-txn-type.resolver` 归位共享层
- **明确不动**：三个 workflow 本体（业务分叉真实）；SwapLegAccounting↔DispositionService 双胞胎引擎（业主已裁「合并零收益」）
- **验收**：jest 全量 + demo:all 前后逐字一致 + 净减行数

### 波五 · 订单可见面 + 前端收口 + 三幕走查
- **订单级折叠**（F2，裁定 5）：制裁客户收单后连状态变化都不产生——折叠语义是设计岔口，波内 spec 脑暴（波三快修的白名单留作纵深防线）
- **L1/挂起原因说明**（D10 管理台侧）：CUSTOMER_RESTRICTION 格带具体因由 + 限制便签号（现只说"被限制"不说为什么，l1-gate.service.ts:114 detail 无 cause）；客户面保持藏
- 三域详情路由 `:id`→业务号（照客户域前例，此时号规已在波二定妥）；分页组件统一；恒空展示位清理（confirmations / sumsubActionId / FundsOrder 7 链上字段——删展示或模拟器补写，现场判）；顺手项（"0m"→"<1m" 等）
- **三幕完整走查截图收官**；剧本细化到站级与否 = 业主偏好（体检时留的岔口，波五 spec 时再问一次）
- **验收**：preview 截图比对 + 三幕走查 + 重铺闸

## 3. 明确不做（留账放下，防范围爬）

通知本体 I1（横切件）｜ TR 对手方 VASP 自动打标（依赖 V3 地址打标）｜ 小额计次自动冻结、自动没收 cron（spec 已 deferred）｜ SLA 管理台可配 ｜ 兑换 FAILED 终态 ｜ D10 客户面细分（tipping-off 保守是刻意）｜ D9 无 applicantId 卡单（讲词覆盖）｜ 全站 CU/WA/AS 换号（另立专项）｜ swap 腿推单 effectiveDate（对账域）

## 4. 悬案纪律（贯穿全战役）

BACKLOG §A 🔴 `demo:all` 偶发客户侧记账失衡（≈1/13，铁律⑤）：不排波、不主动追，但**任何一波跑 demo:all 判红都先按 §A 的取证姿势抓现场再 reset**——嫌疑集中在 swap 腿自愈 attempt 重建 + TB 落账不受 SQL 事务回滚保护。

## 5. 承接与归档

- 每波开工：新会话读本总纲 + 上一波承接记录，与业主脑暴后立该波 spec（骨架先立：总纲链接 / 承接节 / 已定事实 / 待定岔口）
- 波一不需脑暴（纯减法），可直接立 spec 开工
- 派 subagent 一律带项目总纲 §0–§5 要点；模型分层按项目 CLAUDE.md §6
- 全战役收官后：本文件随各波 spec 一并移 `archive/`，CHANGELOG 一波一行
