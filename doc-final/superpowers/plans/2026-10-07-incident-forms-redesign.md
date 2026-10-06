# 事件中心表单应然重设计 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 事件中心登记弹窗两段化、手动下拉 9→7、定损表单五处改（后端真门）、依据码短码前缀，一次落地。

**Architecture:** 类型差异全部收敛进既有注册表（`INCIDENT_TYPE_REGISTRY` 加一列）与前端镜像常量；服务层校验为真门、前端只做提示与显隐；零 schema 迁移（说明字段复用 `impactSummary` 列、币种复用 `assetCode` 列）。

**Tech Stack:** NestJS + Prisma（后端）｜ React + Vite（admin-web）｜ jest（后端单测；本仓库前端组件无单测基建，前端靠 tsc + preview 截图闸）

**Spec:** `doc-final/superpowers/specs/2026-10-07-incident-forms-redesign-design.md`（执行者必读，本 plan 依它论证）

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用
- 本轮特有：**零 schema 迁移**；真门以服务层校验为准（前端只是提示）；登记 payload 分流（`TOP_LEVEL_ANCHOR_KEYS`）不变；`demo/script.md` 场景 25 以零改动为目标（只核对）；种子直写库、已实勘两个已定损样本值（`DATA_IMPACT`/`SERVICE_IMPACT`）均在新合法集内——**禁止为任何数据在校验里开后门**
- 施工在 worktree（`superpowers:using-git-worktrees` 建，分支 `incident-forms-redesign`），闸门跑自己栈（self）
- commit 信息风格照仓库近史（中文 scope，如 `feat(事件表单): …`），不加任何署名行

## 本任务做 / 不做

**做**：spec §1「做」六项。**不做**：spec §1「不做」全表（损失分解/附件/多币种拆分/善后自动回挂/重定损边/管理台通知/schema 迁移）。

**收尾过哪几条**（checklist 命中行，plan 写死）：改了前端→**preview 截图**（永不豁免①）；改页面→`demo/script.md` 场景 25 **核对**（`data.md` 不动——种子零改动）；每轮收尾→CHANGELOG 一行 + BACKLOG 销账 + §9 报告。其余行未触发（无新审计码/无新边/不动钱/无新权限/无新端点/无 schema）。

---

### Task 1: 后端真门——注册表加 `allowedAssessmentBases` 列 + `assess()` 按类型收窄

**Files:**
- Modify: `src/modules/governance/incidents/incident-type-registry.ts`（接口 + 十行各加一格）
- Modify: `src/modules/governance/incidents/incident.service.ts`（`assess()` 开头的合法集来源）
- Test: `src/modules/governance/incidents/incident-type-registry.spec.ts`、`incident.service.spec.ts`

**Interfaces:**
- Produces: `IncidentTypeConfig.allowedAssessmentBases: readonly string[]`（Task 3 前端镜像照抄字面值）

- [ ] **Step 1: 注册表 spec 写失败测试**（`incident-type-registry.spec.ts` 追加）

```ts
it('每个类型的 allowedAssessmentBases 非空且是其口径合法集的子集', () => {
  for (const [type, cfg] of Object.entries(INCIDENT_TYPE_REGISTRY)) {
    const schemeSet = ASSESSMENT_BASIS_BY_SCHEME[cfg.assessmentScheme];
    expect(cfg.allowedAssessmentBases.length).toBeGreaterThan(0);
    for (const b of cfg.allowedAssessmentBases) expect(schemeSet).toContain(b);
  }
});
it('影响口径六类中仅 DATA_BREACH 允许 DATA_IMPACT、其余固定 SERVICE_IMPACT', () => {
  expect(INCIDENT_TYPE_REGISTRY.DATA_BREACH.allowedAssessmentBases).toEqual(['DATA_IMPACT']);
  for (const t of ['CYBER_BCDR', 'OUTSOURCING_FAILURE', 'ASSET_NONCOMPLIANCE', 'COMPLAINT_ESCALATION']) {
    expect(INCIDENT_TYPE_REGISTRY[t].allowedAssessmentBases).toEqual(['SERVICE_IMPACT']);
  }
});
```

