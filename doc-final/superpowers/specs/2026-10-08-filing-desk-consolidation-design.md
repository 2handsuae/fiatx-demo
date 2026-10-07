# 报送台整备波（类型两层化 + RI 自动开单 + 四小修）· Spec

> 2026-10-08 ｜ 来源：甲段验收·报送台三轮讨论 + 登记册走查，业主逐项定稿；四岔口已拍（市场违规留自发申报桶 / 亚类不进 UI / 本波只做 RI 不动外包商 / HRCA 采信销账）
> 状态：待业主过目 → 开 worktree 施工
> 销账对象：BACKLOG :264 / :340 / :508 / :509 / :510 / :511（行号以施工时实查为准，按标题匹配）

## 0. 背景与目标

报送台验收走查暴露的体系性问题（type 单字段混两个海拔、依据码是法条坐标没人懂、来源不可见）与四条散账（审计镜像两处、剧本失真、RI 换人告知断档、HRCA 二手口径），合并一波修清。**零 schema 迁移、零状态机新边、零新审批类型、零新权限**。

## 1. 本任务做 / 不做

**做**：A 类型体系两层化 ｜ B RI 换人自动开告知单 ｜ C 审计 metadata 对称修 ×2 ｜ D 场景 18 剧本 TIR 失真订正（含孪生） ｜ E HRCA 口径订正。

**不做**：结构化正文表单（:506，前提未到——等合规同事字段需求）｜ 外包商册登记/终止联动开单（业主判留下次讨论）｜ goAML XML 生成/下载 ｜ 推送提醒 ｜ 任何兼容层/数据迁移（码与枚举改名靠重铺，禁止映射表）。

## 2. A · 类型体系两层化

### 2.1 来源层（注册表新列，六值封闭）

`filing-type-registry.ts` 的 `FilingTypeConfig` 加 `origin` 列，一行一字面值。**员工可见的第二层是"材料"，不是实现枚举**（业主 2026-10-08 四审钉死）——`INCIDENT_REPORT` 与 `PERIODIC_RETURN` 两个枚举退居幕后工作流路由键，**不出现在任何员工可见的选择面**：

| origin 枚举 | 界面词 | 员工可见的第二层（三形态） | 幕后路由键 |
|---|---|---|---|
| `INCIDENT` | Incident-driven | **七个材料码**（§2.3 改名后：重大事件 72h / 客户资金差异 / …）——码表封闭 | `INCIDENT_REPORT` |
| `PERIODIC_OBLIGATION` | Periodic obligation | **义务台账的行**（动态读 ACTIVE 义务，现 3 行，注册几个就显示几个）——配置开放 | `PERIODIC_RETURN` |
| `REGULATOR_REQUEST` | Regulator request | 单项 "Information request response"（来函内容开放不枚举） | `INFO_REQUEST_RESPONSE`（见 2.2 改名） |
| `SANCTIONS_HIT` | Sanctions hit | `CNMR` `PNMR` | （类型即材料） |
| `AML_MONITORING` | AML monitoring | `STR` `SAR` `HRC` `HRCA` | （类型即材料） |
| `SELF_DISCLOSURE` | Company disclosure | `MATERIAL_CHANGE_NOTIFICATION` `AUDITOR_APPOINTMENT_NOTICE` `MARKET_OFFENCE_DUAL_REPORT`（岔口已拍：留此桶） | （类型即材料） |

注册表注释必须写死来源定义：**来源=法定触发事由，非操作路径**（自动/手工是开单方式，与来源正交）。怀疑型/名单型亚类**不进 UI**（岔口已拍），只进文档与界面词全称。

### 2.2 类型层唯一改名

`REG_INFO_REQUEST_RESPONSE` → `INFO_REQUEST_RESPONSE`（界面词 "Information request response"）。其余十一值保留；AML 六缩写的界面词统一「缩写 — 全称」（HRCA 全称见 §6）。`MARKET_OFFENCE_DUAL_REPORT` 界面词改 "Market offence report (dual-filed)"。

