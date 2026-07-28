# TC-03 · 钱包（Wallet）测试用例

> 对应 PRD《3. 钱包 · Wallet》v0.2 ｜ 域码 `WAL` ｜ 41 条
> 口径与排除范围见 [README.md](README.md)

**本篇排除**：FR-5 / A-T4 收款账户失败原地重试（G3，意图未落地）；B-T6 取消后同址重提（G4，现为重新登记新号）；充值来源白名单逐笔比对（G1/Q1）；VASP 真实归因与所有权验证（G6/Q2）；代码残留的 FROZEN / PENDING_APPROVAL 钱包态（G5，本期不纳入）。

---

## 1. 收款账户创建与幂等（FR-2/3/4 · A-T1~T3 · AC-1.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WAL-001 | AC-1.1 / A-T1·T2 | 正例 | P0 | 首次收虚拟币自助建充值地址 | 客户 APPROVED、账户 ACTIVE、资产 ACTIVE、已就绪 | ① 客户对某虚拟币资产建收款账户 | 账户 `CREATING → ACTIVE`；返回 HexTrust vaultId 与链上地址；审计 `DEPOSIT_WALLET_CREATED` | walletRole=C_DEP |
| TC-WAL-002 | AC-1.1 / A-T1·T2 | 正例 | P0 | 首次收法币自助建 VIBAN | 同上，法币资产 | ① 客户对法币资产建收款账户 | `CREATING → ACTIVE`；返回 VIBAN，银行信息**继承平台主账户 CMA**；审计 `DEPOSIT_WALLET_CREATED` | walletRole=C_VIBAN |
| TC-WAL-003 | AC-1.2 / FR-3 / 判定 1 | 边界 | P0 | 同客户同资产已有 ACTIVE 则复用 | 该客户该资产已有 ACTIVE 收款账户 | ① 再次请求创建 | **复用返回原账户**（同 walletNo），不新建、不进 CREATING；账户总数不变 | 幂等 |
| TC-WAL-004 | A.4 不变量 | 边界 | P0 | 同客户同资产恒只有一个 ACTIVE | 已有 ACTIVE 收款账户 | ① 重复请求创建若干次 ② 统计该 (客户×资产×角色) 的 ACTIVE 账户数 | 恒为 **1**（A.4 唯一约束） | — |
| TC-WAL-005 | AC-1.3 / A-T3 | 反例 | P1 | 托管方开立失败落 FAILED | 可令 HexTrust/Zand 开立失败 | ① 触发创建并令外部开立失败 | 账户置 `FAILED`；审计 `DEPOSIT_WALLET_CREATE_FAILED`（含 error） | 重试行为属 G3，不测 |
| TC-WAL-006 | AC-1.4 / FR-2 | 反例 | P0 | 客户未 APPROVED 拒绝创建 | 客户 onboarding ≠ APPROVED | ① 请求创建收款账户 | 拒绝，不建任何记录（fail-closed） | — |
| TC-WAL-007 | AC-1.4 / FR-2 | 反例 | P0 | 客户账户非 ACTIVE 拒绝创建 | adminStatus ≠ ACTIVE（如 SUSPENDED） | ① 请求创建收款账户 | 拒绝，不建记录 | — |
| TC-WAL-008 | AC-1.4 / FR-2 | 反例 | P0 | 资产非 ACTIVE 拒绝创建 | 目标资产处于 PROVISIONING / SUSPENDED | ① 请求创建收款账户 | 拒绝，不建记录 | 双侧守卫 |
| TC-WAL-009 | AC-1.5 / A-T5·T6 | 正例 | P1 | 运营停用/恢复客户收款账户 | 存在 ACTIVE 客户收款账户 | ① 运营停用 ② 运营恢复 | ① `ACTIVE → DISABLED`；② `DISABLED → ACTIVE`；两次均审计 `WALLET_STATUS_UPDATED`（含 before→after） | DISABLED 可逆 |
| TC-WAL-010 | AC-1.5 / FR-6 | 反例 | P0 | 系统钱包不可手动停用 | 存在 F_OPS / F_SET / F_FEE / F_LIQ / C_CMA 等系统钱包 | ① 运营尝试停用其中任一 | 被拒（受保护角色）；状态不变 | 客户地址与系统钱包分治 |
| TC-WAL-011 | FR-1 | 正例 | P2 | 托管钱包与提现地址物理分离 | — | ① 查收款账户列表 ② 查提现地址列表 | 两者为**独立实体、独立业务键**（walletNo / addressNo），互不混列 | 本期分离需求 |

