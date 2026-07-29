# 充值前端(admin + client)+ 演示开关 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 逐任务执行。步骤用 `- [ ]` 跟踪。
> 分支 `feat/deposit-money-arcs`,worktree `.claude/worktrees/deposit-arcs/`。设计:[`specs/2026-07-29-deposit-frontend-design.md`](../specs/2026-07-29-deposit-frontend-design.md)

**Goal:** 两个前端认全 15 个充值状态、admin 能发起上缴/解冻、客户看到合规安全的英文文案、演示可脱离 sandbox 一键跑 8 场景。

**Architecture:** 抽两张状态映射表作单一真相源(admin 如实 / client 面向客户,刻意不同)→ 页面查表渲染 → admin 加处置区与演示面板 → 后端加 mock 开关与场景端点。

**Tech Stack:** React + Vite + TS(两个前端)、Tailwind(`adm-*` / `fx-*` 令牌)、NestJS(后端两处小改)、Jest(root,已含 admin-web)。

## Global Constraints

- **全英文铁律**:所有用户可见文案零中文(注释可中文)。徽章**全大写**;副文案/筛选项正常大小写。
- **client 违禁词**(大小写不敏感):`sanction/seiz/frozen/freeze/confiscat/enforcement/government/police` 一律不得出现在客户可见输出。`UNDER REVIEW` 是刻意中性词,不得"修正"回 `FROZEN`/`SEIZED`。
- admin 用 `adminFetch`(禁裸 fetch)、`adm-*` 令牌、共享原语;client 用 `customerFetch`、`fx-*` 令牌。
- API host 一律 `import.meta.env.VITE_API_URL`。
- **渲染验证铁律**:声称完成前必须真起服务 + 截图,不能只 tsc 绿。

## 探测已证实的三条现实(计划据此设计,勿再假设)

1. **补料链接后端没有** —— deposit 表只有 `sumsubFinanceTxnId/sumsubTravelRuleTxnId/manualReason`,无 SDK token/link;`ACTION_PENDING` 由 onHold webhook 写入,不创建 action。→ **CTA 降级为 `Please contact support`**(业主已定)。
2. **审批状态卡缺字段** —— `approvalCaseId` 不在 deposit 表;`approvalNo` 仅 POST 响应返回一次,`findOne` 不返回。→ **降级:发起后本地 state 显示,刷新即丢**(业主已定,坦诚标注)。
3. **数据层 tipping-off 泄露** —— `findOneForCustomer` 不裁字段,`manualReason`/`sumsubTxnId`/`statusHistory` 原样发到客户浏览器。→ **本轮只记 BACKLOG,不修**(业主已定)。

---

### Task 1: 两张状态映射表 + 单测(TDD)

**Files:**
- Create: `admin-web/src/utils/depositStatusMap.ts`
- Create: `admin-web/src/utils/depositStatusMap.spec.ts`
- Create: `client-web/src/utils/depositStatusView.ts`
- Create: `client-web/src/utils/depositStatusView.spec.ts`
- Modify: `jest.config.js`(`roots` 加 `'<rootDir>/client-web/src'` —— 否则 client 违禁词单测跑不到,形同虚设)

**Interfaces produces:**
```ts
// admin
export type DepositStatusGroup = 'IN_PROGRESS'|'WAITING'|'NEEDS_OFFICER'|'DISPOSING'|'COMPLETED'|'EXCEPTION';
export interface DepositStatusMeta { label: string; group: DepositStatusGroup; badgeClass: string }
export function getDepositStatusMeta(status: string): DepositStatusMeta  // 未知 → { label: status, group:'EXCEPTION', badgeClass: 警告色 }
// client
export interface DepositStatusView { label: string; note?: string; tone: 'neutral'|'positive'|'warning'|'danger' }
export function getDepositStatusView(status: string): DepositStatusView  // 未知 → PROCESSING
```

