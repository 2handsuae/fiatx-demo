# Mock/Demo 资金单 External Ref 真实化（统一 helper）

> 设计文档 · 2026-06-29 · 分支 main
> 当前 demo/mock/sim 路径生成的 chain txHash (`0xDEMO1USDT` 10 字符) 和 bank reference (`REF-DEMO-1-AED`) 假到一眼穿帮，运营看 External Balances / Account Statement 时立刻识破。本设计加一个集中 helper，输出**确定性可复现**的真实格式 hash / bank ref，应用到 4 个 mock/demo/sim 调用点。产品代码路径不动，存量数据不补丁，下次 demo:all 重跑自动生效。

## 1. 底层逻辑

External Ref 是运营对账的**视觉真相钩子**——它必须看起来像真链上 hash / 真银行回执，否则演示场景没人当真。但 demo 环境又要**可复现**（跑两次同 seed 出同 hash），否则 screenshot 验收和回归测试都拿不准。

确定性 sha256 是两个需求的交集：`sha256(seed)` 同输入恒等输出，长度天然 64 hex 匹配 EVM/Tron 真 txHash 形态。

## 2. 范围

| 在范围 | 不在范围 |
|---|---|
| ✓ 新 helper `src/common/utils/fake-external-refs.util.ts`（2 函数） | 产品代码 `payouts.service.ts:489`（保守不动） |
| ✓ 4 处 demo/mock/sim 调用点改造 | 存量 DB 数据补丁 |
| ✓ 验收路径（DB regex + preview screenshot） | 真随机 hash（要可复现） |
| ✓ ZB bank ref 仿 Zand 格式 | 真银行回执号格式调研（仿真即可） |

## 3. Helper 设计

新文件：`src/common/utils/fake-external-refs.util.ts`

```typescript
import { createHash } from 'node:crypto';

/**
 * Deterministic fake EVM/Tron-style txHash for demo/mock/sim paths.
 * Output: `0x` + 64 hex chars (66 chars total) — matches real EVM/Tron format.
 * Determinism: same seed → same hash → demo reproducible for screenshot
 * verification + regression tests.
 *
 * NOT for production use — production payout txHash must come from the real
 * chain via signer/RPC.
 */
export function fakeChainTxHash(seed: string): string {
  const hex = createHash('sha256').update(`tx:${seed}`).digest('hex');
  return `0x${hex}`;
}

/**
 * Deterministic fake bank reference (Zand-like).
 * Output: `ZB${YYYYMMDD}${10 hex upper}` — 仿 Zand 回执号风格。
 * Determinism: same (seed, date) → same ref.
 */
export function fakeBankRef(seed: string, date: Date | string): string {
  const ymd = (typeof date === 'string' ? date : date.toISOString().slice(0, 10)).replace(/-/g, '');
  const hex = createHash('sha256').update(`bank:${seed}`).digest('hex').slice(0, 10).toUpperCase();
  return `ZB${ymd}${hex}`;
}
```

### 设计要点

- `update('tx:' + seed)` vs `update('bank:' + seed)` 前缀加 namespace —— 防 fake chain hash 和 fake bank ref 偶然撞同 seed 出同 hex
- `slice(0, 10)` for bank ref —— sha256 64 hex 全用太长，10 hex 已足够仿真 + 防碰撞（10^10 空间）
- `.toUpperCase()` 仿真实银行回执常用大写
- 不放在 `scripts/` 而放 `src/common/utils/` —— 因为 `mock-custodian-execution.adapter.ts` 和 `withdraw-transactions.controller.ts` 在 `src/` 里，互相 import 走 src 路径最干净；script 也能反向 import src 模块

## 4. 4 处调用点改造

