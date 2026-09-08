# 平账处置改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 差异行直接放处置按钮（硬边界过滤），一个弹窗涵盖处置+原因+字段，单码制落单，金库全线开单，修死胡同，列表页 ⚡场景气泡。

**Architecture:** 纯函数注册表先行（`dispositionsFor` 合法处置矩阵 + 单码制 REASON_SPECS 扩码）→ 写端翻转（定性与开单/补单/事故原子落）→ 读面下发处置清单 → 权限迁移 → 前端五组弹窗与行按钮 → 种子换码 → 退役清扫 → 文档收口。Spec：`doc-final/superpowers/specs/2026-09-08-recon-disposition-redesign-design.md`；UI 真相：https://claude.ai/code/artifact/4073f7fe-3e94-41c7-b1ad-62e7e5b35a5d （编号 A/B/M/L 均指它）。

**Tech Stack:** NestJS + Prisma + SQLite ｜ React (admin-web) ｜ jest ｜ TigerBeetle（分录逻辑不动）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：① 单码制——调账单 `reasonCode` 直落统一注册表码，禁止新造"成因→调账码"映射；② 全部处置动作原子落定性（两条审计码照写、显式 requestId）；③ 气泡只渲染业务键；④ 分录逻辑（`resolvePostingLegs`/`resolveReattributionLegs`）一行不改；⑤ 管理台文案全英文
- **执行环境**：`superpowers:using-git-worktrees` 建 `.claude/worktrees/recon-disposition/`（分支 `feat/recon-disposition-redesign`），栈用 self（`bash scripts/stack.sh up`）；jest 必须在 Exchange_js 根下跑、命令前置 nvm20 PATH、不接管道尾
- **并行 WIP 协同**：main 工作树有未提交的 ⚡demoRecommendedCause 改动（`reconciliation-query.service.ts`/`ReconciliationDispositionModal.tsx`/`dto`）。worktree 从 main HEAD 分出**不含**它们；Task 5/13 碰同区域时按"该块在则保留、不在则不造"处理；合并前先把 main 并进分支解冲突，再主树快进
- **Subagent 派发**：任务 prompt 必须带 CLAUDE.md §0–§5 要点；执行与任务级评审省略 model 字段走继承（主会话已是执行档）或点名 `sonnet`；**Task 3/4/6 评审点名 `opus`**（动钱闸门/权限）；终审回主会话
- 每任务收尾按本 plan 各任务「过哪几条」清单行自查，全绿才交

---

### Task 1: 统一注册表——`dispositionsFor` 矩阵 + `causesFor` 菜单（纯函数）

**本任务做**：合法处置矩阵、按处置出原因码菜单、OTHER 码入册。**不做**：动 resolveOutlet/menuFor 的既有消费者（Task 5/13）、动调账码（Task 2）。

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts`
- Test: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts`（无则新建；在 Exchange_js 根下 `npx jest src/modules/clearing-settle/reconciliation/disposition --silent`）

**Interfaces（后续任务依赖，签名照抄）:**
```ts
export type DispositionKind =
  | 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE'
  | 'SUPPLEMENT' | 'INCIDENT' | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING';
export const DISPOSITION_LABEL: Record<DispositionKind, string>; // Correction/Reversal/Record entry/Reattribute/Supplement/Register incident/Hold · Next period/Hold · Investigating
export function dispositionsFor(facts: RowFacts): DispositionKind[];
export function causesFor(kind: DispositionKind, matchType: CauseMatchType, book: CauseBook): Array<{ code: CauseCode; label: string; clue: string }>;
export function outletOf(kind: DispositionKind): StoredOutlet; // 存储映射：CORRECT→ADJUST_CORRECT … REATTRIBUTE→ADJUST_REATTRIBUTE，HOLD/SUPPLEMENT/INCIDENT 同名
```

- [ ] **Step 1: 写失败测试**（六格矩阵 = spec §2 表逐格断言；SWAP 过滤；OTHER 归属）