- [ ] **Step 1:** 写两个 spec(先红)。admin spec 断言 15 态各自 label(全大写,见 design §1.1)+ 未知态兜底。client spec 断言 15 态 label(见 design §1.2)+ **违禁词遍历**:
```ts
const FORBIDDEN = /sanction|seiz|frozen|freeze|confiscat|enforcement|government|police/i;
ALL_STATUSES.forEach(s => {
  const v = getDepositStatusView(s);
  expect(`${v.label} ${v.note ?? ''}`).not.toMatch(FORBIDDEN);
});
```
- [ ] **Step 2:** 跑红 `npx jest depositStatusMap depositStatusView`(client 那个此时应"找不到测试"→ 先改 jest.config roots,再红)。
- [ ] **Step 3:** 实现两文件。admin badgeClass **必须用 `adm-*` 令牌**(现有 `DEPOSIT_BADGE_MAP` 用裸 Tailwind,新表纠正);client tone 用 `fx-*` 语义(positive=`fx-sage`、danger=`fx-rust`、warning=`fx-brass`、neutral=`fx-dust`)。
- [ ] **Step 4:** 跑绿。**注意文件必须 `.ts` 非 `.tsx`**(jest `moduleFileExtensions` 无 tsx)。
- [ ] **Step 5:** Commit。

---

### Task 2: admin 列表页接入映射

**Files:** Modify `admin-web/src/pages/DepositTransactionList.tsx`

- [ ] **Step 1:** `:292-299` 徽章改用 `getDepositStatusMeta(item.status)`(替 `getDepositStatusBadgeClass` + `formatStatusLabel`);保留 `:297` 的 BELOW MIN `AdminBadge`。
- [ ] **Step 2:** `:51-54` `DEPOSIT_STATUSES` 从 10 态补到 15 态(与映射表同源:导出 `ALL_DEPOSIT_STATUSES` 供下拉用,消除"两份独立清单"问题)。
- [ ] **Step 3:** 下拉 option 文案用映射表 label(全大写徽章 / 下拉用 Title case,见 design)。
- [ ] **Step 4:** `npm --prefix admin-web run build` tsc 0。Commit。

---

### Task 3: admin 详情页 — 映射 + 终态门控 + Sumsub 引用区

**Files:** Modify `admin-web/src/pages/DepositTransactionDetail.tsx`、`admin-web/src/utils/depositActionMap.ts`

- [ ] **Step 1:** `DepositDetail` interface(`:36-94`)补声明后端已有但前端未声明的字段:`sumsubFinanceTxnId?: string|null; sumsubTravelRuleTxnId?: string|null; manualReason?: string|null; slaDeadline?: string|null`。
- [ ] **Step 2:** Hero 徽章(`:300-332` 区)+ `getTimelineDotColor`(`:636-645`)+ `getTimelineBadge`(`:647-661`)全部改查 `getDepositStatusMeta` —— **三处 10 态表统一到一处**。
- [ ] **Step 3:** `depositActionMap.ts:70-72` `TERMINAL_STATUSES` 补 `RETURNED, SEIZED`(治 BACKLOG:36「终态仍全显 6 按钮」)。
- [ ] **Step 4:** 通用 Actions 组门控(`:415`)加终态判定:`!isTerminal(data.status)`,并追加 `!isDisposing`(RETURNING/SEIZING/CONFISCATING)。
- [ ] **Step 5:** 新增 `DetailCard "Sumsub References"`(只读):`InfoField` 展示两个 txnId + `manualReason`(用 `copyable`);无值时 `InfoField` 自身处理空态。
- [ ] **Step 6:** MANUAL_CHECKING 时在 Actions 区显示只读提示:`Disposition happens in the Sumsub console (officer tags the txn, then re-rejects).`
- [ ] **Step 7:** tsc 0。Commit。

---

### Task 4: admin 详情页 — 发起上缴 / 解冻(含审批号本地显示)

**Files:** Modify `admin-web/src/pages/DepositTransactionDetail.tsx`

**Consumes(后端已就绪):** `POST /deposit-transactions/:id/seize` body `{reason?, orderRef?}` → 响应含 `approvalNo`;`POST .../unfreeze` 同形状。

