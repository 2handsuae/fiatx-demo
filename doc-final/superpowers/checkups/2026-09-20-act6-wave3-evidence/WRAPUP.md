# WRAPUP：第六幕清残留 · 波三「主体分层」

- Spec：`doc-final/superpowers/specs/2026-09-20-act6-wave3-subject-layering-design.md`
- Plan：`doc-final/superpowers/plans/2026-09-20-act6-wave3-subject-layering.md`
- Worktree：`.claude/worktrees/act6_wave3` ｜ branch `worktree-act6_wave3` ｜ base `fcaa9929`
- Commit 链：`fcaa9929`(plan) → `c385b9b4`(T0) → `8e733cdf`(T1) → `213980e8`(T2) → `946b709a`(T3) → `bb6cf4f8`(T4) → `8cdda759`(T5) → `4e10eff2`(T6) → `06c89dd0`(T7) → `328b15ac`(T8) → `5c36a712`(T9) → 本任务(T10)
- 执行日期：2026-09-20

## 一、spec §5「闸与验收」九道闸逐条实测值

| # | 闸 | 判据 | 本次实测 |
|---|---|---|---|
| 1 | 栈级输出 diff（唯一硬判据） | 归一后逐字节 diff = 空 | **两份均空**：`demoall-diff.txt` 0 字节、`break-diff.txt` 0 字节（`wc -c` 实测，见下）；`.norm.txt` 行数 after=before 逐一致（112/95） |
| 2 | 闸①②③ | 全绿 | 三闸均 `exit 0`，零输出（见下方摘录） |
| 3 | jest 对账三域 | 全绿；基线 28/556 + 本波新增 | **29 suites / 561 tests，全绿**（波前 28/556 → +1 suite/+3 tests=T1 Case 主体服务 → T2 迁移零增量 → T4 三用例等量迁移零增量 → T7 既有测试内补 1 断言不改计数 → +2 tests=T8 处置门 → 终值 29/561，逐层归因见下） |
| 4 | 迁移表真实调用 | 变异实证：对已 RESOLVED 案再 resolve 被拒；拆掉 assertTransition 测试必红 | 物证在案：`mutation-transition-red.txt`（拆线后红）+ `mutation-transition-green.txt`（还原复绿），T4 报告已附并经评审独立复跑 |
| 5 | 处置门 | 变异实证：拆掉 sourceAdjustable 门，矩阵断言必红，还原复绿 | 物证在案：`mutation-firm-gate-red.txt` + `mutation-firm-gate-green.txt`，T8 报告已附（red 恰在第 2 条断言败） |
| 6 | `as any` 归零 | 复现命令输出 0 行 | **本次复跑实测 0 行**（命令见下）；`this.prisma as any` 次级探针命中 1 行注释，非代码回潮（见五、） |
| 7 | Case 直写归零 | 复现命令只命中 `reconciliation-case.service.ts`（5 处） | **本次复跑实测：5 处，全部在 `reconciliation-case.service.ts`**（:68/:113/:146/:161/:175），唯一文件判据达成 |
| 8 | `verify:coa` | 恒等式 + 负余额全绿 | **全绿**：4 条恒等式 PASS + 57 科目负余额检查 PASS（摘录见下） |
| 9 | `verify:rbac`（若跑） | 预期仍是既有 2 条 FAIL | **本波不跑**——本波不动权限，brief 明示跳过 |

## 二、命令与摘录

### 闸①②③

```
$ PATH=".../v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json          → exit 0，零输出
$ cd admin-web  && PATH="...:$PATH" npx tsc -b --noEmit                    → exit 0，零输出
$ cd client-web && PATH="...:$PATH" npx tsc -b --noEmit                    → exit 0，零输出
```

### jest 三域

```
$ DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave3/dev.db" npx jest \
    src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers

Test Suites: 29 passed, 29 total
Tests:       561 passed, 561 total
Time:        8.808 s
```

**jest 数字归因链**（28/556 → 29/561）：
- T1（Case 主体服务 + 迁移表）：+1 suite（`reconciliation-case.service.spec.ts`）/ +3 tests → 中间值 29/559
- T2（recon-run 写点改经主体服务）：spec 注入真服务，既有断言零改动，计数不变
- T3（两 util 收敛）：零改计数
- T4（拨钟+破线标记收敛）：三用例等量迁移（搬家不新增），计数不变
- T5/T6（拆 run()/getCase()，挪 FlowComparisonBuilder）：机械拆分零改计数
- T7（铁律③ approvalNo 回填改法）：既有测试内补 1 条真锚断言，不改计数（spec 数不变、test 数不变——断言加在已有 test 内部）
- T8（dispositionsFor 补 AMOUNT_MISMATCH×FIRM 硬边界）：+2 tests → 终值 29/561
- T9（as any 扫尾 18 处 + DTO 补字段）：零改计数（纯类型层，无新测试）

