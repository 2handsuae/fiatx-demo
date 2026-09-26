# 收尾闸证据（Task 11）

环境：self 栈（`worktree-act-a-wave2-filing`），`DATABASE_URL=file:/tmp/exchange_js_wt_act_a_wave2_filing/dev.db`、`TB_ADDRESS=127.0.0.1:3103`；Node 20（`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`，本机默认 Node 18）。

## 随手闸 ①②③

**① 后端 tsc**：`npx tsc --noEmit -p tsconfig.json`
- EXIT: `0`（无输出）

**② admin-web tsc**：`cd admin-web && npx tsc -b --noEmit`
- EXIT: `0`（无输出）

**③ client-web tsc**：`cd client-web && npx tsc -b --noEmit`
- EXIT: `0`（无输出）

## jest：governance + audit-logging

`npx jest src/modules/governance src/modules/audit-logging --colors`
- EXIT: `0`
- 关键行：`Test Suites: 24 passed, 24 total` / `Tests: 358 passed, 358 total`

## e2e：regulatory-filing + incident-register

`bash scripts/on-stack.sh self test:e2e -- test/regulatory-filing.e2e-spec.ts test/incident-register.e2e-spec.ts`
- EXIT: `0`
- 关键行：`PASS test/incident-register.e2e-spec.ts` / `PASS test/regulatory-filing.e2e-spec.ts` / `Test Suites: 2 passed, 2 total` / `Tests: 16 passed, 16 total`

## 重铺闸（⑧，触发原因：本波改了 schema——新增 `regulatory_filings`/`regulatory_filing_entries` 两表 + 事故表退六列）

**重铺**：`bash scripts/stack.sh reset self`
- EXIT: `0`
- 关键行：`Seeded 5 incident sample rows (non-initial states; CYBER_BCDR left for the live demo script).` / `Seeded 3 regulatory filing sample rows (2 chained to data-breach-crm-export + 1 inbound VARA info request).` / `verify:demo-data ALL PASS`

**起栈**：`bash scripts/stack.sh up self`
- EXIT: `0`
- 关键行：迁移日志显示 `20260925231534_filing_wave2_tables`、`20260926002536_incident_wave2_drop_report_slot` 两条本波迁移已应用（`[migrate] skip` = 已应用过，非本次新跑，因为 reset 已经跑过一次 `db push`/迁移）；`all services started`

## demo:all（⑥，复跑确认收尾态；T10 曾跑过一次，本次为重铺后的干净复跑）

`bash scripts/on-stack.sh self demo:all`
- 第一次复跑（未重铺，紧接在 T10 之后+本任务大量 e2e/mutation 测试写入之后）：**EXIT 1**——`FATAL Error: Timeout (15000ms) waiting for: deposit reaches SUCCESS`，根因是 demo:all 脚本本身不是可重复跑的（`demo:frank-prestage` 假设 Frank 是干净状态，而 Frank 已在更早一次 demo:all 运行中被制裁冻结），与本波改动无关——诊断依据：`sqlite3 ... customer_restrictions` 查 Frank 无独立限制行，问题出在 L1 enforcement 命中已存在的制裁状态，而不是权限/报送台改动
- 重铺后复跑：**EXIT 0**
  - 关键行：`花名册：29/29 符合预期` / `asserts: 5/5 PASS` / `═══ demo:all DONE ✅ (all asserts pass) ═══`
  - `data.md` 生成区零 diff：`git status --porcelain` 未列出 `doc-final/demo/data.md`，证明重铺+demo:all 复现的种子与已提交文档一致

## verify:rbac（预期仅 2 存量红）

`bash scripts/on-stack.sh self verify:rbac`
- EXIT: `1`（2 个已知存量红，非本波引入）
- 报送台相关正/反探针全绿：
  ```
  ✓ [报送台经办唯合规官] 合规官 可以 手工开单(MATERIAL_CHANGE_NOTIFICATION) —— compliance_lead@ POST /admin/regulatory-filings → 201
  ✓ [报送台经办唯合规官] 探针收尾清理 · 作废自建报送单 —— POST .../cancel → 201
  ✓ [报送台经办唯合规官] 运营 不得 手工开单 —— ops_officer@ POST /admin/regulatory-filings → 403
  ✓ [报送台经办唯合规官] 金库 不得 手工开单 —— treasury@ POST /admin/regulatory-filings → 403
  ✓ [报送台经办唯合规官] 技术官 不得 手工开单 —— tech_admin@ POST /admin/regulatory-filings → 403
  ```
