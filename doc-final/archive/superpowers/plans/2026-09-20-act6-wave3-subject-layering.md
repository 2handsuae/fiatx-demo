# 第六幕清残留 · 波三「主体分层」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Case 立主体服务 + 显式迁移表（判据 4），拆掉三个大方法，修一处铁律③直写，补一格处置矩阵硬边界，抽两个重复 helper，26 处非 prisma `as any` 全清——**除处置矩阵一格（演示不可达）外全程零行为变更**。

**Architecture:** 先采对照组（栈级输出基线），再从内向外动：① Case 主体服务立起来并接线（写点收敛），② 两个 util 收敛，③ 拨钟/破线收敛进主体，④⑤ 机械拆 `run()` 与 `getCase()`（含 FlowComparisonBuilder 挪件），⑥ 铁律③，⑦ 处置门，⑧ `as any` 扫尾（含审计 DTO 两个先例式补字段），⑨ 收尾闸 + diff 对照 + 承接。

**Tech Stack:** NestJS + Prisma（SQLite）+ TigerBeetle + Jest。`recordByActor/recordSystem` 入参是 `CreateAuditLogEventDto`（有词表 requiredFields 校验）；调账迁移表先例在 `adjustment-transitions.constant.ts` + `adjustment.service.ts:44 assertTransition`。

**Spec:** `doc-final/superpowers/specs/2026-09-20-act6-wave3-subject-layering-design.md`（执行者先读它 + 总纲 §3 波三行）

## Global Constraints

- CLAUDE.md §0–§5 全部适用；派 subagent 时任务 prompt 必须带上其要点（§6 铁规）
- **行为零差异是唯一硬判据**：`demo:all` + `recon:demo:break` 栈级输出归一后逐字节 diff = 空（唯一例外：`dispositionsFor` 的 `AMOUNT_MISMATCH×FIRM` 门——种子铺不到该组合，diff 仍应为空）
- **搬运纪律**：Case 写点/审计信封搬家时载荷**逐字段等价**，禁止顺手"规整"字段、禁止改 `RECON_CASE_OPENED` metadata（UUID 问题归波五）
- **类型纪律**（承接波一）：`as any` / `as unknown as X` / `!` 非空断言 / `@ts-ignore` 一律禁用于新代码；摘 `as any` 暴露的冲突若必须改行为才能解 → **熔断停手报主会话**，不许为过闸改行为
- **测试纪律**：禁止为让测试通过而放宽断言；`writeLineItems` 的 13 键白名单与值断言（`wallet-recon-run.service.spec.ts`）原样保留；新导出的符号必须先有真实消费者
- **既有测试改动白名单**：仅当断言锚定的是本波 spec 明文改变的行为（处置门一处），才允许按新行为更新断言，commit 文案须点名 spec 依据
- 基线：main `f0ba4cd4`；对账三域 jest **28 suites / 556 tests** 全绿；`verify:rbac` 既有 2 条 FAIL（`TOOLING-DEBT:137` + `BACKLOG:228`）
- 执行环境：worktree + self 栈（`superpowers:using-git-worktrees` 建树；栈命令一律 `bash scripts/stack.sh ... self` / `bash scripts/on-stack.sh self ...`）
- 本机 shell 默认 node18：每条命令前置 `PATH="/Users/songshengwei/.nvm/versions/node/v20.20.2/bin:$PATH" `（**平铺形式，不用子壳、不混 cd/git 链**——护栏判例见 `TOOLING-DEBT.md:139`）
- jest 带库跑：`DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers`
- 评审分层：任务级 review 走执行档；**Task 1（状态写点）与 Task 9（记账边界触点）终审不降档**
- 物证目录：`doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence/`（下文简称 `$E`）
- commit 不加 attribution 行

---

## 文件结构

**新建（4）**
- `src/modules/clearing-settle/reconciliation/constants/case-transitions.constant.ts` — 2 态 1 边迁移表
- `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts` — Case 主体服务（全仓唯一 Case 表写点）
- `src/modules/clearing-settle/reconciliation/domain/wallet-no.util.ts` — walletNo 反查（XREF 防御语义逐字保留）
- `src/modules/clearing-settle/reconciliation/domain/asset-decimals.util.ts` — decimals Map 纯函数
- `src/modules/clearing-settle/reconciliation/domain/flow-comparison.builder.ts` — `buildFlowComparison` 挪件（Task 6 时新建）
- `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts` — 主体服务单测

**改（13）**
- `workflow/wallet-recon-run.service.ts` — 写点改调服务、删 2 个审计私法、拆 `run()`、2 处 `as any`（:1052/:1053 Task 9、:539 Task 9）
- `workflow/case-aging.service.ts` — 瘦身到只剩 `findBreachCandidates`
- `sweep/case-aging-sweep.service.ts` — 改注入 + 1 处 `as any`
- `domain/reconciliation-query.service.ts` — `getCase()` 拆、builder 挪出、3 处 `as any`
- `disposition/adjustment.service.ts` — walletNo/decimals 收敛、7 处 `as any`、1 行注释措辞
- `disposition/disposition.service.ts` — walletNo 收敛、1 处 `as any`
- `disposition/push-order.service.ts` — 1 处 `as any`
- `disposition/cause-registry.ts` + `cause-registry.spec.ts` — 处置门
- `controllers/reconciliation-admin.controller.ts` — 拨钟改注入、1 处 `as any`
- `reconciliation.module.ts` — providers 注册
- `src/modules/governance/incidents/incidents.controller.ts`（或 `dto/incident.dto.ts`）— 4 处 `as any`
- `src/modules/asset-treasury/internal-transfers/internal-transfer.service.ts` + `internal-transfer-workflow.service.ts` — 铁律③ + 2 处 `as any`
- `src/modules/audit-logging/dto/audit-log.dto.ts` — 补 `causeCode?` / `outlet?` 两个可选字段（先例式，见 Task 9）
- `workflow/wallet-recon-run.service.spec.ts` — 构造注入真 Case 服务（断言不动）
- `doc-final/TOOLING-DEBT.md` / 总纲 / `CHANGELOG.md` / 波四骨架 — 收尾

