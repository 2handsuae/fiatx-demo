# InternalFund 详情页 Action 区 → Payout 样式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `InternalFundDetailPage` 的 sidebar "Actions" 组从「静态下拉 + reason + Submit」改成 Payout 详情页那种 **状态机感知的一键模拟按钮面板**（amber dashed、sim-mode 门控）。

**Architecture:** 纯前端。新增 `fundActionMap.ts`（忠实映射后端 `funds-flow.service.ts` 的 CRYPTO/FIAT transition map，产出 `getFundSimActionsForStatus`）；改写 `InternalFundDetailPage` 的 Actions 组，复用既有 simulate 端点。无后端/schema/路由变更。

**Tech Stack:** React + TypeScript + Vite + Tailwind（admin-web）。无 FE 测试框架 → 验证门禁 = `npx tsc -b` + sim 模式手验。

参照：`admin-web/src/utils/payoutActionMap.ts`、`admin-web/src/pages/PayoutDetail.tsx`（action 区）。
Spec：`doc-final/superpowers/specs/2026-06-09-internalfund-action-area-payout-style-design.md`。

---

### Task 1: 新增 `fundActionMap.ts`

**Files:**
- Create: `admin-web/src/utils/fundActionMap.ts`

权威来源 = `src/modules/funds-layer/domain/funds-flow.service.ts` 的 `CRYPTO_TRANSITIONS` / `FIAT_TRANSITIONS`。终态是 `CLEAR`（非 `CLEARED`），含 `CANCEL` 动作。

- [ ] **Step 1: 写文件（完整内容）**

```ts
// admin-web/src/utils/fundActionMap.ts
//
// InternalFund 模拟动作映射。
// 权威来源：src/modules/funds-layer/domain/funds-flow.service.ts 的
// CRYPTO_TRANSITIONS / FIAT_TRANSITIONS（改动状态机时必须同步本文件）。
// 注意：终态是 CLEAR（非 Payout 的 CLEARED）；InternalFund 含 CANCEL 动作。

export interface FundSimAction {
  action: string;
  label: string;
  enabledStatuses: Set<string>;
}

const CRYPTO_SIM_ACTIONS: FundSimAction[] = [
  { action: 'SIGN',            label: '⚡ Sign',            enabledStatuses: new Set(['CREATED']) },
  { action: 'BROADCAST',       label: '⚡ Broadcast',       enabledStatuses: new Set(['SIGNING']) },
  { action: 'SIGN_FAIL',       label: '⚡ Sign Fail',       enabledStatuses: new Set(['SIGNING']) },
  { action: 'SEEN_IN_MEMPOOL', label: '⚡ Seen in Mempool', enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'DROP',            label: '⚡ Drop',            enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'TIMEOUT',         label: '⚡ Timeout',         enabledStatuses: new Set(['BROADCASTED', 'CONFIRMING']) },
  { action: 'CONFIRM',         label: '⚡ Confirm',         enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',            label: '⚡ Fail',            enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CLEAR',           label: '⚡ Clear (system)',  enabledStatuses: new Set(['CONFIRMED']) },
  { action: 'CANCEL',          label: '⚡ Cancel',          enabledStatuses: new Set(['CREATED', 'SIGNING', 'BROADCASTED', 'CONFIRMING']) },
];

const FIAT_SIM_ACTIONS: FundSimAction[] = [
  { action: 'SUBMIT',  label: '⚡ Submit',         enabledStatuses: new Set(['CREATED']) },
  { action: 'CONFIRM', label: '⚡ Confirm',        enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',    label: '⚡ Fail',           enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'TIMEOUT', label: '⚡ Timeout',        enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'CLEAR',   label: '⚡ Clear (system)', enabledStatuses: new Set(['CONFIRMED']) },
  { action: 'RETURN',  label: '⚡ Return',         enabledStatuses: new Set(['CONFIRMED', 'CLEAR']) },
  { action: 'CANCEL',  label: '⚡ Cancel',         enabledStatuses: new Set(['CREATED']) },
];

const FUND_TERMINAL = new Set(['CLEAR', 'FAILED', 'TIMEOUT', 'RETURNED', 'CANCELLED']);

export function getFundSimActionsForStatus(
  currentStatus: string,
  assetType?: string | null,
): Array<FundSimAction & { enabled: boolean }> {
  const status = currentStatus.toUpperCase();
  const isTerminal = FUND_TERMINAL.has(status);
  const actions = assetType?.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(status),
  }));
}
```

- [ ] **Step 2: 类型检查**

Run: `cd admin-web && npx tsc -b`
Expected: 无新增报错（该文件自洽，无外部依赖）。

