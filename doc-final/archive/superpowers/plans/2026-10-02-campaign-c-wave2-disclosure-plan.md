# 战役丙波二「讲清楚、给凭据」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 兑换成交前三句披露+平台留存行、成交后不可变确认单主体（表+审计+详情区块+打印）、充值/提现风险提示。

**Architecture:** 新表 `trade_confirmations` 一单一张只写一次；出具挂 `SwapWorkflowService.notifySwapStatusChange` 事务后置漏斗（SUCCESS 分支：先落确认单→记审计→再发通知）；点差金额抽公共函数供报价响应与建单同源；客户详情响应白名单附 confirmation 子对象；客户端文案集中登记、打印走浏览器+浅色打印样式。

**Tech Stack:** NestJS + Prisma(SQLite) + jest ｜ React + vitest（纯函数）｜ 既有审计/通知/单号基建。

**Spec:** `doc-final/superpowers/specs/2026-10-02-campaign-c-wave2-disclosure-spec.md`（§号引用均指它）

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用；CLAUDE.md §2 禁做清单全程有效（不做幂等/重试/兼容层；确认单唯一约束是 schema 结构保证，不写去重逻辑）。
- 本轮特有：①不改报价成交链任何行为（出具只许在事务后置漏斗内加分支）；②确认单零 update 入口（service 不得出现任何 update 方法）；③新文案一律进登记处文件，禁止散写在 JSX；④`$transaction` 回调内禁调横切写服务（丙波一判例）；⑤动 schema → 收尾走重铺闸⑧，迁移不写 backfill；⑥jest 在仓库根跑且每条 node/npm 命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；⑦执行在独立 worktree + self 栈。
- 任务收尾清单（plan 写死，对照 delivery-checklist 左列逐行扫过的命中项）：**持久状态变化→审计**（T3）｜**新增审计码四属性**（T3）｜**改 schema→迁移+reset 登记**（T1）｜**新字段到客户面→白名单当场裁**（T4，已裁：全是定价事实）｜**对外用业务键**（T3 confirmationNo）｜**改交易三域之一→问另两域**（spec §0 拍板 2 已答：确认单只做兑换，充提属 T&S 牌照义务；风险提示 T6 两域都做）｜**新业务动作前端入口**（T5/T6 即入口）｜**改前端→preview+截图**（T7）｜**改页面→同步 demo/script.md**（T8）｜**多波一波→承接记录进波三骨架**（T8）｜**每轮收尾→CHANGELOG+§9 报告**（T8）。未命中行（动钱/审批/权限组/admin端点/新事件/退役动作）spec §8 均为 +0。两条永不豁免：前端截图（T7）✓；动钱 verify:coa——本波不动钱，不触发。

---

### Task 1: `trade_confirmations` 表 + 迁移 + reset 登记

**Files:**
- Modify: `prisma/schema.prisma`（文件尾追加 model）
- Create: `prisma/migrations/<timestamp>_wave2_trade_confirmations/`（由 prisma 生成）
- Modify: `scripts/reset-business-data.ts:82`（`'customerNotification',` 行旁加 `'tradeConfirmation',`）

**Interfaces:**
- Produces: Prisma delegate `prisma.tradeConfirmation`，字段如下（T3/T4 依赖）。

- [ ] **Step 1: schema 追加 model**（无 FK 关系——swapNo 是业务键，镜像 `CustomerNotification` 的 relatedOrderNo 先例）

```prisma
model TradeConfirmation {
  id              String    @id @default(uuid())
  confirmationNo  String    @unique
  swapNo          String    @unique // 一单恰一张：结构保证，非幂等工程
  quoteNo         String?
  ownerCustomerNo String
  fromAmount      Decimal
  fromAssetCode   String
  toAmount        Decimal
  netToAmount     Decimal?
  feeAmount       Decimal?
  feeCurrency     String?
  feeLines        String    @default("[]") // JSON，口径=toCustomerPricingFacts
  exchangeRate    Decimal
  marketRate      Decimal?
  rateSource      String?
  fetchedAt       DateTime?
  spreadPercent   Decimal?
  spreadAmount    Decimal?
  tradedAt        DateTime  // = 兑换单 createdAt
  settledAt       DateTime? // = completedAt
  issuedAt        DateTime  @default(now())

  @@index([ownerCustomerNo])
  @@map("trade_confirmations")
}
```

