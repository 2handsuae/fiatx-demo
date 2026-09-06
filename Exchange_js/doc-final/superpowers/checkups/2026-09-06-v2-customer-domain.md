# V2 客户域 · 第二幕前体检（主会话判读版）

2026-09-06 ｜ 体检对象 main `50d6e798` ｜ 业主目标四轴：**字段数据齐全 / 业务逻辑清晰 / 代码干净无冗余 / 代码与文档同步** ｜ 方法：四名 sonnet 取数员交「数字 + 复现命令」（A 字段清册 48 字段逐个 / B 代码清册 ≈8905 行 / C 文档核对 22 断言 / D 前端展示面），所有否定性结论由主会话独立复现后才采信（复现记录见附录）。

判色口径同 V3 体检：**红** = 违反铁律或命中评审三判据（业务逻辑不符 / 演示不出来·讲不圆 / 代码读不懂）｜ **黄** = 漂移、死码、不一致，不挡演示 ｜ **绿** = 逐项核过有证据。已在 BACKLOG 的旧账标 `已在账:行号`，不重复立案。

**一句话总评：客户域与交易的接缝（能力门 / L1 / 标签→费率 / KYT 前置）是活的、清晰的、权限与 tipping-off 两道红线都守得住；病灶集中在客户主表自身——48 个字段里 27 个空转，其中 12 个还在详情页占着永远空白的展示位；一期拆除留下一整套没人跑的生命周期状态机（约 254 行死码）；文档主体健康（§6 六缺口全部复核仍真），但 §5 引了一个已删除的文件，BACKLOG 有两条 2026-07-04 老体检条目已经腐烂。**

## 四轴判色

| 轴 | 判色 | 一句话 |
|---|---|---|
| ① 字段数据齐全 | **红** | 48 字段仅 ~20 个真实参与业务或展示；lifecycle / tradingTier / sumsubApplicantId 三个交易强依赖字段零运行时写入、全靠种子；两对双胞胎字段各死一半 |
| ② 业务逻辑清晰 | 黄 | 能力门一条线很清晰（绿）；但生命周期状态机是死码、NEW_CUSTOMER 派生标签永不命中，两处「机器在册、无人驱动」 |
| ③ 代码干净无冗余 | 黄 | 两份整文件死码 + 一批死导出/死列 + 前端四处死渲染，合计 -300 行级 |
| ④ 代码与文档同步 | 黄 | modules 篇 §5 十断言 9 相符 1 不符、§6 六缺口全真、demo 数据全对；BACKLOG 两条腐烂 |

---

## 一、字段清册判读（轴①）

48 个标量字段分四层（完整逐字段表在取数员 A 报告，此处为判读）：

**活字段（约 20 个，绿）**：认证组 `email / phone / passwordHash / failedLoginCount / lockedUntil / lastLoginAt`；业务键 `customerNo`；身份展示 `firstName / lastName / companyName / customerType`；`riskRating`（材料刷新窗口天数的真实输入，`material-refresh.service.ts:288,375,493`）；`hardLineDispositionedAt`（swap 硬线 sticky，读写闭环）；`eddRequired`（种子铺设 + 两侧展示，Carol/Frank 的演示事实）；`tradingTier`（限额门 `transaction-limit-gate.service.ts:59` / L1 `l1-gate.service.ts:171` / VIP 派生标签）；`lifecycle`（能力门 ACTIVE 判断 `customer-access.service.ts:158`）；`sumsubApplicantId`（15+ 处交易域 KYT 前置）；`createdAt / updatedAt / id`。

**靠种子活着（3 个关键字段，红）**：`lifecycle`、`tradingTier`、`sumsubApplicantId` 被交易链路重度读取，但**生产代码零运行时写入路径**——只能来自建号默认、种子铺终态、或 admin 通用 PATCH 透传。`sumsubApplicantId` 种子只给 6/11 位客户铺值（`seed.business.ts:675`），无值客户的 KYT 提交分支走不到；`tradingTier` 没有任何「升级为 PREMIUM」的业务动作。这三个字段是「一期重做」（已在账:99）的接线点。

**僵尸展示位（12 个，红——演示可见）**：admin 客户详情页（`CustomerDetail.tsx`）渲染着一整片永远为空/默认值的区块：Sumsub verification 五件套（`verificationSubstatus / CustomerActionRequired / CanContinue / LatestEventType / LatestEventAt`）、`sumsubLatestReviewId / sumsubLatestAttemptId / sumsubExperiencedLevel2`、`nextReviewAt`（"Next Review" 两处 `CustomerDetail.tsx:668,1119`，后端零写入方，恒空）、`investorTier / investorTierUpdatedAt`、`cddDocumentExpiresAt`。演示者带同事看客户详情，屏上一排「—/false/N/A」。client-web 侧 `useCustomerProfile.ts:37,88` 也读 `nextReviewAt`，但 `/onboarding/me` 的 select 根本不含它，条件渲染永不触发。

