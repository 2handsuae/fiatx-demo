# 对账破口场景按成因铺全 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `recon:demo:break` 从 9 个场景铺到 15 个，按「谁错了」的成因结构覆盖现实中会发生的破口；顺带新增两个交易客户供料，并把答案键从「按场景断言桶」拆成「按场景断言差异行 + 按钱包断言桶」。

**Architecture:** 生成器保持两段式不变——先把内部流水逐笔镜像成外部对账单（天生完美对上），再只在外部这一侧注入扭曲。15 条里 14 条纯外部注入，只有「我方重复入账」需要写账本（要让"重复"在屏幕上看得见，得有两笔同 externalRef 的内部流水）。答案键拆两级是本轮的地基改动：一个钱包挂多条场景之后，桶是钱包的属性、不再是场景的属性。

**Tech Stack:** TypeScript + ts-node 脚本 ｜ NestJS 应用上下文（脚本用 `NestFactory.createApplicationContext` 拿服务）｜ Prisma/SQLite ｜ TigerBeetle

## Global Constraints

- 设计依据：`doc-final/superpowers/specs/2026-08-30-recon-break-scenarios-design.md`。**§0.1 的口径是结论，不要翻案。**
- **不做**：归属场景（未归属外部账户）· `HELD` 桶 · 豁免 · 挂起 · 处置动作收口（下一轮）· **引擎任何改动**。
- 退役归属场景**只删种子注入**；`wallet-recon-run.service.ts` 的 `unattributedBalances` 分支与其单测（`wallet-recon-run.service.spec.ts` 「无主外部余额头（walletRef=null）→ 开 BREAK case」）**保留**。
- **素材订单一律不加提现**——提现会留下手续费腿，一旦没走到终态，那个钱包就带上非终态资金单，在途识别会去认领它、把期望桶打乱（`cfec505f` 修的正是这个坑）。新素材单只走充值与兑换。
- **两条自洽式一行都不许改**：`walletCount == matched+inTransit+softFlag+break` 与 `opened+reObserved == inTransit+softFlag+break`。它们场景无关（`wallet-recon-run.service.ts:402` 的 `walletsChecked = walletRefs.length + unattributedBalances.length`，两侧同增同减）。**任何"要改它才成立"的时刻本身就是警报。**
- 注入前置闸必须 **fail-closed**：条件不满足直接抛错，**不许静默降级**。
- 测试的绿必须来自行为。**禁止**扫源码文本型断言。
- 🔴 **`npx tsc --noEmit -p tsconfig.json` 对 `scripts/` 是结构性失明的** —— `tsconfig.json` 的
  `include` 是 `["src/**/*"]`，**从来不看 `scripts/recon-demo.ts`**，而这批任务每一个都在改那个文件。
  它绿只说明 `src/` 没坏，对本批的主战场**不构成任何证据**。
  **这个文件的类型检查 = 能不能被 `ts-node` 跑起来**（ts-node 加载时做类型检查，类型错以 `TSError`
  直接崩在启动阶段），也就是 `recon:demo:reset` / `recon:demo:break` 能不能启动。
  **本条是执行期发现的**：Task 2 的实现方撞上一个 `RootCause` 联合类型错——tsc 全绿、ts-node 直接崩。
- 🔴 **每个任务提交前必须跑一次 `npx jest --silent`**（不是只在 Task 9 收尾时跑）。判据：失败**恰好 4 套 8 例**，
  套名逐字是 `role-definition-create-workflow` / `system-wallet.util` / `wallets.service` /
  `client-web restrictedCapabilities`；不在这四个里的任何红都是事故。
  **本条是执行期补的**：计划初稿只在 Task 9 排了 jest，结果 Task 1 改了 `scripts/demo-roster.ts` 而
  `src/common/utils/demo-roster.spec.ts` 里写死 `toHaveLength(21)` 当场变红，没人在任务内发现，
  要等收尾闸才撞见——那时排查成本已经转嫁给后面的任务了。
  ⚠️ 注意 `scripts/` 下的 `*.spec.ts` **不会被 jest 扫到**（`jest.config.js` 的 roots 只覆盖
  `src/`、`admin-web/src/`、`client-web/src/`），所以改 `scripts/` 下的文件时更容易漏——
  它的测试往往住在 `src/common/utils/` 下。
- **不许用写死的行数/条数当断言或当屏幕文案。** 一律从数据现算（`DEMO_ROSTER.length`、
  `DEMO_ROSTER.filter(...).length`）。写死的数字每次加行都要有人记得回来改，而忘了改的表现是
  "本来该绿的东西变红"或"演示屏幕上印错数字"——本批 Task 1 两样都撞上了。
- 栈命令一律走包装器：`bash scripts/on-stack.sh self <npm-script>`。本工作树端口 3110–3113，DB `/tmp/exchange_js_wt_recon_adj1/dev.db`。
- 🔴 **同一个钱包上挂多条期望时，`expectedLines[]` 必须带 `internalSourceId` 钉行**（Task 5 评审实证后加）。
  原因：`fakeBankRef` 的种子是「钱包 + 当天日期」，**同钱包同日的每笔充值必然拿到同一个回执号**。
  而 `verifyManifest` 的谓词只有 `(matchStatus, walletRef, externalRef)`——三者全同的多条期望，
  在非排他匹配下**退化成同一句话问三遍**：谁的注入被弄坏都不会被发现，只要同组还有一条活着，
  脚本照样打印全绿、退出 0。**这正是答案键最不能出的那种错（自证型绿灯）。**
  修复已落地（Task 5 修复轮）：`ScenarioExpectation.expectedLines[]` 多了可选 `internalSourceId`，
  `verifyManifest` 改成排他 `claim()`。**展示位乙（Task 6）、展示位丙（Task 7）同样是一钱包多期望，
  必须照 Task 5 的写法把 `internalSourceId: <plan>.lines[i].sourceFlowId` 填上。**
  ⚠️ **不是 `internalSourceNo`**——那一列只有 `IN_TRANSIT` 行才写（见 `wallet-recon-run.service.ts`
  的 `writeLineItems()`），`AMOUNT_MISMATCH` / `ORPHAN_INTERNAL` / `ORPHAN_EXTERNAL` 三类行上恒为 null。
  同时按「对外用业务键」把人读的 `DEP…` 号填进该场景的 `detail`（UUID 给机器、单号给人）。
  **验证方式必须是变异测试**：故意弄坏其中一条注入 → 脚本必须变红**且点名是那一条** → 再改回去确认恢复。
  只跑一遍绿不算证明——它本来就是绿的。
- 🔴 **跑 break 的正确顺序**（控制方踩过，且一度把错的写进了需求书）：
  - **轻**（推荐）：`recon:demo:reset` → `recon:demo:break`。前者只回滚注入的扭曲（含 `bumpClosing`
    的相对调整），不动演示数据，快得多。
  - **重**（只在动了 schema / seed 时）：`stack.sh reset self` → **`demo:all`** → `recon:demo:break`。
  ⚠️ **`stack.sh reset self` 是整库重铺，会把演示数据一起清掉**。漏掉中间的 `demo:all` 直接跑 break，
  症状是：只规划出 7 个 PLATFORM 钱包（`internal=0 lines=0`）、`external_statement_lines=0`，
  然后在造在途单时炸 `IllegalSourceWalletError: ... has no active C_VIBAN wallet`——
  **报错栈指向提现工作流的 R4 校验，看着像业务代码坏了，实际是数据没铺。**
- ⚠️ **`demo:all` 不能在同一个库上连跑两次**（花名册第 #7/#10/#13 行把 FRANK 造成永久被制裁，第二次跑 Gate 0 会正确拒绝他的新充值）。每次验证都要先 `stack.sh down` → `reset self` → kill 掉 reset 拉起的 TigerBeetle → `up self`。

---

## 文件清单

| 文件 | 责任 | 动作 |
|---|---|---|
| `prisma/seed.business.ts` | `DEMO_CUSTOMERS` 客户定义表 | 改（+2 条） |
| `scripts/demo-lib.ts` | `DEMO_CUSTOMER_EMAILS` 交易人设名单 | 改（+2 个邮箱） |
| `scripts/demo-roster.ts` | `DEMO_ROSTER` 花名册 | 改（+8 行） |
| `scripts/recon-demo.ts` | 答案键类型 + 15 个场景注入 + 校验 + 前置闸 | 改（本轮主体） |
| `doc-final/demo/baseline.md` | 基线数字与判据 | 改 |
| `doc-final/demo/script.md` | 走查剧本（对账那一幕） | 改 |

---

### Task 1: 两个新交易客户 + 花名册素材单

**Files:**
- Modify: `prisma/seed.business.ts`（`DEMO_CUSTOMERS` 数组）
- Modify: `scripts/demo-lib.ts`（`DEMO_CUSTOMER_EMAILS` **与 `runDeposits` 的驱动 switch**）
- Modify: `scripts/demo-roster.ts`（`DEMO_ROSTER`）

⚠️ **2026-08-30 执行期补正**：`runDeposits` 里的 `switch (entry.seq)` 只有 `case 1-10`、**没有 `default`**
（seq 21 在 switch 之前就 `continue` 掉了）。新加的 7 行充值素材单不匹配任何 case，会一路 fall through、
**永远停在 `COMPLIANCE_PENDING`**，而且不报任何错——要等花名册答案键比对时才以"状态不符"的面目出现。
本计划初稿漏了这一层。修法见 Step 3.5。兑换那侧是 `if (seq===13) else {通用路径}`，seq 23 本来就走得通；
1096 行那个 switch 是提现，本任务不加提现行，不动。

**Interfaces:**
- Consumes: 无
- Produces: 两个交易人设 `demo_jack@example.com` / `demo_kate@example.com`，各自带 `C_VIBAN`(AED) + `C_DEP`(USDT) 两个钱包与一个法币提现地址；四个新钱包上有真实流水。后续任务按 `walletRole` + `ownerNo` 找它们。

- [ ] **Step 1: 加两条客户定义**

在 `prisma/seed.business.ts` 的 `DEMO_CUSTOMERS` 数组末尾（`demo_ivy` 那条之后）追加：

```ts
  // 2× 对账素材人设（Jack/Kate）—— 普通活跃客户，没有任何合规特征。
  // 存在的理由：对账破口场景要落在钱包上，而现有 8 个客户钱包不够分
  // （见 specs/2026-08-30-recon-break-scenarios-design.md §4）。
  // 他们同时提供**有流水的干净钱包**——MATCHED 桶必须有实打实的代表，
  // 0 流水 0 余额的钱包匹配上是"平凡地平"，证明不了引擎在干活。
  {
    email: 'demo_jack@example.com', phone: '+15552000010',
    firstName: 'Jack', lastName: 'Trader', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    sumsubApplicantId: mockSumsubApplicantId('demo_jack@example.com'),
  },
  {
    email: 'demo_kate@example.com', phone: '+15552000011',
    firstName: 'Kate', lastName: 'Trader', customerType: 'INDIVIDUAL',
    lifecycle: 'ACTIVE',
    riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    sumsubApplicantId: mockSumsubApplicantId('demo_kate@example.com'),
  },
```

