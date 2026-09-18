# V7 财资运营 — 深度审计留底（Treasury Gap Audit）

Date: 2026-07-06 ｜ Status: 首次遗漏审计定稿（V7 全 deferred 无活体业务；本次审计目标＝deferred 清单的**法定约束补全**，非"现在做"）
Method: workflow harness（最小版），34 agent / 4 盲区猎手（储备构成/公司资金边界/金库混同/财务资源维持）拿 roadmap 当基线只找清单外义务 + 每条 3 视角对抗；10 候选 → **去重后 5 存活（全 P1）+ 4 驳回**。护栏：BD-only、业主边界决策（gas/热冷钱包/银行费→HexTrust/OpEx）不许挑战、客户的钱归 V4-V6、"V7 全 deferred"是业主决策——只判"义务是否存在且没家"。零故障。

---

## 核心结论

**"V7 全 deferred"的判断经审计站得住——但 deferred 清单本身缺 5 条"落地那天必须带上"的法定约束。** 都不是新工作流，是给已列条目（LP 调拨/再平衡/注资/收入提取）补合法性前提：不带着做，做出来就是违规的。

## 真发现（5 条全 P1，条款均一手核 rulebooks.vara.ae / 官方 PDF）

1. **财资安全港记录 8 年**（3:0，MC VII.A.2 一手核 PDF p.17）：自营禁令（VII.A.1）唯一豁免＝"prudent management of NLA/treasury/balance sheet"，硬前提＝*"maintain full records of all transactions…for a minimum period of eight (8) years"*。V7 每笔 FIRM 资金动作的合法性都靠此撑——**记录缺失＝豁免失效＝违反自营禁令**。落法：强制"审慎管理目的"字段+全量留档 8 年。
2. **储备注资同币种 1:1**（2:1，Company VI.E.2 一手核）：*"hold Reserve Assets on a one-to-one basis in the same Virtual Asset that liabilities are owed"*——ETH 缺口只能用 ETH 补，等值 USDT 充抵在监管口径缺口依旧。已列"储备金注资"只写方向未写注入资产合格性。异议票指出 V8 逐币种日对账会暴露残余缺口（不会静默），但成文约束缺失属实。
3. **NLA 白名单事前算术门**（[3]+[8] 两路合并，Company VI.C.1/C.2/C.4 一手核）：NLA≥1.2×月开支且**只准**现金等价物+VARA 批准的 USD/AED 锚定 VA——**BTC/ETH 库存不计入**；财资调仓可在无亏损情况下把 NLA 调穿，调拨前须算"动后达标吗"。
4. **手续费确权事件+公司钱 1 日滞留时限**（2:1，CRM IV.A.1+IV.B.9.b 一手核）：费按客户协议"immediately due and payable"后才脱离 Client Money（确权事件须协议明写）；公司钱混在客户账户最多 1 个日历日（超额利息 20 日——利息条已单落 V4）。挂"收入提取"。
5. **实缴资本信托锁定+复核补缴**（3:0，Company VI.B.1/B.3 一手核）：*"at all times, hold and maintain paid-up capital"*（BD+持牌托管=AED 400,000 或年度 overheads 15% 取高），置于 UAE 持牌银行信托账户（受益人 VARA）或无期 surety bond；overheads 涨→补缴。金库台账登记"碰不得的钱"+年度复核。

## 对抗驳回 4 条（本轮核验质量最高）

- **公司出金"事前覆盖率闸"**（1:2）：核验以**架构事实**驳——客户/公司钱包物理分池（客户钱包只装客户负债等额资产，费在交易当刻即以真实跨钱包腿落 FIRM 钱包），LP-OUT/收入提取/再平衡全从 F_* 钱包出金，动作碰不到客户池、"动后覆盖率"恒真空转；"at all times 100%"由 V4-V6 实时 1:1 结构性履行，错账路径由 V8 日检+V9 上报+V7 冲正兜底。**架构本身就是那道闸。**
- **财资兑换五因子档案**（0:3）：与安全港记录（#1）重叠，并入。
- **公司钱包台账/命名区分**（1:2）：V3 客户侧标注+ownerType/walletRole 角色体系已实质覆盖。
- **保险维持义务（VI.D）**（1:2）：诚实判归 **V9 公司制度域**（V9"审慎指标跌破即报"已含保险缺口）；标注归属、V7 不新增。

## caveat

- 5 条条款均一手核（MC VII.A.2 为官方 PDF 逐字比对；Company VI.B/C/E 为 rulebooks.vara.ae 抓取，多条双次一致）；动工前对具体数字（40 万/15%/1.2×/20 日）照例再核一遍。
- **至此 V1–V9 九版本深度审计全部收官**（2026-07-06 系列，各版 spec：v1-governance / v2-customer-compliance / v3-financial-config / v4-deposit / v5-withdraw(+3 追补章) / v6-swap(+追补章) / v8-reconciliation / v9-regulatory(+追补章) / 本篇）。贯穿方法论两条：①3:0 一致 ≠ 原文为真，写进代码的条款必须一手核（逮到 "daily aggregated"/“TIR III.A 冷却”两次错引）；②读代码/读架构的对抗核验是防伪缺口命门（本轮"事前覆盖率闸"即被架构事实驳回）。
