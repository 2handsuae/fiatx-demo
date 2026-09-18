# Fake External Refs Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 加 1 个集中 helper + 改 4 处 mock/demo/sim 调用点，让 chain txHash / bank ref 视觉真实化 + 确定性可复现。

**Architecture:** 新建 `src/common/utils/fake-external-refs.util.ts` 导出 `fakeChainTxHash(seed)` 和 `fakeBankRef(seed, date)` 两个纯函数（sha256 确定性）。4 处调用点替换原硬编码字符串模板为 helper 调用。验收链路 = TDD unit test + 重 seed + DB regex + preview screenshot。

**Tech Stack:** TypeScript + Node `crypto.createHash` + jest unit test + ts-node scripts + Prisma + admin-web React preview

---

## Task 1: 新建 helper + TDD unit test

**Files:**
- Create: `src/common/utils/fake-external-refs.util.ts`
- Create: `src/common/utils/fake-external-refs.util.spec.ts`

- [ ] **Step 1: 写失败 spec**

文件 `src/common/utils/fake-external-refs.util.spec.ts`：

```typescript
import { fakeChainTxHash, fakeBankRef } from './fake-external-refs.util';

describe('fakeChainTxHash', () => {
  it('returns deterministic 0x + 64 hex chars for same seed', () => {
    const a = fakeChainTxHash('PI2606304273');
    const b = fakeChainTxHash('PI2606304273');
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[a-f0-9]{64}$/);
    expect(a.length).toBe(66);
  });

  it('returns different hash for different seed', () => {
    const a = fakeChainTxHash('PI001');
    const b = fakeChainTxHash('PI002');
    expect(a).not.toBe(b);
  });
});

describe('fakeBankRef', () => {
  it('returns ZB + YYYYMMDD + 10 hex upper for given (seed, date)', () => {
    const ref = fakeBankRef('PI2606304273', '2026-06-29');
    expect(ref).toMatch(/^ZB\d{8}[A-F0-9]{10}$/);
    expect(ref.startsWith('ZB20260629')).toBe(true);
    expect(ref.length).toBe(20);
  });

  it('accepts Date object as 2nd arg', () => {
    const ref = fakeBankRef('PI001', new Date('2026-06-29T12:00:00Z'));
    expect(ref.startsWith('ZB20260629')).toBe(true);
  });

  it('same (seed, date) → same ref (deterministic)', () => {
    const a = fakeBankRef('PI001', '2026-06-29');
    const b = fakeBankRef('PI001', '2026-06-29');
    expect(a).toBe(b);
  });

  it('different namespace prevents collision between chain hash and bank ref', () => {
    // Both use sha256 but with namespace prefix 'tx:' vs 'bank:'
    const chainHex = fakeChainTxHash('SAME-SEED').slice(2); // strip 0x
    const bankHex = fakeBankRef('SAME-SEED', '2026-06-29').slice(-10).toLowerCase();
    expect(chainHex.slice(0, 10)).not.toBe(bankHex);
  });
});
```

- [ ] **Step 2: Run spec, expect FAIL**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/common/utils/fake-external-refs.util.spec.ts
```

Expected: FAIL — module `./fake-external-refs.util` not found.

- [ ] **Step 3: 实现 helper**

文件 `src/common/utils/fake-external-refs.util.ts`：

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

- [ ] **Step 4: Run spec, expect PASS**

```bash
npx jest src/common/utils/fake-external-refs.util.spec.ts
```

Expected: 5/5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/common/utils/fake-external-refs.util.ts src/common/utils/fake-external-refs.util.spec.ts
git commit -m "feat(common): fake external refs helper — deterministic chain hash + bank ref for demo paths"
```

---

## Task 2: 切换 4 处 mock/demo/sim 调用点