- [ ] **Step 2: 生成迁移**：`npx prisma migrate dev --name wave2_trade_confirmations`（主树勿跑——worktree 内对自己的 DB 跑）；随后 `npx prisma generate`。
- [ ] **Step 3: reset 登记**：`scripts/reset-business-data.ts` 的删除清单在 `'customerNotification',`（:82）下一行加 `'tradeConfirmation',`（该脚本对不存在的 delegate 有守卫，顺序无 FK 约束）。
- [ ] **Step 4: 闸**：`npx tsc --noEmit -p tsconfig.json` 过。
- [ ] **Step 5: Commit** `feat(丙波二T1): trade_confirmations表+迁移+reset登记`

### Task 2: 点差金额公共函数 + 报价响应 `spreadAmount`

**Files:**
- Create: `src/modules/trading/shared/spread-amount.util.ts` ｜ Test: 同目录 `spread-amount.util.spec.ts`
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:459-463`（建单处改调公共函数，行为零变化）
- Modify: `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts:72,84-116`（`toCustomerQuoteResponse` 加 `toAssetDecimals` 参数并输出 `spreadAmount`；唯一调用点 :72 传 `toAsset.decimals ?? 8`）

**Interfaces:**
- Produces: `computeSpreadAmount(fromAmount: Prisma.Decimal, marketRate: Prisma.Decimal, grossAmountOut: Prisma.Decimal, toDecimals: number): Prisma.Decimal`；报价响应新键 `spreadAmount: number`（T5 消费）。

- [ ] **Step 1: 失败测试**（含 0 点差与取整残差负值，按原值输出不截断，spec §1）

```ts
import { Prisma } from '@prisma/client';
import { computeSpreadAmount } from './spread-amount.util';
const d = (v: string) => new Prisma.Decimal(v);
describe('computeSpreadAmount', () => {
  it('= fromAmount×marketRate(按toDecimals四舍五入) − grossOut', () => {
    expect(computeSpreadAmount(d('1000'), d('0.0000153'), d('0.01507'), 8).toString()).toBe('0.00023');
  });
  it('零点差输出 0', () => {
    expect(computeSpreadAmount(d('100'), d('2'), d('200'), 2).toString()).toBe('0');
  });
  it('取整残差可为负，原值输出', () => {
    expect(computeSpreadAmount(d('1'), d('1.004'), d('1.01'), 2).toString()).toBe('-0.01');
  });
});
```

- [ ] **Step 2: 跑测确认失败**：根目录 `npx jest src/modules/trading/shared/spread-amount.util.spec.ts`，预期 FAIL（模块不存在）。
- [ ] **Step 3: 实现**（算式逐字搬自 swap-workflow.service.ts:459-463，含 ROUND_HALF_UP）

```ts
import { Prisma } from '@prisma/client';
/** 点差金额 = in 腿市值(按 toAsset.decimals ROUND_HALF_UP) − 报出毛额。报价响应与建单落库共用（spec §4 同源）。 */
export function computeSpreadAmount(
  fromAmount: Prisma.Decimal, marketRate: Prisma.Decimal,
  grossAmountOut: Prisma.Decimal, toDecimals: number,
): Prisma.Decimal {
  return fromAmount.mul(marketRate).toDecimalPlaces(toDecimals, Prisma.Decimal.ROUND_HALF_UP).sub(grossAmountOut);
}
```

- [ ] **Step 4: 建单处换调**：swap-workflow.service.ts 原 `marketValueOut…sub(toAmount)` 两段改 `const spreadAmount = computeSpreadAmount(fromAmount, new Prisma.Decimal(quote.marketRate), toAmount, toDecimals);`（`toAmount` 即该处 gross out；保留原注释）。
- [ ] **Step 5: 报价响应**：`toCustomerQuoteResponse(quote, toAssetDecimals: number)` 返回体加 `spreadAmount: Number(computeSpreadAmount(new Prisma.Decimal(quote.amountIn), new Prisma.Decimal(quote.marketRate), new Prisma.Decimal(quote.amountOut), toAssetDecimals))`。
- [ ] **Step 6: 闸**：`npx jest src/modules/trading/shared src/modules/trading/swap-transactions` 全绿 + tsc①。
- [ ] **Step 7: Commit** `feat(丙波二T2): 点差金额公共函数+报价响应spreadAmount——建单同源`

### Task 3: `CONFIRMATION_ISSUED` 审计码 + 出具服务 + 漏斗接线

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（:521 `NOTIFICATION_SENT` 键旁加平面码；:1287 spec 表旁加四属性行）
- Create: `src/modules/trading/swap-transactions/trade-confirmations.service.ts` ｜ Test: 同目录 `.spec.ts`
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts:740`（`toCustomerPricingFacts` private→public，复用拆费口径）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.module.ts:83`（providers 加 `TradeConfirmationsService`）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:1460-1476`（漏斗 SUCCESS 分支）