**纯死（零写零读零展示，黄）**：`pepStatus / pepConfirmedAt`、`emailVerifiedAt / phoneVerifiedAt`、`locale / timezone / termsAcceptedAt / lastLoginIp`、`riskLevel`、`latestRiskApprovalId / latestRiskApprovalStatus / latestRiskAssessmentId`（含 relation `latestRiskApproval`，已在账:101）。另有只写不读 3 个：`passwordUpdatedAt / riskRatingUpdatedAt / sumsubExperiencedLevel2`。

**两对双胞胎（红——字段治理的直接抓手）**：
- `riskLevel`（默认 LOW，全仓零引用，种子都不铺）vs `riskRating`（活，真实驱动材料刷新）——同义两列，死一列
- `investorTier`（默认 STANDARD，仅透传展示，无写入）vs `tradingTier`（活，驱动限额/L1/VIP）——同义两列，死一列

**特殊一笔：`onboardingApprovedAt`**——零写入（种子也不铺，恒 null），却是 NEW_CUSTOMER 派生标签的唯一判据（`customer-tag.service.ts:104,111-112`）。**「新客」标签从系统上线起就没打中过任何人。** 目前无费率档引用 NEW_CUSTOMER（复现：`grep -rn NEW_CUSTOMER src/ scripts/ prisma/ admin-web/src client-web/src` 除标签模块自身外零命中），所以是潜伏死逻辑——但它与 V3 体检 F-R1「受众谓词全链路无实例」是同一条病根的两半：等费率侧铺了 NEW_CUSTOMER 受众档，就会发现标签侧永远不命中。

## 二、业务逻辑清晰度（轴②）

**绿——接缝是清晰的**（这正是业主关心的「客户管理 × 交易」部分）：
- 能力门调用图完整：`resolve()` 被三域 workflow + L1 公共闸（`l1-gate.service.ts:88`，三域 `evaluate()` 各一处）+ 客户面三个投影消费；`assertTradingEligibility` 覆盖兑换/提现/充值信号六个入口；唯一执法依据 = lifecycle ACTIVE + 能力不在被摁清单，与文档口径逐字一致
- tipping-off 双红线实测成立：`customer-access.contract.spec.ts` 真用 `fs.readFileSync` 扫源码文本；client-web 全量 grep `blocked` 14 处逐条核对零违反，裸 `blocked` 字段零命中
- 限制账幂等键 `findFirst` 兜底、visibility/releasePolicy 查 `RESTRICTION_CAUSE_POLICY` 落库（7 个 cause）、贴不用批撕必须批的两条审批线——全部与文档相符
- RBAC：admin 侧 21 条路由**全部**登记在 `rbac.catalog.ts`；客户面 5 条按设计不进目录

**红——状态机是死的**：`nextLifecycle()`（`customer-lifecycle.constant.ts:71`，8 动作 7 态）与 `customer-lifecycle.util.ts` 全部 15 个导出，**生产代码零调用方**，只有各自 spec 在用；全仓也没有任何 `customerMain.update` 直写 lifecycle 的旁路——**这根状态轴在运行时只能读、不能变**。文档站6 注已承认「lifecycle 状态位是种子铺设的演示事实」，所以不挡第二幕；判红的原因是**给开发同事讲代码时讲不圆**：文档 §5 把 nextLifecycle 列为在册技术节点、代码里留着整套「非法边显式抛」的机器，但没有一条边真的有人走，连 OFFBOARD 也只有校验函数没有触发方（`assertOffboardable` 零调用，见轴③）。

**黄——已在账缺口本次复核仍真、机制坐实**：
- 材料到期 cron 失配（已在账:111）：机制已并排坐实——写入侧 `enterNotifiedStage()` 落 `REFRESH_IN_PROGRESS`（`material-refresh.service.ts:107-110`），cron 白名单 `['FRESH','NOTIFIED','URGENT','BLOCKING']`（`material-freshness-cron.service.ts:29-35`）不含它，holding 第一次提醒后**永久掉出每日巡查**，URGENT/BLOCKING 只能靠 Sumsub 上报或 ⚡模拟按钮兜底
- REJECTED 材料请求便签长挂（已在账:113）：`autoRelease` 全文件只在 APPROVED 分支调用一次
- 六个 admin 页读已删 `complianceStatus`（已在账:109）
- 制裁客户订单级折叠（已在账:115）、销户只落轴上位置（已在账:107）