- [ ] **Step 1:** 加 state:`isSeizeModalOpen/isUnfreezeModalOpen/seizeReason/seizeOrderRef/unfreezeReason/unfreezeOrderRef/lastApprovalNo`。
- [ ] **Step 2:** 新增 `SidebarGroup "Frozen Disposition"`,**仅 `data.status === 'FROZEN'` 时渲染**,两个按钮 `Initiate Seize` / `Initiate Unfreeze`(用 `adminButtonClass('workflowNegative')` / `('workflowSecondary')` —— **走 adminButtonClass,不学页面现有内联 `bg-red-600`**)。
- [ ] **Step 3:** 两个 Modal 照 Confiscate Modal(`:536-584`)结构:**reason + orderRef 两个必填**(orderRef = 政府令/解冻令文书号),Confirm `disabled={submitting || !reason.trim() || !orderRef.trim()}`,按钮用 `adminButtonClass('modalCancel'|'modalConfirm')`。
- [ ] **Step 4:** handler 照 `handleConfiscate`(`:213-241`):`adminFetch` POST → 失败 `getApiErrorMessage` → 成功读 `result.approvalNo` → `setNotice(\`Seize submitted for approval — ${result.approvalNo}\`)` + `setLastApprovalNo(result.approvalNo)` + `await fetchData()` → `catch (AdminSessionError) return`。
- [ ] **Step 5:** 审批提示条(降级实现):`lastApprovalNo` 有值时显示 `Approval ${lastApprovalNo} submitted — track it in the Approvals center`,**并在代码注释标明**:后端 `findOne` 不返回 `approvalCaseId`,刷新后此提示消失(BACKLOG 已记)。
- [ ] **Step 6:** tsc 0。Commit。

---

### Task 5: client 充值页接入映射 + 英文化

**Files:** Modify `client-web/src/pages/Deposit.tsx`

- [ ] **Step 1:** 删 `getCustomerFacingStatus`(`:300-320`),改 import `getDepositStatusView`;`renderStatusBadge`(`:322-329`)改用它,徽章加 `uppercase` class,`tone` 映射到 `fx-*` 色。
- [ ] **Step 2:** History 筛选(`:706-717`)的 5 个 option 更新为客户口径(用映射表 label,含 `RETURNING`/`RETURNED`/`UNDER REVIEW` 组);**注意 value 仍是后端状态码**。
- [ ] **Step 3:** 详情 modal(`:1073-1145`)状态处加**副文案**(`view.note`,如 `Funds are being returned to the original sender`)。
- [ ] **Step 4:** ACTION_PENDING 时显示 `Please contact support`(**不做跳转** —— 后端无 SDK token,已证实);代码注释标明降级原因 + BACKLOG 引用。
- [ ] **Step 5:** **清中文 4 处**:`:487`/`:488` 改英文(`Next: open Payin Detail in Admin and advance the payin rail…`)、`:498` 改 `${summary.assetCode} simulated deposit created — continue in Admin.`、`:505` 改 `View history`。
- [ ] **Step 6:** `npm --prefix client-web run build` tsc 0 + `grep -P '[\x{4e00}-\x{9fff}]' client-web/src/pages/Deposit.tsx` **零命中**。Commit。

---

### Task 6: 后端 mock 开关 + 场景端点

**Files:**
- Modify: `src/modules/deposit-sumsub/deposit-sumsub.module.ts`
- Create: `src/modules/deposit-sumsub/admin-deposit-demo.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`(登记新端点)

- [ ] **Step 1:** module provider 条件化:
```ts
{ provide: SUMSUB_TXN_CLIENT,
  useClass: process.env.SUMSUB_MOCK_MODE === 'true' ? MockSumsubTxnClient : HttpSumsubTxnClient }
```
(与 `sumsub.client.ts:84` 同名开关对齐)。
- [ ] **Step 2:** demo controller:`POST /admin/deposit-sumsub/demo/run-scenario` body `{ depositId, scenario }` → 查 `DEPOSIT_SCENARIOS[scenario]`(`fixtures/scenarios.ts`,8 个 key,注意**无 S8**)→ 复用 `test/helpers/deposit-scenario-runner.ts` 的喂法(primeSubmit/primeTxn + 逐步 `ingestionService.ingest(payload,{isSimulated:true})`)。
  - **仅当 `SUMSUB_MOCK_MODE==='true'` 才注册该 controller**(module 里条件化 `controllers` 数组)——生产环境端点不存在。
  - 需注入 `MockSumsubTxnClient` 实例(mock 模式下 `SUMSUB_TXN_CLIENT` 即它)以 prime。
  - 写审计 `recordByActor`(谁/何时/哪个场景/哪笔 deposit)。