（`ASSESSMENT_BASIS_BY_SCHEME` 从同文件导出，测试文件已 import 注册表，补这一个具名导入即可。）

- [ ] **Step 2: 跑测确认红**

Run: `npx jest src/modules/governance/incidents/incident-type-registry.spec.ts -t allowedAssessmentBases --silent`
Expected: FAIL（字段不存在，TS 编译错或断言 undefined）

- [ ] **Step 3: 注册表实现**——接口加字段 + 十行赋值

```ts
export interface IncidentTypeConfig {
  // …既有字段不动…
  allowedAssessmentBases: readonly string[]; // spec §4.1：按类型收窄的定损结论合法集，是 assessmentScheme 合法集的子集
}
```

十行字面值：资金族三类与 `STUCK_TRANSACTION_MAJOR` = `['RECOVERED', 'FIRM_LOSS', 'CLIENT_COLLECTION', 'NO_LOSS']`；`CYBER_BCDR`/`OUTSOURCING_FAILURE`/`ASSET_NONCOMPLIANCE`/`COMPLAINT_ESCALATION` = `['SERVICE_IMPACT']`；`DATA_BREACH` = `['DATA_IMPACT']`；`PRUDENTIAL_BREACH` = `['SHORTFALL']`。

- [ ] **Step 4: `assess()` 合法集换源**——`incident.service.ts` 定损开头两行改为：

```ts
const allowedBases = cfg.allowedAssessmentBases; // spec §4.1 真门：按类型，不再按口径
if (!dto.assessmentBasis || !allowedBases.includes(dto.assessmentBasis)) {
  throw new BadRequestException(`assessmentBasis must be one of [${allowedBases.join(', ')}] for incident type ${row.type}`);
}
```

（原 `ASSESSMENT_BASIS_BY_SCHEME[cfg.assessmentScheme]` 引用删除；该常量本身保留——注册表 spec 测试与前端镜像仍用它做子集校验。）

- [ ] **Step 5: service spec 补真门用例**（`incident.service.spec.ts` 定损段，照既有用例的 mock 样板）

```ts
it('数据泄露类定损传 SERVICE_IMPACT 被拒（按类型收窄真门）', async () => {
  // mock 行：type='DATA_BREACH', status='INVESTIGATING'（照本文件既有 assess 用例的 prisma mock 写法）
  await expect(service.assess('INC1', { assessmentBasis: 'SERVICE_IMPACT', impactSummary: 'x', reportRequired: false } as any, actor))
    .rejects.toThrow(/must be one of \[DATA_IMPACT\]/);
});
```

- [ ] **Step 6: 跑事件目录全测确认绿**

Run: `npx jest src/modules/governance/incidents --silent`
Expected: PASS（含既有用例——资金族四选用例不受影响）

- [ ] **Step 7: Commit** `feat(事件表单): 定损结论按类型收窄真门——注册表加 allowedAssessmentBases 列`

---

### Task 2: 后端——定损说明三口径必填 + 钱/缺口口径币种补填

