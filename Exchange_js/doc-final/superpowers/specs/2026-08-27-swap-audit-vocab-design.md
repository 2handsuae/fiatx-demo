# 兑换域审计新名册设计稿（站3-β）

日期：2026-08-27 ｜ 分支：refactor/v6-slim ｜ 底稿：现役 21 具名码实测清单（α1 已清 6 零铸码死名）
承接充值/提现全部裁定：失败不起名（outcome+reasonCode）｜同动作不因语境拆名｜现名保守｜旅程号 CREATED=START 铸根其余 INHERIT｜subjects 角色｜SLA fromStatus 必填。

## 兑换的好底子（与前两域不同）

建得晚：**无动态迁移码族、无每流转双写、无时间线读器旧合同**；腿家族已用 RETRIED/STUCK 词根；FROZEN 零出边终态（无解冻/退款家族）；无 maker-checker 弧（全名册无 requiresCausation）。病灶只剩：`*_FAILED` 起名三处 + 缺旅程号列。

## 新名册（18 码；S=旅程起点，其余全 I）

**出生（1）**
| SWAP_CREATED | **S** | amount, currency, ownerCustomerNo | 报价执行落单（客户操作员通道）；一码双结局：FAILED=执行失败（行可能未落库，无旅程号可铸，reasonCode=EXECUTION_ERROR）——吞 SWAP_FAILED |

**KYT 合规（5）**
| SWAP_KYT_SUBMITTED | I | — | 卖腿（携裁决）/买腿（仅数据）两次报送同码，reason 区分；一码双结局吞 SWAP_KYT_SUBMIT_FAILED×2（reasonCode=SUBMIT_ERROR，腿别进 metadata） |
| SWAP_KYT_APPROVED | I | 从/到 | 放行进结算 |
| SWAP_KYT_REJECTED | I | 从/到 | 拒绝落地（结算腿零铸出） |
| SWAP_KYT_VERDICT_IGNORED | I | reason | 迟到/终态裁决零处理 |
| SWAP_POST_APPROVAL_VERDICT | I | reason | 已进结算窗口才到的裁决：证据入册+红旗（镜像提现 POST_BROADCAST） |

**拒绝处置与通知决策（1）**
| SWAP_KYT_REJECTED_DISPOSED | I | reason | **tipping-off 决策留痕**（制裁命中不通知/粘滞沉默/正常通知——给调查员解释"客户被告知了什么"）；一码双结局吞 SWAP_KYT_REJECTED_DISPOSITION_FAILED |

**冻结（1）**
| SWAP_FROZEN | I | 从/到 | KYT 制裁 + 批量限制两处同码（成因进 metadata） |

**结算腿（5）**
| SWAP_LEG_POSTED | I | — | 每腿过账（资金单号上牵连主体，legSeq/attempt 进 metadata） |
| SWAP_LEG_RETRIED | I | — | 腿自愈重建 attempt+1 |
| SWAP_LEG_STUCK | I | reasonCode | 三级梯耗尽红旗（LEG_EXHAUSTED，与两域停摆词根同池） |
| SWAP_LEG_RESUMED | I | — | 运营手动复驱（操作员通道 recordByActor） |
| SWAP_LEG_HALTED_BY_RESTRICTION | I | — | 客户被限→在途腿停进 |

**终局（1）**：SWAP_SUCCEEDED ｜ I ｜ 从/到 ｜ 全腿结清（PROCESSING→SUCCESS）

**客户级（1）**：SWAP_ACTION_GREEN_HARDLINE_HELD ｜ I ｜ reason ｜ 硬线客户 GREEN 到过、限制刻意保留

**SLA 与演示（3）**：SLA_BREACHED（fromStatus）｜ SLA_TIMEOUT_SIMULATED ｜ DEMO_SCENARIO_RUN

## 废除清单（3 具名进 DEPRECATED 拒写闸）

SWAP_KYT_SUBMIT_FAILED ｜ SWAP_KYT_REJECTED_DISPOSITION_FAILED ｜ SWAP_FAILED

## 接线范围

① 常量表 V6_SWAP_AUDIT_ACTIONS + CONTRACT_ACTION_DOMAINS 纳 SWAP + 退役 3 名（总 50）；② swap_transactions 加旅程号列（迁移+重铺闸）；③ swapAudit 信封助手 + 25 写点换装（含 LEG_RESUMED 操作员通道）；④ 测试同步；⑤ 收尾闸全家 + verify:audit 兑换段入双绿池。

## 竣工记（As-built，2026-08-27）

- 18 码全部接线（b9615058）：工作流 20 写点经 `swapAudit()` 助手换装；SLA 破线/模拟、演示场景、GREEN_HARDLINE 四卫星写点随迁。
- 与设计差异仅一处：接线中发现 SLA 破线拒单缺擦出生锁，随手补上（见出生锁竣工记）。
- 助手带事务 client 形参（兑换审计大半在事务内），client 缺省时不传占位参数（保持 mock 断言的参数簿相干净）。
- verify:audit 兑换段入池后 7/8：Q2/Q4/Q5/V1 较基线转绿，唯 Q6（无人查过审计日志）为基线既有红。
- 域内单测 189/189；兑换 e2e 11/11。
