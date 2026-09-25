# 战役甲·波一「事件中心扩景」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 事件类型 4→9 启用 +1 占位（砍 MANUAL），以八格类型注册表统一站规：按族分权经办、四链结案、依据码按义务勾选、锚与定损异构吸收。

**Architecture:** 一个声明式类型注册表（`incident-type-registry.ts`）成为唯一站规来源；状态机六态、审批引擎、审计合同零改动；service 层按注册表校验（锚键/口径/码候选/白名单/经办桶），close-workflow 的硬编码三元退役为注册表查链。

**Tech Stack:** NestJS 11 + Prisma(SQLite) + jest ｜ React admin-web ｜ 既有审批引擎/审计/RBAC 目录。

**Spec:** `doc-final/superpowers/specs/2026-09-25-campaign-a-wave1-incident-taxonomy-spec.md`（本 plan 逐节实现它；执行者两份都读）

## Global Constraints

- **通用交付清单见 `rules/delivery-checklist.md`，全部适用。**
- **本轮特有**：①零账务（`verify:coa` 不触发）②**零客户面暴露**——所有新面均管理台侧，client-web 零变更（闸③不触发；DATA_BREACH 的"波及客户"只是管理台锚字段，不通知不展示给客户）③`shortfallAmount` 与存量 `amount` 同口径（元、字符串，对齐 `CreateInternalTransferInput.amountMajor`）④不新增审计码、不新增领域事件、不加状态边。
- **worktree 隔离执行**（项目总纲 §10）：一会话=一 worktree=一分支=自动分栈；不在主树跑。
- **Node 20**：本机 shell 默认 node18——每次跑 npm/npx/jest 前先 `node -v` 核对，若是 v18 执行 `export PATH="$(ls -d ~/.nvm/versions/node/v20* | tail -1)/bin:$PATH"`。zsh 下管道退出码用 `${pipestatus[1]}` 或不走管道。
- **jest 必须在仓库根目录跑**，且带 `DATABASE_URL`（缺则假红，判例在案）：`DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db" npx jest src/modules/governance/incidents`。
- **随手闸**（每任务收尾）：闸① `npx tsc --noEmit -p tsconfig.json`；动了 admin-web 加闸② `cd admin-web && npx tsc -b --noEmit && cd ..`；闸④ jest 相关目录全绿。
- **测试的绿必须来自行为**；禁止「扫源码文本」型断言（总纲 §7）。注册表完整性测试写**具体行断言**，不写恒真遍历。
- **派 subagent 必须带项目总纲 §0–§5 要点**；本波为高危波（改审批矩阵+权限域），**终审不降档，评审按附录 A 升档点名**。
- **铁律**：①每个持久化动作走既有审计码（11 码复用，不新增）②结案审批门不可绕③事件侧只挂引用不代办④状态只走 `INCIDENT_TRANSITIONS`⑤本波零账务⑥对外 incidentNo，快照零 UUID。
- 动了 `prisma/schema.prisma`（Task 3）→ 收尾必过重铺闸⑧：`bash scripts/stack.sh reset self` + `bash scripts/on-stack.sh self demo:all` 对照 `doc-final/demo/baseline.md` 全绿。
- 合并 main 后必做：重启后端 + `npm run db:base:sync`（RBAC 新桶不 sync = 403）。

---

### Task 1: 依据码目录定稿（两复核裁定入码）+ 即时语义位

**Files:**
- Modify: `src/modules/governance/incidents/incident.constants.ts:84-89`（INCIDENT_REPORT_BASES）
- Test: `src/modules/governance/incidents/incident.service.spec.ts`（追加 describe）

**Interfaces:**
- Produces: `INCIDENT_REPORT_BASES` 新形状 `{ label: string; hours: number | null; immediate?: true }`，新键 `PDPL_ART_9`/`TIR_II_C_24H`/`COMPANY_IV_H_1`/`COMPANY_VI_C_F`；后续任务按键引用。

**两条复核项在此裁定（spec §5，plan 首任务）：**
- 复核项②：TIR K 网安 72h 与卡单 72h 判为**同一义务合并一码**——同规章 Section K、同 72h 钟、同受文 VARA，仅触发情形不同（依据：roadmap V6 条目引 Tech K.1+I.H.1 与既有 TIR_K_H 同章；一义务一码原则业主 2026-09-25 确认）。TIR_K_H 保留键名，label 改写覆盖双触发。
- 复核项①：PDPL Art.9 在 2026-07-04/06 调研一手核记录中未载数字时限 → `hours: null`（未载时限，不杜撰）。业主如有原文新证可后翻。

- [ ] **Step 1: 写失败测试**（追加到 incident.service.spec.ts 末尾）

