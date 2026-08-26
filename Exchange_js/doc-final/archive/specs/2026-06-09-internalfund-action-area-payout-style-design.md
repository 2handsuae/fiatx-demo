# InternalFund 详情页 Action 区 → Payout 样式改造 Design

> 状态：设计收口（pre-implementation）
> 适用：`admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx` 的 sidebar "Actions" 组
> 目标：把 action 区从「静态下拉 + reason 文本框 + 单个 Submit」改成 Payout 详情页那种 **状态机感知的一键模拟按钮面板**（amber dashed、sim-mode 门控），与 `PayoutDetail.tsx` 视觉/交互一致。
> 范围确认：**完整 Payout 模式**（不只是换皮，连交互模型一起对齐）。

---

## 1. 范围

- **新增**：`admin-web/src/utils/fundActionMap.ts` —— 仿 `payoutActionMap.ts`，提供 `getFundSimActionsForStatus(status, assetType)`。
- **改写**：`InternalFundDetailPage.tsx` 的 sidebar "Actions" 组（state-machine-aware 一键按钮）。
- **不动**：页面其余部分（Hero / Execution Detail / Status Timeline / Identity / Lifecycle 区）、路由、导航、后端。
- **无后端改动**：fund 详情端点 `findOneByNoForAdmin` 已 `include: { asset: true }`，响应里已带 `asset.type`（CRYPTO/FIAT）；前端只需在接口类型里补 `type` 字段。
- **纯前端**：1 个新 util + 1 个页面的 sidebar 组改写。

参照样板：`admin-web/src/pages/PayoutDetail.tsx`（action 区）+ `admin-web/src/utils/payoutActionMap.ts`（action map）。

---

## 2. 关键事实：InternalFund 状态机 ≠ Payout 状态机

action map **必须**忠实映射 `src/modules/funds-layer/domain/funds-flow.service.ts` 的 `CRYPTO_TRANSITIONS` / `FIAT_TRANSITIONS`，**不能照抄 payoutActionMap**。两处真实差异：

1. **终态是 `CLEAR`（不是 Payout 的 `CLEARED`）** —— `InternalFundStatus.CLEAR`。
2. **有 `CANCEL` 动作**（Payout map 没有）：crypto 在 `CREATED/SIGNING/BROADCASTED/CONFIRMING` 可 CANCEL；fiat 在 `CREATED` 可 CANCEL。
3. crypto `TIMEOUT` 在 `BROADCASTED` 和 `CONFIRMING` 都合法。
4. fiat `RETURN` 在 `CONFIRMED` 和 `CLEAR`（已 cleared 态）都合法。

### 由 transition map 推导的动作集（权威来源 = funds-flow.service.ts）

**CRYPTO**（每个动作 → 其合法的当前状态）：

| action | label | enabledStatuses |
|---|---|---|
| SIGN | ⚡ Sign | CREATED |
| BROADCAST | ⚡ Broadcast | SIGNING |
| SIGN_FAIL | ⚡ Sign Fail | SIGNING |
| SEEN_IN_MEMPOOL | ⚡ Seen in Mempool | BROADCASTED |
| DROP | ⚡ Drop | BROADCASTED |
| TIMEOUT | ⚡ Timeout | BROADCASTED, CONFIRMING |
| CONFIRM | ⚡ Confirm | CONFIRMING |
| FAIL | ⚡ Fail | CONFIRMING |
| CLEAR | ⚡ Clear (system) | CONFIRMED |
| CANCEL | ⚡ Cancel | CREATED, SIGNING, BROADCASTED, CONFIRMING |

**FIAT**：

| action | label | enabledStatuses |
|---|---|---|
| SUBMIT | ⚡ Submit | CREATED |
| CONFIRM | ⚡ Confirm | CONFIRMING |
| FAIL | ⚡ Fail | CONFIRMING |
| TIMEOUT | ⚡ Timeout | CONFIRMING |
| CLEAR | ⚡ Clear (system) | CONFIRMED |
| RETURN | ⚡ Return | CONFIRMED, CLEAR |
| CANCEL | ⚡ Cancel | CREATED |

**终态集** `FUND_TERMINAL = { CLEAR, FAILED, TIMEOUT, RETURNED, CANCELLED }`（注意是 `CLEAR` 非 `CLEARED`）。

---

## 3. `fundActionMap.ts`（新增，结构对齐 payoutActionMap）

```ts
// admin-web/src/utils/fundActionMap.ts
export interface FundSimAction {
  action: string;
  label: string;
  enabledStatuses: Set<string>;
}

const CRYPTO_SIM_ACTIONS: FundSimAction[] = [ /* 见上表 */ ];
const FIAT_SIM_ACTIONS: FundSimAction[]   = [ /* 见上表 */ ];

const FUND_TERMINAL = new Set(['CLEAR', 'FAILED', 'TIMEOUT', 'RETURNED', 'CANCELLED']);

export function getFundSimActionsForStatus(
  currentStatus: string,
  assetType?: string | null,
): Array<FundSimAction & { enabled: boolean }> {
  const isTerminal = FUND_TERMINAL.has(currentStatus.toUpperCase());
  const actions = assetType?.toUpperCase() === 'FIAT' ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus.toUpperCase()),
  }));
}
```

