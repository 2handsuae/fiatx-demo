# 审计日志重构 —— 第一批设计稿

- **日期**：2026-08-25
- **批次**：审计日志重构 第一批（表结构 + 打点上收 + V1 词表）
- **状态**：业主已逐节确认，待转 writing-plans

---

## 0. 要解决什么

业主的原话：**「我明显感觉到我的审计日志结构是有问题的。」**

感觉是对的，而且比预想严重。本稿全部结论均**回代码与 live 库实证**得出，非引用既有文档：

| 实测项 | 数字 | 意味着什么 |
|---|---|---|
| 应然字段 56，现有列 24 | **29 个字段完全不存在** | — |
| `result` 取值分布 | **466 / 466 全是 `SUCCESS`** | **拒绝路径一条都没留痕**——监管最想看的那一半证据是空的 |
| 多主体子表 `audit_log_subject_nos` | 2026-02-18 建、**2026-05-20 整表 DROP** | 「按客户查全部」「按依据反查」两类取证做不出来 |
| 写审计的文件 63 个，其中 `*workflow.service` | **仅 26 个** | 约 24 个领域服务 + 1 个 controller 在打点，它们**拿不到 actor / 旅程 / 授权依据 / 多主体** |
| 治理域动作码撞名 | **16 个字面量被多组共用** | `RESET_REQUESTED` 被密码重置与 MFA 重置共用，查不准 |
| `workflowType` 填充率 | **91%（41 条为空）** | 为空的恰恰包括共用码 `APPROVAL_SUBMITTED/APPROVED/REJECTED` 12 条——**现在分不清哪条审批属于哪个业务** |
| 现有 `traceId` 语义 | 33 个跨度 <1 秒、14 个 >1 分钟，**中位 1 秒** | 同一字段同时扮演「一次请求」与「一趟旅程」两个角色，**边界由流程碰巧同步还是异步决定** |

**本批不是补几个字段，是把「记什么、记在哪、怎么串」三件事一次定死。**

---

## 1. 范围（业主明确划的线）

### 本批做三件事

1. **升级审计日志表结构** —— 按应然字段规范落列，一次迁移建齐
2. **清理所有非 workflow 的打点** —— 32 个文件的写入位置上收编排层
3. **V1 完整日志清单落地** —— 45 个动作码定稿并实装

### 本批**不做**

- **三个交易域（充值 / 提现 / 兑换）的日志梳理**。它们的动作码、subjects 填充、拒绝路径接入，全部留给后续批次
- 安全日志（③）—— 归运维，本项目不做
- 回放对账（覆盖率闸门）—— 业主裁定本期不做，方法见 §11
- 词表瘦身（交易域 496 → 实际在用量级）
- `seq` 单调序号 + 哈希链的**校验工具**（列本批建，验证脚本后续）

> ⚠️ **「清理打点」与「不做交易域」如何调和**：清理打点＝**把写入位置从领域服务搬到编排层，不改动作码、不改字段、不改语义**。这是机械迁移，不涉及交易域的日志内容梳理，故不与「不做交易域」冲突。

---

## 2. 四类东西必须分开（结构问题的根源）

被统称「审计日志」的其实是四种东西，保留期、完整性要求、读者、查询方式全不同：

| # | 是什么 | 读者 | 保留期 | 本批 |
|---|---|---|---|---|
| ① | **业务记录** —— 订单表、流水、凭证 | 监管、财务 | ≥8 年 | 不动。它是业务表，不是日志 |
| ② | **业务审计** —— 谁、凭什么、对什么、做了什么 | 监管、内审、合规 | ≥8 年 | **本批全部工作** |
| ③ | **安全日志** —— 登录、越权尝试、异常访问 | 安全、运维 | 中等 | **物理分表，归运维，本项目不做** |
| ④ | **技术日志** —— 调用链、耗时、报错堆栈 | 开发 | 短，可采样丢弃 | 不动（`nestjs-pino` 已接通） |

**判据**：①回答「现在是什么样」（会被 UPDATE），②回答「怎么变成这样的」（永不改写）。

**②③ 必须分表**，不是洁癖：③ 的写入量比 ② 大一到两个数量级，同表会让 ② 的取证查询被登录流水拖垮。

**②④ 靠 `traceId` 搭桥**：从审计记录跳进技术日志看当时的报错与耗时。

---

## 3. 三条铁律

1. **只增不改** —— 无 UPDATE、无 DELETE。修正靠**再写一条**指向原记录（`supersedesEventNo`），不改原记录。**数据库层收回写入账号的 UPDATE/DELETE 权限**，让它物理上做不到。
2. **能独立复原** —— 数据库拿走、只留这条记录，审计员仍能读懂。故存**当时的值**而非外键（`actorDisplayName`、`actorRolesAtTime` 是快照）。
3. **能证明没被改过** —— 单条摘要 + 链式哈希 + 单调序号，三者各堵一个洞（改 / 绕 / 删）。

**审计写入与业务变更必须在同一事务内。审计写失败 = 整个动作失败回滚。** 与既有记账铁律同构——宁可这笔做不成，也不能做成了没痕迹。

---

## 4. 表结构：`audit_log_events` 字段全集

**一次迁移建齐所有列**（沿用第四批「一次建全避免两次表重建」的先例）。本批只保证 **V1 域填满**，交易域的填充留后续批次。