**红——新发现：客户详情 → 交易域零跳转**。三张交易详情页都有跳回客户的链接（`DepositTransactionDetail.tsx:565,878` 等，用业务键），**反方向没有**：`CustomerDetail.tsx` 全文无任何充值/提现/兑换入口（复现：`grep -in "deposit\|withdraw\|swap\|transaction" admin-web/src/pages/CustomerDetail.tsx` 零业务命中）。第二幕③「给 Bob 贴全能力便签 → 三域列表逐一看他的单全冻」，演示者只能手工切三次侧栏菜单再手工搜 Bob——本幕高光的联动一步都链不过去。与已在账:115（聚合视图）不同件事：那是「要不要做聚合页」，这是「连按客户过滤的普通链接都没有」。

## 三、代码干净（轴③——死码清单，全部主会话复现）

| 类 | 项 | 证据 |
|---|---|---|
| 整文件死码 | `customer-lifecycle.util.ts`（174 行）+ 其 spec | 全仓唯一 import 方是自己的 spec |
| 整文件死码 | `review-response-compat.util.ts`（28 行，2 导出） | 零引用、零 spec、连按路径 import 都没有 |
| 死常量/函数 | `CUSTOMER_LIFECYCLE_TRANSITIONS / CUSTOMER_LIFECYCLE_TERMINAL / nextLifecycle`（constant.ts 80 行的主体） | 唯一外部调用方是上面已死的 util.ts |
| 死方法 | `CustomerAccessService.assertOffboardable`（:176-207） | 零生产调用；且 `customers.module.ts:20-22` 注释自认 **TigerBeetleModule / FundsOrdersModule 两个 import 仅为它而存在**——死方法拖着两个模块依赖 |
| 死导出 | `MATERIAL_REQUEST_TERMINAL`（姊妹表 LIVE_STATUSES 有 4 处消费，它零）；`ALL_CAPABILITIES`（仅文件内用，导出无人接）；`isDerivedTag / staticTagCodes` | 各自 grep 只中定义行 |
| 死列 | `CustomerMaterialHolding.sumsubDocId / sumsubIdDocSetType`（全仓零引用）；`CustomerExplicitTag.assignedByUserId`（只写不读） | 取数员 A 附命令 |
| 前端死渲染 | material 三页读 `customer.riskTier`（后端字段叫 `riskRating`，恒 undefined → 风险徽章恒空）：`MaterialManagementPage.tsx` / `MaterialHoldingDetailPage.tsx` / `RefreshCycleDetailPage.tsx`——与已在账:109 的 `complianceStatus` 同病（读已改名/已删字段），但 **riskTier 这半未入账** | 取数员 D |
| 前端死链 | `CustomerDetail.tsx:1020`「View All →」带 `?customerId=<uuid>` 跳 `MaterialManagementPage`，目标页 `buildParams()`（:106-116）**不读这个参数**——点了等于看全量列表，客户 UUID 白进地址栏 | 取数员 D |
| 前端死渲染 | `nextReviewAt`：admin 两处恒空展示、client 一处永不触发（见轴①） | 取数员 B/D |
| schema | 27 个空转字段（见轴①） | 取数员 A |
| 写法不统一（不算缺陷，记一笔） | `CustomersController` 是范围内唯一不写 `@RequirePermissions` 装饰器的 admin controller，靠 guard 按路径自动拼权限码，实际生效 | 取数员 B |

TODO/FIXME/XXX/HACK：范围内**零命中**。

## 四、文档同步（轴④）

**modules/v2-customer-compliance.md：主体健康。**
- §5 十断言 9 相符、1 不符：`customers/customer-status.util.ts → resolveCustomerCanonicalState()` **不存在**——2026-08-16 `a7a5eaa5` 已物理删除，文档 2026-08-27 改写时引用的就是个死路径（不是代码后来漂移，是写下那天就错）
- §5 的 nextLifecycle 条按字面相符（文件在、8 动作在、非法边显式抛在），但呈现为活的技术节点，实为零调用死码——建议改口径为「状态机表在册、运行时无迁移驱动，状态位全部种子铺设」
- §6 六条演示缺口**全部复核仍成立**（含 cron 失配的机制坐实）——这节是健康的债务台账
- §2 状态机表写「8 动作」与代码一致；「七态九边」类表述按代码实际核对为 7 态 8 动作边

**demo/data.md + demo/script.md vs 种子：全对（绿）。** 9 位客户矩阵人数、人名-状态映射（Carol 制裁静默 / Ivy 材料过期明示 / Dave 认证中 / Eve 新注册 / Frank 高风险 / Grace VIP / Henry 企业）逐条与 `seed.business.ts:529-643` 相符；Jack/Kate 是 V8 对账道具、文档口径正确排除。