## 2. 提现地址登记与冷却（FR-7/8/10 · B-T1~T4 · AC-2.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WAL-012 | AC-2.1 / B-T1 / FR-7 | 正例 | P0 | 登记虚拟币地址进 24h 冷却 | 客户已就绪（有 ACTIVE 法币地址） | ① 登记一个链上地址 + network | 状态 `PENDING_ACTIVATION`；`activatesAt = now + 24h`；审计 `ADDRESS_REGISTERED` | — |
| TC-WAL-013 | AC-2.1 / FR-7 | 反例 | P0 | 冷却期内该地址不可用于提现 | 存在 PENDING_ACTIVATION 地址 | ① 用该地址发起提现 | 被拒绝，不建提现单 | 冷却是资金安全闸 |
| TC-WAL-014 | AC-2.2 / B-T2 / FR-8 | 边界 | P0 | 首个法币地址登记即 ACTIVE | 客户**尚无任何** BANK 提现地址 | ① 登记银行账户四要素 | 直接 `ACTIVE`（免 24h）；`tradingReady` 转 true；审计 `ADDRESS_REGISTERED` | 恰第一个 |
| TC-WAL-015 | AC-2.3 / 判定 2 | 边界 | P0 | 第二个法币地址走 24h 冷却 | 客户已有 1 个 ACTIVE 法币地址 | ① 再登记一个银行账户 | `PENDING_ACTIVATION` + 24h——**恰差一个**即不免冷却 | 与 014 成对 |
| TC-WAL-016 | 判定 2 | 边界 | P0 | 虚拟币地址任何情况都走冷却 | 客户已有 ACTIVE 法币地址、且这是首个虚拟币地址 | ① 登记虚拟币地址 | 仍 `PENDING_ACTIVATION` + 24h——「首个免冷却」只对法币成立 | 易错点 |
| TC-WAL-017 | AC-2.4 / B-T3 / FR-10 | 正例 | P1 | 冷却到期自动激活（定时扫描） | 存在 activatesAt 已到期的地址 | ① 等待/触发 5 分钟扫描 | 地址转 `ACTIVE`；审计 `ADDRESS_ACTIVATED`，activatedBy=`CRON` | — |
| TC-WAL-018 | AC-2.4 / B-T3 / FR-10 | 正例 | P1 | 冷却到期懒激活（查询时） | 同上，且未等到扫描 | ① 客户查询地址列表 | 查询即激活，返回 `ACTIVE`；审计 activatedBy=`LAZY` | 双机制 |
| TC-WAL-019 | B-T3 约束 | 边界 | P0 | 未到期不得激活 | activatesAt 尚在未来（如剩 1 分钟） | ① 触发扫描 ② 客户查询 | 地址**仍 PENDING_ACTIVATION**；无激活审计 | 恰差一分钟 |
| TC-WAL-020 | B-T4 / FR-10 | 正例 | P1 | 运营跳过冷却 | 存在 PENDING_ACTIVATION 地址 | ① 运营执行跳冷却 | 地址转 `ACTIVE`；审计 `MANUAL_COOLING_SKIP`（含操作人） | 带审计的后门 |
| TC-WAL-021 | AC-2.5 / B-T5 | 正例 | P1 | 冷却期内客户可取消 | 存在 PENDING_ACTIVATION 地址 | ① 客户取消该地址 | 状态 `CANCELLED`；审计 `ADDRESS_CANCELLED` | 非终态 |
| TC-WAL-022 | B-T5 约束 | 反例 | P1 | 取消仅限冷却中地址 | 地址已 ACTIVE | ① 客户尝试取消 | 被拒（取消只对 PENDING_ACTIVATION 开放） | — |
| TC-WAL-023 | FR-9 | 正例 | P2 | 登记虚拟币地址时做归因打标 | — | ① 登记虚拟币地址 ② 查地址属性 | `addressType` ∈ {VASP, SELF_CUSTODY}；`ownershipProofType = DECLARATION`；命中 VASP 时记 counterpartyVaspName | 声明级，真实验证属 G6 |