```ts
import { INCIDENT_REPORT_BASES } from './incident.constants';

describe('INCIDENT_REPORT_BASES catalog (wave1)', () => {
  it('carries the four new obligation codes with correct clock semantics', () => {
    expect(INCIDENT_REPORT_BASES.PDPL_ART_9.hours).toBeNull();
    expect(INCIDENT_REPORT_BASES.PDPL_ART_9.immediate).toBeUndefined();
    expect(INCIDENT_REPORT_BASES.TIR_II_C_24H.hours).toBe(24);
    expect(INCIDENT_REPORT_BASES.COMPANY_IV_H_1.immediate).toBe(true);
    expect(INCIDENT_REPORT_BASES.COMPANY_IV_H_1.hours).toBeNull();
    expect(INCIDENT_REPORT_BASES.COMPANY_VI_C_F.immediate).toBe(true);
  });
  it('TIR_K_H remains a single 72h obligation covering both cyber and stuck-order triggers', () => {
    expect(INCIDENT_REPORT_BASES.TIR_K_H.hours).toBe(72);
    expect(INCIDENT_REPORT_BASES.TIR_K_H.label).toContain('72');
  });
});
```

- [ ] **Step 2: 跑测确认失败**（`PDPL_ART_9` 不存在 → 编译错即失败形态）
- [ ] **Step 3: 实现**——替换 `INCIDENT_REPORT_BASES`：

```ts
/** 依据条款目录（spec §4/波一 §5）。一码=一项通报义务（一只钟+一个受文机构）。
 * hours=null 且无 immediate → 条款未载明时限（不杜撰）；immediate=true → 即时义务（无小时钟）。 */
export const INCIDENT_REPORT_BASES: Record<string, { label: string; hours: number | null; immediate?: true }> = {
  TIR_K_H: { label: 'TIR Rulebook Section K + H — material incident (cyber/BCDR, major stuck-transaction) reporting to VARA within 72 hours', hours: 72 },
  CRM_IV_E_5: { label: 'CRM IV.E.5 — Material Client Money discrepancy', hours: null },
  CRM_V_D_2: { label: 'CRM V.D.2 — Material Client VA discrepancy', hours: null },
  PDPL_ART_9: { label: 'PDPL (Federal Decree-Law 45/2021) Art.9 — personal data breach report to UAE Data Office (statute states no hour clock)', hours: null },
  TIR_II_C_24H: { label: 'VARA TIR Part II Section C + CRM I.1.4 — re-report to VARA within 24 hours AFTER the breach notice is issued (clock starts at first notice, not detection)', hours: 24 },
  COMPANY_IV_H_1: { label: 'Company Rulebook IV.H.1 — material outsourcing failure, notify VARA immediately', hours: null, immediate: true },
  COMPANY_VI_C_F: { label: 'Company Rulebook VI.C / VI.F — NLA prudential breach, notify VARA immediately; daily updates until VARA is satisfied (calendar duty → wave 4)', hours: null, immediate: true },
};
```

（原对象为 `as const` 字面量则改为上述显式类型标注，保持既有三键行为不变。）

- [ ] **Step 4: 跑测通过**：`DATABASE_URL=... npx jest src/modules/governance/incidents -t "INCIDENT_REPORT_BASES"` → PASS
- [ ] **Step 5: 闸① + commit** `feat(甲波一T1): 依据码目录+4·TIR_K合并双触发·即时语义位（两复核项裁定入码）`

---

### Task 2: 类型注册表 + IncidentTypes 4→10（MANUAL 移除）

**Files:**
- Create: `src/modules/governance/incidents/incident-type-registry.ts`
- Modify: `src/modules/governance/incidents/incident.constants.ts:5-11`（IncidentTypes）
- Modify: `src/modules/governance/incidents/incident.service.ts:137-147`（register 的 switch——MANUAL case 删，整段在 Task 5 换注册表，本任务只删 MANUAL 分支保编译）
- Modify: `src/modules/governance/incidents/incident-close-workflow.service.ts:30`（MANUAL 标签行删）
- Modify: `src/modules/governance/incidents/incidents.controller.spec.ts`（MANUAL 用例改为 CYBER_BCDR 或删除）
- Test: Create `src/modules/governance/incidents/incident-type-registry.spec.ts`

**Interfaces:**
- Produces（后续所有任务消费）:

```ts
export type IncidentFamily = 'FUNDS' | 'TECH_SECURITY' | 'DATA' | 'OPERATIONS' | 'FINANCIAL' | 'CUSTOMER';
export type AssessmentScheme = 'MONETARY' | 'IMPACT' | 'SHORTFALL';
export interface IncidentTypeConfig {
  family: IncidentFamily;
  label: string;
  establishedBy: string;              // 设立出处（注记级，非依据码）
  operatorGroup: PermissionGroupName; // 经办桶（Task 9 的组名，见下表）
  closeActionType: string;            // ApprovalActionTypes.* 键
  reportBasisCandidates: readonly string[]; // INCIDENT_REPORT_BASES 键，空集=不可勾通报
  requiredAnchors: readonly string[]; // 锚键：存量列名或 subjectRefs 内键
  assessmentScheme: AssessmentScheme;
  allowedRemediationKinds: readonly string[];
  enabled: boolean;
}
export const INCIDENT_TYPE_REGISTRY: Record<string, IncidentTypeConfig>;
export function getIncidentTypeConfig(type: string): IncidentTypeConfig; // 未知/停用类型抛 BadRequestException
```

- [ ] **Step 1: 失败测试**（具体行断言，非恒真遍历）：