**26 处 `as any` 归属对照**（收尾核数用）：Task 2 清 recon-run :995/:1011（2）｜Task 4 清 case-aging :80（1）｜Task 6 清 query :476/:605/:643（3）｜Task 7 清划转 :133/:143（2）｜Task 9 清其余 **18**（adjustment 7 + incidents 4 + disposition 1 + push-order 1 + sweep 1 + admin-controller 1 + recon-run :1052/:1053 + :539 共 3）。合计 26。

---

### Task 0: 对照组采样（必须最先——动完就永远补不回来）

**Files:** 只新建 `$E` 物证目录，零代码。

- [ ] **Step 1: 物证目录 + 基线 SHA**

```bash
mkdir -p doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence
E=doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence
git rev-parse HEAD > "$E/BASELINE_SHA"; cat "$E/BASELINE_SHA"
```

Expected：40 位 SHA 落盘（应 = `f0ba4cd4` 所在提交或其后的 spec commit）。

- [ ] **Step 2: 重铺 + 采栈级基线**（标准序：reset → up → 等就绪 → 采样；判例=旧库重跑 demo:all 必红）

```bash
bash scripts/stack.sh reset self
bash scripts/stack.sh up self
bash scripts/on-stack.sh self demo:all         > "$E/demoall-before.txt" 2>&1
bash scripts/on-stack.sh self recon:demo:break > "$E/break-before.txt"   2>&1
tail -3 "$E/demoall-before.txt"; tail -3 "$E/break-before.txt"
```

Expected：两份文件收尾是正常完成行（非报错栈）。**两次采样（before/after）之间不许换栈、不许改采样流程。**

- [ ] **Step 3: 归一副本**（复用波一入档的归一规则，不另立规则）

```bash
N=doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/normalize-rules.sh
bash "$N" "$E/demoall-before.txt" > "$E/demoall-before.norm.txt"
bash "$N" "$E/break-before.txt"   > "$E/break-before.norm.txt"
wc -l "$E"/*.norm.txt
```

- [ ] **Step 4: Commit**

```bash
git add doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence
git commit -m "test(波三对照组): 栈级输出基线采样(demo:all+recon:demo:break)+归一副本+BASELINE_SHA"
```

---

### Task 1: Case 迁移表 + 主体服务（判据 4 本体）

**Files:**
- Create: `constants/case-transitions.constant.ts`、`domain/reconciliation-case.service.ts`、`domain/reconciliation-case.service.spec.ts`
- Modify: `reconciliation.module.ts`（providers 加 `ReconciliationCaseService`）

**Interfaces（Task 2/4 依赖，签名逐字用）:**

```ts
// constants/case-transitions.constant.ts —— 照 adjustment-transitions 先例，只登记现存边
export const CaseStatus = { OPEN: 'OPEN', RESOLVED: 'RESOLVED' } as const;
export const CASE_TRANSITIONS: Record<string, string[]> = {
  [CaseStatus.OPEN]: [CaseStatus.RESOLVED],
  [CaseStatus.RESOLVED]: [],
};
```

```ts
// domain/reconciliation-case.service.ts
@Injectable()
export class ReconciliationCaseService {
  constructor(private readonly prisma: PrismaService, private readonly auditLogs: AuditLogsService) {}

  assertTransition(from: string, to: string): void; // 照 adjustment.service.ts:44 逐字：非法 → BadRequestException(`Illegal reconciliation case status transition: ${from} → ${to}`)

  findOpenByWallet(walletRef: string): Promise<{ id: string; caseNo: string } | null>;
  // = recon-run 现 :738-744 的探针原样（where { walletRef, status:'OPEN' }, select { id, caseNo }）

  openCase(input: OpenCaseInput): Promise<{ caseId: string; caseNo: string }>;
  reObserve(input: ReObserveInput): Promise<void>;
  resolveAutoHealed(input: { caseId: string; caseNo: string; walletRef: string; runId: string; traceId: string | null; resolvedAt: Date }): Promise<void>;
  markSlaBreached(id: string): Promise<void>;
  simulateTimeout(caseNo: string, actor: ApprovalActorContext): Promise<{ caseNo: string; slaDeadline: string }>; // Task 4 才填实现，本任务先不建
}

export interface OpenCaseInput {
  runId: string; businessDate: string; assetId: string; assetCode: string; layer: string;
  book: string; walletRef: string; coaCode: string | null; ownerNo: string | null;
  tbAmount: Prisma.Decimal; inTransitAmount: Prisma.Decimal; expectedExternal: Prisma.Decimal;
  actualExternal: Prisma.Decimal; deltaAmount: Prisma.Decimal;
  severity: string; bucket: ReconBucket; slaDeadline: Date;
  traceId: string | null;   // run 的 traceId，只喂审计
  delta: bigint;            // 只喂审计 metadata.deltaAmount
}
export interface ReObserveInput {
  caseId: string; runId: string;
  tbAmount: Prisma.Decimal; inTransitAmount: Prisma.Decimal; expectedExternal: Prisma.Decimal;
  actualExternal: Prisma.Decimal; deltaAmount: Prisma.Decimal;
  severity: string; bucket: ReconBucket;
  assetId: string; assetCode: string; book: string; coaCode: string | null; ownerNo: string | null;
}
```

