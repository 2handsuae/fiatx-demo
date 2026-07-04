# Product Roadmap

Last Updated: 2026-07-03

**三层分类**（按需求来源）：
- **MVP** — 领导定义的基础必须（非常基础，未必行业惯例，但领导要）
- **ADVANCED** — VARA gap 补齐（rulebook 理论要有）+ 低频逆向操作（上线 MVP、下线 ADVANCED）。`⚖️` = 有具体条款号，rulebook 变版时逐条复查
- **OPTIMIZED** — VARA 不强制、行业多半这么做的未来优化

**每条标注**：`来源:`（领导/VARA 条款/行业）｜ `配对:`（正逆操作互链，防逆向遗忘）｜ 状态 `[x]`交付 `[~]`部分 `[ ]`待做 + 日期。
**实现细节与当前真相** → `reference/truth/`（改代码同步那里，不改这里）｜ **技术债/死码/待决策** → `../BACKLOG.md`。
> ⚠️ 三层分类 + truth 外置目前已应用于 **V3 / V4**；其余版本待同款重排（见 BACKLOG「文档漂移」）。

---

## 依赖链总览

```
V1（审计底座）
  └→ V2（客户审批依赖审批引擎）
       └→ V4 / V5 / V6（交易依赖客户合规资格）
V3（财务配置）
  └→ V4 / V5 / V6 / V7（所有记账依赖账户模型）
V4 / V5 / V6 / V7
  └→ V8（对账依赖已有交易数据）
V1–V8
  └→ V9（合规报送依赖所有业务数据）
V7（财资运营）已脱离交易链——旧 EOD 结算/内部转账被实时1:1 取代删除；现管公司自有资金/流动性，全部 ADVANCED 未做
```

---

## V1 — 审计底座（审批 / 审计 / RBAC / Admin 生命周期）

> 平台治理底座：审批引擎 + 审计日志 + RBAC + admin 生命周期 + 凭证安全。所有后续版本操作可信性依赖它。
> 📖 **实现真相** → [`reference/truth/v1-governance-audit.md`](truth/v1-governance-audit.md)
> ⚠️ SUPER_ADMIN 是演示角色（代码硬编码 bypass），正式上线前须移除。

### MVP（领导定义的基础必须，10 工作流全 ✅）

- [x] Admin Invite — 入职审批 + SoD 冲突校验 + 邀请链接设密激活 ｜来源:业务 ｜配对:Admin 删除(ADV) ✅2026-05-05
- [x] Admin First Login — 首登四步(身份确认→强制 MFA 绑定→验证→安全须知)，状态机+审计 ｜VARA TIR III.A ✅2026-05-06
- [x] Admin Role Binding Change — 角色变更审批 + SoD + 3 层；旧 Change Ticket 已清 ｜VARA TIR III.B ✅2026-05-05
- [x] Admin Account Suspension — 停用审批；JWT 拦截 SUSPENDED(非即时，生产需 token blacklist) ｜来源:业务 ｜配对:恢复 ✅2026-05-05
- [x] Admin Account Reactivation — 恢复审批，3 层 ｜来源:业务 ｜配对:停用 ✅2026-05-06
- [x] Admin Password Reset — 自助(邮箱→MFA→链接)+CISO 代操作；15min token+SHA-256+速率限制+反枚举 ｜VARA TIR III.A ✅2026-05-06
- [x] Admin MFA Reset — CISO/TECH_OFFICER 发起，IAM_CREDENTIAL_RESET，重走首登 ｜VARA TIR III.A ✅2026-05-06
- [x] Role Definition CRUD — 自定义角色 + Action Bucket Catalog(现 9 域 23 bucket) ｜来源:业务 ✅2026-05-10
- [x] Audit Evidence Export — 证据包导出审批(approval-backed)+manifest+SHA-256 digest ｜VARA CRM III.A ✅2026-05-05
- [x] Approval Policy Management — 多步骤审批链(stepsConfig 每步多角色 OR)+自审防篡改 ｜VARA CRM II.B ✅2026-05-07

> #5/6/7 共享 `workflowType: ADMIN_CREDENTIAL_MGMT`。

### ADVANCED（VARA 治理缺口，全部未做）

> 📖 **调研留底** → `superpowers/specs/2026-07-04-v1-governance-audit-research.md`
> ⚠️ **据 2026-07-04 深度调研提级**：`⚖️P0` 标记项原误置"可缓"，实为牌照级/上线前必须（VARA 硬性），是主要合规风险；非上线前把它们当"进阶功能"搁置，VARA 审计视为合规缺陷。

**P0（VARA 牌照级，上线前必须——原清单优先级错位）：**

