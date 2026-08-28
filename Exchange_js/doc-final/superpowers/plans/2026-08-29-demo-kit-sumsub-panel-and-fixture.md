# 演示装备一期 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三域 Sumsub 交易模拟面板按同一张按钮表统一（充值 11 / 提现 11 / 兑换 8），充值提现补上「材料审过 → 订单回炉」这条断掉的边，`demo:all` 改成能造 20 笔各种终态样本并自带答案键的造数器。

**Architecture:** 交易 webhook 只管两件事——驱订单状态机 + 下发材料；材料审核是另一个 webhook（入口已存在，本轮零改动）。按钮表从「三份后端 fixture + 三份前端手抄 = 6 份」收敛成「一份后端真相 + 前端拉取」。造数器从「全 SUCCESS + 全称断言」改成「花名册 + 逐条比对预期」。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle ｜ React(admin-web / client-web) ｜ jest ｜ ts-node 脚本

**Spec:** `doc-final/superpowers/specs/2026-08-29-demo-kit-sumsub-panel-and-fixture-design.md`

## Global Constraints

- **禁做清单**（CLAUDE.md §2）：幂等 / 去重 / 重试回放 / 补偿 repair / 并发锁 / 向后兼容 / 权限加固 / 防御性校验 / 性能优化 / 边界防御 / 改测试框架让测试过 —— 一律不做，发现了记 `doc-final/PRODUCTION-NOTES.md` 一行然后放下
- **铁律**：① 操作必留痕 ② 门不可绕 ③ 各管各的（workflow 只调主体服务方法，不直写别人的表）④ 状态只能沿显式迁移表走 ⑤ 钱动必过账 ⑥ 对外用业务键
- **测试的绿必须来自行为**：禁止「扫源码文本」型断言（`toContain('someString')` 靠注释就能喂饱的那种）
- **随手闸**（每个 Task 收尾必跑）：
  ```
  npx tsc --noEmit -p tsconfig.json
  cd admin-web && npx tsc -b --noEmit && cd ..
  cd client-web && npx tsc -b --noEmit && cd ..
  ```
- **jest 判据**：净新失败 0（跑本任务相关目录即可，命令见各 Task）
- **改了前端必须起 preview 渲染 + 截图**，`tsc` 通过不算数
- **审计动作码是封册的**：`src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts` + 其 `__snapshots__` 快照锁死全册。新增任何动作码必须同步更新快照，否则该 spec 必红
- **数据随时可重铺**：schema / 状态机改动直接按目标终态做，禁止 backfill / 兼容层 / 双写过渡
- **栈命令**：主树 `bash scripts/stack.sh up main`；跑 npm 脚本必须经包装器 `bash scripts/on-stack.sh main <script>`

---

## 文件结构

### 新建

| 路径 | 职责 |
|---|---|
| `src/modules/sumsub-shared/txn-verdict.types.ts` | 三域共用的报文 verdict 类型（`TxnReportVerdict` 从 deposit-sumsub 迁来） |
| `src/modules/sumsub-shared/txn-report.builder.ts` | 报文生成器（从 deposit-sumsub 迁来） |
| `src/modules/sumsub-shared/kyt-webhook-types.ts` | webhook 类型常量（从 deposit-sumsub 迁来） |
| `src/modules/sumsub-shared/scene-tags.ts` | `SceneTag` 四值 + `SCENE_TAG_PRIORITY` 四档（三域共用） |
| `src/modules/sumsub-shared/verdict-buttons.shared.ts` | 充值 + 提现共用的 11 个按钮表（⑩ 按域取 tag） |
| `src/modules/sumsub-shared/sumsub-shared.module.ts` | 上述件的 Nest 模块 |
| `admin-web/src/hooks/useVerdictButtons.ts` | 前端按钮清单拉取（取代三份手抄常量） |
| `admin-web/src/components/SimulationPanel.tsx` | ⚡ 面板共享组件（按「引擎/人」分两组渲染） |
| `scripts/demo-roster.ts` | 花名册常量表 + 答案键打印 |

### 修改

| 路径 | 改什么 |
|---|---|
| `src/modules/deposit-sumsub/fixtures/verdict-buttons.ts` | 改为从共享表取，只保留充值域 ⑩ 的 tag 值 |
| `src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts` | 同上，⑩ 的 tag 改 `FINAL_REJECTED` |
| `src/modules/swap-sumsub/fixtures/verdict-buttons.ts` | 删旧 ②③⑦⑧、加 ③⑤⑨⑪、报文补齐四字段、重编号 |
| `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts` | `SceneTag` 改引共享四值；`SCENE_TAG_PRIORITY` 四档 |
| `src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.ts` | 同上 + `DISPO_TAGS` 的 `REJECT_REFUND` → `FINAL_REJECTED` |
| `src/modules/swap-sumsub/swap-kyt-verdict.handler.ts` | 新增读 `SCENE_TAGS` / `DISPO_TAGS` |
| `src/modules/swap-sumsub/demo-scenario.service.ts` | 删 `runApplicantActionScenario` 分支 |
| `src/modules/swap-sumsub/admin-swap-demo.controller.ts` | 新增 `GET demo/verdict-buttons` |
| `src/modules/deposit-sumsub/admin-deposit-demo.controller.ts` | 同上 |
| `src/modules/withdraw-sumsub/admin-withdraw-demo.controller.ts` | 同上 |
| `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | `DepositApplicantActionsService` 侧：便签按档决定 restrict |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | 新增 `@OnEvent(MATERIAL_REQUEST_REVIEWED)` 回炉 |
| `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` | 转移表补 `ACTION_PENDING --RESUME--> COMPLIANCE_PENDING` |
| `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` | 新增 `@OnEvent(MATERIAL_REQUEST_REVIEWED)` 回炉 |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | V4/V5 名册各加 1 码 |
| `src/modules/audit-logging/constants/__snapshots__/audit-vocabulary-closure.spec.ts.snap` | 同步快照 |
| `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx` | 删手抄常量、改用 `useVerdictButtons` + `SimulationPanel` |
| `scripts/demo-lib.ts` | `verifyEndState` 改花名册比对；造数按花名册铺 |
| `scripts/demo-in-transit.ts` | 并入花名册第 20 行 |
| `doc-final/demo/data.md` | 改为脚本生成 |
| `doc-final/demo/baseline.md` | `demo:all` 判据文字换成「花名册逐条符合预期」 |

### 删除

| 路径 | 为什么 |
|---|---|
| `src/modules/deposit-sumsub/sumsub-txn-client.*`（迁移非删除） | 迁到 `sumsub-shared/`，原路径留 re-export 会掩盖依赖方向问题 → **直接迁，改所有 import** |

---

# 阶段 A · 三域按钮表统一

## Task A1: 建 `sumsub-shared` 中立模块，把共享件从 `deposit-sumsub` 迁出

**为什么**：现在 `withdraw-sumsub` 和 `swap-sumsub` 都 `import '../deposit-sumsub/...'`，两个平级域反向依赖第三个域。共享件必须住中立处。

**Files:**
- Create: `src/modules/sumsub-shared/kyt-webhook-types.ts`
- Create: `src/modules/sumsub-shared/txn-verdict.types.ts`
- Create: `src/modules/sumsub-shared/txn-report.builder.ts`
- Create: `src/modules/sumsub-shared/sumsub-txn-client.interface.ts`
- Create: `src/modules/sumsub-shared/sumsub-txn-client.http.ts`
- Create: `src/modules/sumsub-shared/sumsub-txn-client.mock.ts`
- Create: `src/modules/sumsub-shared/sumsub-txn.types.ts`
- Create: `src/modules/sumsub-shared/sumsub-txn-client.module.ts`
- Modify: 所有 `import ... from '../deposit-sumsub/...'` 与 `'./sumsub-txn-client...'` 的引用点

**Interfaces:**
- Produces: `TxnReportVerdict`、`buildTxnReport()`、`KYT_ONHOLD_TYPE`、`KYT_VERDICT_TYPES`、`SUMSUB_TXN_CLIENT`、`SumsubTxnClient`、`MockSumsubTxnClient`、`SumsubTxnClientModule` —— 后续所有 Task 从 `sumsub-shared` 取这些

- [ ] **Step 1: 列出所有引用点，确认迁移面**

```bash
cd Exchange_js
grep -rn "deposit-sumsub/kyt-webhook-types\|deposit-sumsub/sumsub-txn\|deposit-sumsub/fixtures/txn-report" src/ | grep -v node_modules
grep -rn "from './sumsub-txn-client\|from './kyt-webhook-types\|from './fixtures/txn-report" src/modules/deposit-sumsub/
```

期望：列出 withdraw/swap 侧约 12 处跨域引用 + deposit 自身约 8 处同目录引用。**把输出贴进 commit message**，作为迁移完整性的凭据。

- [ ] **Step 2: `git mv` 七个文件到新目录**

```bash
mkdir -p src/modules/sumsub-shared
git mv src/modules/deposit-sumsub/kyt-webhook-types.ts               src/modules/sumsub-shared/
git mv src/modules/deposit-sumsub/sumsub-txn-client.interface.ts     src/modules/sumsub-shared/
git mv src/modules/deposit-sumsub/sumsub-txn-client.http.ts          src/modules/sumsub-shared/
git mv src/modules/deposit-sumsub/sumsub-txn-client.mock.ts          src/modules/sumsub-shared/
git mv src/modules/deposit-sumsub/sumsub-txn.types.ts                src/modules/sumsub-shared/
git mv src/modules/deposit-sumsub/sumsub-txn-client.module.ts        src/modules/sumsub-shared/
git mv src/modules/deposit-sumsub/fixtures/txn-report.builder.ts     src/modules/sumsub-shared/
git mv src/modules/deposit-sumsub/sumsub-txn-client.mock.spec.ts     src/modules/sumsub-shared/
```

- [ ] **Step 3: 批量改 import 路径**

```bash
# 跨域引用：'../deposit-sumsub/X' → '../sumsub-shared/X'
grep -rl "deposit-sumsub/kyt-webhook-types\|deposit-sumsub/sumsub-txn\|deposit-sumsub/fixtures/txn-report.builder" src/ \
  | xargs sed -i '' \
    -e "s#\.\./deposit-sumsub/kyt-webhook-types#../sumsub-shared/kyt-webhook-types#g" \
    -e "s#\.\./deposit-sumsub/sumsub-txn-client#../sumsub-shared/sumsub-txn-client#g" \
    -e "s#\.\./deposit-sumsub/sumsub-txn\.types#../sumsub-shared/sumsub-txn.types#g" \
    -e "s#\.\./deposit-sumsub/fixtures/txn-report\.builder#../sumsub-shared/txn-report.builder#g"

# deposit 自身的同目录引用 → '../sumsub-shared/X'
grep -rl "from './sumsub-txn-client\|from './kyt-webhook-types\|from './sumsub-txn.types\|from './fixtures/txn-report.builder" src/modules/deposit-sumsub/ \
  | xargs sed -i '' \
    -e "s#from '\./sumsub-txn-client#from '../sumsub-shared/sumsub-txn-client#g" \
    -e "s#from '\./kyt-webhook-types#from '../sumsub-shared/kyt-webhook-types#g" \
    -e "s#from '\./sumsub-txn\.types#from '../sumsub-shared/sumsub-txn.types#g" \
    -e "s#from '\./fixtures/txn-report\.builder#from '../sumsub-shared/txn-report.builder#g"

# fixtures 目录下的相对层级：'../kyt-webhook-types' → '../../sumsub-shared/kyt-webhook-types'
sed -i '' -e "s#from '\.\./kyt-webhook-types#from '../../sumsub-shared/kyt-webhook-types#g" \
          -e "s#from '\./txn-report\.builder#from '../../sumsub-shared/txn-report.builder#g" \
  src/modules/deposit-sumsub/fixtures/*.ts
```

- [ ] **Step 4: 建模块文件并接进各域**

`src/modules/sumsub-shared/sumsub-shared.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { SumsubTxnClientModule } from './sumsub-txn-client.module';

/**
 * 三域（充值/提现/兑换）共用的 Sumsub 底座：报文类型、报文生成器、
 * webhook 类型常量、交易客户端。
 *
 * 2026-08-29 从 deposit-sumsub 迁出——此前 withdraw/swap 两个平级域
 * 反向 import 充值域，充值域事实上成了三域的老大。
 */
@Module({
  imports: [SumsubTxnClientModule],
  exports: [SumsubTxnClientModule],
})
export class SumsubSharedModule {}
```

- [ ] **Step 5: 跑闸门验证零行为改动**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/deposit-sumsub src/modules/withdraw-sumsub src/modules/swap-sumsub src/modules/sumsub-shared
```

