# 提现补料 Embed（多条 applicant action）+ 客户端详情独立页 设计 spec

> **主题**：提现 `ACTION_PENDING` 从「一句静态提示」升级为补料闭环——镜像充值 deposit-action-embed 的终局形态（多条 action 子表 + 独立详情页 + 独立认证页 + 会话接口），提现补料场景（PEP-SOF / 钱包所有权 / TR 信息）走同一套 Sumsub applicant action 机制。
> **日期**：2026-08-07　**状态**：设计（未实现）　**范围**：仅提现域；仅个人客户。
> **蓝本**：[truth/v4-deposit.md §4.6](../../reference/truth/v4-deposit.md)（充值补料 Embed 终局，2026-08-04~06 三轮落地+终审+业主两次定稿后的**最终形态**——本 spec 直接继承终局，充值走过的弯路（postMessage 假冒协议、actionSubmittedAt 双层短路、按材料类型分岔文案）一步都不重走）。
> **业主拍板（2026-08-07）**：B 补料 Embed + C 详情独立页 = 本 spec；A 接口层 status 收敛**缓做**（充值той套自己尚未定稿，不扩散——本 spec 不含 `CUSTOMER_STATUS_PASSTHROUGH` 类改动）；D admin 子表视图两域一起以后做。实现岔口=乙（镜像 fork，不泛化充值刚稳的代码）。

---

## 0. 继承的锁定决策（充值已拍板，提现直接抄终局）

1. **状态就是状态，按钮归按钮**（充值 2026-08-06 减法定稿）：客户提交材料**不改变**提现状态机（`ACTION_PENDING` 仍是 `ACTION_PENDING`，直到 Sumsub 重裁/officer 放行才流转）；渲染层 `getWithdrawStatusView` 保持单参纯查表，**不引入**「已提交改写徽章」的任何短路（充值连续三个 Critical 的根源，直接跳过）。
2. **客户端拿不到 action id**：白名单开口只有 `actions: [{seq, submittedAt}]` 两键——`applicantActionId`/`externalActionId` 结构上不存在于客户面（充值 Critical：fixture id `aa-edd-0002` 的 `edd` 泄 PEP）；对外用 `seq` 定位，服务端按 `withdrawId+seq` 换真 id 铸 token。
3. **每条 action = 独立页面**（`/withdraw/:withdrawNo/verification/:seq`），不是容器切内容；`seq` 一旦分配不再变（进 URL/收藏）。
4. **补料文案不按材料类型分岔**：统一 `Document request {seq}`（充值业主 2026-08-04 定稿否决过分岔）。
5. **会话接口只看这一条 action 自己的 `submittedAt`，绝不查提现 `status`**——接口不可区分（`ACTION_PENDING` vs `FROZEN` 下响应体逐字段全等）；submit 幂等恒 `{ok:true}`（冻结单提交照收不做事）。
6. **「全部交齐」唯一判定点**在 submit 落库后 `count(submittedAt:null)===0` 处；交一条不算。

## 1. 数据模型（镜像 fork）

- **新子表 `withdraw_applicant_actions`**（Prisma model `WithdrawApplicantAction`）：逐字段镜像 `DepositApplicantAction`（父 FK 换 `withdrawTransactionId`），`@@unique([withdrawTransactionId, seq])`。
- **withdraw 表新列 `actionSubmittedAt DateTime?`**：「全部交齐时刻」缓存（非"这条交了没"）；+ `applicantActions` 关系。
- 迁移：加表+加列（无重建需求，纯增量）。

## 2. 同步与提交（`WithdrawApplicantActionsService`，镜像 `DepositApplicantActionsService`）

- **`syncApplicantActions()`**（`applyKytAwaitUser()` 调用）：对报文 `applicantActions[]` **全量列表**做集合比对——新 id 插行（`seq`=现最大+1 追加）；完全一致真 no-op；库内有报文没有的**删未提交行**（已提交行=历史，保留）；空 `externalActionId` 的丢弃不入库。整体 `$transaction` + `P2002` catch 重读一次幂等兜底。已在 `ACTION_PENDING` 时集合有变 → 清「全部交齐」缓存 + 重置 SLA + 审计 `WITHDRAW_ACTION_REISSUED`；跨状态弧（`MANUAL_CHECKING → ACTION_PENDING`）同样清。
- **零未提交行 guard**（充值 2026-08-06 评审修复直接继承）：同步后零未提交行 → 不进/不停留 `ACTION_PENDING`，warn 审计 `WITHDRAW_AWAITUSER_EMPTY_ACTIONS`。
- **`submitBySeq()`**：`updateMany({where:{withdrawTransactionId, seq, submittedAt:null}})` 幂等盖戳（互斥交给 DB，不做先读后写）→ `count(submittedAt:null)`：仍有未交 → 缓存不动；`===0` → 盖 `actionSubmittedAt=now()`；`resetSla = status==='ACTION_PENDING' && !slaBreached` 时 `slaDeadline=now+7d`（`PROVIDER_REVIEW_SLA_DAYS`，语义换成"等 Provider 审"）。审计 `WITHDRAW_ACTION_SUBMITTED` 仅 `changed===true` 时记（metadata：`seq`/真 actionId/`allSubmitted`——审计是 operator 面，与客户面相反）。

## 3. 会话接口（`WithdrawVerificationSessionService` + customer controller 两条新路由）

