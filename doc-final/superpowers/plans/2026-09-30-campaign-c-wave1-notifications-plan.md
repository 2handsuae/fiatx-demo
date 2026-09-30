# 战役丙波一「让客户听得见」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户通知本体上线——16 个发信点、站内消息中心 + email 模拟留痕、gateway JWT 复活、三页去轮询改信号刷新。

**Architecture:** 横切服务 `NotificationsService`（落库+审计+信号）挂在四个主体的**中心状态迁移方法**之后直调（充值/提现 `updateStatus`、兑换 emit 块、投诉 `transition`）；收敛比对用各域自己的 `toCustomerXStatus`，模板查无即沉默（tipping-off 结构保证）；客户端单例 socket 收零内容信号 `customer.updated` 后 refetch 白名单 REST。

**Tech Stack:** NestJS + Prisma(SQLite) + socket.io（服务端已有 `@nestjs/websockets`，客户端 `socket.io-client@^4.8.3` 已声明未用）+ React。

**Spec:** `doc-final/superpowers/specs/2026-09-30-campaign-c-wave1-notifications-spec.md`（评审后版；§0 裁定台账、§1 十六条清单、§6 验收判据）

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用；每任务收尾过本任务标注的清单行。
- 本轮特有：
  - 发信唯一判据 = `toCustomerXStatus(from) ≠ toCustomerXStatus(to)`；模板注册表查无 → 只发信号不落消息；**16 个模板码终盘，增删须回业主**。
  - 模板文案禁执法词（freeze/frozen/sanction/compliance/AML/investigat/enforce/seiz/confiscat），jest 封死；REJECTED 类措辞中性（"could not be completed / funds returned"）。
  - 客户面路由照 `complaints.client.controller.ts` 先例：`@Controller('client/me')` + `AuthGuard('jwt')` + ensureCustomer，**不进 rbac.catalog**；零新权限桶/组。
  - 信号事件名唯一 `customer.updated`，**零 payload**。
  - 审计 `recordSystem`，`requestId` = 通知行 id（唯一，防静默去重）；metadata 必带 `templateCode` + `channels`。
  - 本机 shell 默认 node18：每条 node/npx/npm 命令前置 `export PATH="$(ls -d $HOME/.nvm/versions/node/v20*/bin | tail -1):$PATH"`。
  - jest 在仓库根跑：`npx jest <路径> --runInBand`；若报缺 `DATABASE_URL`，前置 `DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db"`（判例：缺它假红）。
  - 每任务改完代码跑随手闸①（`npx tsc --noEmit -p tsconfig.json`）；动了 client-web 加闸③（`cd client-web && npx tsc -b --noEmit`）与截图闸⑤。
  - 派发档位：任务执行与任务级 review = `sonnet`；终审 = 主会话模型不降档。
  - 本波不做（spec 头部清单）：真发邮件/模板编辑器/管理员侧通知/推送短信/失败重试断线兜底/通知偏好/假挂病根修。

---

### Task 1: 数据地基——customer_notifications 表

**Files:**
- Modify: `prisma/schema.prisma`（`model Complaint` 附近追加）
- Create: `prisma/migrations/<时间戳>_wave1_customer_notifications/migration.sql`（照 `20260929112201_wave2_company_funding` 先例手写）
- Modify: `scripts/reset-business-data.ts`（委托清单加一行，先例 `:77-80` complaint）

**Interfaces:**
- Produces: Prisma delegate `customerNotification`，字段见下——后续所有任务按此模型读写。

- [ ] **Step 1: schema.prisma 加模型**

```prisma
model CustomerNotification {
  id               String    @id @default(uuid())
  ownerCustomerNo  String
  templateCode     String
  title            String
  body             String    // 发送时渲染定格，模板改码不回写
  channels         String    // JSON 数组字符串，如 ["IN_APP","EMAIL_SIMULATED"]
  relatedOrderType String    // DEPOSIT | WITHDRAW | SWAP | COMPLAINT
  relatedOrderNo   String
  readAt           DateTime?
  createdAt        DateTime  @default(now())

  @@index([ownerCustomerNo, createdAt])
  @@map("customer_notifications")
}
```