```ts
// cause-registry.spec.ts 追加
import { dispositionsFor, causesFor, outletOf } from './cause-registry';
const base = { deltaSign: 1 as const, internalDirection: 'IN' as const };
describe('dispositionsFor —— 六格硬边界（spec §2）', () => {
  it('金额不对×客户 = 冲正+两挂起', () => expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', ...base, internalSourceType: 'DEPOSIT' }))
    .toEqual(['CORRECT', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('金额不对×客户 SWAP 行无冲正（A1b 甲）', () => expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', ...base, internalSourceType: 'SWAP' }))
    .toEqual(['HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('金额不对×公司 = 补记+冲销+两挂起', () => expect(dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', ...base, internalSourceType: 'DEPOSIT' }))
    .toEqual(['RECORD', 'REVERSE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('我有外无×客户 = 冲销+改记+两挂起；SWAP 行只剩挂起+改记外还去掉冲销', () => {
    expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', ...base, internalSourceType: 'DEPOSIT' }))
      .toEqual(['REVERSE', 'REATTRIBUTE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
    expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', ...base, internalSourceType: 'SWAP' }))
      .toEqual(['REATTRIBUTE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']);
  });
  it('我有外无×公司 = 冲销+两挂起', () => expect(dispositionsFor({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', ...base, internalSourceType: 'DEPOSIT' }))
    .toEqual(['REVERSE', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('外有我无×客户 = 补单+改记+事故+两挂起', () => expect(dispositionsFor({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' }))
    .toEqual(['SUPPLEMENT', 'REATTRIBUTE', 'INCIDENT', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
  it('外有我无×公司 = 补记+两挂起', () => expect(dispositionsFor({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN' }))
    .toEqual(['RECORD', 'HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING']));
});
describe('causesFor —— 按处置出码 + OTHER（spec §4/§5）', () => {
  const codes = (k: any, m: any, b: any) => causesFor(k, m, b).map((c) => c.code);
  it('冲正@金额不对×客户 = 三码+OTHER', () => expect(codes('CORRECT', 'AMOUNT_MISMATCH', 'CLIENT'))
    .toEqual(['AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'OTHER']));
  it('冲销@我有外无×客户 = 三码+OTHER', () => expect(codes('REVERSE', 'ORPHAN_INTERNAL', 'CLIENT'))
    .toEqual(['DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'OTHER']));
  it('补记@外有我无×公司 = 利息+杂费+OTHER', () => expect(codes('RECORD', 'ORPHAN_EXTERNAL', 'FIRM'))
    .toEqual(['BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'OTHER']));
  it('改记/补单/事故的码固定、无 OTHER', () => {
    expect(codes('REATTRIBUTE', 'ORPHAN_INTERNAL', 'CLIENT')).toEqual(['MISATTRIBUTED_FROM']);
    expect(codes('SUPPLEMENT', 'ORPHAN_EXTERNAL', 'CLIENT')).toEqual(['MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'PAYOUT_RETURNED']);
    expect(codes('INCIDENT', 'ORPHAN_EXTERNAL', 'CLIENT')).toEqual(['UNAUTHORIZED_OUTFLOW']);
  });
  it('挂起等下期 = 跨账期(+OTHER)；调查中@公司外有我无 = 归属排查+查无果+OTHER', () => {
    expect(codes('HOLD_NEXT_PERIOD', 'ORPHAN_INTERNAL', 'CLIENT')).toEqual(['CUTOFF_STRADDLE', 'OTHER']);
    expect(codes('HOLD_INVESTIGATING', 'ORPHAN_EXTERNAL', 'FIRM')).toEqual(['UNCLAIMED_INFLOW', 'UNEXPLAINED', 'OTHER']);
  });
});
it('outletOf 存储映射稳定（spec §8 值域沿用）', () => {
  expect(outletOf('CORRECT')).toBe('ADJUST_CORRECT');
  expect(outletOf('REATTRIBUTE')).toBe('ADJUST_REATTRIBUTE');
  expect(outletOf('HOLD_NEXT_PERIOD')).toBe('HOLD_NEXT_PERIOD');
});
```

- [ ] **Step 2: 跑测试确认红**：`npx jest src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts --silent` → FAIL（dispositionsFor is not a function）
- [ ] **Step 3: 实现**——`cause-registry.ts` 追加（旧 `resolveOutlet`/`menuFor`/`staticOutletLabel` **保留不动**，Task 13 才删）：

```ts
export type DispositionKind =
  | 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE'
  | 'SUPPLEMENT' | 'INCIDENT' | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING';
export const DISPOSITION_LABEL: Record<DispositionKind, string> = {
  CORRECT: 'Correction', REVERSE: 'Reversal', RECORD: 'Record entry', REATTRIBUTE: 'Reattribute',
  SUPPLEMENT: 'Supplement', INCIDENT: 'Register incident',
  HOLD_NEXT_PERIOD: 'Hold · Next period', HOLD_INVESTIGATING: 'Hold · Investigating',
};
// 冲正/冲销只对 DEPOSIT/WITHDRAW 系来源开放（A1b 甲：SWAP 等无调账码，按钮不出现）。
// 注意流水投影里的提现 sourceType 字面量既有 'WITHDRAW' 也有 'WITHDRAWAL'（account_flows
// 表实测为 WITHDRAWAL，resolveOutlet 旧码用 WITHDRAW）——两者都收，执行时先
// `grep -rn "sourceType" src/modules/clearing-settle/reconciliation/projector/` 复核投影字面量。
const ADJUSTABLE_SOURCES = new Set(['DEPOSIT', 'WITHDRAW', 'WITHDRAWAL']);
const sourceAdjustable = (t?: string) => t != null && ADJUSTABLE_SOURCES.has(t);
export function dispositionsFor(facts: RowFacts): DispositionKind[] {
  const out: DispositionKind[] = [];
  if (facts.matchType === 'AMOUNT_MISMATCH') {
    if (facts.book === 'CLIENT') { if (sourceAdjustable(facts.internalSourceType)) out.push('CORRECT'); }
    else out.push('RECORD', 'REVERSE');
  } else if (facts.matchType === 'ORPHAN_INTERNAL') {
    if (sourceAdjustable(facts.internalSourceType)) out.push('REVERSE');
    if (facts.book === 'CLIENT') out.push('REATTRIBUTE');
  } else { // ORPHAN_EXTERNAL
    if (facts.book === 'CLIENT') out.push('SUPPLEMENT', 'REATTRIBUTE', 'INCIDENT');
    else out.push('RECORD');
  }
  out.push('HOLD_NEXT_PERIOD', 'HOLD_INVESTIGATING');
  return out;
}
```
并：① `CauseCode` 联合类型加 `'OTHER'`，`CAUSE_REGISTRY` 加条目 `OTHER: { cells: ALL_CELLS, label: 'Other', clue: 'State the reason in your own words; it is recorded verbatim.', kind: 'ADJUST' /* 占位，新径不读 kind */ }`；② 每码新增列 `usableIn: DispositionKind[]`（映射：AMT_* → ['CORRECT']；FIRM_AMT_UNDERBOOKED → ['RECORD']；FIRM_AMT_OVERBOOKED/FIRM_MISBOOKED/DUP_BOOKING/PHANTOM_BOOKING/PAYOUT_NOT_EXECUTED → ['REVERSE']；MISATTRIBUTED_* → ['REATTRIBUTE']；CUTOFF_STRADDLE → ['HOLD_NEXT_PERIOD']；MISSED_DEPOSIT/BOUNCED_FUNDS/PAYOUT_RETURNED → ['SUPPLEMENT']；UNAUTHORIZED_OUTFLOW → ['INCIDENT']；BANK_*_UNBOOKED → ['RECORD']；UNCLAIMED_INFLOW/UNEXPLAINED → ['HOLD_INVESTIGATING']；OTHER → ['CORRECT','REVERSE','RECORD','HOLD_NEXT_PERIOD','HOLD_INVESTIGATING']）；③ `causesFor` = 按 usableIn ∋ kind 且 cells 命中过滤，声明顺序输出，OTHER 恒排最后；④ `outletOf` 直译映射。
- [ ] **Step 4: 跑测试确认绿**，随手闸①（`npx tsc --noEmit -p tsconfig.json`）
- [ ] **Step 5: Commit** `git add <两文件> && git commit -m "feat(平账): dispositionsFor 合法处置矩阵 + causesFor 按处置出码 + OTHER 入册"`

