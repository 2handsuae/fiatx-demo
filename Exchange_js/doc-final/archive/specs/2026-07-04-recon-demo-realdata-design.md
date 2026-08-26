# recon demo 真实数据夹具（去合成壳 + 真卡单）设计

> 日期：2026-07-04 ｜ 状态：设计定稿（脑暴逐节 approve）
> 范围：两个 demo 命令——Command 1 造"真实卡在半路的单"（在途处置靶子）、Command 2 `recon:demo:break` 去掉唯一的合成壳。零业务代码改动（纯 demo 脚本 + 复用现有 workflow/端点）。
> 上游：推单处置动作（`2026-07-03-push-order-disposition-design.md`）T5 暴露"合成壳单无真实记账链、演不出完整 heal 闭环"（BACKLOG「缺真实卡单 demo 场景」）。本 spec 是那条欠账的兑现。

---

## 0. 决策记录（脑暴对齐）

| # | 问题 | 结论 | 依据（代码为证） |
|---|---|---|---|
| 1 | deposit 要不要造在途 | **不要** | deposit 确认后 `executeTransfer` 直接 POST（无 pending 两阶段，`deposit-workflow.service.ts:493/535`）→ 无在途窗口 |
| 2 | "internal transfer" 指什么 | **= swap 腿** | `directionOf` INTERNAL=swap（`funds-order.service.ts:37`）；swap 四腿 `isExternalCrossing: true`（`swap-leg-accounting.ts:99/318`）= 公司控制账户间真实转账，能在途 |
| 3 | swap 为何现在没在途 | demo 把 12 笔 swap 全跑 CLEARED，不是不能在途；recon 匹配器 `findNonTerminalByWallet` 不排 swap | `funds-order.service.ts:175` |
| 4 | 9 场景造真实数据谁配合 | 见 §1 三分类：8 个纯外部/半外部（已真实）、1 个（在途）必须真实内部单 | 全库仅 scenario-1 调 `fundsOrders.create`（`recon-demo.ts:579`），其余 8 个只动 external_statement_lines |
| 5 | 两命令怎么分工 | Command 1 造真卡单（可复用）；Command 2 复用它去壳 | 见 §4 |

## 1. 9 场景"造真实数据"三分类（Command 2 的依据）

**① 纯外部就能造真实（5 个）**——根因在外部世界，生产即从对账单摄入，injected line = 真数据，**内部不动**：
BANK_CHARGE(5) 银行杂费 ｜ MISSED_DEPOSIT(6) 漏入金 ｜ BANK_INTEREST(7) 银行利息 ｜ BANK_RETURN(8) 银行退汇 ｜ ORPHAN_DEPOSIT(9) 孤儿充值。

**② 半外部：外部造 break、挂一笔已有真实充值当底（3 个）**——内部不新造状态，借用已有真充值改其外部行：
FEE_NETTED(2) 手续费净额 ｜ STATEMENT_MISSING_LINE(3) 缺行 ｜ SCALE_ERROR(4) 精度错。

**③ 必须真实内部单卡在特定状态（1 个）**——外部造不出"在途"这个内部状态：
IN_TRANSIT_TIMING(1)。**这是全 demo 唯一的合成壳**（`fundsOrders.create` 造空心单 + 挂已 SUCCESS 充值 + `bumpClosing` 手调外部余额，推之不记账 → 演不出 heal）。本 spec 把它换成真卡单。

## 2. Command 1 — `demo:in-transit`（真卡单夹具，可复用）

造"真实卡在半路"的单，跑 recon 即现在途、能被处置动作作用。两类靶子：

### 2.1 提现在途（push 今天就能 heal）
- 用真实提现 workflow 造一笔提现，推进到 **CONFIRMED**（funds order 非终态、POST 未做）——在途窗口 = `onPayoutLegConfirmed` 在 CONFIRMED→POST 之间（`withdraw-workflow.service.ts:717/719`；LOCK 阶段还没跨外部 :295，POST 才跨）。
- 注入一条外部对账单**出金行**（银行已确认出金），externalRef = 单子的 txHash/referenceNo → recon 匹配器 Pass 3 认领为在途。
- **heal 闭环可演**：push sync（命中该外部行）→ 驱到 CLEARED → 真 POST 记账（`enrichForPost`/`executeTransfer` 带回填生效日）→ 重对账 → 该钱包 delta→0、case AUTO_HEALED。