期望：tsc 0 错；jest 与迁移前**同样的通过数**（本 Task 是纯搬家，一个用例的结果都不该变）。迁移前先跑一次记下基线数字。

- [ ] **Step 6: Commit**

```bash
git add -A src/modules/
git commit -m "refactor(sumsub): 共享底座从 deposit-sumsub 迁到中立的 sumsub-shared

withdraw/swap 两个平级域此前反向 import 充值域（12 处），充值域事实上
成了三域老大。迁出 7 个文件 + 1 个 spec，纯搬家零行为改动，jest 通过数
与迁移前一致。"
```

---

## Task A2: 建共享按钮表（充值 + 提现合一），含删⑨、拆 PEP、⑩ 改名、重编号

**为什么**：充值与提现两份 `verdict-buttons.ts` 各 195 行，去注释去 import 后**实质只差 1 个按钮**（⑥ 的 label 与 tag）。

**Files:**
- Create: `src/modules/sumsub-shared/scene-tags.ts`
- Create: `src/modules/sumsub-shared/verdict-buttons.shared.ts`
- Create: `src/modules/sumsub-shared/verdict-buttons.shared.spec.ts`
- Modify: `src/modules/deposit-sumsub/fixtures/verdict-buttons.ts`（改为薄壳）
- Modify: `src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts`（改为薄壳）

**Interfaces:**
- Consumes: A1 的 `TxnReportVerdict`、`KYT_ONHOLD_TYPE`
- Produces: `SceneTag`（四值）、`SCENE_TAG_PRIORITY`、`buildOrderVerdictButtons(domain: 'DEPOSIT' | 'WITHDRAW')` → `Record<string, OrderVerdictButton>`；`OrderVerdictButton = { key: string; label: string; webhookType: string; source: 'ENGINE' | 'OFFICER'; verdict: TxnReportVerdict }`

- [ ] **Step 1: 写失败测试**

`src/modules/sumsub-shared/verdict-buttons.shared.spec.ts`：

```typescript
import { buildOrderVerdictButtons } from './verdict-buttons.shared';

describe('buildOrderVerdictButtons', () => {
  const dep = buildOrderVerdictButtons('DEPOSIT');
  const wd = buildOrderVerdictButtons('WITHDRAW');

  it('两域各 11 个按钮，键集合完全一致', () => {
    expect(Object.keys(dep)).toHaveLength(11);
    expect(Object.keys(wd).sort()).toEqual(Object.keys(dep).sort());
  });

  it('两域唯一的差异是 ⑩ 的处置 tag', () => {
    const tagOf = (b: any) => (b.verdict.typedTags ?? []).map((t: any) => t.label).sort();
    for (const key of Object.keys(dep)) {
      if (key === 'V10_REJECTED_DISPOSITION') continue;
      expect({ key, tags: tagOf(wd[key]) }).toEqual({ key, tags: tagOf(dep[key]) });
    }
    expect(tagOf(dep.V10_REJECTED_DISPOSITION)).toEqual(['RETURN_TO_SENDER']);
    expect(tagOf(wd.V10_REJECTED_DISPOSITION)).toEqual(['FINAL_REJECTED']);
  });

  it('PEP 已分主体，且没有未分主体的裸 PEP', () => {
    const allTags = Object.values(dep).flatMap((b: any) =>
      (b.verdict.typedTags ?? []).map((t: any) => t.label));
    expect(allTags).toContain('PEP_APPLICANT');
    expect(allTags).toContain('PEP_COUNTERPARTY');
    expect(allTags).not.toContain('PEP');
  });

  it('SLA breach 按钮已删除（真 SLA 走 simulate-sla-timeout 端点）', () => {
    const labels = Object.values(dep).map((b: any) => b.label);
    expect(labels.some((l) => /SLA/i.test(l))).toBe(false);
  });

  it('每个按钮标了是引擎打的还是合规官手工打的', () => {
    for (const b of Object.values(dep) as any[]) {
      expect(['ENGINE', 'OFFICER']).toContain(b.source);
    }
    expect(dep.V9_REJECTED_MLRO_FREEZE.source).toBe('OFFICER');
    expect(dep.V10_REJECTED_DISPOSITION.source).toBe('OFFICER');
    expect(dep.V1_APPROVED.source).toBe('ENGINE');
  });

  it('awaitUser 档按 SOF/PEP 决定挂订单还是挂客户', () => {
    expect(dep.V2_AWAIT_USER.restrictCustomer).toBe(false);
    expect(dep.V5_AWAIT_USER_MULTI.restrictCustomer).toBe(false);
    expect(dep.V3_AWAIT_USER_PEP_APPLICANT.restrictCustomer).toBe(true);
    expect(dep.V4_AWAIT_USER_PEP_COUNTERPARTY.restrictCustomer).toBe(true);
  });

  it('每个 awaitUser 按钮每次读 applicantActions 都拿到新的 externalActionId', () => {
    const a = (dep.V2_AWAIT_USER.verdict as any).applicantActions[0].externalActionId;
    const b = (dep.V2_AWAIT_USER.verdict as any).applicantActions[0].externalActionId;
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/sumsub-shared/verdict-buttons.shared.spec.ts
```

期望：FAIL — `Cannot find module './verdict-buttons.shared'`

- [ ] **Step 3: 写 `scene-tags.ts`**

```typescript
/**
 * 场景 tag —— Sumsub 规则引擎自动打的，说的是「命中了什么」。
 *
 * 2026-08-29：PEP 分主体，补上 2026-08-20「制裁命中分主体」漏掉的对称性
 * （当时把 SANCTION 拆成 APPLICANT/COUNTERPARTY，PEP 没跟上）。
 */
export type SceneTag =
  | 'SANCTION_APPLICANT'
  | 'SANCTION_COUNTERPARTY'
  | 'PEP_APPLICANT'
  | 'PEP_COUNTERPARTY';

export const SCENE_TAGS = new Set<SceneTag>([
  'SANCTION_APPLICANT',
  'SANCTION_COUNTERPARTY',
  'PEP_APPLICANT',
  'PEP_COUNTERPARTY',
]);

/**
 * 显式优先序。sceneTag 是标量、循环里后写覆盖先写，不定优先级的话哪个生效
 * 取决于 Sumsub 报文里 typedTags 的先后顺序 —— 同一笔「对手方受制裁 + 客户是
 * PEP」的交易会时而冻单时而落人工复核，且无任何日志。
 * 收紧方向优先：漏冻的代价远大于多冻一次。
 */
export const SCENE_TAG_PRIORITY: Record<SceneTag, number> = {
  SANCTION_APPLICANT: 4,
  SANCTION_COUNTERPARTY: 3,
  PEP_APPLICANT: 2,
  PEP_COUNTERPARTY: 1,
};

/** 处置 tag —— 合规官/MLRO 在 Sumsub 审核台上手工打的，说的是「该怎么办」。 */
export type DispoTag = 'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER' | 'FINAL_REJECTED';

export const DISPO_TAGS_BY_DOMAIN: Record<'DEPOSIT' | 'WITHDRAW', ReadonlySet<DispoTag>> = {
  DEPOSIT: new Set<DispoTag>(['FROZEN_BY_MLRO', 'RETURN_TO_SENDER']),
  WITHDRAW: new Set<DispoTag>(['FROZEN_BY_MLRO', 'FINAL_REJECTED']),
};
```

- [ ] **Step 4: 写 `verdict-buttons.shared.ts`**

```typescript
import { randomUUID } from 'crypto';
import { KYT_ONHOLD_TYPE } from './kyt-webhook-types';
import type { TxnReportVerdict } from './txn-report.builder';

export type ButtonSource = 'ENGINE' | 'OFFICER';
export type OrderDomain = 'DEPOSIT' | 'WITHDRAW';

export interface OrderVerdictButton {
  key: string;
  label: string;
  webhookType: string;
  /** ENGINE = Sumsub 规则引擎自动命中；OFFICER = 合规官在 Sumsub 台上手工处置。面板据此分两组。 */
  source: ButtonSource;
  /** awaitUser 档专用：true = 开客户级便签；false = 只挂订单（提醒型材料请求）。 */
  restrictCustomer?: boolean;
  verdict: TxnReportVerdict;
}

const RULE = (id: string, name: string, score: number, action: string, title: string) => ({
  id, name, revision: 1, title, score, dryRun: false, action,
});
const TAG = (label: string) => ({ label, type: 'userDefined' as const });

/**
 * getter 而非固定字面量：材料请求账的 externalActionId 是全表 @unique
 * （不像旧子表按 (订单id, seq) 分段去重），固定字面量会在两笔不同订单先后
 * 点同一个按钮时 P2002。现铸也更贴近真实 Sumsub —— 每次建 action 都发新 id。
 */
const action = (prefix: string) => ({
  applicantActionId: `aa-${prefix}-${randomUUID()}`,
  externalActionId: `EXT-${prefix.toUpperCase()}-${randomUUID()}`,
});

/** ⑩ 处置标签在两域的取值：充值退回原发款方，提现最终拒付。 */
const DISPOSITION_TAG: Record<OrderDomain, string> = {
  DEPOSIT: 'RETURN_TO_SENDER',
  WITHDRAW: 'FINAL_REJECTED',
};
const DISPOSITION_TITLE: Record<OrderDomain, string> = {
  DEPOSIT: 'MLRO disposition: return funds to the originating account.',
  WITHDRAW: 'Officer disposition: final rejection, funds released back to the customer balance.',
};

export function buildOrderVerdictButtons(
  domain: OrderDomain,
): Record<string, OrderVerdictButton> {
  return {
    V1_APPROVED: {
      key: 'V1_APPROVED', label: '① Approved',
      webhookType: 'applicantKytTxnApproved', source: 'ENGINE',
      verdict: { reviewStatus: 'completed', reviewAnswer: 'GREEN', action: 'score', score: 5 },
    },

    V2_AWAIT_USER: {
      key: 'V2_AWAIT_USER', label: '② Awaiting user',
      webhookType: 'applicantKytTxnAwaitingUser', source: 'ENGINE',
      restrictCustomer: false,
      verdict: {
        reviewStatus: 'awaitingUser', reviewAnswer: null, action: 'awaitUser', score: 40,
        matchedRules: [RULE('KYC7', 'Source of funds unclear', 40, 'awaitUser',
          'Additional information required from the applicant.')],
        get applicantActions() { return [action('sof')]; },
      },
    },

    V3_AWAIT_USER_PEP_APPLICANT: {
      key: 'V3_AWAIT_USER_PEP_APPLICANT', label: '③ Awaiting user · PEP（客户本人）',
      webhookType: 'applicantKytTxnAwaitingUser', source: 'ENGINE',
      restrictCustomer: true,
      verdict: {
        reviewStatus: 'awaitingUser', reviewAnswer: null, action: 'awaitUser', score: 62,
        matchedRules: [RULE('AML4', 'PEP match (applicant)', 62, 'awaitUser',
          'The customer themselves is a politically exposed person — enhanced due diligence documents required.')],
        typedTags: [TAG('PEP_APPLICANT')],
        get applicantActions() { return [action('edd')]; },
      },
    },

    V4_AWAIT_USER_PEP_COUNTERPARTY: {
      key: 'V4_AWAIT_USER_PEP_COUNTERPARTY', label: '④ Awaiting user · PEP（对手方）',
      webhookType: 'applicantKytTxnAwaitingUser', source: 'ENGINE',
      restrictCustomer: true,
      verdict: {
        reviewStatus: 'awaitingUser', reviewAnswer: null, action: 'awaitUser', score: 58,
        matchedRules: [RULE('AML4', 'PEP match (counterparty)', 58, 'awaitUser',
          'The counterparty is a politically exposed person — enhanced due diligence documents required.')],
        typedTags: [TAG('PEP_COUNTERPARTY')],
        get applicantActions() { return [action('edd-cp')]; },
      },
    },

    V5_AWAIT_USER_MULTI: {
      key: 'V5_AWAIT_USER_MULTI', label: '⑤ Awaiting user · 多条',
      webhookType: 'applicantKytTxnAwaitingUser', source: 'ENGINE',
      restrictCustomer: false,
      verdict: {
        reviewStatus: 'awaitingUser', reviewAnswer: null, action: 'awaitUser', score: 45,
        matchedRules: [RULE('KYC9', 'Multiple documents required', 45, 'awaitUser',
          'Several items required from the applicant.')],
        get applicantActions() { return [action('multi-1'), action('multi-2'), action('multi-3')]; },
      },
    },

    V6_ONHOLD: {
      key: 'V6_ONHOLD', label: '⑥ On hold',
      webhookType: KYT_ONHOLD_TYPE, source: 'ENGINE',
      verdict: {
        reviewStatus: 'onHold', reviewAnswer: null, action: 'onHold', score: 55,
        matchedRules: [RULE('AML12', 'Manual review threshold', 55, 'onHold',
          'Queued for manual officer review.')],
      },
    },

    V7_REJECTED_SANCTION_APPLICANT: {
      key: 'V7_REJECTED_SANCTION_APPLICANT', label: '⑦ Rejected · Sanctions（客户本人）',
      webhookType: 'applicantKytTxnRejected', source: 'ENGINE',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 98,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML1', 'Sanctions match (applicant)', 98, 'reject',
          'The customer themselves matches an OFAC SDN sanctions list entry.')],
        typedTags: [TAG('SANCTION_APPLICANT')],
      },
    },

    V8_REJECTED_SANCTION_COUNTERPARTY: {
      key: 'V8_REJECTED_SANCTION_COUNTERPARTY', label: '⑧ Rejected · Sanctions（对手方）',
      webhookType: 'applicantKytTxnRejected', source: 'ENGINE',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 98,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML1', 'Sanctions match (counterparty)', 98, 'reject',
          'Counterparty address matches an OFAC SDN sanctions list entry.')],
        typedTags: [TAG('SANCTION_COUNTERPARTY')],
      },
    },

    V9_REJECTED_MLRO_FREEZE: {
      key: 'V9_REJECTED_MLRO_FREEZE', label: '⑨ Rejected · MLRO freeze',
      webhookType: 'applicantKytTxnRejected', source: 'OFFICER',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 84,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML9', 'High-risk transaction pattern', 84, 'reject',
          'MLRO disposition: freeze pending investigation.')],
        typedTags: [TAG('FROZEN_BY_MLRO')],
      },
    },

    V10_REJECTED_DISPOSITION: {
      key: 'V10_REJECTED_DISPOSITION',
      label: domain === 'DEPOSIT' ? '⑩ Rejected · MLRO return' : '⑩ Rejected · Final rejected',
      webhookType: 'applicantKytTxnRejected', source: 'OFFICER',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 79,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML9', 'High-risk transaction pattern', 79, 'reject',
          DISPOSITION_TITLE[domain])],
        typedTags: [TAG(DISPOSITION_TAG[domain])],
      },
    },

    V11_REJECTED_NO_TAG: {
      key: 'V11_REJECTED_NO_TAG', label: '⑪ Rejected · no disposition tag',
      webhookType: 'applicantKytTxnRejected', source: 'ENGINE',
      verdict: {
        reviewStatus: 'completed', reviewAnswer: 'RED', action: 'reject', score: 71,
        reviewRejectType: 'FINAL',
        matchedRules: [RULE('AML9', 'High-risk transaction pattern', 71, 'reject',
          'Risk threshold exceeded — awaiting officer disposition.')],
      },
    },
  };
}
```