**Files:**
- Modify: `scripts/demo-lib.ts:239`
- Modify: `scripts/recon-demo.ts:488-489`
- Modify: `src/modules/funds-layer/adapters/mock-custodian-execution.adapter.ts:8`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts:144`

- [ ] **Step 1: 改 `scripts/demo-lib.ts:239`**

定位行 239 附近 payin txHash 生成块：

```bash
grep -nE "0x\\\${SIM}|fakeChainTxHash" scripts/demo-lib.ts | head -5
```

文件顶部加 import（如果还没有）：

```typescript
import { fakeChainTxHash } from '../src/common/utils/fake-external-refs.util';
```

行 239 替换：

```typescript
// BEFORE:
txHash: type === PayinType.CRYPTO ? `0x${SIM}${idx}USDT` : undefined,
// AFTER:
txHash: type === PayinType.CRYPTO ? fakeChainTxHash(payinNo) : undefined,
```

> 注：`payinNo` 必须在 scope 内。如果生成块里它是别的变量名（例如 `record.payinNo`），按实际名调整。Grep 行 239 上下文确认。

- [ ] **Step 2: 改 `scripts/recon-demo.ts:488-489`**

```bash
grep -nE "0xDEMO|BANK-PO\\\${cutoff" scripts/recon-demo.ts | head -5
```

文件顶部 import 区加：

```typescript
import { fakeChainTxHash, fakeBankRef } from '../src/common/utils/fake-external-refs.util';
```

行 488-489 块替换。看注入逻辑里这两行类似形如：

```typescript
// BEFORE:
const externalRef = isCrypto
  ? `0xDEMO${kind}${injSeq.toString(16).padStart(2, '0')}USDT`
  : `BANK-PO${cutoffDate.replace(/-/g, '')}-${kind}${String(injSeq).padStart(3, '0')}`;
// AFTER:
const externalRef = isCrypto
  ? fakeChainTxHash(`${walletRef}:${kind}:${injSeq}`)
  : fakeBankRef(`${walletRef}:${kind}:${injSeq}`, cutoffDate);
```

> Grep 上下文确认变量名（`isCrypto` / `walletRef` / `kind` / `injSeq` / `cutoffDate`）实际叫什么；按实际名调整。

- [ ] **Step 3: 改 `src/modules/funds-layer/adapters/mock-custodian-execution.adapter.ts:8`**

```bash
grep -nE "0xmock|fakeChainTxHash" src/modules/funds-layer/adapters/mock-custodian-execution.adapter.ts
```

文件顶部 import：

```typescript
import { fakeChainTxHash } from '../../../common/utils/fake-external-refs.util';
```

行 8 区域替换：

```typescript
// BEFORE:
return { txHash: `0xmock${internalFundNo}${randomUUID().slice(0, 8)}` };
// AFTER:
return { txHash: fakeChainTxHash(internalFundNo) };
```

如果文件不再需要 `randomUUID` import，删除该 import 以保持 tsc 清洁（noUnusedLocals）。

- [ ] **Step 4: 改 `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts:144`**

```bash
grep -nE "0xSIM|fakeChainTxHash" src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts
```

文件顶部 import：

```typescript
import { fakeChainTxHash } from '../../../common/utils/fake-external-refs.util';
```

行 144 替换：

```typescript
// BEFORE:
const txHash = body.txHash || `0xSIM${Date.now().toString(16)}`;
// AFTER:
const txHash = body.txHash ?? fakeChainTxHash(`sim:${id ?? Date.now()}`);
```

> `id` 名按实际 controller scope 内变量名调整（可能是 `req.params.id` 或某个 fundNo / withdrawNo）。

- [ ] **Step 5: tsc 编译门**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx tsc --noEmit -p tsconfig.json
```

Expected: 0 errors。

也跑 frontend tsc（如有间接依赖）：

```bash
cd admin-web && npx tsc --noEmit
```

Expected: 0 errors。

- [ ] **Step 6: 跑全部 jest 确认无回归**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest 2>&1 | tail -10
```

Expected: 全 PASS。

- [ ] **Step 7: Commit**

```bash
git add scripts/demo-lib.ts \
        scripts/recon-demo.ts \
        src/modules/funds-layer/adapters/mock-custodian-execution.adapter.ts \
        src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts
git commit -m "feat(demo): switch 4 mock/demo/sim paths to fake-external-refs helper"
```

---

## Task 3: 端到端验收 — 重 build / 重 seed / DB regex / preview

**Files:** 无代码改动

- [ ] **Step 1: Rebuild backend + 重启栈**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npm run build 2>&1 | tail -3
bash /tmp/exchange_js_main/start-stack.sh
sleep 10
```

Expected: nest build 无 error；4 端口 (3000/3001/3002/3003) 全起。

- [ ] **Step 2: 跑 demo:all 重 seed 业务数据**

```bash
npm run main:demo 2>&1 | tail -8
```

Expected: `═══ demo:all DONE ✅` 显示。

- [ ] **Step 3: 跑 recon:demo:pass 让 mirror 数据用新 hash**

```bash
npm run main:recon:pass 2>&1 | tail -5
```

Expected: recon demo 完成（pass-mode FAIL 因 engine matcher 已知 trade-off，不影响 ref 视觉验收）。