- [ ] ⚖️P0 审计日志 8 年留存 + 归档 — 冷存储+完整性验证 ｜CRM Rule I.F.2(≥8 年，涉国安无限期)；⚠️现 `audit-retention-job.ts` 还查已删列坏着(见 BACKLOG)
- [ ] ⚖️P0 定期权限复审/复认 — 权限快照 + 休眠/过度权限/SoD 违规标记 + 季审签字 ｜Schedule 1 RC2 Std 8 + §D.2.d.ii(quarterly) + NIST AC-2/AC-6(7)
- [ ] ⚖️P0 密钥生命周期治理 — API Key + 加密密钥(DEK/KEK) + admin 凭证 的生成/轮换/撤销/访问审计；**链上签名/托管密钥→HexTrust 治理，平台只留监督(勿实现)** ｜TIR §D + NIST SP 800-57 crypto period
- [ ] ⚖️P0 审计日志 WORM/tamper-evidence + 实时安全告警 — 哈希链/完整性验证 + 安全事件实时告警 ｜Schedule 1 RC2 Std 13(⚠️通知本体 stub 是根因)
- [ ] ⚖️P0 会话即时撤销/终止 — 停用/角色撤销即时会话失效(撤销列表/短 TTL+吊销)，至少特权账户 ｜NIST AC-12(现 JWT next-check 非即时)
- [ ] ⚖️P0 SoD 互斥矩阵扩容 — 从 3 对 admin 扩到 VARA 枚举 sales/dealing/accounting/settlement/safekeeping ｜Company Rulebook §B.2
- [ ] ⚖️P0 admin 生命周期通知补实 — create/modify/enable/disable/remove 自动审计+通知指定人(审计已有、通知因 stub 未落) ｜NIST AC-2(4)
- [ ] ⚖️P0 API Key 紧急 + 定期轮换 — 泄露紧急轮换 + 定期轮换(NIST crypto period 递归控制) ｜TIR Schedule 1(原 ADVANCED，提级)

**P1（VARA/行业，非上线阻断）：**

- [ ] ⚖️P1 PAM 特权治理闭环 — 特权账户白名单强制 + 特权操作审计 + Break-Glass 紧急特权 ｜NIST AC-6(5)
- [ ] P1 变更前强制安全测试门 — 上线前渗透/漏洞扫描 + 整改追踪门控 ｜Schedule 1 RC2 Std 11(依赖 CI/CD)
- [ ] ⚖️ Emergency Break-Glass — 紧急权限绕过 + 时限 elevated + 自动收回 + 事后 review ｜TIR V.A ｜上线无 SUPER_ADMIN 后优先级高
- [ ] Approval 超时预警/通知 — 到期前 N 小时通知 + 升级 ｜来源:业务 ｜依赖通知本体

**P2（低频/退出路径）：**

- [ ] ⚖️ Admin Account Deletion — 离职完全撤销访问(Suspension 只是临时) ｜VARA TIR III.B.2 ｜配对:Invite(MVP)
- [ ] Audit Evidence Package Deletion — 证据包保留期满受控删除 ｜来源:业务

### Supporting Features（非 workflow）

- **审批引擎(maker-checker)** ✅ ｜ **审计 write/query** ✅ ｜ **RBAC 权限校验** ✅ ｜ **SoD 互斥(3 对硬编码，⚠️应扩容见上 P0)** ✅ ｜ **审计 SubjectNo 移除** ✅2026-05-19
- ⚠️ **通知 send/retry** — roadmap 原标 ✅，**实为 STUB**（只 WebSocket gateway，无 email/webhook/retry）——是"实时告警""生命周期通知""超时预警"三个 P0/P1 的共同前置，见 truth + BACKLOG
- **Approval delegation / Login anomaly detection** — ADVANCED 未做

> 现状/锚点见 [truth/v1-governance-audit.md](truth/v1-governance-audit.md)；技术债(通知 stub / subjectNos 漂移 / retention 脚本 / SUPER_ADMIN bypass)见 [BACKLOG.md](../BACKLOG.md)。

## V2 — 客户管理 + 合规底座

> 客户准入 + 合规管理：Onboarding + CRA + 材料时效 + Tier 升级 + 冻结。核心=客户主表三轴状态模型；`assertTradingEligibility` 是 V4-V6 交易资格门。**MVP 仅 Individual，Corporate 显式禁用**。
> **前置**：V1（审批引擎）｜**被依赖**：V4-V6 交易门。
> 📖 **实现真相** → [`reference/truth/v2-customer-compliance.md`](truth/v2-customer-compliance.md)
> ⚠️ 三轴状态模型 ✅2026-05-09（onboardingStatus/adminStatus/complianceStatus + restrictions JSON + investorTier/tradingTier/riskRating）。

### MVP（领导定义的基础必须）

> ⚠️ **重大订正（2026-07-04 体检）**：下列 Onboarding/CRA/材料时效原 roadmap 标 [ ] 未做，**实测均已建可用、模块注册在 AppModule 在跑**——Onboarding 更是 V4-V6 交易门的依赖（若真没做平台无法交易）。故 [ ]→[~]。