```ts
import { INCIDENT_TYPE_REGISTRY, getIncidentTypeConfig } from './incident-type-registry';

describe('INCIDENT_TYPE_REGISTRY (spec §1 十类终盘)', () => {
  it('has exactly the 10 chartered types and MANUAL is gone', () => {
    expect(Object.keys(INCIDENT_TYPE_REGISTRY).sort()).toEqual([
      'ASSET_NONCOMPLIANCE', 'CLIENT_SHORTFALL', 'COMPLAINT_ESCALATION', 'CYBER_BCDR',
      'DATA_BREACH', 'LARGE_UNEXPLAINED', 'OUTSOURCING_FAILURE', 'PRUDENTIAL_BREACH',
      'STUCK_TRANSACTION_MAJOR', 'UNAUTHORIZED_OUTFLOW',
    ]);
  });
  it('DATA_BREACH: DPO 经办、CISO 单步结案、双码候选、影响口径', () => {
    const c = INCIDENT_TYPE_REGISTRY.DATA_BREACH;
    expect(c.operatorGroup).toBe('INCIDENT_DATA_WRITE');
    expect(c.closeActionType).toBe('INCIDENT_CLOSE_TECHSEC');
    expect([...c.reportBasisCandidates].sort()).toEqual(['PDPL_ART_9', 'TIR_II_C_24H']);
    expect(c.assessmentScheme).toBe('IMPACT');
    expect(c.allowedRemediationKinds).toEqual(['CUSTOMER_NOTICE_LOGGED']);
  });
  it('ASSET_NONCOMPLIANCE: 空码集 + 资产暂停引用白名单', () => {
    const c = INCIDENT_TYPE_REGISTRY.ASSET_NONCOMPLIANCE;
    expect(c.reportBasisCandidates).toEqual([]);
    expect(c.allowedRemediationKinds).toEqual(['ASSET_SUSPENSION_REF']);
    expect(c.closeActionType).toBe('INCIDENT_CLOSE_TECHSEC');
  });
  it('PRUDENTIAL_BREACH: CFO 经办不可自批 → 高管链', () => {
    const c = INCIDENT_TYPE_REGISTRY.PRUDENTIAL_BREACH;
    expect(c.operatorGroup).toBe('INCIDENT_FIN_WRITE');
    expect(c.closeActionType).toBe('INCIDENT_CLOSE_PRUDENTIAL');
    expect(c.assessmentScheme).toBe('SHORTFALL');
  });
  it('存量三类行为锚不变、走存量链', () => {
    expect(INCIDENT_TYPE_REGISTRY.UNAUTHORIZED_OUTFLOW.closeActionType).toBe('INCIDENT_CLOSE_SECURITY');
    expect(INCIDENT_TYPE_REGISTRY.LARGE_UNEXPLAINED.closeActionType).toBe('INCIDENT_CLOSE_FINANCIAL');
    expect(INCIDENT_TYPE_REGISTRY.STUCK_TRANSACTION_MAJOR.closeActionType).toBe('INCIDENT_CLOSE_FINANCIAL');
  });
  it('COMPLAINT_ESCALATION 停用：getIncidentTypeConfig 抛 400', () => {
    expect(INCIDENT_TYPE_REGISTRY.COMPLAINT_ESCALATION.enabled).toBe(false);
    expect(() => getIncidentTypeConfig('COMPLAINT_ESCALATION')).toThrow(/disabled/i);
    expect(() => getIncidentTypeConfig('MANUAL')).toThrow(/unknown/i);
  });
});
```

- [ ] **Step 2: 跑测失败**（模块不存在）
- [ ] **Step 3: 实现注册表**（十行全量，spec §1 表逐格照抄；节选骨架，执行者补齐全部十行——每行八格均已在 spec §1 表定死，不许自创值）：