### 4.1 命名与枚举一律以应然为准

业主裁定：**代码与应然不一致时，听应然的。**

| 现有 | 应然 | 处理 |
|---|---|---|
| `auditNo` | `eventNo` | 改名 |
| `result` | **`outcome`** | 改名 |
| `SUCCESS`/`FAILED`/`REJECTED`/`SKIPPED`/`PENDING_APPROVAL`/`READY`（6 值） | **`SUCCESS`/`DENIED`/`FAILED`/`PARTIAL`**（4 值） | 换枚举 |
| `entityType`/`entityId`/`entityNo` | `primarySubjectType`/`primarySubjectNo` | 改名；`entityId` 并入 |
| `entityOwnerNo` | `ownerCustomerNo` | 改名 |
| `createdAt`（落库时刻） | `recordedAt` | 改名 |
| `actorRole`（单值字符串） | `actorRolesAtTime`（数组快照） | 改型 |
| `workflowType` | — | **退役**，见 §4.3 |
| `updatedAt` | — | **删除**。只增不改的表不该有「更新时间」 |

### 4.2 十组字段

**组 A · 信封**
`id` · `eventNo` · `schemaVersion` · `seq`（全局单调，**判断「有没有被删掉一条」的唯一手段**）· `category`（`BUSINESS`/`GOVERNANCE`/`SECURITY`/`SYSTEM`）· `isReadOnly` · `supersedesEventNo` · `correctionReason`

**组 B · 时间（三个，不可合并）**
`occurredAt`（业务事实发生时刻）· `recordedAt`（落库时刻）· `effectiveDate`（记账/业务日）
一律 UTC 存储 + NTP 时钟同步。

**组 C · 动作**
`action`（扁平、**全局唯一**、永不改名）· `actionDomain`（`IAM`/`APPROVAL`/`CONFIG`/`AUDIT`/`DEPOSIT`/`WITHDRAW`/`SWAP`/`LEDGER`/`RECON`）

**组 D · 人（两个）**
`actorType` · `actorNo` · `actorDisplayName`（**当时**快照）· `onBehalfOfType`/`onBehalfOfNo` · `actorRolesAtTime`（**当时**角色数组快照）· `authnMethod`

**组 E · 来源**
`sourcePlatform`（`ADMIN_API`/`CLIENT_API`/`CRON`/`WEBHOOK`/**`SCRIPT`**/`SYSTEM`）· `requestId` · `sessionId` · `sourceIp` · `userAgent` · `endpoint`

> `SCRIPT` 必须是独立取值——绕过界面跑脚本改数据是审计最关心的高危路径。
> `endpoint` 让「有人绕过正门走通用改状态接口」查得出来。

**组 F · 主体**
主表冗余：`primarySubjectType` · `primarySubjectNo` · `ownerCustomerNo`
子表 `audit_log_subjects`：见 §5

**组 G · 结果**
`outcome` · `reasonCode` · `reason` · `fromStatus`/`toStatus`（**提为一等列**）· `beforeData`/`afterData` · `amount`/`currency`

**组 H · 授权依据（金融业特有，通用日志标准里没有）**
`permissionCode` · `policyCode`/`policyVersion` · `approvalNo` · `ruleCode`/`ruleVersion` · `isOverride`/`overrideReason`

> **带版本号是刚需**：只记「按规则办了」证明不了「按的是哪条规则的哪个版本」，而监管问的是后者。

**组 I · 关联（三条线）**
`correlationId` · `causationId` · `traceId` · `groupEventId` · `externalEvidenceRef`

**组 J · 完整性与生命周期**
`payloadDigest`（**脱敏前**载荷摘要）· `prevHash`/`selfHash` · `retentionClass` · `retainedUntil` · `legalHold` · `idempotencyKey` · `signature` · `archivedAt`/`storageTier`

> `legalHold` 最常被漏、代价最大：客户进入调查后记录必须冻结到期删除，否则**归档任务会在完全「合规」的情况下自动销毁证据**。

### 4.3 `workflowType` 退役 —— 及本批唯一的过渡层例外

**退役理由（业主用一个场景判死的）**：

> 一笔提现命中制裁 → 冻该单 → 冻客户 → 客户冻结广播又冻住两张兑换单。**这是几个工作流？**
> 按决策域数是 **2**，按代码里的 workflow 服务文件数是 **3**（实测），按「一趟流程」判据数是 **4**。

三个答案都说得通。更硬的一击是**跨域级联时它填不出唯一值**：「兑换单被冻结」这条记录，`workflowType` 该填 `SWAP`、`WITHDRAW` 还是 `CUSTOMER_RESTRICTION`？

**一个连定义都因人而异的字段，不能承担身份职责。** 它原本的职责已被四个字段瓜分：`action` 答「发生了什么」、`actionDomain` 答「改的是谁家的东西」（确定的）、`correlationId` 答「哪一趟」、`causationId` 答「谁触发的」。

⚠️ **本批唯一的过渡层例外**：`workflowType` 列**本批保留但停止语义依赖**，V1 域不再写入。物理删列排在交易域那一批——因为交易域 63 处写入点仍传该字段，本批不碰交易域业务代码。**这是「不留过渡层」约定的一个明确标注的例外，清理时点＝交易域批次。**

---

## 5. 多主体子表 `audit_log_subjects`

### 5.1 为什么必须是子表