- [ ] **Step 2: 把他们加进交易人设名单**

`scripts/demo-lib.ts` 的 `DEMO_CUSTOMER_EMAILS`：

```ts
export const DEMO_CUSTOMER_EMAILS = [
  'demo_alice@example.com',
  'demo_bob@example.com',
  'demo_grace@example.com',
  // 对账素材人设——进这个名单就自动拿到 C_VIBAN/C_DEP 两个钱包、客户级 TB 科目、
  // 以及法币提现地址（2026-07-11 上线的交易前置闸要求客户有 active 法币提现地址，
  // 否则第一笔充值就会被 hold 住）。
  'demo_jack@example.com',
  'demo_kate@example.com',
] as const;
```

- [ ] **Step 3: 花名册加 8 行素材单**

`scripts/demo-roster.ts`：先在人设常量区（`const GRACE = ...` 附近）加：

```ts
const JACK = 'demo_jack@example.com';
const KATE = 'demo_kate@example.com';
```

再在 `DEMO_ROSTER` 数组末尾（`seq: 21` 那条之后）追加：

```ts

  // ── 对账素材单（seq 22-29）─────────────────────────────────────────────
  // 花名册的原则是「剧本演到的状态必须有现成样本」——那是**覆盖下限**，不是
  // "每种状态只能一条"。下面这几行不为新终态而生，是为对账破口场景供料：
  // 场景要删/改/挪外部对账单行，钱包上就得先有行。
  // ⚠️ 一律不加提现：提现会留下手续费腿，没走到终态就让那个钱包带上非终态
  // 资金单，在途识别会去认领它、把场景的期望桶打乱（cfec505f 修的就是这个坑）。
  { seq: 22, domain: 'DEPOSIT', label: '充值 · 素材（Grace USDT）',   expectedStatus: 'SUCCESS', customerEmail: GRACE, amount: '1200', currency: 'USDT', driver: '⚡①' },
  { seq: 23, domain: 'SWAP',    label: '兑换 · 素材（Grace AED→USDT）', expectedStatus: 'SUCCESS', customerEmail: GRACE, amount: '800',  currency: 'AED',  driver: '⚡①' },
  { seq: 24, domain: 'DEPOSIT', label: '充值 · 素材（Jack AED 大额）',  expectedStatus: 'SUCCESS', customerEmail: JACK,  amount: '5000', currency: 'AED',  driver: '⚡①' },
  { seq: 25, domain: 'DEPOSIT', label: '充值 · 素材（Jack AED 小额）',  expectedStatus: 'SUCCESS', customerEmail: JACK,  amount: '1500', currency: 'AED',  driver: '⚡①' },
  { seq: 26, domain: 'DEPOSIT', label: '充值 · 素材（Jack USDT）',     expectedStatus: 'SUCCESS', customerEmail: JACK,  amount: '400',  currency: 'USDT', driver: '⚡①' },
  { seq: 27, domain: 'DEPOSIT', label: '充值 · 素材（Kate AED 大额）',  expectedStatus: 'SUCCESS', customerEmail: KATE,  amount: '4000', currency: 'AED',  driver: '⚡①' },
  { seq: 28, domain: 'DEPOSIT', label: '充值 · 素材（Kate AED 小额）',  expectedStatus: 'SUCCESS', customerEmail: KATE,  amount: '1200', currency: 'AED',  driver: '⚡①' },
  { seq: 29, domain: 'DEPOSIT', label: '充值 · 素材（Kate USDT）',     expectedStatus: 'SUCCESS', customerEmail: KATE,  amount: '350',  currency: 'USDT', driver: '⚡①' },
```

- [ ] **Step 3.5: 给充值驱动补路径 + fail-closed 兜底**

`scripts/demo-lib.ts` 的 `runDeposits` 里，把成功组扩到新 seq：

```ts
      // seq 22/24-29 是对账素材单（2026-08-30 加）：跟 1/2/3 一样是普通成功充值，
      // 走同一条 V1_APPROVED → SUCCESS 的路。
      case 1: case 2: case 3:
      case 22: case 24: case 25: case 26: case 27: case 28: case 29:
        await driveVerdict(ctx, dep.id, 'V1_APPROVED');
        dep = await waitDepositStatus(ctx, dep.id, 'SUCCESS');
        break;
```

并在同一个 switch 末尾补 `default`，让这个坑不能再犯：

```ts
      default:
        // fail-closed：花名册加了一行、却忘了在这里给它一条驱动路径时，当场炸，
        // 而不是让那一行悄悄停在 COMPLIANCE_PENDING 里。
        // 2026-08-30 实证：本批加 7 行素材单时踩的正是这个缺口。
        throw new Error(
          `花名册 #${entry.seq}（${entry.label}）在 runDeposits 里没有对应的驱动分支 —— ` +
          '加了花名册行就必须同时在这里给它一条路，否则它会停在 COMPLIANCE_PENDING。',
        );
```

本批 Global Constraints 明写「fail-closed，不许静默降级」，而这个 switch 现在的行为正是静默降级。

- [ ] **Step 4: 从零重铺并跑 demo:all**

```bash
bash scripts/stack.sh down
```

```bash
bash scripts/stack.sh reset self
```

```bash
lsof -ti:3113
```

Expected: 打印一个 pid（`reset` 自己拉起的 TigerBeetle）。用 `kill <pid>` 停掉它，确认 `lsof -ti:3113` 再无输出，然后：

```bash
bash scripts/stack.sh up self
```

```bash
bash scripts/on-stack.sh self demo:all
```

Expected: `花名册 29/29 符合预期` + `asserts: 5/5 PASS` + `demo:all DONE ✅`。

- [ ] **Step 5: 断言两个新客户被完整开通**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT c.email, (SELECT COUNT(*) FROM wallets w WHERE w.ownerId=c.id) wallets, (SELECT COUNT(*) FROM withdrawal_addresses wa WHERE wa.customerId=c.id) addrs FROM customer_main c WHERE c.email IN ('demo_jack@example.com','demo_kate@example.com');"
```

Expected: 两行，`wallets` 都是 `2`，`addrs` 都 `≥1`。

- [ ] **Step 6: 断言四个新钱包与 Grace USDT 都有可镜像流水**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT w.walletNo, c.email, a.code, (SELECT COUNT(*) FROM account_flows af WHERE af.walletRef=w.id AND af.isExternalCrossing=1) crossFlows FROM wallets w JOIN customer_main c ON c.id=w.ownerId JOIN assets a ON a.id=w.assetId WHERE c.email IN ('demo_jack@example.com','demo_kate@example.com','demo_grace@example.com') AND w.ownerType='CUSTOMER' ORDER BY c.email, a.code;"
```

Expected: Jack/Kate 的 AED 与 USDT 四个钱包 `crossFlows` 全部 `>0`；Grace 的 USDT 钱包 `crossFlows` 也 `>0`（原本是 0）。

- [ ] **Step 7: 断言没有新增非终态资金单**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT fo.fundsOrderNo, fo.legSeq, fo.status, wf.walletNo FROM funds_orders fo LEFT JOIN wallets wf ON wf.id=fo.fromWalletId WHERE fo.status NOT IN ('CLEARED','FAILED','CANCELLED');"
```

Expected: **只有花名册 #20 那笔在途提现的两条腿**（同一个 `withdrawTransactionId`，from 是 Alice 的 AED 钱包）。若出现 Jack/Kate/Grace 的钱包，说明素材单留下了非终态腿——**必须查清再往下**，那正是 §6.1 那条硬规则要防的。

- [ ] **Step 8: 提交**

```bash
git add prisma/seed.business.ts scripts/demo-lib.ts scripts/demo-roster.ts
git commit -m "feat(demo): 新增 Jack/Kate 两个交易人设 + 8 行对账素材单"
```

---

### Task 2: 答案键拆两级

**Files:**
- Modify: `scripts/recon-demo.ts`（类型定义区 `InjectionV2`/`ManifestV2`、`verifyManifest`、`main()` 里的打印与断言段）

**Interfaces:**
- Consumes: Task 1 的钱包
- Produces:
  - `type RootCause`（15 个值的联合类型）
  - `interface ScenarioExpectation { scenarioId; rootCause; expectedLines: Array<{walletRef; lineType; amount; externalRef}>; fundsOrderNo?; detail }`
  - `interface WalletExpectation { walletRef; scenarioIds: number[]; expectedBucket; bucketRationale; hasNonTerminalFundsOrder }`
  - `interface ManifestV3 { cutoff: string; scenarios: ScenarioExpectation[]; wallets: WalletExpectation[] }`
  - `verifyManifest(prisma, runId, manifest): Promise<{ scenariosDetected: number; scenariosMissed: string[]; walletsOk: number; walletsMismatched: string[] }>`

**本任务只改机制、不加场景。** 现有 9 条场景原样迁到新形状，跑出来仍是 9/9——用已知good的场景证明新机制没写坏。

- [ ] **Step 1: 换掉类型定义**

把 `scripts/recon-demo.ts` 里 `interface InjectionV2 { ... }` 与 `interface ManifestV2 { ... }` 两块整体替换为：

```ts
// 15-scenario model（2026-08-30 重做）：每个场景重现一个**成因**，成因按
// 「谁错了」分三真相（我方错 / 对方错 / 都没错）——见
// specs/2026-08-30-recon-break-scenarios-design.md §3。
//
// ⚠️ **本轮显式废除了旧的 disjoint-wallet 前提**（旧文件头写着"Each scenario
// targets its own wallet … so cases stay disjoint"）。一个钱包现在可以挂多条
// 场景——现实本来如此，而且"同一个形状三条差异、三种相反处置摆在一屏"是整套
// 演示最值钱的一屏。代价是：**桶是钱包的属性，不再是场景的属性**，故答案键
// 拆成两级。
type RootCause =
  | 'IN_TRANSIT_TIMING'
  | 'FEE_NETTED'
  | 'STATEMENT_MISSING_LINE'
  | 'SCALE_ERROR'
  | 'BANK_CHARGE'
  | 'MISSED_DEPOSIT'
  | 'BANK_INTEREST'
  | 'BANK_RETURN'
  | 'DUPLICATE_DEPOSIT'
  | 'VOIDED_SIGNAL'
  | 'STATEMENT_DUPLICATE_LINE'
  | 'COUNTERPARTY_AMOUNT_ERROR'
  | 'ROUNDING_DIFF'
  | 'CUTOFF_STRADDLE'
  | 'MISROUTED_CREDIT'
  // ⚠️ 场景 9（未归属外部账户）本轮**保留**，Task 4 才退役它——届时连同这一行一起删。
  // 计划初稿把 Task 4 的终态提前塞进了这里，导致 Step 3 的场景 9 迁移编译不过。
  | 'ORPHAN_DEPOSIT';

type LineType = 'IN_TRANSIT' | 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
type Bucket = 'IN_TRANSIT' | 'SOFT_FLAG' | 'BREAK';

/** 每个场景断言：我造出了哪些差异行。 */
interface ScenarioExpectation {
  scenarioId: number;
  rootCause: RootCause;
  /** 绝大多数场景只产生一条；MISROUTED_CREDIT（记错钱包）跨两个钱包，故是数组。 */
  expectedLines: Array<{
    walletRef: string;
    lineType: LineType;
    amount: string;
    externalRef: string | null;
  }>;
  fundsOrderNo?: string;        // IN_TRANSIT_TIMING only
  detail: Record<string, unknown>;
}

/** 每个被注入的钱包断言：它最终落在哪个桶。 */
interface WalletExpectation {
  walletRef: string;
  scenarioIds: number[];
  expectedBucket: Bucket;
  /**
   * 桶是怎么推出来的，供审的人核。**多场景钱包必填且必须写清算式** ——
   * 这个值是人手算的，算错了答案键就是错的，而答案键错的表现是
   * "测试绿着但证明了错的东西"。单场景钱包写一句话即可。
   */
  bucketRationale: string;
  /**
   * 这个钱包上有没有 demo:all 留下的非终态资金单。只有在途场景那个钱包
   * 允许为 true——见 Task 3 的前置闸。
   */
  hasNonTerminalFundsOrder: boolean;
}

interface ManifestV3 {
  cutoff: string;
  scenarios: ScenarioExpectation[];
  wallets: WalletExpectation[];
}
```