```ts
export const INCIDENT_TYPE_REGISTRY: Record<string, IncidentTypeConfig> = {
  UNAUTHORIZED_OUTFLOW: {
    family: 'FUNDS', label: 'Unauthorized outflow', establishedBy: 'CRM IV.E.5 / V.D.2',
    operatorGroup: 'INCIDENT_WRITE', closeActionType: 'INCIDENT_CLOSE_SECURITY',
    reportBasisCandidates: ['CRM_IV_E_5', 'CRM_V_D_2'],
    requiredAnchors: [],  // 存量：现有 service 校验原样保留（Task 5），锚声明空=沿用旧校验
    assessmentScheme: 'MONETARY',
    allowedRemediationKinds: ['SUPPLEMENT', 'CLAIM', 'ADJUSTMENT', 'TRANSFER'], enabled: true,
  },
  // LARGE_UNEXPLAINED / CLIENT_SHORTFALL 同族同构（链 INCIDENT_CLOSE_FINANCIAL）……
  CYBER_BCDR: {
    family: 'TECH_SECURITY', label: 'Cyber / BCDR incident', establishedBy: 'TIR Rulebook K + H',
    operatorGroup: 'INCIDENT_TECH_WRITE', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['TIR_K_H'],
    requiredAnchors: ['affectedSystem', 'bcdrTriggered'], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: [], enabled: true,
  },
  DATA_BREACH: { family: 'DATA', label: 'Personal data breach', establishedBy: 'PDPL 45/2021 Art.9 + TIR II.C',
    operatorGroup: 'INCIDENT_DATA_WRITE', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['PDPL_ART_9', 'TIR_II_C_24H'],
    requiredAnchors: ['affectedCustomerCount', 'dataCategories'], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: ['CUSTOMER_NOTICE_LOGGED'], enabled: true,
  },
  OUTSOURCING_FAILURE: { family: 'TECH_SECURITY', label: 'Outsourcing failure', establishedBy: 'Company IV.H.1',
    operatorGroup: 'INCIDENT_TECH_WRITE', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: ['COMPANY_IV_H_1'],
    requiredAnchors: ['vendor', 'serviceImpact'], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: [], enabled: true,
  },
  ASSET_NONCOMPLIANCE: { family: 'OPERATIONS', label: 'Asset non-compliance', establishedBy: 'BD IV.E (duty = immediate suspension, not reporting)',
    operatorGroup: 'INCIDENT_OPS_WRITE', closeActionType: 'INCIDENT_CLOSE_TECHSEC',
    reportBasisCandidates: [], requiredAnchors: ['assetCode'], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: ['ASSET_SUSPENSION_REF'], enabled: true,
  },
  STUCK_TRANSACTION_MAJOR: { family: 'OPERATIONS', label: 'Major stuck transaction', establishedBy: 'TIR K.1 + I.H.1 + CRM I.E.4',
    operatorGroup: 'INCIDENT_OPS_WRITE', closeActionType: 'INCIDENT_CLOSE_FINANCIAL',
    reportBasisCandidates: ['TIR_K_H'],
    requiredAnchors: ['orderNo', 'customerNo', 'amount'], assessmentScheme: 'MONETARY',
    allowedRemediationKinds: [], enabled: true,
  },
  PRUDENTIAL_BREACH: { family: 'FINANCIAL', label: 'Prudential (NLA) breach', establishedBy: 'Company VI.C / VI.F',
    operatorGroup: 'INCIDENT_FIN_WRITE', closeActionType: 'INCIDENT_CLOSE_PRUDENTIAL',
    reportBasisCandidates: ['COMPANY_VI_C_F'],
    requiredAnchors: ['metric', 'shortfallAmount'], assessmentScheme: 'SHORTFALL',
    allowedRemediationKinds: [], enabled: true,
  },
  COMPLAINT_ESCALATION: { family: 'CUSTOMER', label: 'Complaint escalation (wave-5 placeholder)', establishedBy: 'Market Conduct III.A',
    operatorGroup: 'INCIDENT_OPS_WRITE', closeActionType: 'INCIDENT_CLOSE_FINANCIAL', // 占位值，enabled=false 使其不可达；波五改
    reportBasisCandidates: [], requiredAnchors: [], assessmentScheme: 'IMPACT',
    allowedRemediationKinds: [], enabled: false,
  },
};
export function getIncidentTypeConfig(type: string): IncidentTypeConfig {
  const c = INCIDENT_TYPE_REGISTRY[type];
  if (!c) throw new BadRequestException(`Unknown incident type: ${type}`);
  if (!c.enabled) throw new BadRequestException(`Incident type ${type} is disabled (reserved for a later wave)`);
  return c;
}
```

同步：`IncidentTypes` 常量对象换成注册表键派生（删 MANUAL，加 6 新键 + 占位键）；`incident.service.ts:146` MANUAL case 删除；`incident-close-workflow.service.ts:30` MANUAL 标签删；controller.spec 的 MANUAL 用例改用 `CYBER_BCDR`。

- [ ] **Step 4: 跑测通过 + 全目录 jest 回归**（存量三类用例必须仍绿）
- [ ] **Step 5: 闸① + commit** `feat(甲波一T2): 类型注册表十行八格·MANUAL退役（后端三处+用例）`

---

### Task 3: schema 迁移（subjectRefs / impactSummary / impactCount）

**Files:**
- Modify: `prisma/schema.prisma:1633-1668`（model Incident）
- Create: `prisma/migrations/<timestamp>_incident_wave1_taxonomy/migration.sql`（`npx prisma migrate dev --name incident_wave1_taxonomy` 生成）

**Interfaces:**
- Produces: `Incident.subjectRefs String?`（JSON 字符串，仅新类型锚用；存量列不动）、`Incident.impactSummary String?`、`Incident.impactCount Int?`；`type`/`assessmentBasis` 注释更新为十类/三口径。

- [ ] **Step 1:** schema 三列追加（注释写明：`subjectRefs` 存 JSON 串 `{"affectedSystem":"...",...}`，仿 `reportBasisCodes` 轻量存储先例；`assessmentBasis` 注释追加 `SERVICE_IMPACT | DATA_IMPACT | SHORTFALL`）
- [ ] **Step 2:** `npx prisma migrate dev --name incident_wave1_taxonomy && npx prisma generate`（数据可重铺，不写兼容——总纲 §3）
- [ ] **Step 3:** 闸① 通过（Prisma client 类型可用）
- [ ] **Step 4: Commit** `feat(甲波一T3): Incident schema +subjectRefs/impactSummary/impactCount（重铺闸⑧在收尾任务）`

---

### Task 4: AccessControlService.getUserPermissionGroups

**Files:**
- Modify: `src/modules/identity/access-control/access-control.service.ts`（`hasPermission` 在 :205，新方法加在其后）
- Test: `src/modules/identity/access-control/access-control.service.spec.ts`（追加）