**Files:**
- Modify: `src/modules/governance/incidents/incident.constants.ts`（`AssessIncidentDto` 加 `assetCode?: string`，注释注明 spec §4.3）
- Modify: `src/modules/governance/incidents/incident.service.ts`（`assess()` 必填校验与落库）
- Test: `src/modules/governance/incidents/incident.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `allowedAssessmentBases`（校验顺序在它之后）
- Produces: `assess()` 新契约——三口径 `impactSummary` 必填；`MONETARY`/`SHORTFALL` 且行上 `assetCode` 为空时 `dto.assetCode` 必填并落 `assetCode` 列（行上有值则忽略传入，以行值为准）

- [ ] **Step 1: 写三条失败测试**

```ts
it('钱口径定损缺说明被拒（三口径统一必填）', async () => {
  // mock 行：type='CLIENT_SHORTFALL', status='INVESTIGATING', assetCode='AED'
  await expect(service.assess('INC1', { assessmentBasis: 'FIRM_LOSS', assessedAmount: '100', reportRequired: false } as any, actor))
    .rejects.toThrow(/assessment note/i);
});
it('钱口径定损、登记未留币种且未补传被拒', async () => {
  // mock 行：type='CLIENT_SHORTFALL', assetCode=null
  await expect(service.assess('INC1', { assessmentBasis: 'FIRM_LOSS', assessedAmount: '100', impactSummary: 'why', reportRequired: false } as any, actor))
    .rejects.toThrow(/asset code/i);
});
it('钱口径补传币种落列；行上已有值时忽略传入', async () => {
  // 情形A：行 assetCode=null + dto.assetCode='USDT-TRON' → update 收到 assetCode:'USDT-TRON'
  // 情形B：行 assetCode='AED' + dto.assetCode='USDT-TRON' → update 不含 assetCode 键（或等于 'AED'）
  // 断言 prisma.incident.update 的 data（照既有用例对 update 入参断言的写法）
});
```

- [ ] **Step 2: 跑测确认红**

Run: `npx jest src/modules/governance/incidents/incident.service.spec.ts -t 口径 --silent`
Expected: FAIL

- [ ] **Step 3: 实现**——`assess()` 必填段改为：

```ts
if (!dto.impactSummary) throw new BadRequestException('Assessment requires an assessment note (impact summary)'); // spec §4.2 三口径统一
if (cfg.assessmentScheme !== 'IMPACT') {
  if (!dto.assessedAmount) throw new BadRequestException('Assessment requires an assessed amount');
  if (!row.assetCode && !dto.assetCode) {
    throw new BadRequestException('Assessment requires an asset code (none was recorded at registration)'); // spec §4.3
  }
}
```

落库 `data` 增改两处：`assetCode: row.assetCode ?? (cfg.assessmentScheme !== 'IMPACT' ? dto.assetCode ?? null : null) ?? row.assetCode`——写成显式三元难读，用前置变量：

```ts
const effectiveAssetCode = row.assetCode ?? (cfg.assessmentScheme !== 'IMPACT' ? dto.assetCode ?? null : null);
// update data 增加： assetCode: effectiveAssetCode,
// recordAudit metadata 增加： assetCode: effectiveAssetCode,（R5 判例：展示级字段镜像进 metadata）
```

- [ ] **Step 4: 跑事件目录全测**——既有用例里 IMPACT 口径不受影响；若有钱口径既有用例缺 `impactSummary` 入参，**给用例补入参**（契约变了，测试跟着变，不是放宽实现）

Run: `npx jest src/modules/governance/incidents --silent`
Expected: PASS

- [ ] **Step 5: Commit** `feat(事件表单): 定损说明三口径必填 + 钱/缺口口径币种补填落列`

---

### Task 3: 前端——定损表单改造（镜像、固定结论、说明/币种、预填、静态说明、码前缀）

**Files:**
- Modify: `admin-web/src/utils/incidentStatusMap.ts`（镜像加列）
- Modify: `admin-web/src/pages/IncidentDetailPage.tsx`（Assessment 卡 + Regulatory Filings 卡 Basis 列）

**Interfaces:**
- Consumes: Task 1 注册表字面值（镜像照抄）；详情接口既有返回（`detail.assetCode`、`detail.subjectRefs`）
- Produces: 无（终端任务）

- [ ] **Step 1: 镜像加列**——`INCIDENT_TYPE_REGISTRY_MIRROR` 每类型加 `allowedAssessmentBases`（字面值与后端注册表逐字一致，文件头注释已声明镜像关系）

- [ ] **Step 2: Assessment 卡五处改**（全部在既有表单 JSX 内，锚点=现有控件）：

```tsx
// ① 结论控件：合法集唯一时渲染固定文本，不渲染下拉
const allowedBases = INCIDENT_TYPE_REGISTRY_MIRROR[detail.type]?.allowedAssessmentBases ?? basisOptions;
{allowedBases.length === 1
  ? <span className="text-xs">{ASSESSMENT_BASIS_LABEL[allowedBases[0]]}</span>
  : <select …>{allowedBases.map(…)}</select>}