- [ ] **Step 2: 重写 verifyManifest**

把整个 `async function verifyManifest(...) { ... }` 替换为：

```ts
// ── Phase 4: 两级校验 ────────────────────────────────────────────────────
//   按场景 —— 每条场景的每一条 expectedLine 都要在本轮 line items 里找得到
//   按钱包 —— 每个被注入的钱包，其 case 的 bucket 要等于期望值
async function verifyManifest(
  prisma: PrismaService,
  runId: string,
  manifest: ManifestV3,
): Promise<{
  scenariosDetected: number;
  scenariosMissed: string[];
  walletsOk: number;
  walletsMismatched: string[];
}> {
  const lineItems = (await (prisma as any).reconciliationLineItem.findMany({
    where: { foundByRunId: runId },
    select: {
      matchStatus: true,
      walletRef: true,
      externalRef: true,
      internalSourceNo: true,
    },
  })) as Array<{
    matchStatus: string;
    walletRef: string | null;
    externalRef: string | null;
    internalSourceNo: string | null;
  }>;

  const cases = (await (prisma as any).reconciliationCase.findMany({
    where: { openedByRunId: runId },
    select: { caseNo: true, walletRef: true, bucket: true },
  })) as Array<{ caseNo: string; walletRef: string | null; bucket: string | null }>;

  // ── 按场景 ──
  const scenariosMissed: string[] = [];
  let scenariosDetected = 0;
  for (const sc of manifest.scenarios) {
    const allLinesHit = sc.expectedLines.every((exp) =>
      lineItems.some(
        (l) => l.matchStatus === exp.lineType
          && l.walletRef === exp.walletRef
          && (exp.externalRef ? l.externalRef === exp.externalRef : true),
      ),
    );
    // 在途场景额外断言：那条 IN_TRANSIT 行必须指向我们造的那张资金单，
    // 否则"认领到了某张在途单"这个绿灯可能来自别的单。
    const fundsOrderHit = sc.fundsOrderNo
      ? lineItems.some(
          (l) => l.matchStatus === 'IN_TRANSIT'
            && l.internalSourceNo === sc.fundsOrderNo,
        )
      : true;
    if (allLinesHit && fundsOrderHit) scenariosDetected += 1;
    else scenariosMissed.push(`scenario#${sc.scenarioId}(${sc.rootCause})`);
  }

  // ── 按钱包 ──
  const walletsMismatched: string[] = [];
  let walletsOk = 0;
  for (const w of manifest.wallets) {
    const c = cases.find((x) => x.walletRef === w.walletRef);
    if (c && c.bucket === w.expectedBucket) walletsOk += 1;
    else {
      walletsMismatched.push(
        `${w.walletRef} expect=${w.expectedBucket} actual=${c?.bucket ?? '(无 case)'} [${w.bucketRationale}]`,
      );
    }
  }

  return { scenariosDetected, scenariosMissed, walletsOk, walletsMismatched };
}
```

- [ ] **Step 3: 把 9 条现有注入迁到新形状**

在 `injectScenarios` 里，把每一处 `injections.push({ scenarioId, rootCause, walletRef, expectedBucket, expectedLineType, amount, externalRef, detail })` 改成两个数组：场景推 `scenarios`，钱包推 `wallets`。函数签名改为返回 `ManifestV3`。

以场景 3（`STATEMENT_MISSING_LINE`）为例，改法逐字如下——**其余 8 条照此办理**：

```ts
    scenarios.push({
      scenarioId: 3,
      rootCause: 'STATEMENT_MISSING_LINE',
      expectedLines: [{
        walletRef: s3Plan.walletRef,
        lineType: 'ORPHAN_INTERNAL',
        amount: candidate.amount.toString(),
        externalRef: candidate.externalRef,
      }],
      detail: {
        deletedExternalLineId: candidate.id,
        direction: candidate.direction,
        prevClosingBalance: prevClose,
        closingBalanceDelta: signedDelta.toString(),
      },
    });
    wallets.push({
      walletRef: s3Plan.walletRef,
      scenarioIds: [3],
      expectedBucket: 'BREAK',
      bucketRationale: '删掉一条外部行并压低同额收盘 → 残差 = 该行金额 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
```

场景 5 与 7 共用一个 FIRM 钱包（对冲对），故它们只推**一条** `wallets` 记录：

```ts
    wallets.push({
      walletRef: s5s7Plan.walletRef,
      scenarioIds: [5, 7],
      expectedBucket: 'SOFT_FLAG',
      bucketRationale: '杂费 −X 与利息 +X 金额相等方向相反 → 残差 = 0；两条孤儿外部行 → 异常数 2 > 0 → SOFT_FLAG',
      hasNonTerminalFundsOrder: false,
    });
```

场景 9（未归属账户）本轮**保持原样**，它的 `expectedLines` 为空数组（引擎对未归属头不跑流水匹配，没有差异行）：

```ts
    scenarios.push({
      scenarioId: 9,
      rootCause: 'ORPHAN_DEPOSIT',
      expectedLines: [],   // 未归属头：引擎故意不跑流水匹配，只有 case 级信号
      detail: { accountRef: DEMO_ORPHAN_ACCOUNT_REF, closingBalance: s9Amount.toString() },
    });
    wallets.push({
      walletRef: DEMO_ORPHAN_ACCOUNT_REF,
      scenarioIds: [9],
      expectedBucket: 'BREAK',
      bucketRationale: '未归属外部账户：无内部面可比，引擎直接开 BREAK case',
      hasNonTerminalFundsOrder: false,
    });
```

⚠️ 场景 1（在途）那条 `wallets` 记录的 `hasNonTerminalFundsOrder` 必须是 **`true`**——它身上挂着花名册 #20 那笔真卡单，这是它的设计前提，不是污染。

- [ ] **Step 4: 改打印与断言段**

`main()` 里 `mode === 'break' && manifest` 那一段，替换为：

```ts
    const v = await verifyManifest(prisma, result.runId, manifest);
    console.log(`\n──── manifest verification ────`);
    for (const sc of manifest.scenarios) {
      const missed = v.scenariosMissed.some((m) => m.startsWith(`scenario#${sc.scenarioId}(`));
      const wallets = Array.from(new Set(sc.expectedLines.map((l) => l.walletRef.slice(0, 8)))).join(',') || '(case-only)';
      console.log(`  #${String(sc.scenarioId).padStart(2)}  ${sc.rootCause.padEnd(26)} wallet=${wallets}  ${missed ? 'MISSED' : 'DETECTED'}`);
    }
    console.log(`  scenarios: ${v.scenariosDetected}/${manifest.scenarios.length} DETECTED`);
    console.log(`  wallets:   ${v.walletsOk}/${manifest.wallets.length} bucket OK`);
    for (const m of v.walletsMismatched) console.log(`    ✗ ${m}`);

    const idn = await assertIdentities(prisma, result.runId);
    console.log(`\n──── identity self-check ────`);
    for (const [label, ok] of idn.checks) console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}`);

    const asserts: Array<[string, boolean]> = [
      ['status==BREAK', result.status === 'BREAK'],
      [`scenarios ${v.scenariosDetected}/${manifest.scenarios.length}`, v.scenariosDetected === manifest.scenarios.length],
      [`wallets ${v.walletsOk}/${manifest.wallets.length}`, v.walletsOk === manifest.wallets.length],
      ['identities OK', idn.ok],
    ];
    // ⚠️ 循环变量必须叫 `pass`、不能叫 `ok` —— 外层有个 `let ok = true`，收尾的
    // `process.exit(ok ? 0 : 1)` 读的就是它；用 `ok` 当循环变量会把它遮蔽掉，断言失败传不出去。
    // pass 分支早就是这么避开的，照抄它。同理**不要用 `process.exitCode = 1`**——
    // 收尾那句显式 `process.exit(0)` 会覆盖它，失败照样退 0。
    console.log(`\n──── break-mode asserts ────`);
    for (const [label, pass] of asserts) {
      console.log(`  ${pass ? 'OK ' : 'BAD'} ${label}`);
      if (!pass) ok = false;
    }
    if (ok) console.log(`\nALL ${manifest.scenarios.length} SCENARIOS DETECTED PER MANIFEST`);
    else console.error('\nASSERT(S) FAILED');
```

⚠️ 旧代码里有一句 `manifest.injections.length === 9` 的硬编码，**必须删掉**——本轮场景数会变，写死 9 会在 Task 5 之后变成假红。

- [ ] **Step 5: 编译 + 跑，确认 9 条原样通过**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 无输出。⚠️ **但这条对 `scripts/recon-demo.ts` 不构成证据**（`include` 只有 `src/**/*`）——
那个文件的类型检查靠下一步 `recon:demo:*` 能不能被 ts-node 启动起来。

```bash
bash scripts/on-stack.sh self recon:demo:reset
```

```bash
bash scripts/on-stack.sh self recon:demo:break
```

Expected: `scenarios: 9/9 DETECTED` + `wallets: 8/8 bucket OK` + 两条 identity `OK` + `ALL 9 SCENARIOS DETECTED PER MANIFEST`。

（钱包数是 8 不是 9：场景 5+7 共用一个 FIRM 钱包，只有一条 `wallets` 记录。）

- [ ] **Step 6: 变异验证——把一个期望桶改错，必须变红**

把场景 3 那条 `wallets` 记录的 `expectedBucket` 从 `'BREAK'` 改成 `'SOFT_FLAG'`，重跑 `recon:demo:break`。

Expected: `wallets: 7/8 bucket OK` + 一行 `✗ <walletRef> expect=SOFT_FLAG actual=BREAK [...]` + `BAD wallets 7/8`，退出码非 0。**确认后改回。**

这一步是必须的：按钱包的桶校验是本轮新写的机制，不做变异验证就不知道它是真在查还是恒绿。

- [ ] **Step 7: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "refactor(demo): 对账答案键拆两级——场景断言差异行、钱包断言桶"
```

---

### Task 3: 注入前置闸（业务数据污染场景）

**Files:**
- Modify: `scripts/recon-demo.ts`（`injectScenarios` 开头）

**Interfaces:**
- Consumes: Task 2 的 `WalletExpectation.hasNonTerminalFundsOrder`
- Produces: `assertTargetWalletsClean(prisma, targets: Array<{ walletRef: string; allowNonTerminal: boolean }>): Promise<void>` —— 不满足直接抛错

**背景（出处 `cfec505f`，claude-43）**：这条防的**不是场景之间撞车**，是**业务数据污染场景**——两个独立的轴。一个钱包上有 `demo:all` 留下的非终态资金单，引擎会（正确地）产生 IN_TRANSIT 行并把桶重判成 BREAK，而答案键期望别的桶。当时的表现是 `demo:all` 全绿、`recon` 报 7/9，**中间没有任何东西说"我挑钱包时妥协了"**。

- [ ] **Step 1: 写前置闸**

在 `scripts/recon-demo.ts` 里 `injectScenarios` 函数之前加：

```ts
/**
 * 注入前置闸（fail-closed）。除了明确允许的钱包（在途场景那个），其余目标钱包
 * 必须没有非终态资金单——有就直接抛错，**不许静默降级**。
 *
 * 为什么必须炸而不是跳过：这类问题最难查的不是它本身，是它静默。demo:all 全绿、
 * recon 报少几个 DETECTED，中间没有任何东西说"我挑钱包时妥协了"。
 * 出处：cfec505f（FIRM 钱包挑选补排除条件）把同一条道理用在了挑钱包上，
 * 这里把它推广成所有目标钱包的前置断言。
 */
async function assertTargetWalletsClean(
  prisma: PrismaService,
  targets: Array<{ walletRef: string; allowNonTerminal: boolean }>,
): Promise<void> {
  const mustBeClean = targets.filter((t) => !t.allowNonTerminal).map((t) => t.walletRef);
  if (mustBeClean.length === 0) return;

  const open = (await (prisma as any).fundsOrder.findMany({
    where: {
      status: { notIn: Array.from(TERMINAL_STATUSES) },
      OR: [
        { fromWalletId: { in: mustBeClean } },
        { toWalletId: { in: mustBeClean } },
      ],
    },
    select: { fundsOrderNo: true, status: true, fromWalletId: true, toWalletId: true },
  })) as Array<{ fundsOrderNo: string; status: string; fromWalletId: string | null; toWalletId: string | null }>;

  if (open.length === 0) return;

  const detail = open
    .map((o) => `${o.fundsOrderNo}(${o.status}) from=${o.fromWalletId ?? '-'} to=${o.toWalletId ?? '-'}`)
    .join('; ');
  throw new Error(
    `注入前置闸：${open.length} 笔非终态资金单落在本不该有在途的目标钱包上 —— ${detail}\n` +
    '在途识别会认领它们并把这些钱包的桶重判成 BREAK，答案键就不再成立。\n' +
    '处理：要么把该场景挪到别的钱包，要么在 WalletExpectation 里把 hasNonTerminalFundsOrder 设为 true 并相应改期望桶。',
  );
}
```

`TERMINAL_STATUSES` 已在文件顶部 import（`cfec505f` 引入）；若不在，补：

```ts
import { TERMINAL_STATUSES } from '../src/modules/funds-orders/constants/funds-order-transitions.constant';
```

- [ ] **Step 2: 在注入前调用它**

在 `injectScenarios` 里、所有钱包挑选完成之后、第一个场景注入之前插入：

```ts
  // 前置闸：目标钱包不得带非终态资金单（在途场景那个除外——它就是靠真卡单的）。
  await assertTargetWalletsClean(prisma, [
    { walletRef: stuck.walletRef,     allowNonTerminal: true  },   // 在途场景，卡单是它的设计前提
    { walletRef: s2Plan.walletRef,    allowNonTerminal: false },
    { walletRef: s3Plan.walletRef,    allowNonTerminal: false },
    { walletRef: s4Plan.walletRef,    allowNonTerminal: false },
    { walletRef: s6Plan.walletRef,    allowNonTerminal: false },
    { walletRef: s8Plan.walletRef,    allowNonTerminal: false },
    { walletRef: s5s7Plan.walletRef,  allowNonTerminal: false },
  ]);
```

（Task 4 重排钱包之后，这张表要跟着更新成新的目标钱包清单。）

- [ ] **Step 3: 跑一遍确认没误伤**

```bash
bash scripts/on-stack.sh self recon:demo:reset
```

```bash
bash scripts/on-stack.sh self recon:demo:break
```

Expected: 照常 `scenarios: 9/9` + `wallets: 8/8`，前置闸静默通过（不打印任何东西）。

- [ ] **Step 4: 变异验证——把在途那个钱包也标成"不许有在途"，必须炸**

把上面那张表里 `stuck.walletRef` 那行的 `allowNonTerminal` 从 `true` 改成 `false`，重跑。

Expected: 脚本**抛错退出**，错误信息里列出花名册 #20 那两条腿的单号与状态。**确认后改回。**

这一步证明闸门真的在查，而不是恒真通过。

- [ ] **Step 5: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "feat(demo): 注入前置闸——目标钱包不得带非终态资金单，fail-closed"
```

---

### Task 4: 钱包重排 + 退役归属场景 + 修退汇数据

**Files:**
- Modify: `scripts/recon-demo.ts`（钱包挑选段、场景 8、场景 9、文件头注释）

**Interfaces:**
- Consumes: Task 1 的 Jack/Kate 钱包、Task 2 的 `ManifestV3`、Task 3 的前置闸
- Produces: 按 spec §4.2 分配的钱包句柄，供 Task 5-8 使用：`slotInTransit`（在途；⚠️ 真实变量名是这个，**不要写成 `slotAlice`**——它从 `stuck.walletRef` 反查）、`slotShowcaseA`（Grace AED）、`slotShowcaseB`（Frank AED）、`slotShowcaseC`（Bob USDT）、`slotFeeNetted`（Bob AED）、`slotReturn`（Alice USDT）、`slotCutoff`（Grace USDT）、`slotMisroutedFrom`（Jack AED）、`slotMisroutedTo`（Kate AED）

- [ ] **Step 1: 按 owner + 资产显式挑钱包，取代轮转分配**

把现有那段 `const [s2Plan, s3Plan, s4Plan, s6Plan, s8Plan] = picks;` 的轮转挑选整块替换为按人设显式定位（钱包分配是设计的一部分，不该由遍历顺序决定）：

```ts
  // 钱包分配按 specs/2026-08-30-recon-break-scenarios-design.md §4.2 显式指定。
  // 不再用轮转挑选：一个钱包挂哪些场景是设计决策，让遍历顺序决定它，等于
  // 演示内容随数据顺序漂移，而且展示位（同形不同真相摆一屏）根本没法安排。
  const planByOwnerAsset = (ownerNo: string, assetCode: string): WalletPlan => {
    const p = plans.find((x) => x.ownerNo === ownerNo && x.currency === assetCode && x.walletKind === 'CUSTOMER');
    if (!p) throw new Error(`找不到 ${ownerNo} 的 ${assetCode} 客户钱包 —— demo:all 是否跑过？花名册是否含该客户的素材单？`);
    return p;
  };
  const emailToNo = async (email: string): Promise<string> => {
    const c = await (prisma as any).customerMain.findUnique({ where: { email }, select: { customerNo: true } });
    if (!c) throw new Error(`客户不存在：${email}`);
    return c.customerNo;
  };

  const ALICE_NO = await emailToNo('demo_alice@example.com');
  const BOB_NO   = await emailToNo('demo_bob@example.com');
  const GRACE_NO = await emailToNo('demo_grace@example.com');
  const FRANK_NO = await emailToNo('demo_frank@example.com');
  const JACK_NO  = await emailToNo('demo_jack@example.com');
  const KATE_NO  = await emailToNo('demo_kate@example.com');

  // ⚠️ 在途那个钱包**必须从卡单 fixture 推出来，不能按 owner 猜**：场景 ① 用的是
  // createStuckWithdraw 造的那笔真卡单（变量 `stuck`），它挂在哪个钱包由花名册
  // #20 决定。按 owner 硬猜今天恰好一致，但花名册一改就会**静默分叉**——场景 ①
  // 指着 A 钱包、前置闸放行的是 B 钱包。
  const slotInTransit = plans.find((p) => p.walletRef === stuck.walletRef);
  if (!slotInTransit) throw new Error(`在途场景的钱包不在 plans 里：${stuck.walletRef}`);

  const slotShowcaseA     = planByOwnerAsset(GRACE_NO, 'AED');        // 展示位甲：金额不对三真相 ④⑩⑪
  const slotShowcaseB     = planByOwnerAsset(FRANK_NO, 'AED');        // 展示位乙：我有外无三真相 ③⑦⑧
  const slotShowcaseC     = planByOwnerAsset(BOB_NO,   'USDT-TRON');  // 展示位丙：外有我无两真相 ⑤⑨
  const slotFeeNetted     = planByOwnerAsset(BOB_NO,   'AED');        // ② 手续费轧差
  const slotReturn        = planByOwnerAsset(ALICE_NO, 'USDT-TRON');  // ⑥ 退汇
  const slotCutoff        = planByOwnerAsset(GRACE_NO, 'USDT-TRON');  // ⑫ 跨日切
  const slotMisroutedFrom = planByOwnerAsset(JACK_NO,  'AED');        // ⑬ 记错钱包 · 发出端
  const slotMisroutedTo   = planByOwnerAsset(KATE_NO,  'AED');        // ⑬ 记错钱包 · 接收端
```

⚠️ `planByOwnerAsset` 用的 `currency` 字段在 `WalletPlan` 上是资产 **code**（AED / USDT-TRON），不是 currency（AED / USDT）——这两个在加密币上不同，用错会找不到钱包。跟 `planWallets` 里的取值口径核对一遍再写。

原来的 `s2Plan/s3Plan/s4Plan/s6Plan/s8Plan/s5s7Plan` 六个变量按下表改名引用：

| 旧 | 新 | 场景 |
|---|---|---|
| （场景 ① 无 plan 变量，直接用 `stuck.walletRef`） | `slotInTransit`（上面按 `stuck.walletRef` 反查） | ① |
| `s2Plan` | `slotFeeNetted` | ② |
| `s3Plan` | `slotShowcaseB` | ③ |
| `s4Plan` | `slotShowcaseA` | ④ |
| `s6Plan` | `slotShowcaseC` | ⑤ |
| `s8Plan` | `slotReturn` | ⑥（原 8） |
| `s5s7Plan` | 不变（FIRM 钱包挑选逻辑保留） | ⑭⑮（原 5/7） |

- [ ] **Step 2: 场景编号对齐 spec**

原场景 6（MISSED_DEPOSIT）改编号为 **⑤**，原场景 8（BANK_RETURN）改编号为 **⑥**，原场景 5/7（BANK_CHARGE/BANK_INTEREST）改编号为 **⑭/⑮**。改的是 `scenarioId` 字段，`rootCause` 字符串不变。

- [ ] **Step 3: 删掉归属场景**

删除 `// ── Scenario 9 — 孤儿充值 ...` 整块（含它的 `scenarios.push` 与 `wallets.push`）。同时删除常量 `DEMO_ORPHAN_ACCOUNT_REF`（先 `grep -n DEMO_ORPHAN_ACCOUNT_REF scripts/recon-demo.ts` 确认再无引用）。

⚠️ **只删种子注入。** `wallet-recon-run.service.ts` 的 `unattributedBalances` 分支与它的单测（`wallet-recon-run.service.spec.ts` 「无主外部余额头（walletRef=null）→ 开 BREAK case（caseReason=unattributed_external_account…）」）**保留不动**——真遇到未归属账户照样开案子，只是演示里不铺这个局。

- [ ] **Step 4: 把退汇场景改成自洽的**

现有退汇造了一进一出净额为零的两条行，又单独把外部收盘压低同额——现实里没有事件同时产生这两样。改成：**银行把一笔已入账的充值退了回去**，即只加一条 OUT 幽灵行 + 压低同额收盘。

把 `// ── Scenario 8 — 退汇 ...` 整块的注入体替换为：

```ts
  // ── 场景 ⑥ — 退汇 (BREAK / ORPHAN_EXTERNAL / 客户账簿) ──────────────────
  // 一笔已经入过账的钱被银行退了回去：银行对账单上多出一条 OUT，我方账上
  // 还留着那笔入账。→ 外有我无 + 余额差。
  // ⚠️ 2026-08-30 重写：旧版造了一进一出净额为零的两条行，又单独把收盘压低
  // 同额——现实里没有哪个事件同时产生这两样（旧 spec §8 短板 1 已登记）。
  {
    const s6Amount = D('4700');   // 分 —— USDT 0.004700
    const outRef = refFor(slotReturn.currency, 'RETURNOUT');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotReturn.currency),
        accountRef: slotReturn.walletRef,
        subAccount: slotReturn.walletRef,
        book: slotReturn.book,
        currency: slotReturn.currency,
        direction: 'OUT',
        amount: s6Amount,
        externalRef: outRef,
        datetime: cutoff,
        description: 'Demo bank return — a previously credited deposit was clawed back',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotReturn.walletRef}-s6-bank-return`,
      },
    });
    const prevClose = await bumpClosing(slotReturn, s6Amount.negated());
    scenarios.push({
      scenarioId: 6,
      rootCause: 'BANK_RETURN',
      expectedLines: [{
        walletRef: slotReturn.walletRef,
        lineType: 'ORPHAN_EXTERNAL',
        amount: s6Amount.toString(),
        externalRef: outRef,
      }],
      detail: {
        insertedExternalLineId: created.id,
        prevClosingBalance: prevClose,
        closingBalanceDelta: s6Amount.negated().toString(),
      },
    });
    wallets.push({
      walletRef: slotReturn.walletRef,
      scenarioIds: [6],
      expectedBucket: 'BREAK',
      bucketRationale: '加一条 OUT 幽灵行并压低同额收盘 → 残差 = −该行金额 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }
```

- [ ] **Step 5: 更新前置闸的目标钱包清单**

把 Task 3 Step 2 那张表换成新的九个 slot：

```ts
  await assertTargetWalletsClean(prisma, [
    { walletRef: slotInTransit.walletRef,     allowNonTerminal: true  },
    { walletRef: slotShowcaseA.walletRef,     allowNonTerminal: false },
    { walletRef: slotShowcaseB.walletRef,     allowNonTerminal: false },
    { walletRef: slotShowcaseC.walletRef,     allowNonTerminal: false },
    { walletRef: slotFeeNetted.walletRef,     allowNonTerminal: false },
    { walletRef: slotReturn.walletRef,        allowNonTerminal: false },
    { walletRef: slotCutoff.walletRef,        allowNonTerminal: false },
    { walletRef: slotMisroutedFrom.walletRef, allowNonTerminal: false },
    { walletRef: slotMisroutedTo.walletRef,   allowNonTerminal: false },
    { walletRef: s5s7Plan.walletRef,          allowNonTerminal: false },
  ]);
```

- [ ] **Step 6: 改文件头注释**

文件头那段场景清单（`//   --mode=break   ... 1. IN_TRANSIT_TIMING ... 9. ORPHAN_DEPOSIT`）与下面那句 disjoint 前提，整体改写：

```
//   --mode=break   Pass-mode setup, then inject 15 scenarios covering the
//                  root-cause matrix (see specs/2026-08-30-recon-break-
//                  scenarios-design.md §3) and write `manifest.json`.
//                  成因按「谁错了」分三真相：
//                    金额不对   ④我方小数点错 ⑩对方记错 ⑪舍入精度
//                    我有外无   ⑦我方重复入账 ⑧假信号 ③银行漏报 ⑫跨日切
//                    外有我无   ⑤漏监听充值 ⑨对账单重复行 ⑥退汇
//                    在途       ①在途时序差
//                    公司补记   ⑭银行杂费 ⑮银行利息
//                    跨钱包     ⑬记错钱包
//                    净额口径   ②手续费轧差
//
//                  ⚠️ **旧的 disjoint-wallet 前提已于 2026-08-30 显式废除。**
//                  一个钱包现在可以挂多条场景（三个展示位就是靠这个：同一个
//                  形状三条差异、三种相反处置摆在一屏）。因此**桶是钱包的属性、
//                  不是场景的属性**，答案键拆两级：场景断言差异行，钱包断言桶。
```

这一步不是可选的：留着一句已经不成立的前提，下一个人会照着它做判断——本仓库刚在 C_CMA 那两句注释上栽过同一个跟头。

- [ ] **Step 7: 跑，确认仍是 8 条 9 个钱包**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 无输出。⚠️ **但这条对 `scripts/recon-demo.ts` 不构成证据**（`include` 只有 `src/**/*`）——
那个文件的类型检查靠下一步 `recon:demo:*` 能不能被 ts-node 启动起来。

```bash
bash scripts/on-stack.sh self recon:demo:reset
```

```bash
bash scripts/on-stack.sh self recon:demo:break
```

Expected: `scenarios: 8/8 DETECTED`（归属那条已退役）+ `wallets: 7/7 bucket OK` + identity 全 OK。

- [ ] **Step 8: 断言引擎的未归属分支单测仍然绿**

```bash
npx jest src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run --silent
```

Expected: PASS，含「无主外部余额头（walletRef=null）→ 开 BREAK case」那条。**它必须还在**——本轮删的是种子注入，不是引擎能力。

- [ ] **Step 9: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "refactor(demo): 钱包按人设显式分配、退役归属场景、退汇数据改自洽"
```

---

### Task 5: 展示位甲 —— 金额不对的三种真相

**Files:**
- Modify: `scripts/recon-demo.ts`（场景 ④ 所在块）

**Interfaces:**
- Consumes: Task 4 的 `slotShowcaseA`（Grace AED）
- Produces: 场景 ⑩ `COUNTERPARTY_AMOUNT_ERROR`、⑪ `ROUNDING_DIFF`

- [ ] **Step 1: 把 ④ 改成挑三条不同的行，注入三种金额错**

把原 `SCALE_ERROR` 那一块整体替换为：

```ts
  // ── 展示位甲 · 同样是「金额不对」，三种相反的真相 ───────────────────────
  // ④ 我方小数点错位   → 我方错   → 冲正（改我方的账）
  // ⑩ 对方金额记错     → 对方错   → 不该动账（该找银行）
  // ⑪ 舍入精度差       → 都没错   → 不该动账（该豁免，豁免没做故今天无出口）
  // 三条形状完全相同、处置完全不同——这一屏是整套演示最值钱的地方之一。
  {
    const lines = (await (prisma as any).externalStatementLine.findMany({
      where: { subAccount: slotShowcaseA.walletRef },
      orderBy: { datetime: 'asc' },
      take: 3,
    })) as Array<{ id: string; direction: string; amount: Prisma.Decimal; externalRef: string | null }>;
    if (lines.length < 3) {
      throw new Error(
        `展示位甲需要 ≥3 条外部行，实际 ${lines.length} 条（钱包 ${slotShowcaseA.walletRef}）—— ` +
        '花名册给 Grace 的 AED 单是否被改少了？',
      );
    }

    // ④ 小数点错位：我方把金额记成了 1/100（外部才是对的）→ 外部 − 内部 = +99×内部
    const [l4, l10, l11] = lines;
    const s4New = l4.amount.mul(100);
    await (prisma as any).externalStatementLine.update({ where: { id: l4.id }, data: { amount: s4New } });
    const s4Delta = s4New.minus(l4.amount);
    const s4Prev = await bumpClosing(slotShowcaseA, l4.direction === 'IN' ? s4Delta : s4Delta.negated());

    // ⑩ 对方金额记错：银行把金额打错了，我方账是对的 → 差一个固定小额
    const s10Delta = D('333');
    const s10New = l10.amount.plus(s10Delta);
    await (prisma as any).externalStatementLine.update({ where: { id: l10.id }, data: { amount: s10New } });
    const s10Prev = await bumpClosing(slotShowcaseA, l10.direction === 'IN' ? s10Delta : s10Delta.negated());

    // ⑪ 舍入精度差：双方舍入规则不同造成的固定尾差，谁都没错
    const s11Delta = D('2');
    const s11New = l11.amount.plus(s11Delta);
    await (prisma as any).externalStatementLine.update({ where: { id: l11.id }, data: { amount: s11New } });
    const s11Prev = await bumpClosing(slotShowcaseA, l11.direction === 'IN' ? s11Delta : s11Delta.negated());

    scenarios.push({
      scenarioId: 4,
      rootCause: 'SCALE_ERROR',
      expectedLines: [{ walletRef: slotShowcaseA.walletRef, lineType: 'AMOUNT_MISMATCH', amount: s4New.toString(), externalRef: l4.externalRef }],
      detail: { lineId: l4.id, internalAmount: l4.amount.toString(), externalAmount: s4New.toString(), prevClosingBalance: s4Prev },
    });
    scenarios.push({
      scenarioId: 10,
      rootCause: 'COUNTERPARTY_AMOUNT_ERROR',
      expectedLines: [{ walletRef: slotShowcaseA.walletRef, lineType: 'AMOUNT_MISMATCH', amount: s10New.toString(), externalRef: l10.externalRef }],
      detail: { lineId: l10.id, internalAmount: l10.amount.toString(), externalAmount: s10New.toString(), prevClosingBalance: s10Prev },
    });
    scenarios.push({
      scenarioId: 11,
      rootCause: 'ROUNDING_DIFF',
      expectedLines: [{ walletRef: slotShowcaseA.walletRef, lineType: 'AMOUNT_MISMATCH', amount: s11New.toString(), externalRef: l11.externalRef }],
      detail: { lineId: l11.id, internalAmount: l11.amount.toString(), externalAmount: s11New.toString(), prevClosingBalance: s11Prev },
    });
    wallets.push({
      walletRef: slotShowcaseA.walletRef,
      scenarioIds: [4, 10, 11],
      expectedBucket: 'BREAK',
      bucketRationale:
        '三条金额差同时存在：④ 外部−内部 = 99×原额、⑩ +333、⑪ +2（方向按各自行的 IN/OUT 计入收盘）。' +
        '三者之和恒 ≠ 0（④ 一项就远大于其余两项之和），且无在途 → 残差 ≠ 0 → BREAK。',
    hasNonTerminalFundsOrder: false,
    });
  }
```

- [ ] **Step 2: 跑，确认 10 条场景**

```bash
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break
```

Expected: `scenarios: 10/10 DETECTED`、`wallets: 7/7 bucket OK`、identity 全 OK。

- [ ] **Step 3: 人工确认三条差异行同在一屏**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT c.caseNo, li.matchStatus, li.internalAmount, li.externalAmount FROM reconciliation_line_items li JOIN reconciliation_cases c ON c.id=li.caseId WHERE c.walletRef=(SELECT w.id FROM wallets w JOIN customer_main cm ON cm.id=w.ownerId JOIN assets a ON a.id=w.assetId WHERE cm.email='demo_grace@example.com' AND a.code='AED');"
```

Expected: 同一个 caseNo 下**三条 `AMOUNT_MISMATCH`**，内外金额各不相同。

- [ ] **Step 4: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "feat(demo): 展示位甲——金额不对的三种真相（我方错/对方错/都没错）"
```

---

### Task 6: 展示位乙 —— 我有外无的三种真相（含唯一一次写账本）

**Files:**
- Modify: `scripts/recon-demo.ts`（场景 ③ 所在块）

**Interfaces:**
- Consumes: Task 4 的 `slotShowcaseB`（Frank AED）
- Produces: 场景 ⑦ `DUPLICATE_DEPOSIT`、⑧ `VOIDED_SIGNAL`

**这是 15 条里唯一会写账本的注入。** 要让"重复"在屏幕上看得出来，必须有两笔同 `externalRef` 的内部流水——匹配器 Pass 1 按 ref 配对，一笔匹配上、另一笔成孤儿，**两行同 ref 同额**。这个"孤儿在已匹配列表里有个同号双胞胎"就是重复入账的铁证；③⑧ 的孤儿没有双胞胎。

- [ ] **Step 1: 补 import**

`scripts/recon-demo.ts` 顶部补（四个常量分散在三个文件，已核实；现有 import 里一个都没有）：

```ts
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
```

`injectScenarios` 的参数加 `accounting: AccountingService`，在 `main()` 的调用处传 `app.get(AccountingService)`。

- [ ] **Step 2: 注入三条**

把原 `STATEMENT_MISSING_LINE` 那一块整体替换为：

```ts
  // ── 展示位乙 · 同样是「我有外无」，三种相反的真相 ───────────────────────
  // ③ 银行漏报明细   → 对方错 → 不该动账（我方账是对的）
  // ⑦ 我方重复入账   → 我方错 → 冲销
  // ⑧ 假信号入账     → 我方错 → 冲销
  // ⑦ 的可辨识证据：它的孤儿行在**已匹配列表里有个同 ref 同额的双胞胎**
  // （银行报一笔、我方入两笔），③⑧ 的孤儿没有。这是整套演示最值钱的对照。
  {
    const lines = (await (prisma as any).externalStatementLine.findMany({
      where: { subAccount: slotShowcaseB.walletRef },
      orderBy: { datetime: 'asc' },
      take: 3,
    })) as Array<{ id: string; direction: string; amount: Prisma.Decimal; externalRef: string | null }>;
    if (lines.length < 3) {
      throw new Error(`展示位乙需要 ≥3 条外部行，实际 ${lines.length} 条（钱包 ${slotShowcaseB.walletRef}）`);
    }
    const [l3, lDup, l8] = lines;

    // ③ 银行漏报明细：删掉一条外部行 + 压低同额收盘（我方账是对的）
    await (prisma as any).externalStatementLine.delete({ where: { id: l3.id } });
    const s3Signed = l3.direction === 'IN' ? l3.amount.negated() : l3.amount;
    const s3Prev = await bumpClosing(slotShowcaseB, s3Signed);

    // ⑧ 假信号入账：我方收到一个假的入账信号并入了账，银行那边根本没这笔
    await (prisma as any).externalStatementLine.delete({ where: { id: l8.id } });
    const s8Signed = l8.direction === 'IN' ? l8.amount.negated() : l8.amount;
    const s8Prev = await bumpClosing(slotShowcaseB, s8Signed);

    // ⑦ 我方重复入账：银行报了一笔（lDup 保留不动），我方账上再入一笔同 ref 的。
    // ⚠️ 固定 sourceNo 保证可重跑：TB 的 transfer id 是 (sourceType, sourceNo,
    // eventCode) 的确定性哈希，重跑时判为已存在直接跳过，不会二次入账。
    // ⚠️ recon:demo:reset **不回滚账本**（它只清外部数据与 WALLET_V1 的 run/case），
    // 彻底归零要走 stack.sh reset self（会重建 TigerBeetle）。
    const dupLedger = TB_LEDGERS[slotShowcaseB.currency === 'AED' ? 'AED' : 'USDT'];
    const owner = await (prisma as any).customerMain.findUnique({
      where: { customerNo: slotShowcaseB.ownerNo! }, select: { id: true },
    });
    if (!owner) throw new Error(`找不到展示位乙钱包的客户：${slotShowcaseB.ownerNo}`);
    const clientAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger: dupLedger, ownerType: 'SYSTEM' });
    const suspenseId    = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger: dupLedger, ownerType: 'CUSTOMER', ownerUuid: owner.id });
    const payableId     = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger: dupLedger, ownerType: 'CUSTOMER', ownerUuid: owner.id });
    const dupSourceNo = `DEMO-DUP-${cutoffDate}-${slotShowcaseB.walletRef.slice(0, 8)}`;
    const dupAmount = BigInt(lDup.amount.toFixed(0));

    await accounting.executeTransfer({
      debitAccountId: clientAssetId, creditAccountId: suspenseId, amount: dupAmount, ledger: dupLedger,
      code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: dupSourceNo, eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        assetCurrency: slotShowcaseB.currency, traceId: dupSourceNo,
        actorType: 'SYSTEM', actorId: 'RECON_DEMO',
        memo: 'Demo duplicate deposit — bank reported ONE credit, our books took it twice',
        debitWalletRef: slotShowcaseB.walletRef, creditWalletRef: slotShowcaseB.walletRef,
        isExternalCrossing: true,           // 这一腿要参与流水匹配
        externalRef: lDup.externalRef,      // 与银行那条同 ref → 一笔匹配、一笔成孤儿
        effectiveDate: cutoffDate,
      },
    });
    await accounting.executeTransfer({
      debitAccountId: suspenseId, creditAccountId: payableId, amount: dupAmount, ledger: dupLedger,
      code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: dupSourceNo, eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
        creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
        assetCurrency: slotShowcaseB.currency, traceId: dupSourceNo,
        actorType: 'SYSTEM', actorId: 'RECON_DEMO',
        memo: 'Demo duplicate deposit (reclass)',
        debitWalletRef: slotShowcaseB.walletRef, creditWalletRef: slotShowcaseB.walletRef,
        isExternalCrossing: false,          // 纯账面重分类，不参与匹配
        effectiveDate: cutoffDate,
      },
    });

    // ⚠️⚠️ 排他钉行键——**不加这个，本任务交付的那一刻就把 Task 5 刚堵上的洞
    // 在 Frank 的钱包上原样重挖一遍**（2026-08-30 复审拿真实库数据实测：Frank
    // 的 AED 钱包三笔充值共用同一个 `externalRef = ZB20260830275C7FCE5B`，
    // 与 Grace 钱包完全相同的撞号前提）。③⑦⑧ 三条的 (matchStatus, walletRef,
    // externalRef) 三元组字面全同，不钉行就会退化成"同一句话问三遍"：谁的注入
    // 被写坏都不会被发现，只要另外两条还活着，脚本照样全绿退出 0。
    // 见 Global Constraints 里那条 🔴，以及 Task 5 的 ④⑩⑪ 写法。
    //
    // ③⑧ 的键是确定的：它们把自己的外部行删了，对应的内部流水直接变孤儿，
    // 取 planWallets 排出的同位置 sourceFlowId 即可（与上面 [l3,lDup,l8] 同序）。
    const [plB3, , plB8] = slotShowcaseB.lines;
    //
    // ⑦ 不一样，**它是本批唯一一个键要反查的**：lDup 的外部行没删，而内部侧
    // 现在有两笔同 ref 的流水（原始那笔 + 我们刚造的这笔）。匹配器会配走一笔、
    // 剩一笔成孤儿——**成孤儿的应当是后造的这笔**（原始那笔 createdAt 更早）。
    // 所以键要按 dupSourceNo 把刚造的 account_flow 反查回来：
    const dupFlow = (await (prisma as any).accountFlow.findFirst({
      where: { sourceNo: dupSourceNo, walletId: slotShowcaseB.walletRef },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })) as { id: string } | null;
    if (!dupFlow) throw new Error(`⑦ 反查不到刚造的重复入账流水：sourceNo=${dupSourceNo}`);
    // ⚠️ 如果 ⑦ 判了 MISSED 而 ③⑧ 正常，**先别怀疑注入写坏了**——那说明匹配器
    // 把原始那笔当成了孤儿、把重复那笔配走了，即"谁跟外部行配对"和这里的假设
    // 相反。那是关于匹配器行为的真实发现，报上来，不要改成"两个 id 试一个"糊过去。

    scenarios.push({
      scenarioId: 3, rootCause: 'STATEMENT_MISSING_LINE',
      expectedLines: [{
        walletRef: slotShowcaseB.walletRef, lineType: 'ORPHAN_INTERNAL',
        amount: l3.amount.toString(), externalRef: l3.externalRef,
        internalSourceId: plB3.sourceFlowId,
      }],
      detail: { deletedExternalLineId: l3.id, prevClosingBalance: s3Prev },
    });
    scenarios.push({
      scenarioId: 7, rootCause: 'DUPLICATE_DEPOSIT',
      expectedLines: [{
        walletRef: slotShowcaseB.walletRef, lineType: 'ORPHAN_INTERNAL',
        amount: lDup.amount.toString(), externalRef: lDup.externalRef,
        internalSourceId: dupFlow.id,
      }],
      detail: { dupSourceNo, bankReportedTimes: 1, bookedTimes: 2, sharedExternalRef: lDup.externalRef },
    });
    scenarios.push({
      scenarioId: 8, rootCause: 'VOIDED_SIGNAL',
      expectedLines: [{
        walletRef: slotShowcaseB.walletRef, lineType: 'ORPHAN_INTERNAL',
        amount: l8.amount.toString(), externalRef: l8.externalRef,
        internalSourceId: plB8.sourceFlowId,
      }],
      detail: { deletedExternalLineId: l8.id, prevClosingBalance: s8Prev },
    });
    wallets.push({
      walletRef: slotShowcaseB.walletRef,
      scenarioIds: [3, 7, 8],
      expectedBucket: 'BREAK',
      bucketRationale:
        '③⑧ 各删一条外部行并压低同额收盘（外部少了两条的金额）；⑦ 内部多入一笔而外部不变（内部多了一笔）。' +
        '三者都把「外部 − 内部」推向负，和恒 ≠ 0，且无在途 → 残差 ≠ 0 → BREAK。',
      hasNonTerminalFundsOrder: false,
    });
  }