**Interfaces:**
- Produces: `async getUserPermissionGroups(userId: string): Promise<string[]>` —— 复用 `getUserPermissionCodes(:171)` 同一条角色→组解析链，返回**权限组名**去重数组（如 `['INCIDENT_TECH_WRITE', ...]`）。Task 5 消费。

- [ ] **Step 1: 失败测试**（仿本文件既有 spec 的 mock 风格；行为断言：给用户绑含 INCIDENT_TECH_WRITE 的角色 → 返回数组含该组名；无角色 → 空数组）
- [ ] **Step 2: 跑测失败** → **Step 3: 实现**（沿 getUserPermissionCodes 的角色解析中段返回组名，不重复查询逻辑，提取共享私有方法如需要）→ **Step 4: 跑测通过（含该文件全量回归）** → **Step 5: 闸① + commit** `feat(甲波一T4): AccessControlService.getUserPermissionGroups（组级查询，供按族经办断言）`

---

### Task 5: 登记改造——注册表校验 + 经办桶断言

**Files:**
- Modify: `src/modules/governance/incidents/incident.constants.ts:57-72`（RegisterIncidentDto 追加 `subjectRefs?: Record<string, string | number | boolean>`）
- Modify: `src/modules/governance/incidents/incident.service.ts:134-`（register）
- Modify: `src/modules/governance/incidents/incidents.controller.ts:47-49` 与 Task 9 呼应（路由权限数组扩为五桶 OR，本任务先改 service，路由数组在 Task 9 一并）
- Test: `incident.service.spec.ts`

**Interfaces:**
- Consumes: `getIncidentTypeConfig`（T2）、`getUserPermissionGroups`（T4）、`Incident.subjectRefs`（T3）。
- Produces: register 行为合同——①未知/停用类型 400；②新类型缺必填锚键 400（报缺哪个键）；③actor 不持该类型 `operatorGroup` → ForbiddenException（**服务层断言**，路由层五桶 OR 只做粗门）；④存量三类走原有 switch 校验分支**原样保留**（行为回归）；⑤新类型锚存入 `subjectRefs`（JSON.stringify）。经办断言同样加在 investigation/notes/escalate/assess/remediations/close/withdraw 各入口共用的私有方法 `assertOperator(type, actor)`。

- [ ] **Step 1: 失败测试**（四条行为用例）：

```ts
it('rejects DATA_BREACH registration missing affectedCustomerCount', async () => {
  await expect(service.register({ type: 'DATA_BREACH', title: 't', description: 'd',
    subjectRefs: { dataCategories: 'ID_DOCUMENT' } } as any, dpoActor))
    .rejects.toThrow(/affectedCustomerCount/);
});
it('rejects registration when actor lacks the family operator group', async () => {
  accessControl.getUserPermissionGroups.mockResolvedValue(['INCIDENT_WRITE']); // 金库
  await expect(service.register(validCyberDto, treasuryActor)).rejects.toThrow(ForbiddenException);
});
it('registers CYBER_BCDR with anchors persisted into subjectRefs', async () => { /* mock create 捕获 data.subjectRefs 含 affectedSystem */ });
it('MANUAL and COMPLAINT_ESCALATION are rejected', async () => { /* 400 */ });
```

- [ ] **Step 2: 跑测失败** → **Step 3: 实现**（register 头部：`const cfg = getIncidentTypeConfig(dto.type); await this.assertOperator(cfg, actor);` 新类型走 `for (const k of cfg.requiredAnchors) if (dto.subjectRefs?.[k] == null || dto.subjectRefs[k] === '') throw new BadRequestException(...)`; 存量三类保留原 switch 分支）→ **Step 4: 全目录 jest 回归绿（存量用例给 mock 补 `getUserPermissionGroups` 返回 `['INCIDENT_WRITE']`）** → **Step 5: 闸① + commit** `feat(甲波一T5): 登记按注册表校验锚键+服务层经办桶断言（存量行为回归不变）`

---

### Task 6: 定损改造——口径集 / 码候选 / 即时钟

**Files:**
- Modify: `incident.constants.ts:91-96`（AssessIncidentDto）
- Modify: `incident.service.ts:275-`（assess）
- Test: `incident.service.spec.ts`

**Interfaces:**
- Produces: `AssessIncidentDto` 新形状：

```ts
export interface AssessIncidentDto {
  assessmentBasis: 'RECOVERED' | 'FIRM_LOSS' | 'CLIENT_COLLECTION' | 'NO_LOSS'   // MONETARY
                 | 'SERVICE_IMPACT' | 'DATA_IMPACT'                              // IMPACT
                 | 'SHORTFALL';                                                  // SHORTFALL
  assessedAmount?: string;   // MONETARY/SHORTFALL 必填；IMPACT 可选
  impactSummary?: string;    // IMPACT 必填
  impactCount?: number;      // 可选（如波及客户数）
  reportRequired: boolean;
  reportBasisCodes?: string[];
}
```

