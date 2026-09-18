# 共享面清扫站设计稿（Phase 4 · 站4，2026-08-27 α 盘点）

三个交易域换装完毕后，轮到大家共用的地板：审计词汇表的平面老账、模块间的 forwardRef 缠绕、信封辅助枚举的死员。本站只清「确凿的死物」与「确凿的遗物缠绕」，凡属未来站（V8 对账 / V2 客户 / V1 治理）的活词汇一律不碰。

## 盘点结果（α，全仓实测）

**① 审计平面表 292 键的构成**

| 类别 | 数量 | 处置 |
|---|---|---|
| 四本名册在册（V1 45 + V4 31 + V5 25 + V6 18） | 119 | 不动 |
| 已进退役闸（历史写过、闸拒新写） | ~50 | 不动（闸的原料） |
| **零写入 + 未入册 + 未退役**（写入方被历代清扫删净的孤名） | **~125** | **本站删除** |
| 有写入但未入册（属未来站词汇） | 56 | **不动**，各归各站 |

零写入孤名的前缀分布：INCIDENT_* 23 ｜ TX_* 20（旧交易监控簇，如 TX_ALERT_UPSERTED / TX_DEPOSIT_FLAGGED）｜ ALERT_* 8 ｜ FINAL_* 7 ｜ PERIODIC_* 6 ｜ CDD_* 4 ｜ 其余散装——全是 Wave 1-3 已删模块（incidents / alerts / cases / periodic-review / cdd）的名字残骸。

56 个有写入未入册名的归属：V2 客户系 12 + 材料请求 7（V2 站）｜ 对账 RECON_*/SYSTEM_RECON_* 5（V8 站）｜ 治理与监管闸（审批 2 / 监管闸 7 / 档案簿 10 / 登录锁 4）（V1 站）｜ 报价 SWAP_QUOTE_* 3、钱包金库 5、入账信号 5、资金单 1（随各自域，暂无站，留册）。

**② forwardRef 34 处四簇**（交易三域内已于站3清零）

| 簇 | 数量 | 判断 |
|---|---|---|
| sumsub-ingestion 枢纽（6 module 边 + 1 @Inject） | 7 | 站3 断链后仅剩 app+四演示件单向引入枢纽——环已不存在，**疑似全数可直接解包**，开机考实证 |
| 身份域死结（customers ↔ material-requests ↔ material-refresh ↔ onboarding ↔ CRA ↔ tier-upgrade + onboarding.service @Inject） | ~17 | 逐张试解开机考；真环保留并注明成环路径，假环（装载顺序遗物）解包 |
| 治理（users→approvals、access-control→approvals） | 2 | 同上试解 |
| 交易外围（swap/withdraw 报价→定价中心 ×4、withdrawal-fee-level→onboarding、l1-gate→customers、wallets→onboarding） | 6 | 同上试解 |

**③ 信封辅助枚举死员**：AuditEntityTypes 59 键死 27（PAYIN/PAYOUT/RECONCILIATION_BREAK/SAFEGUARDING_RUN 等旧表遗名）；AuditWorkflowTypes 10 键死 6（TRANSACTION/ONBOARDING/PERIODIC_REVIEW/GOVERNANCE_REGISTRY/REGULATORY_GATE/SETTLEMENT）。死键删除。

**④ 枢纽本体**（602 行分发器 + ⚡模拟面板控制器 + 重试服务）：全活（演示件），本站不动结构，只解遗物 forwardRef。

## 本站做

- **A. 孤名大清扫**：~125 零写入孤名从平面表删除。**不进退役闸**——退役闸语义是「历史上写过、防复写」，孤名从未落过一行，库里无痕，删即净。删名判据（每名三查零命中才删）：后端非常量文件零引用 ｜ 前端两仓字面量零引用（同拼写命中须核实是否属状态/审批类型等别的词汇表——是则不算引用）｜ live 库 audit_log_events 零行。spec 文件引用随删同步。
- **B. 枢纽解包**：sumsub-ingestion 7 张 forwardRef 试解，开机考（α2 同款：起栈 + 全模块实例化断言）。
- **C. 外围解包**：身份死结 / 治理 / 交易外围共 ~27 张逐张试解；真环保留 + 注明成环路径（写进模块头注），假环解包。判据 = 开机考通过 + tsc×4 + 全量 jest 净新 0。
- **D. 枚举瘦身**：AuditEntityTypes −27、AuditWorkflowTypes −6 死键删除（同 A 三查判据）。

## 本站不做（对照总纲 §2 + 站序）

- 56 个有写入未入册名的换装注册——各归 V8/V2/V1 站
- V2 客户审计主对象键改造（UUID→customerNo 全面化）——V2 站
- 枢纽分发器的结构重构（拆 switch / 事件化）——分发器是演示件的心脏，能跑不折腾
- 幂等/重试/兼容层——禁做清单

## 竣工记（As-built，2026-08-27）

- **刀A**：处决名单实测 136（盘点估 125），字面量核查赦免 8 个活词（FINAL_APPROVAL_*×6 入职终审在写、TX_*BREAK×2 risk-engine 引用），终删 **128**。顺手删了显示映射表的 10 条死词条与 INTERNAL_FUND 短名死簇（map+builder，Spec#4 遗产零调用方）。平面表 292→164。
- **刀D**：同款三查后赦免同拼写活词（PAYIN/PAYOUT/CONFIG/COA/TRANSACTION/ONBOARDING/PERIODIC_REVIEW），终删 AuditEntityTypes −22、AuditWorkflowTypes −3。
- **刀B**：枢纽实挂 10 张 module 边+1 张 @Inject（盘点漏数 4），全拆开机过——站3 摘演示件后环确已不存在。
- **刀C**：SCC 实算（注释剥离建图，第一版被 imports 数组里的注释骗出两个假环）：全仓唯一真环＝身份六件套，环内 16 张原样留；环外 7 module 边+4 @Inject 拆封。l1-gate/wallets 两张是文件级装载序护身符而非环——枢纽解包拉直装载链后实测不复现，注释留了复发排查指引。
- 判据全过：tsc×4 ｜ 全量 jest 净新 0（基线 4 套件 8 条）｜ 开机考三连（login 200）｜ demo:all 8/8 ｜ verify:coa 全恒等 ｜ verify:audit 3 红=基线成文预期（重铺后零治理动作）｜ 退役码零写入、INHERIT 无孤儿两不变量保持绿。
- 终局记分：**全仓 forwardRef 34→16**，其中交易域 0（站3）、共享面/治理/金库 0（本站）、身份真环 16（成环成员与保留理由见刀C 提交）。
