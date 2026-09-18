# 演示装备一期：Sumsub 交易面板统一 + 造数花名册

> 日期：2026-08-29 ｜ 状态：设计定稿 ｜ 分支：待建
> 范围：BACKLOG A 档「演示装备」剩下的两条（A5 造数、A7 补料弧），合并成一轮做。
> 上游：2026-08-28 两本台账二次分诊（`5687e6ad`）+ A 档 8 条实跑复核（`4ed929e4`）
> 口径依据：`rules/review-rubric.md` 判定表 ｜ `decisions.md` [2026-08-24] 同一职责同一组件 ｜ `modules/v4-deposit.md` §状态表

---

## 0. 决策记录

含两条**被实测推翻**的判断——写在最前面，避免下一个人重走。

| # | 问题 | 结论 | 理由 |
|---|---|---|---|
| 1 | 交易 webhook 该管什么 | **只管两件：驱订单状态机 + 下发材料**。材料审核是另一个 webhook，不在交易面板 | 业主 2026-08-29 定。材料审过应解开该客户名下**所有**被卡的单，与哪笔交易触发无关；挂在订单面板上是错的归属 |
| 2 | 充值/提现要不要补「认证复核」按钮 | **不补。反过来删掉兑换的 ⑦⑧** | 同上。⑦⑧ 是 `MaterialRequestPanel` 那三个按钮的重复品，且装错了位置 |
| 3 | ~~删掉 ⑦⑧ 后三域会没有解锁扳机~~ | **假的，已被实测推翻** | `POST /admin/sumsub/simulate/applicant-action-result` 早就存在，住在中立的 `sumsub-ingestion` 模块；前端在客户详情页 Verification Requests 区块，三个按钮（✅ Approve / 🔄 Retry / ❌ Final）。**分层本来就是对的** |
| 4 | ~~A7 = 充值/提现缺解锁按钮~~ | **假的，已被实测推翻** | 2026-08-29 全链实跑：⚡② → 客户端提交 → 管理台 Approve → 便签 RELEASED、客户恢复交易。闭环通的 |
| 5 | A7 真身是什么 | **充值/提现不监听 `MATERIAL_REQUEST_REVIEWED`，材料审过订单不回炉** | 同一次实跑：便签解了、客户能交易了，但那笔充值单 20 秒后仍是 `ACTION_PENDING`。`modules/v4-deposit.md` 写的是 `COMPLIANCE_PENDING ⇄ ACTION_PENDING`（补齐回炉），代码里没有触发这条回边的人 |
| 6 | 抄兑换的 listener 吗 | **不能抄，得新建** | 兑换的 `SwapApplicantActionHandler` 干的是**记一条审计**（GREEN 来了但硬线还在，故意不解），不是回炉——兑换软线单已是 `REJECTED` 终态，没什么可回炉。全仓没有回炉范本 |
| 7 | Sumsub 回传的 tag 分两类吗 | **不分。一个 `typedTags` 数组，一种形状** | 分两类是我方 handler 的读法：label 落在 `SCENE_TAGS` 就当"命中了什么"，落在 `DISPO_TAGS` 就当"该怎么办" |
| 8 | 那 `DISPO_TAGS` 是谁打的 | **人手工打的**（`type: 'userDefined'` 本来就是给人用的） | 代码注释即为证：「合规官最标准的操作恰恰是一边打 `RETURN_TO_SENDER` tag 一边驳回」。现实假设＝我方合规官/MLRO 在 Sumsub 审核台上办公 |
| 9 | ~~处置 tag 绕过了 MLRO 审批门~~ | **没绕，是我想多了** | `FROZEN_BY_MLRO` 直接冻单，而文档说"制裁冻结＝系统自动、无审批（保护动作）"✓；`RETURN_TO_SENDER` **不直接退**，先落 `MANUAL_CHECKING` 把 tag 写进 reason，真正退回仍要运营发起 + MLRO 批 ✓。**tag 只路由并留建议，不绕门** |
| 10 | 便签挂客户还是挂订单，由什么决定 | **由 tag 决定，不由按钮决定** | 业主 2026-08-29 提出"普通 awaiting user 不该限制客户"。归纳成规则：SOF 问的是**这笔钱**哪来的＝交易层→只挂订单；PEP 问的是**这个人**是不是政治人物＝人身层→挂客户 |
| 11 | `demo:all` 是闸门还是造数器 | **两个都是**：造一批各种状态的单，同时打印答案键逐条比对 | 业主选甲。现有 `recon:demo:break` 就是这个模式（造烂数据 + 答案键），学习成本为零 |
| 12 | 造数要不要随机 | **固定** | 仓库现有约定就是固定（`DEP_USDT='3000'` 等常量）；随机金额会自己穿仓；`demo/data.md` 已声明要改成脚本自动生成，随机则每次都变、分不清漂移与噪音 |
| 13 | 三条处置弧（没收/退回/上缴）造不造 | **造** | 它们是唯一能证明 V4 篇开篇公理「每个终态都回答了钱去哪了」的样本。今天库里一笔都没有 |
| 14 | 面板层合并到什么程度 | **充值+提现合并；兑换共用底座、保留自己的按钮表** | 充值/提现去注释去 import 后实质差异＝**1 个按钮**（实测），合它是还债；兑换差异是真的（8 vs 11、四态 vs 十态），硬合会造出谁都不想读的配置表 |

