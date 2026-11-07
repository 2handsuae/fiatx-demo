# T8 证据 · 认损补缺——管理台与事故页

基线 `549b1e36`。本任务只动管理台（+ 事故视图一处孤儿清理），后端记账 / 状态机零改动。

## 1. 闸门（命令 · 退出码 · 关键行）

| 闸 | 命令 | 退出 | 关键行 |
|---|---|---|---|
| ① | `npx tsc --noEmit -p tsconfig.json` | 0 | 0 行 |
| ② | `cd admin-web && npx tsc -b --noEmit` | 0 | 0 行 |
| ③ | `cd client-web && npx tsc -b --noEmit` | 0 | 0 行 |
| ④ | `npx jest admin-web/src src/modules/governance/incidents`（`DATABASE_URL` 取自 `.env`） | 0 | `Test Suites: 19 passed`；`Tests: 344 passed`（含 `module-parity.spec`、新 `shortfallTopup.spec` 9 例） |
| lint | `npx eslint <本任务改的 9 个文件>`（admin-web） | 0 | 0 error；2 条 warning 都在本任务没碰的行（`DashboardLayout.tsx:559` useMemo 依赖、`ReconciliationCasesListPage.tsx:164` 多余 disable） |
| ⑥ 终态 | `stack.sh reset self` → `up` → `on-stack.sh self demo:all` | 0 / 0 / 0 | `花名册：35/35`、`asserts: 5/5 PASS` |
| ⑦ 终态 | `on-stack.sh self verify:coa` | 0 | 4 条恒等 ✓、`105 个科目全部 ≥ 0`、`ALL INVARIANTS PASS` |

`doc-final/demo/data.md` 未被 `demo:all` 改写（`git status` 无此文件）。栈留在 reset → up → demo:all 之后的干净态。

### 失效验证（新纯函数 `shortfallTopup.ts` 的 spec）
- 变异 M1：`if (t.recognized) return …` 改成 `if (true) return …`（失败态不看 recognized）→ `1 failed, 8 passed`，红的是「失败但短缺没记成不会冒充已记短缺」。
- 变异 M2：`SHORTFALL_FROM_ROLES` 加进 `F_SET`（结算户混进下拉）→ `1 failed, 8 passed`，红的是「只留运营户与手续费户」。
- 还原后 `9 passed`，`diff` 与备份一致。

## 2. 走查（self 栈，管理台 3111 / API 3110）

起点：`reset self` → `up` → `demo:all`（35/35）→ `on-stack.sh self recon:demo:break`（exit 0，18/18 DETECTED、wallets 12/12、casesOpened 12/12）。
截图器 `scripts/demo-shot.js`（`--cookie shared_simulation_mode=true --full-page 0`）。菜单类截图用 `--click "Resolve" --click "Resolve"`：实测单点一次（无论 `--full-page` 0 / 1）截图里没有菜单、点两次菜单才留住；原因推断是 `ResolveMenu` 监听 window scroll 就关，而截图器点击前 `scrollIntoView` 引发的滚动事件在点击之后才派发（推断，未单独验证），第二下时按钮已居中、不再滚动。

### 账龄路 · Alice USDT 案 `REC20261107-003`（场景 16，托管方对账单少 7.5 USDT）

