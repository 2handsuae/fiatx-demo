# TC-04 · 交易费率等级（Fee Level）测试用例

> 对应 PRD《5. 交易费率等级 · Fee Level》v1.1 ｜ 域码 `FEE` ｜ 35 条
> 口径与排除范围见 [README.md](README.md)

**本篇排除**：其它费项 NETWORK_FEE_EST / COMPLIANCE_FEE（非目标 1，本版每档只留服务费）；30 日历日生效闸与通知客户（G1/Q1，未实现）；报价「资格快照」（G3，延后）；报价单生命周期（属《提现》《兑换》）。
**族说明**：提现族与兑换族对称，除**键**（提现=单资产 / 兑换=币对）与**服务费码**（`WITHDRAW_SERVICE_FEE` / `SWAP_SERVICE_FEE`）外行为一致。标「双族」的用例须在两族各跑一遍。

---

## 1. 创建等级（FR-1/2/3 · LT1~LT3 · AC-1.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-FEE-001 | AC-1.1 / FR-1 / LT1 | 正例 | P1 | 合法创建落 PENDING_APPROVAL | 目标资产/币对为 ACTIVE | ① 提交合法 tiersJson（分档非空、每档一个本族服务费项）+ 受众 | 等级 `PENDING_APPROVAL`；`configHash = sha256(tiersJson)` 落库；审计 `CREATION_REQUESTED` | 双族 |
| TC-FEE-002 | FR-1 | 反例 | P1 | levelCode 重复被拒 | 已存在同 levelCode | ① 用相同 levelCode 创建 | 拒绝，不建记录 | 业务键唯一 |
| TC-FEE-003 | FR-1 | 反例 | P1 | 非 ACTIVE 资产不可建等级 | 资产处于 PROVISIONING / SUSPENDED | ① 创建该资产的费率等级 | 拒绝 | — |
| TC-FEE-004 | FR-1 | 反例 | P1 | 分档为空或费项码不属本族被拒 | — | ① 提交空分档 ② 提交带兑换服务费码的**提现**等级 | 两次均拒绝 | 族隔离 |
| TC-FEE-005 | AC-1.2 / FR-2 | 反例 | P0 | isDefault 不可再设 requiredTags | — | ① 创建 isDefault=true 且带 requiredTags 的等级 | 拒绝 | EVERYONE 与谓词互斥 |
| TC-FEE-006 | AC-1.2 / FR-2 | 边界 | P0 | requiredTags 至多 1 个 | — | ① 提交 1 个标签 ② 提交 2 个标签 | ① 通过；② 拒绝 | 恰差一个 |
| TC-FEE-007 | AC-1.2 / FR-2 | 反例 | P0 | 未注册标签被拒 | — | ① requiredTags 填注册表外的标签码 | 拒绝 | 固定注册表 |
| TC-FEE-008 | FR-2 | 边界 | P1 | 时间窗须 validFrom ≤ validTo | — | ① 提交 validFrom > validTo ② 提交二者相等 | ① 拒绝；② 通过 | 边界 |
| TC-FEE-009 | AC-1.3 / LT2 | 正例 | P1 | 审批通过转 ACTIVE | 存在 CFO 提交的 PENDING_APPROVAL 等级 | ① OPS_OFFICER 批准 | 等级 `ACTIVE`；审批句柄清空；审计 `CREATION_APPLIED` | 裁决人 OPS_OFFICER 未变；提单人 2026-08-30 起由运营改财务负责人 |
| TC-FEE-010 | AC-1.3 / LT3 | 反例 | P1 | 审批否决则删除该 PENDING 等级 | 存在 CFO 提交的 PENDING_APPROVAL 等级 | ① OPS_OFFICER 否决 | 该 PENDING 等级**被删除**（非置废）；审计 `CREATION_CANCELLED` | 与变更请求处理不同 |
| TC-FEE-011 | FR-3 / 4.4 SoD | 反例 | P0 | 发起人不可自批 | 由财务负责人 A 提交创建请求 | ① A 本人尝试审批该请求 | 拒绝——A 的角色（CFO）不在审批人白名单（仅 OPS_OFFICER）内，天然不可能自批；若 A 身兼 OPS_OFFICER 角色，则触发同用户 SoD 拦截（maker≠checker） | 2026-08-30 起提单角色（CFO）与裁决角色（OPS_OFFICER）分属两个不相交角色，自批门槛从"同用户拦截"加固为"角色本不相交" |
| TC-FEE-012 | FR-3 | 边界 | P2 | 审批 48h 时限与可取消 | 存在 CFO 提交的 PENDING 审批 | ① 查审批时限 ② 发起方（CFO）取消 | 时限 48h；取消后请求终结、等级不生效 | 裁决人单步 OPS_OFFICER，未变 |

