# 充值域审计新名册设计稿（站1b-β）

日期：2026-08-26 ｜ 分支：refactor/v4-slim-1b ｜ 底稿：现役 44 码实测清单 + V1 第一批合同格式
目标：充值域操作留痕切入 2026-08-25 新合同（四属性出生冻结 / assertActionSpec 机器校验 / subjects 五角色 / 三追踪 ID），第七幕"按单号、按客户、按旅程"检索从此对充值域成立。

## 七条裁定（先拍这个，码表随之）

| # | 裁定 | 白话 |
|---|---|---|
| D1 | **废除动态迁移码族** `DEPOSIT_<从>_TO_<到>`（496 组合爆炸的根） | 状态变化不再自己起名，写进每条留痕的"从哪来/到哪去"两列——名册从此数得清 |
| D2 | **现名保守**：能保留的码名一律不改 | V1 先例（GRANTED/ISSUED）证明业务词合法；改名=历史检索断链，只在合并处动 |
| D3 | **充值单加"旅程号"一列**（correlationId，重铺闸随行） | 旅程起点铸号落单，之后每条留痕从单上继承——"这一笔从头到尾"一查一串 |
| D4 | **旅程边界**：一笔充值 = 一段旅程；没收/退回/上缴/解冻同旅程，审批拍板事件作"因果前件" | 处置不是新故事，是同一笔钱的下一章 |
| D5 | **挂起三码合并**：GATE / HELD_BELOW_MIN / HELD_NOT_TRADING_READY → `DEPOSIT_HELD` + 原因码 | 同一个动作（拦下），三个名字→一个名字三个原因 |
| D6 | **停摆三码合并**（每弧）：FAILED(结算耗尽) / STUCK(腿耗尽) / UNLOCK_FAILED(崩溃) → `_STUCK` + 原因码 | "卡住了"是一件事，怎么卡的进原因码——全域净减 6 码 |
| D7 | **subjects 五角色首次全量接线**：主体=单号 ｜ 归属=客户号 ｜ 凭据=审批号 ｜ 牵连=资金单号 | "按客户查全部"从此有真数据（现在 V1 域这个查询只能查到"谁查过"） |

## 新名册（33 码，S=旅程起点 / I=继承旅程；★=必带因果前件）

**主线（10）**
| 码 | 模式 | 必填 | 说明 |
|---|---|---|---|
| DEPOSIT_CREATED | **S** | — | 钱到信号落单，铸旅程号（现名保留） |
| DEPOSIT_PAYIN_CONFIRMED | I | 从/到 | 到账确认，进筛查 |
| DEPOSIT_PAYIN_FAILED | I | 从/到, reason | 钱没到，终局（业务终局进码名，V1 先例） |
| DEPOSIT_COMPLIANCE_STARTED | I | — | 筛查开始 |
| DEPOSIT_HELD | I | reason | 拦下挂起（D5 合并：小额/行政/闸门三因归原因码） |
| DEPOSIT_SUMSUB_SUBMITTED | I | kytTxnId | 单笔报送 |
| DEPOSIT_APPROVED | I | 从/到 | 放行入账 |
| DEPOSIT_COMPLETED | I | 从/到 | 终局成功 |
| DEPOSIT_LIMIT_WAIVED | I | reason | 小额豁免放行 |
| DEPOSIT_ACCOUNTING_BLOCKED | I | reason | 记账被拒、状态不推进 |

**裁决与复核（8）**
| DEPOSIT_ONHOLD ｜ I ｜ — ｜ 官方挂起复核中 |
| DEPOSIT_MANUAL_CHECKING ｜ I ｜ 从/到 ｜ 进人工复核（SLA/官方拒绝两成因走 reason） |
| DEPOSIT_MANUAL_APPROVED ｜ I ｜ — ｜ 复核翻案 |
| DEPOSIT_FROZEN ｜ I ｜ 从/到, sceneTag ｜ 冻结（申请人/对手方/官方三成因） |
| DEPOSIT_ACTION_REQUIRED ｜ I ｜ 从/到 ｜ 要求补料（取代一条动态迁移码） |
| DEPOSIT_AWAITUSER_EMPTY_ACTIONS ｜ I ｜ reason ｜ 空补料清单拒进补料态 |
| DEPOSIT_KYT_VERDICT_IGNORED ｜ I ｜ reason ｜ 迟到/终态裁决只留证据 |
| DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT ｜ I ｜ sceneTag ｜ 被忽略裁决中的制裁信号（冻人不冻单） |

**处置四弧（12 = 没收/退回/上缴各 3 + 解冻 2 + 收口 1）**
| DEPOSIT_CONFISCATION_REQUESTED / RETURN_APPROVAL_REQUESTED / SEIZE_APPROVAL_REQUESTED ｜ I ｜ — ｜ 发起开审批案（三弧各一） |
| DEPOSIT_CONFISCATION_STARTED / RETURN_STARTED / SEIZE_STARTED ｜ I★ ｜ approvalNo ｜ 批准落地、先账后状态 |
| DEPOSIT_CONFISCATION_RETRIED / RETURN_RETRIED / SEIZE_RETRIED ｜ I ｜ attempt, fundsOrderNo ｜ 腿重建 |
| DEPOSIT_CONFISCATION_EXECUTED / RETURNED / SEIZED ｜ I ｜ 从/到 ｜ 三弧终局（现名保留） |
| DEPOSIT_CONFISCATION_STUCK / RETURN_STUCK / SEIZE_STUCK ｜ I ｜ reason, attempt ｜ 停摆红旗（D6 合并三成因） |
| DEPOSIT_UNFREEZE_APPROVAL_REQUESTED ｜ I ｜ — ｜ + DEPOSIT_UNFROZEN ｜ I★ ｜ approvalNo, orderRef |
| DEPOSIT_LEG_CLEAR_FAILED ｜ I ｜ reason ｜ 腿收口滞后留痕 |

**SLA 与守卫（3）**
| DEPOSIT_SLA_BREACHED ｜ I ｜ slaType, fromStatus ｜ 破线 |
| DEPOSIT_SLA_TIMEOUT_SIMULATED ｜ I ｜ — ｜ 演示拨钟（留痕明示是模拟） |
| DEPOSIT_APPROVE_BLOCKED_FROZEN ｜ I ｜ — ｜ 冻结单拒放行（活守卫） |

**演示（1）**：DEPOSIT_DEMO_SCENARIO_RUN ｜ I ｜ scenario ｜ ⚡场景执行留痕

## 废除清单（写入 DEPRECATED 拒写名单）

动态族 `DEPOSIT_*_TO_*` 全部 ｜ DEPOSIT_GATE ｜ DEPOSIT_HELD_BELOW_MIN ｜ DEPOSIT_HELD_NOT_TRADING_READY ｜ DEPOSIT_CONFISCATION_FAILED ｜ DEPOSIT_CONFISCATION_UNLOCK_FAILED ｜ DEPOSIT_RETURN_APPROVAL_REQUESTED?（并入否→保留）——终版以接线时逐点核为准，历史行永远可读。

## 接线范围（认了名册就动）

① 常量文件新增 `V4_DEPOSIT_AUDIT_ACTIONS`（四属性表）+ 废除名单进拒写闸；② 充值单表加旅程号列（迁移+重铺闸）；③ 全部 recordSystem/recordByActor 调用点换新参数形（actionDomain='DEPOSIT'、旅程号继承、subjects 四角色、outcome/reasonCode 规范）；④ 动态迁移调用点改为对应业务码；⑤ 测试同步；⑥ 收尾闸全家 + verify:audit 充值段应转绿（Q2/Q4/Q5 因有真数据而活）。
