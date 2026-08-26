# 对账演示管线 (Reconciliation Demo) — 设计

> 状态：设计 / 待实现
> 日期：2026-06-21
> 范围：在已落地的交易数据层（`demo:all`）之上做对账 demo —— 去锚点的 external 生成 + pass/break 两模式 + break manifest + 只读「注入 vs 检出」对比页。
> 前置已完成（本会话）：交易数据层 `demo:*`、手动结算 `runManualCryptoSettlement`、`settlementType` 6 值枚举重构。

---

## 0. 一句话

读 `demo:all` 产出的真实资金单 → 合成外部对账单（完美 or 带刻意 break）→ 跑对账引擎 `APPLY` → admin 用记分卡 / case / 对比页展示，并能验证「对账引擎抓到的 = 故意注入的」。

---

## 1. 现状与缺口

- **引擎/UI 已有**（pre-session V8 redesign）：credit-net 五公式（式1–5）+ 四桶（matched / ORPHAN_INTERNAL / ORPHAN_EXTERNAL / AMOUNT_MISMATCH）；`ReconciliationRun` / `ReconciliationCase` / `ReconciliationLineItem`；admin run/case/external-balance 页 + 记分卡。
- **交易数据层已有**：`demo:all` 产出真实 `payin`/`payout`/`internalFund`（Alice/Bob/Grace；**法币已结算、虚拟币挂起**；refs `REF-DEMO-*`/`0xDEMO*`；业务日 = 运行当天）。
- **缺口**：现有 `recon:gen`（`recon-redesign-statement-gen.ts`）写死 `BUSINESS_DATE='2026-06-16'` + `REF-SEED5`/`0xSEED5` 锚点（找不到抛 "seed data drift"），**吃不进 `demo:all` 数据**；且它永远注入 break（无 pass 模式）、无 manifest、无对比页。

---

## 2. 端到端流程

```
demo:all ──► 内部账(真实充/兑/提, crypto pending)
                  │
   recon:demo ────┤ 读内部真实资金单 → 合成外部对账单
   --mode=pass    │   pass : 外部 = 内部                → 全绿、0 case、空 manifest
   --mode=break   │   break: 外部 = 内部 但故意破坏 ~6 笔 → 写 demoManifest(答案键)
                  ▼
        RedesignReconRunService.run(APPLY, demoManifest)  ── 式1-5 + 4桶, 落 run/case/lineItem
                  │
                  ▼
   admin: 记分卡(绿/红) → case(看差异桶) → 「Demo 对比页」(注入 vs 检出, ✓/✗/⚠)
```

---

## 3. 组件设计

### 3.1 `recon:demo` 脚本（去锚点，取代 `recon:gen`）
新建 `scripts/recon-demo.ts`，**吸收** `recon-redesign-statement-gen.ts` 的外部合成逻辑（Zand/HexTrust 字段映射、closing = TB − in-transit − Σbreak、FIRM treasury backfill、归一化两表 upsert），但去锚点：
- **业务日**：`--date=YYYY-MM-DD`，默认今天（`demo:all` 数据的实际业务日）。
- **资产**：按 `currency` 查 AED/USDT（不写死 UUID）。
- **break 目标**：从当天真实记录里**动态挑**（不依赖 `REF-SEED5`）；把挑中的记录写进 manifest。
- **mode**：`--mode=pass|break`（默认 `break`）。
  - `pass`：external 完美镜像内部 → 式4/式5 tie 0、0 case、不写 manifest。
  - `break`：注入 **~6 笔**（每币种 3 桶各 1）：
    - `ORPHAN_INTERNAL`：从外部流水里**删一笔**真实 payin（内部有外部无）；
    - `ORPHAN_EXTERNAL`：**加一笔**无内部对应的进账（外部有内部无）；
    - `AMOUNT_MISMATCH`：把一笔的外部金额**改掉**（同笔金额不符）；
    - 跨 **AED(CLIENT)** + **USDT(CLIENT/FIRM)**；构建 `demoManifest`。
- 调 `RedesignReconRunService.run({ businessDate, triggerType:'MANUAL', mode:'APPLY', demoManifest })`。
- 末尾控制台打印 injected-vs-detected 摘要（沿用现有 gen 的 break 打印 + 回读 run）。
- **运行前**清当天 external 两表 + 上次 demo run（幂等可复现，沿用 gen 的清理）。

> crypto-pending 态下：式1–3 应绿（内部账未被动；式3 桥对 open outstanding），式4/式5 在被注入的 currency×book 红。

### 3.2 manifest（答案键）
- 加列 `ReconciliationRun.demoManifest String?`（可空 JSON）——手写迁移 SQL（`prisma/migrations/<ts>_recon_demo_manifest/migration.sql` + `npm run db:migrate:local`，按项目约定，**不用 `prisma migrate dev`**）。
- 形状：
  ```json
  { "generatedAt": "<ISO>", "breaks": [
    { "currency":"AED", "book":"CLIENT", "bucket":"ORPHAN_INTERNAL",
      "targetType":"payin", "targetRef":"REF-DEMO-3-AED",
      "internalAmount":"2865.50", "externalAmount":null, "signedDelta":"2865.50", "note":"omitted from external" } ] }
  ```