- [x] Sumsub Webhook 翻译层 — 签名验证→ingest→dispatch(按 eventType 路由)+retry/dead-letter+Admin 页 ｜来源:业务 ✅2026-05-23
- [~] 客户 Onboarding — CDD via Sumsub(真实集成)+状态机+FINAL_APPROVAL MLRO 门+assertTradingEligibility 交易门(V4-V6 依赖) ｜VARA CRM II.A ｜实测~80% 可用(原 [ ] 系漂移)
- [~] CRA Review — Sumsub AML→6 规则策略→自动/MLRO 签署+EDD(HIGH→RISK_RATING_MLRO_REVIEW)+制裁冻结+月度 cron re-KYC ｜VARA CRM II.C/III.B ｜实测~85% 可用
- [~] Material Refresh — 每日 cron→NUDGE/URGENT/BLOCKING 阶段→BLOCKING 冻结+补件解冻 ｜VARA CRM II.A.3 ｜实测~95%(状态名代码作 NUDGE_ONLY/CLEARED)
- [~] Trading Tier Upgrade — CRA HIGH→Sumsub Level2→MLRO+SMO 审批→升级 ｜来源:业务 ｜后端全建，⛔缺客户端材料提交 UI
- [~] 客户冻结/解冻 — 自动冻结在(material/tier/制裁触发)，⚠️缺统一 workflow + MLRO 解冻审批门 + freeze API ｜VARA CRM IV.A ｜见 BACKLOG

### ADVANCED（全部未做）

**Individual 进阶：**
- [ ] 客户资料变更 — 身份变更触发重验(低风险直接生效/高风险 Sumsub 重验) ｜VARA CRM II.A.3
- [ ] 客户销户 — 余额清零+在途处理+AML 终审+KYC 归档 8 年+账号关闭 ｜VARA CRM IV.C
- [ ] 客户协议版本管理 — T&C/费率表版本+Legal 审批+客户确认记录 ｜来源:业务

**Institutional（接入机构客户后 7 workflows，Corporate 现显式禁用）：**
- [ ] Corporate Onboarding/KYB ｜ UBO 管理 ｜ 授权代表管理 ｜ 公司结构变更 ｜ 多用户企业访问 ｜ Corporate CRA ｜ Re-KYB — 均 VARA CRM II.B/III；CorporateProfile/UboProfile 表已 stub

> 现状/锚点见 [truth/v2-customer-compliance.md](truth/v2-customer-compliance.md)；技术债(冻结无统一 workflow / Tier UI / Corporate stub)见 [BACKLOG.md](../BACKLOG.md)。

## V3 — 财务配置

> 交易的前置底座：资产 / 钱包 / 账本账户三个 primitive + 提现地址 + 金额闸门。
> **前置**：V1（审批引擎）｜**被依赖**：V4-V7 所有记账操作。
> 📖 **实现真相** → [`reference/truth/v3-financial-config.md`](truth/v3-financial-config.md)

### MVP（领导定义的基础必须）

- [x] 资产上线与激活 — 直接创建→PROVISIONING→CISO 审批+就绪检查→ACTIVE ｜来源:领导 ｜配对:资产下架(ADV) ✅2026-05-15
- [x] 资产暂停/恢复 — 双向独立 CISO 审批门 ｜来源:领导+VARA TIR IV.C ✅2026-05-15
- [x] 托管钱包创建 — Crypto — Admin 系统钱包 / Client 充值地址双入口 ｜来源:领导 ✅2026-05-13
- [x] 托管钱包创建 — Fiat — Admin 系统账户 / Client VIBAN 双入口 ｜来源:领导 ✅2026-05-13
- [x] 账本账户开设 — 随资产同事务开系统账户，客户账户首笔懒解析+手动兜底 ｜来源:领导 ✅2026-05-15
- [x] 提现地址登记 — Crypto — 24h 安全冷却 ｜来源:领导+VARA TIR III.A ｜配对:地址停用归档(ADV) ✅2026-05-13
- [x] 提现地址登记 — Bank — 同冷却机制 ｜来源:领导+VARA TIR III.A ｜配对:地址停用归档(ADV) ✅2026-05-13
- [~] 金额闸门体系 — 限额配置管道✅2026-05-16；**未接入执行**（充/提/兑均不消费限额表，侧边栏入口已隐藏 84cfffb）。三条金额线（tier 限额 / 大额审批 20 万 / TR 阈值 3,500）待合并为"金额闸门矩阵"统一接入 L1 ｜来源:领导（2026-07-03 定性 MVP 未完成，待重设计）

### ADVANCED（VARA gap + 低频逆向）

