# SDD ledger — plan: doc-final/superpowers/plans/2026-09-25-campaign-a-wave1-incident-taxonomy.md

Spec: doc-final/superpowers/specs/2026-09-25-campaign-a-wave1-incident-taxonomy-spec.md（约束权威）
Worktree: .claude/worktrees/act_a_wave1_incidents ｜ branch worktree-act_a_wave1_incidents ｜ BASE-T1: a09cab98
Baseline: tsc OK ｜ incidents jest 5 suites / 128 tests 全绿
模型映射（项目附录A）：实现=sonnet ｜ 任务评审=sonnet，高危面（T5/T8/T9）评审=opus ｜ 终审=继承（fable，不降档）

## 预检冲突扫描（执行前）

| 对 | 生产 vs 消费 | 结论 |
|---|---|---|
| T1×T2（同文件 incident.constants.ts） | T1 改 REPORT_BASES 区、T2 改 IncidentTypes 区；T2 注册表引用 T1 新键 PDPL_ART_9 等 | 顺序依赖成立，无冲突 |
| T1×T6 | T1 目录条目类型 {label;hours;immediate?}；T6 给 TIR_II_C_24H 加 chainStart | 见 Ruling-1 |
| T2×T8 | 注册表 closeActionType 字符串字面量 = ApprovalActionTypes 键值同名（'X':'X' 形状） | 字面量可直接当 actionType 值，成立 |
| T2×T9 | 注册表 operatorGroup 组名 = T9 catalog 联合类型新增四名 | 名称三处（T2 测试/T8 常量/T9 目录）一致，已核 |
| T4×T5 | getUserPermissionGroups 产出 → T5 消费 | 见 Ruling-2（模块接线是 plan 缺口） |
| T5×T9 | T9 前路由仍只认 INCIDENT_WRITE，T5 单测走 mock 不受影响；e2e 在 T11 | 顺序成立 |
| T8×T9（同文件 scripts/verify-rbac.ts） | T8 改 MAKER 表、T9 加探针；不同区域顺序执行 | 无冲突 |
| T2×T10 | 注册表 label ↔ 前端词表 | 见 Ruling-3 |
| T2×T11 | 种子 type 串须为注册表键；状态样例须字段自洽 | 写入 T11 派发上下文 |
| 各任务自洽 | T2 测试键清单=spec §1 十类 ✓；T6 双码 deadline=null 与其 chainStart 排除规则自洽 ✓；T1 测试 immediate/hours 断言与实现形状一致 ✓ | 清洁 |

- Ruling-1: T6 就地扩目录条目可选字段 `chainStart?: 'NOTICE'`——非冲突而是分层引入；T1 按计划原样实现，不预埋。代价若错：T6 一次类型改动，极小。
- Ruling-2: plan T5 漏写 AccessControlService 的模块接线（incidents.module 需 import 提供方模块并注入 service）——按 spec §3"服务层断言"必须有此依赖，接线指令写进 T5 派发上下文。代价若错：DI 启动错，当场红。
- Ruling-3: T10 前端类型词表 label 必须逐字复制 T2 注册表 label，防两处文案漂移；写进 T10 派发。代价若错：界面文案不一致，轻。