- [ ] **Step 5: 两域 fixture 改成薄壳**

`src/modules/deposit-sumsub/fixtures/verdict-buttons.ts` 整个文件替换为：

```typescript
import { buildOrderVerdictButtons, type OrderVerdictButton } from '../../sumsub-shared/verdict-buttons.shared';

/**
 * 充值域裁决按钮 —— 表本身住在 sumsub-shared（2026-08-29 合并，此前充值与提现
 * 各一份 195 行，去注释去 import 后实质只差 ⑩ 一个按钮）。
 * 本域与提现域的唯一差异：⑩ 的处置 tag = RETURN_TO_SENDER（提现是 FINAL_REJECTED）。
 */
export type DepositVerdictButton = OrderVerdictButton;
export const DEPOSIT_VERDICT_BUTTONS = buildOrderVerdictButtons('DEPOSIT');
```

`src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts` 同款，改 `'WITHDRAW'` 与 `WITHDRAW_VERDICT_BUTTONS` / `WithdrawVerdictButton`。

- [ ] **Step 6: 跑测试**

```bash
npx jest src/modules/sumsub-shared/verdict-buttons.shared.spec.ts
```

期望：6 个用例全 PASS。

- [ ] **Step 7: 跑随手闸 + 相关 jest**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/deposit-sumsub src/modules/withdraw-sumsub src/modules/sumsub-shared
```

**预期会有失败**：旧 key（`V4B_...`、`V9_REJECTED_SLA` 等）在 handler / demo-scenario 的 spec 里还被引用。这些在 Task A3 修。本 Step 只需确认失败**都是 key 改名引起的**，没有别的。把失败清单贴进 commit message。

- [ ] **Step 8: Commit**

```bash
git add src/modules/sumsub-shared src/modules/deposit-sumsub/fixtures src/modules/withdraw-sumsub/fixtures
git commit -m "feat(sumsub): 充值+提现按钮表合并成一份共享表，11 码统一

- 删 ⑨ SLA breach（假货：只投报文，与真 SLA 定时器取证痕迹对不上；
  三域各有真的 POST :no/simulate-sla-timeout 端点）
- PEP 分主体 PEP_APPLICANT / PEP_COUNTERPARTY（补 2026-08-20 那批的对称性）
- 提现 ⑩ REJECT_REFUND → FINAL_REJECTED
- 重编号 ①..⑪，三域同码同义（解「圈码三域错位」）
- 每个按钮标 source: ENGINE(引擎自动命中) / OFFICER(合规官手工处置)
- awaitUser 档标 restrictCustomer：SOF 只挂订单、PEP 挂客户

handler 侧的 key 引用在下一个 commit 跟上。"
```

---

## Task A3: 充值/提现 handler 跟上新 tag 与新 key

**Files:**
- Modify: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts`
- Modify: `src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（`dispoTag` 类型）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（`dispoTag` 类型）
- Modify: 上述四个文件的 `.spec.ts`

**Interfaces:**
- Consumes: A2 的 `SceneTag`、`SCENE_TAGS`、`SCENE_TAG_PRIORITY`、`DispoTag`、`DISPO_TAGS_BY_DOMAIN`

- [ ] **Step 1: 写失败测试（优先级四档）**

追加到 `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts`：

```typescript
describe('SceneTag 优先级（四档，收紧优先）', () => {
  const cases: Array<[string[], string]> = [
    [['PEP_COUNTERPARTY', 'PEP_APPLICANT'], 'PEP_APPLICANT'],
    [['PEP_APPLICANT', 'SANCTION_COUNTERPARTY'], 'SANCTION_COUNTERPARTY'],
    [['SANCTION_COUNTERPARTY', 'SANCTION_APPLICANT'], 'SANCTION_APPLICANT'],
    [['SANCTION_APPLICANT', 'PEP_COUNTERPARTY'], 'SANCTION_APPLICANT'],
  ];

  it.each(cases)('typedTags=%j → sceneTag=%s（与报文顺序无关）', async (tags, expected) => {
    // 正序
    const forward = await runHandlerWithTags(tags);
    // 逆序：同一组 tag 反着投，结论必须一样
    const reversed = await runHandlerWithTags([...tags].reverse());
    expect(forward.sceneTag).toBe(expected);
    expect(reversed.sceneTag).toBe(expected);
  });
});
```

> `runHandlerWithTags` 是本 spec 已有的驱动辅助（构造 mock txn detail → 调 handler → 捕获传给 `workflow.applyKytVerdict` 的参数）。若现有 spec 里的辅助函数名不同，沿用现有那个，**不要新造**。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts -t 'SceneTag 优先级'
```

期望：FAIL —— 现有实现里 `PEP_APPLICANT` 不在 `SCENE_TAGS` 集合中，`sceneTag` 为 `undefined`。

- [ ] **Step 3: 改充值 handler**

删掉 `deposit-kyt-verdict.handler.ts` 里本地的这三行定义：

```typescript
export type SceneTag = 'SANCTION_APPLICANT' | 'SANCTION_COUNTERPARTY' | 'PEP';
const SCENE_TAGS = new Set<SceneTag>([...]);
const SCENE_TAG_PRIORITY: Record<SceneTag, number> = {...};
const DISPO_TAGS = new Set(['FROZEN_BY_MLRO', 'RETURN_TO_SENDER']);
```

替换为：

```typescript
import {
  SCENE_TAGS, SCENE_TAG_PRIORITY, DISPO_TAGS_BY_DOMAIN,
  type SceneTag, type DispoTag,
} from '../sumsub-shared/scene-tags';

export type { SceneTag };
const DISPO_TAGS = DISPO_TAGS_BY_DOMAIN.DEPOSIT;
```

再把方法体里的两处 `dispoTag` 类型标注从字面量联合改为 `DispoTag`：

```typescript
let dispoTag: DispoTag | undefined;
// ...
if (DISPO_TAGS.has(tag.label as DispoTag)) dispoTag = tag.label as DispoTag;
```

- [ ] **Step 4: 改提现 handler（同款 + 改名）**

同 Step 3，但 `const DISPO_TAGS = DISPO_TAGS_BY_DOMAIN.WITHDRAW;`。然后全文件搜 `REJECT_REFUND` 换 `FINAL_REJECTED`：

```bash
grep -rn "REJECT_REFUND" src/modules/withdraw-sumsub/ src/modules/trading/withdraw-transactions/
```

**注意**：`WithdrawTransactionAction.REJECT_REFUND` 是**状态机动作码**，与处置 tag 同名但不是一回事——**动作码不改**，只改 tag 字面量。逐个 hit 判断后再改。

- [ ] **Step 5: 两个 workflow 的 `dispoTag` 类型跟上**

`deposit-workflow.service.ts` 三处（约 L515 / L647 / L907）：`'FROZEN_BY_MLRO' | 'RETURN_TO_SENDER'` → `DispoTag`，import 自 `sumsub-shared/scene-tags`。提现侧同理。

- [ ] **Step 6: 修 spec 里的旧 key 引用**

```bash
grep -rln "V4B_REJECTED_SANCTION_COUNTERPARTY\|V9_REJECTED_SLA\|V5_REJECTED_FROZEN_MLRO\|V6_REJECTED_RETURN\|V6_REJECTED_REFUND_TAG\|V7_REJECTED_NO_TAG\|V3_AWAIT_USER_PEP\|V10_AWAIT_USER_MULTI" src/ test/
```

按 Task A2 的新 key 逐个替换（映射表见 A2 Step 4 的代码）。`V9_REJECTED_SLA` 相关用例**整个删除**——该按钮已不存在，SLA 超时改由 `simulate-sla-timeout` 端点驱动，其行为在 `*-sla.service.spec.ts` 已有覆盖。

- [ ] **Step 7: 跑闸门**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/deposit-sumsub src/modules/withdraw-sumsub src/modules/sumsub-shared src/modules/trading
```

期望：全绿（净新失败 0）。

- [ ] **Step 8: Commit**

```bash
git add src/modules/
git commit -m "feat(sumsub): 充值/提现 handler 跟上四档 SceneTag 与 FINAL_REJECTED

- SceneTag/SCENE_TAG_PRIORITY/DISPO_TAGS 上收到 sumsub-shared/scene-tags
- 优先级四档：SANCTION_APPLICANT 4 > SANCTION_COUNTERPARTY 3 >
  PEP_APPLICANT 2 > PEP_COUNTERPARTY 1（沿用「收紧优先」原则）
- 新增行为测试：同一组 tag 正投逆投结论一致，不随报文顺序漂移
- 提现处置 tag REJECT_REFUND → FINAL_REJECTED（状态机动作码 REJECT_REFUND 不动）
- 删 V9_REJECTED_SLA 相关用例（按钮已删，SLA 由 simulate-sla-timeout 覆盖）"
```

---

## Task A4: 便签挂谁由 tag 决定（SOF 只挂订单 / PEP 挂客户）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-applicant-actions.service.ts`
- Test: 两者的 `.spec.ts`

> 若上述文件名不存在，用 `grep -rn "syncApplicantActions" src/ | grep -v spec` 定位真实落点。

**Interfaces:**
- Consumes: A2 的 `OrderVerdictButton.restrictCustomer`；`sceneTag`（A3 传下来的）

- [ ] **Step 1: 写失败测试**

```typescript
describe('便签挂谁由 tag 决定', () => {
  it('普通 SOF 补料（无 sceneTag）→ 材料请求不带 restrictionNo，客户不受限', async () => {
    await service.syncApplicantActions(depositId, [{ applicantActionId: 'a', externalActionId: 'e1' }], undefined);
    const row = await prisma.materialRequest.findFirst({ where: { externalActionId: 'e1' } });
    expect(row.restrictionNo).toBeNull();
    const open = await prisma.customerRestriction.count({
      where: { customerId, cause: 'PENDING_DOCUMENT', status: 'OPEN' },
    });
    expect(open).toBe(0);
  });

  it('PEP 补料（sceneTag=PEP_APPLICANT）→ 开客户级便签，scope 含 WITHDRAW+SWAP', async () => {
    await service.syncApplicantActions(depositId, [{ applicantActionId: 'b', externalActionId: 'e2' }], 'PEP_APPLICANT');
    const row = await prisma.materialRequest.findFirst({ where: { externalActionId: 'e2' } });
    expect(row.restrictionNo).not.toBeNull();
    const scopes = await prisma.customerRestriction.findMany({
      where: { restrictionNo: row.restrictionNo }, select: { scope: true },
    });
    expect(scopes.map((s) => s.scope).sort()).toEqual(['SWAP', 'WITHDRAW']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions -t '便签挂谁由 tag 决定'
```

