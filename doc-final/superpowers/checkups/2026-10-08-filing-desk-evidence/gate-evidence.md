# 报送台整备波 · 收尾闸证据（Task 6）

- 日期：2026-10-08 ｜ 分支 `filing-desk-consolidation`（worktree `.claude/worktrees/filing_desk_consolidation`）｜ 栈：self（端口 3100 后端 / 3101 管理台 / 3102 客户端 / 3103 TigerBeetle，库 `/tmp/exchange_js_wt_filing_desk_consolidation/dev.db`）
- 取证位置说明：行为证据全部取自 **self 栈（dist 由 `stack.sh up` 现编，含本波全部提交）上的真实 HTTP 与真实渲染**，不是单测/mock；截图为同一栈的管理台（3101）渲染。
- 敏感信息：token 一律不入本文（curl 经 `jq -r .access_token` 取值后只进变量，从未回显）。
- 一律硬编码的演示种子账号口令（`123456`）属项目既定演示事实，不是真密钥。

## 0. 文档微订正（闸门前先做，commit `f59c84b9`）

`docs(报送台): 收尾微订正——场景18改判VA/HRC锚半句/时序措辞/岔口追踪行`，五个改动点（派发词的第 6 项是 commit 本身）：

| # | 落点 | 改动 |
|---|---|---|
| 1 | `demo/script.md` 场景 18 + 孪生 `modules/v8-recon.md:100`（及题头 Last Verified 一句、`CHANGELOG.md:5` 本波自己那行） | 材料改判 **Client VA discrepancy report**（Jack 案标的 USDT=虚拟资产，CRM V.D.2），删"勾 Money 亦可"括注；引文补成三段 `Client VA discrepancy report — CRM V.D.2 — No statutory deadline stated`，Type 列句 `Incident report — Client VA discrepancy report (no stated deadline)` |
| 2 | `modules/v9-regulatory-filing.md` §2.1 | "HRC/HRCA 锚交易属性…" → "HRC 锚交易、HRCA 锚活动，均无外部案件可引" |
| 3 | `modules/v9-regulatory-filing.md` §2.1 超时软标段 | "本波未改" → "甲波二落地；2026-10-08 整备波起 `deadlineAt` 同镜像进 `metadata`"（段内后半句同义重复一并去重） |
| 4 | `demo/script.md` 场景 22 期望① | "互不联动" → "两本登记册之间互不联动" |
| 5 | `BACKLOG.md` 末尾 | 追加外包商册联动自动开「重大变更告知」单的岔口追踪行 |

⚠️ 与派发词的一处出入：派发词要求写 `Client virtual asset discrepancy report`，**实际注册表 label 是 `Client VA discrepancy report`**（`src/modules/governance/incidents/incident.constants.ts:117`）。剧本按真渲染写（下方 §6 截图 08a 同字面核过）；写成"virtual asset"会让剧本引文与屏幕对不上。

## 1. 随手闸（三栈 tsc）

```
npx tsc --noEmit -p tsconfig.json                     -> backend exit=0
cd admin-web  && npx tsc -b --noEmit                  -> admin   exit=0
cd client-web && npx tsc -b --noEmit                  -> client  exit=0
```

（Node 20.20.2；三个退出码都在子 shell 内 `echo` 取得，未经管道吞码。）

## 2. governance jest

```
export DATABASE_URL="file:/tmp/exchange_js_wt_filing_desk_consolidation/dev.db"
npx jest src/modules/governance --runInBand --silent  -> exit=0
Test Suites: 29 passed, 29 total
Tests:       514 passed, 514 total
```

基线 514（T5 之后）一致，无红。执行时库为进入本任务时已存在的 self 库（前几个任务铺的）（`DATABASE_URL` 显式指向，缺它会 129 条假红）；§4 重铺发生在本步之后，jest 未在新库上重跑——本步与 §4 之间 governance 目录**零代码改动**（只有本任务的文档提交），所以不重跑；这是一个已声明的取证顺序，不是遗漏。

## 3. 旧名零残留（判据用派发词修正版，不用任务书原命令）

任务书原命令的缺陷：`| grep -v archive` 按词过滤会吞掉"行内含 archive"的真残留，`-v ".superpowers"` 点号通配会整目录误滤——自蒙眼。修正版用 `--exclude-dir`：

