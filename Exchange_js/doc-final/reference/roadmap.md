# Product Roadmap

Last Updated: 2026-07-06

**三层分类**（按需求来源）：
- **MVP** — 领导定义的基础必须（非常基础，未必行业惯例，但领导要）
- **ADVANCED** — VARA gap 补齐（rulebook 理论要有）+ 低频逆向操作（上线 MVP、下线 ADVANCED）。`⚖️` = 有具体条款号，rulebook 变版时逐条复查
- **OPTIMIZED** — VARA 不强制、行业多半这么做的未来优化

**每条标注**：`来源:`（领导/VARA 条款/行业）｜ `配对:`（正逆操作互链，防逆向遗忘）｜ 状态 `[x]`交付 `[~]`部分 `[ ]`待做 + 日期。
**实现细节与当前真相** → `reference/truth/`（改代码同步那里，不改这里）｜ **技术债/死码/待决策** → `../BACKLOG.md`。
> ⚠️ 三层分类 + truth 外置已应用于 **V1–V6**；深度调研级 P0/P1/P2 + `⚖️P0` 重排 + `superpowers/specs/` 调研留底已覆盖 **V1 / V2 / V3 / V5 / V6 / V8 / V9**。V4（有三层、无 spec）｜V7（待同款重排）见 BACKLOG「文档漂移」。

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
> 📖 **调研留底** → `superpowers/specs/2026-07-06-v2-customer-compliance-research.md`（V2 首次深度审计）
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

#### 🔄 2026-07-06 遗漏审计追补（fable-5 首次深度审计，69 agent/21 候选/对抗核验含读代码毙 2 伪缺口）

> ⚠️ 3 个 P0 全卡在"客户资格门"（V4-V6 每笔交易的上游）；根因＝**过度信任 Sumsub 绿灯**。Client Money/联邦法条款号系 gap-audit 溯源，**动工前一手复核**（见 spec caveat）。

**P0（VARA 牌照级 · 资格门窟窿）：**

- [ ] ⚖️P0 底层 CDD 档案本地留存+随取 — 现只接 Sumsub 结论/标签；须把底层资料(证件影像/核验报告/命中详情)拉回**本地留副本、without delay 可调阅**(监管索档现在拿不出) ｜FATF R.17 + VARA III.E.6/III.I
- [ ] ⚖️P0 高危国家客户准入门(地域因子) — 国籍/居住国命中 FATF/NAMLCFTC 高危名单→强制 EDD；黑名单辖区(伊朗/朝鲜 call-for-action)→拒入；**现 Sumsub 绿灯即自动放行(伊朗普通人漏放)** ｜Cabinet 134/2025 + FATF
- [ ] ⚖️P0 CRA 补法定四维因子 — 现 6 规则全筛查结果驱动；须加**客户类型/地域/产品/渠道**四维(与上条同根：地域未进风险因子) ｜Cabinet 10/2019 Art.4.1→134/2025 + VARA III.E.2

**P1（VARA 强制）：**

- [ ] ⚖️P1 CDD 完不成/维持不了→强制退出+STR评估 — Material Refresh **无限期冻结＝违 III.E.8"不得 maintain"**；须合规强制终止关系闭环(挂销户)+"是否报 STR"决策留痕 ｜VARA III.E.8
- [ ] ⚖️P1 触发式 re-CDD(存疑重核) — MLRO/ops 对已有身份信息存疑(举报/交易监控升级)→一键发起**整套 CDD 重核**(非只重跑风险分)，完成前拦交易 ｜VARA III.E.4(c)(d)
- [ ] ⚖️P1 PEP 建立/继续须 MLRO+高管层双批 — 现仅 MLRO 单签；加第二把钥匙(Senior Management)，开户与"中途变 PEP"均适用 ｜VARA III.E.6(a)(vi) + FATF R.12
- [ ] ⚖️P1 PEP 识别含家属/密切关联人(RCA) — 现仅"PEP"单标签；家属/关联人命中须同等全套措施，现落 red_other/green 错轨 ｜Cabinet 134/2025 + FATF R.12
- [ ] ⚖️P1 Sumsub CDD 质量定期抽测 — 只复核客户、从不复核供应商；须定期抽样验证 Sumsub CDD 输出质量(最终责任不可转移) ｜VARA III.E.9
- [ ] ⚖️P1 禁匿名/别名账户系统落地 — 账户↔法定身份唯一绑定+同人重复/别名去重+展示名≠真名禁止 ｜Cabinet 134/2025 + FATF R.10
- [ ] ⚖️P1 未成年/行为能力准入门槛 — <18 拒入(阿联酋成年线 **2026-06-01 降至 18**，新生效易漏配)；CDD 已采 DOB→落硬闸 ｜Federal Decree-Law 25/2025
- [ ] P2 冻结 tipping-off 内外分离**硬化** — ✅**2026-07-06 补核(读代码):当前已中性、非活漏**——auth 登录返中性 `CUSTOMER_ACCOUNT_FROZEN`+"联系客服"、freeze reason(`sanctions_hit_pending_investigation` 等)**仅写审计日志**、profile-banner 文案中性。缺的只是**强制**内外分离约定(防未来新增客户面直显 reason 回归)，非当前泄露 ｜VARA III.F.1 + 联邦 10/2025 Art.29(替代 20/2018 Art.25)
- [ ] P2 被拒申请人**调查记录**留存 8 年 — ✅**2026-07-06 补核**:被拒过程若触发调查/分析(制裁/PEP 命中)其记录属 CDD records 须留 ≥8y；⚠️"**全部**被拒申请人留存"是推断(III.I 原文仅"clients"、无 prospective 字样) ｜VARA III.I.1.b/III.I.2（gap-audit 误引 III.H＝制裁章，已纠）

**Individual 进阶：**
- [ ] 客户资料变更 — 身份变更触发重验(低风险直接生效/高风险 Sumsub 重验) ｜VARA CRM II.A.3
- [ ] 客户销户 — 余额清零+在途处理+AML 终审+KYC 归档 8 年+账号关闭 ｜VARA CRM IV.C
- [ ] 客户协议版本管理 — T&C/费率表版本+Legal 审批+客户确认记录 ｜来源:业务 ｜⚠️2026-07-06 V6 复查:协议含费率表,变更须**提前 30 日历日**通知客户+单方变更权须明示写入协议(MC II.A.7/8)——生效闸在 V6 费率工作流,通知发送在本条
- [ ] ⚖️ 投资者分类(Retail/Qualified/Institutional) — 客户级分类状态+证据留痕≥8y(Qualified 门槛:净资产≥AED 350 万或年收入≥AED 70 万,禁自我声明);升级走披露+同意+双重复核;V4-V6 交易门只读此字段 ｜Market Conduct IV.A.1 + VARA Circular 2026-01-08 ｜来源:2026-07-06 V6 复查分拣归 V2
- [ ] ⚖️ 客户资金月度对账单 — 至少月度(25 日历日内编制)向客户发 Client Money 对账单，逐笔列每笔 credit/debit(含每笔法币提现借记的金额/日期/价值)；提现流水字段由 V5「提现记录字段集」供数 ｜CRM IV.D.2.a/b ｜来源:2026-07-06 V5 复查分拣归 V2

