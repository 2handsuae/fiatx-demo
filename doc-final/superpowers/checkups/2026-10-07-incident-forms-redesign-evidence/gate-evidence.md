# 事件中心表单应然重设计 · 收尾闸证据（2026-10-07）

> spec：`doc-final/superpowers/specs/2026-10-07-incident-forms-redesign-design.md` ｜ plan：`doc-final/superpowers/plans/2026-10-07-incident-forms-redesign.md` Task 6
> 证据取自**本 worktree 自己的栈**（分支 `incident-forms-redesign`，HEAD `579c155d`；后端 3100 / 管理台 3101 / 客户端 3102 / TB 3103；DB `/tmp/exchange_js_wt_incident_forms_redesign/dev.db`），未碰主栈 3000-3003。
> 栈跑的是 `dist/main`（`stack-up.sh` 起栈时 `npm run build`），已核 dist 含新码：`grep -c allowedAssessmentBases dist/modules/governance/incidents/incident-type-registry.js` = 10；`incident.service.js` 含 `assessmentBasis must be one of [` / `asset code` / `assessment note` 三句新文案。
> 登录令牌一律脱敏（下文 `$TOKEN` = `POST /auth/login` 取得的 `access_token`，admin@fiatx.com）。

## 1. 随手闸（Node v20.20.2）

| 命令 | 退出码 | 输出 |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 | 空 |
| `cd admin-web && npx tsc -b --noEmit` | 0 | 空 |
| `cd client-web && npx tsc -b --noEmit` | 0 | 空 |

## 2. 后端全目录

`npx jest src/modules/governance/incidents --silent` → 退出码 0
`Test Suites: 7 passed, 7 total ｜ Tests: 192 passed, 192 total`（基线 186，本一揽子净增 6）

## 3. curl 真门探针（直打后端，绕过前端）

造态（均 `POST /admin/incidents` → 201，再 `POST /:no/investigation` → INVESTIGATING）：

| 事件 | 类型 | 登记要点 |
|---|---|---|
| INC261007395501 | DATA_BREACH | `subjectRefs.affectedCustomerCount=46, dataCategories=CONTACT,ID_DOCUMENT` |
| INC261007210777 | CLIENT_SHORTFALL | customerNo=CU2601019430, amount=1500, **assetCode=AED** |
| INC261007637872 | CLIENT_SHORTFALL | customerNo=CU2601019430, amount=2000, **不带 assetCode** |

通用调用形态：`curl -s -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:3100/admin/incidents/<NO>/assess -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '<BODY>'`

### 探针① DATA_BREACH 传 SERVICE_IMPACT → 400

```
POST /admin/incidents/INC261007395501/assess
{"assessmentBasis":"SERVICE_IMPACT","impactSummary":"x","reportRequired":false}
→ HTTP 400
{"message":"assessmentBasis must be one of [DATA_IMPACT] for incident type DATA_BREACH","error":"Bad Request","statusCode":400}
```

### 探针② CLIENT_SHORTFALL（登记带 AED）缺说明 → 400

```
POST /admin/incidents/INC261007210777/assess
{"assessmentBasis":"FIRM_LOSS","assessedAmount":"100","reportRequired":false}
→ HTTP 400
{"message":"Assessment requires an assessment note (impact summary)","error":"Bad Request","statusCode":400}
```

### 探针③ CLIENT_SHORTFALL（登记不带币种）说明金额齐、缺 assetCode → 400

```
POST /admin/incidents/INC261007637872/assess
{"assessmentBasis":"FIRM_LOSS","assessedAmount":"100","impactSummary":"Reconciled against ledger","reportRequired":false}
→ HTTP 400
{"message":"Assessment requires an asset code (none was recorded at registration)","error":"Bad Request","statusCode":400}
```

探针③前行状态：`sqlite3 <DB> "SELECT incidentNo,status,assetCode,assessmentBasis FROM incidents WHERE incidentNo='INC261007637872'"` → `INC261007637872|INVESTIGATING||`

### 探针④ 同一张（③）补 `assetCode` 提交 → 成功且落列（验 ValidationPipe 白名单正向路径）

