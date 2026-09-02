# 对账破口平账 · A 批：账龄线 + 公司池核销 设计

> 日期：2026-09-02 ｜ 状态：设计定稿（业主逐段过目）｜ 分支：待建（worktree 隔离）
> 范围：平账一期半（定性 / 改记 / 挂起）之后的**下一轮前半批**。管「**差异悬着多久、悬太久怎么办**」——账龄线 + 查无果核销（公司池）+ 公司账簿冲销定码 + 一期半两条尾巴。
> 后半批（补单两入口）/ 二期（内部划转单）/ 三期（事故登记）不在本批，BACKLOG 在案。
> 上游：`specs/2026-08-27-recon-adjustment-order-design.md`（调账单一期）｜ `archive/` 内一期半 spec（定性 / 成因注册表）｜ `reference/recon-cause-handbook.md`（三结局模型）
> 口径依据：`decisions.md` 2026-09-01 三条（核销与豁免挂查证结果轴 / 处置分轮 / 成因注册表单一来源）+ 2026-08-28「三期切分」「客户侧公司承担无账面捷径」+ 本文 §0 新增两条

---

## 0. 决策记录（本轮脑暴的结论，含被推翻的口径）

| # | 问题 | 结论 | 理由 |
|---|---|---|---|
| 1 | 平账审批裁决人 | **一律 CFO**。调账单审批策略 `RECON_ADJUSTMENT_POST` 裁决人 OPS_OFFICER → CFO | 业主 2026-09-02 拍板，**覆盖** `decisions.md` 2026-09-01「审批人保持 OPS_OFFICER 不动」。独立依据：对账引出的账本更正在业内是财务签批，运营开单运营批不成立。链条定型三个人：运营查证定性 → 金库开单 → CFO 裁决 |
| 2 | 核销要不要新开审批类型 | **不开**。核销 = 调账单第五族，复用 `RECON_ADJUSTMENT_POST` | 分录腿、审批、审计、详情页与调账单全同，差别只在门槛；立新主体是重复 |
| 3 | 豁免做不做 | **不做**。成因表删「精度尘埃差」；手册保留行业动词并写四类根源 | 本系统与服务商精度一致（AED 两边 2 位、USDT 两边 6 位；swap 由我方按 rate 算完四舍五入落地），唯一通向豁免的成因不存在；行业里其他永久差异项（银行记错 / 迁移期初差 / 规则禁止调账 / 无主款待处置）在本系统要么被「没有对方错」公理排除、要么已有别的出口。⚠ 脑暴中我方先提「豁免不审批」，被业主「按理应审批」纠正；随后业主点出精度一致，整件事作废——两次改口各有新事实 |
| 4 | 容差做不做 | **不做**。立场：**一分不差，一分也追** | 容差放过的一分钱会攒成需要豁免的差；精度一致的系统不需要它。场景 4「舍入精度差 → 冲正」就是这个立场的现成例子 |
| 5 | 「余额差本身」第七格 | **不做** | 它只在期初差 / 尘埃两种情况出现，本系统都没有；全部流水 1:1 全史比对、无窗口截断，不会出现「每笔配上只有收盘差」 |
| 6 | 三条数字线 | **写死代码**：账龄 3 天；小额线 AED 100 元 / USDT 30；容差已无 | 财务政策数，改动该走发版评审，不做运营旋钮（同 TR 阈值先例 `decisions.md` 2026-07-31）。演示靠 ⚡拨钟 |
| 7 | 账龄怎么存 | **存截止时刻 + 每分钟扫描 + 到线置标记**（三域 SLA 同款） | 否决「读时现算天数」：没有「到线」这个事件就没有审计可留、没有钟可拨 |
| 8 | 账龄起算点 | **案件业务日**；复观察不重置 | 差异从第一次看见就在；「进入状态计时」（2026-08-21）在案件上就是开案那天 |
| 9 | 超期后果 | **标记 + 系统审计 + 列表醒目 + 解锁两个按钮**；状态不动；不发通知 | 软破线只置标记；系统没有通知中心，硬做是造一个只为这一处服务的件 |
| 10 | 公司账簿冲销 | **随核销一起定码**（一期半留话） | `FIRM_AMT_OVERBOOKED` / `FIRM_MISBOOKED` 从留档改冲销，新成因码一枚两向 |
| 11 | 跨日切案件页无可处置行 | 真因 = **跑批截止点是精确时刻，页面重建按当天 23:59:59**；修法 = run 记 `cutoffAt`，页面按它重建 | 场景 9 把外部行挪到「截止点后 6 小时」，跑批时在窗外、页面重建时落回窗内 |
| 12 | 严重度分级 | **本批不动**，登记 BACKLOG | 现行 HIGH ≥ 1 万最小单位对 AED 是 100 元、对 USDT 是 0.01 元，跨资产不可比；本批「金额小」另立小额线，不借用它 |