**Institutional（接入机构客户后 7 workflows，Corporate 现显式禁用）：**
- [ ] Corporate Onboarding/KYB ｜ UBO 管理 ｜ 授权代表管理 ｜ 公司结构变更 ｜ 多用户企业访问 ｜ Corporate CRA ｜ Re-KYB — 均 VARA CRM II.B/III；CorporateProfile/UboProfile 表已 stub

> 现状/锚点见 [truth/v2-customer-compliance.md](truth/v2-customer-compliance.md)；技术债(冻结无统一 workflow / Tier UI / Corporate stub)见 [BACKLOG.md](../BACKLOG.md)。

## V3 — 财务配置

> 交易的前置底座：资产 / 钱包 / 账本账户三个 primitive + 提现地址 + 金额闸门。
> **前置**：V1（审批引擎）｜**被依赖**：V4-V7 所有记账操作。
> 📖 **实现真相** → [`reference/truth/v3-financial-config.md`](truth/v3-financial-config.md)
> 📖 **调研留底** → `superpowers/specs/2026-07-06-v3-financial-config-research.md`（首次遗漏审计）

### MVP（领导定义的基础必须）

- [x] 资产上线与激活 — 直接创建→PROVISIONING→CISO 审批+就绪检查→ACTIVE ｜来源:领导 ｜配对:资产下架(ADV) ✅2026-05-15
- [x] 资产暂停/恢复 — 双向独立 CISO 审批门 ｜来源:领导+VARA TIR IV.C ✅2026-05-15
- [x] 托管钱包创建 — Crypto — Admin 系统钱包 / Client 充值地址双入口 ｜来源:领导 ✅2026-05-13
- [x] 托管钱包创建 — Fiat — Admin 系统账户 / Client VIBAN 双入口 ｜来源:领导 ✅2026-05-13
- [x] 账本账户开设 — 随资产同事务开系统账户，客户账户首笔懒解析+手动兜底 ｜来源:领导 ✅2026-05-15
- [x] 提现地址登记 — Crypto — 24h 安全冷却 ｜来源:领导+**行业惯例**(⚠️2026-07-06 审计:查遍各册无地址冷却法定条款,原 TIR III.A 误引——那是保密信息条款) ｜配对:地址停用归档(ADV) ✅2026-05-13
- [x] 提现地址登记 — Bank — 同冷却机制 ｜来源:领导+**行业惯例**(同上,无法定锚) ｜配对:地址停用归档(ADV) ✅2026-05-13
- [~] 金额闸门体系 — 限额配置管道✅2026-05-16；**未接入执行**（充/提/兑均不消费限额表，侧边栏入口已隐藏 84cfffb）。三条金额线（tier 限额 / 大额审批 20 万 / TR 阈值 3,500）待合并为"金额闸门矩阵"统一接入 L1 ｜来源:领导（2026-07-03 定性 MVP 未完成，待重设计）

### ADVANCED（VARA gap + 低频逆向）

- [ ] ⚖️ 资产对外披露信息页 — 每资产公开摘要（符号/发行日/市值/流通量/合约审计/最大回撤）｜VARA BD I.B.1(c) ｜挂靠资产上线，下架联动摘除
- [ ] ⚖️ 资产下架 — 在途订单清退 + 持仓清退 + 披露页摘除 + 审批 ｜来源:VARA(披露一致性)+行业(Coinbase/Kraken) ｜配对:资产上线(MVP)
- [ ] ⚖️ 阈值参数配置治理 — 归集/dust/大额线/TR 阈值走 Maker-Checker，出硬编码 ｜VARA Company(职责分离，硬编码绕过四眼) ｜自 V7 移入
- [ ] ⚖️P1 稳定币兑换对 CBUAE 牌照门 — AED↔支付型代币(USDT/USDC)兑换对**开通前**登记 CBUAE 授权/非异议注册状态,无则禁开该对——央行 2024 条例明文"含 VARA 持牌人",VARA 牌照不覆盖法币↔支付代币换汇 ｜CBUAE Payment Token Services Regulation(Circular 2/2024,条款原文待核) ｜来源:2026-07-06 V6 复查分拣归 V3
- [ ] ⚖️P1 VA Standards 存续复审+币对急停 — 上线尽调只是"prior to"半句,"**at all times during**"要求在售币对存续符合:跌出标准(列禁/失监管认可)→暂停该币对报价成交+留痕;VA Standards 文本挂官网随修订更新;V6 报价引擎消费暂停标记 ｜Market Conduct VIII.A.2/A.3/A.4(n) ｜来源:2026-07-06 V6 复查分拣归 V3
- [ ] ⚖️P1 提现地址所有权验证 + hosted/unhosted 分类打标记 — 登记时验证客户控制自托管钱包(验一次永久) + 分类 hosted/unhosted + 对手方 VASP 初次尽调 → 打标记供 V5 每笔消费；TravelRuleAdapter 归因已有地基 ｜CRM III.G.7 + FATF(2026-07-04 V5 调研确认，原"待核"已坐实) ｜**地址级一次性控制归 V3**；交易级(制裁重筛/TR 发送/差异化 EDD)在 V5
- [ ] 提现地址停用归档 — 确认无在途提现→停用（8 年保留，不物理删）｜来源:领导 ｜配对:地址登记(MVP)
- [ ] ⚖️P1 第三方银行客户资金确认函 — 存客户法币前须取银行书面确认(资金以 agent 身份持有/银行无抵销·扣押权/账户名可区分自有资金)；不出函则不许再存并撤出已存(IV.C.4 有牙齿) ｜CRM IV.C.3/C.4(一手核) ｜来源:2026-07-06 V8 审计分拣归 V3(账户配置门；V8 只消费"该账户已挂确认函证据")

#### 🔄 2026-07-06 遗漏审计追补（fable-5，13 候选/9 存活/4 驳回；条款均一手核 rulebooks.vara.ae）

