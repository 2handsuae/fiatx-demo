# 第六幕清残留 · 波四「前端拆分」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 调账预填（金额/方向/改记 side）收回后端单一来源（顺带修出账翻符号，销 `BACKLOG.md:176`），拆掉 1893 行案件详情页与 821 行调账弹窗，断掉 6 处反向 import，收敛金额换算与色调映射重复件，删除弹窗结构性不可达的自由选择死分支——**除「提现类 AMOUNT_MISMATCH 预填方向」（演示不可达）外全程零行为变更，屏上像素零差异**。

**Architecture:** 先采对照组（栈级输出基线 + 11 张基线截图，动完永远补不回来），再从后端向前端、从纯逻辑向组件推：① 后端 `resolveAdjustmentPrefill` + DTO 字段，② 前端三处推导退役、消费点改读下发字段，③ utils 层抽离（类型/金额/色调词表）断循环 import，④ 轻组件外迁，⑤ Differences 大表外迁，⑥ 弹窗拆分 + 死分支删除，⑦ 收尾闸 + diff 白名单比对 + 截图比对 + 承接。

**Tech Stack:** NestJS + Prisma（SQLite）+ Jest ｜ React + Vite（admin-web，无组件级单测能力——`.spec.tsx` 静默不跑，前端正确性由闸② + 截图闸兜）｜ `scripts/demo-shot.js`（puppeteer-core，支持 --click/--type/--select 顺序步骤，自动登录并种 simulation cookie）

**Spec:** `doc-final/superpowers/specs/2026-09-20-act6-wave4-frontend-split-design.md`（执行者先读它 + 总纲 §3 波四行）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用；CLAUDE.md §0–§5 全部适用，派 subagent 时任务 prompt 必须带其要点
- **像素同构纪律**：JSX 搬运一律剪切粘贴式，`className` 与用户可见文案**字面禁改**，注释随行；「顺手规整」= 缺陷
- **类型纪律**（承接波一/波三）：新代码禁 `as any` / `as unknown as X` / `!` 非空断言 / `@ts-ignore`；可空的下发字段用与 `openWriteOff` 同款的早退守卫
- **行为零差异**，唯一豁免：提现类 AMOUNT_MISMATCH 的预填方向由错变对（spec §2.1，种子铺不到）；栈级 diff 白名单仅 `adjustmentPrefill` / `adjustmentBook` 两个新增字段行
- 基线：main `9cdbbacc`（含波四 spec commit `0b2a0036`，代码与 `912ebefe` 等同）；jest 对账三域 **29 suites / 561 tests** 全绿
- 执行环境：worktree + self 栈（`superpowers:using-git-worktrees` 建树，树名 `act6-wave4`；栈命令一律 `bash scripts/stack.sh ... self` / `bash scripts/on-stack.sh self ...`）
- 本机 shell 默认 node18：每条命令前置 `PATH="/Users/songshengwei/.nvm/versions/node/v20.20.2/bin:$PATH" `（平铺形式，不用子壳、不混 cd/git 链）
- jest 三域带库跑：`DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave4/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers`
- 评审分层：任务级 review 执行档；**Task 1 / Task 2 评审不降档**——kind 模式下方向锁定只读即唯一权威，「算错会静默把钱记反、无人拦」（弹窗 :122 注释原话）
- 物证目录：`doc-final/superpowers/checkups/2026-09-21-act6-wave4-evidence/`（下文简称 `$E`）
- commit 不加 attribution 行

---

## 文件结构

**新建（后端 0，前端 8）**
- `admin-web/src/utils/reconTypes.ts` — 案件页全部只读 DTO 类型（`FlowComparisonRow` 一族 + `ReconCaseDetail` 一族），纯类型零运行时
- `admin-web/src/utils/reconAmount.ts` — bigint-safe 分↔元家族单一来源（`formatAmount` / `minorToMajorPlain` / `isZeroAmount` / `minorToDisplay` / `displayToMinor`）
- `admin-web/src/components/reconciliation/DispositionFindingModal.tsx` — 页面内联弹层外迁（:580-726 原样）
- `admin-web/src/components/reconciliation/CaseHistory.tsx` — `caseHistoryTime` + `CaseHistoryCell` + `CaseHistory`
- `admin-web/src/components/reconciliation/caseDetailBits.tsx` — `ShortRef` / `IncidentBadge` / `MatchChip` / `SOURCE_TYPE_HREF` / `buildIncidentHref`
- `admin-web/src/components/reconciliation/CaseBalanceTiles.tsx` — Balance Explained 五瓦区（:1223-1330）
- `admin-web/src/components/reconciliation/CaseFlowTable.tsx` — Differences 大表（:1337-1759）
- `admin-web/src/components/reconciliation/ReattributionCandidatePicker.tsx` + `WriteOffPrereqPanel.tsx` — 弹窗两个子区块

**改（后端 3 + spec 2，前端 10）**
- `src/.../reconciliation/disposition/cause-registry.ts` + `cause-registry.spec.ts` — `resolveAdjustmentPrefill` + TDD 用例
- `src/.../reconciliation/dto/reconciliation.dto.ts` — `FlowComparisonRow.adjustmentPrefill?`
- `src/.../reconciliation/domain/reconciliation-query.service.ts` + `.spec.ts` — 行挂 prefill、case 挂 `adjustmentBook`
- `admin-web/src/pages/ReconciliationCasesDetailPage.tsx` — 退役 + 类型/工具/组件全部外迁后的编排壳
- `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx` — `deriveKindDirection` 退役、死分支删除、子区块外迁
- `admin-web/src/utils/causeRegistry.ts` — 吸收 `MATCH_TONE` / `MATCH_LABEL` / `COA_PHRASE`，类型 import 改指 reconTypes
- `admin-web/src/utils/reconBucketMap.ts` — 吸收 `TONE_CLASSES` 导出
- `admin-web/src/pages/ReconciliationRunsDetailPage.tsx` — 删本地 `formatAmount` / `isZeroAmount` / `TONE_CLASSES` 三份 fork
- `admin-web/src/pages/ReconciliationAdjustmentDetailPage.tsx` — 删本地 `formatAmount` fork
- `admin-web/src/pages/ReconciliationCasesListPage.tsx` / `ReconciliationAdjustmentListPage.tsx` / `components/ReconciliationHoldModal.tsx` / `components/InternalTransferInitiateModal.tsx` — import 改道
- 收尾：`BACKLOG.md`（:176 销账）/ `CHANGELOG.md` / 总纲状态行 / 波五骨架新立