**载荷等价表（搬运时逐字段抄，来源行号在波前基线上）：**
- `openCase` 内部顺序：`count({ where: { businessDate } })` → `caseNo = \`REC${businessDate.replace(/-/g, '')}-${String(priorToday + 1).padStart(3, '0')}\`` → `create` data = recon-run :789-816 的 23 个字段逐字（`layer` 用 `input.layer`；`traceId: randomUUID()` 是 **case 自己的**，与审计用的 `input.traceId` 是两个东西，别搞混）→ 发 `auditCaseOpened`（信封 = recon-run :976-996 逐字，`} as any` 顺手摘掉——subjects 已用枚举、字段全在 DTO，直接就能编译）→ return
- `reObserve` 的 update data = recon-run :752-771 的 14 个字段逐字
- `resolveAutoHealed` 内部顺序：`findUnique({ where: { id: caseId }, select: { status: true } })`（查不到 → `NotFoundException`）→ `assertTransition(row.status, CaseStatus.RESOLVED)` → update data = `{ status: 'RESOLVED', resolutionReason: 'AUTO_HEALED', resolvedAt: input.resolvedAt, lastUpdatedRunId: input.runId, closedByRunId: input.runId }`（= recon-run :960-968 逐字，`resolvedAt` 由调用方传——autoHealCases 现在是循环外算一次 `now`，语义必须保住）→ 发 `auditCaseAutoHealed`（信封 = recon-run :998-1012 逐字，摘 `as any`）
- `markSlaBreached` = case-aging :39 逐字

- [ ] **Step 1: 写常量文件 + 服务骨架 + 失败测试**

`reconciliation-case.service.spec.ts`（mock 只造行为、不回显断言；断言的是**服务自己算出的东西**——caseNo 序号、硬编码结案字段、非法跃迁拒绝）：

```ts
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReconciliationCaseService } from './reconciliation-case.service';

const makeDeps = () => {
  const reconciliationCase = {
    count: jest.fn().mockResolvedValue(41),
    create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'case-uuid-1', ...data })),
    update: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  };
  const prisma: any = { reconciliationCase };
  const auditLogs: any = { recordSystem: jest.fn().mockResolvedValue(undefined), recordByActor: jest.fn().mockResolvedValue(undefined) };
  return { prisma, auditLogs, reconciliationCase };
};
const dec = (s: string) => new Prisma.Decimal(s);
const openInput = (deps?: Partial<any>) => ({
  runId: 'run-1', businessDate: '2026-09-20', assetId: 'a1', assetCode: 'AED', layer: 'WALLET',
  book: 'CLIENT', walletRef: 'w-1', coaCode: '1101', ownerNo: 'CUS001',
  tbAmount: dec('100'), inTransitAmount: dec('0'), expectedExternal: dec('90'),
  actualExternal: dec('90'), deltaAmount: dec('-10'),
  severity: 'LOW', bucket: 'BREAK' as const, slaDeadline: new Date('2026-09-23T20:00:00Z'),
  traceId: 'trace-run', delta: -10n, ...deps,
});

describe('ReconciliationCaseService（波三判据 4）', () => {
  it('openCase：按 businessDate 序号铸 caseNo，状态落 OPEN，发 RECON_CASE_OPENED', async () => {
    const d = makeDeps();
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    const out = await svc.openCase(openInput());
    expect(out.caseNo).toBe('REC20260920-042');                       // count=41 → 042：服务算的，不是回显
    expect(d.reconciliationCase.create.mock.calls[0][0].data.status).toBe('OPEN');
    const audit = d.auditLogs.recordSystem.mock.calls[0][0];
    expect(audit.action).toBe('RECON_CASE_OPENED');
    expect(audit.metadata.deltaAmount).toBe('-10');                   // bigint→string 是服务干的活
  });
  it('resolveAutoHealed：OPEN → RESOLVED 落 AUTO_HEALED 五字段，发 RECON_CASE_AUTO_HEALED', async () => {
    const d = makeDeps();
    d.reconciliationCase.findUnique.mockResolvedValue({ status: 'OPEN' });
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    const at = new Date('2026-09-20T12:00:00Z');
    await svc.resolveAutoHealed({ caseId: 'c1', caseNo: 'REC1', walletRef: 'w-1', runId: 'run-2', traceId: null, resolvedAt: at });
    expect(d.reconciliationCase.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'RESOLVED', resolutionReason: 'AUTO_HEALED', resolvedAt: at, lastUpdatedRunId: 'run-2', closedByRunId: 'run-2' },
    });
    expect(d.auditLogs.recordSystem.mock.calls[0][0].action).toBe('RECON_CASE_AUTO_HEALED');
  });
  it('resolveAutoHealed：已 RESOLVED 的案再 resolve 被显式拒（迁移表真调用）', async () => {
    const d = makeDeps();
    d.reconciliationCase.findUnique.mockResolvedValue({ status: 'RESOLVED' });
    const svc = new ReconciliationCaseService(d.prisma, d.auditLogs);
    await expect(svc.resolveAutoHealed({ caseId: 'c1', caseNo: 'REC1', walletRef: 'w-1', runId: 'run-2', traceId: null, resolvedAt: new Date() }))
      .rejects.toThrow(BadRequestException);
    expect(d.reconciliationCase.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db" npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts
```

Expected：FAIL（服务未实现 / 模块不存在）。

- [ ] **Step 3: 实现服务**（按上面接口与载荷等价表；`openCase`/`resolveAutoHealed` 内的审计方法把 recon-run :976-1012 两个私法**原样搬来**并摘 `} as any`——摘完必须直接编译过，不许改任何键）+ module providers 注册

- [ ] **Step 4: 跑测确认通过 + 闸①**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db" npx jest src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts
npx tsc --noEmit -p tsconfig.json
```

Expected：PASS + tsc 绿。（此刻 recon-run 尚未接线——两个审计私法在两处并存，Task 2 删旧的。）

- [ ] **Step 5: 变异实证甲（迁移表不是摆设）**：注释掉 `resolveAutoHealed` 里的 `assertTransition` 调用 → 复跑 Step 4 的 jest → 第 3 条用例必红；还原复绿。两次输出存 `$E/mutation-transition-{red,green}.txt`

- [ ] **Step 6: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/constants/case-transitions.constant.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts src/modules/clearing-settle/reconciliation/reconciliation.module.ts doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence
git commit -m "feat(波三T1): Case主体服务+2态1边显式迁移表(照adjustment先例)——openCase/reObserve/resolveAutoHealed/markSlaBreached+审计随写点,非法跃迁显式拒+变异实证"
```