**资产上线门：**
- [ ] ⚖️P1 AEC 隐私币硬拦截 — "匿名增强币"(门罗类)在迪拜**明文禁止一切相关 VA 活动**(硬禁令,审批不可放行)；资产 primitive 加 AEC 标记(含"有无可追踪缓释"判定)→创建/激活双环节系统级拦死+审计 ｜VA&RA Regulations 2023 Part II.C(一手逐字核)
- [ ] ⚖️P1 上线初始尽调法定 14 因子集 — 上线审批单内置 MC VIII.A.4(a)-(n) 逐因子字段(市值流动性/被禁与否/DLT 安全/操纵易感/发行方欺诈史等,每因子=结论+依据)，CISO 审批前置校验全填毕+记录留 8 年；现只查"TB 账户+钱包"技术就绪，"存续复审"条目只管上架后半句 ｜MC VIII.A.1-A.4 + VIII.B.2/CRM I.F

**银行渠道门（与确认函凑齐三件套）：**
- [ ] ⚖️P1 第三方银行准入资格门 — 开户前核验:①银行在其辖区**持有效吸储牌照**②**非与平台同集团**；划付客户资金前再核 ｜CRM IV.C.1 + IV.C.2.a(一手核)
- [ ] ⚖️P1 客户资金境内银行限制 — UAE 客户资金必须存 **UAE 境内**第三方银行；境外行仅可作中转、收到后 **24h 内**启动转移境内；银行账户配置加"境内/境外+仅中转"属性 ｜CRM IV.B.5(一手核)

**托管侧（平台自身账册义务，不因 HexTrust 外包豁免）：**
- [ ] ⚖️P1 客户 VA 钱包强制隔离+账册标注 — 客户币钱包与平台自有币**完全分开**，账册强制标注 "Client VA Wallet"(钱包以平台名义开在 HexTrust 即算平台 hold/control) ｜CRM V.B.3 + V.A.2(一手核)
- [ ] ⚖️P1 托管安排对外披露 — 官网公示:客户资产保护安排声明 + 第三方托管人(HexTrust)身份；与"资产披露页"(I.B.1(c))同条不同款 ｜BD I.B.1(g)/(i)(一手核)
- [ ] ⚖️P2 空投/质押收益归客户+禁再质押 — 客户 VA 衍生收益(空投/staking)默认**全归客户**(除非书面同意归平台)；客户 VA 须 1:1 持有、未经明示同意禁 rehypothecation；需"资产事件收益归属"配置位 ｜CRM V.B.5 + V.B.4(一手核)

**地址册：**
- [ ] ⚖️P1 法币收款账户同名核验 — 登记银行账户时核**户名=KYC 姓名**(first-party)；法定出口是"付给客户本人"，不核名=默默开放第三方代收 ｜CRM IV.B.10.b.ii(一手核)

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

> 📖 **调研留底** → `superpowers/specs/2026-07-04-v5-withdraw-compliance-research.md`
> ⚠️ **据 2026-07-04 深度调研重排**（10 findings 3:0 + 代码验证）：⚖️P0=牌照级必须；**纠正旧设想 3 处**——① 制裁是 BLOCK(冻结原地) 非"取消退回客户"；② L2「Travel Rule」现只是筛查状态位、缺发起方发送；③ 失败退回有硬 **24h SLA**(非"尽快")——⚠️**2026-07-06 牌照订正**:平台仅 BD 牌照(无 T&S 活动),硬 24h 直接约束执行转账的持牌方(HexTrust),平台义务=合同传导+监督,下列两条 T&S 锚点已改锚。

**P0（VARA 牌照级，现有几乎空白）：**

- [ ] ⚖️P0 Travel Rule 发起方**发送** — **单笔或关联交易累计 >AED 3,500**（按 VARA 口径，2026-07-06 甲方定；非"按自然日"，关联交易合并沿用 III.G.9 拆单监控）发起前向受益方 VASP 发送 originator(name+钱包地址+住址)+beneficiary(name+钱包地址) payload；⚠️现有 L2 只是筛查状态位、**无发送环节** ｜CRM III.G.2/4/5
- [ ] ⚖️P0 对手方 VASP 尽调 — 新对手方 VASP 首次交易前风险尽调(核受监管+能收 TR)，pre-send gating；⚠️2026-02-24 VARA Circular **禁止向未受监管对手方转账** ｜CRM III.G.6
- [ ] ⚖️P0 制裁命中→BLOCK/FROZEN — ⚠️纠偏:命中 BLOCK 须**冻结原地+拒绝各方访问+上报**，**非取消退回客户**(与 block 义务冲突)；后端需补 FROZEN 态 ｜CRM III.H + OFAC FAQ 646
- [ ] ⚖️P0 失败/未授权提现处置+退回 — 未授权/偏离指示→尽快退款或恢复账户；⚠️2026-07-06 牌照订正:平台仅 BD(无 T&S),II.C.2 硬 24h 约束的是执行转账的 HexTrust——平台侧=合同传导 24h SLA+监督跟踪 ｜CRM I.E.4(客户资产保护) + BD I.A.1.c ｜HexTrust 合同(原锚 T&S II.C.2 撤)
- [ ] ⚖️P0 KYT 高风险/可疑→MLRO→STR — 挂起→MLRO 门→goAML **立即上报**(联动 V9 STR) ｜CRM III.F.3.a

**P1（VARA 强制但相对次级）：**

- [ ] ⚖️P1 stuck/failed→追踪-定因-通知 — 转账未达须追踪+查因+通知客户；⚠️2026-07-06 牌照订正:II.C.3 直接义务方是 HexTrust,平台侧=合同要求追踪+对客通知与留痕 ｜CRM I.E.1 + HexTrust 合同(原锚 T&S II.C.3 撤)
- [ ] ⚖️P1 自托管钱包差异化 EDD/限额 — **消费 V3 打的自托管标记**，按金额应用 EDD/额度限制(所有权验证已在 V3 登记时做) ｜FATF/VARA III.G.7
- [ ] ⚖️P1 大额提现增强审查(EDD) — 超阈值强制 SOF/SOW→Sumsub 增强→MLRO 门(阈值按 tradingTier) ｜CRM III.B
- [ ] 法币银行退回(bounced) — 退汇→void 恢复→通知→审计(绑 24h) ｜来源:业务 ｜配对:V4 充值 bounce

