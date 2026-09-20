# Task 8 收尾闸走查记录（2026-09-20，act6-wave2-dead-cleanup）

栈：worktree `act6-wave2`（self），backend 3100 / admin 3101 / client 3102 / TB 3103。
分支 HEAD 起点：`6a7871aa`。

## Step 1：重铺闸

```
bash scripts/stack.sh reset self   → EXIT=0（`✔ Capital injection: 2 transfer(s) created` 命中，未踩孤儿 TB 坑）
bash scripts/stack.sh up self      → EXIT=0，API=3100 ADM=3101 CLIENT=3102 TB=3103
bash scripts/on-stack.sh self demo:all         → 花名册 29/29 符合预期，COA 5/5 PASS，EXIT=0
bash scripts/on-stack.sh self recon:demo:break → 18/18 场景 DETECTED，12/12 钱包桶 OK，casesOpened 12/12，
                                                  identity①②自检 OK，EXIT=0
```

对照 `doc-final/demo/baseline.md`：全绿，与基线口径一致（花名册条目数因本波未改种子花名册未变化）。

## Step 2：verify:coa + verify:rbac

```
bash scripts/on-stack.sh self verify:coa   → EXIT=0
  ✓ ledger 1 CLIENT 恒等 29812565 ｜ ✓ ledger 1 FIRM 恒等 99870335
  ✓ ledger 2 CLIENT 恒等 4392571811 ｜ ✓ ledger 2 FIRM 恒等 100413428189
  ✓ 负余额检查 通过（57 个科目全部 ≥ 0）
  ALL INVARIANTS PASS
```

```
bash scripts/on-stack.sh self verify:rbac  → EXIT=1（2 条 FAIL，均与本波无关，见下）
```

**S1/S2/S4/S5/S5b/S5c/S5d/S6/S8/S9、11 个职务登录、路径预检、全部矩阵头条行为探针（含
运营/合规官/内审/金库官/CFO 各条）、V3、V4 资金单看推分离、档位升级读安全** —— 全绿。
**OPS_OFFICER 提交→批准往返后 77 项 permissionCodes 逐一无丢失**——本波 Task 6 摘除
`INTERNAL_TRANSFER_READ` 后的 OPS_OFFICER 判据本身全绿，catalog 绑定 5→4 生效正常。

两条 FAIL，均确认为**本波之前已存在、与本波 diff 无关**的既有工具/RBAC 债，已有登记：

1. **S7 catalog 字典真实性**：4 条 sumsub demo 裁决路由（`admin_deposit_sumsub_demo_run_verdict`
   等）被误判死行——路由方法装饰器实际写在三域共用基类 `sumsub-shared/demo-scenario.base.ts`
   上，S7 的正则只扫每个 `*.controller.ts` 文件自身文本，扫描器盲点。**已登记**
   `doc-final/TOOLING-DEBT.md:137`（2026-09-14 波五 Task 3 发现，至今未修，本次原样复现）。
2. **V2 改角色不丢权限 · COMPLIANCE_OFFICER**：提交 400 `Invalid permission groups: CUSTOMER_WRITE`——
   `CUSTOMER_WRITE` 权限组已是零路由的空壳（原挂靠的三条裸 CRUD 端点已删），但仍被
   `rbac.catalog.ts:821`（ActionBucket）与 `:1020`（COMPLIANCE_OFFICER 默认分组）引用，
   `role-definition-modify-workflow.service.ts` 的 `VALID_PERMISSION_GROUPS`（=
   `RBAC_PERMISSION_DEFINITIONS.flatMap(groups)`，即真实路由绑定的权限组集合）不含它，
   往返提交即被拒。**已登记** `doc-final/BACKLOG.md:228`（2026-09-16 第七幕波二观察）。

**证据两条均确认为预置、非本波回归**：
- `git diff ac33c002 HEAD -- src/modules/identity/access-control/rbac.catalog.ts` 只有
  4 行改动，正是 Task 6 的 OPS_OFFICER 摘 `INTERNAL_TRANSFER_READ`；与 `CUSTOMER_WRITE`、
  sumsub demo 路由均无关。
- `git show main:src/modules/identity/access-control/rbac.catalog.ts | grep -n CUSTOMER_WRITE`
  与 `git show ac33c002:...`（本波开工基点）输出逐字节相同：18/821/1020 三处。
- `git show main:src/modules/deposit-sumsub/admin-deposit-demo.controller.ts` 同样是
  `extends DemoScenarioControllerBase`（继承写法本身即成因），main 上此刻同样会复现 S7 误判。