- [ ] **Step 2: 手写迁移 SQL**（新建目录，文件名 `migration.sql`；CREATE TABLE + CREATE INDEX，列名/类型对照上一条迁移的 SQLite 方言；不写任何 backfill）
- [ ] **Step 3: `scripts/reset-business-data.ts` 委托清单加 `customerNotification`**（放 complaint 邻近，注释注明 wave 来源）
- [ ] **Step 4: 生成并验证**

```bash
npx prisma generate && npx tsc --noEmit -p tsconfig.json
```
Expected: 双绿。
- [ ] **Step 5: 空库可建证明**：`bash scripts/stack.sh reset self` 全程无红（重铺闸提前验，防"空库建不起"）。
- [ ] **Step 6: Commit** `feat(丙波一T1): customer_notifications 表+迁移+reset登记`

收尾过清单行：**改 schema**（迁移文件、无 backfill）。

---

### Task 2: 模板登记处 + NotificationsService + 审计码

**Files:**
- Create: `src/core/notifications/notification-templates.constant.ts`
- Create: `src/core/notifications/notifications.service.ts`
- Modify: `src/core/notifications/notifications.module.ts`（providers/exports 加 service；imports 加 `AuditLoggingModule`、Prisma 所在公共模块——照仓库其他 module 的注入方式）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（动作码 + spec 条目）
- Create: `src/core/notifications/notifications.service.spec.ts`
- Modify: `scripts/export-audit-vocab.ts`（若按显式 import 分组，把新码挂进对应组——判例：导出器已漏挂三次，必须本任务内挂并验证）

**Interfaces:**
- Produces（后续任务按此调用，签名不得漂移）:

```ts
export interface NotifyOwnerRef { customerId?: string; customerNo?: string } // 至少给一个，服务内补齐另一半
export interface OrderNotifyInput {
  domain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
  orderNo: string;
  owner: NotifyOwnerRef;
  collapsedFrom: string;
  collapsedTo: string;
  amount?: string;
  assetCode?: string;
}
class NotificationsService {
  notifyOrderStatusChange(input: OrderNotifyInput): Promise<void>;
  notifyComplaintStatus(input: { complaintNo: string; owner: NotifyOwnerRef; to: string }): Promise<void>;
}
```

- [ ] **Step 1: 写失败测试**（`notifications.service.spec.ts`，prisma/audit/gateway 全 mock，mock 行为化——带 where 语义，判例"mock 无视 where 假绿"）

```ts
describe('NotificationsService', () => {
  it('collapse 不变 → 不落库不发信号不审计', async () => {
    await service.notifyOrderStatusChange({ domain: 'DEPOSIT', orderNo: 'DEP1', owner: { customerId: 'c1' }, collapsedFrom: 'COMPLIANCE_PENDING', collapsedTo: 'COMPLIANCE_PENDING' });
    expect(prisma.customerNotification.create).not.toHaveBeenCalled();
    expect(gateway.emitCustomerUpdated).not.toHaveBeenCalled();
  });
  it('collapse 变化但无模板（→COMPLIANCE_PENDING）→ 只信号不落消息', async () => { /* PAYIN_PENDING→COMPLIANCE_PENDING */ });
  it('DEPOSIT_SUCCESS → 落库+审计(requestId=行id, metadata 带 templateCode+channels)+信号', async () => { /* 断言 recordSystem 入参 */ });
  it('模板文案全集不含执法词', () => {
    const banned = /freez|frozen|sanction|complian|AML|investigat|enforc|seiz|confiscat/i;
    for (const t of Object.values(NOTIFICATION_TEMPLATES)) {
      expect(banned.test(t.title)).toBe(false);
      expect(banned.test(t.body({ orderNo: 'X1', amount: '1', assetCode: 'USDT' }))).toBe(false);
    }
  });
  it('body 渲染定格：改模板常量不影响已落库行（断言 create 传入的是渲染串非函数引用）', async () => { /* create 入参 body 为 string */ });
});
```

- [ ] **Step 2: 跑测确认红**：`npx jest src/core/notifications --runInBand` → FAIL（模块不存在）
- [ ] **Step 3: 模板登记处**（16 条全量，键 = `${domain}_${collapsedTo}` / 投诉码）