一条业务事件天然牵扯**多个**对象，且每个扮演**不同角色**。「MLRO 批准解冻充值单 DEP-1234」牵扯 5 个对象：充值单（主）、客户（归属）、审批单（依据）、资金单（相关）、资产（相关）。

**一对 `entityType`+`entityId` 装不下。** 装不下的塞 `metadata` —— **而 JSON 列建不了索引、做不了精确过滤，塞进去等于查不到**。

行业先例：**CloudTrail 的 `resources` 字段是一个列表**，不是单值。

> 这张表**原本就有**（`audit_log_subject_nos`，2026-02-18 建），**而且当初就带 `subjectRole` 列**，2026-05-20 被整表 DROP。本批是按同样的形状恢复，不是从零设计。
> 而 `rules/audit-logging.md` 的查询契约**至今仍要求**详情返回 `subjectNos[]`、支持按 `subjectNo` 精确过滤——**规矩还在，实现没了**。

### 5.2 表结构

```
audit_log_subjects
  id / eventId(FK, CASCADE) / subjectType / subjectNo / subjectRole / occurredAt / createdAt
  @@unique([eventId, subjectType, subjectNo, subjectRole])
  索引：(subjectNo, occurredAt) / (subjectType, subjectNo, occurredAt) / (subjectRole, occurredAt) / (eventId)
```

**唯一键必须含 `subjectRole`**：同一对象可在一条事件里担两个角色（「冻结这个客户」时客户既是 `OWNER` 又是 `PRIMARY`），不含角色会被误判成重复。

**`subjectNo` 存业务键不存 UUID**：对象可能被删，业务键在记录里仍可读。

### 5.3 五个角色（封闭枚举）

| 角色 | 含义 | 基数 |
|---|---|---|
| `PRIMARY` | 事件**直接作用**的对象 | **至多 1 个** |
| `OWNER` | 归属主体，通常是客户。**监管索档走这个角色** | 0..N |
| `INSTRUMENT` | 动作所**依据**的凭据：审批单、规则行、提现地址、报价单 | 0..N |
| `RELATED` | 被**牵连**的相关单据：资金单、资产、钱包、账本账户 | 0..N |
| `COUNTERPARTY` | **对手方**：外部 VASP、收款人、汇款人 | 0..N |

**刻意不设 `ACTOR`**（业主裁定）：操作人已由主表 `actorNo` 记录，子表再存一份不增加任何新的查询能力，只增加两处对不上的风险。**同一份信息只存一处。**

**`PRIMARY` 零个是合法的**：限额拦截时单根本没建成，那条记录只有 `OWNER` 和 `INSTRUMENT`。守卫只在 `PRIMARY` **多于一个**时抛错。

### 5.4 拆条两判据（满足任一即必须拆）

| 判据 | 内容 | 为什么 |
|---|---|---|
| **甲 · 结果独立** | 每个对象各自可能成功或失败 → 拆 | 一条记录只有**一个 `outcome`**，装不下「审批通过了但执行失败了」 |
| **乙 · PRIMARY 不同** | 两个主体各自的状态都变了 → 拆 | 一条记录只有**一组 `fromStatus`/`toStatus`**，而它记的是 **PRIMARY 的**状态 |

**业主确认：所有日志一律适用。**

**自检信号**：写出 `fromStatus == toStatus` 时先别接受——那通常是 **PRIMARY 选错了**的症状。真正合法的 `from == to` 只剩幂等重放，而那种情况该用 `outcome` 表达。

### 5.5 经典试题：二级审批

某人点批准，审批单从待审变成通过，被审批的事随之执行。直觉答案「1 条，状态放字段」方向对（状态确实该放字段），但踩两条判据：

- **踩判据甲**：批准了解冻、解冻时外部系统报错，是完全可能的。合成一条会显示「审批成功」而实际对象还冻着。
- **踩判据乙**：多级审批的中间票，「状态没变」是错觉——审批单整体没变，但**那一票发生了**。用 `from == to` 记录等于宣称「什么都没发生」。

**修正**：中间票的前后状态两个字段**留空**（语义＝「这个动作没有推动 PRIMARY 的状态」）。

**不为此把「审批步骤」提升成一类主体**——审批分几步是可配置的，拿一个随配置漂移的东西当八年记录的骨架是亏的；而职责分离要举证的「两票不是同一人投的」，靠**同一张单 + 不同 actor + 不同时间**一条查询就拿到了。

```
第一票  APPROVAL_GRANTED   PRIMARY=审批单   前后状态留空
第二票  APPROVAL_GRANTED   PRIMARY=审批单   待审 → 通过
执行    <业务动作>          PRIMARY=业务对象  各自迁移   ← causationId 指回上条
```

---

## 6. 三条追踪线

**一句话记法：`traceId` 是「这一下」，`correlationId` 是「这一趟」。** 一趟里有很多下；一下里可能碰到好几趟。

| | `traceId` | `correlationId` | `causationId` |
|---|---|---|---|
| 边界 | **一次外部触发**（业主定义） | **一个业务流程的一次完整执行** | 直接触发本条的那一条事件 |
| 活多久 | 毫秒~秒 | 分钟~数月 | — |
| 切的方向 | **跨实体**（一次触发能动很多单子） | **跨时间**（一件事要好多次触发才走完） | 跨前两者的边界 |
| 谁生成 | 框架，请求入口 | 业务层，流程开始时 | 调用方传入 |
| 回答 | 这一下系统干了什么 | 这件事一共经历了什么 | 谁导致了谁 |