**Interfaces:**
- Consumes: T1 delegate；`generateReferenceNo('CNF')`（`src/common/utils/no-generator.util.ts:3`）；`AuditLogsService.recordSystem`（信封逐字照 `src/core/notifications/notifications.service.ts:265-283` 先例）。
- Produces: `TradeConfirmationsService.issueForSwapIfSuccess(swapNo: string, toStatus: string): Promise<void>`（边界吞错，非 SUCCESS 立即 return）；T4 读 `prisma.tradeConfirmation.findUnique({ where: { swapNo } })`。

- [ ] **Step 1: 四属性登记**：平面码 `CONFIRMATION_ISSUED: 'CONFIRMATION_ISSUED',`；spec 行 `CONFIRMATION_ISSUED: { domain: 'SWAP', correlationMode: N, requiredFields: ['confirmationNo'] },`（含义注释：成交确认单出具，actor=system）。
- [ ] **Step 2: 失败测试**（mock prisma/audit，**行为化 mock 尊重 where**——判例"mock 无视 where 假绿"）

```ts
// trade-confirmations.service.spec.ts 断言清单（逐条写全，输入造真实形状的 swap+quote 行）：
// ① toStatus='SUCCESS' → tradeConfirmation.create 恰一次，data 含 confirmationNo(^CNF-)、swapNo、
//    ownerCustomerNo=swap.ownerNo、tradedAt=swap.createdAt、settledAt=swap.completedAt、
//    exchangeRate/feeAmount/netToAmount 来自 swap 行、marketRate/rateSource/fetchedAt/spreadPercent 来自 quote 行、
//    spreadAmount=swap.spreadAmount、feeLines=JSON（经 toCustomerPricingFacts 口径）
// ② 随后 recordSystem 恰一次：action=CONFIRMATION_ISSUED、顶层 confirmationNo、primarySubjectNo=swapNo、
//    ownerCustomerNo、requestId=created.id（倒逼"先 create 后审计"次序）
// ③ toStatus='REJECTED'/'FROZEN'/'PROCESSING' → create 与 recordSystem 均零调用
// ④ create 抛错（含唯一约束冲突）→ 方法 resolve 不外抛、recordSystem 零调用（边界吞错封条）
// ⑤ swap 行查无（findUnique(where:{swapNo}) 不匹配）→ 静默 return（行为化 mock：where.swapNo 不等即返回 null）
```

- [ ] **Step 3: 跑测确认失败**：`npx jest src/modules/trading/swap-transactions/trade-confirmations.service.spec.ts` FAIL。
- [ ] **Step 4: 实现 service**（自包含：按 swapNo 自读 swap include quote——漏斗签名只有 swapNo/ownerId，不扩）

