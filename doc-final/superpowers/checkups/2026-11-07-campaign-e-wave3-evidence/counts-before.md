# 改前计数（戊波三 T0，代码头 `dc94f70c`，self 栈 `demo:all` 之后）

环境：每条命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；仓库根执行。

## 审计词表

命令：`npm run audit:vocab > <文件> 2>&1; echo $?`（不接管道）→ **退出码 1**。
首行：`审计动作码名册与种子文档对不上——先修种子/常量再重跑，不写盘。`；「有码没说明」**29 个**：

```
DD_ASSESSMENT_CONCLUDED DD_ASSESSMENT_OPENED DD_ASSESSMENT_SAVED DD_INFOSEC_RECORDED DD_SCREENING_RECORDED
DOCUMENT_UPLOADED
HOUSE_TRANSFER_CANCELLED HOUSE_TRANSFER_EXECUTION_STARTED HOUSE_TRANSFER_FAILED HOUSE_TRANSFER_LEG_POSTED
HOUSE_TRANSFER_REJECTED HOUSE_TRANSFER_REQUESTED HOUSE_TRANSFER_SETTLED
INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED
LP_PROFILE_APPROVAL_CANCELLED LP_PROFILE_RESUBMITTED LP_PROFILE_RETURNED LP_PROFILE_SENT_FOR_APPROVAL
VENDOR_ACTIVATED VENDOR_APPLIED VENDOR_APPROVAL_CANCELLED VENDOR_APPROVAL_REJECTED VENDOR_APPROVED
VENDOR_MATERIALITY_UPGRADED VENDOR_NOTIFICATION_OPENED VENDOR_REJECTED VENDOR_RESUBMITTED VENDOR_RETURNED
VENDOR_SENT_FOR_APPROVAL
```
「种子有码、常量里不在现役也不在退役名册」：0 个。

## 权限桶 / 域 / 组

命令：`bash scripts/on-stack.sh self verify:rbac > <文件> 2>&1`，引 S13d 行（该脚本读 `rbac.catalog.ts` 的三源并集）：

> ✓ S13d … 域 15（预期 15）｜ACTION_BUCKET_CATALOG 共 89 桶（预期 89）｜route∪职务绑定∪桶 三源并集共 96 个组（预期 96）

= **15 域 / 89 桶 / 96 组**（与 spec 一致）。

注：同一次 `verify:rbac` 退出码 **1**（共 1 条 FAIL）——不是 S13d，而是 **S7**：`catalog 字典真实性` 报 4 行找不到 controller 端点：`api.post.admin_deposit_sumsub_demo_run_verdict`、`api.get.admin_deposit_sumsub_demo_verdict_buttons`、`api.post.admin_withdraw_sumsub_demo_run_verdict`、`api.get.admin_withdraw_sumsub_demo_verdict_buttons`。改前就红（本任务零代码改动），后续任务对照时以「仍只有这 1 条 S7」为不变量。

## 其他计数

| 项 | 命令 | 结果 |
|---|---|---|
| `assertPostOutflowCompliant` 调用点 | `grep -rn "assertPostOutflowCompliant" src --include='*.ts' \| grep -v "spec.ts"` | 定义 1（`prudential.service.ts:142`）＋**调用 3**：`lp-exchange-workflow.service.ts:120`、`vendor-payment-workflow.service.ts:95`、`house-transfer-workflow.service.ts:95`（另有 3 处注释提及） |
| demo-ops 端点 | `grep -n "@Post\|@Get" src/modules/demo-ops/demo-ops.controller.ts` | **3**：`GET status`、`POST reset`、`POST recon-break` |
| 审计种子文档行数 | `grep -cE '^\|\s*\`[A-Z0-9_]+\`\s*\|.*\|.*\|.*\|.*\|$' doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md` | **364** |
| `decisions.md` 行数 | `wc -l doc-final/decisions.md` | **170** |
| 花名册 / 断言 | `bash scripts/on-stack.sh self demo:all`（退出 0） | 花名册 **35/35**；asserts **5/5 PASS** |
| NLA | `nla-status-before.json` | `nlaAedMinor` = **136475225**（口径二）；floor 120000000；headroom 16475225 |
