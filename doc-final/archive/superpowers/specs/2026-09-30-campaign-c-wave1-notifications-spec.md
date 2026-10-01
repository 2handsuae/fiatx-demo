# 战役丙波一「让客户听得见」spec

> 总纲：`2026-09-30-campaign-c-outreach-disclosure-charter.md` §2 波一行 ｜ 骨架：`2026-09-30-campaign-c-wave1-skeleton.md`（8 岔口本 spec 全收口）｜ 脑暴拍板 2026-09-30 ｜ 状态：**待业主过目 → plan**
> 本任务做：通知本体 / gateway 复活 / 三域+投诉接线 / email 模拟留痕 / 客户端消息中心 / 三页信号刷新 / 审计词表 / 剧本文档同步。本任务不做（对照 CLAUDE.md §2）：真发邮件 ｜ 模板编辑器 ｜ 管理员侧通知 ｜ 浏览器推送/短信 ｜ 发送失败重试与断线兜底（272 原文"断线交 socket.io 自带重连不加兜底"）｜ 通知偏好设置 ｜ 假挂病根修（留搁置总纲）。

## 执行订正（2026-10-01，T11 文档收口，spec 原文不改只追记）

1. **§1"冻结/解冻收敛前后同为『处理中』"系口语措辞，非字面状态码**：实测 `toCustomerSwapStatus(FROZEN)` = `'COMPLIANCE_PENDING'`（`swap-transactions.service.ts:677`），不是 `PROCESSING`；且 FROZEN 在 5 态状态机里唯一入边来自 `COMPLIANCE_PENDING --FREEZE-->`（`:424-430`），两端收敛值恒等，连信号/通知的"判据不成立"结论不受此措辞误影响——冻结落地前后 `collapsedFrom===collapsedTo`，零通知、零信号，反面验收判据本身依旧成立，只是"处理中"这句话在 §1 原文读起来像在指代 `PROCESSING` 状态码，需订正为"收敛到同一个值（`COMPLIANCE_PENDING`），不是字面的 `PROCESSING`"。
2. **§3"接线 = 各域 workflow/service 直调"在兑换域的实际落点是 workflow 层 + SLA 服务共 9 个事务后置调用点，不是状态落地处同步直调**：T7 首版把 `notifyOrderStatusChange` 调用放在 `markStatus` 所在的 `$transaction` 回调内，因该方法走独立 Prisma 连接写 `customerNotification`，SQLite 单写者下被外层未提交事务自锁到 5000ms 超时、外层事务回滚（订单卡回原状态）但通知已落库发出，且被 SLA sweep（`@Cron` 每 30 秒）反复重试同一死路、每轮再发一条重复假通知（`BACKLOG.md:106` 完整复现记录）。修法（`70d119ac`+`2067648e`）：新增私有方法 `SwapWorkflowService.notifySwapStatusChange()`，在对应 `$transaction` resolve **之后**调用，8 处调用点（`:579/847/900/1277/1826/1879/2088/2371`）+ `SwapSlaService` 超时拒单补接第 9 点（`:133`），充值/提现两域因调用点本就不在 `$transaction` 内未受影响、接线方式不变。

## §0 脑暴裁定台账（2026-09-30）

**四拍板**：
1. **发信点 = 核心 13 条 + 投诉进展 3 条**（投诉是总纲外唯一收编加项，业主点头收"投诉进展"；脑暴原列受理/裁决两点，2026-09-30 spec 评审 Major1 补收**延期说明**——投诉域自定义三类正式对客书面 ACK/EXTENSION_NOTICE/FINAL_RESPONSE（`complaint.constants.ts:68-72`），场景 23 正演"含延期"全弧，缺延期通知则消息中心与详情页当场自相矛盾；档位升级/开户结果不加——横幅已覆盖）。
2. **管理台可见面走甲案**：零新页。发信记审计事件（actor=system），管理台靠既有审计中心按单号/客户号检索；email 模拟证据 = 消息渠道徽章 + 审计。
3. **消息中心方向**：客户端顶栏铃铛（未读数）→ 消息列表页（倒序/已读置灰/渠道徽章/深链订单详情）；已读落库。
4. **剧本走甲案**：三/四/五幕各补一步"切客户端看铃铛"，二/五幕冻结场景补反面步。

**四备案**（agent 定，业主未异议）：新表配 reset 登记 ｜ `NOTIFICATION_SENT` 进审计名册与词表 ｜ 客户标已读不审计（纯读类自助动作）｜ email 留痕与站内同记录、渠道字段区分。

**两订正**：
- **decisions:11 债（2026-08-07"客户端接口层响应体仍带真实 status"缓做）已清**——三域客户面响应均经 `toCustomer*Status` 收敛后下发，充值侧为白名单反转设计（`deposit-transactions.service.ts:86-118` 注释自证"防 DevTools 直读"，未来新增执法态默认收敛）。本波收尾给 decisions 该条补订正注记。
- **搁置总纲"卡单对客通知"字面被收敛判据推翻**：卡单客户面仍是"处理中"、收敛态无变化 → 不发；转补料/失败（收敛态变化）才发。以判据为准。