```ts
export const NOTIFICATION_TEMPLATES = {
  DEPOSIT_SUCCESS:        { title: 'Deposit credited',            body: (p) => `Your deposit ${p.orderNo}${amt(p)} has been credited to your account.`, simulateEmail: true },
  DEPOSIT_FAILED:         { title: 'Deposit unsuccessful',        body: (p) => `Your deposit ${p.orderNo} could not be completed.`, simulateEmail: true },
  DEPOSIT_RETURNING:      { title: 'Deposit being returned',      body: (p) => `Your deposit ${p.orderNo} is being returned to the originating account.`, simulateEmail: false },
  DEPOSIT_RETURNED:       { title: 'Deposit returned',            body: (p) => `Your deposit ${p.orderNo} has been returned to the originating account.`, simulateEmail: true },
  DEPOSIT_CLAWED_BACK:    { title: 'Deposit reversed by bank',    body: (p) => `Your deposit ${p.orderNo} was reversed by the sending bank.`, simulateEmail: true },
  DEPOSIT_ACTION_PENDING: { title: 'Action required',             body: (p) => `Your deposit ${p.orderNo} needs additional information from you. Please open the order for details.`, simulateEmail: false },
  WITHDRAW_SUCCESS:       { title: 'Withdrawal completed',        body: (p) => `Your withdrawal ${p.orderNo}${amt(p)} has been completed.`, simulateEmail: true },
  WITHDRAW_REJECTED:      { title: 'Withdrawal not completed',    body: (p) => `Your withdrawal ${p.orderNo} could not be completed. Funds have been returned to your account.`, simulateEmail: true },
  WITHDRAW_RETURNED:      { title: 'Withdrawal returned',         body: (p) => `Your withdrawal ${p.orderNo} was returned by the receiving bank. Funds are back in your account.`, simulateEmail: true },
  WITHDRAW_FAILED:        { title: 'Withdrawal unsuccessful',     body: (p) => `Your withdrawal ${p.orderNo} could not be processed. Funds have been returned to your account.`, simulateEmail: true },
  WITHDRAW_ACTION_PENDING:{ title: 'Additional documents required', body: (p) => `Your withdrawal ${p.orderNo} requires additional documents. Please open the order to continue.`, simulateEmail: false },
  SWAP_SUCCESS:           { title: 'Exchange completed',          body: (p) => `Your exchange ${p.orderNo} has been completed.`, simulateEmail: true },
  SWAP_REJECTED:          { title: 'Exchange not completed',      body: (p) => `Your exchange ${p.orderNo} could not be completed. Your funds have been returned.`, simulateEmail: true },
  COMPLAINT_ACKNOWLEDGED: { title: 'Complaint received',          body: (p) => `Your complaint ${p.orderNo} has been received and is being looked into.`, simulateEmail: true },
  COMPLAINT_EXTENDED:     { title: 'Complaint review extended',   body: (p) => `The review period for your complaint ${p.orderNo} has been extended. A final response will follow.`, simulateEmail: true },
  COMPLAINT_RESOLVED:     { title: 'Complaint resolved',          body: (p) => `Your complaint ${p.orderNo} has been resolved. Please open it to view the outcome.`, simulateEmail: true },
} as const;
// amt(p) = p.amount && p.assetCode ? ` of ${p.amount} ${p.assetCode}` : ''
// 键查无即沉默——tipping-off 的结构保证，禁止加 default 分支
```