```
grep -rnE "REG_INFO_REQUEST_RESPONSE|TIR_K_H|CRM_IV_E_5|CRM_V_D_2|PDPL_ART_9|TIR_II_C_24H|COMPANY_IV_H_1|COMPANY_VI_C_F" \
  src test prisma scripts admin-web/src client-web/src doc-final \
  --include="*.ts" --include="*.tsx" --include="*.md" \
  --exclude-dir=archive --exclude-dir=checkups --exclude-dir=superpowers --exclude-dir=node_modules
```

命中 **恰为 2 行**（= 豁免清单两行，其余零）：

| 命中 | 豁免理由 |
|---|---|
| `doc-final/CHANGELOG.md:16`（2026-09-28 历史条目，内含 `TIR_K_H`） | CHANGELOG 只追加不改史，改写即篡改历史账 |
| `doc-final/reference/roadmap.md:482` | 业主维护文件，agent 不碰 |

**失效验证（它真的会红）**：在 `src/__tmp_probe/p.ts` 临时写入一行 `const x='TIR_K_H';` 后重跑同一命令 → 命中变为 3 行（多出 `src/__tmp_probe/p.ts:1`），证明扫描范围覆盖 `src`、命令会抓；验证后文件已删，`git status` 干净。搜法边界：字面串、三种扩展名、上列目录；未覆盖：archive/checkups/superpowers（豁免目录）、动态拼接（本波没有按字符串拼码的代码路径）、外部调用方。

另：旧键被后端拒绝（行为证据，见 §5 ③ 附）——`reportBasisCodes:["TIR_K_H"]` → 400 `Unknown basis code: TIR_K_H`，无别名。

## 4. 重铺闸 ⑧

执行序（CLAUDE.md §10 标准序 reset → up → demo:all）：

```
bash scripts/stack.sh reset self   -> exit=0；末尾 "verify:demo-data ALL PASS"；TigerBeetle 清理重建（0_0.tigerbeetle 重 format，3103 ready）
bash scripts/stack.sh up           -> exit=0；后端 dist 现编（19761 / 3100），status 三端口 up
bash scripts/on-stack.sh self demo:all -> exit=0
```

`demo:all` 关键摘录：

```
花名册：29/29 符合预期
  ✓ 花名册 29 笔逐条符合预期
  ✓ COA CLIENT(AED):  CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE) (34107565 == 34107565)
  ✓ COA FIRM(AED):    ... (94620335 == 94620335)
  ✓ COA CLIENT(USDT): ... (7101620811 == 7101620811)
  ✓ COA FIRM(USDT):   ... (114013428189 == 114013428189)
  ✓ data.md 生成区已更新
  asserts: 5/5 PASS
═══ demo:all DONE ✅ (all asserts pass) ═══
```

- `git status` 在 demo:all 之后干净 → `demo/data.md` 生成区**零 diff**（判例：生成区 diff 即脏库探针；这里没有）。
- 日志里唯一的 `FAIL` 字样是 `[DepositWorkflowService] L1 FAIL: deposit … customer DEPOSIT capability`——花名册里「L1 能力闸拒绝」那笔充值的**设计内 WARN**（该笔预期终态本就是被拦），不是错误；`grep -c "✗\|✘"` 为 0。
- 种子码串（FILING 种子的 `INFO_REQUEST_RESPONSE`、事故报送种子的新依据码）经 reset 重铺后可见：`GET /admin/regulatory-filings` 种子行 `type:"INFO_REQUEST_RESPONSE"`、`basisCode:"DATA_BREACH_REPORT"/"DATA_BREACH_RE_REPORT_24H"`。

## 5. 行为证据（真 HTTP，curl + jq；self 栈 3100）

账号：`compliance_lead@` 提单、`sm@` 批准/驳回、`admin@`（超管）读列表、`tech_admin@` 登记网安事件（均 `POST /auth/login`，口令为演示种子口令，token 不回显）。

### ① RI 换人 → 批准 → 报送台自动开「重大变更告知」单

