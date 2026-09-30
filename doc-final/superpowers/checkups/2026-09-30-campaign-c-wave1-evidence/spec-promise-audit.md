# 战役丙波一 spec 承诺对账（T11）

> 判例："spec 承诺没代码不产生 diff，唯逐条追可逮"——对照 `2026-09-30-campaign-c-wave1-notifications-spec.md` §0-§7 逐条问"代码/文档在哪"。方法：逐条给出锚点文件/行号或测试名，标 ✅ 已落地 / ⚠️ 落地但有出入（说明出入） / ❌ 未落地。全表 ✅，无 ❌。

## §0 脑暴裁定台账

| # | 承诺 | 代码/文档在哪 | 状态 |
|---|---|---|---|
| 拍板1 | 发信点=核心13条+投诉3条（16条终盘，含延期通知） | `notification-templates.constant.ts:24-39` 16 个键（DEPOSIT×6/WITHDRAW×5/SWAP×2/COMPLAINT×3）；`notifications.service.spec.ts:142`「16 个模板全量登记」自点判据 | ✅ |
| 拍板2 | 管理台可见面走甲案：零新页，发信记审计，email 模拟=渠道徽章+审计 | 全仓 `rbac.catalog.ts`/`PermissionGroup` 在本波 10 个任务提交中零 diff（`git log --name-only 3cccfcc4^..HEAD \| grep rbac.catalog` 零命中）；`NOTIFICATION_SENT` metadata 带 `channels`（`notifications.service.ts:265` 起） | ✅ |
| 拍板3 | 消息中心方向：铃铛（未读数）→ 列表页（倒序/已读置灰/渠道徽章/深链）；已读落库 | `client-web/src/components/NotificationBell.tsx`、`client-web/src/pages/Messages.tsx`；`schema.prisma:1974` `readAt DateTime?` | ✅ |
| 拍板4 | 剧本走甲案：三/四/五幕各补一步，二/五幕冻结场景补反面步 | `doc-final/demo/script.md:96`（充值站）/`:130`（兑换站）/`:170`（提现站）/`:368`（投诉站）四处 `NOTIFICATION_SENT` 判据行；T10 走查截图 `11a/11b/11c-client-grace-messages-{BEFORE,AFTER-freeze,AFTER-unfreeze}.png`（反面步：冻结前后消息数不变） | ✅ |
| 备案1 | 新表配 reset 登记 | `scripts/reset-business-data.ts:82` `'customerNotification'` | ✅ |
| 备案2 | `NOTIFICATION_SENT` 进审计名册与词表 | `audit-actions.constant.ts:521`（码）/`:1287`（spec：domain CUSTOMER, correlationMode N, requiredFields templateCode+channels）；`npm run audit:vocab` 本次重跑命中 `doc-final/lark/2026-09-16-audit-actions-catalog-full.md:309`，合计 **327** 码 | ✅ |
| 备案3 | 客户标已读不审计（纯读类自助动作） | `notifications.client.controller.ts:9-10` 注释自证"标已读不写审计：spec §0 备案 3...已在评审阶段确认"，`markRead()` 方法体确认无审计调用 | ✅ |
| 备案4 | email 留痕与站内同记录、渠道字段区分 | `schema.prisma:1971` `channels String // JSON 数组...["IN_APP","EMAIL_SIMULATED"]`，单表不分渠道行 | ✅ |
| 订正1 | decisions:11 缓办债已清 | `decisions.md` :11 行尾本次追加订正注记（本任务，见下 §7） | ✅ |
| 订正2 | 卡单对客通知被收敛判据推翻（处理中→处理中不发） | `deposit-workflow.service.ts` ACTION_PENDING 走模板 `DEPOSIT_ACTION_PENDING`（收敛态变化才发，补料态本身是收敛态变化的一种，非"卡单"字面态）；提现补料同理走 `WITHDRAW_ACTION_PENDING`——两条已在 §1 清单内实现，订正本身已被 §1 吸收，非独立代码项 | ✅ |