- 两条存量红逐字核对，均在 `doc-final/TOOLING-DEBT.md`/`doc-final/BACKLOG.md` 登记过、复现命令与错误文本完全一致，非本波引入：
  1. `✗ S7 catalog 字典真实性 ...` 报 4 条 `admin_deposit_sumsub_demo_*`/`admin_withdraw_sumsub_demo_*` 死行——`doc-final/TOOLING-DEBT.md` 2026-09-14 波五 Task 3 登记行，扫描器静态局限（共用基类装饰器扫不到），与本波无关
  2. `✗ V2 改角色不丢权限 · COMPLIANCE_OFFICER —— 技术官提交 modify 失败: 400 {"message":"Invalid permission groups: CUSTOMER_WRITE",...}`——`doc-final/BACKLOG.md` 2026-09-16/2026-09-25 登记行，`CUSTOMER_WRITE` 权限组零路由但仍被角色绑定引用的既有缺陷，与本波报送台改动无关
- `共 2 条 FAIL，其中 GUARD_OPEN（守卫 fail-open，非权限配错）0 条`——两条都不是安全洞，判据"逐字对上登记债即绿判"成立

## 树净收尾（Task 11 主体收尾时点）

`git status --porcelain`（Task 11 文档收口部分完成后）：仅文档改动 + 新篇 + evidence 文件，源码 0 改动（变异测试三点全部还原，见 `mutation-tests.md`）。

## 修 1（主会话打回：audit:vocab 差集必修，不外溢）

**问题**：T6 退役 `INCIDENT_REGULATOR_REPORT_DRAFTED`/`INCIDENT_REGULATOR_REPORTED` 两码时未按本仓退役惯例登记进 `DEPRECATED_AUDIT_ACTIONS`，`npm run audit:vocab` 差集 fail-fast。主会话判定为波内必修（非可外溢的独立任务），当场修复。

**改动**：`src/modules/audit-logging/constants/audit-actions.constant.ts` 的 `DEPRECATED_AUDIT_ACTIONS` 数组追加两码，注释「甲波二 T6 退役（通报单槽收编，事故名册 11→9）」，格式照邻近条目（客户主表裸 CRUD 退役那组）。

**`npm run audit:vocab` 复跑**：
- EXIT: `0`
- 关键行：
  ```
  note: 4 seed codes retired since 2026-09-15: CUSTOMER_DELETED, CUSTOMER_UPDATED, INCIDENT_REGULATOR_REPORTED, INCIDENT_REGULATOR_REPORT_DRAFTED
  分域计数（从常量重算）：... GOVERNANCE: 9 ... 合计 259 码
  已写入 doc-final/lark/2026-09-16-audit-actions-catalog-full.md
  ```
- `doc-final/lark/2026-09-16-audit-actions-catalog-full.md` 词表入库确认：现役 261→259（GOVERNANCE 11→9），退役 115→117，两码从「事故一生」现役表移入附录退役码清单；生成头行日期/基线哈希同步更新

**`npx jest src/modules/audit-logging --colors` 复跑**：
- 第一次：EXIT `1`——`audit-actions.constant.spec.ts` 一条断言红：`第一批 · V1 词表守则 › 退役码 97 个（...）`标题里的叙事没跟数字走，实际断言 `expect(DEPRECATED_AUDIT_ACTIONS).toHaveLength(115)` 与新长度 117 不符——按合同的一部分修正：追加一段叙事「+ 2 甲波二(2026-09-26)T6：INCIDENT_REGULATOR_REPORT_DRAFTED/INCIDENT_REGULATOR_REPORTED 随通报单槽收编退役新入闸，得 117」+ 断言改 `toHaveLength(117)`（**未改动**该测试标题里历史遗留的开头基数「97」——那是早于本次多轮追加就已经与结尾数字不一致的历史标签，非本次改动引入，不在本次修复范围内）
- 第二次：EXIT `0`——`Test Suites: 8 passed, 8 total` / `Tests: 92 passed, 92 total`

**`npx jest src/modules/governance src/modules/audit-logging --colors` 复跑（全域回归）**：
- 默认并行：EXIT `1`——`regulatory-filing-sweep.service.spec.ts` 一条断言红（`marked` 期望 1 实收 2）；诊断确认与本次改动无关，是 `doc-final/TOOLING-DEBT.md:151` 已登记的既有并行 worker 假红（多个 spec 共享同一份 self 栈 `dev.db`，sweep 全表扫描互踩）
- `--runInBand` 复跑：EXIT `0`——`Test Suites: 24 passed, 24 total` / `Tests: 358 passed, 358 total`，确认为已知 flake、非回归

**`npx tsc --noEmit -p tsconfig.json`**：
- EXIT: `0`（无输出）

**树净**：修复提交前后 `git status --porcelain` 仅列出预期改动文件（`audit-actions.constant.ts` + 对应 spec + 词表生成物 `doc-final/lark/2026-09-16-audit-actions-catalog-full.md`），无源码孤儿改动。
