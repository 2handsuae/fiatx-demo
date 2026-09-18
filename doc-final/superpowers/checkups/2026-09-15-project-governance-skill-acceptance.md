# project-governance skill 验收报告

2026-09-15 ｜ 交付物：`~/.claude/skills/project-governance/`（自带 git，14 commits）｜ 计划：`plans/2026-09-15-project-governance-skill.md`

## 一、RED 基线（Task 1，三跑史）

1. 首跑作废：skill 于运行中途落盘，基线代理扫到并直接触发（污染）。意外实证＝description 自然触发有效。
2. **二跑＝采用的"知情基线"**：skill 已隐藏，但本仓 cwd 的子代理自动加载项目 CLAUDE.md（即方法论本体）。污染方向保守——基线被强化，GREEN 差距只会低估 skill 增益。
3. 三跑（`claude -p` /tmp 干净上下文）：CLI OAuth 过期未执行；业主 `claude login` 后可补纯净基线。

基线结论：即便方法论全文在上下文里，徒手复刻仍**系统性丢失机制件**（触发式清单、三行头、桶准入判据、评审封闭面、真相/验收双层），只搬走口号件（封闭性句、禁读句）；且代拍了三条铁律（正是 skill 禁的）。明细见 skill 仓 `dev/baseline-red.md`。

## 二、GREEN 开荒演练（Task 8）

NoteApp 九问模拟答卷，sonnet 演练、主会话直查产物验收：**基线 10 检查点全部翻正、抽查 3 条全过、模板注释零残留、零修复轮**。亮点：判断标准从答案推导成两句判别式、铁律零代拍留空注明、README 显式豁免注记。裁定留档：种子=业主给的事实、措辞=安装工作（PARKED 判据由 Q2+Q3 拼接判合格）。明细见 skill 仓 `dev/green-drill.md`。

## 三、占位符扫描（Task 9）

`grep -rn 'TBD|TODO|待补|FIXME|XXX'`（除 dev/）：唯一命中为补装流程"盘点现有文档（含散落的 TODO…）"——被盘点对象的名词，判假阳性。`grep -rL '样例非内容' references/`：空，11 处标注齐。

## 四、反向检验映射表（doc-final 构件 → 骨架槽位）

| doc-final 构件 | 槽位 / 排除理由 |
|---|---|
| CLAUDE.md §0–§10 | charter 模板 §0–§10 逐节对位 |
| rules/delivery-checklist.md | templates/delivery-checklist.md |
| rules/review-rubric.md | templates/review-rubric.md（终审补路由行后闭环，见五） |
| rules/backend·frontend-*·audit-logging | charter §5"落地写法外链 docs/rules/"槽，项目自扩展 |
| decisions.md | templates/decisions.md |
| BACKLOG / PRODUCTION-NOTES / TOOLING-DEBT | debt-buckets 三段；PARKED 命名规则明文涵盖 PRODUCTION-NOTES |
| modules/ ＋ overview | 真相层轻量件 |
| demo/{script,baseline,data,simulated-externals} | acceptance/ 验收层槽，形态项目自扩展 |
| superpowers/{specs,plans,checkups} ＋ archive | 目录骨架＋归档协议（checkups 半句终审补齐） |
| CHANGELOG.md | 轻量件 |
| ui-contract/ | 被 rules/frontend-* 链到→封闭性"被链到"条款覆盖 |
| lark/ ＋ reference/ | 单向出口/业主自留条款（methodology §1 补句，计划预判命中） |
| 战役总纲 / 波骨架（specs 内活文件） | campaign-charter / wave-spec-skeleton 模板 |
| §11 明示不装 | 模型分层原则与证据纪律个人层（全局 CLAUDE.md）、worktree（superpowers 已有）、一切肉 |

**零丢件。**

## 五、终审（Fable，全仓 12 commits）与修复

必修 1 条＋建议 3 条，全部采纳，一个修复 commit（`b2dddff`）收口，控制器逐处 grep 复核：

1. **必修**：charter 缺"评审 → rules/review-rubric.md"路由——生成项目里评审规约成路由孤儿、当天违反封闭性 → §8 路由表加行
2. §6 归档补"checkups 随其战役同生命周期归档"
3. SKILL.md 拷贝行写明改名（原"同名文件拷贝"名实不符）
4. 自检三行头豁免扩展至 `*.template.md` 拷贝件
5. 补装流程补"缺骨架件先按开荒第 2–3 步生成"尾注

执行期判例（入 ledger）：基线先于交付物落盘；娘家仓测不出无先验基线；替代证据到手前不清旧证据；haiku 修复者会把"只压 X"执行成"每处都压"——修复落点必复核。

## 六、结论

**验收通过**：spec §12 三判据全过（开荒演练零修复轮、模板无悬空、反向检验零丢件），终审必修项已修复并复核。skill 已就位 `~/.claude/skills/project-governance/`，系统已识别。