- [ ] **Step 4: NotificationsService 实现**：`notifyOrderStatusChange` = collapse 相等即 return → 补齐 owner（缺哪半查 `prisma.customer` 哪半）→ `gateway.emitCustomerUpdated(customerId)`（collapse 变了恒发）→ 查模板，命中则渲染落库 + `auditLogsService.recordSystem`（入参照 `regulatory-filing-sweep.service.ts:61` FILING_OVERDUE_MARKED 现场抄形状：entityType 映射 DEPOSIT→`DEPOSIT_TRANSACTION`/WITHDRAW→`WITHDRAW_TRANSACTION`/SWAP→`SWAP_TRANSACTION`/COMPLAINT→`COMPLAINT`，entityNo=orderNo，requestId=通知行 id，metadata `{templateCode, channels}`，subjects 镜像 customerNo+orderNo 照该现场既有写法）。`notifyComplaintStatus` = to 命中 `{ACKNOWLEDGED→COMPLAINT_ACKNOWLEDGED, INVESTIGATING_EXTENDED→COMPLAINT_EXTENDED, RESOLVED→COMPLAINT_RESOLVED}` 才动作，内部同一条 send 路径。
- [ ] **Step 5: 审计码登记**：动作码区（`:449` 一带）加 `NOTIFICATION_SENT`；spec 区（`:1103` 一带）加一行——先读该文件 actionDomain 取值集，存在 `CUSTOMER` 用之、否则用与 FILING_OVERDUE_MARKED 同款 `GOVERNANCE`：`NOTIFICATION_SENT: { domain: <上述>, correlationMode: N, requiredFields: ['templateCode','channels'], requiresCausation: false }`；跑一次含 `assertActionSpec` 的既有测试确认机器校验过。
- [ ] **Step 6: 导出器挂码**：读 `scripts/export-audit-vocab.ts:11-43` 分组结构，把 `NOTIFICATION_SENT` 挂进对应组；跑 `npm run audit:vocab`，在输出物里 `grep NOTIFICATION_SENT` 必须命中（判例：exporter 结构性失明唯此步逮）。
- [ ] **Step 7: 跑测确认绿** + 闸①
- [ ] **Step 8: Commit** `feat(丙波一T2): 16模板+NotificationsService+NOTIFICATION_SENT审计码`

收尾过清单行：**任何持久状态变化→写审计（recordSystem+显式 requestId）**；**新增审计动作码→出生四属性冻结**。

---

### Task 3: gateway 复活（JWT 入房 + 信号出口）

**Files:**
- Modify: `src/core/notifications/notifications.gateway.ts`（整文件改写）
- Create: `src/core/notifications/notifications.gateway.spec.ts`

**Interfaces:**
- Produces: `emitCustomerUpdated(customerId: string): void` —— T2 的 service 调它（T2 里先以接口 mock，本任务落真身）。
- 握手契约（T8 客户端按此连）：`io(<API origin>, { auth: { token } })`，事件名 `customer.updated`，零 payload。

- [ ] **Step 1: 写失败测试**：无 token / 坏 token / `type!=='CUSTOMER'` 的 token → `client.disconnect()` 被调、不入房；好 token → `client.join('customer_<userId>')`；`emitCustomerUpdated('c1')` → `server.to('customer_c1').emit('customer.updated', {})`。
- [ ] **Step 2: 跑测红**：`npx jest src/core/notifications --runInBand`
- [ ] **Step 3: 实现**：先读 `src/modules/identity/auth/jwt.strategy.ts` 拿 claims 形状（secret = `process.env.JWT_SECRET || 'secretKey'` 同源）；`grep '"jsonwebtoken"\|@nestjs/jwt' package.json`——有哪个用哪个做 `verify`，都没有则 `npm i jsonwebtoken`（passport-jwt 的同源实现，显式声明不吃传递依赖）。`handleConnection` 读 `client.handshake.auth?.token`，验签失败或非 CUSTOMER 即 `client.disconnect(true)`；**删除** `handshake.query.customerId` 路径、`notifyComplianceUpdated` 方法与 `compliance_updated` 事件名（全仓零调用已双证）。
- [ ] **Step 4: 绿 + 闸①**
- [ ] **Step 5: Commit** `feat(丙波一T3): gateway JWT入房+customer.updated信号,自报customerId路径退役`

收尾过清单行：**退役业务动作**（孤儿方法与事件名连根删，无前端引用已证）；铁律②（门不可绕——入房必验签）。

---

### Task 4: 客户面通知端点

**Files:**
- Create: `src/core/notifications/notifications.client.controller.ts`
- Modify: `src/core/notifications/notifications.module.ts`（controllers 注册）
- Modify: `src/core/notifications/notifications.service.ts`（加三个读写方法）
- Test: `src/core/notifications/notifications.client.controller.spec.ts`

**Interfaces:**
- Produces（T8 前端按此调）：
  - `GET /client/me/notifications?skip=&take=` → `{ items: [{ id, templateCode, title, body, channels: string[], relatedOrderType, relatedOrderNo, readAt, createdAt }], total }`
  - `GET /client/me/notifications/unread-count` → `{ count }`
  - `POST /client/me/notifications/:id/read` → `{ ok: true }`（只允许标自己的，跨客户 404）