---

## 1. 定位与边界

**本批做的一句话**：给每张打开的案子一只钟；钟到线、财务查不出、金额又小的公司池差异，由公司认下来，账本按外部的数记，案子关掉。

**做**：
1. 平账审批裁决人改 CFO（§4）
2. 账龄线：起算 / 到线 / 标记 / 审计 / ⚡拨钟 / 解锁（§2）
3. 核销，公司池：调账单第五族（§3）
4. 公司账簿冲销定码（§5）
5. 两条尾巴：跨日切案件页 + 三处 tooltip UUID（§6）
6. 成因表 / 手册 / 剧本 / 决策同步（§7 §9）

**不做**（对照 CLAUDE.md §2 与本批范围）：客户池核销（二期划转前置）｜ 事故升级（三期）｜ 通知中心 ｜ 豁免 ｜ 容差 ｜ 补单两入口（后半批）｜ `SOFT_FLAG → COMPENSATING` 改名 ｜ 严重度按资产化 ｜ 人工销案 ｜ 幂等 / 并发 / 重试等技术兜底一概不碰。

**三人链**（本批定型，演示要讲）：运营在案件页**查证定性** → 金库在同一行**开单**（冲正 / 冲销 / 补记 / 改记 / 核销）→ **CFO 裁决** → 系统落账 → 重对账自愈。查的人、开单的人、批的人是三个人。

---

## 2. 账龄线（Case Aging）

### 2.1 规则

| 项 | 口径 |
|---|---|
| 对象 | 每张 `status=OPEN`、`layer=WALLET` 的案件，不分桶（在途 / 软标记 / 破口都计） |
| 起算 | 案件业务日 `businessDate` 的日终（`T23:59:59.999Z`） |
| 线 | `RECON_AGING_DAYS = 3`（常量表 §2.7） |
| 截止时刻 | `slaDeadline = 业务日日终 + 3 天`；**开案时设一次**，复观察（同案跨日 upsert）**不重置** |
| 到线 | 扫描发现 `slaDeadline < now` 且 `slaBreached=false` → 置 `slaBreached=true` + 一条系统审计；**状态不动**（软破线，同三域「等自己人」态） |
| 一次性 | 置过标记不再扫（`slaBreached=false` 是扫描条件） |
| 结案 | 案件 RESOLVED 后标记随行保留（历史可查），不清 |

「到线」的业务含义按案子当时在等什么而定，本批只做标记与解锁，不推状态：

| 案子在等什么 | 到线含义 | 本批动作 |
|---|---|---|
| 钱到账（在途，场景 1） | 卡住了，去推单 | 只标记；「去推单」入口已有 |
| 下期自平（挂起·等下期，场景 9） | 当初判错了，重查 | 只标记；人可覆盖重定性 |
| 财务查出来（挂起·调查中，场景 10 / 无主入金） | 调查要有结论 | **解锁**：公司池小额 → 核销；公司池大额 → 升级事故（三期留档）；客户池 → 待二期划转 |
| 没人碰（未定性） | 查证逾期 | 只标记 |
| 别的域补单（留档，场景 13/14） | 等太久 | 只标记 |

### 2.2 字段（`ReconciliationCase`）

- `slaDeadline DateTime?`——**复用**既有空列，开案时填
- `slaBreached Boolean @default(false)`——新增
- 迁移一支，随 §6.1 的 run 列同一文件；空库能建起即可，不写 backfill（重铺）

### 2.3 扫描与主体服务