行为合同：①口径必须属于该类型 `assessmentScheme` 的合法集（映射常量 `ASSESSMENT_BASIS_BY_SCHEME` 放 registry 文件）；②`reportBasisCodes ⊆ cfg.reportBasisCandidates`，越界 400（含空集类型勾任何码即 400）；③deadline 计算沿既有逻辑（assess 已返回 `reportDeadlineAt`）：取所勾码中**最小 hours**算目标时刻；全为 null/immediate → `reportDeadlineAt = null`（immediate 不造钟）；④IMPACT 缺 impactSummary 400，MONETARY/SHORTFALL 缺 assessedAmount 400。

- [ ] **Step 1: 失败测试**（五条：ASSET_NONCOMPLIANCE 勾 TIR_K_H → 400；DATA_BREACH 勾双码 → deadline=null（PDPL null + 24h？——注意 24h 钟链起点是通知发出非定损时刻，**波一不落 24h 目标时刻**，deadline 只按"从定损起算的数字钟"码计算，TIR_II_C_24H 标记 `chainStart: 'NOTICE'` 排除出 deadline 计算——把该字段加进目录条目并断言）；CYBER_BCDR 勾 TIR_K_H → deadline≈now+72h；PRUDENTIAL_BREACH 缺 assessedAmount → 400；存量 UNAUTHORIZED_OUTFLOW 旧口径回归绿）
- [ ] **Step 2: 失败** → **Step 3: 实现**（目录条目补可选 `chainStart?: 'NOTICE'` 于 TIR_II_C_24H；assess 头部取 cfg 校验四条合同）→ **Step 4: 通过+回归** → **Step 5: 闸① + commit** `feat(甲波一T6): 定损三口径按类型约束·码候选集过滤·钟链码不入定损deadline`

---

### Task 7: 处置白名单 +2

**Files:**
- Modify: `incident.constants.ts:48-54`（IncidentRemediationKinds + `ASSET_SUSPENSION_REF`、`CUSTOMER_NOTICE_LOGGED`）
- Modify: `incident.service.ts:361-`（linkRemediation 头部加 `if (!cfg.allowedRemediationKinds.includes(dto.kind)) throw new BadRequestException(...)`）
- Test: `incident.service.spec.ts`

行为合同：资金族四钱单照旧；`ASSET_SUSPENSION_REF.referenceNo` = 既有资产暂停审批单号（只登记引用，不校验其存在——事件侧不代办不越域查询，铁律③；说明写入 kind 注释）；`CUSTOMER_NOTICE_LOGGED.referenceNo` = 自由留痕串（如 `NOTICE-2026-09-25`），审计走既有 `INCIDENT_REMEDIATION_LINKED` 码（metadata 带 kind，不新增审计码）。

- [ ] **Step 1: 失败测试**（三条：CYBER_BCDR 挂 SUPPLEMENT → 400；ASSET_NONCOMPLIANCE 挂 ASSET_SUSPENSION_REF → 通过且审计调用带 kind；存量 UNAUTHORIZED_OUTFLOW 挂 TRANSFER 回归绿）→ **Step 2-4: 红→实现→绿** → **Step 5: 闸① + commit** `feat(甲波一T7): 处置动作白名单+2（资产暂停引用/客户通知留痕）`

---

### Task 8: 结案四链——两条新链 + close-workflow 注册表化

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts:69`（枚举区追加 `INCIDENT_CLOSE_TECHSEC`、`INCIDENT_CLOSE_PRUDENTIAL`）；`:370` 配置区追加：

```ts
  [ApprovalActionTypes.INCIDENT_CLOSE_TECHSEC]: {
    steps: [{ stepNo: 1, roles: ['CISO'] }], timeoutHours: 48, allowCancel: true,
  },
  [ApprovalActionTypes.INCIDENT_CLOSE_PRUDENTIAL]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48, allowCancel: true,
  },
```

- Modify: `src/modules/governance/incidents/incident-approval.service.ts`（仿既有两类各加 handler：`IncidentCloseTechsecApprovalService` / `IncidentClosePrudentialApprovalService`，`workflowType = AuditBusinessWorkflowTypes.INCIDENT`）
- Modify: `src/modules/governance/incidents/incidents.module.ts`（providers 注册两个新 handler——仿既有两个的注册位）
- Modify: `src/modules/governance/incidents/incident-close-workflow.service.ts:71-73`（三元退役）：

```ts
    const actionType = getIncidentTypeConfig(row.type).closeActionType;