// ② 说明字段：三口径必填；label 按口径——IMPACT 维持 "Impact summary (required …)"，
//    MONETARY/SHORTFALL 新渲染同一个 textarea，placeholder="Assessment note — basis for this determination (required)"
//    提交体两口径都发 impactSummary 键（复用列，spec §4.2）；Submit disabled 条件加 !impactSummary.trim()

// ③ 币种：scheme !== 'IMPACT' 时金额框旁渲染——
{detail.assetCode
  ? <span className="font-mono text-xs text-adm-t3">{detail.assetCode}</span>
  : <input value={assessAssetCode} onChange={…} placeholder="Asset code*" className="w-28 …" />}
//    提交体在行上无币种时带 assetCode；Submit disabled 条件加 (!detail.assetCode && !assessAssetCode.trim())

// ④ 预填（useState 初值或 detail 加载后的 effect，查实可改）：
//    DATA_BREACH → impactCount 预填 subjectRefs.affectedCustomerCount
//    PRUDENTIAL_BREACH → assessedAmount 预填 subjectRefs.shortfallAmount
//    OUTSOURCING_FAILURE → impactSummary 预填 subjectRefs.serviceImpact

// ⑤ 零候选类型：reportBasisOptions.length === 0 时，撤掉 disabled checkbox，渲染静态行——
//    ASSET_NONCOMPLIANCE: "No reporting obligation — the duty is immediate asset suspension, not reporting"
//    COMPLAINT_ESCALATION: "No complaint-specific reporting obligation under VARA Market Conduct"
//    文案放 Record<string,string> 常量 NO_REPORTING_NOTE（incidentStatusMap.ts），其余类型不渲染该行
```

- [ ] **Step 3: 码前缀两处**——定损复选项与 Regulatory Filings 卡 Basis 列，渲染改 `` `${code} — ${label}` ``：

```tsx
<span className="font-mono">{code}</span> — {b?.label ?? ''}
```

- [ ] **Step 4: tsc 闸②**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..`
Expected: 零错

- [ ] **Step 5: Commit** `feat(事件表单): 定损表单按类型固定结论+说明币种预填+零候选静态说明+码前缀`

---

### Task 4: 前端——登记弹窗两段化 + 下拉 7 类 + prefill 锁定

**Files:**
- Modify: `admin-web/src/utils/incidentStatusMap.ts`（新增表单规格常量）
- Modify: `admin-web/src/pages/IncidentListPage.tsx`（`NewIncidentModal` 重排）

**Interfaces:**
- Consumes: 既有 `INCIDENT_SUBJECT_REF_FIELDS`（专属锚区不动，只挪位置）；既有 `prefill` 协议（案件页三入口传 `prefill.type` 等）
- Produces: `INCIDENT_REGISTRATION_FORM` 常量（Task 5 详情页重排复用其 `sourceFields` 口径）

- [ ] **Step 1: 规格常量落 `incidentStatusMap.ts`**（spec §2 表逐字翻译，单一来源）：

