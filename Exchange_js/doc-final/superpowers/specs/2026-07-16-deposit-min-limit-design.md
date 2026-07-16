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
           批准 → ① 挂 deposit 下建第二张资金单（legSeq=2, INTERNAL, 客户托管钱包→公司钱包）
                  ② 资金单 CLEAR 记两腿：
                     腿1(客户侧) DR DEPOSIT_SUSPENSE / CR CLIENT_ASSET   ← Step1 反向分录（roadmap V4 ⚖️P0 第一块）
                     腿2(公司侧) DR FIRM_ASSET / CR FIRM_FEE            ← 确认平台收入
                  ③ deposit → CONFISCATED（终态，治理化取代现 PATCH 直改的半截桥）+ 三打点审计
           拒绝 → deposit 留 COMPLIANCE_PENDING（可再发起）
```

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

truth v4-deposit（BELOW_MIN 挂起/CONFISCATED 治理化/客户面过滤）+ v3-financial-config（DEPOSIT 限额行）+ funds-orders（deposit legSeq>1 投影）+ BACKLOG（§4 各账）+ roadmap V4（异常终态回退 P0 部分兑现标注）。