```

- [ ] **Step 3: 跑，确认 12 条**

```bash
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break
```

Expected: `scenarios: 12/12 DETECTED`、`wallets: 7/7 bucket OK`、identity 全 OK。

- [ ] **Step 4: 断言"双胞胎"证据真的在**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT li.matchStatus, li.externalRef, li.internalAmount FROM reconciliation_line_items li JOIN reconciliation_cases c ON c.id=li.caseId JOIN wallets w ON w.id=c.walletRef JOIN customer_main cm ON cm.id=w.ownerId JOIN assets a ON a.id=w.assetId WHERE cm.email='demo_frank@example.com' AND a.code='AED' ORDER BY li.lineNo;"
```

Expected: 三条 `ORPHAN_INTERNAL`。其中 ⑦ 那条的 `externalRef` 必须与该钱包**已匹配**行里某一条的 ref 相同——用下面这条核：

```bash
sqlite3 /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT COUNT(*) FROM account_flows WHERE sourceNo LIKE 'DEMO-DUP-%' AND isExternalCrossing=1;"
```

Expected: `1`（重复入账那笔的外部穿越腿；重分类腿 crossing=false 不计）。

- [ ] **Step 5: 幂等确认——再跑一次，账本不许二次入账**

```bash
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break
```

```bash
sqlite3 /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT COUNT(*) FROM account_flows WHERE sourceNo LIKE 'DEMO-DUP-%';"
```

