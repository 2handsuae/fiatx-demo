# 第六幕清残留 · 波四「前端拆分」—— 骨架

> 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` §3 波四行
> 本文件是骨架，**不是 spec**。波四 spec 的展开是下一个新会话读总纲 + 本承接后跟业主脑暴的活，收尾会话不代做。

## 承接上一波（波三「主体分层」，2026-09-20 收官）

- **后端读面契约本波零变更**（波四前端拆分的前提）：T6 的 `getCase()` 拆分与 `buildFlowComparison()` 挪件全程逐字段核实返回 DTO 不变（评审独立编译复现），T1-T9 全部任务均以"栈级输出 diff 为唯一硬判据"约束，两份归一 diff（`demoall-diff.txt` / `break-diff.txt`）在 T0 对照组与 T10 收尾复采之间逐字节为空（`wc -c` 实测均 0）。**后端对外的读面（API 出参形状）本波确认零变更**，波四前端拆分可以放心假设当前接口契约稳定，不需要先核对后端是否又改了什么。
- **实际偏差**：
  - `walletNo` 纯反查：spec §1.4 记 5 处，实为 **6 处**（第 6 处是 `reconciliation-query.service.ts` 的 `getCase()` 内 `walletRow` 反查，评审对 base 版本核实逐字等价后收敛并入）。
  - `recon-run` spec 直构：plan 写 10 处，实为 **15 处**，已全部换 `buildSvc` 工厂构造，spec 注入真服务、既有断言零改动。
  - `run()` 拆分后仍有 **190 行**（含 8 路聚合胶水的编排层），非机械拆分能再压缩的部分，评审认可这是结构本身的解释而非拆分不彻底。
  - T1 的 `ReconciliationCaseService` 类**不声明** `simulateTimeout`（Ruling R1 裁定：接口块该行是给 T4 的预告，非 T1 交付物；未实现的声明在闸①下会红），T4 再补齐该方法。
  - T6 两处必要类型标注（非类型谎言，评审各自独立复现）：① `caseBook` 显式标注 `CauseBook`——切面边界的 literal widening 必要项；② `matchType` 控制流窄化——值域从 5 缩到 3，经 `builder` 字面量清单证实合法收窄，非"假装类型变窄"。
  - T9 记账边界 `null → undefined` 归并：`tb-account-registry.service.ts:72` 的 `?? null` 归一写法，经值流实追安全（`where` 逐字节同），非静默行为变化。
- **新事实**：
  1. `CreateAuditLogEventDto` 按 `payloadDigest` 先例补了 `causeCode?` / `outlet?` 两个可选字段（依据词表 `audit-actions.constant.ts:871` 的 `requiredFields` 顶层声明）——业主须知：这是审计载荷类型声明补全，不是新增业务字段，不影响任何前端可见面。
  2. `" as any"` grep 判据照不到的残留类型逃逸形态（已登记 `TOOLING-DEBT.md`，提不修）：`const subjects: any[]` 三处（`adjustment.service.ts:832/:960`、`push-order.service.ts:241`）+ `as unknown as string[]` 一处（`internal-transfer.dto.ts:32`，波二遗留）。这些不影响波四前端拆分，纯后端内部类型债。
  3. `recon-demo.ts` 的 break 清单落盘路径写死 `/tmp/exchange_js_main/recon-demo-manifest.json`（self 栈跑批也写 main 路径，T0 对照组采样时发现，既有脚本行为，已登记 `TOOLING-DEBT.md`，提不修）——若波四要用该产物做走查物证，注意它落在 main 路径而非当前 worktree 的 self 路径。
  4. `recon-run` 顶部的 `AuditActions` import 系波前既有死导入（评审经 `git show` 复现，非本波引入），只留 WRAPUP 提及，未清，留终审分诊。
- **判据达成事实**（波四开工前的干净基线）：
  - Case 表写点全仓唯一文件 `reconciliation-case.service.ts`（5 处：:68/:113/:146/:161/:175），复现命令见波三 spec §1.1，波四若不碰这层不会破坏该判据。
  - 三域非 prisma 的 `as any` 归零（复现命令 0 行，见波三 spec §1.3），`TOOLING-DEBT.md:143` 已销账。
  - 变异物证 4 份在案：`mutation-transition-{red,green}.txt`（迁移表非法跃迁）、`mutation-firm-gate-{red,green}.txt`（处置门 `AMOUNT_MISMATCH×FIRM` 硬边界）。
  - jest 对账三域基线：**29 suites / 561 tests**（波前 28/556 → T1 +1 suite/+3 tests → T8 +2 tests，其余任务零改计数）。
  - `verify:coa` 全绿（4 条恒等式 + 57 科目负余额检查）。

## 已定事实（波三带过来的，波四开工前必须知道）

- **主体边界已立**：Case 有自己的服务与显式迁移表（`ReconciliationCaseService`：`openCase` / `reObserve` / `resolveAutoHealed` / `findOpenByWallet` / `simulateTimeout` / `markSlaBreached` / `assertTransition`），`status` 写点已从 3 个文件收敛为 1 个。波四前端拆分如果要展示 Case 状态相关信息，读的是这一层的既有出参，不需要也不应该绕过它直接拼状态。
- **大方法已拆**：`run()` 331→190 行、`getCase()` 414 行按五段编排拆分、`buildFlowComparison()` 挪进独立的 `FlowComparisonBuilder`（-198 行）。波四要拆的前端大文件（`ReconciliationCasesDetailPage.tsx` 1893 行、`ReconciliationAdjustmentCreateModal.tsx` 821 行）是**纯前端**结构问题，后端这几个方法的拆分对它们没有直接依赖，只是确认了"跨层同款问题、后端已经示范过一次拆法"。
- **铁律③已修**：划转 `approvalNo` 回填改走 `InternalTransferService.stampApprovalNo`（照 `stampExternalRef` 先例），workflow 不再直写表。
- **`dispositionsFor()` 硬边界已补**：`AMOUNT_MISMATCH × FIRM` 组合现在会经 `sourceAdjustable` 门再给 `REVERSE`，`RECORD` 不设门（种子铺不到该组合，行为闸未触发，靠变异实证 + jest 三用例证明该路径存在且正确）。前端如果渲染处置按钮矩阵，此后端行为变化理论上会影响按钮可见性——**波四若涉及该弹窗/矩阵渲染，需先确认前端是否有自己一份重复的按钮启用逻辑**（`rowAdjustmentPrefill` 一类前端自算业务判断，正是总纲 §3 波四行本身列的边界）。
- **两个 helper 已收敛**：`walletNo` 反查（6 处纯反查，混合 select 的 2 处按 Ruling R2 不收敛——`internal-transfer.service.ts:106` 的关系嵌套 select 不属同款）、`decimals` Map 构造（5 处）均收敛为共用 util，`XREF` 防御语义逐字保留。

## 待定岔口

**无**——波四范围已在总纲 §3 波四行定稿（`ReconciliationCasesDetailPage.tsx` 1893 行拆分 / `ReconciliationAdjustmentCreateModal.tsx` 821 行 / 前端自算业务判断收回后端，含 `rowAdjustmentPrefill().direction` 提现类缺翻符号已知行号 `:330-337` / 3 组重复块收敛；验收口径=第六幕五页 + 三个弹窗逐页截图与波前比对像素级同构 + 闸②全绿），本次收尾任务执行过程中未发现需要业主重新拍板的新岔口。若波四新会话展开 spec 时发现总纲范围与代码现状有出入（例如前端自算逻辑的实际分布与总纲描述不符），按惯例在波四 spec 里如实列出，不在本骨架臆测。