```
POST /admin/incidents/INC261007637872/assess
{"assessmentBasis":"FIRM_LOSS","assessedAmount":"100","impactSummary":"Reconciled against ledger","assetCode":"USDT-TRON","reportRequired":false}
→ HTTP 201
{"incidentNo":"INC261007637872","status":"ASSESSED","filingsOpened":[]}
```

落列核对：`sqlite3 -header <DB> "SELECT incidentNo,status,assetCode,assessmentBasis,assessedAmount,impactSummary FROM incidents WHERE incidentNo='INC261007637872'"`
→ `INC261007637872|ASSESSED|USDT-TRON|FIRM_LOSS|100|Reconciled against ledger`（探针前 assetCode 为空）

### 补充探针⑤（非任务书要求，顺手验 spec §4.3「行上已有值以行值为准」）

```
POST /admin/incidents/INC261007210777/assess   （登记时 assetCode=AED）
{"assessmentBasis":"FIRM_LOSS","assessedAmount":"1500","impactSummary":"Covered from firm funds","assetCode":"USDT-TRON","reportRequired":false}
→ HTTP 201 {"incidentNo":"INC261007210777","status":"ASSESSED","filingsOpened":[]}
```
落列：`INC261007210777|ASSESSED|AED|FIRM_LOSS|1500` —— 请求体里的 USDT-TRON 被忽略，行值 AED 保留。

补充对照（同一真门另一口径）：OUTSOURCING_FAILURE（种子 INC2601014294）传 `DATA_IMPACT` → `400 assessmentBasis must be one of [SERVICE_IMPACT] for incident type OUTSOURCING_FAILURE`。

### 这几条探针「会红」的依据

未对旧 dist 做 live 失效验证（会要求再造一套旧版栈，代价与收益不匹配）。改以 base commit 源码行证明旧码会放行：`git show 9a36895a:src/modules/governance/incidents/incident.service.ts` 第 431 行 `const allowedBases = ASSESSMENT_BASIS_BY_SCHEME[cfg.assessmentScheme]`——IMPACT 口径合法集 = `['SERVICE_IMPACT','DATA_IMPACT']`，故旧码下探针①会是 201；第 436–438 行仅 IMPACT 口径校验说明（钱/缺口口径无此校验），故旧码下探针②会是 201；旧码无币种补填逻辑，探针③同样不会 400。即三条 400 都是新增的真门，非历史就有。

## 4. 通用下拉 7 类（DOM 取证）

一次性 puppeteer 脚本（脚本在会话 scratchpad，不入库）打开 `/admin/governance/incidents`，点 Register Incident，读弹窗 `<select>` 选项；再带 `?type=LARGE_UNEXPLAINED` 打开读同一位置：

```
NO-PREFILL (generic dropdown): {"selectPresent":true,"options":["Client shortfall","Cyber / BCDR incident","Personal data breach","Outsourcing failure","Asset non-compliance","Major stuck transaction","Prudential (NLA) breach"]}
PREFILL type=LARGE_UNEXPLAINED: {"selectPresent":false}
```
——无 prefill：7 项，缺「Unauthorized outflow」「Large unexplained discrepancy」；带 prefill.type：弹窗不渲染 `<select>`（类型锁定为只读文本，见截图 01/02/10）。

## 5. 造态披露（读截图前必看）

- 事件均经 API 登记推进，标题 `[EVIDENCE] …` 前缀；种子五行（INC2601014584/16037/14294/12762/11480）原样使用。
- **两处直写 DB（仅为让详情页渲染对账族字段，非行为证据）**：本 worktree 无对账场景数据（`reconciliation_cases/dispositions/internal_transfers` 均 0 行），对账族登记锚有真校验、API 登记不了——① `INSERT` 一行 `INC261007999901`（UNAUTHORIZED_OUTFLOW，sourceCaseNo=RC-EVID-0001、sourceDispositionNo=DSP-EVID-0001，标题 `[EVIDENCE-FIXTURE]`）→ 截图 16；② 对 `INC261007637872` 执行 `UPDATE … SET sourceAdvanceTransferNo='TRF2610070001'` → 截图 16b。两处 SQL 绕过了服务层，**只证明详情页展示，不证明登记/审计行为**。案件页三入口的端到端登记（含隐藏值落库）本 worktree 未复现，留甲段正式验收场景 31——理由：案件页入口的端到端登记需要真实对账锚（对账案件/定性行），本 worktree 无 recon 场景数据，造不出。

