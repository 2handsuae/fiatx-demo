# Backlog — Spec #5 + Cross-Cutting Infra（截至 2026-06-16，Spec #4 收官时刻）

> 本文档由 Spec #4 收尾时同步落盘，记录已 flag 但本会话不做的所有事项，避免下次会话重新挖掘。颗粒度按 spec 候选 / infra 问题 / minor 三档拉通。

---

## A. Spec #5 候选三件套（异常路径完备性）

底层逻辑：Spec #1-#4 已经把 happy path 的 traceId/audit/命名拉齐，但**异常路径**（CANCEL / FAIL / TIMEOUT / REORG / REOPEN）的 audit 词汇虽已建好，**业务触发路径多数未实现**——形成"半截工程"。完备性矩阵：

```
entity × state × transition × audit
        | CREATE | CONFIRM | CLEAR | CANCEL | FAIL | TIMEOUT | REORG | REOPEN
PAYIN          ✓      ✓        ✓       ?      ?       ?         ?       ?
OUTSTANDING    ✓      -        -       -      -       -         ?       ?
FEE_ACCRUAL    ✓      -        -       -      -       -         ?       ?
INTERNAL_FUND  ✓      ✓        ✓       ✓      ✓       ✓         ✓*      -
SWAP_QUOTE     ✓      ✓        ✓       ?      -       -         -       -
                                                    (*) 代码就位/未触发
```

### A1. SWAP_QUOTE_CANCELLED 触发路径补齐

- **代码现状**：`AuditActions.SWAP_QUOTE_CANCELLED` 常量存在（`audit-actions.constant.ts:355`），`swap-quote.service.ts:364` 已调用
- **真实问题**：DB 历史 0 行——业务流程根本不触发该路径
- **触发条件未定**：quote 过期？user cancel？admin 手动 cancel？产品需求未明
- **预计颗粒度**：1-3 个任务（看是否需要新建 cancel API + sim 触发器）

### A2. OUTSTANDING / FEE_ACCRUAL / INTERNAL_FUND REORG 路径

- **代码现状**：`AuditActions.REORGED='REORGED'` 常量存在（line 416），`buildInternalFundStateAction('RETURNED')→'REORGED'` 映射在 Spec #4 helper 里
- **真实问题**：outstandings/fee-accrual/funds-flow service **0 调用点**——状态机定义里也没有 reorg/reopen 转换
- **触发方应在**：crypto-listener / payin 状态机收到 chain reorg 信号时回退已 CONFIRMED/CLEARED 的资金
- **预计颗粒度**：5-8 个任务（reorg 信号入口 + Outstanding 反向 transition + FeeAccrual 反向 transition + INTERNAL_FUND reorg + audit + sim）
- **依赖**：链 listener 现状（chain reorg detection 是否已建？）需先侦察

### A3. OUTSTANDING REOPENED 路径

- **业务语义**：已 CLEARED 的 Outstanding 被强制回退（人工 / 系统流程触发）
- **代码现状**：0 实现
- **状态**：**需求未明**——产品定义"什么场景下需要 REOPEN" 之前不要拍设计
- **建议**：等产品需求驱动、暂不做

### A4. 风控分流（独立大题、可独立成 Spec）

- **问题**：风控有自己的实体 `KYT_CASE / TRAVEL_RULE_CASE / RISK_DECISION_RECORD / COMPLIANCE_CASE_EVIDENCE_PACKAGE`（`AuditEntityTypes` 第 49-66 行都有），但 **audit 全挂在 DEPOSIT 上**（`DEPOSIT_COMPLIANCE_STARTED / DEPOSIT_KYT_APPLIED / DEPOSIT_COMPLIANCE_EVIDENCE_SYNCED` 等）
- **DB 实测**：4 个风控 entityType **全 0 行**
- **顶层设计未对齐**：风控状态机是不是该跟 DEPOSIT/SWAP/WITHDRAW 分离？分离后 audit 流水线怎么拉通？
- **独立 Spec 候选**：建议单独一轮，颗粒度 5-10 任务

---

## B. Cross-Cutting Infra 问题（横切、阻塞 Spec #4 live recon）

### B1. SQLite 单写锁 vs audit-logs 独立 prisma 连接竞争（**最高优先级**）

