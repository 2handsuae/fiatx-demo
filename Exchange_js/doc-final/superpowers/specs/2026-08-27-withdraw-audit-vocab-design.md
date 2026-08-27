# 提现域审计新名册设计稿（站2-β）

日期：2026-08-27 ｜ 分支：refactor/v5-slim ｜ 底稿：现役 32 具名码 + 动态迁移族实测清单
目标：提现域操作留痕切入新合同（四属性出生冻结 / assertActionSpec 机器校验 / subjects 角色 / 旅程号），承接站1b 充值域全部裁定。

## 承接裁定（站1b 已定，不再议）

废动态迁移族（状态变化进从/到两列）｜ 现名保守（只在合并处动名）｜ 失败不起名（进 outcome+reasonCode）｜ 同动作不因语境拆名 ｜ 提现单加旅程号列（CREATED=START 铸根）｜ subjects 四角色（主体=单号/归属=客户号/凭据=审批号/牵连=资金单号）｜ 空清单异常 warn 降日志不留痕

## 提现特有病灶（本稿要治的）

1. **动态码铸在状态机里**：`updateStatus` 内建转移留痕——**每次流转都双写**（比充值重）。废除后每条边由具名码携从/到覆盖（接线时做边×码覆盖对照，漏边补进最近的具名码）。
2. **一事多痕之最**：终局一刻最多四条（PAYOUT_CONFIRMED + ACCOUNTING_POSTED + SUCCESS + 动态码）。
3. **三个审批家族共用 "APPROVAL" 字样**：大额/解冻/制裁退款，报表上分不清谁是谁。
4. **同一动作两个名**：退款有官员标签路（REFUNDED_BY_TAG）和双人审批路（SANCTION_REFUNDED），动作一样（拒单+解锁退余额）。
5. **锁释放独立留痕**（LOCK_RELEASED）：四个终局出口各自留痕之外再加一条"锁已解"——一事双痕。

## 新名册（25 码；S=旅程起点 / I=继承；★=必带审批因果）

**出生（1）**
| 码 | 模式 | 必填 | 说明 |
|---|---|---|---|
| WITHDRAW_CREATED | **S** | amount, currency, ownerCustomerNo | 建单铸旅程号；吞 WITHDRAW_REQUESTED（客户发起走操作员通道 recordByActor，演示造数走 SYSTEM——同一件事两条通道，不是两个名） |

**大额闸（3）**
| WITHDRAW_LARGE_VALUE_REQUESTED | I | — | 开大额审批案（现 APPROVAL_REQUESTED，三家族去歧义改名） |
| WITHDRAW_LARGE_VALUE_PASSED | I★ | approvalNo, 从/到 | 批准落地回合规流（现 APPROVAL_GRANTED） |
| WITHDRAW_REJECTED | I★ | approvalNo, 从/到 | 拒批落地=终局+解锁（现 APPROVAL_DECLINED；解锁金额进 metadata） |

**合规流转（8）**
| WITHDRAW_SUMSUB_SUBMITTED | I | — | 单笔报送（保留） |
| WITHDRAW_ONHOLD | I | — | 官方挂起复核中（保留） |
| WITHDRAW_MANUAL_CHECKING | I | 从/到 | 进人工复核（新增，顶动态码；SLA 破线/官方拒绝两成因进 reason） |
| WITHDRAW_ACTION_REQUIRED | I | 从/到 | 要求客户补料（新增，顶动态码，镜像充值） |
| WITHDRAW_FROZEN | I | 从/到 | 冻结（sceneTag 进 metadata；保留） |
| WITHDRAW_KYT_VERDICT_IGNORED | I | reason | 迟到/终态裁决零处理（保留）；吞 SANCTION_HIT_ON_IGNORED_VERDICT（sceneTag 进 metadata，冻人由限制账自己留痕——镜像充值裁定） |
| WITHDRAW_POST_BROADCAST_VERDICT | I | reason | 钱已在途裁决才到：证据入册+红旗待复核（保留——与"忽略"是两件事：这个写证据、可能插旗） |
| WITHDRAW_COMPLIANCE_PASSED | I | 从/到 | 合规全过、进付款（保留）；吞 MANUAL_APPROVED（翻案语义=从 MANUAL_CHECKING 来，镜像充值） |

**付款与终局（4）**
| WITHDRAW_PAYOUT_INITIATED | I | — | 两条资金单腿铸出、钱在途（保留） |
| WITHDRAW_PAYOUT_COMPLETED | I | 成功:从/到 | 一码双结局（镜像充值 PAYIN_COMPLETED）：SUCCESS=外部确认+落账；FAILED=付款失败→整单 FAIL+解锁（吞 PAYOUT_CONFIRMED + PAYOUT_FAILED） |
| WITHDRAW_BOUNCED | I | 从/到 | 已付款被退票→冲正回客户（保留；operator 通道，费用不退明示在 reason） |
| WITHDRAW_SUCCESS | I | 从/到 | 终局一条痕；吞 ACCOUNTING_POSTED（账证细节进 metadata）+ 动态码 |

**费用尾巴（2）**
| WITHDRAW_FEE_LEG_REBUILT | I | — | 费腿重建 attempt N（保留；资金单号上牵连主体） |
| WITHDRAW_FEE_SETTLE_STUCK | I | reasonCode | 停摆红旗，两因归码：SETTLE_EXHAUSTED（落账 3/3）/ LEG_EXHAUSTED（腿 3/3）（保留） |