---

### Task 2: recon-run 接线（写点出走，行为零差异）

**Files:**
- Modify: `workflow/wallet-recon-run.service.ts`、`workflow/wallet-recon-run.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `ReconciliationCaseService` 全部方法
- Produces: `WalletReconRunService` 构造签名变为 7 参（末位 `caseService: ReconciliationCaseService`）——Task 5 拆 `run()` 踩在本任务之上

- [ ] **Step 1: 改 `upsertCaseForWallet`**：顶部 Decimal 换算与 `computeSeverity` 不动；探针 `findFirst` 换 `this.caseService.findOpenByWallet(input.walletRef)`；`existing` 分支的 update 块换 `await this.caseService.reObserve({ caseId: existing.id, runId: input.runId, ...14 字段 })`（后随的 `reconciliationLineItem.deleteMany` **留在原地**——行明细是 run 的证据写点，不是 Case 表）；`else` 分支的 count+create 块换 `const opened = await this.caseService.openCase({ ...23 字段, layer: RUN_LAYER, traceId: input.traceId, delta: input.delta })`。`upsertCaseForWallet` 的 input 类型**新增 `traceId: string | null` 一个字段**，其余不动

- [ ] **Step 2: 改 `run()` 两处调用点**：:278/:339 两处传入 `traceId: run.traceId ?? null`；删除 :299/:361 两行 `await this.auditCaseOpened(...)`（审计已随写点进 `openCase`，只在 created 路径发——语义同现状）

- [ ] **Step 3: 改 `autoHealCases`**：`findMany` 探针不动；循环体换 `await this.caseService.resolveAutoHealed({ caseId: c.id, caseNo: c.caseNo, walletRef: c.walletRef, runId: input.runId, traceId: input.traceId, resolvedAt: now })`（`now` 仍在循环外算一次）；删除本文件的 `auditCaseOpened` / `auditCaseAutoHealed` 两个私法（**`auditRunCompleted` 留下**，它是跑批级留痕，Task 9 清它的 `as any`）

- [ ] **Step 4: 更新 spec**：`wallet-recon-run.service.spec.ts` 有 10 处直构。文件顶部加一个工厂并逐处替换（**所有既有断言一行不动**——Case 写仍落在同一个 mock prisma 上，13 键白名单与 create/update 断言原样成立）：

```ts
import { ReconciliationCaseService } from '../domain/reconciliation-case.service';
const buildSvc = (deps: any) =>
  new WalletReconRunService(
    deps.prisma, deps.balanceChecker as any, deps.flowMatcher as any, deps.tigerBeetle as any,
    deps.auditLogs as any, deps.explainedDifferences as any,
    new ReconciliationCaseService(deps.prisma, deps.auditLogs),   // 真服务 + 同一套 mock：写点行为可见
  );
```

（spec 文件里的 `as any` 是 mock 造型，波一定过：不在清账范围。）

- [ ] **Step 5: 三域 jest 全绿 + 闸①**

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
npx tsc --noEmit -p tsconfig.json
```

Expected：29 suites（28+T1 新增 1）全绿，数字记下来（收尾报实数）。若 13 键白名单红了 → 停下检查搬运是不是弄丢/多写了字段，**改代码不改断言**。

- [ ] **Step 6: 写点收敛复核（判据 7 预演）**

```bash
grep -rn "reconciliationCase\.\(create\|update\|updateMany\|upsert\|delete\)" src --include='*.ts' | grep -v '\.spec\.ts'
```

Expected：recon-run 零命中；命中只剩 `reconciliation-case.service.ts`（3 处）+ `case-aging.service.ts`（2 处，Task 4 收）。