- [ ] **Step 1: 先读先例** `src/modules/governance/complaints/complaints.client.controller.ts`（`@Controller('client/me')` + `AuthGuard('jwt')` + ensureCustomer + 客户面零权限码注释），照抄骨架。
- [ ] **Step 2: 写失败测试**：非 CUSTOMER token 403；列表只回本客户行（行为化 mock 校验 where 带 ownerCustomerNo）；unread-count 只数 `readAt: null`；read 跨客户行 404、本人行写 `readAt`。
- [ ] **Step 3: 实现三方法**（service 内以 `req.user.userId` 查 `customer` 得 `customerNo` 再 where；channels 落库是 JSON 串，出口 `JSON.parse`）。**标已读不写审计**（spec §0 备案 3：铁律①的"operator 持久化动作"不含客户纯读位标记；此判定已写入 spec，评审未异议）。
- [ ] **Step 4: 绿 + 闸①**；确认 `rbac.catalog.ts` 零改动（`git diff --stat` 不含它）。
- [ ] **Step 5: Commit** `feat(丙波一T4): client/me/notifications 三端点`

收尾过清单行：**新增业务动作→前端要有入口**（入口在 T8 落，同波闭环）；客户面路由不进 catalog（先例注释照录）。

---

### Task 5: 充值域接线

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（`updateStatus` :760 一带 + 构造函数注入）
- Modify: `src/modules/trading/deposit-transactions/*.module.ts`（imports 加 NotificationsModule）
- Test: 既有 `deposit-transactions.service.spec.ts` 加用例

**Interfaces:**
- Consumes: `NotificationsService.notifyOrderStatusChange`（T2 签名）。

- [ ] **Step 1: 读方法体** `sed -n '760,860p'` 该文件——找到持久化成功、审计与 `DEPOSIT_STATUS_CHANGED` emit 之后的位置，对齐方法内实际局部变量名（旧/新状态、行对象）。
- [ ] **Step 2: 写失败测试**（mock NotificationsService）：真实状态 `COMPLIANCE_PENDING→FROZEN`（冻结落地）→ `notifyOrderStatusChange` 收到 `collapsedFrom==='COMPLIANCE_PENDING' && collapsedTo==='COMPLIANCE_PENDING'`（服务侧仍调用，去重在 T2 内部——本测断言传参正确）；`→SUCCESS` → collapsedTo==='SUCCESS'。
- [ ] **Step 3: 插入调用**（`ownerType === 'CUSTOMER'` 才发；FIRM 单跳过）

```ts
await this.notificationsService.notifyOrderStatusChange({
  domain: 'DEPOSIT',
  orderNo: <行>.depositNo,
  owner: { customerId: <行>.ownerId },
  collapsedFrom: this.toCustomerStatus(<旧状态>),
  collapsedTo: this.toCustomerStatus(<新状态>),
  amount: <展示金额>,   // ⚠️ 清单"涉及金额"行：通知正文是展示层——先看本域客户面 DTO/详情页怎么换算金额（如有最小单位→展示换算 util 则同款调用），禁止裸吐 DB 原值；读后对齐
  assetCode: <行>.assetCode ?? <行>.assetId,   // 读行结构后取真名
});
```

- [ ] **Step 4: 漏斗完备性证据**：`grep -n "depositTransaction.update" src/modules/trading/deposit-transactions/*.ts` 逐处核 `status` 字段是否只在 `updateStatus` 内写——结论与命令记入任务产出（判例：证据要在断言位置取）。有旁路写 status 的立即上报主会话，不自行扩接。
- [ ] **Step 5: 绿 + 闸①**（本域 jest：`npx jest src/modules/trading/deposit-transactions --runInBand`）
- [ ] **Step 6: Commit** `feat(丙波一T5): 充值域接通知,6发信点经收敛判据`

收尾过清单行：**改了交易三域任一→问另外两个域一不一样**（T6/T7 同构，收尾核三域调用形状一致）；**涉及金额→展示层换算**（金额取值方式记入任务产出，T6/T7 同规）。

---

### Task 6: 提现域接线

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（`updateStatus` :773 一带 + 注入）
- Modify: 对应 module imports
- Test: 既有 `withdraw-transactions.service.spec.ts` 加用例

**Interfaces:** Consumes 同 T5。