## 2. 变更费率 · configHash 冲突守卫（FR-4/5/6 · CR1~CR5 · AC-2.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-FEE-013 | AC-2.1 / FR-4 / CR1 | 正例 | P1 | 对 ACTIVE 等级建变更请求 | 等级 ACTIVE、无在途请求 | ① 提交新 tiersJson + 变更原因 | 请求 `PENDING_APPROVAL`，生成 requestNo（提现族 `WFLC-NNN`）；快照 currentTiersJson + currentConfigHash；审计 `CHANGE_REQUESTED` | 双族 |
| TC-FEE-014 | FR-4 | 反例 | P1 | 非 ACTIVE 等级不可提变更 | 等级仍 PENDING_APPROVAL | ① 提交变更请求 | 拒绝 | — |
| TC-FEE-015 | AC-2.2 / FR-4 | 反例 | P0 | 同一等级仅允许 1 个在途请求 | 该等级已有 PENDING 请求 | ① 再提一个变更请求 | 拒绝 | 防并发打架 |
| TC-FEE-016 | AC-2.3 / FR-5 / CR2 / 判定 2 | 正例 | P0 | 审批通过且 configHash 未变则生效 | 存在 CFO 提交的变更请求，期间无其他变更 | ① OPS_OFFICER 批准 | 等级 tiersJson 更新为 proposed，configHash 重算；请求 `APPROVED`；审计 `CHANGE_APPLIED`；后续报价按新费率 | 裁决人 OPS_OFFICER 未变 |
| TC-FEE-017 | AC-2.4 / FR-5 / CR3 / 判定 2 | 反例 | P0 | configHash 冲突则拒绝执行、原值不动 | 请求 A 在途期间，等级已被另一路径改过 | ① 批准请求 A | 请求 `FAILED` + failureReason；**等级现值分毫不改**；审计 `CHANGE_APPLY_FAILED` | 核心守卫，重心用例 |
| TC-FEE-018 | 判定 2 | 反例 | P0 | 执行时等级已非 ACTIVE 则失败 | 审批期间等级被停用 | ① 批准请求 | 请求 `FAILED`，等级不变 | 判定 2 第 3 行 |
| TC-FEE-019 | AC-2.5 / CR4 | 反例 | P1 | 审批否决则请求 REJECTED | 存在 PENDING 请求 | ① 否决 | 请求 `REJECTED`；等级不变 | — |
| TC-FEE-020 | CR5 | 正例 | P2 | 主动取消变更请求 | 存在 PENDING 请求 | ① 发起方取消 | 请求 `CANCELLED`；审计 `CHANGE_CANCELLED` | — |
| TC-FEE-021 | 5.3 约束 | 反例 | P1 | 变更请求终态不可逆 | 请求为 APPROVED/FAILED/REJECTED/CANCELLED | ① 尝试再次审批/执行 | 全部被拒 | — |
| TC-FEE-022 | FR-6 | 边界 | P1 | 受众变更不走 configHash、不走审批 | 等级 ACTIVE | ① 直接修改 requiredTags / validFrom / validTo | 立即生效，无需审批；configHash **不变**（只护 tiersJson） | ⚠ 落地度待验（G2） |

