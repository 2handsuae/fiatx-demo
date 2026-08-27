# V1 治理站设计稿（Phase 4 · 站7·末站，2026-08-27 α 盘点）

末站双重使命：治理域自身收口 + **全仓词表封册**（收官基线复跑前，任何词都要有名册归属或进退役闸，此后靠守册测试锁死）。

## α 盘点

**好消息（地基站已干完的）**：V1 名册 45 码全部接线（唯一疑似零写方 ADMIN_PASSWORD_RESET_SELF_COMPLETED 实为变量式写入）；审批域信封已带子表；监管闸/档案簿键法已是业务键（gateNo/registryNo）；AUDIT_LOG_QUERIED 已按"唯一许可的 controller 直写例外"接线。

**待办census**：

1. **risk-engine 整模块已死**：app.module 不挂载、全仓零 import（站6 拆掉最后消费方）。⚠️ 6/17 记忆"实为 LIVE 勿删"已被站6 事实推翻——站4 为它赦免的 TX_RECONCILIATION_BREAK_DETECTED / TX_SAFEGUARDING_BREAK_DETECTED 两词随葬。
2. **有写方未入册 27 词**（剔除误报后）六簇：治理 13+5 变量式 UPDATED（监管闸 7 / 档案簿 5 簿×增改 / APPROVAL_REQUIRED_MISSING）｜ 充值入账信号 5 ｜ 兑换报价 3 ｜ 金库 3（含 DEPOSIT_WALLET_CREATE_FAILED——**失败单独起名，违既有裁决**）｜ 记账 1 ｜ 对手方 1 ｜ 资金单 1。
3. **监管闸/档案簿信封缺域缺子表缺 requestId**（键法已对）；AUDIT_LOG_QUERIED 幂等键无盐——注释自陈"实质上只会落一条"，违 8/20 randomUUID 定式（Q6 只能亮一次的根因）。
4. 死出口 5 具（修正法扫描：同文件使用计入活）。

## β 五刀

- **刀A 死码**：risk-engine 整模块删（三份常量文件；TX_*BREAK 两词一并出表）+ 5 具死出口。
- **刀B 治理词入册（V1 名册 45→~64）**：APPROVAL_REQUIRED_MISSING 归 APPROVAL 域；监管闸 7 码、五本档案簿 10 码（CREATED/UPDATED×5）归 CONFIG 域。全部现名保守。
- **刀C 散词归置（各回各家）**：入账信号 5 码 → V4 充值册｜报价 3 码 → V6 兑换册｜DEPOSIT_WALLET_CREATED **并双结局**（CREATE_FAILED 退役，failure=outcome+reasonCode）→ V4｜WALLET_STATUS_UPDATED / MANUAL_TB_ACCOUNT_CREATED / LP_CONFIG_UPDATED / FUNDS_ORDER_ADVANCED → V1 CONFIG 域（平台运营件）。
- **刀D 布线**：监管闸/档案簿两个 recordAudit 助手补 actionDomain/subjects/requestId；散词写点补同款；AUDIT_LOG_QUERIED 幂等键加盐（Q6 每次真实查询都留痕）。
- **刀E 封册（末站之锚）**：守册测试——平面表键集 ≡ 六本名册 ∪ 退役闸，多一词少一词都红；写点扫描闭合（全仓 action 字面量/常量 ⊆ 封册集合）。此后新词必先入册，词表永不再散。

## 不做

审批机制/RBAC 语义改动 ｜ 通知域（零审计词）｜ 身份三模块小环（真环留档）｜ Q6 转绿所需的"演示中真点一次审计页"（那是演示剧本的事，不造假数据）