- [ ] ⚖️ 资产对外披露信息页 — 每资产公开摘要（符号/发行日/市值/流通量/合约审计/最大回撤）｜VARA BD I.B.1(c) ｜挂靠资产上线，下架联动摘除
- [ ] ⚖️ 资产下架 — 在途订单清退 + 持仓清退 + 披露页摘除 + 审批 ｜来源:VARA(披露一致性)+行业(Coinbase/Kraken) ｜配对:资产上线(MVP)
- [ ] ⚖️ 阈值参数配置治理 — 归集/dust/大额线/TR 阈值走 Maker-Checker，出硬编码 ｜VARA Company(职责分离，硬编码绕过四眼) ｜自 V7 移入
- [ ] ⚖️(待核) 提现地址 hosted/unhosted 区分 — 非托管钱包风险标记 ｜CRM Rulebook(条款待人工复核) ｜TravelRuleAdapter 归因已有地基
- [ ] 提现地址停用归档 — 确认无在途提现→停用（8 年保留，不物理删）｜来源:领导 ｜配对:地址登记(MVP)

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] 资产上线三重评审矩阵 — 法律定性/合规风险/技术安全独立评审位 ｜来源:行业(Coinbase Listing Framework)
- [ ] 辖区×币种白名单矩阵 — 多辖区/多法币后启用 ｜来源:行业+FATF

> **支撑项**（TB 账户类型定义 / 钱包模型 V3 适配 / 资产状态守卫 / code→currency 改名 / 前端清理）均已交付；实现现状见 [truth/v3-financial-config.md](truth/v3-financial-config.md)。**技术债**（TB 建账失败无 backlog、contractAddress 残留等）见 [BACKLOG.md](../BACKLOG.md)。

---

## V4 — 充值流程

> 链上/银行到账 → 充值订单 → 暂扣两步记账 → L1 资格 + L2 合规筛查 → 入账。
> **前置**：V2（客户合规资格）+ V3（账户模型）。
> 📖 **实现真相** → [`reference/truth/v4-deposit.md`](truth/v4-deposit.md)（含双链路状态机、异常分支现状、半截桥风险）

### MVP（领导定义的基础必须）

- [x] 虚拟币充值 Happy Path — 链上到账→资金单确认→暂扣记账(Step1 CLIENT_ASSET→SUSPENSE)→L1 资格→L2(KYT+TR 全 PASSED)→入账(Step2 SUSPENSE→PAYABLE) ｜来源:领导+VARA CRM II.A ✅2026-05-22
- [x] 法币充值 Happy Path — VIBAN 到账(无确认阶段)→暂扣记账→L1→L2(KYT；TR 自动 NOT_REQUIRED)→入账 ｜来源:领导+VARA CRM II.A ✅2026-05-27

### ADVANCED（VARA gap + 异常分支；括号内 P0/P1/P2 = 实施优先级）

**P0（硬条款欠账 + 已上线按钮钱路未通）：**
- [ ] ⚖️ 制裁冻结完整闭环 — KYT/制裁命中→FROZEN→MLRO 审批门→放行/没收(CONFISCATE 治理化) ｜VARA CRM III.H(命中即冻结、记录 8 年) ｜(P0)
- [ ] ⚖️ 已记账异常终态 TB 回退 — REJECTED/FAILED/EXPIRED 若已过 Step1 须反向 SUSPENSE→CLIENT_ASSET ｜VARA BD(禁止不当处置客户资产) ｜(P0，临时守卫见 BACKLOG task_16af8187)
- [ ] KYT FAILED 消化路径 — 失败不能永挂 COMPLIANCE_PENDING ｜来源:业务 ｜(P0)

**P1（有具体数字/字段的条款欠账）：**
- [ ] ⚖️ TR 阈值 3,500 闸门 + 数据缺失分支 — 单笔/分方向/严格大于；缺对手方数据→等待时限→处置 ｜VARA CRM III.G ｜(P1，并入金额闸门矩阵)
- [ ] ⚖️ 拆单聚合监控 — 关联交易识别，防规避阈值 ｜VARA CRM III.G.9 + FATF 红旗指标 ｜(P1)
- [ ] ⚖️ 法币名义不符核验 — senderName 字段+比对，first-party 付款人核验 ｜VARA CRM III.E(SoF/首笔经持牌账户) ｜(P1)
- [ ] 按链确认数配置 + 区块重组回退 — 确认数按链差异化（非全局常量）｜来源:行业(Coinbase/Kraken) ｜(P1)
- [ ] ACTION_PENDING 补材料闭环 — 接 Sumsub 复审 webhook ｜来源:业务 ｜配对:L2 筛查 ｜(P1)

**P2（依赖真实银行集成或低频）：**
- [ ] ⚖️ 稳定币发行方冻结应对 — USDT 黑名单事件 runbook + 资产暂停联动 ｜FATF 2025(非法活动多涉稳定币) ｜(P2)
- [ ] 法币银行退汇/冲正 — bounce→FAILED；到账后 reversal→扣回/催收 ｜来源:业务 ｜(P2)
- [ ] EXPIRED 超时回退 — 补材料超时→回退 ｜来源:业务 ｜(P2)
- [ ] 孤儿充值处理 — 无主资金→suspense→人工归属/MLRO；VIBAN 归属校验建议先补 ｜VARA CRM III.A ｜(P2)
- [ ] 充值渠道暂停/恢复 — 指定链/token/法币渠道 + 审批 ｜来源:业务 ｜(P2)

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] 充值成功通知 — 到账推送客户，复用 V1 Notification ｜来源:行业(UX)