## 3. 提现地址停用（FR-11/12 · B-T7 · AC-2.6~2.8）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WAL-024 | AC-2.6 / B-T7 / FR-12 | 正例 | P1 | 运营可停用 ACTIVE 地址（含末位法币） | 客户仅剩 1 个 ACTIVE 法币地址 | ① 运营带原因停用该地址 | 停用成功（运营 override）；状态落停用终态；审计 `ADDRESS_SUSPENDED`（含 reason / 操作人） | 与客户侧守卫不同 |
| TC-WAL-025 | AC-2.7 / FR-12 | 反例 | P0 | 客户不可软停用末位 ACTIVE 法币地址 | 客户仅剩 1 个 ACTIVE 法币地址 | ① 客户自助停用该地址 | 拒绝，错误 `LAST_ACTIVE_FIAT_ADDRESS`；状态不变 | 防自锁死 |
| TC-WAL-026 | AC-2.8 / FR-12 | 反例 | P0 | 客户不可软停用有在途提现的地址 | 该地址存在未终态的提现单 | ① 客户自助停用该地址 | 拒绝，错误 `ADDRESS_HAS_INFLIGHT_WITHDRAWAL` | 与在途互斥 |
| TC-WAL-027 | B-T7 / FR-11 | 正例 | P1 | 客户软停用非末位地址成功 | 客户有 ≥2 个 ACTIVE 法币地址、无在途 | ① 客户停用其中一个 | 成功；审计 `ADDRESS_DEACTIVATED`（含操作人） | — |
| TC-WAL-028 | 5.3-B 约束 | 边界 | P1 | 停用为终态且归档保留 | 存在已停用地址 | ① 查地址列表/详情 ② 尝试恢复 | 记录仍可查（**不物理删**）；无恢复路径，停用不可逆 | 8 年留存前提 |

## 4. 交易起始守卫（FR-13/14/16/17 · 判定 3 · AC-3.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WAL-029 | AC-3.1 / FR-13 | 反例 | P0 | 未就绪发起提现被后端拒 | 客户 APPROVED 但**无** ACTIVE 法币地址 | ① 直接调后端发起提现（绕过前端） | 拒绝，错误 `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`；不建单 | 后端是唯一边界 |
| TC-WAL-030 | AC-3.1 / FR-13 | 反例 | P0 | 未就绪发起兑换被后端拒 | 同上 | ① 直接调后端发起兑换 | 同上，拒绝且不建单 | — |
| TC-WAL-031 | AC-3.2 / FR-14 | 反例 | P0 | 未就绪登记虚拟币地址被拒 | 同上 | ① 登记一个链上提现地址 | 拒绝 `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS` | — |
| TC-WAL-032 | AC-3.2 / FR-14 | 正例 | P0 | 未就绪登记法币地址放行 | 同上 | ① 登记银行账户 | **放行**并即时 ACTIVE——法币地址是引导起点，是守卫的唯一例外 | 与 031 成对 |
| TC-WAL-033 | AC-3.3 / FR-14 | 反例 | P0 | 未就绪创建收款账户被拒、查询不受影响 | 同上 | ① 建 C_DEP/C_VIBAN ② 查询已存在账户 | ① 拒绝；② 查询正常返回 | 拦写不拦读 |
| TC-WAL-034 | AC-3.5 / FR-16 / 判定 3 | 正例 | P1 | 未就绪访问业务页渲染引导页 | 同上 | ① 依次访问 /deposit、/withdraw、/swap、/wallet | 四页均渲染**独立引导页**（非业务表单、非重定向），URL 停在原路径；CTA 指向 /withdrawal-addresses | — |
| TC-WAL-035 | AC-3.7 / FR-16 / 判定 3 | 边界 | P0 | 目的地页与身份页不被守卫拦 | 同上 | ① 访问 /withdrawal-addresses ② 访问 /overview、/profile、/verification | 全部正常渲染，**无自循环白屏** | 路径须段边界匹配，防 /withdraw 误吞 /withdrawal-addresses |
| TC-WAL-036 | AC-3.6 / FR-17 | 正例 | P1 | 钱包页锁加密页签、强制银行页签 | 同上，停留在 /withdrawal-addresses | ① 观察页面 ② 点「加密地址」页签 | 顶部有说明 banner；「加密地址」页签**禁用/锁定**；强制停在「银行账户」页签 | — |
| TC-WAL-037 | AC-3.6 / FR-8 | 正例 | P1 | 加首个法币地址后即时解锁 | 同上 | ① 在钱包页登记银行账户 ② 不刷新页面观察 | 就绪态即时刷新：banner 消失、加密页签解锁；再访问 /withdraw 直达业务页 | 即时性是重点 |