- `workflow/case-aging.service.ts`（案件计时主体方法，无 @Cron）：
  - `computeDeadline(businessDate): Date`——纯函数，供 `wallet-recon-run.service.ts` 开案时调用
  - `markBreached(caseId, now)`——置标记；返回案件快照供审计
  - `simulateTimeout(caseNo)`——⚡拨钟：`slaDeadline = now − 1s`（只对 OPEN 案件；RESOLVED 拒 400「已结案的案子没有账龄」）
- `sweep/case-aging-sweep.service.ts`：`@Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })` → `checkAgingBreaches(now)`，与 `withdraw-sla.service.ts` 同构；扫描逻辑与 @Cron 包装分开，测试直接调用；逐案 try/catch 不拖垮整轮
- 审计写在扫描服务（编排层），经 DI 注入 `AuditLogsService.recordSystem`，**显式 `requestId`**

### 2.4 ⚡拨钟

- 端点：`POST /admin/reconciliation/cases/:caseNo/simulate-aging-timeout`，权限组 **`DEMO_CLOCK_WRITE`**（现有组，`rbac.catalog.ts` 加一条 `route()`；桶 `demo.act_clock` 描述已涵盖「SLA timers」，不改桶）
- 语义与三域一致：把截止拨到过去，**下一分钟扫描即超期**；端点本身**不置标记**（标记只由扫描置，「到线」事件只有一处来源）
- 拨钟是 operator 的持久化动作（铁律①）：端点记一条操作员通道审计 `RECON_AGING_TIMEOUT_SIMULATED`，镜像充值域 `DEPOSIT_SLA_TIMEOUT_SIMULATED`（`deposit-transactions.service.ts setSlaDeadlineByNo`）——拨钟一条、到线一条，两条审计各说各的事
- 前端：案件详情页 ACTIONS 块，`useSimulationMode` 门控，按钮文案「⚡ 拨到超期」；成功提示「截止已拨到过去，下一分钟扫描即超期」

### 2.5 看得见

| 位置 | 变化 |
|---|---|
| 案件列表页 | Aging 列旁加红色徽标「超期」（`slaBreached`）；排序仍按账龄降序 |
| 案件详情 Hero | 徽标「超期 N 天」（N = floor((now − slaDeadline)/1d)，≥1） |
| 详情侧栏 LIFECYCLE | `SLA Deadline` 现在有值（既有行，`frontend-admin.md` 表里 ReconciliationCase 已登记） |
| 差异行动作列 | 在一期半六态之上加三态，见 §2.6 |

### 2.6 解锁规则（差异行）

前提：`case.slaBreached=true` **且** 该行有定性 **且** 定性出口 = `HOLD_INVESTIGATING` **且** 定性未挂单号。三条都成立才进下表；否则动作列维持一期半六态。

| 案件账簿 | 行差额 vs 小额线 | 动作列显示 | 谁看得见按钮 |
|---|---|---|---|
| FIRM | ≤ 小额线 | 按钮「核销」 | 持 `RECON_ADJUSTMENT_WRITE`（金库）；其他人看只读标签「超期 · 可核销」 |
| FIRM | > 小额线 | 只读标签「超期 · 待升级事故（三期）」 | 所有人 |
| CLIENT | 任意 | 只读标签「超期 · 待二期划转」 | 所有人 |

判据**在服务端算**：`reconciliation-query.service.getCase` 的行注解段（一期半 §3/§8 那段）给行加 `nextStep`：
```
nextStep?: {
  kind: 'WRITE_OFF' | 'INCIDENT_DEFERRED' | 'TRANSFER_DEFERRED';
  // kind=WRITE_OFF 时下面四项齐（表单预填，前端不自己拼真相）
  reasonCode?: 'UNEXPLAINED_WRITE_OFF'; direction?: 'REDUCE' | 'INCREASE';
  amount?: string; effectiveDate?: string;
}
```

### 2.7 常量表 `disposition/recon-thresholds.constant.ts`

```
RECON_AGING_DAYS = 3
SMALL_AMOUNT_LINE_MINOR: { AED: 10_000n /* 100.00 */, USDT: 30_000_000n /* 30.000000 */ }
isSmallAmount(assetCode, minor: bigint): boolean   // 未登记资产 → throw，不兜底
```
与 TR 阈值同一做法：写死、手册记数值、改动走发版评审。

### 2.8 审计