**明确不碰**：schema / seed / 迁移（零）｜ 权限与端点（零，不需要 `db:base:sync`）｜ `utils/number-format.ts`（浮点家族）｜ `LedgerAccountList.tsx:63` / `AccountFlowList.tsx:77`（账本域 fork，spec §0 不做）｜ `demo/data.md` / `demo/script.md`（页面内容与种子零变化，不触发）

---

### Task 0: 对照组采样 + 基线截图（必须最先——动完就永远补不回来）

**Files:** 只新建 `$E` 物证目录与两个脚本，零业务代码。

- [ ] **Step 1: 物证目录 + 基线 SHA**

```bash
mkdir -p doc-final/superpowers/checkups/2026-09-21-act6-wave4-evidence
E=doc-final/superpowers/checkups/2026-09-21-act6-wave4-evidence
git rev-parse HEAD > "$E/BASELINE_SHA"; cat "$E/BASELINE_SHA"
```

- [ ] **Step 2: 重铺 + 采栈级基线**（标准序 reset → up → 采样；判例=旧库重跑 demo:all 必红）

```bash
bash scripts/stack.sh reset self
bash scripts/stack.sh up self
bash scripts/on-stack.sh self demo:all         > "$E/demoall-before.txt" 2>&1
bash scripts/on-stack.sh self recon:demo:break > "$E/break-before.txt"   2>&1
tail -3 "$E/demoall-before.txt"; tail -3 "$E/break-before.txt"
```

- [ ] **Step 3: 归一副本**（复用波一入档规则，不另立）

```bash
N=doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/normalize-rules.sh
bash "$N" "$E/demoall-before.txt" > "$E/demoall-before.norm.txt"
bash "$N" "$E/break-before.txt"   > "$E/break-before.norm.txt"
```

- [ ] **Step 4: 落盘 shot 目标解析脚本 `$E/resolve-shot-targets.mjs`**（before/after 两侧用**同一份**，按行事实通用解析、不写死单号）

```js
// 用法: node resolve-shot-targets.mjs http://127.0.0.1:<API端口>
// 输出 shell 可 source 的变量行。登录参数与 scripts/demo-shot.js 缺省一致。
const api = process.argv[2];
const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'treasury@fiatx.com', password: '123456' }) }).then((r) => r.json());
const token = login.access_token ?? login.token ?? login.accessToken;
const get = async (p) => { const r = await fetch(`${api}${p}`, { headers: { Authorization: `Bearer ${token}` } }); return r.json(); };
const listRaw = await get('/admin/reconciliation/cases?status=OPEN');
const list = Array.isArray(listRaw) ? listRaw : (listRaw.items ?? listRaw.rows ?? []);
const details = [];
for (const c of list) details.push(await get(`/admin/reconciliation/cases/${encodeURIComponent(c.caseNo)}`));
const hasKind = (d, kind) => (d.flowComparison ?? []).some((r) => (r.dispositions ?? []).some((x) => x.kind === kind));
const rowOf = (d, kind) => (d.flowComparison ?? []).find((r) => (r.dispositions ?? []).some((x) => x.kind === kind));
const firstCauseLabel = (d, kind) => rowOf(d, kind).dispositions.find((x) => x.kind === kind).causes[0].label;
// 四个目标案互不相同，避免 m3/m5 的落库定性影响后续 shot 的行状态
const used = new Set();
const pick = (kind) => { const d = details.find((x) => !used.has(x.caseNo) && hasKind(x, kind)); used.add(d.caseNo); return d; };
const correct = pick('CORRECT'); const reattr = pick('REATTRIBUTE');
const holdCase = pick('HOLD_INVESTIGATING'); const supp = pick('SUPPLEMENT');
const lines = [
  `CASE_CORRECT=${correct.caseNo}`,
  `CASE_REATTR=${reattr.caseNo}`, `CAUSE_REATTR=${JSON.stringify(firstCauseLabel(reattr, 'REATTRIBUTE'))}`,
  `CASE_HOLD=${holdCase.caseNo}`,
  `CASE_SUPP=${supp.caseNo}`, `CAUSE_SUPP=${JSON.stringify(firstCauseLabel(supp, 'SUPPLEMENT'))}`,
];
console.log(lines.join('\n'));
```

- [ ] **Step 5: 落盘截图脚本 `$E/shots.sh`**（before/after 两侧用**同一份**，`PREFIX` 区分；m3/m5/m6 含落库动作，必须排在栈级采样之后跑）