**过哪几条**：无持久状态变化（纯函数），tsc①、本目录 jest 全绿即可。

---

### Task 2: 单码制——REASON_SPECS 扩码（调账规则表）

**本任务做**：新原因码进调账规则表，OTHER 双簿放行。**不做**：删旧 8 码（Task 13）、动分录函数（铁律）。

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts`
- Test: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`（追加块）

**Interfaces:** `ReasonCode` 联合类型追加 11 个成员：`AMT_MISBOOKED|AMT_FEE_NETTED|AMT_ROUNDING|DUP_BOOKING|PHANTOM_BOOKING|PAYOUT_NOT_EXECUTED|FIRM_AMT_UNDERBOOKED|FIRM_AMT_OVERBOOKED|FIRM_MISBOOKED|BANK_INTEREST_UNBOOKED|BANK_CHARGE_UNBOOKED` + `OTHER`；`REASON_SPECS` 的 `book` 类型放宽为 `Book | 'ANY'`（仅 OTHER 用），`assertReasonAllowed` 对 `'ANY'` 跳过账簿校验。

- [ ] **Step 1: 写失败测试**

```ts
describe('单码制 REASON_SPECS（spec §5）', () => {
  it.each([
    ['AMT_MISBOOKED', 'CLIENT', ['REDUCE', 'INCREASE']],
    ['DUP_BOOKING', 'CLIENT', ['REDUCE']],
    ['PAYOUT_NOT_EXECUTED', 'CLIENT', ['INCREASE']],
    ['FIRM_AMT_UNDERBOOKED', 'FIRM', ['REDUCE', 'INCREASE']],
    ['BANK_INTEREST_UNBOOKED', 'FIRM', ['INCREASE']],
    ['BANK_CHARGE_UNBOOKED', 'FIRM', ['REDUCE']],
  ] as const)('%s 落在 %s 簿、方向 %j', (code, book, dirs) => {
    expect(REASON_SPECS[code].book).toBe(book);
    expect(REASON_SPECS[code].directions).toEqual(dirs);
    expect(REASON_SPECS[code].customerLabel !== undefined).toBe(true);
  });
  it('OTHER 双簿双向放行，客户话术受控', () => {
    expect(REASON_SPECS.OTHER.book).toBe('ANY');
    expect(() => assertReasonAllowed('OTHER', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('OTHER', 'FIRM', 'INCREASE')).not.toThrow();
    expect(REASON_SPECS.OTHER.customerLabel).toBe('Balance correction');
  });
  it('旧码仍在（Task 13 才退役）', () => expect(REASON_SPECS.DEPOSIT_AMOUNT_CORRECTION).toBeDefined());
});
```

- [ ] **Step 2: 跑红** → FAIL（新码不存在）
- [ ] **Step 3: 实现**——新码条目（customerLabel：客户簿三 AMT 码与 PHANTOM/DUP/PAYOUT_NOT_EXECUTED 分别沿用旧对应文案：AMT_* → 'Balance correction'；DUP_BOOKING → 'Duplicate deposit reversal'；PHANTOM_BOOKING → 'Deposit reversal'；PAYOUT_NOT_EXECUTED → 'Withdrawal refund'；公司簿五码 customerLabel 为 null；internalLabel = 注册表 label 同词；family 按 usableIn 对应族）；directions 如测试表；`assertReasonAllowed` 首行加 `if (spec.book !== 'ANY' && spec.book !== book) …`。`requiresRelatedOrder` 不动（book×direction 语义与码无关）。
- [ ] **Step 4: 跑绿**（`npx jest src/modules/clearing-settle/reconciliation/disposition --silent`）+ tsc①
- [ ] **Step 5: Commit** `feat(平账): 单码制——REASON_SPECS 扩 12 码,OTHER 双簿放行`

**过哪几条**：客户面词表行（新码 customerLabel 当场定，手写不外露）；tsc + 本目录 jest。

---

### Task 3: 写端翻转——定性携所选处置 + 三路原子落