Expected: 与第一次跑完之后**数字一致**（固定 sourceNo → TB 判为已存在跳过）。

- [ ] **Step 6: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "feat(demo): 展示位乙——我有外无的三种真相，含唯一一次写账本的重复入账"
```

---

### Task 7: 展示位丙 + 跨日切

**Files:**
- Modify: `scripts/recon-demo.ts`（场景 ⑤ 所在块；新增 ⑫）

**Interfaces:**
- Consumes: Task 4 的 `slotShowcaseC`（Bob USDT）、`slotCutoff`（Grace USDT）
- Produces: 场景 ⑨ `STATEMENT_DUPLICATE_LINE`、⑫ `CUTOFF_STRADDLE`

- [ ] **Step 1: 展示位丙加 ⑨**

在原 `MISSED_DEPOSIT`（现 ⑤）那一块的 `scenarios.push` 之后、`wallets.push` 之前，插入 ⑨ 的注入，并把两条合成一条 `wallets` 记录：

```ts
    // ⑨ 对账单重复行：银行把同一笔报了两次，我方账是对的 → 复制一条现有行 + 抬高同额收盘
    const dupSrc = (await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotShowcaseC.walletRef, direction: 'IN' },
      orderBy: { datetime: 'asc' },
    })) as { id: string; amount: Prisma.Decimal; externalRef: string | null; direction: string; datetime: Date; description: string | null } | null;
    if (!dupSrc) throw new Error(`展示位丙需要 ≥1 条 IN 方向外部行（钱包 ${slotShowcaseC.walletRef}）`);
    const s9Ref = refFor(slotShowcaseC.currency, 'DUPLINE');
    const s9Created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotShowcaseC.currency),
        accountRef: slotShowcaseC.walletRef,
        subAccount: slotShowcaseC.walletRef,
        book: slotShowcaseC.book,
        currency: slotShowcaseC.currency,
        direction: 'IN',
        amount: dupSrc.amount,
        externalRef: s9Ref,
        datetime: cutoff,
        description: 'Demo statement duplicate — bank reported the same credit twice',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotShowcaseC.walletRef}-s9-duplicate-line`,
      },
    });
    const s9Prev = await bumpClosing(slotShowcaseC, dupSrc.amount);
    scenarios.push({
      scenarioId: 9,
      rootCause: 'STATEMENT_DUPLICATE_LINE',
      expectedLines: [{ walletRef: slotShowcaseC.walletRef, lineType: 'ORPHAN_EXTERNAL', amount: dupSrc.amount.toString(), externalRef: s9Ref }],
      detail: { copiedFromLineId: dupSrc.id, insertedExternalLineId: s9Created.id, prevClosingBalance: s9Prev },
    });
```

