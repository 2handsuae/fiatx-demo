# SDD ledger — plan: doc-final/superpowers/plans/2026-09-26-campaign-a-wave2-regulatory-filing.md

Spec: doc-final/superpowers/specs/2026-09-26-campaign-a-wave2-regulatory-filing-spec.md（权威）
Base: af8dacbd（worktree-act-a-wave2-filing，自 main 快进）
模型档位：实现与任务级 review = sonnet（执行档）；终审 = 省略 model 走继承（不降档）。

## 开工前冲突扫描（2026-09-26）

| 对 | 生产 vs 消费 | 结果 |
|---|---|---|
| T1↔T3 | FilingStatus/FILING_TRANSITIONS/DTO/getFilingTypeConfig/INCIDENT_REPORT_BASES.authority | 名称逐一对上，无冲突 |
| T2↔T3/T7/T10 | prisma 字段（deadlineAt/overdueMarkedAt/basisCode/incidentNo/submittedAt/traceId/approvalNo/cancelledReason/createdByUserId/receivedAt） | T3/T7/T10 引用的每个列名都在 T2 schema，无冲突 |
| T3↔T4 | markSignoffRequested(filingNo,approvalNo,actor) / applySignoffDecision(filingNo,decision,event) / findByNo | 签名一致 |
| T3↔T6 | openForIncident(入参={incidentNo,type,title,createdAt,customerNo?,traceId}) / summaryForIncident 返回键集 | incident 行含全部入参键；close 守卫消费 status/basisCode/submittedAt/filingNo 都在返回键集 |
| T3↔T7 | FILING_OVERDUE_MARKED requiredFields=['deadlineAt'] | ⚠️ T7 若直调 recordSystem（照 swap-sla 模板）必须把 deadlineAt（ISO 串）放 extra/顶层，否则写入被拒——**入 T7 派发词** |
| T4↔T5 | workflow.submitForSignoff → controller /signoff | 一致 |
| T5↔T6 | 同文件 rbac.catalog.ts：T5 加 9 行、T6 删 2 行（regulator-report） | 不同 route 行，串行无冲突 |
| T6↔T9 | 后端 getView 停发六字段，admin-web 本地接口类型仍声明（IncidentDetailPage:70-76） | T6 后闸③仍绿（前端自声明类型），运行时 undefined 到 T9 收口——plan 原文已写，成立 |
| T6↔T8 | assess 返回 {filingsOpened} / e2e 六段 | 一致 |
| T4↔T5 时序 | T4 加 policy 后 verify:rbac S8 需要 MAKER 表行（T5 才加） | verify:rbac 只在 T5 Step 5 跑，T4 闸不含它——无 gate 破绽 |
| 各任务自洽 | T1 测试断言=注册表实数（5 类/6 态）；T5 路由 9=controller 端点 9（GET2+POST7）；T11 计数（14 域 68 桶 76 组）=T5 增量（+1 域+2 桶+2 组） | 自洽 |

扫描结论：零红。一条注意事项（T7 deadlineAt 顶层）入派发词。