## 3. 客户标签与选级（FR-7/8/9/10 · 判定 1 · AC-3.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-FEE-023 | AC-3.1 / FR-7 | 正例 | P1 | 赋 STATIC 标签即时生效 | 客户存在 | ① 管理员赋 `WHITELIST_PILOT` ② 立即求值该客户标签 | 标签即时进 effectiveTags（无审批）；审计 `TAG_ASSIGNED` | RBAC 门控 |
| TC-FEE-024 | AC-3.1 / FR-7 | 反例 | P0 | 不可手打 DERIVED 或未注册标签 | — | ① 手打 `VIP`（DERIVED） ② 手打注册表外标签 | 两次均拒绝 | 派生只算不存 |
| TC-FEE-025 | FR-7 | 正例 | P2 | 撤销 STATIC 标签 | 客户已有该标签 | ① 撤销 | 标签移除，effectiveTags 不再含；审计 `TAG_REVOKED` | — |
| TC-FEE-026 | AC-3.2 / FR-8 | 正例 | P1 | VIP 派生标签现算 | 客户 tradingTier = PREMIUM | ① 求值 effectiveTags | 含 `VIP`；未落任何标签表 | 零存储 |
| TC-FEE-027 | AC-3.2 / FR-8 | 边界 | P0 | NEW_CUSTOMER 恰 30 天命中、31 天不命中 | 客户 onboardingApprovedAt 可控 | ① 置为距今恰 30 天求值 ② 置为距今 31 天求值 | ① 含 `NEW_CUSTOMER`；② 不含——**无需任何清理任务**自动失效 | 现算的关键验证 |
| TC-FEE-028 | AC-3.3 / FR-9 / 判定 1 | 正例 | P0 | 谓词命中：标签子集 + 在窗内 | 等级 requiredTags=[VIP]，窗覆盖当前 | ① 用 VIP 客户报价 | 该等级进命中集合 | — |
| TC-FEE-029 | AC-3.3 / FR-9 / 判定 1 | 反例 | P0 | 标签不满足则不命中 | 同上，客户非 VIP | ① 报价 | 该等级不进命中集合 | 判定 1 第 3 行 |
| TC-FEE-030 | FR-9 / 判定 1 | 边界 | P0 | 窗外不命中（恰过期一秒） | 等级 validTo 刚过 | ① 报价 | 不命中——时间窗到点即自动失效 | 判定 1 第 4 行 |
| TC-FEE-031 | AC-3.3 / FR-9 | 正例 | P0 | isDefault 恒命中 | 存在 isDefault 等级 | ① 用任意客户（无任何标签）报价 | 该等级必进命中集合 | EVERYONE |
| TC-FEE-032 | AC-3.4 / FR-10 / UC4 | 正例 | P0 | 命中多个等级取 cheapest | 客户同时命中 A(费 10)、B(费 6)、C(费 8) | ① 报价 | 选中 B；返回其服务费与净额；命中依据（等级/档）可解释 | 只减免不加价 |
| TC-FEE-033 | UC4 扩展流 | 边界 | P1 | 金额落不进任何分档的候选被跳过 | 候选 A 的分档不覆盖该金额、候选 B 覆盖 | ① 用该金额报价 | A 不参与比价；选中 B | UC4 4a |
| TC-FEE-034 | AC-3.4 / UC4 | 反例 | P0 | 无命中 / 无适用等级则拒报价 | ① 该资产无 ACTIVE+enabled 等级 ② 有等级但全不命中且无 isDefault ③ 全部候选都无匹配分档 | ① ② ③ 分别报价 | 三种情形均**拒绝报价**（No applicable fee level），**绝不静默取 0 费或错费** | 最低保证，重心用例 |
| TC-FEE-035 | 5.3 enabled | 边界 | P1 | enabled=false 的 ACTIVE 等级不参与选级 | 等级 ACTIVE 但 enabled=false | ① 报价 | 该等级不进候选集合 | 独立开关 |

---

**覆盖对账**：AC-1.1→001 ｜ AC-1.2→005/006/007 ｜ AC-1.3→009/010 ｜ AC-2.1→013 ｜ AC-2.2→015 ｜ AC-2.3→016 ｜ AC-2.4→017 ｜ AC-2.5→019 ｜ AC-3.1→023/024 ｜ AC-3.2→026/027 ｜ AC-3.3→028/029/031 ｜ AC-3.4→032/034；FR-1→001~004 ｜ FR-2→005~008 ｜ FR-3→009~012 ｜ FR-4→013~015 ｜ FR-5→016~019 ｜ FR-6→022 ｜ FR-7→023~025 ｜ FR-8→026/027 ｜ FR-9→028~031 ｜ FR-10→032~035；LT1→001 ｜ LT2→009 ｜ LT3→010 ｜ CR1→013 ｜ CR2→016 ｜ CR3→017/018 ｜ CR4→019 ｜ CR5→020；判定 1 四行→031/028/029/030 ｜ 判定 2 三行→016/017/018；UC4 五步流水线→028~035。