| 步 | 做法 | 结果 |
|---|---|---|
| Hold · Investigating | HTTP `POST /admin/reconciliation/cases/REC20261107-003/dispositions`（Hold 弹层本任务没碰；demo-shot 点不中弹层里的 radio label，故走 API，body 与 `ReconciliationHoldModal.submit` 一致） | `RCD261107167767`，`HOLD_INVESTIGATING` |
| ⚡ 拨钟 | **UI**：案件页侧栏 ⚡ Fast-forward aging → 轮询 API 至 `slaBreached=true`（约 40 s，下一分钟扫描） | `nextStep = {kind:'SHORTFALL_TOPUP', amount:'7500000', effectiveDate:'2026-11-07', lossSource:'AGING', …}` |
| 菜单 | UI：Resolve ▾ | Fix the books 组出现「Recognize loss & top up」（`t8-shortfall-menu.png`） |
| 弹层 | UI：点该菜单项 | 成因只读 Unexplained client loss、金额 7.500000 USDT-TRON 锁定、生效日 2026-11-07 只读、Top up from 默认 `WA2601018867 · Company Operations · balance 113,999.428189`（`t8-shortfall-modal.png`） |
| 提交 | UI：填理由 → Submit to CFO | `ITR261107362652` / `APR261107973068`（`t8-shortfall-submitted.png`） |
| 待批 | 重载案件页 | 行标签 `Pending CFO · ITR261107362652`，行无 Resolve 菜单（锁定）（`t8-shortfall-pending.png`） |
| CFO 批 | **UI**：`cfo@fiatx.com` 审批详情页 Approve → 弹窗 Approve | 划转单 `EXECUTING`、`recognizedAt` 有值、腿 `FDO261107193939` CREATED |
| 补款中 | 重载案件页 | `Shortfall recognised · topping up ITR261107362652`（`t8-shortfall-topping.png`） |
| ⚡ 推腿 | **UI**：资金单页 ⚡ Broadcast → ⚡ Seen in Mempool → ⚡ Confirm | 划转单 `SUCCESS`，腿 `CLEARED` |
| 已解释 | 重载案件页 | `Explained · ITR261107362652`（绿，带对勾）（`t8-shortfall-explained.png`）；案件仍 OPEN——Re-reconcile 愈案要 T9 匹配器（R25），本任务按 brief 不点 |
| 划转单详情 | UI | Purpose `Shortfall top-up`、Loss Source、Effective Date、Shortfall Recognised 时刻、Approval 回链（`t8-transfer-detail.png`）；列表页 purpose 筛选 / 副标题（`t8-transfer-list.png`） |

### 腿失败态 · `REC20261107-006`（AED 0.97，同一流程，法币一腿经结算户）
HTTP 做 Hold + 拨钟；**UI** 提交（`ITR261107118623`）、**UI** CFO 批、**UI** ⚡ Submit → ⚡ Fail（`--prompt-text` 接住原生 prompt）→ 划转单 `FAILED`、`failureReasonCode=LEG_FAILED`、`recognizedAt` 有值 → 行标签 `Shortfall recognised · top-up failed ITR261107118623`（红），行仍无 Resolve 菜单——入口不回来（裁定 15）（`t8-shortfall-failed.png`）。

### 事故路 · `REC20261107-011` 的 1,200.00 AED 幽灵转出
没有现成 FIRM_LOSS 事故，按 `test/incident-register.e2e-spec.ts` 同款经 HTTP 开：对 OUT 外部行记 `INCIDENT` 定性（`UNAUTHORIZED_OUTFLOW`）→ `POST /admin/incidents`（带 `customerNo` / `assetCode` / `amount`，与案件页「登记事故」预填同形）→ `investigation` → `assess`（`FIRM_LOSS`、`1200.00`、`reportRequired:false`，免报送单）→ `INC261107909412` ASSESSED。
- 事故页（`t8-incident-entry.png`）：善后区出现「Recognize loss & top up」+ 一句指路。
- 点它 → 跳 `/admin/reconciliation/cases/REC20261107-011?shortfallIncidentNo=INC261107909412`，弹层自动打开：金额 1,200.00 AED 锁定（= 定损额）、成因只读、from 默认 `WA2601017408 · Company Operations · balance 946,089.35 AED`、路线两条法币腿；行标签 `Incident assessed · eligible to recognize loss`（`t8-incident-modal.png`）。
- 另有 `INC261107588976`（场景 18 的 400 USDT 案，首次我漏传 `customerNo` 注册的）——它的事故页**不会**显示该入口（`customerNo` 为空判为非客户池）；这正是入口条件里要 `customerNo` 的原因，真实路径（案件页登记）总会带上它。该栈已重铺清掉。

### 截图清单（均在本目录，逐张 Read 过）
`t8-shortfall-menu.png` · `t8-shortfall-modal.png` · `t8-shortfall-submitted.png` · `t8-shortfall-pending.png` · `t8-shortfall-topping.png` · `t8-shortfall-explained.png` · `t8-shortfall-failed.png` · `t8-incident-entry.png` · `t8-incident-modal.png` · `t8-transfer-detail.png` · `t8-transfer-list.png`

## 3. 退役清点（改前写预期，改后同命令）

边界：`admin-web/src`，字面量 grep（含模板串形态的 `compensat` 大小写不敏感补搜），不含动态拼接；后端 / e2e 由 T7a / T7b 已清。