**制裁场景验证**：一份报文冻 1 个客户 + N 笔订单 → **1 个 `traceId`**（一次 webhook）、**N+1 个 `correlationId`**（每笔订单自己那趟 + 客户那趟）。三个查询各归各位：

- 「这份报文进来后系统干了什么」→ 按 `traceId`
- 「这笔订单一路经历了什么」→ 按 `correlationId`
- 「这个客户名下所有事」→ 按主体子表查客户号

### 6.1 `correlationId` 填写规范

**值**：不透明 UUID v4。**禁止拼业务号、禁止嵌日期或类型**——任何编进 id 的东西都会变，变了 id 就撒谎了。要按类型筛用 `actionDomain` 列。

**只有 `correlationId` 需要进动作码说明**，声明一个三值：

| 模式 | 做什么 |
|---|---|
| `START` | 生成 UUID v4，**同事务**写回主单的 `correlationId` 列 |
| `INHERIT` | 从本条记录的 **PRIMARY 主体**上读；主体是从属实体（如资金腿）就顺父外键上溯到主单再读 |
| `NONE` | 不属于任何旅程（用得很少） |

**开启还是延续是码的固有属性，不随场景变** —— `ADMIN_INVITE_REQUESTED` 永远是开启，`ADMIN_INVITE_ACCEPTED` 永远是延续。故写死在码说明里。

`causationId` **半进**码说明（只声明是否必填，值随场景变）；`traceId` **不进**（框架生成，无脑透传，零判断）。

### 6.2 一条必须写死的铁律

> **`INHERIT` 读不到值时报错失败，绝不允许静默生成一个新的。**

写成 `主单.correlationId ?? 新生成()` 是最常见的偷懒，后果是每次读失败就悄悄开一趟新旅程——**链断了、数据看着正常、完全不报错**。

**实证**：现在库里 78 个 `traceId` 里有 **17 个只有一条记录（22%）**，正是这种断链的样子。

### 6.3 落地地基比预期完整

实测 **23 张实体表已带 `traceId` 列**（`DepositTransaction` / `WithdrawTransaction` / `SwapTransaction` / `ApprovalCase` / `CustomerRestriction` / `MaterialRequest` / `TierUpgradeCase` …）。

**缺的不是字段，是规则**——没人说清边界该怎么划，才出现「有的跨 1 秒、有的跨 8 分钟」的漂移。本批把 `traceId` 列改名 `correlationId` 并补三条规则，**现有代码大部分不用改**。

从属实体（资金单）**不加列**：顺父外键读父单的值。异步 webhook 回来靠被操作实体行上的值找回，**不需要外部缓存**。

---

## 7. 记录密度：三个测试

一个步骤要不要写②，问三句话，**通过任一即记；三个都不通过则属④技术日志**：

| 测试 | 问什么 | 记 | 不记 |
|---|---|---|---|
| **责任** | 有没有「做错了要担责」的主体？ | 人的决定、系统按规则自动判 | 纯技术执行（重试、序列化、缓存刷新） |
| **不可逆** | 之后有没有东西无法自动撤销？ | 钱动了、进终态、对外发消息、对监管报送 | 可随时重跑的中间计算 |
| **可辩护** | 事后会不会单独就这一步被质疑？ | 「你何时知道钱到的」「你为什么放行」 | 「你为什么先查 A 表再查 B 表」 |

**基准**：一笔顺利业务 ≈ **8 条**；走完整异常处置 **15–25 条**。

**异常路径不是「8 条再加几条」，是另一种形状**：多数有人的决定、`outcome` 多样、密度天然更高。且有一类 happy path 完全没有的记录——

> **「到点了但没动」也必须记。** SLA 到期无人处理、重试耗尽、等补料超时、报文迟到落终态被忽略。否则「为什么这单挂了三个月」翻遍日志会发现那三个月是**一片空白**，而空白无法自证是「系统坏了」还是「有人压着」。

**单次重试不记（技术执行、可逆），重试耗尽要记**（不可逆 + 会被质疑）。例外：若某类重试的**次数本身**是合规义务，则每次都记。

---

## 8. 动作词表治理

### 8.1 扁平且全局唯一

**放弃「`workflowType` + `action`」复合键**（理由见 §4.3）。动作码**单列即可唯一识别**，不依赖任何第二列消歧。

### 8.2 命名规则：前缀优先（业主选定）

**同一趟流程的全部码共享同一前缀。**

代价是可读性略让位（`ADMIN_SUSPENSION_APPLIED` 不如 `ADMIN_ACCOUNT_SUSPENDED` 直白），换来的是**一条前缀查询就能捞出整趟流程**。八年下来可检索性比读起来顺值钱；可读性由 `actionDomain` 与词表文档承担。

**六个后缀，语义封闭**：

| 后缀 | 含义 |
|---|---|
| `_REQUESTED` | 发起，一趟的起点，通常 `correlationMode = START` |
| `_APPLIED` | **变更被施加** —— 审批通过后执行，或系统自动施加（如锁定） |
| `_COMPLETED` | **一趟多步流程走完** —— 不走审批的多步流程（首登四步、自助改密） |
| `_CANCELLED` | 中途作废。**只给代码里真有取消路径的流程加**，不按对称性硬凑 |
| `_EXPIRED` | 到期作废，系统写 |
| `_DENIED` | 系统主动挡住、动作没执行成，与 `outcome=DENIED` 配套 |