新码 **`RECON_CASE_AGING_BREACHED`**，出生即冻结四属性：
- 含义：一张打开的案件账龄到线（软破线，状态不动）
- `actionDomain: RECON`；`correlationMode: N`（对账件无客户旅程，同 `RECON_CASE_OPENED`）
- `requiredFields: []`（顶层无特有必填；`slaDeadline / ageDays / bucket / book / severity` 落 metadata）
- 通道：**系统**（`recordSystem`，actor `AGING_TIMER`）；主对象 = caseNo；子主体 = 钱包（`walletNo`，业务键）

新码 **`RECON_AGING_TIMEOUT_SIMULATED`**（⚡拨钟，§2.4）：
- 含义：演示者把案件账龄截止拨到过去（演示件，不是业务动作）
- `actionDomain: RECON`；`correlationMode: N`；`requiredFields: []`（原截止 / 新截止落 metadata）
- 通道：**操作员**（`recordByActor`）；主对象 = caseNo；`sourcePlatform: 'ADMIN'`

两码均入 `V8_RECON_AUDIT_ACTIONS`（7 → 9 码）与词表封册。

---

## 3. 核销（公司池）

### 3.1 形态

- 调账单**第五族** `WRITE_OFF`；`FAMILY_LABEL.WRITE_OFF = '核销'`
- 新成因码（`adjustment-rules.ts` `REASON_SPECS`）：
  ```
  UNEXPLAINED_WRITE_OFF: { book: 'FIRM', directions: ['REDUCE','INCREASE'],
                           customerLabel: null, internalLabel: '查无果核销', family: 'WRITE_OFF' }
  ```
- **不是成因表里的成因**：核销挂在查证结果轴上（`decisions.md` 2026-09-01），触发它的是账龄，不是某个成因。`CAUSE_REGISTRY` 不加条目；定性记录的 `outlet` 保持 `HOLD_INVESTIGATING`——「查不出」仍是查证结论的真相，核销是它的后续处置

### 3.2 四个前提

后端 `adjustment.service.createDraft` 对 `reasonCode=UNEXPLAINED_WRITE_OFF` 的守卫，**全部 400、人话文案**；前端按 §2.6 同一判据显示按钮：

| # | 前提 | 400 文案 |
|---|---|---|
| 1 | `case.slaBreached=true` | 「案子还没到账龄线，查无果的差异先挂着，到线再谈核销」 |
| 2 | 锚的那条差异行有定性，且 `outlet=HOLD_INVESTIGATING`，且 `adjustmentNo` 为空 | 「核销只对已定性为『挂起·调查中』的差异行；这行的结论是 X」 |
| 3 | `case.book='FIRM'` | 「客户池的查无果差异不能一笔核销：托管里真少了钱，要先认损再由公司补款（二期划转）」 |
| 4 | `amount ≤ SMALL_AMOUNT_LINE_MINOR[assetCode]` | 「差额 X 超过小额线 Y，查无果的大额差异不许核销，走事故登记（三期）」 |

### 3.3 方向与金额：一句原则「让内部等于外部」

`cause-registry.ts` 新增纯函数 `resolveWriteOff(facts: RowFacts): { reasonCode, direction, amountMinor }`：

| 行形状 | 方向 | 金额 |
|---|---|---|
| 金额不对 | `signedDeltaSign(facts) === -1 → REDUCE`，否则 `INCREASE`（出账翻符号，同冲正） | ‖外部 − 内部‖ |
| 我有外无 | 内部方向 `OUT → INCREASE`，`IN → REDUCE`（同冲销） | 内部行金额 |
| 外有我无 | 外部方向 `IN → INCREASE`，`OUT → REDUCE`（同补记孤儿） | 外部行金额 |

生效日 = 案件业务日（`decisions.md` 2026-08-29，不得晚于它）。

### 3.4 分录

与补记**同一对腿**——借贷科目只由（账簿 × 方向）决定，`resolvePostingLegs('FIRM', direction)` 不改：
- 少了（REDUCE）：借 `E.FIRM_OPS` 运营资金 / 贷 `A.FIRM_ASSET` 公司资产——公司认损
- 多了（INCREASE）：借 `A.FIRM_ASSET` / 贷 `E.INCOME_OTHER` 其他收入——公司意外之财
不增科目（`decisions.md` 2026-08-13 九码终盘）。

### 3.5 全路径