> 🔄 **2026-07-06 遗漏复查追补**（fable-5，11 存活→分拣后 9 留 V5、对账单归 V2）。下列 Client Money(CRM Part IV) 条款号系 gap-audit 溯源，**一手复核前当"很可能对"**（见 spec caveat）。
- [ ] ⚖️P1 🔄 提现划账授权 + 指令绑定存证 — 客户账户每笔划出须绑客户提现指令(指令ID+客户ID+收款账户/地址+白名单肢分类)方可打款；付第三方须留客户指令原文 ｜CRM IV.B.10
- [ ] ⚖️P1 🔄 payout 失败资金 1 日再隔离 — 法币提现被退回/撤销、资金回平台账户→**1 个自然日内**回存客户隔离账户+恢复余额，禁滞留运营账户 ｜CRM IV.B.5.a ｜挂靠:法币银行退回
- [ ] ⚖️P1 🔄 Client Money 违规 1 日报 VARA — 无凭据划账/退回超1日未回存/跨客户垫付 任一→提现流内检测→**1 个自然日内**书面报 VARA(发函走 V9 通道) ｜CRM IV.F.1
- [ ] ⚖️P1 🔄 提现暂停牌照级窄化约束 — "客户极端行情也须能提"→暂停须选法定事由+限范围/时限+**禁行情异动全面停提**+每年政策有效性复查；违约经 CRM I.2 通报 VARA（P2 渠道暂停功能须套此护栏）｜BD I.A.1.c + I.A.2
- [ ] ⚖️P1 🔄 合规冻结 tipping-off 内外双轨 — 制裁/KYT 卡住的提现：内部原因码(SANCTIONS_HIT/KYT_STR)仅合规可见，客户端统一映射中性文案("处理中")，对客话术 MLRO 预审；**禁客户可见渠道输出真实冻结原因(刑事红线)** ｜CRM III.F.1/F.3.d + 联邦法 20/2018 Art.25
- [ ] ⚖️P1 🔄 提现费率 30 日历日生效闸 — WithdrawalFeeLevel 变更强制生效日 ≥T+30 + 通知客户(费率属协议内容、改即改协议)；现"即改即生效"撞线 ｜MC II.A.7/8 + II.B.1(e) ｜与 V6 markup 同源
- [ ] ⚖️P1 🔄 提现记录法定字段集 — 提现单落库固化 CRM I.F.1 最低字段(金额/时间戳/支付指令/费用总额/客户+居住国快照/收款账户或地址/HexTrust 执行方)，native 格式 ≥8y、VARA 索取即出；供 V2 对账单取数 ｜CRM I.F.1-3 ｜与 V6 swap 同源
- [ ] ⚖️P1 🔄 Sunrise 分支(对手方受监管但收不了 TR) — 非"禁转"：尝试替代安全通道→留 best-efforts 证据→合规风险相称放行/拒绝决策留痕→同对手方持续失败触发关系复评(回写 V3 尽调档) ｜Circular 2026-02-24 §2.c + CRM III.G.8
- [ ] ⚖️P1 🔄 Post-KYT 报告后持续监控 — 出过 STR 的提现：payout 上链确认后对目标地址近实时追踪(订阅链上分析告警)，异常回流 MLRO 复评，直至 case 关闭 ｜CRM III.F.5

**P2（低频/治理）：**

- [ ] 拆单/结构化提现监控 — 兼作 TR 阈值的"关联交易累计"判定源（单笔<3500 但关联累计过线→触发 TR 发送）｜CRM III.G.9
- [ ] 提现渠道暂停/恢复 ｜ 提现渠道切换/降级 ｜ 批量提现(机构) ｜ 提现专属限额变更(并入金额闸门矩阵) ｜来源:业务

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] 提现成功通知 — SUCCESS 推送客户，复用 V1 Notification（基础设施在、未接）｜来源:行业(UX)

> **支撑项**（事件驱动编排 / TB pending-post-void 记账 / 模拟端点 / Admin+Client 页 / Tipping-off 映射 / WithdrawQuote 取最优 / 费率 seed）均已交付；现状见 [truth/v5-withdraw.md](truth/v5-withdraw.md)。**技术债**（Sumsub 真集成 / 热钱包校验 / 通知 / repair surface）见 [BACKLOG.md](../BACKLOG.md)。
> ⚠️ **措辞订正（2026-07-03 体检）**：费率审批已从 MLRO+SMO 简化为 OPS_OFFICER 单步（2026-06-01）；REJECTED/大额否决的 void 解锁**已实现**（异常分支非全空）；提现资金单 = 2 腿 funds_order（payout+fee），FUND_OUT 预归集已退役。

---

## V6 — 兑换流程

> 平台内兑换（crypto↔fiat 余额交换，**资金不出境、无外部对手方**）：报价 → L1 资格 → 消费 Quote → 4 腿实时记账 → SUCCESS。现**仅 L1 同步闸门**——⚠️据 2026-07-04 调研，「因资金不出境免 L2」**过度泛化**：仅 Travel Rule 可豁免，**AML 交易监控 + 最优执行** 两根 P0 支柱不豁免（见 ADVANCED）。
> **前置**：V2 + V3。
> 📖 **实现真相** → [`reference/truth/v6-swap.md`](truth/v6-swap.md)（4 腿账户 / FAILED-REVERSED 死枚举 / 费率治理）

### MVP（领导定义的基础必须）

- [x] 报价工作流 — SwapQuote(30s TTL)：resolveBestLevel 最优费 + Binance 实时汇率 + PricingEngine 算 amountOut/spread/fee ｜来源:领导 ✅2026-06-01
- [x] 兑换成交 Happy Path — L1 资格→消费 Quote→PROCESSING→4 腿 per-leg two-phase(客户 CLIENT_PAYABLE↔CLIENT_ASSET + 公司 FIRM_ASSET↔FIRM_OPS/SET/FEE)→leg1 自动/leg2-4 admin advance→4 腿 CLEAR→SUCCESS ｜来源:领导+VARA CRM II.A ✅2026-06-01
- [x] 兑换费率等级 创建/变更/绑定 — 3 独立工作流；创建/变更 OPS_OFFICER 单步、变更 request-record+configHash 冲突、绑定无门；tier=rateMarkupBps+feeItems(支持 spread-only) ｜来源:领导+VARA CRM II.C ✅2026-06-01

### ADVANCED（VARA gap + 异常分支）