```
BEFORE  GET /admin/regulatory-filings  → MATERIAL_CHANGE_NOTIFICATION 行数 = 0
POST /admin/responsible-individuals/RI2601019215/replacement (compliance_lead@, 席位=CISO, 新任 Sara Whitfield)
  → 201 {"approvalNo":"APR261008447567"}
批准前再读 → MATERIAL_CHANGE_NOTIFICATION 行数 = 0（提单不开单）
POST /admin/control-gates/approvals/APR261008447567/approve (sm@) → 201 status=APPROVED
AFTER   → [{"filingNo":"FIL261008166379","type":"MATERIAL_CHANGE_NOTIFICATION","status":"DRAFT",
            "title":"Responsible Individual change — CISO: Marcus Tan → Sara Whitfield",
            "authority":"VARA","deadlineAt":null}]
GET /admin/regulatory-filings/FIL261008166379 → createdByUserId:"SYSTEM"
GET /admin/responsible-individuals/RI2601019215 → incumbentName:"Sara Whitfield"
审计 GET /admin/audit-logs?action=FILING_OPENED&subjectNo=FIL261008166379
  → metadata {"source":"RI_REPLACEMENT","riNo":"RI2601019215","approvalNo":"APR261008447567","authority":"VARA","deadlineAt":null}
```

"批准前 0、批准后 1" 是这条检测的失效验证（计数确实会从 0 变到 1，不是恒真）。

接手可用性：对这张 SYSTEM 开的单走 起草 → 送签（`REG_FILING_SUBMIT` 审批）→ `sm@` 批准 → 标已提交（`externalRef=VARA-REG-2026-RI-0001`）→ 终态 `SUBMITTED`，全程 201（"不因为是自动开的单就降级"）。

### ② 同席位再提一次换人并驳回 → 无新单

```
BEFORE  MATERIAL_CHANGE_NOTIFICATION 行数 = 1（FIL261008166379），总报送单数 = 7
POST .../RI2601019215/replacement (新任 Liam Carter) → 201 approvalNo=APR261008644048
POST /admin/control-gates/approvals/APR261008644048/reject (sm@) → 201 status=REJECTED
AFTER   MATERIAL_CHANGE_NOTIFICATION 行数 = 1，总数 = 7（不变）；席位现任仍 Sara Whitfield，pendingApprovalNo=null
审计 subjectNo=RI2601019215 → RI_REPLACEMENT_PROPOSED → APPROVAL_DECLINED → RI_REPLACEMENT_REJECTED，无 FILING_OPENED
```

### ③ 事故定损勾新依据码 → 开出的单 basisCode = 新键；旧键被拒

```
tech_admin@ POST /admin/incidents {type:CYBER_BCDR, subjectRefs:{affectedSystem,bcdrTriggered}} → 201 INC261008964141
POST .../investigation → 201；POST .../notes → 201
POST .../assess {assessmentBasis:SERVICE_IMPACT, reportRequired:true, reportBasisCodes:["MAJOR_INCIDENT_72H"]}
  → 201 {"incidentNo":"INC261008964141","status":"ASSESSED","filingsOpened":["FIL261008069409"]}
GET /admin/regulatory-filings → {"filingNo":"FIL261008069409","type":"INCIDENT_REPORT","status":"DRAFT",
   "basisCode":"MAJOR_INCIDENT_72H","deadlineAt":"2026-10-10T23:25:12.072Z"}   # 登记时刻 + 72h
```

附（无别名）：对另一张 `INVESTIGATING` 的 `CYBER_BCDR`（INC261008125602）提交 `reportBasisCodes:["TIR_K_H"]` →
`400 {"message":"Unknown basis code: TIR_K_H","error":"Bad Request"}`；该事故仍 `INVESTIGATING`（后续在 UI 里改勾新键提交，见 §6 的 25）。

### ④ 附加行为核对（本波触过的 metadata 镜像）

- `POST /admin/regulatory-filings/FIL2601012321/simulate-deadline-timeout`（PNMR）后 36 秒，`GET /admin/audit-logs?subjectNo=FIL2601012321` →
  `FILING_OVERDUE_MARKED`（actor SYSTEM）`metadata.deadlineAt="2026-10-07T22:35:26.506Z"`、`FILING_DEADLINE_FASTFORWARDED`（actor ADMIN）`metadata.deadlineAt` 同值（T3 补的"超时截止时刻"镜像已落库）。
- `RI_REPLACEMENT_APPLIED` 审计 `metadata.fromIncumbent="Marcus Tan"`、`toIncumbent="Sara Whitfield"`（T3 补的 from/to 镜像）。