## 进度
Task 1: implementer DONE (1c822bcf, 130 tests, tsc clean); fixed pre-existing 3-key assertion; INTEL: admin-web has an independent 3-key INCIDENT_REPORT_BASES mirror untouched -> carry to T10 dispatch
Task 1: complete (commits a09cab98..1c822bcf, review clean)
Ruling-4: T2 注册表 operatorGroup 用 string 类型不引 rbac 联合(T9 才有新成员,提前引用编译红);T9 落地后值域由 catalog 保证。代价若错:少一层编译期约束,轻
Task 2: implementer DONE (1c440b92, 137 tests, tsc clean); e2e 3处MANUAL->CLIENT_SHORTFALL 未实跑(T11 收); INTEL: admin-web IncidentListPage/incidentStatusMap 残留 'MANUAL' 字面量 -> T10 派发必带
Task 2: complete (commits 1c822bcf..1c440b92, review clean, 2 minor deferred)
Task 2: minor (deferred): M1 serviceImpact 锚键 spec 单元格未列而 plan 列了 — Ruling: 保留(影响口径类型需影响锚,spec 单元格是速记);T10 派发补 serviceImpact 渲染(plan:413 漏列)
Task 2: minor (deferred): M2 controller.spec/schema 注释连带改动,已披露,正当
Task 3: implementer DONE (60b9ee14, 3 ADD COLUMN nullable, tsc+jest 绿, worktree 库隔离)
Task 3: complete (commits 1c440b92..60b9ee14, review clean)
Task 4: implementer DONE (1c7f5516, 24 tests); Ruling-5: assertOperator 不给 SUPER_ADMIN 开特例(应急账号不日常用+绑定全组覆盖),T5 派发携带。代价若错:超管演示登记被拒,现场换号即可,轻
Task 4: review Approved + 1 Important(去重缺显式测试) -> fix round 1
Task 4: 补偿核查(我在评审词里预判过 Ruling-5): buildRolePermissionCodeMap 对 SUPER_ADMIN 展开全量码入种子 -> 组级查询对超管返回全组,T5 断言畅通,预判成立非掩盖
Task 4: fix round 1/5 (1 addressed, 0 open — 去重显式测试+失效验证; commits 1c7f5516..105d6c35)
Task 4: complete (commits 60b9ee14..105d6c35, review clean after 1 fix round)
Task 5: implementer DONE (141 tests, tsc clean); 八入口(register/investigation/notes/escalate/assess/remediations/close(requestClose)/withdraw)全挂 assertOperator;assertOperator 改 public 供 IncidentCloseWorkflowService 复用(改动最小方案,报告已写理由);TDD 红证据=stash 掉三实现文件后 spec 编译红(TS2554 参数数不对);连锁修复=12 处 incidentRow fixture 补 type + incident-close-workflow.service.spec.ts mock 补 assertOperator
Task 5: INTEL(对应 T5×T9 表"e2e 在 T11"那行的具体内容): test/incident-register.e2e-spec.ts 直调八入口用 ops()(OPS_OFFICER),但当前 rbac.catalog.ts 该角色不持 INCIDENT_WRITE(已迁给 treasury,2026-09-10 两角色定案)——assertOperator 激活后会 403;已顺手修 makeActor 的捏造 userId(现查真种子邮箱得真 id),但 ops()->treasury() 的角色改派(~20 处调用点+叙事注释)未动,需要起完整栈验证,已 spawn_task(task_42531af2) -> T11 派发必带
Task 5: review Needs fixes(C1 Critical + I1/I2/I3 Important + M1/M2 Minor) -> fix round 1
Task 5: fix round 1/1 (80220c52,176 tests,tsc clean): C1 权限码反查组失效(GET路由码同属READ/WRITE两组·T9后12条incident路由码同属五桶)→族独占能力码cap.incident.{funds,tech,data,ops,fin}(rbac.catalog.ts RBAC_PERMISSION_DEFINITIONS新增5行+PermissionGroup联合类型加4名,只加类型成员不动桶目录/路由/绑定仍归T9)+注册表operatorMarkerCode第九格+assertOperator改hasPermission精确判定;I1通报两入口(saveReportDraft/markReported)进门→经办线8→10入口;I2同名锚(assetCode/customerNo/amount)改源DTO顶层不塞subjectRefs;I3十门失效验证it.each+register/close-workflow补create/audit未调断言;M1 registration-workflow断言前移防孤儿定性行;M2清理operatorGroups死参数→operatorAllowed布尔;退役getUserPermissionGroups+4条T4测试(buildPermCodeToGroups未删,getActionBucketCatalog另一消费方);红绿证据=禁stash改cp备份到scratchpad+临时置空断言看红(9+1+1三处全证红)+cp恢复diff -q核对逐字节一致;新疑虑=cap.*五行会被verify-rbac.ts S7判死行(白名单当前清零),裁决未动该脚本(T9范围),已入报告
Task 5: review round 2 Needs fixes(新Important 族区分零红测,mock不按code参数判断可被"实参改常量/目录改组"双变异绕过而176全绿) + 场外雷确认实缺口(BodyDto缺subjectRefs,whitelist会剥字段HTTP真链路必400) + 四件小修 -> fix round 2
Task 5: fix round 2/2 (19154075,179 tests,tsc clean): mock改hasPermission(_,code)真按码判断+heldMarkers选项(默认['cap.incident.funds']);正向补techActor登记CYBER_BCDR断言toHaveBeenCalledWith(userId,'cap.incident.tech');rbac.catalog.spec.ts新增3条纯函数测试(五码各一组/五组互异/TREASURY_OFFICER含funds不含tech);红证据=双变异(assertOperator实参改常量→incident.service.spec 7条红;cap.incident.tech的groups改INCIDENT_WRITE→rbac.catalog.spec 2条红)cp备份/恢复+diff核对;BodyDto补subjectRefs(IsOptional+IsObject,HTTP真链路验证留T9探针+T11e2e);小修=TOP_LEVEL_ANCHOR_KEYS挪注册表导出(T10要消费)+顶层键报错文案改missing required field(subjectRefs键保持in subjectRefs)+超管捷径注释修准(hasPermission自己的角色码捷径:216-218非getUserPermissionCodes)+两处退役方法残留注释清理
Task 5: complete (commits 74900953..19154075, review Needs fixes -> 2 fix rounds -> clean)
Task 5: implementer DONE (74900953, 141 tests, 八入口断言, assertOperator 转 public 供 close-workflow 直调); INTEL: e2e 用 ops() 但资金族经办=金库 -> ops->treasury ~20 处改派并入 T9 派发(T11 前必落); 芯片 task_42531af2 已撤(本波内活); 纪律提醒: T5 实现者用了 git stash(共享栈禁令),幸无残留,后续派发词加禁令行
Task 5: review Needs fixes — C1(码反查组必查多,T9后门失效)+I1(通报两入口无门)+I2(同名锚只走subjectRefs断审计链)+I3(七门零失效验证+红证据不成立)+M1(workflow先落定性后过门)+M2(死参数)
Task 5: Ruling-6(改设计,supersedes Ruling-5 的推导前提): 每族独占能力码 cap.* 入 RBAC_PERMISSION_DEFINITIONS(定义表是字面数组可挂合成条目,role():90 只是助手);注册表加 operatorMarkerCode 第九格;assertOperator 改 hasPermission(userId,marker);getUserPermissionGroups 本分支退役删除(getActiveRolePermissions 提取保留供码方法)。依据: proposedPermissionGroups 获批即置空(:238)组身份不落库 + T9 后五桶码集同构一切码推导失真。代价若错: 合成码撞 verify:rbac 静态判据,修复轮内可见
Task 5: Ruling-7: 通报草稿/已通报标记两入口纳入经办门(该族经办人的活),经办线=十入口
Task 5: Ruling-8: 与存量列同名的锚键(assetCode/customerNo/amount)从 DTO 顶层取值落存量列,subjectRefs 只装新键——审计主体挂载与按客户筛选依赖存量列
Task 5: fix round 1/5 提交 80220c52 (6/6 修毕, 176 tests); INTEL: verify:rbac S7 会判 cap.* 死行 -> T9 需 Ruling-9(S7 加显式标记码白名单,注释指 Ruling-6,是设计承认不是骗绿)
Task 5: fix round 1/5 (6 addressed, 1 new Important[族区分零红测] + 1 confirmed gap[BodyDto 无 subjectRefs 遭 whitelist 剥离] -> round 2; commits 74900953..80220c52)
Task 5: Ruling-8 修订: 顶层键缺失报字段名不再说 in subjectRefs(原'报错信息不变'措辞收回——文案指向错误位置是缺陷)
Task 5: Ruling-9(T9 派发修订清单): S7 加 cap.* 显式白名单注释指 Ruling-6(设计承认非骗绿)/S1 四新组孤儿警报加绑定后自清/T9 Step1 联合类型已由 T5修1 完成改为核对/e2e ops->treasury ~20 处/新增数据同步依赖: 重铺或 db:base:sync 先于任何实走(cap 码要进库)
Task 5: minor (deferred->final review): 五条 MARKER 行会出现在权限目录列表与角色权限清单里,演示可见,暂判可接受
Task 5: fix round 2/5 (6 addressed, 0 open; commits 80220c52..19154075)
Task 5: complete (commits 105d6c35..19154075, review clean after 2 fix rounds; 经办门=十入口+族独占能力码, 179 tests)
Task 6: implementer DONE (595a688d, incidents 160/160); INTEL: close-workflow ASSESSMENT_BASIS_IMPACT_VERB 未盖新三值(结案摘要退化生码) -> 并入 T8 派发
Task 6: review 实质通过, 2 findings(M 行为红证据不足/过期注释) -> fix round 1(只补证据+注释,不动实现)
Task 6: fix round 1/5 (2 addressed, 0 open; commits 595a688d..7e23f9a5, 纯证据轮三变异全红)
Task 6: complete (commits 19154075..7e23f9a5, review clean after 1 fix round)
Task 7: implementer DONE (75e7f740, 163 tests); INTEL: worktree admin/client node_modules 缺 vite -> 控制器补装(T10 前置); admin-web REMEDIATION_KINDS 平行词表确认在 T10 清单
Task 7: complete (commits 7e23f9a5..75e7f740, review clean, 1 M 注记留档)
Task 8: implementer DONE (70b9ef73, 203 tests, S5 静态独跑+临时绑定证红; S5 四新组天然红移交 T9)
Task 8: review Needs fixes(高危标准) — C1 计划层缺陷: IMPACT/SHORTFALL×空白名单类型结案不可达(NO_LOSS 门×口径禁选×无善后可挂三处叠加) + I1 CISO 裁决盲区 + I2 FINANCIAL maker 漏 OPS 组 + M2-M5
Task 8: Ruling-10: 采乙案——requestClose 从 ASSESSED 放行条件 = basis===NO_LOSS || 该类型处置白名单为空;依据 spec§1 处置可选/ASSESSED→CLOSED 边本为无善后设;DATA_BREACH/ASSET 仍须先挂通知/暂停引用(故事更完整)。代价若错: 三类可绕过善后直接关单,业主可再收紧
Task 8: Ruling-11: 结案审批 objectSnapshot 增 impactSummary+subjectRefs(业务值非 UUID,CISO 看得懂批什么);INCIDENT_TYPE_IMPACT_LABEL 补齐十类
Task 8: 移交 T9: CISO 绑 INCIDENT_READ(裁决人要看得见事故) ; 移交 T10: ApprovalPoliciesPage ACTION_TYPE_LABELS 两新键+侧栏可见性核对
Task 8: fix round 1/5 提交 2669f0b9 (C1乙案+I1acd+I2+M2-M5, 219 tests; S5/S9 余红=T9 绑定待办)
Task 8: fix round 1/5 (9 addressed, 0 open; commits 70b9ef73..2669f0b9)
Task 8: complete (commits 75e7f740..2669f0b9, review clean after 1 fix round)
Task 8: minor (deferred->final): spec:133/service:105 两处注释失真; close-workflow:77 拒绝文案歧义; M4 兜底应取末步非首步; spec:314 fixture 用了不可达态
Task 8: 业主留意项: STUCK 乙案后可认损(FIRM_LOSS)直接结案但挂不了调账,认损无记账路径(铁律⑤张力,注册表设计层)——T11 登 BACKLOG
Task 8: T10 必带三件: IncidentDetailPage:103 closeGateReason 镜像乙案 / :116 canWrite 改按族能力 / ApprovalPoliciesPage 两新链标签
Task 9: implementer DONE (234ab10f, verify:rbac 62->66 全绿含 S5/S9 转绿, 3 新探针, 242 jest; 2 条存量红双版本比对判非本任务并登 TOOLING-DEBT/BACKLOG)
Task 9: 台账订正: 上一行'verify:rbac 全绿'失实——实为 S5/S9 转绿+零新增红,整跑 FAIL:2(两条存量红:S7 sumsub-demo 盲区已登 TOOLING-DEBT / V2 CUSTOMER_WRITE 孤儿已登 BACKLOG),T11 判据口径=零新增红+存量红登册
Task 9: review Needs fixes — C1 前端 RoleDetailPage 码反查组回归(五桶OR放大成真实越权授码链,Ruling-6 只修了后端)+I1 前端代表码门控失效(转T10)+I2 报告数字失实+M1-M6
Task 9: Ruling-12: 前端 heldGroups 推导改'组内全部码都持有才算持有'(子集完备推导,cap.*码使其单射)——与 Ruling-6 同根同修;admin-web 无单测甲械(memory 判例),证据=tsc+截图闸⑤+纯函数抽离供目检
Task 9: T10 追加移交: CaseFlowTable 登记按钮与 IncidentDetailPage 写按钮改按 cap.incident.<family> 门控(先核 session.permissions 含 cap 码); T11 追加: M5 变异(金库临时绑 TECH 组->反向探针须红)+M6 文档口径'四职务'新经办位+M4 探针遗留事故与剧本撞车核对
Task 9: fix round 1/5 提交 82a9e10b (C1子集完备+7截图+I2如实+M1-M4+探针自清理; 踩坑:基线复跑覆盖绑定已sync纠正)
Task 9: fix round 1/5 (7 addressed, 1 Important 遗留[view 桶双组致资金族越权授码尾巴] -> round 2; commits 234ab10f..82a9e10b)
Task 9: Ruling-13: view 桶改只挂 INCIDENT_READ(一行)——写组持有人经子集推导仍见 View,提交不再连带授 WRITE;顺带修正'选 view 桶即得写权'的旧病
Task 9: T11 追加登册: ①Modify 非原样提交存量病(CFO +CUSTOMER_READ 8码/SMO·CISO 丢 GOV_APPROVAL_POLICY_WRITE)->BACKLOG ②customer.manage_profile 400 影响面扩注(新建角色勾桶同炸)->BACKLOG 既有行扩写
Task 9: fix round 2/5 提交 0abaf132 (view桶一行修+服务端持久化实证 8角色 gainedCodes=0); 实现者又spawn芯片(customer.view同款,ID未留)——与T11登册项重复,留着无害
Task 9: fix round 2/5 (1 addressed, 0 open; commits 82a9e10b..0abaf132)
Task 9: complete (commits 2669f0b9..0abaf132, review clean after 2 fix rounds; verify:rbac 93判据 净增4 零新红, 桶 62->66)
Task 10: implementer DONE (85a06938, 三tsc+186 tests+9截图+cap码curl实证); 披露两顺带修(getView投影additive/ListPage登记钮同诊断); 移交T11: e2e 4条既有红(T6口径收窄遗留)
Task 10: review 实质通过, 3 小项 -> fix round 1(两死导出清/ListPage等价空操作撤/报告因果订正)
Task 10: fix round 1/5 (3 addressed, 0 open; commits 85a06938..430b5464)
Task 10: complete (commits 0abaf132..430b5464, review clean after 1 fix round)
Task 11: implementer DONE (d98e040f 代码/种子/e2e, 6494a43c 文档/骨架); e2e 4条既有红修复根因=T6按类型收窄reportBasisCandidates后UNAUTHORIZED_OUTFLOW唯二合法码CRM_IV_E_5/CRM_V_D_2(TIR_K_H非法)、72h钟路径单元测试已覆盖(STUCK_TRANSACTION_MAJOR)、本用例改验证两码均无钟→null；T8遗留五小项清（拒绝文案拆两条/M4末步非首步+两步链专属测试/两注释失真/spec:314不可达态fixture换）；种子四样例seedIncidents()直铺终态(CYBER_BCDR留现场演)；四点变异实证全部先证红后复绿(cp备份禁stash)；九类全生命周期真HTTP实走(2类e2e覆盖+3类全新注册+4类接续种子+1类禁用确认400)，审计fromStatus/toStatus五种边型抽查；MANUAL零残留(广谱+限定两次grep)；jest全量205 suites/2766 tests绿；重铺闸两轮(含最终清洁态)demo:all 29/29+COA 4/4全绿；verify:rbac净增0(两条存量红S7/V2-CUSTOMER_WRITE已登册)；BACKLOG三行(FIRM_LOSS无记账路径/customer.view同Ruling-13缺口/CUSTOMER_WRITE 400扩注create路径)+PRODUCTION-NOTES一行(无兜底分类通道)+TOOLING-DEBT一行(recon-demo.ts manifest路径硬编码main栈)；v1-governance.md §7全面改写+overview.md §4(66桶/四新经办位/CISO新增READ)+v8-recon.md三处订正+data.md新增事故种子区块+script.md场景⑱续MANUAL替换+三处"运营事故域清零"表述订正为"仅FUNDS族"；波二骨架(报送台)承接记录=Ruling-6/10/12/13四条设计演进+通报单槽现状+PRUDENTIAL联动位+V8通报收编岔口②待裁决；前端closeGateReason文案拆分截图验证(dpo@真实登录)
Task 11: complete (commits 430b5464..6494a43c, 战役甲波一十一任务全数收官，无评审轮，单会话交付；波二骨架已立待新会话脑暴展开)
Task 11: implementer DONE (d98e040f+6494a43c; 重铺闸x2 29/29+4/4; e2e 10/10; 全量jest 205/2766 实测记录[brief写30/573+不可复现,按实测]; 九类HTTP全生命周期; TOOLING-DEBT 又收一条 recon-demo 硬编码主栈路径)
Task 11: review 实质全过, I1(overview 同文件 62/66 自相矛盾——数字复述漏改判例再现)+M1-M3 -> fix round 1(四处文档)
Task 11: fix round 1/5 (4 addressed; commits 6494a43c..0b5b2c92)
Task 11: complete (commits 430b5464..0b5b2c92, review clean after 1 fix round)
=== ALL 11 TASKS COMPLETE — 进入全分支终审 ===
Final review: With fixes — I1 PRUDENTIAL 缺演示场景(spec§8 承诺) / I2 affectedSystem 枚举被 plan 静默降级为文本(spec§1 格值) / M3-M6 四件分钟级; 四 Ruling 复核无一推翻; deferred 分诊全可留(T8四小项已清)
Final: Ruling-14: affectedSystem 受控枚举成员照 vendor 先例由控制器定: BACKEND_API/ADMIN_PORTAL/CLIENT_PORTAL/LEDGER/DATABASE/CLOUD_INFRA/OTHER——spec 留白处的成员定义,业主可否。代价若错: 改一个下拉清单,极小
Final fix wave: 9f45e5b3+8b8778a2 (I1/I2/M3-M6 全落, 重铺闸 5 样例全绿)
Final fix wave: re-review PASS (5/5 verified) — 波一全绿闭环
