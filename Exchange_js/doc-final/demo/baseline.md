# 基线（Phase 4 收官重钉）

> 钉定时点：2026-08-27 ｜ 代码基准：45a4f1a8（Phase 4 七站全合 + 收官清扫）｜ 环境：main 栈经 `stack.sh reset main` 从零重铺后实测
> **判据铁律：此后一切验证以「净新失败 = 0」为准，不是"全绿"。** 下方红名单是已知、已登记的旧账——它们继续红不算事故；**不在名单上的新红才是事故**。
> 重钉纪律：只在业主批准的行为变化后重钉；每次重钉记 CHANGELOG 一行。
> 重钉历史：2026-08-26 Step 0 首钉（7c53afd4）→ **2026-08-27 收官重钉（本版）**。

## 绿名单（当前全绿）

| 类 | 项 |
|---|---|
| 编译 | tsc 后端 ｜ tsc test 配置（tsconfig.test.json）｜ tsc 管理台 ｜ tsc 客户端 |
| 重铺 | `stack.sh reset main`（含 TigerBeetle 清理重建，全链实跑） |
| 演示 | demo:setup ｜ demo:deposit ｜ demo:swap ｜ demo:withdraw ｜ demo:in-transit ｜ demo:all（8 场景断言终态） |
| 对账 | recon:demo:pass ｜ **recon:demo:break 9/9 全检出**（收官实测；旧基线 7/9 的两处 MISSED 已不复现，旧账已销）｜ verify:demo-data |
| 账本 | verify:coa —— 两恒等式 + 负余额断言（49 科目全部 ≥ 0）。收官多轮实测**重铺后与 demo:all 后均全绿**；历史上个别含 break 注入的运行轮见过公司 AED 负余额（浮存时序），若复现不算净新红 |
| 审计 | verify:audit 恒绿七项：Q2 按单据查 ｜ Q4 按客户查 ｜ 不变量①②③（PRIMARY 至多一 / INHERIT 必有旅程号 / 退役码零写入）——三查合同七站换装后的固定资产 |
| 封册 | audit-vocabulary-closure.spec 四条：平面表归籍 / 六册互斥 / V3 附册冻结快照 / 写点闭合退役词零引用 |

> ⚠️ **重铺前必须先 `stack.sh down <栈>` 停栈，否则 TigerBeetle 清不掉。** `reset-stack.sh` 的 `rm -f` 对运行中进程持有的文件只是 unlink，旧 tigerbeetle 仍在旧 inode 上服务 → SQLite 重铺了、TB 没有 → 客户 UUID 全新使 `CLIENT_PAYABLE` 读 0 而 SYSTEM 口径 `CLIENT_ASSET` 留旧余额（恒等式假红），多轮提现累积还会把公司 AED 打成负数（负余额假红）。2026-08-28 平账一期实测定位——正确顺序：`down` → `reset` → `up`，此后 `demo:all` 完 `verify:coa` 全绿。

> 💡 **`verify:coa` 建议在 `test:e2e recon-adjustment-money-arcs` 之后再跑一次。** 调账单的四种分录组合里，`FIRM`+`REDUCE`（银行杂费）与 `FIRM`+`INCREASE`（银行利息）**只有这支 e2e 会真落账**——`demo:all` 不碰调账。在 e2e 之后跑 `verify:coa`，四种组合各自落账后的恒等式与负余额就都被覆盖了（spec §9 验收第 3 条的要求），零额外成本。2026-08-28 平账一期末站实测：e2e 后 ALL INVARIANTS PASS。

## 红名单（已知旧账，允许持续红）

**jest 全量：4 套 / 8 例失败**（共 **164 套 2082 例**；另 3 skipped / 4 todo）—— 计数于 2026-08-28 平账一期刷新（+3 套 +64 例，全部来自调账单：`adjustment-rules` / `adjustment.service` / `adjustment-approval.service`；失败清单逐字未变）——

- `src/modules/identity/access-control/role-definition-create-workflow.service.spec.ts`（crypto is not defined，环境性）
- `src/modules/asset-treasury/wallets/system-wallet.util.spec.ts`
- `src/modules/asset-treasury/wallets/wallets.service.spec.ts`
- `client-web/src/utils/restrictedCapabilities.spec.ts`（vitest 文件被 jest 捡起，结构性红）

**verify:audit 波动带（不算净新红）**——
```
Q5 拒绝有痕 ｜ V1 词表已被使用：取决于 demo 运行窗口内是否触发重复制裁命中 /
  治理动作，红绿都属正常（收官同一天两轮实测一红一绿）
Q6 谁查过审计日志：重铺后恒红，管理员真查一次审计页当场转绿（活体已证）——
  演示剧本第七幕含此动作，正式走查时自然绿
```

## e2e（单独口径，收官起入基线）

全量 11 套件 **83/83**（收官在 main 实测）。跑法三要素，缺一必假红：

1. **私库先铺**：六个自带独立库的套件（kyt-verdict-landing / sanction-subject-split / deposit-verdicts / material-requests / customer-restrictions / sla）在每次 `stack.sh reset` 后库被清空，须逐库 `DATABASE_URL=file:/tmp/exchange_js_main/<e2e-库名>.db` 依次 `prisma migrate deploy` + `db:base:sync` + `db:biz:init`；
2. **串行跑**：`bash scripts/on-stack.sh main test:e2e --runInBand <11 个文件>`（**不要**在文件列表前多写 `--`，会被 jest 当路径模式吞掉 runInBand）；并行会互踩栈库出假红；
3. **干净态起跑**：栈库残留多轮数据会触发日累计限额假红；`reset` + 重铺私库后一次跑完。

已知偶发：funds_orderNo 时间戳撞号极低概率 flake（生成器熵，非行为红），重跑即绿。