1. 运营在案件页那行「处置」→ 选「查不出（已穷尽调查）」→ 写清查过什么 → 徽标「已定性 · 挂起·调查中」，案子仍红
2. ⚡拨钟（演示）或真等 3 天 → 扫描置「超期」+ 审计
3. 金库看到该行按钮「核销」→ 点开调账单**锁定视图**（成因固定「查无果核销」不给下拉；方向只读附推导依据一句；金额只读 = 行差额；生效日只读 = 案件业务日；说明必填，默认带入查证说明摘要）→ 提交送审
4. 审批中心：CFO 看到**后果原话**（§3.7）→ 批准
5. 系统落账（同步直调 `AccountingService.executeTransfer`，失败即流程失败）→ 定性记录挂上单号锁死
6. 运营点「重对账」→ 该行已解释（explained 索引）+ 内部余额已动 → 残差 0、异常 0 → MATCHED → 案子 RESOLVED

### 3.6 定性联动

`disposition.service.linkAdjustment` 现规则「出口不以 ADJUST 开头即拒」**放行一种组合**：`outlet=HOLD_INVESTIGATING` 且调账单 `family=WRITE_OFF`。挂上单号后同锚重定性照旧 400（「单和结论必须对得上」）。

### 3.7 审批

- 复用 `RECON_ADJUSTMENT_POST`，裁决人 CFO（§4）；不新开策略、`verify-rbac` 表不加行
- 审批页后果原话模板（`adjustment.service` 的 impact 段加 WRITE_OFF 分支）：
  「公司池查无果核销：钱包 {walletNo} {assetCode} 差额 {金额元} {认损进运营资金 ｜ 计入其他收入}，案件 {caseNo} 已超期 {N} 天，查证结论：{findingNote 摘要}」
- 驳回 / 取消 / 超时 → `REJECTED`（既有四钩子）；定性上挂的单号**不解除**——与一期同款：单落 REJECTED 后定性保持锁定，要重来须金库再开一张，单和结论的历史必须对得上

### 3.8 审计

复用 `RECON_ADJUSTMENT_DRAFTED` / `RECON_ADJUSTMENT_POSTED`，`reasonCode=UNEXPLAINED_WRITE_OFF` 记在 requiredFields 顶层；「同动作不因语境拆名」，不另铸码。

### 3.9 收口

案子经重对账**自愈**关闭，`resolutionReason='AUTO_HEALED'`——账本已按外部的数改过，钱包真平了，「自愈」是准确的；核销这件事在案件页的调账单面板里可见（族 = 核销）。不另设 `WRITTEN_OFF` 关闭原因（与冲正 / 补记同款处理，避免关闭原因和调账单面板说两遍）。

**核销不是终局**：哪天银行迟到一笔冲正把钱送回来，它以「外有我无」进新案子，走补记进公司池，损失自然抵回。外部是权威保证核销之后系统仍然诚实。

---

## 4. 审批人改 CFO

- `approval.constants.ts`：`RECON_ADJUSTMENT_POST.steps = [{ stepNo: 1, roles: ['CFO'] }]`，`timeoutHours: 48` 不变
- 策略行由 `seed.base.ts` 从 `DEFAULT_APPROVAL_POLICIES` upsert，`db:base:sync` / 重铺即生效
- SoD：maker 组 `RECON_ADJUSTMENT_WRITE` 持有人 = TREASURY_OFFICER；checker = CFO；无重叠，`verify:rbac` S5 那一行不动
- 演示账号：`cfo@fiatx.com`（seed 既有）
- 文档同步：`demo/script.md` 第六幕 5 续「单步 OPS_OFFICER」→ CFO；`modules/v8-recon.md` §3「开调账单」「改记」两行裁决人；`recon-cause-handbook.md` §三总述「运营复核」→「CFO 裁决」；`decisions.md` 追加

---

## 5. 公司账簿冲销定码

| 成因码 | 格 | 一期半 | 本批 |
|---|---|---|---|
| `FIRM_AMT_OVERBOOKED` 公司收支记多 | 金额不对 × 公司 | 留档「公司冲销（无码，下一轮）」 | `kind: 'ADJUST', family: 'REVERSE'` |
| `FIRM_MISBOOKED` 公司收支误记/重复记 | 我有外无 × 公司 | 同上 | 同上 |