`wallets.push` 改成：

```ts
    wallets.push({
      walletRef: slotShowcaseC.walletRef,
      scenarioIds: [5, 9],
      expectedBucket: 'BREAK',
      bucketRationale:
        '⑤ 加一条幽灵 IN 行并抬高同额收盘、⑨ 复制一条 IN 行并抬高同额收盘 —— 两者都把「外部 − 内部」推向正，' +
        '和恒 ≠ 0，且无在途 → 残差 ≠ 0 → BREAK。',
      hasNonTerminalFundsOrder: false,
    });
```

⚠️ ⑨ 用**新 ref** 而不是复制原 ref：若两条外部行同 ref，匹配器 Pass 1 会把其中一条与内部流水配上、另一条留孤儿，结果一样；但用新 ref 让答案键能精确定位是哪一条，避免"配上的到底是原行还是复制行"的不确定。

- [ ] **Step 2: 加 ⑫ 跨日切（新杠杆，唯一不碰收盘的）**

在展示位丙那一块之后插入：

```ts
  // ── ⑫ 跨日切 (SOFT_FLAG / ORPHAN_INTERNAL / 客户账簿) ────────────────────
  // 对方按它的营业日切账、我方按 UTC：一笔真实发生的流水落在了对方的下一个
  // 营业日，本期对账单上没有它。→ 我方有、外部本期没有。
  //
  // ⚠️ **这是唯一不碰收盘的场景**：收盘是对方给的一个数、本来就含这笔；
  // 变的只是这笔出现在哪一期的明细里。于是 **余额分毫不差、流水配不上**
  // → 残差 0 + 异常 1 + 无在途 → SOFT_FLAG。
  // 这一条是"只看余额会漏掉什么"的活教材：只对余额的话，这个钱包会被判成
  // 完全正常，而实际上有一笔流水两边对不上。
  //
  // 杠杆：把该行的 datetime 挪到截止点之后。引擎取外部行的条件是
  // `datetime <= cutoff`（wallet-recon-run.service.ts fetchExternalLinesForWallet），
  // 故这条行本期不参与匹配；externalBalance 按 cutoffDate 取，不受影响。
  {
    const straddle = (await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotCutoff.walletRef },
      orderBy: { datetime: 'asc' },
    })) as { id: string; amount: Prisma.Decimal; externalRef: string | null } | null;
    if (!straddle) {
      throw new Error(
        `⑫ 跨日切需要 ≥1 条外部行（钱包 ${slotCutoff.walletRef}）—— ` +
        '花名册给 Grace 的 USDT 素材单（seq 22/23）是否还在？',
      );
    }
    const shifted = new Date(cutoff.getTime() + 6 * 60 * 60 * 1000);   // 截止点之后 6 小时
    await (prisma as any).externalStatementLine.update({
      where: { id: straddle.id },
      data: {
        datetime: shifted,
        description: 'Demo cutoff straddle — landed in the counterparty\'s NEXT business day',
      },
    });
    scenarios.push({
      scenarioId: 12,
      rootCause: 'CUTOFF_STRADDLE',
      expectedLines: [{ walletRef: slotCutoff.walletRef, lineType: 'ORPHAN_INTERNAL', amount: straddle.amount.toString(), externalRef: straddle.externalRef }],
      detail: { shiftedLineId: straddle.id, shiftedTo: shifted.toISOString(), closingBalanceUntouched: true },
    });
    wallets.push({
      walletRef: slotCutoff.walletRef,
      scenarioIds: [12],
      expectedBucket: 'SOFT_FLAG',
      bucketRationale:
        '只挪了一条外部行的时间、**收盘一分没动** → 余额差 = 0；该行本期不参与匹配 → 它的内部对手成孤儿 → 异常数 1；' +
        '无在途 → 命中「残差 0 且无在途 且 流水异常 > 0 → SOFT_FLAG」。',
      hasNonTerminalFundsOrder: false,
    });
  }
```