```bash
#!/bin/bash
# 用法: bash shots.sh <before|after>   —— 在 worktree 根、self 栈已起、demo:all+break 已采样之后
set -e
PREFIX=$1; E=doc-final/superpowers/checkups/2026-09-21-act6-wave4-evidence
ADM=$(grep ADMIN .stackports | grep -o '[0-9]*'); API=$(grep API .stackports | grep -o '[0-9]*')
eval "$(node "$E/resolve-shot-targets.mjs" "http://127.0.0.1:$API")"
S="node scripts/demo-shot.js --api http://127.0.0.1:$API"
B="http://localhost:$ADM/admin/reconciliation"
NOTE="Verified against statement and internal records."
# 五页（与波二 p1-p5 同一套）
$S --url "$B/runs"               --out "$E/$PREFIX-p1-runs.png"
$S --url "$B/cases"              --out "$E/$PREFIX-p2-cases.png"
$S --url "$B/cases/$CASE_CORRECT" --wait 2500 --out "$E/$PREFIX-p3-case-detail.png"
$S --url "$B/external-balances"  --out "$E/$PREFIX-p4-external-balances.png"
$S --url "$B/adjustments"        --out "$E/$PREFIX-p5-adjustments.png"
# m1 kind 模式（Correction 直开调账弹窗，零落库）
$S --url "$B/cases/$CASE_CORRECT" --click "Correction" --wait 1500 --out "$E/$PREFIX-m1-adjust-kind.png"
# m2 定性小弹层（Reattribute 打开 picker，零落库）
$S --url "$B/cases/$CASE_REATTR" --click "Reattribute" --wait 1200 --out "$E/$PREFIX-m2-finding-picker.png"
# m3 REATTRIBUTE 锁定视图（记一条定性=落库，故用专属案且排在采样后）
$S --url "$B/cases/$CASE_REATTR" --click "Reattribute" --click "$CAUSE_REATTR" \
   --type "textarea::$NOTE" --click "Continue" --wait 2500 --out "$E/$PREFIX-m3-adjust-reattr-locked.png"
# m4 Hold 弹窗（打开即拍，零落库）
$S --url "$B/cases/$CASE_HOLD" --click "Hold · Investigating" --wait 1200 --out "$E/$PREFIX-m4-hold.png"
# m5 补单弹窗（SUPPLEMENT 定性落库后自动开）
$S --url "$B/cases/$CASE_SUPP" --click "Supplement" --click "$CAUSE_SUPP" \
   --type "textarea::$NOTE" --click "Continue" --wait 2500 --out "$E/$PREFIX-m5-supplement.png"
# m6 核销锁定视图：给 CASE_HOLD 记 Hold·Investigating（m4 的案，此刻真提交）→ ⚡拨钟 → 认损/核销按钮
$S --url "$B/cases/$CASE_HOLD" --click "Hold · Investigating" --click "::0" \
   --type "textarea::$NOTE" --click "Continue" --wait 2000 --out "$E/$PREFIX-m6a-hold-recorded.png"
$S --url "$B/cases/$CASE_HOLD" --click "Fast-forward aging" --wait 2000 --out "$E/$PREFIX-m6b-aged.png"
$S --url "$B/cases/$CASE_HOLD" --click "Recognize loss" --wait 1500 --out "$E/$PREFIX-m6-writeoff-locked.png" \
  || $S --url "$B/cases/$CASE_HOLD" --click "Write off" --wait 1500 --out "$E/$PREFIX-m6-writeoff-locked.png"
echo "shots done: $PREFIX"
```

执行前先核两件事并按实修正脚本（改完的脚本才入库，之后 before/after 不再动它）：① `resolve-shot-targets.mjs` 里 cases 列表与登录响应的字段名（`curl` 各打一次确认）；② m6 的 Hold 成因单选 `--click "::0"` 是否命中第一个成因 radio（demo-shot 的 `--click "文本[::第几个]"` 语义，取 Hold·Investigating 弹层里第一个成因 label 文本更稳，跑一次视截图微调）。若 `CASE_HOLD` 拨钟后判大额走 `INCIDENT_DEFERRED`（m6 两个按钮文案都找不到），换 resolver 里 `pick('HOLD_INVESTIGATING')` 为「金额最小的案」重跑 m6 三步，修正入库。

- [ ] **Step 6: 跑基线截图**

```bash
npm i --no-save puppeteer-core@24
bash "$E/shots.sh" before
ls "$E"/before-*.png | wc -l   # 预期 13（p1-p5 + m1-m6 含 m6a/m6b 过程证）
```

- [ ] **Step 7: Commit**

```bash
git add doc-final/superpowers/checkups/2026-09-21-act6-wave4-evidence
git commit -m "test(波四对照组): 栈级输出基线+归一副本+13张基线截图+shots脚本入库(before/after同脚本)"
```

**本任务过清单行**：改了前端→截图（基线侧）；其余不触发。

---

### Task 1: 后端 `resolveAdjustmentPrefill` + DTO + 行挂载（TDD；评审不降档）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts`（`resolveWriteOff` 之后）
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts:158` 附近
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`（`:700` 后、`:500` 返回体）
- Test: `disposition/cause-registry.spec.ts` + `domain/reconciliation-query.service.spec.ts`

**Interfaces（Produces，Task 2 依赖）:**

```ts
// cause-registry.ts
export interface AdjustmentPrefill {
  amountMinor: string;
  direction: 'REDUCE' | 'INCREASE';
  reattributionSide: 'FROM' | 'TO';
}
export function resolveAdjustmentPrefill(facts: WriteOffFacts): AdjustmentPrefill;
// FlowComparisonRow（DTO）新增: adjustmentPrefill?: AdjustmentPrefill  —— 只在三类异常行下发
// getCase() 返回体新增: adjustmentBook: 'CLIENT' | 'FIRM'
```

- [ ] **Step 1: 写失败测试**（`cause-registry.spec.ts` 尾部新 describe）

```ts
describe('resolveAdjustmentPrefill（波四：开单预填单一来源）', () => {
  it('AMOUNT_MISMATCH 出账翻符号：内部 OUT、原始差 +10 → REDUCE（BACKLOG:176 组合首次入网）', () => {
    expect(resolveAdjustmentPrefill({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1, internalDirection: 'OUT', deltaAmount: '10' }))
      .toEqual({ amountMinor: '10', direction: 'REDUCE', reattributionSide: 'TO' });
  });
  it('AMOUNT_MISMATCH 入账不翻：内部 IN、原始差 -10 → REDUCE、金额取绝对值', () => {
    expect(resolveAdjustmentPrefill({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-10' }))
      .toEqual({ amountMinor: '10', direction: 'REDUCE', reattributionSide: 'TO' });
  });
  it('ORPHAN_INTERNAL：内部 IN → REDUCE、side=FROM、金额取内部行', () => {
    expect(resolveAdjustmentPrefill({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN', internalAmount: '77' }))
      .toEqual({ amountMinor: '77', direction: 'REDUCE', reattributionSide: 'FROM' });
  });
  it('ORPHAN_EXTERNAL：外部 IN → INCREASE、side=TO、金额取外部行', () => {
    expect(resolveAdjustmentPrefill({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN', externalAmount: '55' }))
      .toEqual({ amountMinor: '55', direction: 'INCREASE', reattributionSide: 'TO' });
  });
});
```