### ⑤ 场景 18 真路径（对账案 → 事故 → 定损勾 VA 材料 → 自动开单 → 起草送签签发提交）

前置：`recon:demo:break` 在 UTC 23:27（迪拜已是次日 03:27）跑出 `walletsChecked=0 / 0/18 DETECTED`——`scripts/recon-demo.ts:225` 的 `ymd()` 取 UTC 日期落 `cutoffDate`，而引擎 `wallet-recon-run.service.ts:153` 用 `toBusinessDate(cutoff)`（迪拜业务日）按 `cutoffDate` 查外部余额，UTC 20:00–24:00 窗口内两者差一天、查不到（既有"迪拜业务日 UTC20-24 窗口"判例，与本波无关）。**等到 UTC 00:00 后同命令重跑**：`status=BREAK walletsChecked=19 casesOpened=12`、`scenarios: 18/18 DETECTED`、`wallets: 12/12 bucket OK`、`recon:demo break DONE — OK`（同代码同栈，仅时钟不同，坐实原因）。

（⚠️ 环境债：该脚本的 manifest 默认写 `/tmp/exchange_js_main/recon-demo-manifest.json`——**第一次失败的运行把 main 栈那份文件覆盖了**（mtime 03:27，内容是 self 栈的计划）；这是 TOOLING-DEBT 已登记的"MANIFEST_PATH 写死 main"（`TOOLING-DEBT.md:32/48/155`）。重跑时我用 `RECON_DEMO_MANIFEST_PATH=/tmp/exchange_js_wt_filing_desk_consolidation/recon-demo-manifest.json` 指向本树，没有再碰 main。main 栈该文件下次 `recon:demo:break` 会自己重写；main 的库/账本/端口全程未碰，`stack.sh status` 显示 main 三端口 pid 前后不变。）

场景 18 逐步（UI = puppeteer 真点；API = curl）：

| 步 | 做法 | 结果 |
|---|---|---|
| 案件页 | UI `treasury@` 打开 `REC20261008-009`（Jack `CU2601010403` USDT-TRON，400 USDT 幽灵 OUT） | 差异行上恰 1 个「Register incident」按钮（`18a`） |
| 选成因 | UI 点按钮 → 弹窗只有一项 `Unauthorized outflow`（线索 "We hold no order for it…"）→ 填查证说明 → Continue | 弹窗 `18b`；跳转到 `/admin/governance/incidents?type=UNAUTHORIZED_OUTFLOW&sourceCaseNo=REC20261008-009&sourceDispositionNo=RCD261008251140&customerNo=CU2601010403&assetCode=USDT-TRON&amount=400.000000&title=…` |
| 登记表单 | 弹窗 `Register Incident`：Type=`Unauthorized outflow (entry-locked)`、Title/Description/Source Case/Source Disposition Line/Asset/Amount 全预填（`18c`）→ UI 点弹窗内 Register | 跳到 `INC261008792834` 详情（`18d`），`customerNo/assetCode/amount/sourceCaseNo` 全在 |
| 调查 | API：`/investigation`、两条 `/notes`、`/escalate {to:MLRO}` | 均 201；事故 `INVESTIGATING` |
| 定损 | **UI**：Assessed amount 400、基准选 `Loss recognized`、填 Assessment note、勾 Regulatory report required | Report Basis 两行（`18e`）：`Client Money discrepancy report — CRM IV.E.5 — No statutory deadline stated` / `Client VA discrepancy report — CRM V.D.2 — No statutory deadline stated`；勾 VA 提交 |
| 自动开单 | 同上提交 | 顶部 `Regulatory filing opened: FIL261008613491`；Filings 卡 Basis=`Client VA discrepancy report — CRM V.D.2`、Deadline=`No deadline set`（`18f`）；API：`type=INCIDENT_REPORT`、`basisCode=CLIENT_VA_DISCREPANCY`、`deadlineAt=null`、`authority=VARA` |
| 通报链 | API：`compliance_lead@` 起草 → 送签（审批单）→ `sm@` 批准 → `SIGNED_OFF` → `compliance_lead@` 标已提交（`externalRef=VARA-REG-2026-VA-0001`） | 全 201，终态 `SUBMITTED` |

未走（出本波改动面）：认损开单（Recognize loss）、补款划转、挂载、提结案两步审批——这些是场景 18 的下游，本波没有触碰；故"结案前置门放行"一句本轮**未验**。