## §1 发信点清单（16 条终盘）

| 域 | 收敛态 | 模板键 | 接线点 | 状态 |
|---|---|---|---|---|
| 充值 | SUCCESS/FAILED/RETURNING/RETURNED/CLAWED_BACK/ACTION_PENDING | `DEPOSIT_*` 6 个 | `DepositTransactionsService.updateStatus()`（各调用点，含 `deposit-workflow.service.ts` 多处状态迁移） | ✅ |
| 提现 | SUCCESS/REJECTED/RETURNED/FAILED/ACTION_PENDING | `WITHDRAW_*` 5 个 | 提现 post-commit finalize（T5，BACKLOG:120 T10 走查实证：`WDR260930250801` 全链 KYT→两腿→SUCCESS，铃铛/`/messages` 实时收到） | ✅ |
| 兑换 | SUCCESS/REJECTED | `SWAP_*` 2 个 | `SwapWorkflowService.notifySwapStatusChange()` 私有方法 8 处调用点（`:579/847/900/1277/1826/1879/2088/2371`）+ `SwapSlaService` 超时拒单 1 处（`:133`），均在 `$transaction` resolve 之后（T7 两轮修复 `70d119ac`+`2067648e`） | ✅ |
| 投诉 | ACKNOWLEDGED/INVESTIGATING_EXTENDED/RESOLVED | `COMPLAINT_*` 3 个 | `complaints.service.ts:220 transition()` 中心迁移方法，三个到达态命中即发（`notifications.service.spec.ts:217/251` 覆盖命中/未命中两分支） | ✅ |
| 话术红线 | 模板只引用收敛面信息，不写内部原因；被冻结单据永不出现在模板可达路径 | `notifications.service.spec.ts:116`「模板文案全集不含执法词」+ `:46`「collapse 不变→不落库不发信号不审计」（冻结态判据层短路，模板层零暴露机会） | ✅ |

## §2 数据模型

| 承诺 | 代码在哪 | 状态 |
|---|---|---|
| `customer_notifications` 表，字段 id/ownerCustomerNo/templateCode/title/body/channels/relatedOrderType/relatedOrderNo/readAt/createdAt | `schema.prisma:1965-1979`，字段逐一对齐（body 注释"发送时渲染定格"、channels 注释"JSON 数组字符串"） | ✅ |
| 不设通知业务单号 | 表无 `xxxNo` 字段，锚点为 `relatedOrderNo`+`templateCode` | ✅ |
| reset 登记 | `scripts/reset-business-data.ts:82` | ✅ |
| 迁移文件新增，不做旧数据兼容 | `prisma/migrations/20260930150926_wave1_customer_notifications/` | ✅ |

## §3 服务、模板与接线

| 承诺 | 代码在哪 | 状态 |
|---|---|---|
| `NotificationsService.send()` 单一写点：渲染→落库→审计→信号 | `notifications.service.ts`（落库+审计先于信号，`5c4fc6a4` 修正顺序） | ✅ |
| 模板登记处纯常量表，无编辑面 | `notification-templates.constant.ts`，16 键，无 CRUD 端点/管理台页面 | ✅ |
| email 留痕原则：终局13条+投诉三书面=email，过程3条=仅站内 | 模板表 `simulateEmail` 字段：true×13/false×3（逐键核对与 spec §3 数字一致：DEPOSIT_RETURNING/DEPOSIT_ACTION_PENDING/WITHDRAW_ACTION_PENDING 三条 false） | ✅ |
| 接线=各域直调，不走事件订阅；投诉走中心 `transition()` | 充/提/兑三域见 §1 接线点列；投诉 `complaints.service.ts:220` | ✅ |
| 审计 metadata 必带 templateCode+channels | `audit-actions.constant.ts:1287` `requiredFields: ['templateCode','channels']`；`notifications.service.spec.ts:78` 断言 metadata 内容 | ✅ |
| gateway 复活：握手验 JWT，按 token 身份入房，删 `handshake.query.customerId` 自报路径，唯一零 payload 信号 `customer.updated`，删孤儿方法 `notifyComplianceUpdated` | `notifications.gateway.ts:26-50`（`handleConnection` 验 JWT+disconnect 三分支）；`:52-54` `emitCustomerUpdated` 零 payload；全仓 `grep -rn "notifyComplianceUpdated\|compliance_updated"` 零命中；`notifications.gateway.spec.ts:29/38/51/61` 四个握手用例 | ✅ |