终值 **29 suites / 561 tests**，与 T9 报告独立复跑值完全吻合。

### 栈级输出 diff（Step 2）

采样流程与 Task 0 同一栈（self）、同一命令：`stack.sh reset self` → `stack.sh up self` → `on-stack.sh self demo:all` → `on-stack.sh self recon:demo:break` → 归一 → diff。

```
$ diff demoall-before.norm.txt demoall-after.norm.txt | tee demoall-diff.txt
$ wc -c demoall-diff.txt
0 doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence/demoall-diff.txt

$ diff break-before.norm.txt break-after.norm.txt | tee break-diff.txt
$ wc -c break-diff.txt
0 doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence/break-diff.txt
```

两份 diff **真为空**（0 字节，非"看起来空"）。归一规则沿用波一入档的 `normalize-rules.sh`（六类天然变动值：进程号 / UUID / 业务单号 / 人读时间戳 / ISO 串 / `wallet=` 8 位 hex），本次**未新增任何归一规则条目**——空 diff 是在既有规则下直接达成的，没有出现"归一规则没盖住的天然变动"需要补规则的情况，也没有出现真行为差异。`demo:all` 尾部 `asserts: 5/5 PASS`、`recon:demo:break` 尾部 `ALL 18 SCENARIOS DETECTED PER MANIFEST`，both 与波前基线（Task 0）逐字节一致。

### 判据 6/7 grep（Step 4，波三 spec §1.1/§1.3 复现命令）

```
$ grep -rn "reconciliationCase\.\(create\|update\|updateMany\|upsert\|delete\)" src --include='*.ts' | grep -v '\.spec\.ts'
src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts:68
src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts:113
src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts:146
src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts:161
src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts:175
（5 处，全仓唯一文件——判据 7 达成）

$ grep -rn " as any" src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers \
    --include='*.ts' | grep -v '\.spec\.ts' | grep -v "this\.prisma as any" | wc -l
0
（判据 6 达成）
```

### `verify:coa`（Step 3）

```
$ bash scripts/on-stack.sh self verify:coa
✓ ledger 1 CLIENT 恒等 29812565
✓ ledger 1 FIRM 恒等 99870335
✓ ledger 2 CLIENT 恒等 4392571811
✓ ledger 2 FIRM 恒等 100413428189
✓ 负余额检查 通过 (57 个科目全部 ≥ 0)
ALL INVARIANTS PASS
```

## 三、DTO 补字段说明（T9 落地，本任务复核确认未回潮）

`src/modules/audit-logging/dto/audit-log.dto.ts` 的 `CreateAuditLogEventDto` 紧挨 `payloadDigest` 后新增两个可选字段：

```ts
/** 词表 requiredFields 顶层声明（同 authnMethod/payloadDigest 先例）：
 *  RECON_DISPOSITION_RECORDED 声明 causeCode/outlet 必填，assertActionSpec 只查 input 顶层。 */
@ApiPropertyOptional() @IsOptional() @IsString()
causeCode?: string;

@ApiPropertyOptional() @IsOptional() @IsString()
outlet?: string;
```

**依据**：`audit-actions.constant.ts:871` `RECON_DISPOSITION_RECORDED.requiredFields = ['causeCode','outlet']`——词表已经声明这两个字段是该动作码的顶层必填项，但 DTO 之前没有声明对应属性，导致调用方只能靠 `as any` 绕过 tsc 检查把这两个字段塞进 envelope。这不是新增业务字段，是把词表已声明、代码已在用、类型系统此前看不见的两个字段**补上类型声明**——照 `authnMethod`/`payloadDigest` 两个既有可选字段的先例文体（均为 `@ApiPropertyOptional() @IsOptional() @IsString()`），不改变任何运行期行为，只是让 tsc 从"照不到"变成"看得见"。

## 四、熔断触发情况

**零**。全波（T0–T10）逐任务自查 + 评审复核，无一处触发 spec §6 熔断条款（DTO 放宽 / 载荷字段规整 / 新增未知键）。T9 report 明确记录"无一处把 `as any` 换成等价逃逸（如 `as unknown as X`），无一处把顶层字段塞进 metadata，无熔断触发"；incidents controller 4 处属性收窄未出现"不在 Body 也不在服务侧 interface 的键"。**限定**：该结论指本波 T9 那 18 处修复动作本身——摘 cast 时未顺手造出新的等价逃逸。它不等于"仓库里没有等价逃逸形态"：修复过程中改用的 `const subjects: any[]` 局部变量声明与波二遗留的一处 `as unknown as string[]` 二段式断言仍然存在，属于 `" as any"` 字面量 grep 判据本身照不到的既有/新增形态，详见 §六。

## 五、`this.prisma as any` 次级探针——1 行注释命中如实登记

