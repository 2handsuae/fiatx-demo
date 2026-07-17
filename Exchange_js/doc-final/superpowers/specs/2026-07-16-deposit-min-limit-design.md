# 充值最低限额（Deposit Below-Min）— 设计 spec

日期：2026-07-16 ｜ 状态：设计定稿（业主逐节确认）｜ 前置：Transaction Limit 模块（同日 spec，已实现 A/B/D1 接提现/兑换）

## 0. 一句话定位

充值只有 SINGLE 限额、只有下限（min=100 原生币种，max=∞）。充值是被动入金——钱先到、判定在后，所以低于 min **不是拒绝，是"建单隐藏 + 挂起 + 运营处置"**。

## 1. 核心决策链（脑暴定调）

- **建单照旧,不延迟、不省略**（业主问"建后隐藏 vs 不建 vs 等 CONFIRMED 再建"三选一的结论）：
  - 不建单 → Step1 记账无载体、对账外部行配不上 → 实时 1:1 当场 BREAK，还得另造"无主资金"实体（V4 孤儿充值深水区）。否。
  - 等 payin CONFIRMED 再建 → 孤儿资金单窗口；三视图投影按父 FK 分类（payin = depositTransactionId≠null），没爹的资金单三个视图都进不去、事件链没人接。且 crypto 金额在 detected() 就已知，等待零收益。否。
  - **建单 + 客户面隐藏** ✅：写模型一切照旧（FK 铁链/Step1 记账/对账配对全保），只动读模型。原则：**可见性是呈现层的事，不为它扭曲写模型**（tipping-off 映射同源先例）。
- **法币 below-min 是经济攻击面**（业主发现）：客户打 5 AED、平台银行成本 11 AED → 每笔净亏。防线地基 = 法币打款走 VIBAN，打款人是自己的 KYC 客户，可识别可处置。应然了断 = **没收入费**（T&C 授权），攻击经济学从"无限放血"变"每打一笔自损一笔"。虚拟币 gas 出金方付，隐藏挂起即可。
- **below-min 留 COMPLIANCE_PENDING，不进 FROZEN**（业主定调）：金额线是配置闸不是合规红旗；FROZEN 语义/转移与本场景无关，**本轮不碰 FROZEN 任何代码**。
- **双层授权**（业主 Q3 定调）：
  - 客户授权 = **T&C 事前合同授权**（VARA 口径：费用须"按协议到期应付"才从 Client Money 变公司钱）。demo 不建协议管理，但没收动作的审批/审计单**必须带固定依据字段**（`basis: "T&C §x below-minimum deposit handling fee"`）。副产品：两腿资金单恰好执行"公司钱混客户账户 ≤1 日历日须移出"的法定动作。
  - 内部授权 = **maker-checker**：Confiscate 按钮开审批单（V1 引擎，新 actionType `DEPOSIT_CONFISCATION`，单步 OPS_OFFICER），批准后才执行。**PASS 不走审批**（刻意不对称：放客户自己的钱=低风险单人+审计；拿客户的钱=高风险四眼）。

## 2. 流程（应然全图）

```
钱到 → detected()：照旧建 DepositTransaction + payin 资金单
     → 当场判 min（TransactionLimitRulesService.getSingleRule('DEPOSIT', assetId)，原生币种直比）
        低于 min → deposit 落 limitHoldReason='BELOW_MIN'（出生即带标）
     → payin 照常推进 → CONFIRMED → Step1 照常记账（CLIENT_ASSET→DEPOSIT_SUSPENSE）
     → deposit → COMPLIANCE_PENDING
     → checkAutoApproval 加 BELOW_MIN 闸（与 trading-ready 挂起同款：打审计 DEPOSIT_HELD_BELOW_MIN、永不自动放行、不启动 L2）
     → 客户端：列表/详情服务端过滤 BELOW_MIN 单（客户从第一秒起完全看不见）
     → admin 详情两按钮：
        【PASS】     摘 hold 标 + 审计(DEPOSIT_LIMIT_WAIVED) + 重跑 checkAutoApproval → 进 L2 → 全过才 Step2
                     （豁免的是金额线，不豁免合规——两闸正交）
        【Confiscate as fee】 开审批单(DEPOSIT_CONFISCATION, OPS_OFFICER 单步, 快照含金额/币种/依据条款)
           批准 → 见 §10 异步两阶段没收（2026-07-17 取代下列同步流）
           拒绝 → deposit 留 COMPLIANCE_PENDING（可再发起）
```
> ⚠️ 下列同步没收流为 D7 初版，**已被 §10 异步两阶段重设计取代**（2026-07-17）；保留仅作演进对照。
> 初版：批准 → 建 legSeq=2 资金单秒 CLEAR → 单相 executeTransfer 记两腿 → deposit 直接 CONFISCATED。