## §1 发信点清单（16 条终盘）

唯一发信判据：`toCustomerXStatus(from) ≠ toCustomerXStatus(to)` 且新收敛态命中下表。冻结/解冻收敛前后同为"处理中" → **零通知**（这是反面验收项，不是遗漏）。

| 域 | 收敛态（到达即发） | 话术要点（模板逐条对齐既有客户面词表，任务内写死） |
|---|---|---|
| 充值 | SUCCESS ｜ FAILED ｜ RETURNING ｜ RETURNED ｜ CLAWED_BACK ｜ ACTION_PENDING | 到账成功 / 未能入账 / 正在退回 / 已退回 / 银行事后退汇 / 需要补充信息 |
| 提现 | SUCCESS ｜ REJECTED ｜ RETURNED ｜ FAILED ｜ 补料请求态（客户面 ACTION 类，任务核既有桶名） | 成功 / 未能完成已按裁决处理 / 银行退票已退回 / 失败 / 需要补材料 |
| 兑换 | SUCCESS ｜ REJECTED | 兑换成功 / 未能完成已退款 |
| 投诉 | ACKNOWLEDGED ｜ INVESTIGATING_EXTENDED ｜ RESOLVED（与投诉域三类正式对客书面 ACK/EXTENSION_NOTICE/FINAL_RESPONSE 一一对应，`complaint.constants.ts:68-72`；延期书面落地见 `complaints.service.ts:331`） | 投诉已受理 / 处理期限已延长 / 投诉已有裁决结果 |

话术红线：模板只许引用收敛面已有信息（单号/金额/资产/收敛态），不写内部原因；REJECTED 类措辞与详情页既有中性文案同口径；被冻结单据永不出现在任何模板可达路径（判据层保证，模板层复核）。

## §2 数据模型（新表 1 张）

`customer_notifications`：`id` uuid ｜ `ownerCustomerNo`（照 `Complaint` 先例，`schema.prisma:1929`）｜ `templateCode` ｜ `title` ｜ `body`（**发送时渲染定格**——模板日后改码不回写已发消息）｜ `channels`（JSON 数组，`IN_APP` 恒有；`EMAIL_SIMULATED` 按模板配置附带）｜ `relatedOrderType`（DEPOSIT/WITHDRAW/SWAP/COMPLAINT）＋ `relatedOrderNo`（深链用业务键，铁律⑥）｜ `readAt?` ｜ `createdAt`。

- 不设通知业务单号：通知不是管理台经办主体，审计锚 = `relatedOrderNo` + `templateCode`。
- **reset 登记**：`scripts/reset-business-data.ts` 加本表（判例"加表必配 reset 登记表"）；迁移文件照常新增，不做旧数据兼容（CLAUDE.md §3）。

## §3 服务、模板与接线

- **`NotificationsService`**（`core/notifications/`，新）：`send({ customerNo, templateCode, params, orderRef })` → 渲染模板 → 落库 → 审计 `NOTIFICATION_SENT`（actor=system，`FILING_OVERDUE_MARKED` 先例，subjects 镜像 customerNo+orderNo）→ gateway 发信号。单一写点。
- **模板登记处** `notification-templates.constant.ts`：16 码 → `{title, body(params), simulateEmail: boolean}` 纯常量表（词表式，无编辑面）。email 留痕原则 = **正式对客书面才"发邮件"**：终局类（成功/失败/退回/退汇/裁决）+ 投诉三书面（受理/延期/最终答复）附带，共 13 条；过程提示（RETURNING/两域补料）仅站内，共 3 条。
- **接线 = 各域 workflow/service 直调**（不走事件订阅）：三域 `*_STATUS_CHANGED` 事件 payload 不对称（充值缺单号、字段名异，`domain-events.constants.ts:11-44`），且事件注册表规矩 subscribers 限 workflow——通知作为横切服务照 `auditLogsService` 模式在各域状态落地处直调，收敛比对用**各域自己的** `toCustomerXStatus`（客户可见性常量各留各域，decisions:117 判例，不抽共享）。投诉三点全走中心迁移方法 `complaints.service.ts:220 transition()`（ACKNOWLEDGED/INVESTIGATING_EXTENDED/RESOLVED 三个到达态命中即发）。
- **审计 metadata**：`NOTIFICATION_SENT` 事件 metadata 必带 `templateCode` + `channels` 两字段（判例"extra 不落库须镜像 metadata"）——演示者在审计中心打开该事件要能指出"这条附带模拟邮件"。
- **gateway 复活**（`notifications.gateway.ts` 改写）：握手验 JWT（同 REST secret），按 token 身份 `join(customer_<id>)`，**删除 `handshake.query.customerId` 自报路径**（铁律②）；信号事件唯一：`customer.updated`，**零 payload**（272 设计点①②原样继承）；孤儿方法 `notifyComplianceUpdated` 连事件名 `compliance_updated` 一并删除。