| 命令 | 改前 | 改后 |
|---|---|---|
| `grep -rn "CLIENT_COMPENSATION\|/compensation\|'COMPENSATION'\|INTERNAL_TRANSFER_COMPENSATION\|Initiate compensation\|UNEXPLAINED_CLIENT_LOSS" admin-web/src` | **18** | **0**（预期 0，含「`UNEXPLAINED_CLIENT_LOSS` 作新弹层固定成因」——弹层里是写死的展示词 `Unexplained client loss`，不是该码字面量，故无需例外） |
| T7a 清点用的 `CLIENT_COMPENSATION\|sourceAdjustmentNo\|INTERNAL_TRANSFER_COMPENSATION_IN\|initiateCompensation\|'COMPENSATION'`（admin-web/src） | 15（T7a 报告） | **0** |
| `grep -rniE "sourceAdjustmentNo\|compensat" admin-web/src` | 命中补款相关多处 | 剩 `COMPENSATING`（对账桶名，另一概念）、`reconTypes.ts` 一句退役说明注释、`HouseTransferDetail` 的英文词 `compensated`——均非补款概念 |
| 全仓同 T7a 命令（`src scripts prisma test admin-web/src client-web/src`，排除 migrations） | 20（T7b 后） | **5**，全是 T7a 钉死「已退役」的负向断言（`not.toHaveProperty('sourceAdjustmentNo')` 等，留作锁） |

## 4. 改动与来源（每条对应 brief 哪一句）

- `utils/shortfallTopup.ts`（新）+ spec：Status 标签四态（`Pending CFO` / `Shortfall recognised · topping up` / `Explained` / `Shortfall recognised · top-up failed`）与 from 钱包候选过滤——brief「Row Status label by the attached transfer」「from select … filtered to F_OPS/F_FEE」。
- `CaseFlowTable.tsx`：菜单项、标签、行锁（`disposition.transferNo`）、删 Initiate compensation 与 COMPENSATION 分支、划转回挂行只留垫款。新增 `canShortfallTopup` 门（金库划转写权，不再借 `canCreateAdjustment`）。
- `ReconciliationCasesDetailPage.tsx`：`canFundClient` 收窄为垫款写权（补款退役后只剩垫款用它），新增 `canShortfallTopup`；`?adjustmentNo=` 自动开弹层改为 `?shortfallIncidentNo=`（按 `nextStep.kind==='SHORTFALL_TOPUP'` 且 `disposition.incidentNo` 匹配）。
- `InternalTransferInitiateModal.tsx`：补款分支 → 认损补缺弹层；垫款分支原样。顺带：弹层常驻挂载，`reason / result / error` 在每次打开时清空（否则同一案件页连着给两行开单会带出上一次的回执——此前只有垫款走这个弹层、几乎碰不到，认损补缺可在多行重复，故必修）。
- `IncidentDetailPage.tsx`：「Initiate Compensation」→「Recognize loss & top up」，条件 = 金库写权 ∧ ASSESSED/RESOLVING ∧ FIRM_LOSS ∧ 有来源案 ∧ 有客户 ∧ 未挂 TRANSFER 善后；`RemediationItem.status` 随按钮退役。
- 后端 `incident.service.ts` + spec：`getView` 里 `adjustmentStatusByNo` 反查与 `remediations[].status` 只为那个按钮服务（T7a 报告 §8-6 点名「T8 一并清」），按钮没了即孤儿，已删；spec 两例改为断言四键投影（`incident.service.spec` 绿）。
- `InternalTransferDetail.tsx` / `InternalTransferList.tsx` / `ReconciliationCasesListPage.tsx` / `ReconciliationAdjustmentCreateModal.tsx` / `internalTransferStatusMap.ts` / `reconTypes.ts`：删 `sourceAdjustmentNo`（后端已无此列）、补款用途 / 徽标，加 `SHORTFALL_TOPUP` 用途词与认损补缺单的来路 / 生效日 / 记短缺时刻展示。
- R23：删 `HOUSE_TRANSFER_STATUSES` 与对应手抄字面量 spec 例；House Transfers 导航图标 `ArrowRightLeft` → `House`（与 Internal Transfers 的 `ArrowLeftRight` 一眼可分）。