- [ ] **Step 3: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add admin-web/src/utils/fundActionMap.ts
git commit -m "feat(admin): add fundActionMap for InternalFund sim actions (mirrors funds-flow transitions)"
```

---

### Task 2: 改写 `InternalFundDetailPage` 的 Actions 组为 Payout 样式

**Files:**
- Modify: `admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx`

逐处编辑。每处给出精确 before → after。

- [ ] **Step 1: 加 import（hook + action map）**

在文件顶部 import 区（`adminFetch` import 块附近）追加：

```ts
import { useSimulationMode } from '../../utils/simulationMode';
import { getFundSimActionsForStatus } from '../../utils/fundActionMap';
```

- [ ] **Step 2: `FundAsset` 接口补 `type` 字段**

Before:
```ts
interface FundAsset {
  code?: string | null;
  currency?: string | null;
  decimals?: number;
}
```
After:
```ts
interface FundAsset {
  code?: string | null;
  currency?: string | null;
  decimals?: number;
  type?: string | null;
}
```

- [ ] **Step 3: 删除 `SIMULATE_ACTIONS` 静态数组**

删除整块：
```ts
const SIMULATE_ACTIONS = [
  'SIGN',
  'BROADCAST',
  'SEEN_IN_MEMPOOL',
  'CONFIRM',
  'CLEAR',
  'FAIL',
  'DROP',
  'TIMEOUT',
  'CANCEL',
] as const;
```

- [ ] **Step 4: 替换 sim 相关 state + 加 sim-mode hook/derived**

Before（组件内）:
```ts
  // Manual Simulation state
  const [simAction, setSimAction] = useState<(typeof SIMULATE_ACTIONS)[number]>('SIGN');
  const [simReason, setSimReason] = useState('');
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simError, setSimError] = useState('');
```
After:
```ts
  // Simulation state (Payout-style one-click panel)
  const { enabled: simulationModeEnabled } = useSimulationMode();
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simError, setSimError] = useState('');
```

- [ ] **Step 5: 把 `handleSimulate` 改写为 `handleSimAction(action)`**

Before:
```ts
  const handleSimulate = async () => {
    if (!data) return;
    setSimSubmitting(true);
    setSimError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/transfers/${data.internalTransaction.internalTxNo}/simulate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fundsFlowId: data.id,
            action: simAction,
            reason: simReason.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        setSimError(await getApiErrorMessage(response, 'Simulation step failed.'));
        return;
      }
      setSimReason('');
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setSimError(error instanceof Error ? error.message : 'Simulation step failed.');
    } finally {
      setSimSubmitting(false);
    }
  };
```
After:
```ts
  const handleSimAction = async (action: string) => {
    if (!data) return;
    setSimSubmitting(true);
    setSimError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/funds-layer/transfers/${data.internalTransaction.internalTxNo}/simulate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fundsFlowId: data.id, action }),
        },
      );
      if (!response.ok) {
        setSimError(await getApiErrorMessage(response, 'Simulation step failed.'));
        return;
      }
      await fetchData();
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setSimError(error instanceof Error ? error.message : 'Simulation step failed.');
    } finally {
      setSimSubmitting(false);
    }
  };
```

- [ ] **Step 6: 在 render 前算 `simActions`**

在 `if (!data) return null;` 之后、`const decimals = ...` 附近追加：
```ts
  const simActions = simulationModeEnabled
    ? getFundSimActionsForStatus(data.status, data.asset?.type)
    : [];
```

- [ ] **Step 7: 删除 `selectInputCls`（改写后不再使用）**

删除：
```ts
  const selectInputCls =
    'h-[30px] w-full rounded border border-adm-border bg-adm-bg px-2 font-mono text-[11px] text-adm-t1 outline-none focus:border-adm-amber transition-colors';