**冻结处置（4）**
| WITHDRAW_UNFREEZE_REQUESTED | I | — | 去中缀改名（现 UNFREEZE_APPROVAL_REQUESTED） |
| WITHDRAW_UNFROZEN | I★ | approvalNo, 从/到 | 解冻落地（保留） |
| WITHDRAW_REFUND_REQUESTED | I | — | 开制裁退款审批案（现 SANCTION_REFUND_APPROVAL_REQUESTED 改名） |
| WITHDRAW_REFUNDED | I | 从/到 | 退款落地=拒单+解锁退余额；吞 REFUNDED_BY_TAG（官员标签路，从 MANUAL_CHECKING）+ SANCTION_REFUNDED（审批路，从 FROZEN，携 approvalNo）——同一动作两个门，从/到分路径；FROZEN 上标签越权尝试 → 本码 outcome=DENIED reasonCode=FROZEN_REQUIRES_APPROVAL（吞 REFUND_TAG_ON_FROZEN_IGNORED，镜像充值 DENIED 用法） |

**SLA 与演示（3）**
| WITHDRAW_SLA_BREACHED | I | fromStatus | 破线（保留；软/硬进 metadata） |
| WITHDRAW_SLA_TIMEOUT_SIMULATED | I | — | 演示拨钟（保留） |
| WITHDRAW_DEMO_SCENARIO_RUN | I | — | ⚡场景执行（保留） |

## 锁释放归并（一事双痕收敛）

`releaseLock` 的独立留痕 LOCK_RELEASED 取消——四个解锁出口的**落地行**携解锁事实（metadata: releasedNet/releasedFee）：REJECTED ｜ PAYOUT_COMPLETED·FAILED ｜ REFUNDED ｜（解冻不解锁，不涉及）。锁动账本身已有 TB 凭证，不缺账。

## 废除清单（进 DEPRECATED 拒写闸）

动态族 `WITHDRAW_<从>_TO_<到>` 整族（正则拒写）｜ REQUESTED ｜ APPROVAL_REQUESTED/GRANTED/DECLINED ｜ MANUAL_APPROVED ｜ ACCOUNTING_POSTED ｜ PAYOUT_CONFIRMED/PAYOUT_FAILED ｜ SANCTION_HIT_ON_IGNORED_VERDICT ｜ REFUNDED_BY_TAG/SANCTION_REFUNDED ｜ REFUND_TAG_ON_FROZEN_IGNORED ｜ LOCK_RELEASED ｜ AWAITUSER_EMPTY_ACTIONS（降日志）｜ UNFREEZE_APPROVAL_REQUESTED/SANCTION_REFUND_APPROVAL_REQUESTED（改名）
零铸码死常量（ORCHESTRATED×3 / CREATED_TO_PAYOUT_PENDING / PAYOUT_PENDING_TO_SUCCESS / EXTREME_VOLATILITY_BLOCKED / FAILED_REVERSED / FINAL_GATE_BLOCKED / FLAGGED / PRICING_QUOTE 族 / RELEASED / RELEASE_BLOCKED）物理删除，不进退役表（从没写过，无历史行）。

## 接线范围（认了名册就动）

① 常量表新增 `V5_WITHDRAW_AUDIT_ACTIONS` 四属性表 + 废除名单进拒写闸（含动态族正则）+ CONTRACT_ACTION_DOMAINS 纳 WITHDRAW；② 提现单表加旅程号列（迁移+重铺闸）；③ `updateStatus` 内建动态留痕拆除 + 边×码覆盖对照；④ 39 写点换信封（withdrawAudit 助手，镜像 depositAudit）；⑤ 测试同步；⑥ 收尾闸全家 + verify:audit 提现段转绿。


## 落地实况（as-built，2026-08-27 站2-β 接线终盘）

25 码全数落地，四项判断题按业主 2026-08-27 裁定执行：大额闸改名 LARGE_VALUE_* ✅｜
锁释放并入落地行（REJECTED / PAYOUT_COMPLETED·FAILED / REFUNDED 携 releasedNet/releasedFee）✅｜
POST_BROADCAST_VERDICT 保留 ✅｜费用词根统一 **FEE_RETRIED / FEE_STUCK**（对比表暴露的跨域
不一致，取代草稿的 FEE_LEG_REBUILT/FEE_SETTLE_STUCK 保守留名）✅。

接线中顺带矫正的生产件：
- **状态机内建动态留痕拆除**（每流转双写的病根在 updateStatus 里，比充值重）；
  边×码覆盖对照 21 条边全接住，新增 MANUAL_CHECKING×2 / ACTION_REQUIRED 三个落点
- **详情页审计时间线读器**整个停在旧合同（orderBy 已删列当场炸/三臂查询全空/
  靠解析动态码取从到）——矫正为按业务键单臂查询+直读从/到两列
- mock 建单器删除（直插表违规、零使用方）；e2e 夹具补铸旅程号、查痕助手改查业务键

落地实测：demo:all 8/8｜提现旅程样本 CREATED→COMPLIANCE_PASSED→SUMSUB_SUBMITTED→
PAYOUT_INITIATED→PAYOUT_COMPLETED→SUCCESS 同旅程号一串｜verify:audit 提现行入
Q2/Q4 双绿池（客户维度单客命中 26 条）｜退役码零写入 ✓｜五套 e2e 49/49。