### 2.3 依据码七个改名（材料语义，法条降副标签）

`INCIDENT_REPORT_BASES`（incident.constants.ts，前端镜像同步）键改名，`label` 拆为 `label`（材料名）+ `statuteRef`（法条引用，新字段，副标签展示；报文正文与审计引用照旧用法条）：

| 旧键 | 新键 |
|---|---|
| `TIR_K_H` | `MAJOR_INCIDENT_72H` |
| `CRM_IV_E_5` | `CLIENT_MONEY_DISCREPANCY` |
| `CRM_V_D_2` | `CLIENT_VA_DISCREPANCY` |
| `PDPL_ART_9` | `DATA_BREACH_REPORT` |
| `TIR_II_C_24H` | `DATA_BREACH_RE_REPORT_24H` |
| `COMPANY_IV_H_1` | `OUTSOURCING_FAILURE_NOTICE` |
| `COMPANY_VI_C_F` | `PRUDENTIAL_BREACH_NOTICE` |

**连带面（施工首任务全量 grep 清点，已知类别）**：`incident-type-registry.ts` 的 `reportBasisCandidates` 七处；种子 `seed.business.ts` 的 `reportBasisCodes` 字面串（如 `'PDPL_ART_9,TIR_II_C_24H'`）；`chainStart` 钟链判据引用；e2e 与单测中的码字面；`demo/script.md` 场景 24⑥/25③ 的码前缀引文（随新名二次订正）；前端镜像 `incidentStatusMap.ts`；`doc-final/modules/` 两篇的码表。存量 DB 行（incidents.reportBasisCodes / regulatory_filings.basisCode）靠重铺作废。

### 2.4 UI 三件（选择面与展示面都用材料层）

- **开单弹窗**：下拉按 origin 分 optgroup 六组，组内选项=§2.1 的"员工可见第二层"——`INCIDENT` 组直接列**七个材料**（选中=幕后 type `INCIDENT_REPORT` + 该 basisCode 预选；表单照旧必填事故号，码不在该事故候选集后端照拒 400，前端可按已填事故号过滤材料）；`PERIODIC_OBLIGATION` 组**动态列 ACTIVE 义务行**（选中=幕后 type `PERIODIC_RETURN`，标题/受文机构从义务行带出；补报无锚无钟语义不变、不新增后端字段——联动仅预填，义务行回链仍只在自动路）；其余组列类型。
- 报送台列表加**来源筛选**；
- 列表 Type 列**容器型下钻**：事故通报行显示 `Incident report — <材料名> (<钟>)`（读 basisCode 新名）；周期申报行显示 `Periodic return — <标题期别>`；其余类型显示界面词。

## 3. B · RI 换人批准落地自动开「重大变更告知」单

- `ri-replacement-workflow.service.ts` 在 `applyReplacement` 落地后横向调 `RegulatoryFilingService` 开一张 `MATERIAL_CHANGE_NOTIFICATION`：DRAFT 态、`createdByUserId='SYSTEM'`（照义务开单先例）、标题 `Responsible Individual change — <position>: <from> → <to>`、audit metadata 带 `riNo`/`approvalNo`。
- **不建外键、RI 行不回填 filingNo**（零 schema 约束；义务的 `lastFilingNo` 先例是既有列，RI 无列不加列）——双向可查靠审计 metadata 与标题。
- 开单失败不回滚换人（与制裁 CONFIRMED 出口同形的非原子现实，照实注释，不做补偿——CLAUDE.md §2）。
- 合规官接手走 GENERAL 六态全链原样；该单无钟（MATERIAL_CHANGE_NOTIFICATION 无钟配置不变）。
- 测试：workflow spec 断言批准落地后 `RegulatoryFilingService` 被以正确类型/标题调用 + 驳回路径不开单。

## 4. C · 审计 metadata 对称修（R5 判例修法：extra 校验形态保留、镜像进 metadata）