- 新成因码：`FIRM_ENTRY_REVERSAL: { book: 'FIRM', directions: ['REDUCE','INCREASE'], customerLabel: null, internalLabel: '公司账簿冲销', family: 'REVERSE' }`
- `resolveOutlet` REVERSE 分支：这两条成因 → `reasonCode='FIRM_ENTRY_REVERSAL'`；方向：我有外无按内部方向取反（既有），**金额不对按 `signedDeltaSign`**（REVERSE 分支原先只处理孤儿，补这一支）
- `DeferredTarget` 删 `'FIRM_REVERSAL'`
- 不铺新场景（2026-09-01「按处置铺不按成因铺」：冲销已有场景 6/7）；手册两条改「处置 = 冲销 · 已开放」

---

## 6. 两条尾巴

### 6.1 跨日切案件页无可处置行

- 真因见 §0-11。`ReconciliationRun` 加 `cutoffAt DateTime?`，`createRun` 写入本轮 `cutoff`
- `reconciliation-query.service.getCase`：重建差异行的截止时刻 = `lastObservedRun.cutoffAt ?? 当天日终`（历史行 null 时回落）；`buildFlowComparison` 改收 `cutoff: Date`（外部行 `datetime ≤ cutoff`、内部流水 `effectiveCutoffFilter(cutoff)`；`externalBalance` 仍按 `toBusinessDate(cutoff)` 取）
- 改完场景 9 那条「我有外无」回到页面 → 「处置」→ 跨账期 → 挂起·等下期；剧本第 9 步从「只讲不点」改可点
- 改记对端候选读的是持久化 line items，不受影响

### 6.2 三处 tooltip 漏 UUID

删 `title` 属性：`ReconciliationRunsDetailPage.tsx:592`、`ReconciliationCasesListPage.tsx:316`、`:328`。可见文本已是业务键。

---

## 7. 成因表与手册变更清单

**`cause-registry.ts`**
- 删 `PRECISION_DUST`（`CauseCode` 联合、注册表条目；种子 `RootCause=CauseCode` 无引用）；`DeferredTarget` 删 `'WAIVER'`、`'FIRM_REVERSAL'`
- `AdjustFamily` 加 `'WRITE_OFF'`；`FAMILY_LABEL` 加 `核销`
- 新纯函数 `resolveWriteOff`（§3.3）
- 六格菜单变化：金额不对 × 客户 少一项（尘埃）；金额不对 × 公司 少一项（尘埃）、「记多」出口变冲销；我有外无 × 公司 「误记」出口变冲销。**菜单顺序 = 声明顺序**，截图验收按新菜单对

**`reference/recon-cause-handbook.md`**
- §一 三结局：豁免那一支标注「本系统当前无此条件、不建入口」；「三条补充」重写——① 账龄已上线（3 天、到线动作、解锁规则）② 核销两个池子做法（公司池已开放 / 客户池待二期）③ 容差不建（一分也追）
- §二：删两处「精度不可表示的尘埃差」；`FIRM_AMT_OVERBOOKED` / `FIRM_MISBOOKED` 处置改冲销、本轮状态改已开放
- §三：总述「运营复核」→「CFO 裁决」；「8. 核销」改本批开放 + 四前提 + 操作步骤；「9. 豁免」改「不建入口」+ **四类根源**（两边量法不同 / 修正证据已失 / 规则禁止更正分录 / 钱是别人的暂不能动）+ 「条件出现时回来」清单（BTC 8 位、ETH 18 位等超出账本最小单位的资产；带转账扣费或自动变余额机制的代币；真实迁移期初差；VARA 客户资金规则限制调账）；新增「0. 账龄」一节放在十种处置之前
- §四 演示对照：场景 10 处置改「挂起·调查中 → 超期 → 核销」；长红 3 条

---

## 8. 权限与端点

| 端点 | 权限组 | 新旧 |
|---|---|---|
| `POST /admin/reconciliation/cases/:caseNo/simulate-aging-timeout` | `DEMO_CLOCK_WRITE` | 新 route（现有组） |
| `POST /admin/reconciliation/adjustments`（`reasonCode=UNEXPLAINED_WRITE_OFF`） | `RECON_ADJUSTMENT_WRITE` | 既有 |
| 其余 | — | 不动 |