**本任务做**：`record()` 收「财务所选处置」并按矩阵校验；调账/补单/事故三路发起时原子落定性（两审计码、显式 requestId）。**不做**：核销/认损闸（Task 4）、读面（Task 5）。

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts`（`record()` 约 :60-120 区）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/disposition.controller.ts`（DTO 校验）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`（`createDraft` 开头：无既有定性则先 record 再 draft、再 linkAdjustment）
- Modify: `src/modules/deposit-transactions/deposit-workflow.service.ts`（`initiateSupplement`/`initiateClawback` 入参加 `causeCode`/`findingNote`，无定性则先 record(outlet=SUPPLEMENT)）
- Modify: `src/modules/withdraw-transactions/withdraw-workflow.service.ts`（`initiateReturnClaim` 同上）
- Modify: 事故登记入口服务（`grep -rn "attachIncident" src --include="*.ts"` 找到调用方，为 register-from-row 路径补 record(outlet=INCIDENT)）
- Test: `disposition.service.spec.ts` + `adjustment.service.spec.ts` 追加

**Interfaces（Produces）:** `record(dto: { caseNo; explainedFlowId?; explainedExternalLineId?; causeCode: CauseCode; disposition: DispositionKind; findingNote: string }, actor)` → 存 `outlet = outletOf(dto.disposition)`；矩阵外处置 400、码不配处置 400、OTHER 无 note 400（note 本必填）；覆盖/挂单锁语义不变。`CreateAdjustmentDto` 增可选 `causeCode?: CauseCode; findingNote?: string`（带了且行无定性 → 原子落）。

- [ ] **Step 1: 失败测试**（disposition.service.spec 追加）

```ts
it('矩阵外处置拒 400：金额不对×客户 选 REVERSE', async () => {
  await expect(svc.record({ ...baseDto, causeCode: 'AMT_MISBOOKED', disposition: 'REVERSE' }, actor))
    .rejects.toThrow(/not available for this line/);
});
it('码不配处置拒 400：CORRECT 配 DUP_BOOKING', async () => {
  await expect(svc.record({ ...baseDto, causeCode: 'DUP_BOOKING', disposition: 'CORRECT' }, actor))
    .rejects.toThrow(/does not belong/);
});
it('合法组合落库：outlet=outletOf(disposition)，审计 RECON_DISPOSITION_RECORDED 带 requestId', async () => {
  await svc.record({ ...baseDto, causeCode: 'AMT_FEE_NETTED', disposition: 'CORRECT' }, actor);
  expect(prisma.reconciliationDisposition.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ outlet: 'ADJUST_CORRECT' }) }));
  expect(audit.recordByActor).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECON_DISPOSITION_RECORDED', requestId: expect.any(String) }));
});
```
（adjustment.service.spec 追加）
```ts
it('createDraft 带 causeCode+findingNote 且行无定性 → 先 record 再 draft 再 link，两审计各一条', async () => {
  await svc.createDraft({ ...draftDto, causeCode: 'AMT_FEE_NETTED', findingNote: 'bank receipt shows net' }, actor);
  const actions = audit.recordByActor.mock.calls.map((c) => c[0].action);
  expect(actions).toEqual(expect.arrayContaining(['RECON_DISPOSITION_RECORDED', 'RECON_ADJUSTMENT_DRAFTED']));
});
it('行已挂未走完的单 → 原子路径拒 400（沿用挂单锁）', async () => { /* 造 held.adjustmentNo 非空，断言 rejects */ });
```

- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**。record() 校验序：行事实取自锚（现有 facts 组装逻辑保留）→ `dispositionsFor(facts).includes(dto.disposition)` 否则 `BadRequestException('Disposition <kind> is not available for this line')` → `causesFor(dto.disposition, facts.matchType, facts.book).some(c => c.code === dto.causeCode)` 否则拒 → 存 `outletOf`。原子路径：createDraft 在 `assertReasonAllowed` 前插入——行有定性且未挂单则沿用；无定性且 dto 带 causeCode/findingNote 则 `await this.dispositionService.record({ …, disposition: kindOfFamily(dto) }, actor)`（kindOfFamily：按 dto.reasonCode 的 REASON_SPECS.family 映射 CORRECT/REVERSE/RECORD/REATTRIBUTE）；两处均复用既有 `linkAdjustment` 挂单。补单/退汇/退回与事故登记同构（outlet 分别 SUPPLEMENT/INCIDENT）。requestId 沿用各服务既有取法（同文件其它写点照抄）。
- [ ] **Step 4: 跑绿** + tsc①；`npx jest src/modules/clearing-settle/reconciliation src/modules/deposit-transactions src/modules/withdraw-transactions --silent` 全绿
- [ ] **Step 5: Commit** `feat(平账): 定性携所选处置按矩阵校验,调账/补单/事故三路原子落定性`

**过哪几条**：审计行（两码各一条、显式 requestId——变异测试：注释掉 record 的审计调用，断言测试转红再还原）；审批正门（三路仍走既有 ApprovalsService 类型）。**评审档位：opus。**

---

### Task 4: 死胡同修复——事故定损解锁认损/核销（写闸 + 读面）

**本任务做**：`held.incidentNo` 即走事故路三重闸；读面对已定损事故行出 WRITE_OFF nextStep（按簿选码）。**不做**：事故域生命周期、通报。

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`（`assertWriteOffAllowed` 分流行：`if (held?.outlet === 'INCIDENT')` → `if (held?.incidentNo)`）
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` :550-565 块：条件 `d.outlet === 'INCIDENT' && d.incidentNo` → `d.incidentNo`；`reasonCode` 改 `caseBook === 'FIRM' ? 'UNEXPLAINED_WRITE_OFF' : 'UNEXPLAINED_CLIENT_LOSS'`；`direction` 客户簿恒 'REDUCE'、公司簿用 `resolveWriteOff(facts).direction`；块位置保持在账龄块之后（定损后覆盖 INCIDENT_DEFERRED）
- Test: `adjustment.service.spec.ts` + `reconciliation-query.service.spec.ts` 追加

- [ ] **Step 1: 失败测试**

```ts
it('HOLD_INVESTIGATING 行挂已定损事故（LARGE_UNEXPLAINED 路）→ 认损放行,金额=定损额,不查小额线', async () => {
  // held: outlet=HOLD_INVESTIGATING, incidentNo='INC1'; incident: status=ASSESSED, basis=FIRM_LOSS, assessedAmount 超小额线
  await expect(svc.createDraft(largeLossDto, actor)).resolves.toMatchObject({ status: 'DRAFT' });
});
it('挂事故但未定损 → 仍拒（三重闸①）', async () => { /* incident.status=INVESTIGATING → rejects /has not been assessed/ */ });
it('读面：HOLD_INVESTIGATING+已定损事故行 nextStep=WRITE_OFF,金额=定损额,公司簿码=UNEXPLAINED_WRITE_OFF', async () => { /* 断言 r.nextStep */ });
```

- [ ] **Step 2: 跑红**（现状：写闸落进小额线拒；读面 nextStep 为 INCIDENT_DEFERRED）
- [ ] **Step 3: 实现**（上述两处条件改 + 读面码/方向按簿；`assertIncidentWriteOffAllowed` 本体零改动——三重闸已通用）
- [ ] **Step 4: 跑绿** + tsc①；手动复现 BACKLOG 剧本：`bash scripts/stack.sh up`（worktree self 栈）→ 铺一条超线查不出差异 → 挂起 → ⚡拨钟 → Escalate → 定损 FIRM_LOSS → 案件页出「Recognize loss」→ 开单 CFO 批 → Re-reconcile 案愈；留终端输出
- [ ] **Step 5: Commit** `fix(平账): 事故定损后认损/核销解锁——闸改挂事故判定,金额锁定损额(销 BACKLOG 死胡同)`

**过哪几条**：动了钱 → 收尾闸 ⑦ `verify:coa`（本任务先在 self 栈跑一次）；两条永不豁免之②。**评审档位：opus。**

---

### Task 5: 读面翻转——行下发处置清单 + 气泡数据源

**本任务做**：差异行 `menu` → `dispositions`；案件列表下发 `demoScenarios`（业务键）。**不做**：前端（Task 7/11）。

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`（:487-529 行区）
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts`（响应形状）
- Test: `reconciliation-query.service.spec.ts`

**Interfaces（Produces，前端任务照此消费）:**
```ts
// 每差异行（替换 r.menu）：
r.dispositions = dispositionsFor(facts).map((kind) => ({
  kind, label: DISPOSITION_LABEL[kind],
  causes: causesFor(kind, facts.matchType, facts.book), // {code,label,clue}[]
}));
// r.disposition（已定性展示）保留字段名不变；outletLabel 改由 DISPOSITION_LABEL + 存储 outlet 反查，:496 的 resolveOutlet 调用删除，
// family/reasonCode/direction 改从挂着的调账单读（无单则省略——新径开单时字段在单上）
// 案件列表每行新增：
demoScenarios?: Array<{ scenarioId: number; causeCode: string; causeLabel: string; dispositionLabel: string }>;
// 取数：最近一轮带 demoManifest 的 run，scenarios[].expectedLines[].walletRef === case.walletRef 者聚合；无 manifest（真实/pass 轮）恒 undefined。
```

- [ ] **Step 1: 失败测试**（行含 dispositions 且 SWAP 行无 CORRECT；列表行 demoScenarios 命中/真实轮为空——用例形状照本文件既有 spec 的造数惯例）
- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**（⚡demoRecommendedCause 块若不在本分支（WIP 未合），不新造；若合并后出现，改读 `r.dispositions` 里的码集做包含判断）
- [ ] **Step 4: 跑绿** + tsc①
- [ ] **Step 5: Commit** `feat(平账): 读面下发合法处置清单与案件级演示场景(业务键)`

**过哪几条**：对外识别行（demoScenarios 不带 walletRef UUID——grep 响应 DTO 证明）；无新端点（复用既有 GET）。

---

### Task 6: 权限迁移——金库全线开单

**本任务做**：四个权限组持有职务 OPS→金库；案件页动作组归属核查。**不做**：CFO 权限（不动）、新权限组（无）。

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（职务持有区：`DEPOSIT_SUPPLEMENT_WRITE`/`DEPOSIT_CLAWBACK_WRITE`/`WITHDRAW_RETURN_CLAIM_WRITE` 从 OPS_OFFICER 行（:1091 一带）移入 TREASURY_OFFICER 行（:1056-1059 一带）；`RECON_DISPOSITION_WRITE`、`RECON_RUN_WRITE`（重对账/推单，:1095 一带）同迁）
- 核查步：`grep -n "RECON_RUN_WRITE\|INCIDENT_WRITE" src/modules/identity/access-control/rbac.catalog.ts` 与 `grep -rn "route('POST', '/admin/reconciliation" src` ——确认推单/重对账/事故登记各自 gate 的组；**INCIDENT_WRITE 若同时 gate 事故域内动作，采取"金库加持、OPS 暂留"（加不减），把影响面写进任务报告交终审**
- Test: `bash scripts/on-stack.sh self verify:rbac`（S5 遍历 `MAKER_GROUP_BY_POLICY`——**表本身不改**：它映射策略→组名，组名未变；变的是持有职务，S5 会用新绑定重算安全 maker）

- [ ] **Step 1**: 迁移四组 + 核查步记录结论
- [ ] **Step 2**: `npm run prisma:generate`（如需）→ `bash scripts/stack.sh up` → `npm run db:base:sync`（worktree self 栈）→ **重启后端**（`VALID_PERMISSION_DEFINITIONS` 内存加载，老坑）
- [ ] **Step 3**: `bash scripts/on-stack.sh self verify:rbac` → 全绿（含 S5 自批死锁：CFO 不在任何 maker 组）；金库账号登录见案件页动作按钮、OPS 账号不见（此步截图归 Task 7 后一并验，此处 curl 探针即可：403/200 对照）
- [ ] **Step 4: Commit** `feat(平账): 处置全线金库开单——四权限组持有职务迁移(运营退出案件页)`

**过哪几条**：权限四处齐（本次只动"职务持有"一处，另三处既有——grep 证明四处仍齐）；新端点行不触发；verify:rbac 全绿。**评审档位：opus。**

---

### Task 7: 前端——行按钮 + 挂起两弹窗（A1–A7 / B4–B5 / M8–M9）

**本任务做**：Disposition 列按钮组、挂起弹窗（两种一个组件按 kind 切）、覆盖/锁定显隐。**不做**：调账/补单弹窗（Task 8/9）。

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（动作列渲染区——现「Record finding」入口处）
- Create: `admin-web/src/components/ReconciliationHoldModal.tsx`
- 复用：`adminButtonClass`、既有 chip 样式

**Interfaces（Consumes）:** Task 5 的 `r.dispositions`；提交：挂起 → `POST /admin/reconciliation/cases/:caseNo/dispositions`，body `{ explainedFlowId|explainedExternalLineId, causeCode, disposition, findingNote }`（Task 3 契约）。

- [ ] **Step 1**: 动作列新渲染（要点，随现有代码风格落）：
```tsx
// 行无锁（!row.disposition?.adjustmentNo && !row.disposition?.supplementNo）时：
// 已有定性 → 先渲染结论 chip（`Finding: ${causeLabel} → ${outletLabel}`），按钮组仍渲染（B4/B5 覆盖语义）
// 按钮组 = row.dispositions.map：CORRECT/REVERSE/RECORD/REATTRIBUTE → 开 Task 8 弹窗；SUPPLEMENT → Task 9；
// INCIDENT → 既有事故登记弹窗（传 causeCode='UNAUTHORIZED_OUTFLOW'）；HOLD_* → ReconciliationHoldModal
// 有锁 → 只渲染既有 Pending/Explained/Rejected chips（词表沿用六态英文词表）
// 布局：flex flex-wrap gap-1，列宽沿用约 250px，禁 nowrap（横滚惯犯）
```
- [ ] **Step 2**: `ReconciliationHoldModal`（props `{ open, caseNo, row, kind: 'HOLD_NEXT_PERIOD'|'HOLD_INVESTIGATING', onClose, onDone }`）：原因单选（数据 = row.dispositions 中该 kind 的 causes；OTHER 选中出必填文本框）+ Investigation note 必填 + 静态提示行（等下期：零账务、下期自愈；调查中：启动 3 天倒计时）+ 提交（无审批，M8/M9 样机为准）
- [ ] **Step 3**: 随手闸②（`cd admin-web && npx tsc -b --noEmit`）
- [ ] **Step 4**: 预览验证——self 栈起后台，登录种子 admin，进一张 break 案：六格按钮显隐对样机 A1–A7（含 SWAP 行藏冲正——没有现成 SWAP 差异行就跳过该格截图并在报告注明）、挂两种、覆盖重定、案子仍红；**截图落盘** `doc-final/superpowers/plans/artifacts/2026-09-08-T7-*.png`（工具 `node scripts/demo-shot.js`）
- [ ] **Step 5: Commit** `feat(平账前端): 差异行直接处置按钮+挂起两弹窗,Record finding 入口退役`

**过哪几条**：新动作有入口/退役动作删入口（旧入口按钮删）；前端必截图（永不豁免①）。

---

### Task 8: 前端——调账四族弹窗（M1–M4）

**本任务做**：冲正/冲销/补记/改记一窗到底（原因码 + 推导区 + 双 note + 原子提交）。**不做**：核销/认损视图（Task 10）。

**Files:**
- Modify: `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx`（596 行，改造而非重写：`locked` 视图机制保留给核销/改记；新增「按处置进入」模式）
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（按钮接线，传 `{ kind, row }`）

**Interfaces（Consumes）:** Task 5 行数据（causes/duplicateTwinRef/deltaAmount/方向事实）；Task 3 `CreateAdjustmentDto` 的 `causeCode`/`findingNote`。前端方向/金额推导**不自算**——读 Task 5 下发的行事实按 M1/M2/M3 样机展示，提交后以后端 400 为准（推导权威在后端）。

- [ ] **Step 1**: 新模式渲染序（对照样机）：证据区（行金额/参考号/原单号）→ 原因单选（该 kind 的 causes；OTHER 出手写框；DUP_BOOKING 选中时展示 duplicateTwinRef 线索行）→ 推导区只读（Order code = 所选原因码；Direction/Amount/Effective date）→ Investigation note 必填 + Customer-facing note（customerLabel 预填）→ Submit for CFO review。改记保持既有对端候选屏（候选接线不动）。
- [ ] **Step 2**: 提交 payload：既有字段 + `causeCode` + `findingNote`；reasonCode = 所选原因码（单码制）
- [ ] **Step 3**: 闸② tsc -b
- [ ] **Step 4**: 预览走查：Bob AED 场景 5 冲正全链（选码→提交→审批中心 CFO 批→Re-reconcile 案愈）+ Frank 场景 6 冲销 + 场景 8 改记两案齐愈；**截图落盘** `2026-09-08-T8-*.png`
- [ ] **Step 5: Commit** `feat(平账前端): 调账四族一窗到底——原因码+推导区+原子提交`

**过哪几条**：客户面词表（Customer note 受控预填）；截图；改了充值提现相关展示需自问三域一致（不触发——只动对账页）。

---

### Task 9: 前端——补单弹窗改造（M5–M7）

**本任务做**：单入口按方向出类型、BELOW_MIN 提示、原子定性。**不做**：垫款/补款流（不动）。

**Files:**
- Modify: `admin-web/src/components/ReconciliationSupplementModal.tsx`（113 行；`kind` 由后端 candidates 接口按方向返回的机制保留，前端加类型单选仅当 IN 行有两个可选类型时展示）
- Modify: `ReconciliationCasesDetailPage.tsx`（「Supplement」单按钮接线；不再要求行先有定性——`canSubmit` 的 `!!dispositionNo` 前置去掉，payload 改带 `causeCode`/`findingNote`，Task 3 契约）

- [ ] **Step 1**: IN 行类型单选（Missed customer deposit / Payout returned by bank——各自表单区沿用）；OUT 行直进退汇；M5 表单区加提示行：`Amounts below this asset's single-deposit minimum will pause at OPERATION_PENDING after approval — release it on the deposit detail page.`
- [ ] **Step 2**: 闸② tsc -b
- [ ] **Step 3**: 预览走查场景 13/14/15 三路发起→CFO 批→业务域执行→Re-reconcile；**截图落盘** `2026-09-08-T9-*.png`
- [ ] **Step 4: Commit** `feat(平账前端): 补单单入口按方向出类型+下限挂起提示+原子定性`

