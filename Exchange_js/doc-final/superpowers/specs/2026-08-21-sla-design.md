# 三域 SLA 收口 —— 第三批设计稿

- **日期**：2026-08-21
- **批次**：三域合规一致化 第三批
- **状态**：业主已逐节确认，待转 writing-plans

---

## 0. 要解决什么

业主的原话：**「某个状态下计时，然后时间到了，迁移到什么状态」**。

三域今天有三套**互不相同**的计时机制，且实际上从没跑起来过。

### 0.1 实测现状（2026-08-21）

| 域 | 机制 | 计时起点 | 时长 | 扫描 |
|---|---|---|---|---|
| 充值 | `slaDeadline` 列，进状态时算好写库 | 进入状态的时刻 | 7 天硬编码 | 5 分钟 |
| 提现 | 同上 | 同上 | 7 天硬编码 | 5 分钟 |
| 兑换 | **无列**，扫 `createdAt < now - 常量` | **建单时刻** | 常量 | 30 秒 |

- 兑换算的是「这单建了多久」，**不是**「在这个状态待了多久」——与业主口径不符
- 兑换连 `slaDeadline` / `slaBreached` 两列都没有
- **31 个状态里只有 3 个在计时**
- live 主库实证：充值 7 笔、提现 5 笔的 `slaDeadline` **全为 NULL**，`slaBreached` 全 0 —— 这条路一次都没跑过

### 0.2 一个被机制掩盖的真缺口

充值/提现的扫描查询本身**已经包含** `COMPLIANCE_PENDING`：

```typescript
// deposit-transactions.service.ts:833-841（提现同构）
status: { in: [COMPLIANCE_PENDING, ACTION_PENDING] },
slaDeadline: { lt: now },
slaBreached: false,
```

但 `slaDeadline` **只在 `applyKytOnHold` 分支被设过**（`deposit-workflow.service.ts:805`）。正常送检等裁决的单，该列是 `NULL`，而 `lt: now` 匹配不到 `NULL` → **永远扫不到**。

后果：**Sumsub 一直不回裁决，单子就永远挂在合规中，没有任何兜底。** 这恰恰是最该有 SLA 的一格。

---

## 1. 分类原则：按「在等谁」决定超时动作

这是本设计的底层逻辑。31 个状态按等待对象分类，分类直接决定超时该干什么：

| 类 | 等谁 | 超时动作 | 理由 |
|---|---|---|---|
| ① | 客户（交材料） | **推状态** | 客户不配合，我方有权处置 |
| ② | 服务商（Sumsub 回裁决） | **推状态** | 服务商不回，我方有权处置 |
| ③ | 我方自己人（合规官/审批人/运营） | **只置标记，不推状态** | 超时的是我们自己，不能把怠工转嫁给客户 |
| ④ | 外部执行（链上确认/广播/腿过账） | **不设** | 钱在路上，改状态改不了外部事实 |
| ⑤ | MLRO（制裁调查） | **不设** | 自动解冻被制裁的人是合规灾难 |
| ⑥ | 终态 | **不设** | — |

**业主裁定（③ 类）**：只计时不推状态，超时在管理台亮红标。理由是我方怠工不该由客户承担后果，单子该怎么判还得人判。

---

## 2. 范围：7 格

### 2.1 硬 SLA · 超时推状态（4 格）

| 域 | 状态 | 等谁 | 时长 | 超时目标 | 现状 |
|---|---|---|---|---|---|
| 充值 | `COMPLIANCE_PENDING` | Sumsub | 7 天 | `MANUAL_CHECKING` | **本批补计时**（§0.2） |
| 提现 | `COMPLIANCE_PENDING` | Sumsub | 7 天 | `MANUAL_CHECKING` | **本批补计时** |
| 兑换 | `COMPLIANCE_PENDING` | Sumsub | 7 天 | `REJECTED` | 有，但基准是 `createdAt`，本批改 |
| 充值/提现 | `ACTION_PENDING` | 客户交材料 | 7 天 | `MANUAL_CHECKING` | 已有，不动逻辑 |

**兑换为什么是 `REJECTED` 而不是转人工**（业主裁定）：兑换零记账，拒了不用回滚任何东西；而充值的钱已在暂扣户、提现的钱已 pending-locked，直接拒会留下悬空资金，必须有人处理。这个差异**刻意保留**，不为「三域一致」而统一——统一要给兑换加 `MANUAL_CHECKING` 态，得不偿失。

### 2.2 软 SLA · 超时只置标记（3 格）

| 域 | 状态 | 等谁 | 时长 |
|---|---|---|---|
| 充值/提现 | `MANUAL_CHECKING` | 合规官 | 3 天 |
| 提现 | `PENDING_APPROVAL` | 审批人 | 1 天 |
| 充值 | `OPERATION_PENDING` | 运营 | 1 天 |

时长按「等自己人该更快」拟。三格今天**完全没有计时**，本批新增。

### 2.3 明确不做

| 不做的 | 理由 |
|---|---|
| 三域 `FROZEN` | 制裁调查中，自动解冻是合规灾难 |
| 全部终态（充值 5 / 提现 4 / 兑换 5） | 已结束 |
| `PAYIN_PENDING`（充值） | 等链上确认数。⚠️ 注意：单是**链上检测到入账时才建的**（`detected()` = "Inbound detection entry"），不是客户点按钮时建的——所以它等的是确认数，不是客户 |
| `PAYOUT_PENDING`（提现） | 钱已广播上链 |
| `RETURNING` / `SEIZING` / `CONFISCATING`（充值） | 处置在途，等外部 |
| `PROCESSING`（兑换） | 四条腿正在逐条过账 |