- :264 `FILING_SUBMITTED` 的 `externalRef`、`FILING_ENTRY_LOGGED` 的 `kind` → 镜像进 metadata；
- :508 `FILING_OVERDUE_MARKED` 的 `deadlineAt` → 镜像进 metadata。
- 测试：三码各一条断言 `recordAudit` 的 metadata 携键。

## 5. D · 场景 18 剧本失真订正（与 §2.3 改名联动）

`demo/script.md` 场景 18 定损步骤"依据勾 TIR Rulebook K+H"按**改名后的显示形态**订正为勾 `CLIENT_MONEY_DISCREPANCY — CRM IV.E.5`（未授权转出候选集唯 CRM 两码）；孪生 `modules/v8-recon.md:100` 同句同修。销 :509。

## 6. E · HRCA 口径订正（考证闭环，业主已采信）

官方一手材料（UAE FIU goAML Web Submission Guide v2.2，p2 术语表/p3 目录/p5 定义节）确认：全称 **High Risk Country Activity Report**；语义为**活动型**（与 HRC 的交易型二分，平行于 STR/SAR），**非**"交易属性不全时的替代报文"；3 工作日不反对窗同 HRC 被证实。订正：注册表 HRCA 行备注、界面词全称、`modules/v9-regulatory-filing.md` §2 表行与 §4.2 叙述。销 :340（销账行注明证据=该手册三处页码）。

## 7. 触点清单（文件级，施工首任务 grep 实勘补全）

后端：`filing-type-registry.ts`（origin 列+改名+HRCA 备注）｜ `regulatory-filing.constants.ts`（若类型键联合类型在此）｜ `incident.constants.ts`（码表改名+statuteRef）｜ `incident-type-registry.ts`（candidates 七处）｜ `ri-replacement-workflow.service.ts` ｜ `regulatory-filing.service.ts`/`audit` 调用点（C 项）｜ 种子 `seed.business.ts`（码串+若有类型串）｜ 相关 spec/e2e。
前端：`RegulatoryFilingListPage.tsx`（optgroup/筛选/下钻）｜ `incidentStatusMap.ts` 与 `IncidentDetailPage.tsx`（码表镜像+前缀显示随新名）。
文档：`modules/v9-regulatory-filing.md` ｜ `modules/v1-governance.md` §7 码表 ｜ `modules/v8-recon.md:100` ｜ `demo/script.md`（场景 18/24⑥/25③）｜ `CHANGELOG` 一行 ｜ `BACKLOG` 销六条。

## 8. 验收判据

1. 闸①②③ 三栈 tsc；`npx jest src/modules/governance` 全绿（incidents+regulatory-filings+complaints 目录基线之上）。
2. **行为证据**：RI 换人批准 → 报送台自动出现告知单（curl 或 e2e 级断言 + 截图）；驳回不开单。
3. **真名证据**：定损勾码 → 开出的单 `basisCode` 为新键且列表下钻显示材料名+钟；旧键全仓 grep 零残留（排除 archive 与本 spec）。
4. 截图：弹窗 optgroup 六组、列表来源筛选、下钻两形态（事故/周期）、RI 换人后台账新单、HRCA 界面词全称。
5. 剧本回归：场景 18（订正后）/21/22（RI 换人多一张自动单——**剧本场景 22 需补一句**）/24⑥/25③ 措辞与实际渲染逐句核。
6. 重铺闸⑧：码改名动了种子 → `stack.sh reset` + `demo:all` 全绿必跑。
7. 收尾：CHANGELOG 一行、BACKLOG 销 :264/:340/:508/:509/:510/:511、`doc-final` 对照 delivery-checklist。

## 9. 风险与边界

- **最大破坏面=依据码改名**（跨两域+前端+种子+剧本+测试的字面串）：首任务全量清点，判据 3 的"零残留 grep"是失效验证；禁止留旧名别名（兼容假象，照 FILING_TRANSITIONS 别名物理删除先例）。
- 场景 22 剧本因 B 项行为变化需补一句（换人批准后口播"报送台自动开出告知单"）——纳入文档同步，不是回归破坏。
- `statuteRef` 新字段仅常量结构，非 DB 列，不违零 schema。