| # | 文件 : 行 | 之前 | 之后 |
|---|---|---|---|
| 1 | `scripts/demo-lib.ts:239` | `txHash: type === PayinType.CRYPTO ? \`0x${SIM}${idx}USDT\` : undefined` | `txHash: type === PayinType.CRYPTO ? fakeChainTxHash(payinNo) : undefined` |
| 2 | `scripts/recon-demo.ts:488` | `0xDEMO${kind}${injSeq.toString(16).padStart(2, '0')}USDT` | `fakeChainTxHash(\`${walletRef}:${kind}:${injSeq}\`)` |
| 2 | `scripts/recon-demo.ts:489` | `BANK-PO${cutoffDate.replace(/-/g, '')}-${kind}${String(injSeq).padStart(3, '0')}` | `fakeBankRef(\`${walletRef}:${kind}:${injSeq}\`, cutoffDate)` |
| 3 | `src/modules/funds-layer/adapters/mock-custodian-execution.adapter.ts:8` | `\`0xmock${internalFundNo}${randomUUID().slice(0, 8)}\`` | `fakeChainTxHash(internalFundNo)` |
| 4 | `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts:144` | `body.txHash \|\| \`0xSIM${Date.now().toString(16)}\`` | `body.txHash ?? fakeChainTxHash(\`sim:${id ?? Date.now()}\`)` |

### Seed 选取原则

| 调用点 | seed 选什么 | 为什么 |
|---|---|---|
| demo-lib payin | `payinNo` | 一笔 payin 对应一个 txHash，业务键唯一 |
| recon-demo break inject | `walletRef:kind:injSeq` | 同一 wallet 同一类型多次注入要不同 hash，加 seq 增加熵 |
| mock-custodian-execution | `internalFundNo` | 一笔 fund 单一个 chain tx，业务键唯一 |
| withdraw simulate | `sim:${id ?? Date.now()}` | id 可能不在场（fallback Date.now()）；`sim:` 前缀标识 simulate 通道 |

## 5. 不变量

- 同 seed 必出同 hash（确定性）
- 输出长度恒定（chain 66 字符，bank ref 20 字符 `ZB` + 8 数字 + 10 hex）
- 不影响产品代码 `payouts.service.ts`（保守不动）
- 后端 read model schema 零改动
- 存量 DB 数据不动，重跑 demo:all 后新数据自动用新格式

## 6. 改动量

```
新建: src/common/utils/fake-external-refs.util.ts        ~30 lines
改 4 文件各 1-2 行                                       ~8 lines
─────────────────────────────────────────────────────────────────
总: 1 helper + 4 调用点切换 = ~40 lines / 5 files / 1 commit
```

## 7. 验收方式

| # | 验收项 | 工具 | 判据 |
|---|---|---|---|
| 1 | 重跑 demo:all + recon-demo + 重 build + 重启栈 | bash | 无 error |
| 2 | `payins.txHash` 样本 crypto 行 | sqlite3 + regex | `^0x[a-f0-9]{64}$` 通过 |
| 3 | `payins.referenceNo` 样本 fiat 行 | sqlite3 + regex | `^ZB\d{8}[A-F0-9]{10}$` 通过 |
| 4 | `tb_transfer_evidence.externalRef` 是否引用了新 hash | sqlite3 join | 同 sourceNo 的 evidence externalRef 跟 fund 单 txHash 一致 |
| 5 | preview External Balances 详情列表显新 hash | screenshot | amber 显示真实 hex 格式而非 `0xDEMO1USDT` |
| 6 | preview AccountStatement External Ref 列 | screenshot | DEPOSIT 行显 `0xa3f...` 而非 demo 假串 |
| 7 | 复现性：同 seed 跑两次 | bash 对比 | hash 相等 |

## 8. 后续考虑（Deferred）

- 产品代码 `payouts.service.ts:489` 真正接入 chain signer 后自然替代当前 fallback hex
- bank ref 格式如未来对接 Zand SDK 拿真回执号，删除 fake helper 该路径
- 可选：External Ref 在 UI 上加点击跳 Tronscan / Etherscan deep link（design §8 of `2026-06-29-account-statement-external-ref-column-design.md` 已 deferred）

## 9. 引用

- [`2026-06-29-account-statement-external-ref-column-design.md`](2026-06-29-account-statement-external-ref-column-design.md) — External Ref 列显化的前置 spec
- [`doc-final/rules/backend-platform.md`](../../rules/backend-platform.md) — backend utility 文件放置约定
- `src/modules/asset-treasury/payouts/errors.ts:5` — referenceNo (BANK-PO for FIAT; txHash for CRYPTO) 业务约定来源
