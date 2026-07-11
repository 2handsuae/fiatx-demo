# V2 客户管理+合规底座 — 深度审计留底（Customer Compliance Gap Audit）

Date: 2026-07-06 ｜ Status: 首次深度审计定稿（V2 此前只做过体检+truth，无 deep-research；本次为全量找漏）
Method: workflow harness，69 agent / 6 盲区猎手（CDD 生命周期 / PEP / 依赖 Sumsub 条件 / 客户准入硬边界 / CRA 方法论 / 冻结退场）拿 roadmap+truth 当基线**只找清单外义务** + 每条候选 3 视角对抗（条款真伪 / 真未覆盖 / 归属 V2）；21 候选 → **3 P0 + 8 P1 + 1 归 V9 + 1 待核 + 6 驳回**。护栏：BD-only 铁律、Corporate 域不报（已列将来项）、BACKLOG 已知缺口不重报、核不到一手原文只能 UNCERTAIN。
⚠️ **运行中 fable-5 撞月度额度上限**：最后一个盲区（冻结/退场）7 个 verify agent 挂掉，其 [17] 仅 2 票、[20] 0 票（见 caveat）。

---

## 核心结论

**V2 三层合规骨架（Onboarding/CRA/Material Refresh/Tier/冻结）方向对、已可用，但 3 个 P0 全卡在同一个根因——过度信任 Sumsub 的"绿灯"。** 一个住伊朗、名字干净的普通人，Sumsub 出 green，现有 6 规则策略就自动放行了：地域没进风险因子、底层档案没拉回本地、准入侧没有独立地域门。这三个都是**客户资格门（assertTradingEligibility）的窟窿**，而资格门是 V4-V6 每笔交易的上游。

## P0 · 资格门窟窿（3 条，均 3:0）

### ① 底层 CDD 档案本地留存 + 随取（不能只留 Sumsub 结论）
- 现有 Sumsub Webhook 翻译层摄入的是审核结论/AML 标签；缺"把底层资料（证件影像/核验报告/命中详情）拉回本地留副本、without delay 可调阅"。监管索档现在拿不出；ADVANCED"KYC 归档 8 年"挂在销户时点，不满足存续期随时可调。
- 依据：FATF R.17（依赖第三方须 immediately 取得底层 CDD 资料）+ Cabinet 134/2025 第三方依赖条款 + VARA CRM III.E.6(a)(i)/III.I（记录保存）。

### ② 高危国家客户"准入侧"强制 EDD + 黑名单辖区拒入
- CRA 6 规则全由 Sumsub AML 命中驱动；国籍/居住国命中 FATF/NAMLCFTC 高危名单**本身**应触发强制 HIGH+EDD（黑名单 call-for-action 辖区→拒入），不依赖名字命中。现住伊朗的干净客户走 green 自动通过。
- 依据：Cabinet 10/2019 Art.22→134/2025（对高危国家自然人强制相称 EDD）+ FATF（伊朗/朝鲜 countermeasures、缅甸列名）。

### ③ CRA 补法定四维风险因子
- 客户风险评估法定最低因子集 = **客户类型 / 地域 / 产品服务 / 交付渠道**；现 6 规则全是筛查结果+材料时效，无地域/产品/渠道基线因子。与 ② 同根：地域没进因子，高危辖区干净客户直接 green_stable 自动签署。
- 依据：Cabinet 10/2019 Art.4.1（原文四维因子）→134/2025（+扩散融资）+ VARA CRM III.E.2/III.D.6-7。

## P1 · VARA 强制（8 条）

1. **CDD 完不成/维持不了→强制退出+STR评估**（3:0，III.E.8）：Material Refresh 终点是 BLOCKING→冻结+补件解冻，**冻结可无限期挂起=违反 III.E.8(a) 不得 maintain**。须"合规强制终止关系闭环（挂销户）+ 是否报 STR 决策留痕"。（候选 [0][13][19] 同主题去重为一。）
2. **触发式 re-CDD 存疑重核**（3:0，III.E.4(c)(d)）：对已有身份信息真实性起疑（举报/交易监控升级）时须**重核身份**，非只重跑风险分。现 CRA 触发源只有 Sumsub 事件+月度 cron，产出是评级不是重核。
3. **PEP 建立/继续须 MLRO+高管层双批**（C2R1→P1，III.E.6(a)(vi)+FATF R.12）：现仅 MLRO 单签，缺 Senior Management 第二把钥匙；"中途变 PEP"同样适用。
4. **PEP 识别含家属/密切关联人 RCA**（3:0，Cabinet 134/2025+FATF R.12）：现仅单"PEP"标签；家属/关联人命中落 red_other/green 错轨。
5. **Sumsub CDD 质量定期抽测**（C2R1→P1，III.E.9）：只复核客户、从不复核供应商 CDD 输出质量；最终责任不可转移。（候选 [9] Sumsub 等效性评估并入本条。）
6. **禁匿名/别名账户系统落地**（3:0，Cabinet 134/2025+FATF R.10）：账户↔法定身份唯一绑定 + 同人重复/别名去重 + 展示名≠真名禁止。
7. **未成年/行为能力准入门槛**（3:0，Federal Decree-Law 25/2025）：<18 拒入；阿联酋成年线 **2026-06-01 刚从 21 降至 18**，新生效易漏配；CDD 已采 DOB→落硬闸。
8. **客户级冻结 tipping-off 内外双轨**（⚠️2 票，III.F.1+联邦 10/2025 Art.29）：客户级自动冻结（制裁/CRA/材料 BLOCKING）对客展示须内外分离，直显制裁/AML 原因=刑事罪；V5 提现双轨同源扩展到 V2 客户级。

