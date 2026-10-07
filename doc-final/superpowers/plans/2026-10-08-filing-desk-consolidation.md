# 报送台整备波 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 报送台类型两层化（来源六桶+材料层选择面+依据码材料语义改名）、RI 换人自动开告知单、审计 metadata 对称修、剧本/HRCA 口径订正，一波落地并销 BACKLOG 六条。

**Architecture:** 一切类型差异收敛进 `filing-type-registry.ts`（加 `origin` 列）与 `INCIDENT_REPORT_BASES`（键改名+`statuteRef` 拆分）；员工可见第二层=材料（码表/义务行/枚举三形态），`INCIDENT_REPORT`/`PERIODIC_RETURN` 退居幕后路由键；RI 开单复用 `RegulatoryFilingService` 既有开单方法成为第四条自动来路。零 schema、零新边、零新审批、零新权限。

**Tech Stack:** NestJS + Prisma（后端）｜ React + Vite（admin-web）｜ jest（后端；前端无单测基建，闸=tsc+截图）

**Spec:** `doc-final/superpowers/specs/2026-10-08-filing-desk-consolidation-design.md`（执行者必读；§2.1 表的"员工可见第二层"列是本波的灵魂）

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用
- 本轮特有：**零 schema 迁移**；码与类型改名**禁止留旧名别名/兼容映射**（照 `FILING_TRANSITIONS` 别名物理删除先例），存量 DB 行靠重铺作废；旧键全仓 grep 零残留（排除 `archive/` 与本波 spec/plan）是判据也是失效验证；员工可见选择面**只出现材料层**，`INCIDENT_REPORT`/`PERIODIC_RETURN` 两枚举不得出现在任何下拉/组名；周期组选义务行**仅预填**（标题/机构），不新增后端字段
- 施工在 worktree（分支 `filing-desk-consolidation`，目录下划线），闸门跑自己栈（self）；commit 中文 scope、不加署名行
- **收尾过哪几条**（checklist 命中行，plan 写死）：改了前端→**preview 截图**（永不豁免①）；**改了种子**（码串字面）→ 重铺闸⑧ `reset`+`demo:all` 必跑 + `script.md` 多处同步（`data.md` 生成区由 demo:all 自写不手改）；持久写变化→B 项复用既有 `FILING_OPENED` 审计（SYSTEM 源）、C 项本身即审计修；每轮收尾→CHANGELOG 一行 + BACKLOG 销 :264/:340/:508/:509/:510/:511 + §9 报告。未触发：动钱(verify:coa)/新审计码/新状态边/新审批策略/新权限组/新端点/新事件/客户面/schema

---

### Task 1: 后端注册表——`origin` 列 + 类型改名 + HRCA 订正

**Files:**
- Modify: `src/modules/governance/regulatory-filings/filing-type-registry.ts`
- Modify: 全仓 `REG_INFO_REQUEST_RESPONSE` 字面引用（首步 grep 清点：预期在 `prisma/seed.business.ts` 入站种子、`test/regulatory-filing.e2e-spec.ts`、本模块 spec、`admin-web` 留给 Task 4）
- Test: `src/modules/governance/regulatory-filings/*.spec.ts`

**Interfaces:**
- Produces: `FilingTypeConfig.origin: FilingOrigin`；`FilingOrigin` 六值联合类型 `'INCIDENT'|'PERIODIC_OBLIGATION'|'REGULATOR_REQUEST'|'SANCTIONS_HIT'|'AML_MONITORING'|'SELF_DISCLOSURE'`（Task 4 前端镜像照抄）；类型键 `INFO_REQUEST_RESPONSE`

- [ ] **Step 1: 全量清点**：`grep -rn "REG_INFO_REQUEST_RESPONSE" src test prisma scripts doc-final --include="*.ts" --include="*.md" | grep -v archive`，清单记入报告
- [ ] **Step 2: 写失败测试**（registry spec 追加）：

```ts
it('每个类型恰有一个 origin 且取值在六值集内', () => {
  const ORIGINS = ['INCIDENT','PERIODIC_OBLIGATION','REGULATOR_REQUEST','SANCTIONS_HIT','AML_MONITORING','SELF_DISCLOSURE'];
  for (const cfg of Object.values(FILING_TYPE_REGISTRY)) expect(ORIGINS).toContain(cfg.origin);
});
it('origin→类型分组与 spec §2.1 一致（关键三组钉死）', () => {
  expect(FILING_TYPE_REGISTRY.INCIDENT_REPORT.origin).toBe('INCIDENT');
  expect(FILING_TYPE_REGISTRY.PERIODIC_RETURN.origin).toBe('PERIODIC_OBLIGATION');
  expect(FILING_TYPE_REGISTRY.INFO_REQUEST_RESPONSE.origin).toBe('REGULATOR_REQUEST');
  for (const t of ['STR','SAR','HRC','HRCA']) expect(FILING_TYPE_REGISTRY[t].origin).toBe('AML_MONITORING');
});
```