```ts
@Injectable()
export class TradeConfirmationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly swapTransactionsService: SwapTransactionsService,
  ) {}
  /** SUCCESS 后置出具：一单一张(swapNo @unique)。整体吞错（demo 尽力而为，不阻断成交，镜像通知边界）。 */
  async issueForSwapIfSuccess(swapNo: string, toStatus: string): Promise<void> {
    if (toStatus !== SwapTransactionStatus.SUCCESS) return;
    try {
      const swap = await this.prisma.swapTransaction.findUnique({ where: { swapNo }, include: { quote: true } });
      if (!swap?.ownerNo) return;
      const facts = this.swapTransactionsService.toCustomerPricingFacts(swap.feeBreakdown);
      const created = await this.prisma.tradeConfirmation.create({ data: {
        confirmationNo: generateReferenceNo('CNF'), swapNo, quoteNo: swap.quoteNo,
        ownerCustomerNo: swap.ownerNo,
        fromAmount: swap.fromAmount, fromAssetCode: swap.fromAssetCode,
        toAmount: swap.toAmount, netToAmount: swap.netToAmount,
        feeAmount: swap.feeAmount, feeCurrency: swap.feeCurrency,
        feeLines: JSON.stringify(facts.feeLines), exchangeRate: swap.exchangeRate,
        marketRate: swap.quote?.marketRate ?? null, rateSource: swap.quote?.rateSource ?? null,
        fetchedAt: swap.quote?.fetchedAt ?? null, spreadPercent: swap.quote?.spreadPercent ?? null,
        spreadAmount: swap.spreadAmount, tradedAt: swap.createdAt, settledAt: swap.completedAt,
      }});
      await this.auditLogsService.recordSystem({
        action: AuditActions.CONFIRMATION_ISSUED, actionDomain: 'SWAP', category: AuditCategory.BUSINESS,
        primarySubjectType: AuditEntityTypes.SWAP_TRANSACTION, primarySubjectNo: swapNo,
        ownerCustomerNo: swap.ownerNo,
        subjects: [
          { subjectType: AuditEntityTypes.SWAP_TRANSACTION, subjectNo: swapNo, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'CUSTOMER', subjectNo: swap.ownerNo, subjectRole: AuditSubjectRole.OWNER },
        ],
        reason: `Trade confirmation ${created.confirmationNo} issued for ${swapNo}`,
        confirmationNo: created.confirmationNo, // requiredFields 顶层展开，metadata 另镜像（照 NOTIFICATION_SENT 先例）
        metadata: { confirmationNo: created.confirmationNo, swapNo },
        requestId: created.id, sourcePlatform: 'SYSTEM',
      } as any);
    } catch (err) { console.error(`[trade-confirmation] issue failed for ${swapNo}`, err); }
  }
}
```

- [ ] **Step 5: 漏斗接线**：`notifySwapStatusChange`（:1460）`if (!swap.swapNo) return;` 之后、`notifyOrderStatusChange` **之前**插：`await this.tradeConfirmationsService.issueForSwapIfSuccess(swap.swapNo, toStatus);`（注释引三原则①延伸：确认单先于通知，客户点开通知时单必须已存在）。构造器注入；module providers 登记。**9 调用点零改动**——分支住漏斗内。
- [ ] **Step 6: 闸**：该 spec 全绿 + `npx jest src/modules/trading/swap-transactions src/modules/audit-logging` 全绿 + tsc① + `npm run audit:vocab` 导出现役码 **328**（丙波一 327+1）。
- [ ] **Step 7: Commit** `feat(丙波二T3): CONFIRMATION_ISSUED(328)+出具服务+漏斗SUCCESS分支——先落单再审计再通知`

### Task 4: 客户详情响应附 confirmation 子对象（白名单显式映射）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts:767-800`（`findOneForCustomer` 内，`toCustomerSwapView` 结果上附加；`findOneForCustomerBySwapNo`(:787) 复用它自然覆盖，列表接口不动）
- Test: 既有 `swap-transactions.service.spec.ts` 追加（无则新建 `swap-transactions.customer-view.spec.ts`）

**Interfaces:**
- Produces: 详情响应新键 `confirmation: {...} | null`（字段=下方映射，T6 消费）。

- [ ] **Step 1: 失败测试**

```ts
// ① SUCCESS 单且确认单存在 → 响应 confirmation 含且仅含 18 键：
//    confirmationNo quoteNo fromAmount fromAssetCode toAmount netToAmount feeAmount feeCurrency
//    feeLines(数组,JSON.parse 后) exchangeRate marketRate rateSource fetchedAt spreadPercent
//    spreadAmount tradedAt settledAt issuedAt ——用 Object.keys 全等断言（白名单封条，禁 ...spread 整行）
// ② FROZEN 单 → confirmation===null 且 status==='COMPLIANCE_PENDING' 且 completedAt===null（既有反面延伸）
// ③ SUCCESS 单但确认单行不存在（历史边缘）→ confirmation===null，页面照旧
```