> **支撑项**（事件驱动编排 / KYT-TR 模拟端点 / Admin 充值页 / Client 三 Tab / Tipping-off 映射 / Overview 读 TB）均已交付；现状见 [truth/v4-deposit.md](truth/v4-deposit.md)。**技术债**（txHash 去重、repair surface、emit vs emitAsync、PATCH 绕过等）见 [BACKLOG.md](../BACKLOG.md)。**TransactionComplianceService 废弃** — 已确认全仓 0 命中（删干净）。

---

## V5 — 提现流程

> 提现申请 → L1 资格 → 大额审批门 → L2 合规筛查（Pre-KYT + TR）→ Payout → 链上/银行确认 → 记账。crypto/fiat 共用同一工作流。
> **前置**：V2 + V3 + V4（余额依赖充值）。
> 📖 **实现真相** → [`reference/truth/v5-withdraw.md`](truth/v5-withdraw.md)（状态机 / 三层合规 / 大额门 / 费率治理 / funds_order 2 腿）

### MVP（领导定义的基础必须）

- [x] 虚拟币提现 Happy Path — L1 资格→大额门→L2(Pre-KYT+TR 全 PASSED)→Payout→txHash 确认→TB post(客户 CLIENT_PAYABLE↔CLIENT_ASSET + 公司 FIRM_ASSET→FIRM_FEE)→L3 归档→SUCCESS ｜来源:领导+VARA CRM II.A ✅2026-05-30
- [x] 法币提现 Happy Path — 同链路；TR 自动 NOT_REQUIRED、无 L3、银行到账确认(走 funds_order CONFIRMED) ｜来源:领导+VARA CRM II.A ✅2026-05-31
- [x] 大额审批门 — 毛额 ≥20 万 AED(fail-closed 估值)触发 SMO 单步 48h，门置于 L2 之前 ｜来源:领导+VARA ✅2026-06-01（**现役唯一金额闸门**）
- [x] 提现费率等级 创建/变更/绑定 — 3 独立工作流；创建/变更走审批(现状 OPS_OFFICER 单步)、变更 request-record+configHash 冲突检测、绑定无门直接生效 ｜来源:领导+VARA CRM II.C ✅2026-05-30

### ADVANCED（VARA gap + 异常分支）

- [ ] ⚖️ 制裁地址/受益人拦截 — 命中 OFAC/SDN→强制取消→void 解锁→MLRO 审计→SAR ｜VARA CRM III.H ｜配对:L2 筛查
- [ ] ⚖️ KYT 高风险 MLRO 审批门 — 高风险地址/受益人→挂起→MLRO 放行/拒绝(void)；后端需补 FROZEN 或等价挂起态 ｜VARA CRM
- [ ] ⚖️ 大额提现增强审查(EDD) — 超阈值强制 SOF/SOW→Sumsub 增强→MLRO 门(阈值按 tradingTier) ｜VARA CRM III.B
- [ ] 链上失败重试/加速 — stuck/failed→超时重试加速或取消(现仅 onPayoutLegFailed→FAILED+void，无重试) ｜来源:业务
- [ ] 法币银行退回(bounced) — 退汇→void 恢复→通知→审计 ｜来源:业务 ｜配对:V4 充值 bounce
- [ ] 提现渠道暂停/恢复 — 指定链/token/法币渠道 Maker+Checker，在途处理策略明确 ｜来源:业务
- [ ] 提现渠道切换/降级 — 主渠道故障切备用 + 审批 ｜来源:业务
- [ ] 批量提现(机构) — CSV 批量→逐笔校验→统一审批→逐笔 Payout+汇总 ｜来源:业务(机构)
- [ ] 提现专属限额变更 — request-record 审批(区别于 V3 通用限额) ｜来源:业务 ｜与金额闸门矩阵一并

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] 提现成功通知 — SUCCESS 推送客户，复用 V1 Notification（基础设施在、未接）｜来源:行业(UX)

> **支撑项**（事件驱动编排 / TB pending-post-void 记账 / 模拟端点 / Admin+Client 页 / Tipping-off 映射 / WithdrawQuote 取最优 / 费率 seed）均已交付；现状见 [truth/v5-withdraw.md](truth/v5-withdraw.md)。**技术债**（Sumsub 真集成 / 热钱包校验 / 通知 / repair surface）见 [BACKLOG.md](../BACKLOG.md)。
> ⚠️ **措辞订正（2026-07-03 体检）**：费率审批已从 MLRO+SMO 简化为 OPS_OFFICER 单步（2026-06-01）；REJECTED/大额否决的 void 解锁**已实现**（异常分支非全空）；提现资金单 = 2 腿 funds_order（payout+fee），FUND_OUT 预归集已退役。

---

## V6 — 兑换流程

> 平台内兑换（crypto↔fiat 余额交换，**资金不出境、无外部对手方**）：报价 → L1 资格 → 消费 Quote → 4 腿实时记账 → SUCCESS。合规**仅 L1 同步闸门**（无 L2/大额门，因资金不出境）。
> **前置**：V2 + V3。
> 📖 **实现真相** → [`reference/truth/v6-swap.md`](truth/v6-swap.md)（4 腿账户 / FAILED-REVERSED 死枚举 / 费率治理）