- [ ] **Step 7: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.spec.ts
git commit -m "refactor(波三T2): recon-run案件写点全部改经Case主体服务,删2个搬家审计私法(-2处as any),spec注入真服务既有断言零改动"
```

---

### Task 3: 两个重复 helper 收敛

**Files:**
- Create: `domain/wallet-no.util.ts`、`domain/asset-decimals.util.ts`
- Modify: `disposition/disposition.service.ts`（:110/:248）、`disposition/adjustment.service.ts`（:544 内联、:667 闭包→:699/:700、:633 decimals）、`sweep/case-aging-sweep.service.ts`（:44 改用 util）、`workflow/wallet-recon-run.service.ts`（:177-179）、`domain/reconciliation-query.service.ts`（:158/:260/:900）

**Interfaces（Produces，Task 4 的 `simulateTimeout` 搬家用）:**

```ts
// domain/wallet-no.util.ts
import { PrismaService } from '../../../../core/prisma/prisma.service';
/** 钱包业务键——跨钱包合成案件的 'XREF:' 前缀不是真 Wallet.id，查了必空。 */
export async function resolveWalletNo(prisma: PrismaService, ref: string | null | undefined): Promise<string | null> {
  if (!ref || String(ref).startsWith('XREF:')) return null;
  const w = await prisma.wallet.findUnique({ where: { id: ref }, select: { walletNo: true } });
  return w?.walletNo ?? null;
}
```

```ts
// domain/asset-decimals.util.ts
export function decimalsMapOf(assets: ReadonlyArray<{ code: string; decimals: number }>): Map<string, number> {
  return new Map(assets.map((a) => [a.code, a.decimals]));
}
```

- [ ] **Step 1: 建两个 util**（逐字用上面代码；`resolveWalletNo` 的 XREF 注释保留——它是 case-aging :43 与 adjustment :666 注释的合并真身）
- [ ] **Step 2: 替换 walletNo 纯反查 5 处**：disposition :110/:248、adjustment :544、adjustment :667 闭包整段删除（:699/:700 改调 `resolveWalletNo(this.prisma, ...)`）、sweep :44（`this.caseAging.walletNoOf(...)` → `resolveWalletNo(this.prisma, c.walletRef)`——sweep 已注入 prisma？没有则加）。**不动**：query :460（walletNo+ownerId 双字段）与 supplement-evidence :150（整行取用）——select 集合不同不算同款（spec §1.4）；`case-aging.service.ts` 的 `walletNoOf` 方法留到 Task 4 随拨钟一起退役
- [ ] **Step 3: 替换 decimals Map 5 处**（adjustment :633 那处的 `(a: any)` 一并消失；recon-run :177-179 保留 `as Array<...>` 之外的查询不动，只把 `new Map(...)` 换 `decimalsMapOf(assetsForDecimals)`）
- [ ] **Step 4: 预期终态复核**

```bash
grep -rn "select: { walletNo: true }" src/modules/clearing-settle src/modules/asset-treasury/internal-transfers src/modules/governance/incidents --include='*.ts' | grep -v spec | grep -v wallet-no.util
grep -rn "\.decimals\]" src/modules/clearing-settle --include='*.ts' | grep -v spec | grep -v asset-decimals.util
```

Expected：第一条只剩 `case-aging.service.ts` 1 处（Task 4 清零）；第二条 0。

- [ ] **Step 5: 三域 jest + 闸① 全绿 → Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/wallet-no.util.ts src/modules/clearing-settle/reconciliation/domain/asset-decimals.util.ts src/modules/clearing-settle/reconciliation/disposition src/modules/clearing-settle/reconciliation/sweep src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts
git commit -m "refactor(波三T3): walletNo反查与decimals Map两个重复件收敛为util——纯反查5处+Map构造5处归一,XREF防御语义逐字保留"
```

---

### Task 4: 拨钟与破线收敛进主体（case-aging 瘦身）

**Files:**
- Modify: `domain/reconciliation-case.service.ts`（补 `simulateTimeout` 实现 + `markSlaBreached` 已有）、`workflow/case-aging.service.ts`（删 `markBreached`/`walletNoOf`/`simulateTimeout`，只剩 `findBreachCandidates`）、`sweep/case-aging-sweep.service.ts`（`markBreached` 改调 caseService）、`controllers/reconciliation-admin.controller.ts`（:72 改调 caseService）、`reconciliation.module.ts`（exports 若列 `CaseAgingService` 核对——域外零消费者已实扫，模块内注入照常）

**Interfaces:**
- Consumes: Task 1 服务 + Task 3 `resolveWalletNo`
- Produces: `ReconciliationCaseService.simulateTimeout(caseNo, actor)` 返回 `{ caseNo: string; slaDeadline: string }`（与现 case-aging 返回形状逐字同）

- [ ] **Step 1: 搬 `simulateTimeout`**：case-aging :55-84 整方法搬进 Case 服务（load→验 OPEN→写 `slaDeadline`→审计→return，六段逐字；`this.walletNoOf(...)` 换 `resolveWalletNo(this.prisma, kase.walletRef)`；审计信封摘 `} as any`——该信封 subjects 已用枚举、字段全在 DTO，摘掉直接编译）。**验 OPEN 的报错文案逐字保留**（`'已结案的案子没有账龄，拨不了钟'`）
- [ ] **Step 2: 瘦身与改线**：case-aging 删三个方法及其 import 残留（波四骨架规矩：孤儿 import 必清）；sweep :33 `this.caseAging.markBreached(c.id)` → `this.caseService.markSlaBreached(c.id)`（注入）；admin controller :72 → `this.caseService.simulateTimeout(caseNo, actor)`（注入）
- [ ] **Step 3: 写点终局复核**：Task 2 Step 6 同一条 grep → **只命中 `reconciliation-case.service.ts`（5 处）**。这就是判据 7 的可机器复核形态
- [ ] **Step 4: 三域 jest + 闸① 全绿；⚡拨钟行为闸**——拨钟是演示件（`DEMO_CLOCK_WRITE`），栈上实走一次：

```bash
bash scripts/on-stack.sh self recon:demo:break > /tmp/w3-t4-break.txt 2>&1; tail -5 /tmp/w3-t4-break.txt
```

Expected：正常完成（break 剧本含账龄场景，会踩到扫描与标记链路）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation
git commit -m "refactor(波三T4): 拨钟+破线标记收敛进Case主体服务(-1处as any),case-aging瘦身只剩候选扫描,Case表写点全仓唯一文件达成"
```

---

### Task 5: 拆 `run()`（机械抽方法）

**Files:**
- Modify: `workflow/wallet-recon-run.service.ts`

**Interfaces（内部私法，签名给定防命名漂移）:**

```ts
private async processAttributedWallet(args: {
  walletRef: string; bal: AttributedBalance;      // bal 的现类型照文件内声明
  cutoff: Date; runId: string; traceId: string | null;
  businessDate: string; slaDeadline: Date; decimals: number;
}): Promise<{
  observed: boolean;                               // false = resolveAssetId 缺席跳过
  snapshotRow: Prisma.ReconciliationRunWalletCreateManyInput | null;
  bucket: ReconBucket | null;
  caseOutcome: 'CREATED' | 'REOBSERVED' | null; breaking: boolean;
  orphanInternal: number; orphanExternal: number; mismatch: number;
}>;
private async processUnattributedHead(args: {
  bal: UnattributedBalance; runId: string; traceId: string | null;
  businessDate: string; slaDeadline: Date;
}): Promise<{ observed: boolean; snapshotRow: Prisma.ReconciliationRunWalletCreateManyInput | null; caseOutcome: 'CREATED' | 'REOBSERVED' | null }>;
```

- [ ] **Step 1: 抽两个循环体**：:206-326 归属钱包循环体 → `processAttributedWallet`；:328-388 未归属循环体 → `processUnattributedHead`。**剪切粘贴式搬运**：语句顺序、注释（含 2026-08-29 自愈事故注释等历史注释）原样随行；`run()` 主体只剩：预门（INTERNAL_BREAK 两个早退）→ createRun → 载入余额与 decimals → 两个循环（收集 outcome 聚合计数/集合/快照行）→ 快照 createMany → autoHealCases → finishRun + auditRunCompleted + return
- [ ] **Step 2: 闸① + 三域 jest 全绿**（recon-run spec 打的是公有 `run()`，私法重排零感知）
- [ ] **Step 3: 行数复核**：`awk 'NR>=<run 新起行> && /^  }$/{print NR; exit}'` 确认 `run()` 主体已成编排段（预期 ≤ 150 行，不设硬指标、记录实数）
- [ ] **Step 4: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts
git commit -m "refactor(波三T5): run()拆成编排+两个循环体私法(processAttributedWallet/processUnattributedHead),剪切粘贴式搬运注释随行"
```