```ts
/** spec §2：登记弹窗 Type-specific 段的来路字段与顶层锚显隐/必填规格（展示层；后端校验不变仍是真门）。 */
export interface IncidentRegistrationFormSpec {
  sourceFields: readonly ('sourceCaseNo' | 'sourceDispositionNo' | 'sourceAdvanceTransferNo')[];
  requiredSources: readonly string[];
  topLevel: Partial<Record<'customerNo' | 'assetCode' | 'amount', 'required' | 'optional'>>;
}
export const INCIDENT_REGISTRATION_FORM: Record<string, IncidentRegistrationFormSpec> = {
  UNAUTHORIZED_OUTFLOW:    { sourceFields: ['sourceCaseNo', 'sourceDispositionNo'], requiredSources: ['sourceCaseNo', 'sourceDispositionNo'], topLevel: { assetCode: 'optional', amount: 'optional' } },
  LARGE_UNEXPLAINED:       { sourceFields: ['sourceCaseNo'], requiredSources: ['sourceCaseNo'], topLevel: { assetCode: 'optional', amount: 'optional' } },
  CLIENT_SHORTFALL:        { sourceFields: ['sourceAdvanceTransferNo'], requiredSources: [], topLevel: { customerNo: 'required', amount: 'required', assetCode: 'optional' } },
  CYBER_BCDR:              { sourceFields: [], requiredSources: [], topLevel: {} },
  DATA_BREACH:             { sourceFields: [], requiredSources: [], topLevel: {} },
  OUTSOURCING_FAILURE:     { sourceFields: [], requiredSources: [], topLevel: {} },
  ASSET_NONCOMPLIANCE:     { sourceFields: [], requiredSources: [], topLevel: { assetCode: 'required' } },
  STUCK_TRANSACTION_MAJOR: { sourceFields: [], requiredSources: [], topLevel: { customerNo: 'required', amount: 'required', assetCode: 'optional' } },
  PRUDENTIAL_BREACH:       { sourceFields: [], requiredSources: [], topLevel: {} },
};
/** spec §3：通用下拉只给 7 类；对账族两类唯案件页 prefill 可达。 */
export const MANUAL_DROPDOWN_TYPES = INCIDENT_TYPES.filter((t) => t !== 'UNAUTHORIZED_OUTFLOW' && t !== 'LARGE_UNEXPLAINED');
```

- [ ] **Step 2: 弹窗重排**（`NewIncidentModal`）：

```tsx
// ① Type 控件：prefill 带 type 时锁定只读（spec §3 硬约束——案件页入口的两个被砍类型经此照常登记）
{prefill?.type
  ? <div className="…只读样式…">{INCIDENT_TYPE_LABEL[prefill.type]}<span className="text-adm-t3">（entry-locked）</span></div>
  : <select value={type} …>{MANUAL_DROPDOWN_TYPES.map(…)}</select>}

// ② Common 段：Type / Title / Description 三件，删除其后所有无条件渲染的字段
// ③ Type-specific details 区（既有锚区扩容）：按 INCIDENT_REGISTRATION_FORM[type] 渲染——
//    sourceFields（沿用现有三个 input 的 JSX，搬进本区，required 按 requiredSources 打 *）
//    → topLevel 三框（沿用现有三联排 input，按 topLevel 键显隐、按值打 */optional）
//    → 既有 INCIDENT_SUBJECT_REF_FIELDS 动态锚（原样）
// ④ submit() 校验：删除对 UNAUTHORIZED_OUTFLOW/LARGE_UNEXPLAINED/CLIENT_SHORTFALL 的散列硬编码 if，
//    统一改读 INCIDENT_REGISTRATION_FORM[type]（requiredSources 与 topLevel==='required' 逐键非空）；
//    payload 组装逻辑一行不动（顶层键照旧、subjectRefs 照旧）
```