---

## 1. 定位与边界

**本轮交付三件**：

| 部分 | 做什么 | 解掉 |
|---|---|---|
| **A** | 三域 Sumsub 交易面板按钮表统一（11 / 11 / 8） | 圈码错位、⑨ 假 SLA 按钮、兑换报文失真、PEP 未分主体 |
| **B** | 充值/提现补 `MATERIAL_REQUEST_REVIEWED` 回炉 listener | **A7 真身** |
| **C** | `demo:all` 改成花名册造数器 + 答案键 | **A5** |

**顺序**：A → B → C。C 的造数器要按 A 定稿后的按钮表驱状态，A 不定 C 就得返工。

**不做**（各有归属，不在本轮）：

- 真接 Sumsub 申请人侧 —— BACKLOG C 档「一期客户流程重做」
- 材料审核 UI —— **已存在**，本轮零改动
- 圈码以外的 admin 三域前端一致性 —— PRODUCTION-NOTES 前端观感组
- 兑换的对手方场景 —— 兑换没有对手方，是业务本身不一样，不是缺口

---

## 2. A 部分 · 三域交易面板统一

### 2.1 分层原则（本轮最硬的一条）

> **交易 webhook（`applicantKytTxn*`）只负责：驱动订单状态机 + 下发材料请求。**
> **材料审核（`applicantActionReviewed`）是另一个 webhook，作用于客户，不在交易面板上。**

推论：三域交易面板**一个认证复核按钮都不该有**。兑换现有的 ⑦⑧ 删除。

### 2.2 主表

骨架取自 Sumsub 报文自身的 `scoringResult.action` 四档，不是自造分组。

| 码 | 按钮 | `action` | tag | 谁打的 | 便签 | 充值 | 提现 | 兑换 |
|---|---|---|---|---|---|:--:|:--:|:--:|
| ① | Approved | `score` | — | 引擎 | — | ✓ | ✓ | ✓ |
| ② | Awaiting user | `awaitUser` | — | 引擎 | **只挂订单** | ✓ | ✓ | ✓ |
| ③ | Awaiting user · PEP（客户本人） | `awaitUser` | `PEP_APPLICANT` | 引擎 | 挂客户 | ✓ | ✓ | ✓ |
| ④ | Awaiting user · PEP（对手方） | `awaitUser` | `PEP_COUNTERPARTY` | 引擎 | 挂客户 | ✓ | ✓ | **—** |
| ⑤ | Awaiting user · 多条 | `awaitUser` | — | 引擎 | **只挂订单** | ✓ | ✓ | ✓ |
| ⑥ | On hold | `onHold` | — | 引擎 | — | ✓ | ✓ | ✓ |
| ⑦ | Rejected · Sanctions（客户本人） | `reject` | `SANCTION_APPLICANT` | 引擎 | 挂客户 | ✓ | ✓ | ✓ |
| ⑧ | Rejected · Sanctions（对手方） | `reject` | `SANCTION_COUNTERPARTY` | 引擎 | —（只冻单） | ✓ | ✓ | **—** |
| ⑨ | Rejected · MLRO freeze | `reject` | `FROZEN_BY_MLRO` | **人** | —（只冻单） | ✓ | ✓ | ✓ |
| ⑩ | Rejected · 处置标签 | `reject` | 充值 `RETURN_TO_SENDER`<br>提现 `FINAL_REJECTED` | **人** | — | ✓ | ✓ | **—** |
| ⑪ | Rejected · no disposition tag | `reject` | 无 | 引擎 | — | ✓ | ✓ | ✓ |

**充值 11 ｜ 提现 11 ｜ 兑换 8**

