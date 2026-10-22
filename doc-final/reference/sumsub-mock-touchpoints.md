# Sumsub mock 触点登记册（对手方层）

> 建册 2026-10-22（对手方波一：提现地址簿）｜ 缺口编号 = `reference/sumsub-services-needed.md` 的小节号（#1 归因 / #2 所有权验证链支持 / #3 筛查触发条件）
> 用途：业主要做 mock↔sandbox 切换时的地图——哪些能力是「站在 Sumsub 一侧」的 mock、真 Sumsub 对应哪项服务、切换时动哪一刀。
> 范围：**本册只收对手方层**（地址归因 / 地址风险筛查 / 钱包签名验证，及波二新增的触点）。既有总开关 `SUMSUB_MOCK_MODE` 与裁决 ⚡ 全家族（`admin/sumsub/simulate/*`）不在此重登，见 `demo/simulated-externals.md`。

## 一、触点总表

| 触点 | 代码位置 | mock 行为 | 真 Sumsub 对应物（缺口编号） | 切换时的刀口 |
|---|---|---|---|---|
| ① 地址归因 | `asset-treasury/withdrawal-addresses/mock-travel-rule.adapter.ts#attributeAddress`（接口 `travel-rule-adapter.interface.ts`；调用点 `withdrawal-address-workflow.service.ts#registerAddress`） | 地址尾号 `1111` → 归因为 VASP「Mock VASP Exchange」（`did:mock:vasp-exchange-001`），其余一律「自托管」。结论写 `addressType`，并与客户自报 `declaredHosting` 比对：不一致 → `hostingMismatch` 红旗（留痕不拦截） | Standalone Wallet Attribution，`POST /resources/api/wallet-attribution`。**缺口 #1**：2026-10-20 实调 403「feature not enabled」，未开通 | DI token `TRAVEL_RULE_ADAPTER`（`withdrawal-addresses.module.ts`）换实现；调用方只认 `AddressAttributionResult { attributed, vaspName, vaspDid }`，真返回映射进这个形状即可，主体层与前端零改动 |
| ② 地址风险筛查 | `mock-travel-rule.adapter.ts#screenAddress`（同一 DI token，同一个类）；⚡覆写后门：`POST /admin/withdrawal-addresses/:addressNo/simulate-screening`（`withdrawal-address-admin.controller.ts` → `WithdrawalAddressWorkflowService#feedScreening`） | 地址 / IBAN 尾号 `2222` → YELLOW、`3333` → RED（**登记即拒**，落 `REJECTED`）、其余 GREEN；链上与银行（IBAN 尾号，无归因）共用这一方法。⚡ 是对已登记 pending 条目的覆写：喂 GREEN/YELLOW 只改筛查结论并记 `WITHDRAWAL_ADDRESS_SCREENED`，喂 RED 走 `REJECT` 边进 `REJECTED`（记 `WITHDRAWAL_ADDRESS_REJECTED`）；挂 `DEMO_VERDICT_WRITE`（合规官持，与喂裁决同义） | 收付方式风险筛查（payment method AML screening，Crystal 流水线）。**缺口 #3**：API 直加收付方式后 `checks/latest?type=PAYMENT_SOURCE` 持续为空，触发条件待与 CSM 确认（WebSDK/actions 路径实测秒出 YELLOW） | 同一 DI token 换实现；登记写点（`WithdrawalAddressService#create` / `#createBankAccount` 写 `screeningAnswer` / `screenedAt`）改挂 Sumsub 回调回灌结论，回灌点可复用 `recordScreening` / `rejectByScreening` 两个主体方法（迁移表不用改）。**注意**：现落点计算假设登记时结论已同步给出（RED 登记即拒），异步化后这一处要重切；⚡端点保留为演示后门（结论覆写） |
| ③ 钱包签名验证 | `POST /client/withdrawal-addresses/:addressNo/verify-signature`（`withdrawal-address.controller.ts#verifySignature` → `WithdrawalAddressWorkflowService#verifyOwnershipSignature` → 主体层 `verifyOwnershipSignature`） | **点即过**：不验任何签名，仅对 `PENDING_VERIFICATION` 且证据档为 `SIGNATURE` 的本人条目写 `ownershipVerifiedAt`，再走 `RELEASE` 边进冷却（冷却自此刻起算）；记 `WITHDRAWAL_ADDRESS_OWNERSHIP_VERIFIED` | crypto ownership verification（WebSDK 签名 / Satoshi 验证）。**缺口 #2**：租户的链上验证支持未配，实测报 `This blockchain isn't supported for verification` | 客户端「Verify wallet signature」按钮改为拉起 WebSDK；后端这个端点改为收 Sumsub 回调后再调同一个主体方法 `verifyOwnershipSignature`（`RELEASE` 边与冷却重算已在主体层，不动） |
| ④ 总开关与裁决 ⚡ 家族 | `SUMSUB_MOCK_MODE` 及 `admin/sumsub/simulate/*` | 见 `demo/simulated-externals.md` | 见该文档 | 不在本册 |

## 二、mock 确定性规则（①② 共用，验收判据所在）

演示者输入已知地址得到已知结局——这是 mock 的主通道，⚡ 只是覆写后门。完整可复制测试串见 `demo/data.md`「mock 测试地址速查」。

| 地址 / IBAN 尾号 | 归因（①） | 筛查（②） | 登记结局 |
|---|---|---|---|
| `1111`（仅链上） | VASP「Mock VASP Exchange」 | GREEN | 照 2×2 落点；客户若自报「自托管」则同时升 `hostingMismatch` 红旗 |
| `2222` | 自托管 | **YELLOW** | 照 2×2 落点（中风险放行，留痕） |
| `3333` | 自托管 | **RED** | **登记即 `REJECTED`**（属落点计算、不是迁移表的边；`WITHDRAWAL_ADDRESS_REGISTERED` + `WITHDRAWAL_ADDRESS_REJECTED` 双审计，后者系统主体、reason 固定 `Screening returned RED at registration`） |
| 其余 | 自托管 | GREEN | 照 2×2 落点 |

## 三、定位

业主将做 mock↔sandbox 切换，波二新增触点续登本册；本册只登记不实现，切换机制届时另立 spec。

登记纪律：凡新增「站在 Sumsub 一侧」的 mock 能力（不论是 adapter 方法、模拟端点还是写死的结论），在同一个提交里往第一节总表加一行，写清代码位置与刀口；漏登记 = 将来切换时找不到刀口。