- 两腿之后客户侧/公司侧恒等式双双保平；逐钱包对账两边都有行（资金单外部镜像照常）。
- min 判定**出生时落标**（detected()），checkAutoApproval 读标——判定确定性从第一秒起；之后运营调低 min 不会静默放行存量挂单（存量走 PASS 处置）。

## 3. 数据与接口改动

- **DepositTransaction 加列** `limitHoldReason String?`（现值域仅 'BELOW_MIN'，将来其他 hold 复用）。
- **状态机**：`CONFISCATED` 入正式枚举 + 转移表（COMPLIANCE_PENDING→CONFISCATED 仅经审批链）。FROZEN 相关不动。
- **客户面过滤（业主特别叮嘱）**：客户侧充值**列表 + 详情**端点服务端过滤 `limitHoldReason='BELOW_MIN'` 的单（列表不出现；详情按不存在处理）。过滤在**服务端**做，非前端隐藏——防直连 API 看到。admin 端点不过滤，列表加 BELOW_MIN 标识。
- **三视图投影扩一行**：`depositTransactionId≠null 且 legSeq>1 → internal 视图`（照抄提现 fee 腿分类，`funds-order-source.repo.ts`）。
- **审批**：新 actionType `DEPOSIT_CONFISCATION`（approval.constants 注册 + 单步 OPS_OFFICER 策略 + decided 事件 handler 执行 ①②③）。
- **审计**：`DEPOSIT_HELD_BELOW_MIN` / `DEPOSIT_LIMIT_WAIVED` / 没收三打点（REQUESTED/APPROVED+EXECUTED/FAILED），依据字段随单。
- **种子**：`transaction_limit_rules` 补 DEPOSIT SINGLE 行（每资产 min=100 原生币种，maxAmount 空=无穷大）。
- **配置台**：Transaction Limits 页 DEPOSIT 行自然显示（现有单列表+类型筛选直接吃到，无 UI 改动）。

## 4. 明确不做（记 BACKLOG）

- **原路退回**：依赖反向分录 + 真实对外付款（半个提现流）——挂 roadmap V4 P0 族，独立立项。
- **below-min 计数 → 自动冻结客户**：反滥用闭环后续（牵 V2 冻结流）；本轮审计可查次数，不自动动作。
- **没收超期自动兜底（cron）**：本轮纯手动。
- **trading-ready 挂起自动重驱**：既有 BACKLOG 债，本轮不碰。
- **制裁没收（FROZEN 坐实路径）**：审批人应然是 MLRO（合规域），与本轮费用性没收（财务域 OPS_OFFICER）**不共用审批链**——将来单独做。

## 5. 验证

- 单测：detected 落标 / checkAutoApproval BELOW_MIN 闸 / PASS 摘标重跑 / 没收两腿记账 / 客户面过滤
- e2e：小额充值 → 客户列表不可见 → admin 可见带标 → PASS 路径入账 / Confiscate 路径审批→两腿→CONFISCATED
- 回归：`verify:coa` 四式恒等（含没收后）、`demo:all` 不受影响（demo 金额 3000/8000 ≫ min 100）、recon 没收单钱包对账平
- 渲染截图：admin 处置按钮 + 审批单 + 账本两腿流水；客户端列表前后对比（隐藏生效）

## 6. 文档同步义务（实施时）

truth v4-deposit（BELOW_MIN 挂起/CONFISCATED 治理化/客户面过滤/§10 异步没收）+ v3-financial-config（DEPOSIT 限额行）+ funds-orders（deposit legSeq>1 投影 + 没收两阶段）+ BACKLOG（§4 各账）+ roadmap V4（异常终态回退 P0 部分兑现标注）。

## 10. 没收异步两阶段重设计（2026-07-17，业主定，取代 §2 同步没收）

**底层逻辑**：没收是真实资金移动（客户托管钱包→公司钱包），应与内部转账/提现资金单**同构**——异步步进 + pending/post 两阶段记账，而非 D7 初版的"同步一把梭"。