期望：第一个用例 FAIL —— 现在 `restrict` 恒为 `true`，`restrictionNo` 不为 null。

- [ ] **Step 3: 实现**

`syncApplicantActions` 签名加第三个参数，`issuer.register` 的 `restrict` 改为按 sceneTag 派生：

```typescript
async syncApplicantActions(
  depositId: string,
  actions: { applicantActionId: string; externalActionId: string }[],
  sceneTag?: SceneTag,
) {
  // SOF（无 sceneTag）问的是「这笔钱哪来的」= 交易层的事 → 只挂订单，成提醒型材料请求。
  // PEP 问的是「这个人是不是政治人物」= 人身层的事 → 才配开客户级便签。
  // 业主 2026-08-29 口径，见 spec §2.6(5)。
  const restrict = sceneTag === 'PEP_APPLICANT' || sceneTag === 'PEP_COUNTERPARTY';
  // ... issuer.register({ restrict, ... })
}
```

调用方（`deposit-workflow.service.ts` 的 `applyKytAwaitUser`）把 `v.sceneTag` 透传进来。

- [ ] **Step 4: 跑测试**

```bash
npx jest src/modules/trading/deposit-transactions src/modules/trading/withdraw-transactions
```

期望：两个新用例 PASS，其余净新失败 0。

- [ ] **Step 5: 跑随手闸并 commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/trading
git commit -m "feat(compliance): 补料便签挂谁由 tag 决定——SOF 只挂订单、PEP 挂客户

业主 2026-08-29 口径：普通 awaiting user（SOF，问「这笔钱哪来的」）是交易
层的事，只挂订单成提醒型材料请求；PEP（问「这个人是不是政治人物」）是人身
层的事，才开客户级便签。PENDING_DOCUMENT 是唯一 scopeSelectable 的因由，
地基已支持，无需改常量表。"
```

---

## Task A5: 兑换按钮表改造（删 4 加 4 + 报文补齐四字段）

**Files:**
- Modify: `src/modules/swap-sumsub/fixtures/verdict-buttons.ts`
- Modify: `src/modules/swap-sumsub/fixtures/verdict-buttons.spec.ts`
- Modify: `src/modules/swap-sumsub/demo-scenario.service.ts`（删 `runApplicantActionScenario`）
- Modify: `src/modules/swap-sumsub/demo-scenario.service.spec.ts`

**Interfaces:**
- Consumes: A1 的 `TxnReportVerdict`、A2 的 `SceneTag`
- Produces: `SWAP_VERDICT_BUTTONS`（8 个，键与充值/提现同名，缺 V4 / V8 / V10）

- [ ] **Step 1: 写失败测试**

```typescript
import { SWAP_VERDICT_BUTTONS } from './verdict-buttons';
import { buildOrderVerdictButtons } from '../../sumsub-shared/verdict-buttons.shared';