- [ ] **Step 1: 读方法体**（:773 起），确认退票 bounce / 裁决退款 / 补料 RESUBMISSION 各路径全部经此漏斗落状态（`grep -n "withdrawTransaction.update" src/modules/trading/withdraw-transactions/*.ts` 核 status 写点，同 T5 证据纪律）。
- [ ] **Step 2: 失败测试**：`→ACTION_PENDING 收敛态`（补料）、`→REJECTED`、冻结迁移三用例，形状同 T5。
- [ ] **Step 3: 插入调用**（`domain: 'WITHDRAW'`，收敛用 `this.toCustomerWithdrawStatus`，单号 `withdrawNo`，其余字段读行结构对齐）。
- [ ] **Step 4: 绿 + 闸①** `npx jest src/modules/trading/withdraw-transactions --runInBand`
- [ ] **Step 5: Commit** `feat(丙波一T6): 提现域接通知,5发信点`

收尾过清单行：三域一致性核（与 T5 相同形状）。

---

### Task 7: 兑换 + 投诉接线

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（:565-583 状态落库 + `SWAP_STATUS_CHANGED` emit 块之后）
- Modify: `src/modules/governance/complaints/complaints.service.ts`（`transition` :220 落库成功后）
- Modify: 两 module imports
- Test: 两域既有 spec 各加用例

**Interfaces:** Consumes T2 两方法。

- [ ] **Step 1: swap 漏斗证据**：`grep -n "swapTransaction.update" src/modules/trading/swap-transactions/swap-transactions.service.ts`（现知 :454/:500/:565/:869/:915/:924 六处）逐处读，确认**只有 :565 一带写 `status`**（`SWAP_STATUS_CHANGED` 唯一 emit 点 :576 佐证）；其余写非状态列则记录命令+结论，有第二个 status 写点立即上报。
- [ ] **Step 2: 失败测试**：swap `→SUCCESS`、`→REJECTED`、`FROZEN` 迁移（collapsed 恒 PROCESSING）三用例；complaint `transition` 到 ACKNOWLEDGED / INVESTIGATING_EXTENDED / RESOLVED 各断言 `notifyComplaintStatus({to})` 被调、到 INVESTIGATING 不调。
- [ ] **Step 3: 实现**：swap 在 emit 块后调 `notifyOrderStatusChange({ domain: 'SWAP', orderNo: swapNo, owner: { customerId: <行>.ownerId }, collapsedFrom/To: this.toCustomerSwapStatus(...) })`；complaint 在 `transition` 落库成功后调 `notifyComplaintStatus({ complaintNo: row.complaintNo, owner: { customerNo: row.ownerCustomerNo }, to })`（Complaint 只有 `ownerCustomerNo`，`schema.prisma:1929`——owner 半边由 T2 服务补齐）。
- [ ] **Step 4: 绿 + 闸①**：`npx jest src/modules/trading/swap-transactions src/modules/governance/complaints --runInBand`
- [ ] **Step 5: Commit** `feat(丙波一T7): 兑换+投诉接通知,2+3发信点,16点全通`

收尾过清单行：三域一致性（T5/T6/T7 调用形状终核）；投诉域动作已有审计（transition 内既有），本任务零新审计码。

---

### Task 8: 客户端消息中心

**Files:**
- Create: `client-web/src/utils/customerSocket.ts`
- Create: `client-web/src/components/NotificationBell.tsx`
- Create: `client-web/src/pages/Messages.tsx`
- Modify: `client-web/src/App.tsx`（lazy 路由 `/messages`，照既有页写法）
- Modify: `client-web/src/components/CustomerDashboardLayout.tsx`（header 右簇 :259-308 一带挂铃铛）

**Interfaces:**
- Consumes: T4 三端点；T3 握手契约。
- Produces（T9 复用）: `onCustomerUpdated(cb: () => void): () => void`（返回解绑函数）。

- [ ] **Step 1: socket 单例**