- [ ] **Step 2: 跑测试确认红**（`resolveAdjustmentPrefill is not a function`）

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave4/dev.db" npx jest src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts -t resolveAdjustmentPrefill
```

- [ ] **Step 3: 实现**（`cause-registry.ts`，`resolveWriteOff` 之后；委托复用，不抄第二份公式）

```ts
/**
 * 开单预填（波四）：差异行「开调账单」的金额/方向/改记 side——方向与金额直接委托
 * resolveWriteOff（同一条「让内部等于外部」公式：出账翻符号/内部反向/外部照搬），
 * side 与 disposition.service.ts listReattributionCandidates 的约定同源：错记方=FROM、
 * 正主方=TO。此前这三个值由前端两处各算一遍（页面 rowAdjustmentPrefill 漏了出账
 * 翻符号 = BACKLOG:176，弹窗 deriveKindDirection 是本文件的手抄镜像），波四起收回
 * 本文件单一来源，由 reconciliation-query.service 随行下发。
 */
export interface AdjustmentPrefill {
  amountMinor: string;
  direction: 'REDUCE' | 'INCREASE';
  reattributionSide: 'FROM' | 'TO';
}
export function resolveAdjustmentPrefill(facts: WriteOffFacts): AdjustmentPrefill {
  const { direction, amountMinor } = resolveWriteOff(facts);
  return { amountMinor, direction, reattributionSide: facts.matchType === 'ORPHAN_INTERNAL' ? 'FROM' : 'TO' };
}
```

- [ ] **Step 4: 跑测试确认绿**（同 Step 2 命令）

- [ ] **Step 5: DTO 字段**（`reconciliation.dto.ts`，`explainedByAdjustmentNo` 之前插入；文件已 import `DispositionKind`，同一句加 `AdjustmentPrefill`）

```ts
  // 波四：开单预填三件（金额/方向/改记 side）——唯一真相在 disposition/cause-registry.ts
  // resolveAdjustmentPrefill（出账翻符号见其头注释）。只在三类异常行下发；MATCHED/
  // IN_TRANSIT 行开不了调账弹窗（按钮唯一入口挂在 dispositions 上），不挂即不造死字段。
  adjustmentPrefill?: AdjustmentPrefill;
```

- [ ] **Step 6: 行挂载**（`reconciliation-query.service.ts` 行注解段，`r.dispositions = ...` 块（:691-700）之后紧接；顶部 import 补 `resolveAdjustmentPrefill`）

```ts
    // 波四：开单预填随行下发——与上面 dispositions 同一份 rowFacts，金额三选一交给
    // resolveAdjustmentPrefill（与核销 nextStep 同源公式）；页面与弹窗自此不再各算一遍。
    r.adjustmentPrefill = resolveAdjustmentPrefill({
      ...rowFacts,
      internalAmount: r.internalFlow?.amount,
      externalAmount: r.externalLine?.amount,
      deltaAmount: r.deltaAmount,
    });
```

- [ ] **Step 7: case 级 `adjustmentBook`**（`getCase()` 返回体 `:500-512`，`bucket` 行后加一行）

```ts
      // 波四：CLIENT|FIRM 归一化下发——与 adjustment.service.ts createDraft 同一句
      // 归一化（ctx.caseBook 即它），前端不再本地镜像（镜像不一致 = 表单选得进去提交 400）。
      adjustmentBook: ctx.caseBook,
```

- [ ] **Step 8: 读面行为测试**（`reconciliation-query.service.spec.ts`，照既有 `buildSvc` 工厂模式加两个用例；断言字面值而非回显，且第一条的 `REDUCE` 在旧前端公式下是 `INCREASE`——mock 回显骗不过）

```ts
  it('波四：AMOUNT_MISMATCH 行下发 adjustmentPrefill（出账翻符号：OUT + delta 正 → REDUCE）', async () => {
    // 造一条 internalDirection OUT、deltaAmount '5' 的 mismatch 行（fixture 照本文件既有 mismatch 用例）
    // 断言: row.adjustmentPrefill 恰等于 { amountMinor: '5', direction: 'REDUCE', reattributionSide: 'TO' }
    // 并断言: MATCHED / IN_TRANSIT 行 adjustmentPrefill === undefined
  });
  it('波四：case 级下发 adjustmentBook（book null → CLIENT）', async () => {
    // 断言 getCase 返回体 adjustmentBook === 'CLIENT'（fixture book: null）
  });
```

（两用例的 fixture 细节照该 spec 文件既有 mismatch/getCase 用例改配——文件内已有可抄的行构造；断言必须是上面两组字面值。）

- [ ] **Step 9: 闸① + jest 三域全绿；Commit**

```bash
npx tsc --noEmit -p tsconfig.json
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave4/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
git add src/modules/clearing-settle/reconciliation
git commit -m "feat(波四T1): resolveAdjustmentPrefill收编开单预填(委托resolveWriteOff,出账翻符号入网)+FlowComparisonRow.adjustmentPrefill只挂三类异常行+getCase下发adjustmentBook"
```

**本任务过清单行**：涉及金额→最小单位存展示层换算（`amountMinor` 沿用最小单位约定）；对外识别→prefill 三件无 UUID。不触发：审计（无持久状态变化）、schema、端点。

---

### Task 2: 前端三处推导退役 + 消费点改读下发字段（评审不降档）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`
- Modify: `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx`

**Interfaces（Consumes）:** Task 1 的 `row.adjustmentPrefill` / `kase.adjustmentBook`。

- [ ] **Step 1: 前端类型补字段**（页面 `interface FlowComparisonRow` 内、`interface ReconCaseDetail` 内各一处）

```ts
  // 波四：开单预填——后端 cause-registry.resolveAdjustmentPrefill 单一来源，
  // 只在三类异常行下发（MATCHED/IN_TRANSIT 无消费点）。
  adjustmentPrefill?: { amountMinor: string; direction: 'REDUCE' | 'INCREASE'; reattributionSide: 'FROM' | 'TO' };
```

```ts
  adjustmentBook: 'CLIENT' | 'FIRM';   // 波四：后端归一化下发（createDraft 同一句），前端不再镜像
```

- [ ] **Step 2: 删 `rowAdjustmentPrefill` 整段**（`:308-356` 含头注释），原地放一个纯交接组装件（非业务判断——金额/方向已由后端判死，这里只补两个证据锚与表单形状）