圈码在三域指同一件事——顺手解掉「圈码三域错位」。

### 2.3 兑换缺的三格，全部是真实差异

| 缺 | 为什么 |
|---|---|
| ④ PEP 对手方 | 兑换是客户账内换币，**没有对手方**，没有第三方地址/IBAN 可查 |
| ⑧ Sanctions 对手方 | 同上 |
| ⑩ 处置标签 | 兑换的 `FROZEN` 是**零出边终态**，没有没收/退回/上缴那类弧，无处可标 |

**这是能达到的最统一状态。** 不得为了凑数造这三个。

### 2.4 删除的四个

| 删 | 域 | 理由 |
|---|---|---|
| `Rejected · SLA breach`（旧⑨） | 充值、提现 | **假货**：只投一份报文，与真实 SLA 定时器的取证痕迹对不上（PRODUCTION-NOTES 在案）。三域各有真的 `POST :no/simulate-sla-timeout` 端点，删掉零损失 |
| `Rejected · 硬线（无 action）`（旧②） | 兑换 | 与新 ⑪ `no disposition tag` 重名 |
| `Rejected · 软线（下发认证）`（旧③） | 兑换 | 与新 ② `Awaiting user` 重名 |
| `认证通过 / 认证不通过`（旧⑦⑧） | 兑换 | 不属交易层（§2.1）；且是 `MaterialRequestPanel` 三按钮的重复品 |

### 2.5 结局不统一是对的

同一个 ② `Awaiting user`，三域落点不同：

| 域 | 落点 | 为什么 |
|---|---|---|
| 充值 | `ACTION_PENDING`（挂着等） | 钱已在暂扣户，等得起 |
| 提现 | `ACTION_PENDING`（挂着等） | 同上 |
| 兑换 | **等同拒绝**，但仍下发材料 | 报价锁了、卖出余额锁了，挂不住三天 |

**统一的是按钮和报文，不是结局。** 按钮只负责喂报文，结局由各域 handler / workflow 决定——这正是 §2.1 那条原则的落地形态，所以三域可共用一张按钮表而不必改任何一个域的状态机。

### 2.6 连带改动（不改就名不副实）

**(1) PEP 分主体** —— 补 2026-08-20「制裁命中分主体」漏掉的对称性。

现状 `SceneTag = 'SANCTION_APPLICANT' | 'SANCTION_COUNTERPARTY' | 'PEP'`（制裁分了，PEP 没分）。改为四值，优先级表从三档扩到四档，沿用既有的「收紧优先」原则（原注释：漏冻的代价远大于多冻一次）：

```
SANCTION_APPLICANT: 4  >  SANCTION_COUNTERPARTY: 3  >  PEP_APPLICANT: 2  >  PEP_COUNTERPARTY: 1
```

落点：充值/提现两域的 `*-kyt-verdict.handler.ts` 的 `SceneTag` 类型 + `SCENE_TAGS` + `SCENE_TAG_PRIORITY`。

**(2) 提现 ⑩ 改名连 tag 值一起改** —— `REJECT_REFUND` → `FINAL_REJECTED`，三处联动：fixture 的 label 与 tag、handler 的 `DISPO_TAGS` 集合、`dispoTag` 的类型声明。历史审计里的旧值不管（数据随时可重铺，CLAUDE.md §3）。

**(3) 兑换报文补齐** —— `SwapVerdictVerdict` 现只有 4 个字段，补上 `reviewStatus / action / reviewRejectType / matchedRules`，三域共用 `TxnReportVerdict`。**不是凭空造**：这些是真 Sumsub 本来就会发、被分叉时省掉的字段。

**(4) 兑换要认 tag** —— 兑换 handler 现在把 `typedTags` 原样往 workflow 传，不读 `SCENE_TAGS`/`DISPO_TAGS`。新增的 ③ PEP、⑨ MLRO freeze、⑤ 多条材料都要求兑换 workflow 认这些 tag。

**(5) 便签挂谁由 tag 决定** —— issuer 调用时按档传参：

| 档 | 问的是 | `restrict` |
|---|---|---|
| ② 普通（SOF）、⑤ 多条 | 这**笔钱**哪来的 | `false` —— 只挂订单，成"提醒型"材料请求 |
| ③④ PEP | 这**个人**是不是政治人物 | `true` —— 开客户级便签 |

`PENDING_DOCUMENT` 是唯一 `scopeSelectable: true` 的因由，地基已支持，无需改常量表。
`MaterialRequestPanel` 已有对应文案：「Rows without a restriction are reminders only.」