- `GET my/:withdrawNo/verification-session/:seq` → `mustFindOwn`（`where:{withdrawNo, ownerId}`，IDOR 同款 404）→ `findBySeq` 查不到=与单子不存在**完全相同的 404**（不给探测面）→ 响应只由这一条的 `submittedAt` 决定：已交 `{submitted:true, sdkToken:null}`；未交且客户无 `sumsubApplicantId` `{submitted:false, sdkToken:null}`；未交且有 → `sumsubClient.createActionSdkToken({applicantId, levelName: SUMSUB_ACTION_LEVEL, externalActionId})` `{submitted:false, sdkToken}`。**响应体仅此两键**。
- `POST my/:withdrawNo/verification-session/:seq/submit` → 幂等恒 `{ok:true}`，不碰状态机，落库走 `submitBySeq()`。
- **路由声明顺序**：带 `:seq` 的两条必须写在 `my/:withdrawNo` 之前（段数匹配抢先坑，充值踩过）。
- 客户面 JWT 鉴权，非 admin 端点，无需 RBAC catalog 登记。

## 4. 客户端（C：详情独立页 + B：认证页）

- **`WithdrawDetail.tsx`**（新，路由 `/withdraw/:withdrawNo`，独立页非弹窗）：交易字段 + `Outstanding verification` 卡片——**仅** `status==='ACTION_PENDING' && actions.length>0` 渲染；逐条 `Document request {seq}`，每条「Provide documents」按钮**恒渲染**、按这一条自己的 `submittedAt` 置灰；点击 `navigate('/withdraw/${withdrawNo}/verification/${seq}')`。History 列表的 Details 改为跳本页，**现有详情弹窗删除**（对齐充值终局）。需要新客户端点 `GET my/:withdrawNo`（byNo 查详情，`mustFindOwn` 同款；现有按 id 的读端点保留兼容）。
- **`WithdrawVerification.tsx`**（新，路由 `/withdraw/:withdrawNo/verification/:seq`）：四态互斥渲染——①该 seq 已交 → 静态「已收到审核中」文案；②会话拉取失败/真接无 token → 重试；③demo 分支 loading；④demo → `MockUploader`（假上传，Submit 直调 submit 端点）/ 真接 → `#sumsub-container` + `window.snsWebSdk.init(token, refreshToken)`（监听真实 `idCheck.onApplicantSubmitted`，token 过期走 `refreshToken()` 重铸）。分流判据 `useSimulationMode()`（与 admin ⚡ 同一套）。提交成功 navigate 回详情页；失败留在原地重试提示。**不做 postMessage 协议**（充值已删的弯路）。
- **白名单开口**：`toCustomerWithdrawView()` 加 `actions: (item.applicantActions ?? []).map(a => ({seq: a.seq, submittedAt: a.submittedAt}))`——仅此两键；**不开**顶层 `actionSubmittedAt`（充值最终删掉了，没有消费者就不开口）。

## 5. demo/fixtures/e2e

- 提现 `fixtures/verdict-buttons.ts` 的 ②③（awaitUser/awaitUser·PEP）报文补 `applicantActions[]`（含 `externalActionId`）；补一个多条 action fixture（镜像充值 099fd5f0 轮）。
- e2e 四条镜像（扩展 `test/withdraw-sumsub-scenarios.e2e-spec.ts` 或新文件）：①补料完整弧（提交后状态不动、全部交齐缓存时序）②单条不可区分（同一 seq 在 `ACTION_PENDING` vs `FROZEN` 会话响应体全等）③多条全部交齐时序（交第 1 条缓存不动、交最后一条才盖）④逐条不可区分。

## 6. 明确不做（本 spec 边界）

- **A 接口层 status 收敛**（`CUSTOMER_STATUS_PASSTHROUGH`/`completedAt` 白名单/bucket 补集/status 参数忽略）——业主 2026-08-07 拍板缓做，充值那套定稿后两域一起对齐（BACKLOG「规则 A」条已挂）。
- **D admin 子表视图**——两域一起以后做（充值同欠）。
- **真接 `snsWebSdk` 的 `<script>` 加载**——充值同缺（全仓无该 script 标签，BACKLOG 已挂），本轮 demo 分支可跑、真接分支与充值同等程度（代码在、script 待接）。
- 按材料类型分岔补料文案、`ACTION_PENDING` 被冻后徽章变化的进一步伪装——充值业主定稿已否/已接受的取舍，不重开。

## 7. 与现状代码差距（实施地图）

- prisma：新表+新列迁移；`withdraw-transactions.service.ts`：`toCustomerWithdrawView` 开 `actions` 口 + byNo 客户查询；
- `withdraw-workflow.service.ts → applyKytAwaitUser()`：改走 `syncApplicantActions()`（现在只写 `manualReason`/`slaDeadline`）+ 零行 guard；
- 新文件：`withdraw-applicant-actions.service.ts` / `withdraw-verification-session.service.ts`（镜像充值同名文件）；
- `customer-withdraw.controller.ts`：三条新路由（session×2 + byNo 详情），注意声明顺序；
- client：`WithdrawDetail.tsx`/`WithdrawVerification.tsx` 新页 + 路由注册 + `Withdraw.tsx` 删弹窗改跳转；
- fixtures/e2e 如 §5；audit 常量三个新增（`WITHDRAW_ACTION_REISSUED`/`WITHDRAW_AWAITUSER_EMPTY_ACTIONS`/`WITHDRAW_ACTION_SUBMITTED`）。