---

### Task 6: FlowComparisonBuilder 挪件 + `getCase()` 就地拆 + 3 处查询投影

**Files:**
- Create: `domain/flow-comparison.builder.ts`
- Modify: `domain/reconciliation-query.service.ts`、`reconciliation.module.ts`（providers 加 builder）

**Interfaces:**

```ts
// domain/flow-comparison.builder.ts
@Injectable()
export class FlowComparisonBuilder {
  constructor(prisma: PrismaService, walletFlowMatcher: WalletFlowMatcherService, explainedDifferences: ExplainedDifferenceService) {}
  build(kase: { walletRef: string; cutoff: Date; businessDate: string; assetCode: string }): Promise<{ rows: FlowComparisonRow[]; summary: FlowComparisonSummary }>;
}
```

- [ ] **Step 1: 挪 builder**：query :963-1160 整段（含只被它用的类型/局部件）搬进新文件成 `build()`；`FlowComparisonRow` / `FlowComparisonSummary` 类型定义在哪就从哪 import，若定义在 query service 文件内且 getCase 也用 → 类型留原文件导出、builder import（**新导出有真实消费者**）。query ctor 换注入 builder；搬完 `grep -n "this\.walletFlowMatcher\|this\.explainedDifferences" reconciliation-query.service.ts` → 零命中则从 ctor 删这两个依赖（自身清理），有命中则留
- [ ] **Step 2: `getCase()` 就地拆**（剪切粘贴式，段落即切面）：
  - `resolveCaseCutoff(...)`——:380-410 的 cutoff/businessDate 决策段
  - `loadAnnotationContext(...)`——:445-513 的 transfers 双 Map / walletOwner+availableMinor / dispositions / incidents / dByFlow·dByExt / matchedKeys / demoLineCauses 装载段，返回一个 ctx 对象（字段名照局部变量名）
  - `annotateRow(r, ctx)`——:514-690 行注解循环体（处置菜单 / demo 成因 / 账龄核销 / 事故认损 / funding nextStep 全家）
  - `appendInTransitRows(...)`——:675-730 在途行追加段
  - 收尾观测与 DTO 组装留 `getCase()` 主体
  - 边界按当前文件实际段落定，行号漂了以段落注释为锚；**不改任何计算**
- [ ] **Step 3: 清 3 处投影 `as any`**：:476 `dispositions ... as any[]` → 按用到的字段声明投影行类型；:605/:643 `matchType: r.matchType as any` → `r.matchType` 的真类型收窄到 `RowFacts['matchType']`（行数据源头标注，不在调用点断言；若源头是 string → 在行类型上把 matchType 声明为联合）
- [ ] **Step 4: 闸①②③ + 三域 jest 全绿**（②③照跑：query 出参类型若被 admin-web 触到，这里就会咬）
- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain src/modules/clearing-settle/reconciliation/reconciliation.module.ts
git commit -m "refactor(波三T6): buildFlowComparison挪独立FlowComparisonBuilder(-198行),getCase()拆五段编排,3处查询投影as any换真类型"
```

---

### Task 7: 铁律③ 直写修复（划转 workflow）

**Files:**
- Modify: `src/modules/asset-treasury/internal-transfers/internal-transfer.service.ts`（加方法）、`internal-transfer-workflow.service.ts`（:130 改调 + :133/:143 清）

**Interfaces:**

```ts
// internal-transfer.service.ts —— 照 FundsOrderService.stampExternalRef 先例（funds-order.service.ts:205）
/** 铁律③：approvalNo 回填走主体服务，workflow 不直写自己域外……的表。 */
async stampApprovalNo(transferNo: string, approvalNo: string): Promise<void> {
  await this.prisma.internalTransfer.update({ where: { transferNo }, data: { approvalNo } });
}
```

- [ ] **Step 1**: 加 `stampApprovalNo`；workflow :130 → `await this.transfers.stampApprovalNo(row.transferNo, approval.approvalNo)`
- [ ] **Step 2**: 清 :133 `(extra as any).externalRef`——`extra` 在同方法上文构造，给它的声明补上 `externalRef?: string | null`（或按实际构造收窄），调用点直接 `extra.externalRef ?? null`；清 :143 `{ reason: dto.reason } as any`——看 `approvals.cancel` 第二参真实类型，字段齐则摘掉即过，缺必填字段则属真冲突 → 熔断上报
- [ ] **Step 3**: 闸① + 划转域 jest 全绿：

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_<树名>/dev.db" npx jest src/modules/asset-treasury/internal-transfers
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/internal-transfers
git commit -m "fix(波三T7): 铁律③——划转approvalNo回填改走InternalTransferService.stampApprovalNo(照stampExternalRef先例),同方法2处as any清零"
```

---