### 2.7 共享化范围

| 件 | 处理 |
|---|---|
| 充值 + 提现的 `verdict-buttons.ts` | **合并成一份**，⑩ 的 tag 按域取值（唯一差异） |
| 充值 + 提现的 `demo-scenario.service.ts` | **合并成一份** + 每域一个小适配器（读/写自己的订单模型、写自己的审计） |
| 充值 + 提现的 ⚡ 面板前端 | **合并成一份**（现有两份归一化后 diff 只差 1 行，PRODUCTION-NOTES 已量过） |
| 兑换 | **共用底座**（`TxnReportVerdict`、报文生成器、摄取管道），**保留自己的按钮表** |
| 共享件住址 | 从 `deposit-sumsub` 迁到中立处，与 `sumsub-ingestion` 同级 —— 现在提现/兑换是 `import '../deposit-sumsub/...'` 反向依赖充值域 |

面板上按 §2.2 的「谁打的」列**分两组**渲染：引擎自动命中 / 合规官手工处置。运营一眼看得出自己在模拟哪一种。

---

## 3. B 部分 · 补料回炉（A7 真身）

### 3.1 缺口

`MATERIAL_REQUEST_REVIEWED` 事件当前只有两个监听方：

| 监听方 | 干什么 |
|---|---|
| `swap-sumsub/applicant-action.handler.ts:47` | **记一条审计**（GREEN 到了但客户带硬线，故意不解，留痕给调查员） |
| `identity/material-refresh/material-refresh-review.listener.ts:46` | 材料刷新域收尾 |

**没有任何一个域会把订单回炉。** 充值/提现的 `@OnEvent` 清单里根本没有这个事件——它们只听 `CUSTOMER_RESTRICTION_OPENED`（便签**开启**），单向。

实测（2026-08-29，main 栈）：`ACTION_PENDING` 的充值单，客户提交材料 + 管理台 Approve 之后，便签 `RELEASED`、客户恢复交易能力，**充值单本身 20 秒后仍是 `ACTION_PENDING`**。

### 3.2 判定：是业务缺口

`modules/v4-deposit.md` §状态表明写：

> 等客户补料 ｜ `COMPLIANCE_PENDING ⇄ ACTION_PENDING`（**补齐回炉**）

文档有这条回边，代码没有触发它的人 → `rules/review-rubric.md` 判据 #1（业务逻辑不符）。

**不是死局**：`approveDeposit` 的入口白名单含 `ACTION_PENDING`，运营可在详情页直接批。但两者业务含义不同——

| | 含义 |
|---|---|
| 文档说的「补齐回炉」 | 材料补齐 → **重跑一次合规筛查** → 再定去留 |
| 现在实际能做的 | 运营**看着办**，直接放行 |

合规演示里这是要害区别：「补料后重新筛查」是业务规则，「运营拍板绕过」不是。

### 3.3 做法

充值域、提现域各新增一个 `@OnEvent(MATERIAL_REQUEST_REVIEWED, { async: true })` 监听：

```
收到事件
  ├─ 事件里的 orderDomain 不是本域 → 直接返回（铁律③：各管各的）
  ├─ outcome === 'APPROVED'（GREEN）
  │    └─ 订单在 ACTION_PENDING → 沿显式迁移表推回 COMPLIANCE_PENDING，重跑合规
  │       （订单已不在 ACTION_PENDING → no-op，留一行日志：迟到的复核）
  ├─ outcome === 'RETRY'  → 订单留在 ACTION_PENDING（材料行还能再用），不动状态
  └─ outcome === 'REJECTED'（FINAL）→ 订单留在 ACTION_PENDING，等运营处置
       （便签按「只有 GREEN 撕便签」留在原地——材料账既有口径，本轮不动）
```

**三条约束**：

1. **只走迁移表**（铁律④）：`ACTION_PENDING → COMPLIANCE_PENDING` 这条边若转移表里没有，加一条边，不许绕表直写
2. **必留痕**（铁律①）：回炉是 operator 视角的业务动作，审计必须查得到；动作码入各域名册（V4 31 码 / V5 25 码 需扩）
3. **失败不阻断主流程**：与兑换域现有 handler 同款口径——一条旁路不该有能力让材料审核失败

### 3.4 兑换不动

兑换的软线单落 `REJECTED` 终态，没有活态可回炉。现有 handler 的审计留痕职责保持原样。

---

## 4. C 部分 · `demo:all` 改花名册造数器（A5）