```ts
import { io, Socket } from 'socket.io-client';
let socket: Socket | null = null;
export function getCustomerSocket(): Socket | null {
  const token = localStorage.getItem('customer_token');
  if (!token) return null;
  if (!socket) socket = io(import.meta.env.VITE_API_URL, { auth: { token } });
  return socket;
}
export function onCustomerUpdated(cb: () => void): () => void {
  const s = getCustomerSocket();
  if (!s) return () => {};
  s.on('customer.updated', cb);
  return () => { s.off('customer.updated', cb); };
}
export function closeCustomerSocket() { socket?.disconnect(); socket = null; }
```
（登出处调 `closeCustomerSocket`——找 `CustomerDashboardLayout` 现有 logout 处挂上。）

- [ ] **Step 2: 铃铛**：挂载时 fetch unread-count + `onCustomerUpdated(refetch)`；badge>0 显数；点击 `navigate('/messages')`；样式贴 layout 现有 header 图标族（读现场类名，不造新体系）。
- [ ] **Step 3: Messages 页**：`customerFetch` 拉列表（分页 take=20）；行 = 标题/正文/时间/渠道徽章（`channels` 含 `EMAIL_SIMULATED` 加 "Email" 徽章）/未读加粗；点击行 → `POST :id/read` → 深链：

```ts
const ORDER_ROUTES: Record<string, (no: string) => string> = {
  DEPOSIT: (no) => `/deposit/${no}`,
  WITHDRAW: (no) => `/withdraw/${no}`,
  SWAP: (no) => `/swap/${no}`,
  COMPLAINT: (no) => `/complaints/${no}`,
};
```

- [ ] **Step 4: 路由 + 布局接入**；闸③ `cd client-web && npx tsc -b --noEmit`
- [ ] **Step 5: 截图闸⑤**：起 self 栈 preview，登 Quick login 种子客户——铃铛零数 / 造一条通知（用 ⚡ 推一单充值 SUCCESS）后铃铛亮数 / Messages 列表 / 点击深链落详情，四截图。
- [ ] **Step 6: Commit** `feat(丙波一T8): 铃铛+消息中心+深链,socket僵尸依赖转正`

收尾过清单行：**新增业务动作→前端有入口**；**改了前端→preview 截图**。

---

### Task 9: 三页去轮询改信号刷新

**Files:**
- Modify: `client-web/src/pages/Swap.tsx`（删 `:34` `HISTORY_REFRESH_INTERVAL_MS` + `:556-570` history 自刷 effect；**保留 `:324-340` 汇率刷新与报价倒计时**）
- Modify: `client-web/src/pages/Deposit.tsx`、`client-web/src/pages/Withdraw.tsx`（列表 refetch 挂信号）

**Interfaces:** Consumes T8 `onCustomerUpdated`。

- [ ] **Step 1: 先读三页列表取数函数**（Swap history fetch、Deposit/Withdraw 列表 fetch 与余额 fetch 的真名与依赖），记下名字。
- [ ] **Step 2: Swap 改造**：删自刷常量与 effect；新 effect `onCustomerUpdated(() => { <fetchHistory>(); <fetchBalances>(); })`（评审 Minor3：终态余额顺带刷不能丢）；确认页面已有手动刷新入口，没有则在 history 区头加一枚 Refresh 钮调 `<fetchHistory>`。
- [ ] **Step 3: Deposit/Withdraw 同款**：`onCustomerUpdated(() => { <fetchList>(); <fetchBalances 若页面展示>(); })` + 手动刷新钮核有补无。
- [ ] **Step 4: 闸③ + 行为验证**：preview 起页，Network 静置 10 秒——Swap 页零列表 GET（272 现症反转，浏览器面板截图存证）；⚡ 喂一条裁决 → 三页不手动操作自动翻新，截图。
- [ ] **Step 5: Commit** `feat(丙波一T9): Swap3秒自刷退役,三页信号+拉取统一`

收尾过清单行：**改了前端→截图**；**退役业务动作→入口同步清**（自刷逻辑连常量删净，`grep HISTORY_REFRESH_INTERVAL_MS` 零命中）。

---

### Task 10: 走查 + 剧本同步

**Files:**
- Modify: `doc-final/demo/script.md`（三/四/五幕各 +1 步；二幕 Carol/Ivy、五幕 Grace/Frank 冻结场景 +反面步；场景 23 讲词补"三类书面各配通知"一句）
- Modify: `doc-final/demo/data.md`（人工区同步；生成区不手改）
- Create: `doc-final/superpowers/checkups/2026-09-30-campaign-c-wave1-evidence/`（截图与证据落盘，文件名带场景号）