**过哪几条**：三域对照（补单三路同改互查——三路 payload 形状一致的 grep 证明）；截图。

---

### Task 10: 前端——核销/认损 + 事故来源变体（M10–M12）

**Files:**
- Modify: `ReconciliationAdjustmentCreateModal.tsx`（WRITE_OFF locked 视图：前提清单区按来源切——账龄路四条 ✓ / 事故路三条 ✓（含 INCxxx 与定损额），M12 样机）
- Modify: `ReconciliationCasesDetailPage.tsx`（nextStep=WRITE_OFF 的按钮文案按簿：公司 Write off / 客户 Recognize loss——若既有实现已如此则仅核对）

- [ ] **Step 1**: locked.writeOff 增 `source: 'AGING' | 'INCIDENT'; incidentNo?; assessedDisplay?`（读面 nextStep 已带金额；事故路由行上 `disposition.incidentNo` 判定）
- [ ] **Step 2**: 闸② → 预览走查：场景 10 核销、场景 16 认损+补款、**死胡同新路**（Task 4 的 LARGE_UNEXPLAINED 剧本走到案愈）；**截图落盘** `2026-09-08-T10-*.png`
- [ ] **Step 3: Commit** `feat(平账前端): 核销/认损前提区按来源切,事故定损路入口(M12)`