### MVP（领导定义的基础必须）

- [x] 报价工作流 — SwapQuote(30s TTL)：resolveBestLevel 最优费 + Binance 实时汇率 + PricingEngine 算 amountOut/spread/fee ｜来源:领导 ✅2026-06-01
- [x] 兑换成交 Happy Path — L1 资格→消费 Quote→PROCESSING→4 腿 per-leg two-phase(客户 CLIENT_PAYABLE↔CLIENT_ASSET + 公司 FIRM_ASSET↔FIRM_OPS/SET/FEE)→leg1 自动/leg2-4 admin advance→4 腿 CLEAR→SUCCESS ｜来源:领导+VARA CRM II.A ✅2026-06-01
- [x] 兑换费率等级 创建/变更/绑定 — 3 独立工作流；创建/变更 OPS_OFFICER 单步、变更 request-record+configHash 冲突、绑定无门；tier=rateMarkupBps+feeItems(支持 spread-only) ｜来源:领导+VARA CRM II.C ✅2026-06-01

### ADVANCED（VARA gap + 治理 + 失败终态）

- [ ] swap 失败终态治理 — 接 reverse 端点(整笔冲正→REVERSED) + 自动 FAILED 状态机；现 FAILED/REVERSED 为**死枚举**、失败仅自愈→STUCK 留 PROCESSING ｜来源:业务 ｜配对:成交 Happy Path
- [ ] ⚖️ 大额兑换增强审查(EDD) — 超阈值强制 SOF/SOW→Sumsub 增强→MLRO；⚠️设计立场:swap 资金不出境现仅 L1 eligibility，是否启用异步合规门待定 ｜VARA CRM III.B
- [ ] 交易暂停/恢复 — 货币对/全局暂停，在途 Quote 强制 EXPIRED，Maker+Checker ｜来源:业务
- [ ] 货币对上下线 — 新增(关联 TB Account+默认 SwapFeeLevel+审批)/下线(处理在途 Quote+归档) ｜来源:业务
- [ ] 批量兑换(机构) — CSV 批量→逐笔校验→统一审批→逐笔成交 ｜来源:业务(机构)

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] Quote TTL cron sweep — 过期 Quote 自动标 EXPIRED(现仅懒过期) ｜来源:行业
- [ ] 兑换成功通知 — SUCCESS 推送客户，复用 V1 Notification ｜来源:行业(UX)

> **支撑项**（SwapQuoteService 拆分 / PricingCenterService 删除 −3500 行 / 4 腿声明式记账 / Client 兑换页 / Swap Quotes admin 页 / 审批策略 6 类简化 OPS_OFFICER / legacy swap config 已清）均已交付；现状见 [truth/v6-swap.md](truth/v6-swap.md)。**技术债**（Sumsub TM / repair surface / InternalFund 命名债）见 [BACKLOG.md](../BACKLOG.md)。
> ⚠️ **措辞订正（2026-07-04 体检）**：① reverse 整笔冲正 / REVERSED / FAILED 实为**死枚举 + 无 reverse 端点**（原 2026-06-26 ✅ 过度声明，降为 ADVANCED 待做）；② 编排类名实为 `SwapWorkflowService`+`SwapLegAccounting`，**无 `SwapSettlementService`**；③ swap 腿 = funds_order（代码仍用 InternalFund 旧名，命名债）。

---

## V7 — 财资运营（Treasury Ops）

> 管**公司自有资金与流动性**（客户的钱由 V4-V6 管，实时1:1 safeguarding）。
> ⚠️ **旧 V7「内部转账 / 延迟结算」整套已废弃**：随实时1:1 重构，通用内部转账工作流 / EOD 轧差结算 / 充值归集 cron / 手续费归集 / 法币交割 / Outstanding / SettlementBatch / FeeAccrual / 白名单 全部删除（C5b）。每笔交易现**自己就地记账**（V4 两步 / V5 payout+fee / V6 四腿）。资金单（funds_orders）是**跨版本共享原语**（V4 起在用），归 `truth/funds-orders.md`（待建），不属于本版本。
> **前置**：V3（账户模型）。
> 📖 无独立 truth（无活体 V7 业务）；旧延迟结算设计仅作历史存档 → `reference/v7-funds-layer-baseline.md`（只读追溯，勿当现状）。

### MVP

- 无。原 MVP（通用内部转账 / 充值归集 / EOD 结算 / 法币交割 / 手续费归集）已被实时1:1 吸收进 V4-V6 或删除。

### ADVANCED（全部未做，平台跑起量、自有资金进出多了才痛）

**流动性管理（最先痛）：**
- [ ] LP 调拨治理 — LP-IN 补货 / LP-OUT 回吐（Maker + CFO/MLRO 审批）；客户换出多了库存见底须找 LP 平盘 ｜来源:业务
- [ ] 公司自有流动性再平衡 — FIRM 各钱包 Main↔Liquidity 库存调拨 ｜来源:业务
- [ ] 跨网络库存再平衡 — 同资产跨链（如 USDT-ERC20↔TRC20，可能走 OTC）｜来源:业务