不新增权限组，不新增审批策略。新 route 登记后 `db:base:sync` + **重启后端**。

---

## 9. 演示脚本变化（第六幕）

| 步 | 一期半 | 本批 |
|---|---|---|
| 5 续 | 审批中心批准（单步 `OPS_OFFICER`） | 审批中心 **CFO** 批准，审批页显示后果原话 |
| 9 | 只讲不点（已知缺口） | **可点**：「处置」→ 跨账期 → 挂起·等下期；案子仍红 |
| 10 | 定性查不出 → 挂起·调查中，顺带讲下一轮 | 定性 → **⚡ 拨到超期** → 一分钟后列表出现「超期」→ 金库那行点「核销」→ 锁定视图 → 送审 → **CFO 批** → 重对账 → 案子 RESOLVED；顺带讲三道锁（账龄 / 小额线 / CFO）少一道就是后门 |
| 期望 | 14 条平 10 条、长红 4 条（9/10/13/14） | 14 条平 **11** 条、长红 **3** 条（9/13/14） |
| 开场 | 两句公理 | 加第三句：**查的人、开单的人、批的人是三个人** |

`demo/data.md` 对账行同步：账龄线 3 天、小额线两资产数值、场景 10 处置改核销。

---

## 10. 验收标准（实现期展开为 plan 硬闸）

1. **随手闸**：tsc 三处零错；jest `src/modules/clearing-settle/reconciliation` 全绿；`bash scripts/stack-env.test.sh` 若碰栈脚本
2. **重铺闸**（改了 schema）：`stack.sh reset self` → `on-stack.sh self demo:all` 终态全绿 → `recon:demo:break` **14/14 场景 + 11/11 钱包桶**全检出
3. **动钱闸**：核销落账后 `verify:coa` 两恒等式 + 负余额断言全绿
4. **权限闸**：`verify:rbac` 全绿（含 S5 自批死锁：`RECON_ADJUSTMENT_POST` maker 金库 / checker CFO）
5. **e2e** `test/recon-aging-write-off.e2e-spec.ts`（照 `recon-adjustment-money-arcs` 的三要素跑法）：
   - 正路径：场景 10 定性 UNEXPLAINED → 拨钟 → `checkAgingBreaches` → `slaBreached=true` + 审计 `RECON_CASE_AGING_BREACHED` 可查 → 开核销单（DRAFT，审计 DRAFTED）→ submit → CFO 批准 → POSTED（审计 POSTED，`reasonCode=UNEXPLAINED_WRITE_OFF`）→ TB 分录 = 借 FIRM_OPS / 贷 FIRM_ASSET，金额 7 → 定性挂单号 → rerun → 案子 RESOLVED / AUTO_HEALED
   - 反例 ①：未超期开核销单 → 400（前提 1）
   - 反例 ②：超期但金额 > 小额线 → 400（前提 4）
   - 反例 ③：客户池案件超期 → 400（前提 3）
   - 跨日切：场景 9 案件 `getCase` 的 `flowComparison` 含 1 条 `ORPHAN_INTERNAL`（修前为 0）
   - 断言来自行为，禁止扫源码文本
6. **单测**：`adjustment-rules.spec`（两个新成因码 book/directions/family）｜ `cause-registry.spec`（`resolveWriteOff` 三形状六方向；FIRM 两成因出口 = 冲销 + 方向；`PRECISION_DUST` 不存在；六格菜单顺序）｜ `case-aging.service.spec`（截止 = 业务日日终 + 3 天；复观察不重置；RESOLVED 拒拨钟）｜ `case-aging-sweep.service.spec`（只扫 OPEN + 未标记 + 已过期；逐案失败不拖垮）｜ `reconciliation-query.service.spec`（`nextStep` 三态判定）｜ `adjustment.service.spec`（四前提 400；WRITE_OFF 联动放行）｜ `disposition.service.spec`（linkAdjustment 放行组合）
7. **前端截图四张**（永不豁免）：列表「超期」徽标｜详情核销按钮 + 锁定视图｜审批页后果原话｜场景 9 可点出「处置」
8. **文档收口**：§7 §9 全部落地；BACKLOG 销四条（aging+SLA ｜ 跨日切 ｜ 三处 tooltip ｜ 十件计数改七件并把豁免 / 容差改「不做」）+ 登记一条（严重度按资产化）；CHANGELOG 一行；`decisions.md` 追加两条（§12 给出原文）；`modules/v8-recon.md` §1–§6；词表封册加 `RECON_CASE_AGING_BREACHED` 与 `RECON_AGING_TIMEOUT_SIMULATED` 两码