**过哪几条**：截图；动钱链路走查后在 self 栈补跑 `bash scripts/on-stack.sh self verify:coa`。

---

### Task 11: 前端——列表页 ⚡场景气泡（L1）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesListPage.tsx`（391 行，Disposition/定性进度列）

**Interfaces（Consumes）:** Task 5 `demoScenarios`。

- [ ] **Step 1**: 行有 `demoScenarios` 时列尾渲染 ⚡ 徽标（内容 `⚡${ids.join('·')}`）；hover 出纯 CSS tooltip（绝对定位卡片，每场景一行：`#id causeLabel — dispositionLabel`；样机 L1 为准；不引库）
- [ ] **Step 2**: 闸② → 预览两态截图：模拟 break 轮列表见气泡；`recon:demo:pass` 后列表无徽标；**截图落盘** `2026-09-08-T11-*.png`
- [ ] **Step 3: Commit** `feat(平账前端): 列表页演示场景气泡(⚡,仅答案键在场)`

**过哪几条**：对外识别（tooltip 无 UUID——grep）；截图两态。

---

### Task 12: 种子与校验脚本换码 + 重铺闸

**本任务做**：全仓旧调账码引用换新码；重铺闸全绿。**不做**：删码（Task 13）。

**Files:**
- 排查命令（结论必附命令）：`grep -rn "DEPOSIT_AMOUNT_CORRECTION\|WITHDRAW_AMOUNT_CORRECTION\|DEPOSIT_DUPLICATE_REVERSAL\|DEPOSIT_SIGNAL_VOID\|WITHDRAW_VOID_REFUND\|BANK_INTEREST\b\|BANK_CHARGE\b\|FIRM_ENTRY_REVERSAL" src scripts test admin-web/src e2e 2>/dev/null`
- Modify: 命中处逐个换成对应新码（对照 spec §5 的 1:1 关系；`accounting` 域的 `BANK_INTEREST`/`BANK_CHARGE` 若是**转账码/科目侧字面量**而非调账 reasonCode，**不换**——先看上下文再动，拿不准记录给评审）
- `scripts/recon-demo.ts`：`rootCause` 已是 CauseCode 无需换；核对 manifest 断言与新读面兼容