## 任务进度
Task 1: implementer DONE (commit 5c0e0ada, tests 7/7 + incidents 187/187, tsc 0) — review dispatched
Task 1: minor (deferred): filing-type-registry.spec.ts:106 describe 串留 `§?` 占位（引用风格瑕疵，终审时顺手清）
Task 1: complete (commits af8dacbd..5c0e0ada, review clean)
Task 2: implementer DONE (commit 070c1087, tsc 0, sqlite 两表实证; 环境准备 npm ci + reset self) — review dispatched
Task 2: complete (commits 5c0e0ada..070c1087, review clean)
Task 3: dispatched (BASE 070c1087)
Task 3: implementer DONE (commit 7f39defd, 10 suites/122 passed; 自报两关注点交评审: 真Prisma测试=brief指令 / authority校验推广到全类型) — review dispatched
Task 3: minor (deferred): saveDraft 首次判定用 !row.body 真值检查，空串首存会重记 DRAFT_SAVED（边缘，终审triage）
Task 3: minor (deferred): openForIncident 逐码循环不包事务（演示系统章程内合规，park）
Task 3: carry→T5: ①OpenFilingBodyDto 的 title 对手工开单必填（spec §1「手工开单必填」，T3 service 缺省落 cfg.label）②ccAuthorities 值域校验（∈机构目录）落 DTO/class-validator
Task 3: complete (commits 070c1087..7f39defd, review clean)
Task 4: dispatched (BASE 7f39defd)
Task 4: implementer DONE (commit 21187d81, 8 suites/77 green; 自报: impact串用人话机构名替raw code, handler无独立spec照事故先例) — review dispatched
Task 4: note: impact 串 authority 人话化=评审裁定合理改良(objectSnapshot.authority 顶层仍存原始码);评审做过变异实证(只吃APPROVED则3用例红)后已还原
Task 4: complete (commits 7f39defd..21187d81, review clean)
Task 5: dispatched (BASE 21187d81; 携带 T3 两条 DTO 项)
Task 5: implementer DONE (commit 0393209f, 264/264 jest + approvalEntityRoutes 1/1 + admin-web tsc 0; 新探针 1 ALLOW+cleanup + 3 DENY 全过)
Task 5: Ruling: plan「verify:rbac 全绿」判据在本仓现状不可达——2 处存量红经双证坐实为登记债(S7 demo-verdict 盲点=TOOLING-DEBT 2026-09-14 f35b72de / CUSTOMER_WRITE 死组=BACKLOG 甲波一升级行,均先于基线且 T5 diff 零触碰) — 判据修正为「T5 相关判定与新探针全绿、仅存 2 红与登记债逐字对上」。代价若错: 若两红实为本波引入则终审全量对照会再逮。
Task 5: complete (commits 21187d81..0393209f, review clean; ⚠️compliance_lead 键有效性由实跑探针证据覆盖)
Task 6: dispatched (BASE 0393209f; self 栈在跑)
Task 6: implementer DONE (commit 2bf472ad, 23 suites/350 + e2e 10/10 + 三端 tsc 0; 自报两偏差: e2e中段400撞复合守卫改单测隔离 / 退役grep src余20处自称注释或回归断言) — review dispatched(重点核两偏差)
Task 6: minor (deferred): T6 报告退役清点表 src/ 计数 20 vs 实测 19（纯报告数字疏漏，判定结论不变）
Task 6: minor (carry→T7): regulatory-filing.service.ts:142 头注释「由 IncidentService.assess 调用」已失实（调用点已挪 workflow）——T7 同模块顺手改写
Task 6: complete (commits 0393209f..2bf472ad, review clean)
Task 7: dispatched (BASE 2bf472ad; 携带: 审计 deadlineAt 顶层传 + :142 注释顺手清)
Task 7: implementer DONE (commit 35c77e60, 4 suites/53 green 含真AuditLogsService合同证明; :142 注释已顺手清) — review dispatched
Task 7: minor (deferred): sweep spec 注释把「非原子写审计」错引为 swap-sla 先例（实际 swap-sla 是事务内回滚；本模块 T3 序列写法才是真先例）——措辞修正留终审 triage
Task 7: complete (commits 2bf472ad..35c77e60, review clean)
Task 8: dispatched (BASE 35c77e60)
Task 8: implementer DONE (commit 279c4495, 新文件 6/6 + 与事故e2e联跑 16/16 绿; 红证据=故意改72h→73h真红后还原)
Task 8: Ruling: 全量 test:e2e 12/22 套件红 = 存量环境债——TOOLING-DEBT:76(reset后e2e专用库悬空未provision)+:78(共库互踩根因未解)双证 + 实现者 A/B 隔离实验(摘除新文件同12红)。波闸判据取「新文件全绿+相关联跑全绿」，不得对外宣称全量e2e绿。代价若错: 若12红中混入本波引入项,终审全量对照与收尾闸⑥⑧会再逮。
Task 8: complete (commits 35c77e60..279c4495, review clean 零缺陷)
Task 9: dispatched (BASE 279c4495)
Task 9: implementer DONE (commit c918785f, 双端 tsc 0, admin-web 退役 grep 23→0; 四截图落盘) — 控制器已亲验四图(超时红行/SIGNED_OFF动作/受控下拉+钟提示/事故区块; 侧边栏项在 DashboardLayout:398, 图1图2 未见系视口截断) — review dispatched
Task 9: review Needs fixes — Important×2(Incident列非链接 / 送签存草稿加brief外文本一致门控) + Minor×1(close的window.prompt note投机) — fix round 1 resume原实现者
Task 9: fix round 1/5 (3 addressed, 0 open — Incident列改Link+stopPropagation / 门控回纯公式 / prompt删; commits c918785f..96191918)
Task 9: minor (deferred): 送签按钮下方说明文案「Requires a saved, non-empty draft」在门控下沉后端后语义漂移（复审out-of-scope观察）——终审triage顺手改一句
Task 9: complete (commits 279c4495..96191918, review clean after 1 fix round)
Task 10: dispatched (BASE 96191918)
Task 10: implementer DONE (commit 35ccefb8; reset→up→demo:all 全绿; 顺手修 reset-business-data.ts 漏登两新表[58+7行残留实证]; sweep spec 并行 flake 登 TOOLING-DEBT[--runInBand 两次绿]) — review dispatched
Task 10: complete (commits 96191918..35ccefb8, review clean 零缺陷; reset-business-data 顺手修判定=必需配套成立)
Task 11: dispatched (BASE 35ccefb8)
Task 11: implementer DONE (commit 368e5eb1; 十项产出全落, 变异3/3红绿, 收尾闸全绿[verify:rbac 仅2存量红逐字对上]) — concern: audit:vocab 差集 fail-fast=T6 退役两码漏登 DEPRECATED_AUDIT_ACTIONS
Task 11: Ruling: vocab 缺口判波内必修(spec §5.4 承诺词表重跑入库), 撤外溢任务卡 task_b3f16347, 修复轮1 resume 实现者. 代价若错: 若 DEPRECATED 登记另有惯例, 终审逐条追会逮.
Task 11: fix round 1/5 (1 addressed: 两退役码入DEPRECATED, audit:vocab exit 0 [259活/117退]; commit 62752793) — review dispatched (docs+fix 双提交)
Task 11: review Needs fixes — Important×1(v1-gov §4/§5 旧计数 13域66桶/74组 同文件矛盾) — fix round 2 resume 实现者
Task 11: minor (deferred): demo/script.md:24「12域51桶」为早于本波的陈年漂移（评审判非本任务缺陷）——终审 triage
Task 11: fix round 2/5 (1 addressed: 两处旧计数同步; 复审逮到修复引入的新 Minor: v1-governance.md:59 括号 9开8闭未闭合——Minor级不延环, 挂账终审修复波; commits 62752793..22a59ed8)
Task 11: minor (deferred): v1-governance.md:59 括号未闭合（修2引入，补一个）即平）
Task 11: complete (commits 35ccefb8..22a59ed8, 2 fix rounds)
== 全部 11 任务完成，进入终审 ==
终审: dispatched (af8dacbd..22a59ed8, 14 commits; 不降档=省略model继承Fable; 包567KB)
终审: Ready to merge after listed fixes — Important×1(export-audit-vocab 未纳报送十码册,目录缺整域) + merge前顺手×2(v1-gov:60 115→117 / :59括号) + 修复波若干词级; 三 Ruling 全采信(T11 vocab 修复判「不完整」→并入 Important-1 根修)
终审 Ruling: spec §9「审计留痕区照惯例」——实现取事故页口径(无中央审计区,审计中心反向跳转已接)成立,不补区块不改文档;「惯例」两读取窄读。代价若错: 业主走查若要求页内审计区,波三补。
终审 fix wave: ONE dispatch — ①exporter纳册+10码说明+重跑vocab+目录重生成(259→269) ②v1-gov:60 117 ③:59括号 ④spec§?→§2 ⑤sweep注释错引改写 ⑥script.md 12域51桶两处改现值 ⑦种子两单补body ⑧词表闭合spec八→九册 ⑨v9§4按钮实名+即时口径 — T9文案项按终审triage留档不修
终审修复波: complete (commit 1d4c0618, 9/9 ADDRESSED, 复审零新破坏) — 分支就绪