（registry 常量导出名以实勘为准——若当前为 `getFilingTypeConfig` 内部 Record，测试用该 Record 的既有导出；无导出则补具名导出，不改行为。）
- [ ] **Step 3: 跑测确认红**（字段不存在 TS 报错即红）
- [ ] **Step 4: 实现**——`FilingOrigin` 联合类型 + 接口加 `origin` + 十二行字面值（照 spec §2.1）+ 注册表头注释写死来源定义原话：「来源=法定触发事由，非操作路径——自动/手工是开单方式，与来源正交」+ 键 `REG_INFO_REQUEST_RESPONSE`→`INFO_REQUEST_RESPONSE`（label 改 "Information request response"）+ HRCA 行：label 全称 "HRCA — High Risk Country Activity Report"、备注从"交易属性不全时的替代报文"改为"活动型（非交易）——与 HRC 的交易型二分，官方定义见 UAE FIU goAML Web Submission Guide v2.2 p5；3 工作日不反对窗同 HRC"
- [ ] **Step 5: 按 Step 1 清单逐处改旧类型键字面**（种子入站样例、e2e、spec——测试断言随契约更新，不放宽）
- [ ] **Step 6: 跑 `npx jest src/modules/governance/regulatory-filings --silent` 绿 + 后端 tsc 绿**
- [ ] **Step 7: Commit** `feat(报送台): 注册表加 origin 六桶列+INFO_REQUEST_RESPONSE 改名+HRCA 官方口径订正`

---

### Task 2: 后端依据码七个改名 + `statuteRef` 拆分

**Files:**
- Modify: `src/modules/governance/incidents/incident.constants.ts`（`INCIDENT_REPORT_BASES` 键改名；值结构 `label` 拆 `label`+`statuteRef`）
- Modify: `src/modules/governance/incidents/incident-type-registry.ts`（`reportBasisCandidates` 七处字面）
- Modify: `prisma/seed.business.ts`（`reportBasisCodes` 字面串，如 `'PDPL_ART_9,TIR_II_C_24H'`）
- Modify: 服务/测试/e2e 中旧码字面（首步 grep 清点）
- Test: incidents 与 regulatory-filings 两目录既有 spec 随字面更新

**Interfaces:**
- Produces: 七新键（`MAJOR_INCIDENT_72H`/`CLIENT_MONEY_DISCREPANCY`/`CLIENT_VA_DISCREPANCY`/`DATA_BREACH_REPORT`/`DATA_BREACH_RE_REPORT_24H`/`OUTSOURCING_FAILURE_NOTICE`/`PRUDENTIAL_BREACH_NOTICE`）；`INCIDENT_REPORT_BASES[k].statuteRef: string`（法条原文，Task 4 副标签用）

- [ ] **Step 1: 全量清点**：`grep -rnE "TIR_K_H|CRM_IV_E_5|CRM_V_D_2|PDPL_ART_9|TIR_II_C_24H|COMPANY_IV_H_1|COMPANY_VI_C_F" src test prisma scripts admin-web/src doc-final --include="*.ts*" --include="*.md" | grep -v archive`，分"本任务改/Task 4 改/Task 5 改"三栏记入报告
- [ ] **Step 2: 写失败测试**：

```ts
it('依据码新键集与 statuteRef 齐全，旧键不存在', () => {
  const NEW = ['MAJOR_INCIDENT_72H','CLIENT_MONEY_DISCREPANCY','CLIENT_VA_DISCREPANCY','DATA_BREACH_REPORT','DATA_BREACH_RE_REPORT_24H','OUTSOURCING_FAILURE_NOTICE','PRUDENTIAL_BREACH_NOTICE'];
  expect(Object.keys(INCIDENT_REPORT_BASES).sort()).toEqual([...NEW].sort());
  for (const k of NEW) expect(INCIDENT_REPORT_BASES[k].statuteRef).toBeTruthy();
});
```

- [ ] **Step 3: 红 → 实现**——键改名；每行 `label`=材料名（照 spec §2.3 界面词）、`statuteRef`=原法条引述（如 `'TIR Rulebook Section K + H'`、`'CRM IV.E.5'`）；钟/机构/chainStart 配置原样随行
- [ ] **Step 4: 按清单改后端侧全部旧码字面**（candidates、种子串、服务内 `'TIR_II_C_24H'` 类钟链字面若有、测试断言）
- [ ] **Step 5: `npx jest src/modules/governance --silent` 全绿 + 后端 tsc 绿**；跑一次失效验证：把任一 candidates 改回旧键 → registry/一致性测试应红，还原
- [ ] **Step 6: Commit** `feat(报送台): 依据码七个改为材料语义键+statuteRef 法条副标签拆分`