## §4 客户端：消息中心 + 三页信号刷新

| 承诺 | 代码在哪 | 状态 |
|---|---|---|
| 铃铛挂顶栏，badge=未读数；`/messages` 列表倒序/已读置灰/渠道徽章/深链；进详情/点击即标已读 | `client-web/src/components/NotificationBell.tsx`、`client-web/src/pages/Messages.tsx` | ✅ |
| 端点：`GET .../notifications` \| `GET .../notifications/unread-count` \| `POST .../notifications/:id/read` | `notifications.client.controller.ts:23/34/42`——路径前缀实为 `client/me/...`（照 `complaints.client.controller.ts` 既有形状，文件头注释自证），非 spec 字面 `customers/me/...`；功能与判据（三条端点、客户面不进 RBAC 桶）均一致，判**⚠️ 路径措辞出入，非功能出入** | ⚠️ |
| 信号消费：单例 socket，token 取 `localStorage 'customer_token'`；收 `customer.updated` → 订单列表 refetch + 未读数 refetch + 余额 refetch（评审 Minor3 口径） | `client-web/src/pages/Swap.tsx:554-560`（`fetchBalances()` 在信号处理器内）；Deposit.tsx/Withdraw.tsx 同款信号消费（`grep -l "customer.updated"` 命中三页） | ✅ |
| 退役对象=`HISTORY_REFRESH_INTERVAL_MS=3000` 驱动的 History 自刷；`:324-340` 汇率刷新器与倒计时保留 | `grep -n "HISTORY_REFRESH_INTERVAL_MS" client-web/src/pages/Swap.tsx` 零命中（已删除）；汇率刷新器代码仍在（未改动，行号随其它编辑漂移但逻辑未动） | ✅ |
| 既有 10 处 `alert()` 不动 | 本波 10 个任务提交未触碰 `alert(` 调用（非本波改动范围，未验证逐处但无相关 diff） | ✅ |

## §5 审计与 RBAC

| 承诺 | 代码在哪 | 状态 |
|---|---|---|
| 新审计码 1 个 `NOTIFICATION_SENT`，登记全套（常量+subjects 镜像+exporter+词表+文档计数） | `audit-actions.constant.ts:521,1287`；exporter 命中（`npm run audit:vocab` 本次重跑，`doc-final/lark/.../catalog-full.md:309`）；modules 文档计数本任务已改（`overview.md` 326→327，见 §7） | ✅ |
| 零新权限桶/组（15 域 81 桶 89 组不动） | `overview.md` header 本波不改桶/组数字，仅改审计码；git log 对 `rbac.catalog.ts` 零 diff | ✅ |

## §6 验收判据