- [ ] **Step 4: DB regex 验证 — payins.txHash 是 EVM 格式**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT payinNo, txHash FROM payins WHERE type='CRYPTO' LIMIT 3;"
```

Expected: 每行 txHash 长度 66，匹配 `^0x[a-f0-9]{64}$`。手动 grep 验证：

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT txHash FROM payins WHERE type='CRYPTO';" | while IFS= read -r h; do
  if [[ "$h" =~ ^0x[a-f0-9]{64}$ ]]; then echo "OK $h"; else echo "FAIL $h"; fi
done
```

Expected: 所有行 OK。

- [ ] **Step 5: DB regex 验证 — recon mirror lines 用新格式**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT DISTINCT external_ref FROM external_statement_lines WHERE date(datetime/1000,'unixepoch') >= '2026-06-29' AND external_ref IS NOT NULL LIMIT 10;"
```

Expected: 看到 `0x[a-f0-9]{64}` 格式 hash 或 `ZB20260629[A-F0-9]{10}` 格式 bank ref，**不再有** `0xDEMO1USDT` / `REF-DEMO-1-AED` / `BANK-PO20260629-…001` 串。

- [ ] **Step 6: 复现性测试 — 同 seed 连跑两次出同 hash**

```bash
HASH1=$(node -e "const {fakeChainTxHash}=require('./dist/common/utils/fake-external-refs.util.js'); console.log(fakeChainTxHash('PI2606304273'));")
HASH2=$(node -e "const {fakeChainTxHash}=require('./dist/common/utils/fake-external-refs.util.js'); console.log(fakeChainTxHash('PI2606304273'));")
echo "1: $HASH1"
echo "2: $HASH2"
[ "$HASH1" = "$HASH2" ] && echo "✅ DETERMINISTIC" || echo "❌ NOT DETERMINISTIC"
```

Expected: `✅ DETERMINISTIC`。

- [ ] **Step 7: Preview 视觉验收 — External Balances 详情页**

启 preview server（如还没起）：

```javascript
// preview_eval inside admin preview server:
(async () => {
  const r = await fetch('http://localhost:3000/auth/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email:'admin@fiatx.com',password:'123456'})
  });
  const j = await r.json();
  localStorage.setItem('admin_token', j.access_token);
  localStorage.setItem('admin_user', JSON.stringify(j.user));
  window.location.href = 'http://localhost:3001/admin/reconciliation/external-balances?date=2026-06-29&wallet=WA2601014324';
  return 'go';
})()
```

`preview_screenshot` 截图。判据：DEPOSIT_ASSET_TO_SUSPENSE 行的 External Ref 列显示**真实 64 hex hash**（amber 颜色截断 `0xa3f...` 形式），不再显 `0xDEMO1USDT`。

- [ ] **Step 8: Preview 视觉验收 — AccountStatement 页面**

```javascript
window.location.href = 'http://localhost:3001/admin/ledger/account-statement';
// click into Alice CLIENT_PAYABLE USDT-TRON
```

`preview_screenshot`。判据：External Ref 列 DEPOSIT 行也显真实 hash 格式。

- [ ] **Step 9: 验收报告**

无 commit。汇总 7 步验证结果给 controller，宣告闭环。

---

## Self-Review

**Spec 覆盖（vs §3-§7）**:

| Spec 章节 | 对应 Task / Step |
|---|---|
| §3 Helper 函数（fakeChainTxHash + fakeBankRef） | Task 1 Step 1-3 |
| §4 4 处调用点改造 | Task 2 Step 1-4 |
| §5 不变量（确定性 / 长度 / 不影响产品） | Task 1 spec 5 asserts + Task 2 Step 5 tsc |
| §6 改动量（~40 行 / 5 files / 1 commit logical） | Task 1 (2 files commit) + Task 2 (4 files commit) — 实际 2 commit 而非 1（分关注点） |
| §7 验收 7 项 | Task 3 Step 1-8 |

**Placeholder 扫描**：无 TBD/TODO。每改动 step 给出完整 before/after 代码 + grep 命令辅助 implementer 定位真实变量名。

**Type 一致性**：
- `fakeChainTxHash(seed: string): string` 签名贯穿
- `fakeBankRef(seed: string, date: Date | string): string` 签名贯穿
- import 路径相对各调用文件位置已校算（scripts/ → `../src/common/utils/...`；adapter / controller → `../../../common/utils/...`）

---

## 完整任务清单

- [ ] **Task 1** — 新 helper + TDD unit test（2 files / 1 commit）
- [ ] **Task 2** — 4 处调用点切换 + tsc + jest 回归（4 files / 1 commit）
- [ ] **Task 3** — 端到端验收（rebuild / re-seed / DB regex / preview 截图）

共 **3 任务 / 16 步骤 / 2 commit**。