**储备与收入：**
- [ ] ⚖️ 储备金注资 / 穿底补救 — 公司外部→客户池，补足 safeguarding 缺口 ｜VARA(客户资产 1:1 保障)
- [ ] 收入提取 — FIRM_FEE → 公司运营 / 银行账户 ｜来源:业务

**异常与配置治理：**
- [ ] 异常资金处置 — 孤儿/无主资金归位 / 冻结·制裁资产隔离 / 错账冲正 ｜来源:业务+VARA
- [ ] 内部转账阈值配置治理 — 归集/审批线/dust 阈值出硬编码（Maker+Checker）｜来源:业务 ｜与 V3 金额闸门矩阵一并

> **边界决策（仍有效）**：链上 gas → HexTrust gas station 自担（不进 TB，固定 P&L）；钱包热/冷分层 + 托管扫钱 → HexTrust 管，平台不编排；银行费 → 年付固定 OpEx。
> **别双重登记**：偿付义务（Reimbursement）+ 储备证明（Proof of Reserves）已归 V8 对账。

---

## V8 — 对账流程

> 客户/公司资产对账：内部账本（TB / AccountFlow 投影）vs 外部数据（银行 / HexTrust / 链上）**逐物理钱包 1:1 直比** + 差异分五桶 + 平账处置。
> **前置**：V3-V6（依赖完整交易与持仓数据）。
> 📖 **实现真相** → [`reference/truth/v8-recon.md`](truth/v8-recon.md)（Phase B 引擎 / 五桶 / Run-Case 驾驶舱 / effectiveDate / 推单处置）
> ⚠️ 历史：经 I1-I5 → credit-net 五公式 → Phase B 三轮重构；旧 credit-net 五公式引擎已 **Phase C 物理删**（11 文件）。设计存档见 `superpowers/specs/2026-06-20 ~ 2026-07-03-*` 系列（只读追溯，勿当现状）。

### MVP（领导定义的基础必须）

- [x] 逐钱包 1:1 余额对账 — 客户钱包 external==PAYABLE+SUSPENSE / 公司钱包 1:1 直比；内部恒等预门(TB 直读) ｜来源:领导+VARA CRM III.A ✅Phase B
- [x] 五桶流水匹配 — 三轮(同 ref 跨钱包互证 / 金额方向窗口模糊 / 在途↔非终态资金单)+残差恒等式分桶(MATCHED/IN_TRANSIT/SOFT_FLAG/BREAK) ｜来源:领导 ✅Round3
- [x] Run 编排 + 快照 + 审计 — 每日 cron(02:30 Dubai)→逐钱包→开 case(每钱包跨日唯一 OPEN)+auto-heal+run 快照(根治历史漂移)+审计三打点 ｜来源:领导 ✅Round3
- [x] Run/Case 驾驶舱 admin — Run(结论条+五桶过滤+三元组跳转+快照表)/Case(桶徽章+差额五格+观察历史+流水混排) ｜来源:领导 ✅Round3
- [x] effectiveDate 平账准备 — 双表加列+等价保真切换(effectiveCutoffFilter)+回填透传链(advance→writeEvidence→account_flows)+recon:rerun 工具 ｜来源:领导 ✅2026-07-03
- [x] 推单处置(7 平账动作第 1 个) — 同步腿(唯一回执匹配)+人工腿(三件套)，逐步 advance 不直写 TB+回填生效日；双端点+审计 ｜来源:领导 ✅2026-07-03
- [x] recon:demo 九场景 — anchor-free pass/break + manifest 答案键(9 类平账根因)+恒等式自验 ｜来源:领导 ✅2026-07-03

### ADVANCED（差异处置闭环 + 监管报送，全 deferred）

- [ ] ⚖️ 差异处理人工闭环 — Finance 人工核实/补录→RESOLVED + 24h SLA 升级 MLRO/CFO ｜VARA(差异上报) ｜现止于 Case OPEN
- [ ] 其余 6 平账处置动作 — 补单/冲正/冲销/豁免/偿付/…(推单已做) ｜来源:业务
- [ ] 偿付义务工作流(Reimbursement) — 从 V7 移入；OPEN→审批(CFO/MLRO)→REIMBURSED；表已 drop 留 hook；两触发源(对账差异/event 失败)共出口 ｜来源:业务+VARA
- [ ] ⚖️ 季度 Proof of Reserves — HexTrust 钱包链上快照→Sum(客户负债)≤储备证明→VARA 季报 ｜VARA(储备证明)
- [ ] 对账报告导出 — 日期范围摘要(余额差/匹配率/未决 Case)，VARA 审计 / 半年独立审计输入 ｜VARA
- [ ] LP 仓位对账 — 与 LP 对手方核对 LP-IN/OUT，依赖 LP API/文件 ｜来源:业务