---

## 11. 明确不做（本批）

| 项 | 归属 | 理由 |
|---|---|---|
| 客户池核销 | 二期 | 两步中的补款靠内部划转单（`decisions.md` 2026-08-28 无账面捷径） |
| 事故升级 | 三期 | 治理件；大额超期本批只留档标签 |
| 超期通知 MLRO / CFO | 不做 | 无通知中心；标记 + 审计 + 列表醒目已足够演示 |
| 豁免 / 容差 | 不做 | §0-3 / §0-4；手册保留动词与四类根源 |
| 「余额差本身」第七格 | 不做 | §0-5 |
| 严重度按资产化 | BACKLOG | §0-12 |
| 补单两入口 | 后半批 | 场景 13/14 继续长红 |
| `SOFT_FLAG → COMPENSATING` 改名 | BACKLOG 既有 | 与本批无关 |
| 核销后的关闭原因 `WRITTEN_OFF` | 不做 | §3.9 |
| 定性 REJECTED 后自动解锁 | 不做 | §3.7，单和结论历史对得上 |

---

## 12. `decisions.md` 追加原文（plan 直接落）

- `[2026-09-02] **平账一切审批裁决人 = CFO**：调账单（含核销族）审批策略裁决人由 OPS_OFFICER 改为 CFO，覆盖 2026-09-01「审批人保持 OPS_OFFICER 不动」｜ 对账引出的账本更正与核销在业内是财务签批；链条定型为 运营查证定性 → 金库开单 → CFO 裁决，查的人、开单的人、批的人三个人；自批死锁不存在（CFO 不持开单权）`
- `[2026-09-02] **豁免与容差不做**（覆盖 2026-09-01「豁免与容差同批」）：本系统与服务商精度一致（AED 两边 2 位、USDT 两边 6 位，swap 由我方按 rate 算完四舍五入落地），唯一通向豁免的成因「精度尘埃差」不存在，从成因表删除；行业里其他永久差异项（迁移期初差 / 规则禁止调账 / 无主款待处置）在本系统无条件或已有出口。立场：**一分不差，一分也追**。手册保留豁免为行业动词并记四类根源，条件出现（BTC/ETH 精度、转账扣费或自动变余额代币、真实迁移、客户资金规则）时回来`

---

## 附录 A · 数据模型改动

| 表 | 列 | 类型 | 说明 |
|---|---|---|---|
| `reconciliation_cases` | `slaDeadline` | 既有 `DateTime?` | 开案时填 = 业务日日终 + 3 天 |
| `reconciliation_cases` | `slaBreached` | 新 `Boolean @default(false)` | 账龄到线标记 |
| `reconciliation_runs` | `cutoffAt` | 新 `DateTime?` | 本轮截止时刻，案件页重建差异行的取数口径 |

一支迁移；不写 backfill；改完 `stack.sh reset` 重铺。

## 附录 B · 本批触发的交付清单行（`rules/delivery-checklist.md`）

任何持久状态变化（审计 + requestId）｜ 新增审计动作码（四属性冻结 + 封册）｜ 新状态 / 新结局（账龄计时回答「要不要计时」：要，3 天）｜ 动了钱（同步直调 + `verify:coa`）｜ 该走 maker-checker（审批中心正门）｜ 新增 admin 端点（`route()` + `db:base:sync` + 重启）｜ 新增业务动作（前端入口：核销按钮、⚡拨钟）｜ 涉及金额（最小单位存、展示换算）｜ 对外识别（业务键；删三处 UUID tooltip）｜ 改 schema（迁移文件、重铺）｜ 改页面或种子（`data.md` + `script.md`）｜ 改了前端（截图）｜ 每轮收尾（§9 报告 + CHANGELOG + BACKLOG 销账）

不触发：退役业务动作（无）｜ 改了交易三域（无）｜ 新字段到客户面（无，核销只在公司池）｜ 新事件（无）｜ 新增权限组（无）｜ 新增审批策略（无）