**业主裁定（软 SLA 收窄）**：红标的价值在「催人干活」，而等链上确认、等腿过账这些，红了也没人能加速；反倒是合规官压着一单三天不看，红标真能起作用。

---

## 3. 机制统一

三域改用**同一套**：进入某状态时算好 `slaDeadline` 写库，cron 扫 `slaDeadline < now && slaBreached = false`。

### 3.1 兑换补两列

`SwapTransaction` 新增 `slaDeadline DateTime?` + `slaBreached Boolean @default(false)`，与另两域同名同型。

计时基准从 `createdAt` 改成**进入 `COMPLIANCE_PENDING` 的时刻**。

> ⚠️ 今天兑换的 `COMPLIANCE_PENDING` 是出生态，两者数值等价——但**口径必须一致**。否则以后多一条进 `COMPLIANCE_PENDING` 的路径，兑换就会悄悄按错误的起点算。

### 3.2 超时动作只有两种

```
硬 SLA 破线 → markStatus(SLA_BREACH) + slaBreached=true + 审计
软 SLA 破线 →                          slaBreached=true + 审计     ← 状态一步不动
```

一个 `slaBreached` 字段承载两种行为。它同时还是「已处理过、别重复扫」的去重标记（现有语义，沿用）。

### 3.3 状态迁移时重置

进入新状态时重设 `slaDeadline`（新状态有 SLA 就设、没有就置 `null`）并把 `slaBreached` 归 `false`。

**代码里已有这个模式**，照用不另造：

```typescript
// deposit-workflow.service.ts:775-783
extraData: {
  manualReason,
  slaDeadline,
  actionSubmittedAt: null,
  slaBreached: false,
},
```

### 3.4 补 `COMPLIANCE_PENDING` 计时的改动面很小

扫描查询**已经包含** `COMPLIANCE_PENDING`（§0.2），所以只需在**进入该状态时把 deadline 设上**（送检成功后），扫描侧一行不用改。

---

## 4. 呈现

### 4.1 列表页（三域都要）

- 新增「剩余时间」列：`2d 4h` 格式；已超时显示红色「已超时」
- 新增「仅看已超时」筛选（挂进各自既有的 `FilterState`）

三域列表页均已有 `FilterState` 结构（`DepositTransactionList.tsx:37` / `WithdrawTransactionList.tsx:35` / `SwapTransactionList.tsx:51`），按既有形状扩展。

### 4.2 详情页（三域都要）

- 状态卡内显示倒计时
- 超时后红标 + 超时时刻

> 现状：`slaDeadline` 在充值/提现详情页的 TS interface 里**声明了但全文件无第二处引用**（`DepositTransactionDetail.tsx:98`、`WithdrawTransactionDetail.tsx:129-130`），兑换连声明都没有。

### 4.3 客户端不显示（业主裁定）

客户端不显示倒计时。理由：对客户是承诺，一旦我方超时就得回答「客户看到什么」，问题一开没完，对 demo 加分不多。

---

## 5. 演示触发

单据详情页的 **action 栏**新增「模拟超时」按钮——**不是** ⚡ Simulation 那个模拟 Sumsub webhook 的面板（**超时不是 webhook**，业主早先已明确此点）。

点击后把 `slaDeadline` 拨到过去，下一次 cron 扫描即破线。

**生产时长保持 7 天 / 3 天 / 1 天不变**，演示不靠改配置、不靠改数据库。

> 现状：要演 SLA 只能直接改数据库把 `slaDeadline` 改到过去再等 5 分钟——全仓 `grep checkSlaBreaches` 只有 `@Cron` 和 spec 两个调用方，**零 controller**。
>
> ⚠️ 现有 ⚡ 面板里那个「⑨ Rejected · SLA breach」按钮**不是这个 SLA**——它只是投一条打了 SLA_BREACH tag 的 Sumsub 裁决报文，与计时器无关。两者不要混淆。

---

## 6. 验收标准

1. **三域机制一致**：都用 `slaDeadline` 列 + 进状态时算 deadline；兑换不再按 `createdAt`
2. **补上的那格真的会破线**：充值/提现进 `COMPLIANCE_PENDING` 后 `slaDeadline` 非 NULL；拨到过去后扫描能捞到并推 `MANUAL_CHECKING`
3. **硬 SLA 推状态**：4 格各自推到设计规定的目标态，写审计
4. **软 SLA 不推状态**：3 格破线后 `slaBreached=true`、**状态逐字未变**、写审计
5. **`FROZEN` 永不破线**：三域 `FROZEN` 单无论挂多久都不被扫到
6. **状态迁移重置**：离开有 SLA 的状态后，`slaDeadline`/`slaBreached` 被正确重设
7. **列表页可见**：三域列表页有剩余时间列 + 「仅看已超时」筛选可用
8. **详情页可见**：三域详情页显示倒计时；超时后红标
9. **演示可触发**：action 栏「模拟超时」按钮一点，无需改库、无需等待
10. **硬闸**：tsc 两份配置 0 错；全量 jest 净新失败 0

---

## 7. 明确不在本批范围

- 兑换详情页那两格假信息（`Restrictions: None` / `Pending Action: —`）、`rejectReason` 不渲染、Resume Leg 死按钮
- 权限硬化（四个 admin 路由缺 `assertAdmin`）
- 客户端兑换详情页
- 所有边界类问题（并发窗口、死枚举、审计粒度）——一条不带

（以上均已在 BACKLOG 登记，业主口径：demo 系统不关心边界问题。）