> 📖 **调研留底** → `superpowers/specs/2026-07-04-v6-swap-compliance-research.md`
> ⚠️ **据 2026-07-04 深度调研重排**（103 agent/32 findings/3 视角对抗核验）：核心纠偏——「资金不出境→免 L2」**过度泛化**，只 Travel Rule 可豁免；**AML 交易监控 + 市场行为/最优执行** 两根 P0 支柱不因账本内而豁免。
> ⚠️ **别误当合规洞**：`FAILED/REVERSED 死枚举`、`STUCK 部分成交一致性` 经对抗核验 **3:0 驳回**＝技术债（已在 BACKLOG），非监管缺口。
> 🔄 **2026-07-06 遗漏复查追补**（64 agent/19 候选/16 存活/**0 新 P0**）：三根 P0 支柱经复查全站得住；按模块分拣 V6 净增 **6 条流程内小项**（下列标"2026-07-06 复查"），客户级归 V2(分类/协议)、资产级归 V3(CBUAE 门/VA Standards)、公司制度归 V9(员工 PA/内幕名单/返佣禁令)；**T&S 两候选因牌照事实(仅 BD、无 T&S)撤销**。留底见 spec 追补章。

**P0（VARA 牌照级，现有几乎空白）：**

- [ ] ⚖️P0 兑换反洗钱交易监控 — 成交后 emit `SwapCompleted`→规则引擎(刚充就换/大额或拆单/来回对敲/画像不符/高风险PEP)→命中开 MLRO Case→STR 候选(联动 V9 goAML)；**本质盯客户行为模式非单笔**；先「只检测不阻断」(R.20 事后报即合规) ｜CRM III.F.1/III.E.5(a) + FATF R.10/R.20/2020 红旗
- [ ] ⚖️P0 最优执行 best-execution gate — 平台自营做庄须**自证定价靠谱**：≥2 价源比对 + 偏离阈值拦截/降级 + 每笔 bestExec 证据留痕(≥8y)；⚠️**非限制利润**，管透明/一致/有据、点差多少是商业决策 ｜BD II.A.1/A.2(本金成交不豁免)/II.B.1
- [ ] ⚖️P0 本金身份 + 利益冲突 + 定价方法 对外披露 — 告知客户「平台作对手方成交、含点差」+ 公开定价方法 + 冲突管理 ｜BD I.B.1.a/d + II.B.1

**P1（VARA 强制但相对次级）：**

- [ ] ⚖️P1 点差作「平台留存」双点披露 + 成交确认单 — 成交前显性标注留存额 + SUCCESS 后生成不可变确认单(现连成功通知都没接) ｜BD II.A.6
- [ ] ⚖️P1 价格公允性书面政策 + 治理 — 点差上限/偏离容忍/peg 来源入 fee-level 式 Maker-Checker；**分档按规则(同档同价、禁手动看人改价)** ｜BD II.A.1/A.3/A.16
- [ ] ⚖️P1 内部化订单流季度执行质量复核 — 100% 自成交须 ≥季度抽样 自家价 vs 外部可得价，出「调整 or 书面说明」 ｜BD II.A.13
- [ ] ⚖️P1 陈旧价/极端行情保护 — 价源心跳+最大陈旧度拒单+第二源熔断+成交前重校验(顺带解决滑点) ｜BD II.A.4/A.12 + Tech I.H.1
- [ ] ⚖️P1 兑换环节市场操纵监控 — 账本内也能 wash/自成交/套陈旧价，须监控+达阈报 FIU/VARA ｜VA & Related Activities Regulations 2023 Part VIII §I/§J（⚠️2026-07-06 纠正:原误标 Market Conduct）｜上报出口在 V9
- [ ] ⚖️P1 AED 3,500 累计阈值→re-CDD + 大额兑换审批门 — 单笔+滚动累计感知(与拆单共用计数器) ｜CRM III.E
- [ ] ⚖️P1 高风险/PEP 大额兑换 EDD — L1 门读 riskRating→打 EDD 标记→校验 SOF/SOW 时效(客户层义务，不必逐笔硬闸) ｜CRM III.E.10
- [ ] ⚖️P1 卡单重大事件 72h 上报判定 — STUCK 严重度分级→达档起 72h 计时 + VARA 通报草案 ｜Tech K.1 + I.H.1
- [ ] ⚖️P1 卡单期间客户资金保护 SLA — leg1 已扣、买入腿卡→最长停留 SLA、超时强制修复 or 全额回滚释放 + 客户侧可见 ｜CRM I.E.4/I.E.1
- [ ] ⚖️P1 本金交易 vs 自营禁令边界 — 出「仅即时轧平、禁投机」政策 + 存货敞口台账 ≥8y ｜Market Conduct VII.A.1/A.3 + BD II.B.1
- [ ] ⚖️P1 费率/点差变更 30 日历日生效闸 — markup/费率变更审批后强制生效日 ≥T+30 并触发全体客户通知(通知发送走 V2 协议管理);执行政策重大变更(换价源/调 best-ex 阈值/TTL)同触发通知——⚠️上 P0 best-ex gate 当天即触发本条 ｜MC II.A.7/8+II.B.1(e) + BD II.A.16 ｜来源:2026-07-06 复查
- [ ] ⚖️P1 员工账户抢跑侦测规则 — P0① 监控引擎加一类规则:员工打标账户的兑换 vs 同向客户大单/markup·价源变更事件做 ±时间窗关联→合规 Case(员工 PA 审批制度本体在 V9) ｜VA&RA Regs 2023 VIII §C/§E/§J ｜来源:2026-07-06 复查
- [ ] ⚖️P1 划账指令存证 — 客户接受报价=Client Money 划出指令:quoteId+操作时间戳+借记流水三绑定留痕 ≥8y;Client Money 违规须 1 日历日内报 VARA ｜CRM IV.B.10 ｜来源:2026-07-06 复查
- [ ] ⚖️P1 卡单 3 日资金再隔离 — STUCK 超 **3 个日历日**(已收客户 AED、币未交付)→该笔自动划回客户资金桶重新隔离(与修复/回滚 SLA、72h 上报**并行不互替**) ｜CRM IV.B.6.b/B.7 ｜来源:2026-07-06 复查 ｜挂靠:卡单 SLA
- [ ] ⚖️P1 成交记录法定字段集 — SwapCompleted 落不可变原始记录(金额/币对/时间戳/客户+customerNo/居住国快照/费用与点差总额/支付指令/报价快照),native 格式 ≥8y、VARA 索取即出 ｜CRM I.F.1-3 ｜来源:2026-07-06 复查
- [ ] swap 失败终态治理 — 接 reverse 端点(整笔冲正→REVERSED) + 自动 FAILED 状态机；现死枚举、失败仅自愈→STUCK 留 PROCESSING ｜来源:业务/技术债(**非合规洞**) ｜配对:成交 Happy Path

**P2（低频 / 治理 / 辩护）：**

- [ ] 拆单/结构化兑换聚合监控(既有客户非 occasional，列低) ｜CRM III.E.4(b)
- [ ] 兑换链路容量保障 — 报价→L1→4 腿记账容量基线+过载**明确拒单**(拒绝优于静默吞单) ｜BD II.A.15 ｜来源:2026-07-06 复查
- [ ] ✅ **可保留辩护**：Travel Rule 不适用内部兑换(III.G 需对手方/transfer)——须存证依据 + 护栏(将来支持转出/跨客户则立即触发) ｜CRM III.G
- [ ] 交易暂停/恢复 ｜ 货币对上下线(关联 TB Account+默认费率+审批) ｜ 批量兑换(机构 CSV) ｜来源:业务

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] Quote TTL cron sweep — 过期 Quote 自动标 EXPIRED(现仅懒过期) ｜来源:行业
- [ ] 兑换成功通知 — SUCCESS 推送客户，复用 V1 Notification ｜来源:行业(UX)

> **支撑项**（SwapQuoteService 拆分 / PricingCenterService 删除 −3500 行 / 4 腿声明式记账 / Client 兑换页 / Swap Quotes admin 页 / 审批策略 6 类简化 OPS_OFFICER / legacy swap config 已清）均已交付；现状见 [truth/v6-swap.md](truth/v6-swap.md)。**技术债**（Sumsub TM / repair surface / InternalFund 命名债）见 [BACKLOG.md](../BACKLOG.md)。
> ⚠️ **措辞订正（2026-07-04 体检）**：① reverse 整笔冲正 / REVERSED / FAILED 实为**死枚举 + 无 reverse 端点**（原 2026-06-26 ✅ 过度声明，降为 ADVANCED 待做）；② 编排类名实为 `SwapWorkflowService`+`SwapLegAccounting`，**无 `SwapSettlementService`**；③ swap 腿 = funds_order（代码仍用 InternalFund 旧名，命名债）。
> ⚠️ **合规边界订正（2026-07-04 调研）**：truth/v6-swap.md §11/§47「合规仅 L1＝设计决策非遗漏」**部分错误**——只 Travel Rule 该豁免，AML 监控/最优执行/EDD 不该豁免（详见 spec §四）。truth + BACKLOG 待同步（本轮仅动 roadmap + spec）。

---

## V7 — 财资运营（Treasury Ops）

> 管**公司自有资金与流动性**（客户的钱由 V4-V6 管，实时1:1 safeguarding）。
> ⚠️ **旧 V7「内部转账 / 延迟结算」整套已废弃**：随实时1:1 重构，通用内部转账工作流 / EOD 轧差结算 / 充值归集 cron / 手续费归集 / 法币交割 / Outstanding / SettlementBatch / FeeAccrual / 白名单 全部删除（C5b）。每笔交易现**自己就地记账**（V4 两步 / V5 payout+fee / V6 四腿）。资金单（funds_orders）是**跨版本共享原语**（V4 起在用），归 `truth/funds-orders.md`（待建），不属于本版本。
> **前置**：V3（账户模型）。
> 📖 无独立 truth（无活体 V7 业务）；共享资金原语见 `truth/funds-orders.md`。旧「内部转账 / 延迟结算」设计已删，仅存于历史 spec（`superpowers/specs/2026-06-*-v7-*`，只读追溯，勿当现状）。

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
> 📖 **调研留底** → `superpowers/specs/2026-07-06-v8-reconciliation-research.md`（首次遗漏审计）
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

- [ ] ⚖️P1 差异处理人工闭环 + **未平差异报 VARA** — Finance 人工核实/补录→RESOLVED + 24h SLA 升级 MLRO/CFO；**重大差异未纠正→末级终态生成 VARA 通报工单(REPORTED_TO_VARA)+审计打点**(现止于内部 RESOLVED、无对外出口) ｜CRM IV.E.5(Client Money)+V.D.2(Client VAs) 一手核 ｜三路 3:0
- [ ] 其余 6 平账处置动作 — 补单/冲正/冲销/豁免/偿付/…(推单已做) ｜来源:业务
- [ ] 偿付义务工作流(Reimbursement) — 从 V7 移入；OPEN→审批(CFO/MLRO)→REIMBURSED；表已 drop 留 hook；两触发源(对账差异/event 失败)共出口 ｜来源:业务+VARA
- [ ] ⚖️ Proof of Reserves（**改写：非单纯季度**）— 真实义务四件：储备资产**每日对账** + **≥每半年独立第三方审计** + 审计报告随**季报**交 VARA + **VARA 随时索取即须能出**(on-demand)；口径 Sum(客户 VA 负债)≤HexTrust 储备 ｜CRM V.C.1 + Company Rulebook 储备资产节 Rule 3(一手核) ｜⚠️2026-07-06 订正:原"季度"既漏半年审计、又把 on-demand 窄成定时任务
- [ ] 对账报告导出 — 日期范围摘要(余额差/匹配率/未决 Case)，VARA 审计 / 半年独立审计输入 ｜VARA
- [ ] LP 仓位对账 — 与 LP 对手方核对 LP-IN/OUT，依赖 LP API/文件 ｜来源:业务

#### 🔄 2026-07-06 遗漏审计追补（fable-5 精简版；差异闭环/PoR 已就地改写、银行确认函→V3、枚举坑→BACKLOG）

- [ ] ⚖️P1 对账流程利益冲突隔离 — 跑对账/重对账、执行平账动作(推单等)、RESOLVED 关 case 的角色须互斥、不得同时是能制造差异的资金操作方(≠V1 公司级 SoD，本条是对账域专条) ｜CRM IV.E.4(一手核)
- [ ] ⚖️P1 对账底稿+外部原件 8 年原生留存 — run 结果/匹配明细 + **银行/HexTrust 原始对账单原件**按 native 格式存 ≥8y、随 VARA 索取即出(现归一化入库后原件无留存、DB 在 /tmp) ｜CRM I.F.1-3(一手核) ｜与 V5/V6 记录字段集同源
- [ ] P2 成文对账政策 — 五桶阈值/差异分级/SLA/处置权限/升级路径写成受治理政策文档 + 定期复审 ｜CRM I.B.3/4

> **设计前提（仍有效）**：① Gas 全由公司承担，客户资产不因 Gas 产生差异；② 实时1:1 双式记账保证客户资产与负债内部持平，对账退化为外部核对。
> **技术债**（reObservedCount=0 bug / Reimbursement 三处残留 / FIRM treasury 历史残留 / 资本注入 evidence 待核）见 [BACKLOG.md](../BACKLOG.md)。

## V9 — 合规治理顶层（Regulatory Governance）

> V1-V8 交易层之上、**直接面向监管机构（VARA / UAE FIU / EOCN / UAE Data Office 等）和客户**的合规治理义务。
> **边界铁律**：Sumsub 承接**检测**（KYT/筛查/持续监控 → 告警）；V9 做 Sumsub 覆盖不到、**法定责任在持牌人/MLRO 身上不可外包**的申报/上报/裁决/配合。⚠️**制裁命中独立单列**（2026-07-06 复查纠正旧"不单列"错误：CNMR/PNMR 是 goAML 上与 STR **并列**的独立报文，STR 覆盖不了）。
> **前置**：V1-V8。
> 📖 **调研留底** → `superpowers/specs/2026-07-04-v9-regulatory-governance-research.md`（含 2026-07-06 遗漏复查追补 17 条 + 产品大白话）。本节 2026-07-04 据 VARA Rulebook 深度调研重排（9 条 3:0），2026-07-06 fable-5 遗漏复查追补（24 条候选全 3:0 确认）。

### MVP（P0 · 牌照级 / 上线前必须——个人客户即适用，法定义务不可延后）

**A. 反洗钱 / 制裁报案（goAML 报文族，MLRO 不可外包）：**

- [ ] ⚖️ **STR/SAR 申报** — Sumsub 告警→案件落地→MLRO 研判→报/不报决策+依据留档→goAML 提交→回执+FIU 追问→事后处置(联动 V2 冻结/改风险评级)；**无固定天数(immediately)**；MLRO 唯一责任人 ｜CRM III.F.3(a)/III.F.4
  - [ ] ⚖️ **tipping-off 防护门**(随 STR 同生) — STR 案所有对外/跨角色通信强制过防泄密门；泄密=联邦刑事罪(6 月监禁+AED 10-50 万) ｜III.F.3(d) + AML-CFT Law Art.25
  - [ ] **goAML 注册**(上线前置) — 平台/MLRO 在 goAML 门户注册且保持 active，否则无法报任何 AML 事项 ｜CBUAE Rulebook 4.3
- [ ] ⚖️ 🆕 **制裁确认命中 → CNMR 报文** — 命中制裁名单(本地恐怖/UN 综合)→**≤24h 冻结全部资产+停服+禁 tipping-off**→冻结后**5 个工作日**内经 goAML 交 CNMR(原 FFR)**抄送 EOCN+VARA**(STR 只到 FIU、覆盖不了)→冻结无限期至除名；漏报罚 AED 5 万起+刑责 ｜Cabinet Decision 74/2020 Art.21/22 + EOCN TFS Guidance(2025-07 FFR→CNMR)
- [ ] ⚖️ 🆕 **制裁部分命中 → PNMR 报文** — 模糊同名排除不了→24h 暂停+10 工作日排除窗口→排除则恢复/否则拒绝交易+5 工作日交 PNMR→**挂起直至 EOCN 经 goAML 下指令**；**无需"怀疑"即触发，STR 状态机接不住** ｜Cabinet Decision 74/2020 Art.21/22
- [ ] ⚖️ 🆕 **EOCN 名单订阅(NAS)+ 更新全库重筛** — 注册 EOCN 通知系统(与 goAML 注册并列的上线前置)→名单一更新即全库重筛→**24h 冻结时钟从 UNSC/内阁列名起算**(非从发现起) ｜EOCN TFS Guidance 步骤1/2 + Cabinet Decision 74 Art.1

**B. 向 VARA 主动上报（出事 / 变更 / 自首）：**

- [ ] ⚖️ **VARA 重大变更/合规受损上报** — 变更类=**事前书面审批门**(发生前取批准，非事后通知)；一般合规受损=**immediately 通知**+回执跟踪 ｜Company Rulebook VIII.A.1.a + Section H
- [ ] ⚖️ **网络安全/BCDR 事件上报** — 材料性网安或触发 BCDR→**检测后 72h 内报 VARA**(性质/范围/影响+缓解+是否已报他机关) ｜TIR Rulebook Section K + H
- [ ] ⚖️ 🆕 **个人数据泄露上报** — 泄露(含无网安的误发/供应商侧)→报 **UAE Data Office(非 VARA)** + 通知受影响客户(四要素)；Sumsub 等处理方须即报平台、责任在平台不可外包 ｜UAE PDPL(Federal Decree-Law 45/2021) Art.9 + VARA TIR II.A.1
- [ ] ⚖️ 🆕 **数据泄露后 24h 再报 VARA** — 向 Data Office/客户发出泄露通知后**24h 内**再报 VARA(事件报告摘要+副本)——独立于 72h 网安线的第二只钟、起点更晚更紧 ｜VARA TIR Part II Section C + CRM I.1.4
- [ ] ⚖️ 🆕 **审慎指标跌破即报** — NLA(≥1.2×月运营支出)**每日核对**、跌破→**immediately** 通知 VARA(缺口/原因/整改/时限四要素)+**每日更新直至 VARA 认可** ｜Company Rulebook VI.C/VI.F
- [ ] ⚖️ 🆕 **外包商失效即报** — Material Outsourcing 协议重大违约(Sumsub 筛查中断/HexTrust 托管违约)→**immediately** 报 VARA ｜Company Rulebook IV.H.1

**C. 应监管 / 应客户：**

- [ ] ⚖️ **监管信息请求配合** — FIU/VARA 追加信息→**48h 硬性回复**；证据调取横跨 V1 审计 + V4-V8 交易/对账 ｜CRM Rulebook III.F.3(b)
- [ ] ⚖️ **客户投诉处理** — 受理→确认(**≤1 周**)→调查→裁决(**≤4 周**，例外**≤8 周**且第 4 周出状态更新)→三段留档(投诉/措施/结果) ｜Market Conduct Rulebook III.A

**D. 业务专属：**

- [ ] ⚖️ **资产持续监控**(仅当自行上架/分销资产) — 资产不再合规→immediately 暂停分销；Issuer/资产材料性变更→immediately 重跑尽调 ｜BD Rulebook IV.E
- [ ] ⚖️ 🆕 **营销内容发布前合规审批门** — App 内 banner/推送/活动页/KOL 稿出街前过合规 checklist(禁保证收益/禁 FOMO/强制风险声明)+合规官批准留痕；第三方营销须持牌方书面批准 ｜Marketing Regulations 2024 I.B.3.b + I.C.2/I.C.3(违规单次罚至 AED 1000 万)

### ADVANCED（P1 · VARA 强制但非上线阻断）

- [ ] ⚖️ **MLRO/董事会季度合规报告** — 季度 cadence；含 AML/CFT 有效性评估 + 失效项指认 + 当季**匿名增强交易(AET)摘要** ｜CRM Rulebook III.A.2.f/g/h
- [ ] ⚖️ 🆕 **全行 AML/CFT 风险评估(EWRA/BRA)** — 公司整体风险评估(VA/技术/产品/渠道，≤3 月频率+重大变更即评)，结果**反哺 V2 CRA 方法论**与资源分配 ｜CRM III.D.1-4 ｜来源:2026-07-06 V2 审计分拣归 V9
- [ ] ⚖️ 🆕 **制裁误冻结申诉/解冻除名** — 客户申诉误冻→法定 grievance 程序→经 EOCN/goAML 走解冻或除名执行(≠普通客户投诉) ｜EOCN TFS Guidance
- [ ] ⚖️ 🆕 **市场违法双头上报** — 怀疑内幕/操纵/损害市场公平行为→按法定六字段报 **UAE FIU + VARA 双通道**+备查(触发/对象/报文均异于洗钱 STR) ｜VA & Related Activities Regulations 2023 Part VIII §J.2/J.3/J.4 ｜⚠️纠 V6 引用(误标 Market Conduct)
- [ ] ⚖️ 🆕 **定期财务申报(月/季)** — 月:资产负债/损益/现金流/自有钱包地址/关联方交易；季:董事会纪要/财务合规声明/风险敞口 报 VARA ｜CRM Rulebook Section H Rule 1/2
- [ ] ⚖️ 🆕 **年度审计申报** — 经审计年报+内控鉴证+高管合规评估+**首 100 名客户 onboarding 抽样**+集团结构 报 VARA ｜CRM Section H Rule 3 + Company G.1
- [ ] ⚖️ 🆕 **关键人员(RI)更换事前审批** — 换法定负责人**先批后换**；突发离任才可事后 immediately 通知+接续方案；RI 年度适格复核留痕 ｜Company Rulebook I.C.2/3/4
- [ ] ⚖️ 🆕 **营销激励事前 confirmation** — 注册奖/邀请返佣/充值送等**每场活动事前取 VARA compliance confirmation** 方可上线+持续遵守附加条件 ｜Marketing Regulations 2024 I.C.2.l
- [ ] ⚖️ 🆕 **营销档案 8 年留存** — 全部营销物料(含 App 推送/活动页快照)+分发明细存 ≥8 年、随 VARA 查随出 ｜Marketing Regulations 2024 I.C.4
- [ ] ⚖️ 🆕 **Material Outsourcing 事前通知+登记册** — 新签/改约重大外包(Sumsub/HexTrust)先通知 VARA、异议清零才生效+维护外包登记册 ｜Company Rulebook IV.H.3/H.4/F.6 + IV.C.2.b
- [ ] ⚖️ 🆕 **吹哨人制度** — 建内部举报渠道(可匿名)+官网显著位置公示(与隐私/投诉政策并列)+年度有效性评估 ｜BD Services Rulebook I.B.1.b + I.A.2
- [ ] ⚖️ 🆕 **VARA 现场检查配合** — 检查通知→按**通知载明期限**(非固定 48h)开放账簿/系统/场地+verification 回执；上线前置:客户协议预置"同意向 VARA 报送交易信息"条款 ｜VA & Related Activities Regulations 2023 Part IX.B
- [ ] ⚖️ 🆕 **高危国家交易报文(HRC/HRCA)** — 涉 NAMLCFTC 高风险国家交易→**先扣住**→交 goAML 报文→**报后满 3 个工作日 FIU 不反对方可执行**(阻断型，需交易引擎 HOLD 态) ｜UAEFIU goAML Report Types + NAMLCFTC 名单

### P2（低频 / 治理）

- [ ] ⚖️ 🆕 **外部审计师任命/更换通知** — 委任/更换审计师 promptly 通知 VARA(名称+联系方式)；VARA 可强制改聘(通知制非批准制) ｜Company Rulebook Section G Rule 1
- [ ] ⚖️ 🆕 **员工个人交易(PA dealing)制度** — 员工/董事开/改/平任何 VA 头寸须**事前书面批准**+每 6 个月强制申报持仓与交易史+冲突强制处置+入职告知书 ｜Market Conduct VI.B.1-5 ｜来源:2026-07-06 V6 复查分拣(V6 只留抢跑侦测规则)
- [ ] ⚖️ 🆕 **内幕名单登记册** — 可接触内幕信息(调价计划/价源切换/上下币决策)人员登记+进出留痕+书面知悉确认+8 年留存随查随出 ｜Market Conduct VI.A.1-5 ｜来源:2026-07-06 V6 复查分拣
- [ ] 🆕 **第三方执行返佣禁令政策** — 禁止与兑换成交量/点差收入挂钩的介绍人/affiliate 返佣;涉执行的第三方酬金协议过合规审查+登记留痕 ｜BD II.A.7 ｜来源:2026-07-06 V6 复查分拣
- [ ] ⚖️ 🆕 **董事 fit & proper 审批+年检** — 每名董事须 VARA 批准为适格人+每年复核+失格即免职补任 ｜Company Rulebook I.B.1
- [ ] ⚖️ 🆕 **控制权/股权变更审批** — 可能改变 Control 的动作→由拟取得方向 VARA 申请→**30 个工作日**审+新控制人/UBO 尽调+非 PEP/非制裁声明 ｜Company Rulebook VIII.C + I.A.5
- [ ] 🆕 **违规营销整改/下架执行** — 收 VARA 针对营销的 cease-and-desist/整改令→限时下架+执行留痕+回报 ｜Marketing Regulations 2024 II.A.1

### 跨版本基础设施（非独立工作流，服务上面所有 P0/P1）

- [ ] **统一 SLA 监控层（"法定闹钟墙"）** — 收拢全部法定时钟成倒计时+升级告警：immediately(报案/自首) / 24h(制裁冻结·数据泄露报 VARA) / 48h(信息请求) / 72h(网安) / 3 工作日(高危国家阻断) / 5 工作日(制裁 CNMR/PNMR) / 10 工作日(部分命中排除) / 1-4-8 周(投诉) / 每日(NLA 核对) / 月·季·年(定期申报)
- [ ] **合规日历** — goAML 注册 + EOCN NAS 订阅 + 月/季/年报到期 + 董事年审 + 各监管截止日追踪台账

> **⚠️ 调研纠偏（2026-07-04）**：① "72h" 归属**网安/BCDR 事件**(旧版误挂"重大事件上报")；② 材料性变更是**事前审批门**非事后 72h 通知；③ STR **无固定天数**(immediately)；④ **STR 是 MLRO 经 goAML 自报，Sumsub 报不了**。
> **⚠️ 复查纠偏（2026-07-06，fable-5 遗漏复查，24 条 3:0）**：⑤ **制裁命中必须独立单列**——旧"不单列/STR 交叉点"是错的，命中后只发 STR 会**漏发 CNMR/PNMR**，直接踩 Cabinet Decision 74 罚则；⑥ "定期 regulatory returns 待核"**已锚定**——CRM Section H 月/季/年申报确为硬性义务，不再待核；⑦ 追补 17 条独立义务(制裁报文族/数据泄露双钟/定期申报/审慎跌破/营销/外包/人员治理/市场违法/现场检查/高危国家)——规律=旧调研凡"不单列/待核/顺带一提"处皆为漏。