**分类维度不编进码里**（不要 `TRADING_DEPOSIT_APPROVED`）：分类体系会调整，动作码不能跟着变。CloudTrail 同款——`eventName` 扁平，`eventSource` 独立成列。

### 8.3 失败用 `outcome` 表达，不用动作码表达

业主裁定。V1 现有 7 个 `*_FAILED` 码全部收编。

**`outcome` 说的是「动作执行成没成」，不是「业务结果好不好」**：

- `APPROVAL_DECLINED`（审批被驳回）的 `outcome` 是 **`SUCCESS`** —— 驳回这个动作成功执行了。业务被拒由动作码名字表达。
- `DENIED` 留给**系统主动挡住、动作压根没执行成**：SoD 冲突、自审防篡改、速率限制、令牌失效。
- `FAILED` 留给**试了但技术上没成**：邮件发送失败、下游写库失败。

### 8.4 每个码出生即定死

新增动作码时**当场**声明四件事，不能「先上线回头补」：

```
<CODE>
  语义:              一句话
  actionDomain:      IAM / APPROVAL / CONFIG / AUDIT / …
  correlationMode:   START / INHERIT / NONE
  额外必填字段:       该码特有的要求
  causationId:       是否必填（异步驱动的码必填）
```

**理由**：一旦有记录用这个码写进库，再补必填规则——**那些历史记录永远残缺，而且改不了**（只增不改是第一条铁律）。

**副作用是好的**：这四行合起来，写入时就能做**机器校验**——缺字段拒绝写入、`START` 的码却读到已有旅程也拒绝写入。「条件必填」由此从一句文档变成硬闸门。

### 8.5 反模式

```
❌  action = ORDER_UPDATED
    metadata = { what: "status", from: "...", to: "..." }
```

用通用码 + 附加字段里的子类型，会让**所有按动作的统计、告警、权限映射全部失效**。判据：**两件事若需分别统计/授权/告警，就必须是两个码。**

---

## 9. 前后值：什么时候要、存多少

**判据一句话：变的是「状态」→ 前后状态两列就够了；变的是「配置或属性」→ 才需要 `beforeData`/`afterData`。**

| 动作 | 要前后值 | 为什么 |
|---|---|---|
| 订单批准 / 放款 / 成交 / 审批通过 | ❌ | 状态变化，`fromStatus`/`toStatus` 已说清；金额另有专列 |
| 改费率 · 改限额 · 改角色 · 改客户主数据 | ✅ | 属性变化，只有前后值能答「从多少改成多少」 |

**大量业务流水类动作根本不需要这一栏**，误加只会撑大记录、淹没信号。

**存法：只存变了的那几项，不存整行。** 存整行有三个代价——记录膨胀；审计员得自己比对；**整行若含证件号、银行账号，改任何一项都会把它们复制一遍，白白扩大泄露面**。

两个细节：机械变化（`updatedAt`、`version`）**不记**；「维持不变」是个决定但**不用前后值相同表达**（那等于没信息），写进 `outcome` 与 `reason`。

**定的时点：跟动作词表一起定，不能分开** ——「这个码需要哪些字段」和「要不要记前后值」是同一个问题的两面。

---

## 10. 打点上收编排层

### 10.1 为什么审计必须写在编排层

审计记录所需的信息**八成只有编排层知道**：

| 字段 | 领域服务拿得到吗 |
|---|---|
| `actorNo` / `actorRolesAtTime` / `authnMethod` / `onBehalfOf` | ❌ 请求上下文，实体层不该知道谁在调它 |
| `correlationId` / `causationId` | ❌ 旅程由编排层定义 |
| `permissionCode` / `policyVersion` / `approvalNo` | ❌ 授权是编排层的事 |
| 多主体（`OWNER`/`INSTRUMENT`/`RELATED`） | ❌ 实体只知道自己 |
| `sourcePlatform` / `endpoint` / `requestId` | ❌ 拿不到 |
| `fromStatus`/`toStatus` · `beforeData`/`afterData` | ✅ |

强行让领域服务写，就得把 actor、旅程号、权限码一路当参数塞进每个方法 —— **实体层会因此获得它不该有的知识**，分层就破了。

**行业同构**：Kubernetes 的审计在 **kube-apiserver 的请求管线**里生成，**不在 etcd**（存储层不知道谁在调）；CloudTrail 在服务 API 边界记录，不在底层存储。

### 10.2 代价与配套

**编排层写审计的软肋是绕得过**：任何不经编排层的写入（直接调实体、通用改状态接口、脚本改库、跨模块后门），数据变了而审计为空，**且不报错**。

配套是**覆盖率闸门**（回放对账）—— 业主裁定本期不做，方法见 §11。

### 10.3 清单：32 个文件

**A · 领域服务（24 个，必须上收）**