### 4.1 现状与病根

`demo:all` 现在只造 happy path（6 充值 / 3 兑换 / 5 提现，**全 SUCCESS**），末尾断言「所有属于 demo 客户的单都必须 SUCCESS」。

两个毛病：

1. **断言的是开放集合** —— 任何人往 demo 客户名下留一笔非终态的单它就挂。`demo:in-transit` 那笔在途单会打挂它（实测：8/8 → **6/8**，`withdrawals SUCCESS` 与 `payout legs CLEARED` 两条同时栽），手工建的测试单同理
2. **数据太薄** —— 演示要的余额、对账要的料、各种终态的样本，全都没有

台账原本的修法是「断言排除带 `DEMO_STUCK_WD_REF_PREFIX` 的在途单」——**方向错了**。在途单不是污染，它是第一个正确的样本，只是被一个错的断言当成了失败。

### 4.2 新定位

> `demo:all` = **造一批各种状态的单 + 打印答案键**。
> 每笔单出生时就写好「它该停在哪个状态」，跑完逐条比对。

与 `recon:demo:break` 同一个模式（造烂数据 + 答案键），复用同一套心智。

### 4.3 花名册（20 笔单）

原则：**剧本演到的状态必须有现成样本，剧本没演到的不造。** 不按状态机穷举——兑换的 `FAILED`/`REVERSED` 是不可达死枚举，不进花名册。

| # | 域 | 目标状态 | 哪一幕要它 | 怎么驱 |
|---|---|---|---|---|
| 1-3 | 充值 | `SUCCESS` ×3 | 三幕主线、余额来源 | ⚡① |
| 4 | 充值 | `ACTION_PENDING` | 补料演示 | ⚡② |
| 5 | 充值 | `MANUAL_CHECKING` | 人工复核台 | ⚡⑪ |
| 6 | 充值 | `OPERATION_PENDING` | 小额挂起（没收的舞台） | 小额金额 |
| 7 | 充值 | `FROZEN` | 三幕高光、七幕追溯 | ⚡⑦ |
| 8 | 充值 | `CONFISCATED` | 四条出路之一 | 挂起 → 没收 → **MLRO 批** |
| 9 | 充值 | `RETURNED` | 四条出路之一 | 复核 → 退回 → **MLRO 批** |
| 10 | 充值 | `SEIZED` | 四条出路之一 | 冻结 → 上缴 → **MLRO 批** |
| 11-12 | 兑换 | `SUCCESS` ×2 | 四幕主线 | 现成 |
| 13 | 兑换 | `FROZEN` | 零出边终态、锁擦除 | ⚡⑦ |
| 14-16 | 提现 | `SUCCESS` ×3 | 五幕主线 | 现成 |
| 17 | 提现 | `ACTION_PENDING` | 补料 Embed | ⚡② |
| 18 | 提现 | `PENDING_APPROVAL` | 大额 SMO 审批门 | 大额金额 |
| 19 | 提现 | `FROZEN` | 五幕 tipping-off 高光 | ⚡⑦ |
| 20 | 提现 | `PAYOUT_PENDING` | **第六幕在途单** | 现有 `demo:in-transit` 并入 |

**在途单从此不是特例**，它就是花名册第 20 行，预期状态 `PAYOUT_PENDING`。A5 到这里自动消失。

### 4.4 三条约束

**(1) 走真实流程，不插表** —— 造数一律走模拟按钮同一套端点（`demo/script.md` 既有规矩）。三条处置弧要换 MLRO 身份登录走审批，脚本需支持第二身份。

**(2) 固定，不随机** —— 金额、笔数、目标状态全部写死常量（沿用现有 `DEP_USDT='3000'` 约定）。**唯一会变的是单号**（内嵌日期，无法固定），所以答案键**运行时打印**，不写死在文件里。

**(3) 断言 = 实到状态 vs 预期状态** —— 取代现在的「全都必须 SUCCESS」。跑完打印花名册：

```
充值 10 笔：3 SUCCESS / 1 ACTION_PENDING / 1 MANUAL_CHECKING / 1 OPERATION_PENDING
            1 FROZEN / 1 CONFISCATED / 1 RETURNED / 1 SEIZED     ✓ 10/10 符合预期
兑换  3 笔：2 SUCCESS / 1 FROZEN                                    ✓  3/3
提现  7 笔：3 SUCCESS / 1 ACTION_PENDING / 1 PENDING_APPROVAL
            1 FROZEN / 1 PAYOUT_PENDING                            ✓  7/7
COA 四恒等式                                                        ✓  4/4
```