**Type 列句子的验证位置**：场景 18 写的 `Incident report — Client VA discrepancy report (no stated deadline)` 与 Deadline `No deadline set`，本轮是在同类型同依据码的另一张单上渲染验到的（`05`：用 `CLIENT_SHORTFALL` 事故、同样勾 `CLIENT_VA_DISCREPANCY` 开出的单；Type 列字面逐字一致）；场景 18 那张真单在我截列表前已被推进到 `SUBMITTED`（Deadline 列变 Submitted），所以列表层的"逐字"用 05 作证，真单层用 18f 的 Filings 卡 + API 字段作证。这是一个已声明的位置差，不是同一张单。


## 6. 截图清单（`doc-final/superpowers/checkups/2026-10-08-filing-desk-evidence/`）

截图器：`scripts/demo-shot.js` 的登录注入手法，另用 scratchpad 里一份临时 puppeteer-core 驱动（`shots.js`，不入库）——原因：**native `<select>` 的 optgroup 在无头截图里画不出下拉面板**，需要把 `size` 属性撑开成 listbox 才拍得到六组分组名；`demo-shot.js` 没有页内 evaluate 钩子。`--no-save` 装的 puppeteer-core，`package.json`/锁文件零改动。

| # | 文件 | 对应判据 | 核对 |
|---|---|---|---|
| 01 | `01-open-filing-six-groups.png` | 弹窗 optgroup 六组全景 | 六组齐全且顺序 = Incident-driven(7) / Periodic obligation(3) / Regulator request(1) / Sanctions hit(2) / AML monitoring(4) / Company disclosure(3)；下方琥珀色提示行 `TIR Rulebook Section K + H — Report within 72h` |
| 02 | `02-incident-group-seven-materials.png` | INCIDENT 组七材料展开 | 七个材料名逐个可见：Major incident report / Client Money discrepancy report / Client VA discrepancy report / Personal data breach report / Data breach re-report / Outsourcing failure notice / Prudential (NLA) breach notice；选中 Client VA 后提示行 `CRM V.D.2 — No statutory deadline stated` |
| 03 | `03-periodic-group-obligation-rows.png` | PERIODIC 组义务行动态选项 | 组内三行 = 三条 ACTIVE 义务（Annual/Monthly/Quarterly）；选中 Monthly 后标题预填 `VARA Monthly Regulatory Return — make-up filing`，**Authority 格在 2 列网格的左半格**（T4 评审核对项：机构格版式——截到，右半格空、无错位） |
| 04 | `04-list-source-filter-incident-driven.png` | 列表来源筛选生效 | 来源选 Incident-driven → 只剩三张事故通报行（计数 `3 filing(s)`）；`04b-list-source-filter-periodic.png` 同理 Periodic obligation |
| 05 | `05-type-column-drilldown-incident-and-periodic.png` | Type 列下钻（事故+周期同屏） | 同屏三种形态：`Incident report — Client VA discrepancy report (no stated deadline)`（Deadline `No deadline set`）、`Incident report — Major incident report (72h)`、`Periodic return — VARA Annual Report incl. audited financials — due 2026-10-07`（Deadline 红 Overdue）；其余行显示界面词（T4 评审核对项：Type 列长文案——自然折行为两行，行高自适应，无横向滚动） |
| 06 | `06-ri-replacement-auto-filing-list.png` + `06b-ri-replacement-auto-filing-detail.png` | RI 换人后报送台自动新单 | 来源=Company disclosure 只剩 `Material change notification`（Draft / VARA / `No deadline set`）；详情页 `Created By SYSTEM`，标题 `Responsible Individual change — CISO: Marcus Tan → Sara Whitfield` |
| 07 | `07-hrca-full-label-aml-group.png` | HRCA 界面词全称 | AML monitoring 组四行：`STR — Suspicious Transaction Report` / `SAR — Suspicious Activity Report` / `HRC — High Risk Country Transaction Report` / `HRCA — High Risk Country Activity Report`（选中态） |
| 08 | `08a-assessment-basis-options.png` + `08b-assessment-submitted-filing-opened.png` | 定损依据码新显示（材料名—法条—钟三段） | 事故页 Assessment 勾选项两行：`Client Money discrepancy report — CRM IV.E.5 — No statutory deadline stated` / `Client VA discrepancy report — CRM V.D.2 — No statutory deadline stated`；勾 VA 提交后顶部 `Regulatory filing opened: FIL261008937890`，Filings 卡 Basis=`Client VA discrepancy report — CRM V.D.2`、Deadline `No deadline set` |
| 09 | `06-…list.png`（审批后的报送台列表，复用）+ `09-ri-register-after-replacement.png` | 场景 22 新句对应画面 | RI 册页 CISO 行：Incumbent=`Sara Whitfield`，VARA Ref=`VARA-RI-2026-014`，Effective From=`2026/11/1`，Pending Replacement 清空 |
| 18 | `18a`…`18f`（案件页 / 成因弹窗 / 预填登记表单 / 事故已登记 / 定损依据勾选 / 提交后 Filings 卡） | 场景 18 真路径 | 见 §5⑤；`18e`=两行依据码三段式，`18f`=`Regulatory filing opened: FIL261008613491` + Basis `Client VA discrepancy report — CRM V.D.2` + `No deadline set` |
| 21 | `21a-clock-wall.png` / `21b-obligations.png` | 场景 21 | 闹钟墙 11 行（含 PNMR 倒计时、三条义务倒计时）；义务页 Annual 的 Last Filing 已回填 |
| 24 | `24a-…assessment-form.png` / `24b-…assessed-remediation-hint.png` | 场景 24⑥ | 固定文本 `Service impact assessed`、无 Regulatory report required 勾选框、静态一行 `No complaint-specific reporting obligation under VARA Market Conduct`；提交后 Assessed + `no remediation actions to attach — it can be closed directly once assessed` |
| 25 | `25a-assessment-basis-options.png` / `25b-assessment-submitted-filing-opened.png` | 场景 25③ | 勾选项唯一一行 `Major incident report — TIR Rulebook Section K + H — Report within 72h`；提交后 `Regulatory filing opened: FIL261008324628`，Filings 卡 Basis=`Major incident report — TIR Rulebook Section K + H`、Authority VARA、Deadline `2d 23h`、Draft |