- [ ] **Step 1**: 换码 + tsc①②③ 三闸全绿
- [ ] **Step 2**: 重铺闸：`bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all`（8/8）→ `bash scripts/on-stack.sh self recon:demo`（18/18 场景 + 12/12 钱包）→ `bash scripts/on-stack.sh self verify:coa`
- [ ] **Step 3: Commit** `chore(平账): 全仓调账码引用切单码制,重铺闸全绿`

**过哪几条**：改种子 → 重铺闸 ⑧；否定性结论（"没引用了"）附 grep 命令。

---

### Task 13: 退役清扫——旧两层码与旧入口零残余

**Files:**
- Modify: `cause-registry.ts`（删 `resolveOutlet`/`menuFor`/`staticOutletLabel`/`kind` 派生死区/`DeferredTarget.NO_REASON_CODE`）
- Modify: `adjustment-rules.ts`（删 8 个旧 ReasonCode 及条目）
- Delete: `admin-web/src/components/ReconciliationDispositionModal.tsx`（两屏定性弹窗；若合并 main 后该文件带 ⚡Recommended WIP，先把推荐徽标逻辑迁进新弹窗再删）
- Modify: `ReconciliationAdjustmentCreateModal.tsx`（删 `REASON_META` 旧码行与 `REASON_LABEL` 孤儿）
- 零残余证明（附进报告）：`grep -rn "resolveOutlet\|menuFor\|staticOutletLabel\|Record finding\|ReconciliationDispositionModal" src admin-web/src scripts test e2e` → 仅历史文档命中