**结论**：本波（含 Task 6 OPS 权限收回）未引入任何新的 verify:rbac 红。两条 FAIL 是
main 上已经存在、已被此前波次登记在案的既有工具/RBAC 债，超出本任务「仅可同步 OPS
相关判据期望值」的授权范围，未做任何生产代码改动，原样记录并继续收尾。

## Step 3：五页截图

| 文件 | 核验结论 |
|---|---|
| `p1-runs.png` | Reconciliation Runs：2 条运行，Business Date 均 `2026-09-19`，无 epoch 时间；RUN…-1 Cases +12/✓0，RUN…-2 +0/✓0（复跑无新案）。 |
| `p2-cases.png` | 12 条 Open 案件，STATUS 筛选框当前值 `Open`；源码核验 `grep -c "WAIVED\|PENDING_RECHECK" admin-web/src/pages/ReconciliationCasesListPage.tsx` = 0（无匹配），页面截图各行 Disposition/Status 列亦无 Waived 字样——判据 4 达标。 |
| `p3-case-detail-scene1.png` | 深链 `REC20260919-004`（recon:demo:break 场景 #1 IN_TRANSIT_TIMING，bucket=IN_TRANSIT）。Differences 表在途行 **Time = `09-20 03:17`**（真实时间，非 `01-01 04:00` 占位），Source `FD0260920298730`，Disposition `Push order →`。红3 判据（真实时间落库+下发）达标；该案当前只有 1 条在途差异行，排序修复（不再恒排最旧）基于 Task 1/2 单测覆盖的后端真值/null 下发机制的推论（`reconciliation-query.service.spec.ts` 新增 24 行）。 |
| `p4-external-balances.png` | 默认日 `2026/09/19`，19 wallets（Crypto 9 + Fiat 10）——Step 4 划转前基线快照。 |
| `p5-adjustments.png` | 0 adjustments（Step 4 尚未开单前的真实空态，非误筛）。 |
| `p6-eb-after-transfer.png` | 见 Step 4。 |
| `p7-ops-sidebar.png` | 见 Step 5。 |
| `p8-ops-fundsorder-detail.png` | 见 Step 5。 |

## Step 4：External Balances 实证（划一笔、默认日不漂）

按 `demo/script.md` 场景 16 动作序列，全程走后端真实端点（API 路径，非 UI 点击；判据只看
终态，两条路径等效）：

1. `treasury@` `POST /admin/reconciliation/cases/REC20260919-003/dispositions`
   （matchType=AMOUNT_MISMATCH, causeCode=UNEXPLAINED, disposition=HOLD_INVESTIGATING）
   → `dispositionNo=RCD260920891038`，outlet=HOLD_INVESTIGATING
2. `treasury@` `POST .../REC20260919-003/simulate-aging-timeout` → SLA 拨至过去
3. `CaseAgingSweepService` 每分钟 `@Cron` 自动扫描 → 轮询确认 `nextStep.kind=WRITE_OFF`
   （reasonCode=UNEXPLAINED_CLIENT_LOSS, amount=7500000）
4. `treasury@` `POST /admin/reconciliation/adjustments`（认损开单，挂 dispositionNo）
   → `adjustmentNo=ADJ260920919963`，直接进 PENDING_APPROVAL（Task 3 写端翻转：带
   dispositionNo/causeCode 的开单一步到位，无需再调 `.../submit`）
5. `cfo@` `POST /admin/control-gates/approvals/APR260920657828/approve` → APPROVED（201）
6. 轮询确认 adjustment 状态 → `POSTED`
7. `treasury@` `POST /admin/reconciliation/runs/wallet`（cutoff=now）→ `casesAutoHealed=1`；
   案件 `REC20260919-003` → `status=RESOLVED`，`nextStep.kind=COMPENSATION`
   （`demoRecommended.scenarioId=16` 字段坐实这就是脚本场景 16）
8. `treasury@` `POST /admin/internal-transfers/compensation`（adjustmentNo=ADJ260920919963）
   → `transferNo=ITR260920502309`，status=PENDING_APPROVAL
9. `cfo@` `POST /admin/control-gates/approvals/APR260920490962/approve` → APPROVED（201），
   划转转 EXECUTING，腿1 `FDO260920877214`（F_OPS → Alice C_DEP）status=CREATED