```

- Test: `incident-close-workflow.service.spec.ts`

- [ ] **Step 1: 失败测试**（链错配探针——变异测试点①的常驻化）：

```ts
it.each([
  ['CYBER_BCDR', 'INCIDENT_CLOSE_TECHSEC'],
  ['DATA_BREACH', 'INCIDENT_CLOSE_TECHSEC'],
  ['OUTSOURCING_FAILURE', 'INCIDENT_CLOSE_TECHSEC'],
  ['ASSET_NONCOMPLIANCE', 'INCIDENT_CLOSE_TECHSEC'],
  ['STUCK_TRANSACTION_MAJOR', 'INCIDENT_CLOSE_FINANCIAL'],
  ['PRUDENTIAL_BREACH', 'INCIDENT_CLOSE_PRUDENTIAL'],
  ['UNAUTHORIZED_OUTFLOW', 'INCIDENT_CLOSE_SECURITY'],
])('%s requests closure via %s', async (type, expected) => {
  /* 造 row(type, ASSESSED, reportRequired=false)，断言 approvals.createAndSubmit 收到 actionType===expected */
});
```

- [ ] **Step 2-4: 红→实现→绿**（含既有"未标记已通报不许结案"守卫回归）
- [ ] **Step 5: MAKER_GROUP_BY_POLICY 扩表**（delivery-checklist 硬条款——S5 自批死锁闸只遍历这张人工表，表外策略不受保护）：`scripts/verify-rbac.ts:243` 该表形状为 `Record<string, string>`（一策略一 maker 组，既有 `INCIDENT_CLOSE_SECURITY: 'INCIDENT_WRITE'` 在 :266）。`INCIDENT_CLOSE_PRUDENTIAL: 'INCIDENT_FIN_WRITE'` 直接加一行；`INCIDENT_CLOSE_TECHSEC` 的 maker 横跨三个经办组（技安/数据/运营），单串装不下——**把该表值类型放宽为 `string | string[]`，消费处（S5 遍历逻辑，约 :266 后）对数组逐组做同一校验**（改动最小、语义不变），然后 `INCIDENT_CLOSE_TECHSEC: ['INCIDENT_TECH_WRITE','INCIDENT_DATA_WRITE','INCIDENT_OPS_WRITE']`。跑 S5 确认：CISO 不持三个经办桶、SMO 不持财务经办桶（按 T9 绑定本应天然成立，S5 红了说明绑定错）；**先注掉一行绑定证明 S5 会红再恢复**（报绿先证红）
- [ ] **Step 6: 闸① + commit** `feat(甲波一T8): 结案四链——CISO单步/高管单步入审批常量+handler·三元退役为注册表查链·MAKER表两行`

---

### Task 9: RBAC——四新桶、路由、绑定、verify:rbac

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`：
  - `:78-79` PermissionGroup 联合类型追加 `'INCIDENT_TECH_WRITE' | 'INCIDENT_DATA_WRITE' | 'INCIDENT_OPS_WRITE' | 'INCIDENT_FIN_WRITE'`
  - `:441-452` 全部 12 条 incidents 路由的组数组从 `['INCIDENT_WRITE']` 改为 `['INCIDENT_WRITE','INCIDENT_TECH_WRITE','INCIDENT_DATA_WRITE','INCIDENT_OPS_WRITE','INCIDENT_FIN_WRITE']`（GET 两条在既有基础上加四组）——粗门放行、服务层细分（T5）
  - `:907-908` 桶目录：`incidents.manage` label 收窄为 "Register & manage funds-family incidents"；新增四桶条目（key 如 `incidents.manage-tech`，groups 各一新组，description 按族写明覆盖类型）
  - 角色绑定区（`:963` 起的各职务数组）：TECH_OFFICER + `INCIDENT_TECH_WRITE`；DPO + `INCIDENT_DATA_WRITE`；OPS_OFFICER + `INCIDENT_OPS_WRITE`；CFO + `INCIDENT_FIN_WRITE`（各职务现有 INCIDENT_READ 保留）
- Modify: `scripts/verify-rbac.ts`：行为探针追加（正向：技术官 POST /admin/incidents 注册 CYBER_BCDR 200；反向：金库注册 CYBER_BCDR 403、技术官注册 UNAUTHORIZED_OUTFLOW 403——探针打真端点，沿既有 47 探针写法）
- Test: 既有 verify:rbac 机制即闸

- [ ] **Step 1:** catalog 四处改齐 → 闸① 过
- [ ] **Step 2:** worktree 栈起 + `npm run db:base:sync` + 重启后端（新组不 sync 必 403——判例）
- [ ] **Step 3:** verify:rbac 探针扩写 → `bash scripts/on-stack.sh self verify:rbac`（或该脚本在本仓的注册跑法，以 package.json 为准）全绿；**故意注掉一条绑定跑一次确认探针会红**（报绿前先证明会红），恢复
- [ ] **Step 4: Commit** `feat(甲波一T9): Incident域2→6桶·路由五桶OR·四职务新绑定·verify:rbac正反探针（62→66）`

---

### Task 10: 前端——登记/定损/详情按注册表渲染

**Files:**
- Modify: `admin-web/src/pages/IncidentListPage.tsx`（登记入口所在页——类型下拉、动态锚字段）
- Modify: `admin-web/src/pages/IncidentDetailPage.tsx`（定损表单、依据码勾选、钟三态、处置挂载、锚展示）
- Modify: `admin-web/src/utils/incidentStatusMap.ts`（类型标签词表：+7 新类型英文标签，−MANUAL）

**行为合同（每条都要截图验证）：**
1. 类型下拉 = 注册表 enabled 类型（无 MANUAL、无投诉占位）；选中类型 → 动态渲染该类型 `requiredAnchors` 输入项（affectedSystem 文本 / bcdrTriggered 勾选 / dataCategories 多选：ID_DOCUMENT·CONTACT·TRANSACTION_HISTORY·COMPLIANCE_FILE·CREDENTIALS / vendor 下拉：SUMSUB·HEXTRUST·BANKING_PARTNER·OTHER / orderNo·metric·shortfallAmount 文本）——枚举成员就按本行清单写死词表。
2. 定损表单：口径下拉按类型口径集过滤；金额/影响摘要按口径条件必填；依据码复选框只列该类型候选集，每码右侧钟徽章三态文案：`Report within {h}h` ／ `Immediate obligation (no hour clock)` ／ `No statutory deadline stated`；TIR_II_C_24H 徽章加注 `clock starts at first notice`。
3. 详情页：subjectRefs 键值区块渲染（新类型）；处置区挂载动作按白名单过滤下拉。
4. 全站禁 UUID 暴露（铁律⑥回归：新增区块只显示业务号/枚举/文本）。