## §4 客户端：消息中心 + 三页信号刷新

- **铃铛**挂客户端顶栏（布局随现有导航），badge = 未读数；点开 `/messages` 列表页：倒序、已读置灰、渠道徽章（In-app / Email）、点击按 `relatedOrderType` 深链到对应详情路由；进详情或点击即标已读。
- **端点**（照 `profile-banners.controller.ts` 客户守卫先例，客户面路由不进 RBAC 桶目录）：`GET /customers/me/notifications` ｜ `GET /customers/me/notifications/unread-count` ｜ `POST /customers/me/notifications/:id/read`。
- **信号消费**：客户端建单例 socket（token 取自 `localStorage 'customer_token'` 同 `customerFetch.ts`；`socket.io-client@^4.8.3` 僵尸依赖转正）；收 `customer.updated` → 当前订单列表 refetch + 未读数 refetch + **余额 refetch**（评审 Minor3：被退役的自刷在终态时顺带 `fetchBalances()`，`Swap.tsx:565-568`，信号替代不得丢这口）。**退役对象 =** `HISTORY_REFRESH_INTERVAL_MS = 3000`（`Swap.tsx:34`）驱动的 History 自刷 effect（`:556-570`，即 272 原文 `:554`/`:913` 漂移后位置）；**`:324-340` 汇率刷新器与报价倒计时保留**——那是四幕报价演示可见物，不在 272 作用域（评审 Major2 锚点订正）。充值/提现列表页现无轮询，接同一信号触发 refetch；三页统一"进页拉一次 + 手动刷新 + 信号触发拉"（272 方案原文）。
- 既有 10 处 `alert()` 是表单校验提示，非通知范畴，**不动**（纪律：每行改动可追溯）。

## §5 审计与 RBAC

- 新审计码 **1 个**：`NOTIFICATION_SENT`。登记全套：`audit-actions.constant.ts` + subjects 镜像 + exporter + `npm run audit:vocab` 词表（现役 326→327）+ modules 文档计数（判例"新增审计名册三点齐"，exporter 必挂）。
- 零新权限桶、零新权限组（客户面路由不进目录）——overview §4 的 15 域 81 桶 89 组**不动**。

## §6 验收判据

1. 三域各至少一条成功通知：客户端铃铛亮数 → 消息 → 徽章 → 深链跳详情，截图链。
2. **反面走查**：冻结场景（既有 Grace/Frank/Jack）——冻结落地前后客户端零新通知，且全库消息文案不含任何执法词（jest 断言模板集 + 走查截图双证）。
3. 投诉受理、延期、裁决三通知实走（客户端投诉页深链；场景 23"含延期"全弧现成）。
4. 272 现症反转：Swap 列表页静置 10 秒零自动 GET（原 4 次）；⚡喂裁决后客户屏**信号驱动**自动更新（走查"喂完切客户端"各站生效）。
5. 审计：`NOTIFICATION_SENT` 按 orderNo/customerNo 在审计中心检索得到。
6. jest：gateway 无 token/坏 token 拒入房；发信判据单测（收敛不变不发——冻结迁移用例必测）；模板渲染定格（改模板常量不影响已落库 body）。
7. 闸：随手闸①-⑤（含前端截图）；收尾闸⑥ `demo:all`、⑧ reset 重铺（动 schema）；⑦不涉钱不跑。

## §7 文档与剧本同步（收尾按 `rules/delivery-checklist.md`）

- `demo/script.md`：三/四/五幕各 +1 步、二/五幕 +反面步；`demo/data.md` 生成区同步。
- `modules/v1-governance.md:62-66` 通知两行由"空壳/别承诺"改写为现役口径；`modules/overview.md` §5 提一句；不新开篇。
- `decisions.md`：:11 债已清订正注记；本 spec §0 两订正如需另立条目随收尾裁。
- BACKLOG 销账（落地后）：`:106` `:120` `:272` `:276` 四行；`modules/v6-swap.md:85` 整句删、`v5-withdraw.md:90` **只删"提现成功通知未接"半句**（同行"费腿卡死后的视图残留"是另一件事，保留——评审 Minor5 防连坐）。
- 波二骨架立档（承接记录节留空，收尾写入）。

## §8 尺寸与档位

SDD 预估 9-11 任务（表+服务模板 / gateway / 充值接线 / 提现接线 / 兑换+投诉接线 / 消息中心前端 / 信号刷新三页 / 审计词表 / 剧本走查 / 文档收口）——plan 定。评审默认档（总纲 §2：不动钱不动状态机；通知挂在状态变化点上，只读既有迁移结果）。