describe('SWAP_VERDICT_BUTTONS', () => {
  it('8 个按钮，键是充值域的子集（同码同义）', () => {
    const keys = Object.keys(SWAP_VERDICT_BUTTONS);
    expect(keys).toHaveLength(8);
    const depKeys = new Set(Object.keys(buildOrderVerdictButtons('DEPOSIT')));
    for (const k of keys) expect(depKeys.has(k)).toBe(true);
  });

  it('缺的三个各有真实理由：兑换无对手方、无处置弧', () => {
    expect(SWAP_VERDICT_BUTTONS.V4_AWAIT_USER_PEP_COUNTERPARTY).toBeUndefined();
    expect(SWAP_VERDICT_BUTTONS.V8_REJECTED_SANCTION_COUNTERPARTY).toBeUndefined();
    expect(SWAP_VERDICT_BUTTONS.V10_REJECTED_DISPOSITION).toBeUndefined();
  });

  it('认证复核按钮已删（材料审核不属交易层）', () => {
    const types = Object.values(SWAP_VERDICT_BUTTONS).map((b: any) => b.webhookType);
    expect(types).not.toContain('applicantActionReviewed');
  });

  it('报文形状与充值域一致：四个字段都在', () => {
    const dep = buildOrderVerdictButtons('DEPOSIT');
    for (const [key, b] of Object.entries(SWAP_VERDICT_BUTTONS) as [string, any][]) {
      const ref = (dep as any)[key];
      expect(Object.keys(b.verdict).sort()).toEqual(Object.keys(ref.verdict).sort());
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/swap-sumsub/fixtures/verdict-buttons.spec.ts
```

期望：4 个用例全 FAIL（现有 8 个按钮里有 `applicantActionReviewed`，键名也是旧的）。

- [ ] **Step 3: 重写兑换 fixture**

整个文件替换为「从共享表取 8 个 + 覆盖兑换特有的 score」：

```typescript
import { buildOrderVerdictButtons, type OrderVerdictButton } from '../../sumsub-shared/verdict-buttons.shared';

export type SwapVerdictButton = OrderVerdictButton;

/**
 * 兑换域裁决按钮 —— 取充值域同一张表的 8 个子集（同码同义）。
 *
 * 缺的三个各有真实理由，不得为了凑数补：
 *   ④ PEP 对手方 / ⑧ Sanctions 对手方 —— 兑换是客户账内换币，没有对手方；
 *   ⑩ 处置标签 —— 兑换的 FROZEN 是零出边终态，没有没收/退回/上缴那类弧。
 *
 * 2026-08-29 删掉旧的「⑦认证通过 / ⑧认证不通过」：材料审核是另一个 webhook
 * （applicantActionReviewed），入口在客户详情页 Verification Requests 区块的
 * MaterialRequestPanel，不属交易面板。见 spec §2.1。
 */
const ALL = buildOrderVerdictButtons('DEPOSIT');
const SWAP_KEYS = [
  'V1_APPROVED',
  'V2_AWAIT_USER',
  'V3_AWAIT_USER_PEP_APPLICANT',
  'V5_AWAIT_USER_MULTI',
  'V6_ONHOLD',
  'V7_REJECTED_SANCTION_APPLICANT',
  'V9_REJECTED_MLRO_FREEZE',
  'V11_REJECTED_NO_TAG',
] as const;

export const SWAP_VERDICT_BUTTONS: Record<string, SwapVerdictButton> =
  Object.fromEntries(SWAP_KEYS.map((k) => [k, ALL[k]]));
```

- [ ] **Step 4: 删 `runApplicantActionScenario` 分支**

`demo-scenario.service.ts` 删掉：`runVerdict` 里 `if (button.webhookType === 'applicantActionReviewed') {...}` 整个分支、私有方法 `runApplicantActionScenario` 全体、以及随之无用的 `MaterialRequestsService` 注入（若无其他调用方）。对应 spec 用例一并删除。

- [ ] **Step 5: 跑测试**

```bash
npx jest src/modules/swap-sumsub
```

期望：新 4 个用例 PASS；删掉的 ⑦⑧ 相关用例已不存在；其余净新失败 0。

- [ ] **Step 6: 跑随手闸并 commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/swap-sumsub
git commit -m "feat(swap): 兑换按钮表并入统一表，8 码是充值域的子集

删 4：⑦认证通过/⑧认证不通过（材料审核不属交易层，入口在客户详情页）、
      旧②硬线（与 ⑪ no disposition tag 重名）、旧③软线（与 ② awaiting user 重名）
加 4：③ PEP 客户本人、⑤ 多条材料、⑨ MLRO freeze、⑪ no disposition tag
报文补齐 reviewStatus/action/reviewRejectType/matchedRules —— 此前兑换的
verdict 只有 4 个字段，是分叉时省掉的，真 Sumsub 本来就会发。

缺的三个（④⑧ 对手方、⑩ 处置标签）是真实业务差异：兑换无对手方、
FROZEN 是零出边终态，不得为凑数补。"
```

---

## Task A6: 兑换 workflow 认 tag（PEP / MLRO freeze / 多条材料）

**Files:**
- Modify: `src/modules/swap-sumsub/swap-kyt-verdict.handler.ts`
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Test: 两者的 `.spec.ts`

**Interfaces:**
- Consumes: A2 的 `SCENE_TAGS` / `SCENE_TAG_PRIORITY` / `DISPO_TAGS_BY_DOMAIN`

- [ ] **Step 1: 写失败测试**

```typescript
describe('兑换域读 tag', () => {
  it('⑨ MLRO freeze → FROZEN（与 ⑦ Sanctions 同一终态，不同因由）', async () => {
    await feed('V9_REJECTED_MLRO_FREEZE');
    const swap = await prisma.swapTransaction.findUnique({ where: { id: swapId } });
    expect(swap.status).toBe('FROZEN');
    const audit = await latestSwapAudit(swapId);
    expect(audit.metadata.dispoTag).toBe('FROZEN_BY_MLRO');
  });

  it('③ PEP 客户本人 → 下发材料 + 开客户级便签，兑换单落 REJECTED', async () => {
    await feed('V3_AWAIT_USER_PEP_APPLICANT');
    const swap = await prisma.swapTransaction.findUnique({ where: { id: swapId } });
    expect(swap.status).toBe('REJECTED');
    const req = await prisma.materialRequest.findFirst({ where: { orderRef: swap.swapNo } });
    expect(req.restrictionNo).not.toBeNull();
  });

  it('⑤ 多条材料 → 一次下发 3 行', async () => {
    await feed('V5_AWAIT_USER_MULTI');
    const swap = await prisma.swapTransaction.findUnique({ where: { id: swapId } });
    const rows = await prisma.materialRequest.findMany({ where: { orderRef: swap.swapNo } });
    expect(rows).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/swap-sumsub/swap-kyt-verdict.handler.spec.ts -t '兑换域读 tag'
```

期望：三个全 FAIL —— handler 现在只把 `typedTags` 原样传下去，不分流 sceneTag/dispoTag。

- [ ] **Step 3: 兑换 handler 加 tag 分流**

照抄充值 handler 的分流段（`deposit-kyt-verdict.handler.ts` L90-102 那段循环），改用 `DISPO_TAGS_BY_DOMAIN` 里兑换该认的集合。兑换只认 `FROZEN_BY_MLRO`（它没有 return/refund 弧）：

```typescript
import { SCENE_TAGS, SCENE_TAG_PRIORITY, type SceneTag, type DispoTag } from '../sumsub-shared/scene-tags';

const DISPO_TAGS = new Set<DispoTag>(['FROZEN_BY_MLRO']);

// ... 在读到 detail.typedTags 之后：
let sceneTag: SceneTag | undefined;
let dispoTag: DispoTag | undefined;
for (const tag of detail.typedTags) {
  if (tag.type !== 'userDefined') continue;
  if (SCENE_TAGS.has(tag.label as SceneTag)) {
    const candidate = tag.label as SceneTag;
    if (!sceneTag || SCENE_TAG_PRIORITY[candidate] > SCENE_TAG_PRIORITY[sceneTag]) sceneTag = candidate;
  }
  if (DISPO_TAGS.has(tag.label as DispoTag)) dispoTag = tag.label as DispoTag;
}
```

- [ ] **Step 4: 兑换 workflow 接住**

`swap-workflow.service.ts` 的 `applyKytVerdict` 入参加 `sceneTag?` / `dispoTag?`，rejected 分支里：

```typescript
// 制裁命中客户本人、或 MLRO 手工冻结 —— 两条都落 FROZEN（零出边终态）。
// 因由不同，靠审计 metadata 的 sceneTag/dispoTag 分辨，不靠状态分辨。
if (sceneTag === 'SANCTION_APPLICANT' || dispoTag === 'FROZEN_BY_MLRO') { /* → FROZEN */ }
```

- [ ] **Step 5: 跑测试并 commit**

```bash
npx jest src/modules/swap-sumsub src/modules/trading/swap-transactions
npx tsc --noEmit -p tsconfig.json
git add src/modules/swap-sumsub src/modules/trading/swap-transactions
git commit -m "feat(swap): 兑换 workflow 认 sceneTag/dispoTag

此前兑换 handler 只把 typedTags 原样往 workflow 传，不分流。新增的
③ PEP / ⑨ MLRO freeze / ⑤ 多条材料 都要求兑换侧真的读 tag。
兑换只认 FROZEN_BY_MLRO 一个处置 tag —— 它没有 return/refund 弧。
FROZEN 的两条因由（制裁命中 vs MLRO 冻结）靠审计 metadata 分辨，不靠状态分辨。"
```

---

## Task A7: 按钮清单出端点，前端三份手抄下岗

**为什么**：现在按钮表实际有 **6 份**——三个后端 fixture + 三个前端手抄常量（`DepositTransactionDetail.tsx:45` / `WithdrawTransactionDetail.tsx:45` / `SwapTransactionDetail.tsx:33`）。前端那份的注释自己承认：「这里没有自动化断言，改动任一侧务必同步改另一侧，否则 operator 会点不出新场景。」

**Files:**
- Modify: `src/modules/deposit-sumsub/admin-deposit-demo.controller.ts`
- Modify: `src/modules/withdraw-sumsub/admin-withdraw-demo.controller.ts`
- Modify: `src/modules/swap-sumsub/admin-swap-demo.controller.ts`
- Create: `admin-web/src/hooks/useVerdictButtons.ts`
- Modify: `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

**Interfaces:**
- Produces: `GET /admin/{deposit|withdraw|swap}-sumsub/demo/verdict-buttons` → `{ buttons: Array<{ key: string; label: string; source: 'ENGINE' | 'OFFICER' }> }`
- Produces: `useVerdictButtons(domain: 'deposit' | 'withdraw' | 'swap')` → `{ buttons, loading }`

- [ ] **Step 1: 写失败测试（后端）**

`src/modules/deposit-sumsub/admin-deposit-demo.controller.spec.ts` 追加：

```typescript
it('GET verdict-buttons 返回 11 个按钮，含 source 分组标记', async () => {
  const res = await controller.listVerdictButtons({ user: { type: 'ADMIN' } });
  expect(res.buttons).toHaveLength(11);
  expect(res.buttons[0]).toEqual(
    expect.objectContaining({ key: expect.any(String), label: expect.any(String), source: expect.any(String) }),
  );
  // 不吐报文内容：前端只需要键、文案、分组
  expect(res.buttons[0]).not.toHaveProperty('verdict');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/deposit-sumsub/admin-deposit-demo.controller.spec.ts
```

期望：FAIL —— `controller.listVerdictButtons is not a function`

- [ ] **Step 3: 三个 controller 各加一个 GET**

```typescript
@Get('verdict-buttons')
@ApiOperation({ summary: '列出本域可用的裁决按钮（demo only）—— 前端据此渲染 ⚡ 面板' })
listVerdictButtons(@Req() req: any) {
  return {
    buttons: Object.values(DEPOSIT_VERDICT_BUTTONS).map((b) => ({
      key: b.key, label: b.label, source: b.source,
    })),
  };
}
```

三份同款，各取自己的表。

- [ ] **Step 4: 登记 RBAC**

`rbac.catalog.ts` 加三条 route（照现有 `run-verdict` 那三条的写法），然后：

```bash
bash scripts/on-stack.sh main db:base:sync
```

⚠️ **必须重启后端**——SUPER_ADMIN 权限走内存 `RBAC_PERMISSION_DEFINITIONS` 不读 DB，只 seed 不重启 = 白费。

- [ ] **Step 5: 写前端 hook**

`admin-web/src/hooks/useVerdictButtons.ts`：

```typescript
import { useEffect, useState } from 'react';
import { adminFetch } from '../utils/adminFetch';

export type VerdictButton = { key: string; label: string; source: 'ENGINE' | 'OFFICER' };

/**
 * ⚡ 面板按钮清单 —— 从后端拉，不再手抄。
 *
 * 2026-08-29 之前三个详情页各手抄一份 key/label 常量，靠注释提醒「改一侧务必
 * 同步改另一侧」，没有任何机制保证一致。按钮表当时实际有 6 份。
 */
export function useVerdictButtons(domain: 'deposit' | 'withdraw' | 'swap') {
  const [buttons, setButtons] = useState<VerdictButton[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/${domain}-sumsub/demo/verdict-buttons`)
      .then((r) => r.json())
      .then((d) => { if (alive) setButtons(d.buttons ?? []); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [domain]);
  return { buttons, loading };
}
```

- [ ] **Step 6: 三个详情页删手抄常量、改用 hook**

删 `const DEPOSIT_VERDICT_BUTTONS: Array<{key,label}> = [...]`（含上方那段「务必同步改另一侧」的注释），改：

```typescript
const { buttons: verdictButtons } = useVerdictButtons('deposit');
```

渲染处 `DEPOSIT_VERDICT_BUTTONS.map(...)` → `verdictButtons.map(...)`。提现/兑换同款。

- [ ] **Step 7: 前端闸门 + 渲染验证**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
bash scripts/stack.sh up main
```

用 preview 打开充值详情页 → 截图 ⚡ 面板，确认 **11 个按钮**且文案是新的（③④ 是 PEP 分主体、⑩ 是新名字、没有 SLA breach）。提现同样 11 个、兑换 8 个。**三张截图贴进 commit message 或 PR。**

- [ ] **Step 8: Commit**

```bash
git add src/modules admin-web/src
git commit -m "feat(admin): ⚡ 面板按钮清单改从后端拉，消灭三份前端手抄

按钮表此前实际有 6 份（3 后端 fixture + 3 前端手抄常量），前端那份的注释
自己承认「没有自动化断言，改动任一侧务必同步改另一侧，否则 operator 会点
不出新场景」。新增 GET /admin/{域}-sumsub/demo/verdict-buttons，前端用
useVerdictButtons 拉取，一份真相。

真机截图验证：充值 11 / 提现 11 / 兑换 8，文案为新表。"
```

---

## Task A8: ⚡ 面板抽共享组件，按「引擎 / 合规官」分两组

**Files:**
- Create: `admin-web/src/components/SimulationPanel.tsx`
- Modify: `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx`

**Interfaces:**
- Consumes: A7 的 `useVerdictButtons`
- Produces: `<SimulationPanel domain="deposit" orderId={id} disabled={bool} onDone={fn} />`

- [ ] **Step 1: 写共享组件**

```tsx
import { useState } from 'react';
import { useVerdictButtons } from '../hooks/useVerdictButtons';
import { adminFetch } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';
import { DetailCard } from './DetailCard';

const ID_FIELD: Record<string, string> = {
  deposit: 'depositId', withdraw: 'withdrawId', swap: 'swapId',
};

/**
 * ⚡ Simulation 面板 —— 三域共用（2026-08-29 抽出，此前三份手写、归一化后
 * diff 只差按钮数组名）。
 *
 * 按 source 分两组渲染：Sumsub 规则引擎自动命中 vs 合规官在 Sumsub 台上手工
 * 处置 —— 这两件事在演示里是两个故事，运营该一眼看得出自己在模拟哪一种。
 */
export function SimulationPanel(props: {
  domain: 'deposit' | 'withdraw' | 'swap';
  orderId: string;
  disabled?: boolean;
  onDone: () => void;
}) {
  const { buttons } = useVerdictButtons(props.domain);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string) => {
    setBusy(key);
    try {
      await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/${props.domain}-sumsub/demo/run-verdict`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [ID_FIELD[props.domain]]: props.orderId, verdict: key }) },
      );
      props.onDone();
    } finally { setBusy(null); }
  };

  const group = (source: 'ENGINE' | 'OFFICER') => buttons.filter((b) => b.source === source);

  return (
    <DetailCard title="⚡ Simulation" columns={1}>
      {([
        ['ENGINE', 'Sumsub 规则引擎自动命中'],
        ['OFFICER', '合规官在 Sumsub 台上手工处置'],
      ] as const).map(([src, caption]) => (
        <div key={src} className="mb-3 last:mb-0">
          <p className="mb-1.5 font-mono text-[9px] text-adm-t3">{caption}</p>
          <div className="flex flex-wrap gap-1.5">
            {group(src).map((b) => (
              <button key={b.key} disabled={props.disabled || busy !== null}
                onClick={() => void run(b.key)}
                className={adminButtonClass('rowSecondaryUtility')}>
                {busy === b.key ? '…' : b.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </DetailCard>
  );
}
```

> `DetailCard` / `adminFetch` / `adminButtonClass` 的真实 import 路径以三个详情页现有写法为准，不要臆造。

- [ ] **Step 2: 三个详情页换用共享组件**

删各页 `{simEnabled && (<DetailCard title="⚡ Simulation" ...>...</DetailCard>)}` 整块 + `handleRunVerdict` + `simSubmitting` state，换成：

```tsx
{simEnabled && (
  <SimulationPanel domain="deposit" orderId={detail.id}
    disabled={isVerdictIgnored(detail.status)} onDone={() => void refresh()} />
)}
```

- [ ] **Step 3: 前端闸门 + 渲染验证**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

preview 三个详情页各截一张：面板分两组、组标题在、按钮数对（11/11/8）、终态时置灰。

- [ ] **Step 4: Commit**

```bash
git add admin-web/src
git commit -m "refactor(admin): ⚡ 面板抽成共享组件，按引擎/合规官分两组渲染

三份手写归一（PRODUCTION-NOTES 已量过：充值提现两份归一化后 diff 只差
按钮数组名）。新增分组：Sumsub 规则引擎自动命中 vs 合规官手工处置——
两类 tag 的现实来源不同（引擎打的 SCENE_TAGS vs 人打的 DISPO_TAGS），
演示里是两个故事。三域真机截图验证。"
```

---

# 阶段 B · 补料回炉

## Task B1: 提现转移表补 `ACTION_PENDING --RESUME--> COMPLIANCE_PENDING`

**为什么**：充值侧这条边**已经存在**（`deposit-transactions.service.ts` 的 `ACTION_PENDING` 出边含 `RESUME → COMPLIANCE_PENDING`）；提现侧**没有**——只有 `APPROVE→PAYOUT_PENDING` / `KYT_REJECTED→MANUAL_CHECKING` / `FREEZE→FROZEN` / `SLA_BREACH→MANUAL_CHECKING`。

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:117-122`
- Test: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
it('ACTION_PENDING --RESUME--> COMPLIANCE_PENDING（补料回炉）', async () => {
  const wd = await seedWithdraw({ status: 'ACTION_PENDING' });
  await service.updateStatus(wd.id, {
    action: WithdrawTransactionAction.RESUME,
    reason: 'material approved — back to compliance',
  });
  const after = await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } });
  expect(after.status).toBe('COMPLIANCE_PENDING');
});

it('非法跃迁仍被显式拒绝：ACTION_PENDING 不能直接 SUCCESS', async () => {
  const wd = await seedWithdraw({ status: 'ACTION_PENDING' });
  await expect(service.updateStatus(wd.id, {
    action: 'SUCCESS' as any, reason: 'x',
  })).rejects.toThrow(/Invalid action/i);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts -t '补料回炉'
```

期望：第一个 FAIL —— `Invalid action RESUME from ACTION_PENDING`

- [ ] **Step 3: 转移表加一条边**

```typescript
[WithdrawTransactionStatus.ACTION_PENDING]: {
  [WithdrawTransactionAction.APPROVE]: WithdrawTransactionStatus.PAYOUT_PENDING,
  [WithdrawTransactionAction.KYT_REJECTED]: WithdrawTransactionStatus.MANUAL_CHECKING,
  [WithdrawTransactionAction.FREEZE]: WithdrawTransactionStatus.FROZEN,
  [WithdrawTransactionAction.SLA_BREACH]: WithdrawTransactionStatus.MANUAL_CHECKING,
  // 2026-08-29 补料回炉：材料审过（GREEN）→ 回合规重跑一次筛查，而不是让运营
  // 看着办直接放行。充值侧这条边一直存在（RESUME → COMPLIANCE_PENDING），
  // 提现侧此前缺，导致 ACTION_PENDING 的提现单在材料审过后永远停在原地。
  [WithdrawTransactionAction.RESUME]: WithdrawTransactionStatus.COMPLIANCE_PENDING,
},
```

若 `WithdrawTransactionAction.RESUME` 枚举不存在，先加枚举值。

- [ ] **Step 4: 跑测试并 commit**

```bash
npx jest src/modules/trading/withdraw-transactions
npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/withdraw-transactions
git commit -m "feat(withdraw): 转移表补 ACTION_PENDING --RESUME--> COMPLIANCE_PENDING

补料回炉这条边充值侧一直有，提现侧此前缺。铁律④：要新结局就加一条边，
不许绕表直写。非法跃迁仍显式拒绝（同批用例验证）。"
```

---

## Task B2: 充值域补 `MATERIAL_REQUEST_REVIEWED` 回炉 listener

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（V4 名册 +1 码）
- Modify: `src/modules/audit-logging/constants/__snapshots__/audit-vocabulary-closure.spec.ts.snap`
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `DomainEventNames.MATERIAL_REQUEST_REVIEWED`，事件形状 `{ requestNo, customerId, orderDomain, orderRef, outcome: 'APPROVED'|'RETRY'|'REJECTED', traceId }`（见 `material-request-review.service.ts` 的 emit）
- Produces: 审计码 `DEPOSIT_MATERIAL_APPROVED_RESUMED`

- [ ] **Step 1: 写失败测试**

```typescript
describe('材料审过 → 充值单回炉', () => {
  it('GREEN + 单在 ACTION_PENDING → 回 COMPLIANCE_PENDING 并留痕', async () => {
    const dep = await seedDeposit({ status: 'ACTION_PENDING' });
    await workflow.onMaterialRequestReviewed({
      requestNo: 'MRQ1', customerId: dep.ownerId,
      orderDomain: 'DEPOSIT', orderRef: dep.depositNo,
      outcome: 'APPROVED', traceId: 't1',
    });
    const after = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(after.status).toBe('COMPLIANCE_PENDING');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DEPOSIT_MATERIAL_APPROVED_RESUMED', primarySubjectNo: dep.depositNo },
    });
    expect(audit).not.toBeNull();
  });

  it('不是本域的事件 → 一动不动（铁律③各管各的）', async () => {
    const dep = await seedDeposit({ status: 'ACTION_PENDING' });
    await workflow.onMaterialRequestReviewed({
      requestNo: 'MRQ2', customerId: dep.ownerId,
      orderDomain: 'WITHDRAW', orderRef: 'WD123',
      outcome: 'APPROVED', traceId: 't2',
    });
    const after = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(after.status).toBe('ACTION_PENDING');
  });

  it.each(['RETRY', 'REJECTED'])('%s → 单留在 ACTION_PENDING（只有 GREEN 回炉）', async (outcome) => {
    const dep = await seedDeposit({ status: 'ACTION_PENDING' });
    await workflow.onMaterialRequestReviewed({
      requestNo: 'MRQ3', customerId: dep.ownerId,
      orderDomain: 'DEPOSIT', orderRef: dep.depositNo,
      outcome, traceId: 't3',
    });
    const after = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(after.status).toBe('ACTION_PENDING');
  });

  it('单已不在 ACTION_PENDING（迟到的复核）→ no-op，不抛', async () => {
    const dep = await seedDeposit({ status: 'FROZEN' });
    await expect(workflow.onMaterialRequestReviewed({
      requestNo: 'MRQ4', customerId: dep.ownerId,
      orderDomain: 'DEPOSIT', orderRef: dep.depositNo,
      outcome: 'APPROVED', traceId: 't4',
    })).resolves.not.toThrow();
    const after = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(after.status).toBe('FROZEN');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t '材料审过'
```

期望：全 FAIL —— `workflow.onMaterialRequestReviewed is not a function`

- [ ] **Step 3: 名册加码 + 更新封册快照**

`audit-actions.constant.ts` 的 `V4_DEPOSIT_AUDIT_ACTIONS` 加：

```typescript
DEPOSIT_MATERIAL_APPROVED_RESUMED: {
  domain: 'DEPOSIT', correlationMode: I,
  requiredFields: ['fromStatus', 'toStatus', 'requestNo'], requiresCausation: false,
},
```

同时 `AuditActions` 常量对象加同名键。然后：

```bash
npx jest src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts -u
```

⚠️ 封册快照是**只出不进**的守卫，`-u` 是本轮唯一被允许的更新场景（新增业务动作码）。更新后 `git diff` 快照，确认**只多了这一行**。

- [ ] **Step 4: 实现 listener**

```typescript
/**
 * 材料审过 → 把这笔充值推回合规重跑。
 *
 * modules/v4-deposit.md §状态表写的是 COMPLIANCE_PENDING ⇄ ACTION_PENDING
 * （补齐回炉）——这条回边转移表里一直有（RESUME），但 2026-08-29 之前没有
 * 任何人触发它：本域只听 CUSTOMER_RESTRICTION_OPENED（便签开启），单向。
 * 便签开了接得住（冻单），便签解了不知道。
 *
 * 「补料后重跑合规」与「运营看着办直接放行」在合规演示里是两回事，后者是
 * approveDeposit 白名单含 ACTION_PENDING 带来的人工出路，不能当成前者。
 *
 * 失败不上抛（@OnEvent 里抛没人接），与本域其它 listener 同款口径。
 */
@OnEvent(DomainEventNames.MATERIAL_REQUEST_REVIEWED, { async: true })
async onMaterialRequestReviewed(event: {
  requestNo: string; customerId: string;
  orderDomain: string; orderRef: string | null;
  outcome: string; traceId?: string;
}): Promise<void> {
  // 铁律③：各管各的。别人域的材料请求与本域无关。
  if (event.orderDomain !== 'DEPOSIT' || !event.orderRef) return;
  // 只有 GREEN 回炉 —— RETRY/FINAL 都还没审过，单子该留在原地等。
  if (event.outcome !== 'APPROVED') return;

  try {
    const deposit = await this.depositService.findByNo(event.orderRef);
    if (!deposit) return;
    if (deposit.status !== DepositTransactionStatus.ACTION_PENDING) {
      this.logger.log(
        `Material ${event.requestNo} approved but deposit ${event.orderRef} is ` +
        `${deposit.status} (not ACTION_PENDING) — late review, nothing to resume`,
      );
      return;
    }

    await this.depositService.updateStatus(deposit.id, {
      action: DepositTransactionAction.RESUME,
      reason: `Material request ${event.requestNo} reviewed GREEN — back to compliance for re-screening`,
    });

    await this.depositAudit({
      action: AuditActions.DEPOSIT_MATERIAL_APPROVED_RESUMED,
      deposit,
      fromStatus: DepositTransactionStatus.ACTION_PENDING,
      toStatus: DepositTransactionStatus.COMPLIANCE_PENDING,
      metadata: { requestNo: event.requestNo },
      correlationId: deposit.correlationId ?? undefined,
    });
  } catch (e) {
    this.logger.warn(
      `onMaterialRequestReviewed failed for ${event.requestNo}: ` +
      `${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
```

> `depositAudit` 的真实签名以本文件现有的审计封装为准（站1b-β 统一信封），照现有调用点抄。

- [ ] **Step 5: 跑测试**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
npx jest src/modules/audit-logging
```

期望：5 个新用例 PASS；封册 spec PASS（快照已更）。

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions src/modules/audit-logging
git commit -m "feat(deposit): 材料审过后把充值单推回合规重跑（A7 真身）

2026-08-29 实跑发现：ACTION_PENDING 充值单，客户提交材料 + 管理台 Approve
后便签 RELEASED、客户恢复交易，但订单 20 秒后仍 ACTION_PENDING。
MATERIAL_REQUEST_REVIEWED 全仓只有两个监听方（兑换那个干的是记审计不是
回炉、材料刷新域），充值/提现只听 CUSTOMER_RESTRICTION_OPENED——单向。

modules/v4-deposit.md 写「COMPLIANCE_PENDING ⇄ ACTION_PENDING 补齐回炉」，
转移表里 RESUME 这条边一直在，只是没人触发。

只有 GREEN 回炉；RETRY/FINAL 留原地；非本域事件不动（铁律③）；
迟到的复核 no-op 不抛。新增审计码 DEPOSIT_MATERIAL_APPROVED_RESUMED，
封册快照同步更新（只多这一行）。"
```

---

## Task B3: 提现域补同款 listener

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（V5 名册 +1 码）
- Modify: `src/modules/audit-logging/constants/__snapshots__/audit-vocabulary-closure.spec.ts.snap`
- Test: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts`

**Interfaces:**
- Consumes: B1 的 `ACTION_PENDING --RESUME--> COMPLIANCE_PENDING` 边
- Produces: 审计码 `WITHDRAW_MATERIAL_APPROVED_RESUMED`

- [ ] **Step 1: 写失败测试**

与 B2 Step 1 五个用例逐一对应，把 `Deposit` 换成 `Withdraw`、`orderDomain: 'WITHDRAW'`、审计码换 `WITHDRAW_MATERIAL_APPROVED_RESUMED`、"不是本域"那个用例的 `orderDomain` 换成 `'DEPOSIT'`、"迟到的复核"那个用例的起始态换成 `'PAYOUT_PENDING'`。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts -t '材料审过'
```

期望：全 FAIL —— 方法不存在。

- [ ] **Step 3: V5 名册加码 + 更新快照**

```typescript
WITHDRAW_MATERIAL_APPROVED_RESUMED: {
  domain: 'WITHDRAW', correlationMode: I,
  requiredFields: ['fromStatus', 'toStatus', 'requestNo'], requiresCausation: false,
},
```

```bash
npx jest src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts -u
git diff src/modules/audit-logging/constants/__snapshots__/
```

确认只多一行。

- [ ] **Step 4: 实现（照 B2 Step 4，换域）**

结构逐字同构 B2，差别只有：`event.orderDomain !== 'WITHDRAW'`、`this.withdrawService`、`WithdrawTransactionStatus.ACTION_PENDING`、`WithdrawTransactionAction.RESUME`、`withdrawAudit()` 封装、审计码。

- [ ] **Step 5: 跑测试 + 随手闸**

```bash
npx jest src/modules/trading src/modules/audit-logging
npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 6: 全链实跑验证（不能只靠单测）**

```bash
bash scripts/stack.sh reset main && bash scripts/stack.sh up main
```

然后手工走一遍并记录每步实到状态：

1. 客户端建一笔提现 → `COMPLIANCE_PENDING`
2. ⚡ 按 ② Awaiting user → `ACTION_PENDING` + 材料请求 `PENDING_SUBMISSION`
3. 客户端 `POST /client/me/material-requests/{no}/submit` → `SUBMITTED`
4. 管理台客户详情页 Verification Requests 点 ✅ Approve
5. **断言**：材料请求 `APPROVED`、**提现单回到 `COMPLIANCE_PENDING`**、审计里查得到 `WITHDRAW_MATERIAL_APPROVED_RESUMED`

把五步实到状态贴进 commit message。

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/withdraw-transactions src/modules/audit-logging
git commit -m "feat(withdraw): 材料审过后把提现单推回合规重跑

与充值域同构（B2）。全链实跑验证五步状态流转，含审计留痕。"
```

---

# 阶段 C · `demo:all` 花名册造数器

## Task C1: 花名册常量表 + 答案键打印

**Files:**
- Create: `scripts/demo-roster.ts`
- Create: `scripts/demo-roster.spec.ts`

**Interfaces:**
- Produces: `DEMO_ROSTER: RosterEntry[]`；`RosterEntry = { seq: number; domain: 'DEPOSIT'|'SWAP'|'WITHDRAW'; label: string; expectedStatus: string; customerEmail: string; amount: string; currency: string; driver: string }`
- Produces: `printAnswerKey(actual: Array<{ seq: number; orderNo: string; status: string }>): { pass: boolean; lines: string[] }`

- [ ] **Step 1: 写失败测试**

```typescript
import { DEMO_ROSTER, printAnswerKey } from './demo-roster';

describe('DEMO_ROSTER', () => {
  it('20 笔单，覆盖三域', () => {
    expect(DEMO_ROSTER).toHaveLength(20);
    const byDomain = DEMO_ROSTER.reduce<Record<string, number>>((a, r) => {
      a[r.domain] = (a[r.domain] ?? 0) + 1; return a;
    }, {});
    expect(byDomain).toEqual({ DEPOSIT: 10, SWAP: 3, WITHDRAW: 7 });
  });

  it('金额全部写死，没有随机', () => {
    for (const r of DEMO_ROSTER) expect(r.amount).toMatch(/^\d+(\.\d+)?$/);
    // 两次 import 拿到同一批值
    const snapshot = JSON.stringify(DEMO_ROSTER);
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expect(JSON.stringify(require('./demo-roster').DEMO_ROSTER)).toEqual(snapshot);
  });

  it('三条处置弧都在花名册里', () => {
    const states = DEMO_ROSTER.map((r) => r.expectedStatus);
    expect(states).toContain('CONFISCATED');
    expect(states).toContain('RETURNED');
    expect(states).toContain('SEIZED');
  });

  it('在途单是花名册的一行，不是特例', () => {
    const inTransit = DEMO_ROSTER.find((r) => r.expectedStatus === 'PAYOUT_PENDING');
    expect(inTransit).toBeDefined();
    expect(inTransit!.domain).toBe('WITHDRAW');
  });

  it('printAnswerKey：全部符合预期 → pass', () => {
    const actual = DEMO_ROSTER.map((r) => ({ seq: r.seq, orderNo: `NO${r.seq}`, status: r.expectedStatus }));
    expect(printAnswerKey(actual).pass).toBe(true);
  });

  it('printAnswerKey：有一笔状态不符 → fail，且指出是哪一笔', () => {
    const actual = DEMO_ROSTER.map((r) => ({ seq: r.seq, orderNo: `NO${r.seq}`, status: r.expectedStatus }));
    actual[7].status = 'SUCCESS';
    const res = printAnswerKey(actual);
    expect(res.pass).toBe(false);
    expect(res.lines.join('\n')).toContain(DEMO_ROSTER[7].label);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest scripts/demo-roster.spec.ts
```

期望：FAIL — 模块不存在。

- [ ] **Step 3: 写花名册**

```typescript
/**
 * demo:all 花名册 —— 20 笔单覆盖 20 种终态/活态。
 *
 * 原则：剧本演到的状态必须有现成样本，剧本没演到的不造。不按状态机穷举
 * （兑换的 FAILED/REVERSED 是不可达死枚举，不进册）。
 *
 * 固定不随机：金额、笔数、目标状态全部写死。唯一会变的是单号（内嵌日期），
 * 所以答案键运行时打印，不写死在文件里。随机金额会自己穿仓，也会让
 * demo/data.md 的自动生成分不清「漂移」与「噪音」。
 */
export type RosterDomain = 'DEPOSIT' | 'SWAP' | 'WITHDRAW';

export interface RosterEntry {
  seq: number;
  domain: RosterDomain;
  label: string;
  expectedStatus: string;
  customerEmail: string;
  amount: string;
  currency: string;
  /** 怎么把单驱到目标态；⚡N = 模拟面板第 N 个按钮 */
  driver: string;
}

const ALICE = 'demo_alice@example.com';
const BOB = 'demo_bob@example.com';
const GRACE = 'demo_grace@example.com';

export const DEMO_ROSTER: RosterEntry[] = [
  { seq: 1,  domain: 'DEPOSIT',  label: '充值 · 正常入账 USDT',      expectedStatus: 'SUCCESS',           customerEmail: ALICE, amount: '3000',   currency: 'USDT', driver: '⚡①' },
  { seq: 2,  domain: 'DEPOSIT',  label: '充值 · 正常入账 AED',       expectedStatus: 'SUCCESS',           customerEmail: BOB,   amount: '8000',   currency: 'AED',  driver: '⚡①' },
  { seq: 3,  domain: 'DEPOSIT',  label: '充值 · 正常入账 AED（二）',  expectedStatus: 'SUCCESS',           customerEmail: GRACE, amount: '6500',   currency: 'AED',  driver: '⚡①' },
  { seq: 4,  domain: 'DEPOSIT',  label: '充值 · 等客户补料',         expectedStatus: 'ACTION_PENDING',    customerEmail: ALICE, amount: '4200',   currency: 'AED',  driver: '⚡②' },
  { seq: 5,  domain: 'DEPOSIT',  label: '充值 · 转人工复核',         expectedStatus: 'MANUAL_CHECKING',   customerEmail: BOB,   amount: '5100',   currency: 'AED',  driver: '⚡⑪' },
  { seq: 6,  domain: 'DEPOSIT',  label: '充值 · 小额挂起',           expectedStatus: 'OPERATION_PENDING', customerEmail: GRACE, amount: '35',     currency: 'AED',  driver: '低于下限' },
  { seq: 7,  domain: 'DEPOSIT',  label: '充值 · 制裁冻结',           expectedStatus: 'FROZEN',            customerEmail: BOB,   amount: '7300',   currency: 'AED',  driver: '⚡⑦' },
  { seq: 8,  domain: 'DEPOSIT',  label: '充值 · 没收（钱进公司）',    expectedStatus: 'CONFISCATED',       customerEmail: GRACE, amount: '42',     currency: 'AED',  driver: '低于下限 → 没收 → MLRO 批' },
  { seq: 9,  domain: 'DEPOSIT',  label: '充值 · 退回原发款方',       expectedStatus: 'RETURNED',          customerEmail: ALICE, amount: '2600',   currency: 'AED',  driver: '⚡⑪ → 退回 → MLRO 批' },
  { seq: 10, domain: 'DEPOSIT',  label: '充值 · 上缴（政府移交）',    expectedStatus: 'SEIZED',            customerEmail: BOB,   amount: '9100',   currency: 'AED',  driver: '⚡⑦ → 上缴 → MLRO 批' },

  { seq: 11, domain: 'SWAP',     label: '兑换 · USDT→AED 成功',      expectedStatus: 'SUCCESS',           customerEmail: ALICE, amount: '1000',   currency: 'USDT', driver: '⚡①' },
  { seq: 12, domain: 'SWAP',     label: '兑换 · AED→USDT 成功',      expectedStatus: 'SUCCESS',           customerEmail: BOB,   amount: '2900',   currency: 'AED',  driver: '⚡①' },
  { seq: 13, domain: 'SWAP',     label: '兑换 · 制裁冻结（零出边）',  expectedStatus: 'FROZEN',            customerEmail: GRACE, amount: '600',    currency: 'AED',  driver: '⚡⑦' },

  { seq: 14, domain: 'WITHDRAW', label: '提现 · 法币成功',           expectedStatus: 'SUCCESS',           customerEmail: ALICE, amount: '1200',   currency: 'AED',  driver: '⚡①' },
  { seq: 15, domain: 'WITHDRAW', label: '提现 · 虚拟币成功',         expectedStatus: 'SUCCESS',           customerEmail: BOB,   amount: '150',    currency: 'USDT', driver: '⚡①' },
  { seq: 16, domain: 'WITHDRAW', label: '提现 · 法币成功（二）',     expectedStatus: 'SUCCESS',           customerEmail: GRACE, amount: '900',    currency: 'AED',  driver: '⚡①' },
  { seq: 17, domain: 'WITHDRAW', label: '提现 · 等客户补料',         expectedStatus: 'ACTION_PENDING',    customerEmail: ALICE, amount: '1800',   currency: 'AED',  driver: '⚡②' },
  { seq: 18, domain: 'WITHDRAW', label: '提现 · 大额待审批',         expectedStatus: 'PENDING_APPROVAL',  customerEmail: BOB,   amount: '250000', currency: 'AED',  driver: '超大额闸' },
  { seq: 19, domain: 'WITHDRAW', label: '提现 · 制裁冻结',           expectedStatus: 'FROZEN',            customerEmail: GRACE, amount: '1500',   currency: 'AED',  driver: '⚡⑦' },
  { seq: 20, domain: 'WITHDRAW', label: '提现 · 卡在半路（对账用）',  expectedStatus: 'PAYOUT_PENDING',    customerEmail: ALICE, amount: '500',    currency: 'AED',  driver: 'demo:in-transit' },
];

export function printAnswerKey(
  actual: Array<{ seq: number; orderNo: string; status: string }>,
): { pass: boolean; lines: string[] } {
  const bySeq = new Map(actual.map((a) => [a.seq, a]));
  const lines: string[] = [];
  let bad = 0;

  for (const domain of ['DEPOSIT', 'SWAP', 'WITHDRAW'] as const) {
    const rows = DEMO_ROSTER.filter((r) => r.domain === domain);
    lines.push(`\n── ${domain}（${rows.length} 笔）`);
    for (const r of rows) {
      const a = bySeq.get(r.seq);
      const ok = a?.status === r.expectedStatus;
      if (!ok) bad += 1;
      lines.push(
        `  ${ok ? '✓' : '✗'} #${String(r.seq).padStart(2)} ${r.label.padEnd(24)} ` +
        `${(a?.orderNo ?? '—').padEnd(16)} 预期 ${r.expectedStatus}` +
        (ok ? '' : ` ｜ 实到 ${a?.status ?? '（没造出来）'}`),
      );
    }
  }
  lines.push(`\n花名册：${DEMO_ROSTER.length - bad}/${DEMO_ROSTER.length} 符合预期`);
  return { pass: bad === 0, lines };
}
```

- [ ] **Step 4: 跑测试**

```bash
npx jest scripts/demo-roster.spec.ts
```

期望：6 个用例全 PASS。

> ⚠️ `scripts/` 不在 `tsconfig.json` 的 include 里（PRODUCTION-NOTES 在案）。本 Task 的 `tsc` 检查靠 `tsconfig.test.json` 或 jest 的 ts-jest 转译覆盖，不额外改闸门配置。

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-roster.ts scripts/demo-roster.spec.ts
git commit -m "feat(demo): 花名册常量表 + 答案键打印

20 笔单覆盖 20 种状态（充值 10 / 兑换 3 / 提现 7），含三条处置弧
CONFISCATED/RETURNED/SEIZED —— 它们是唯一能证明 V4 篇开篇公理
「每个终态都回答了钱去哪了」的样本，今天库里一笔都没有。

固定不随机（金额写死，答案键运行时打印，因为单号内嵌日期无法固定）。
在途单是第 20 行而不是特例。"
```

---

## Task C2: 造数器按花名册铺充值 10 笔（含三条处置弧）

**Files:**
- Modify: `scripts/demo-lib.ts`（`runDeposits`）
- Create: `scripts/demo-mlro.ts`（MLRO 身份持有 + 审批helper）

**Interfaces:**
- Consumes: C1 的 `DEMO_ROSTER`
- Produces: `runDeposits(ctx)` 返回 `Array<{ seq: number; orderNo: string; status: string }>`；`approveAsMlro(ctx, approvalNo)` 

- [ ] **Step 1: 建 MLRO 身份 helper**

`scripts/demo-mlro.ts`：

```typescript
/**
 * 三条处置弧（没收/退回/上缴）都是 maker-checker：运营发起 + MLRO 单步审批。
 * 造数脚本因此需要第二个身份 —— 用 base seed 里的 mlro@fiatx.com（密码 123456，
 * 见 doc-final/demo/data.md「管理员」节）。
 */
export async function loginAsMlro(apiBase: string): Promise<string> {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'mlro@fiatx.com', password: '123456' }),
  });
  if (!res.ok) throw new Error(`MLRO login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

export async function approveAsMlro(apiBase: string, token: string, approvalNo: string): Promise<void> {
  const res = await fetch(`${apiBase}/admin/approvals/${approvalNo}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ comment: 'demo fixture — MLRO approval' }),
  });
  if (!res.ok) throw new Error(`MLRO approve ${approvalNo} failed: ${res.status} ${await res.text()}`);
}
```

> 审批端点路径以 `grep -rn "@Post" src/modules/**/approvals*.controller.ts` 的实际结果为准，不要臆造。

- [ ] **Step 2: 写失败测试（e2e 级，跑真栈）**

`test/demo-roster.e2e-spec.ts`：

```typescript
it('充值 10 笔全部落到花名册预期状态', async () => {
  const results = await runDeposits(ctx);
  const deposits = DEMO_ROSTER.filter((r) => r.domain === 'DEPOSIT');
  for (const r of deposits) {
    const got = results.find((x) => x.seq === r.seq);
    expect({ seq: r.seq, status: got?.status }).toEqual({ seq: r.seq, status: r.expectedStatus });
  }
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
bash scripts/on-stack.sh main -- npx jest test/demo-roster.e2e-spec.ts
```

期望：FAIL —— 现在 `runDeposits` 只造 SUCCESS，seq 4-10 全部对不上。

- [ ] **Step 4: 改写 `runDeposits`**

按 `DEMO_ROSTER` 里 `domain === 'DEPOSIT'` 的 10 行逐条铺：建单 → 按 `driver` 驱动 → 记录实到状态。三条处置弧的驱动序列：

```typescript
// #8 CONFISCATED：低于下限挂起 → 运营发起没收 → MLRO 批 → 资金单腿确认
await createDeposit(ctx, entry);                       // → OPERATION_PENDING（金额低于下限）
const { approvalNo } = await opsConfiscate(ctx, no);   // → 开 MLRO 审批单
await approveAsMlro(ctx.apiBase, mlroToken, approvalNo);
await waitFor(() => statusOf(no) === 'CONFISCATED', 15_000);

// #9 RETURNED：⚡⑪ 转人工 → 运营发起退回 → MLRO 批
// #10 SEIZED：⚡⑦ 冻结 → 运营发起上缴 → MLRO 批
```

- [ ] **Step 5: 跑测试**

```bash
bash scripts/on-stack.sh main -- npx jest test/demo-roster.e2e-spec.ts
```

期望：10 笔全对。

- [ ] **Step 6: Commit**

```bash
git add scripts/ test/demo-roster.e2e-spec.ts
git commit -m "feat(demo): 充值按花名册铺 10 笔，含三条处置弧

CONFISCATED/RETURNED/SEIZED 三条弧都是 maker-checker（运营发起 + MLRO
单步审批），造数脚本因此持第二身份 mlro@fiatx.com。
造数一律走真实流程重放（模拟按钮同一套端点），不插表。"
```

---

## Task C3: 兑换 3 笔 + 提现 7 笔

**Files:**
- Modify: `scripts/demo-lib.ts`（`runSwaps` / `runWithdraws`）
- Modify: `scripts/demo-in-transit.ts`（改为被 `runWithdraws` 调用，产出第 20 行）

**Interfaces:**
- Consumes: C1 的 `DEMO_ROSTER`、C2 的 `approveAsMlro`
- Produces: `runSwaps(ctx)` / `runWithdraws(ctx)` 返回同 C2 的 `Array<{ seq, orderNo, status }>`

- [ ] **Step 1: 写失败测试**

```typescript
it('兑换 3 笔 + 提现 7 笔全部落到花名册预期状态', async () => {
  const results = [...(await runSwaps(ctx)), ...(await runWithdraws(ctx))];
  for (const r of DEMO_ROSTER.filter((x) => x.domain !== 'DEPOSIT')) {
    const got = results.find((x) => x.seq === r.seq);
    expect({ seq: r.seq, status: got?.status }).toEqual({ seq: r.seq, status: r.expectedStatus });
  }
});

it('在途单由 runWithdraws 产出，不再需要单独跑 demo:in-transit', async () => {
  const results = await runWithdraws(ctx);
  expect(results.find((x) => x.seq === 20)?.status).toBe('PAYOUT_PENDING');
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
bash scripts/on-stack.sh main -- npx jest test/demo-roster.e2e-spec.ts -t '兑换 3 笔'
```

- [ ] **Step 3: 改写 `runSwaps` / `runWithdraws`**

按花名册铺；提现第 18 行用 250000 AED 触发大额闸停在 `PENDING_APPROVAL`（**不批**——它就该停在那给演示看）；第 20 行调 `demo-in-transit.ts` 现有的 `createStuckWithdraw`。

`demo:in-transit` 这个 npm 脚本**保留**（第六幕单独演时还要用），但 `demo:all` 不再依赖先跑它。

- [ ] **Step 4: 跑测试并 commit**

```bash
bash scripts/on-stack.sh main -- npx jest test/demo-roster.e2e-spec.ts
git add scripts/ test/
git commit -m "feat(demo): 兑换 3 笔 + 提现 7 笔按花名册铺，在途单并入

在途单从此是花名册第 20 行（预期 PAYOUT_PENDING），不再是打挂断言的
「污染」。demo:in-transit 脚本保留（第六幕单独演时用），但 demo:all
不再依赖先跑它。"
```

---

## Task C4: 断言换成「实到 vs 预期」，A5 到此消失

**Files:**
- Modify: `scripts/demo-lib.ts:567-610`（`verifyEndState`）
- Test: `test/demo-roster.e2e-spec.ts`

**Interfaces:**
- Consumes: C1 的 `printAnswerKey`、C2/C3 的三个 run 函数返回值

- [ ] **Step 1: 写失败测试（A5 的墓志铭）**

```typescript
it('🎯 A5：跑过 demo:in-transit 之后再跑 demo:all，仍然全绿', async () => {
  await runInTransit(ctx);            // 再造一笔卡在半路的
  const ok = await verifyEndState(ctx);
  expect(ok).toBe(true);              // 旧断言会在这里挂成 6/8
});

it('某笔单没到预期状态 → 断言失败并指名道姓', async () => {
  await prisma.depositTransaction.update({
    where: { depositNo: rosterNo(7) }, data: { status: 'SUCCESS' },   // 该 FROZEN 的变成 SUCCESS
  });
  const ok = await verifyEndState(ctx);
  expect(ok).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
bash scripts/on-stack.sh main -- npx jest test/demo-roster.e2e-spec.ts -t 'A5'
```

期望：FAIL —— 旧的全称断言「所有 demo 提现必须 SUCCESS」被在途单打挂。

- [ ] **Step 3: 改写 `verifyEndState`**

删掉这两段全称断言（`demo-lib.ts` 约 L580-604）：

```typescript
['deposits SUCCESS', 'depositTransaction', 'SUCCESS'],
['swaps SUCCESS', 'swapTransaction', 'SUCCESS'],
['withdrawals SUCCESS', 'withdrawTransaction', 'SUCCESS'],
// 以及 'all demo payout legs CLEARED' 那整块
```

换成：

```typescript
// 花名册逐条比对 —— 取代此前的「所有 demo 单必须 SUCCESS」。
// 那个断言的前提本来就是错的：一个丰富的演示数据集里本来就该有冻结的、
// 没收的、退回的、上缴的、卡在半路的。in-transit 那笔单不是污染，
// 它是花名册第 20 行。
const { pass, lines } = printAnswerKey(rosterResults);
lines.forEach((l) => console.log(l));
ok('花名册逐条符合预期', pass);
```

**保留**现有 4 条 COA 恒等式断言原样不动。

- [ ] **Step 4: 跑测试**

```bash
bash scripts/on-stack.sh main -- npx jest test/demo-roster.e2e-spec.ts
```

期望：两个新用例 PASS。

- [ ] **Step 5: 全新库全链实跑**

```bash
bash scripts/stack.sh reset main && bash scripts/stack.sh up main
bash scripts/on-stack.sh main demo:all
bash scripts/on-stack.sh main demo:in-transit
bash scripts/on-stack.sh main demo:all          # ← 关键：这一趟必须还是全绿
bash scripts/on-stack.sh main verify:coa
```

把三次 `demo:all` 的答案键输出贴进 commit message。

- [ ] **Step 6: Commit**

```bash
git add scripts/ test/
git commit -m "feat(demo): demo:all 断言改花名册比对——A5 到此消失

旧断言「所有属于 demo 客户的单都必须 SUCCESS」断言的是一个开放集合，
任何人往 demo 客户名下留一笔非终态的单它就挂：实测 8/8 → 跑一次
demo:in-transit → 6/8（withdrawals SUCCESS 与 payout legs CLEARED 两条
同时栽）→ 跑 recon:demo 自清 → 回 8/8。

台账原本的修法是「排除带 DEMO_STUCK 前缀的在途单」，方向错了：在途单
不是污染，是第一个正确的样本，只是被一个错的断言当成了失败。

现在：花名册 20 行逐条比对实到 vs 预期。COA 四恒等式原样保留。
验证：跑过 demo:in-transit 之后再跑 demo:all 仍然全绿。"
```

---

## Task C5: `data.md` 改脚本生成 + `baseline.md` 换判据

**Files:**
- Modify: `scripts/demo-lib.ts`（答案键落盘）
- Modify: `doc-final/demo/data.md`
- Modify: `doc-final/demo/baseline.md`

- [ ] **Step 1: 答案键落盘**

`demo:all` 收尾时把花名册实到结果写进 `doc-final/demo/data.md` 的「本批数据」章节（脚本生成区用 `<!-- GENERATED:BEGIN -->` / `<!-- GENERATED:END -->` 包住，区外的手写内容不动）。

- [ ] **Step 2: 跑一次生成**

```bash
bash scripts/on-stack.sh main demo:all
git diff doc-final/demo/data.md
```

期望：生成区被填上 20 行；`data.md:3` 那句「待造数脚本输出答案键清单后，本文件改为脚本自动生成（防漂移）」改成「本文件生成区由 `demo:all` 自动写入」。

- [ ] **Step 3: 换 baseline 判据**

`doc-final/demo/baseline.md` 绿名单里 `demo:all 8/8` 那条 → `demo:all 花名册 20/20 符合预期 + COA 四恒等式`。**不删这条闸门。**

- [ ] **Step 4: 收尾闸（CLAUDE.md §7）**

```bash
bash scripts/stack.sh reset main && bash scripts/stack.sh up main
bash scripts/on-stack.sh main demo:all       # ⑥
bash scripts/on-stack.sh main verify:coa     # ⑦（动过钱：三条处置弧）
bash scripts/on-stack.sh main recon:demo:pass
bash scripts/on-stack.sh main verify:audit
npx jest                                      # 全量，判据：净新失败 0
```

- [ ] **Step 5: Commit**

```bash
git add scripts/ doc-final/demo/
git commit -m "docs(demo): data.md 改由 demo:all 自动生成，baseline 判据换花名册

data.md:3 早已声明「待造数脚本输出答案键清单后，本文件改为脚本自动生成
（防漂移）」—— 现在兑现。生成区用 GENERATED 标记包住，区外手写内容不动。
git diff data.md 有变化 = 代码真的改了行为。

baseline.md 绿名单：demo:all 8/8 → 花名册 20/20 + COA 四恒等式。闸门不删。"
```

---

## Task C6: 台账与文档收口

**Files:**
- Modify: `doc-final/BACKLOG.md`
- Modify: `doc-final/PRODUCTION-NOTES.md`
- Modify: `doc-final/CHANGELOG.md`
- Modify: `doc-final/modules/v4-deposit.md` / `v5-withdraw.md` / `v6-swap.md`

- [ ] **Step 1: 销 BACKLOG A 档两条**

A5 与 A7 两条勾掉，各附实证一行（答案键输出片段 / 五步实跑状态）。A 档清空后整节删除，导语并入 §B。

- [ ] **Step 2: 销 PRODUCTION-NOTES 三条**

- 「⑨ SLA 按钮与真实定时器痕迹不一致」→ 按钮已删
- 「⚡ Simulation 面板 markup 仍是三份手写」→ 已抽共享组件
- 「`scripts/` 不在 tsc 覆盖范围」→ **不销**，本轮没解决，原样留着

各加一行 `[已解 2026-08-XX] → 见 commit <sha>`。

- [ ] **Step 3: 三篇 modules 更新**

- `v4-deposit.md`：补料回炉这条边现在真的通了（原「演示缺口」里若有相关行，删掉）
- `v5-withdraw.md`：⑩ 改名 `Final rejected`；转移表新边
- `v6-swap.md`：按钮从 8 个变 8 个但内容不同；材料审核入口指向客户详情页

- [ ] **Step 4: CHANGELOG 一行**

- [ ] **Step 5: Commit**

```bash
git add doc-final/
git commit -m "docs: 演示装备一期收口——销 BACKLOG A 档两条 + PRODUCTION-NOTES 两条"
```

---

# 自查

**1. Spec 覆盖**

| Spec 节 | 落点 |
|---|---|
| §2.1 分层原则 | A5（删兑换 ⑦⑧） |
| §2.2 主表 | A2（充值提现）+ A5（兑换） |
| §2.3 兑换缺三格有真实理由 | A5 Step 1 第二个用例 |
| §2.4 删四个 | A2（⑨）+ A5（旧②③⑦⑧） |
| §2.5 结局不统一 | A6（兑换 workflow 自己决定落点） |
| §2.6(1) PEP 分主体 | A2 + A3 |
| §2.6(2) FINAL_REJECTED | A2 + A3 Step 4 |
| §2.6(3) 兑换报文补齐 | A5 Step 1 第四个用例 |
| §2.6(4) 兑换认 tag | A6 |
| §2.6(5) 便签挂谁 | A4 |
| §2.7 共享化 | A1 + A2 + A7 + A8 |
| §3 补料回炉 | B1 + B2 + B3 |
| §4.3 花名册 | C1 |
| §4.4 三约束 | C1(固定) + C2(走真实流程) + C4(断言) |
| §4.5 文档连带 | C5 |
| §5 顺带销账 | C6 |
| §6 验收 8 条 | 分散在各 Task 的测试 + C5 Step 4 收尾闸 |

**新增覆盖**：Spec 写的是「§3.3 若转移表没有这条边就加一条」——实施时发现充值侧 `RESUME → COMPLIANCE_PENDING` **已存在**，只有提现侧缺。B1 据此收窄成只改提现。

**2. 类型一致性**

- `SceneTag` 四值：A2 定义 → A3（充值/提现）、A6（兑换）消费 ✓
- `OrderVerdictButton.source`：A2 定义 → A7（端点）、A8（分组渲染）消费 ✓
- `OrderVerdictButton.restrictCustomer`：A2 定义 → A4 消费 ✓
- `RosterEntry` / `printAnswerKey`：C1 定义 → C2/C3/C4 消费 ✓
- 按钮 key 全表统一（`V1_APPROVED` … `V11_REJECTED_NO_TAG`）：A2 定义 → A3 Step 6 批量改引用、A5 取子集、A7 端点透传 ✓

**3. 已知风险**

| 风险 | 缓解 |
|---|---|
| A3 Step 6 的 key 批量替换可能漏 `test/` 下的 e2e | Step 6 的 grep 范围含 `test/`；A3 Step 7 跑全量 trading 目录 |
| 封册快照 `-u` 可能顺手吞掉别的漂移 | B2/B3 各要求 `git diff` 快照确认「只多一行」 |
| C2 的审批端点路径靠 grep 确认 | Step 1 明确写了「以 grep 实际结果为准，不要臆造」 |
| `scripts/` 不在 tsc 闸门内 | C1 Step 4 已标注；不在本轮解决，PRODUCTION-NOTES 原样留账 |