## 归属 → V9（公司制度，非客户级）

- **全行 AML/CFT 风险评估 EWRA/BRA**（3:0，CRM III.D.1-4，≤3 月频率）：公司整体风险评估，与客户级 CRA 是同章两个平行义务。按分拣原则归 V9；但 III.D.4 要求 BRA 结果**反哺 V2 CRA 方法论**，故 V2 留接口。已入 roadmap V9。

## 待核（fable-5 额度中断，0 票，不当确认）

- **被拒申请人 CDD 材料 8 年留存**（[20]，medium，VARA III.H.1(b)）：REJECTED 终态申请人的 Sumsub 材料/拒绝记录是否须留存禁清库（尤涉制裁/PEP 被拒）。看似合理（CDD records 含 prospective client），但**0 核验**——须补一手复核。

## 对抗驳回 6 条（含 2 个"读代码"good catch）

- **CDD 复审周期分层**（0:3）：核验员读 `config/material-refresh-policy.json`——已按 LOW/MED/HIGH 分层（LIVENESS 730/365/180 天等）。伪缺口。
- **CRA 方法论未成文/未批准**（0:3）：核验员读 `config/client-risk-assessment-policy.json`——已是版本化声明式 config（v1.0.0）。伪缺口。
- **Sumsub 宕机硬暂停**（0:3）：onboarding 状态机已结构性 fail-closed，无需专门机制。
- **制裁 TFS 解冻权外部授权**（0:2）：V9 已有"制裁误冻结申诉/解冻除名"覆盖。
- **PEP 强制 SOF/SOW**（C1R2）：与现有 HIGH→EDD 路径（III.E.10）重叠，实质并入 PEP 双批/RCA 两条。
- **Sumsub 等效性评估**（C1R2）：并入"定期抽测"（III.E.9）/ V9 外包治理。

## caveat（含方法论教训）

- ⚠️ **fable-5 月度额度中断**：冻结/退场盲区核验不全（[17] 2 票、[19] 1 票但与 [0] 同主题已 3:0、[20] 0 票）。
- ⚠️ **联邦法/Cabinet 条款号（10/2019→134/2025 承接）多系 gap-audit 溯源**，新条号"待逐字核"已标注；VARA CRM III.E 系列多条已一手核到 rulebooks.vara.ae。承接 V5 教训：**3:0 一致 ≠ 原文为真**，动工前须一手复核。
- ✅ 本轮亮点：对抗核验含**读代码验证**，毙掉 2 条"代码其实已实现"的伪缺口——是对"3:0 共享坏源"风险的有效对冲。

---

## 2026-07-06 补核（额度中断两条，opus 一手补全）

**[17] 客户级冻结 tipping-off → 降级 P2（读代码坐实"当前非活漏"）**
- 一手读码：`customer-auth.service.ts:182-210` 冻结客户登录时 `complianceFreezeReason`(值含 `sanctions_hit_pending_investigation`，CRA:450 制裁路径设)**仅写入审计日志 metadata**，抛给客户的是中性 `CUSTOMER_ACCOUNT_FROZEN`+"联系客服"；`profile-banners.service.ts:45/58` 横幅文案亦中性("请联系合规团队"/"合规审查进行中"，不显制裁/AML/PEP 字样)；客户端控制器/DTO/client-web 全无 freeze reason 引用。
- 结论：**当前代码 tipping-off 安全**，[17] 从 P1 活漏降为 **P2 设计硬化**（缺的是强制内外分离约定防未来回归，非现存泄露）。
- ⚠️ **自我纠错留痕**：合成报告时我曾据半截 grep 误断"auth 响应活泄露 reason=刑事级"，读全代码后推翻——**又一例"grep 半截即断"教训，与 daily-aggregated 同类**；下断言前必读全代码/原文。

**[20] 被拒申请人留存 → 窄化 + 纠条款**
- 一手核 rulebooks.vara.ae：记录保存实为 **Part III.I**（gap-audit 引的 III.H＝"制裁"章，误引）；III.I.1.b 留 CDD records 含"results from the investigation and analysis of clients' activities"、III.I.2 留 **≥8 年**。但**原文仅"clients"、无 "prospective"/被拒申请人字样**。
- 结论：站得住的是窄版——"被拒过程若触发了调查/分析（制裁/PEP 命中），那些记录属 III.I.1.b 须留 8y"；"全部被拒申请人材料留存"是推断，P2/medium 保留。条款订正 III.H.1(b)→III.I.1.b/III.I.2。