- [ ] **Step 3:** RBAC 照 `POST :id/confiscate` 登记(`rbac.catalog.ts` route + `db:base:sync` + **重启后端**才生效)。
- [ ] **Step 4:** `npx tsc --noEmit` 0;`npx jest` 无回归。Commit。

---

### Task 7: admin 演示面板

**Files:** Modify `admin-web/src/pages/DepositTransactionDetail.tsx`

**范式:** 照 `FundsOrderDetail.tsx:473-515` 的 ⚡ 面板,但**全英文、用 `adm-*` 令牌、按钮用 `adminButtonClass('simulationAction')`** —— 不复制它的双语 label 与裸 amber 色。

- [ ] **Step 1:** `const { enabled: simEnabled } = useSimulationMode();`(`admin-web/src/utils/simulationMode.ts`)。
- [ ] **Step 2:** `{simEnabled && (` 门控的 section,标题 `⚡ Simulation`,8 个按钮(S1/S2/S3/S4/S5/S6/S7/S9),label 用场景可读名(`Happy fiat` / `Sanctions → frozen` / `PEP → EDD pass` …)。
- [ ] **Step 3:** 点击 → `adminFetch POST /admin/deposit-sumsub/demo/run-scenario` body `{ depositId: id, scenario: key }` → 成功 `setNotice` + `await fetchData()`。
- [ ] **Step 4:** tsc 0。Commit。

---

### Task 8: 渲染验证 + 中文扫描 + 文档 + 硬闸

**Files:** truth `v4-deposit.md`(前端现状段)、`BACKLOG.md`

- [ ] **Step 1:** 起两个前端(worktree self 栈:`bash scripts/stack.sh up`),`SUMSUB_MOCK_MODE=true` 重启后端。
- [ ] **Step 2:** **逐场景喂 + 截图**(项目铁律,不可省):制裁→`FROZEN`、脏钱→`MANUAL_CHECKING`、退回→`RETURNING`/`RETURNED`、`SEIZING`、演示面板本身、admin 处置区(FROZEN 下两按钮)、client 侧 `UNDER REVIEW` 与 `RETURNING` 文案。截图存 `.superpowers/sdd/` 并在报告贴出。
- [ ] **Step 3:** **零中文扫描**:`grep -rnP '[\x{4e00}-\x{9fff}]'` 扫 `admin-web/src/pages/DepositTransaction*.tsx`、`admin-web/src/utils/depositStatus*.ts`、`client-web/src/pages/Deposit.tsx`、`client-web/src/utils/depositStatusView.ts` —— **用户可见文案零命中**(注释豁免)。
- [ ] **Step 4:** BACKLOG 登记三条:①客户面 API 未裁字段(manualReason/sumsubTxnId/statusHistory 泄露,tipping-off)②补料 CTA 缺 SDK token 已降级 ③审批号刷新即丢(缺 `approvalCaseId`)。
- [ ] **Step 5:** truth `v4-deposit.md` 补前端现状段(两个前端认全 15 态、admin 可发起上缴/解冻、演示开关)。
- [ ] **Step 6:** 硬闸:两前端 `build` tsc 0 + root `npx jest`(净新失败 0)+ e2e 15/15 不回归。Commit。

---

## Self-Review

- **Spec 覆盖**:design §1(Task1)§2(2/3/4)§3(5)§4(6/7)§5(8)全覆盖 ✅
- **占位扫描**:三处"未知"已由探测证实并落为降级方案,非占位 ✅
- **类型一致**:`getDepositStatusMeta`/`getDepositStatusView` 签名在 Task1 定义,2/3/5 引用一致 ✅
- **已知风险**:Task6 的 demo controller 需在 mock 模式注入 MockSumsubTxnClient 实例来 prime——若 DI 拿不到具体类型(接口 token 绑的是它),实施时可能要额外导出;标注供实施者留意。