- `RedesignReconRunService.run` 加**可选** `demoManifest` 入参；`APPLY` 时写到该 run 行（`pass` 模式不传 → 列保持 null）。

### 3.3 对比 endpoint + 页面
- **端点** `GET /admin/reconciliation/demo/compare?runNo=...` → `{ run, manifest, detected, reconciliation }`，其中：
  - `detected` = 该 run 的 case line-items（按 currency/book/bucket/ref）；
  - `reconciliation` = 服务端按 `(currency, book, bucket, ref)` 把 manifest 与 line-items 配对，产出 `matched` / `missed`（注入但未检出）/ `extra`（检出但未注入）。
  - 加到 `reconciliation-admin.controller.ts` + `reconciliation-query.service.ts`（新 query 方法）。
- **RBAC**：登记新 GET 端点（`rbac.catalog.ts` `route()` + `db:base:sync` + **重启后端**）；复用对账读权限族（与现有 reconciliation GET 同 permission）。
- **admin 页**：新只读 `ReconciliationDemoComparePage`（左 = manifest 注入项 │ 右 = detected，按配对标 ✓抓到 / ✗漏 / ⚠多检；`pass` 模式两侧空 → 「perfect tie」）。`run` 详情页（`ReconciliationRunsDetailPage`）当该 run `demoManifest` 非空时，显示一个「Demo 对比」入口链接（否则不显示 → production 页面保持干净）。

### 3.4 退役旧脚本
- 删 `scripts/recon-redesign-statement-gen.ts`（`recon:gen`）+ `scripts/recon-redesign-run-verify.ts`（`recon:redesign`）+ `package.json` 两条命令；先 `grep` 确认无其它引用。
- `recon:drilldown`（`recon-drilldown-verify.ts`）本轮**不动**（不在退役名单；plan 阶段确认它是否也锚死，单列处理）。

### 3.5 打包/流程
`npm run dev:reset`（干净 branch 业务种子）→ `npm run demo:all`（造真实业务数据）→ `npm run recon:demo -- --mode=pass|break`（外部 + 对账 + manifest）→ admin 看记分卡 / case / Demo 对比页。命令分开（数据 vs 对账）。`recon:demo` 对脚本数据与手建订单都成立（去锚点）。

---

## 4. 终态 / 验收

- **pass**：式1–5 全 PASS、0 case；对比页空（无注入无检出）。
- **break**：注入 ~6 笔；式1–3 绿（内部自洽，含 crypto-pending 桥 via 式3），式4/式5 在被注入的 currency×book 红；case 里 4 桶可钻；对比页左右 **1:1 对上**（matched = 注入数、missed = 0、extra = 0）。
- **可复现**：`recon:demo` 重跑前清当天 external + 上次 demo run；同输入同结果（金额随实时汇率漂移的部分用符号/关系断言）。
- **回归**：现有 reconciliation jest 全绿；admin 记分卡/case 页渲染不破。

---

## 5. 文件计划

**新增**：`scripts/recon-demo.ts`；`admin-web/.../ReconciliationDemoComparePage.tsx`（+ 路由）；`reconciliation-admin.controller.ts` 端点 + `reconciliation-query.service.ts` query 方法；迁移 `*_recon_demo_manifest`。
**改动**：`RedesignReconRunService.run`（+`demoManifest`）；`prisma/schema.prisma`（`ReconciliationRun.demoManifest`）；`package.json`（+`recon:demo`，−`recon:gen`/`recon:redesign`）；`rbac.catalog.ts`；`ReconciliationRunsDetailPage`（条件入口链接）。
**退役删除**：`recon-redesign-statement-gen.ts`、`recon-redesign-run-verify.ts`。
**复用（不改）**：`BalanceSnapshotService` / `InTransitService`（closing 计算）、`RedesignReconRunService`（引擎）、scorecard/case/external-balance 页。

---

## 6. 决策记录

- **结算态**：crypto pending 直接对账（式3 展示在途桥）。
- **对比页**：单独只读页 + run-detail 条件入口（production 页保持干净）。
- **break 目录**：每币种 3 桶各 1，跨 AED+USDT、CLIENT+FIRM（~6 笔）。
- **旧脚本**：`recon:gen` + `recon:redesign` 退役。
- **manifest 存储**：`ReconciliationRun.demoManifest` 列（可空 JSON）。

---

## 7. 非目标

- 不接真实 Sumsub/银行/链（外部仍是合成）。
- 不做平账 / Reimbursement（止于 case OPEN + 对比展示）。
- 不迁移历史对账数据。
- 不动 `recon:drilldown`（本轮范围外）。