- [ ] **Step 2: 跑测 FAIL → Step 3: 实现**：`findOneForCustomer` 取到行后：`const conf = await this.prisma.tradeConfirmation.findUnique({ where: { swapNo: item.swapNo ?? '' } });` 仅当 `toCustomerSwapStatus(item.status)==='SUCCESS' && conf` 时逐键显式映射（`feeLines: JSON.parse(conf.feeLines)`），否则 `confirmation: null`。**判据用收敛后状态**（镜像 completedAt 先例——防"有没有确认单"反推冻结）。
- [ ] **Step 4: 闸**：相关 jest 全绿 + tsc①。
- [ ] **Step 5: Commit** `feat(丙波二T4): 客户详情附confirmation子对象——白名单18键+FROZEN反面封条`

### Task 5: 披露文案登记处 + 兑换确认弹窗（留存行+三句话）

**Files:**
- Create: `client-web/src/utils/disclosureCopy.ts`（与 `swapStatusView.ts` 同族：写死代码集中登记）｜ Test: `disclosureCopy.spec.ts`
- Modify: `client-web/src/pages/Swap.tsx`（FirmQuote 接口 ~:99 加 `spreadAmount: number`；弹窗 Fee 行(:1019-1024)后插 Retained 行；按钮(:1088)前插三句话块）

**Interfaces:**
- Consumes: T2 报价响应 `spreadAmount`。
- Produces: `DISCLOSURE_COPY`（常量对象）与 `fillRateDisclosure(source: string, fetchedAt: string, spreadPercent: number): string`（T6/T7 复用登记处）。

- [ ] **Step 1: 失败测试**（vitest：`cd client-web && npx vitest run src/utils/disclosureCopy.spec.ts`）

```ts
import { DISCLOSURE_COPY, fillRateDisclosure } from './disclosureCopy';
it('第二句填入来源/时刻/点差', () => {
  expect(fillRateDisclosure('BINANCE', '2026-10-02T10:02:05.000Z', 0.5))
    .toMatch(/market reference rate \(BINANCE, .+\) adjusted by our 0\.5% spread/);
});
it('登记处五族文案齐全', () => {
  for (const k of ['principal','rateTemplate','conflict','retainedLabel','figuresFixed','riskChain','riskFiat','riskDeposit'] as const)
    expect(DISCLOSURE_COPY[k]).toBeTruthy();
});
```

- [ ] **Step 2: 跑测 FAIL → Step 3: 实现登记处**（文案逐字照 spec §1/§2.4/§3，业主已批）

```ts
export const DISCLOSURE_COPY = {
  principal: 'FIATX acts as principal — you are trading directly with FIATX, not with another client.',
  rateTemplate: 'Your rate is the market reference rate ({source}, {time}) adjusted by our {spread}% spread.',
  conflict: 'FIATX earns the spread and fee on this trade, so our interests may differ from yours.',
  retainedLabel: 'Retained by FIATX',
  principalPast: 'FIATX acted as principal in this trade.',
  figuresFixed: 'Figures were fixed when you confirmed and will not change.',
  riskChain: 'Blockchain transfers are irreversible — funds sent to a wrong address or network cannot be recovered.',
  riskFiat: 'Bank transfers cannot be recalled once sent.',
  riskDeposit: 'Virtual assets are volatile and can lose part or all of their value.',
} as const;
export const fillRateDisclosure = (source: string, fetchedAt: string, spread: number): string =>
  DISCLOSURE_COPY.rateTemplate.replace('{source}', source)
    .replace('{time}', new Date(fetchedAt).toLocaleTimeString()).replace('{spread}', String(spread));
```

- [ ] **Step 4: 弹窗**：Retained 行照相邻 Fee 行版式：`<span>{DISCLOSURE_COPY.retainedLabel}</span><span className="font-mono text-fx-sand">Fee {formatAssetAmount(firmQuote.feeTotal, …)} {firmQuote.feeCurrency} · Spread {formatAssetAmount(firmQuote.spreadAmount, getAssetDecimalsByCode(firmQuote.currencyOut))} {firmQuote.currencyOut}</span>`（spread 原值显示不截断）。三句话块：标题 `Before you confirm`，三行小字 `principal` / `fillRateDisclosure(firmQuote.rateSource, firmQuote.fetchedAt, firmQuote.spreadPercent)` / `conflict`，置于 limitBanner 与按钮之间。
- [ ] **Step 5: 闸**：vitest 绿 + `cd client-web && npx tsc -b --noEmit`。
- [ ] **Step 6: Commit** `feat(丙波二T5): 披露文案登记处+弹窗留存行与三句话`