### 2.2 swap 在途（recon 检测；push heal 待 BACKLOG）
- 用真实 swap workflow 造一笔，逐腿推进（`advanceLeg`，`swap-transactions.controller.ts:62`）到**腿 1-2 CLEARED、腿 3-4 留非终态**（即 `demo:swap` 已建模的 "fiat settled / crypto pending"）。
- 非终态 swap 腿在其钱包上 → recon 检测 IN_TRANSIT。
- push 现不接 swap（先卖后买守卫 + 回填未穿透，BACKLOG「swap 腿推单」）→ 本夹具当前只演**检测**，heal 待 swap 推单落地即现成可用。

### 2.3 复用形态
造单逻辑抽成**共享函数**（如 `createStuckWithdraw()` / `createStuckSwap()`，放 demo-lib 或独立 fixture 模块），供：① `demo:in-transit` 命令直接调；② Command 2 场景 1 复用（§4）；③ 未来补单/冲正等处置动作 demo 复用。**一份逻辑，多处用。**

## 3. Command 2 — `recon:demo:break`（检测夹具去壳）

- **场景 2-9（8 个）不动**：已是真实外部行注入（§1 ①②），生产忠实。
- **场景 1（in-transit）壳换真**：删掉现有"空心单 + bumpClosing"造法，改调 Command 1 的 `createStuckWithdraw()`——金闸门从此跑在**真卡提现**上。
  - manifest/恒等式不变（inTransit 仍 = 1），只是那 1 个在途从壳变真；金闸门基线随之更新一次（demo 改动的正常代价）。
  - 好处：金闸门自证的"在途检测"从此有真实记账链背书，且与 Command 1 同源、不双维护。

## 4. 两命令咬合

```
共享 fixture：createStuckWithdraw() / createStuckSwap()
   ├── demo:in-transit（Command 1）── 造全套真卡单（提现+swap）→ 处置演示靶子
   └── recon:demo:break（Command 2）── 场景 1 调 createStuckWithdraw() → 检测金闸门（真单）
                                       场景 2-9 外部注入（不动）
```
- 独立可跑：`demo:in-transit` 单独跑 = 一批真卡单；`recon:demo:break` 单独跑 = 完整九场景（自包含，内含真在途）。
- 无循环依赖：Command 2 复用的是 Command 1 的**函数**（同进程 import），非"先跑 Command 1 命令"。

## 5. heal 叙事（演示流程）

- **MVP（数据 + 手动演）**：`demo:in-transit` 造真卡单 → 跑 recon（`recon:rerun`）→ 驾驶舱现真实在途 → operator UI 侧栏推单（提现）→ 点"重新对账" → case AUTO_HEALED。
- **可选 `--verify` 自检**：命令自驱全程（造→recon→push→recon→断言 delta→0/case RESOLVED），出答案键当回归用（对标 `recon:demo` 的 manifest 自检）。MVP 先不做，作为加分项。

## 6. 验收标准

- [ ] `demo:in-transit` 造出：≥1 真卡提现（CONFIRMED 非终态 + 外部出金行）、≥1 真卡 swap（腿 1-2 CLEARED / 3-4 非终态）
- [ ] 跑 recon → 提现钱包 IN_TRANSIT、swap 钱包 IN_TRANSIT（残差=0，非 BREAK）
- [ ] 提现单 push sync → CLEARED + 真 evidence/flow 行落库（effectiveDate=回执日）→ 重对账 → 该钱包 delta=0、case AUTO_HEALED（**这是补齐 T5 演不出的那一环**）
- [ ] `recon:demo:break` 场景 1 换真后：9/9 DETECTED、两条恒等式、金闸门（新基线）稳定复现
- [ ] tsc 0 / jest 净新增失败 0
- [ ] 前端截图：驾驶舱真实在途 case → 推单 → 自愈闭环（preview 渲染验证）

## 7. 明确不做（本期）

swap push heal（待 BACKLOG「swap 腿推单」）｜纯外部 8 场景重造（已真实）｜deposit 在途（无窗口）｜historical 补跑 UI｜真实银行/托管查询 adapter（推单沿用 port）