- [ ] **Step 3: 跑，确认 14 条**

```bash
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break
```

Expected: `scenarios: 14/14 DETECTED`、`wallets: 8/8 bucket OK`、identity 全 OK。

- [ ] **Step 4: 断言 ⑫ 真的是"余额平、流水不平"**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT rw.bucket, rw.deltaAmount, rw.orphanInternal, rw.inTransitCount FROM reconciliation_run_wallets rw JOIN wallets w ON w.id=rw.walletRef JOIN customer_main cm ON cm.id=w.ownerId JOIN assets a ON a.id=w.assetId WHERE cm.email='demo_grace@example.com' AND a.code='USDT-TRON' ORDER BY rw.rowid DESC LIMIT 1;"
```

Expected: `bucket=SOFT_FLAG`、**`deltaAmount=0`**、`orphanInternal≥1`、`inTransitCount=0`。

**`deltaAmount=0` 这一格是这条场景的全部意义**——它证明只看余额会把这个钱包判成完全正常。

- [ ] **Step 5: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "feat(demo): 展示位丙加对账单重复行；新增跨日切（余额平流水不平）"
```

---

### Task 8: ⑬ 记错钱包（唯一跨两个钱包的场景）

**Files:**
- Modify: `scripts/recon-demo.ts`

**Interfaces:**
- Consumes: Task 4 的 `slotMisroutedFrom`（Jack AED）、`slotMisroutedTo`（Kate AED）
- Produces: 场景 ⑬ `MISROUTED_CREDIT`，**一个成因两条差异行、两个案子**

- [ ] **Step 1: 注入**

在 ⑫ 之后插入：