### Task 8: `dispositionsFor()` 硬边界（本波唯一行为变更，演示不可达）

**Files:**
- Modify: `disposition/cause-registry.ts`（:121-134 一处分支）、`disposition/cause-registry.spec.ts`

- [ ] **Step 1: 先写失败测试**（加进 `cause-registry.spec.ts`）：

```ts
describe('dispositionsFor — AMOUNT_MISMATCH×FIRM 硬边界（波三，spec §2.4）', () => {
  it('可调账来源（WITHDRAWAL）：RECORD 与 REVERSE 都给', () => {
    const kinds = dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', internalSourceType: 'WITHDRAWAL' });
    expect(kinds).toEqual(expect.arrayContaining(['RECORD', 'REVERSE']));
  });
  it('不可调账来源（SWAP）：只给 RECORD——冲销只对 DEPOSIT/WITHDRAW 系开放（A1b 甲）', () => {
    const kinds = dispositionsFor({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM', internalSourceType: 'SWAP' });
    expect(kinds).toContain('RECORD');
    expect(kinds).not.toContain('REVERSE');
  });
});
```

先 `grep -n "AMOUNT_MISMATCH" src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts src/modules/clearing-settle/reconciliation/disposition/*.spec.ts src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts` 排查既有断言是否锚定旧行为（FIRM 恒给 REVERSE）——有则按新行为更新，commit 文案点名 spec §2.4（这是唯一允许改既有断言的场合）。

- [ ] **Step 2: 跑测确认第 2 条红**（现状 REVERSE 无条件给）
- [ ] **Step 3: 改一处分支**：

```ts
    else { out.push('RECORD'); if (sourceAdjustable(facts.internalSourceType)) out.push('REVERSE'); }
```

- [ ] **Step 4: 跑测全绿 + 变异实证乙**：把门改回 `out.push('RECORD', 'REVERSE')` → 第 2 条必红，还原复绿；两次输出存 `$E/mutation-firm-gate-{red,green}.txt`
- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence
git commit -m "fix(波三T8): dispositionsFor补AMOUNT_MISMATCH×FIRM硬边界——REVERSE过sourceAdjustable门,RECORD不设门(体检黄1,种子不可达,变异实证在案)"
```

---

### Task 9: `as any` 扫尾 18 处 + DTO 先例式补字段 + 销账

**Files:**
- Modify: `src/modules/audit-logging/dto/audit-log.dto.ts`、`disposition/adjustment.service.ts`、`disposition/disposition.service.ts`、`disposition/push-order.service.ts`、`sweep/case-aging-sweep.service.ts`、`controllers/reconciliation-admin.controller.ts`、`workflow/wallet-recon-run.service.ts`、`src/modules/governance/incidents/incidents.controller.ts`（及 `dto/incident.dto.ts`）、必要时 `src/modules/accounting/tigerbeetle/*.ts`（仅返回类型标注）、`doc-final/TOOLING-DEBT.md`

**逐族修法（发现任何一处需要改运行时行为才能解 → 熔断停手，不许硬修）：**

- [ ] **Step 1: DTO 补两个字段**（`audit-log.dto.ts`，紧挨 `payloadDigest` 后，注释照该文件三个先例的文体写明"只为满足词表 requiredFields 校验的顶层声明"）：

```ts
  /** 词表 requiredFields 顶层声明（同 authnMethod/payloadDigest 先例）：
   *  RECON_DISPOSITION_RECORDED 声明 causeCode/outlet 必填，assertActionSpec 只查 input 顶层。 */
  @ApiPropertyOptional() @IsOptional() @IsString()
  causeCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  outlet?: string;
