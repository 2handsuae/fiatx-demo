# Sumsub 待开通服务清单（沙箱实测缺口）

> 业主维护 ｜ 实测环境：沙箱租户 `fiatx.com_181762` ｜ 实测日期 2026-10-20/21（Claude 会话实走取证）
> 用途：找 Sumsub CSM / support 开通时照单报；开通一项划掉一项。
> 已确认开通（对照组，来自 entitlements 接口，共 21 项）：`PAYMENT_SOURCE`、`KYT`、`KYT_ANTI_FRAUD`、`KYT_UNHOSTED_WALLET_VERIFICATION`、`TRAVEL_RULE` 等。

## 一、确认未开通（有错误实证）

### 1. Standalone Wallet Attribution（独立钱包归因）
- **接口**：`POST /resources/api/wallet-attribution`
- **实证**：2026-10-20 实调返回 `403 "You don't have this feature enabled, please contact us"`（correlationId `4d399c4e888cf71c0a73980f18fc28e0`）
- **我们哪些流程依赖**：
  - 提现地址登记：hosted/unhosted 分流（进不进 VASP 尽调门的判定者）
  - 充值到账：来源地址归因（是哪家 VASP 的 → 查尽调册 / 无主 → unhosted 政策）
  - LP 到货验收：来源归因 =「真是 Falcon 打来的吗」软核对
- **开通要求**：CSM 开 feature + App Token 需 "Manage TM transactions – Decisions" 权限

### 2. 钱包所有权验证的链支持（Crypto ownership verification）
- **症状**：WebSDK 收付方式流程里，自声明/签名/Satoshi 提交后报 `Try again or use a different device`；用既有级别（satoshi wallet test）复现出明文错误：`This blockchain isn't supported for verification`
- **实证**：2026-10-19/20，多配置交叉排除（关签名、关 Satoshi、换 DEFAULT/SIMPLE 表单、真实主网 ETH 地址、手机扫码接力）均同错 → 非级别配置问题，是租户的链上验证支持未配
- **我们哪些流程依赖**：提现地址登记「unhosted × 本人」格的签名强验证；unhosted 自声明表单（`unhostedWalletFormType`）
- **开通要求**：CSM 配置 ownership verification 支持的链（至少 ETH / TRX）

## 二、待与 CSM 确认（有疑点，未定性）

### 3. 收付方式风险筛查的触发条件（Crystal 筛查流水线）
- **症状**：API 直调 `POST /applicants/{id}/payments` 加地址后，`GET /resources/checks/latest?type=PAYMENT_SOURCE` 持续为空；但走 WebSDK/actions 路径时筛查秒出（实测落 YELLOW 两次）
- **要问的**：API 直加的收付方式是否也自动触发钱包筛查？还是必须挂 action / 等审核流水线？沙箱与生产行为是否一致？`walletScreeningProvider: crystal` 在沙箱是 mock 还是需正式 Crystal 合约（BYOK）？
- **我们哪些流程依赖**：提现地址登记的「风险筛查」步（API 直调为主干的架构前提）

### 4. Travel Rule 验证规则 / 生态配置未激活（2026-10-21 实测补充）
- **症状**：真实提交两笔 `travelRule` 型入账交易（200，score 80，命中 Counterparty AML Screening 规则），但 `travelRuleInfo` 全程空——交易内归因（counterpartyVaspId）未填充、认领挂起位（needApplicantOwnershipConfirmation）未升起
- **判断**：挂起位是规则驱动的（文档："归因认不出 → 触发 the verification rule"），本工作区未配 TR 验证规则 / 未加入 TR 目录生态
- **要做的**：先在 Dashboard → Transactions and travel rule → Settings 自查（TR 规则、目录加入状态部分自助可配），装不上再问 CSM
- **对照（不用开通的）**：VASP 尽调弹药接口**现在就能用**——目录 `GET /resources/vasps/-;hidden=false,$null`（实测 637 家）、单家 `GET /resources/api/vasps/{id}/one`（EEC 状态 / 风险标 / 监管登记行）；KYT webhook 事件族含 `applicantKytTxnAwaitingUser`（等用户动作）、`applicantKytOnHold`、`travelRuleAction`

### 5. TR 阈值是否支持"关联交易累计"（2026-10-21 待确认）
- **背景**：TR FAQ 明文阈值按"the transaction amount"（单笔）判断，低于阈值自动 Not Applicable；VARA III.G.2 的口径是"单笔**或关联交易累计**"
- **要问的**：TM/TR 规则能否按同客户×同来源的累计金额触发 ownership confirmation / hold？若不能，关联累计监视器全量落我们系统（关联键定义 + 滚动累计 + 过线处置）
- **立场**：无论答案如何，累计口径的定义与兜底责任在持牌人（我们），工具只代执行

## 三、候补（有需要才买，现阶段不开通）

### 6. KYB（公司型 applicant 的实体尽调）—— 候选而非必购（2026-10-24 LP 两步准入补记）
- **产品**：Sumsub KYB——给对手方（LP）建公司型 applicant，并跑 applicant 级 AML 筛查
- **我们哪些流程依赖**：LP 与外包服务商准入里的逐名筛查——**现为合规官人工登记、无外部服务**（2026-10-28 甲波六退役原 `lp-desk/lp-entity-screening.mock.ts` 三档 mock；见 `reference/sumsub-mock-touchpoints.md` ⑨ 行与 `modules/compliance-office.md` §3.3）。若采用 KYB，自动筛查结果将落入同一套逐名筛查记录
- **口径**：这不是缺口，也没有错误实证（`src/` `scripts/` `prisma/` 与两个前端内按 kyb / company applicant 字面搜无任何调用）——LP 两步准入本轮刻意不建 Sumsub 主体，KYB 是「不必」而非「不能」。真集成时与「人工尽调流程（不经 Sumsub）」二选一，届时定
- **购买触发点**：① 公司型客户上线（需要给公司型客户做 KYB）；② 对手方数量大到人工复审追不动。**现阶段**对手方很少，人工尽调（注册文件 + 牌照公示核验）加制裁筛查订阅即可履约，不必买
- 找 CSM 时别把它当缺口报——它不在上面两类里

## 四、本清单的来源与口径

- 证据全部来自真实沙箱调用（级别 `Address screening demo` id `6ad67e51b90e9c26efe9f488`、测试 applicant `addr-demo-*` / `wd-demo-alice`），复现步骤在会话演示页 `withdraw-address-demo.html`（本地 scratchpad，含每步接口契约）
- 「未开通」与「待确认」分开列：前者拿错误码说话，后者只有行为疑点——找 CSM 时别把二类当一类报；「候补」（第三节）是还没到购买触发点的产品，无错误也无疑点，不用报