## 5. 兑换双边收款门（FR-15 · 判定 4）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WAL-038 | AC-3.4 / FR-15 / 判定 4 | 反例 | P0 | 缺买入侧收款账户拒绝兑换 | 客户已就绪；仅有卖出侧收款账户 | ① 取价后确认成交 | 拒绝，错误 `RECEIVING_ACCOUNT_REQUIRED` **且带缺失的 assetCode**；不消费报价、不建单 | 消费报价前拦截 |
| TC-WAL-039 | AC-3.4 / FR-15 / 判定 4 | 反例 | P0 | 缺卖出侧收款账户拒绝兑换 | 仅有买入侧收款账户 | ① 取价后确认成交 | 同上，带对应 assetCode | 两侧对称 |
| TC-WAL-040 | 判定 4 | 正例 | P1 | 双侧齐备放行 | 买卖两侧均有 ACTIVE 收款账户 | ① 取价后确认成交 | 正常放行进入成交流程 | — |
| TC-WAL-041 | FR-17 | 正例 | P2 | 兑换前端逐币预检与引导 | 缺任一侧收款账户 | ① 在兑换页选定买/卖币对 | 提交按钮禁用并提示缺哪个币种；CTA「Create receiving account」跳 **/deposit** | 收款账户=充值地址 |

---

**覆盖对账**：AC-1.1→001/002 ｜ AC-1.2→003/004 ｜ AC-1.3→005 ｜ AC-1.4→006/007/008 ｜ AC-1.5→009/010 ｜ AC-2.1→012/013 ｜ AC-2.2→014 ｜ AC-2.3→015 ｜ AC-2.4→017/018 ｜ AC-2.5→021 ｜ AC-2.6→024 ｜ AC-2.7→025 ｜ AC-2.8→026 ｜ AC-3.1→029/030 ｜ AC-3.2→031/032 ｜ AC-3.3→033 ｜ AC-3.4→038/039 ｜ AC-3.5→034 ｜ AC-3.6→036/037 ｜ AC-3.7→035；FR-1→011 ｜ FR-2~4→001~008 ｜ FR-6→009/010 ｜ FR-7→012/013 ｜ FR-8→014/037 ｜ FR-9→023 ｜ FR-10→017/018/020 ｜ FR-11→021/027 ｜ FR-12→024~026 ｜ FR-13~17→029~041；A-T1/T2→001/002 ｜ A-T3→005 ｜ A-T5/T6→009 ｜ B-T1→012 ｜ B-T2→014 ｜ B-T3→017/018/019 ｜ B-T4→020 ｜ B-T5→021/022 ｜ B-T7→024/027；判定 1→003 ｜ 判定 2→014/015/016 ｜ 判定 3→034/035 ｜ 判定 4→038/039/040；审计 9 事件全部落在对应用例。FR-5/A-T4、B-T6 无验收（G3/G4）。