- [ ] **Step 1:** 三文件实现 → 闸②
- [ ] **Step 2:** worktree 栈起，浏览器实走：登记 DATA_BREACH（双码勾选+双钟徽章）与 STUCK_TRANSACTION_MAJOR（TIR_K 72h 徽章）各一条 → **截图落盘**（路径写进任务产物：`doc-final/superpowers/checkups/2026-09-XX-act-a-wave1-evidence/` 下按页命名）
- [ ] **Step 3: Commit** `feat(甲波一T10): 登记/定损/详情按注册表动态渲染·钟三态徽章·MANUAL出词表`

---

### Task 11: 种子样例 + 文档同步 + 收尾闸

**Files:**
- Modify: `prisma/seed.business.ts`（新增 `seedIncidents()`：四条样例——DATA_BREACH@ASSESSED（已勾双码未通报）、OUTSOURCING_FAILURE@INVESTIGATING、ASSET_NONCOMPLIANCE@RESOLVING（挂 ASSET_SUSPENSION_REF）、STUCK_TRANSACTION_MAJOR@REGISTERED；locate 既有 seed 函数注册位照挂；种子数据 = 初始态铺设，现场登记一条 CYBER_BCDR 留给剧本演"留痕"）
- Modify: `doc-final/demo/data.md`（事件区块同步四条样例）
- Modify: `doc-final/modules/v8-recon.md` 事故登记节 + `doc-final/modules/overview.md` §4（66 桶、三职务新经办位）——truth 同步
- Append: `doc-final/PRODUCTION-NOTES.md` 一行（事件分类不全兜底登记，生产再议）

**收尾闸（对照 `doc-final/rules/delivery-checklist.md`）：**
- [ ] **Step 1:** seed + data.md → 重铺闸⑧：`bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all` 对照 baseline 全绿（旧库直跑必红判例——先 reset）
- [ ] **Step 2:** 九个启用类型全生命周期实走（登记→调查→定损→处置→结案审批→关单），每类审计事件链抽查（fromStatus/toStatus）
- [ ] **Step 3:** MANUAL 零残留：`grep -rn "IncidentTypes.MANUAL" src admin-web/src` 零命中 + `grep -rn "'MANUAL'" src/modules/governance/incidents admin-web/src/pages/Incident* admin-web/src/utils/incidentStatusMap.ts` 零命中（范围限定防同名字面量误伤客户限制/对账触发的 MANUAL）
- [ ] **Step 4:** 变异实证三点（改注册表链指向→T8 探针红；注掉一条 RBAC 绑定→verify:rbac 红；registry 删一锚键→T5 用例红），恢复后全绿留痕
- [ ] **Step 5:** **script.md 核对**：`grep -n -i "incident\|事故" doc-final/demo/script.md`——既有事故步骤（平账三期场景系）必须仍可走；若步骤文案引用 MANUAL 或旧四类口径则同步修；**不加新幕**（波五编排）
- [ ] **Step 6:** 收尾三件套：`CHANGELOG.md` 一行（合并时）；`BACKLOG.md` 扫事故相关行销账/改锚；轮末按 CLAUDE.md §9 报告 `Documentation updated: modules§0-4 / demo — <一句话>`
- [ ] **Step 7:** 闸①②④ + jest 全量基线数记录 → Commit `chore(甲波一T11): 种子四样例·truth同步(66桶/三新经办位)·PRODUCTION-NOTES一行·收尾三件套·四闸物证`
- [ ] **Step 8:** 按 delivery-checklist 写**波二承接记录**进波二骨架（通报单槽→工单交接、PRUDENTIAL 联动、V8 通报收编岔口②）；只写承接不展开波二 spec

---

## Self-Review（已执行）

- **Spec 覆盖**：§1 十类→T2；§2 注册表/MANUAL→T2；§3 权限→T4/T5/T9；§4 四链→T8；§5 码目录+复核②①→T1、钟链排除→T6；§6 锚定损→T3/T5/T6；§7 白名单→T7；§8 场景→T11 种子+T10 实走（⚡ 新端点确认不需要：登记本身是一等管理动作）；§9 验收→T9/T11；§10 交接→T11 Step 6。无缺口。
- **占位扫描**：注册表骨架标明"执行者按 spec §1 表补齐全部十行、不许自创值"——表格即完整值源，非 TBD。
- **类型一致性**：`INCIDENT_CLOSE_TECHSEC`/`INCIDENT_CLOSE_PRUDENTIAL`/`INCIDENT_TECH_WRITE` 等命名在 T2 测试、T8 常量、T9 目录三处一致；`getUserPermissionGroups` T4 定义 T5 消费；`chainStart` T6 引入并在 T6 内消费。