```
identity/auth/customer-auth.service.ts                 10 处   ← 客户登录，归③，本批删除打点
identity/auth/auth.service.ts                           8 处   ← admin 登录，归③；连续失败锁定改写为 ADMIN_ACCOUNT_LOCK_APPLIED 并上收
identity/client-risk-assessment/…service.ts             7 处
identity/material-requests/material-requests.service.ts 5 处
identity/customers/customer-restrictions.service.ts     4 处
counterparty/liquidity-config/liquidity-config.service.ts 4 处
trading/withdraw-transactions/withdraw-transactions.service.ts 4 处
identity/customers/customers.service.ts                 3 处
identity/tier-upgrade-case/tier-upgrade-case.service.ts 3 处
identity/users/admin-invitations.service.ts             3 处   ← V1，上收 admin-invite-workflow
trading/swap-fee-level/swap-quote.service.ts            3 处
trading/deposit-transactions/deposit-transactions.service.ts 3 处
asset-treasury/wallets/customer-deposit-wallet.service.ts 2 处
identity/customer-tags/customer-tag.service.ts          2 处
identity/onboarding/onboarding.service.ts               2 处
clearing-settle/reconciliation/disposition/push-order.service.ts 2 处
trading/swap-transactions/swap-transactions.service.ts  2 处
accounting/tigerbeetle/tb-manual-account.service.ts     1 处
asset-treasury/transaction-limits/transaction-limit-gate.service.ts 1 处
asset-treasury/wallets/wallets.service.ts               1 处
identity/access-control/access-control.service.ts       1 处   ← V1
governance/registries/governance-registries.service.ts  1 处
governance/regulatory-gates/regulatory-gates.service.ts 1 处
trading/deposit-transactions/inbound-transfer-signals.service.ts 1 处
```

**B · 适配 / 扫描 / 演示层（7 个，逐个定性不一刀切）**

```
deposit-sumsub/deposit-sla.service.ts        2 处
withdraw-sumsub/withdraw-sla.service.ts      2 处
swap-sumsub/swap-sla.service.ts              1 处
deposit-sumsub/demo-scenario.service.ts      1 处
withdraw-sumsub/demo-scenario.service.ts     1 处
swap-sumsub/demo-scenario.service.ts         1 处
swap-sumsub/applicant-action.handler.ts      1 处
```

**定性规则**：SLA 扫描服务与 webhook handler 属**编排性质**（它们知道 actor、旅程、依据），可**保留原位**但必须补齐 subjects 与三条追踪线；`demo-scenario` 属演示脚手架，其写入应标 `sourcePlatform = SCRIPT`。

**C · controller（1 个，违规）**

```
funds-orders/funds-orders.admin.controller.ts:82
```

**必须上收**：审计绑在**业务事件**上，不能绑在**入口**上——同一业务事件有多个入口（管理端 / 客户端 / 定时任务 / webhook），写在入口层则换个门进来就没痕迹。

### 10.4 分工：实体层判断，编排层记录

领域服务会拒绝非法操作（如不允许的状态跳转）。按「可辩护」测试，**被拒绝也必须记**。

**做法**：实体层抛出**带原因码的结构化异常**，编排层捕获后写审计。判断在下面，记录在上面，职责不混。

---

## 11. 覆盖率闸门（本期不做，方法留档）

审计写在编排层就必须配一道独立核对：**比对「数据变了多少次」与「审计记了多少条」，对不上即为绕过。**

三种做法递进：

| 方法 | 覆盖 | 成本 |
|---|---|---|
| **状态回放** —— 按审计重放状态迁移，与业务表实际状态比 | 只覆盖状态，查不出金额/地址被改 | 不改表结构，最低 |
| **改动次数比对** —— 业务表加「改动次数」列，**数据库层强制自增** | 覆盖全字段 | 要加列 + 触发器 |
| **数据库变更流比对** —— 读 binlog/WAL/CDC | **真兜底**，直接改库也逃不掉 | 最高，噪声大 |

**铁律：核对必须用两个互相独立的来源。** 拿审计日志核对审计日志永远是绿的——绕过的那一次根本没往审计里写过东西。

配套六件事：范围（有审计义务的对象）· 频率（常规每日 + 高危准实时）· 差异三分类（良性白名单需审批 / 可解释记债 / **不可解释走事件响应**）· 对账本身要留痕 · 跑的人不能是被对账的人 · 报告格式。

**将来起步建议**：状态回放 + 只覆盖资金类单据 + 每天一次。别一上来上第三种，多半会卡在「过滤噪声」变成没人看的告警源。

---

## 12. V1 完整日志清单：45 个动作码

**十一组，全局唯一，前缀优先命名。** 逐码的 PRIMARY / 其他主体 / `correlationMode` / 允许的 `outcome` / 额外必填字段见配套词表文档。

| 分组 | actionDomain | 码数 | START | 能出 DENIED |
|---|---|---|---|---|
| 横切 · 审批引擎 | `APPROVAL` | 6 | 0 | 1 |
| ① 入职邀请 | `IAM` | 5 | 1 | 2 |
| ② 首次登录 | `IAM` | 4 | 1 | 1 |
| ③ 角色绑定变更 | `IAM` | 3 | 1 | 1 |
| ④⑤ 停用 / 恢复 | `IAM` | 4 | 2 | 0 |
| ⑥ 密码重置（两条路） | `IAM` | 6 | 2 | 2 |
| ⑦ MFA 重置 | `IAM` | 3 | 1 | 0 |
| ⑧ 账号锁定 / 解锁 | `IAM` | 2 | 1 | 0 |
| ⑨ 角色定义（建 / 改） | `CONFIG` | 6 | 2 | 0 |
| ⑩ 审批策略变更 | `CONFIG` | 2 | 1 | 1 |
| ⑪ 审计日志自身 | `AUDIT` | 4 | 1 | 0 |
| **合计** | — | **45** | **13** | **8** |

