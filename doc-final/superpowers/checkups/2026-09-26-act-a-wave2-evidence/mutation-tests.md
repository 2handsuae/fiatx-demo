# 变异测试三点（Task 11，spec §11）

三点均按「改 → 跑红 → 还原 → 跑绿」执行；全程结束 `git status --porcelain` 确认树净（见文末）。

## ① FILING_TRANSITIONS 删 SIGNED_OFF→SUBMITTED 边

**改动**：`src/modules/governance/regulatory-filings/regulatory-filing.constants.ts`
```diff
-  [FilingStatus.SIGNED_OFF]: [FilingStatus.SUBMITTED],
+  [FilingStatus.SIGNED_OFF]: [], // MUTATION-1
```

**红**：`npx jest src/modules/governance/regulatory-filings --colors`
- EXIT: `1`
- 关键行：
  ```
  Test Suites: 1 failed, 3 passed, 4 total
  Tests:       4 failed, 49 passed, 53 total
  ● markSubmitted › sets the sibling NOTICE-chain deadline ... BadRequestException: Invalid filing transition SIGNED_OFF → SUBMITTED
  ● addEntry › rejects a kind outside the enum ... BadRequestException: Invalid filing transition SIGNED_OFF → SUBMITTED
  ● close › closes a SUBMITTED filing ... BadRequestException: Invalid filing transition SIGNED_OFF → SUBMITTED
  ● audit envelope ... walks the full lifecycle ... BadRequestException: Invalid filing transition SIGNED_OFF → SUBMITTED
  ```

**还原**：改回 `[FilingStatus.SIGNED_OFF]: [FilingStatus.SUBMITTED],`

**绿**：`npx jest src/modules/governance/regulatory-filings --colors`
- EXIT: `0`
- 关键行：`Test Suites: 4 passed, 4 total` / `Tests: 53 passed, 53 total`

## ② 签发链角色误换运营（OPS_OFFICER 顶替 SENIOR_MANAGEMENT_OFFICER）

**改动**：`src/modules/governance/approvals/constants/approval.constants.ts`
```diff
   [ApprovalActionTypes.REG_FILING_SUBMIT]: {
-    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48, allowCancel: true,
+    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }], timeoutHours: 48, allowCancel: true, // MUTATION-2
   },
```

**⚠️ 中途发现（记入证据链）**：第一次改完常量直接跑 e2e，**全绿**——不是判据失效，是环境事实：`ApprovalsService.approve/reject` 走 `ApprovalPolicyService.getPolicy()`，**DB 里 `approval_action_policies` 表若已有该 `actionType` 的持久化行，优先于代码里的 `DEFAULT_APPROVAL_POLICIES` 常量**（`approval-policy.service.ts:44-53`：`policy?.checkerRoles` 分支先于 `fallback`）；self 栈的库在 T5 起就已写入 `REG_FILING_SUBMIT → SENIOR_MANAGEMENT_OFFICER` 这一行，只改常量不 `db:base:sync` 不会被运行时读到——与「改 RBAC 常量必须 `db:base:sync` + 重启」是同一类环境事实的审批侧版本，登记在此、不改判据本身。修正做法：改完常量后对 self 栈 `db:base:sync`（把新配置 upsert 进该库的持久化行），e2e 才会读到变异。

**同步命令**：
```
DATABASE_URL="file:/tmp/exchange_js_wt_act_a_wave2_filing/dev.db" TB_ADDRESS="127.0.0.1:3103" npm run db:base:sync
```
- EXIT: `0`；`sqlite3 ... "select actionType, checkerRoles from approval_action_policies where actionType='REG_FILING_SUBMIT';"` → `REG_FILING_SUBMIT|OPS_OFFICER`（确认库已同步变异）

**红**：`bash scripts/on-stack.sh self test:e2e -- test/regulatory-filing.e2e-spec.ts`
- EXIT: `1`
- 关键行：
  ```
  FAIL test/regulatory-filing.e2e-spec.ts
    ✕ ① 出站全链 ...
    ✕ ② 驳回环 ...
    ✕ ③ 钟链 ...
    ✓ ④ 入站 ...
    ✕ ⑤ 结案联动 ...
    ✓ ⑥ 手工越界 ...
  ForbiddenException: Actor role SENIOR_MANAGEMENT_OFFICER cannot sign the current pending step (step 1)
      at src/modules/governance/approvals/approvals.service.ts:694
  ```
  （e2e①按 spec 点名必红——确认命中；②③⑤连带红是同一签发链的自然传导，不是判据本身之外的噪音）

**还原**：常量改回 `SENIOR_MANAGEMENT_OFFICER`，再次 `db:base:sync`（同一命令）
- EXIT: `0`；DB 复核 → `REG_FILING_SUBMIT|SENIOR_MANAGEMENT_OFFICER`
- `git diff --stat src/modules/governance/approvals/constants/approval.constants.ts` → 空（源码已复位）

**绿**：`bash scripts/on-stack.sh self test:e2e -- test/regulatory-filing.e2e-spec.ts`
- EXIT: `0`
- 关键行：`Tests: 6 passed, 6 total`（① ② ③ ④ ⑤ ⑥ 全部 ✓）

## ③ markSubmitted 的 externalRef 前置闸注释掉

**改动**：`src/modules/governance/regulatory-filings/regulatory-filing.service.ts`
```diff
-    if (!dto?.externalRef) throw new BadRequestException('Marking a filing as submitted requires an externalRef');
+    // if (!dto?.externalRef) throw new BadRequestException('Marking a filing as submitted requires an externalRef');
```

**红**：`npx jest src/modules/governance/regulatory-filings/regulatory-filing.service.spec.ts --colors`
- EXIT: `1`
- 关键行：
  ```
  Tests: 1 failed, 22 passed, 23 total
  ● markSubmitted › rejects a missing externalRef
    expect(received).rejects.toThrow()
    Received promise resolved instead of rejected
    Resolved to value: {"chainDeadlineSetFor": [], "filingNo": "FIL260926594199"}
  ```

**还原**：取消注释，恢复前置闸

**绿**：`npx jest src/modules/governance/regulatory-filings/regulatory-filing.service.spec.ts --colors`
- EXIT: `0`
- 关键行：`Tests: 23 passed, 23 total`

## 收尾：树净证据

```
$ git status --porcelain
（无输出）
```

三点变异全部红→绿闭环，源码与 self 栈 DB（②涉及的 `approval_action_policies` 表）均已复位到变异前状态。