- **症状**：`swap-workflow.service` 5s tx body 内做 swap + TB + outstanding + fee-accrual + 5+ audit 写入 → P2028 transaction timeout（5072ms > 5000ms）
- **根因**：`audit-logs.service` 用独立 prisma 连接写 audit，与业务 prisma tx 抢 SQLite 单写锁
- **Spec #4 影响**：sim-e2e-demo 卡在 TASK 3 swap 处，无法跑通完整 live recon（绕用 sim-spec4-audit-verify 脚本验证 audit 行为）
- **历史尝试**：DT-T7 试过把 tx timeout 5s→15s，没用（commit `820e449` 已 revert in `5e06196`）
- **3 个候选方案**（独立 Spec）：
  1. audit 接入业务 tx（合连接、不再竞争锁）
  2. audit outbox 模式（业务 tx 提交后异步 audit）
  3. 上 PostgreSQL（绕过 SQLite 单写锁、最彻底）
- **预计颗粒度**：3-7 任务，需要先深度侦察 audit-logs.service 与 prisma 连接管理

---

## C. 小项 backlog（minor、独立修复）

### C1. `generateReferenceNo('DEP')` P2002 低熵冲突

- **症状**：sim-deposits-only 偶发 P2002 unique constraint violation 在 DEP 编号
- **根因**：DEP 编号生成器熵不足（可能 4 位短串）
- **修复**：generator 加长 / 加 retry
- **历史**：在多个 sim 失败里出现、被 flag 但未做

### C2. fiat-settlement-workflow 5s tx timeout

- **症状**：fiat-settlement 也踩 P2028 类似 B1 但单独 trip
- **根因**：fiat settlement workflow 单 tx 内做太多事
- **依赖 B1**：和 audit/tx 共用连接同问题，B1 解了这个也好了

### C3. `SettlementBatch.totalFeeAccrualCount / settledFeeAccrualCount` 计数器回填

- **症状**：Spec #3 / LE-A 时建了 fee counter 字段但旧数据没回填，新数据计数从 0 起算
- **影响**：非阻塞、回填一次性 SQL UPDATE 即可

### C4. `cryptoPaths` spec medium array 缺 `CRYPTO_SWAP_FEE_COLLECT`

- **症状**：`whitelist-paths.constant.spec.ts` 的 medium 数组列表少一项
- **修复**：补常量 + 测试 expect
- **优先级**：极低、纯测试覆盖度

---

## D. Working Tree 遗留（与本轮无关）

| 文件 | 状态 | 归属 |
|---|---|---|
| `scripts/reset-business-data.ts` | 修改 | 早前工作（非 Spec #4） |
| `scripts/sim-deposits-only.ts` | 新增 | 早前工作（非 Spec #4） |
| `scripts/sim-swaps-only.ts` | 新增 | 早前工作（非 Spec #4） |

不属本 Spec #4 范围，若启动 Spec #5 / B1 时一并清理。

---

## E. 决策导航（下次会话开局判断）

| 用户说 | 推荐 Spec |
|---|---|
| "继续异常路径完备性" | **Spec #5 = A1 + A2 (含 sim)**，颗粒度 5-8 任务 |
| "继续风控审计" | **Spec #6 = A4 风控分流**（独立大题） |
| "先解 sim 阻塞" | **Spec INFRA-1 = B1 SQLite 写锁治本**，颗粒度 3-7 任务、解了之后 Spec #5 才能跑完整 live recon |
| "小修一下" | **C1-C4 minor 包**，~半天合一个 PR |

---

## F. 当前 main → branch 状态（提交基线）

```
489f2e9 test(spec#4): add minimal audit-verifier sim          ← Spec #4 收官
202561c chore(spec#4): drop 7 obsolete constants
d14a37f feat(spec#4): drop INTERNAL_TRANSFER audit double-write
be67e94 feat(spec#4): internal-transfer-workflow short names
66f2d57 feat(spec#4): internal-funds.service short names
70789d4 feat(spec#4): funds-flow.service short names
5117453 feat(spec#4): add short-name constants + helper
6bafd6c fix(spec#4): UPPERCASE alignment
2d75fbf docs(plan): Spec #4 plan
ecda186 docs(spec): Spec #4 design
... (pre-Spec#4 history)
```

8 commits 上 branch、未 merge main、未推 remote（按 standing rule）。