- [ ] **Step 1**: 删 → tsc①②③ + `npx jest src/modules/clearing-settle/reconciliation --silent` 全绿（红即有漏网消费者，回去接干净再删）
- [ ] **Step 2: Commit** `refactor(平账): 退役 resolveOutlet/menuFor/旧8调账码/两屏定性弹窗,零残余`

**过哪几条**：退役动作删前端入口 + 幽灵零残余（grep 命令随报告）。

---

### Task 14: 文档收口 + 收尾闸 + 全链走查

**Files:**
- Modify: `doc-final/modules/v8-recon.md`（§1 处置叙事改"财务选处置"、§3 角色表全列金库、§5 技术节点：注册表/矩阵/原子落/气泡）
- Modify: `doc-final/reference/recon-cause-handbook.md`（出口列→"常见处置"；单码制说明；附录落后三波问题**不在本轮修**，保持 BACKLOG）
- Modify: `doc-final/demo/script.md` 第六幕（走查词按新入口重写：直点按钮、一窗到底、气泡开场）+ `doc-final/demo/data.md`（生成区由 demo:all 重写、手改区角色词核对）
- Modify: `doc-final/decisions.md` 三条（① 覆盖 2026-09-01"人选成因系统判出口"→"财务选处置,系统只管硬边界/留痕/复核"；② 覆盖 2026-09-02 三人链→"金库开单、CFO 批,运营退出对账"；③ 新增单码制）
- Modify: `doc-final/BACKLOG.md`（销"大额查不出定损后无出口"；新增"兑换冲正/冲销码未立（A1b 甲）"；核对 №270 下限提示已在弹窗）
- Modify: `doc-final/CHANGELOG.md` 一行

- [ ] **Step 1**: 收尾闸（worktree self 栈）：`bash scripts/stack.sh reset self` → `on-stack.sh self demo:all` → `on-stack.sh self recon:demo` → `on-stack.sh self verify:coa` → `on-stack.sh self verify:rbac` → 全绿，判据对照 `doc-final/demo/baseline.md`
- [ ] **Step 2**: 按 `demo/script.md` 新词第六幕全链走查一遍（场景 1→18 + 死胡同新路），关键幕截图补齐 `2026-09-08-T14-*.png`
- [ ] **Step 3: Commit** `docs(平账处置改版): 文档四层收口+decisions 三条+BACKLOG 销/增+CHANGELOG`
- [ ] **Step 4**: 终审（主会话）：逐条 spec 承诺找代码（历史判例："该写没写"只有终审能逮）；然后 `superpowers:finishing-a-development-branch`——合并 main 前先并 main 解 WIP 冲突，合并后主树 **重启后端 + `npm run db:base:sync`**，动了种子 → `bash scripts/stack.sh reset main` 重铺全绿

**过哪几条**：每轮收尾行全套（文档分层 + CHANGELOG + BACKLOG）；Thread 完成规则报告 `Documentation updated: modules§0-5 / demo / decisions`。

---

## Self-Review 结论（已跑）

- **Spec 覆盖**：§1 九拍板 → T1(①②硬边界+A1b)/T3(③原子)/T2+T12(④单码)/T6(⑤金库)/T7(⑥挂起)/T4(⑦死胡同)/T11(⑨气泡)；§2→T1；§4→T7-T10；§5→T1+T2；§6→T3-T6；§7→T7-T11；§8→T12；§10→各任务 Step 与 T14；§11→T14。无缺口。
- **占位扫描**：无 TBD/“类似 Task N”；两处刻意的执行时核查（sourceType 字面量、INCIDENT_WRITE 影响面）是验证步骤而非占位，均给了确切命令与回退动作。
- **类型一致**：`DispositionKind`/`dispositionsFor`/`causesFor`/`outletOf`/`dispositions`/`demoScenarios` 各任务同名同形；`causeCode`+`findingNote` 贯穿 T3/T8/T9。