## 6. 截图索引（均 Chrome 无头渲染，`scripts/demo-shot.js`，admin 暗色默认主题，1440 宽；sha256 互不相同）

| 序号 | 文件 | 看点 |
|---|---|---|
| 01 | `01-register-unauthorized-outflow-locked.png` | URL 预填锁定态（案件页入口来路）：Type 只读 `(entry-locked)`；Source Case No* / Source Disposition Line No* / Asset(optional) / Amount(optional) |
| 02 | `02-register-large-unexplained-locked.png` | 锁定态：Source Case No* / Asset / Amount，**无 Customer No** |
| 03 | `03-register-client-shortfall.png` | 通用下拉默认（Client shortfall）：Source Advance Transfer No(optional) / Customer No* / Amount* / Asset(optional) |
| 04 | `04-register-cyber-bcdr.png` | Affected system*（受控下拉）+ BCDR triggered 勾选；零客户/金额/币种字段 |
| 05 | `05-register-data-breach.png` | Affected customer count* + Data categories*（五个多选框）；零钱味字段 |
| 06 | `06-register-outsourcing-failure.png` | Vendor*（受控下拉）+ Service impact*；零钱味字段 |
| 07 | `07-register-asset-noncompliance.png` | 仅 Asset* |
| 08 | `08-register-stuck-transaction.png` | Customer No* / Amount* / Asset(optional) + Order No* |
| 09 | `09-register-prudential-breach.png` | Metric (NLA)* + Shortfall amount* |
| 10 | `10-register-client-shortfall-advance-locked.png` | 第三种来路（客户欠款带垫款单号）锁定态 |
| 11 | `11-assess-money-no-asset-recorded.png` | 钱口径、登记无币种：Assessed amount + Asset code* 输入框 + 四选下拉(Recovered) + 报告勾选；Assessment note 文本域 |
| 11b | `11b-assess-money-asset-recorded-readonly.png` | （补充）登记带 AED：币种只读文本 `AED`，无输入框 |
| 12 | `12-assess-shortfall-prefilled.png` | 缺口口径（种子 PRUDENTIAL）：金额预填 250000、结论固定文本 `Shortfall assessed`、Asset code* 出现 |
| 13 | `13-assess-impact-prefilled.png` | 影响口径（种子 OUTSOURCING）：说明预填 serviceImpact、结论固定文本 `Service impact assessed`、无币种字段 |
| 14 | `14-assess-zero-candidate-static-note.png` | 零候选（ASSET_NONCOMPLIANCE）：无通报勾选框，静态说明行 `No reporting obligation — …` |
| 15 | `15-assess-code-prefix-data-breach.png` | DATA_BREACH 勾 Regulatory report required 后两条候选码：`PDPL_ART_9 — …` / `TIR_II_C_24H — …`；金额位预填 impactCount=46；结论固定文本 `Data impact assessed` |
| 16 | `16-detail-recon-family-unauthorized-outflow.png` | 详情页对账族（**DB 直写 fixture**）：Basic Info 无残留，Type-Specific 卡含 Source Case(链接)/Source Disposition Line/Amount |
| 16b | `16b-detail-client-shortfall-assessed.png` | 详情页 CLIENT_SHORTFALL 已定损（**advance 号为 DB 直写**）：Source Advance Transfer(链接)/Customer(链接)/Amount；定损卡 `Assessment Note`；Freeze 提示条位置可目测 |
| 17 | `17-detail-asset-noncompliance.png` | 种子 INC2601012762：Type-Specific 卡只有 Asset 一行，无空壳 |
| 18 | `18-register-data-breach-light-theme.png` | **浅色主题**弹窗（其余全部为默认暗色，故 18 补浅色以两主题都覆盖） |
| 18b | `18b-assess-money-light-theme.png` | （补充）浅色主题定损表单 |
| 19 | `19-scene25-register-cyber-bcdr-filled.png` | 场景 25 ①：tech_admin@ 登记弹窗已填（点 Register 前） |
| 20a | `20a-scene25-after-register-detail.png` | 场景 25 ①：点 Register 后落详情页，状态 Registered（事件 INC261007881068） |
| 20b | `20b-scene25-investigating-with-note.png` | 场景 25 ②：Start Investigation + 一条调查笔记，状态 Investigating |
| 20c | `20c-scene25-assess-form-filled.png` | 场景 25 ③：Impact summary 填好、勾 Regulatory report required、唯一候选码 `TIR_K_H — …` 已勾（提交前） |
| 20 | `20-scene25-assessed-filing-opened.png` | 场景 25 ③：提交后——横幅 `Regulatory filing opened: FIL261007070774`；Regulatory Filings 卡新增一行（Basis 带 `TIR_K_H —` 前缀 / VARA / Draft / 倒计时 2d 23h） |