- [ ] **Step 3: tsc 闸②**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..`
Expected: 零错

- [ ] **Step 4: Commit** `feat(事件表单): 登记弹窗两段化+通用下拉7类+案件页入口类型锁定`

---

### Task 5: 前端——详情页两卡同口径重排

**Files:**
- Modify: `admin-web/src/pages/IncidentDetailPage.tsx`（Basic Info 卡 / Type-Specific Details 卡）

**Interfaces:**
- Consumes: Task 4 的 `INCIDENT_REGISTRATION_FORM`（判断该类型哪些来路字段属于专属区）

- [ ] **Step 1: 重排**——Basic Info 卡保留：Type / Status / Title / Description / Registered By / Registered At / Closed At / Withdrawn Reason（元信息）；`sourceCaseNo` / `sourceDispositionNo` / `sourceAdvanceTransferNo` / `customerNo` / `assetCode` / `amount` 六个字段的既有 `InfoField`（含链接渲染）整块搬进 Type-Specific Details 卡，置于 `subjectRefs` 锚之前；Type-Specific 卡的显示条件从 `subjectRefs 非空` 放宽为 `subjectRefs 非空 || 六字段任一非空`

- [ ] **Step 2: tsc 闸② + Commit** `refactor(事件表单): 详情页两卡与登记弹窗同口径重排`

---

### Task 6: 收尾闸——真门行为证据 + 截图走查 + 文档同步

**Files:**
- Create: `doc-final/superpowers/checkups/2026-10-07-incident-forms-redesign-evidence/`（截图落盘）
- Modify: `doc-final/modules/v1-governance.md` §7（登记表单两段化与定损口径两段描述）
- Modify: `doc-final/CHANGELOG.md`（一行）、`doc-final/BACKLOG.md`（销账对应行）
- 核对（预期零改动）: `doc-final/demo/script.md` 场景 25

- [ ] **Step 1: 随手闸三连**

Run: `npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit)`
Expected: 三栈零错

- [ ] **Step 2: 后端全目录测试**

Run: `npx jest src/modules/governance/incidents --silent`
Expected: PASS

- [ ] **Step 3: 起本 worktree 栈 + 真门行为证据**（spec §7.2，curl 直打后端绕过前端）

```bash
bash scripts/stack.sh up   # self 栈，端口看 .stackports
# 登录超管拿 token 后，对一张 INVESTIGATING 的数据泄露事件：
# ① assessmentBasis=SERVICE_IMPACT → 期待 400 "must be one of [DATA_IMPACT]"
# ② 钱口径缺 impactSummary → 期待 400 "assessment note"
# ③ 钱口径行上无币种且缺 assetCode → 期待 400 "asset code"
# 三条 400 原文截取存 evidence 目录 gate-evidence.md（命令+响应）
```

- [ ] **Step 4: preview 截图清单**（闸⑤，内置浏览器逐屏，存 evidence 目录）：9 类登记弹窗各 1（01–09，核对 spec §2 表逐字段）；prefill 锁定态 1（10，从对账案件页入口进）；定损四形态各 1（11 钱口径含说明+币种补填、12 缺口预填、13 影响口径、14 零候选静态说明行）；码前缀 1（15）。判据：网安/数据泄露/外包/审慎四类弹窗**零钱味字段**；大额查不出无 Customer No

- [ ] **Step 5: 场景 25 回归**——照 `demo/script.md` 场景 25 ①–③ 步骤在本栈重走登记→调查→定损（核对剧本措辞无一处失效；"Impact summary 必填"字样仍成立）

- [ ] **Step 6: 文档同步**——`modules/v1-governance.md` §7：「第四入口已改版」段补一句两段化与 7 类下拉；定损段补"结论按类型收窄（注册表 `allowedAssessmentBases`）、说明三口径必填、钱/缺口口径币种必有"；CHANGELOG 加一行（业务口径：观众感知=表单干净了/定损必须写依据）；BACKLOG 对应行销账

- [ ] **Step 7: Commit** `docs(事件表单): 文档同步+证据落盘+BACKLOG 销账` → 收尾按 `superpowers:finishing-a-development-branch` 走合并

---

## Self-Review 记录

- **Spec 覆盖**：§2→Task 4/5；§3→Task 4；§4.1→Task 1+3；§4.2/4.3→Task 2+3；§4.4/4.5→Task 3；§5→Task 3；§6 触点清单逐文件对上；§7 判据→Task 6 Step 1–5；§8 种子风险→已实勘前置消解（Global Constraints 记载），prefill 回归→Task 6 Step 4 第 10 张截图。无缺口。
- **类型一致**：`allowedAssessmentBases` 名称前后端一致；`INCIDENT_REGISTRATION_FORM`/`MANUAL_DROPDOWN_TYPES` 仅前端；`effectiveAssetCode` 仅 Task 2 内部。
- **占位扫描**：Task 3/4 的 JSX 以"锚点+结构代码"给出而非全文重抄（既有文件 600+ 行，重抄反而引入漂移）；判定可执行性足够——执行者持 spec + 本 plan + 源文件。