### 12.1 三个关键设计

**审批横切模板**：八个工作流走审批。审批记录 PRIMARY=审批单，业务侧记录 PRIMARY=业务对象，按判据乙各自成条——**同时发生、同一个人，但不是重复**。

**新增 `APPROVAL_SOD_DENIED`**：职责分离拦截（maker 自审、跨步骤同人、改审批策略自身）现在**发生了但不留痕**。这是本清单价值最高的一条。

**新增 `AUDIT_LOG_QUERIED`**：导出有痕（走审批）**但查看无痕**。它也是唯一 `correlationMode = NONE` 的码——查审计不属于任何业务旅程。

### 12.2 边界：登录归哪

**判据：「使用」访问能力 = ③ 安全日志；「改变」访问能力 = ② 业务审计。**

| | 归属 |
|---|---|
| 登录成功 / 失败流水（admin 与客户） | ③ |
| **连续失败 → 账号锁定**（admin 与客户） | **②**（业主裁定） |
| 首登绑 MFA / 密码重置 / MFA 重置 / 角色变更 / 停用恢复 | ② |
| 客户改密码 / 改 MFA / 改安全设置 | ② |
| 新设备 / 新地区首次登录 | ③ + 告警（**除非触发了限制**，触发了就转 ②） |

**锁定归 ② 的自洽性论证**：客户被冻结、被贴限制**已经在 ② 里了**。「连续失败被锁定」本质就是客户能力被系统限制，跟制裁冻结同性质。**分开放的话，「这个客户为什么用不了」要跨两套日志拼。**

**账户接管调查**（「这笔可疑提现之前账户从哪登的」）的答案**不是**把登录流水搬进 ②（量会淹掉业务信号），而是 ③ 保留足够长 + 用 `traceId` 与客户号对接，取证时跳过去。

### 12.3 退役 11 个

| 退役 | 去向 |
|---|---|
| 7 个 `*_FAILED`（`MFA_VERIFY_FAILED` / `RESET_FAILED` / `CHANGE_APPLY_FAILED` / `ROLE_ACTIVATE_FAILED` / `ROLE_MODIFY_FAILED` / `MODIFICATION_APPLY_FAILED` / `GENERATION_FAILED`） | 收编进 `outcome=FAILED` + `reasonCode` |
| `ADMIN_LOGIN_SUCCESS` | ③。⚠️ 该字面量现**在两处常量各定义一份**，退役时两处一起清 |
| `ADMIN_LOGIN_FAILED` | ③ |
| `MFA_LOGIN_VERIFIED` / `MFA_LOGIN_VERIFY_FAILED` | ③。日常登录的 MFA 校验属「使用」，区别于首登的绑定 |

**退役 = 标记 deprecated、不再允许新写入、历史仍可读**，不是删除。

### 12.4 一个必须知会的代价

**50 个旧码里只有 `APPROVAL_SUBMITTED` 一个字面量原样保留** —— 选前缀优先＝**整张词表换名**。

因为演示数据可随时重铺、尚无八年历史包袱，**现在换是最便宜的时机**；一旦有真实历史，改名成本不可逆。这也是本批必须把词表定死的原因。

---

## 13. 六个取证问题（验收的真正标准）

不用「字段够不够」评判，用**「这六个问题能不能一条查询走完」**评判：

| # | 问题 | 靠什么 | 本批后 |
|---|---|---|---|
| 1 | 某人在职期间做过什么 | `actorNo` + 时间区间 | ✅ |
| 2 | 某单据从生到死被谁碰过（**含它只是「相关方」的事件**） | **主体子表** | ✅ 本批恢复 |
| 3 | 这笔钱每一步依据什么、谁导致了谁 | `correlationId` + `causationId` | ✅ V1 域 |
| 4 | 监管说「把某客户的全部记录给我」 | `ownerCustomerNo` + `subjectRole=OWNER` | ✅ 本批恢复 |
| 5 | 谁被拒过、谁拒的、依据哪条规则哪个版本 | `outcome=DENIED` + `ruleVersion` | ✅ V1 域 8 个码 |
| 6 | 谁看过、导出过审计日志 | `isReadOnly` + `AUDIT_LOG_QUERIED` | ✅ 本批新增 |

**第 2、3 题是分水岭**：第 2 不成立＝缺子表，第 3 不成立＝缺因果线。这两题不过，其余做得再漂亮也只是一堆流水账。

---

## 14. 五条约定（非字段，缺一条上面全白设）

1. **数据库层收回写入账号的 UPDATE / DELETE 权限** —— 「只增不改」靠代码自觉迟早有人为修笔误跑 UPDATE。把它变成物理上做不到才叫控制。
2. **动作展示名单独一张映射表，带生效区间** —— 主表只存永不变的 `action` 码。
3. **全库 UTC 存储 + NTP 时钟同步** —— 不同步的时间戳会给出错误的先后顺序，而先后顺序常常就是责任归属。
4. **脱敏规则：敏感键掩码，但 `payloadDigest` 取自原文** —— 否则脱敏本身成了篡改的掩护。
5. **超长载荷有明确的截断优先级** —— CloudTrail 明确规定**最后才截 `errorMessage`**。本项目定：先截 `beforeData`/`afterData`，最后才动 `reason`。