场景 25 ①–③ 的库内终态：`sqlite3 <DB> "SELECT incidentNo,status,assessmentBasis,reportRequired,reportBasisCodes FROM incidents WHERE incidentNo='INC261007881068'"` → `INC261007881068|ASSESSED|SERVICE_IMPACT|1|TIR_K_H`。

## 7. e2e 尝试（红，环境债，不作为本次证据）

`bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/(incident-register|regulatory-filing|complaints)\.e2e-spec'` → 退出码 1，`Test Suites: 3 failed, 3 total ｜ Tests: 20 failed, 20 total`，全部死在 `app.init()`：`TypeError: The "warning" argument must be of type string or an instance of Error`（`eventemitter2` 监听器越限警告，跨 realm Error）。这是 `doc-final/TOOLING-DEBT.md` 已登记的存量环境债（「起完整 AppModule 的 jest … 52 个监听器」条），与本一揽子无关；该红在任何用例体执行之前出现，故 e2e 对本次改动**既不能证明也不能证伪**。本次真门行为证据改由 §2 单测 192/192 + §3 curl 探针承担。（T2 顺手改过的 `test/incident-register.e2e-spec.ts` 三行因此仍未实跑过。）

## 8. 剧本核对记录

- 场景 25 ①–③ 在本栈用 demo-shot 逐步实走（tech_admin@ → 登记 INC261007881068 → Start Investigation + 笔记 → 定损勾 TIR_K_H），除下条外措辞成立：Impact summary 必填 ✓、唯一候选码 ✓、横幅 `Regulatory filing opened: FIL…` ✓、Filings 卡 VARA / Draft / 约 2d 23h ✓。
- 已订正（本 commit）：场景 24 ⑥ 两句（结论固定文本、旧 `no statutory reporting basis to select` 提示 → 静态说明行）；场景 25 ③ 的 Report Basis 选项原文加 `TIR_K_H — ` 前缀。
- 边缘表述未改，留控制者定夺：场景 25 ① 括号「选中后表单动态长出 Type-specific 区」——两段化后 Type-specific 区**常驻**、只是字段随类型换，建议改「选中后 Type-specific 区换成网安专属字段」。
- **范围外发现，已订正**：新定损真门使旧剧本步骤会 400——场景 31 ⑤（缺必填 Assessment note）、场景 32 ④（缺 Assessment note，且审慎登记无币种→还缺必填 Asset code；依据码选项现带 `COMPANY_VI_C_F — ` 前缀）、`script.md` 第 18 行表格行（认损定损同缺 note）三处已于 `9a1164e7` 订正；其后评审又逮到场景 32 ⑨ 审批 Impact 摘要引文（32 ④ 补币种后结案摘要带 ` AED`，拼接见 `incident-close-workflow.service.ts` `describeCloseImpact`）与场景 31 ④「客户号…全部预填」措辞偏旧（弹窗已不渲染客户号，隐藏值仍随提交），两处于修复轮 2 订正。场景 18 行「依据勾 TIR Rulebook K+H」对未授权转出本就不合法，属存量失真，已登 BACKLOG（不在本分支修）。