```ts
  // ── ⑬ 记错钱包 (BREAK ×2 / 跨两个钱包) ──────────────────────────────────
  // 一笔本该记到 Jack 账上的钱，被记到了 Kate 账上。
  //   发出端（Jack）：我方账上有、对账单上没有 → 我有外无
  //   接收端（Kate）：对账单上有、我方账上没有 → 外有我无
  // 一个成因、两个案子——这是 15 条里唯一跨钱包的，答案键里两条 expectedLines
  // 指向不同的 walletRef，但共用同一个 scenarioId。
  {
    const moved = (await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotMisroutedFrom.walletRef, direction: 'IN' },
      orderBy: { datetime: 'asc' },
    })) as { id: string; amount: Prisma.Decimal; externalRef: string | null } | null;
    if (!moved) {
      throw new Error(
        `⑬ 记错钱包需要发出端有 ≥1 条 IN 方向外部行（钱包 ${slotMisroutedFrom.walletRef}）—— ` +
        '花名册给 Jack 的 AED 素材单（seq 24/25）是否还在？',
      );
    }

    // 发出端：删掉那条行 + 压低同额收盘
    await (prisma as any).externalStatementLine.delete({ where: { id: moved.id } });
    const fromPrev = await bumpClosing(slotMisroutedFrom, moved.amount.negated());

    // 接收端：同一笔钱出现在别的客户账上 + 抬高同额收盘
    const toRef = refFor(slotMisroutedTo.currency, 'MISROUTED');
    const toCreated = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotMisroutedTo.currency),
        accountRef: slotMisroutedTo.walletRef,
        subAccount: slotMisroutedTo.walletRef,
        book: slotMisroutedTo.book,
        currency: slotMisroutedTo.currency,
        direction: 'IN',
        amount: moved.amount,
        externalRef: toRef,
        datetime: cutoff,
        description: 'Demo misrouted credit — this belongs to another customer',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotMisroutedTo.walletRef}-s13-misrouted`,
      },
    });
    const toPrev = await bumpClosing(slotMisroutedTo, moved.amount);

    scenarios.push({
      scenarioId: 13,
      rootCause: 'MISROUTED_CREDIT',
      expectedLines: [
        { walletRef: slotMisroutedFrom.walletRef, lineType: 'ORPHAN_INTERNAL', amount: moved.amount.toString(), externalRef: moved.externalRef },
        { walletRef: slotMisroutedTo.walletRef,   lineType: 'ORPHAN_EXTERNAL', amount: moved.amount.toString(), externalRef: toRef },
      ],
      detail: {
        deletedFromLineId: moved.id,
        insertedToLineId: toCreated.id,
        fromPrevClosingBalance: fromPrev,
        toPrevClosingBalance: toPrev,
        note: '一个成因两个案子：发出端我有外无、接收端外有我无',
      },
    });
    wallets.push({
      walletRef: slotMisroutedFrom.walletRef,
      scenarioIds: [13],
      expectedBucket: 'BREAK',
      bucketRationale: '发出端：删掉一条 IN 行并压低同额收盘 → 残差 = −该行金额 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
    wallets.push({
      walletRef: slotMisroutedTo.walletRef,
      scenarioIds: [13],
      expectedBucket: 'BREAK',
      bucketRationale: '接收端：加一条 IN 幽灵行并抬高同额收盘 → 残差 = +该行金额 ≠ 0 → BREAK',
      hasNonTerminalFundsOrder: false,
    });
  }
```

- [ ] **Step 2: 跑，确认 15 条 10 个钱包**

```bash
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break
```

Expected: `scenarios: 15/15 DETECTED`、`wallets: 10/10 bucket OK`、identity 全 OK、`ALL 15 SCENARIOS DETECTED PER MANIFEST`。

- [ ] **Step 3: 断言桶分布与 spec §5.6 一致**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT bucket, COUNT(*) n FROM reconciliation_cases WHERE status='OPEN' GROUP BY bucket ORDER BY bucket;"
```

Expected：`BREAK 7` / `IN_TRANSIT 1` / `SOFT_FLAG 2`，合计 **10 个案子**。

- [ ] **Step 4: 断言三个干净钱包真的是 MATCHED**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT cm.email, a.code, rw.bucket, rw.matchedCount, rw.deltaAmount FROM reconciliation_run_wallets rw JOIN wallets w ON w.id=rw.walletRef JOIN customer_main cm ON cm.id=w.ownerId JOIN assets a ON a.id=w.assetId WHERE rw.runId=(SELECT id FROM reconciliation_runs ORDER BY startedAt DESC LIMIT 1) AND ((cm.email='demo_frank@example.com' AND a.code='USDT-TRON') OR (cm.email IN ('demo_jack@example.com','demo_kate@example.com') AND a.code='USDT-TRON'));"
```

Expected: 三行全部 `bucket=MATCHED`、`deltaAmount=0`；其中 **Jack/Kate 两行的 `matchedCount > 0`**（有真实流水逐笔配上），Frank 那行 `matchedCount=0`（0 流水，"平凡地平"）。

这一步锁的是 spec §4.2 那条：两种"干净"价值不同——真正的 MATCHED 样本是有流水那两个。

- [ ] **Step 5: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "feat(demo): 记错钱包——唯一跨两个钱包的成因，一因两案"
```

---

### Task 9: 收尾——闸门、文档、基线

**Files:**
- Modify: `doc-final/demo/baseline.md`
- Modify: `doc-final/demo/script.md`

- [ ] **Step 1: 从零重铺跑全链**

```bash
bash scripts/stack.sh down
```

```bash
bash scripts/stack.sh reset self
```

```bash
lsof -ti:3113
```

kill 掉打印出来的 pid，确认 `lsof -ti:3113` 无输出，然后：

```bash
bash scripts/stack.sh up self
```

```bash
bash scripts/on-stack.sh self demo:all
```

Expected: `花名册 29/29 符合预期` + `asserts: 5/5 PASS`。

```bash
bash scripts/on-stack.sh self recon:demo:break
```

Expected: `scenarios: 15/15` + `wallets: 10/10` + identity 全 OK。

```bash
bash scripts/on-stack.sh self recon:demo:pass
```

Expected: `DONE — OK`（pass 模式不受本轮影响，但种子变了要复验）。

```bash
bash scripts/on-stack.sh self verify:coa
```

Expected: `ALL INVARIANTS PASS`（⑦ 写了账本，恒等式必须仍然成立）。

- [ ] **Step 2: 三闸 + 全量 jest**

```bash
npx tsc --noEmit -p tsconfig.json
```

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

```bash
cd client-web && npx tsc -b --noEmit && cd ..
```

Expected: 三条都无输出。

```bash
npx jest --silent 2>&1 | tail -6
```

Expected: 失败套数与红名单**逐字一致**（`role-definition-create-workflow` / `system-wallet.util` / `wallets.service` / `client-web restrictedCapabilities`）。**不在名单上的新红即事故**，必须查清再往下。

- [ ] **Step 3: 更新基线**

`doc-final/demo/baseline.md`：

- 「演示」行的花名册数字 21 → **29**
- 「对账」行改为：`recon:demo:pass ｜ recon:demo:break 15/15 场景 + 10/10 钱包桶（2026-08-30 按成因铺全，答案键拆两级）｜ verify:demo-data`
- jest 例数按 Step 2 实测刷新
- **追加一句关于 COA 四个数值的说明**（来源：main 上的并行 session claude-43，2026-08-30）：

```markdown
> 💡 **`demo:all` 打印的那四个 COA 恒等数值会随花名册变化，数字变了不等于账错了。**
> `verify:coa` 与 `demo:all` 验的都是**等式两边相等**，不验具体数值——所以花名册加了行、
> 客户多了两个之后，这四个数必然变，这是正常的。
> ⚠️ 它们会落在 `doc-final/demo/data.md` 的 `<!-- GENERATED:BEGIN -->` 区块里，
> **那段是 `demo:all` 收尾自己写的，不要手改**——手改会被下一次 `demo:all` 整段覆盖，白费。
```

- 追加一行操作约束：

```markdown
> ⚠️ **`recon:demo:break` 的场景 ⑦（重复入账）会写账本**，是 15 条里唯一一条。它用固定 sourceNo 保证重跑幂等（TB 判为已存在直接跳过），但 **`recon:demo:reset` 不回滚账本**——它只清外部数据与 WALLET_V1 的 run/case。要把账本也归零，走 `stack.sh reset self`（含 TigerBeetle 重建）。
```

- [ ] **Step 4: 提交**

```bash
`doc-final/demo/script.md`（**走查剧本，业主演示时照着念**，四处已作废）：

- `:49` 「break 场景 `recon:demo:break`（**9 种破口**）」→ 15 种
- `:50` 走查步骤列举的破口类型里含「**孤儿存款**」——那正是本批退役的归属场景，**必须删**，
  否则演示者会去找一个不存在的案子；同时按三个展示位改写讲法：
  「逐破口对着答案键讲」→「**三个展示位各讲一屏**：同一形状、三种相反的真相」
- `:52` 「**9/9 全检出**」→ 15/15；「调账单正在做」→ 已落地；并补一条本批新增的已知缺口：

```markdown
**已知缺口**：破口已按成因铺全（15/15）。但**处置这一侧还差豁免与挂起**，
因此「不该动账」那几条今天在界面上会**显示一个对它们而言错误的按钮**
（⑩⑪ 显示冲正、③⑫ 显示冲销），点下去会把本来正确的账改错——而且差额归零、
案子关闭、报表干净，**没人会发现**。
⚠️ **走查时这 4 条的正确演法是「指出来、不点」**：它们恰恰是"同一个形状两种相反真相、
系统分不出、必须人去查"的活教材。另有 3 条（⑤⑨⑥）显示"无处置动作"，那是安全的。
```

git add doc-final/demo/baseline.md doc-final/demo/script.md
git commit -m "docs(demo): 基线刷新——花名册 29 行、破口 15 场景 10 钱包"
```

---

## 附：本计划自查

**Spec 覆盖**

| spec 节 | 落在哪 |
|---|---|
| §1 范围 | Global Constraints |
| §2 五个杠杆 | Task 5（改金额）· Task 6（删行 + 写账本）· Task 7（加行 / 复制行 / **挪时间**）· Task 8（行搬家） |
| §3 成因表 15 条 | Task 4（①②③④⑤⑥⑭⑮ 迁移）· Task 5（⑩⑪）· Task 6（⑦⑧）· Task 7（⑨⑫）· Task 8（⑬） |
| §4.1 新增两客户 | Task 1 |
| §4.2 钱包分工 | Task 4 Step 1 |
| §5 逐场景规格 | Task 4–8 |
| §5.6 桶汇总 | Task 8 Step 3 |
| §6 花名册 8 行 + 不加提现 | Task 1 Step 3 + Step 7 |
| §7 答案键拆两级 | Task 2 |
| §7.1 自洽式不改 | Global Constraints + 每个 Task 的 identity 断言 |
| §8 前置闸 fail-closed | Task 3 |
| §9.1 桶推导可审 | `WalletExpectation.bucketRationale` 必填，Task 2 定义、Task 4–8 逐条写 |
| §9.2 ⑦ 幂等 + reset 不回滚账本 | Task 6 Step 5 + Task 9 Step 3 |
| §9.3 废除 disjoint 前提、改文件头 | Task 4 Step 6 |
| §9.4 4 条按钮会点错 | 不在本轮范围（收口那轮的事），spec 已登记 |

**变异验证点**（这个仓库栽过多次自证型绿灯，以下两处强制）

- Task 2 Step 6：改错一个期望桶 → `wallets` 校验必须变红
- Task 3 Step 4：把在途钱包标成"不许有在途" → 前置闸必须抛错

**留给实施者的提醒**

- `WalletPlan.currency` 存的是资产 **code**（`AED` / `USDT-TRON`），不是 currency（`AED` / `USDT`）。加密币上两者不同，`planByOwnerAsset` 用错会找不到钱包。
- 外部对账单行的 `amount` 一律是**最小单位（分）**，与 `account_flows` 同口径。
- 每次改完注入都要 `recon:demo:reset` 再 `break`——`bumpClosing` 是相对调整，不 reset 直接重跑会二次累加。