判据 6 主 grep（` as any` 排除 `this\.prisma as any`）本次复跑为 **0 行**，达标。但另跑一次次级探针（`this\.prisma as any` 本身）：

```
$ grep -rn "this\.prisma as any" src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers --include='*.ts' | grep -v spec
src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.ts:157:
    // `(this.prisma as any)` 取数（2026-09-19 波一已摘净），tsc 照不到，合并后会在运行期才炸成
```

**命中 1 行，核实为注释文本**（讲述波一历史，解释 `wallet.asset` 字段为何被移除），不是代码里的真实 `this.prisma as any` cast；`git log` 可查该行属波一/波二遗留、非本任务改动引入。波一战场（`this.prisma as any` 真实 cast）本身确认未回潮为 0 处真实 cast。此项如实记录，不视为闸红。

## 六、残留形态与新登记两条债——指引

`" as any"` grep 判据照不到的两类残留逃逸形态、以及 T0 发现的一处既有脚本路径问题，本任务已追加登记到 `doc-final/TOOLING-DEBT.md` 末尾（照原第 143 行销账后的既有格式）：

1. **三域残留类型逃逸清册**——`const subjects: any[]` 三处（`adjustment.service.ts:832/:960`、`push-order.service.ts:241`）+ `as unknown as string[]` 一处（`internal-transfer.dto.ts:32`，波二遗留）：审计 envelope 的 subjects 数组仍绕过枚举检查，" as any" 字面量 grep 照不到这类形态（`any[]` 声明 / `as unknown as` 二段式断言）。**提不修**，留待下一次系统性清理。
2. **`recon-demo.ts` break 清单落盘路径写死 main 栈**：`/tmp/exchange_js_main/recon-demo-manifest.json`，self 栈跑批也写 main 路径（T0 对照组采样时发现，既有脚本行为，非本波引入）。**提不修**。

两条均只登记复现命令与来源，不修、不讨论、不进 plan（`CLAUDE.md §4` 技术兜底出口规矩）。

另有一处**只提不改**、留终审分诊的死码线索（Ruling R3 第③项）：`recon-run` 顶部的 `AuditActions` import 系波前既有死导入（base 侧零使用点，T2 评审经 `git show` 复现），按"别人的死码只提不删"原则未清；不新登记 `TOOLING-DEBT.md`（未达该文件的登记门槛，只是一行未使用的死 import），仅在此存档以免线索随波三 spec 归档而失踪。

## 七、对照 `rules/delivery-checklist.md` 逐条

| 触发行 | 是否命中 | 说明 |
|---|---|---|
| 任何持久状态变化 → 写审计 | 否 | 本波零新增审计动作码、零新增持久状态写点（Case 迁移表在 T1 已完成，本任务只收尾验证） |
| 新增审计动作码 | 否 | 无新码，只补 DTO 两个可选字段声明 |
| 新状态/新结局 | 否 | 本波不新增状态或边（T1 已完成迁移表建设，属前序任务） |
| 动了钱 | 是（记账边界调用点被动过，非新行为） | `verify:coa` 已跑，全绿（见二、） |
| 该走 maker-checker | 否 | 不涉及 |
| 新增 maker-checker 审批策略 | 否 | 不涉及 |
| 新增权限组 | 否 | 不涉及 |
| 新增 admin 端点 | 否 | 不涉及 |
| 新增业务动作 | 否 | 本波无业务面变化 |
| 退役业务动作 | 否 | 不涉及 |
| 改了交易三域任一 | 否 | 不涉及 |
| 新字段/新状态到客户面 | 否 | DTO 两个可选字段是后端内部审计载荷，不到客户面 |
| 涉及金额 | 否（无新金额字段） | 不涉及 |
| 对外识别 | 否 | 不涉及 |
| 新事件 | 否 | 不涉及 |
| 改 schema | 否 | 本波不动 schema（T1 的迁移表是既有任务，非本收尾任务范围） |
| 改页面或种子 | 否 | 不涉及 |
| 改了前端 | 否（admin-web/client-web 零 diff，已闸②③核验） | 不触发截图闸 |
| 本任务是多波中的一波 | **是** | 承接记录写入波四骨架（见下），本波 spec 随后归档 |
| 每轮收尾 | **是** | 文档分层收口 + CHANGELOG 一行（见八、） |

## 八、文档分层收口

- 波四骨架：`doc-final/superpowers/specs/2026-09-20-act6-wave4-skeleton.md`（新建）
- 总纲状态行：`doc-final/superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` 第 7 行回写"波三 已完成 ｜ 波四 骨架已立"
- `CHANGELOG.md`：顶部加一行

`Documentation updated: modules§5(TOOLING-DEBT 两条新债) / demo(none) / decisions(none) / 总纲状态行+CHANGELOG+波四骨架 — 波三主体分层收尾闸全套通过，行为零差异栈级证据两份均空`