```ts
// 波四：预填交接（非判断）——金额/方向由行上 adjustmentPrefill 判死（后端
// cause-registry.resolveAdjustmentPrefill 单一来源），这里只补两个解释锚。
// ④ 两个解释锚一律按行原样带上——它们是这条差异的真实证据 id，后端据此在下一轮
// 对账里把这条差异从异常数里摘掉。案件级入口开单时两个都空：纯补余额，不摘差异行。
const prefillFromRow = (row: FlowComparisonRow, ap: NonNullable<FlowComparisonRow['adjustmentPrefill']>): AdjustmentPrefill => ({
  amountMinor: ap.amountMinor,
  direction: ap.direction,
  relatedOrderNo: '',
  explainedFlowId: row.internalFlow?.id,
  explainedExternalLineId: row.externalLine?.id,
});
```

- [ ] **Step 3: 四个消费点改写**

`openAdjustKind`（:870）与 `handleFindingRecorded` 的 REATTRIBUTE 支（:900）同款：

```ts
  const openAdjustKind = (row: FlowComparisonRow, kind: 'CORRECT' | 'REVERSE' | 'RECORD') => {
    const ap = row.adjustmentPrefill;
    if (!ap) return; // 按钮只在带 dispositions 的行上渲染——守卫与 openWriteOff 同款
    setCreatePrefill(prefillFromRow(row, ap));
    setAdjustLocked(null);
    setAdjustKind({ kind, row });
  };
```

REATTRIBUTE 支开头加同款 `const ap = row.adjustmentPrefill; if (!ap) return;`，`setCreatePrefill(prefillFromRow(row, ap));` 替换原调用。

`buildAdjustLocked`（:379-392）——side 与金额改读下发字段（`&& ap` 只是类型收窄：REATTRIBUTE 只可能来自异常行，行为面等价）：

```ts
const buildAdjustLocked = (handoff: AdjustHandoff, currentCaseNo: string): AdjustmentLocked => {
  const ap = handoff.row.adjustmentPrefill;
  return {
    dispositionNo: handoff.dispositionNo,
    family: handoff.family,
    reasonCode: handoff.reasonCode,
    direction: handoff.direction,
    directionNote: handoff.directionNote,
    toCandidatesUrl: handoff.family === 'REATTRIBUTE' && ap
      ? `/admin/reconciliation/cases/${encodeURIComponent(currentCaseNo)}/reattribution-candidates?side=${ap.reattributionSide}&amount=${ap.amountMinor}`
      : undefined,
  };
};
```

（该函数头上「T9：…side 由行的 matchType 决定…」注释段改为一句：「side/金额读行上 adjustmentPrefill——与查候选、开单同一个数，单一来源在后端」。）

`explainedSumMinor`（:1100-1103）：

```ts
    .reduce((sum, r) => sum + BigInt(r.adjustmentPrefill?.amountMinor ?? '0'), 0n)
```

（注释里「金额用与开单预填同一份 rowAdjustmentPrefill 算出」改为「金额读行上 adjustmentPrefill——与开单同一个数」。）

- [ ] **Step 4: `adjustmentBook` 镜像删除**（:1087-1091 注释与表达式）

```ts
  // 波四：CLIENT|FIRM 归一化由后端随 case 下发（createDraft 同一句），前端不再镜像。
  const adjustmentBook: AdjustmentBook = kase.adjustmentBook;
```

- [ ] **Step 5: 弹窗 `deriveKindDirection` 退役**——删 `:122-140`（头注释 + 函数）；`:302` 改为：

```ts
    setDirection(locked ? (locked.direction ?? '') : (isKindMode && row ? (row.adjustmentPrefill?.direction ?? '') : ''));
```

同文件 `:298` 与 `:644` 两处提到 `deriveKindDirection` 的注释，改指 `row.adjustmentPrefill.direction`（语义不变：方向只读、打开时写进 state）。

- [ ] **Step 6: 全文复核零残留 + 闸②**

```bash
grep -rn "rowAdjustmentPrefill\|deriveKindDirection" admin-web/src   # 预期 0 行
cd admin-web && npx tsc -b --noEmit && cd ..
```

- [ ] **Step 7: preview 快验**（self 栈已起；案件详情页开一条 mismatch 案，点 Correction 弹层方向仍为既有值——种子全是入账类，方向应与波前一致）+ Commit

```bash
git add admin-web/src
git commit -m "refactor(波四T2): 前端三处方向/预填推导退役(rowAdjustmentPrefill/deriveKindDirection/改记side镜像),四消费点+adjustmentBook改读后端下发字段"
```

**本任务过清单行**：改了前端→preview 渲染快验（截图闸收尾统一走 Task 7）。不触发：其余行。

---

### Task 3: utils 层抽离——类型 / 金额 / 色调词表，断 6 处反向 import，删 3 份 fork

**Files:**
- Create: `admin-web/src/utils/reconTypes.ts`、`admin-web/src/utils/reconAmount.ts`
- Modify: `admin-web/src/utils/reconBucketMap.ts`、`admin-web/src/utils/causeRegistry.ts`
- Modify: `ReconciliationCasesDetailPage.tsx`、`ReconciliationRunsDetailPage.tsx`、`ReconciliationAdjustmentDetailPage.tsx`、`ReconciliationCasesListPage.tsx`、`ReconciliationAdjustmentListPage.tsx`、`ReconciliationHoldModal.tsx`、`ReconciliationAdjustmentCreateModal.tsx`、`InternalTransferInitiateModal.tsx`

**Interfaces（Produces，Task 4-6 依赖）:**
- `utils/reconTypes.ts`：导出页面 `:71-243` 全部类型（`CaseLineItem` / `FlowMatchType` / `FlowExternalSide` / `FlowInternalSide` / `FlowComparisonRow` / `FlowComparisonSummary` / `CaseExplain` / `CaseObservation` / `CaseAdjustmentRow` / `ReconCaseDetail`），签名逐字不变
- `utils/reconAmount.ts`：`formatAmount` / `minorToMajorPlain` / `isZeroAmount`（取页面版签名 `raw: string | null | undefined`——Runs 版是它的窄化，替换为宽版对既有调用零影响）+ 弹窗的 `minorToDisplay` / `displayToMinor`，实现逐字搬运；文件头注释与 `utils/number-format.ts` 划界（那边浮点展示用，这边 bigint-safe、对账域专用）
- `utils/reconBucketMap.ts`：新增导出 `TONE_CLASSES`（两页现有实现字面相同，搬其一）
- `utils/causeRegistry.ts`：吸收 `MATCH_TONE` / `MATCH_LABEL` / `COA_PHRASE`（该文件头注释本就自述「前端自己要的展示词」）；其 `FlowComparisonRow` import 改指 `./reconTypes`