```

依据：`audit-actions.constant.ts:871` `RECON_DISPOSITION_RECORDED: { requiredFields: ['causeCode','outlet'] }`——这两个键是运行时校验读取的**真实接受字段**，DTO 缺声明才逼出 `as any`；补可选字段=对齐类型与真实用法，不是放宽（spec §1.3"逐处对齐字段；不改 DTO 语义"）。**收尾 WRAPUP 单列一段点名此改动。**

- [ ] **Step 2: 审计信封族 6 处**（adjustment :513/:870/:1007、disposition :135、push-order :261、sweep :62）：摘 `} as any` → 按 tsc 报错逐个修，预期只有一类错：subjects 里的裸字符串（`'PRIMARY'` / `'RELATED'` / `'RECONCILIATION_CASE'`）→ 换 `AuditSubjectRole.PRIMARY` / `AuditSubjectRole.RELATED` / `AuditEntityTypes.RECONCILIATION_CASE`（枚举值同字符串，落库零变化）。冒出**不在 DTO 也不在词表 requiredFields** 的顶层键 → 熔断上报，不许塞 metadata（改落库形状=改行为）
- [ ] **Step 3: actor 两处**（recon-run :1053 `input.actor as any`、admin-controller :36 字面量 cast）：摘掉直接编译——`AuditActorContext` 四字段与字面量逐字对上；若报错说明 import 的是别的 ActorContext 类型 → 换成 `AuditActorContext` import，不改字段
- [ ] **Step 4: 记账边界 4 处**（adjustment :790/:791/:924/:925）：摘 `as any`——`resolveTbAccountId` 真实入参 `{ code: number; ledger: number; ownerType: string; ownerUuid?: string }`，`ownerFor()` 返回已是该形状的子集，预期直接编译；报错则按真实类型收窄 `ownerFor` 的返回声明
- [ ] **Step 5: incidents controller 4 处**（:52/:90/:98/:106 `dto as any`）：对照 `dto/incident.dto.ts` 的 Body 类与 `incident.constants.ts` 的服务侧 interface 逐字段比对；结构兼容则直接摘 cast；个别字段类型不齐（如 string vs 字面量联合）→ 收窄 **Body 类**的属性类型（校验装饰器不动）；Body 缺服务侧必填字段 → 熔断上报
- [ ] **Step 6: TB 返回值 1 处**（recon-run :539）：看 `TigerBeetleService.lookupAccounts` 的声明返回；若为 `any`/宽类型 → 给该方法补真实返回类型标注（tigerbeetle client 的 Account 结构含 `id/code/debits_posted/credits_posted`，纯标注零行为），调用点摘 cast
- [ ] **Step 7: 注释措辞**：adjustment :334 注释里的 `as any` 字样微调（如"靠 `any` 断言掩盖类型缺口"），原意不动
- [ ] **Step 8: 归零复核 + 三闸 + 三域 jest**

```bash
grep -rn " as any" src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers --include='*.ts' | grep -v '\.spec\.ts' | grep -v "this\.prisma as any" | wc -l
```

Expected：**0**。（spec §5 闸 6 判据；`this.prisma as any` 排除项此时也应恒 0，顺手 `grep -c "this\.prisma as any"` 复核波一战果未回潮。）

- [ ] **Step 9: TOOLING-DEBT:143 销账**：整条 `- [ ]` 改 `- [x] ~~...~~`，尾注"2026-09-20 波三清零（26 处全清 + DTO 补 causeCode/outlet 两个先例式声明），销账 commit 见波三合并"
- [ ] **Step 10: Commit**

```bash
git add src/modules/audit-logging/dto/audit-log.dto.ts src/modules/clearing-settle src/modules/governance/incidents src/modules/accounting doc-final/TOOLING-DEBT.md
git commit -m "fix(波三T9): 三域非prisma as any清零(18处扫尾)——审计subjects换枚举+DTO按payloadDigest先例补causeCode/outlet+记账边界四处真类型+incidents dto对齐+TB返回类型,TOOLING-DEBT:143销账"
```

---

### Task 10: 收尾闸全套 + 对照 diff + 承接

**Files:** `$E` 物证、`doc-final/superpowers/specs/2026-09-20-act6-wave4-skeleton.md`（新建）、总纲状态行、`CHANGELOG.md`

- [ ] **Step 1: 三闸 + 三域 jest 终跑**（①②③ + jest 实数与归因：基线 28/556 → 本波预期 +1 suite（T1）+2 tests（T8）±，收尾按实际报）
- [ ] **Step 2: 栈级 after 采样 + 归一 diff**（与 Task 0 同一流程、同一栈）：

```bash
E=doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence
N=doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/normalize-rules.sh
bash scripts/stack.sh reset self && bash scripts/stack.sh up self
bash scripts/on-stack.sh self demo:all         > "$E/demoall-after.txt" 2>&1
bash scripts/on-stack.sh self recon:demo:break > "$E/break-after.txt"   2>&1
bash "$N" "$E/demoall-after.txt" > "$E/demoall-after.norm.txt"
bash "$N" "$E/break-after.txt"   > "$E/break-after.norm.txt"
diff "$E/demoall-before.norm.txt" "$E/demoall-after.norm.txt" | tee "$E/demoall-diff.txt"
diff "$E/break-before.norm.txt"   "$E/break-after.norm.txt"   | tee "$E/break-diff.txt"
```

Expected：**两个 diff 为空**。非空 → 逐行归因：是归一规则没盖住的天然变动（如实补充规则并在 WRAPUP 里登记新规则条目及理由），还是真行为差异（**回去修代码，不许改基线**）。

- [ ] **Step 3: `verify:coa`**

```bash
bash scripts/on-stack.sh self verify:coa
```

Expected：恒等式 + 57 科目负余额全绿。

- [ ] **Step 4: 写点终局三证**（进 WRAPUP）：判据 7 grep（唯一文件 5 处）｜ `as any` 归零 grep ｜ 变异两组物证文件名
- [ ] **Step 5: `$E/WRAPUP.md`**：对照 `rules/delivery-checklist.md` 逐条 + spec §5 九道闸逐条填实测值（jest 实数、diff 空、DTO 补字段说明段、熔断触发情况=预期零）
- [ ] **Step 6: 波四骨架 + 总纲回写 + CHANGELOG**：新建 `2026-09-20-act6-wave4-skeleton.md`（总纲链接 / 承接节：实际偏差 · 新事实 · 波四前提——**必须点名"后端读面契约本波有无变更"**，预期"无"，有则逐条列）；总纲状态行"波三 已完成（…）｜ 波四 骨架已立"；`CHANGELOG.md` 加一行
- [ ] **Step 7: Commit**

```bash
git add doc-final
git commit -m "test(波三收尾物证): 栈级归一diff两份均空+verify:coa全绿+写点唯一文件grep+变异两组入档;波四骨架承接+总纲回写+CHANGELOG一行"
```

（合并进 main 由业主批：合并后按 CLAUDE.md §10 重启后端 + `db:base:sync`——本波不动 RBAC，sync 预期零变化；spec 与 plan 随后归档 `doc-final/archive/`。）

---

## Self-Review 记录（写完当日）

1. **Spec 覆盖**：§2.1→T1/T2/T4｜§2.2→T5/T6（writeLineItems 未挪位，白名单不动）｜§2.3→T7｜§2.4→T8｜§2.5→T3｜§2.6→T2/T4/T6/T7/T9（26 处归属对照表）｜§5 九闸→T0/T10 + 各任务步骤｜§6 风险三条→Global Constraints 熔断条款 + T9 Step 1/2/5。无缺口。
2. **占位符**：无 TBD/TODO；"边界按段落定"类步骤均给了段落表与锚。
3. **类型一致性**：`ReconciliationCaseService` 七个方法名在 T1（定义）/T2（openCase·reObserve·resolveAutoHealed·findOpenByWallet）/T4（simulateTimeout·markSlaBreached）逐字一致；`resolveWalletNo`/`decimalsMapOf` 在 T3 定义、T4 消费；`buildSvc` 工厂第 7 参与 T1 构造签名一致。