### 状态机
- 新增 deposit 中间态 **`CONFISCATING`**：`COMPLIANCE_PENDING → CONFISCATING → CONFISCATED`。
- `CONFISCATING` = **承诺态，只进不退**（除人工介入）——一旦审批通过进入，pending 两腿始终锁定，钱不漏回也不双扣。
- 转移表加 `COMPLIANCE_PENDING →(CONFISCATE_START)→ CONFISCATING`、`CONFISCATING →(CONFISCATE_SETTLE)→ CONFISCATED`。

### 流程（三段）
```
① onConfiscationDecided(APPROVED):
   deposit → CONFISCATING(via service updateStatus, Rule 5)
   建 legSeq=2 INTERNAL 资金单, initialStatus=CREATED(可步进,不再秒 CLEAR)
   两腿 PENDING 锁定(executePendingTransfer, 同 swap-leg-accounting 的 executePendingTransfer):
     腿1: DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM)  ← Step1 反向
     腿2: DR FIRM_ASSET(SYSTEM) / CR FIRM_FEE(SYSTEM)             ← 平台收入
   审计 DEPOSIT_CONFISCATION_STARTED(暂名, 或复用 REQUESTED 后置)

② ops 手动步进资金单(现成 ⚡ 面板 POST /admin/funds-orders/:no/advance):
   CREATED → SUBMITTED → CONFIRMING → CONFIRMED → CLEARED
   (与内部转账/提现 payout 同一步进机制, 无新端点)

③ handleFundsOrderChanged(FUNDS_ORDER_STATUS_CHANGED, 扩现有 handler):
   event.legSeq===2 且 status===CONFIRMED →
     两腿 POST 结算(postPendingTransfer, 同 withdraw onPayoutLegConfirmed):
       ├─ 成功 → deposit → CONFISCATED + DEPOSIT_CONFISCATION_EXECUTED 审计
       └─ 失败 → 同步自动重试 3 次
            ├─ 某次成功 → CONFISCATED
            └─ 3 次全败 → deposit 停在 CONFISCATING(不回退) + DEPOSIT_CONFISCATION_FAILED 审计
                          (标"需人工介入", pending 锁定保留)
```

### 接线锚点（已核实）
- 事件：`DomainEventNames.FUNDS_ORDER_STATUS_CHANGED`（含 `legSeq`/`status`，提现 payout post 同源）→ `deposit-workflow.service.ts → handleFundsOrderChanged()`（现 `legSeq!==1 return`，扩 legSeq===2 分支）。
- 两阶段记账：`accounting.service.ts → executePendingTransfer()/postPendingTransfer()/voidPendingTransfer()`（swap-leg-accounting / withdraw-workflow 现成模板）。
- 拆分：`executeConfiscation` 拆成 `startConfiscation`（① pending+CONFISCATING，挂 onConfiscationDecided）+ `settleConfiscation`（③ post+CONFISCATED+重试，挂 handleFundsOrderChanged legSeq2）。
- 资金单建单：`fundsOrders.create({ initialStatus: CREATED })`（原 CONFIRMED 改 CREATED，不 auto-CLEAR）。
- 前端：CONFISCATING 状态徽章（`StatusPill` + 状态色，进行中色如 amber）；详情页 CONFISCATING 期间显示没收资金单在途（Fix 2 已就位）。

### 失败/边界
- **POST 重试**：同步 3 次（demo 级）；真异步结算的 backoff/cron 重试 → BACKLOG。
- **卡住的 CONFISCATING 人工介入**：demo 先"停住+FAILED 审计标记"；"一键重试 settle"的 ops 动作 → BACKLOG。
- **幂等**：settle 前查 deposit 已 CONFISCATED 则 no-op（重复事件/重放）；pending 已存在则不重复锁。
- **先账后状态铁律不变**：post 成功才翻 CONFISCATED。

### 验证增量
- 单测：startConfiscation(CONFISCATING+pending+funds order CREATED) / settle 成功(post+CONFISCATED) / settle 失败重试 3 次后停 CONFISCATING / 幂等 no-op。
- e2e：审批通过→CONFISCATING→⚡步进资金单到 CONFIRMED→CONFISCATED；verify:coa 全平（pending 与 post 两态都不破恒等）。