**BACKLOG 两条腐烂（均为 2026-07-04 老 V2 体检遗留，一期拆除后没人回头改）**：
- :105「Corporate/机构客户 stub：CorporateProfile/UboProfile **表+关系连**」——`ubo_profiles` 表已在 2026-08-27 `v2slim_phase1_teardown` 迁移 DROP，全仓零代码引用；现状只剩 `customerType/companyName` 两列 + 注册端硬编码 INDIVIDUAL + client 注册页「Corporate · by invitation only」禁用徽标
- :103「Tier Upgrade ⛔ 缺客户端 UI：**后端全建**（createFromCra→Level2→MLRO+SMO 审批）」——tier-upgrade 后端已随一期拆除，`createFromCra` 全仓只剩 `material-refresh.service.ts:326` 一行注释残影；「缺客户端 UI」的前提没了，该条应并入 :99 一期重做

**铁律走查**：②门（能力门唯一执法）绿 ｜ ⑥业务键：客户本体路由/展示全 `customerNo` 绿；但 material-holding / refresh-cycle 两类记录无业务号、用内部 id 进路由，`MaterialHoldingDetailPage.tsx:547-548` 还把 UUID 当「Holding ID」文本展示（黄；客户域业务号化轮当时已观察到 material-holdings 带 UUID、未入账，本次入册）｜ ①留痕：15 码在册与文档一致（写入路径未逐动作验证，冻结不留痕类已在账:142/146/289）。

## 五、岔口（待业主定，按讨论优先级排）

1. **27 个空转字段的去留**（轴①主病）：甲=只保 Sumsub 集成组等一期重做（:99）的接线字段、其余裁掉，详情页僵尸区同步撤；乙=全部保留等一期重做统一接线。两案下 `riskLevel`、`investorTier(+UpdatedAt)` 两对双胞胎的死半边都该删（无人接线、有活同义字段）。schema 改动 = reset 重铺，无迁移负担。
2. **客户详情 → 三域交易列表的按客户过滤跳转**要不要补：第二幕③联动演示的入口，工作量小（三域列表页已支持按 owner 过滤与被跳入）。
3. **生命周期状态机死码**：一期重做的地基还是包袱——留 `constants/customer-lifecycle.constant.ts`（状态表是文档级资产）删 `customer-lifecycle.util.ts` + `assertOffboardable`（连带解掉 customers.module 两个死依赖）？
4. **NEW_CUSTOMER 标签**：删（受众谓词现无实例）or 留待一期重做在 MLRO 终审落 `onboardingApprovedAt` 时激活——与 V3 F-R1（费率侧铺受众档）应同一波决策。
5. **死码/死渲染清扫**是否单独一小波（轴③清单，-300 行级 + 前端四处），还是并入字段治理波。

## 附录：主会话复现记录（否定性结论采信依据）

```bash
# 状态机零调用（空输出=确认）
grep -rn "nextLifecycle\|customer-lifecycle.util" --include="*.ts" src/ | grep -v spec | grep -v "customer-lifecycle"
# lifecycle 无直写旁路（命中全为 select 投影）
grep -rn "lifecycle:" --include="*.ts" src/ | grep -v spec | grep -v -E "constant|select|where|access|util"
# onboardingApprovedAt 只有标签派生在读、无写入（含种子）
grep -rnw "onboardingApprovedAt" --include="*.ts" src/ prisma/ | grep -v spec
# NEW_CUSTOMER 无费率/演示使用面
grep -rn "NEW_CUSTOMER" --include="*.ts" src/ scripts/ prisma/ admin-web/src client-web/src | grep -v spec | grep -v "customer-tag"
# findOne 裸 findUnique 无 select（passwordHash 出响应体）
sed -n '64,68p' src/modules/identity/customers/customers.service.ts
# review-response-compat / pepStatus / sumsubApplicantId 写入 / 五个死导出——均已复现零命中
grep -rn "projectResponseRecord\|resolveLegacyIncidentAssigneeUserId" --include="*.ts" src/ admin-web/src client-web/src | grep -v "review-response-compat.util.ts"
grep -rnw "pepStatus" --include="*.ts" --include="*.tsx" src/ admin-web/src client-web/src
grep -rn "sumsubApplicantId" --include="*.ts" src/ | grep -v spec | grep -E "update|create|data"
for s in MATERIAL_REQUEST_TERMINAL ALL_CAPABILITIES isDerivedTag staticTagCodes assertOffboardable; do grep -rnw "$s" --include="*.ts" src/ | grep -v spec; done
# BACKLOG:103/:105 腐烂
grep -rn "createFromCra\|TierUpgrade\|tier-upgrade" --include="*.ts" src/ | grep -v spec   # 仅 1 行注释残影
grep -rn -i "corporateprofile\|uboprofile\|ubo_" prisma/ src/ admin-web/src/ client-web/src/  # 仅迁移文件 DROP 记录
```

技术兜底两条（passwordHash 裸出 admin API 响应体 / customers CRUD 请求体直透传 Prisma Input、全局 ValidationPipe 对纯 TS 类型不生效）已按 §4 记 `PRODUCTION-NOTES.md`，本报告不展开。