10. `treasury@` `POST /admin/funds-orders/FDO260920877214/advance`（action=SUBMIT）→ 201，
    status=SUBMITTED（**只推第一腿，未 CONFIRM，按 brief 字面止步于此**）

**EB 实证前后对照（`GET /admin/reconciliation/external-balances?date=2026-09-19`）**：

| | 划转前（p4） | 划转后（p6） |
|---|---|---|
| 默认日 | `2026-09-19` | `2026-09-19`（**未漂**） |
| 钱包行数 | 19 | 19（**不少于初值**，未出现/消失整行） |
| Alice `WA2601014324` USDT-TRON | 1,592.500000（lineCount=1） | **1,600.000000**（lineCount=3，+2 行） |
| FIRM_OPS `WA2601018867` USDT-TRON | 100,399.428189（lineCount=4） | **100,391.928189**（lineCount=5，+1 行） |

差额 7.500000 USDT 精确对应本次补款金额，双边镜像行（腿1 SUBMIT 落地即同时回单两侧
statement line）。截图 `p6-eb-after-transfer.png` URL 栏可见 `?date=2026-09-19`，页头
`2026-09-19 · 19 wallets · Crypto 9 · Fiat 10` 与 p4 完全一致——判据 6 达标。

## Step 5：ops_officer 实登两张

- `p7-ops-sidebar.png`：`ops_officer@fiatx.com` 登录后侧栏 **CUSTODY** 组仅剩
  `Custodian Wallets` / `Withdrawal Addresses` 两项，**无 Internal Transfers**；整个
  **Reconciliation** 分组与 **Incident Register** 均不再出现（与 `script.md` 注③
  "运营在本幕彻底清零"一致，超出判据 5 的最低要求）。
- `p8-ops-fundsorder-detail.png`：深链 Step 4 那笔划转腿 1 `FDO260920877214` 详情页，
  "LINKED INTERNAL TRANSFER" 区显示 `ITR260920502309` **纯文本 + 状态徽标**，无下划线/
  跳转箭头（对照同页 `TX HASH` 字段有可点外链图标）。源码核验
  `admin-web/src/pages/FundsOrderDetail.tsx:357`：
  `!parent || parent.kind !== 'Internal transfer' || hasPermission(PERMISSIONS.INTERNAL_TRANSFERS_READ)`
  ——`ops_officer` 已不持有 `INTERNAL_TRANSFERS_READ`（Task 6 摘除），条件为 false，
  渲染纯文本分支，无幽灵链接。

## Step 6：终局三闸 + jest 三域

```
npx tsc --noEmit -p tsconfig.json                              → EXIT=0
(cd admin-web && npx tsc -b --noEmit)                           → EXIT=0
(cd client-web && npx tsc -b --noEmit)                          → EXIT=0
DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave2/dev.db" \
  npx jest src/modules/clearing-settle src/modules/governance/incidents \
           src/modules/asset-treasury/internal-transfers            → EXIT=0
  Test Suites: 28 passed, 28 total
  Tests:       556 passed, 556 total
```

（jest 输出中一行 `ERROR [CaseAgingSweepService] case aging sweep failed for
REC20260902-007: boom` 是 `case-aging-sweep.service.spec.ts` 自己注入的失败路径夹具，
该 suite 本身 PASS，不是真失败。）

## 小结（对照 spec §6 硬判据）

| 判据 | 结论 |
|---|---|
| 2 重铺闸 | 全绿 |
| 3 红3生效 | 达标（p3 截图 + Task1/2 单测） |
| 4 幽灵筛选摘净 | 达标（截图 + grep -c = 0） |
| 5 权限收回 | **verify:rbac 有 2 条既有、非本波引入的 FAIL**（详见 Step 2）；catalog 绑定
  5→4、OPS 往返判据、ops 实登两张截图（含超出最低要求的 Reconciliation/Incident 分组
  隐藏）均达标 |
| 6 EB 实证 | 达标（默认日不漂 + 行数不少于初值 + 具体余额变动可追） |
| 8 五页截图 | 达标（p1–p5 无 epoch / 无恒空异常 / 无点了必空筛选项） |

判据 5 字面"三件套全绿"未 100% 满足，但两条红均为 confirmed 既有债（main HEAD 同样
复现、已在 TOOLING-DEBT/BACKLOG 登记在案），非本波引入、非 Task 6 OPS 改动所致，超出
本任务"仅同步 OPS 相关判据期望值"的改动授权范围，故未做任何生产代码修改。