- `assetType` 缺省（null/undefined/非 FIAT）→ 落 CRYPTO（与后端 `getTransitionMap` 的 `assetType === 'FIAT' ? FIAT : CRYPTO` 默认一致）。
- 顶部加注释指明权威来源是 `funds-flow.service.ts` 的 transition map，避免后续漂移。
- 与 payoutActionMap 一样：返回**该类型全部动作**，非法的标 `enabled:false`（UI 灰显），与 Payout「全列出 + 灰掉非法」一致。

---

## 4. `InternalFundDetailPage.tsx` Actions 组改写

### 4.1 删除（旧静态模式）
- `SIMULATE_ACTIONS` 常量数组（L61–71）。
- `simAction` / `simReason` state（L82–83）。
- sidebar "Actions" 组里的 `<select>` 下拉、`Action` label、`Reason` label + `<input>`、单个 Submit 按钮、`selectInputCls`（若改写后不再使用则一并移除）。
- `handleSimulate` 改名/改造为 `handleSimAction(action: string)`（见下）。

### 4.2 新增 import / hook
```ts
import { useSimulationMode } from '../../utils/simulationMode';
import { getFundSimActionsForStatus } from '../../utils/fundActionMap';
```
组件内：
```ts
const { enabled: simulationModeEnabled } = useSimulationMode();
const simActions = simulationModeEnabled
  ? getFundSimActionsForStatus(data.status, data.asset?.type)
  : [];
```

### 4.3 `FundAsset` 接口补字段
```ts
interface FundAsset {
  code?: string | null;
  currency?: string | null;
  decimals?: number;
  type?: string | null;   // 新增：CRYPTO | FIAT（驱动动作集）
}
```

### 4.4 `handleSimAction`（复用现有 simulate 端点，一键、无 reason）
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
- 端点、body 形状不变（`{ fundsFlowId, action }`，去掉 `reason`）。`simSubmitting` / `simError` state 保留。

### 4.5 渲染（照搬 PayoutDetail 的 "Simulation Controls" 组）
```tsx
{simulationModeEnabled && simActions.length > 0 && (
  <SidebarGroup title="Simulation Controls">
    <div className="rounded border border-dashed border-amber-400 bg-amber-900/20 p-2">
      <div className="mb-2 flex items-center gap-1 font-mono text-[9px] text-amber-400">⚡ SIM MODE</div>
      {simError && <p className="mb-2 font-mono text-[10px] text-adm-red">{simError}</p>}
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
- **非 sim 模式 → 不渲染该组**（与 Payout 一致；旧版是「永远显示」，现改为 sim-mode 门控）。
- 保留 `simError` 显示（放面板内，与旧行为一致）。

---

## 5. 行为差异对照

| | 旧（静态） | 新（Payout 模式） |
|---|---|---|
| 是否始终显示 | 永远显示 | 仅 sim 模式显示 |
| 动作选择 | 下拉选全部动作（不分状态） | 状态机：该 asset 类型全部动作，非法灰显 |
| 触发 | 选动作 + 选填 reason → Submit | 一键点按钮即触发 |
| asset 类型 | 不感知（永远 crypto 动作集） | 按 `asset.type` 切 CRYPTO/FIAT |
| reason | 有 | 去掉（一键，与 Payout 一致） |
| 视觉 | blue-tinted box | amber dashed box（Payout 同款） |

---

## 6. 验证

- `cd admin-web && npx tsc -b`（无 FE 测试框架，类型检查为主门禁）。
- 手动（vite dev HMR，端口 3501，刷新即可）：开启 sim 模式 → 进一笔 FIAT fund（状态 CREATED）→ 应只见 `⚡ Submit` 可点、其余灰；点 Submit → 状态进 CONFIRMING、按钮集随之更新。再验一笔 CRYPTO fund 的 SIGN→BROADCAST→… 链。终态 fund（CLEAR/FAILED/…）→ 全灰。关闭 sim 模式 → action 组消失。

---

## 7. Out of Scope
- 后端 simulate 端点 / 状态机逻辑 —— 不动。
- fund 详情页其余区块 —— 不动。
- 把 transition map 抽成前后端共享 —— 推后（本轮手抄 + 注释标源即可）。

---

## 8. 交付清单

| 文件 | 改动 |
|---|---|
| `admin-web/src/utils/fundActionMap.ts` | 新增；`getFundSimActionsForStatus` + CRYPTO/FIAT 动作集（映射 funds-flow.service transition map）|
| `admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx` | Actions 组改写为 Payout 样式一键按钮（sim-mode 门控）；删静态下拉/reason；`handleSimAction`；`FundAsset.type` 字段 |

---

## 9. 不变量速查
- 纯前端，无后端/schema/路由/导航变更。
- action 集 = funds-flow.service 的 transition map 的忠实映射（终态 `CLEAR` 非 `CLEARED`；含 `CANCEL`）。
- 复用既有 simulate 端点与 body 形状（去 reason）。
- sim-mode 门控：非 sim 模式不显示 action 区。