"业主过目"项（只截不判，留给业主）：Task 2 遗留的七个材料英文文案（01/02/08a/18e 可见）；Task 1 遗留的"单据标题呈 `CNMR — Confirmed Name Match Report — CU…` 双破折号偏长"——标题只出现在报送单**详情页**与审批摘要里，本轮没有专门截 CNMR/PNMR 详情页（05 列表的 Type 列显示的是类型界面词 `CNMR — Confirmed Name Match Report`，不带客户号），如需业主过目该项需另截。

## 7. 剧本回归（对 `demo/script.md` 当前文本，真栈逐句）

失效句**只记录不自改**（留控制者）。

| 场景 | 结果 | 要点 |
|---|---|---|
| 18 | 逐句通过，**两处措辞瑕疵（既有，非本波引入）** | ①"自动跳转事故登记表单（类型 / 来源案号 / 定性行号 / 客户 / 资产 / 金额已预填）"——表单**没有可见的客户输入框**（`18c`：Type/Title/Description/Source Case/Disposition Line/Asset/Amount），客户号走 URL 参数带到、详情页 Customer 字段可见；字面"客户已预填"在表单上看不到。②"勾 Client VA discrepancy report — CRM V.D.2 — No statutory deadline stated"与屏幕逐字一致（本任务微订正后的句子，`18e` 核过）；Type 列 / Deadline 句子见 §5⑤ 的位置说明。下游认损/补款/结案未走 |
| 21 | ②**失效**，其余通过 | ①闹钟墙：报送单钟含 PNMR 倒计时 + 三条义务倒计时 ✓（`21a`）。②**"`Next Due` 已翻到下一自然年末"失效**：实测 Annual 点 ⚡ 后 30 秒翻为 `2027/10/8 03:27:05`（= 拨钟时刻 +1 年，`advanceDueDate()` 对 dueAt 加一年，不取年末），页面与 API `nextDueAt:"2027-10-07T23:27:05.000Z"` 一致；⑥那句"仍是翻期后的下一年"是对的。另：⚡ Fast-forward due 按钮要 Simulation 开关打开才渲染（关着时只有 Edit/Disable），剧本该节没提——同样既有。③新 `PERIODIC_RETURN` 单 `FIL261008710521`，标题 `… — due 2026-10-07`、Deadline 红 Overdue ✓（`05`）。④⑤⑥走通：起草→送签→`sm@` 批准（审批 `objectSnapshot.impact` = "Submitting Periodic regulatory return to VARA (…), statutory deadline 2026-10-07T23:27:05.030Z"）→标已提交，终态 `SUBMITTED`，`nextDueAt` 不变 ✓。⑦PNMR 拨钟后 36 秒 `FILING_DEADLINE_FASTFORWARDED`(ADMIN) + `FILING_OVERDUE_MARKED`(SYSTEM) 两条审计，且两条 `metadata.deadlineAt` 都带值（本波 T3 补的镜像）✓ |
| 22 | 通过（含新补句） | ①RI 册：4 个席位、Propose replacement 链路 ✓；②审批 `objectSnapshot` 含 `newIncumbentName/effectiveFrom/reason/varaRef` 四字段（self 库 sqlite 只读查 `approval_cases`）✓；③批准后席位 Incumbent=`Sara Whitfield`、VARA Ref/Effective From 已更新、Pending Replacement 清空（`09`）✓；④**新补句**：批准同一时刻报送台多出 `Material change notification`，SYSTEM 开单、`Draft`、Authority VARA、标题 `Responsible Individual change — CISO: Marcus Tan → Sara Whitfield`、Deadline `No deadline set`（`06`/`06b`）✓；接手六态走通（起草→送签→`sm@`→已提交）✓。判据：一席一在途 400 未再测（verify:rbac 既有探针范围）；审计链四条 + `RI_REPLACEMENT_APPLIED.metadata.fromIncumbent/toIncumbent` 逐字 ✓；驳回路径 `APPROVAL_DECLINED → RI_REPLACEMENT_REJECTED`、无 `FILING_OPENED` ✓。期望①的新限定语"两本登记册之间互不联动"与期望③并存不矛盾 ✓。站 A（外包商册增改止）本波未改，未重走 |
| 24⑥ | 通过 | UI 走：Start Investigation → 笔记 → Assessment 区固定文本 `Service impact assessed`、**无** Regulatory report required 勾选框（DOM 实测 `hasReportCheckbox:false`）、静态一行 `No complaint-specific reporting obligation under VARA Market Conduct` → Submit → `Assessed`，Remediation 卡 `This incident type has no remediation actions to attach — it can be closed directly once assessed.`（`24a`/`24b`）。该事故由种子② `CMP2601017476` 现场 extend → ⚡ simulate-timeout → escalate 得 `INC261008161548` |
| 25③ | 通过 | UI 走：Cyber/BCDR 事件 Assessment 勾 Regulatory report required → Report Basis **仅一行** `Major incident report — TIR Rulebook Section K + H — Report within 72h` → Submit → 顶部 `Regulatory filing opened: FIL261008324628`，Filings 卡 Basis=`Major incident report — TIR Rulebook Section K + H`、Authority VARA、Deadline `2d 23h`、Draft（`25a`/`25b`）；报送台 Type 列 `Incident report — Major incident report (72h)`（`05`）✓ |