- [ ] **Step 1: 铺数**：`bash scripts/stack.sh reset self && bash scripts/on-stack.sh self demo:all`（判例标准序）
- [ ] **Step 2: 正面链走查**：三域各喂一条到 SUCCESS + 投诉走场景 23 全弧（受理/延期/裁决）——每步客户端铃铛/消息/深链截图；审计中心按单号检索 `NOTIFICATION_SENT` 截图（metadata 展开见 templateCode+channels）。
- [ ] **Step 3: 反面链走查**：冻结场景喂裁决——冻结落地前后客户端消息中心**零新增**截图（前后对比双截图）；解冻回 COMPLIANCE_PENDING 同样零新增。
- [ ] **Step 4: 剧本落笔**：动作指令必须是预铺态下实走过的（判例：剧本步骤必实走）；反面步写明"验的是没有"。
- [ ] **Step 5: Commit** `docs(丙波一T10): 剧本三幕加步+二五幕反面步,走查证据入档`

收尾过清单行：**改页面/种子→同步 demo 两档**；**改前端→截图**。

---

### Task 11: 文档收口 + 收尾闸

**Files:**
- Modify: `doc-final/modules/v1-governance.md`（:62-66 通知空壳两行改写为现役口径：16 发信点/消息中心/email 模拟留痕/管理侧走审计）
- Modify: `doc-final/modules/overview.md`（§5 加一句通知本体；头部 Last Verified 追加；审计码 326→327）
- Modify: `doc-final/modules/v6-swap.md`（:85 "成功通知未接"整句删）、`doc-final/modules/v5-withdraw.md`（:90 只删"提现成功通知未接"半句，费腿视图残留保留）
- Modify: `doc-final/decisions.md`（:11 条尾追加订正注记：2026-09-30 核实三域客户面已收敛下发，债已清，锚 `deposit-transactions.service.ts:86-118`）
- Modify: `doc-final/BACKLOG.md`（销 :106/:120/:272/:276 四行 + Last Updated 头部记账）
- Modify: `doc-final/CHANGELOG.md`（一行）
- Create: `doc-final/superpowers/specs/2026-09-30-campaign-c-wave2-skeleton.md`（总纲链接/「承接波一」节写实际偏差与新事实/波二已定事实/待定岔口——只写承接，不展开波二设计）

- [ ] **Step 1: 词表终核**：`npm run audit:vocab` 重跑，输出物 `grep NOTIFICATION_SENT` 命中；现役码计数 = 327 记入 overview。
- [ ] **Step 2: 逐文件落笔**（数字复述处 `grep -n "326"` 清点全改，判例：多处复述必漏改）。
- [ ] **Step 3: 收尾闸**：`bash scripts/on-stack.sh self demo:all` 全绿断言终态；`bash scripts/stack.sh reset self` 后重跑仍绿（闸⑥⑧；不动钱，⑦不跑）。
- [ ] **Step 4: 承诺对账**：拿 spec §0-§7 逐条问"代码在哪"（判例：spec 承诺没代码不产生 diff），记对账表入 evidence 目录。
- [ ] **Step 5: Commit** `docs(丙波一T11): 文档收口+BACKLOG销四行+波二骨架承接`

收尾过清单行：**每轮收尾**（分层报告 + CHANGELOG + BACKLOG）；**多波承接**（承接写进波二骨架，不展开波二）。

---

## Self-Review 记录（写毕自查）

1. **Spec 覆盖**：§0 两订正→T11（decisions 注记）+§4 已修锚点→T9；§1 十六条→T2 模板+T5/6/7 接线；§2 表→T1；§3 服务/模板/审计→T2、gateway→T3；§4 消息中心→T8、三页刷新→T9、端点→T4；§5 审计词表→T2+T11；§6 验收→T5-T10 测试与走查步；§7 文档→T10/T11。无孤儿承诺。
2. **占位扫描**："读后对齐变量名"类步骤均配了先读命令与完整的新增代码块，无 TBD/略。
3. **类型一致**：`NotifyOwnerRef`/`OrderNotifyInput`/`onCustomerUpdated` 三处跨任务签名逐字比对一致；模板键 = `${domain}_${collapsedTo}` 与 T5-T7 传参域名枚举一致。
