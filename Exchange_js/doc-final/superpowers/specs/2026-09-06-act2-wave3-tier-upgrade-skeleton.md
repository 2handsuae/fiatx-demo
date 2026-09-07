# 第二幕客户域 · 波三「交易档位升级」骨架

- 总纲：`2026-09-06-act2-customer-waves-outline.md`（跨波口径直接引用）｜ 性质：骨架——只记已定事实与待定岔口，**展开是波三新会话读总纲 + 承接后跟业主脑暴的活**

## 承接波二（波二收尾时填）

**Task 14（收尾闸 + 走查五景）2026-09-07 收尾记录：**

- 实际偏差：
  - 报价对照口径按业主更正版核对——1000 USDT 档 `NEWCUST-USDT-AED-TIER-002` flat **16** vs `STD-USDT-AED-TIER-002` flat **20**（非本 plan 早前草稿的 25/30），已用真实后端 `GET /swap-transactions/rate` 报价端点 + 客户端 UI 逐一实证吻合。
  - 客户端 Swap 页「You Sell」金额输入受当前持仓上限钳制（`handleFromAmountChange`：`numValue > maxBalance` 时把值钳回 `currentBalance`），现场注册的零余额新客户**无法**在 UI 上直接打出超过持仓的卖出金额预览；若波三要再现「新档位客户报价」这类演示，同样会撞上这个钳制——要么先给客户铺一笔真实到账（走 `demo:deposit` 内部引擎或客户端「Simulate Deposit」+ 资金单三段推进 `SUBMIT/OBSERVE_CONFIRMING/CONFIRM/CLEAR` 全套跑完），要么和本次一样改走后台 `GET /swap-transactions/rate`（与 UI 同一路由）直接验证费率命中，不受余额钳制。
  - `task-14-brief.md` 点名的 spec 路径 `src/modules/identity/organization/invite-expiry.service.spec.ts` 实际路径是 `src/modules/identity/users/invite-expiry.service.spec.ts`（笔误，已按实际路径确认为预置环境依赖，非本波回归）；且它不是单纯缺 `DATABASE_URL`——需要 self 栈的 TigerBeetle **真连上**（`bash scripts/stack.sh up self` 之后再单独跑该 suite 才转绿），仅设 `DATABASE_URL`/`TB_ADDRESS` 环境变量、TB 服务不在跑一样会挂起超时。
- 新事实（执行中发现，供波三直接复用）：
  - `shared_simulation_mode` cookie 是 host-only（按 host 不按 port），client-web(3102)/admin-web(3101) 同一浏览器会话共享同一枚 cookie；但 `scripts/demo-shot.js` 起的是全新 headless profile，不继承交互式 Browser-pane 里手动开的开关，必须显式传 `--cookie shared_simulation_mode=true`（本任务已给 `demo-shot.js` 加上这个能力，见下条）。
  - `scripts/demo-shot.js` 本任务新增四处通用能力（非本波业务逻辑，纯走查工具增强，已跑 `node -c` 语法检查 + backend tsc 闸门确认零回归）：`--cookie key=value`（导航前按 origin 种 cookie）、`--prompt-text "文本"`（自动接管 `window.prompt`，否则 headless 下按钮静默 no-op）、`--click "文本::idx"`（同文本撞号时点第 idx 个，例如按钮打开的弹窗里确认按钮同名）、以及 `--type` 步骤改成三击选中清空再敲（不然会在预填字段后面追加出「LiveLive」这种重复值）。波三如需要客户端/管理台截图，直接复用这几个 flag。
  - 断言审计留痕的标准姿势：`sqlite3 -header -column <db> "SELECT eventNo, action, actorNo, outcome, occurredAt FROM audit_log_events WHERE ownerCustomerNo='CUxxx' ORDER BY occurredAt;"`——本波五景逐景都用这条核验，波三沿用即可。
- 波三前提确认（脑暴前核对，不代表已拍板）：
  - **applicant 复用**：波二 RED-RETRY 场景已实证——同一客户 reject-retry 与 reapply 之间 `sumsubApplicantId` 原样不变（不重建 applicant）。波三「档位升级」若也走 Sumsub 模拟提交材料，可放心假设复用同一 applicant 身份，不需要新建。
  - **档位字段位置**：`customer_main` 表已有 `tradingTier`（当前枚举值含 `BASIC`）与 `riskRating` 字段，波三 `tradingTier` BASIC→PREMIUM 的目标列已存在于 schema，不需要新增字段——但状态机（是否走独立迁移表、非法跃迁怎么拒）与审批挂载位置仍要波三新会话展开时核对，本波未看这部分代码。
  - **准入审批同构可扩**：本波 `CUSTOMER_ONBOARDING_ACCEPTANCE` 是单步 maker(运营)→checker(高管，SENIOR_MANAGEMENT_OFFICER) 结构，走 `onboarding-workflow.service.ts` 编排 + `ApprovalHandlerBase` 机制。波三档位升级审批若沿用同一套编排范式技术上可行（不代表业务上就该复用单步——待定岔口①「MLRO+SMO 双审 vs 单步」仍需业主拍板，本条只确认技术底座具备可扩性）。

## 已定事实

- **做**（业主 2026-09-06）；入口 = **客户主动申请**（旧入口是定期风评带出的 `createFromCra`，风评已裁定不做，不复用）
- 行业口径：这是**合规档位**升级（多交材料换更高限额），不是商务 VIP——客户补交高级别材料（地址证明 / 资金来源，Sumsub 模拟）→ 审批 → `tradingTier` BASIC→PREMIUM
- 升级后立即生效面：限额门（`transaction_limit_rules` 种子已分 BASIC/PREMIUM 两档）+ L1 快照；**费率不联动**（档位与费率彻底分开，VIP 是手打标签——总纲裁定）
- 旧后端已随一期拆除（2026-08-27），按新审计合同重建，不翻旧代码
- 依赖波二：申请人侧集成、材料补交会话、审批模式复用入驻地基

## 待定岔口（脑暴时与业主对）

1. 审批线谁批：旧制是 MLRO+SMO 双审，是否沿用（与入驻 MLRO 终审的分工怎么讲）
2. 有没有降级（PREMIUM→BASIC）：主动申请降？合规原因强制降？还是不做
3. 客户端申请入口形态（档位页？profile？）与申请中状态的客户面展示
4. PREMIUM 所需材料清单定义放哪（旧 policy JSON 已随 material-refresh 退役，按新 spec 重定义）
5. 升级申请的次数限制 / 被拒后再申请