- [ ] **Step 1: 建 `reconTypes.ts`**——剪切页面 `:71-243` 类型块整段（注释随行），全部加 `export`；页面顶部 `import type { ... } from '../utils/reconTypes'`
- [ ] **Step 2: 建 `reconAmount.ts`**——剪切页面 `formatAmount` / `minorToMajorPlain` / `isZeroAmount`（:251-271）与弹窗 `minorToDisplay` / `displayToMinor`（:176-199），注释随行；页面与弹窗改 import
- [ ] **Step 3: 色调与词表**——`TONE_CLASSES` 搬进 `reconBucketMap.ts` 并导出，删两页本地副本（页面 :397-403、Runs :147-152，两页改 import）；`MATCH_TONE` / `MATCH_LABEL` / `COA_PHRASE`（页面 :405-430）搬进 `causeRegistry.ts` 并导出，页面改 import（`MATCH_LABEL` 在新家的 export 自此有真实消费者=页面，spec §2.4 判据闭合）
- [ ] **Step 4: 断反向 import**——6 处消费方改道：`utils/causeRegistry.ts:6`→reconTypes；`InternalTransferInitiateModal.tsx:7`→reconAmount+reconTypes；`ReconciliationHoldModal.tsx:14`→reconTypes；`ReconciliationAdjustmentCreateModal.tsx:36`→reconAmount+reconTypes（该文件 :34-35 的「循环 import 有先例」注释**删除**——病灶已除）；`ReconciliationCasesListPage.tsx:28`→reconAmount+causeRegistry；`ReconciliationAdjustmentListPage.tsx:19`→reconAmount（其 :10 「rather than forking a third copy」注释改指新家）。页面自身删除这些符号的 `export`（保留 default 导出）
- [ ] **Step 5: 删 3 份 fork**——Runs `formatAmount`（:124-138）/ `isZeroAmount`（:139-143）、AdjustmentDetail `formatAmount`（:59-70 含「两处各自本地一份——本仓库既有约定」注释，一并删除，该约定被本波废止），两页改 import 共享件
- [ ] **Step 6: 复现命令核数 + 闸②**

```bash
grep -rn "padStart(decimals + 1" admin-web/src --include='*.tsx' --include='*.ts'
# 预期恰 3 行: utils/reconAmount.ts ×1 + LedgerAccountList.tsx + AccountFlowList.tsx（账本域，spec §0 不做）
grep -rn "const TONE_CLASSES" admin-web/src            # 预期 1 行: utils/reconBucketMap.ts
grep -rn "from '.*ReconciliationCasesDetailPage'" admin-web/src --include='*.tsx' --include='*.ts'   # 预期 0 行
cd admin-web && npx tsc -b --noEmit && cd ..
```

- [ ] **Step 7: preview 快验**（Runs 详情 + 案件详情各刷一眼，色调与金额展示无异）+ Commit

```bash
git add admin-web/src
git commit -m "refactor(波四T3): reconTypes/reconAmount抽离+TONE_CLASSES收编reconBucketMap+词表收编causeRegistry,6处反向import断根,3份fork删除(金额换算对账域4收1/色调2收1)"
```

**本任务过清单行**：改了前端→preview 快验（截图闸 Task 7）。不触发：其余行。

---

### Task 4: 轻组件外迁——DispositionFindingModal / CaseHistory / 小件 / Balance 五瓦

**Files:**
- Create: `components/reconciliation/DispositionFindingModal.tsx` / `CaseHistory.tsx` / `caseDetailBits.tsx` / `CaseBalanceTiles.tsx`
- Modify: `pages/ReconciliationCasesDetailPage.tsx`

**Interfaces（Produces）:**

```ts
// DispositionFindingModal.tsx —— props 接口 DispositionFindingModalProps（页面 :580-588）原样随迁；
//   依赖 import: DispositionRecordResult(../ReconciliationHoldModal) / FlowComparisonRow(utils/reconTypes)
//   / rowFacts(utils/causeRegistry) / adminFetch 三件套 / adminButtonClass / useSimulationMode
// CaseHistory.tsx —— export const CaseHistory: ({ kase, agingReferenceMs }: { kase: ReconCaseDetail; agingReferenceMs: number }) => JSX
//   （连 caseHistoryTime、CaseHistoryCell 一起搬，后两者不导出）
// caseDetailBits.tsx —— export { ShortRef, IncidentBadge, MatchChip, SOURCE_TYPE_HREF, buildIncidentHref }
// CaseBalanceTiles.tsx —— Balance Explained 区（页面 :1223-1330 JSX 段）成组件；props 以段内实际引用收口
//   （基准: { kase: ReconCaseDetail }，段内若引用 explainedSumMinor 等派生值则一并入 props——由闸② 收口，禁止把求和算式搬进组件）
```