### Task 6: SwapDetail 确认单区块 + 打印 + 显示条件纯函数

**Files:**
- Create: `client-web/src/utils/confirmationDisplay.ts` ｜ Test: `confirmationDisplay.spec.ts`
- Modify: `client-web/src/pages/SwapDetail.tsx`（接口 :42-45 加 `confirmation` 类型；:140-188 Amounts/Pricing 两区块在显示条件成立时合并渲染为 Trade Confirmation 区块——**读 confirmation 子对象，不再现拼订单字段**；非 SUCCESS 原区块一字不变）
- Modify: `client-web/src/index.css`（尾部加打印样式）

**Interfaces:**
- Consumes: T4 `confirmation` 18 键；T5 `DISCLOSURE_COPY.principalPast/figuresFixed`。
- Produces: `shouldShowConfirmation(status: string, confirmation: unknown): boolean`。

- [ ] **Step 1: 失败测试**

```ts
import { shouldShowConfirmation } from './confirmationDisplay';
it.each([
  ['SUCCESS', {}, true], ['SUCCESS', null, false],
  ['COMPLIANCE_PENDING', {}, false], // 纵深防御：后端万一漏带，前端也不给非成功单出单
  ['REJECTED', {}, false],
])('%s/%p → %p', (s, c, want) => expect(shouldShowConfirmation(s, c)).toBe(want));
```

- [ ] **Step 2: FAIL → Step 3: 实现** `export const shouldShowConfirmation = (status: string, confirmation: unknown): boolean => status === 'SUCCESS' && confirmation != null;`
- [ ] **Step 4: 区块**：容器 `className="print-confirmation …"`；头行 `Trade Confirmation` + 右侧 `<button onClick={() => window.print()}>Print / Save as PDF</button>`（打印按钮本身 `print:hidden` 语义由下方 CSS 隐藏）；字段行沿用既有 `Field` 组件：Confirmation No（mono）/ Order（swapNo）/ Quote No / Trade time（tradedAt）/ Settled（settledAt）/ You sold / You received（netToAmount）/ Fee（feeLines 沿 Pricing 现有渲染）/ Executed rate / `Market reference {marketRate} ({rateSource}, {fetchedAt 时分秒}) · Spread {spreadPercent}%` / `{retainedLabel}: Fee … · Spread {spreadAmount}`；尾两行小字 `principalPast` 与 `figuresFixed`；Issued at 落角标。
- [ ] **Step 5: 打印样式**（index.css 尾部，浅色翻面——spec §2.4）

```css
@media print {
  body * { visibility: hidden; }
  .print-confirmation, .print-confirmation * { visibility: visible; }
  .print-confirmation { position: absolute; inset: 0 auto auto 0; width: 100%;
    background: #fff !important; }
  .print-confirmation * { color: #111 !important; background: transparent !important;
    border-color: #bbb !important; }
  .print-confirmation button { display: none !important; }
}
```

- [ ] **Step 6: 闸**：vitest 绿 + tsc③。
- [ ] **Step 7: Commit** `feat(丙波二T6): 确认单区块读留存原件+浏览器打印浅色样式`

### Task 7: 充值/提现风险提示 + 走查截图六张

**Files:**
- Modify: `client-web/src/pages/Withdraw.tsx:1070-1080`（确认按钮上方一行：所选资产 `networkInfo.kind==='CHAIN'`（或 asset.type==='CRYPTO' 兜底同页既有判别 :499 同式）→ `riskChain`，否则 `riskFiat`）
- Modify: `client-web/src/pages/Deposit.tsx`（crypto 标签页收款地址卡下方加 `riskDeposit` 一行；**fiat 标签页不加**——spec §0 拍板 3）
- Create: `doc-final/superpowers/checkups/2026-10-02-campaign-c-wave2-evidence/`（截图落盘，文件名清单见 Step 3）