```

- [ ] **Step 8: 改写 sidebar "Actions" 组**

Before（整个 `<SidebarGroup title="Actions">…</SidebarGroup>` 块）:
```tsx
          {/* ACTIONS → Manual Simulation */}
          <SidebarGroup title="Actions">
            <div className="rounded-lg border border-adm-blue/25 bg-adm-blue/6 p-3">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-blue">
                Manual Simulation
              </p>
              <p className="mt-1 font-mono text-[9px] leading-relaxed text-adm-t3">
                DEV-only. Advances this execution leg through its state machine.
              </p>

              {simError && (
                <p className="mt-2 font-mono text-[10px] text-adm-red">{simError}</p>
              )}

              <label className="mt-3 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                Action
              </label>
              <select
                value={simAction}
                onChange={(e) =>
                  setSimAction(e.target.value as (typeof SIMULATE_ACTIONS)[number])
                }
                className={`mt-1 ${selectInputCls}`}
                disabled={simSubmitting}
              >
                {SIMULATE_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              <label className="mt-2.5 block font-mono text-[9px] uppercase tracking-wider text-adm-t3">
                Reason (optional)
              </label>
              <input
                value={simReason}
                onChange={(e) => setSimReason(e.target.value)}
                placeholder="Reason"
                className={`mt-1 ${selectInputCls}`}
                disabled={simSubmitting}
              />

              <button
                onClick={handleSimulate}
                disabled={simSubmitting}
                className={adminButtonClass('simulationAction', 'mt-3 w-full')}
              >
                {simSubmitting ? 'Submitting…' : 'Submit Step'}
              </button>
            </div>
          </SidebarGroup>
```
After:
```tsx
          {/* ACTIONS → Simulation Controls (sim mode only, Payout-style) */}
          {simulationModeEnabled && simActions.length > 0 && (
            <SidebarGroup title="Simulation Controls">
              <div className="rounded border border-dashed border-amber-400 bg-amber-900/20 p-2">
                <div className="mb-2 flex items-center gap-1 font-mono text-[9px] text-amber-400">
                  ⚡ SIM MODE
                </div>
                {simError && (
                  <p className="mb-2 font-mono text-[10px] text-adm-red">{simError}</p>
                )}
                <div className="flex flex-col gap-1.5">
                  {simActions.map((a) => (
                    <button
                      key={a.action}
                      onClick={() => handleSimAction(a.action)}
                      disabled={!a.enabled || simSubmitting}
                      className="w-full rounded border border-dashed border-amber-500/50 bg-amber-900/30 px-2 py-1.5 text-left font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {simSubmitting ? '...' : a.label}
                    </button>
                  ))}
                </div>
              </div>
            </SidebarGroup>
          )}
```

- [ ] **Step 9: 清理 `adminButtonClass` import（如已无其他用途）**

检查文件内 `adminButtonClass` 是否还有其他引用：
Run: `cd admin-web && grep -n "adminButtonClass" src/pages/funds-layer/InternalFundDetailPage.tsx`
- 若 grep 仅剩 import 行（无其他调用）→ 删除该 import：
  ```ts
  import { adminButtonClass } from '../../components/common/adminButtonStyles';
  ```
- 若仍有其他调用 → 保留 import，不动。

（注：Step 8 移除了唯一的 `adminButtonClass('simulationAction', ...)` 调用，预期 import 变孤儿需删除 —— 但以 grep 实际结果为准。）

- [ ] **Step 10: 类型检查**

Run: `cd admin-web && npx tsc -b`
Expected: 无报错（无未用变量/孤儿 import；`simAction`/`simReason`/`SIMULATE_ACTIONS`/`selectInputCls` 已全部移除）。
- 若报 "X is declared but never used" → 回到对应 step 确认该符号已删干净。

- [ ] **Step 11: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx
git commit -m "feat(admin): InternalFund detail action area → Payout-style one-click sim panel"
```

---

### Task 3: 手动验收（sim 模式）

**Files:** 无（运行时验证）

- [ ] **Step 1: 确认 admin-web 在跑（vite dev / HMR，端口 3501）**

Run: `lsof -nP -iTCP:3501 -sTCP:LISTEN`
Expected: 有 `node`（vite）监听 3501。HMR 会自动加载改动，无需重启。

- [ ] **Step 2: 浏览器验收清单**

1. 进 admin（3501），开启 **Simulation Mode**。
2. 进一笔 **FIAT** fund 详情（状态 `CREATED`）→ Actions 区应为 amber dashed「Simulation Controls」面板；`⚡ Submit` 可点，其余动作灰显。
3. 点 `⚡ Submit` → 状态进 `CONFIRMING`；按钮集刷新为 `⚡ Confirm`/`⚡ Fail`/`⚡ Timeout` 可点。
4. 进一笔 **CRYPTO** fund（`CREATED`）→ 应见 `⚡ Sign` 可点，链路 SIGN→BROADCAST→SEEN_IN_MEMPOOL→CONFIRM→CLEAR 逐步可走。
5. 进一笔**终态** fund（`CLEAR`/`FAILED`/`RETURNED`/...）→ 所有按钮灰显。
6. **关闭 Simulation Mode** → Actions/Simulation Controls 区整块消失（与 Payout 一致）。

Expected: 全部符合；无 console 报错。

---

## Self-Review

**1. Spec coverage（逐条对 spec）：**
- 新增 `fundActionMap.ts` + `getFundSimActionsForStatus` → Task 1 ✓
- CRYPTO/FIAT 动作集映射 transition map（终态 CLEAR、含 CANCEL）→ Task 1 表 ✓
- 删静态下拉/reason、加 sim-mode 门控、amber dashed 一键按钮 → Task 2 Step 3–8 ✓
- `FundAsset.type` 字段 → Task 2 Step 2 ✓
- `handleSimAction` 复用 simulate 端点、body `{fundsFlowId, action}`（去 reason）→ Task 2 Step 5 ✓
- 非 sim 模式不显示 → Task 2 Step 8（`{simulationModeEnabled && ...}`）✓
- 验证 tsc + sim 手验 → Task 1 Step 2 / Task 2 Step 10 / Task 3 ✓
- 孤儿 import 清理 → Task 2 Step 9 ✓
- 无 spec 要求遗漏。

**2. Placeholder scan：** 无 TBD/TODO；每个 code step 给出完整代码与精确 before/after。✓

**3. Type consistency：**
- `getFundSimActionsForStatus(currentStatus, assetType?)` 在 Task 1 定义、Task 2 Step 6 按签名调用（`data.status`, `data.asset?.type`）✓
- `handleSimAction(action: string)` 定义（Step 5）与调用（Step 8 `() => handleSimAction(a.action)`）一致 ✓
- `simActions` 元素含 `.action`/`.label`/`.enabled`，Step 8 渲染用到的字段均在 Task 1 返回类型内 ✓
- `simulationModeEnabled` / `simSubmitting` / `simError` 全部在 Step 4 定义、后续引用一致 ✓
