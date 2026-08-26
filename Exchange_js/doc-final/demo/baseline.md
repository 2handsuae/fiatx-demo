# 基线（Phase 4 · Step 0 钉死）

> 钉定时点：2026-08-26 ｜ 代码基准：7c53afd4 ｜ 环境：main 栈经 `stack.sh reset main` 从零重铺后实测
> **判据铁律：此后一切验证以「净新失败 = 0」为准，不是"全绿"。** 下方红名单是已知、已登记的旧账——瘦身过程中它们继续红不算事故；**不在名单上的新红才是事故**。
> 重钉纪律：只在 Phase 4 收官、或业主批准的行为变化后重钉；每次重钉记 CHANGELOG 一行。

## 绿名单（当前全绿）

| 类 | 项 |
|---|---|
| 编译 | tsc 后端 ｜ tsc 管理台 ｜ tsc 客户端 |
| 重铺 | `stack.sh reset main`（新入口，含 TigerBeetle 清理重建，全链实跑）｜ `stack.sh reset-main`（旧入口） |
| 演示 | demo:setup ｜ demo:deposit ｜ demo:swap ｜ demo:withdraw ｜ demo:in-transit ｜ demo:all（8 场景断言终态） |
| 对账 | recon:demo:pass ｜ verify:demo-data |
| 账本 | verify:coa —— 两恒等式 + 负余额断言（重铺后 49 科目全部 ≥ 0）ALL INVARIANTS PASS。⚠️ 此绿的测点是**重铺后立即**；demo:all 跑完后再测必见 2 个公司 AED 负余额（浮存未预铺，见 BACKLOG 环境卫生节），不算净新红 |

## 红名单（已知旧账，允许持续红）

**jest 全量：4 套 / 8 例失败**（共 164 套 2148 例；另 2 skipped / 4 todo）——

- `src/modules/identity/access-control/role-definition-create-workflow.service.spec.ts`
- `src/modules/asset-treasury/wallets/system-wallet.util.spec.ts`
- `src/modules/asset-treasury/wallets/wallets.service.spec.ts`
- `client-web/src/utils/restrictedCapabilities.spec.ts`（vitest 文件被 jest 捡起，结构性红）

⚠️ 记忆口径曾是"3 套 4 例"——实测已漂到 4/8，以本文件为准。

**recon:demo:break：7/9 检出**——#5 BANK_CHARGE、#7 BANK_INTEREST 两类 SOFT_FLAG 破口 MISSED（BACKLOG 在案）。

**verify:audit：5 项失败**（重铺后零治理动作 + 三域写旧词表所致，BACKLOG 已拆三域随各域回收切）——
```
✗ Q2 按单据查全部 —— 库里没有任何 PRIMARY 子表行
✗ Q4 按客户查全部 —— 库里没有任何 OWNER=CUSTOMER 子表行
✗ Q5 拒绝有痕 —— 0 条非 SUCCESS
✗ Q6 谁查过审计日志 —— 0 条 AUDIT_LOG_QUERIED
✗ V1 词表已被使用 —— 0 个 V1 码有真实写入
（三条不变量 ✓：PRIMARY 至多一 / INHERIT 必有 correlationId / 退役码零写入）
```

## e2e（不在全量 jest 内，单独口径）

`test/` 下 e2e 按新宪法属 Phase 4 候删对象，不入本基线；确需跑用 `npx jest --config test/jest-e2e.json`，结果单独表述。
