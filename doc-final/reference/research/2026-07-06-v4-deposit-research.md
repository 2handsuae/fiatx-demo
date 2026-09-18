# V4 充值流程 — 深度审计留底（Deposit Gap Audit）

Date: 2026-07-06 ｜ Status: 首次遗漏审计定稿（V4 此前只有体检+truth，无 deep-research；本次补齐"收款方 beneficiary VASP"视角）
Method: workflow harness（精简版），44 agent / 5 盲区猎手（收款方 TR / 法币收款 Client Money / 拒收退回 / 来源画像 / 记录+暂扣时限）拿 roadmap+truth 当基线只找清单外义务 + 每条 3 视角对抗（条款真伪 / 真未覆盖 / 归属 V4）；13 候选 → **去重后 8 存活（6 P1 + 2 P2）+ 2 驳回**。护栏：BD-only、托管归 HexTrust、V4 ADVANCED 本厚故已列条目只有"语义缺口"才算发现、一手核不到只能 UNCERTAIN。1 verify agent 断线（对应条目 2 票定论）。

---

## 核心结论

**V4 原骨架（暂扣两步记账 + L1 + L2 + 三个 P0 异常闭环）方向对、无新 P0——这轮补的是"收件人视角"。** V5 研究补齐了"发件人义务"（往外发币要发 TR 报文），但 V4 是**收款方（beneficiary VASP）**，收件人有一组镜像但**不对称**的义务，此前一件都没有：报文要"对答案"、个人钱包来源要单独处置、生人交易所要先"查户口"。

## P1 · 收件人义务（6 条，与 V5 发件人对称）

1. **TR 受益人准确性核验闸门**（3:0，CRM III.G.3 一手核）：>AED 3,500 充值在入账（G.3"允许客户访问"时点=Step2）前，把收到的 TR 报文受益人姓名+钱包/账号与本方客户档案逐字段比对，不符→挂起转 MLRO 禁入账；报文原文随单留存。现只管数据"到没到"（presence），不管"对不对"（accuracy match）。
2. **Unhosted 来源充值差异化处置**（3:0，CRM III.G.7(a) 一手核）：来源判定 unhosted 时不进"等对手方数据"分支（没有对手方 VASP 永远等不来），改走独立政策（所有权自证/增强监控/限额/退回，均留痕）。⚠️ 核验读代码+BACKLOG 证实**现设计反把 unhosted 判 NOT_REQUIRED 自动放行，比 hosted 更松、管反了**。V5/V3 只落了提现侧 unhosted，充值侧（G.7(a) 明文含 deposits）无镜像。
3. **收款侧对手方 VASP 尽调入账门**（3:0，CRM III.G.6 一手核）：来自某 hosted 钱包（=某外部 VASP）的充值，该 VASP 首次交易前须完成 risk-based DD、未尽调不得直接入账（查一次即可，除非风险升高）。"any transaction" 不限方向，V5 只落发送侧。（候选 [2] P2 与 [9] P1 是同一义务，取 [9] 的 P1。）
4. **法币到账 1 日入 Client Account**（3:0，CRM IV.B.5.a 一手核）：收到客户法币须 1 个自然日内存入 Client Account，暂扣审查不豁免隔离。境外 24h 汇回境内已在 V3 银行配置。（候选 [3]+[12] 合并。）
5. **拒收充值原路退回**（2:0:1，CRM III.G.4(b)+G.9）：可退回的拒收（KYT FAILED/合规拒绝/孤儿到期）只可退回原来源（链上退原 originator 地址、法币退原汇出账户），禁退客户指定第三方——否则平台成洗白通道（脏 A 进、干净出到 B 带持牌背书）。与 P0 制裁禁退是不同分支。
6. **充值记录法定字段集 + 来源画像留存**（3:0，CRM I.F.1-2 + III.G.3/G.4）：每笔充值留存最低字段（金额/时间/payment instruction/费用/客户+居住国/对手方 VASP·托管方），含 originator 三要素 obtain-and-hold、≥8y、监管索取即出。与 V5/V6/V8 记录字段集同源。（候选 [8]+[11] 合并。）

## P2 · 低频/披露（2 条）

7. **Client Money 利息归属**（2:1，CRM IV.B.9.b.iii + IV.D.2.a.iii）：Client Account 生息中超出应付客户部分须 20 个自然日内移出；客户对账单披露利息。
8. **同来源跨客户复用监控**（3:0，CRM III.F.1/F.2）：同一外部来源地址/汇款人反复给多个不同客户充值（第三方代充/资金骡红旗）纳入可疑指标库。

## 对抗驳回 2 条

- **冻结/制裁禁退回硬门**（1:2）：已列 P0"制裁冻结完整闭环"语义已含（命中→FROZEN，不走退回分支）；退回硬门实质并入原路退回（[7]）。
- **混合汇款限时清出**（1:2）：与 Client Money 隔离/利息条重叠。

## caveat

- TR 系列（G.3/G.6/G.7）+ 记录（I.F.1）+ Client Money（IV.B.5/B.9）条款均标"一手核到 rulebooks.vara.ae"（多为三次抓取一致）；承接教训，动工前仍建议对 IV.B.9.b.iii "20 calendar days" 等具体数字复核一次。
- 1 verify agent（inbound-attribution scope）断线，[8] 以 2 票定论（均 CONFIRMED）。
- **至此九版本全部完成深度审计级复查**（V1/V2/V3/V4/V5/V6/V8/V9，仅 V7 未做——全 deferred + 托管签名归 HexTrust，合规暴露面最低）。