---

### Task 3: 后端 RI 自动开单 + 审计 metadata 三键镜像

**Files:**
- Modify: `src/modules/governance/compliance-office/ri-replacement-workflow.service.ts`
- Modify: `src/modules/governance/regulatory-filings/regulatory-filing.service.ts`（C 项两处 recordAudit + 若 B 项需开单入口微调）
- Test: `ri-replacement-workflow.service.spec.ts`（或邻位既有 spec）、`regulatory-filing.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `INFO_REQUEST_RESPONSE` 改名不影响本任务（`MATERIAL_CHANGE_NOTIFICATION` 未改）
- Produces: RI 批准落地 → `MATERIAL_CHANGE_NOTIFICATION` DRAFT 单（`createdByUserId='SYSTEM'`，标题 `Responsible Individual change — <position>: <from> → <to>`，审计 metadata 带 `riNo`/`approvalNo`）

- [ ] **Step 1: 写失败测试**（B 项两条 + C 项三条）：

```ts
it('RI 换人批准落地后自动开重大变更告知单（SYSTEM 源，标题携席位与新旧任）', async () => {
  // 照本文件既有 onDecided 批准用例的 mock 样板，断言 filingService 开单方法被调用，
  // 入参 type='MATERIAL_CHANGE_NOTIFICATION'、title 含 position/fromIncumbent/toIncumbent
});
it('RI 换人被驳回不开单', async () => { /* 驳回路径断言开单方法零调用 */ });
// C 项（regulatory-filing.service.spec.ts）：
it('FILING_SUBMITTED 审计 metadata 携 externalRef', ...);
it('FILING_ENTRY_LOGGED 审计 metadata 携 kind', ...);
it('FILING_OVERDUE_MARKED 审计 metadata 携 deadlineAt', ...);  // sweep spec 若单列则落那边
```

- [ ] **Step 2: 红 → 实现**——B：`applyReplacement` 落地后调开单（新增 `openForRiChange()` 薄方法或复用 `openManual` 形参皆可，取窄者；失败不回滚换人，注释照实写明非原子、引 PRODUCTION-NOTES 同类先例）；C：三处 `recordAudit` 的 metadata 增键（extra 校验形态保留，R5 修法）
- [ ] **Step 3: `npx jest src/modules/governance --silent` 全绿**
- [ ] **Step 4: Commit** `feat(报送台): RI 换人批准自动开重大变更告知单+审计 metadata 三键对称修`

---

### Task 4: 前端——镜像 + 弹窗材料层 optgroup + 列表筛选与下钻

**Files:**
- Modify: `admin-web/src/utils/incidentStatusMap.ts`（码表镜像换新键+statuteRef）
- Modify: `admin-web/src/pages/RegulatoryFilingListPage.tsx`（弹窗重构+筛选+下钻）
- Modify: `admin-web/src/pages/IncidentDetailPage.tsx`（码前缀/Basis 列随新键新 label——显示形态 `<材料名> — <statuteRef>`）
- 若报送台类型词表另有文件（实勘），同步

**Interfaces:**
- Consumes: Task 1 `origin` 六值与分组、Task 2 新码键+statuteRef；既有 `GET /admin/compliance-obligations`（义务行动态选项，五职务读权已覆盖合规官/MLRO）
- Produces: 无（终端）

- [ ] **Step 1: 镜像更新**（origin 分组常量、码表新键、HRCA 全称、`INFO_REQUEST_RESPONSE`）
- [ ] **Step 2: 弹窗重构**——optgroup 六组，组内选项=材料层：

```tsx
// INCIDENT 组：七个材料（value 编码为 `INCIDENT_REPORT::<basisCode>`，选中拆解为 type+basisCode 预选；
//   表单仍必填事故号；已填事故号时材料列表按该事故类型 candidates 过滤）
// PERIODIC_OBLIGATION 组：挂载时 fetch ACTIVE 义务行，选项=义务名（value `PERIODIC_RETURN::<obligationNo>`，
//   选中预填 title=`${义务名} — make-up filing` 与 authority；payload 不带 obligationNo——仅预填，spec §2.4）
// REGULATOR_REQUEST 组：单项 Information request response
// 其余组：类型即材料，照 §2.1
// 守卫：员工可见文案中不得出现 INCIDENT_REPORT / PERIODIC_RETURN 字样（Global Constraints）
```

- [ ] **Step 3: 列表**——来源筛选下拉（六值+All）；Type 列下钻（事故行读 basisCode 新 label+钟、周期行读标题期别、其余界面词）
- [ ] **Step 4: 码前缀显示随新名**——IncidentDetailPage 定损复选项与 Filings 卡 Basis 列：`<材料名> — <statuteRef>`（替换原 `code — 法条全文` 形态）
- [ ] **Step 5: `cd admin-web && npx tsc -b --noEmit` 零错**
- [ ] **Step 6: Commit** `feat(报送台): 弹窗材料层六组+列表来源筛选与类型下钻+码表新名接线`

---

### Task 5: 文档同步与销账

**Files:**
- Modify: `doc-final/modules/v9-regulatory-filing.md`（类型表加来源列/码表新名/HRCA §2 表行与 §4.2 叙述/两层树一节）
- Modify: `doc-final/modules/v1-governance.md` §7（依据码表新名+statuteRef 说明）
- Modify: `doc-final/modules/v8-recon.md`（:100 孪生句 TIR→CRM 材料名）
- Modify: `doc-final/demo/script.md`（场景 18 订正；场景 22 补一句"批准落地后报送台自动开出重大变更告知单"；场景 24⑥/25③ 码前缀引文随新名二次订正；其余出现旧码名处按 Task 2 清单扫）
- Modify: `doc-final/CHANGELOG.md`（一行业务口径）、`doc-final/BACKLOG.md`（按标题销 :264/:340/:508/:509/:510/:511 六条，:340 销账行注明证据=goAML 手册 v2.2 p2/p3/p5）

- [ ] **Step 1: 逐文件改**（码名以 Task 2 清单"Task 5 改"栏为准）
- [ ] **Step 2: Commit** `docs(报送台): 两层化/改名/HRCA 全量文档同步+BACKLOG 销六条`

---

### Task 6: 收尾闸——重铺+行为证据+截图

**Files:**
- Create: `doc-final/superpowers/checkups/2026-10-08-filing-desk-evidence/`（截图+gate-evidence.md）

- [ ] **Step 1: 随手闸**：三栈 tsc 零错
- [ ] **Step 2: `npx jest src/modules/governance --silent` 全绿**（基线：incidents 192+filings+complaints 各套）
- [ ] **Step 3: 旧名零残留失效验证**：`grep -rnE "REG_INFO_REQUEST_RESPONSE|TIR_K_H|CRM_IV_E_5|CRM_V_D_2|PDPL_ART_9|TIR_II_C_24H|COMPANY_IV_H_1|COMPANY_VI_C_F" src test prisma scripts admin-web/src client-web/src doc-final --include="*.ts*" --include="*.md" | grep -v archive | grep -v "2026-10-08-filing-desk"`——期待零行，结果原样入 gate-evidence
- [ ] **Step 4: 重铺闸⑧**：`bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all`——花名册全符+asserts 全 PASS（种子码串已改，这是本波最重的回归证据）
- [ ] **Step 5: 行为证据**（curl，superadmin）：①RI 换人提单→高管批准→`GET /admin/regulatory-filings` 出现 `MATERIAL_CHANGE_NOTIFICATION` SYSTEM 新单（标题携席位与新旧任）；②驳回路径不开单；③事故定损勾新码→开单 basisCode=新键+列表下钻显示材料名
- [ ] **Step 6: 截图清单**（demo-shot，存证据目录）：01 弹窗 optgroup 六组全景｜02 INCIDENT 组七材料展开｜03 PERIODIC 组义务行动态选项｜04 列表来源筛选生效｜05 Type 列下钻两形态（事故/周期同屏最佳）｜06 RI 换人后报送台自动新单｜07 HRCA 界面词全称｜08 定损依据码新显示形态（材料名—法条）｜09 场景 22 补句对应画面
- [ ] **Step 7: 剧本回归**：场景 18/21/22/24⑥/25③ 逐句核（22 含新补句、25③ 引文已随新名）
- [ ] **Step 8: gate-evidence.md 汇总 + Commit** `docs(报送台): 收尾闸证据落盘` → 收尾按 finishing-a-development-branch

---

## Self-Review 记录

- **Spec 覆盖**：§2.1→T1+T4；§2.2→T1；§2.3→T2；§2.4→T4；§3→T3；§4→T3；§5→T5；§6→T1(label)+T5(文档)；§7 触点逐文件对上；§8 判据→T6 Step1-7；§9 风险→T2/T6 的 grep 失效验证与 Global Constraints 禁别名条。无缺口。
- **类型一致**：`FilingOrigin` 六值 T1 定义、T4 镜像照抄；七新码键 T2 定义、T4/T5 消费；`statuteRef` T2 产、T4 显示。`INFO_REQUEST_RESPONSE` 全链一名。
- **占位扫描**：T1 Step2 注明常量导出名以实勘为准（不虚构导出名）；T3 测试以既有 mock 样板为锚；无 TBD。