**失效句汇总（留控制者）**：共 **1 句确切失效**（21②"下一自然年末"）+ **2 处措辞瑕疵**（18 "客户已预填" 表单无可见客户框；21 ② 未提 Simulation 开关前提）。三处均为本波之前就存在，未自改。

## 8. 收栈

```
bash scripts/stack.sh down self -> exit=0（backend/admin/client/tb 四个 pid 停；services stopped）
lsof -nP -iTCP:3100-3103 -sTCP:LISTEN -> 无输出（退出码 1，端口全空）
bash scripts/stack.sh status -> 本树 3100/3101/3102 down；main 3000/3001/3002 仍 up（pid 59785/59787/59789，与开工前一致，全程未碰）
git status --short -> 仅 `?? doc-final/superpowers/checkups/2026-10-08-filing-desk-evidence/`
```

## 9. 本任务产生/改动的东西

- commit `f59c84b9`（文档微订正，§0）+ 本证据 commit（截图 24 张 + 本文件）；零源码改动。
- `npm i --no-save puppeteer-core@24`：只进 `node_modules`，`package.json`/锁文件零 diff。
- 本树库里留有演示操作的痕迹（RI 换人、几张事故/报送单、`recon:demo:break` 铺的 12 张案子），属一次性自栈数据；"重铺即消"。