- [ ] **Step 1: 外迁 `DispositionFindingModal`**（页面 :580-726 + props 接口 :580-588 剪切粘贴，import 按上表补齐；页面处改 `import { DispositionFindingModal } from '../components/reconciliation/DispositionFindingModal'`，挂载处 JSX 零改动）
- [ ] **Step 2: 外迁 `CaseHistory`**（:464-477 `caseHistoryTime` + :513-578 两组件）与 `caseDetailBits`（:432-462 `ShortRef`/`SOURCE_TYPE_HREF` + :478-495 `buildIncidentHref`/`IncidentBadge` + :497-511 `MatchChip`；`buildIncidentHref` 页面 handlers 还在用——从 bits 文件 import 回页面）
- [ ] **Step 3: 外迁 `CaseBalanceTiles`**（:1223-1330 JSX 段，剪切粘贴，段内 className/文案零改动）
- [ ] **Step 4: 闸② + preview 快验（案件详情页整页走查一遍：历史区/五瓦/差异行徽章/定性弹层开合）+ Commit**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
git add admin-web/src
git commit -m "refactor(波四T4): DispositionFindingModal/CaseHistory/小件/Balance五瓦外迁components/reconciliation,JSX与className逐字搬运"
```

**本任务过清单行**：改了前端→preview 快验。不触发：其余行。

---

### Task 5: Differences 大表外迁 `CaseFlowTable`（本波最大搬运，单独成任务单独评审）

**Files:**
- Create: `components/reconciliation/CaseFlowTable.tsx`
- Modify: `pages/ReconciliationCasesDetailPage.tsx`

**Interfaces（Produces）:**

```ts
interface CaseFlowTableProps {
  kase: ReconCaseDetail;
  sortedFlows: FlowComparisonRow[];
  showMatched: boolean;
  setShowMatched: (v: boolean) => void;
  simEnabled: boolean;
  onOpenAdjustKind: (row: FlowComparisonRow, kind: 'CORRECT' | 'REVERSE' | 'RECORD') => void;
  onOpenFinding: (row: FlowComparisonRow, kind: string, label: string) => void;
  onOpenHold: (row: FlowComparisonRow, kind: 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING') => void;
  onOpenWriteOff: (row: FlowComparisonRow) => void;
  onOpenFunding: (row: FlowComparisonRow) => void;
}
// 基准名单——段内（页面 :1337-1759）实际引用的标识符以闸② 收口：缺的加进 props（回调一律
// on* 命名转发既有 handler，不改语义），多的删掉。纯展示 helper（shortTimestamp/fmtTime/
// rowTimestamp/MATCH_RANK/deltaSign）当前只有本段和 sortedFlows 用——随迁进组件文件或留页面，
// 以「消费方在哪就住哪」定夺并在 commit 文案记录去向。
```

- [ ] **Step 1: 剪切 :1337-1759 整段 JSX 成组件**（结构、className、文案逐字保留；`row.dispositions!.map` 处的 `!` 是既有代码原样随迁，不算新增类型逃逸，也不顺手改）
- [ ] **Step 2: 页面挂载处替换为 `<CaseFlowTable ... />`**，handlers 原名转传
- [ ] **Step 3: 闸② + 行数复核**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
wc -l admin-web/src/pages/ReconciliationCasesDetailPage.tsx admin-web/src/components/reconciliation/CaseFlowTable.tsx
# 页面预期 ≤ 650（软目标，记实数；超出需结构性解释入 WRAPUP——波三 run() 190 行先例）
```

- [ ] **Step 4: preview 快验**（差异表：折叠/展开 Matched、各按钮弹层开合、⚡推荐徽标）+ Commit

```bash
git add admin-web/src
git commit -m "refactor(波四T5): Differences大表外迁CaseFlowTable(:1337-1759逐字搬运),页面只剩状态编排+版面组装"
```

**本任务过清单行**：改了前端→preview 快验。不触发：其余行。

---

### Task 6: 调账弹窗拆分 + 自由选择死分支删除（翻案点，spec §2.3 已批）

**Files:**
- Modify: `components/ReconciliationAdjustmentCreateModal.tsx`
- Create: `components/reconciliation/ReattributionCandidatePicker.tsx` / `WriteOffPrereqPanel.tsx`

- [ ] **Step 1: 判死复跑**（删之前在 HEAD 再验一次，纪律第 6 条）

```bash
grep -n "setCreatePrefill(" admin-web/src/pages/ReconciliationCasesDetailPage.tsx
# 预期: 全部调用点要么同时 setAdjustKind（kind 模式）要么同时 setAdjustLocked（锁定），
# 要么是置空收尾——不存在「双空打开」的入口；弹窗仅在 createPrefill 非空时挂载
grep -rn "REASON_META" admin-web/src | grep -v ReconciliationAdjustmentCreateModal.tsx   # 预期 0 行
```

- [ ] **Step 2: 删自由选择分支**——`interface ReasonMeta`（:45-49）、`REASON_META` 空表及其头注释（:51-59）、`reasonOptions` / `directionOptions` / `pickReason`（:366-377 一带）及其 JSX 渲染分支（以 `reasonOptions` 的引用定位）整体删除；`REASON_LABEL`（:66，活词表）**不动**；删完 `grep -n "REASON_META\|reasonOptions\|pickReason" admin-web/src` 预期 0 行
- [ ] **Step 3: 外迁改记候选区**——candidates state + 拉取 useEffect（:332-370）+ 候选列表 JSX 成 `ReattributionCandidatePicker`（props 基准：`{ url: string; assetCode: string; decimals: number; onPick: (c: ReattributionCandidateRow) => void }`，`ReattributionCandidateRow` 接口随迁导出；实际引用以闸② 收口）
- [ ] **Step 4: 外迁核销前提区**——M10-M12 前提清单 JSX（:540 一带，以 `locked.writeOff` 的引用定位整段）成 `WriteOffPrereqPanel`（props 基准：`{ writeOff: NonNullable<AdjustmentLocked['writeOff']> }` + 段内实际引用）
- [ ] **Step 5: 闸② + 行数复核 + preview 快验（kind / REATTRIBUTE 锁定 / 核销锁定三形态各开一次）+ Commit**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
wc -l admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx   # 预期 ≤ 450（软目标记实数）
git add admin-web/src
git commit -m "refactor(波四T6): 调账弹窗拆分(候选选择器/核销前提区外迁)+自由选择死分支删除(REASON_META空表+三helper+JSX支,判死双证spec§1.4)"
```

**本任务过清单行**：退役业务动作→**不适用**（删的是无入口死分支，前端入口本就不存在——判死复跑即物证）；改了前端→preview 快验。

---

### Task 7: 收尾闸全套——diff 白名单、截图比对、销账、承接（对照 `rules/delivery-checklist.md` 逐行）

**Files:** `$E` 物证 + `BACKLOG.md` + `CHANGELOG.md` + 总纲 + 波五骨架新立。

- [ ] **Step 1: 三闸 + jest 三域**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web  && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave4/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
# 基线 29/561 起算，记录新计数（T1 预期 +4~+6 tests）
```

- [ ] **Step 2: after 栈级采样 + 归一 + 白名单 diff**（同 Task 0 流程；采样先于截图）

```bash
E=doc-final/superpowers/checkups/2026-09-21-act6-wave4-evidence
bash scripts/stack.sh reset self && bash scripts/stack.sh up self
bash scripts/on-stack.sh self demo:all         > "$E/demoall-after.txt" 2>&1
bash scripts/on-stack.sh self recon:demo:break > "$E/break-after.txt"   2>&1
N=doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/normalize-rules.sh
bash "$N" "$E/demoall-after.txt" > "$E/demoall-after.norm.txt"
bash "$N" "$E/break-after.txt"   > "$E/break-after.norm.txt"
diff "$E/demoall-before.norm.txt" "$E/demoall-after.norm.txt" > "$E/demoall-diff.txt"; wc -c "$E/demoall-diff.txt"
diff "$E/break-before.norm.txt"   "$E/break-after.norm.txt"   > "$E/break-diff.txt";   wc -c "$E/break-diff.txt"
# 判据: 两份 diff 为空 = 达标（demo 输出若不含 case 读面 JSON，天然为空，如实记「白名单未启用」）；
# 非空时逐 hunk 检查——只许命中 adjustmentPrefill / adjustmentBook 字样，过滤副本入档:
grep -v "adjustmentPrefill\|adjustmentBook" "$E/demoall-diff.txt" | grep "^[<>]" ; echo "exit=$?"   # 预期无输出(exit=1)
# 保守项: verify:coa（波四判定不动钱，本不触发；跑它是廉价地基核验，红了即停手回报）。
# 如实记档: recon-demo.ts 零处置/调账动作（grep -n "createDraft\|/dispositions\|adjustmentNo" scripts/recon-demo.ts → 0 行），
# 故 verify:coa 对本波方向公式**无探测力**——方向等价性的闸是 T1 单测 + Step 3 的 m1 截图断言，不许拿 coa 绿充数。
bash scripts/on-stack.sh self verify:coa | tail -5
```

- [ ] **Step 3: after 截图 + 逐张比对**（同一份 shots.sh；比对口径=spec §6 闸 4）

```bash
bash "$E/shots.sh" after
```

逐张并排比对 before-\*/after-\* 共 13 对，往 `$E/walkthrough.md` 写比对表：每行一张图，断言**文案 / 列 / 按钮组 / 布局零差异**；允许两侧不同的仅：单号与日期时间字面（两侧各自重铺所致）、aging 天数（自然日漂移）——出现任何第三类差异即停手回报。**m1（kind 模式）额外断言**：Direction 只读值与该行 delta 符号在入账语义下一致（= 波前行为）。

- [ ] **Step 4: 复现命令归零复跑**（三条,同 Task 3 Step 6 + Task 2 Step 6 + Task 6 判死条,结果记 walkthrough）
- [ ] **Step 5: 行数清册**

```bash
wc -l admin-web/src/pages/ReconciliationCasesDetailPage.tsx \
      admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx \
      admin-web/src/components/reconciliation/*.tsx admin-web/src/utils/recon*.ts
# 软目标: 页面 ≤650 / 弹窗 ≤450 / 新件各 ≤500——实数进 WRAPUP，超标附结构性解释
```

- [ ] **Step 6: 文档收口**——① `BACKLOG.md:176` 按既有销账体例销账（注明「波四收编修复：方向公式收回后端 cause-registry，出账翻符号用例入 cause-registry.spec」）；② `CHANGELOG.md` 加一行（波四：前端拆分+预填收编，行为差异仅提现类预填方向）；③ 总纲状态行回写「波四已完成」；④ **波五骨架新立** `specs/2026-09-21-act6-wave5-skeleton.md`：只含总纲链接 + 「承接上一波」节（实际偏差 / 新事实 / 波五前提有无变化——重点核对：波五要改的 7 处业务日文件本波是否被拆分挪动过位置）+ 已定事实 + 待定岔口空节——**不展开波五 spec**
- [ ] **Step 7: WRAPUP.md 入档**（`$E/WRAPUP.md`：四硬判据逐条物证索引 + 行数实数 + jest 计数 + 清单命中行核对表）+ Commit

```bash
git add doc-final
git commit -m "docs(波四收尾): 栈级diff白名单比对+13对截图walkthrough+行数清册+BACKLOG:176销账+CHANGELOG+总纲回写+波五骨架承接"
```

- [ ] **Step 8: 合并要求**（合并会话执行,此处只记）：merge 进 main 后 **build + 重启后端**（主栈跑 dist）；无新端点无权限变更,**不需要** `db:base:sync`；无 schema 变更,不触发重铺闸

**本任务过清单行**：改了前端→截图（本波闸 4 本体）；本任务是多波中的一波→承接写进波五骨架、不展开；每轮收尾→CHANGELOG 一行 + BACKLOG 销账 + 文档分层收口（报告行：Documentation updated: none——`modules/` 现状层零变化，波四是结构波）。不触发：改页面或种子（内容零变化）、动了钱（记账路径零改动；verify:coa 作保守项加跑但不当证据，见 Step 2 注）、schema（重铺闸）、新字段到客户面（client-web 对对账读面零消费，命中的 3 处 "reconciliation" 均为营销文案字面——2026-09-21 实扫）。

---

## Self-Review 记录（写完当日）

1. **Spec 覆盖**：§2.1 收编→T1/T2；§2.2 六去处→T3/T4/T5；§2.3 弹窗+翻案→T6；§2.4 摘 export→T3 Step 3（词表迁移路径，spec 预写的两形态之一）；§6 六闸→T7 + 各任务随手闸；§5 交付清单命中行→各任务尾。无遗漏。
2. **占位符扫描**：Task 1 Step 8 的两用例以「fixture 照本文件既有用例改配 + 断言字面值给死」交代——断言值已写死，fixture 是既有文件的机械改配，不属「Write tests for the above」型占位。Task 5/6 的 props「基准名单 + 闸② 收口」承接波三「bal 的现类型照文件内声明」先例：搬运型任务由编译器收口引用集合，plan 锁死的是**语义禁改与命名**。
3. **类型一致性**：`AdjustmentPrefill`（后端 cause-registry 导出）与前端行内联类型字段名逐一核对（amountMinor/direction/reattributionSide）；`prefillFromRow` 返回的前端 `AdjustmentPrefill`（弹窗导出，含 relatedOrderNo/锚）与后端同名接口是**两个模块的两个类型**，plan 各处引用已分别限定文件，不混用。
4. **顺序依赖**：T2 依赖 T1 字段；T4/T5 依赖 T3 的 utils；T6 独立于 T4/T5 但排后（同文件冲突面最小化）；T0/T7 首尾采样对称，shots.sh 与 resolver 两侧同脚本。