> **设计前提（仍有效）**：① Gas 全由公司承担，客户资产不因 Gas 产生差异；② 实时1:1 双式记账保证客户资产与负债内部持平，对账退化为外部核对。
> **技术债**（reObservedCount=0 bug / Reimbursement 三处残留 / FIRM treasury 历史残留 / 资本注入 evidence 待核）见 [BACKLOG.md](../BACKLOG.md)。

## V9 — 合规治理顶层（Regulatory Governance）

> V1-V8 交易层之上、**直接面向监管机构（VARA / UAE FIU）和客户**的合规治理义务。
> **边界铁律**：Sumsub 承接**检测**（KYT/筛查/持续监控 → 告警）；V9 做 Sumsub 覆盖不到、**法定责任在 MLRO 身上不可外包**的申报/上报/裁决/配合。制裁命中后的冻结+SAR 是 STR① × V2 冻结的交叉点，不单列。
> **前置**：V1-V8。
> 📖 无独立 truth（全未做）；本节 2026-07-04 据 VARA Rulebook 深度调研重排（9 条 3:0 验证），**取代旧 V9**（旧版误把 STR 挂 Sumsub 提交、72h 挂错场景，见文末纠偏）。

### MVP（P0 · 牌照级 / 上线前必须——个人客户即适用，法定义务不可延后）

- [ ] ⚖️ **STR/SAR 申报** — Sumsub 告警→案件落地(挂客户/交易)→MLRO 研判(scrutinize)→报/不报决策+依据留档→goAML 提交→回执+FIU 追问→事后处置(联动 V2 冻结/改风险评级)；**无固定天数(immediately/near-real-time 建模)**；MLRO 唯一责任人 ｜VARA CRM III.F.3(a)/III.F.4
  - [ ] ⚖️ **tipping-off 防护门**(随 STR 同生) — STR 案所有对外/跨角色通信节点强制过防泄密门；泄密=联邦刑事罪(6 月监禁+AED 10-50 万) ｜III.F.3(d) + AML-CFT Law Art.25
  - [ ] **goAML 注册**(上线前置) — 平台/MLRO 在 goAML 门户注册且保持 active，否则无法报任何 AML 事项 ｜CBUAE Rulebook 4.3
- [ ] ⚖️ **VARA 重大变更/事件上报** — 变更类=**事前书面审批门**(发生前取 VARA 批准，非事后通知)；一般合规受损=**immediately 通知**+回执跟踪 ｜Company Rulebook VIII.A.1.a + Section H
- [ ] ⚖️ **客户投诉处理** — 受理→确认(**≤1 周**)→调查→裁决(**≤4 周**，例外**≤8 周**且第 4 周出状态更新)→三段留档(投诉/措施/结果)；升级 MLRO/仲裁 ｜Market Conduct Rulebook III.A
- [ ] ⚖️ **网络安全/BCDR 事件上报** — 材料性网安事件或触发 BCDR→**检测后 72h 内报 VARA**(含性质/范围/影响+缓解措施+是否已报他机关) ｜TIR Rulebook Section K + H
- [ ] ⚖️ **监管信息请求配合** — FIU/VARA 追加信息→**48h 硬性回复**；证据调取横跨 V1 审计 + V4-V8 交易/对账 ｜CRM Rulebook III.F.3(b)
- [ ] ⚖️ **资产持续监控**(仅当自行上架/分销资产) — 资产不再合规→immediately 暂停分销；Issuer/资产材料性变更→immediately 重跑尽调 ｜BD Rulebook IV.E

### ADVANCED（P1 · VARA 强制但非上线阻断）

- [ ] ⚖️ **MLRO/董事会季度合规报告** — 季度 cadence；含 AML/CFT 有效性评估 + 失效项指认 + 当季**匿名增强交易(AET)摘要** ｜CRM Rulebook III.A.2.f/g/h

### 跨版本基础设施（非独立工作流，服务上面所有 P0）

- [ ] **统一 SLA 监控层** — 收拢所有法定时钟(48h 信息请求 / 72h 网安事件 / 1-4-8 周投诉 / 季度报告)成倒计时+告警引擎，给各 P0 工作流供时效
- [ ] **合规日历** — goAML 注册状态 + 季度报告 + 各监管截止日追踪台账

> **⚠️ 调研纠偏（2026-07-04，取代旧 V9 的错误）**：① "72h" 归属**网安/BCDR 事件**（旧版误挂"重大事件上报"）；② 材料性变更是**事前审批门**，非事后 72h 通知；③ STR 申报**无固定天数**（immediately，建模为即时计时器非倒计时）；④ **STR 申报是 MLRO 经 goAML 自报，Sumsub 报不了**（旧版"STR→Sumsub→goAML" 是错的——goAML 注册绑持牌实体、申报责任 MLRO 不可外包、tipping-off 决策是刑事红线）。
> **待核**：VARA 是否有独立"季度 regulatory returns"（调研未锚定；季度义务主要即上方 MLRO 董事会报告，勿凭空造报表工作流）。