| # | 判据 | 证据 | 状态 |
|---|---|---|---|
| 1 | 三域各至少一条成功通知，铃铛→消息→徽章→深链截图链 | `superpowers/checkups/2026-09-30-campaign-c-wave1-evidence/02-05.png`（充值/提现审计+深链）、`14-17.png`（兑换 FIXED 后成功链） | ✅ |
| 2 | 反面走查：冻结场景零新通知+模板集零执法词（jest+截图双证） | `notifications.service.spec.ts:46`（collapse 不变不落库不发信号不审计）+`:116`（模板全集零执法词）；截图 `11a/11b/11c-client-grace-messages-*.png`（冻结前后消息数视觉持平） | ✅ |
| 3 | 投诉受理/延期/裁决三通知实走，场景 23 全弧 | `notifications.service.spec.ts:217/251`（RESOLVED 命中/INVESTIGATING 未命中）；`script.md:368`；截图 `08-09.png` | ✅ |
| 4 | 272 反转：Swap 列表静置 10 秒零自动 GET；⚡喂裁决后信号驱动自动更新 | `BACKLOG.md:272` 本任务收口注记"走查实证：Swap 列表页静置 10 秒零自动 GET（原 4 次），⚡喂裁决后客户屏信号驱动自动更新"（T9 原始走查，本任务复核代码确认 `HISTORY_REFRESH_INTERVAL_MS` 已物理删除） | ✅ |
| 5 | 审计按 orderNo/customerNo 检索得到 `NOTIFICATION_SENT` | 截图 `02/04.png` 标注"按单号检索"；`audit-actions.constant.ts:1287` `correlationMode: N` 允许按主表 `primarySubjectNo` 检索 | ✅ |
| 6 | jest：gateway 无/坏 token 拒入房；发信判据单测；模板渲染定格 | `notifications.gateway.spec.ts:29/38/51/61`；`notifications.service.spec.ts:46`（判据）+`:124`（渲染定格："改模板常量不影响已落库行"） | ✅ |
| 7 | 闸：随手闸①-⑤（含前端截图）；收尾闸⑥`demo:all`、⑧reset 重铺 | 本任务（T11）实跑：`npx tsc --noEmit -p tsconfig.json` exit 0；`bash scripts/stack.sh reset self` → `bash scripts/stack.sh up self` → `bash scripts/on-stack.sh self demo:all` 两轮独立 reset 周期均 exit 0、29/29+5/5（详见 task-11-report.md） | ✅ |

## §7 文档与剧本同步

| 承诺 | 落点 | 状态 |
|---|---|---|
| `demo/script.md` 三/四/五幕各+1 步，二/五幕+反面步；`demo/data.md` 同步 | T10 已完成（`7d9383e0`），T11 复核未变 | ✅（T10 完成） |
| `v1-governance.md:62-66` 通知两行改写为现役口径 | 本任务（T11）：:62（§5 技术节点）、:66（§6 演示缺口） | ✅ |
| `overview.md` §5 提一句 | 本任务：新增通知本体一行 + header Last Verified 追加 + 326→327 | ✅ |
| `decisions.md`:11 债已清订正注记 | 本任务：行尾追加"订正 2026-10-01，战役丙波一 T11" | ✅ |
| BACKLOG 销账 `:106`/`:120`/`:272`/`:276` | 本任务：`:106`/`:272`/`:276` 翻 `[x]`+已修说明；`:120` 复核确认 T10 已正确勾 `[x]`，未改 | ✅ |
| `v6-swap.md:85` 整句删；`v5-withdraw.md:90` 只删半句 | 本任务：v6-swap.md 删整行；v5-withdraw.md 只删"提现成功通知未接；"，"费腿卡死后的视图残留"保留 | ✅ |
| 波二骨架立档 | 本任务：新建 `2026-09-30-campaign-c-wave2-skeleton.md`，含"承接波一"六点 | ✅ |

## 结论

spec §0-§7 全部承诺逐条核实，**零孤儿承诺**（无"说了没代码"的条目）。唯一出入点：§4 端点路径前缀 `client/me/notifications` 与 spec 字面 `customers/me/notifications` 不同，但功能、判据（三条端点、客户面零权限码）均满足，判定为措辞出入非功能缺口——不追加改动（"每一行改动都要追得到来源"：纠正一个纯路径措辞不是任何需求或必需配套，原实现选择已有 `complaints.client.controller.ts` 先例，不动）。