**Interfaces:**
- Consumes: T5 `DISCLOSURE_COPY`。

- [ ] **Step 1: 加两处提示行**（样式照既有小字 `text-xs text-fx-dune`，不弹窗）。
- [ ] **Step 2: 闸**：tsc③ + `npm run test:client` 全绿。
- [ ] **Step 3: 走查**：worktree 内 `bash scripts/stack.sh up`（self 栈）+ 喂数（`bash scripts/on-stack.sh self demo:all`），preview 起客户端逐屏截图入 evidence 目录（≥6 张，缺一不算过）：`01-swap-modal.png`（三句话+留存行，数字可对照报价）/ `02-confirmation-block.png`（confirmationNo+出具时刻+留存行与弹窗一致）/ `03-print-preview.png`（浅色可读）/ `04-withdraw-risk.png` / `05-deposit-risk.png`（crypto 页；顺带确认 fiat 页**无**该行）/ `06-frozen-negative.png`（冻结兑换单详情：无确认单区块、无 completedAt，与审核中不可区分）。管理台审计中心按 swapNo 检索到 `CONFIRMATION_ISSUED` 另截 `07-audit-search.png`。
- [ ] **Step 4: Commit** `feat(丙波二T7): 充提风险提示+走查证据七张入档`

### Task 8: 收尾——重铺闸 + 文档剧本同步 + 承接记录

**Files:**
- Modify: `doc-final/modules/`兑换篇（确认单主体/出具链/328 一节）+ `overview.md`（审计码 327→328 头行）
- Modify: `doc-final/demo/script.md`（四幕 Confirm and Swap 步补指读；成交后补开详情看确认单+打印；既有兑换冻结场景补反面步；三/五幕各指一句风险提示）；`demo/data.md` 生成区由 demo:all 自写不手改
- Modify: `doc-final/PRODUCTION-NOTES.md`（追加一行：确认单真 PDF/整版留存/补发修正流——并入 2026-10-01 通知投递语义同族）＋ `doc-final/CHANGELOG.md` 一行
- Modify: `doc-final/superpowers/specs/2026-10-02-campaign-c-wave3-agreement-skeleton.md`「承接上一波」节（按 delivery-checklist：实际偏差/新事实/前提变化）

**收尾闸（判据全绿才算完）：**
- [ ] **Step 1: 随手闸**：tsc×3 全 0 ｜ `npx jest src/modules/trading src/modules/audit-logging src/core/notifications` 全绿 ｜ `npm run test:client` 全绿 ｜ `npm run audit:vocab` = 328。
- [ ] **Step 2: 重铺闸⑧**（动 schema 必触发）：`bash scripts/stack.sh reset self` 从零建库 → `bash scripts/on-stack.sh self demo:all` 全 PASS 零 diff（确认单随真实流程自然生成——`initiateSwap` 路径，spec §0 拍板 5 实证），判据对照 `doc-final/demo/baseline.md`。不动钱→⑦ `verify:coa` 不触发（spec §6）。
- [ ] **Step 3: 文档四件 + 承接记录**（上列 Files；§9 报告行：`Documentation updated: modules§0-4 / demo / none 之外按实动层报`）。
- [ ] **Step 4: Commit** `docs(丙波二T8): 文档剧本收口+重铺闸全绿+波三承接`

---

## Self-Review 记录（写完即查）

- **Spec 覆盖**：§1→T2/T5；§2.1→T1；§2.2/2.3→T3；§2.4→T4/T6；§3→T7；§4→T2；§5→T5；§6→各任务闸+T7/T8；§7→T8；§8 数量表=T1 表 1/T3 328/权限审批 +0（无任务产生）；§9→T7 走查+T8 重铺。无缺口。
- **占位扫描**：无 TBD；T3 测试以断言清单给出（mock 形状依赖执行时真实行结构，清单逐条可判红绿）。
- **类型一致**：`issueForSwapIfSuccess(swapNo, toStatus)` T3 定义=漏斗调用；`confirmation` 18 键 T4 产=T6 耗；`computeSpreadAmount` 四参 T2 定义=两调用点；`DISCLOSURE_COPY` 键名 T5 定义=T6/T7 消费。