现有的 4 条 COA 恒等式断言原样保留。

### 4.5 两处文档连带

| 文件 | 改什么 |
|---|---|
| `demo/data.md` | 改为**脚本自动生成**——该文件第 3 行早已声明「待造数脚本输出答案键清单后，本文件改为脚本自动生成（防漂移）」。生成后 `git diff data.md` 有变化 = 代码真的改了行为 |
| `demo/baseline.md` | 绿名单里「`demo:all` 8/8」的判据文字换成「花名册逐条符合预期」。**不删这条闸门** |

---

## 5. 顺带销的旧账

| 账 | 在哪 | 怎么销 |
|---|---|---|
| ⑨ SLA 按钮与真实定时器痕迹不一致 | PRODUCTION-NOTES | §2.4 删掉该按钮 |
| ⚡ 面板 markup 三份手写 | PRODUCTION-NOTES 前端观感组 | §2.7 充值+提现合并 |
| 圈码在三域错位 | 本轮对话新发现 | §2.2 统一编号 |
| PEP 未随制裁分主体 | 2026-08-20 批次遗留 | §2.6(1) |
| `demo:all` 结果不稳定、不宜当验收信号 | BACKLOG A5 原文 | §4.3 换断言口径 |
| BACKLOG A7 判决错误（"两半都在"） | 2026-08-28 `4ed929e4` | 本 spec §0 #3/#4/#5 更正，台账随本轮回写 |

---

## 6. 验收

### 硬闸（CLAUDE.md §7）

- ① 后端 `tsc --noEmit`｜② admin-web `tsc -b`｜③ client-web `tsc -b`
- ④ jest 净新失败 0（重点：三域 `*-kyt-verdict.handler.spec.ts`、`verdict-buttons.spec.ts`、`demo-scenario.service.spec.ts`）
- ⑤ 改了前端 → preview 渲染 + 截图（⚡ 面板两组分区、⑩ 新名字）
- ⑥ `on-stack.sh main demo:all` 走通并断言终态
- ⑦ 动过钱 → `verify:coa`（三条处置弧动了账本）
- ⑧ 未动 schema，重铺闸按需

### 行为验收（禁止扫源码文本型断言）

| # | 验收点 | 判据 |
|---|---|---|
| 1 | 按钮表统一 | 三域面板 ① 到 ⑪ 语义一致；兑换 8 个、另两域 11 个 |
| 2 | ⑤ 便签口径 | 按 ② → 材料请求无 `restrictionNo`，客户仍可提现/兑换；按 ③ → 开客户级便签，客户被卡 |
| 3 | PEP 分主体 | 同时命中「对手方受制裁 + 客户是 PEP」→ 按优先级落 `SANCTION_COUNTERPARTY`，不随报文顺序漂移 |
| 4 | **补料回炉** | `ACTION_PENDING` 充值单 → 客户提交 → 管理台 Approve → **订单回到 `COMPLIANCE_PENDING` 并重跑合规**，审计查得到这一步 |
| 5 | 回炉不越域 | 提现域的材料复核不会推动充值单，反之亦然 |
| 6 | 花名册 | 全新库 `reset` → `demo:all` → 20 行逐条符合预期，答案键打印完整 |
| 7 | **A5 消失** | 跑 `demo:in-transit` 后再跑 `demo:all` **仍然全绿**（在途单是花名册第 20 行，不是失败） |
| 8 | 处置弧账本 | `CONFISCATED`/`RETURNED`/`SEIZED` 三笔各有资金单腿 + 账本分录，`verify:coa` 恒等 |

---

## 7. 待决

| # | 问题 | 现状 |
|---|---|---|
| Q1 | 共享件从 `deposit-sumsub` 迁到中立处，迁到哪个目录名 | 实施时定，不影响设计 |
| Q2 | 三条处置弧的造数要换 MLRO 身份，脚本用哪种方式持有第二身份 | 实施时定 |
| Q3 | 回炉后重跑合规，是重新投一次 KYT 报文还是直接调 `checkAutoApproval` | 实施时定；两者审计痕迹不同，倾向前者（贴近真实） |

---

## 8. 分期建议

| 期 | 内容 | 依赖 |
|---|---|---|
| 一 | §2 按钮表统一 + §2.6 连带改动 | 无 |
| 二 | §3 补料回炉 listener | 无（可与一并行） |
| 三 | §4 花名册造数器 | **依赖一**（按新按钮表驱状态） |