---

## 15. 验收标准

1. **表结构齐备**：`audit_log_events` 十组字段全部落列；`workflowType` 停止 V1 域写入；`updatedAt` 已删
2. **命名与枚举全按应然**：`outcome` 四值枚举可用；`eventNo`/`primarySubjectNo`/`ownerCustomerNo`/`recordedAt`/`actorRolesAtTime` 全部到位
3. **子表可用**：`audit_log_subjects` 建成，五角色齐，唯一键含 `subjectRole`
4. **PRIMARY 唯一性守卫生效**：一条事件挂两个 `PRIMARY` 时写入被拒；挂零个合法
5. **按客户查得到**：客户从未被改，但按客户号经子表能检索到该笔全部记录——**判据是命中记录里「主对象不是客户本人」的条数 > 0**
6. **按依据查得到**：按审批单号能反查出它批出了哪些动作
7. **拒绝有痕**：V1 域 8 个能出 `DENIED` 的码，各自产生过至少一条 `outcome=DENIED` + `reasonCode` 的记录
8. **`INHERIT` 读不到即报错**：人为清掉主单的 `correlationId` 后再触发动作，写入失败而非静默生成新值
9. **打点全部在编排层**：全仓扫描，领域服务与 controller 零 `recordByActor`/`recordSystem` 调用（SLA/handler 类按 §10.3 定性保留者除外，且已补齐 subjects 与三条追踪线）
10. **V1 词表实装**：45 码全部有真实调用方；11 个退役码标 deprecated 且零新写入
11. **每码声明完整**：45 个码各自的 `actionDomain` / `correlationMode` / 额外必填 / `causationId` 是否必填 四项齐备，且写入时可机器校验
12. **六个取证问题**：第 1/2/4/5/6 题在 V1 域各能一条查询走完；第 3 题因果链在 V1 域可追
13. **断言不是自证型绿灯**：每个新增测试须做变异测试——注释掉实现必须变红
14. **硬闸**：五道构建闸门，`tsc` 四份配置 0 错；全量 `jest` 净新失败 = 0

---

## 16. 明确不在本批范围

看到以下这些**不要顺手补上**：

- **三个交易域（充值 / 提现 / 兑换）的日志梳理** —— 动作码、subjects 填充、拒绝路径接入，全部后续批次
- **`workflowType` 物理删列** —— 交易域 63 处写入点仍传该字段，删列排在交易域批次（§4.3 标注的过渡层例外）
- **安全日志（③）的建设** —— 归运维
- **回放对账 / 覆盖率闸门** —— 业主裁定本期不做，方法已留档 §11
- **交易域词表瘦身** —— 496 个码里 59 个在用，那是交易域批次的活
- **`seq` 与哈希链的校验工具** —— 列本批建，验证脚本后续
- **`legalHold` 的运维流程** —— 列本批建，触发与解除流程后续
- **`AUDIT_LOG_QUERIED` 的查询规模分级** —— 本批先无差别记录

---

## 附录：本稿事实核查方式

- **全部数字均为本轮实跑所得，非引用既有文档**。来源三处：`prisma/schema.prisma` 与 194 个迁移的历史 · 全仓 63 个调用 `recordByActor`/`recordSystem` 的源文件 · main 栈 live 库 `/tmp/exchange_js_main/dev.db` 的 466 条 `audit_log_events` 记录
- §0 的 `traceId` 语义分布经**两次计算**：首次误把毫秒时间戳当日期串解析（`julianday()`），得出「61 个全部跨 1 天以上」的错误结论；重算后为「中位 1 秒、33 个 <1 秒、14 个 >1 分钟」，本稿采用后者
- §8.1「放弃复合键」的结论**推翻了本轮早先的相反判断**。早先据「16 个字面量撞名」主张重命名 51 个码，经业主质询后实测两个前提均不成立（`workflowType` 91% 填充、幂等键不含该字段），确认**复合键设计本身有先例（CloudTrail `eventSource`+`eventName`、K8s `verb`+`resource`）**，真正的缺陷在另外两处；最终因 §4.3 的场景论证而整体放弃
- §12 的 45 码经三轮机检：字面量全局唯一 · 前缀归组与分组声明逐一对上 · 汇总表的 START/DENIED 计数由数据结构生成，与表格行数物理一致
- §10.3 的 32 个文件清单为逐文件 `grep` 计数所得；§12.3 退役清单中「`ADMIN_LOGIN_SUCCESS` 在两处常量各定义一份」经 `grep -rn` 实证
- 上一版 41 码经业主要求复查后补 4 减 1：补漏三处（`APPROVAL_POLICY_CHANGE_REQUESTED` 违反自定判据乙、密码重置两条路被错误合并、`ROLE_DEFINITION_MODIFY_CANCELLED` 漏抄）、补现状缺口一处（`ADMIN_ROLE_CHANGE_CANCELLED`，代码 `:176` 有取消路径而旧词表无码）、业主裁定去掉 `ADMIN_PRIVILEGE_OVERRIDE_USED`（SUPER_ADMIN bypass 是 demo 产物）
- 停用/恢复**刻意不加 `CANCELLED`**：实测两文件 `cancel` 相关代码 0 处，按实际能力走不按对称性凑
